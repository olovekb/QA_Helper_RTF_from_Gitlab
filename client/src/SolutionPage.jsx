import React, { useState } from 'react';
import axios from 'axios';
import config from './config.json';
import './SolutionPage.css';
import { marked } from 'marked';

const groupIssuesByCategoryAndMessage = (issues) => {
  const result = {};
  for (const issue of issues) {
    if (!result[issue.category]) result[issue.category] = {};
    if (!result[issue.category][issue.message]) result[issue.category][issue.message] = [];
    result[issue.category][issue.message].push(issue);
  }
  return result;
};

/**
 * Функция для парсинга Markdown‑текста с рекомендациями.
 * Ожидается, что в тексте рекомендации для каждого требования начинаются строкой вида:
 * #### ТР-001. <Описание требования>
 * Далее где-то в блоке есть секция **Рекомендаций:** <текст рекомендаций>.
 */
function parseAiResponse(aiResponse) {
  const lines = aiResponse.split('\n');
  const recMap = {};
  let currentReq = null;
  lines.forEach(line => {
    // Ищем заголовок требований в формате "#### ТР-XXX. Описание..."
    const headerMatch = line.match(/^####\s*([TТ][RР]-\d+)\.\s*(.+)$/);
    if (headerMatch) {
      currentReq = headerMatch[1];
      // Сохраняем описание требования как часть пары
      recMap[currentReq] = { requirement: headerMatch[2].trim(), recommendation: '' };
    } else if (currentReq && line.indexOf('**Рекомендаций:**') !== -1) {
      // Находим рекомендацию после ключевого слова
      const parts = line.split('**Рекомендаций:**');
      if (parts[1]) {
        recMap[currentReq].recommendation = parts[1].trim();
      }
    } else if (currentReq && line.trim() && recMap[currentReq].recommendation) {
      // Если рекомендация уже началась, добавляем последующие строки
      recMap[currentReq].recommendation += ' ' + line.trim();
    }
  });
  return recMap;
}

/**
 * Функция для генерации текстового отчёта.
 * В отчёте включаются:
 *  - Статистика по анализу
 *  - Перечень найденных проблем
 *  - AI рекомендации (если имеются)
 */
function generateReportText(analysisResult) {
  let report = 'Отчёт по анализу требований\n\n';

  // Статистика
  report += 'Статистика:\n';
  report += `  Всего проблем: ${analysisResult.stats.total}\n`;
  for (const [category, count] of Object.entries(analysisResult.stats.byCategory)) {
    report += `  ${category}: ${count}\n`;
  }
  report += '\n';

  // Проблемы
  report += 'Найденные проблемы:\n';
  analysisResult.issues.forEach((issue, idx) => {
    report += `${idx + 1}. [${issue.category}] ${issue.fullRequirement}\n   -> ${issue.message}\n\n`;
  });

  // Deepseek рекомендации (если имеются)
  if (analysisResult.deepseekRecommendations && analysisResult.deepseekRecommendations.suggestions) {
    report += 'Рекомендации Deepseek:\n';
    analysisResult.deepseekRecommendations.suggestions.forEach((sugg, idx) => {
      report += `  ${idx + 1}. ${sugg}\n`;
    });
    report += '\n';
  }

  // AI рекомендации (если имеются)
  if (analysisResult.ai && analysisResult.ai.response) {
    report += 'AI рекомендации:\n';
    report += analysisResult.ai.response + '\n';
  }

  return report;
}

const SolutionPage = () => {
  const [solutionText, setSolutionText] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showIssues, setShowIssues] = useState(true);

  const handleAnalyzeSolution = async () => {
    setLoading(true);
    try {
      const payload = { text: solutionText, mode: 'text', useDeepseek: true };
      const response = await axios.post(`${config.serverUrl}/analyze/solution`, payload);
      setAnalysisResult(response.data.data);
    } catch (error) {
      console.error('Ошибка анализа:', error);
      setAnalysisResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Если есть AI-ответ в markdown, парсим его, чтобы получить пары "ТР-XXX"
  const recommendationsMap = analysisResult && analysisResult.ai && analysisResult.ai.response
    ? parseAiResponse(analysisResult.ai.response)
    : {};

  // Функция для скачивания отчёта
  const handleDownloadReport = () => {
    if (!analysisResult) return;
    const reportText = generateReportText(analysisResult);
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="solution-page">
      <h1>Тестирование требований (alpha версия в разработке)</h1>

      {/* Кнопка скачивания отчёта */}
      {analysisResult && !analysisResult.error && (
        <div className="download-report">
          <button onClick={handleDownloadReport}>
            Скачать отчёт (TXT)
          </button>
        </div>
      )}

      <p className="instruction">
        Введите требования в формате:<br />
        <code>
          ТР-028. Система должна предоставлять возможность фильтровать заявки в таблице по наличию parentDocumentId.<br />
          ТР-029. В выпадающем списке "Продукт" должны легко отображаться дочерние подпроцессы.<br />
          ТР-030. Если выбран фильтр "Отображать только параллельные процессы", система должна отображать только такие заявки.
        </code><br />
        Каждое требование должно начинаться с кода (например, <code>ТР-028.</code>) и быть с новой строки.
      </p>

      <textarea
        placeholder="Вставьте образ решения для анализа..."
        value={solutionText}
        onChange={(e) => setSolutionText(e.target.value)}
        rows={12}
        cols={80}
      />
      <br />
      <button onClick={handleAnalyzeSolution} disabled={loading || !solutionText}>
        {loading
          ? 'Анализируется...(Нужно подождать пару минут)'
          : 'Запустить анализ'}
      </button>

      {analysisResult && (
        <div className="analysis-result">
          <h2>Результаты анализа</h2>

          {analysisResult.error && (
            <p className="error">Ошибка: {analysisResult.error}</p>
          )}

          {!analysisResult.error && (
            <>
              {/* AI рекомендации в исходном виде */}
              {analysisResult.ai?.success && analysisResult.ai.response && (
                <section className="ai-recommendation">
                  <div
                    className="ai-block"
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(analysisResult.ai.response)
                    }}
                  />
                </section>
              )}

              {/* Переключатель видимости найденных проблем */}
              <div className="toggle-issues">
                <button onClick={() => setShowIssues(!showIssues)}>
                  {showIssues
                    ? 'Скрыть найденные проблемы'
                    : 'Показать найденные проблемы, найденные статическим анализом'}
                </button>
              </div>

              {/* Список найденных проблем */}
              {showIssues && (
                <section className="issues-section">
                  <h3>
                    Найденные проблемы статического анализа требований ({analysisResult.stats.total})
                  </h3>
                  {Object.entries(groupIssuesByCategoryAndMessage(analysisResult.issues)).map(([category, messages]) => (
                    <div key={category} className="issue-group">
                      <h4>{category}</h4>
                      {Object.entries(messages).map(([message, relatedIssues]) => (
                        <div key={message} className="issue-subgroup">
                          <div className="issue-message">{message}</div>
                          <ul className="analysis-list">
                            {relatedIssues.map((issue, idx) => (
                              <li key={idx} className={`issue-item issue-${category.replace(/\s+/g, '-').toLowerCase()}`}>
                                <div className="issue-excerpt">…{issue.fullRequirement}…</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SolutionPage;
