/**
 * Минимальный сборщик MP4 / QuickTime (MOV) без зависимостей.
 * Поддерживает: видео H.264 (avc1) и VP9 (vp09); звук AAC (mp4a), Opus и
 * несжатый PCM ('sowt', только в MOV — для устройств без аудиокодировщика).
 * Структура: ftyp | mdat (все видео, затем весь звук) | moov.
 * Порядок декодирования ≠ порядок показа (B-кадры) обрабатывается через ctts + elst.
 */

export interface VideoSample {
  data: Uint8Array;
  /** Время показа, в единицах timescale дорожки */
  pts: number;
  duration: number;
  key: boolean;
}

export interface VideoTrack {
  codec: 'avc1' | 'vp09';
  width: number;
  height: number;
  timescale: number;
  /** avcC для H.264 */
  description?: Uint8Array;
  vp9?: { profile: number; level: number; bitDepth: number };
  /** В порядке декодирования */
  samples: VideoSample[];
}

export interface AudioSample {
  data: Uint8Array;
  /** В единицах sampleRate */
  duration: number;
}

export interface AudioTrack {
  codec: 'mp4a' | 'opus' | 'lpcm';
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig (AAC) или OpusHead (Opus) */
  description?: Uint8Array;
  bitrate?: number;
  samples: AudioSample[];
  /** Для lpcm: число PCM-кадров (сэмплов на канал) */
  pcmFrames?: number;
  /** Стартовая задержка кодека (AAC priming), в сэмплах — пропускается через elst */
  primingSamples?: number;
}

export interface MuxInput {
  container: 'mp4' | 'mov';
  video: VideoTrack;
  audio?: AudioTrack | null;
}

/* ---------------- байты ---------------- */
const te = new TextEncoder();
const u8 = (n: number) => new Uint8Array([n & 255]);
const u16 = (n: number) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const u24 = (n: number) => new Uint8Array([(n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}
function s32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n | 0);
  return b;
}
const zeros = (n: number) => new Uint8Array(n);
function fourcc(s: string): Uint8Array {
  if (s.length !== 4) throw new Error('fourcc ' + s);
  return te.encode(s);
}
export function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(8 + body.length), fourcc(type), body]);
}
function full(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u8(version), u24(flags), ...parts);
}
const MATRIX = concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));
const macTime = () => Math.floor(Date.now() / 1000) + 2082844800;

/** Сжатие длительностей в пары (count, delta) */
function runLength(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

/* ---------------- описания кодеков ---------------- */
function visualEntry(type: string, w: number, h: number, ...children: Uint8Array[]): Uint8Array {
  const name = new Uint8Array(32);
  const label = te.encode('W Studio');
  name[0] = label.length;
  name.set(label, 1);
  return box(
    type,
    zeros(6),
    u16(1), // data_reference_index
    u16(0),
    u16(0),
    zeros(12),
    u16(w),
    u16(h),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1), // frame_count
    name,
    u16(0x0018),
    u16(0xffff),
    ...children,
  );
}

function audioEntry(type: string, channels: number, sampleRate: number, ...children: Uint8Array[]): Uint8Array {
  return box(type, zeros(6), u16(1), zeros(8), u16(channels), u16(16), u16(0), u16(0), u32(Math.round(sampleRate) * 65536), ...children);
}

function descr(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const len = body.length;
  const lenBytes = len < 128 ? u8(len) : new Uint8Array([0x80 | ((len >>> 21) & 127), 0x80 | ((len >>> 14) & 127), 0x80 | ((len >>> 7) & 127), len & 127]);
  return concat([u8(tag), lenBytes, body]);
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
export function aacConfig(sampleRate: number, channels: number): Uint8Array {
  const fi = Math.max(0, AAC_RATES.indexOf(sampleRate));
  const v = (2 << 11) | (fi << 7) | (channels << 3);
  return u16(v);
}

function esds(asc: Uint8Array, bitrate: number): Uint8Array {
  return full(
    'esds',
    0,
    0,
    descr(
      3,
      u16(1),
      u8(0),
      descr(4, u8(0x40), u8(0x15), u24(0), u32(bitrate), u32(bitrate), descr(5, asc)),
      descr(6, u8(2)),
    ),
  );
}

function dOps(channels: number, sampleRate: number, head?: Uint8Array): Uint8Array {
  // OpusHead (little-endian) → dOps (big-endian)
  let preSkip = 312;
  let inputRate = sampleRate;
  if (head && head.length >= 19 && new TextDecoder().decode(head.subarray(0, 8)) === 'OpusHead') {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    preSkip = dv.getUint16(10, true);
    inputRate = dv.getUint32(12, true);
  }
  return box('dOps', u8(0), u8(channels), u16(preSkip), u32(inputRate), u16(0), u8(0));
}

/* ---------------- дорожки ---------------- */
interface TrakArgs {
  id: number;
  kind: 'vide' | 'soun';
  timescale: number;
  mediaDuration: number;
  movieDuration: number;
  width?: number;
  height?: number;
  stsd: Uint8Array;
  stts: [number, number][];
  ctts?: [number, number][];
  stss?: number[];
  sizes: number[] | { constant: number; count: number };
  chunkOffset: number;
  editMediaTime?: number;
  container: 'mp4' | 'mov';
}

function trak(a: TrakArgs): Uint8Array {
  const t = macTime();
  const isVideo = a.kind === 'vide';
  const tkhd = full(
    'tkhd',
    0,
    3,
    u32(t),
    u32(t),
    u32(a.id),
    u32(0),
    u32(a.movieDuration),
    zeros(8),
    u16(0),
    u16(0),
    u16(isVideo ? 0 : 0x0100),
    u16(0),
    MATRIX,
    u32((a.width ?? 0) * 65536),
    u32((a.height ?? 0) * 65536),
  );
  const edts =
    a.editMediaTime && a.editMediaTime > 0
      ? [box('edts', full('elst', 0, 0, u32(1), u32(a.movieDuration), s32(a.editMediaTime), u16(1), u16(0)))]
      : [];
  const mdhd = full('mdhd', 0, 0, u32(t), u32(t), u32(a.timescale), u32(a.mediaDuration), u16(0x55c4), u16(0));
  const hdlr = full(
    'hdlr',
    0,
    0,
    a.container === 'mov' ? fourcc('mhlr') : u32(0),
    fourcc(a.kind),
    zeros(12),
    te.encode(isVideo ? 'VideoHandler\0' : 'SoundHandler\0'),
  );
  const mhd = isVideo ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, u16(0), u16(0));
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));

  const stts = full('stts', 0, 0, u32(a.stts.length), ...a.stts.flatMap(([c, d]) => [u32(c), u32(d)]));
  const parts = [a.stsd, stts];
  if (a.ctts) parts.push(full('ctts', 0, 0, u32(a.ctts.length), ...a.ctts.flatMap(([c, d]) => [u32(c), u32(d)])));
  if (a.stss) parts.push(full('stss', 0, 0, u32(a.stss.length), ...a.stss.map(u32)));
  const count = Array.isArray(a.sizes) ? a.sizes.length : a.sizes.count;
  parts.push(full('stsc', 0, 0, u32(1), u32(1), u32(count), u32(1)));
  if (Array.isArray(a.sizes)) {
    const sz = new Uint8Array(a.sizes.length * 4);
    const dv = new DataView(sz.buffer);
    a.sizes.forEach((s, i) => dv.setUint32(i * 4, s));
    parts.push(full('stsz', 0, 0, u32(0), u32(a.sizes.length), sz));
  } else {
    parts.push(full('stsz', 0, 0, u32(a.sizes.constant), u32(a.sizes.count)));
  }
  parts.push(full('stco', 0, 0, u32(1), u32(a.chunkOffset)));
  const stbl = box('stbl', ...parts);

  return box('trak', tkhd, ...edts, box('mdia', mdhd, hdlr, box('minf', mhd, dinf, stbl)));
}

/* ---------------- сборка файла ---------------- */
export function muxMp4(input: MuxInput): Blob {
  const { container, video, audio } = input;
  if (!video.samples.length) throw new Error('Нет видеокадров для записи');
  if (audio?.codec === 'lpcm' && container !== 'mov') throw new Error('PCM поддерживается только в MOV');

  const ftyp =
    container === 'mov'
      ? box('ftyp', fourcc('qt  '), u32(0x20050300), fourcc('qt  '))
      : box('ftyp', fourcc('isom'), u32(0x200), fourcc('isom'), fourcc('iso2'), fourcc(video.codec === 'avc1' ? 'avc1' : 'iso6'), fourcc('mp41'));

  /* --- видео: время показа и декодирования --- */
  const vs = video.samples;
  const pts = vs.map((s) => s.pts);
  const sorted = [...pts].sort((a, b) => a - b);
  let shift = 0;
  for (let i = 0; i < vs.length; i++) shift = Math.max(shift, sorted[i] - pts[i]);
  const dts = sorted.map((p) => p - shift);
  const vDurations = vs.map((s, i) => (i < vs.length - 1 ? dts[i + 1] - dts[i] : s.duration));
  const offsets = vs.map((s, i) => s.pts - dts[i]);
  const hasReorder = offsets.some((o) => o !== offsets[0]) || shift > 0;
  const minPts = sorted[0];
  let endPts = 0;
  vs.forEach((s) => (endPts = Math.max(endPts, s.pts + s.duration)));
  const vMediaDuration = vDurations.reduce((a, b) => a + b, 0);
  const vPresentDuration = endPts - minPts;

  const vBytes = vs.reduce((a, s) => a + s.data.length, 0);
  const aBytes = audio ? audio.samples.reduce((a, s) => a + s.data.length, 0) : 0;
  const mdatSize = 8 + vBytes + aBytes;
  if (ftyp.length + mdatSize > 0xffffffff) throw new Error('Видео слишком большое (больше 4 ГБ). Выберите качество ниже.');
  const vOffset = ftyp.length + 8;
  const aOffset = vOffset + vBytes;

  const movieTs = 1000;
  const vMovieDur = Math.round((vPresentDuration / video.timescale) * movieTs);

  let vStsd: Uint8Array;
  if (video.codec === 'avc1') {
    if (!video.description) throw new Error('Нет описания H.264 (avcC)');
    vStsd = visualEntry('avc1', video.width, video.height, box('avcC', video.description));
  } else {
    const p = video.vp9 ?? { profile: 0, level: 10, bitDepth: 8 };
    vStsd = visualEntry('vp09', video.width, video.height, full('vpcC', 1, 0, u8(p.profile), u8(p.level), u8((p.bitDepth << 4) | (1 << 1) | 0), u8(1), u8(1), u8(1), u16(0)));
  }

  const keyIdx = vs.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const traks: Uint8Array[] = [
    trak({
      id: 1,
      kind: 'vide',
      timescale: video.timescale,
      mediaDuration: vMediaDuration,
      movieDuration: vMovieDur,
      width: video.width,
      height: video.height,
      stsd: full('stsd', 0, 0, u32(1), vStsd),
      stts: runLength(vDurations),
      ctts: hasReorder ? runLength(offsets) : undefined,
      stss: keyIdx.length === vs.length ? undefined : keyIdx,
      sizes: vs.map((s) => s.data.length),
      chunkOffset: vOffset,
      editMediaTime: shift,
      container,
    }),
  ];

  let maxMovieDur = vMovieDur;
  if (audio && audio.samples.length) {
    let entry: Uint8Array;
    let stts: [number, number][];
    let sizes: TrakArgs['sizes'];
    let mediaDuration: number;
    if (audio.codec === 'lpcm') {
      const frames = audio.pcmFrames ?? 0;
      entry = audioEntry('sowt', audio.channels, audio.sampleRate);
      stts = [[frames, 1]];
      sizes = { constant: audio.channels * 2, count: frames };
      mediaDuration = frames;
    } else {
      entry =
        audio.codec === 'mp4a'
          ? audioEntry('mp4a', audio.channels, audio.sampleRate, esds(audio.description ?? aacConfig(audio.sampleRate, audio.channels), audio.bitrate ?? 192000))
          : audioEntry('Opus', audio.channels, 48000, dOps(audio.channels, audio.sampleRate, audio.description));
      const durs = audio.samples.map((s) => s.duration);
      stts = runLength(durs);
      sizes = audio.samples.map((s) => s.data.length);
      mediaDuration = durs.reduce((a, b) => a + b, 0);
    }
    const priming = audio.codec === 'lpcm' ? 0 : Math.max(0, Math.round(audio.primingSamples ?? 0));
    const aMovieDur = Math.round(((mediaDuration - priming) / audio.sampleRate) * movieTs);
    maxMovieDur = Math.max(maxMovieDur, aMovieDur);
    traks.push(
      trak({
        id: 2,
        kind: 'soun',
        timescale: audio.sampleRate,
        mediaDuration,
        movieDuration: aMovieDur,
        stsd: full('stsd', 0, 0, u32(1), entry),
        stts,
        sizes,
        chunkOffset: aOffset,
        editMediaTime: priming,
        container,
      }),
    );
  }

  const t = macTime();
  const mvhd = full('mvhd', 0, 0, u32(t), u32(t), u32(movieTs), u32(maxMovieDur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(traks.length + 1));
  const moov = box('moov', mvhd, ...traks);

  const parts: BlobPart[] = [ftyp as BlobPart, concat([u32(mdatSize), fourcc('mdat')]) as BlobPart];
  vs.forEach((s) => parts.push(s.data as BlobPart));
  audio?.samples.forEach((s) => parts.push(s.data as BlobPart));
  parts.push(moov as BlobPart);
  return new Blob(parts, { type: container === 'mov' ? 'video/quicktime' : 'video/mp4' });
}
