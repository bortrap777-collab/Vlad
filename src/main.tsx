import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { requestPersistence } from './lib/db';
import { installGlobalErrorLog } from './app/errors';
import { initInstall } from './app/install';
import './styles/tokens.css';
import './styles/app.css';

installGlobalErrorLog();
initInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Просим не очищать проекты автоматически (важно для Safari).
requestPersistence();

// Офлайн-режим: только при установке как приложение (не внутри iframe/превью).
const inFrame = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
if ('serviceWorker' in navigator && !inFrame && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Новая версия установлена. Перезагрузку предлагаем, а не делаем сами — чтобы не прервать монтаж или экспорт.
    if (hadController) window.dispatchEvent(new Event('ws-update-ready'));
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // Проверяем обновления, когда приложение снова открывают
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => undefined));
      })
      .catch(() => undefined);
  });
}
