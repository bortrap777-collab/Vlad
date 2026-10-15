/** Ryzhiy the dog: tied & scared → follows Kolya → sits / digs. */
import Phaser from 'phaser';
import { GROUND_Y } from '../config';

export type DogMode = 'tied' | 'follow' | 'sit' | 'goto' | 'dig' | 'flee';

export class Dog {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  readonly cans: Phaser.GameObjects.Image[] = [];
  private rope: Phaser.GameObjects.Graphics;
  mode: DogMode = 'tied';
  target = 0;
  facing: 1 | -1 = -1;
  private tiedAt: number;
  private onArrive: (() => void) | null = null;
  private barkTimer = 0;

  constructor(private scene: Phaser.Scene, x: number, tied: boolean, private postX: number) {
    this.tiedAt = postX;
    this.shadow = scene.add.image(x, GROUND_Y + 1, 'shadow').setAlpha(0.4).setDepth(37);
    this.sprite = scene.add.sprite(x, GROUND_Y + 2, 'dog', 0).setOrigin(0.5, 1).setDepth(38);
    this.rope = scene.add.graphics().setDepth(37);
    if (tied) {
      for (let i = 0; i < 3; i++) this.cans.push(scene.add.image(x, GROUND_Y, 'can').setOrigin(0.5, 1).setDepth(38));
      this.mode = 'tied';
      this.sprite.play('dog_cower');
    } else {
      this.mode = 'sit';
      this.sprite.play('dog_sit');
    }
    this.face(-1);
  }

  get x() {
    return this.sprite.x;
  }

  face(d: 1 | -1) {
    this.facing = d;
    this.sprite.setFlipX(d < 0);
  }

  /** Startled: jumps away from Kolya, cans rattling. */
  panic(fromX: number) {
    if (this.mode !== 'tied') return;
    const dir = this.x > fromX ? 1 : -1;
    this.scene.tweens.add({ targets: this.sprite, x: this.tiedAt + dir * 12, duration: 180, ease: 'Quad.easeOut' });
    this.sprite.play('dog_cower');
  }

  calm() {
    if (this.mode === 'tied') this.sprite.play('dog_idle');
  }

  release() {
    this.mode = 'follow';
    for (const c of this.cans) {
      this.scene.tweens.add({ targets: c, y: c.y + 2, angle: 90, alpha: 0, duration: 900, delay: 300, onComplete: () => c.destroy() });
    }
    this.cans.length = 0;
    this.rope.clear();
    this.sprite.play('dog_idle');
  }

  goTo(x: number, then?: () => void) {
    this.mode = 'goto';
    this.target = x;
    this.onArrive = then ?? null;
  }

  sit() {
    this.mode = 'sit';
    this.sprite.play('dog_sit', true);
  }

  bark() {
    this.sprite.play('dog_bark', true);
    this.barkTimer = 1.2;
  }

  update(dt: number, playerX: number, playerMoving: boolean) {
    const s = this.sprite;
    this.shadow.x = s.x;
    if (this.barkTimer > 0) {
      this.barkTimer -= dt;
      if (this.barkTimer <= 0) s.play(this.mode === 'sit' ? 'dog_sit' : 'dog_idle', true);
      return;
    }
    if (this.mode === 'tied') {
      // cans dangle behind the tail, rope to the post
      this.cans.forEach((c, i) => {
        c.x = s.x - this.facing * (14 + i * 5) + Math.sin(this.scene.time.now / 300 + i) * 0.6;
        c.y = GROUND_Y + 2 - (i % 2);
      });
      this.rope.clear().lineStyle(1, 0xb8a888, 1).lineBetween(this.postX + 4, GROUND_Y - 6, s.x + this.facing * 10, GROUND_Y - 14);
      if (Math.abs(playerX - s.x) < 70) this.face(playerX > s.x ? 1 : -1);
      return;
    }
    let goal: number | null = null;
    let speed = 70;
    if (this.mode === 'follow') {
      const behind = playerX - (playerMoving ? 22 : 18) * Math.sign(playerX - s.x || 1);
      if (Math.abs(behind - s.x) > 10) goal = behind;
      speed = Math.abs(behind - s.x) > 60 ? 110 : 70;
    } else if (this.mode === 'goto') {
      goal = this.target;
      speed = 100;
    }
    if (goal !== null) {
      const dx = goal - s.x;
      const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      s.x += step;
      this.face(dx > 0 ? 1 : -1);
      s.play(speed > 90 ? 'dog_run' : 'dog_walk', true);
      if (Math.abs(goal - s.x) < 1.5 && this.mode === 'goto') {
        this.mode = 'dig';
        s.play('dog_cower', true); // low, nose in the snow — reads as digging
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      }
    } else if (this.mode === 'follow') {
      this.face(playerX > s.x ? 1 : -1);
      s.play('dog_idle', true);
    }
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
    this.rope.destroy();
    this.cans.forEach((c) => c.destroy());
  }
}
