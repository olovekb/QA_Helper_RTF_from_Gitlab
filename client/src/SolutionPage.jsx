/* eslint-disable no-undef */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import CreatableSelect from 'react-select/creatable';
import { get as idbGet, set as idbSet, clear as idbClear } from 'idb-keyval';
import './SolutionPage.css';
import config from './config.json';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import useAttachmentsMap from './components/useAttachmentsMap'
import { serializeFile } from './components/fileStorage'
import { marked } from 'marked';
import 'github-markdown-css/github-markdown-dark.css';
import TestModelGeneratorModal from './components/test-model/TestModelGeneratorModal';
import TestModelReviewModal from './components/test-model/TestModelReviewModal';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;


const EMPTY_INITIAL_CASES = [];

marked.setOptions({
  gfm: true,
  breaks: true,
});

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return debounced;
}

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

    if (key === 'solutionTasks') {
      const toPersist = (Array.isArray(state) ? state : []).map(t => {
        const {
          attachments,
          requirementAttachments,
          descriptionAttachments,
          stepsAttachments,
          actualAttachments,
          expectedAttachments,
          ...rest
        } = t;
        return rest;
      });
      idbSet(key, toPersist)
        .catch(err => console.warn('IDB error saving tasks:', err));
    } else {
      idbSet(key, state)
        .catch(err => console.warn(`IDB error saving "${key}":`, err));
    }
  }, [key, state]);

  return [state, setState];
}

export const SolutionCard = ({
  task, index, onUpdate, onDelete,
  fieldOptions, loadDefectOptions, onDefectSelect,
  allureProject, runAi, aiLoading,
  isCollapsed, onToggleCollapse, fillFieldsWithAI,
  aiFillLoading,
  setAttachmentsMap
}) => {

  const handleChange = field => e => {
    const v = e.target.type === 'checkbox'
      ? e.target.checked
      : e.target.value;
    onUpdate(index, { ...task, [field]: v });
  };

  const handlePaste = field => async e => {
    const rawFiles = Array.from(e.clipboardData.files || []);
    if (!rawFiles.length) return;
    e.preventDefault();
    const renamedFiles = rawFiles.map((f, idx) => {
      const ext = f.name.split('.').pop();
      const uniqueName = `screenshot-${Date.now()}-${idx}.${ext}`;
      return new File([f], uniqueName, { type: f.type });
    });

    const placeholders = renamedFiles
      .map(f => `!${f.name}|thumbnail!`)
      .join('\n');
    const existingText = task[field] || '';
    const needsSeparator =
      existingText !== '' && !existingText.endsWith('\n');
    const markup = (needsSeparator ? '\n' : '') + placeholders;
    const attKey = field + 'Attachments';
    const prevList = task[attKey] || [];

    onUpdate(index, {
      ...task,
      [field]: existingText + markup,
      [attKey]: [...prevList, ...renamedFiles]
    });
    const serialized = await Promise.all(renamedFiles.map(f => serializeFile(f)))
    setAttachmentsMap(m => ({
      ...m,
      [task.id]: {
        ...(m[task.id] || {}),
        common: [...(m[task.id]?.common || []), ...serialized],
        [field]: [...(m[task.id]?.[field] || []), ...renamedFiles]
      }
    }));
  };

  const toOptions = key =>
    (fieldOptions[key] || []).map(o => ({ value: o.id, label: o.name }));

  const formatAllureOptionLabel = (opt, { context }) => {
    if (context === 'value') return opt.label.split('(')[0].trim();
    return (
      <div className="allure-option-container">
        <div className="allure-option">
          <span className="allure-option__name">{opt.label}</span>
          <span className="allure-option__details">ID: {opt.value}</span>
        </div>
        {opt.linked && <span className="allure-option__linked">уже привязан</span>}
      </div>
    );
  };

  return (
    <div className={`task-card ${task.isNew ? 'new-task' : ''}`}>
      <div className="task-header">
        <button
          className="collapse-toggle"
          onClick={() => onToggleCollapse(index)}
          title={isCollapsed ? "Развернуть" : "Свернуть"}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <input
          type="checkbox"
          checked={task.selected}
          onChange={handleChange('selected')}
          title="Выбрать/снять выбор"
        />
        <div className="field" style={{ flexGrow: 1 }}>
          <label htmlFor={`summary-${index}`}>Тема*</label>
          <input
            id={`summary-${index}`}
            type="text"
            placeholder="Краткое описание проблемы"
            value={task.summary}
            onChange={handleChange('summary')}
          />
        </div>
        <button onClick={() => onDelete(index)} title="Удалить задачу">❌</button>
      </div>

      {task.aiSummary && (
        <div className="ai-feedback full-width">
          <strong>AI Тема:</strong> {task.aiSummary}
        </div>
      )}

      <div className={`card-body ${isCollapsed ? 'collapsed' : ''}`}>
        {/* Исходное требование */}
        <div className="field full-width">
          <label htmlFor={`requirement-${index}`}>Исходное требование*</label>
          <textarea
            id={`requirement-${index}`}
            rows={4}
            placeholder="Текст требования"
            value={task.requirement}
            onChange={handleChange('requirement')}
            onPaste={handlePaste('requirement')}
          />
        </div>
        {task.aiRequirement && (
          <div className="ai-feedback full-width">
            <strong>AI Требование:</strong> {task.aiRequirement}
          </div>
        )}

        {/* Описание проблемы (description) */}
        <div className="field full-width">
          <label htmlFor={`description-${index}`}>Описание проблемы*</label>
          <textarea
            id={`description-${index}`}
            rows={4}
            placeholder="Детальное описание проблемы..."
            value={task.description}
            onChange={handleChange('description')}
            onPaste={handlePaste('description')}
          />
        </div>
        {task.aiDescription && (
          <div className="ai-feedback full-width">
            <strong>AI Описание:</strong> {task.aiDescription}
          </div>
        )}

        {/* Фактический и ожидаемый результат */}
        <div className="field-group">
          <div className="field full-width">
            <label htmlFor={`actual-${index}`}>Фактический результат*</label>
            <textarea
              id={`actual-${index}`}
              rows={2}
              placeholder="Что произошло на самом деле"
              value={task.actual}
              onChange={handleChange('actual')}
              onPaste={handlePaste('actual')}
            />
          </div>
          {task.aiActual && (
            <div className="ai-feedback full-width">
              <strong>AI Фактический:</strong> {task.aiActual}
            </div>
          )}
          <div className="field full-width">
            <label htmlFor={`expected-${index}`}>Ожидаемый результат*</label>
            <textarea
              id={`expected-${index}`}
              rows={2}
              placeholder="Что должно было произойти"
              value={task.expected}
              onChange={handleChange('expected')}
              onPaste={handlePaste('expected')}
            />
          </div>
          {task.aiExpected && (
            <div className="ai-feedback full-width">
              <strong>AI Ожидаемый:</strong> {task.aiExpected}
            </div>
          )}
        </div>

        {/* Нарушенные свойства */}
        <div className="field full-width">
          <label htmlFor={`properties-${index}`}>Нарушенные свойства (через запятую)</label>
          <textarea
            id={`properties-${index}`}
            rows={2}
            placeholder="Нарушенные свойства"
            value={task.properties}
            onChange={handleChange('properties')}
          />
        </div>
        {task.aiProperties && (
          <div className="ai-feedback full-width">
            <strong>AI Свойства:</strong> {task.aiProperties}
          </div>
        )}

        {/* Общие вложения */}
        <div className="field full-width">
          <label>Прикрепить файлы</label>
          <input
            type="file"
            multiple
            onChange={async e => {
              const MAX_FILE_SIZE = 50 * 1024 * 1024;
              const MAX_FILE_COUNT = 20;
              let rawFiles = Array.from(e.target.files);

              const existingCount = (task.attachments || []).length;
              if (existingCount + rawFiles.length > MAX_FILE_COUNT) {
                alert(`Нельзя прикрепить более ${MAX_FILE_COUNT} файлов (уже ${existingCount}).`);
                rawFiles = rawFiles.slice(0, MAX_FILE_COUNT - existingCount);
              }

              const tooBig = rawFiles.filter(f => f.size > MAX_FILE_SIZE);
              if (tooBig.length) {
                const f = tooBig[0];
                alert(`Файл "${f.name}" слишком большой (${(f.size / 1024 / 1024).toFixed(1)} МБ). Максимум 50 МБ.`);
                rawFiles = rawFiles.filter(f => f.size <= MAX_FILE_SIZE);
              }
              if (!rawFiles.length) return;

              onUpdate(index, {
                ...task,
                attachments: [...(task.attachments || []), ...rawFiles]
              });
              const serialized = await Promise.all(rawFiles.map(f => serializeFile(f)));
              setAttachmentsMap(m => ({
                ...m,
                [task.id]: {
                  ...(m[task.id] || {}),
                  common: [...(m[task.id]?.common || []), ...serialized]
                }
              }));
            }}
          />
          {task.attachments?.length > 0 && (
            <ul className="attached-list">
              {task.attachments.map((f, i) => (
                <li key={i}>
                  {f.name}
                  <button
                    type="button"
                    className="remove-attachment-btn"
                    onClick={() => {
                      const newAttachments = task.attachments.filter((_, idx) => idx !== i);
                      onUpdate(index, { ...task, attachments: newAttachments });

                      setAttachmentsMap(m => {
                        const entry = m[task.id] || {};
                        const common = (entry.common || []).filter(x => x.name !== f.name);
                        return {
                          ...m,
                          [task.id]: {
                            ...entry,
                            common,
                          }
                        };
                      });
                    }}
                    title="Удалить файл"
                  >
                    ❌
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Дополнительная информация */}
        <div className="field-group">
          <div className="field">
            <label>Ссылка на требование</label>
            <input
              type="text"
              placeholder="URL в Confluence"
              value={task.requirementLink}
              onChange={handleChange('requirementLink')}
            />
          </div>
          <div className="field">
            <label>Макет</label>
            <input
              type="text"
              placeholder="URL в Figma"
              value={task.mockup}
              onChange={handleChange('mockup')}
            />
          </div>
        </div>

        {/* AI‐кнопки */}
        <div className="ai-controls">
        </div>
      </div>
    </div>
  );
};


// --- Confluence helpers (ID/URL -> pageId) ---
const getConfluencePageId = (raw) => {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return s;
  try {
    const u = new URL(s);
    // обычный вид: .../pages/viewpage.action?pageId=123456
    const pid = u.searchParams.get('pageId');
    if (pid) return pid;
    // иногда id в конце пути или как last segment — попробуем выдрать цифры
    const m = u.href.match(/pageId=(\d+)/i) || u.pathname.match(/(\d{5,})$/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
};

const parseManyPageIds = (rawList) => {
  if (!rawList) return [];
  return [...new Set(
    String(rawList)
      .split(/[,\s]+/)
      .map(getConfluencePageId)
      .filter(Boolean)
  )];
};


export default function SolutionPage({ projects = [] }) {
  const [attachmentsMap, setAttachmentsMap] = useAttachmentsMap('solutionAttachmentsMap');
  const [defaultStand, setDefaultStand] = usePersistentState('defaultStand', '');
  const [defaultEnv, setDefaultEnv] = usePersistentState('defaultEnv', '');
  const [defaultRequirementLink, setDefaultRequirementLink] = usePersistentState('defaultRequirementLink', '');
  const [defaultTestData, setDefaultTestData] = usePersistentState('defaultTestData', '');
  const [defaultMockup, setDefaultMockup] = usePersistentState('defaultMockup', '');

  const [tasks, setTasks] = usePersistentState('solutionTasks', []);
  const [jiraProject, setJiraProject] = usePersistentState('jiraProject', '');
  const [jiraPat, setJiraPat] = usePersistentState('jiraPat', '');
  const [openRouterKey, setOpenRouterKey] = usePersistentState('openRouterKey', '');
  const [epicOption, setEpicOption] = usePersistentState('solutionEpic', null);
  const [assigneeOption, setAssigneeOption] = usePersistentState('solutionAssignee', null);
  const [targetStatus, setTargetStatus] = usePersistentState('targetStatus', null);
  const [allureProject, setAllureProject] = usePersistentState('allureProject', '');
  const [fieldOptions, setFieldOptions] = useState({});
  const [fieldIds, setFieldIds] = useState({});
  const [transitions, setTransitions] = useState([]);
  const [isMetaLoading, setIsMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState({});
  const [requestLinkOption, setRequestLinkOption] = usePersistentState('solutionReqLink', null);
  const [aiFillAllLoading, setAiFillAllLoading] = useState(false);
  const [aiFillLoading, setAiFillLoading] = useState({});
  const [linkTypes, setLinkTypes] = useState([]);
  const [requestLinkType, setRequestLinkType] = usePersistentState('solutionReqLinkType', null);
  const [inputMode, setInputMode] = usePersistentState('inputMode', 'text');
  const [solutionText, setSolutionText] = usePersistentState('solutionText', '');
  const [confluencePageId, setConfluencePageId] = usePersistentState('confluencePageId', '');
  const [bearerToken, setBearerToken] = usePersistentState('bearerToken', '');
  const [contextText, setContextText] = usePersistentState('contextText', '');
  const [glossary, setGlossary] = usePersistentState('glossary', '');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const debProject = useDebounce(jiraProject, 500);
  const debPat = useDebounce(jiraPat, 500);
  const allowedLinkNames = ['Блокирует', 'Относится', 'Клонирование', 'Порождение'];
  const [collapsedStates, setCollapsedStates] = useState({});
  const requestLinkIssue = requestLinkOption?.value || null;
  const [isGenModalOpen, setGenModalOpen] = useState(false);
  const [isReviewModalOpen, setReviewModalOpen] = useState(false);
  const [generatedCases, setGeneratedCases] = useState([]);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [glossaryPageId, setGlossaryPageId] = usePersistentState('glossaryPageId', '');
  const [contextPageIdsInput, setContextPageIdsInput] = usePersistentState('contextPageIdsInput', '');
  const [contextPageIds, setContextPageIds] = usePersistentState('contextPageIds', []);

  const [contextInstruction, setContextInstruction] = usePersistentState('contextInstruction', '');
  const [mainExecutorOption, setMainExecutorOption] =
    usePersistentState('solutionMainExecutor', null);
  const [reviewerOption, setReviewerOption] =
    usePersistentState('solutionReviewer', []);

  useEffect(() => {
    if (reviewerOption && !Array.isArray(reviewerOption)) {
      setReviewerOption([reviewerOption]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (tasks.length > 0 && tasks[0].selected === undefined) {
      setTasks(ts => ts.map(t => ({ ...t, selected: true })));
    }
  }, [tasks, setTasks]);
  useEffect(() => {

    idbSet('__initialized__', true)
      .catch(console.warn);
  }, []);
  useEffect(() => {
    setTasks(ts => ts.map(t => ({ ...t, allureDefect: null })));
  }, [allureProject, setTasks]);
  const cardRefs = useRef([]);
  useEffect(() => {
    // Миграция: если новый массив пуст, но в старом поле есть данные — распарсить
    if (!Array.isArray(contextPageIds) || contextPageIds.length) return;
    const parsed = parseManyPageIds(contextPageIdsInput);
    if (parsed.length) setContextPageIds(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // запускаем один раз

  useEffect(() => {
    cardRefs.current = tasks.map((_, i) => cardRefs.current[i] || React.createRef());
  }, [tasks]);

  const scrollToTask = useCallback((i) => {
    const el = document.getElementById(`task-${i}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const loadLinkTypes = useCallback(async () => {
    if (!jiraPat) return;
    try {
      const { data } = await axios.get(
        `${config.serverUrl}/jira/issueLinkTypes`,
        { params: { pat: jiraPat } }
      );

      setLinkTypes(data.map(t => ({ value: t.name, label: t.name })));
    } catch (e) {
      console.warn('Не удалось загрузить типы связей:', e);
    }
  }, [jiraPat]);

  useEffect(() => { loadLinkTypes() }, [loadLinkTypes]);

  const loadIssueOptions = async input => {
    if (!jiraProject || !jiraPat) return [];

    const q = input.trim();
    let jql;

    if (/^\d+$/.test(q)) {
      jql = `project = ${jiraProject} AND key = ${jiraProject}-${q}`;
    } else if (/^[A-Z]+-\d+$/.test(q)) {
      jql = `project = ${jiraProject} AND key = "${q}"`;
    } else {
      jql = `project = ${jiraProject} AND summary ~ "${q}*"`;
    }

    jql += ' ORDER BY created DESC';

    const url = new URL(`${config.serverUrl}/jira/search`);
    url.searchParams.set('pat', jiraPat);
    url.searchParams.set('jql', jql);
    url.searchParams.set('maxResults', 50);

    const resp = await fetch(url.toString(), {
      headers: { Accept: 'application/json' }
    });
    if (!resp.ok) return [];

    const { issues } = await resp.json();
    return issues.map(issue => ({
      value: issue.key,
      label: `${issue.key} — ${issue.fields.summary}`
    }));
  };


  const buildRequirementsPayload = ({ includeRequirements = false } = {}) => {
    const parsedGlossaryId = getConfluencePageId(glossaryPageId);
    const parsedContextIds = (Array.isArray(contextPageIds) ? contextPageIds : [])
      .map(getConfluencePageId)
      .filter(Boolean);


    const payload = {
      // без requirements по умолчанию
      text: (inputMode === 'text' || inputMode === 'pdf') ? solutionText.trim() : undefined,
      pageId: (inputMode === 'confluence') ? confluencePageId.trim() : undefined,
      bearerToken: bearerToken?.trim() || undefined,
      glossary: glossary?.trim() || undefined,
      glossaryPageId: parsedGlossaryId || undefined,
      context: contextText?.trim() || undefined,
      contextPageIds: parsedContextIds.length ? [...new Set(parsedContextIds)] : undefined,
      contextInstruction: contextInstruction?.trim() || undefined,
    };

    if (includeRequirements) {
      payload.requirements = prepareRequirements();
    }

    // подчистим undefined-ключи
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
    return payload;
  };


  const prepareRequirements = () => {
    const reqsFromTasks = tasks.map(t => t.requirement?.trim()).filter(r => r);
    if (reqsFromTasks.length > 0) {
      return reqsFromTasks;
    }

    // если явно вставили текст → берём текст
    if (inputMode === 'text') {
      return solutionText.trim() ? [solutionText.trim()] : [];
    }

    // во всех остальных режимах (confluence/pdf) — ничего не возвращаем
    return [];
  };


  // группируем текстовые фрагменты в строки по Y
  const groupByRows = (items, tol = 2) => {
    const buckets = new Map();
    for (const it of items) {
      const x = it.transform[4], y = it.transform[5];
      const key = Math.round(y / tol) * tol; // «корзина» по Y
      const arr = buckets.get(key) || [];
      arr.push({ str: it.str, x, y, w: it.width || 0 });
      buckets.set(key, arr);
    }
    // PDF ось Y растет вверх — сортируем от верхней строки к нижней
    const rows = [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, arr]) => arr.sort((a, b) => a.x - b.x));
    return rows;
  };

  // кластеризуем X-позиции, чтобы понять «колонки»
  const detectColumns = (rows, tol = 12) => {
    const xs = [];
    rows.forEach(r => r.forEach(c => xs.push(c.x)));
    xs.sort((a, b) => a - b);
    const cols = [];
    for (const x of xs) {
      const hit = cols.find(v => Math.abs(v - x) <= tol);
      if (!hit) cols.push(x);
    }
    // убираем шум: берем только «популярные» X, которые встречались часто
    const counts = cols.map(cx =>
      rows.reduce((acc, r) => acc + (r.some(c => Math.abs(c.x - cx) <= tol) ? 1 : 0), 0)
    );
    const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
    const stableCols = cols.filter((_, i) => counts[i] >= avg * 0.6);
    return stableCols.sort((a, b) => a - b);
  };

  // строим одну «строку таблицы» по ближайшей колонке
  const placeIntoColumns = (cells, colXs, tol = 12) => {
    const row = Array(colXs.length).fill('');
    for (const c of cells) {
      let idx = 0, best = Infinity;
      for (let i = 0; i < colXs.length; i++) {
        const d = Math.abs(c.x - colXs[i]);
        if (d < best) { best = d; idx = i; }
      }
      if (best <= tol) {
        row[idx] = row[idx] ? `${row[idx]} ${c.str}` : c.str;
      } else {
        // «выбившийся» текст считаем последней колонкой
        row[row.length - 1] = row[row.length - 1]
          ? `${row[row.length - 1]} ${c.str}` : c.str;
      }
    }
    return row.map(s => s.trim());
  };

  // считаем «насколько это таблица»: много повторных межсловных зазоров по X
  const looksLikeTable = (rows) => {
    let tableishLines = 0;
    for (const r of rows) {
      let bigGaps = 0;
      for (let i = 1; i < r.length; i++) {
        const prev = r[i - 1], cur = r[i];
        const gap = cur.x - (prev.x + (prev.w || 0));
        if (gap > 18) bigGaps++;
      }
      if (bigGaps >= 2) tableishLines++;
    }
    return tableishLines >= Math.max(3, rows.length * 0.2);
  };

  // fallback — собрать обычную строку с пробелами/« | » по большим зазорам
  const joinWithGaps = (cells) => {
    let s = '';
    for (let i = 0; i < cells.length; i++) {
      const cur = cells[i], prev = cells[i - 1];
      if (i > 0) {
        const gap = cur.x - (prev.x + (prev.w || 0));
        s += gap > 18 ? ' | ' : (gap > 6 ? ' ' : '');
      }
      s += cur.str;
    }
    return s;
  };

  // ===== обработчик загрузки PDF =====
  /** @param {File} file */
  const handlePdfUpload = async (file) => {
    setPdfExtracting(true);
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent({ normalizeWhitespace: true });
        const rows = groupByRows(tc.items, 2);

        let pageMd = '';
        if (looksLikeTable(rows)) {
          const colXs = detectColumns(rows, 12);
          const mdRows = rows.map(r => placeIntoColumns(r, colXs, 12));
          const widths = mdRows[0]?.map((_, i) =>
            Math.max(...mdRows.map(row => (row[i] || '').length))
          ) || [];
          const pad = (s, i) => (s || '').padEnd(widths[i] || 3, ' ');
          if (mdRows.length) {
            pageMd += `| ${mdRows[0].map((c, i) => pad(c, i)).join(' | ')} |\n`;
            pageMd += `| ${widths.map(w => '-'.repeat(Math.max(3, w))).join(' | ')} |\n`;
            for (let i = 1; i < mdRows.length; i++) {
              pageMd += `| ${mdRows[i].map((c, j) => pad(c, j)).join(' | ')} |\n`;
            }
          }
        } else {
          pageMd = rows.map(joinWithGaps).join('\n');
        }

        pages.push(pageMd.trim());
      }

      let text = pages.join('\n\n--- page ---\n\n');

      // починка переносов/дефисов/буллитов
      text = text
        .replace(/(\S)-\n(\S)/g, '$1$2')   // склейка слов, разорванных дефисом
        .replace(/[ \t]+\n/g, '\n')        // убираем хвостовые пробелы
        .replace(/[•◦▪]/g, '-');           // буллиты → markdown-списки

      setSolutionText(text);
      setInputMode('text'); // дальше ваш обычный поток «текст»
      if (!text) alert('В PDF нет текстового слоя (скан). Для таблиц нужен OCR.');
    } catch (e) {
      alert('Не удалось извлечь текст из PDF: ' + (e?.message || e));
    } finally {
      setPdfExtracting(false);
    }
  };



  const handleGenerateModel = async (modelStructure) => {
    const payloadBase = buildRequirementsPayload({ includeRequirements: true });

    try {
      const { data } = await axios.post(
        `${config.serverUrl}/generate-test-cases`,
        { ...payloadBase, modelStructure }, {
        headers: {
          'Content-Type': 'application/json'
        }
      }
      );
      setGeneratedCases(data.cases);
      setGenModalOpen(false);
      setReviewModalOpen(true);
    } catch (err) {
      console.error('generate-test-cases error:', err);
      alert('Ошибка генерации тест-кейсов: ' + (err.response?.data?.error || err.message));
    }
  };

  // вызывается из ревью, отправляет финальный список в Allure и закрывает
  const handleConfirmSend = finalCases => {
    // … тут ваша логика отправки в Allure …
    console.log('Отправляем в Allure:', finalCases);
    setReviewModalOpen(false);
  };

  const loadMeta = useCallback(async () => {
    if (!debProject || !debPat) return;
    setIsMetaLoading(true); setMetaError('');
    try {
      const { data } = await axios.post(`${config.serverUrl}/jira/meta`, { projectKey: debProject, pat: debPat });
      setFieldOptions(data.options); setFieldIds(data.fieldIds);
    } catch (e) {
      setMetaError(e.response?.data?.error || e.message);
    } finally {
      setIsMetaLoading(false);
    }
  }, [debProject, debPat]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const loadUserOptions = input =>
    axios.get(`${config.serverUrl}/jira/users`, { params: { projectKey: jiraProject, pat: jiraPat, query: input } })
      .then(r => r.data.map(u => ({ value: u.name, label: u.displayName })))
      .catch(() => []);

  const loadTransitions = useCallback(async () => {
    if (!debProject || !debPat) return;
    try {
      const sample = 'JMT-15044';
      const { data } = await axios.get(`${config.serverUrl}/jira/transitions`, { params: { issueKey: sample, pat: jiraPat } });
      setTransitions(data);
    } catch { console.warn('Не удалось загрузить transitions'); }
  }, [debProject, debPat]);
  useEffect(() => { if (modalOpen) loadTransitions(); }, [modalOpen, loadTransitions]);

  useEffect(() => {
    setTasks(ts =>
      ts.map(t => ({
        ...t,
        attachments: (t.attachments && t.attachments.length > 0)
          ? t.attachments
          : (attachmentsMap[t.id]?.common || []),
        requirementAttachments: attachmentsMap[t.id]?.requirement || [],
        descriptionAttachments: attachmentsMap[t.id]?.description || [],
        stepsAttachments: attachmentsMap[t.id]?.steps || [],
        actualAttachments: attachmentsMap[t.id]?.actual || [],
        expectedAttachments: attachmentsMap[t.id]?.expected || [],
      }))
    );
  }, [attachmentsMap, setTasks]);

  const loadDefectOptions = async (projectId, input) => {
    if (!projectId) return [];

    const needle = input.trim().toLowerCase();

    const { data: defects } = await axios.get(
      `${config.serverUrl}/allure/defects`,
      { params: { projectId, page: 0, size: 500, query: needle || undefined } }
    );

    if (/^\d+$/.test(needle)) {
      const id = Number(needle);
      if (!defects.some(d => d.id === id)) {
        try {
          const { data: detail } = await axios.get(
            `${config.serverUrl}/allure/defect/${id}/details`
          );
          defects.unshift({
            id,
            name: detail.name,
            issue: detail.issue
          });
        } catch { }
      }
    }

    const filtered = needle
      ? defects.filter(d =>
        d.name.toLowerCase().includes(needle) ||
        String(d.id).includes(needle)
      )
      : defects;

    const opts = filtered.map(d => ({
      value: d.id,
      label: `${d.name} (ID: ${d.id})`,
      linked: Boolean(d.issue)
    }));
    return [
      { label: 'Свободные дефекты', options: opts.filter(o => !o.linked) },
      { label: 'Уже привязанные дефекты', options: opts.filter(o => o.linked) }
    ];
  };

  const fetchDefectDetails = async (idx, defectId) => {
    try {
      const { data } = await axios.get(`${config.serverUrl}/allure/defect/${defectId}/details`);
      setTasks(ts => ts.map((t, i) => i === idx ? {
        ...t,
        summary: data.name || t.summary,
        description: data.description || t.description,
        steps: (data.steps || []).join('\n') || t.steps,
        isNew: false
      } : t));
    } catch (e) {
      console.error('Ошибка загрузки деталей дефекта:', e);
      alert('Не удалось загрузить описание/шаги дефекта');
    }
  };

  const handleFillAllWithAI = async () => {
    if (!jiraProject || !jiraPat) {
      alert('Сначала укажите Project Key и Jira PAT');
      return;
    }
    setAiFillAllLoading(true);
    try {
      const updated = await Promise.all(tasks.map(async (t) => {
        if (!t.selected) return t;
        const payload = {
          summary: t.summary,
          description: t.description,
          steps: t.steps,
          stand: t.stand,
          env: t.env,
          pat: jiraPat,
          projectKey: jiraProject
        };
        const { data } = await axios.post(
          `${config.serverUrl}/jira/ai-fill-fields`,
          payload
        );
        return {
          ...t,
          actual: data.actual,
          expected: data.expected
        };
      }));
      setTasks(updated);
    } catch (e) {
      console.error('AI fill all error:', e);
      alert('Ошибка при заполнении AI для всех: ' + (e.response?.data?.error || e.message));
    } finally {
      setAiFillAllLoading(false);
    }
  };

  const fillFieldsWithAI = async idx => {
    const t = tasks[idx];
    setAiFillLoading(l => ({ ...l, [idx]: true }));
    try {
      const payload = {
        summary: t.summary,
        description: t.description,
        steps: t.steps,
        stand: t.stand,
        env: t.env,
        pat: jiraPat,
        projectKey: jiraProject
      };
      const { data } = await axios.post(
        `${config.serverUrl}/jira/ai-fill-fields`,
        payload
      );
      setTasks(ts => ts.map((c, i) => i === idx
        ? {
          ...c,
          actual: data.actual,
          expected: data.expected,
          properties: data.properties || c.properties,
          aiProperties: data.propertiesFeedback || c.aiProperties
        }
        : c
      ));
    } catch (e) {
      console.error('AI‑fill error:', e);
      alert('Не удалось заполнить поля AI: ' + (e.response?.data?.error || e.message));
    } finally {
      setAiFillLoading(l => ({ ...l, [idx]: false }));
    }
  };

  const runAi = async idx => {
    const t = tasks[idx];
    setAiLoading(l => ({ ...l, [idx]: true }));
    try {
      const { data } = await axios.post(`${config.serverUrl}/bug/ai-review`, { task: t });
      setTasks(ts => ts.map((c, i) => i === idx ? {
        ...c,
        aiSummary: data.summaryFeedback,
        aiDescription: data.descriptionFeedback,
        aiSteps: data.stepsFeedback,
        aiActual: data.actualFeedback,
        aiExpected: data.expectedFeedback,
        properties: data.propertiesFeedback || c.properties,
        aiProperties: data.propertiesFeedback || c.aiProperties
      } : c));
    } catch (e) {
      alert('Ошибка AI: ' + (e.response?.data?.error || e.message));
    } finally {
      setAiLoading(l => ({ ...l, [idx]: false }));
    }
  };

  const handleAdd = () => {
    const newId = uuidv4();
    setAttachmentsMap(prev => ({
      ...prev,
      [newId]: {
        common: [],
        requirement: [],
        description: [],
        steps: [],
        actual: [],
        expected: [],
      }
    }));

    setTasks(prev => [{
      id: newId,
      summary: '',
      requirement: '',
      description: '',
      steps: '',
      actual: '',
      expected: '',
      properties: '',
      stand: defaultStand,
      env: defaultEnv,
      requirementLink: defaultRequirementLink,
      testData: defaultTestData,
      mockup: defaultMockup,
      selected: true,
      isNew: true,
      allureDefect: null,
      attachments: [],
      requirementAttachments: [],
      descriptionAttachments: [],
      stepsAttachments: [],
      actualAttachments: [],
      expectedAttachments: [],
      aiSummary: '',
      aiRequirement: '',
      aiDescription: '',
      aiSteps: '',
      aiActual: '',
      aiExpected: '',
      aiProperties: '',
    }, ...prev]);

    setCollapsedStates(prev => {
      const next = { 0: false };
      Object.entries(prev).forEach(([key, val]) => {
        next[Number(key) + 1] = val;
      });
      return next;
    });
  };

  const handleDelete = i => {
    setTasks(ts => ts.filter((_, idx) => idx !== i));
    setCollapsedStates(prev => {
      const newStates = {};
      Object.keys(prev).forEach(key => {
        const intKey = parseInt(key, 10);
        if (intKey < i) {
          newStates[intKey] = prev[key];
        } else if (intKey > i) {
          newStates[intKey - 1] = prev[key];
        }
      });
      return newStates;
    });
  };

  const handleUpdate = (i, upd) => setTasks(ts => ts.map((t, idx) => idx === i ? upd : t));

  const handleToggleCollapse = index => {
    setCollapsedStates(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleAnalyzeSolution = async () => {
    setLoading(true);
    setAnalysisResult(null);

    // единый билдер уже:
    // - берет contextPageIds (из мультиселекта) И/ИЛИ contextPageIdsInput
    // - вынимает из URL чистые pageId
    // - делает dedup
    // - подставляет bearerToken при наличии
    const payload = buildRequirementsPayload({ includeRequirements: false });

    try {
      const headers = openRouterKey ? { 'X-OpenRouter-Key': openRouterKey } : {};
      const resp = await axios.post(`${config.serverUrl}/analyze/solution`, payload, { headers });
      if (!resp.data.success) {
        setAnalysisResult({ error: resp.data.error });
      } else {
        setAnalysisResult(resp.data.data);
        const aiTasks = parseDocumentationErrors(resp.data.data.ai?.response);
        setTasks(prev => [...prev, ...aiTasks]);
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
    const blocks = response.split('```').filter((_, i) => i % 2 === 1);

    return blocks.map(block => {
      const lines = block.trim().split('\n');
      const requirement = lines.find(l => l.startsWith('###'))?.replace(/^###\s*/, '').trim() || '';

      const getField = (label) => {
        const line = lines.find(l => l.includes(label));
        return line ? line.split(label)[1].trim() : '';
      };

      const description = getField('**Описание**:');
      const properties = getField('**Нарушены свойства**:');
      const actual = getField('**Фактический результат**:');
      const expected = getField('**Ожидаемый результат**:');

      const topic = getField('**Тема**:');
      const part = getField('**Тема**:');
      const summary = `${topic}`;

      return {
        id: uuidv4(),
        summary,
        requirement,
        description,
        steps: '',
        actual,
        expected,
        properties,
        stand: defaultStand,
        env: defaultEnv,
        requirementLink: defaultRequirementLink,
        testData: defaultTestData,
        mockup: defaultMockup,
        selected: true,
        isNew: false,
        allureDefect: null,
        attachments: [],
        requirementAttachments: [],
        descriptionAttachments: [],
        stepsAttachments: [],
        actualAttachments: [],
        expectedAttachments: [],
        aiSummary: '',
        aiRequirement: '',
        aiDescription: '',
        aiSteps: '',
        aiActual: '',
        aiExpected: '',
        aiProperties: '',
      };
    }).filter(t => t.summary);
  };

  const handleCreateAll = async () => {
    setCreating(true);
    setResults([]);
    const out = [];

    for (const t of tasks.filter(t => t.selected)) {
      const desc = `h3. Исходное требование\n${t.requirement}\n\nh3. Описание проблемы\n${t.description || '(не заполнено)'}\n\nh3. Нарушенные свойства\n${t.properties}\n\nh3. Фактический результат\n{quote}${t.actual || '(не заполнено)'}{quote}\n\nh3. Ожидаемый результат\n{quote}${t.expected || '(не заполнено)'}{quote}\n*Макет:* ${t.mockup || 'не указано'}\n*Ссылка на требование:* ${t.requirementLink || 'не указано'}`;

      const fields = {
        project: { key: jiraProject },
        issuetype: { id: "12812" },
        summary: t.summary,
        description: desc,
        customfield_13169: { id: "12683" },
      };
      if (epicOption?.value) {
        fields[fieldIds['Epic Link']] = epicOption.value;
      }
      if (assigneeOption?.value) {
        fields.assignee = { name: assigneeOption.value };
      }
      if (fieldIds['Основной исполнитель'] && mainExecutorOption?.value) {
        fields[fieldIds['Основной исполнитель']] = { name: mainExecutorOption.value };
      }
      const REVIEWERS_CF = 'customfield_13812';
      const reviewersFieldId = fieldIds['Ревьюеры'] || fieldIds['Ревьюер'] || REVIEWERS_CF;
      if (reviewersFieldId) {
        const opts = Array.isArray(reviewerOption) ? reviewerOption : (reviewerOption ? [reviewerOption] : []);
        if (opts.length) {
          fields[reviewersFieldId] = opts.map(o => ({ name: o.value }));
        }
      }

      try {
        const { data: { key } } = await axios.post(
          `${config.serverUrl}/jira/create-issue`,
          { pat: jiraPat, payload: { fields } }
        );
        out.push({ success: true, summary: t.summary, key });

        const allFiles = [
          ...(t.requirementAttachments || []),
          ...(t.descriptionAttachments || []),
          ...(t.stepsAttachments || []),
          ...(t.actualAttachments || []),
          ...(t.expectedAttachments || []),
          ...(t.attachments || [])
        ];
        const blobFiles = allFiles.filter(f => f instanceof Blob);

        if (blobFiles.length) {
          const form = new FormData();
          blobFiles.forEach(f => form.append('file', f));

          await axios.post(
            `${config.serverUrl}/jira/issue/${key}/attachments`,
            form,
            {
              headers: {
                'X-Atlassian-Token': 'no-check',
                Authorization: `Bearer ${jiraPat}`
              }
            }
          );
        }

        if (targetStatus) {
          await axios.post(
            `${config.serverUrl}/jira/transition-issues`,
            { pat: jiraPat, issueKeys: [key], transitionId: targetStatus }
          );
        }
        if (t.allureDefect) {
          try {
            await axios.post(
              `${config.serverUrl}/allure/defect/${t.allureDefect.value}/issue`,
              { integrationId: 67, name: key }
            );
          } catch (linkErr) {
            out.push({
              success: false,
              summary: `Привязка ${t.summary}`,
              key,
              error: linkErr.response?.data?.error || linkErr.message
            });
          }
        }
        if (requestLinkIssue && requestLinkType) {
          try {
            await axios.post(
              `${config.serverUrl}/jira/issueLink`,
              {
                pat: jiraPat,
                typeName: requestLinkType,
                inwardIssueKey: key,
                outwardIssueKey: requestLinkIssue
              }
            );
          } catch (err) {
            out.push({
              success: false,
              summary: `Связь ${t.summary}`,
              error: err.response?.data?.error || err.message
            });
          }
        }

      } catch (err) {
        out.push({
          success: false,
          summary: t.summary,
          error: err.response?.data?.error || err.message
        });
      }
    }

    setResults(out);
    setTasks(ts =>
      ts.filter(t =>
        !out.find(r => r.success && r.summary === t.summary && !r.error)
      )
    );
    setCreating(false);
  };

  const ready = !isMetaLoading && !metaError && Object.keys(fieldOptions).length > 0;
  const selectedTasksCount = tasks.filter(t => t.selected).length;
  const navigate = useNavigate();
  const filteredLinkTypes = linkTypes.filter(o =>
    allowedLinkNames.includes(o.value)
  );
  const canAnalyze = (inputMode === 'text' ? solutionText.trim() : confluencePageId.trim()) && !loading;

  return (
    <div className="solution-page">
      <h1>Тестирование требований</h1>

      <section className="page-section">
        <h2>1. Настройки подключения</h2>
        <div className="settings-grid">
          <div className="field full-width">
            <label>Project Key (Jira)</label>
            <input type="text" value={jiraProject} onChange={e => setJiraProject(e.target.value.toUpperCase())} required placeholder="PROJ" />
          </div>
          <div className="field">
            <label>Jira PAT (Personal Access Token)</label>
            <input type="password" value={jiraPat} onChange={e => setJiraPat(e.target.value)} placeholder="Ваш токен доступа Jira" />
          </div>
          <div className="field">
            <label>
              OpenRouter API Key 
              <span style={{ cursor: 'help', marginLeft: '5px' }} title="Оставьте пустым для использования API-ключа по умолчанию">ⓘ</span>
            </label>
            <input 
              type="password" 
              value={openRouterKey} 
              onChange={e => setOpenRouterKey(e.target.value.trim())} 
              placeholder="sk-or-v1-..." 
            />
          </div>
          <div className="field">
            <label>Проект Allure</label>
            <Select
              classNamePrefix="select"
              placeholder="Выберите проект Allure…"
              options={projects.map(p => ({ value: p.id, label: p.name }))}
              value={
                projects
                  .map(p => ({ value: p.id, label: p.name }))
                  .find(o => o.value === allureProject) || null
              }
              isClearable
              onChange={opt => setAllureProject(opt?.value || '')}
              styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
              menuPortalTarget={document.body}
            />
          </div>
        </div>

        {isMetaLoading && <p className="status-message loading">Загрузка метаданных Jira…</p>}
        {metaError && <p className="status-message error">{metaError}</p>}
        {ready && <p className="status-message success">Метаданные Jira успешно загружены</p>}
      </section>

      <div className="input-area">
        <div className="input-tabs">
          <button type="button" className={inputMode === 'confluence' ? 'active' : ''} onClick={() => setInputMode('confluence')}>Загрузить из Confluence</button>
          <button type="button" className={inputMode === 'text' ? 'active' : ''} onClick={() => setInputMode('text')}>Вставить текст</button>
          <button type="button" className={inputMode === 'pdf' ? 'active' : ''} onClick={() => setInputMode('pdf')}>Загрузить PDF</button>
        </div>

        {inputMode === 'pdf' && (
          <div className="pdf-inputs">
            <input type="file" accept="application/pdf"
              onChange={e => e.target.files?.[0] && handlePdfUpload(e.target.files[0])} />
            {pdfExtracting && <p>Извлекается текст из PDF…</p>}
          </div>
        )}

        {inputMode === 'text' ? (
          <div className="md-split">
            <textarea
              placeholder="Вставьте текст требований для анализа..."
              value={solutionText}
              onChange={e => setSolutionText(e.target.value)}
              rows={12}
              className="md-editor"
            />
          </div>
        ) : (
          <div className="confluence-inputs">
            <input
              type="text"
              placeholder="Confluence Page ID (напр., 133465419)"
              name="confluencePageId"
              autoComplete="off"
              value={confluencePageId}
              onChange={e => setConfluencePageId(e.target.value)}
            />
            <input
              type="password"
              placeholder="Ваш Bearer токен для Confluence"
              name="confluenceToken"
              autoComplete="new-password"
              value={bearerToken}
              onChange={e => setBearerToken(e.target.value)}
            />

          </div>


        )}
        {/* --- Новые поля для глоссария и контекста из Confluence --- */}
        <div className="confluence-inputs">
          <input
            type="text"
            placeholder="Глоссарий: Confluence Page ID или URL (необязательно)"
            value={glossaryPageId}
            onChange={e => setGlossaryPageId(e.target.value)}
          />
          <div className="ctx-select">
            <CreatableSelect
              classNamePrefix="select"
              isMulti
              placeholder="Доп. контекст: добавьте Page ID/URL и нажмите Enter"
              value={(contextPageIds || []).map(v => ({ value: v, label: v }))}
              onChange={(opts) => {
                const vals = (opts || []).map(o => o.value);
                setContextPageIds(vals);
                // дополнительная синхронизация "на всякий":
                setContextPageIdsInput(vals.length ? vals.join(' ') : '');
              }}

              onCreateOption={(inputValue) => setContextPageIds([...(contextPageIds || []), inputValue])}
              formatCreateLabel={(inputValue) => `Добавить: ${inputValue}`}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              styles={{
                container: (base) => ({ ...base, width: '100%' }),
                control: (base) => ({ ...base, minHeight: 44 }),
                valueContainer: (base) => ({
                  ...base,
                  flexWrap: 'nowrap',     // чтобы чипы не ломались в столбик
                  overflowX: 'auto',      // горизонтальный скролл, если много ID
                }),
                multiValue: (base) => ({ ...base, marginRight: 8 }),
                menuPortal: (base) => ({ ...base, zIndex: 9999 }),
              }}
            />
          </div>

          <textarea
            className="context-input"
            placeholder="Инструкция к доп. контексту: что именно брать из ссылок (напр.: 'используй только разделы «Термины» и «Ограничения»')"
            value={contextInstruction}
            onChange={e => setContextInstruction(e.target.value)}
            rows={2}
          />
        </div>

        <button className="analyze-button" onClick={handleAnalyzeSolution} disabled={!canAnalyze}>
          {loading ? 'Анализируется...' : '🚀 Запустить AI-анализ'}
        </button>
      </div>

      {loading && <div className="loader">Анализ в процессе...</div>}
      {analysisResult?.error && <div className="error-message">Ошибка: {analysisResult.error}</div>}

      <div className="task-controls">
        <button className="btn btn-secondary" onClick={handleAdd}>➕ Добавить задачу</button>
        <button
          className="btn btn-primary"
          disabled={selectedTasksCount === 0 || !ready}
          onClick={() => {
            setResults([]);
            setModalOpen(true);
          }}
        >
          ⚙️ Создать в Jira ({selectedTasksCount})
        </button>
        <button className="btn btn-danger" onClick={async () => {
          if (window.confirm('Вы уверены, что хотите очистить все задачи и настройки? Это действие необратимо.')) {
            await idbClear(); window.location.reload();
          }
        }}>
          🗑️ Очистить всё
        </button>
      </div>
      {tasks.length > 3 && (
        <div className="mini-nav">
          {tasks.map((t, i) => (
            <button type="button"
              key={i}
              onClick={() => scrollToTask(i)}
            >
              {i + 1}. {t.summary || 'Без темы'}
            </button>
          ))}
        </div>
      )}
      {/* --- Кнопка и две модалки для тест‑модели --- */}
      <button onClick={() => setGenModalOpen(true)} className="btn btn-secondary" style={{ marginBottom: 16 }}>
        🧱 Сгенерировать тест-кейсы
      </button>

      <TestModelGeneratorModal
        isOpen={isGenModalOpen}
        onClose={() => setGenModalOpen(false)}
        onGenerate={handleGenerateModel}
        initialCases={EMPTY_INITIAL_CASES}
        requirements={prepareRequirements()}
        jiraProject={jiraProject}
        jiraPat={jiraPat}
      />

      <TestModelReviewModal
        isOpen={isReviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        onConfirmSend={handleConfirmSend}
        initialCases={generatedCases}
        projectId={allureProject}
        jiraProject={jiraProject}
        jiraPat={jiraPat}
      />
      {/* Основной список задач */}
      <div className="task-list">
        {tasks.map((t, i) => (
          <div key={t.id} id={`task-${i}`} ref={cardRefs.current[i]}>
            <SolutionCard
              index={i}
              task={t}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              fieldOptions={fieldOptions}
              loadDefectOptions={loadDefectOptions}
              allureProject={allureProject}
              onDefectSelect={fetchDefectDetails}
              runAi={runAi}
              aiLoading={aiLoading[i]}
              fillFieldsWithAI={fillFieldsWithAI}
              aiFillLoading={aiFillLoading[i] || false}
              isCollapsed={!!collapsedStates[i]}
              onToggleCollapse={handleToggleCollapse}
              setAttachmentsMap={setAttachmentsMap}
            />
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="modal">
          <div className="modal-content">
            <button className="modal-close-btn" onClick={() => setModalOpen(false)}>×</button>
            <h2>2. Общие поля для ({selectedTasksCount}) задач</h2>
            <fieldset disabled={!ready || creating} className="common-fields-group">
              <legend>Общие поля Jira</legend>

              <div className="field full-width">
                <label>Epic Link</label>
                <AsyncSelect
                  classNamePrefix="select"
                  cacheOptions
                  defaultOptions
                  loadOptions={loadIssueOptions}
                  placeholder="Начните вводить Epic Link…"
                  value={epicOption}
                  onChange={opt => setEpicOption(opt)}
                  noOptionsMessage={() => 'Нет совпадений'}
                  isClearable
                />
              </div>

              <div className="field">
                <label>Исполнитель (необязательно)</label>
                <AsyncSelect
                  classNamePrefix="select"
                  cacheOptions
                  defaultOptions
                  loadOptions={loadUserOptions}
                  placeholder="Начните вводить имя…"
                  value={assigneeOption}
                  onChange={opt => setAssigneeOption(opt)}
                  noOptionsMessage={() => 'Нет совпадений'}
                  isClearable
                />
              </div>
              <div className="field">
                <label>Основной исполнитель</label>
                <AsyncSelect
                  classNamePrefix="select"
                  cacheOptions
                  defaultOptions
                  loadOptions={loadUserOptions}
                  placeholder="Начните вводить имя…"
                  value={mainExecutorOption}
                  onChange={opt => setMainExecutorOption(opt)}
                  noOptionsMessage={() => 'Нет совпадений'}
                  isClearable
                />
              </div>

              <div className="field">
                <label>Ревьюеры</label>
                <AsyncSelect
                  classNamePrefix="select"
                  cacheOptions
                  defaultOptions
                  isMulti
                  loadOptions={loadUserOptions}
                  placeholder="Начните вводить имена…"
                  value={reviewerOption || []}
                  onChange={opts => setReviewerOption(opts || [])}
                  noOptionsMessage={() => 'Нет совпадений'}
                  isClearable
                />
              </div>
              <div className="field">
                <label>Статус задачи</label>
                <Select
                  classNamePrefix="select"
                  placeholder="Выберите статус…"
                  isClearable
                  options={transitions.map(t => ({ value: t.id, label: t.name }))}
                  value={
                    transitions
                      .map(t => ({ value: t.id, label: t.name }))
                      .find(o => o.value === targetStatus) || null
                  }
                  onChange={opt => setTargetStatus(opt?.value || null)}
                  styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  menuPlacement="auto"
                />
              </div>
            </fieldset>
            <fieldset disabled={!ready || creating} className="common-fields-group">
              <legend>Связь запроса</legend>
              <div className="field">
                <label>Ключ задачи</label>
                <AsyncSelect
                  classNamePrefix="select"
                  cacheOptions
                  defaultOptions
                  loadOptions={loadIssueOptions}
                  placeholder="Начните вводить ключ задачи…"
                  value={requestLinkOption}
                  onChange={opt => {
                    setRequestLinkOption(opt);
                  }}
                  noOptionsMessage={() => 'Ничего не найдено'}
                  isClearable
                />
              </div>
              <div className="field">
                <label>Тип связи</label>
                <Select
                  classNamePrefix="select"
                  placeholder="Выберите тип..."
                  options={filteredLinkTypes}
                  value={filteredLinkTypes.find(o => o.value === requestLinkType) || null}
                  onChange={opt => setRequestLinkType(opt?.value || null)}
                  isClearable
                />
              </div>
            </fieldset>
            <div className="buttons">
              <button onClick={handleCreateAll} disabled={!ready || creating} className="btn btn-primary">
                {creating ? 'Создание…' : `Подтвердить и создать ${selectedTasksCount} задач`}
              </button>
            </div>
            {results.length > 0 && (
              <div className="jira-result">
                <h3>Результаты создания:</h3>
                {results.map((r, i) =>
                  r.success
                    ? <p key={i} className="success">✅ <b>{r.key}:</b> <a href={`${config.jiraBaseUrl || 'https://jira.abanking.ru'}/browse/${r.key}`} target="_blank" rel="noreferrer">{r.summary}</a></p>
                    : <p key={i} className="error">❌ <b>{r.summary}:</b> {r.error}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="floating-buttons">
        <button
          className="btn btn-secondary btn-back"
          onClick={() => navigate('/')}
        >
          ← Назад
        </button>
        <button
          className="btn btn-secondary btn-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ↑ Вверх
        </button>
      </div>
    </div>
  );
}