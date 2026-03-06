/* eslint-disable no-undef */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import CreatableSelect from 'react-select/creatable';
import { get as idbGet, set as idbSet, clear as idbClear } from 'idb-keyval';
import './SolutionPage.css';
import config from './config';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import useAttachmentsMap from './components/useAttachmentsMap'
import { serializeFile } from './components/fileStorage'
import { marked } from 'marked';
import 'github-markdown-css/github-markdown-dark.css';
import TestModelGeneratorModal from './components/test-model/TestModelGeneratorModal';
import TestModelReviewModal from './components/test-model/TestModelReviewModal';
import GlobalGenerationWindow from './components/GlobalGenerationWindow';
import ErrorBoundary from './components/ErrorBoundary';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import { trackEvent } from './analytics';
import { tasksWord } from './utils/textHelpers';
import { formatPropertiesForJira, stripPropertyLinks, VIOLATED_PROPERTY_LINK } from './utils/propertiesHelpers';
import { useDebounce } from './hooks/useDebounce';
import { usePersistentState } from './hooks/usePersistentState';
import { useShowScrollTop } from './hooks/useShowScrollTop';
import { createHandleChange, createHandlePaste } from './utils/taskFieldHelpers';
import ArrowUpIcon from './components/ArrowUpIcon';
import JiraMarkdownField from './components/JiraMarkdownField';
import AttachmentsField from './components/AttachmentsField';
import TaskSidebar from './components/TaskSidebar';
import PhraseLoader from './components/PhraseLoader';
import UndoDeleteToast from './components/UndoDeleteToast';

// CSS для анимаций прогресс-бара
const progressBarStyles = `
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
`;

// Инжектим стили в head
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = progressBarStyles;
  document.head.appendChild(styleSheet);
}

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;


const EMPTY_INITIAL_CASES = [];

marked.setOptions({
  gfm: true,
  breaks: true,
});

const VIOLATED_PROPERTY_OPTIONS = [
  { value: 'Завершенность', label: 'Завершенность' },
  { value: 'Атомарность', label: 'Атомарность' },
  { value: 'Непротиворечивость', label: 'Непротиворечивость' },
  { value: 'Недвусмысленность', label: 'Недвусмысленность' },
  { value: 'Выполнимость', label: 'Выполнимость' },
  { value: 'Обязательность', label: 'Обязательность' },
  { value: 'Корректность', label: 'Корректность' },
  { value: 'Проверяемость', label: 'Проверяемость' }
];

const REQUIRED_FIELDS = [
  { key: 'summary', id: i => `field-summary-${i}` },
  { key: 'requirement', id: i => `field-requirement-${i}` },
  { key: 'description', id: i => `field-description-${i}` },
  { key: 'actual', id: i => `field-actual-${i}` },
  { key: 'expected', id: i => `field-expected-${i}` }
];

const isEmptyRequired = (task, key) =>
{
  switch (key) {
    case 'summary': return !(task.summary || '').trim();
    case 'requirement': return !(task.requirement || '').trim();
    case 'description': return !(task.description || '').trim();
    case 'actual': return !(task.actual || '').trim();
    case 'expected': return !(task.expected || '').trim();
    default: return false;
  }
};

const getFirstInvalidFieldId = (task, index) =>
{
  for (const { key, id } of REQUIRED_FIELDS) {
    if (isEmptyRequired(task, key)) return id(index);
  }
  return null;
};

export const SolutionCard = ({
  task, index, onUpdate, onDelete, onDeleteClick,
  fieldOptions, loadDefectOptions, onDefectSelect,
  allureProject, runAi, aiLoading,
  isCollapsed, onToggleCollapse, fillFieldsWithAI,
  aiFillLoading,
  setAttachmentsMap,
  attachmentsMap = {},
  forceValidation = false
}) =>
{
  const [touchedFields, setTouchedFields] = useState(() => new Set());
  const [violatedPropertyOptions, setViolatedPropertyOptions] = useState([]);

  const isFieldInvalid = useCallback((fieldKey) =>
  {
    const touched = touchedFields.has(fieldKey) || forceValidation;
    return touched && isEmptyRequired(task, fieldKey);
  }, [touchedFields, forceValidation, task]);

  const handleBlur = useCallback((fieldKey) =>
  {
    setTouchedFields(prev => new Set(prev).add(fieldKey));
  }, []);

  useEffect(() =>
  {
    const propsText = (task.properties || '').trim();
    const linkMatch = propsText.match(/\[([^\]]+)\|https:\/\/confluence\.artsofte\.ru\/x\/Bru6CQ\]/);
    const names = linkMatch
      ? linkMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : propsText ? propsText.split(',').map(s => s.trim()).filter(Boolean) : [];
    const opts = names.map(n => VIOLATED_PROPERTY_OPTIONS.find(o => o.value === n)).filter(Boolean);
    setViolatedPropertyOptions(opts);
  }, [task.properties]);

  const handleChange = createHandleChange(task, index, onUpdate);
  const handlePaste = createHandlePaste(task, index, onUpdate, setAttachmentsMap, { serializeFile, includeCommon: true });

  return (
    <div className={ `task-card ${task.isNew ? 'new-task' : ''}` }>
      <div className="task-header">
        { onToggleCollapse && (
          <button
            className="collapse-toggle"
            onClick={ () => onToggleCollapse(index) }
            title={ isCollapsed ? "Развернуть" : "Свернуть" }
          >
            { isCollapsed ? '▶' : '▼' }
          </button>
        ) }
        <input
          type="checkbox"
          checked={ task.selected }
          onChange={ handleChange('selected') }
          title="Выбрать/снять выбор"
        />
        <div id={ `field-summary-${index}` } className={ `field ${isFieldInvalid('summary') ? 'field-invalid' : ''}` } style={ { flexGrow: 1 } }>
          <label htmlFor={ `summary-${index}` }>Тема*</label>
          <input
            id={ `summary-${index}` }
            type="text"
            placeholder="Краткое описание проблемы"
            value={ task.summary }
            onChange={ handleChange('summary') }
            onBlur={ () => handleBlur('summary') }
          />
        </div>
        <button
          className="btn-secondary"
          onClick={ () => (onDeleteClick ? onDeleteClick(index) : onDelete(index)) }
          title="Удалить задачу"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" vectorEffect="non-scaling-stroke">
            <path d="M16 6v-.8c0-1.12 0-1.68-.218-2.108a2 2 0 0 0-.874-.874C14.48 2 13.92 2 12.8 2h-1.6c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C8 3.52 8 4.08 8 5.2V6m2 5.5v5m4-5v5M3 6h18m-2 0v11.2c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C16.72 22 15.88 22 14.2 22H9.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C5 19.72 5 18.88 5 17.2V6" />
          </svg>
        </button>
      </div>

      { task.aiSummary && (
        <div className="ai-feedback full-width">
          <strong>AI Тема:</strong> { task.aiSummary }
        </div>
      ) }

      <div className={ `card-body ${isCollapsed ? 'collapsed' : ''}` }>
        {/* Исходное требование */ }
        <div id={ `field-requirement-${index}` } className={ `field full-width ${isFieldInvalid('requirement') ? 'field-invalid' : ''}` }>
          <label htmlFor={ `requirement-${index}` }>Исходное требование*</label>
          <textarea
            id={ `requirement-${index}` }
            rows={ 4 }
            placeholder="Текст требования"
            value={ task.requirement }
            onChange={ handleChange('requirement') }
            onBlur={ () => handleBlur('requirement') }
            onPaste={ handlePaste('requirement') }
          />
        </div>
        { task.aiRequirement && (
          <div className="ai-feedback full-width">
            <strong>AI Требование:</strong> { task.aiRequirement }
          </div>
        ) }

        {/* Описание проблемы (description) */ }
        <div id={ `field-description-${index}` } className={ `field full-width ${isFieldInvalid('description') ? 'field-invalid' : ''}` }>
          <label htmlFor={ `description-${index}` }>Описание проблемы*</label>
          <JiraMarkdownField
            id={ `description-${index}` }
            value={ task.description }
            onChange={ val => onUpdate(index, { ...task, description: val }) }
            onBlur={ () => handleBlur('description') }
            onPaste={ handlePaste('description') }
            imageAttachments={ attachmentsMap[task.id]?.description || [] }
            placeholder="Детальное описание проблемы..."
            minHeight={ 136 }
          />
        </div>
        { task.aiDescription && (
          <div className="ai-feedback full-width">
            <strong>AI Описание:</strong> { task.aiDescription }
          </div>
        ) }

        {/* Фактический и ожидаемый результат */ }
        <div className="field-group">
          <div id={ `field-actual-${index}` } className={ `field full-width ${isFieldInvalid('actual') ? 'field-invalid' : ''}` }>
            <label htmlFor={ `actual-${index}` }>Фактический результат*</label>
            <JiraMarkdownField
              id={ `actual-${index}` }
              value={ task.actual }
              onChange={ val => onUpdate(index, { ...task, actual: val }) }
              onBlur={ () => handleBlur('actual') }
              onPaste={ handlePaste('actual') }
              imageAttachments={ attachmentsMap[task.id]?.actual || [] }
              placeholder="Что произошло на самом деле"
              minHeight={ 80 }
            />
          </div>
          { task.aiActual && (
            <div className="ai-feedback full-width">
              <strong>AI Фактический:</strong> { task.aiActual }
            </div>
          ) }
          <div id={ `field-expected-${index}` } className={ `field full-width ${isFieldInvalid('expected') ? 'field-invalid' : ''}` }>
            <label htmlFor={ `expected-${index}` }>Ожидаемый результат*</label>
            <JiraMarkdownField
              id={ `expected-${index}` }
              value={ task.expected }
              onChange={ val => onUpdate(index, { ...task, expected: val }) }
              onBlur={ () => handleBlur('expected') }
              onPaste={ handlePaste('expected') }
              imageAttachments={ attachmentsMap[task.id]?.expected || [] }
              placeholder="Что должно было произойти"
              minHeight={ 80 }
            />
          </div>
          { task.aiExpected && (
            <div className="ai-feedback full-width">
              <strong>AI Ожидаемый:</strong> { task.aiExpected }
            </div>
          ) }
        </div>

        {/* Нарушенные свойства */ }
        <div className="field full-width">
          <label>Нарушенное свойство</label>
          <Select
            classNamePrefix="select"
            placeholder="Выберите..."
            isMulti
            closeMenuOnSelect={ false }
            isClearable
            options={ VIOLATED_PROPERTY_OPTIONS }
            value={ violatedPropertyOptions }
            onChange={ opts =>
            {
              const selected = opts || [];
              setViolatedPropertyOptions(selected);
              const rest = stripPropertyLinks(task.properties || '');
              const block =
                selected.length > 0
                  ? `[${selected.map(o => o.value).join(', ')}|${VIOLATED_PROPERTY_LINK}]`
                  : '';
              const newProps = [block, rest].filter(Boolean).join('\n\n');
              onUpdate(index, { ...task, properties: newProps });
            } }
            styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
            menuPortalTarget={ document.body }
          />
        </div>
        { task.aiProperties && (
          <div className="ai-feedback full-width">
            <strong>AI Свойства:</strong> { task.aiProperties }
          </div>
        ) }

        {/* Общие вложения */ }
        {/* Общие вложения */ }
        <AttachmentsField
          task={ task }
          index={ index }
          onUpdate={ onUpdate }
          setAttachmentsMap={ setAttachmentsMap }
          attachmentsMap={ attachmentsMap }
          commonOnly
          label="Прикрепить файлы"
        />

        {/* Дополнительная информация */ }
        <div className="field-group">
          <div className="field">
            <label>Ссылка на требование</label>
            <input
              type="text"
              placeholder="URL в Confluence"
              value={ task.requirementLink }
              onChange={ handleChange('requirementLink') }
            />
          </div>
          <div className="field">
            <label>Макет</label>
            <input
              type="text"
              placeholder="URL в Figma"
              value={ task.mockup }
              onChange={ handleChange('mockup') }
            />
          </div>
        </div>

        {/* AI‐кнопки */ }
        <div className="ai-controls">
        </div>
      </div>
    </div>
  );
};


// --- Confluence helpers (ID/URL -> pageId) ---
const getConfluencePageId = (raw) =>
{
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

const parseManyPageIds = (rawList) =>
{
  if (!rawList) return [];
  return [...new Set(
    String(rawList)
      .split(/[,\s]+/)
      .map(getConfluencePageId)
      .filter(Boolean)
  )];
};


export default function SolutionPage ({ projects = [] })
{
  const [attachmentsMap, setAttachmentsMap] = useAttachmentsMap('solutionAttachmentsMap');
  const [defaultStand, setDefaultStand] = usePersistentState('defaultStand', '');
  const [defaultEnv, setDefaultEnv] = usePersistentState('defaultEnv', '');
  const [defaultRequirementLink, setDefaultRequirementLink] = usePersistentState('defaultRequirementLink', '');
  const [defaultTestData, setDefaultTestData] = usePersistentState('defaultTestData', '');
  const [defaultMockup, setDefaultMockup] = usePersistentState('defaultMockup', '');

  const [tasks, setTasks] = usePersistentState('solutionTasks', []);
  const [taskGroups, setTaskGroups] = usePersistentState('solutionTaskGroups', []);
  const [jiraProject, setJiraProject] = usePersistentState('jiraProject', '');
  const [jiraPat, setJiraPat] = usePersistentState('jiraPat', '');
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
  const resultsRef = useRef(null);
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
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const [defaultsCollapsed, setDefaultsCollapsed] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [undoDeleteState, setUndoDeleteState] = useState(null);
  const [forceValidationForTaskIndex, setForceValidationForTaskIndex] = useState(null);
  const [showValidationToast, setShowValidationToast] = useState(false);
  const validationToastTimerRef = useRef(null);
  const requestLinkIssue = requestLinkOption?.value || null;
  const [isGenModalOpen, setGenModalOpen] = useState(false);
  const [isReviewModalOpen, setReviewModalOpen] = useState(false);
  const [generatedCases, setGeneratedCases] = useState([]);

  // Логирование изменений generatedCases
  useEffect(() =>
  {
    console.log('SolutionPage: generatedCases state changed:', generatedCases);
    console.log('SolutionPage: generatedCases length:', generatedCases?.length);
  }, [generatedCases]);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [glossaryPageId, setGlossaryPageId] = usePersistentState('glossaryPageId', '');
  const [contextPageIdsInput, setContextPageIdsInput] = usePersistentState('contextPageIdsInput', '');
  const [contextPageIds, setContextPageIds] = usePersistentState('contextPageIds', []);

  const [contextInstruction, setContextInstruction] = usePersistentState('contextInstruction', '');
  const [mainExecutorOption, setMainExecutorOption] =
    usePersistentState('solutionMainExecutor', null);
  const [reviewerOption, setReviewerOption] =
    usePersistentState('solutionReviewer', []);

  const showValidationFailedToast = useCallback(() =>
  {
    if (validationToastTimerRef.current) clearTimeout(validationToastTimerRef.current);
    setShowValidationToast(true);
    validationToastTimerRef.current = setTimeout(() =>
    {
      setShowValidationToast(false);
      validationToastTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() =>
  {
    if (reviewerOption && !Array.isArray(reviewerOption)) {
      setReviewerOption([reviewerOption]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() =>
  {
    if (tasks.length > 0 && tasks[0].selected === undefined) {
      setTasks(ts => ts.map(t => ({ ...t, selected: true })));
    }
  }, [tasks, setTasks]);
  useEffect(() =>
  {
    if (tasks.length === 0) {
      setSelectedTaskIndex(0);
    } else if (selectedTaskIndex >= tasks.length) {
      setSelectedTaskIndex(Math.max(0, tasks.length - 1));
    }
  }, [tasks.length, selectedTaskIndex]);
  useEffect(() =>
  {
    idbSet('__initialized__', true)
      .catch(console.warn);
  }, []);
  useEffect(() =>
  {
    setTasks(ts => ts.map(t => ({ ...t, allureDefect: null })));
  }, [allureProject, setTasks]);
  const cardRefs = useRef([]);
  useEffect(() =>
  {
    // Миграция: если новый массив пуст, но в старом поле есть данные — распарсить
    if (!Array.isArray(contextPageIds) || contextPageIds.length) return;
    const parsed = parseManyPageIds(contextPageIdsInput);
    if (parsed.length) setContextPageIds(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // запускаем один раз

  useEffect(() =>
  {
    cardRefs.current = tasks.map((_, i) => cardRefs.current[i] || React.createRef());
  }, [tasks]);

  const scrollToTask = useCallback((i) =>
  {
    const el = document.getElementById(`task-${i}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const loadLinkTypes = useCallback(async () =>
  {
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

  const loadIssueOptions = async input =>
  {
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


  const buildRequirementsPayload = ({ includeRequirements = false } = {}) =>
  {
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


  const prepareRequirements = () =>
  {
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
  const groupByRows = (items, tol = 2) =>
  {
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
  const detectColumns = (rows, tol = 12) =>
  {
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
  const placeIntoColumns = (cells, colXs, tol = 12) =>
  {
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
  const looksLikeTable = (rows) =>
  {
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
  const joinWithGaps = (cells) =>
  {
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
  const handlePdfUpload = async (file) =>
  {
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



  const [generationTaskId, setGenerationTaskId] = usePersistentState('generationTaskId', null);
  const [generationProgress, setGenerationProgress] = usePersistentState('generationProgress', 0);
  const [generationStatus, setGenerationStatus] = usePersistentState('generationStatus', null);
  const [isGenerationMinimized, setIsGenerationMinimized] = usePersistentState('isGenerationMinimized', false);

  // Состояния для генерации BDD тестов
  const [bddTaskId, setBddTaskId] = usePersistentState('bddTaskId', null);
  const [bddProgress, setBddProgress] = usePersistentState('bddProgress', 0);
  const [bddStatus, setBddStatus] = usePersistentState('bddStatus', null);
  const [isBddMinimized, setIsBddMinimized] = usePersistentState('isBddMinimized', false);
  const [bddResult, setBddResult] = usePersistentState('bddResult', null);
  const [isBddReviewModalOpen, setIsBddReviewModalOpen] = useState(false);

  // Состояния для генерации тестовой модели
  const [modelGenerationTaskId, setModelGenerationTaskId] = usePersistentState('modelGenerationTaskId', null);
  const [modelGenerationProgress, setModelGenerationProgress] = usePersistentState('modelGenerationProgress', 0);
  const [modelGenerationStatus, setModelGenerationStatus] = usePersistentState('modelGenerationStatus', null);
  const [modelIsMinimized, setModelIsMinimized] = usePersistentState('modelIsMinimized', false);
  const [generatedModel, setGeneratedModel] = usePersistentState('generatedModel', null);

  // Автоматически возобновляем проверку статуса при загрузке страницы
  useEffect(() =>
  {
    if (generationTaskId && generationStatus === 'processing') {
      checkGenerationStatus(generationTaskId);
    }
  }, [generationTaskId, generationStatus]);

  // Автоматически возобновляем проверку статуса генерации тестовой модели
  useEffect(() =>
  {
    if (modelGenerationTaskId && modelGenerationStatus === 'processing') {
      checkModelGenerationStatus(modelGenerationTaskId);
    }
  }, [modelGenerationTaskId, modelGenerationStatus]);

  // Автоматически возобновляем проверку статуса BDD генерации
  useEffect(() =>
  {
    if (bddTaskId && bddTaskId !== 'undefined' && bddTaskId !== 'null' && bddStatus === 'processing') {
      checkBddStatus(bddTaskId);
    }
  }, [bddTaskId, bddStatus]);

  // Уведомляем GlobalBackgroundProgress об изменениях состояния
  useEffect(() =>
  {
    window.dispatchEvent(new CustomEvent('updateTestCaseGeneration', {
      detail: {
        status: generationStatus,
        progress: generationProgress,
        taskId: generationTaskId,
        isMinimized: isGenerationMinimized
      }
    }));
  }, [generationStatus, generationProgress, generationTaskId, isGenerationMinimized]);

  useEffect(() =>
  {
    window.dispatchEvent(new CustomEvent('updateTestModelGeneration', {
      detail: {
        status: modelGenerationStatus,
        progress: modelGenerationProgress,
        taskId: modelGenerationTaskId,
        isMinimized: modelIsMinimized
      }
    }));
  }, [modelGenerationStatus, modelGenerationProgress, modelGenerationTaskId, modelIsMinimized]);

  // Загружаем сохраненные BDD результаты при инициализации
  useEffect(() =>
  {
    const loadSavedBddResult = async () =>
    {
      try {
        const saved = await idbGet('bddResult');
        if (saved) {
          setBddResult(saved);
          // Если есть сохраненный результат, но статус не установлен - устанавливаем completed
          const savedStatus = await idbGet('bddStatus');
          if (!savedStatus && saved) {
            setBddStatus('completed');
          }
        }
      } catch (error) {
        console.warn('Ошибка загрузки сохраненных BDD результатов:', error);
      }
    };
    loadSavedBddResult();
  }, []);

  // Загружаем сохраненные тест-кейсы при инициализации (только если нет активной задачи)
  useEffect(() =>
  {
    const loadSavedTestCases = async () =>
    {
      // ✅ ВАЖНО: Сначала загружаем generationTaskId из IndexedDB, так как usePersistentState загружает асинхронно
      let activeTaskId = generationTaskId;
      if (!activeTaskId) {
        try {
          activeTaskId = await idbGet('generationTaskId');
        } catch (error) {
          console.warn('Ошибка загрузки generationTaskId из IndexedDB:', error);
        }
      }

      // ✅ ВАЖНО: Если есть активная задача генерации, НЕ загружаем старые данные из localStorage
      // Вместо этого проверяем статус задачи и загружаем актуальные данные из API
      if (activeTaskId) {
        console.log('SolutionPage: есть активная задача генерации, пропускаем загрузку из localStorage, taskId:', activeTaskId);
        // Проверяем статус задачи
        try {
          await checkGenerationStatus(activeTaskId);
        } catch (error) {
          console.warn('Ошибка проверки статуса активной задачи:', error);
        }
        return;
      }

      // Если нет активной задачи, загружаем из localStorage
      try {
        const savedCases = localStorage.getItem('generatedTestCases');
        console.log('SolutionPage: loading saved test cases:', savedCases);
        if (savedCases) {
          const parsedCases = JSON.parse(savedCases);
          console.log('SolutionPage: parsed saved test cases:', parsedCases);
          console.log('SolutionPage: parsed test cases length:', parsedCases?.length);
          setGeneratedCases(parsedCases);
          setGenerationStatus('completed'); // Устанавливаем статус как завершенный
        }
      } catch (error) {
        console.warn('Ошибка загрузки сохраненных тест-кейсов:', error);
        localStorage.removeItem('generatedTestCases');
      }
    };

    loadSavedTestCases();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Проверяем, нужно ли открыть модальное окно генерации
  useEffect(() =>
  {
    const shouldOpenModal = localStorage.getItem('openGenerationModal');
    if (shouldOpenModal === 'true') {
      // Очищаем флаг
      localStorage.removeItem('openGenerationModal');
      // Открываем модальное окно генерации тестовой модели
      // Это будет обработано в GlobalGenerationWindow
      window.dispatchEvent(new CustomEvent('openGenerationModal'));
    }
  }, []);

  const checkGenerationStatus = async (taskId) =>
  {
    try {
      // ✅ Добавляем параметр ?nocache=true для принудительной очистки кэша на сервере
      // Это гарантирует, что мы получим актуальные данные, а не закэшированные
      const { data } = await axios.get(`${config.serverUrl}/generate-test-cases-status/${taskId}?nocache=${Date.now()}`);
      setGenerationProgress(data.progress);
      setGenerationStatus(data.status);

      if (data.status === 'completed') {
        console.log('SolutionPage: received test cases from server:', data.result.testCases);
        console.log('SolutionPage: test cases length:', data.result.testCases?.length);
        console.log('SolutionPage: first test case:', data.result.testCases?.[0]);
        // ✅ ВАЖНО: Очищаем старые данные из localStorage перед сохранением новых
        localStorage.removeItem('generatedTestCases');
        setGeneratedCases(data.result.testCases);
        // Сохраняем результат в localStorage
        localStorage.setItem('generatedTestCases', JSON.stringify(data.result.testCases));
        setReviewModalOpen(true);
        setGenerationTaskId(null);
        setGenerationProgress(100);
        setGenerationStatus('completed'); // Не сбрасываем статус, а устанавливаем 'completed'
        setIsGenerationMinimized(false); // Показать модальное окно при завершении

        // Очищаем временные данные генерации (батчим операции)
        await Promise.all([
          idbSet('generationTaskId', null),
          idbSet('generationProgress', 0),
          idbSet('generationStatus', null),
          idbSet('isGenerationMinimized', false)
        ]);

        // Показать уведомление о завершении
        if (window.Notification && Notification.permission === 'granted') {
          new Notification('Генерация завершена', {
            body: 'Тест-кейсы успешно сгенерированы',
            icon: '/favicon.ico'
          });
        }
      } else if (data.status === 'failed') {
        alert('Ошибка генерации тест-кейсов: ' + (data.error_message || 'Неизвестная ошибка'));
        setGenerationTaskId(null);
        setGenerationProgress(0);
        setGenerationStatus(null);
      } else if (data.status === 'processing') {
        // Продолжаем опрашивать статус каждые 5 секунд (оптимизация)
        setTimeout(() =>
        {
          if (generationTaskId === taskId) {
            checkGenerationStatus(taskId);
          }
        }, 5000);
      }
    } catch (err) {
      console.error('Ошибка проверки статуса:', err);
      // Простая обработка ошибок - останавливаем опрос при любой ошибке
      alert('Ошибка проверки статуса генерации: ' + (err.response?.data?.error || err.message));
      setGenerationTaskId(null);
      setGenerationProgress(0);
      setGenerationStatus(null);
    }
  };

  // Функция для отмены генерации
  const cancelGeneration = useCallback(async (taskId, type) =>
  {
    try {
      const response = await fetch(`/api/cancel-generation/${taskId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        console.log(`${type} отменена`);
        // Сбрасываем состояние
        if (type === 'test_cases') {
          setGenerationTaskId(null);
          setGenerationProgress(0);
          setGenerationStatus(null);
          setIsGenerationMinimized(false);
        } else if (type === 'test_model') {
          setModelGenerationTaskId(null);
          setModelGenerationProgress(0);
          setModelGenerationStatus(null);
          setModelIsMinimized(false);
        }
      } else {
        console.error('Ошибка отмены генерации');
      }
    } catch (error) {
      console.error('Ошибка отмены генерации:', error);
    }
  }, []);

  // Добавляем функцию отмены в window для глобального доступа
  useEffect(() =>
  {
    window.cancelGeneration = cancelGeneration;
    return () =>
    {
      delete window.cancelGeneration;
    };
  }, [cancelGeneration]);

  // Проверка статуса генерации тестовой модели
  const checkModelGenerationStatus = async (taskId) =>
  {
    try {
      const { data } = await axios.get(`${config.serverUrl}/generate-test-model-status/${taskId}`);
      setModelGenerationProgress(data.progress);
      setModelGenerationStatus(data.status);

      if (data.status === 'completed') {
        setModelGenerationTaskId(null);
        setModelGenerationProgress(100);
        setModelGenerationStatus('completed');
        setModelIsMinimized(false);

        // Сохраняем результат в IndexedDB и состояние
        if (data.result && data.result.testModel) {
          await idbSet('generatedTestModel', data.result.testModel);
          setGeneratedModel(data.result.testModel);
          console.log('Тестовая модель сохранена в IndexedDB и состояние');
        }

        // Очищаем временные данные генерации (батчим операции)
        await Promise.all([
          idbSet('modelGenerationTaskId', null),
          idbSet('modelGenerationProgress', 0),
          idbSet('modelGenerationStatus', null),
          idbSet('modelIsMinimized', false)
        ]);

        // Показать уведомление о завершении
        if (window.Notification && Notification.permission === 'granted') {
          new Notification('Генерация тестовой модели завершена', {
            body: 'Тестовая модель успешно сгенерирована',
            icon: '/favicon.ico'
          });
        }
      } else if (data.status === 'failed') {
        alert('Ошибка генерации тестовой модели: ' + (data.error_message || 'Неизвестная ошибка'));
        setModelGenerationTaskId(null);
        setModelGenerationProgress(0);
        setModelGenerationStatus(null);
      } else if (data.status === 'processing') {
        // Продолжаем опрашивать статус каждые 5 секунд (оптимизация)
        setTimeout(() =>
        {
          if (modelGenerationTaskId === taskId) {
            checkModelGenerationStatus(taskId);
          }
        }, 5000);
      }
    } catch (err) {
      console.error('Ошибка проверки статуса генерации тестовой модели:', err);
      // Простая обработка ошибок - останавливаем опрос при любой ошибке
      alert('Ошибка проверки статуса генерации тестовой модели: ' + (err.response?.data?.error || err.message));
      setModelGenerationTaskId(null);
      setModelGenerationProgress(0);
      setModelGenerationStatus(null);
    }
  };

  const handleGenerateModel = async (modelStructure, includeBackendTests = true) =>
  {
    trackEvent('generate_test_model', { page: '/solution', projectId: allureProject?.id, taskId: confluencePageId });
    console.log('SolutionPage: получена структура тестовой модели для генерации тест-кейсов:', modelStructure);
    console.log('SolutionPage: количество features в структуре:', modelStructure?.length);
    console.log('SolutionPage: includeBackendTests:', includeBackendTests);

    const payloadBase = buildRequirementsPayload({ includeRequirements: true });

    // Запрашиваем разрешение на уведомления
    if (window.Notification && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    try {
      // ОЧИЩАЕМ СТАРЫЕ ДАННЫЕ ПЕРЕД ГЕНЕРАЦИЕЙ
      console.log('Очищаем старые данные перед генерацией новых тест-кейсов...');
      setGeneratedCases([]);
      localStorage.removeItem('generatedTestCases');
      setGenerationStatus(null);

      // Сначала пробуем асинхронный API
      try {
        const payload = {
          ...payloadBase,
          modelStructure,
          includeBackendTests: includeBackendTests !== false, // ✅ Передаём флаг включения backend тестов
          ...(allureProject ? { projectId: allureProject } : {})  // ✅ Добавляем projectId для shared steps
        };
        console.log('SolutionPage: отправляем payload с modelStructure:', payload);

        const { data } = await axios.post(
          `${config.serverUrl}/generate-test-cases-async`,
          payload, {
          headers: {
            'Content-Type': 'application/json'
          }
        }
        );

        setGenerationTaskId(data.taskId);
        setGenerationProgress(0);
        setGenerationStatus('processing');
        checkGenerationStatus(data.taskId);
        return;
      } catch (asyncErr) {
        console.warn('Async API failed, falling back to sync:', asyncErr);
        // Fallback к синхронному API
      }

      // Fallback к старому синхронному API
      const { data } = await axios.post(
        `${config.serverUrl}/generate-test-cases`,
        { ...payloadBase, modelStructure }, {
        headers: {
          'Content-Type': 'application/json'
        }
      }
      );
      setGeneratedCases(data.cases);
      setReviewModalOpen(true);
    } catch (err) {
      console.error('generate-test-cases error:', err);
      alert('Ошибка генерации тест-кейсов: ' + (err.response?.data?.error || err.message));
    }
  };

  // Проверка статуса BDD генерации
  const checkBddStatus = async (taskId) =>
  {
    // Проверяем, что taskId валиден
    if (!taskId || taskId === 'undefined' || taskId === 'null') {
      console.warn('[BDD] checkBddStatus вызван с невалидным taskId:', taskId);
      return;
    }

    try {
      const { data } = await axios.get(`${config.bddServerUrl || config.serverUrl}/api/bdd/status/${taskId}?nocache=${Date.now()}`, {
        timeout: 30000
      });
      setBddProgress(data.progress || 0);
      setBddStatus(data.status);

      if (data.status === 'completed') {
        console.log('BDD генерация завершена:', data.result);

        // Сохраняем результат
        if (data.result) {
          setBddResult(data.result);
          await idbSet('bddResult', data.result);
        }

        setBddTaskId(null);
        setBddProgress(100);
        setBddStatus('completed');
        setIsBddMinimized(false);

        // Очищаем временные данные задачи, но сохраняем результат
        await Promise.all([
          idbSet('bddTaskId', null),
          idbSet('bddProgress', 0),
          idbSet('isBddMinimized', false)
        ]);

        // Открываем модальное окно для просмотра результатов
        setIsBddReviewModalOpen(true);

        // Показать уведомление
        if (window.Notification && Notification.permission === 'granted') {
          new Notification('BDD генерация завершена', {
            body: 'BDD тесты успешно сгенерированы',
            icon: '/favicon.ico'
          });
        }
      } else if (data.status === 'failed') {
        alert('Ошибка BDD генерации: ' + (data.error_message || 'Неизвестная ошибка'));
        setBddTaskId(null);
        setBddProgress(0);
        setBddStatus(null);
      } else if (data.status === 'processing') {
        // Продолжаем опрашивать статус
        setTimeout(() =>
        {
          if (bddTaskId === taskId) {
            checkBddStatus(taskId);
          }
        }, 5000);
      }
    } catch (err) {
      console.error('Ошибка проверки статуса BDD:', err);
      alert('Ошибка проверки статуса BDD генерации: ' + (err.response?.data?.error || err.message));
      setBddTaskId(null);
      setBddProgress(0);
      setBddStatus(null);
    }
  };

  // Функция для регенерации BDD тестов (очищает старые результаты и запускает новую генерацию)
  const handleRegenerateBDD = async () =>
  {
    // Закрываем модальное окно
    setIsBddReviewModalOpen(false);

    // Очищаем старые результаты
    setBddResult(null);
    setBddStatus(null);
    setBddTaskId(null);
    setBddProgress(0);

    await Promise.all([
      idbSet('bddResult', null),
      idbSet('bddStatus', null),
      idbSet('bddTaskId', null),
      idbSet('bddProgress', 0)
    ]);

    // Запускаем новую генерацию
    await handleGenerateBDDInternal();
  };

  // Внутренняя функция для генерации BDD тестов (без проверки на существующие результаты)
  const handleGenerateBDDInternal = async () =>
  {

    const payloadBase = buildRequirementsPayload({ includeRequirements: true });

    // Запрашиваем разрешение на уведомления
    if (window.Notification && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    try {
      const payload = {
        ...payloadBase,
        ...(allureProject ? { projectId: typeof allureProject === 'string' ? allureProject : allureProject.id } : {})
      };

      console.log('BDD: отправляем запрос на генерацию:', payload);

      const { data } = await axios.post(
        `${config.bddServerUrl || config.serverUrl}/api/bdd/generate`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      setBddTaskId(data.taskId);
      setBddProgress(0);
      setBddStatus('processing');
      checkBddStatus(data.taskId);
    } catch (err) {
      console.error('BDD генерация error:', err);
      alert('Ошибка запуска BDD генерации: ' + (err.response?.data?.error || err.message));
    }
  };

  // Функция для генерации BDD тестов (публичная, с проверкой на существующие результаты)
  const handleGenerateBDD = async () =>
  {
    // Если уже есть завершенные результаты - открываем превью
    if (bddStatus === 'completed' && bddResult) {
      setIsBddReviewModalOpen(true);
      return;
    }

    // Иначе запускаем генерацию
    await handleGenerateBDDInternal();
  };

  // вызывается из ревью, отправляет финальный список в Allure и закрывает
  const handleConfirmSend = finalCases =>
  {
    // … тут ваша логика отправки в Allure …
    console.log('Отправляем в Allure:', finalCases);
    setReviewModalOpen(false);
  };

  // Очищает все сохраненные состояния ревью тест-кейсов в localStorage
  const clearReviewState = useCallback(() =>
  {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('testCasesReview_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      if (keysToRemove.length > 0) {
        console.log(`Очищено ${keysToRemove.length} сохраненных состояний модалки тест-кейсов`);
      }
    } catch (err) {
      console.warn('Ошибка при очистке localStorage модалки:', err);
    }
  }, []);

  // Функция для очистки состояния тест-кейсов
  const handleClearTestCases = useCallback(() =>
  {
    if (window.confirm('Вы уверены, что хотите удалить все сгенерированные тест-кейсы? Это действие нельзя отменить.')) {
      setGeneratedCases([]);
      setGenerationStatus(null);
      setGenerationTaskId(null);
      setGenerationProgress(0);
      setIsGenerationMinimized(false);

      // Очищаем сохраненные данные
      localStorage.removeItem('generatedTestCases');
      clearReviewState();

      // Очищаем данные из IndexedDB
      idbSet('generationTaskId', null).catch(console.warn);
      idbSet('generationProgress', 0).catch(console.warn);
      idbSet('generationStatus', null).catch(console.warn);
      idbSet('isGenerationMinimized', false).catch(console.warn);

      console.log('Состояние тест-кейсов очищено');
    }
  }, [clearReviewState]);

  // Функция для очистки состояния тестовой модели
  const handleClearTestModel = useCallback(() =>
  {
    if (window.confirm('Вы уверены, что хотите удалить сгенерированную тестовую модель? Это действие нельзя отменить.')) {
      setGeneratedModel(null);
      setModelGenerationStatus(null);
      setModelGenerationTaskId(null);
      setModelGenerationProgress(0);
      setModelIsMinimized(false);

      // Очищаем данные из IndexedDB
      idbSet('generatedTestModel', null).catch(console.warn);
      idbSet('testModelTree', null).catch(console.warn);
      idbSet('modelGenerationTaskId', null).catch(console.warn);
      idbSet('modelGenerationProgress', 0).catch(console.warn);
      idbSet('modelGenerationStatus', null).catch(console.warn);
      idbSet('modelIsMinimized', false).catch(console.warn);

      console.log('Состояние тестовой модели очищено');
    }
  }, []);

  const loadMeta = useCallback(async () =>
  {
    if (!debProject || !debPat) return;
    setIsMetaLoading(true); setMetaError('');
    try {
      const { data } = await axios.post(`${config.serverUrl}/jira/meta`, { projectKey: debProject, pat: debPat, issueTypeId: '12812' });
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

  const loadTransitions = useCallback(async () =>
  {
    if (!debProject || !debPat) return;
    try {
      const sample = 'JMT-15044';
      const { data } = await axios.get(`${config.serverUrl}/jira/transitions`, { params: { issueKey: sample, pat: jiraPat } });
      setTransitions(data);
    } catch { console.warn('Не удалось загрузить transitions'); }
  }, [debProject, debPat]);
  useEffect(() => { if (modalOpen) loadTransitions(); }, [modalOpen, loadTransitions]);

  useEffect(() =>
  {
    if (results.length > 0 && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [results]);

  useEffect(() =>
  {
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

  const loadDefectOptions = async (projectId, input) =>
  {
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

  const fetchDefectDetails = async (idx, defectId) =>
  {
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

  const handleFillAllWithAI = async () =>
  {
    trackEvent('fill_all_ai', { page: '/solution', projectId: allureProject?.id, taskId: jiraProject });
    if (!jiraProject || !jiraPat) {
      alert('Сначала укажите Project Key и Jira PAT');
      return;
    }
    setAiFillAllLoading(true);
    try {
      const updated = await Promise.all(tasks.map(async (t) =>
      {
        if (!t.selected) return t;
        const payload = {
          summary: t.summary,
          description: t.description,
          steps: t.steps,
          stand: t.stand,
          env: t.env,
          pat: jiraPat,
          projectKey: jiraProject,
          issueTypeId: '12812'
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

  const fillFieldsWithAI = async idx =>
  {
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
        projectKey: jiraProject,
        issueTypeId: '12812'
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

  const runAi = async idx =>
  {
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

  const handleAdd = (groupId) =>
  {
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

    const newTask = {
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
      ...(groupId ? { groupId } : {}),
    };

    let insertIdx = 0;
    if (groupId) {
      let lastIdx = -1;
      tasks.forEach((t, i) => { if (t.groupId === groupId) lastIdx = i; });
      if (lastIdx >= 0) insertIdx = lastIdx + 1;
    }

    setTasks(prev =>
    {
      if (insertIdx > 0) {
        const next = [...prev];
        next.splice(insertIdx, 0, newTask);
        return next;
      }
      return [newTask, ...prev];
    });

    setSelectedTaskIndex(insertIdx);

    setCollapsedStates(prev =>
    {
      const next = {};
      Object.entries(prev).forEach(([key, val]) =>
      {
        const k = Number(key);
        next[k >= insertIdx ? k + 1 : k] = val;
      });
      next[insertIdx] = false;
      return next;
    });
  };

  const handleDelete = i =>
  {
    const deleted = tasks[i];
    setTasks(ts => ts.filter((_, idx) => idx !== i));
    setCollapsedStates(prev =>
    {
      const newStates = {};
      Object.keys(prev).forEach(key =>
      {
        const intKey = parseInt(key, 10);
        if (intKey < i) {
          newStates[intKey] = prev[key];
        } else if (intKey > i) {
          newStates[intKey - 1] = prev[key];
        }
      });
      return newStates;
    });
    if (deleted?.groupId) {
      const remaining = tasks.filter((t, idx) => idx !== i && t.groupId === deleted.groupId).length;
      if (remaining <= 1) {
        setTaskGroups(gs => gs.filter(g => g.id !== deleted.groupId));
        setTasks(ts => ts.map(t => t.groupId === deleted.groupId ? { ...t, groupId: undefined } : t));
      }
    }
  };

  const handleDeleteWithUndo = i =>
  {
    const deleted = tasks[i];
    handleDelete(i);
    setUndoDeleteState({ task: deleted, index: i });
  };

  const handleRestoreTask = () =>
  {
    if (!undoDeleteState) return;
    const { task, index } = undoDeleteState;
    setTasks(ts => [...ts.slice(0, index), task, ...ts.slice(index)]);
    setCollapsedStates(prev =>
    {
      const newStates = {};
      Object.keys(prev).forEach(key =>
      {
        const intKey = parseInt(key, 10);
        if (intKey < index) newStates[intKey] = prev[key];
        else if (intKey >= index) newStates[intKey + 1] = prev[key];
      });
      return newStates;
    });
    setSelectedTaskIndex(index);
    setUndoDeleteState(null);
  };

  const handleUpdate = (i, upd) =>
  {
    if (forceValidationForTaskIndex === i) setForceValidationForTaskIndex(null);
    setTasks(ts => ts.map((t, idx) => idx === i ? upd : t));
  };

  const handleDeleteSelected = () =>
  {
    let remaining = tasks.filter(t => !t.selected);
    const keptIndices = tasks.map((t, i) => t.selected ? -1 : i).filter(i => i >= 0);

    const groupCounts = {};
    remaining.forEach(t => { if (t.groupId) groupCounts[t.groupId] = (groupCounts[t.groupId] || 0) + 1; });
    const toDissolve = new Set(taskGroups.filter(g => (groupCounts[g.id] || 0) <= 1).map(g => g.id));
    if (toDissolve.size > 0) {
      remaining = remaining.map(t => toDissolve.has(t.groupId) ? { ...t, groupId: undefined } : t);
      setTaskGroups(gs => gs.filter(g => !toDissolve.has(g.id)));
    }

    setTasks(remaining);
    setCollapsedStates(prev =>
    {
      const next = {};
      keptIndices.forEach((oldIdx, newIdx) =>
      {
        if (prev[oldIdx] !== undefined) next[newIdx] = prev[oldIdx];
      });
      return next;
    });
    setSelectedTaskIndex(remaining.length ? Math.min(selectedTaskIndex, remaining.length - 1) : -1);
    setDeleteModalOpen(false);
  };

  const handleToggleCollapse = index =>
  {
    setCollapsedStates(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleAnalyzeSolution = async () =>
  {
    trackEvent('ai_analyze_requirements', { page: '/solution', projectId: allureProject?.id, taskId: confluencePageId });
    setLoading(true);
    setAnalysisResult(null);

    // единый билдер уже:
    // - берет contextPageIds (из мультиселекта) И/ИЛИ contextPageIdsInput
    // - вынимает из URL чистые pageId
    // - делает dedup
    // - подставляет bearerToken при наличии
    const payload = buildRequirementsPayload({ includeRequirements: false });

    try {
      const resp = await axios.post(`${config.serverUrl}/analyze/solution`, payload);
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



  const parseDocumentationErrors = (response) =>
  {
    if (!response) return [];
    const blocks = response.split('```').filter((_, i) => i % 2 === 1);

    return blocks.map(block =>
    {
      const lines = block.trim().split('\n');
      const requirement = lines.find(l => l.startsWith('###'))?.replace(/^###\s*/, '').trim() || '';

      const getField = (label) =>
      {
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

  const handleCreateAll = async () =>
  {
    trackEvent('create_jira_tasks', { page: '/solution', projectId: allureProject?.id, taskId: jiraProject, extra: { count: tasks.filter(t => t.selected).length } });
    setCreating(true);
    setResults([]);
    const out = [];

    for (const t of tasks.filter(t => t.selected)) {
      const propsBlock = formatPropertiesForJira(t.properties);
      const desc = `h3. Исходное требование\n${t.requirement}\n\nh3. Описание проблемы\n${t.description || '(не заполнено)'}\n\nh3. Нарушенные свойства\n${propsBlock}\n\nh3. Фактический результат\n{quote}${t.actual || '(не заполнено)'}{quote}\n\nh3. Ожидаемый результат\n{quote}${t.expected || '(не заполнено)'}{quote}\n*Макет:* ${t.mockup || 'не указано'}\n*Ссылка на требование:* ${t.requirementLink || 'не указано'}`;

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
  const showScrollTop = useShowScrollTop();
  const filteredLinkTypes = linkTypes.filter(o =>
    allowedLinkNames.includes(o.value)
  );
  const canAnalyze = (inputMode === 'text' ? solutionText.trim() : confluencePageId.trim()) && !loading;

  return (
    <ErrorBoundary>
      <div className="solution-page">
        <button
          className="btn btn-secondary page-nav-back"
          onClick={ () => navigate('/') }
        >
          ← Назад
        </button>
        <h1>Тестирование требований</h1>

        <section className="page-section">
          <div className="page-section-header">
            <h2>Настройки подключения</h2>
            <div className="page-section-header-right">
              <button
                type="button"
                className="btn btn-link"
                onClick={ async () =>
                {
                  if (window.confirm('Вы уверены, что хотите очистить все задачи и настройки? Это действие необратимо.')) {
                    await idbClear(); window.location.reload();
                  }
                } }
              >
                Очистить всё
              </button>
            </div>
          </div>
          <div className="settings-grid">
            <div className="field">
              <label>Project Key (Jira)</label>
              <input type="text" value={ jiraProject } onChange={ e => setJiraProject(e.target.value.toUpperCase()) } required placeholder="PROJ" />
            </div>
            <div className="field">
              <label>Jira PAT (Personal Access Token)</label>
              <input type="password" value={ jiraPat } onChange={ e => setJiraPat(e.target.value) } placeholder="Ваш токен доступа Jira" />
            </div>
            <div className="field">
              <label>Проект Allure</label>
              <Select
                classNamePrefix="select"
                placeholder="Выберите проект Allure…"
                options={ projects.map(p => ({ value: p.id, label: p.name })) }
                value={
                  projects
                    .map(p => ({ value: p.id, label: p.name }))
                    .find(o => o.value === allureProject) || null
                }
                isClearable
                onChange={ opt => setAllureProject(opt?.value || '') }
                styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                menuPortalTarget={ document.body }
              />
            </div>
          </div>

          { isMetaLoading && <p className="status-message loading">Загрузка метаданных Jira…</p> }
          { metaError && <p className="status-message error">{ metaError }</p> }
          { ready && <p className="status-message success">Метаданные Jira успешно загружены</p> }
        </section>

        <div className="input-area">
          <div className="input-tabs">
            <button type="button" className={ inputMode === 'confluence' ? 'active' : '' } onClick={ () => setInputMode('confluence') }>Загрузить из Confluence</button>
            <button type="button" className={ inputMode === 'text' ? 'active' : '' } onClick={ () => setInputMode('text') }>Вставить текст</button>
            <button type="button" className={ inputMode === 'pdf' ? 'active' : '' } onClick={ () => setInputMode('pdf') }>Загрузить PDF</button>
          </div>

          { inputMode === 'pdf' && (
            <div className="pdf-inputs">
              <input type="file" accept="application/pdf"
                onChange={ e => e.target.files?.[0] && handlePdfUpload(e.target.files[0]) } />
              { pdfExtracting && <p>Извлекается текст из PDF…</p> }
            </div>
          ) }

          { inputMode === 'text' ? (
            <div className="md-split">
              <textarea
                placeholder="Вставьте текст требований для анализа..."
                value={ solutionText }
                onChange={ e => setSolutionText(e.target.value) }
                rows={ 3 }
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
                value={ confluencePageId }
                onChange={ e => setConfluencePageId(e.target.value) }
              />
              <input
                type="password"
                placeholder="Ваш Bearer токен для Confluence"
                name="confluenceToken"
                autoComplete="new-password"
                value={ bearerToken }
                onChange={ e => setBearerToken(e.target.value) }
              />

            </div>


          ) }
          {/* --- Глоссарий для всех режимов --- */ }
          <div className="confluence-inputs">
            <input
              type="text"
              placeholder="Глоссарий: Confluence Page ID или URL (необязательно)"
              value={ glossaryPageId }
              onChange={ e => setGlossaryPageId(e.target.value) }
            />
          </div>
          {/* --- Доп. контекст только для text и pdf --- */ }
          { (inputMode === 'text' || inputMode === 'pdf') && (
            <div className="confluence-inputs">
              <div className="ctx-select">
                <CreatableSelect
                  classNamePrefix="select"
                  isMulti
                  placeholder="Доп. контекст: добавьте Page ID/URL и нажмите Enter"
                  value={ (contextPageIds || []).map(v => ({ value: v, label: v })) }
                  onChange={ (opts) =>
                  {
                    const vals = (opts || []).map(o => o.value);
                    setContextPageIds(vals);
                    // дополнительная синхронизация "на всякий":
                    setContextPageIdsInput(vals.length ? vals.join(' ') : '');
                  } }
                  onCreateOption={ (inputValue) => setContextPageIds([...(contextPageIds || []), inputValue]) }
                  formatCreateLabel={ (inputValue) => `Добавить: ${inputValue}` }
                  menuPortalTarget={ document.body }
                  menuPosition="fixed"
                  styles={ {
                    container: (base) => ({ ...base, width: '100%' }),
                    control: (base) => ({ ...base, minHeight: 44 }),
                    valueContainer: (base) => ({
                      ...base,
                      flexWrap: 'nowrap',     // чтобы чипы не ломались в столбик
                      overflowX: 'auto',      // горизонтальный скролл, если много ID
                    }),
                    multiValue: (base) => ({ ...base, marginRight: 8 }),
                    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                  } }
                />
              </div>

              <textarea
                className="context-input"
                placeholder="Инструкция к доп. контексту: что именно брать из ссылок (напр.: 'используй только разделы «Термины» и «Ограничения»')"
                value={ contextInstruction }
                onChange={ e => setContextInstruction(e.target.value) }
                rows={ 2 }
              />
            </div>
          ) }

          <button className="analyze-button" onClick={ handleAnalyzeSolution } disabled={ !canAnalyze }>
            { loading ? 'Анализируется...' : 'Запустить AI-анализ' }
          </button>
        </div>

        { loading && <PhraseLoader /> }
        { analysisResult?.error && <div className="error-message">Ошибка: { analysisResult.error }</div> }

        {/* Глобальное окно генерации */ }
        <GlobalGenerationWindow
          projects={ projects }
          buildRequirementsPayload={ buildRequirementsPayload }
          prepareRequirements={ prepareRequirements }
          inputMode={ inputMode }
          solutionText={ solutionText }
          confluencePageId={ confluencePageId }
          bearerToken={ bearerToken }
          glossary={ glossary }
          glossaryPageId={ glossaryPageId }
          contextText={ contextText }
          contextPageIds={ contextPageIds }
          contextInstruction={ contextInstruction }
          tasks={ tasks }
          // Состояния генерации
          generationTaskId={ generationTaskId }
          setGenerationTaskId={ setGenerationTaskId }
          generationProgress={ generationProgress }
          setGenerationProgress={ setGenerationProgress }
          generationStatus={ generationStatus }
          setGenerationStatus={ setGenerationStatus }
          isGenerationMinimized={ isGenerationMinimized }
          setIsGenerationMinimized={ setIsGenerationMinimized }
          generatedCases={ generatedCases }
          setGeneratedCases={ setGeneratedCases }
          checkGenerationStatus={ checkGenerationStatus }
          handleGenerateModel={ handleGenerateModel }
          // Состояния генерации тестовой модели
          modelGenerationTaskId={ modelGenerationTaskId }
          setModelGenerationTaskId={ setModelGenerationTaskId }
          modelGenerationProgress={ modelGenerationProgress }
          setModelGenerationProgress={ setModelGenerationProgress }
          modelGenerationStatus={ modelGenerationStatus }
          setModelGenerationStatus={ setModelGenerationStatus }
          modelIsMinimized={ modelIsMinimized }
          setModelIsMinimized={ setModelIsMinimized }
          checkModelGenerationStatus={ checkModelGenerationStatus }
          generatedModel={ generatedModel }
          cancelGeneration={ cancelGeneration }
          jiraProject={ jiraProject }
          allureProject={ allureProject ? (typeof allureProject === 'string' ? { id: allureProject } : allureProject) : null }
          jiraPat={ jiraPat }
          reviewModalOpen={ isReviewModalOpen }
          setReviewModalOpen={ setReviewModalOpen }
          onClearTestCases={ handleClearTestCases }
          onClearTestModel={ handleClearTestModel }
          clearReviewState={ clearReviewState }
          // BDD генерация
          handleGenerateBDD={ handleGenerateBDD }
          bddTaskId={ bddTaskId }
          bddProgress={ bddProgress }
          bddStatus={ bddStatus }
          bddReviewModalOpen={ isBddReviewModalOpen }
          setBddReviewModalOpen={ setIsBddReviewModalOpen }
          bddResult={ bddResult }
          onRegenerateBDD={ handleRegenerateBDD }
        />


        <div className="bug-report-layout">
          { tasks.length > 0 && (
            <div className="task-area-left">
              <button
                className="collapse-toggle"
                onClick={ () => setDefaultsCollapsed(prev => !prev) }
              >
                <span className="collapse-toggle-text">Значения по умолчанию</span>
                <svg className={ `collapse-toggle-icon ${defaultsCollapsed ? 'collapsed' : ''}` } width="14" height="14" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 3l3 4 3-4" />
                </svg>
              </button>
              <div className={ `defaults-panel ${defaultsCollapsed ? 'collapsed' : ''}` }>
                <div className="field-group">
                  <div className="field full-width">
                    <label>Ссылка на требование</label>
                    <input
                      type="text"
                      placeholder="URL в Confluence"
                      value={ defaultRequirementLink }
                      onChange={ e =>
                      {
                        const v = e.target.value;
                        setDefaultRequirementLink(v);
                        setTasks(ts => ts.map(t => ({ ...t, requirementLink: v })));
                      } }
                    />
                  </div>
                  <div className="field full-width">
                    <label>Макет</label>
                    <input
                      type="text"
                      placeholder="URL в Figma"
                      value={ defaultMockup }
                      onChange={ e =>
                      {
                        const v = e.target.value;
                        setDefaultMockup(v);
                        setTasks(ts => ts.map(t => ({ ...t, mockup: v })));
                      } }
                    />
                  </div>
                </div>
              </div>
              <div className={ `task-controls-wrapper${selectedTasksCount > 0 ? ' expanded' : ''}` }>
                <div className="task-controls">
                  <button
                    className="btn btn-primary"
                    disabled={ !ready }
                    onClick={ () =>
                    {
                      if (selectedTasksCount === 0) return;
                      const firstInvalidIdx = tasks.findIndex((t, i) => t.selected && getFirstInvalidFieldId(t, i));
                      if (firstInvalidIdx >= 0) {
                        const firstInvalidId = getFirstInvalidFieldId(tasks[firstInvalidIdx], firstInvalidIdx);
                        showValidationFailedToast();
                        setForceValidationForTaskIndex(firstInvalidIdx);
                        setSelectedTaskIndex(firstInvalidIdx);
                        requestAnimationFrame(() =>
                        {
                          const el = document.getElementById(firstInvalidId);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        });
                        return;
                      }
                      setResults([]);
                      setModalOpen(true);
                    } }
                  >
                    Создать в Jira ({ selectedTasksCount })
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={ () => setDeleteModalOpen(true) }
                  >
                    Удалить
                  </button>
                </div>
              </div>
              <TaskSidebar
                tasks={ tasks }
                setTasks={ setTasks }
                groups={ taskGroups }
                setGroups={ setTaskGroups }
                selectedTaskIndex={ selectedTaskIndex }
                setSelectedTaskIndex={ setSelectedTaskIndex }
                onAdd={ handleAdd }
                onUpdate={ handleUpdate }
              />
            </div>
          ) }
          <div className="task-details">
            { tasks.length === 0 ? (
              <div className="task-details-empty">
                <p>Здесь пока ничего нет</p>
                <button type="button" className="btn btn-primary" onClick={ handleAdd }>
                  Добавить задачу
                </button>
              </div>
            ) : selectedTaskIndex >= 0 && selectedTaskIndex < tasks.length ? (
              <div className="task-list" id={ `task-${selectedTaskIndex}` } ref={ cardRefs.current[selectedTaskIndex] }>
                <SolutionCard
                  index={ selectedTaskIndex }
                  task={ tasks[selectedTaskIndex] }
                  onUpdate={ handleUpdate }
                  onDelete={ handleDeleteWithUndo }
                  fieldOptions={ fieldOptions }
                  loadDefectOptions={ loadDefectOptions }
                  allureProject={ allureProject }
                  onDefectSelect={ fetchDefectDetails }
                  runAi={ runAi }
                  aiLoading={ aiLoading[selectedTaskIndex] }
                  fillFieldsWithAI={ fillFieldsWithAI }
                  aiFillLoading={ aiFillLoading[selectedTaskIndex] || false }
                  isCollapsed={ false }
                  onToggleCollapse={ handleToggleCollapse }
                  setAttachmentsMap={ setAttachmentsMap }
                  attachmentsMap={ attachmentsMap }
                  forceValidation={ forceValidationForTaskIndex === selectedTaskIndex }
                />
              </div>
            ) : null }
          </div>
        </div>

        { deleteModalOpen && (
          <div
            className="modal"
            onClick={ e => { if (e.target === e.currentTarget) setDeleteModalOpen(false); } }
          >
            <div className="modal-content" onClick={ e => e.stopPropagation() }>
              <h1>Удалить задачи?</h1>
              <ul className="delete-modal-list">
                { tasks.filter(t => t.selected).map((t, i) => (
                  <li key={ i }>{ t.summary || 'Без темы' }</li>
                )) }
              </ul>
              <div className="buttons" style={ { display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: 16 } }>
                <button className="btn btn-secondary" onClick={ handleDeleteSelected }>
                  Да, удалить
                </button>
                <button className="btn btn-primary" onClick={ () => setDeleteModalOpen(false) }>
                  Нет
                </button>
              </div>
            </div>
          </div>
        ) }

        { modalOpen && (
          <div
            className="modal"
            onClick={ e => { if (e.target === e.currentTarget) setModalOpen(false); } }
          >
            <div className="modal-content" onClick={ e => e.stopPropagation() }>
              <button className="modal-close-btn" onClick={ () => setModalOpen(false) }>×</button>
              <h2>2. Общие поля для ({ selectedTasksCount }) { tasksWord(selectedTasksCount, 'genitive') }</h2>
              <fieldset disabled={ !ready || creating } className="common-fields-group">
                <legend>Общие поля Jira</legend>

                <div className="field full-width">
                  <label>Epic Link</label>
                  <AsyncSelect
                    classNamePrefix="select"
                    cacheOptions
                    defaultOptions
                    loadOptions={ loadIssueOptions }
                    placeholder="Начните вводить Epic Link…"
                    value={ epicOption }
                    onChange={ opt => setEpicOption(opt) }
                    noOptionsMessage={ () => 'Нет совпадений' }
                    isClearable
                  />
                </div>

                <div className="field">
                  <label>Исполнитель (необязательно)</label>
                  <AsyncSelect
                    classNamePrefix="select"
                    cacheOptions
                    defaultOptions
                    loadOptions={ loadUserOptions }
                    placeholder="Начните вводить имя…"
                    value={ assigneeOption }
                    onChange={ opt => setAssigneeOption(opt) }
                    noOptionsMessage={ () => 'Нет совпадений' }
                    isClearable
                  />
                </div>
                <div className="field">
                  <label>Основной исполнитель</label>
                  <AsyncSelect
                    classNamePrefix="select"
                    cacheOptions
                    defaultOptions
                    loadOptions={ loadUserOptions }
                    placeholder="Начните вводить имя…"
                    value={ mainExecutorOption }
                    onChange={ opt => setMainExecutorOption(opt) }
                    noOptionsMessage={ () => 'Нет совпадений' }
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
                    loadOptions={ loadUserOptions }
                    placeholder="Начните вводить имена…"
                    value={ reviewerOption || [] }
                    onChange={ opts => setReviewerOption(opts || []) }
                    noOptionsMessage={ () => 'Нет совпадений' }
                    isClearable
                  />
                </div>
                <div className="field">
                  <label>Статус задачи</label>
                  <Select
                    classNamePrefix="select"
                    placeholder="Выберите статус…"
                    isClearable
                    options={ transitions.map(t => ({ value: t.id, label: t.name })) }
                    value={
                      transitions
                        .map(t => ({ value: t.id, label: t.name }))
                        .find(o => o.value === targetStatus) || null
                    }
                    onChange={ opt => setTargetStatus(opt?.value || null) }
                    styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                    menuPortalTarget={ document.body }
                    menuPosition="fixed"
                    menuPlacement="auto"
                  />
                </div>
              </fieldset>
              <fieldset disabled={ !ready || creating } className="common-fields-group">
                <legend>Связь запроса</legend>
                <div className="field">
                  <label>Ключ задачи</label>
                  <AsyncSelect
                    classNamePrefix="select"
                    cacheOptions
                    defaultOptions
                    loadOptions={ loadIssueOptions }
                    placeholder="Начните вводить ключ задачи…"
                    value={ requestLinkOption }
                    onChange={ opt =>
                    {
                      setRequestLinkOption(opt);
                    } }
                    noOptionsMessage={ () => 'Ничего не найдено' }
                    isClearable
                  />
                </div>
                <div className="field">
                  <label>Тип связи</label>
                  <Select
                    classNamePrefix="select"
                    placeholder="Выберите тип..."
                    options={ filteredLinkTypes }
                    value={ filteredLinkTypes.find(o => o.value === requestLinkType) || null }
                    onChange={ opt => setRequestLinkType(opt?.value || null) }
                    isClearable
                  />
                </div>
              </fieldset>
              <div className="buttons">
                { selectedTasksCount === 0 ? (
                  <button onClick={ () => setModalOpen(false) } className="btn btn-primary">
                    Вернуться
                  </button>
                ) : (
                  <button onClick={ handleCreateAll } disabled={ !ready || creating } className="btn btn-primary">
                    { creating ? 'Создание…' : `Подтвердить и создать ${selectedTasksCount} ${tasksWord(selectedTasksCount)}` }
                  </button>
                ) }
              </div>
              { results.length > 0 && (
                <div className="jira-result" ref={ resultsRef }>
                  <h3>Результаты создания:</h3>
                  { results.map((r, i) =>
                    r.success
                      ? <p key={ i } className="success"><b>{ r.key }:</b> <a href={ `${config.jiraBaseUrl || 'https://jira.abanking.ru'}/browse/${r.key}` } target="_blank" rel="noreferrer">{ r.summary }</a></p>
                      : <p key={ i } className="error"><b>{ r.summary }:</b> { r.error }</p>
                  ) }
                </div>
              ) }
            </div>
          </div>
        ) }
        <UndoDeleteToast
          visible={ !!undoDeleteState }
          taskName={ undoDeleteState?.task?.summary }
          onRestore={ handleRestoreTask }
          onDismiss={ () => setUndoDeleteState(null) }
        />
        { showValidationToast && (
          <div className="validation-toast" role="alert">
            Не заполнены обязательные поля
          </div>
        ) }
        { showScrollTop && (
          <div className="floating-buttons floating-buttons--top-only">
            <span />
            <button
              type="button"
              className="btn btn-secondary btn-top"
              onClick={ () => window.scrollTo({ top: 0, behavior: 'smooth' }) }
              title="Вверх"
              aria-label="Вверх"
            >
              <ArrowUpIcon />
            </button>
          </div>
        ) }

      </div>
    </ErrorBoundary>
  );
}
