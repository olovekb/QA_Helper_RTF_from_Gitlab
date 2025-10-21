// Утилита для обработки ошибок ResizeObserver
export const suppressResizeObserverErrors = () => {
  // Перехватываем ошибки ResizeObserver на уровне window
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args[0];
    if (typeof message === 'string' && message.includes('ResizeObserver loop completed with undelivered notifications')) {
      // Подавляем ResizeObserver ошибки
      console.warn('ResizeObserver error suppressed:', message);
      return;
    }
    // Вызываем оригинальный console.error для остальных ошибок
    originalConsoleError.apply(console, args);
  };

  // Перехватываем ошибки на уровне window
  window.addEventListener('error', (event) => {
    if (event.message && event.message.includes('ResizeObserver loop completed with undelivered notifications')) {
      event.preventDefault();
      event.stopPropagation();
      console.warn('ResizeObserver error suppressed:', event.message);
      return false;
    }
  });

  // Перехватываем необработанные отклонения промисов
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message && event.reason.message.includes('ResizeObserver loop completed with undelivered notifications')) {
      event.preventDefault();
      console.warn('ResizeObserver promise rejection suppressed:', event.reason.message);
      return false;
    }
  });
};

// Функция для проверки, является ли ошибка ResizeObserver
export const isResizeObserverError = (error) => {
  if (!error) return false;
  
  const message = error.message || error.toString();
  return message.includes('ResizeObserver loop completed with undelivered notifications');
};

// Функция для безопасного логирования ошибок
export const safeLogError = (error, context = '') => {
  if (isResizeObserverError(error)) {
    console.warn(`ResizeObserver error suppressed${context ? ` in ${context}` : ''}:`, error.message);
    return;
  }
  
  console.error(`Error${context ? ` in ${context}` : ''}:`, error);
};
