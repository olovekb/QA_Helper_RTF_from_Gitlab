import React, { createContext, useContext, useState, useEffect } from 'react';

const THEME_STORAGE_KEY = 'app-theme';

const ThemeContext = createContext({
  theme: 'dark',
  setTheme: () => { },
});

export function ThemeProvider ({ children })
{
  const [theme, setThemeState] = useState(() =>
  {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;

    const prefersDark =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() =>
  {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (newTheme) =>
  {
    if (newTheme === 'light' || newTheme === 'dark') {
      setThemeState(newTheme);
    }
  };

  const toggleTheme = () =>
  {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={ { theme, setTheme, toggleTheme } }>
      { children }
    </ThemeContext.Provider>
  );
}

export function useTheme ()
{
  const ctx = useContext(ThemeContext);

  return ctx;
}
