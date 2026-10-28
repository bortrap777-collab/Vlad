import { useEffect, useState } from 'react';
import { NavProvider, useNav, type Route } from './app/nav';
import { ThemeProvider } from './app/theme';
import { UiProvider } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomeScreen } from './features/home/HomeScreen';
import { VideoEditorScreen } from './features/video/VideoEditorScreen';
import { PhotoEditorScreen } from './features/photo/PhotoEditorScreen';
import { AiToolsScreen } from './features/ai/AiToolsScreen';
import { ProjectsScreen } from './features/projects/ProjectsScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';

function renderRoute(r: Route) {
  switch (r.name) {
    case 'home':
      return <HomeScreen />;
    case 'video':
      return <VideoEditorScreen projectId={r.projectId} />;
    case 'photo':
      return <PhotoEditorScreen projectId={r.projectId} tool={r.tool} />;
    case 'ai':
      return <AiToolsScreen />;
    case 'projects':
      return <ProjectsScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

function Screens() {
  const { route, depth, direction, home } = useNav();
  // Ключ по глубине стека: после импорта (replace) экран не пересоздаётся.
  return (
    <main className={`stage nav-${direction}`} key={`${depth}-${route.name}`}>
      <ErrorBoundary where={route.name} onHome={home}>
        {renderRoute(route)}
      </ErrorBoundary>
    </main>
  );
}

function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('ws-update-ready', on);
    return () => window.removeEventListener('ws-update-ready', on);
  }, []);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      <span>Доступна новая версия W Studio</span>
      <button className="btn btn-primary btn-sm" onClick={() => location.reload()}>
        Обновить
      </button>
      <button className="icon-btn icon-btn-sm" aria-label="Позже" onClick={() => setReady(false)}>
        ×
      </button>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <NavProvider>
        <UiProvider>
          <UpdateBanner />
          <Screens />
        </UiProvider>
      </NavProvider>
    </ThemeProvider>
  );
}
