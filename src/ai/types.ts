/**
 * Архитектура ИИ-инструментов.
 *
 * Каждый инструмент работает через «провайдера» — подключаемый модуль,
 * который реально выполняет обработку. Провайдер может работать:
 *  - on-device: модель в браузере (WebGPU/WASM, например ONNX Runtime Web, MediaPipe);
 *  - server: собственный сервер с GPU;
 *  - api: внешний API по ключу.
 *
 * Пока ни один провайдер не зарегистрирован, инструмент честно показывает
 * статус «не подключено» и не выполняет никаких действий.
 */
export type AiToolId = 'bg-remove' | 'bg-replace' | 'object-select' | 'object-erase' | 'enhance' | 'captions' | 'smart-edit';
export type ProviderKind = 'on-device' | 'server' | 'api';

export interface AiProgress {
  /** 0…1, null — длительность неизвестна */
  value: number | null;
  label: string;
}

export interface AiProvider<I = unknown, O = unknown> {
  id: string;
  tool: AiToolId;
  kind: ProviderKind;
  title: string;
  /** Проверка: модель скачана / сервер доступен / ключ задан */
  isAvailable(): Promise<boolean>;
  run(input: I, onProgress: (p: AiProgress) => void, signal: AbortSignal): Promise<O>;
}

export interface AiToolSpec {
  id: AiToolId;
  title: string;
  description: string;
  icon: string;
  media: 'photo' | 'video';
  requirements: { kind: ProviderKind; title: string; detail: string }[];
}
