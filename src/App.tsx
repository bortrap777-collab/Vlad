import { NavProvider, useNav, type Route } from './app/nav';
import { ThemeProvider } from './app/theme';
import { UiProvider } from './components/ui';
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
      return <PhotoEditorScreen projectId={r.projectId} />;
    case 'ai':
      return <AiToolsScreen />;
    case 'projects':
      return <ProjectsScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

function Screens() {
  const { route, depth, direction } = useNav();
  // Ключ по глубине стека: после импорта (replace) экран не пересоздаётся.
  return (
    <main className={`stage nav-${direction}`} key={`${depth}-${route.name}`}>
      {renderRoute(route)}
    </main>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <NavProvider>
        <UiProvider>
          <Screens />
        </UiProvider>
      </NavProvider>
    </ThemeProvider>
  );
}
