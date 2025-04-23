import React, { useState, useRef } from 'react';
import axios from 'axios';
import config from './config.json';
import './SolutionPage.css';
import { marked } from 'marked';
import 'github-markdown-css/github-markdown-dark.css';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const SolutionPage = () => {
  const [solutionText, setSolutionText] = useState('');
  const [confluencePageId, setConfluencePageId] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [contextText, setContextText] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [jiraProject, setJiraProject] = useState('');
  const [jiraPat, setJiraPat] = useState('');
  const [epicLink, setEpicLink] = useState('');
  const [jiraCreateResult, setJiraCreateResult] = useState(null);
  const [jiraLoading, setJiraLoading] = useState(false);

  const analyzeButtonRef = useRef(null);

  const stripCodeFences = (text) => {
    let md = text.trim();
    if (md.startsWith('```')) {
      md = md.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trim();
    }
    return md;
  };

  const handleAnalyzeSolution = async () => {
    setLoading(true);
    setAnalysisResult(null);

    const payload = {
      context: contextText || undefined,
      project: undefined,
      useDeepseek: true,
      mode: 'text',
    };

    if (confluencePageId.trim()) {
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
      }
    } catch (err) {
      console.error('Ошибка анализа:', err);
      setAnalysisResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = () => {
    if (!analysisResult) return;
    let report = 'AI рекомендации по требованиям\n\n';
    report += analysisResult.ai?.response || 'Рекомендации отсутствуют.';
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_recommendations_${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRetry = () => {
    setAnalysisResult(null);
    analyzeButtonRef.current?.focus();
  };

  const parseDocumentationErrors = (response) => {
    if (!response) return [];
    const blocks = response.split('```').filter((_, i) => i % 2 === 1);
    return blocks.map(block => {
      const lines = block.trim().split('\n');
      const requirement = lines[0].replace(/^###\s*/, '').trim();
      const errorSection = lines.slice(1).join('\n');
      const topicMatch = errorSection.match(/- \*\*Тема\*\*: (.+?) в части «(.+?)»/);
      const descriptionMatch = errorSection.match(/- \*\*Описание\*\*: (.+)/);
      const propertiesMatch = errorSection.match(/- \*\*Нарушены свойства\*\*: (.+)/);
      const actualMatch = errorSection.match(/- \*\*Фактический результат\*\*: (.+)/);
      const expectedMatch = errorSection.match(/- \*\*Ожидаемый результат\*\*: (.+)/);

      return {
        requirement,
        topic: topicMatch ? topicMatch[1] : '',
        problemPart: topicMatch ? topicMatch[2] : '',
        description: descriptionMatch ? descriptionMatch[1] : '',
        properties: propertiesMatch ? propertiesMatch[1] : '',
        actual: actualMatch ? actualMatch[1] : '',
        expected: expectedMatch ? expectedMatch[1] : '',
      };
    }).filter(err => err.topic && err.description);
  };

  const validateInputs = () => {
    if (!jiraProject || !jiraPat || !epicLink) {
      return 'Пожалуйста, заполните все поля: Project Key, PAT и Epic Link.';
    }
    if (!/^[A-Z0-9]+(-[0-9]+)?$/.test(epicLink)) {
      return 'Epic Link должен быть в формате ABC-123.';
    }
    return null;
  };

  const handleCreateJiraIssues = async () => {
    const validationError = validateInputs();
    if (validationError) {
      alert(validationError);
      return;
    }

    setJiraLoading(true);
    setJiraCreateResult(null);

    const errors = parseDocumentationErrors(analysisResult.ai?.response);
    if (errors.length === 0) {
      setJiraCreateResult({ error: 'Нет ошибок документации для создания задач.' });
      setJiraLoading(false);
      return;
    }

    const results = [];

    for (const err of errors) {
      const summary = `${err.topic} в части "${err.problemPart}"`;
      const description =
        `h3. Требование\n${err.requirement}\n\n` +
        `h3. Описание проблемы\n${err.description}\n\n` +
        `h3. Нарушены свойства\n${err.properties}\n\n` +
        `h3. Фактический результат\n${err.actual}\n\n` +
        `h3. Ожидаемый результат\n${err.expected}`;

      const payload = {
        fields: {
          project: { key: jiraProject },
          summary,
          description,
          issuetype: { id: "12812" },
          customfield_13169: { id: "12683" },
          customfield_10101: epicLink,
          customfield_14306: description 
        }
      };

      try {
        const response = await axios.post(`${config.serverUrl}/jira/create-issue`, {
          pat: jiraPat,
          payload
        }, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8' // Явно указываем кодировку UTF-8
          }
        });
        results.push({ success: true, key: response.data.key, summary });
      } catch (e) {
        results.push({ success: false, summary, error: e.response?.data?.error || e.message });
      }
    }

    setJiraCreateResult({ results });
    setJiraLoading(false);
  };


  
  const canAnalyze = (solutionText.trim() || confluencePageId.trim()) && !loading;
  const isUsingManualText = !!solutionText.trim();
  const isUsingPageId = !!confluencePageId.trim();

  return (
    <div className="solution-page">
      <h1>Тестирование требований (alpha)</h1>

      <div className="field">
        <label>Контекст (необязательно):</label>
        <textarea
          placeholder="Дополнительный контекст для анализа..."
          value={contextText}
          onChange={e => setContextText(e.target.value)}
          rows={3}
        />
      </div>

      <div className="field">
        <label>Confluence Page ID:</label>
        <input
          type="text"
          placeholder="Например: 133465419"
          value={confluencePageId}
          onChange={e => setConfluencePageId(e.target.value)}
          disabled={isUsingManualText}
        />
      </div>

      <div className="field">
        <label>Маркер доступа Confluence (PAT):</label>
        <input
          type="password"
          placeholder="Ваш Confluence PAT"
          value={bearerToken}
          onChange={e => setBearerToken(e.target.value)}
          disabled={isUsingManualText}
        />
      </div>

      <div className="field">
        <label>Текст требований (приоритет ввода):</label>
        <textarea
          placeholder="Вставьте текст требований..."
          value={solutionText}
          onChange={e => setSolutionText(e.target.value)}
          rows={10}
          disabled={isUsingPageId}
        />
      </div>

      <div className="buttons">
        <button
          ref={analyzeButtonRef}
          onClick={handleAnalyzeSolution}
          disabled={!canAnalyze}
        >
          {loading ? 'Анализируется...' : 'Запустить AI-анализ'}
        </button>

        {analysisResult && !analysisResult.error && (
          <>
            <button onClick={handleDownloadReport}>
              Скачать AI-рекомендации (TXT)
            </button>
            <button onClick={() => setModalOpen(true)}>
              Создать задачи в Jira
            </button>
          </>
        )}
      </div>

      {modalOpen && (
        <div className="modal">
          <div className="modal-content">
            <h2>Создание задач в Jira</h2>

            <div className="field">
              <label>Jira Project Key:</label>
              <input
                type="text"
                placeholder="Например: JMT"
                value={jiraProject}
                onChange={e => setJiraProject(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Jira PAT:</label>
              <input
                type="password"
                placeholder="Ваш Jira PAT"
                value={jiraPat}
                onChange={e => setJiraPat(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Epic Link (ключ эпика):</label>
              <input
                type="text"
                placeholder="Например: JMT-123"
                value={epicLink}
                onChange={e => setEpicLink(e.target.value)}
              />
            </div>

            <div className="buttons">
              <button onClick={handleCreateJiraIssues} disabled={jiraLoading}>
                {jiraLoading ? 'Создание...' : 'Создать задачи'}
              </button>
              <button onClick={() => setModalOpen(false)} disabled={jiraLoading}>
                Закрыть
              </button>
            </div>

            {jiraCreateResult && (
              <div className="jira-result">
                <h3>Результат создания задач</h3>
                {jiraCreateResult.error && <p className="error">{jiraCreateResult.error}</p>}
                {jiraCreateResult.results && (
                  <ul>
                    {jiraCreateResult.results.map((res, i) => (
                      <li key={i}>
                        {res.success ? (
                          <span>
                            ✅ <a href={`https://jira.abanking.ru/browse/${res.key}`} target="_blank" rel="noreferrer">{res.key}</a>: {res.summary}
                          </span>
                        ) : (
                          <span>❌ {res.summary}: {res.error}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {analysisResult && (
        <div className="analysis-result">
          <h2>AI-рекомендации</h2>

          {analysisResult.error && (
            <>
              <p className="error">
                {analysisResult.error === 'AI не вернул результат, попробуйте ещё раз.'
                  ? 'AI вернул пустой ответ. Нажмите «Запустить AI-анализ» ещё раз.'
                  : `Ошибка: ${analysisResult.error}`}
              </p>
              {analysisResult.error === 'AI не вернул результат, попробуйте ещё раз.' && (
                <button onClick={handleRetry}>Попробовать снова</button>
              )}
            </>
          )}

          {!analysisResult.error && analysisResult.ai?.response && (
            <section className="ai-recommendation markdown-body">
              <div
                dangerouslySetInnerHTML={{
                  __html: marked.parse(stripCodeFences(analysisResult.ai.response))
                }}
              />
            </section>
          )}

          {!analysisResult.error && !analysisResult.ai?.response && (
            <p>Рекомендации AI не получены.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default SolutionPage;
