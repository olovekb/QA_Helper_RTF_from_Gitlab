import React, { useState, useCallback } from 'react';
import axios from 'axios';
import { marked } from 'marked';
import 'github-markdown-css/github-markdown-dark.css';
import config from './config.json';
import './SolutionPage.css'; // Убедитесь, что используете новый CSS



marked.setOptions({
  gfm: true,
  breaks: true,
});

// Компонент для одной карточки задачи
const TaskCard = ({ task, index, onUpdate, onDelete, onToggleSelect }) => {
  const handleChange = (field, value) => {
    onUpdate(index, { ...task, [field]: value });
  };

  return (
    <div className={`task-card ${task.isNew ? 'new-task' : ''}`}>
      <div className="task-header">
        <input
          type="checkbox"
          checked={task.selected}
          onChange={e => onToggleSelect(index, e.target.checked)}
        />
        <textarea
          type="text"
          className="task-summary-input"
          value={task.summary}
          placeholder="Заголовок задачи (Тема)"
          onChange={e => handleChange('summary', e.target.value)}
        />
        <button onClick={() => onDelete(index)} className="delete-task-btn">❌</button>
      </div>
      <div className="task-body">
        {/* Исходное требование */}
        <textarea
          type="text"
          value={task.requirement}
          placeholder="Текст требования"
          onChange={e => handleChange('requirement', e.target.value)}
        />

        {/* Описание проблемы */}
        <textarea
          value={task.problem}
          placeholder="Описание проблемы"
          onChange={e => handleChange('problem', e.target.value)}
          rows={3}
        />

        {/* Фактический результат */}
        <textarea
          type="text"
          value={task.actual}
          placeholder="Фактический результат"
          onChange={e => handleChange('actual', e.target.value)}
        />

        {/* Ожидаемый результат */}
        <textarea
          type="text"
          value={task.expected}
          placeholder="Ожидаемый результат"
          onChange={e => handleChange('expected', e.target.value)}
        />

        {/* Нарушенные свойства */}
        <textarea
          type="text"
          value={task.properties}
          placeholder="Нарушенные свойства (через запятую)"
          onChange={e => handleChange('properties', e.target.value)}
        />
      </div>
    </div>
  );
};




const SolutionPage = () => {
  const [inputMode, setInputMode] = useState('text'); // 'text' или 'confluence'
  const [solutionText, setSolutionText] = useState('');
  const [confluencePageId, setConfluencePageId] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [contextText, setContextText] = useState('');
  const [glossary, setGlossary] = useState(''); // <-- НОВОЕ: состояние для глоссария
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [jiraProject, setJiraProject] = useState('');
  const [jiraPat, setJiraPat] = useState('');
  const [epicLink, setEpicLink] = useState('');
  const [jiraCreateResult, setJiraCreateResult] = useState(null);
  const [jiraLoading, setJiraLoading] = useState(false);

  const [tasks, setTasks] = useState([]); // <-- Единый список задач (от AI и ручных)

  // Закрыть модалку и сбросить результат Jira
  const closeModal = () => {
    setModalOpen(false);
    setJiraCreateResult(null);
  };


  const handleAnalyzeSolution = async () => {
    setLoading(true);
    setAnalysisResult(null);
    setTasks([]);

    const payload = {
      context: contextText || undefined,
      project: undefined,
      glossary: glossary || undefined, // <-- НОВОЕ: передаем глоссарий
    };

    if (inputMode === 'confluence') {
      payload.pageId = confluencePageId.trim();
      payload.bearerToken = bearerToken.trim();
    } else {
      payload.text = solutionText;
    }

    try {
      const resp = await axios.post(`${config.serverUrl}/analyze/solution`, payload);
      if (!resp.data.success) {
        setAnalysisResult({ error: resp.data.error });
      } else {
        setAnalysisResult(resp.data.data);
        // Сразу парсим результат в интерактивные задачи
        const aiTasks = parseDocumentationErrors(resp.data.data.ai?.response);
        setTasks(aiTasks);
      }
    } catch (err) {
      console.error('Ошибка анализа:', err);
      setAnalysisResult({ error: err.response?.data?.error || err.message });
    } finally {
      setLoading(false);
    }
  };

  const parseDocumentationErrors = (response) => {
    if (!response) return [];
    // У AI‐ответа берем только блоки внутри ```` ```
    const blocks = response.split('```').filter((_, i) => i % 2 === 1);

    return blocks.map(block => {
      const lines = block.trim().split('\n');
      // Первой строкой считается требование (### ...)
      const requirement = lines.find(l => l.startsWith('###'))?.replace(/^###\s*/, '').trim() || '';

      const getField = (label) => {
        const line = lines.find(l => l.includes(label));
        return line ? line.split(label)[1].trim() : '';
      };

      // Подписи в Markdown-ответе от AI
      const problem = getField('**Описание**:');
      const properties = getField('**Нарушены свойства**:');
      const actual = getField('**Фактический результат**:');
      const expected = getField('**Ожидаемый результат**:');

      // Заголовок таски
      const topic = getField('**Тема**:').split(' в части «')[0] || '';
      const part = getField('**Тема**:').split(' в части «')[1]?.replace('»', '') || '';
      const summary = `${topic} в части "${part}"`;

      return {
        summary,
        requirement,
        problem,
        properties,
        actual,
        expected,
        selected: true,
        isNew: false,  // AI‐таска
      };
    }).filter(t => t.summary);
  };


  // --- НОВЫЕ ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ ЗАДАЧАМИ ---

  const handleAddTask = () => {
    const newTask = {
      summary: '',
      requirement: '',
      problem: '',
      actual: '',
      expected: '',
      properties: '',
      selected: true,
      isNew: true,
    };
    setTasks([newTask, ...tasks]);
  };


  const handleDeleteTask = (index) => {
    setTasks(tasks.filter((_, i) => i !== index));
  };

  const handleUpdateTask = (index, updatedTask) => {
    // При редактировании полей, автоматически пересобираем description
    //  const jiraDescription = `h3. Исходное требование\n${updatedTask.requirement}\n\nh3. Описание проблемы\n${updatedTask.description || '(описание не заполнено)'}\n\nh3. Нарушены свойства\n${updatedTask.properties}\n\nh3. Фактический результат\n{quote}${updatedTask.actual || '(не заполнено)'}{quote}\n\nh3. Ожидаемый результат\n{quote}${updatedTask.expected}{quote}`;
    //  updatedTask.description = jiraDescription;

    const newTasks = [...tasks];
    newTasks[index] = updatedTask;
    setTasks(newTasks);
  };

  const handleToggleSelect = (index, selected) => {
    const newTasks = [...tasks];
    newTasks[index].selected = selected;
    setTasks(newTasks);
  };

  // 1) Обновлённый handleCreateJiraIssues
  const handleCreateJiraIssues = async () => {
    if (!jiraProject || !jiraPat || !epicLink) {
      alert('Заполните все поля: Project Key, PAT и Epic Link.');
      return;
    }
    setJiraLoading(true);
    // сбросим прошлый результат
    setJiraCreateResult(null);

    const DEFECT_TYPE_ID = '12683';
    const results = [];

    for (const task of tasks.filter(t => t.selected)) {
      const jiraDesc =
        `h3. Исходное требование\n${task.requirement}\n\n` +
        `h3. Описание проблемы\n${task.problem || '(не заполнено)'}\n\n` +
        `h3. Нарушены свойства\n${task.properties}\n\n` +
        `h3. Фактический результат\n{quote}${task.actual || '(не заполнено)'}{quote}\n\n` +
        `h3. Ожидаемый результат\n{quote}${task.expected || '(не заполнено)'}{quote}`;

      const payload = {
        fields: {
          project: { key: jiraProject },
          summary: task.summary,
          description: jiraDesc,
          issuetype: { id: "12812" },
          customfield_10101: epicLink,
          customfield_13169: { id: DEFECT_TYPE_ID },
        }
      };

      try {
        const resp = await axios.post(
          `${config.serverUrl}/jira/create-issue`,
          { pat: jiraPat, payload }
        );
        results.push({ success: true, summary: task.summary, key: resp.data.key });
      } catch (err) {
        results.push({ success: false, summary: task.summary, error: err.response?.data?.error || err.message });
      }
    }

    // Убираем из тасков все, что создалось успешно
    const createdSummaries = results.filter(r => r.success).map(r => r.summary);
    setTasks(prev => prev.filter(t => !createdSummaries.includes(t.summary)));

    // Сохраняем и успехи, и ошибки
    setJiraCreateResult(results);
    setJiraLoading(false);
  };




  const canAnalyze = (inputMode === 'text' ? solutionText.trim() : confluencePageId.trim()) && !loading;

  return (
    <div className="solution-page">
      <h1>Тестирование требований</h1>

      <div className="input-area">
        <div className="input-tabs">
          <button className={inputMode === 'text' ? 'active' : ''} onClick={() => setInputMode('text')}>Вставить текст</button>
          <button className={inputMode === 'confluence' ? 'active' : ''} onClick={() => setInputMode('confluence')}>Загрузить из Confluence</button>
        </div>

        {inputMode === 'text' ? (
          <textarea placeholder="Вставьте текст требований для анализа..." value={solutionText} onChange={e => setSolutionText(e.target.value)} rows={10} />
        ) : (
          <div className="confluence-inputs">
            <input type="text" placeholder="Confluence Page ID (напр., 133465419)" name="confluencePageId"  autoComplete="off" value={confluencePageId} onChange={e => setConfluencePageId(e.target.value)} />
            <input type="password" placeholder="Ваш Bearer токен для Confluence" name="confluenceToken" autoComplete="new-password" value={bearerToken} onChange={e => setBearerToken(e.target.value)} />
          </div>
        )}

        <textarea className="context-input" placeholder="Дополнительный контекст для анализа (необязательно)" value={contextText} onChange={e => setContextText(e.target.value)} rows={3} />
        <textarea className="context-input" placeholder="Глоссарий проекта: АС - Автоматизированная Система, ФЛ - Физическое лицо (необязательно)" value={glossary} onChange={e => setGlossary(e.target.value)} rows={3} />

        <button className="analyze-button" onClick={handleAnalyzeSolution} disabled={!canAnalyze}>
          {loading ? 'Анализируется...' : '🚀 Запустить AI-анализ'}
        </button>
      </div>

      {loading && <div className="loader">Анализ в процессе...</div>}
      {analysisResult?.error && <div className="error-message">Ошибка: {analysisResult.error}</div>}

      {tasks.length > 0 && (
        <div className="task-workspace">
          <h2>Рабочая область: Задачи для Jira</h2>
          <p>Проверьте, отредактируйте, удалите или добавьте новые задачи перед созданием в Jira.</p>
          <div className="task-controls">
            <button onClick={handleAddTask} className="add-task-btn">➕ Добавить задачу вручную</button>
            <button onClick={() => setModalOpen(true)} className="create-jira-btn">⚙️ Создать выбранные в Jira</button>
          </div>
          <div className="task-list">
            {tasks.map((task, index) => (
              <TaskCard
                key={index}
                task={task}
                index={index}
                onUpdate={handleUpdateTask}
                onDelete={handleDeleteTask}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </div>
        </div>
      )}
      {modalOpen && (
        <div className="modal" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={closeModal}>×</button>
            <h2>Настройки для создания задач в Jira</h2>

            {/* Только при первом показе (до отправки) – поля настроек */}
            {!jiraCreateResult && (
              <>
                <div className="field">
                  <label>Jira Project Key:</label>
                  <input type="text" value={jiraProject} onChange={e => setJiraProject(e.target.value)} placeholder="Например: JMT" />
                </div>
                <div className="field">
                  <label>Jira PAT:</label>
                  <input type="password" value={jiraPat} onChange={e => setJiraPat(e.target.value)} />
                </div>
                <div className="field">
                  <label>Epic Link:</label>
                  <input type="text" value={epicLink} onChange={e => setEpicLink(e.target.value)} placeholder="Например: JMT-123" />
                </div>
              </>
            )}

            {/* Результат создания – всегда после попытки */}
            {jiraCreateResult && (
              <div className="jira-result">
                <h3>Результат создания</h3>

                {/* Успешно созданные */}
                {jiraCreateResult.filter(r => r.success).length > 0 && (
                  <ul className="success-list">
                    {jiraCreateResult.filter(r => r.success).map((r, i) => (
                      <li key={i} className="success">
                        ✅ <a href={`https://jira.abanking.ru/browse/${r.key}`} target="_blank" rel="noreferrer">
                          {r.summary}: {r.key}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Ошибки, если они есть */}
                {jiraCreateResult.filter(r => !r.success).length > 0 && (
                  <ul className="error-list">
                    {jiraCreateResult.filter(r => !r.success).map((r, i) => (
                      <li key={i} className="error">
                        ❌ {r.summary}: {r.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Кнопки “Создать” + “Закрыть” */}
            {/* Показываем их, если ещё нет jiraCreateResult или есть неуспехи */}
            {(!jiraCreateResult || jiraCreateResult.some(r => !r.success)) && (
              <div className="buttons">
                <button
                  onClick={handleCreateJiraIssues}
                  disabled={jiraLoading || tasks.filter(t => t.selected).length === 0}
                >
                  {jiraLoading
                    ? 'Создание…'
                    : `Создать ${tasks.filter(t => t.selected).length} задач(и)`}
                </button>
                <button onClick={closeModal} disabled={jiraLoading}>
                  Закрыть
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default SolutionPage;