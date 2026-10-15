/**
 * Original procedural music & SFX, rendered offline to WAV.
 * All material is composed here — no third-party recordings.
 */
import { writeFileSync } from 'node:fs';

const SR = 22050;

function wav(path: string, data: Float32Array) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length * 2, 40);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0.95 ? 0.95 / peak : 1;
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i] * g)) * 32767), 44 + i * 2);
  writeFileSync(path, buf);
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

class Track {
  data: Float32Array;
  constructor(public seconds: number) {
    this.data = new Float32Array(Math.ceil(seconds * SR));
  }
  add(i: number, v: number) {
    const n = this.data.length;
    this.data[((i % n) + n) % n] += v; // wrap → seamless loops
  }
  pad(notes: number[], t0: number, dur: number, vol = 0.05) {
    const a = 0.8, r = 1.2;
    const len = Math.floor((dur + r) * SR);
    for (const m of notes)
      for (const det of [-0.12, 0.1]) {
        const f = mtof(m + det);
        let lp = 0;
        let ph = rnd();
        for (let i = 0; i < len; i++) {
          const t = i / SR;
          const env = t < a ? t / a : t < dur ? 1 : Math.max(0, 1 - (t - dur) / r);
          ph += f / SR;
          const saw = 2 * (ph % 1) - 1;
          lp += (saw - lp) * 0.06;
          this.add(Math.floor(t0 * SR) + i, lp * env * vol);
        }
      }
  }
  bell(m: number, t0: number, vol = 0.18, decay = 1.8) {
    const f = mtof(m);
    const len = Math.floor(decay * 2.5 * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.exp(-t / (decay * 0.45)) * Math.min(1, t * 400);
      const vib = 1 + 0.003 * Math.sin(t * 2 * Math.PI * 5);
      const v = Math.sin(2 * Math.PI * f * vib * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 3) + 0.15 * Math.sin(2 * Math.PI * f * 4.07 * t) * Math.exp(-t * 6);
      this.add(Math.floor(t0 * SR) + i, v * env * vol);
    }
  }
  epiano(m: number, t0: number, vol = 0.14, decay = 1.6) {
    const f = mtof(m);
    const len = Math.floor(decay * 2 * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.exp(-t / decay) * Math.min(1, t * 300);
      const tine = Math.sin(2 * Math.PI * f * t + 0.8 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 4));
      this.add(Math.floor(t0 * SR) + i, (tine + 0.2 * Math.sin(4 * Math.PI * f * t)) * env * vol);
    }
  }
  bass(m: number, t0: number, dur: number, vol = 0.22) {
    const f = mtof(m);
    const len = Math.floor((dur + 0.05) * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, t * 200) * (t < dur ? 1 - (t / dur) * 0.4 : Math.max(0, 1 - (t - dur) * 20));
      const ph = (f * t) % 1;
      const tri = 4 * Math.abs(ph - 0.5) - 1;
      this.add(Math.floor(t0 * SR) + i, tri * env * vol);
    }
  }
  noise(t0: number, dur: number, vol: number, lpK = 0.5, hp = false) {
    let lp = 0, prev = 0;
    const len = Math.floor(dur * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.exp(-t / (dur * 0.3));
      const n = rnd() * 2 - 1;
      lp += (n - lp) * lpK;
      const out = hp ? lp - prev : lp;
      prev = lp;
      this.add(Math.floor(t0 * SR) + i, out * env * vol);
    }
  }
  kick(t0: number, vol = 0.5) {
    const len = Math.floor(0.25 * SR);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const f = 50 + 90 * Math.exp(-t * 30);
      ph += f / SR;
      this.add(Math.floor(t0 * SR) + i, Math.sin(2 * Math.PI * ph) * Math.exp(-t * 12) * vol);
    }
  }
  reverb(mix = 0.25) {
    const combs = [1557, 1617, 1491, 1422].map((d) => Math.floor(d * SR / 44100) * 2);
    const out = new Float32Array(this.data.length);
    const n = this.data.length;
    for (const d of combs) {
      const buf = new Float32Array(d);
      let idx = 0;
      // two passes to wrap the tail for loops
      for (let pass = 0; pass < 2; pass++)
        for (let i = 0; i < n; i++) {
          const y = buf[idx];
          buf[idx] = this.data[i] + y * 0.82;
          idx = (idx + 1) % d;
          if (pass === 1) out[i] += y * 0.25;
        }
    }
    for (let i = 0; i < n; i++) this.data[i] = this.data[i] * (1 - mix) + out[i] * mix;
  }
  lowpass(k: number) {
    let lp = 0;
    for (let i = 0; i < this.data.length; i++) {
      lp += (this.data[i] - lp) * k;
      this.data[i] = lp;
    }
  }
  tape(vol = 0.004) {
    for (let i = 0; i < this.data.length; i++) this.data[i] += (rnd() * 2 - 1) * vol;
  }
}

// ---------------------------------------------------------------- music
function yardTheme(): Float32Array {
  const bpm = 76, beat = 60 / bpm, bar = beat * 4, bars = 16;
  const tr = new Track(bar * bars);
  const prog = [
    [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62],
    [57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59],
  ];
  const roots = [45, 41, 48, 43, 45, 41, 38, 40];
  const melodyA = [[76, 0], [74, 1], [72, 1.5], [71, 2], [72, 3], [69, 4.5], [72, 6], [71, 7], [67, 7.5], [69, 8.5], [72, 10], [74, 11], [76, 12], [79, 13], [76, 14], [71, 15.5]];
  const melodyB = [[81, 0], [79, 1], [76, 2], [77, 4], [76, 5], [72, 6], [74, 8], [72, 9], [71, 10], [69, 12], [68, 13.5], [71, 14.5]];
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    const ch = prog[b % 8];
    tr.pad(ch, t, bar * 0.95, 0.035);
    tr.bass(roots[b % 8] - 12 + 12, t, beat * 1.8, 0.12);
    tr.bass(roots[b % 8] - 12 + 12, t + beat * 2.5, beat * 1.2, 0.08);
    // music-box arpeggio
    for (let k = 0; k < 8; k++) {
      const n = ch[[0, 1, 2, 1, 0, 2, 1, 2][k]] + 12;
      tr.bell(n, t + k * beat * 0.5, 0.035, 0.9);
    }
  }
  const mel = (m: number[][], start: number) => m.forEach(([n, at]) => tr.bell(n, start + at * beat, 0.13, 2.2));
  mel(melodyA, bar * 0);
  mel(melodyB, bar * 4);
  mel(melodyA.map(([n, a]) => [n + (a > 12 ? -2 : 0), a]), bar * 8);
  mel(melodyB.map(([n, a]) => [n - 5 + (a < 4 ? 5 : 0), a]), bar * 12);
  tr.reverb(0.3);
  tr.tape();
  return tr.data;
}

function homeTheme(): Float32Array {
  const bpm = 66, beat = 60 / bpm, bar = beat * 4, bars = 8;
  const tr = new Track(bar * bars);
  const prog = [[62, 65, 69], [58, 62, 65], [55, 58, 62], [57, 61, 64], [62, 65, 69], [58, 62, 65], [55, 58, 62], [57, 61, 64]];
  const roots = [38, 34, 43, 45, 38, 34, 43, 45];
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    const ch = prog[b];
    tr.pad(ch.map((n) => n - 12), t, bar, 0.025);
    tr.bass(roots[b], t, bar * 0.8, 0.1);
    for (let k = 0; k < 4; k++) tr.epiano(ch[k % 3] + (k === 3 ? 12 : 0), t + k * beat, 0.07, 1.8);
    if (b % 2 === 1) tr.epiano(ch[2] + 12, t + beat * 2.5, 0.09, 2.5);
  }
  [[74, 0], [72, 1.5], [70, 2], [69, 4], [70, 6], [72, 7], [74, 8], [77, 10], [76, 12], [73, 14]].forEach(([n, a]) => tr.epiano(n, bar * 4 + a * beat * 0.5 * 2, 0.11, 2.4));
  tr.reverb(0.35);
  tr.lowpass(0.5);
  tr.tape(0.006);
  return tr.data;
}

function fightTheme(): Float32Array {
  const bpm = 132, beat = 60 / bpm, bar = beat * 4, bars = 8;
  const tr = new Track(bar * bars);
  const ost = [40, 40, 43, 40, 45, 40, 47, 45];
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    const shift = b >= 4 && b < 6 ? 3 : b >= 6 ? 5 : 0;
    for (let k = 0; k < 8; k++) tr.bass(ost[k] + shift, t + k * beat * 0.5, beat * 0.4, 0.2);
    for (let k = 0; k < 4; k++) tr.kick(t + k * beat, 0.45);
    tr.noise(t + beat, 0.18, 0.25, 0.7);
    tr.noise(t + beat * 3, 0.18, 0.25, 0.7);
    for (let k = 0; k < 8; k++) tr.noise(t + k * beat * 0.5, 0.04, 0.08, 0.9, true);
    if (b % 2 === 0) [64, 67, 71].forEach((n) => tr.bell(n + shift, t, 0.06, 0.6));
    tr.pad([52 + shift, 59 + shift], t, bar * 0.9, 0.02);
  }
  tr.reverb(0.12);
  return tr.data;
}

function mysteryTheme(): Float32Array {
  const bpm = 60, beat = 1, bar = beat * 4, bars = 8;
  const tr = new Track(bar * bars);
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    tr.pad([33, 40, b % 4 === 3 ? 46 : 45], t, bar, 0.04);
    if (b % 2 === 0) tr.bell([76, 72, 71, 77][(b / 2) % 4], t + beat, 0.1, 3);
    tr.bell([64, 63][b % 2], t + beat * 3, 0.05, 2);
  }
  tr.reverb(0.45);
  tr.lowpass(0.4);
  tr.tape(0.005);
  void bpm;
  return tr.data;
}

function windLoop(): Float32Array {
  const tr = new Track(16);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < tr.data.length; i++) {
    const t = i / SR;
    const mod = 0.5 + 0.5 * Math.sin((t / 16) * 2 * Math.PI * 3) * Math.sin((t / 16) * 2 * Math.PI * 2 + 1);
    const n = rnd() * 2 - 1;
    lp += (n - lp) * (0.02 + 0.04 * mod);
    lp2 += (lp - lp2) * 0.3;
    tr.data[i] = lp2 * (0.5 + mod) * 1.4;
  }
  return tr.data;
}

// ---------------------------------------------------------------- sfx
function sfx(seconds: number, fn: (t: number, i: number) => number): Float32Array {
  const d = new Float32Array(Math.ceil(seconds * SR));
  for (let i = 0; i < d.length; i++) d[i] = fn(i / SR, i);
  return d;
}

function filteredNoise(seconds: number, env: (t: number) => number, k: (t: number) => number) {
  let lp = 0;
  return sfx(seconds, (t) => {
    lp += (rnd() * 2 - 1 - lp) * k(t);
    return lp * env(t);
  });
}

export function renderAudio(dir: string) {
  wav(`${dir}/music_yard.wav`, yardTheme());
  wav(`${dir}/music_home.wav`, homeTheme());
  wav(`${dir}/music_fight.wav`, fightTheme());
  wav(`${dir}/music_mystery.wav`, mysteryTheme());
  wav(`${dir}/amb_wind.wav`, windLoop());
  wav(`${dir}/sfx_step_snow.wav`, filteredNoise(0.12, (t) => Math.exp(-t * 35) * (1 + Math.sin(t * 900) * 0.3) * 0.7, () => 0.35));
  wav(`${dir}/sfx_step_floor.wav`, sfx(0.08, (t) => Math.sin(2 * Math.PI * 110 * t) * Math.exp(-t * 60) * 0.5 + (rnd() - 0.5) * Math.exp(-t * 90) * 0.2));
  wav(`${dir}/sfx_blip.wav`, sfx(0.035, (t) => (Math.sin(2 * Math.PI * 660 * t) > 0 ? 1 : -1) * Math.exp(-t * 80) * 0.12));
  wav(`${dir}/sfx_ui_move.wav`, sfx(0.05, (t) => Math.sin(2 * Math.PI * 990 * t) * Math.exp(-t * 70) * 0.3));
  wav(`${dir}/sfx_ui_ok.wav`, sfx(0.14, (t) => Math.sin(2 * Math.PI * (t < 0.06 ? 784 : 1175) * t) * Math.exp(-t * 18) * 0.3));
  wav(`${dir}/sfx_pickup.wav`, sfx(0.45, (t) => [523, 659, 784, 1047].reduce((s, f, k) => s + (t > k * 0.07 ? Math.sin(2 * Math.PI * f * t) * Math.exp(-(t - k * 0.07) * 8) : 0), 0) * 0.15));
  wav(`${dir}/sfx_clue.wav`, sfx(1.4, (t) => [659, 831, 988, 1319].reduce((s, f, k) => s + (t > k * 0.12 ? Math.sin(2 * Math.PI * f * t) * Math.exp(-(t - k * 0.12) * 3) : 0), 0) * 0.12));
  wav(`${dir}/sfx_door.wav`, sfx(0.7, (t) => Math.sin(2 * Math.PI * (300 + 200 * Math.sin(t * 9)) * t) * Math.exp(-t * 5) * 0.08 + (t > 0.5 ? Math.sin(2 * Math.PI * 70 * t) * Math.exp(-(t - 0.5) * 25) * 0.6 : 0)));
  wav(`${dir}/sfx_hit.wav`, sfx(0.22, (t) => Math.sin(2 * Math.PI * (90 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18) * 0.6 + (rnd() * 2 - 1) * Math.exp(-t * 40) * 0.35));
  wav(`${dir}/sfx_block.wav`, sfx(0.15, (t) => Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 35) * 0.5 + (rnd() * 2 - 1) * Math.exp(-t * 120) * 0.25));
  wav(`${dir}/sfx_whoosh.wav`, filteredNoise(0.3, (t) => Math.sin((t / 0.3) * Math.PI) * 0.6, (t) => 0.05 + t * 1.2));
  wav(`${dir}/sfx_bark.wav`, sfx(0.5, (t) => {
    const burst = (t0: number) => (t > t0 && t < t0 + 0.13 ? Math.exp(-(t - t0) * 18) : 0);
    const e = burst(0) + burst(0.24);
    const f = 300 + 250 * Math.exp(-((t % 0.24) * 25));
    return (((f * t) % 1) * 2 - 1) * e * 0.35 + (rnd() * 2 - 1) * e * 0.15;
  }));
  wav(`${dir}/sfx_whine.wav`, sfx(0.9, (t) => Math.sin(2 * Math.PI * (880 - 220 * t + 30 * Math.sin(t * 40)) * t) * Math.sin((t / 0.9) * Math.PI) * 0.15));
  wav(`${dir}/sfx_cans.wav`, sfx(0.8, (t) => {
    let s = 0;
    for (const t0 of [0, 0.11, 0.19, 0.34, 0.5]) if (t > t0) for (const f of [1820, 2630, 3410]) s += Math.sin(2 * Math.PI * f * (t - t0)) * Math.exp(-(t - t0) * 30);
    return s * 0.06;
  }));
  wav(`${dir}/sfx_engine.wav`, sfx(3, (t) => (Math.sin(2 * Math.PI * 38 * t) + 0.5 * Math.sin(2 * Math.PI * 76 * t + Math.sin(t * 20))) * Math.min(1, t * 2) * Math.min(1, (3 - t) * 2) * 0.25));
  wav(`${dir}/sfx_untie.wav`, filteredNoise(0.25, (t) => Math.exp(-t * 12) * 0.5, () => 0.6));
}
