/** Reusable UI building blocks (960×540 UI space, rendered at 2× for crisp text). */
import Phaser from 'phaser';
import { COLORS, FONT_TEXT, FONT_TITLE, UI_ZOOM } from '../config';
import { services } from '../services';

export function txt(scene: Phaser.Scene, x: number, y: number, s: string, size = 18, color: string = COLORS.text, opts: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}, title = false) {
  return scene.add
    .text(x, y, s, { fontFamily: title ? FONT_TITLE : FONT_TEXT, fontSize: `${size}px`, color, ...opts })
    .setResolution(UI_ZOOM);
}

/** Panel with a dark navy fill, a light edge and warm corner pixels (matches ui_frame.png). */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 0.94): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0x070913, alpha).fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle(COLORS.panelEdge, 1).fillRect(x, y, w, h);
  g.fillStyle(COLORS.panel, alpha).fillRect(x + 2, y + 2, w - 4, h - 4);
  g.fillStyle(0x161d38, alpha).fillRect(x + 4, y + 4, w - 8, 2);
  g.fillStyle(COLORS.accent, 1);
  for (const [cx, cy] of [[x + 4, y + 4], [x + w - 6, y + 4], [x + 4, y + h - 6], [x + w - 6, y + h - 6]]) g.fillRect(cx, cy, 2, 2);
  return g;
}

export interface MenuItem {
  label: string | (() => string);
  onSelect?: () => void;
  onAdjust?: (dir: -1 | 1) => void;
  disabled?: () => boolean;
  hint?: string;
}

/**
 * Vertical keyboard + mouse menu. ↑/↓ (or W/S) to move, Enter/E/Space to select,
 * ←/→ (or A/D) to adjust sliders.
 */
export class Menu {
  index = 0;
  readonly texts: Phaser.GameObjects.Text[] = [];
  readonly cursor: Phaser.GameObjects.Text;
  readonly container: Phaser.GameObjects.Container;
  hintText?: Phaser.GameObjects.Text;
  active = true;

  constructor(scene: Phaser.Scene, x: number, y: number, private items: MenuItem[], opts: { size?: number; gap?: number; align?: 'left' | 'center'; title?: boolean; hintY?: number } = {}) {
    const size = opts.size ?? 22;
    const gap = opts.gap ?? size + 14;
    const align = opts.align ?? 'left';
    this.container = scene.add.container(0, 0);
    items.forEach((_it, i) => {
      const t = txt(scene, x, y + i * gap, '', size, COLORS.text, {}, opts.title ?? true).setOrigin(align === 'center' ? 0.5 : 0, 0.5);
      t.setInteractive({ useHandCursor: true });
      t.on('pointerover', () => {
        if (!this.active || this.isDisabled(i)) return;
        if (this.index !== i) services().audio.sfx('sfx_ui_move', { volume: 0.5 });
        this.index = i;
        this.refresh();
      });
      t.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!this.active || this.isDisabled(i)) return;
        this.index = i;
        const item = this.items[i];
        if (item.onAdjust && !item.onSelect) {
          const bounds = t.getBounds();
          item.onAdjust(p.x / UI_ZOOM < bounds.centerX ? -1 : 1);
        } else this.select();
        this.refresh();
      });
      this.texts.push(t);
      this.container.add(t);
    });
    this.cursor = txt(scene, 0, 0, '▸', size, COLORS.accentText, {}, true).setOrigin(1, 0.5);
    this.container.add(this.cursor);
    if (opts.hintY !== undefined) {
      this.hintText = txt(scene, x, opts.hintY, '', 15, COLORS.textDim, { wordWrap: { width: 520 } }).setOrigin(align === 'center' ? 0.5 : 0, 0);
      this.container.add(this.hintText);
    }
    while (this.isDisabled(this.index) && this.index < items.length - 1) this.index++;
    this.refresh();
  }

  private isDisabled(i: number) {
    return !!this.items[i].disabled?.();
  }

  refresh() {
    this.items.forEach((it, i) => {
      const t = this.texts[i];
      const label = typeof it.label === 'function' ? it.label() : it.label;
      t.setText(label);
      const dis = this.isDisabled(i);
      t.setColor(dis ? '#58617e' : i === this.index ? COLORS.accentText : COLORS.text);
    });
    const cur = this.texts[this.index];
    if (cur) {
      const b = cur.getBounds();
      this.cursor.setPosition(b.x - 8, cur.y);
    }
    if (this.hintText) this.hintText.setText(this.items[this.index]?.hint ?? '');
  }

  move(d: number) {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.index + d * k + n * 4) % n;
      if (!this.isDisabled(i)) {
        this.index = i;
        break;
      }
    }
    services().audio.sfx('sfx_ui_move', { volume: 0.5 });
    this.refresh();
  }

  select() {
    const it = this.items[this.index];
    if (!it || this.isDisabled(this.index)) return;
    services().audio.sfx('sfx_ui_ok', { volume: 0.6 });
    if (it.onSelect) it.onSelect();
    else it.onAdjust?.(1);
    this.refresh();
  }

  /** Call every frame while the menu has focus. */
  handleInput(): void {
    if (!this.active) return;
    const inp = services().input;
    if (inp.codePressed('ArrowUp') || inp.codePressed('KeyW')) this.move(-1);
    if (inp.codePressed('ArrowDown') || inp.codePressed('KeyS')) this.move(1);
    const it = this.items[this.index];
    if (it?.onAdjust) {
      if (inp.codePressed('ArrowLeft') || inp.codePressed('KeyA')) {
        it.onAdjust(-1);
        services().audio.sfx('sfx_ui_move', { volume: 0.5 });
        this.refresh();
      }
      if (inp.codePressed('ArrowRight') || inp.codePressed('KeyD')) {
        it.onAdjust(1);
        services().audio.sfx('sfx_ui_move', { volume: 0.5 });
        this.refresh();
      }
    }
    if (inp.codePressed('Enter') || inp.codePressed('Space') || inp.justPressed('interact')) this.select();
  }

  destroy() {
    this.container.destroy();
  }
}

export function bar(v: number, n = 10): string {
  const k = Math.round(v * n);
  return '■'.repeat(k) + '□'.repeat(n - k);
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
