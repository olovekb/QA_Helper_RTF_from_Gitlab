import { useState, useEffect } from 'react';

const SCROLL_THRESHOLD = 200;

/**
 * Возвращает true, когда контент длинный (есть прокрутка) и пользователь прокрутил вниз.
 * Используется для условного отображения кнопки «Вверх».
 */
export function useShowScrollTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const check = () => {
      const scrollable = document.documentElement.scrollHeight > window.innerHeight;
      const scrolled = window.scrollY > SCROLL_THRESHOLD;
      setShow(scrollable && scrolled);
    };

    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  return show;
}
