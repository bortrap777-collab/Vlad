/**
 * The playable world. One scene renders whichever level the session is in
 * (apartment interior or the courtyard), handles movement, interaction, triggers,
 * cutscenes and the fight.
 */
import Phaser from 'phaser';
import { GROUND_Y, VIEW_H, ZOOM } from '../config';
import { services } from '../services';
import { LEVELS, type InteractableDef, type LevelDef, type NpcDef } from '../content/levels';
import { evalCond, type GameState, type LevelId } from '../core/state';
import type { CharId } from '../core/types';
import { Actor } from '../world/Actor';
import { Dog } from '../world/Dog';
import { Enemy, Fight } from '../world/Fight';
import type { UIScene } from './UIScene';
import { CHARACTERS } from '../content/characters';

interface Candidate {
  key: string;
  label: string;
  x: number;
  priority: number;
  dist: number;
  run: () => Promise<void> | void;
}

const IMMEDIATE_EVENTS = new Set(['dog_whine', 'dog_panic', 'bullies_leave', 'seryoga_leave']);
const DEFERRED_EVENTS = new Set(['untie_minigame', 'dog_dig', 'finale']);

export class WorldScene extends Phaser.Scene {
  level!: LevelDef;
  player!: Actor;
  dog: Dog | null = null;
  npcs = new Map<string, Actor>();
  /** NPCs whose presence is controlled by a running cutscene. */
  private scripted = new Map<string, Actor>();
  busy = false;
  cutscene = false;
  skipping = false;
  fight: Fight | null = null;
  private pendingEvents: string[] = [];
  private prompt: Candidate | null = null;
  private stepAcc = 0;
  private footAcc = 0;
  private footLeft = false;
  private footprints: Phaser.GameObjects.Image[] = [];
  private breathTimers = new Map<Actor, number>();
  private puffs!: Phaser.GameObjects.Particles.ParticleEmitter;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private nightLights: Phaser.GameObjects.Image[] = [];
  private headlights: Phaser.GameObjects.Image[] = [];
  private dogScareCd = 0;
  private unsub: (() => void)[] = [];
  private swingSeats: Phaser.GameObjects.Image[] = [];
  private fightAssist = 0;

  constructor() {
    super('World');
  }

  get state(): GameState {
    return services().session!.state;
  }
  get ui(): UIScene {
    return this.scene.get('UI') as UIScene;
  }

  create(data: { fresh?: boolean; entry?: boolean }) {
    const sv = services();
    sv.audio.attach(this);
    this.npcs = new Map();
    this.scripted = new Map();
    this.footprints = [];
    this.nightLights = [];
    this.headlights = [];
    this.swingSeats = [];
    this.breathTimers = new Map();
    this.busy = false;
    this.cutscene = false;
    this.skipping = false;
    this.fight = null;
    this.dog = null;
    this.pendingEvents = [];
    this.prompt = null;
    const st = this.state;
    this.level = LEVELS[st.level];
    const L = this.level;

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBounds(0, 0, L.width, VIEW_H);
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#070913');

    // ---- parallax layers: positioned so their left edge aligns with the view at scroll 0
    const offX = (cam.width / 2) * (1 - 1 / ZOOM);
    const offY = (cam.height / 2) * (1 - 1 / ZOOM);
    L.parallax.forEach((p, i) => {
      this.add.image(offX * (1 - p.factor), offY * (1 - p.factor), p.key).setOrigin(0).setScrollFactor(p.factor).setDepth(-100 + i);
    });
    this.add.image(0, 0, L.backdrop).setOrigin(0).setDepth(0);

    // ---- props
    for (const pr of L.props) {
      if (pr.cond && !evalCond(st, pr.cond)) continue;
      const img = this.add.image(pr.x, pr.y, pr.texture).setOrigin(0.5, 1).setDepth(pr.layer === 'front' ? 70 : 10).setFlipX(!!pr.flipX);
      img.setName(pr.id);
      if (pr.texture === 'lamp') this.addLampLights(pr.x, pr.y, pr.layer === 'front');
      if (pr.texture === 'swings') {
        for (const sx of [-40, 40]) {
          const seat = this.add.image(pr.x + sx, pr.y - 90, 'swingseat').setOrigin(0.5, 0).setDepth(11);
          this.swingSeats.push(seat);
          if (!sv.settings.reducedMotion) this.tweens.add({ targets: seat, angle: { from: -3 + sx / 40, to: 3 + sx / 40 }, duration: 2600 + sx * 10, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
      }
    }
    for (const l of L.lights) {
      const g = this.add.image(l.x, l.y, l.texture).setBlendMode(Phaser.BlendModes.ADD).setScale(l.scale ?? 1).setAlpha(l.alpha ?? 0.8).setDepth(95);
      if (l.nightOnly) this.nightLights.push(g);
    }

    // ---- night overlay (multiply) — lights are drawn above it
    this.nightOverlay = this.add.rectangle(0, 0, L.width, VIEW_H, L.outdoor ? 0x5866a8 : 0x6a76b0).setOrigin(0).setDepth(90).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
    this.applyNight(!!st.flags.night);

    // ---- atmosphere
    if (L.outdoor) this.createSnow();
    this.puffs = this.add.particles(0, 0, 'puff', {
      emitting: false,
      lifespan: 1500,
      speedY: { min: -9, max: -4 },
      speedX: { min: -3, max: 3 },
      scale: { start: 0.5, end: 1.3 },
      alpha: { start: 0.55, end: 0 },
    });
    this.puffs.setDepth(60);

    // ---- characters
    this.player = new Actor(this, 'kolya', st.x, 50);
    this.player.face(st.facing);
    this.refreshNpcs();
    if (L.id === 'courtyard') this.createDog();

    cam.startFollow(this.player.sprite, true, 0.12, 0.12, 0, 0);
    cam.setFollowOffset(0, 0);
    cam.centerOn(this.player.x, VIEW_H / 2);

    // ---- UI scene
    if (!this.scene.isActive('UI')) this.scene.launch('UI');
    else this.ui.resetForWorld();
    this.scene.bringToTop('UI');

    sv.audio.playMusic(L.music);
    sv.audio.setAmbience(L.ambience ?? null);

    const session = sv.session!;
    this.unsub.push(
      session.bus.on('state', (e) => {
        if (e.type === 'custom') this.onCustomEvent(e.name);
        this.ui?.onStateEvent?.(e);
        if (e.type === 'flag' || e.type === 'stage' || e.type === 'item') this.refreshNpcs();
      }),
    );
    this.events.once('shutdown', () => {
      this.unsub.forEach((u) => u());
      this.unsub = [];
      this.fight?.destroy();
    });

    this.exposeTestHook();
    if (data?.entry) cam.fadeIn(450, 7, 9, 19);
    // story hooks on entering a level
    this.time.delayedCall(30, () => void this.onEnterLevel(!!data?.fresh));
  }

  // ------------------------------------------------------------------ setup helpers
  private addLampLights(x: number, bottom: number, front: boolean) {
    const head = this.add.image(x + 7, bottom - 97, 'glow_warm').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7).setScale(0.9).setDepth(95);
    const pool = this.add.image(x + 4, front ? GROUND_Y + 14 : GROUND_Y - 4, 'glow_warm').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.32).setScale(1.7, 0.35).setDepth(95);
    if (!services().settings.reducedMotion) this.tweens.add({ targets: head, alpha: 0.6, duration: 1800 + Math.random() * 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    void pool;
  }

  private createSnow() {
    const reduce = services().settings.reducedMotion;
    const W = this.level.width;
    const back = this.add.particles(0, 0, 'flake1', {
      x: { min: -40, max: W + 40 },
      y: -6,
      lifespan: 16000,
      speedY: { min: 9, max: 16 },
      speedX: { min: -5, max: 2 },
      alpha: { min: 0.35, max: 0.7 },
      frequency: reduce ? 120 : 28,
      advance: 16000,
    });
    back.setDepth(30);
    const front = this.add.particles(0, 0, 'flake2', {
      x: { min: -40, max: W + 40 },
      y: -6,
      lifespan: 9000,
      speedY: { min: 22, max: 34 },
      speedX: { min: -9, max: 3 },
      alpha: { min: 0.55, max: 0.95 },
      frequency: reduce ? 400 : 110,
      advance: 9000,
    });
    front.setDepth(80);
    // low drifting fog at the horizon
    for (let i = 0; i < 4; i++) {
      const f = this.add.image(i * 520, 205, 'glow_cold').setScale(7, 0.55).setAlpha(0.1).setDepth(85).setBlendMode(Phaser.BlendModes.ADD);
      if (!reduce) this.tweens.add({ targets: f, x: f.x + 90, duration: 14000 + i * 2000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  applyNight(on: boolean) {
    this.nightOverlay.setVisible(on);
    this.nightLights.forEach((l) => l.setVisible(on));
  }

  private createDog() {
    const f = this.state.flags;
    if (!f.dog_freed) {
      this.dog = new Dog(this, 1494, true, 1506);
    } else if (f.dog_digging && !f.dog_dug) {
      this.dog = new Dog(this, 1600, false, 1506);
      this.dog.goTo(1600);
    } else {
      this.dog = new Dog(this, this.player.x - 20, false, 1506);
      this.dog.mode = 'follow';
    }
  }

  /** Create/destroy NPC actors to match their conditions. */
  refreshNpcs() {
    if (!this.player) return;
    const st = this.state;
    const wanted = new Map<string, NpcDef>();
    for (const n of this.level.npcs) if (evalCond(st, n.cond) && !this.scripted.has(n.id)) wanted.set(n.id, n);
    for (const [id, a] of this.npcs) {
      if (!wanted.has(id)) {
        a.destroy();
        this.npcs.delete(id);
      }
    }
    for (const [id, n] of wanted) {
      if (this.npcs.has(id)) continue;
      const a = new Actor(this, n.id, n.x, 40);
      a.face(n.facing);
      a.setBase(n.anim ?? 'idle');
      this.npcs.set(id, a);
    }
  }

  npcDef(id: string): NpcDef | undefined {
    return this.level.npcs.find((n) => n.id === id && evalCond(this.state, n.cond));
  }

  actor(id: CharId): Actor | undefined {
    if (id === 'kolya') return this.player;
    return this.scripted.get(id) ?? this.npcs.get(id);
  }

  // ------------------------------------------------------------------ main loop
  update(_time: number, deltaMs: number) {
    const sv = services();
    const dt = Math.min(0.05, deltaMs / 1000);
    const st = this.state;
    st.playTime += dt;
    this.dogScareCd = Math.max(0, this.dogScareCd - dt);

    let moving = false;
    let running = false;
    if (this.fight) {
      this.fight.update(dt);
    } else if (!this.busy && !this.ui?.modal) {
      let dir = 0;
      if (sv.input.isDown('left')) dir -= 1;
      if (sv.input.isDown('right')) dir += 1;
      if (dir !== 0) {
        running = sv.input.isDown('sprint') && this.level.outdoor;
        const speed = running ? 112 : 62;
        const nx = Phaser.Math.Clamp(this.player.x + dir * speed * dt, this.level.bounds[0], this.level.bounds[1]);
        moving = Math.abs(nx - this.player.x) > 0.01;
        const prevFacing = this.player.facing;
        this.player.x = nx;
        this.player.face(dir > 0 ? 1 : -1);
        if (prevFacing !== this.player.facing && !moving) this.player.play('turn', true);
        this.player.play(moving ? (running ? 'run' : 'walk') : 'idle');
        if (moving) this.onPlayerStep(Math.abs(dir * speed * dt), running);
      } else this.player.play('idle');

      this.updatePrompt();
      if (sv.input.justPressed('interact') && this.prompt) {
        const c = this.prompt;
        void this.runInteraction(c);
      }
      this.checkTriggers();
      this.checkDogApproach(moving, running);
      // after Lyokha's hint Ryzhiy runs off to the snowdrift by himself
      const f = st.flags;
      if (this.dog && f.hint_dig && f.dog_freed && !f.dog_digging && !f.dog_dug && this.dog.mode === 'follow') this.dogDig();
    } else if (!this.cutscene) {
      this.player.play(this.player.baseAnim);
    }
    if (this.busy || this.ui?.modal || this.fight) this.setPrompt(null);

    this.player.update();
    this.npcs.forEach((a) => a.update());
    this.scripted.forEach((a) => a.update());
    this.dog?.update(dt, this.player.x, moving);
    this.updateBreath(dt);
    // (skip while a door transition has already switched the level)
    if (st.level === this.level.id) {
      st.x = Math.round(this.player.x);
      st.facing = this.player.facing;
    }
  }

  private onPlayerStep(dist: number, running: boolean) {
    const sv = services();
    this.stepAcc += dist;
    const stride = running ? 18 : 15;
    if (this.stepAcc >= stride) {
      this.stepAcc = 0;
      sv.audio.sfx(this.level.stepSound, { volume: running ? 0.32 : 0.22, detune: Phaser.Math.Between(-200, 200) });
    }
    if (!this.level.outdoor) return;
    this.footAcc += dist;
    if (this.footAcc >= 7) {
      this.footAcc = 0;
      this.footLeft = !this.footLeft;
      const fx = Math.round(this.player.x - this.player.facing * 2);
      const fy = GROUND_Y + (this.footLeft ? 0 : 2);
      // only leave prints where the backdrop is snow (bright), not on dark asphalt
      const px = this.textures.getPixel(fx, fy, this.level.backdrop);
      if (px && px.v > 0.45) {
        const fp = this.add.image(fx, fy, 'footprint').setDepth(5).setAlpha(0.75).setFlipX(this.player.facing < 0);
        this.footprints.push(fp);
        this.tweens.add({ targets: fp, alpha: 0, delay: 14000, duration: 8000, onComplete: () => fp.destroy() });
        if (this.footprints.length > 70) this.footprints.shift()?.destroy();
      }
    }
  }

  private updateBreath(dt: number) {
    if (!this.level.outdoor) return;
    const all: Actor[] = [this.player, ...this.npcs.values(), ...this.scripted.values()];
    for (const a of all) {
      if (!a.sprite.visible) continue;
      let t = (this.breathTimers.get(a) ?? Math.random() * 3) - dt;
      if (t <= 0) {
        const m = a.mouth();
        this.puffs.emitParticleAt(m.x, m.y, 1);
        const talking = a.sprite.anims.currentAnim?.key.endsWith('_talk');
        t = talking ? 0.7 : 2.4 + Math.random() * 1.8;
      }
      this.breathTimers.set(a, t);
    }
  }

  // ------------------------------------------------------------------ interaction
  private candidates(): Candidate[] {
    const px = this.player.x;
    const st = this.state;
    const out: Candidate[] = [];
    for (const it of this.level.interactables) {
      if (!evalCond(st, it.cond)) continue;
      const d = Math.abs(it.x - px);
      if (d <= it.range) out.push({ key: it.id, label: it.label, x: it.x, priority: it.priority ?? 0, dist: d, run: () => this.runAction(it) });
    }
    for (const [id, a] of this.npcs) {
      const def = this.npcDef(id);
      if (!def) continue;
      const d = Math.abs(a.x - px);
      if (d <= (def.range ?? 24)) out.push({ key: `npc:${id}`, label: 'Поговорить', x: a.x, priority: 5, dist: d, run: () => this.talkTo(a, def.dialogue) });
    }
    if (this.dog) {
      const d = Math.abs(this.dog.x - px);
      const f = st.flags;
      if (d <= 26 && !(f.dog_digging && !f.dog_dug)) {
        const needed = st.stage === 'investigate' && !f.dog_dug;
        const label = !f.dog_freed ? (f.dog_ready ? 'Развязать' : 'Подойти к собаке') : needed ? 'Позвать Рыжего' : 'Погладить';
        // a following dog is always nearby, so petting must never hide other prompts
        const priority = !f.dog_freed ? 4 : needed ? 2 : -1;
        out.push({ key: 'dog', label, x: this.dog.x, priority, dist: d, run: () => this.talkDog() });
      }
    }
    // nearest wins, with priority acting as a distance bonus (8 px per level)
    out.sort((a, b) => a.dist - a.priority * 8 - (b.dist - b.priority * 8));
    return out;
  }

  private updatePrompt() {
    const c = this.candidates()[0] ?? null;
    this.setPrompt(c);
  }

  private setPrompt(c: Candidate | null) {
    if (c?.key !== this.prompt?.key || c?.label !== this.prompt?.label) {
      this.ui?.setPrompt(c ? { label: c.label, x: c.x } : null);
    } else if (c && this.prompt && Math.abs(c.x - this.prompt.x) > 0.5) {
      this.ui?.movePrompt(c.x);
    }
    this.prompt = c;
  }

  private async runInteraction(c: Candidate) {
    if (this.busy) return;
    this.setPrompt(null);
    await c.run();
  }

  private async runAction(it: InteractableDef) {
    const a = it.action;
    if ('dialogue' in a) {
      if (it.id === 'bread') this.state.flags.bread_taken = true;
      await this.talk(a.dialogue, it.x);
      this.syncProps();
    } else if ('door' in a) {
      for (const r of a.requires ?? []) {
        if (!evalCond(this.state, r.cond)) {
          await this.talk(r.elseDialogue);
          return;
        }
      }
      await this.transition(a.door, a.spawnX);
    } else if ('event' in a) {
      this.onCustomEvent(a.event);
    }
  }

  /** Hide props that depend on state (picked-up items). */
  private syncProps() {
    for (const pr of this.level.props) {
      if (!pr.cond) continue;
      const obj = this.children.getByName(pr.id) as Phaser.GameObjects.Image | null;
      if (obj && !evalCond(this.state, pr.cond)) {
        this.tweens.add({ targets: obj, alpha: 0, y: obj.y - 4, duration: 250, onComplete: () => obj.destroy() });
        services().audio.sfx('sfx_pickup', { volume: 0.7 });
      }
    }
  }

  private async talkTo(a: Actor, dialogue: string) {
    // keep a comfortable conversation distance so the sprites don't overlap
    const gap = this.player.x - a.x;
    if (Math.abs(gap) < 24) {
      const side = gap >= 0 ? 1 : -1;
      const target = Phaser.Math.Clamp(a.x + side * 26, this.level.bounds[0], this.level.bounds[1]);
      this.busy = true;
      await this.player.walkTo(Math.abs(target - a.x) >= 20 ? target : a.x - side * 26, 70);
      this.busy = false;
    }
    a.faceTowards(this.player.x);
    this.player.faceTowards(a.x);
    await this.talk(dialogue);
    const def = this.npcDef(a.id);
    if (def && this.npcs.get(a.id) === a) a.face(def.facing);
  }

  private async talkDog() {
    if (!this.dog) return;
    this.player.faceTowards(this.dog.x);
    if (this.state.flags.dog_freed && this.state.stage !== 'investigate') this.dog.bark();
    await this.talk('dog');
  }

  /** Run a dialogue with world input locked, then process deferred story events. */
  async talk(id: string, _focusX?: number): Promise<void> {
    const wasBusy = this.busy;
    this.busy = true;
    const stageBefore = this.state.stage;
    try {
      await this.ui.runDialogue(id);
    } finally {
      this.busy = wasBusy;
    }
    if (!this.cutscene && this.state.stage !== stageBefore) this.autosave();
    await this.flushDeferred();
  }

  onSpeaker(id: CharId | null, typing: boolean) {
    for (const a of [this.player, ...this.npcs.values(), ...this.scripted.values()]) {
      if (a.id === id && typing) a.play(a.hasAnim('talk') ? 'talk' : a.baseAnim);
      else if (a.sprite.anims.currentAnim?.key.endsWith('_talk')) a.play(a.baseAnim, true);
    }
  }

  private onCustomEvent(name: string) {
    if (IMMEDIATE_EVENTS.has(name)) this.handleImmediate(name);
    else if (DEFERRED_EVENTS.has(name)) this.pendingEvents.push(name);
  }

  private handleImmediate(name: string) {
    const sv = services();
    switch (name) {
      case 'dog_whine':
        sv.audio.sfx('sfx_whine', { volume: 0.5, caption: '[Вдалеке скулит собака]' });
        break;
      case 'dog_panic':
        this.dog?.panic(this.player.x);
        sv.audio.sfx('sfx_cans', { caption: '[Гремят консервные банки]' });
        break;
      case 'bullies_leave':
        for (const id of ['zheka', 'tolstyi'] as const) {
          const a = this.scripted.get(id);
          if (a) void a.walkTo(this.level.width + 60, 90, this.skipping, 'run').then(() => this.removeScripted(id));
        }
        break;
      case 'seryoga_leave': {
        const a = this.scripted.get('seryoga');
        if (a) void a.walkTo(-60, 55, this.skipping).then(() => this.removeScripted('seryoga'));
        break;
      }
    }
  }

  private async flushDeferred() {
    while (this.pendingEvents.length) {
      const name = this.pendingEvents.shift()!;
      switch (name) {
        case 'untie_minigame':
          await this.untieSequence();
          break;
        case 'dog_dig':
          this.dogDig();
          break;
        case 'finale':
          await this.finaleCutscene();
          break;
      }
    }
  }

  private checkTriggers() {
    const px = this.player.x;
    for (const t of this.level.triggers) {
      if (px < t.x0 || px > t.x1 || !evalCond(this.state, t.cond)) continue;
      if (t.event === 'bullies_scene' && !this.state.flags.fight_won) {
        void this.bulliesCutscene();
        return;
      }
    }
  }

  private checkDogApproach(moving: boolean, running: boolean) {
    const d = this.dog;
    if (!d || d.mode !== 'tied' || this.state.flags.dog_ready) return;
    if (moving && running && Math.abs(d.x - this.player.x) < 70 && this.dogScareCd <= 0) {
      this.dogScareCd = 4;
      d.panic(this.player.x);
      services().audio.sfx('sfx_cans', { caption: '[Гремят консервные банки]' });
      this.ui.toast('Собака шарахается. Подходи к ней шагом, без резких движений.');
    }
  }

  // ------------------------------------------------------------------ saving & transitions
  autosave() {
    const sv = services();
    if (sv.session?.save('auto')) this.ui?.showSaving();
  }

  private async transition(to: LevelId, spawnX: number) {
    const sv = services();
    this.busy = true;
    this.setPrompt(null);
    sv.audio.sfx('sfx_door', { volume: 0.7 });
    const st = this.state;
    st.level = to;
    st.x = spawnX;
    st.facing = to === 'courtyard' ? 1 : 1;
    if (to === 'apartment' && st.stage === 'go_home') st.flags.night = true;
    await new Promise<void>((res) => {
      this.cameras.main.fadeOut(380, 7, 9, 19);
      this.cameras.main.once('camerafadeoutcomplete', () => res());
    });
    this.autosave();
    this.scene.restart({ entry: true });
  }

  private async onEnterLevel(fresh: boolean) {
    const st = this.state;
    const f = st.flags;
    if (this.level.id === 'apartment' && !f.intro_done) {
      await this.introCutscene(fresh);
    } else if (this.level.id === 'courtyard' && !f.yard_visited) {
      f.yard_visited = true;
      services().session!.apply([{ stage: 'meet_yard' }]);
      this.autosave();
      this.ui.toast('Shift — бежать. Во дворе снег хрустит под ногами.');
    } else if (this.level.id === 'apartment' && st.stage === 'go_home' && !f.home_night_done) {
      await this.homeNightCutscene();
    }
  }

  // ------------------------------------------------------------------ cutscene helpers
  wait(ms: number): Promise<void> {
    if (this.skipping) return Promise.resolve();
    return new Promise((res) => this.time.delayedCall(ms, () => res()));
  }

  private panTo(x: number, ms = 900): Promise<void> {
    const cam = this.cameras.main;
    cam.stopFollow();
    if (this.skipping) {
      cam.centerOn(x, VIEW_H / 2);
      return Promise.resolve();
    }
    return new Promise((res) => {
      cam.pan(x, VIEW_H / 2, ms, 'Sine.easeInOut', true, (_c, p) => p >= 1 && res());
    });
  }

  private followPlayer() {
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
  }

  private spawnScripted(id: CharId, x: number, facing: 1 | -1, anim = 'idle'): Actor {
    this.npcs.get(id)?.destroy();
    this.npcs.delete(id);
    this.scripted.get(id)?.destroy();
    const a = new Actor(this, id, x, 41 + this.scripted.size);
    a.face(facing);
    a.setBase(anim);
    this.scripted.set(id, a);
    return a;
  }

  private removeScripted(id: CharId) {
    this.scripted.get(id)?.destroy();
    this.scripted.delete(id);
  }

  private async beginCutscene() {
    this.busy = true;
    this.cutscene = true;
    this.skipping = false;
    this.setPrompt(null);
    this.player.stopMoving();
    this.player.play('idle', true);
    this.ui.setCutscene(true);
  }

  private endCutscene() {
    this.cutscene = false;
    this.skipping = false;
    this.busy = false;
    this.ui.setCutscene(false);
    this.followPlayer();
  }

  /** Esc during a cutscene. */
  skipCutscene() {
    if (this.cutscene) this.skipping = true;
  }

  // ------------------------------------------------------------------ story sequences
  private async introCutscene(fresh: boolean) {
    await this.beginCutscene();
    const mama = this.npcs.get('mama');
    const papa = this.npcs.get('papa');
    mama?.hold('argue');
    papa?.hold('argue');
    if (fresh) await this.ui.chapterCard('Глава 1', 'Новый двор', 'Зима 1996 года. Провинциальный город.');
    await this.panTo(290, 1600);
    await this.wait(400);
    await this.talk('intro_argue');
    mama?.hold(null);
    papa?.hold(null);
    await this.panTo(this.player.x, 900);
    this.endCutscene();
    this.autosave();
    this.ui.tutorial();
  }

  private async untieSequence() {
    if (!this.dog) return;
    this.busy = true;
    this.player.faceTowards(this.dog.x);
    this.player.hold('kneel');
    this.dog.calm();
    const ok = await this.ui.untieMinigame();
    this.player.hold(null);
    if (ok) {
      services().audio.sfx('sfx_untie');
      services().audio.sfx('sfx_cans', { volume: 0.6, caption: '[Банки падают в снег]' });
      this.dog.release();
      await this.talk('dog_freed');
      this.dog.mode = 'follow';
      this.busy = false;
      this.autosave();
    } else {
      this.busy = false;
      this.ui.toast('Узел пока не поддался. Можно попробовать ещё раз.');
    }
  }

  private dogDig() {
    if (!this.dog) return;
    this.state.flags.dog_digging = true;
    services().audio.sfx('sfx_bark', { caption: '[Рыжий лает]' });
    this.ui.toast('Рыжий сорвался с места и умчался к крайним гаражам!');
    this.dog.goTo(1600, () => {
      services().audio.sfx('sfx_bark', { volume: 0.7, caption: '[Рыжий лает у семнадцатого гаража]' });
      this.ui.toast('Рыжий роет снег за семнадцатым гаражом!');
    });
  }

  private async bulliesCutscene() {
    await this.beginCutscene();
    const sv = services();
    // quick cut so the staging is the same whichever side Kolya arrives from
    await this.ui.fade(true, 300);
    const seryogaNpc = this.npcs.get('seryoga');
    const seryoga = this.spawnScripted('seryoga', seryogaNpc?.x ?? 548, 1);
    const olya = this.spawnScripted('olya', 800, -1, 'idle');
    const zheka = this.spawnScripted('zheka', 760, 1, 'laugh');
    const tolstyi = this.spawnScripted('tolstyi', 840, -1, 'laugh');
    olya.face(-1);
    zheka.face(1);
    this.player.x = 630;
    this.player.face(1);
    if (this.dog) {
      this.dog.mode = 'sit';
      this.dog.sprite.x = 600;
      this.dog.sit();
    }
    this.cameras.main.stopFollow();
    this.cameras.main.centerOn(720, VIEW_H / 2);
    await this.ui.fade(false, 300);
    await this.player.walkTo(690, 62, this.skipping);
    this.player.face(1);
    await this.wait(300);
    await this.talk('bullies');
    zheka.setBase('idle');
    tolstyi.setBase('idle');
    zheka.face(-1);
    tolstyi.face(-1);
    void olya.walkTo(900, 70, this.skipping).then(() => olya.face(-1));
    void seryoga;
    // checkpoint: a loss restarts the scuffle from here
    sv.audio.rewind('music_fight');
    sv.audio.playMusic('music_fight', 400);
    this.ui.setCutscene(false);
    this.cutscene = false;
    this.skipping = false;
    this.followPlayer();
    await this.runFight();
  }

  private async runFight(): Promise<void> {
    const sv = services();
    const zheka = this.scripted.get('zheka')!;
    const tolstyi = this.scripted.get('tolstyi')!;
    const insulted = !!this.state.flags.insulted;
    const assist = this.fightAssist * 0.22;
    zheka.x = 740;
    tolstyi.x = 790;
    zheka.setVisible(true);
    tolstyi.setVisible(true);
    zheka.hold(null);
    tolstyi.hold(null);
    this.player.x = Math.min(Math.max(this.player.x, 640), 690);
    const enemies = [
      new Enemy(zheka, { resolve: 3, windup: 0.62 + assist, recovery: 0.85 + assist, reach: 26, damage: 1, speed: 46 }),
      new Enemy(tolstyi, { resolve: insulted ? 4 : 3, windup: 0.85 + assist, recovery: 1.0 + assist, reach: 28, damage: 1, speed: 36 }),
    ];
    const dogAvailable = !!this.state.flags.dog_freed && !!this.dog;
    const fight = new Fight(this, this.player, enemies, [600, 880], {
      dogAvailable,
      names: ['Жека', 'Толстый'],
      onDogHelp: (target) => {
        if (!this.dog) return;
        this.dog.mode = 'goto';
        this.dog.goTo(target.actor.x - 18 * Math.sign(target.actor.x - this.dog.x || 1), () => {
          this.dog?.bark();
          sv.audio.sfx('sfx_bark', { caption: '[Рыжий громко лает]' });
          if (this.dog) this.dog.mode = 'sit';
        });
      },
    });
    this.fight = fight;
    this.busy = true;
    this.ui.fightStart(fight);
    const result = await new Promise<'won' | 'lost'>((res) => {
      const ev = this.time.addEvent({
        delay: 50,
        loop: true,
        callback: () => {
          if (fight.state !== 'active') {
            ev.remove();
            res(fight.state);
          }
        },
      });
    });
    this.ui.fightEnd();
    if (result === 'lost') {
      await this.wait(900);
      await this.ui.fightLost();
      fight.destroy();
      this.fight = null;
      this.fightAssist++;
      this.player.hold(null);
      this.player.x = 670;
      this.player.face(1);
      if (this.dog) {
        this.dog.sprite.x = 580;
        this.dog.sit();
      }
      return this.runFight();
    }
    await this.wait(400);
    fight.destroy();
    this.fight = null;
    // bullies come back to have their say, then leave
    this.cutscene = true;
    this.ui.setCutscene(true);
    for (const [a, x] of [[zheka, 760], [tolstyi, 800]] as const) {
      a.setVisible(true);
      a.hold(null);
      a.x = x > this.player.x ? Math.max(x, this.player.x + 40) : x;
      a.faceTowards(this.player.x);
    }
    const seryoga = this.scripted.get('seryoga');
    if (seryoga) void seryoga.walkTo(this.player.x - 40, 60, this.skipping).then(() => seryoga.faceTowards(this.player.x));
    const olya = this.scripted.get('olya');
    sv.audio.playMusic('music_yard', 1200);
    await this.wait(600);
    this.state.flags.dog_helped = dogAvailable;
    await this.talk('bullies_after');
    if (olya) {
      await olya.walkTo(this.player.x + 30, 60, this.skipping);
      olya.faceTowards(this.player.x);
    }
    this.removeScripted('zheka');
    this.removeScripted('tolstyi');
    this.removeScripted('seryoga');
    this.removeScripted('olya');
    this.refreshNpcs();
    const olyaNpc = this.npcs.get('olya');
    if (olyaNpc) {
      olyaNpc.x = Math.min(this.player.x + 30, 860);
      olyaNpc.faceTowards(this.player.x);
    }
    if (this.dog) this.dog.mode = 'follow';
    this.endCutscene();
    this.autosave();
  }

  private async finaleCutscene() {
    await this.beginCutscene();
    const sv = services();
    this.state.flags.finale_started = true;
    await this.ui.fade(true);
    // dusk turns into night
    this.state.flags.night = true;
    this.applyNight(true);
    this.npcs.forEach((a) => a.destroy());
    this.npcs.clear();
    this.player.x = 660;
    this.player.face(1);
    const olya = this.spawnScripted('olya', 700, -1);
    const sveta = this.spawnScripted('sveta', 735, -1);
    const lyokha = this.spawnScripted('lyokha', 770, -1);
    if (this.dog) {
      this.dog.mode = 'sit';
      this.dog.sprite.x = 630;
      this.dog.sit();
    }
    this.cameras.main.stopFollow();
    this.cameras.main.centerOn(715, VIEW_H / 2);
    sv.audio.playMusic('music_mystery', 1500);
    await this.ui.caption('Через полчаса. Во дворе зажглись фонари.', 2200);
    await this.ui.fade(false);
    await this.talk('finale_kids');
    // the rattling car arrives from the arch
    sv.audio.sfx('sfx_engine', { volume: 0.9, caption: '[Тарахтит мотор]' });
    for (let i = 0; i < 2; i++) {
      const h = this.add.image(1880, 222 + i * 4, 'glow_warm').setBlendMode(Phaser.BlendModes.ADD).setScale(2.2, 0.5).setAlpha(0).setDepth(96);
      this.headlights.push(h);
      this.tweens.add({ targets: h, alpha: 0.7, x: 1180 - i * 20, duration: this.skipping ? 0 : 2600, ease: 'Sine.easeOut' });
    }
    await this.panTo(980, 1800);
    const alexey = this.spawnScripted('alexey', 1060, -1);
    await this.wait(400);
    olya.face(1);
    sveta.face(1);
    lyokha.face(1);
    await this.panTo(820, 1400);
    await alexey.walkTo(815, 48, this.skipping);
    alexey.face(-1);
    await this.talk('finale_officer');
    await alexey.walkTo(1080, 55, this.skipping);
    this.removeScripted('alexey');
    sv.audio.sfx('sfx_engine', { volume: 0.6 });
    this.headlights.forEach((h) => this.tweens.add({ targets: h, x: 1620, alpha: 0, duration: this.skipping ? 0 : 3200, onComplete: () => h.destroy() }));
    this.headlights = [];
    await this.panTo(715, 1200);
    olya.face(-1);
    sveta.face(-1);
    lyokha.face(-1);
    await this.talk('finale_after');
    void olya.walkTo(196, 60, this.skipping).then(() => this.removeScripted('olya'));
    void sveta.walkTo(1900, 60, this.skipping).then(() => this.removeScripted('sveta'));
    void lyokha.walkTo(1300, 60, this.skipping).then(() => this.removeScripted('lyokha'));
    await this.wait(1200);
    if (this.dog) this.dog.mode = 'follow';
    sv.audio.playMusic('music_yard', 2000);
    this.endCutscene();
    this.autosave();
  }

  private async homeNightCutscene() {
    await this.beginCutscene();
    const mama = this.npcs.get('mama');
    const papa = this.npcs.get('papa');
    this.player.x = 72;
    await this.player.walkTo(200, 55, this.skipping);
    this.player.face(1);
    mama?.faceTowards(this.player.x);
    await this.talk('home_night');
    if (mama) void mama.walkTo(470, 50, this.skipping).then(() => mama.face(-1));
    if (papa) void papa.walkTo(510, 50, this.skipping).then(() => papa.face(-1));
    await this.player.walkTo(290, 45, this.skipping);
    this.player.hold('front');
    await this.panTo(290, 800);
    await this.wait(600);
    await this.talk('window_end');
    this.player.hold(null);
    this.state.flags.home_night_done = true;
    this.autosave();
    await this.ui.fade(true, 1600);
    this.endCutscene();
    this.ui.setVisible(false);
    this.scene.stop('UI');
    this.scene.start('End');
  }

  // ------------------------------------------------------------------ test hook (read-only)
  private exposeTestHook() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getters below must read live scene state
    const self = this;
    (window as unknown as { __KOLYA__: unknown }).__KOLYA__ = {
      get state() {
        return JSON.parse(JSON.stringify(self.state));
      },
      get world() {
        return {
          level: self.level.id,
          px: self.player?.x,
          busy: self.busy,
          cutscene: self.cutscene,
          prompt: self.prompt ? { key: self.prompt.key, label: self.prompt.label, x: self.prompt.x } : null,
          npcs: [...self.npcs.entries()].map(([id, a]) => ({ id, x: a.x, name: CHARACTERS[a.id].name })),
          scripted: [...self.scripted.entries()].map(([id, a]) => ({ id, x: a.x })),
          dog: self.dog ? { x: self.dog.x, mode: self.dog.mode } : null,
          fight: self.fight ? self.fight.view() : null,
          music: services().audio.currentMusic,
          night: self.nightOverlay?.visible ?? false,
        };
      },
      get ui() {
        return (self.scene.get('UI') as UIScene | undefined)?.debugView?.() ?? null;
      },
    };
  }
}
