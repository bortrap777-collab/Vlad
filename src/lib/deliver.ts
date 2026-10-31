/**
 * Отдать готовый файл пользователю — лучшим способом, который есть на платформе:
 *  1. Просмотрщик Claude (capability `downloads`): подтверждение и системный «Поделиться».
 *  2. Web Share API с файлами: на iPhone → «Сохранить изображение» в Фото.
 *  3. Обычное скачивание (Android Chrome, компьютер).
 *  4. Если ничего не доступно — показать картинку для долгого нажатия.
 * Вызывать прямо из обработчика нажатия: iOS разрешает «Поделиться» только по жесту.
 */
export type DeliverResult = 'saved' | 'shared' | 'downloaded' | 'cancelled' | 'manual';

interface DownloadsNs {
  save(req: { filename: string; data: Blob }): Promise<{ status: string }>;
}

let downloadsPromise: Promise<DownloadsNs | null> | null = null;

/** Запрашиваем заранее, чтобы при нажатии не терять «жест» пользователя на ожидании. */
export function prepareDelivery(): void {
  if (downloadsPromise) return;
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  downloadsPromise = c?.use ? (c.use('downloads') as Promise<DownloadsNs | null>).catch(() => null) : Promise.resolve(null);
}

export function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export async function deliverFile(blob: Blob, filename: string): Promise<DeliverResult> {
  prepareDelivery();
  const file = new File([blob], filename, { type: blob.type });

  // 2. На iPhone/iPad сначала «Поделиться» (там есть «Сохранить изображение»),
  //    пока действует жест. На Android и компьютере надёжнее обычное скачивание.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!inFrame() && isAppleMobile() && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // NotAllowedError и прочее — пробуем дальше
    }
  }

  // 1. Просмотрщик Claude
  const dl = await downloadsPromise;
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return 'cancelled';
      if (code === 'rate_limited') throw new Error('Окно сохранения уже открыто. Подождите и повторите.');
      if (code === 'not_signed' || code === 'rejected_extension' || code === 'extension_not_enabled')
        throw new Error('Этот формат нельзя сохранить внутри Claude. Откройте Ws в Safari (как приложение) и сохраните оттуда.');
      if (code === 'too_large') throw new Error('Файл слишком большой для сохранения здесь. Выберите качество ниже.');
    }
  }

  // 3. Скачивание
  if (!inFrame()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'downloaded';
  }

  return 'manual';
}
