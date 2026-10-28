/**
 * Распознавание речи Whisper на устройстве (ONNX Runtime Web), с метками времени.
 *
 * Повторяет поведение оригинала (openai/whisper):
 *  - окна по 30 с, следующее окно начинается с конца последней законченной фразы;
 *  - жадное декодирование с правилами меток времени (ApplyTimestampRules);
 *  - пропуск окон без речи (вероятность <|nocaptions|> и средняя уверенность);
 *  - защита от «зацикливания» (повтор одних и тех же слов).
 * Без DOM: работает в Web Worker и в Node (для проверки по эталону).
 */
import { CHUNK_SAMPLES, logMel, N_FRAMES, N_MELS, SAMPLE_RATE } from './mel';

/* Минимальный интерфейс onnxruntime, чтобы ядро не зависело от сборки */
export interface OrtTensor {
  data: ArrayLike<number> | BigInt64Array | Uint8Array;
  dims: readonly number[];
}
export interface OrtSession {
  inputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
export interface OrtLike {
  Tensor: new (type: string, data: unknown, dims: number[]) => OrtTensor;
}

export interface GenerationConfig {
  suppress_tokens: number[];
  begin_suppress_tokens: number[];
  lang_to_id: Record<string, number>;
  task_to_id: Record<string, number>;
  eos_token_id: number;
  decoder_start_token_id: number;
  no_timestamps_token_id: number;
  max_initial_timestamp_index?: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeOptions {
  /** Код языка ('ru', 'en', …) или 'auto' */
  language: string;
  onProgress?: (value: number, label: string) => void;
  isCancelled?: () => boolean;
}

/* ---------- Токены → текст (byte-level BPE, как GPT-2) ---------- */
function bytesToUnicode(): Map<string, number> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++)
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  const m = new Map<string, number>();
  bs.forEach((b, i) => m.set(String.fromCharCode(cs[i]), b));
  return m;
}

export class WhisperTokenizer {
  private tokens: string[] = [];
  private byteOf = bytesToUnicode();
  private utf8 = new TextDecoder('utf-8', { fatal: false });
  constructor(vocab: Record<string, number>) {
    for (const [t, id] of Object.entries(vocab)) this.tokens[id] = t;
  }
  decode(ids: number[]): string {
    const bytes: number[] = [];
    for (const id of ids) {
      const t = this.tokens[id];
      if (!t) continue;
      for (const ch of t) {
        const b = this.byteOf.get(ch);
        if (b !== undefined) bytes.push(b);
      }
    }
    return this.utf8.decode(new Uint8Array(bytes));
  }
}

/* ---------- Модель ---------- */
export class Whisper {
  private layers: number;
  private heads: number;
  private headDim: number;
  private eot: number;
  private sot: number;
  private tsBegin: number;
  private noCaptions: number;
  private transcribeId: number;
  private suppress: number[];
  private maxInitial: number;

  constructor(
    private ort: OrtLike,
    private encoder: OrtSession,
    private decoder: OrtSession,
    private gen: GenerationConfig,
    private tok: WhisperTokenizer,
    dims?: { heads: number; headDim: number },
  ) {
    this.layers = decoder.inputNames.filter((n) => /^past_key_values\.\d+\.decoder\.key$/.test(n)).length;
    this.heads = dims?.heads ?? 8;
    this.headDim = dims?.headDim ?? 64;
    this.eot = gen.eos_token_id;
    this.sot = gen.decoder_start_token_id;
    this.tsBegin = gen.no_timestamps_token_id + 1;
    this.noCaptions = gen.no_timestamps_token_id - 1;
    this.transcribeId = gen.task_to_id.transcribe;
    this.suppress = gen.suppress_tokens;
    this.maxInitial = gen.max_initial_timestamp_index ?? 50;
  }

  languages(): string[] {
    return Object.keys(this.gen.lang_to_id).map((k) => k.replace(/[<|>]/g, ''));
  }

  private emptyPast(): Record<string, OrtTensor> {
    const feeds: Record<string, OrtTensor> = {};
    for (let l = 0; l < this.layers; l++)
      for (const kind of ['decoder', 'encoder'])
        for (const kv of ['key', 'value']) feeds[`past_key_values.${l}.${kind}.${kv}`] = new this.ort.Tensor('float32', new Float32Array(0), [1, this.heads, 0, this.headDim]);
    return feeds;
  }

  /** Один шаг декодера: логиты всех позиций входа и новый кэш */
  private async step(ids: number[], enc: OrtTensor, past: Record<string, OrtTensor> | null) {
    const feeds: Record<string, OrtTensor> = {
      input_ids: new this.ort.Tensor('int64', BigInt64Array.from(ids.map((i) => BigInt(i))), [1, ids.length]),
      encoder_hidden_states: enc,
      use_cache_branch: new this.ort.Tensor('bool', new Uint8Array([past ? 1 : 0]), [1]),
      ...(past ?? this.emptyPast()),
    };
    const out = await this.decoder.run(feeds);
    const next: Record<string, OrtTensor> = {};
    for (let l = 0; l < this.layers; l++)
      for (const kv of ['key', 'value']) {
        next[`past_key_values.${l}.decoder.${kv}`] = out[`present.${l}.decoder.${kv}`];
        // Кэш кодировщика считается на первом шаге и дальше не меняется
        next[`past_key_values.${l}.encoder.${kv}`] = past ? past[`past_key_values.${l}.encoder.${kv}`] : out[`present.${l}.encoder.${kv}`];
      }
    return { logits: out.logits.data as Float32Array, seq: out.logits.dims[1], vocab: out.logits.dims[2], past: next };
  }

  private async encode(audio: Float32Array): Promise<OrtTensor> {
    const mel = logMel(audio);
    const out = await this.encoder.run({ input_features: new this.ort.Tensor('float32', mel, [1, N_MELS, N_FRAMES]) });
    return out.last_hidden_state ?? Object.values(out)[0];
  }

  /** Определить язык по первому окну с речью */
  async detectLanguage(audio: Float32Array): Promise<string> {
    const enc = await this.encode(audio);
    const { logits, vocab } = await this.step([this.sot], enc, null);
    let best = 'en';
    let bestV = -Infinity;
    for (const [k, id] of Object.entries(this.gen.lang_to_id)) {
      const v = logits[id];
      if (v > bestV) {
        bestV = v;
        best = k.replace(/[<|>]/g, '');
      }
    }
    void vocab;
    return best;
  }

  /**
   * Декодировать одно окно 30 с. Если модель зациклилась или не уверена —
   * повтор с «температурой» (как в оригинале: 0 → 0.4 → 0.8), берём лучший результат.
   */
  private async decodeWindow(audio: Float32Array, langId: number, isCancelled?: () => boolean) {
    const enc = await this.encode(audio);
    let best: { seq: number[]; avgLogprob: number; noSpeechProb: number; looped: boolean } | null = null;
    for (const temperature of [0, 0.4, 0.8]) {
      const r = await this.decodeOnce(enc, langId, temperature, isCancelled);
      if (!best || (best.looped && !r.looped) || (best.looped === r.looped && r.avgLogprob > best.avgLogprob)) best = r;
      if (!r.looped && r.avgLogprob > -1) break;
      if (r.noSpeechProb > 0.6) break;
    }
    return best!;
  }

  private async decodeOnce(enc: OrtTensor, langId: number, temperature: number, isCancelled?: () => boolean) {
    const rnd = mulberry32(12345 + Math.round(temperature * 100));
    const prompt = [this.sot, langId, this.transcribeId];
    let r = await this.step(prompt, enc, null);
    const V = r.vocab;
    let looped = false;
    // Вероятность «здесь нет речи» — по позиции <|startoftranscript|>
    const noSpeechProb = softmaxAt(r.logits.subarray(0, V), this.noCaptions);
    const seq: number[] = [];
    let sumLogprob = 0;
    const maxNew = 224;
    let lastRow = r.logits.subarray((r.seq - 1) * V, r.seq * V);
    for (let i = 0; i < maxNew; i++) {
      if (isCancelled?.()) throw new Error('cancelled');
      const logits = Float32Array.from(lastRow);
      this.applyRules(logits, seq);
      const { id, logprob } = temperature > 0 ? sample(logits, temperature, rnd) : argmaxWithLogprob(logits);
      sumLogprob += logprob;
      if (id === this.eot) break;
      seq.push(id);
      const cut = repetitionStart(seq, this.tsBegin);
      if (cut >= 0) {
        // Отрезаем повторы, оставляя первое вхождение
        seq.length = cut;
        looped = true;
        break;
      }
      r = await this.step([id], enc, r.past);
      lastRow = r.logits.subarray((r.seq - 1) * V, r.seq * V);
    }
    return { seq, avgLogprob: sumLogprob / Math.max(1, seq.length + 1), noSpeechProb, looped };
  }

  private applyRules(logits: Float32Array, seq: number[]): void {
    const NEG = -Infinity;
    const ts = this.tsBegin;
    for (const id of this.suppress) logits[id] = NEG;
    // Служебные токены (языки, задачи, <|notimestamps|>) в тексте не нужны
    for (let id = this.eot + 1; id < ts; id++) logits[id] = NEG;
    if (!seq.length) for (const id of this.gen.begin_suppress_tokens) logits[id] = NEG;

    const n = seq.length;
    const lastTs = n >= 1 && seq[n - 1] >= ts;
    const penultTs = n < 2 || seq[n - 2] >= ts;
    if (lastTs) {
      if (penultTs) for (let id = ts; id < logits.length; id++) logits[id] = NEG;
      else for (let id = 0; id < this.eot; id++) logits[id] = NEG;
    }
    const stamps = seq.filter((t) => t >= ts);
    if (stamps.length) {
      const last = stamps[stamps.length - 1];
      const limit = lastTs && !penultTs ? last : last + 1;
      for (let id = ts; id < limit; id++) logits[id] = NEG;
    }
    if (!n) {
      for (let id = 0; id < ts; id++) logits[id] = NEG;
      for (let id = ts + this.maxInitial + 1; id < logits.length; id++) logits[id] = NEG;
    }
    // Если сумма вероятностей меток времени выше любого слова — ставим метку
    const lse = logSumExp(logits, 0, logits.length);
    const tsLse = logSumExp(logits, ts, logits.length);
    let maxText = NEG;
    for (let id = 0; id < ts; id++) if (logits[id] > maxText) maxText = logits[id];
    if (tsLse - lse > maxText - lse) for (let id = 0; id < ts; id++) logits[id] = NEG;
  }

  /**
   * Распознать всю запись (16 кГц, моно). Метки времени — в секундах от начала записи.
   */
  async transcribe(audio: Float32Array, opts: TranscribeOptions): Promise<{ segments: Segment[]; language: string }> {
    const total = audio.length;
    const step = CHUNK_SAMPLES;
    let language = opts.language;
    if (language === 'auto') {
      opts.onProgress?.(0, 'Определяю язык…');
      const start = firstSpeech(audio);
      language = await this.detectLanguage(audio.subarray(start, start + step));
    }
    const langId = this.gen.lang_to_id[`<|${language}|>`];
    if (langId === undefined) throw new Error(`Язык «${language}» не поддерживается моделью`);

    const segments: Segment[] = [];
    let seek = 0;
    while (seek < total - SAMPLE_RATE * 0.2) {
      if (opts.isCancelled?.()) throw new Error('cancelled');
      const offset = seek / SAMPLE_RATE;
      opts.onProgress?.(seek / total, `Распознаю речь… ${fmt(offset)} из ${fmt(total / SAMPLE_RATE)}`);
      const window = audio.subarray(seek, seek + step);
      const winSec = window.length / SAMPLE_RATE;
      const { seq, avgLogprob, noSpeechProb } = await this.decodeWindow(window, langId, opts.isCancelled);

      if (noSpeechProb > 0.6 && avgLogprob < -1) {
        seek += window.length;
        continue;
      }
      const parsed = this.parse(seq);
      for (const s of parsed.complete) {
        const text = this.tok.decode(s.tokens).trim();
        if (!text) continue;
        segments.push({ start: offset + s.start, end: offset + Math.min(s.end, winSec), text });
      }
      // Незаконченная фраза в конце окна — начнём с неё следующее окно
      if (parsed.openStart !== null && parsed.openStart > 1 && window.length === step) {
        seek += Math.round(parsed.openStart * SAMPLE_RATE);
      } else {
        if (parsed.openStart !== null && parsed.openTokens.length) {
          const text = this.tok.decode(parsed.openTokens).trim();
          if (text) segments.push({ start: offset + parsed.openStart, end: offset + winSec, text });
        }
        seek += window.length;
      }
    }
    opts.onProgress?.(1, 'Готово');
    return { segments: cleanup(segments), language };
  }

  private parse(seq: number[]) {
    const ts = this.tsBegin;
    const complete: { start: number; end: number; tokens: number[] }[] = [];
    let start: number | null = null;
    let text: number[] = [];
    for (const t of seq) {
      if (t >= ts) {
        const time = (t - ts) * 0.02;
        if (start === null) start = time;
        else if (text.length) {
          complete.push({ start, end: time, tokens: text });
          start = null;
          text = [];
        } else start = time;
      } else if (t < this.eot) {
        if (start === null) start = complete.length ? complete[complete.length - 1].end : 0;
        text.push(t);
      }
    }
    return { complete, openStart: text.length ? start : null, openTokens: text };
  }
}

/* ---------- вспомогательное ---------- */
function logSumExp(a: Float32Array, from: number, to: number): number {
  let m = -Infinity;
  for (let i = from; i < to; i++) if (a[i] > m) m = a[i];
  if (m === -Infinity) return -Infinity;
  let s = 0;
  for (let i = from; i < to; i++) s += Math.exp(a[i] - m);
  return m + Math.log(s);
}

function softmaxAt(row: Float32Array, id: number): number {
  return Math.exp(row[id] - logSumExp(row, 0, row.length));
}

function argmaxWithLogprob(a: Float32Array): { id: number; logprob: number } {
  let id = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[id]) id = i;
  return { id, logprob: a[id] - logSumExp(a, 0, a.length) };
}

/**
 * Модель зациклилась: одна и та же последовательность текста (1–30 токенов)
 * повторяется подряд (короткая — 5 раз, длинная — 3 раза). Метки времени не считаем.
 * Возвращает позицию, с которой начинаются лишние повторы, или -1.
 */
function repetitionStart(seq: number[], tsBegin: number): number {
  const idx: number[] = [];
  const text: number[] = [];
  seq.forEach((t, i) => {
    if (t < tsBegin) {
      text.push(t);
      idx.push(i);
    }
  });
  const n = text.length;
  for (let len = 1; len <= 30; len++) {
    const reps = len < 4 ? 5 : 3;
    if (n < len * reps) continue;
    let ok = true;
    for (let r = 1; r < reps && ok; r++)
      for (let i = 0; i < len; i++)
        if (text[n - len + i] !== text[n - (r + 1) * len + i]) {
          ok = false;
          break;
        }
    if (ok) return idx[n - (reps - 1) * len];
  }
  return -1;
}

/** Выбор токена с температурой (детерминированный генератор — повторяемый результат) */
function sample(logits: Float32Array, temperature: number, rnd: () => number): { id: number; logprob: number } {
  let m = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > m) m = logits[i];
  let sum = 0;
  const p = new Float64Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i] === -Infinity ? 0 : Math.exp((logits[i] - m) / temperature);
    p[i] = v;
    sum += v;
  }
  let x = rnd() * sum;
  let id = 0;
  for (let i = 0; i < p.length; i++) {
    x -= p[i];
    if (x <= 0) {
      id = i;
      break;
    }
  }
  return { id, logprob: logits[id] - logSumExp(logits, 0, logits.length) };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Первая громкая точка — с неё определяем язык */
function firstSpeech(audio: Float32Array): number {
  const win = SAMPLE_RATE / 10;
  for (let i = 0; i + win < audio.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += audio[j] * audio[j];
    if (Math.sqrt(s / win) > 0.02) return Math.max(0, i - SAMPLE_RATE / 2);
  }
  return 0;
}

/** Убрать пустые и подряд повторяющиеся фразы, выправить порядок времени */
function cleanup(list: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of list) {
    const prev = out[out.length - 1];
    if (prev && prev.text === s.text && s.start - prev.end < 1) {
      prev.end = Math.max(prev.end, s.end);
      continue;
    }
    const start = prev ? Math.max(s.start, prev.end) : s.start;
    out.push({ start, end: Math.max(start + 0.3, s.end), text: s.text });
  }
  return out;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
