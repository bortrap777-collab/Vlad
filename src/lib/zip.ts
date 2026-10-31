/**
 * ZIP без сжатия (store): открытый формат, который понимает любое устройство.
 * Медиа и так сжаты — повторное сжатие только тратило бы время и батарею.
 * Чтение работает через blob.slice: большой файл не загружается в память целиком.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcUpdate(crc: number, bytes: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

async function crcOfBlob(blob: Blob, onBytes: (n: number) => void): Promise<number> {
  const STEP = 4 * 1024 * 1024;
  let crc = 0;
  for (let off = 0; off < blob.size; off += STEP) {
    const part = await bytesOf(blob.slice(off, Math.min(blob.size, off + STEP)));
    crc = crcUpdate(crc, part);
    onBytes(part.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return crc;
}

const te = new TextEncoder();

function header(size: number, fill: (dv: DataView) => void): Uint8Array {
  const b = new Uint8Array(size);
  fill(new DataView(b.buffer));
  return b;
}

function dosDateTime(d = new Date()): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

export interface ZipInput {
  name: string;
  data: Blob;
}

export async function writeZip(entries: ZipInput[], onProgress?: (v: number) => void): Promise<Blob> {
  const total = entries.reduce((a, e) => a + e.data.size, 0) || 1;
  let done = 0;
  const [time, date] = dosDateTime();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = te.encode(e.name);
    const crc = await crcOfBlob(e.data, (n) => {
      done += n;
      onProgress?.(done / total);
    });
    const size = e.data.size;
    const local = header(30, (dv) => {
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // имена в UTF-8
      dv.setUint16(8, 0, true); // без сжатия
      dv.setUint16(10, time, true);
      dv.setUint16(12, date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
    });
    central.push(
      header(46, (dv) => {
        dv.setUint32(0, 0x02014b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 20, true);
        dv.setUint16(8, 0x0800, true);
        dv.setUint16(10, 0, true);
        dv.setUint16(12, time, true);
        dv.setUint16(14, date, true);
        dv.setUint32(16, crc, true);
        dv.setUint32(20, size, true);
        dv.setUint32(24, size, true);
        dv.setUint16(28, name.length, true);
        dv.setUint32(42, offset, true);
      }),
      name,
    );
    parts.push(local as BlobPart, name as BlobPart, e.data);
    offset += 30 + name.length + size;
    if (offset > 0xffffffff) throw new Error('Проект больше 4 ГБ — такой файл пока нельзя перенести.');
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = header(22, (dv) => {
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, entries.length, true);
    dv.setUint16(10, entries.length, true);
    dv.setUint32(12, cdSize, true);
    dv.setUint32(16, offset, true);
  });
  central.forEach((c) => parts.push(c as BlobPart));
  parts.push(eocd as BlobPart);
  return new Blob(parts, { type: 'application/zip' });
}

export interface ZipEntry {
  name: string;
  size: number;
  crc: number;
  /** Данные файла без копирования (кусок исходного Blob) */
  data: Blob;
}

export class ZipError extends Error {}

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  const tailSize = Math.min(file.size, 22 + 65535);
  const tail = await bytesOf(file.slice(file.size - tailSize));
  let eo = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eo = i;
      break;
    }
  }
  if (eo < 0) throw new ZipError('Это не файл проекта Ws (не похож на ZIP).');
  const ev = new DataView(tail.buffer, tail.byteOffset + eo, 22);
  const count = ev.getUint16(10, true);
  const cdSize = ev.getUint32(12, true);
  const cdOffset = ev.getUint32(16, true);
  const cd = await bytesOf(file.slice(cdOffset, cdOffset + cdSize));
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const out: ZipEntry[] = [];
  const td = new TextDecoder();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new ZipError('Файл проекта повреждён.');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = td.decode(cd.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (method !== 0) throw new ZipError('Файл сжат другой программой. Импортируйте файл, созданный в Ws, без перепаковки.');
    const lh = await bytesOf(file.slice(localOff, localOff + 30));
    const lv = new DataView(lh.buffer, lh.byteOffset, 30);
    const start = localOff + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    out.push({ name, size, crc, data: file.slice(start, start + size) });
  }
  return out;
}

export async function verifyEntry(e: ZipEntry, onBytes?: (n: number) => void): Promise<boolean> {
  return (await crcOfBlob(e.data, onBytes ?? (() => undefined))) === e.crc;
}

export async function readText(e: ZipEntry): Promise<string> {
  return new TextDecoder().decode(await bytesOf(e.data));
}
