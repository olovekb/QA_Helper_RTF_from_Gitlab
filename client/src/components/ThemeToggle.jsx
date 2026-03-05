import React from 'react';
import { useTheme } from '../ThemeContext';
import './ThemeToggle.css';

export default function ThemeToggle ()
{
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      className="btn-link theme-toggle"
      onClick={ toggleTheme }
    >
      { theme === 'dark' ? '(⊙_⊙)' : '( u_u )' }
    </button>
  );
}
