// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './style.css';
import config from './config.json';
import { parseXmindFile } from './parce-xmind/parce.xmind.mjs';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked'; // Импорт библиотеки marked
import { get as idbGet, set as idbSet } from 'idb-keyval';
import GlobalBackgroundProgress from './components/GlobalBackgroundProgress';
import ErrorBoundary from './components/ErrorBoundary';

function usePersistentState(key, defaultValue) {
  const [state, setState] = useState(defaultValue);
  const isFirstMount = useRef(true);

  useEffect(() => {
    idbGet(key)
      .then(stored => {
        if (stored !== undefined) {
          setState(stored);
        } else {
          idbSet(key, defaultValue).catch(console.warn);
        }
      })
      .catch(console.warn);
  }, [key]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    idbSet(key, state).catch(console.warn);
  }, [key, state]);

  return [state, setState];
}

const App = ({ projects }) => {
  const [projectId, setProjectId] = useState(config.projectId);
  const [jiraIssue, setJiraIssue] = useState(config.jiraIssue);
  const [openRouterKey, setOpenRouterKey] = usePersistentState('openRouterKey', '');
  const [loading, setLoading] = useState(false);
  const [htmlReport, setHtmlReport] = useState('');
  const [fixStatus, setFixStatus] = useState(false);
  const [activeTab, setActiveTab] = useState('analysis');
  const [xmindFile, setXmindFile] = useState(null);
  const [exportMessage, setExportMessage] = useState('');
  const [exportResult, setExportResult] = useState(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);

  const navigate = useNavigate();
  const reportContainerRef = useRef(null);

  // Функция для преобразования Markdown-текста в HTML
  const parseMarkdown = (markdownText) => {
    return marked(markdownText);
  };

  useEffect(() => {
    const savedFixStatus = sessionStorage.getItem('fixStatus');
    if (savedFixStatus) {
      setFixStatus(JSON.parse(savedFixStatus));
    }
    const savedReport = sessionStorage.getItem('htmlReport');
    if (savedReport) {
      setHtmlReport(savedReport);
    }
  }, []);

  // Делегирование кликов внутри контейнера, обработка кнопок AI-рекомендаций
  useEffect(() => {
    const container = reportContainerRef.current;
    if (!container) return;

    const handleButtonClick = async (event) => {
      const btn = event.target.closest('.ai-recommend-btn');
      if (!btn) return;
      if (btn.disabled) return;

      const originalContent = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';

      const testId = btn.getAttribute('data-test-id');
      const testCaseData = btn.getAttribute('data-test-case');
      let testCase = {};
      if (testCaseData) {
        try {
          testCase = JSON.parse(testCaseData);
        } catch (e) {
          console.error('Ошибка парсинга testCaseData:', e);
        }
      }
      const payload = {
        id: testId,
        projectId,
        ...testCase
      };

      const recParagraph = container.querySelector(`#ai-rec-text-${testId}`);

      try {
        const headers = openRouterKey ? { 'X-OpenRouter-Key': openRouterKey } : {};
        const response = await axios.post(`${config.serverUrl}/ai-recommendation`, payload, { headers });
        const recommendation = response.data.recommendation || 'Нет рекомендаций';

        if (recParagraph) {
          const htmlContent = parseMarkdown(recommendation);
          recParagraph.innerHTML = htmlContent;
        }
      } catch (error) {
        if (recParagraph) {
          recParagraph.innerText = 'Ошибка: ' + error.message;
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
      }
    };

    container.addEventListener('click', handleButtonClick);
    return () => {
      container.removeEventListener('click', handleButtonClick);
    };
  }, [htmlReport, projectId]);

  const downloadHtml = () => {
    const htmlContent = sessionStorage.getItem('htmlReport');
    const savedProjectId = sessionStorage.getItem('projectId');
    const savedJiraIssue = sessionStorage.getItem('jiraIssue');
    if (!htmlContent) {
      console.error('HTML отчет не найден в sessionStorage');
      return;
    }
    if (!savedProjectId || !savedJiraIssue) {
      console.error('Данные projectId или jiraIssue отсутствуют в sessionStorage');
      return;
    }
    const fileName = `Результат ревью тест-кейсов ${savedJiraIssue}.html`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
  };

  const toggleFixStatus = () => {
    const newFixStatus = !fixStatus;
    setFixStatus(newFixStatus);
    sessionStorage.setItem('fixStatus', JSON.stringify(newFixStatus));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setHtmlReport('');

    try {
      const response = await axios.post(`${config.serverUrl}/analyze`, {
        projectId,
        jiraIssue,
      });
      const newReport = response.data;
      setHtmlReport(newReport);
      sessionStorage.setItem('htmlReport', newReport);
      sessionStorage.setItem('projectId', projectId);
      sessionStorage.setItem('jiraIssue', jiraIssue);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleXmindFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setXmindFile(file);
    }
  };

  const handleExportClick = async () => {
    setLoading(true);
    if (!xmindFile) {
      setExportMessage('Пожалуйста, загрузите файл XMind.');
      return;
    }
    if (!projectId) {
      setExportMessage('Пожалуйста, выберите проект.');
      return;
    }
    setExportMessage('Обработка файла и экспорт данных...');
    try {
      const allureData = await parseXmindFile(xmindFile, projectId);
      const response = await axios.post(`${config.serverUrl}/export`, {
        allureData,
        projectId,
      });
      if (response.status === 200) {
        const allureLink = `https://abanking.qatools.cloud/project/${projectId}/test-cases`;
        setExportMessage('Экспорт завершён! Посмотреть результат: ');
        setExportResult(allureLink);
      } else {
        setExportMessage('Ошибка при экспорте данных.');
      }
    } catch (error) {
      console.error('Ошибка экспорта:', error);
      setExportMessage('Ошибка при обработке и экспорте файла.');
    } finally {
      setLoading(false);
    }
  };

  // Обработчик для перехода на страницу "Test impact analysis"
  const handleTIAClick = () => {
    navigate('/tia');
  };

  // Новый обработчик для перехода на страницу "Тестирование требований"
  const handleSolutionClick = () => {
    navigate('/solution');
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  const handleCleanupDuplicates = async () => {
    if (!projectId) {
      alert('Пожалуйста, выберите проект.');
      return;
    }

    setCleanupLoading(true);
    setCleanupResult(null);
    try {
      const response = await axios.post(`${config.serverUrl}/cleanup-duplicates`, {
        projectId,
      });
      setCleanupResult(response.data);
      if (response.data.success) {
        setExportMessage(`Очистка завершена. Удалено ${response.data.deleted} дублей из ${response.data.totalCases} тест-кейсов.`);
      }
    } catch (error) {
      console.error('Ошибка очистки дублей:', error);
      setCleanupResult({
        success: false,
        error: error.response?.data?.error || error.message || 'Неизвестная ошибка'
      });
    } finally {
      setCleanupLoading(false);
      // Не закрываем модалку - пользователь сам закроет после просмотра результатов
    }
  };

  return (
    <ErrorBoundary>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div className="App">
        {/* Глобальный фоновый прогресс-бар */}
        <GlobalBackgroundProgress />
      
      <div className="header-wrapper">
        <h1>QA-helper</h1>
        <div className="header-buttons">
          <button onClick={handleTIAClick} className="tia-button">
            Test impact analysis
          </button>
          <button onClick={handleSolutionClick} className="tia-button">
            Тестирование требований
          </button>
          <button onClick={() => navigate('/code-error')} className="tia-button">
            Завести набор ошибок кода на эпик
          </button>
        </div>
      </div>
      
      <div className="tabs">
        <button onClick={() => handleTabChange('analysis')} className={activeTab === 'analysis' ? 'active' : ''}>
          Анализ тестов
        </button>
        <button onClick={() => handleTabChange('export')} className={activeTab === 'export' ? 'active' : ''}>
          Экспорт Xmind в Allure
        </button>
      </div>
      {activeTab === 'analysis' && (
        <div style={{
          maxWidth: '800px',
          margin: '0 auto',
          padding: '40px 20px'
        }}>
          <form onSubmit={handleSubmit} style={{
            backgroundColor: '#ffffff',
            padding: '32px',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            marginBottom: '32px'
          }}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}>
                Выберите проект:
              </label>
              <select 
                value={projectId} 
                onChange={(e) => setProjectId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '15px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  color: '#1f2937',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  outline: 'none'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              >
                <option value="">Выберите проект</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}>
                Номер задачи из Jira:
              </label>
              <input 
                type="text" 
                value={jiraIssue} 
                onChange={(e) => setJiraIssue(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '15px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  color: '#1f2937',
                  outline: 'none',
                  transition: 'all 0.2s',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            <div style={{ marginBottom: '32px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}>
                OpenRouter API Key 
                <span style={{ 
                  cursor: 'help', 
                  marginLeft: '5px',
                  color: '#6b7280'
                }} title="Оставьте пустым для использования API-ключа по умолчанию">ⓘ</span>:
              </label>
              <input 
                type="password" 
                value={openRouterKey} 
                onChange={(e) => setOpenRouterKey(e.target.value.trim())} 
                placeholder="sk-or-..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '15px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  color: '#1f2937',
                  outline: 'none',
                  transition: 'all 0.2s',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            <button 
              type="submit" 
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px 24px',
                fontSize: '16px',
                fontWeight: '600',
                color: '#ffffff',
                backgroundColor: loading ? '#9ca3af' : '#3b82f6',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: loading ? 'none' : '0 2px 4px rgba(59, 130, 246, 0.3)'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.target.style.backgroundColor = '#2563eb';
                  e.target.style.boxShadow = '0 4px 8px rgba(59, 130, 246, 0.4)';
                  e.target.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.target.style.backgroundColor = '#3b82f6';
                  e.target.style.boxShadow = '0 2px 4px rgba(59, 130, 246, 0.3)';
                  e.target.style.transform = 'translateY(0)';
                }
              }}
            >
              {loading ? 'Анализ запущен...' : 'Запустить анализ'}
            </button>
          </form>
          {htmlReport && !loading && (
            <div style={{ marginBottom: '32px', textAlign: 'center' }}>
              <button 
                onClick={downloadHtml} 
                style={{
                  padding: '12px 24px',
                  fontSize: '15px',
                  fontWeight: '500',
                  color: '#ffffff',
                  backgroundColor: '#10b981',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#059669';
                  e.target.style.boxShadow = '0 4px 8px rgba(16, 185, 129, 0.4)';
                  e.target.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#10b981';
                  e.target.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
                  e.target.style.transform = 'translateY(0)';
                }}
              >
                Скачать отчёт
              </button>
            </div>
          )}
          <div ref={reportContainerRef} style={{
            backgroundColor: '#ffffff',
            padding: '32px',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            minHeight: '200px'
          }}>
            {loading ? (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '60px 20px'
              }}>
                <div className="spinner"></div>
              </div>
            ) : htmlReport ? (
              <div dangerouslySetInnerHTML={{ __html: htmlReport }} />
            ) : (
              <p style={{
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '16px',
                padding: '40px 20px'
              }}>
                Не найдено тест-кейсов для анализа
              </p>
            )}
          </div>
        </div>
      )}
      {activeTab === 'export' && (
        <div style={{
          maxWidth: '800px',
          margin: '0 auto',
          padding: '40px 20px'
        }}>
          <h2 style={{
            fontSize: '28px',
            fontWeight: '600',
            color: '#ffffff',
            marginBottom: '32px',
            textAlign: 'center'
          }}>
            Экспорт XMind в Allure
          </h2>
          <div style={{
            backgroundColor: '#ffffff',
            padding: '32px',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            marginBottom: '24px'
          }}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}>
                Выберите проект:
              </label>
              <select 
                value={projectId} 
                onChange={(e) => setProjectId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '15px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  color: '#1f2937',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              >
                <option value="">Выберите проект</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: '32px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}>
                Загрузить XMind файл:
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap'
              }}>
                <label style={{
                  padding: '12px 24px',
                  fontSize: '15px',
                  fontWeight: '500',
                  color: '#ffffff',
                  backgroundColor: '#3b82f6',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)',
                  display: 'inline-block'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#2563eb';
                  e.target.style.boxShadow = '0 4px 8px rgba(59, 130, 246, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#3b82f6';
                  e.target.style.boxShadow = '0 2px 4px rgba(59, 130, 246, 0.3)';
                }}
                >
                  Выберите файл
                  <input 
                    type="file" 
                    accept=".xmind" 
                    onChange={handleXmindFileChange}
                    style={{ display: 'none' }}
                  />
                </label>
                <span style={{
                  fontSize: '14px',
                  color: xmindFile ? '#10b981' : '#6b7280',
                  fontWeight: xmindFile ? '500' : '400'
                }}>
                  {xmindFile ? xmindFile.name : 'Файл не выбран'}
                </span>
              </div>
            </div>
            <button 
              onClick={handleExportClick} 
              disabled={loading || !xmindFile}
              style={{
                width: '100%',
                padding: '14px 24px',
                fontSize: '16px',
                fontWeight: '600',
                color: '#ffffff',
                backgroundColor: (loading || !xmindFile) ? '#9ca3af' : '#10b981',
                border: 'none',
                borderRadius: '8px',
                cursor: (loading || !xmindFile) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: (loading || !xmindFile) ? 'none' : '0 2px 4px rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px'
              }}
              onMouseEnter={(e) => {
                if (!loading && xmindFile) {
                  e.target.style.backgroundColor = '#059669';
                  e.target.style.boxShadow = '0 4px 8px rgba(16, 185, 129, 0.4)';
                  e.target.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading && xmindFile) {
                  e.target.style.backgroundColor = '#10b981';
                  e.target.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
                  e.target.style.transform = 'translateY(0)';
                }
              }}
            >
              {loading ? (
                <>
                  <div className="spinner" style={{
                    width: '18px',
                    height: '18px',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTop: '2px solid white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                  }}></div>
                  Экспорт...
                </>
              ) : (
                'Экспорт'
              )}
            </button>
          </div>
          
          {exportMessage && (
            <div style={{
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '16px 20px',
              marginBottom: '24px'
            }}>
              <p style={{
                margin: 0,
                fontSize: '15px',
                color: '#1e40af',
                lineHeight: '1.5'
              }}>
                {exportMessage}
              </p>
            </div>
          )}
          
          {exportResult && (
            <div style={{
              textAlign: 'center',
              marginBottom: '24px'
            }}>
              <a 
                href={exportResult} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '12px 24px',
                  fontSize: '15px',
                  fontWeight: '500',
                  color: '#ffffff',
                  backgroundColor: '#10b981',
                  textDecoration: 'none',
                  borderRadius: '8px',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#059669';
                  e.target.style.boxShadow = '0 4px 8px rgba(16, 185, 129, 0.4)';
                  e.target.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#10b981';
                  e.target.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
                  e.target.style.transform = 'translateY(0)';
                }}
              >
                Открыть проект в Allure
              </a>
            </div>
          )}
          
          <div style={{
            textAlign: 'center',
            marginTop: '32px'
          }}>
            <button 
              onClick={() => setShowCleanupModal(true)} 
              disabled={loading || !projectId}
              style={{
                padding: '12px 24px',
                fontSize: '15px',
                fontWeight: '500',
                color: '#ffffff',
                backgroundColor: (loading || !projectId) ? '#9ca3af' : '#dc3545',
                border: 'none',
                borderRadius: '8px',
                cursor: (loading || !projectId) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: (loading || !projectId) ? 'none' : '0 2px 4px rgba(220, 53, 69, 0.3)'
              }}
              onMouseEnter={(e) => {
                if (!loading && projectId) {
                  e.target.style.backgroundColor = '#c82333';
                  e.target.style.boxShadow = '0 4px 8px rgba(220, 53, 69, 0.4)';
                  e.target.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading && projectId) {
                  e.target.style.backgroundColor = '#dc3545';
                  e.target.style.boxShadow = '0 2px 4px rgba(220, 53, 69, 0.3)';
                  e.target.style.transform = 'translateY(0)';
                }
              }}
            >
              Очистить дубли тест-кейсов
            </button>
          </div>
        </div>
      )}
      {showCleanupModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(2px)'
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '16px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            position: 'relative'
          }}>
            <h2 style={{ 
              marginTop: 0, 
              marginBottom: '28px',
              fontSize: '26px',
              fontWeight: '600',
              color: '#1a1a1a',
              letterSpacing: '-0.5px'
            }}>
              Подтверждение очистки дублей
            </h2>
            
            {!cleanupResult && (
              <>
                <p style={{ 
                  marginBottom: '16px', 
                  fontSize: '15px',
                  color: '#4a4a4a',
                  lineHeight: '1.5'
                }}>
                  Вы уверены, что хотите удалить дубли тест-кейсов в проекте <strong style={{ color: '#1a1a1a' }}>
                    {projects.find(p => String(p.id) === String(projectId))?.name || projectId}
                  </strong>?
                </p>
                <div style={{ 
                  marginBottom: '24px', 
                  padding: '18px',
                  backgroundColor: '#fff8e1',
                  border: '1px solid #ffc107',
                  borderRadius: '8px',
                  borderLeft: '4px solid #ff9800'
                }}>
                  <p style={{ 
                    margin: 0, 
                    color: '#856404', 
                    fontWeight: '500',
                    fontSize: '14px',
                    lineHeight: '1.6'
                  }}>
                    Внимание: Будут удалены тест-кейсы с одинаковыми названиями и тегами, оставлены будут только самые полные по содержанию.
                  </p>
                </div>
                <div style={{
                  marginBottom: '32px',
                  padding: '14px 18px',
                  backgroundColor: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '8px'
                }}>
                  <p style={{ 
                    margin: 0, 
                    fontSize: '14px', 
                    color: '#c53030',
                    fontWeight: '500'
                  }}>
                    Это действие нельзя отменить
                  </p>
                </div>
              </>
            )}

            {cleanupLoading && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                gap: '16px'
              }}>
                <div className="spinner" style={{
                  width: '48px',
                  height: '48px',
                  border: '4px solid #f3f3f3',
                  borderTop: '4px solid #dc3545',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                <p style={{
                  margin: 0,
                  color: '#666',
                  fontSize: '15px',
                  fontWeight: '500'
                }}>
                  Выполняется очистка дублей...
                </p>
                <p style={{
                  margin: 0,
                  color: '#999',
                  fontSize: '13px'
                }}>
                  Пожалуйста, подождите
                </p>
              </div>
            )}

            {cleanupResult && !cleanupLoading && (
              <div style={{ 
                marginBottom: '24px'
              }}>
                {cleanupResult.success ? (
                  <div>
                    <div style={{
                      marginBottom: '20px',
                      paddingBottom: '16px',
                      borderBottom: '1px solid #e0e0e0'
                    }}>
                      <h3 style={{
                        margin: 0,
                        fontSize: '18px',
                        fontWeight: '600',
                        color: '#1a1a1a'
                      }}>
                        Очистка завершена
                      </h3>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px'
                    }}>
                      <div style={{
                        padding: '16px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '8px',
                        border: '1px solid #e9ecef'
                      }}>
                        <div style={{ 
                          fontSize: '13px', 
                          color: '#6c757d', 
                          marginBottom: '8px',
                          fontWeight: '500'
                        }}>
                          Всего тест-кейсов
                        </div>
                        <div style={{ 
                          fontSize: '28px', 
                          fontWeight: '700', 
                          color: '#212529',
                          lineHeight: '1.2'
                        }}>
                          {cleanupResult.totalCases}
                        </div>
                      </div>
                      <div style={{
                        padding: '16px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '8px',
                        border: '1px solid #e9ecef'
                      }}>
                        <div style={{ 
                          fontSize: '13px', 
                          color: '#6c757d', 
                          marginBottom: '8px',
                          fontWeight: '500'
                        }}>
                          Групп дублей
                        </div>
                        <div style={{ 
                          fontSize: '28px', 
                          fontWeight: '700', 
                          color: '#212529',
                          lineHeight: '1.2'
                        }}>
                          {cleanupResult.duplicatesFound}
                        </div>
                      </div>
                      <div style={{
                        padding: '16px',
                        backgroundColor: '#fff5f5',
                        borderRadius: '8px',
                        border: '1px solid #fed7d7'
                      }}>
                        <div style={{ 
                          fontSize: '13px', 
                          color: '#6c757d', 
                          marginBottom: '8px',
                          fontWeight: '500'
                        }}>
                          Удалено дублей
                        </div>
                        <div style={{ 
                          fontSize: '28px', 
                          fontWeight: '700', 
                          color: '#c53030',
                          lineHeight: '1.2'
                        }}>
                          {cleanupResult.deleted}
                        </div>
                      </div>
                      <div style={{
                        padding: '16px',
                        backgroundColor: '#f0fff4',
                        borderRadius: '8px',
                        border: '1px solid #c6f6d5'
                      }}>
                        <div style={{ 
                          fontSize: '13px', 
                          color: '#6c757d', 
                          marginBottom: '8px',
                          fontWeight: '500'
                        }}>
                          Оставлено
                        </div>
                        <div style={{ 
                          fontSize: '28px', 
                          fontWeight: '700', 
                          color: '#22543d',
                          lineHeight: '1.2'
                        }}>
                          {cleanupResult.kept}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    padding: '20px',
                    backgroundColor: '#fff5f5',
                    border: '1px solid #fed7d7',
                    borderRadius: '8px'
                  }}>
                    <h3 style={{
                      margin: '0 0 12px 0',
                      fontSize: '18px',
                      fontWeight: '600',
                      color: '#c53030'
                    }}>
                      Ошибка
                    </h3>
                    <p style={{ 
                      margin: 0, 
                      fontSize: '14px',
                      color: '#742a2a',
                      lineHeight: '1.5'
                    }}>
                      {cleanupResult.error || 'Неизвестная ошибка'}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div style={{ 
              display: 'flex', 
              gap: '12px', 
              justifyContent: 'flex-end',
              marginTop: '32px',
              paddingTop: '24px',
              borderTop: '1px solid #e9ecef'
            }}>
              <button
                onClick={() => {
                  setShowCleanupModal(false);
                  setCleanupResult(null);
                }}
                disabled={cleanupLoading}
                style={{
                  minWidth: '120px',
                  padding: '12px 24px',
                  backgroundColor: cleanupLoading ? '#e9ecef' : '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: cleanupLoading ? 'not-allowed' : 'pointer',
                  fontSize: '15px',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                  opacity: cleanupLoading ? 0.6 : 1,
                  boxShadow: cleanupLoading ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
                }}
                onMouseEnter={(e) => {
                  if (!cleanupLoading && !cleanupResult) {
                    e.target.style.backgroundColor = '#5a6268';
                    e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!cleanupLoading) {
                    e.target.style.backgroundColor = cleanupResult ? '#6c757d' : '#6c757d';
                    e.target.style.boxShadow = cleanupResult ? '0 2px 4px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.1)';
                  }
                }}
              >
                {cleanupResult ? 'Закрыть' : 'Отмена'}
              </button>
              {!cleanupResult && (
                <button
                  onClick={handleCleanupDuplicates}
                  disabled={cleanupLoading}
                  style={{
                    minWidth: '180px',
                    padding: '12px 24px',
                    backgroundColor: cleanupLoading ? '#c82333' : '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: cleanupLoading ? 'not-allowed' : 'pointer',
                    fontSize: '15px',
                    fontWeight: '500',
                    transition: 'all 0.2s ease',
                    opacity: cleanupLoading ? 0.7 : 1,
                    boxShadow: cleanupLoading ? 'none' : '0 2px 4px rgba(220,53,69,0.3)'
                  }}
                  onMouseEnter={(e) => {
                    if (!cleanupLoading) {
                      e.target.style.backgroundColor = '#c82333';
                      e.target.style.boxShadow = '0 4px 8px rgba(220,53,69,0.4)';
                      e.target.style.transform = 'translateY(-1px)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!cleanupLoading) {
                      e.target.style.backgroundColor = '#dc3545';
                      e.target.style.boxShadow = '0 2px 4px rgba(220,53,69,0.3)';
                      e.target.style.transform = 'translateY(0)';
                    }
                  }}
                >
                  {cleanupLoading ? 'Очистка...' : 'Подтвердить удаление'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
};

export default App;
