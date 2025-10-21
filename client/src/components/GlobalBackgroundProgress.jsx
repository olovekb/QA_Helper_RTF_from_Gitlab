import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { get as idbGet } from 'idb-keyval';

// CSS для анимаций
const animationStyles = `
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @keyframes slideInLeft {
    from {
      transform: translateX(-100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;

// Инжектим стили в head
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = animationStyles;
  document.head.appendChild(styleSheet);
}

const GlobalBackgroundProgress = () => {
  const navigate = useNavigate();
  
  const [testCaseGeneration, setTestCaseGeneration] = useState({
    status: null,
    progress: 0,
    taskId: null,
    isMinimized: false
  });
  
  const [testModelGeneration, setTestModelGeneration] = useState({
    status: null,
    progress: 0,
    taskId: null,
    isMinimized: false
  });

  // Загружаем состояние при инициализации
  useEffect(() => {
    const loadState = async () => {
      try {
        // Загружаем состояние генерации тест-кейсов
        const [taskId, progress, status, isMinimized] = await Promise.all([
          idbGet('generationTaskId').catch(() => null),
          idbGet('generationProgress').catch(() => 0),
          idbGet('generationStatus').catch(() => null),
          idbGet('isGenerationMinimized').catch(() => false)
        ]);

        if (taskId && status === 'processing') {
          setTestCaseGeneration({ taskId, progress, status, isMinimized });
        }

        // Загружаем состояние генерации тестовой модели
        const [modelTaskId, modelProgress, modelStatus, modelIsMinimized] = await Promise.all([
          idbGet('modelGenerationTaskId').catch(() => null),
          idbGet('modelGenerationProgress').catch(() => 0),
          idbGet('modelGenerationStatus').catch(() => null),
          idbGet('modelIsMinimized').catch(() => false)
        ]);

        if (modelTaskId && modelStatus === 'processing') {
          setTestModelGeneration({ taskId: modelTaskId, progress: modelProgress, status: modelStatus, isMinimized: modelIsMinimized });
        }
      } catch (error) {
        console.warn('Ошибка загрузки состояния генерации:', error);
      }
    };

    loadState();

    // Слушаем изменения в IndexedDB
    const handleStorageChange = () => {
      loadState();
    };

    // Добавляем слушатель для обновлений состояния
    window.addEventListener('generationStateChanged', handleStorageChange);
    
    return () => {
      window.removeEventListener('generationStateChanged', handleStorageChange);
    };
  }, []);

  // Слушаем обновления от SolutionPage
  useEffect(() => {
    const handleTestCaseUpdate = (event) => {
      setTestCaseGeneration(event.detail);
    };

    const handleTestModelUpdate = (event) => {
      setTestModelGeneration(event.detail);
    };

    window.addEventListener('updateTestCaseGeneration', handleTestCaseUpdate);
    window.addEventListener('updateTestModelGeneration', handleTestModelUpdate);
    
    return () => {
      window.removeEventListener('updateTestCaseGeneration', handleTestCaseUpdate);
      window.removeEventListener('updateTestModelGeneration', handleTestModelUpdate);
    };
  }, []);

  // Функция для обновления состояния генерации тест-кейсов
  const updateTestCaseGeneration = (newState) => {
    setTestCaseGeneration(prev => ({ ...prev, ...newState }));
    // Уведомляем другие компоненты об изменении
    window.dispatchEvent(new CustomEvent('generationStateChanged'));
  };

  // Функция для обновления состояния генерации тестовой модели
  const updateTestModelGeneration = (newState) => {
    setTestModelGeneration(prev => ({ ...prev, ...newState }));
    // Уведомляем другие компоненты об изменении
    window.dispatchEvent(new CustomEvent('generationStateChanged'));
  };

  // Экспортируем функции для использования в других компонентах
  useEffect(() => {
    window.updateTestCaseGeneration = updateTestCaseGeneration;
    window.updateTestModelGeneration = updateTestModelGeneration;
    
    return () => {
      delete window.updateTestCaseGeneration;
      delete window.updateTestModelGeneration;
    };
  }, []);

  const hasActiveGeneration = testCaseGeneration.status === 'processing' || testModelGeneration.status === 'processing';
  const hasMinimizedGeneration = (testCaseGeneration.status === 'processing' && testCaseGeneration.isMinimized) || 
                                (testModelGeneration.status === 'processing' && testModelGeneration.isMinimized);

  // Скрываем прогресс-бар в UI, но оставляем всю логику
  return null;

  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      left: '20px',
      zIndex: 1001,
      backgroundColor: 'rgba(13, 17, 23, 0.95)',
      border: '1px solid #30363d',
      borderRadius: 12,
      padding: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      backdropFilter: 'blur(10px)',
      minWidth: 320,
      maxWidth: 400,
      animation: 'slideInLeft 0.3s ease-out'
    }}>
      {/* Генерация тест-кейсов */}
      {testCaseGeneration.status === 'processing' && testCaseGeneration.isMinimized && (
        <div style={{ marginBottom: testModelGeneration.status === 'processing' ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8,
                height: 8,
                backgroundColor: '#58a6ff',
                borderRadius: '50%',
                animation: 'pulse 1.5s infinite'
              }} />
              <h4 style={{ margin: 0, color: '#c9d1d9', fontSize: 14, fontWeight: 600 }}>Генерация тест-кейсов</h4>
            </div>
            <span style={{ fontSize: 12, fontWeight: 'bold', color: '#58a6ff' }}>{testCaseGeneration.progress}%</span>
          </div>
          
          <div style={{ marginBottom: 12 }}>
            <div style={{ 
              width: '100%', 
              height: 6, 
              backgroundColor: '#21262d', 
              borderRadius: 3, 
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div style={{ 
                width: `${testCaseGeneration.progress}%`, 
                height: '100%', 
                backgroundColor: '#58a6ff', 
                transition: 'width 0.5s ease',
                borderRadius: 3,
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                  animation: 'shimmer 2s infinite'
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Генерация тестовой модели */}
      {testModelGeneration.status === 'processing' && testModelGeneration.isMinimized && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8,
                height: 8,
                backgroundColor: '#3fb950',
                borderRadius: '50%',
                animation: 'pulse 1.5s infinite'
              }} />
              <h4 style={{ margin: 0, color: '#c9d1d9', fontSize: 14, fontWeight: 600 }}>Генерация тестовой модели</h4>
            </div>
            <span style={{ fontSize: 12, fontWeight: 'bold', color: '#3fb950' }}>{testModelGeneration.progress}%</span>
          </div>
          
          <div style={{ marginBottom: 12 }}>
            <div style={{ 
              width: '100%', 
              height: 6, 
              backgroundColor: '#21262d', 
              borderRadius: 3, 
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div style={{ 
                width: `${testModelGeneration.progress}%`, 
                height: '100%', 
                backgroundColor: '#3fb950', 
                transition: 'width 0.5s ease',
                borderRadius: 3,
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                  animation: 'shimmer 2s infinite'
                }} />
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div style={{ 
        fontSize: 12, 
        color: '#8b949e',
        marginBottom: 12,
        lineHeight: 1.4
      }}>
        Выполняется в фоновом режиме
      </div>
      
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button 
          onClick={() => {
            // Отменяем процесс
            if (testCaseGeneration.status === 'processing' && testCaseGeneration.taskId && window.cancelGeneration) {
              window.cancelGeneration(testCaseGeneration.taskId, 'test_cases');
            }
            if (testModelGeneration.status === 'processing' && testModelGeneration.taskId && window.cancelGeneration) {
              window.cancelGeneration(testModelGeneration.taskId, 'test_model');
            }
          }}
          style={{
            background: 'none',
            border: '1px solid #f85149',
            color: '#f85149',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.target.style.borderColor = '#ff6b6b';
            e.target.style.color = '#ff6b6b';
          }}
          onMouseLeave={(e) => {
            e.target.style.borderColor = '#f85149';
            e.target.style.color = '#f85149';
          }}
        >
          Отменить
        </button>
        <button 
          onClick={() => {
            // Сохраняем информацию о том, что нужно открыть модальное окно
            localStorage.setItem('openGenerationModal', 'true');
            // Переходим на SolutionPage
            navigate('/solution');
          }}
          style={{
            background: 'none',
            border: '1px solid #30363d',
            color: '#8b949e',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.target.style.borderColor = '#58a6ff';
            e.target.style.color = '#58a6ff';
          }}
          onMouseLeave={(e) => {
            e.target.style.borderColor = '#30363d';
            e.target.style.color = '#8b949e';
          }}
        >
          Открыть
        </button>
      </div>
    </div>
  );
};

export default GlobalBackgroundProgress;
