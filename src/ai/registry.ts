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
      { kind: 'api', title: 'API распознавания речи', detail: 'Рекомендуется. Нужен API-ключ сервиса с русским языком и метками времени (OpenAI Whisper, Deepgram, AssemblyAI). Звук отправляется в сервис; у OpenAI около $0,006 за минуту.' },
      { kind: 'on-device', title: 'Whisper на устройстве', detail: 'Бесплатно и офлайн, но модель 150–250 МБ и на iPhone работает медленнее реального времени. Только для коротких роликов.' },
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
