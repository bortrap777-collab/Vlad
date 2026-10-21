import type { AiProvider, AiToolId, AiToolSpec } from './types';

export const AI_TOOLS: AiToolSpec[] = [
  {
    id: 'bg-remove',
    title: 'Удаление фона',
    description: 'Отделяет человека или предмет от фона.',
    icon: 'cutout',
    media: 'photo',
    requirements: [
      { kind: 'on-device', title: 'Модель в браузере', detail: 'Модель сегментации (~40–90 МБ), скачивается один раз и работает офлайн. Нужен iOS 17+ или свежий Chrome; на старых iPhone — медленно.' },
      { kind: 'server', title: 'Свой сервер', detail: 'Быстрее и качественнее, но фото отправляются на сервер.' },
    ],
  },
  {
    id: 'bg-replace',
    title: 'Замена фона',
    description: 'Цвет, размытие или своя картинка вместо фона.',
    icon: 'layers',
    media: 'photo',
    requirements: [{ kind: 'on-device', title: 'Через удаление фона', detail: 'Сама замена делается на устройстве; нужна та же модель сегментации.' }],
  },
  {
    id: 'enhance',
    title: 'Улучшение качества',
    description: 'Повышает чёткость и разрешение снимка.',
    icon: 'enhance',
    media: 'photo',
    requirements: [
      { kind: 'on-device', title: 'Модель апскейла', detail: 'Лёгкая модель ×2 для WebGPU. Большие фото обрабатываются частями.' },
      { kind: 'api', title: 'Внешний API', detail: 'Лучшее качество, требуется ключ и интернет.' },
    ],
  },
  {
    id: 'captions',
    title: 'Автосубтитры',
    description: 'Распознаёт речь и расставляет субтитры по времени.',
    icon: 'captions',
    media: 'video',
    requirements: [
      { kind: 'on-device', title: 'Whisper в браузере', detail: 'Модель распознавания речи (~75–250 МБ). Поддерживает русский.' },
      { kind: 'api', title: 'API распознавания', detail: 'Быстрее на длинных видео; аудио отправляется в сервис.' },
    ],
  },
  {
    id: 'smart-edit',
    title: 'Умный монтаж',
    description: 'Находит лучшие моменты и собирает черновой монтаж.',
    icon: 'wand',
    media: 'video',
    requirements: [
      { kind: 'server', title: 'Анализ сцен + языковая модель', detail: 'Требует сервер или API: определение сцен, речи и выбор фрагментов. Зависит от готового видеоредактора (этапы 3–4).' },
    ],
  },
];

/** Зарегистрированные провайдеры. Пусто — ИИ ещё не подключён. */
const providers: AiProvider[] = [];

export function registerProvider(p: AiProvider): void {
  providers.push(p);
}

export function providersFor(tool: AiToolId): AiProvider[] {
  return providers.filter((p) => p.tool === tool);
}

export function isToolConnected(tool: AiToolId): boolean {
  return providersFor(tool).length > 0;
}
