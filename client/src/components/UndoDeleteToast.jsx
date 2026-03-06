/* eslint-disable no-undef */
import React, { useEffect, useRef } from 'react';
import './UndoDeleteToast.css';

/**
 * Тост отмены удаления задачи
 * @param visible - показывать тост
 * @param taskName - название задачи для отображения на тосте
 * @param onRestore - колбэк при нажатии "Восстановить"
 * @param onDismiss - колбэк при закрытии (авто или по таймеру)
 * @param duration - время отображения в мс
 */
export default function UndoDeleteToast({ visible, taskName, onRestore, onDismiss, duration = 5000 }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!visible || duration <= 0) return;
    timerRef.current = setTimeout(() => {
      onDismiss?.();
      timerRef.current = null;
    }, duration);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  return (
    <div className="undo-delete-toast" role="alert">
      <span className="undo-delete-toast__message">
        Задача "{ taskName || 'Без темы' }" удалена
      </span>
      <button
        type="button"
        className="undo-delete-toast__restore"
        onClick={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          onRestore?.();
        }}
      >
        Восстановить
      </button>
    </div>
  );
}
