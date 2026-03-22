import React, { useState, useEffect } from 'react';
import './PhraseLoader.css';

const DEFAULT_PHRASES = [
  'Обновляем зависимости...',
  'Перезапускаем пайплайн...',
  'Подключаем VPN...',
  'Валидируем сценарии...',
  'Применяем здравый смысл...',
  'Генерируем отчет...',
  'Чистим кэш и карму...',
  'This package is no longer supported...',
  'Заводим Идею...',
  'Локализуем дефекты...',
  'Перечитываем регламент...',
];

/**
 * Лоадер с фразами в цикле
 * @param phrases - массив фраз
 * @param interval - интервал смены фраз в мс
 */
const FADE_DURATION_MS = 400;

function PhraseLoader ({ phrases = DEFAULT_PHRASES, interval = 4000 })
{
  const [{ prev, curr }, setIndices] = useState({ prev: 0, curr: 0 });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const list = Array.isArray(phrases) && phrases.length > 0 ? phrases : DEFAULT_PHRASES;

  useEffect(() =>
  {
    const id = setInterval(() =>
    {
      setIndices(({ curr }) => ({ prev: curr, curr: (curr + 1) % list.length }));
      setIsTransitioning(true);
    }, interval);
    return () => clearInterval(id);
  }, [list.length, interval]);

  useEffect(() =>
  {
    if (!isTransitioning) return;
    const t = setTimeout(() =>
    {
      setIndices((s) => ({ prev: s.curr, curr: s.curr }));
      setIsTransitioning(false);
    }, FADE_DURATION_MS);
    return () => clearTimeout(t);
  }, [isTransitioning]);

  return (
    <div className="phrase-loader">
      <span className={ `phrase-loader__text phrase-loader__text--out ${isTransitioning ? 'phrase-loader__text--out-visible' : ''}` }>
        { list[prev] }
      </span>
      <span className={ `phrase-loader__text phrase-loader__text--in ${isTransitioning ? 'phrase-loader__text--in-visible' : ''}` }>
        { list[curr] }
      </span>
    </div>
  );
}

export default PhraseLoader;
export { DEFAULT_PHRASES };
