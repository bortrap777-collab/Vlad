/** A character in the world: sprite + ground shadow + animation helpers + scripted movement. */
import Phaser from 'phaser';
import { GROUND_Y } from '../config';
import type { CharId } from '../core/types';

/** Mouth height inside the 80-px frame, per build (kid / teen / adult / old / big). */
const MOUTH_Y: Partial<Record<CharId, number>> = {
  kolya: 48, olya: 48, lyokha: 48, sveta: 43, seryoga: 43, zheka: 43, tolstyi: 45,
  zina: 39, vitya: 32, sasha: 32, alexey: 32, mama: 32, papa: 32,
};

export class Actor {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  facing: 1 | -1 = 1;
  baseAnim = 'idle';
  private moveTween: Phaser.Tweens.Tween | null = null;
  private lockedAnim: string | null = null;
  /** Vertical offset (used for knock-down hops etc.). */
  lift = 0;

  constructor(public readonly scene: Phaser.Scene, public readonly id: CharId, x: number, depth = 40) {
    this.shadow = scene.add.image(x, GROUND_Y + 1, 'shadow').setAlpha(0.45).setDepth(depth - 1);
    this.sprite = scene.add.sprite(x, GROUND_Y + 2, `char_${id}`, 0).setOrigin(0.5, 1).setDepth(depth);
    this.play('idle');
  }

  get x(): number {
    return this.sprite.x;
  }
  set x(v: number) {
    this.sprite.x = v;
    this.shadow.x = v;
  }

  setDepth(d: number) {
    this.sprite.setDepth(d);
    this.shadow.setDepth(d - 1);
  }

  face(dir: 1 | -1) {
    this.facing = dir;
    this.sprite.setFlipX(dir < 0);
  }

  faceTowards(x: number) {
    if (Math.abs(x - this.x) > 1) this.face(x > this.x ? 1 : -1);
  }

  hasAnim(name: string) {
    return this.scene.anims.exists(`${this.id}_${name}`);
  }

  play(name: string, force = false) {
    if (this.lockedAnim && !force) return;
    const key = `${this.id}_${name}`;
    if (!this.scene.anims.exists(key)) return;
    if (this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying && !force) return;
    this.sprite.play(key);
  }

  /** Play a one-shot animation, then return to the base animation. */
  playOnce(name: string): Promise<void> {
    const key = `${this.id}_${name}`;
    if (!this.scene.anims.exists(key)) return Promise.resolve();
    this.lockedAnim = name;
    this.sprite.play(key);
    return new Promise((res) => {
      this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.lockedAnim = null;
        this.play(this.baseAnim, true);
        res();
      });
    });
  }

  /** Hold an animation until released (fight states, cutscene poses). */
  hold(name: string | null) {
    this.lockedAnim = null;
    if (name) {
      this.play(name, true);
      this.lockedAnim = name;
    } else this.play(this.baseAnim, true);
  }

  setBase(name: string) {
    this.baseAnim = name;
    if (!this.lockedAnim) this.play(name);
  }

  /** Scripted walk to x. Resolves on arrival. `instant` teleports (cutscene skip). */
  walkTo(x: number, speed = 60, instant = false, anim = 'walk'): Promise<void> {
    this.moveTween?.stop();
    if (instant || Math.abs(x - this.x) < 1) {
      this.x = x;
      this.play(this.baseAnim, true);
      return Promise.resolve();
    }
    this.face(x > this.x ? 1 : -1);
    this.play(anim, true);
    const duration = (Math.abs(x - this.x) / speed) * 1000;
    return new Promise((res) => {
      this.moveTween = this.scene.tweens.add({
        targets: this,
        x,
        duration,
        ease: 'Linear',
        onComplete: () => {
          this.moveTween = null;
          this.play(this.baseAnim, true);
          res();
        },
      });
    });
  }

  stopMoving() {
    this.moveTween?.stop();
    this.moveTween = null;
  }

  /** Mouth position in world coordinates (for breath vapour). */
  mouth(): { x: number; y: number } {
    const top = this.sprite.y - this.sprite.height;
    return { x: this.x + this.facing * 5, y: top + (MOUTH_Y[this.id] ?? 44) };
  }

  update() {
    this.sprite.y = GROUND_Y + 2 - this.lift;
    this.shadow.setScale(1 - Math.min(0.5, this.lift / 30), 1);
  }

  setVisible(v: boolean) {
    this.sprite.setVisible(v);
    this.shadow.setVisible(v);
  }

  destroy() {
    this.moveTween?.stop();
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
