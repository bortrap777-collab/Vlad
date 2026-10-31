/**
 * Журнал ошибок на устройстве: последние 15 записей в localStorage.
 * Нужен, чтобы пользователь мог скопировать точный текст ошибки и прислать разработчику.
 */
import { APP_VERSION } from './features';

export interface ErrorRecord {
  at: number;
  where: string;
  message: string;
  stack?: string;
}

const KEY = 'ws.errorLog';
const LIMIT = 15;

export function readErrors(): ErrorRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as ErrorRecord[];
  } catch {
    return [];
  }
}

export function logError(where: string, err: unknown): void {
  const e = err as { message?: string; stack?: string; name?: string } | undefined;
  const message = String(e?.message ?? err ?? 'неизвестная ошибка').slice(0, 500);
  // Отменённые действия и обрывы сети — не ошибки приложения
  if (e?.name === 'AbortError' || /The user aborted|cancelled/i.test(message)) return;
  const rec: ErrorRecord = { at: Date.now(), where, message, stack: e?.stack?.split('\n').slice(0, 6).join('\n') };
  try {
    const list = [rec, ...readErrors()].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* приватный режим */
  }
}

export function clearErrors(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ничего */
  }
}

/** Текст отчёта: версия, устройство, последние ошибки */
export function errorReport(list = readErrors()): string {
  const lines = [`Ws ${APP_VERSION}`, navigator.userAgent, ''];
  for (const r of list) {
    lines.push(`${new Date(r.at).toLocaleString('ru-RU')} · ${r.where}`, r.message);
    if (r.stack) lines.push(r.stack);
    lines.push('');
  }
  return lines.join('\n');
}

let installed = false;
export function installGlobalErrorLog(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => logError('страница', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => logError('фоновая операция', e.reason));
}
