/**
 * Единый реестр статуса функций. Интерфейс берёт отсюда, что уже работает,
 * а что запланировано, — чтобы ни одна кнопка не притворялась готовой.
 */
export type FeatureStatus = 'ready' | 'planned' | 'needs-model';

export interface FeatureInfo {
  title: string;
  stage: 1 | 2 | 3 | 4 | 5;
  status: FeatureStatus;
  note: string;
}

export const FEATURES = {
  // Этап 1 — готово
  navigation: { title: 'Навигация и экраны', stage: 1, status: 'ready', note: 'Главный экран, разделы, жест «назад».' },
  theme: { title: 'Светлая и тёмная тема', stage: 1, status: 'ready', note: 'Автоматически по устройству или вручную.' },
  projects: { title: 'Локальные проекты', stage: 1, status: 'ready', note: 'Файлы — на диске устройства (OPFS), без загрузки целиком в память; если диск недоступен — в IndexedDB частями по 8 МБ.' },
  transfer: { title: 'Перенос проекта на другое устройство', stage: 4, status: 'ready', note: 'Файл .zip со всеми исходниками: «Мои проекты» → ⇪, на другом устройстве — «Импорт».' },
  videoImport: { title: 'Импорт и просмотр видео', stage: 1, status: 'ready', note: 'Воспроизведение, перемотка по шкале.' },
  photoImport: { title: 'Импорт фото', stage: 1, status: 'ready', note: 'Фото открывается и сохраняется в проект.' },
  photoPreview: { title: 'Фильтры, коррекция, поворот', stage: 1, status: 'ready', note: '23 фильтра в 6 группах, яркость, контраст, насыщенность, температура.' },

  // Этап 2 — фото
  photoCrop: { title: 'Обрезка фото', stage: 2, status: 'ready', note: 'Рамка с жестами и пропорциями 1:1, 4:5, 9:16, 16:9.' },
  photoText: { title: 'Текст на фото', stage: 2, status: 'ready', note: 'Три шрифта, цвет, тень или плашка; размер ползунком, кнопками или двумя пальцами, поворот.' },
  photoExport: { title: 'Сохранение фото', stage: 2, status: 'ready', note: 'Полное разрешение (на iPhone до 16,7 Мп — ограничение Safari), «Поделиться → Сохранить изображение».' },

  // Этап 3 — видео
  videoTrim: { title: 'Обрезка и разделение клипов', stage: 3, status: 'ready', note: 'Ручки обрезки на шкале, разрез по плейхеду, склейка обратно.' },
  videoClips: { title: 'Несколько клипов и перемещение', stage: 3, status: 'ready', note: 'Добавление видео, перетаскивание клипа пальцем, кнопки «Влево/Вправо».' },
  videoMusic: { title: 'Музыка и громкость', stage: 3, status: 'ready', note: 'Музыка из «Файлов» или звук из любого видео, громкость 0–200 %, смещение, плавные появление и затухание.' },
  videoEffects: { title: 'Скорость, фильтры, формат кадра', stage: 3, status: 'ready', note: 'Скорость 0,25–4×, 23 фильтра для клипов, кадр 9:16, 1:1, 4:5, 16:9 с размытым фоном.' },
  videoTransitions: { title: 'Переходы между клипами', stage: 3, status: 'ready', note: 'Растворение, через чёрный, вспышка, сдвиг, вверх, шторка, наезд, круг — одинаково в предпросмотре и экспорте.' },
  videoText: { title: 'Текст в видео', stage: 3, status: 'ready', note: 'Титры со временем появления, перетаскивание по кадру.' },
  videoUndo: { title: 'Отмена и повтор', stage: 3, status: 'ready', note: 'До 80 шагов в пределах сеанса.' },

  // Этап 4 — экспорт
  videoExport: { title: 'Экспорт видео', stage: 4, status: 'ready', note: 'MP4 (H.264 + AAC) на устройстве, до 4K, с прогрессом и отменой.' },

  // Этап 5 — ИИ
  aiBgRemove: { title: 'Удаление фона', stage: 5, status: 'ready', note: 'Модель ISNet на устройстве (56 МБ, скачивается один раз), работает офлайн.' },
  aiBgReplace: { title: 'Замена фона', stage: 5, status: 'ready', note: 'Прозрачный фон (PNG), цвет, размытие или своё фото.' },
  aiEnhance: { title: 'Улучшение качества', stage: 5, status: 'needs-model', note: 'Нужна модель апскейла или API.' },
  aiCaptions: { title: 'Автосубтитры', stage: 5, status: 'ready', note: 'Whisper на устройстве: быстрая модель 77 МБ или точная 249 МБ; русский, английский и автоопределение.' },
  aiSmartEdit: { title: 'Умный монтаж', stage: 5, status: 'needs-model', note: 'Нужны распознавание речи и языковая модель по API.' },
} satisfies Record<string, FeatureInfo>;

export type FeatureId = keyof typeof FEATURES;

export const APP_VERSION = '0.8.0';
export const APP_STAGE = 5;
