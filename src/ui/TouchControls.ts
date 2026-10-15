/**
 * On-screen buttons for phones and tablets (HTML overlay above the canvas).
 * Buttons feed actions into the shared InputMap, so gameplay code is unchanged.
 */
import type { Action } from '../core/settings';
import type { InputMap } from '../systems/input';
import type { Settings } from '../core/settings';

export type TouchContext = 'hidden' | 'world' | 'fight' | 'dialogue' | 'menu' | 'cutscene' | 'minigame';

export function hasTouchScreen(): boolean {
  if (typeof window === 'undefined') return false;
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints ?? 0) > 0;
}

/** Whether touch-style UI (buttons, hints) should be used. */
export function touchUI(settings: Settings): boolean {
  return settings.touch === 'on' || (settings.touch === 'auto' && hasTouchScreen());
}

const CSS = `
.tc { position: fixed; inset: 0; pointer-events: none; z-index: 10; font-family: "Tiny5", "PT Sans", sans-serif;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.tc[hidden] { display: none; }
.tc button { pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent;
  background: rgba(16, 21, 42, .58); color: #f6c36a; border: 2px solid rgba(240, 168, 72, .85);
  font: inherit; letter-spacing: .03em; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 0 rgba(0,0,0,.45); padding: 0; margin: 0; }
.tc button.on { background: rgba(240, 168, 72, .55); color: #0b0e1e; }
.tc button[hidden] { display: none; }
.tc .pad { position: absolute; display: flex; gap: 14px;
  left: max(14px, env(safe-area-inset-left, 0px)); bottom: max(14px, env(safe-area-inset-bottom, 0px)); }
.tc .pad button { width: 76px; height: 76px; border-radius: 50%; }
.tc .pad svg { width: 30px; height: 30px; fill: currentColor; }
.tc .acts { position: absolute; display: grid; gap: 12px; grid-template-columns: auto auto; align-items: end;
  right: max(14px, env(safe-area-inset-right, 0px)); bottom: max(14px, env(safe-area-inset-bottom, 0px)); }
.tc .acts .main { width: 92px; height: 92px; border-radius: 50%; font-size: 15px; grid-column: 2; grid-row: 1 / span 2; }
.tc .acts .small { width: 72px; height: 44px; border-radius: 22px; font-size: 13px; grid-column: 1; }
.tc .top { position: absolute; display: flex; gap: 10px;
  right: max(14px, env(safe-area-inset-right, 0px)); top: max(12px, env(safe-area-inset-top, 0px)); }
.tc .top button { height: 38px; padding: 0 14px; border-radius: 19px; font-size: 13px; }
.tc-rotate { position: fixed; inset: 0; z-index: 20; background: #070913; color: #eef1fb; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 18px; text-align: center; font: 18px "PT Sans", sans-serif;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.tc-rotate[hidden] { display: none; }
.tc-rotate .phone { width: 46px; height: 76px; border: 3px solid #f6c36a; border-radius: 8px; animation: tc-turn 2.4s ease-in-out infinite; }
@keyframes tc-turn { 0%, 30% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
@media (prefers-reduced-motion: reduce) { .tc-rotate .phone { animation: none; transform: rotate(-90deg); } }
.tc-rotate button { background: none; color: #f6c36a; border: 2px solid #f6c36a; border-radius: 22px; padding: 10px 20px;
  font: 16px "PT Sans", sans-serif; }
`;

const ARROW_L = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1 L2 5 L7 9 Z"/></svg>';
const ARROW_R = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1 L8 5 L3 9 Z"/></svg>';

export class TouchControls {
  private root: HTMLDivElement;
  private rotate: HTMLDivElement;
  private btn: Record<string, HTMLButtonElement> = {};
  private context: TouchContext = 'hidden';
  private inCutscene = false;
  private enabled = false;
  private rotateDismissed = false;

  constructor(private input: InputMap) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'tc';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="pad">
        <button data-k="left" aria-label="Влево">${ARROW_L}</button>
        <button data-k="right" aria-label="Вправо">${ARROW_R}</button>
      </div>
      <div class="acts">
        <button class="small" data-k="block">Блок</button>
        <button class="small" data-k="sprint">Бег</button>
        <button class="main" data-k="interact">Действие</button>
      </div>
      <div class="top">
        <button data-k="fullscreen">Во весь экран</button>
        <button data-k="journal">Дневник</button>
        <button data-k="pause">Пауза</button>
      </div>`;
    document.body.appendChild(this.root);
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const k = b.dataset.k!;
      this.btn[k] = b;
      if (k === 'fullscreen') {
        b.addEventListener('click', () => this.fullscreen());
        return;
      }
      const action = k as Action;
      const press = (e: PointerEvent) => {
        e.preventDefault();
        try {
          b.setPointerCapture?.(e.pointerId);
        } catch {
          /* synthetic events have no capturable pointer */
        }
        b.classList.add('on');
        this.input.virtual(action, true);
      };
      const release = (e: PointerEvent) => {
        e.preventDefault();
        b.classList.remove('on');
        this.input.virtual(action, false);
      };
      b.addEventListener('pointerdown', press);
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', release);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    this.rotate = document.createElement('div');
    this.rotate.className = 'tc-rotate';
    this.rotate.hidden = true;
    this.rotate.innerHTML = `<div class="phone" aria-hidden="true"></div>
      <p>Поверните телефон горизонтально —<br>так двор видно целиком.</p>
      <button type="button">Играть вертикально</button>`;
    this.rotate.querySelector('button')!.addEventListener('click', () => {
      this.rotateDismissed = true;
      this.refreshRotate();
    });
    document.body.appendChild(this.rotate);
    window.addEventListener('resize', () => this.refreshRotate());
    document.addEventListener('fullscreenchange', () => this.refresh());
  }

  private fullscreen() {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    try {
      const p = req?.() as Promise<void> | undefined;
      p?.then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {})).catch(() => {});
    } catch {
      /* not supported (e.g. iPhone Safari) */
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.refresh();
  }

  get active() {
    return this.enabled;
  }

  /** Called every frame by the UI scene with the current situation. */
  setContext(ctx: TouchContext, cutscene = false) {
    if (ctx === this.context && cutscene === this.inCutscene) return;
    this.context = ctx;
    this.inCutscene = cutscene;
    this.refresh();
  }

  private refresh() {
    const show = this.enabled && this.context !== 'hidden';
    this.root.hidden = !show;
    if (!show) {
      this.input.reset();
      for (const b of Object.values(this.btn)) b.classList.remove('on');
    }
    const c = this.context;
    const moving = c === 'world' || c === 'fight';
    this.btn.left.hidden = !moving;
    this.btn.right.hidden = !moving;
    this.btn.block.hidden = c !== 'fight';
    this.btn.sprint.hidden = !moving;
    this.btn.interact.hidden = c === 'menu' || c === 'cutscene';
    this.btn.journal.hidden = c !== 'world';
    this.btn.pause.hidden = c === 'menu' || c === 'minigame';
    this.btn.pause.textContent = this.inCutscene ? 'Пропустить' : 'Пауза';
    const fsOk = !!document.documentElement.requestFullscreen && !document.fullscreenElement;
    this.btn.fullscreen.hidden = !fsOk || c !== 'world';
    this.btn.interact.textContent = c === 'fight' ? 'Толкнуть' : c === 'dialogue' ? 'Дальше' : c === 'minigame' ? 'Тянуть' : 'Действие';
    this.btn.sprint.textContent = c === 'fight' ? 'Уворот' : 'Бег';
    this.refreshRotate();
  }

  private refreshRotate() {
    const portrait = window.innerHeight > window.innerWidth;
    this.rotate.hidden = !(this.enabled && portrait && !this.rotateDismissed);
  }
}
