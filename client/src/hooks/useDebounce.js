import { useState, useEffect } from 'react';

export function useDebounce (value, delay)
{
  const [debounced, setDebounced] = useState(value);
  useEffect(() =>
  {
    const h = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return debounced;
}
