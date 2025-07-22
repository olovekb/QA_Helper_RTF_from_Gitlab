// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './style.css';
import config from './config.json';
import { parseXmindFile } from './parce.xmind.mjs';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked'; // Импорт библиотеки marked

const App = ({ projects }) => {
  const [projectId, setProjectId] = useState(config.projectId);
  const [jiraIssue, setJiraIssue] = useState(config.jiraIssue);
  const [loading, setLoading] = useState(false);
  const [htmlReport, setHtmlReport] = useState('');
  const [fixStatus, setFixStatus] = useState(false);
  const [activeTab, setActiveTab] = useState('analysis');
  const [xmindFile, setXmindFile] = useState(null);
  const [exportMessage, setExportMessage] = useState('');
  const [exportResult, setExportResult] = useState(null);

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
        const response = await axios.post(`${config.serverUrl}/ai-recommendation`, payload);
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
      const allureData = await parseXmindFile(xmindFile);
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

  return (
    <div className="App">
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
        <div>
          <form onSubmit={handleSubmit}>
            <div>
              <label>
                Выберите проект:
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Выберите проект</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <label>
                Номер задачи из Jira:
                <input type="text" value={jiraIssue} onChange={(e) => setJiraIssue(e.target.value)} />
              </label>
            </div>
            <button type="submit" disabled={loading}>
              {loading ? 'Анализ запущен' : 'Запустить анализ'}
            </button>
          </form>
          {htmlReport && !loading && (
            <button onClick={downloadHtml} className="download-btn">
              Скачать отчёт
            </button>
          )}
          <div ref={reportContainerRef}>
            {loading ? (
              <div className="spinner"></div>
            ) : htmlReport ? (
              <div dangerouslySetInnerHTML={{ __html: htmlReport }} />
            ) : (
              <p>Не найдено тест-кейсов для анализа</p>
            )}
          </div>
        </div>
      )}
      {activeTab === 'export' && (
        <div>
          <h2>Экспорт XMind в Allure</h2>
          <div className="form-group">
            <label>
              Выберите проект:
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Выберите проект</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-group">
            <label>
              Загрузить XMind файл:
              <input type="file" accept=".xmind" onChange={handleXmindFileChange} />
            </label>
          </div>
          <button onClick={handleExportClick} disabled={loading || !xmindFile}>
            <div>
              {loading ? <div className="spinner"></div> : <p>Экспорт</p>}
            </div>
          </button>
          {exportMessage && <p className="export-message">{exportMessage}</p>}
          {exportResult && (
            <div className="export-link">
              <a href={exportResult} target="_blank" rel="noopener noreferrer">
                Открыть проект в Allure
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
