/** Music (with outdoor/indoor pause-resume), ambience and SFX with three volume buses. */
import Phaser from 'phaser';
import type { Settings } from '../core/settings';

export type MusicKey = 'music_yard' | 'music_home' | 'music_fight' | 'music_mystery';

export class AudioManager {
  private sound!: Phaser.Sound.BaseSoundManager;
  private tweens!: Phaser.Tweens.TweenManager;
  private music = new Map<string, Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound>();
  private currentMusic: string | null = null;
  private ambience: Phaser.Sound.BaseSound | null = null;
  private ambienceKey: string | null = null;
  /** Caption callback for subtitles of sounds. */
  onCaption: ((text: string) => void) | null = null;

  constructor(private settings: Settings) {}

  attach(scene: Phaser.Scene) {
    this.sound = scene.sound;
    this.tweens = scene.tweens;
  }

  setSettings(s: Settings) {
    this.settings = s;
    this.applyVolumes();
  }

  private musicVol() {
    return this.settings.muted ? 0 : this.settings.master * this.settings.music * 0.7;
  }
  private sfxVol() {
    return this.settings.muted ? 0 : this.settings.master * this.settings.sfx;
  }

  applyVolumes() {
    for (const [k, m] of this.music) if (k === this.currentMusic) m.setVolume(this.musicVol());
    if (this.ambience) (this.ambience as Phaser.Sound.WebAudioSound).setVolume(this.musicVol() * 0.5);
  }

  /**
   * Switch music. Tracks are paused (not stopped) when swapped out, so the outdoor theme
   * resumes from where it left off when returning outside.
   */
  playMusic(key: MusicKey | null, fadeMs = 900) {
    if (!this.sound) return;
    if (key === this.currentMusic) return;
    const prevKey = this.currentMusic;
    if (prevKey) {
      const prev = this.music.get(prevKey);
      if (prev) {
        this.tweens.killTweensOf(prev);
        this.tweens.add({ targets: prev, volume: 0, duration: fadeMs, onComplete: () => prev.pause() });
      }
    }
    this.currentMusic = key;
    if (!key) return;
    let m = this.music.get(key);
    if (!m) {
      m = this.sound.add(key, { loop: true, volume: 0 }) as Phaser.Sound.WebAudioSound;
      this.music.set(key, m);
    }
    this.tweens.killTweensOf(m);
    if (m.isPaused) m.resume();
    else if (!m.isPlaying) m.play({ loop: true, volume: 0 });
    m.setVolume(0);
    this.tweens.add({ targets: m, volume: this.musicVol(), duration: fadeMs });
  }

  /** Restart a track from the beginning next time it plays (e.g. fight theme). */
  rewind(key: MusicKey) {
    const m = this.music.get(key);
    if (m) m.stop();
  }

  setAmbience(key: string | null) {
    if (!this.sound || key === this.ambienceKey) return;
    if (this.ambience) {
      const a = this.ambience;
      this.tweens.add({ targets: a, volume: 0, duration: 600, onComplete: () => a.stop() });
    }
    this.ambienceKey = key;
    this.ambience = null;
    if (!key) return;
    const a = this.sound.add(key, { loop: true, volume: 0 }) as Phaser.Sound.WebAudioSound;
    a.play();
    this.ambience = a;
    this.tweens.add({ targets: a, volume: this.musicVol() * 0.5, duration: 1200 });
  }

  sfx(key: string, opts: { detune?: number; volume?: number; rate?: number; caption?: string } = {}) {
    if (!this.sound) return;
    const v = this.sfxVol() * (opts.volume ?? 1);
    if (v > 0) this.sound.play(key, { volume: v, detune: opts.detune ?? 0, rate: opts.rate ?? 1 });
    if (opts.caption && this.settings.captions) this.onCaption?.(opts.caption);
  }

  get locked(): boolean {
    return !!this.sound && this.sound.locked;
  }
}
