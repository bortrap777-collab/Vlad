import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Навигация стеком экранов (как в нативных приложениях).
 * Синхронизирована с историей браузера: системный жест «назад»
 * в Safari/Chrome и кнопка «назад» на Android закрывают экран.
 */
export type Route =
  | { name: 'home' }
  | { name: 'video'; projectId?: string }
  | { name: 'photo'; projectId?: string; tool?: string }
  | { name: 'ai' }
  | { name: 'projects' }
  | { name: 'settings' };

interface NavCtx {
  route: Route;
  depth: number;
  direction: 'forward' | 'back' | 'none';
  push: (r: Route) => void;
  replace: (r: Route) => void;
  back: () => void;
  home: () => void;
}

const Ctx = createContext<NavCtx | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [direction, setDirection] = useState<NavCtx['direction']>('none');
  const stackRef = useRef(stack);
  stackRef.current = stack;
  // false, если браузер (например, песочница iframe) запретил History API.
  const historyOk = useRef(false);

  useEffect(() => {
    try {
      history.replaceState({ wsDepth: 0 }, '');
      historyOk.current = true;
    } catch {
      historyOk.current = false;
    }
    const onPop = (e: PopStateEvent) => {
      const depth = typeof e.state?.wsDepth === 'number' ? e.state.wsDepth : 0;
      setStack((s) => (depth < s.length - 1 ? s.slice(0, depth + 1) : s));
      setDirection('back');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const push = useCallback((r: Route) => {
    const depth = stackRef.current.length;
    setStack((s) => [...s, r]);
    setDirection('forward');
    if (historyOk.current) {
      try {
        history.pushState({ wsDepth: depth }, '');
      } catch {
        historyOk.current = false;
      }
    }
  }, []);

  const replace = useCallback((r: Route) => {
    setStack((s) => [...s.slice(0, -1), r]);
    setDirection('none');
  }, []);

  const back = useCallback(() => {
    if (stackRef.current.length <= 1) return;
    if (historyOk.current) {
      history.back();
    } else {
      setStack((s) => s.slice(0, -1));
      setDirection('back');
    }
  }, []);

  const home = useCallback(() => {
    const n = stackRef.current.length - 1;
    if (n <= 0) return;
    if (historyOk.current) {
      history.go(-n);
    } else {
      setStack((s) => s.slice(0, 1));
      setDirection('back');
    }
  }, []);

  const value = useMemo<NavCtx>(
    () => ({ route: stack[stack.length - 1], depth: stack.length - 1, direction, push, replace, back, home }),
    [stack, direction, push, replace, back, home],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav(): NavCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNav вне NavProvider');
  return v;
}
