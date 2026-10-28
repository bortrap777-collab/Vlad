import { aiAssetsReady } from './assets';
import { isnetProvider } from './providers/backgroundRemoval';
import type { AiProvider, AiToolId, AiToolSpec } from './types';

export const AI_TOOLS: AiToolSpec[] = [
  {
    id: 'bg-remove',
    title: 'Удаление фона',
    description: 'Отделяет человека или предмет от фона.',
    icon: 'cutout',
    media: 'photo',
    requirements: [
      { kind: 'on-device', title: 'Модель ISNet на устройстве', detail: 'Модель сегментации 44 МБ и движок ONNX Runtime 11 МБ. Скачиваются один раз при первом использовании, дальше работают без интернета. Фото никуда не отправляются.' },
      { kind: 'server', title: 'Свой сервер (не подключён)', detail: 'Быстрее и точнее на сложных краях (волосы, мех), но фото пришлось бы отправлять на сервер. Пока не требуется.' },
    ],
  },
  {
    id: 'bg-replace',
    title: 'Замена фона',
    description: 'Цвет, размытие или своя картинка вместо фона.',
    icon: 'layers',
    media: 'photo',
    requirements: [{ kind: 'on-device', title: 'Та же модель, что и удаление фона', detail: 'Модель находит объект, а фон заменяется прямо в редакторе: прозрачный, цвет, размытие или своё фото. Поворот, обрезку и фильтры можно менять и после.' }],
  },
  {
    id: 'object-select',
    title: 'Выделение касанием',
    description: 'Коснитесь объекта — выделится он или его часть: лицо, голова, человек целиком.',
    icon: 'target',
    media: 'photo',
    requirements: [
      { kind: 'on-device', title: 'Модель MobileSAM на устройстве', detail: 'Энкодер 28 МБ и декодер масок 16,5 МБ. Фото «изучается» один раз (несколько секунд), дальше каждое касание — доли секунды. Работает без интернета, фото никуда не отправляется.' },
    ],
  },
  {
    id: 'object-erase',
    title: 'Удаление объектов',
    description: 'Убирает выделенное и дорисовывает фон на его месте.',
    icon: 'eraser',
    media: 'photo',
    requirements: [
      { kind: 'on-device', title: 'Модель MI-GAN на устройстве', detail: 'Модель Picsart AI Research, 28 МБ. Дорисовывает участок вокруг объекта, остальное фото не меняется. Небольшие объекты убирает чисто; на больших участках фон бывает размытым или с повторами.' },
    ],
  },
  {
    id: 'enhance',
    title: 'Улучшение качества',
    description: 'Повышает чёткость и разрешение снимка.',
    icon: 'enhance',
    media: 'photo',
    requirements: [
      { kind: 'on-device', title: 'Модель апскейла ×2', detail: 'Модель 5–20 МБ, фото обрабатывается частями. На iPhone фото 12 Мп может занять минуты — нужна проверка скорости.' },
      { kind: 'api', title: 'Внешний API', detail: 'Лучшее качество. Нужен API-ключ сервиса; фото отправляется в сервис, обработка платная.' },
    ],
  },
  {
    id: 'captions',
    title: 'Автосубтитры',
    description: 'Распознаёт речь и расставляет субтитры по времени.',
    icon: 'captions',
    media: 'video',
    requirements: [
      { kind: 'on-device', title: 'Whisper на устройстве', detail: 'Работает: редактор видео → «Субтитры». Быстрая модель base — 77 МБ, точная small — 249 МБ (ошибок в русском примерно в 2,4 раза меньше, но медленнее и нужно больше памяти). Скачивается один раз, дальше офлайн; звук никуда не отправляется.' },
      { kind: 'api', title: 'API распознавания речи', detail: 'Не подключено. Даст лучшее качество на длинных роликах, но звук уходит в сервис и нужен платный ключ.' },
    ],
  },
  {
    id: 'smart-edit',
    title: 'Умный монтаж',
    description: 'Находит лучшие моменты и собирает черновой монтаж.',
    icon: 'wand',
    media: 'video',
    requirements: [
      { kind: 'api', title: 'Распознавание речи + языковая модель', detail: 'Сначала автосубтитры, затем языковая модель по API (например, Claude) выбирает фрагменты по тексту и сценам. Нужны API-ключи обоих сервисов.' },
    ],
  },
];

/** Зарегистрированные провайдеры. Инструмент без провайдера показывает «Не подключено». */
const providers: AiProvider[] = [
  isnetProvider as AiProvider,
  // Замена фона — та же модель сегментации; сама композиция делается в фоторедакторе.
  { ...(isnetProvider as AiProvider), tool: 'bg-replace' },
  // Сами вызовы моделей — в providers/objects.ts, инструмент «Объекты» фоторедактора
  { id: 'mobilesam-on-device', tool: 'object-select', kind: 'on-device', title: 'MobileSAM на устройстве', isAvailable: () => aiAssetsReady('select'), run: () => Promise.reject(new Error('Используется в редакторе фото')) },
  {
    id: 'whisper-on-device',
    tool: 'captions',
    kind: 'on-device',
    title: 'Whisper на устройстве',
    isAvailable: async () => (await aiAssetsReady('speech')) || (await aiAssetsReady('speech-hq')),
    run: () => Promise.reject(new Error('Используется в редакторе видео')),
  },
  { id: 'migan-on-device', tool: 'object-erase', kind: 'on-device', title: 'MI-GAN на устройстве', isAvailable: () => aiAssetsReady('erase'), run: () => Promise.reject(new Error('Используется в редакторе фото')) },
];

export function registerProvider(p: AiProvider): void {
  providers.push(p);
}

export function providersFor(tool: AiToolId): AiProvider[] {
  return providers.filter((p) => p.tool === tool);
}

export function isToolConnected(tool: AiToolId): boolean {
  return providersFor(tool).length > 0;
}

export type ToolState = 'ready' | 'needs-download' | 'not-connected';

/** ready — можно пользоваться; needs-download — провайдер есть, модель ещё не скачана. */
export async function toolState(tool: AiToolId): Promise<ToolState> {
  const list = providersFor(tool);
  if (!list.length) return 'not-connected';
  for (const p of list) if (await p.isAvailable()) return 'ready';
  return 'needs-download';
}
