/**
 * Action-mapped keyboard input, independent of Phaser scenes so menus, dialogue and
 * gameplay share one consistent binding table.
 */
import type { Action, Settings } from '../core/settings';

export class InputMap {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** On-screen (touch) buttons feed actions directly, independent of key bindings. */
  private vDown = new Set<Action>();
  private vPressed = new Set<Action>();
  /** When set, the next keydown is delivered here instead (key rebinding UI). */
  captureNext: ((code: string) => void) | null = null;
  private listeners: ((code: string) => void)[] = [];

  constructor(private settings: Settings) {
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (this.captureNext) {
        const fn = this.captureNext;
        this.captureNext = null;
        fn(e.code);
        return;
      }
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      for (const l of this.listeners) l(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => this.reset());
  }

  setSettings(s: Settings) {
    this.settings = s;
  }

  onAnyKey(fn: (code: string) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  isDown(a: Action): boolean {
    return this.vDown.has(a) || this.settings.keys[a].some((k) => this.down.has(k));
  }

  /** True once per physical press; consumes the press. */
  justPressed(a: Action): boolean {
    if (this.vPressed.delete(a)) return true;
    const hit = this.settings.keys[a].find((k) => this.pressed.has(k));
    if (hit) this.pressed.delete(hit);
    return !!hit;
  }

  peekPressed(a: Action): boolean {
    return this.vPressed.has(a) || this.settings.keys[a].some((k) => this.pressed.has(k));
  }

  /** Touch button pressed / released. */
  virtual(a: Action, down: boolean) {
    if (down) {
      if (!this.vDown.has(a)) this.vPressed.add(a);
      this.vDown.add(a);
      for (const l of this.listeners) l('Touch');
    } else this.vDown.delete(a);
  }

  /** A one-shot tap (e.g. touching the interaction prompt). */
  tap(a: Action) {
    this.vPressed.add(a);
  }

  codePressed(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  /** Clear unconsumed presses (call at the end of each frame). */
  endFrame() {
    this.pressed.clear();
    this.vPressed.clear();
  }

  reset() {
    this.down.clear();
    this.pressed.clear();
    this.vDown.clear();
    this.vPressed.clear();
  }
}
