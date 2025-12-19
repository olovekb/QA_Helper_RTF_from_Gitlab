import React, { useState, useEffect } from 'react';
import './BDDReviewModal.css';

const BDDReviewModal = ({ isOpen, onClose, bddResult, onRegenerate }) => {
  const [editedContent, setEditedContent] = useState('');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (bddResult && isOpen) {
      const content = bddResult.feature || bddResult.gherkin || '';
      setEditedContent(content);
      
      // Подсчитываем статистику
      if (content) {
        const lines = content.split('\n');
        const scenarios = content.match(/Scenario:/gi)?.length || 0;
        const features = content.match(/Feature:/gi)?.length || 0;
        const steps = content.match(/(Given|When|Then|And|Но|И|Дано|Когда|Тогда)/gi)?.length || 0;
        
        setStats({
          lines: lines.length,
          scenarios,
          features,
          steps
        });
      }
    }
  }, [bddResult, isOpen]);

  const handleDownload = () => {
    const content = editedContent || (bddResult?.feature || bddResult?.gherkin || '');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bdd-tests.feature';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editedContent || (bddResult?.feature || bddResult?.gherkin || ''));
    // Можно добавить уведомление об успешном копировании
  };

  if (!isOpen) return null;

  const content = editedContent || (bddResult?.feature || bddResult?.gherkin || '');
  const hasError = bddResult?.error;

  return (
    <div className="bdd-review-modal-overlay" onClick={onClose}>
      <div className="bdd-review-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bdd-review-modal-header">
          <h2>BDD Тесты (Gherkin)</h2>
          <button className="bdd-review-modal-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="bdd-review-modal-content">
          {hasError && (
            <div className="bdd-review-error">
              Ошибка генерации: {bddResult.error}
            </div>
          )}

          {stats && (
            <div className="bdd-review-stats">
              <div className="bdd-review-stat">
                <strong>Строк:</strong> {stats.lines}
              </div>
              <div className="bdd-review-stat">
                <strong>Features:</strong> {stats.features}
              </div>
              <div className="bdd-review-stat">
                <strong>Сценариев:</strong> {stats.scenarios}
              </div>
              <div className="bdd-review-stat">
                <strong>Шагов:</strong> {stats.steps}
              </div>
            </div>
          )}

          <div className="bdd-review-editor-section">
            <label className="bdd-review-label">
              Сгенерированный Gherkin
              <span className="bdd-review-hint">(можно редактировать)</span>
            </label>
            <textarea
              className="bdd-review-textarea"
              value={content}
              onChange={(e) => setEditedContent(e.target.value)}
              placeholder="Gherkin сценарии будут отображены здесь..."
              spellCheck={false}
            />
          </div>
        </div>

        <div className="bdd-review-modal-footer">
          <div>
            <button
              className="bdd-review-btn bdd-review-btn-secondary"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('BDDReviewModal: Кнопка регенерации нажата');
                console.log('BDDReviewModal: onRegenerate тип:', typeof onRegenerate);
                console.log('BDDReviewModal: onRegenerate значение:', onRegenerate);
                
                if (onRegenerate && typeof onRegenerate === 'function') {
                  console.log('BDDReviewModal: Вызываем onRegenerate');
                  onClose();
                  // Небольшая задержка, чтобы модальное окно успело закрыться
                  setTimeout(() => {
                    onRegenerate();
                  }, 200);
                } else {
                  console.warn('BDDReviewModal: onRegenerate не передана или не является функцией');
                  alert('Функция регенерации недоступна. Проверьте консоль для деталей.');
                }
              }}
              title={!onRegenerate ? 'Функция регенерации недоступна' : 'Очистить старые результаты и запустить новую генерацию'}
            >
              🔄 Регенерировать
            </button>
          </div>
          <div className="bdd-review-footer-actions">
            <button
              className="bdd-review-btn bdd-review-btn-secondary"
              onClick={handleCopy}
            >
              📋 Копировать
            </button>
            <button
              className="bdd-review-btn bdd-review-btn-primary"
              onClick={handleDownload}
            >
              💾 Скачать .feature
            </button>
            <button
              className="bdd-review-btn bdd-review-btn-secondary"
              onClick={onClose}
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BDDReviewModal;

