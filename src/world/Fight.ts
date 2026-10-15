/**
 * Light, age-appropriate scuffle: block / dodge / shove. No blood, no knock-outs —
 * bullies lose their nerve ("resolve") and back off.
 */
import Phaser from 'phaser';
import { FONT_TITLE, GROUND_Y } from '../config';
import { services } from '../services';
import type { Actor } from './Actor';

export interface EnemyCfg {
  resolve: number;
  windup: number;
  recovery: number;
  reach: number;
  damage: number;
  speed: number;
}

type EState = 'approach' | 'wait' | 'windup' | 'attack' | 'recovery' | 'stagger' | 'hurt' | 'flee' | 'gone';

export class Enemy {
  state: EState = 'approach';
  t = 0;
  resolve: number;
  readonly maxResolve: number;
  hitDone = false;
  cooldown = 0.6 + Math.random() * 0.6;
  staggerFor = 1;
  mark: Phaser.GameObjects.Text;
  constructor(public actor: Actor, public cfg: EnemyCfg) {
    this.resolve = cfg.resolve;
    this.maxResolve = cfg.resolve;
    this.mark = actor.scene.add
      .text(actor.x, GROUND_Y - 78, '!', { fontFamily: FONT_TITLE, fontSize: '14px', color: '#ffd27a', stroke: '#2a1408', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setDepth(100)
      .setVisible(false);
  }
  get open() {
    return this.state === 'recovery' || this.state === 'stagger';
  }
  get active() {
    return this.state !== 'flee' && this.state !== 'gone';
  }
}

export interface FightView {
  hp: number;
  maxHp: number;
  enemies: { name: string; resolve: number; max: number; state: string; x: number }[];
  state: 'active' | 'won' | 'lost';
  blocking: boolean;
}

export class Fight {
  hp = 5;
  readonly maxHp = 5;
  state: 'active' | 'won' | 'lost' = 'active';
  private iframes = 0;
  private blocking = false;
  private blockAt = -10;
  private dodgeT = 0;
  private dodgeCd = 0;
  private pushT = 0;
  private pushHit = false;
  private hurtT = 0;
  private time = 0;
  private dogUsed = false;
  private floatTexts: Phaser.GameObjects.Text[] = [];

  constructor(
    private scene: Phaser.Scene,
    private player: Actor,
    readonly enemies: Enemy[],
    private arena: [number, number],
    private opts: { onDogHelp?: (target: Enemy) => void; dogAvailable: boolean; names: string[] },
  ) {}

  view(): FightView {
    return {
      hp: this.hp,
      maxHp: this.maxHp,
      state: this.state,
      blocking: this.blocking,
      enemies: this.enemies.map((e, i) => ({ name: this.opts.names[i], resolve: e.resolve, max: e.maxResolve, state: e.state, x: e.actor.x })),
    };
  }

  private float(x: number, text: string, color = '#eef1fb') {
    const t = this.scene.add
      .text(x, GROUND_Y - 70, text, { fontFamily: FONT_TITLE, fontSize: '9px', color, stroke: '#070913', strokeThickness: 3 })
      .setOrigin(0.5)
      .setResolution(4)
      .setDepth(101);
    this.floatTexts.push(t);
    this.scene.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  private nearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    for (const e of this.enemies) if (e.active && (!best || Math.abs(e.actor.x - this.player.x) < Math.abs(best.actor.x - this.player.x))) best = e;
    return best;
  }

  private shake(intensity: number) {
    if (!services().settings.reducedMotion) this.scene.cameras.main.shake(140, intensity);
  }

  update(dt: number) {
    if (this.state !== 'active') return;
    const sv = services();
    const inp = sv.input;
    const p = this.player;
    this.time += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);

    // ---------------- player
    const target = this.nearestEnemy();
    if (this.hurtT > 0) {
      this.hurtT -= dt;
    } else if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      p.x = Phaser.Math.Clamp(p.x - p.facing * 130 * dt, this.arena[0], this.arena[1]);
      if (this.dodgeT <= 0) p.hold(null);
    } else if (this.pushT > 0) {
      this.pushT -= dt;
      if (!this.pushHit && this.pushT < 0.2) {
        this.pushHit = true;
        this.resolvePush();
      }
      if (this.pushT <= 0) p.hold(null);
    } else {
      const wantBlock = inp.isDown('block');
      if (wantBlock && !this.blocking) this.blockAt = this.time;
      this.blocking = wantBlock;
      if (this.blocking) {
        if (target) p.faceTowards(target.actor.x);
        p.hold('block');
      } else {
        let dir = 0;
        if (inp.isDown('left')) dir -= 1;
        if (inp.isDown('right')) dir += 1;
        if (inp.justPressed('sprint') && this.dodgeCd <= 0) {
          // dodge back, away from where Kolya is facing
          this.dodgeT = 0.22;
          this.dodgeCd = 0.6;
          this.iframes = Math.max(this.iframes, 0.38);
          p.hold('dodge');
          sv.audio.sfx('sfx_whoosh', { volume: 0.6 });
        } else if (inp.justPressed('interact')) {
          if (target) p.faceTowards(target.actor.x);
          this.pushT = 0.34;
          this.pushHit = false;
          p.hold('push');
          sv.audio.sfx('sfx_whoosh', { volume: 0.4, detune: 300 });
        } else if (dir !== 0) {
          p.x = Phaser.Math.Clamp(p.x + dir * 58 * dt, this.arena[0], this.arena[1]);
          p.face(dir > 0 ? 1 : -1);
          p.hold(null);
          p.play('walk');
        } else {
          p.hold(null);
          if (target) p.faceTowards(target.actor.x);
          p.play('idle');
        }
      }
    }
    p.sprite.setAlpha(this.iframes > 0 && this.hurtT <= 0 && this.dodgeT <= 0 ? (Math.floor(this.time * 20) % 2 ? 0.55 : 1) : 1);

    // ---------------- enemies
    const attacking = this.enemies.some((e) => e.state === 'windup' || e.state === 'attack');
    this.enemies.forEach((e, idx) => this.updateEnemy(e, idx, dt, attacking));

    if (this.enemies.every((e) => !e.active)) {
      this.state = 'won';
      p.hold(null);
      p.sprite.setAlpha(1);
    }
  }

  private updateEnemy(e: Enemy, idx: number, dt: number, someoneAttacking: boolean) {
    const a = e.actor;
    const p = this.player;
    const sv = services();
    e.t += dt;
    e.mark.setPosition(a.x, GROUND_Y - (a.id === 'tolstyi' ? 72 : 76));
    const dx = p.x - a.x;
    const dist = Math.abs(dx);
    const toward: 1 | -1 = dx > 0 ? 1 : -1;
    switch (e.state) {
      case 'approach':
      case 'wait': {
        e.cooldown -= dt;
        // the non-attacker keeps a respectful distance, the next attacker closes in
        const myTurn = !someoneAttacking && e.cooldown <= 0;
        const want = myTurn ? e.cfg.reach - 6 : 44 + idx * 8;
        a.faceTowards(p.x);
        if (dist > want + 3) {
          a.x += toward * e.cfg.speed * dt;
          a.play('walk');
        } else if (dist < want - 10 && !myTurn) {
          a.x -= toward * e.cfg.speed * 0.6 * dt;
          a.play('walk');
        } else {
          a.play('idle');
          if (myTurn) {
            e.state = 'windup';
            e.t = 0;
            a.hold('windup');
            e.mark.setVisible(true);
          }
        }
        a.x = Phaser.Math.Clamp(a.x, this.arena[0] - 30, this.arena[1] + 30);
        break;
      }
      case 'windup':
        e.mark.setScale(1 + Math.sin(e.t * 30) * 0.15);
        if (e.t >= e.cfg.windup) {
          e.state = 'attack';
          e.t = 0;
          e.hitDone = false;
          e.mark.setVisible(false);
          a.hold('attack');
          sv.audio.sfx('sfx_whoosh', { volume: 0.5, detune: -200 });
          // a small lunge
          this.scene.tweens.add({ targets: a, x: a.x + a.facing * 6, duration: 90 });
        }
        break;
      case 'attack':
        if (!e.hitDone && e.t >= 0.1) {
          e.hitDone = true;
          this.resolveHit(e);
        }
        if (e.t >= 0.3 && e.state === 'attack') {
          e.state = 'recovery';
          e.t = 0;
          a.hold('idle');
        }
        break;
      case 'recovery':
        if (e.t >= e.cfg.recovery) this.toWait(e);
        break;
      case 'stagger':
        if (e.t >= e.staggerFor) this.toWait(e);
        break;
      case 'hurt':
        if (e.t >= 0.4) {
          if (e.resolve <= 0) this.flee(e);
          else this.toWait(e);
        }
        break;
      case 'flee':
        a.x += (a.x < (this.arena[0] + this.arena[1]) / 2 ? -1 : 1) * 80 * dt;
        if (e.t > 1.6) {
          e.state = 'gone';
          a.setVisible(false);
        }
        break;
    }
    a.update();
    void idx;
  }

  private toWait(e: Enemy) {
    e.state = 'wait';
    e.t = 0;
    e.cooldown = 0.7 + Math.random() * 0.8;
    e.actor.hold(null);
  }

  private stagger(e: Enemy, seconds: number) {
    e.state = 'stagger';
    e.t = 0;
    e.staggerFor = seconds;
    e.mark.setVisible(false);
    e.actor.hold('stagger');
  }

  private flee(e: Enemy) {
    e.state = 'flee';
    e.t = 0;
    e.mark.setVisible(false);
    e.actor.hold(null);
    e.actor.face(e.actor.x < (this.arena[0] + this.arena[1]) / 2 ? -1 : 1);
    e.actor.play('run', true);
    this.float(e.actor.x, 'Сдался!', '#9be0a8');
    // when the first bully gives up, Ryzhiy joins in and barks the other one off balance
    const rest = this.enemies.filter((x) => x.active && x !== e);
    if (this.opts.dogAvailable && !this.dogUsed && rest.length) {
      this.dogUsed = true;
      this.opts.onDogHelp?.(rest[0]);
      this.scene.time.delayedCall(700, () => {
        if (rest[0].active) {
          this.stagger(rest[0], 2.2);
          this.float(rest[0].actor.x, 'Гав!', '#ffd27a');
        }
      });
    }
  }

  private resolveHit(e: Enemy) {
    const p = this.player;
    const sv = services();
    const dist = Math.abs(p.x - e.actor.x);
    const facingPlayer = (p.x - e.actor.x) * e.actor.facing > 0;
    if (dist > e.cfg.reach || !facingPlayer) {
      this.float(e.actor.x, 'Мимо', '#9aa6c8');
      return;
    }
    if (this.dodgeT > 0 || (this.iframes > 0 && this.hurtT <= 0)) {
      this.float(p.x, 'Увернулся!', '#9be0a8');
      return;
    }
    const blockingTowards = this.blocking && (e.actor.x - p.x) * p.facing > 0;
    if (blockingTowards) {
      const perfect = this.time - this.blockAt < 0.3;
      sv.audio.sfx('sfx_block');
      this.stagger(e, perfect ? 1.4 : 0.9);
      this.float(p.x, perfect ? 'Чётко!' : 'Блок', perfect ? '#ffd27a' : '#eef1fb');
      this.shake(0.002);
      return;
    }
    this.hp -= e.cfg.damage;
    this.iframes = 1.0;
    this.hurtT = 0.35;
    this.blocking = false;
    p.hold(null);
    void p.playOnce('hurt');
    sv.audio.sfx('sfx_hit');
    this.shake(0.006);
    const kb = (p.x - e.actor.x) > 0 ? 1 : -1;
    this.scene.tweens.add({ targets: p, x: Phaser.Math.Clamp(p.x + kb * 10, this.arena[0], this.arena[1]), duration: 160, ease: 'Quad.easeOut' });
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'lost';
      p.hold('down');
      p.sprite.setAlpha(1);
      this.enemies.forEach((x) => {
        x.mark.setVisible(false);
        if (x.active) x.actor.hold('laugh');
      });
    }
  }

  private resolvePush() {
    const p = this.player;
    const sv = services();
    const e = this.enemies.find((x) => x.active && Math.abs(x.actor.x - p.x) < 28 && (x.actor.x - p.x) * p.facing > 0);
    if (!e) return;
    if (e.open) {
      e.resolve -= 1;
      e.state = 'hurt';
      e.t = 0;
      e.mark.setVisible(false);
      e.actor.hold('hurt');
      sv.audio.sfx('sfx_hit', { detune: 400, volume: 0.7 });
      this.shake(0.003);
      this.scene.tweens.add({ targets: e.actor, x: e.actor.x + p.facing * 18, duration: 200, ease: 'Quad.easeOut' });
    } else {
      // guarded — Kolya bounces off
      sv.audio.sfx('sfx_block', { detune: -300, volume: 0.6 });
      this.float(e.actor.x, 'Не пробить!', '#f08a8a');
      this.scene.tweens.add({ targets: p, x: Phaser.Math.Clamp(p.x - p.facing * 8, this.arena[0], this.arena[1]), duration: 150 });
    }
  }

  destroy() {
    this.enemies.forEach((e) => e.mark.destroy());
    this.floatTexts.forEach((t) => t.destroy());
    this.player.sprite.setAlpha(1);
  }
}
