// Утилита для обработки ошибок ResizeObserver
export const suppressResizeObserverErrors = () => {
  // Подавляем ResizeObserver ошибки на самом низком уровне
  const originalError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    if (typeof message === 'string' && (
      message.includes('ResizeObserver loop completed with undelivered notifications') ||
      message.includes('ResizeObserver loop limit exceeded')
    )) {
      console.warn('ResizeObserver error suppressed (window.onerror):', message);
      return true; // Предотвращаем дальнейшую обработку ошибки
    }
    if (originalError) {
      return originalError(message, source, lineno, colno, error);
    }
    return false;
  };
  // Перехватываем ошибки ResizeObserver на уровне window
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args[0];
    if (typeof message === 'string' && (
      message.includes('ResizeObserver loop completed with undelivered notifications') ||
      message.includes('ResizeObserver loop limit exceeded')
    )) {
      // Подавляем ResizeObserver ошибки
      console.warn('ResizeObserver error suppressed:', message);
      return;
    }
    // Вызываем оригинальный console.error для остальных ошибок
    originalConsoleError.apply(console, args);
  };

  // Перехватываем ошибки на уровне window
  window.addEventListener('error', (event) => {
    if (event.message && (
      event.message.includes('ResizeObserver loop completed with undelivered notifications') ||
      event.message.includes('ResizeObserver loop limit exceeded')
    )) {
      event.preventDefault();
      event.stopPropagation();
      console.warn('ResizeObserver error suppressed:', event.message);
      return false;
    }
  });

  // Перехватываем необработанные отклонения промисов
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message && (
      event.reason.message.includes('ResizeObserver loop completed with undelivered notifications') ||
      event.reason.message.includes('ResizeObserver loop limit exceeded')
    )) {
      event.preventDefault();
      console.warn('ResizeObserver promise rejection suppressed:', event.reason.message);
      return false;
    }
  });

  // Дополнительная защита для React DevTools и других инструментов
  if (window.React && window.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
    const originalReportError = window.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactDebugCurrentFrame.getCurrentStack;
    if (originalReportError) {
      window.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactDebugCurrentFrame.getCurrentStack = function() {
        try {
          return originalReportError.apply(this, arguments);
        } catch (error) {
          if (isResizeObserverError(error)) {
            console.warn('ResizeObserver error suppressed in React internals:', error.message);
            return null;
          }
          throw error;
        }
      };
    }
  }
};

// Функция для проверки, является ли ошибка ResizeObserver
export const isResizeObserverError = (error) => {
  if (!error) return false;
  
  const message = error.message || error.toString();
  return message.includes('ResizeObserver loop completed with undelivered notifications') ||
         message.includes('ResizeObserver loop limit exceeded');
};

// Функция для безопасного логирования ошибок
export const safeLogError = (error, context = '') => {
  if (isResizeObserverError(error)) {
    console.warn(`ResizeObserver error suppressed${context ? ` in ${context}` : ''}:`, error.message);
    return;
  }
  
  console.error(`Error${context ? ` in ${context}` : ''}:`, error);
};
