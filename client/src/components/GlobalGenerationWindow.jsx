import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import axios from 'axios';
import config from '../config.json';
import TestModelGeneratorModal from './test-model/TestModelGeneratorModal';
import TestModelReviewModal from './test-model/TestModelReviewModal';
import BDDReviewModal from './bdd/BDDReviewModal';

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
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideInUp {
    from {
      transform: translateX(-50%) translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateX(-50%) translateY(0);
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

const GlobalGenerationWindow = ({ 
  projects,
  buildRequirementsPayload,
  prepareRequirements,
  inputMode,
  solutionText,
  confluencePageId,
  bearerToken,
  glossary,
  glossaryPageId,
  contextText,
  contextPageIds,
  contextInstruction,
  tasks,
  // Состояния генерации
  generationTaskId,
  setGenerationTaskId,
  generationProgress,
  setGenerationProgress,
  generationStatus,
  setGenerationStatus,
  isGenerationMinimized,
  setIsGenerationMinimized,
  generatedCases,
  setGeneratedCases,
  checkGenerationStatus,
  handleGenerateModel,
  // Состояния генерации тестовой модели
  modelGenerationTaskId,
  setModelGenerationTaskId,
  modelGenerationProgress,
  setModelGenerationProgress,
  modelGenerationStatus,
  setModelGenerationStatus,
  modelIsMinimized,
  setModelIsMinimized,
  checkModelGenerationStatus,
  generatedModel,
  cancelGeneration,
  jiraProject,
  allureProject,
  jiraPat,
  reviewModalOpen,
  setReviewModalOpen,
  onClearTestCases,
  onClearTestModel,
  clearReviewState,
  // BDD генерация
  handleGenerateBDD,
  bddTaskId,
  bddProgress,
  bddStatus,
  bddReviewModalOpen,
  setBddReviewModalOpen,
  bddResult,
  onRegenerateBDD
}) => {
  const location = useLocation();
  
  // Локальное состояние для модальных окон

  // Состояние для тестовой модели
  const [isGenModalOpen, setIsGenModalOpen] = useState(false);

  // Обработчик для открытия модального окна из GlobalBackgroundProgress
  useEffect(() => {
    const handleOpenModal = () => {
      setIsGenModalOpen(true);
    };

    window.addEventListener('openGenerationModal', handleOpenModal);
    return () => {
      window.removeEventListener('openGenerationModal', handleOpenModal);
    };
  }, []);


  // Автоматически возобновляем проверку статуса, если есть активная генерация
  useEffect(() => {
    if (generationTaskId && generationStatus === 'processing') {
      checkGenerationStatus(generationTaskId);
    }
  }, [generationTaskId, generationStatus, checkGenerationStatus]);

  // Автоматически возобновляем проверку статуса генерации тестовой модели
  useEffect(() => {
    if (modelGenerationTaskId && modelGenerationStatus === 'processing') {
      checkModelGenerationStatus(modelGenerationTaskId);
    }
  }, [modelGenerationTaskId, modelGenerationStatus, checkModelGenerationStatus]);

  // Обработчик генерации тест-кейсов
  const handleGenerateCases = async (modelStructure, includeBackendTests = true) => {
    console.log('GlobalGenerationWindow: получена структура тестовой модели для генерации тест-кейсов:', modelStructure);
    console.log('GlobalGenerationWindow: количество features в структуре:', modelStructure?.length);
    console.log('GlobalGenerationWindow: includeBackendTests:', includeBackendTests);
    
    if (window.Notification && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    try {
      // Собираем payload с требованиями
      const payload = {
        modelStructure,
        includeBackendTests: includeBackendTests !== false, // По умолчанию true, если не передан
        ...buildRequirementsPayload({ includeRequirements: true }),
        ...(allureProject?.id ? { projectId: allureProject.id } : {})  // ✅ Добавляем projectId для shared steps
      };
      
      console.log('GlobalGenerationWindow: отправляем payload с modelStructure:', payload);
      console.log('GlobalGenerationWindow: includeBackendTests в payload:', payload.includeBackendTests);

      const { data } = await axios.post(
        `${config.serverUrl}/generate-test-cases-async`,
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );
      
      // Очищаем предыдущие результаты при новой генерации
      if (typeof clearReviewState === 'function') {
        clearReviewState();
      }
      setGeneratedCases([]);
      localStorage.removeItem('generatedTestCases');
      
      setGenerationTaskId(data.taskId);
      setGenerationProgress(0);
      setGenerationStatus('processing');
      checkGenerationStatus(data.taskId);
    } catch (error) {
      console.error('Ошибка генерации тест-кейсов:', error);
      alert('Ошибка генерации тест-кейсов: ' + (error.response?.data?.error || error.message));
    }
  };

  // Обработчик открытия модального окна тестовой модели
  const handleOpenModelModal = () => {
    setIsGenModalOpen(true);
  };

  // Обработчик закрытия модального окна тестовой модели
  const handleCloseModelModal = () => {
    setIsGenModalOpen(false);
  };

  // Функция для подсчета тест-кейсов из сохраненного состояния или из generatedCases
  const getTestCasesCount = () => {
    if (!allureProject?.id) return generatedCases?.length || 0;
    
    // Пытаемся получить сохраненное состояние из localStorage
    try {
      // Ищем все ключи, начинающиеся с testCasesReview_${projectId}_
      const projectId = allureProject.id;
      const prefix = `testCasesReview_${projectId}_`;
      
      // Проходим по всем ключам localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const saved = localStorage.getItem(key);
          if (saved) {
            const savedState = JSON.parse(saved);
            if (savedState.treeData && Object.keys(savedState.treeData).length > 0) {
              // Подсчитываем количество тест-кейсов в treeData
              let count = 0;
              const countCases = (nodeData) => {
                if (nodeData.cases && Array.isArray(nodeData.cases)) {
                  count += nodeData.cases.length;
                }
                if (nodeData.stories) {
                  Object.values(nodeData.stories).forEach(story => {
                    if (story.cases && Array.isArray(story.cases)) {
                      count += story.cases.length;
                    }
                    if (story.scenarios) {
                      Object.values(story.scenarios).forEach(scenario => {
                        if (scenario.cases && Array.isArray(scenario.cases)) {
                          count += scenario.cases.length;
                        }
                        if (scenario.codes) {
                          Object.values(scenario.codes).forEach(code => {
                            if (code.cases && Array.isArray(code.cases)) {
                              count += code.cases.length;
                            }
                          });
                        }
                      });
                    }
                  });
                }
              };
              
              Object.values(savedState.treeData).forEach(feature => {
                countCases(feature);
              });
              
              if (count > 0) {
                return count;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('GlobalGenerationWindow: Ошибка при подсчете из localStorage:', err);
    }
    
    // Если не нашли в localStorage, возвращаем количество из generatedCases
    return generatedCases?.length || 0;
  };

  const [testCasesCount, setTestCasesCount] = useState(() => getTestCasesCount());

  // Обновляем счетчик при изменении generatedCases или при открытии/закрытии модалки
  useEffect(() => {
    const count = getTestCasesCount();
    setTestCasesCount(count);
  }, [generatedCases, reviewModalOpen, allureProject?.id]);

  // Обработчик открытия модального окна просмотра тест-кейсов
  const handleOpenReviewModal = () => {
    setReviewModalOpen(true);
    // Обновляем счетчик при открытии модалки
    setTimeout(() => {
      const count = getTestCasesCount();
      setTestCasesCount(count);
    }, 100);
  };

  // Обработчик закрытия модального окна просмотра тест-кейсов
  const handleCloseReviewModal = () => {
    setReviewModalOpen(false);
    // Обновляем счетчик при закрытии модалки
    setTimeout(() => {
      const count = getTestCasesCount();
      setTestCasesCount(count);
    }, 100);
  };

  // Определяем, есть ли активная генерация или сохраненные результаты
  const hasActiveGeneration = generationStatus === 'processing' || modelGenerationStatus === 'processing' || bddStatus === 'processing';
  const hasCompletedGeneration = generationStatus === 'completed' || modelGenerationStatus === 'completed' || bddStatus === 'completed';
  const hasAnyGeneration = hasActiveGeneration || hasCompletedGeneration;

  return (
    <>
      {/* Кнопка для открытия окна генерации */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button 
            onClick={handleOpenModelModal}
            className="btn btn-secondary" 
            disabled={hasActiveGeneration}
            style={{ 
              backgroundColor: hasAnyGeneration ? '#238636' : '',
              borderColor: hasAnyGeneration ? '#2ea043' : '',
              color: hasAnyGeneration ? 'white' : '',
              cursor: hasActiveGeneration ? 'not-allowed' : 'pointer',
              opacity: hasActiveGeneration ? 0.6 : 1
            }}
          >
            {hasActiveGeneration 
              ? '🔄 Генерация...' 
              : hasCompletedGeneration
              ? '✅ Окно генерации тест кейсов и тестовой модели'
              : '🧱 Окно генерации тест кейсов и тестовой модели'
            }
          </button>
          
          {/* Кнопка очистки тестовой модели */}
          {modelGenerationStatus === 'completed' && generatedModel && (
            <button 
              onClick={onClearTestModel}
              className="btn btn-secondary"
              style={{ 
                backgroundColor: '#da3633',
                borderColor: '#f85149',
                color: 'white'
              }}
              title="Удалить сгенерированную тестовую модель"
            >
              🗑️ Очистить модель
            </button>
          )}
          
          {/* Кнопка генерации BDD тестов - независимо от тестовой модели */}
          {handleGenerateBDD && (
            <button 
              onClick={() => {
                // Если есть готовые результаты - открываем превью, иначе запускаем генерацию
                if (bddStatus === 'completed' && bddResult) {
                  console.log('BDD: Открываем превью существующих результатов');
                  setBddReviewModalOpen(true);
                } else {
                  console.log('BDD: Запуск генерации BDD тестов');
                  handleGenerateBDD();
                }
              }}
              className="btn btn-secondary"
              disabled={hasActiveGeneration && bddStatus !== 'completed'}
              style={{ 
                backgroundColor: bddStatus === 'completed' ? '#238636' : bddStatus === 'processing' ? '#58a6ff' : '#a371f7',
                borderColor: bddStatus === 'completed' ? '#2ea043' : bddStatus === 'processing' ? '#58a6ff' : '#a371f7',
                color: 'white',
                cursor: (hasActiveGeneration && bddStatus !== 'completed') ? 'not-allowed' : 'pointer',
                opacity: (hasActiveGeneration && bddStatus !== 'completed') ? 0.6 : 1,
                fontWeight: 500,
                minWidth: '180px'
              }}
              title={bddStatus === 'completed' ? 'Открыть превью BDD тестов' : 'Создать BDD тесты (Gherkin) с дедупликацией шагов из требований'}
            >
              {bddStatus === 'processing' 
                ? `🔄 BDD генерация... ${bddProgress || 0}%`
                : bddStatus === 'completed'
                ? '✅ BDD тесты созданы'
                : '📝 Создать BDD тесты'
              }
            </button>
          )}
        </div>
        
        {/* Прогресс-бар для BDD генерации */}
        {bddStatus === 'processing' && (
          <div style={{ 
            marginBottom: 16,
            padding: 16, 
            backgroundColor: 'rgba(13, 17, 23, 0.95)', 
            border: '1px solid #30363d',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 12,
                  height: 12,
                  backgroundColor: '#58a6ff',
                  borderRadius: '50%',
                  animation: 'pulse 1.5s infinite'
                }} />
                <h4 style={{ margin: 0, color: '#c9d1d9', fontSize: 14, fontWeight: 600 }}>Генерация BDD тестов</h4>
              </div>
              <span style={{ fontSize: 14, fontWeight: 'bold', color: '#58a6ff' }}>{bddProgress}%</span>
            </div>
            <div style={{ 
              width: '100%', 
              height: 8, 
              backgroundColor: '#21262d', 
              borderRadius: 4,
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${bddProgress}%`, 
                height: '100%', 
                backgroundColor: '#58a6ff',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        )}

      {/* Прогресс-бар для генерации тест-кейсов */}
      {(generationStatus === 'processing' && !isGenerationMinimized) && (
        <div style={{ 
          ...(location.pathname === '/solution' 
            ? { 
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100% - 40px)',
                maxWidth: 600,
                zIndex: 1000,
                marginBottom: 0
              } 
            : { 
                marginBottom: 16
              }
          ),
          padding: 20, 
          backgroundColor: 'rgba(13, 17, 23, 0.95)', 
          border: '1px solid #30363d',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)',
          animation: location.pathname === '/solution' ? 'slideInUp 0.3s ease-out' : 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 12,
                height: 12,
                backgroundColor: '#58a6ff',
                borderRadius: '50%',
                animation: 'pulse 1.5s infinite'
              }} />
              <h4 style={{ margin: 0, color: '#c9d1d9', fontSize: 16, fontWeight: 600 }}>Генерация тест-кейсов</h4>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button 
                onClick={() => setIsGenerationMinimized(true)}
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
                Свернуть
              </button>
              <span style={{ fontSize: 14, fontWeight: 'bold', color: '#58a6ff' }}>{generationProgress}%</span>
            </div>
          </div>
          
          <div style={{ 
            fontSize: 14, 
            color: '#8b949e', 
            lineHeight: 1.5,
            marginBottom: 16
          }}>
            Генерация выполняется в фоновом режиме. Вы можете продолжить работу. 
            Результат будет сохранен автоматически.
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ 
              width: '100%', 
              height: 8, 
              backgroundColor: '#21262d', 
              borderRadius: 4, 
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div style={{ 
                width: `${generationProgress}%`, 
                height: '100%', 
                backgroundColor: '#58a6ff', 
                transition: 'width 0.5s ease',
                borderRadius: 4,
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

      {/* Фоновое уведомление для генерации тест-кейсов */}
      {isGenerationMinimized && generationStatus === 'processing' && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 1001,
          backgroundColor: 'rgba(13, 17, 23, 0.95)',
          border: '1px solid #30363d',
          borderRadius: 12,
          padding: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)',
          minWidth: 320,
          maxWidth: 400,
          animation: 'slideInRight 0.3s ease-out'
        }}>
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
            <span style={{ fontSize: 12, fontWeight: 'bold', color: '#58a6ff' }}>{generationProgress}%</span>
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
                width: `${generationProgress}%`, 
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
              onClick={() => setIsGenerationMinimized(false)}
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
      )}

      {/* Кнопки для работы с готовыми тест-кейсами */}
      {hasCompletedGeneration && (generatedCases.length > 0 || testCasesCount > 0) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginLeft: 8 }}>
          <button 
            onClick={handleOpenReviewModal}
            className="btn btn-primary"
          >
            📋 Просмотреть тест-кейсы ({testCasesCount})
          </button>
          <button 
            onClick={onClearTestCases}
            className="btn btn-secondary"
            style={{ 
              backgroundColor: '#da3633',
              borderColor: '#f85149',
              color: 'white'
            }}
            title="Удалить все сгенерированные тест-кейсы"
          >
            🗑️ Очистить тест-кейсы
          </button>
        </div>
      )}

      {/* Модальные окна */}
      <TestModelGeneratorModal
        isOpen={isGenModalOpen}
        onClose={handleCloseModelModal}
        onGenerate={handleGenerateCases}
        projects={projects}
        buildRequirementsPayload={buildRequirementsPayload}
        prepareRequirements={prepareRequirements}
        inputMode={inputMode}
        solutionText={solutionText}
        confluencePageId={confluencePageId}
        bearerToken={bearerToken}
        glossary={glossary}
        glossaryPageId={glossaryPageId}
        contextText={contextText}
        contextPageIds={contextPageIds}
        contextInstruction={contextInstruction}
        tasks={tasks}
        // Состояния генерации тестовой модели
        modelGenerationTaskId={modelGenerationTaskId}
        setModelGenerationTaskId={setModelGenerationTaskId}
        modelGenerationProgress={modelGenerationProgress}
        setModelGenerationProgress={setModelGenerationProgress}
        modelGenerationStatus={modelGenerationStatus}
        setModelGenerationStatus={setModelGenerationStatus}
        modelIsMinimized={modelIsMinimized}
        setModelIsMinimized={setModelIsMinimized}
        checkModelGenerationStatus={checkModelGenerationStatus}
        generatedModel={generatedModel}
        cancelGeneration={cancelGeneration}
        jiraProject={jiraProject}
      />

      {reviewModalOpen && console.log('GlobalGenerationWindow: passing to TestModelReviewModal:', {
        generatedCases,
        generatedCasesLength: generatedCases?.length,
        projectId: allureProject?.id,
        allureProject,
        reviewModalOpen
      })}
      <TestModelReviewModal
        isOpen={reviewModalOpen}
        onClose={handleCloseReviewModal}
        initialCases={generatedCases}
        projectId={allureProject?.id}
        jiraProject={jiraProject}
        jiraPat={jiraPat}
        onCasesCountChange={(count) => {
          setTestCasesCount(count);
        }}
      />

      {/* BDD Review Modal */}
      <BDDReviewModal
        isOpen={bddReviewModalOpen}
        onClose={() => setBddReviewModalOpen(false)}
        bddResult={bddResult}
        onRegenerate={onRegenerateBDD || handleGenerateBDD}
      />
    </>
  );
};

export default GlobalGenerationWindow;
