/**
 * Частота кадров видеофайла MP4/MOV — из заголовка (moov → trak → stts), без декодирования.
 * Нужна для плавного замедления: знать, где кончается один кадр исходника и начинается следующий.
 */
async function readBox(blob: Blob, off: number): Promise<{ type: string; size: number; header: number } | null> {
  if (off + 8 > blob.size) return null;
  const b = new DataView(await blob.slice(off, off + 16).arrayBuffer());
  let size = b.getUint32(0);
  const type = String.fromCharCode(b.getUint8(4), b.getUint8(5), b.getUint8(6), b.getUint8(7));
  let header = 8;
  if (size === 1) {
    size = Number(b.getBigUint64(8));
    header = 16;
  } else if (size === 0) size = blob.size - off;
  if (size < header) return null;
  return { type, size, header };
}

function children(dv: DataView, start: number, end: number): { type: string; start: number; end: number; body: number }[] {
  const out: { type: string; start: number; end: number; body: number }[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    let header = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(p + 8));
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || p + size > end) break;
    out.push({ type, start: p, end: p + size, body: p + header });
    p += size;
  }
  return out;
}

export async function probeFps(blob: Blob): Promise<number | null> {
  try {
    let off = 0;
    for (let guard = 0; guard < 64; guard++) {
      const box = await readBox(blob, off);
      if (!box) return null;
      if (box.type === 'moov') {
        if (box.size > 64 * 1024 * 1024) return null;
        const dv = new DataView(await blob.slice(off, off + box.size).arrayBuffer());
        for (const trak of children(dv, box.header, box.size).filter((b) => b.type === 'trak')) {
          const mdia = children(dv, trak.body, trak.end).find((b) => b.type === 'mdia');
          if (!mdia) continue;
          const mk = children(dv, mdia.body, mdia.end);
          const hdlr = mk.find((b) => b.type === 'hdlr');
          const mdhd = mk.find((b) => b.type === 'mdhd');
          const minf = mk.find((b) => b.type === 'minf');
          if (!hdlr || !mdhd || !minf) continue;
          const handler = String.fromCharCode(dv.getUint8(hdlr.body + 8), dv.getUint8(hdlr.body + 9), dv.getUint8(hdlr.body + 10), dv.getUint8(hdlr.body + 11));
          if (handler !== 'vide') continue;
          const version = dv.getUint8(mdhd.body);
          const timescale = dv.getUint32(mdhd.body + (version === 1 ? 20 : 12));
          const stbl = children(dv, minf.body, minf.end).find((b) => b.type === 'stbl');
          const stts = stbl && children(dv, stbl.body, stbl.end).find((b) => b.type === 'stts');
          if (!stts || !timescale) continue;
          const n = dv.getUint32(stts.body + 4);
          let count = 0;
          let dur = 0;
          for (let i = 0; i < n; i++) {
            const c = dv.getUint32(stts.body + 8 + i * 8);
            const d = dv.getUint32(stts.body + 12 + i * 8);
            count += c;
            dur += c * d;
          }
          if (count && dur) return (count * timescale) / dur;
        }
        return null;
      }
      off += box.size;
    }
  } catch {
    /* не MP4 или повреждён */
  }
  return null;
}
