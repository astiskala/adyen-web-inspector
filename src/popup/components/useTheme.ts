import { useLayoutEffect, useState } from 'preact/hooks';

const THEME_KEY = 'inspector-theme';

export type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  const value = globalThis.localStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

/**
Applies the saved theme; open extension views follow changes from the popup.
*/
export function useTheme(): { readonly theme: Theme; readonly setTheme: (value: Theme) => void } {
  const [theme, update] = useState(readTheme);
  useLayoutEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useLayoutEffect(() => {
    function sync(event: StorageEvent): void {
      if (event.key === THEME_KEY) update(readTheme());
    }
    globalThis.addEventListener('storage', sync);
    return (): void => {
      globalThis.removeEventListener('storage', sync);
    };
  }, []);

  function setTheme(value: Theme): void {
    globalThis.localStorage.setItem(THEME_KEY, value);
    update(value);
  }

  return { theme, setTheme };
}
