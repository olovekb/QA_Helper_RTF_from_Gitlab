/* eslint-disable no-undef */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import { get as idbGet, set as idbSet, clear as idbClear } from 'idb-keyval';
import './CodeErrorPage.css';
import config from './config';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import useAttachmentsMap from './components/useAttachmentsMap'
import { serializeFile } from './components/fileStorage'
import JiraMarkdownField from './components/JiraMarkdownField'
import GlobalBackgroundProgress from './components/GlobalBackgroundProgress';
import { trackEvent } from './analytics';
import { tasksWord } from './utils/textHelpers';
import { useDebounce } from './hooks/useDebounce';
import { usePersistentState } from './hooks/usePersistentState';
import { useShowScrollTop } from './hooks/useShowScrollTop';
import { createToOptions } from './utils/fieldOptions';
import { formatAllureOptionLabel } from './components/AllureOptionLabel';
import { createHandleChange, createHandlePaste } from './utils/taskFieldHelpers';
import ArrowUpIcon from './components/ArrowUpIcon';
import AttachmentsField from './components/AttachmentsField';
import TaskSidebar from './components/TaskSidebar';

const formatLastSaved = (ts) =>
{
    if (!ts || typeof ts !== 'number') return null;
    const d = new Date(ts);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();
    if (sameDay) return `сохранено сегодня в ${time}`;
    if (isYesterday) return `сохранено вчера в ${time}`;
    return `сохранено ${pad(d.getDate())}.${pad(d.getMonth() + 1)} в ${time}`;
};

// порядок обязательных полей для валидации и скролла
const REQUIRED_FIELDS = [
    { key: 'summary', id: i => `field-summary-${i}` },
    { key: 'severity', id: i => `field-severity-${i}` },
    { key: 'prodBug', id: i => `field-prodBug-${i}` },
    { key: 'symptom', id: i => `field-symptom-${i}` },
    { key: 'platform', id: i => `field-platform-${i}` },
    { key: 'description', id: i => `field-description-${i}` },
    { key: 'steps', id: i => `field-steps-${i}` },
    { key: 'actual', id: i => `field-actual-${i}` },
    { key: 'expected', id: i => `field-expected-${i}` }
];

const isEmptyRequired = (task, key) =>
{
    switch (key) {
        case 'summary': return !(task.summary || '').trim();
        case 'severity': return task.severity === undefined || task.severity === null || task.severity === '';
        case 'prodBug': return task.prodBug === undefined || task.prodBug === null;
        case 'symptom': return !(task.symptom || []).length;
        case 'platform': return !(task.platform || []).length;
        case 'description': return !(task.description || '').trim();
        case 'steps': return !(task.steps || '').trim();
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

export const CodeErrorCard = ({
    task, index, onUpdate, onDelete, onDeleteClick,
    fieldOptions, loadDefectOptions, onDefectSelect,
    loadUserOptions,
    allureProject, runAi, aiLoading,
    fillFieldsWithAI,
    aiFillLoading,
    setAttachmentsMap,
    attachmentsMap = {},
    forceValidation = false
}) =>
{
    const [touchedFields, setTouchedFields] = useState(() => new Set());

    const isFieldInvalid = useCallback((fieldKey) =>
    {
        const touched = touchedFields.has(fieldKey) || forceValidation;
        return touched && isEmptyRequired(task, fieldKey);
    }, [touchedFields, forceValidation, task]);

    const handleBlur = useCallback((fieldKey) =>
    {
        setTouchedFields(prev => new Set(prev).add(fieldKey));
    }, []);

    const handleChange = createHandleChange(task, index, onUpdate);
    const handlePaste = createHandlePaste(task, index, onUpdate, setAttachmentsMap);
    const toOptions = createToOptions(fieldOptions);

    // префиксы платформы для поля Тема
    const PREFIX_ORDER = ['S', 'DV', 'D', 'A', 'M', 'AND', 'IOS', 'PWA', '1C'];
    const handlePlatformChange = opts =>
    {
        const newPlatform = opts.map(o => o.value);
        const platOpts = fieldOptions.Platform || [];
        const prefixes = newPlatform
            .map(id => platOpts.find(p => p.id === id)?.prefix)
            .filter(Boolean);
        const uniquePrefixes = [...new Set(prefixes)];
        const sortedPrefixes = uniquePrefixes.sort((a, b) =>
        {
            const ia = PREFIX_ORDER.indexOf(a);
            const ib = PREFIX_ORDER.indexOf(b);
            return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });
        const prefixStr = sortedPrefixes.join('');

        const summary = task.summary || '';
        const match = summary.match(/^([A-Za-z0-9]+)\s*\|\s*(.*)$/s);
        const rest = match ? match[2] : summary;

        const newSummary = prefixStr ? (rest ? `${prefixStr} | ${rest}` : `${prefixStr} | `) : rest;

        onUpdate(index, {
            ...task,
            platform: newPlatform,
            summary: newSummary
        });
    };

    return (
        <div className="task-card">
            <div className="task-header">
                <input
                    className="task-checkbox"
                    type="checkbox"
                    checked={ task.selected }
                    onChange={ handleChange('selected') }
                />
                <div id={ `field-summary-${index}` } className={ `field ${isFieldInvalid('summary') ? 'field-invalid' : ''}` } style={ { flexGrow: 1 } }>
                    <label htmlFor={ `summary-${index}` }>Тема*</label>
                    <div className="input-with-clear">
                        <input
                            id={ `summary-${index}` }
                            type="text"
                            placeholder="Краткое описание проблемы"
                            value={ task.summary }
                            onChange={ handleChange('summary') }
                            onBlur={ () => handleBlur('summary') }
                        />
                        { task.summary && (
                            <button
                                type="button"
                                className="input-clear-btn"
                                onClick={ () => onUpdate(index, { ...task, summary: '' }) }
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                                    <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                            </button>
                        ) }
                    </div>
                </div>
                <button className="btn-secondary" onClick={ () => (onDeleteClick ? onDeleteClick(index) : onDelete(index)) } >
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

            <div className="card-body">
                {/* Allure Defect */ }
                <div className="field field-row full-width">
                    <label>Дефект Allure</label>
                    <AsyncSelect
                        key={ allureProject }
                        classNamePrefix="select"
                        cacheOptions
                        defaultOptions
                        loadOptions={ input => loadDefectOptions(allureProject, input) }
                        isClearable
                        placeholder="Начните вводить..."
                        value={ task.allureDefect }
                        onChange={ opt =>
                        {
                            onUpdate(index, { ...task, allureDefect: opt });
                            if (opt?.value) onDefectSelect(index, opt.value);
                        } }
                        noOptionsMessage={ () =>
                            allureProject ? 'Нет совпадений' : 'Выберите проект'
                        }
                        isOptionDisabled={ opt => opt.linked }
                        formatOptionLabel={ formatAllureOptionLabel }
                        formatGroupLabel={ group => (
                            <div
                                style={ {
                                    fontWeight: 600,
                                    padding: '4px 8px',
                                    backgroundColor: 'var(--bg-input)',
                                    color: group.label.includes('Свободные')
                                        ? 'var(--success)'
                                        : 'var(--warning)'
                                } }
                            >
                                { group.label } ({ group.options.length })
                            </div>
                        ) }
                    />
                </div>

                {/* Исполнитель */ }
                <div className="field field-row full-width">
                    <label>Исполнитель</label>
                    <AsyncSelect
                        classNamePrefix="select"
                        cacheOptions
                        defaultOptions
                        loadOptions={ loadUserOptions }
                        placeholder="Начните вводить имя…"
                        value={ task.assignee || null }
                        onChange={ opt => onUpdate(index, { ...task, assignee: opt }) }
                        noOptionsMessage={ () => 'Нет совпадений' }
                        isClearable
                    />
                </div>

                {/* 1. Серьезность */ }
                <div id={ `field-severity-${index}` } className={ `field field-row full-width ${isFieldInvalid('severity') ? 'field-invalid' : ''}` }>
                    <label>Серьезность*</label>
                    <Select
                        menuPortalTarget={ document.body }
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                        classNamePrefix="select"
                        placeholder="Выберите..."
                        options={ toOptions('Severity') }
                        value={ toOptions('Severity').find(o => o.value === task.severity) || null }
                        onChange={ opt => onUpdate(index, { ...task, severity: opt?.value || '' }) }
                        onBlur={ () => handleBlur('severity') }
                    />
                </div>
                {/* 1. Приоритет */ }
                <div id={ `field-priority-${index}` } className="field field-row full-width">
                    <label>Приоритет</label>
                    <Select
                        menuPortalTarget={ document.body }
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                        classNamePrefix="select"
                        placeholder="Выберите..."
                        options={ toOptions('Priority') }
                        value={ toOptions('Priority').find(o => o.value === task.priority) || null }
                        onChange={ opt => onUpdate(index, { ...task, priority: opt?.value || '' }) }
                        isClearable
                    />
                </div>
                {/* 2. Баг с прода */ }
                <div id={ `field-prodBug-${index}` } className={ `field field-row full-width ${isFieldInvalid('prodBug') ? 'field-invalid' : ''}` }>
                    <label>Баг с прода*</label>
                    <Select
                        menuPortalTarget={ document.body }
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                        classNamePrefix="select"
                        placeholder="Да/Нет"
                        options={ toOptions('ProdBug') }
                        value={ toOptions('ProdBug').find(o => o.value === task.prodBug) || null }
                        onChange={ opt => onUpdate(index, { ...task, prodBug: opt.value }) }
                        onBlur={ () => handleBlur('prodBug') }
                        isClearable={ false }
                    />
                </div>
                {/* 3. Симптом */ }
                <div id={ `field-symptom-${index}` } className={ `field field-row full-width ${isFieldInvalid('symptom') ? 'field-invalid' : ''}` }>
                    <label>Симптом*</label>
                    <Select
                        menuPortalTarget={ document.body }
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                        classNamePrefix="select"
                        isMulti
                        closeMenuOnSelect={ false }
                        placeholder="Выберите..."
                        options={ toOptions('Symptom') }
                        value={ toOptions('Symptom').filter(o => task.symptom.includes(o.value)) }
                        onChange={ opts => onUpdate(index, { ...task, symptom: opts.map(o => o.value) }) }
                        onBlur={ () => handleBlur('symptom') }
                    />
                </div>
                {/* 4. Платформа */ }
                <div id={ `field-platform-${index}` } className={ `field field-row full-width ${isFieldInvalid('platform') ? 'field-invalid' : ''}` }>
                    <label>Платформа*</label>
                    <Select
                        menuPortalTarget={ document.body }
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                        classNamePrefix="select"
                        isMulti
                        closeMenuOnSelect={ false }
                        placeholder="Выберите..."
                        options={ toOptions('Platform') }
                        value={ toOptions('Platform').filter(o => task.platform.includes(o.value)) }
                        onChange={ handlePlatformChange }
                        onBlur={ () => handleBlur('platform') }
                    />
                </div>
                {/* 5. Подробное описание */ }
                <div id={ `field-description-${index}` } className={ `field full-width ${isFieldInvalid('description') ? 'field-invalid' : ''}` }>
                    <label htmlFor={ `description-${index}` }>Подробное описание*</label>
                    <textarea
                        id={ `description-${index}` }
                        rows={ 4 }
                        placeholder="Детальное описание, контекст..."
                        value={ task.description }
                        onChange={ handleChange('description') }
                        onBlur={ () => handleBlur('description') }
                        onPaste={ handlePaste('description') }
                    />
                </div>
                { task.aiDescription && (
                    <div className="ai-feedback full-width">
                        <strong>AI Описание:</strong> { task.aiDescription }
                    </div>
                ) }
                {/* 6. Шаги воспроизведения */ }
                <div id={ `field-steps-${index}` } className={ `field full-width ${isFieldInvalid('steps') ? 'field-invalid' : ''}` }>
                    <label htmlFor={ `steps-${index}` }>Шаги воспроизведения*</label>
                    <JiraMarkdownField
                        id={ `steps-${index}` }
                        value={ task.steps }
                        onChange={ val => onUpdate(index, { ...task, steps: val }) }
                        onBlur={ () => handleBlur('steps') }
                        onPaste={ handlePaste('steps') }
                        imageAttachments={ attachmentsMap[task.id]?.steps || [] }
                        placeholder="1. Открыть... 2. Нажать... 3. Увидеть ошибку..."
                        minHeight={ 136 }
                    />
                </div>
                { task.aiSteps && (
                    <div className="ai-feedback full-width">
                        <strong>AI Шаги:</strong> { task.aiSteps }
                    </div>
                ) }
                {/* 7. Фактический результат */ }
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
                        minHeight={ 136 }
                    />
                </div>
                { task.aiActual && (
                    <div className="ai-feedback full-width">
                        <strong>AI Фактический:</strong> { task.aiActual }
                    </div>
                ) }
                {/* 8. Ожидаемый результат */ }
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
                        minHeight={ 136 }
                    />
                </div>
                { task.aiExpected && (
                    <div className="ai-feedback full-width">
                        <strong>AI Ожидаемый:</strong> { task.aiExpected }
                    </div>
                ) }
                {/* 9. Стенд */ }
                <div className="field field-row full-width">
                    <label>Стенд</label>
                    <input
                        type="text"
                        placeholder="e.g., test-01"
                        value={ task.stand }
                        onChange={ handleChange('stand') }
                    />
                </div>
                {/* 10. Окружение */ }
                <div className="field field-row full-width">
                    <label>Окружение</label>
                    <input
                        type="text"
                        placeholder="e.g., Chrome, Android"
                        value={ task.env }
                        onChange={ handleChange('env') }
                    />
                </div>
                {/* 11. Ссылка на требование */ }
                <div className="field field-row full-width">
                    <label>Ссылка на требование</label>
                    <input
                        type="text"
                        placeholder="URL в Confluence"
                        value={ task.requirementLink }
                        onChange={ handleChange('requirementLink') }
                    />
                </div>
                {/* 12. Тестовые данные */ }
                <div className="field field-row full-width">
                    <label>Тестовые данные</label>
                    <input
                        type="text"
                        placeholder="Логин/пароль"
                        value={ task.testData }
                        onChange={ handleChange('testData') }
                    />
                </div>
                {/* 13. Макет */ }
                <div className="field field-row full-width">
                    <label>Макет</label>
                    <input
                        type="text"
                        placeholder="URL в Figma"
                        value={ task.mockup }
                        onChange={ handleChange('mockup') }
                    />
                </div>
                {/* 14. Worker */ }
                <div className="field field-row full-width">
                    <label>Worker</label>
                    <Select
                        menuPortalTarget={ document.body }
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                        classNamePrefix="select"
                        isClearable
                        options={ toOptions('Worker') }
                        value={ toOptions('Worker').find(o => o.value === task.worker) || null }
                        onChange={ opt => onUpdate(index, { ...task, worker: opt?.value || '' }) }
                    />
                </div>

                {/* Общие вложения */ }
                <AttachmentsField
                    task={ task }
                    index={ index }
                    onUpdate={ onUpdate }
                    setAttachmentsMap={ setAttachmentsMap }
                    attachmentsMap={ attachmentsMap }
                    commonOnly={ false }
                    label="Вложения"
                />
                {/* AI‑кнопка */ }
                <div className="ai-controls">
                    <button
                        onClick={ () => runAi(index) }
                        disabled={ aiLoading }
                        className="btn ai-btn"
                    >
                        { aiLoading ? 'Проверка AI…' : 'Проверить AI' }
                    </button>
                    <button
                        onClick={ () => fillFieldsWithAI(index) }
                        disabled={ aiFillLoading }
                        className="btn ai-fill-btn"
                        style={ { marginLeft: '8px' } }
                    >
                        { aiFillLoading ? '⏳ …' : 'AI‑поля' }
                    </button>
                </div>
            </div>
        </div >
    );
};




//основной компонент страницы
export default function CodeErrorPage ({ projects })
{
    console.log('%c<CodeErrorPage/> render', 'color: #999;');
    const [lastSavedAt, setLastSavedAt] = useState(null);
    useEffect(() =>
    {
        idbGet('codeErrorLastSavedAt').then(ts => ts && setLastSavedAt(ts)).catch(console.warn);
    }, []);
    const handleSaved = useCallback(() =>
    {
        const now = Date.now();
        setLastSavedAt(now);
        idbSet('codeErrorLastSavedAt', now).catch(console.warn);
    }, []);
    const [attachmentsMap, setAttachmentsMap] = useAttachmentsMap('codeErrorAttachmentsMap', { onSaved: handleSaved });
    // блок default-значений
    const [defaultStand, setDefaultStand] = usePersistentState('defaultStand', '');
    const [defaultEnv, setDefaultEnv] = usePersistentState('defaultEnv', '');
    const [defaultRequirementLink, setDefaultRequirementLink] = usePersistentState('defaultRequirementLink', '');
    const [defaultTestData, setDefaultTestData] = usePersistentState('defaultTestData', '');
    const [defaultWorker, setDefaultWorker] = usePersistentState('defaultWorker', '');
    const [defaultMockup, setDefaultMockup] = usePersistentState('defaultMockup', '');
    const [defaultProdBug, setDefaultProdBug] = usePersistentState('defaultProdBug', '');
    const [defaultsCollapsed, setDefaultsCollapsed] = useState(false);
    // Состояния и хуки
    const [tasks, setTasks] = usePersistentState('codeErrorTasks', [], handleSaved);
    const [taskGroups, setTaskGroups] = usePersistentState('codeErrorTaskGroups', []);
    const [jiraProject, setJiraProject] = usePersistentState('jiraProject', '');
    const [jiraPat, setJiraPat] = usePersistentState('jiraPat', '');
    const [epicOption, setEpicOption] = usePersistentState('codeErrorEpic', null);
    const [assigneeOption, setAssigneeOption] = usePersistentState('codeErrorAssignee', null);
    const [versionOption, setVersionOption] = usePersistentState('codeErrorVersion', null);
    const [versionTouched, setVersionTouched] = useState(false);
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
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteSingleModalIndex, setDeleteSingleModalIndex] = useState(null);
    const [aiLoading, setAiLoading] = useState({});
    const [requestLinkOption, setRequestLinkOption] = usePersistentState('codeErrorReqLink', null);
    const [aiFillAllLoading, setAiFillAllLoading] = useState(false);
    const [aiFillLoading, setAiFillLoading] = useState({});
    const [linkTypes, setLinkTypes] = useState([]);
    const [requestLinkType, setRequestLinkType] = usePersistentState('codeErrorReqLinkType', null);
    const debProject = useDebounce(jiraProject, 500);
    const debPat = useDebounce(jiraPat, 500);
    const allowedLinkNames = ['Блокирует', 'Относится', 'Клонирование', 'Порождение'];
    const requestLinkIssue = requestLinkOption?.value || null;
    const [mainExecutorOption, setMainExecutorOption] =
        usePersistentState('codeErrorMainExecutor', null);
    const [reviewerOption, setReviewerOption] =
        usePersistentState('codeErrorReviewers', []);
    const [launchDefectsModalOpen, setLaunchDefectsModalOpen] = useState(false);
    const [selectedLaunchForDefects, setSelectedLaunchForDefects] = useState(null);
    const [launchDefectsList, setLaunchDefectsList] = useState([]);
    const [selectedDefectIds, setSelectedDefectIds] = useState(new Set());
    const [launchDefectsLoading, setLaunchDefectsLoading] = useState(false);
    const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
    const [forceValidationForTaskIndex, setForceValidationForTaskIndex] = useState(null);
    const [showValidationToast, setShowValidationToast] = useState(false);
    const validationToastTimerRef = useRef(null);
    const resultsRef = useRef(null);

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

    useEffect(() => () =>
    {
        if (validationToastTimerRef.current) clearTimeout(validationToastTimerRef.current);
    }, []);

    useEffect(() =>
    {
        if (results.length > 0 && resultsRef.current) {
            resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [results]);

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
            setTasks(ts => ts.map(t => ({ ...t, selected: false })));
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
    useEffect(() =>
    {
        if (!defaultProdBug) return;
        setTasks(tasks =>
            tasks.map(t => ({
                ...t,
                prodBug: t.prodBug || defaultProdBug
            }))
        );
    }, [defaultProdBug]);

    useEffect(() =>
    {
        console.log('%c[tasks] changed:', 'color: #0a0;', tasks);
    }, [tasks]);

    useEffect(() => { if (modalOpen) setVersionTouched(false); }, [modalOpen]);

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

    const loadIssueOptions = async (input, extraJql = '') =>
    {
        if (!jiraProject || !jiraPat) return [];

        const q = input.trim();
        let jql;

        if (/^\d+$/.test(q)) {
            // пользователь ввёл только цифры — ищем по ключу с префиксом проекта
            jql = `project = ${jiraProject} AND key = ${jiraProject}-${q}`;
        } else if (/^[A-Z]+-\d+$/.test(q)) {
            // пользователь ввёл полный ключ, например "JMT-15019"
            jql = `project = ${jiraProject} AND key = "${q}"`;
        } else {
            // остальное — по summary как и было
            // добавляем wildcard для начала слова
            jql = `project = ${jiraProject} AND summary ~ "${q}*"`;
        }

        if (extraJql) jql += ` AND ${extraJql}`;
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


    // Функции загрузки данных
    const loadMeta = useCallback(async () =>
    {
        if (!debProject || !debPat) return;
        setIsMetaLoading(true); setMetaError('');
        try {
            const { data } = await axios.post(`${config.serverUrl}/jira/meta`, { projectKey: debProject, pat: debPat, issueTypeId: '12811' });
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

    const loadVersionOptions = input =>
        axios.get(`${config.serverUrl}/jira/versions`, { params: { projectKey: jiraProject, pat: jiraPat, query: input } })
            .then(r => r.data.map(v => ({ value: v.id, label: v.name })))
            .catch(() => []);

    const loadTransitions = useCallback(async () =>
    {
        if (!debProject || !debPat) return;
        try {
            const sample = 'JMT-14927';
            const { data } = await axios.get(`${config.serverUrl}/jira/transitions`, { params: { issueKey: sample, pat: jiraPat } });
            setTransitions(data);
        } catch { console.warn('Не удалось загрузить transitions'); }
    }, [debProject, debPat]);
    useEffect(() => { if (modalOpen) loadTransitions(); }, [modalOpen, loadTransitions]);

    useEffect(() =>
    {
        const handleKeyDown = e =>
        {
            if (e.key !== 'Escape') return;
            if (launchDefectsModalOpen) {
                setLaunchDefectsModalOpen(false);
                setSelectedLaunchForDefects(null);
                setLaunchDefectsList([]);
                setSelectedDefectIds(new Set());
            } else if (deleteModalOpen) {
                setDeleteModalOpen(false);
            } else if (deleteSingleModalIndex !== null) {
                setDeleteSingleModalIndex(null);
            } else if (modalOpen) {
                setModalOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [launchDefectsModalOpen, deleteModalOpen, deleteSingleModalIndex, modalOpen]);
    useEffect(() =>
    {
        if (fieldOptions.ProdBug?.length && !defaultProdBug) {
            const noOption = fieldOptions.ProdBug.find(o => o.name === 'Нет');
            if (noOption) {
                setDefaultProdBug(noOption.id);
            }
        }
    }, [fieldOptions.ProdBug, defaultProdBug, setDefaultProdBug]);
    useEffect(() =>
    {
        if (!fieldOptions.Platform?.length) return;
        const validIds = new Set(fieldOptions.Platform.map(o => o.id));
        setTasks(ts => ts.map(t => {
            const filtered = (t.platform || []).filter(id => validIds.has(id));
            if (filtered.length !== (t.platform || []).length) {
                return { ...t, platform: filtered };
            }
            return t;
        }));
    }, [fieldOptions.Platform, setTasks]);
    useEffect(() =>
    {
        setTasks(ts =>
            ts.map(t => ({
                ...t,
                attachments: (t.attachments && t.attachments.length > 0)
                    ? t.attachments
                    : (attachmentsMap[t.id]?.common || []),
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
                } catch {

                }
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

    const loadLaunchOptions = async (projectId, input) =>
    {
        if (!projectId) return [];
        const needle = (input || '').trim().toLowerCase();
        const { data } = await axios.get(`${config.serverUrl}/allure/launches`, {
            params: { projectId, page: 0, size: 50, query: needle || undefined }
        });
        const list = Array.isArray(data) ? data : (data?.content || []);
        const withDefects = list.filter(l =>
        {
            const newC = Number(l.newDefectsCount) || 0;
            const knownC = Number(l.knownDefectsCount) || 0;
            return newC > 0 || knownC > 0;
        });
        const searchFiltered = needle
            ? withDefects.filter(l => (l.name || '').toLowerCase().includes(needle) || String(l.id || '').includes(needle))
            : withDefects;

        const withStatus = await Promise.all(
            searchFiltered.map(async (l) =>
            {
                try {
                    const { data: defData } = await axios.get(
                        `${config.serverUrl}/allure/launch/${l.id}/defect`,
                        { params: { page: 0, size: 50 } }
                    );
                    const defects = Array.isArray(defData) ? defData : (defData?.content || []);
                    const hasUnlinked = defects.some(d => !d.issue);
                    return { ...l, hasUnlinked };
                } catch {
                    return { ...l, hasUnlinked: false };
                }
            })
        );
        const opts = withStatus
            .filter(l =>
            {
                const newC = Number(l.newDefectsCount) || 0;
                const knownC = Number(l.knownDefectsCount) || 0;
                return newC > 0 || knownC > 0;
            })
            .map(l => ({
                value: l.id,
                label: `${l.name || `Запуск #${l.id}`} (ID: ${l.id})`,
                hasUnlinked: l.hasUnlinked,
                closed: l.closed !== false,
                newDefectsCount: Number(l.newDefectsCount) || 0,
                jiraIssue: l.issues?.[0]?.name
            }));
        return [
            { label: 'Можно создать задачи', options: opts.filter(o => o.hasUnlinked) },
            { label: 'Все задачи созданы', options: opts.filter(o => !o.hasUnlinked) }
        ];
    };

    const launchDebounceRef = useRef(null);
    const launchPendingResolveRef = useRef(null);
    const loadLaunchOptionsDebounced = useCallback((input) =>
    {
        const isEmpty = !(input || '').trim();
        const delay = isEmpty ? 0 : 400;
        return new Promise((resolve) =>
        {
            if (launchPendingResolveRef.current) {
                launchPendingResolveRef.current([]);
            }
            launchPendingResolveRef.current = resolve;
            clearTimeout(launchDebounceRef.current);
            launchDebounceRef.current = setTimeout(() =>
            {
                launchPendingResolveRef.current = null;
                loadLaunchOptions(allureProject, input).then(resolve).catch(() => resolve([]));
            }, delay);
        });
    }, [allureProject]);

    const handleLaunchSelect = async (opt) =>
    {
        if (!opt?.value || !allureProject) return;
        setLaunchDefectsLoading(true);
        setLaunchDefectsModalOpen(true);
        setSelectedLaunchForDefects(opt);
        setSelectedDefectIds(new Set());
        try {
            const { data } = await axios.get(
                `${config.serverUrl}/allure/launch/${opt.value}/defect`,
                { params: { page: 0, size: 100 } }
            );
            const list = Array.isArray(data) ? data : (data?.content || []);
            const unlinked = list.filter(d => !d.issue);
            setLaunchDefectsList(unlinked);
            setSelectedDefectIds(new Set(unlinked.map(d => d.id)));
        } catch (e) {
            console.error('Ошибка загрузки дефектов запуска:', e);
            setLaunchDefectsList([]);
        } finally {
            setLaunchDefectsLoading(false);
        }
    };

    const handleDefectCheckboxChange = (defectId, checked) =>
    {
        setSelectedDefectIds(prev =>
        {
            const next = new Set(prev);
            if (checked) next.add(defectId);
            else next.delete(defectId);
            return next;
        });
    };

    const handleConfirmDefectsFromLaunch = async () =>
    {
        if (selectedDefectIds.size === 0) {
            setLaunchDefectsModalOpen(false);
            return;
        }
        const selectedDefects = launchDefectsList.filter(d => selectedDefectIds.has(d.id));
        const newTasks = [];
        for (const d of selectedDefects) {
            try {
                const { data } = await axios.get(`${config.serverUrl}/allure/defect/${d.id}/details`);
                const newId = uuidv4();
                setAttachmentsMap(prev => ({
                    ...prev,
                    [newId]: { common: [], description: [], steps: [], actual: [], expected: [] }
                }));
                newTasks.push({
                    id: newId,
                    summary: data.name || '',
                    description: data.description || '',
                    steps: (data.steps || []).join('\n') || '',
                    actual: '',
                    expected: '',
                    stand: defaultStand,
                    env: defaultEnv,
                    requirementLink: defaultRequirementLink,
                    testData: defaultTestData,
                    mockup: defaultMockup,
                    severity: '',
                    priority: '',
                    symptom: [],
                    platform: [],
                    prodBug: defaultProdBug,
                    selected: false,
                    isNew: false,
                    allureDefect: { value: d.id, label: `${d.name || ''} (ID: ${d.id})`, linked: false },
                    attachments: [],
                    descriptionAttachments: [],
                    stepsAttachments: [],
                    actualAttachments: [],
                    expectedAttachments: [],
                    aiSummary: '',
                    aiDescription: '',
                    aiSteps: '',
                    aiActual: '',
                    aiExpected: '',
                    worker: defaultWorker,
                });
            } catch (e) {
                console.error('Ошибка загрузки дефекта', d.id, e);
            }
        }
        if (newTasks.length > 0) {
            setTasks(prev => [...newTasks, ...prev]);
        }
        setLaunchDefectsModalOpen(false);
        setSelectedLaunchForDefects(null);
        setLaunchDefectsList([]);
        setSelectedDefectIds(new Set());
    };

    const fetchDefectDetails = async (idx, defectId) =>
    {
        try {
            const { data } = await axios.get(`${config.serverUrl}/allure/defect/${defectId}/details`);
            const stepsText = Array.isArray(data.steps) ? data.steps.join('\n') : (data.steps || '') || '';
            setTasks(ts => ts.map((t, i) => i === idx ? {
                ...t,
                summary: data.name || t.summary,
                description: data.description || t.description,
                steps: stepsText || t.steps,
                isNew: false
            } : t));
        } catch (e) {
            console.error('Ошибка загрузки деталей дефекта:', e);
            alert('Не удалось загрузить описание/шаги дефекта');
        }
    };

    const handleFillAllWithAI = async () =>
    {
        trackEvent('fill_all_ai', { page: '/code-error', projectId: allureProject, taskId: jiraProject });
        if (!jiraProject || !jiraPat) {
            alert('Сначала укажите Project Key и Jira PAT');
            return;
        }
        setAiFillAllLoading(true);
        try {
            // по очереди обрабатываем все выбранные задачи
            const updated = await Promise.all(tasks.map(async (t) =>
            {
                if (!t.selected) return t;
                // собираем полезные поля
                const payload = {
                    summary: t.summary,
                    description: t.description,
                    steps: t.steps,
                    stand: t.stand,
                    env: t.env,
                    pat: jiraPat,
                    projectKey: jiraProject,
                    issueTypeId: '12811'
                };
                const { data } = await axios.post(
                    `${config.serverUrl}/jira/ai-fill-fields`,
                    payload
                );
                return {
                    ...t,
                    actual: data.actual,
                    expected: data.expected,
                    severity: data.severity,
                    priority: data.priority ?? t.priority,
                    platform: data.platform,
                    symptom: data.symptom
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
        trackEvent('ai_fill_fields', { page: '/code-error', projectId: allureProject, taskId: jiraProject });
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
                issueTypeId: '12811'
            };
            const { data } = await axios.post(
                `${config.serverUrl}/jira/ai-fill-fields`,
                payload
            );
            // data: { actual, expected, severity, priority?, platform: [], symptom: [] }
            setTasks(ts => ts.map((c, i) => i === idx
                ? {
                    ...c,
                    actual: data.actual,
                    expected: data.expected,
                    severity: data.severity,
                    priority: data.priority ?? c.priority,
                    platform: data.platform,
                    symptom: data.symptom
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
        trackEvent('ai_review_task', { page: '/code-error', projectId: allureProject, taskId: jiraProject });
        const t = tasks[idx];
        setAiLoading(l => ({ ...l, [idx]: true }));
        try {
            const { data } = await axios.post(`${config.serverUrl}/bug/ai-review`, { task: t });
            setTasks(ts => ts.map((c, i) => i === idx ? {
                ...c,
                aiSummary: data.summaryFeedback, aiDescription: data.descriptionFeedback,
                aiSteps: data.stepsFeedback, aiActual: data.actualFeedback, aiExpected: data.expectedFeedback
            } : c));
        } catch (e) {
            alert('Ошибка AI: ' + (e.response?.data?.error || e.message));
        } finally {
            setAiLoading(l => ({ ...l, [idx]: false }));
        }
    };

    // --- Обработчики ---
    // Внутри вашего компонента CodeErrorPage, найдите определение handleAdd и замените его на:

    const handleAdd = (groupId) =>
    {
        console.log('handleAdd вызван');
        console.log('%chandleAdd start', 'color: #00f; font-weight: bold;');
        console.trace('trace handleAdd');

        const newId = uuidv4();
        console.log(' — новый ID:', newId);

        setAttachmentsMap(prev => ({
            ...prev,
            [newId]: {
                common: [],
                description: [],
                steps: [],
                actual: [],
                expected: [],
            }
        }));

        const newTask = {
            id: newId,
            summary: '',
            description: '',
            steps: '',
            actual: '',
            expected: '',
            stand: defaultStand,
            env: defaultEnv,
            requirementLink: defaultRequirementLink,
            testData: defaultTestData,
            mockup: defaultMockup,
            severity: '',
            priority: '',
            symptom: [],
            platform: [],
            prodBug: defaultProdBug,
            selected: false,
            isNew: true,
            allureDefect: null,
            attachments: [],
            descriptionAttachments: [],
            stepsAttachments: [],
            actualAttachments: [],
            expectedAttachments: [],
            aiSummary: '',
            aiDescription: '',
            aiSteps: '',
            aiActual: '',
            aiExpected: '',
            worker: defaultWorker,
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
        console.log('%chandleAdd end, tasks after add will be:', 'color: #00f;');

    };


    const handleDelete = i =>
    {
        console.log(`%chandleDelete index=${i}`, 'color: #f00; font-weight: bold;');
        const deleted = tasks[i];
        setSelectedTaskIndex(prev =>
        {
            if (prev === i) return Math.max(0, i - 1);
            if (prev > i) return prev - 1;
            return prev;
        });
        setTasks(ts =>
        {
            const next = ts.filter((_, idx) => idx !== i);
            console.log(' — tasks после удаления будут:', next);
            return next;
        });
        if (deleted?.groupId) {
            const remaining = tasks.filter((t, idx) => idx !== i && t.groupId === deleted.groupId).length;
            if (remaining <= 1) {
                setTaskGroups(gs => gs.filter(g => g.id !== deleted.groupId));
                setTasks(ts => ts.map(t => t.groupId === deleted.groupId ? { ...t, groupId: undefined } : t));
            }
        }
    };

    const handleUpdate = (i, upd) =>
    {
        if (forceValidationForTaskIndex === i) setForceValidationForTaskIndex(null);
        const t = tasks[i];
        if (t?.selected && getFirstInvalidFieldId(upd, i)) {
            upd = { ...upd, selected: false };
        }
        setTasks(ts => ts.map((t, idx) => idx === i ? upd : t));
    };

    // NEW: handler to toggle card collapse state
    const handleDeleteSelected = () =>
    {
        let remaining = tasks.filter(t => !t.selected);

        const groupCounts = {};
        remaining.forEach(t => { if (t.groupId) groupCounts[t.groupId] = (groupCounts[t.groupId] || 0) + 1; });
        const toDissolve = new Set(taskGroups.filter(g => (groupCounts[g.id] || 0) <= 1).map(g => g.id));
        if (toDissolve.size > 0) {
            remaining = remaining.map(t => toDissolve.has(t.groupId) ? { ...t, groupId: undefined } : t);
            setTaskGroups(gs => gs.filter(g => !toDissolve.has(g.id)));
        }

        setTasks(remaining);
        setSelectedTaskIndex(Math.max(0, remaining.length - 1));
        setDeleteModalOpen(false);
    };

    const handleCreateAll = async () =>
    {
        trackEvent('create_jira_tasks', { page: '/code-error', projectId: allureProject, taskId: jiraProject, extra: { count: tasks.filter(t => t.selected).length } });
        console.log('handleCreateAll called', { ready, creating });
        setCreating(true);
        setResults([]);
        const out = [];

        for (const t of tasks.filter(t => t.selected)) {
            // 1) Собираем содержимое описания с плейсхолдерами !file!
            const desc = `h3. Подробное описание
${t.description}

h3. Шаги воспроизведения
${t.steps}

h3. Фактический результат
${t.actual}

h3. Ожидаемый результат
${t.expected}

*Стенд:* ${t.stand || 'не указано'}
*Окружение:* ${t.env || 'не указано'}
*Тестовые данные:* ${t.testData || 'не указано'}
*Макет:* ${t.mockup || 'не указано'}
*Ссылка на требование:* ${t.requirementLink || 'не указано'}`;

            const fields = {
                project: { key: jiraProject },
                issuetype: { id: '12811' },
                summary: t.summary,
                description: desc,
                versions: [{ id: versionOption.value }],
                [fieldIds.Severity]: { id: t.severity },
                [fieldIds.Symptom]: t.symptom.map(id => ({ id })),
                [fieldIds.Platform]: t.platform.map(id => ({ id }))
            };
            if (t.priority && fieldIds.Priority) fields[fieldIds.Priority] = { id: t.priority };
            if (t.prodBug) fields[fieldIds.ProdBug] = { id: t.prodBug };
            if (!versionOption?.value) {
                alert('Выберите затронутую версию.');
                return;
            }
            if (epicOption?.value) {
                fields[fieldIds['Epic Link']] = epicOption.value;
            }
            const assigneeName = t.assignee?.value || assigneeOption?.value;
            if (assigneeName) {
                fields.assignee = { name: assigneeName };
            }
            const MAIN_EXECUTOR_CF = 'customfield_13210';
            const REVIEWERS_CF = 'customfield_13812';
            const mainExecFieldId = fieldIds['Основной исполнитель'] || MAIN_EXECUTOR_CF;
            const reviewersFieldId = fieldIds['Ревьюеры'] || fieldIds['Ревьюер'] || REVIEWERS_CF;

            if (mainExecFieldId && mainExecutorOption?.value) {
                fields[mainExecFieldId] = { name: mainExecutorOption.value };
            }
            if (reviewersFieldId) {
                const opts = Array.isArray(reviewerOption)
                    ? reviewerOption
                    : (reviewerOption ? [reviewerOption] : []);
                if (opts.length) {
                    fields[reviewersFieldId] = opts.map(o => ({ name: o.value }));
                }
            }
            const WORKER_CF = 'customfield_15001';
            const workerFieldId = fieldIds['Worker'] || WORKER_CF;
            if (workerFieldId && t.worker) {
                fields[workerFieldId] = { id: t.worker };
            }

            try {
                const { data: { key } } = await axios.post(
                    `${config.serverUrl}/jira/create-issue`,
                    { pat: jiraPat, payload: { fields } }
                );
                out.push({ success: true, summary: t.summary, key });

                const allFiles = [
                    ...(t.descriptionAttachments || []),
                    ...(t.stepsAttachments || []),
                    ...(t.actualAttachments || []),
                    ...(t.expectedAttachments || []),
                    ...(t.attachments || [])
                ];

                // оставляем только те, которые действительно instanceof Blob
                const blobFiles = allFiles.filter(f => f instanceof Blob);

                if (blobFiles.length) {
                    const form = new FormData();
                    blobFiles.forEach(f => form.append('file', f, f.name || 'image.png'));

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

                    await axios.put(
                        `${config.serverUrl}/jira/issue/${key}`,
                        {
                            pat: jiraPat,
                            payload: { fields: { description: desc } }
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
        // удаляем из задач те, что успешно создались
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
    return (
        <div className="solution-page">
            <button
                className="btn btn-secondary page-nav-back"
                onClick={ () => navigate('/') }
            >
                ← Назад
            </button>
            {/* Глобальный фоновый прогресс-бар */ }
            <GlobalBackgroundProgress />

            <h1>Массовое создание баг-репортов</h1>


            <section className="page-section">
                <div className="page-section-header">
                    <h2>Настройки подключения</h2>
                    <div className="page-section-header-right">
                        { lastSavedAt && (
                            <span className="save-status">{ formatLastSaved(lastSavedAt) }</span>
                        ) }
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
                    {/* FIXED: Added field wrapper and label */ }
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
                            value={ projects.map(p => ({ value: p.id, label: p.name })).find(o => o.value === allureProject) || null }
                            isClearable
                            onChange={ opt => setAllureProject(opt?.value || '') }
                        />
                    </div>
                    <div className="field full-width">
                        <label>Запуск Allure</label>
                        <AsyncSelect
                            key={ allureProject }
                            classNamePrefix="select"
                            cacheOptions
                            defaultOptions
                            loadOptions={ loadLaunchOptionsDebounced }
                            isClearable
                            placeholder="Выберите запуск или начните вводить…"
                            value={ selectedLaunchForDefects }
                            onChange={ opt =>
                            {
                                if (opt?.value) handleLaunchSelect(opt);
                                else setSelectedLaunchForDefects(null);
                            } }
                            noOptionsMessage={ () =>
                                allureProject ? 'Нет совпадений' : 'Выберите проект'
                            }
                            isOptionDisabled={ opt => !opt.hasUnlinked }
                            formatOptionLabel={ (opt, { context }) =>
                            {
                                if (context === 'value') return opt.label.split('(')[0].trim();
                                const defectCount = opt.newDefectsCount ?? 0;
                                return (
                                    <div className="allure-option-grid">
                                        <div className="allure-option-grid__name">
                                            <span className="allure-option-grid__name-text" title={ opt.label }>{ opt.label }</span>
                                            <span className="allure-option-grid__details">ID: { opt.value }</span>
                                        </div>
                                        <div className="allure-option-grid__right">
                                            { opt.jiraIssue && (
                                                <span className="allure-option__jira">{ opt.jiraIssue }</span>
                                            ) }
                                            { defectCount > 0 && (
                                                <span className="allure-option__defects">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={ { verticalAlign: 'middle', marginRight: 4 } }>
                                                        <path d="M2.5 7 5 9.5m-2.5 11 3-3m-4-4h3.121M19 13.5h3.5m-3.5-4L21.5 7m-3 10.5 3 3M8 7.5v-1a4 4 0 1 1 8 0v1m-4 14a7 7 0 0 1-7-7v-3c0-1.117 0-1.676.157-2.125a2.8 2.8 0 0 1 1.718-1.718C7.325 7.5 7.883 7.5 9 7.5h6c1.117 0 1.676 0 2.125.157a2.8 2.8 0 0 1 1.718 1.718C19 9.825 19 10.383 19 11.5v3a7 7 0 0 1-7 7" vectorEffect="non-scaling-stroke" />
                                                    </svg>
                                                    { defectCount }
                                                </span>
                                            ) }
                                            { !opt.closed && <span className="allure-option__open">запуск открыт</span> }
                                        </div>
                                    </div>
                                );
                            } }
                            formatGroupLabel={ group => (
                                <div
                                    style={ {
                                        fontWeight: 600,
                                        padding: '4px 8px',
                                        backgroundColor: 'var(--bg-input)',
                                        color: group.label.includes('Можно')
                                            ? 'var(--success)'
                                            : 'var(--warning)'
                                    } }
                                >
                                    { group.label } ({ group.options.length })
                                </div>
                            ) }
                        />
                    </div>
                </div>
                { isMetaLoading && <p className="status-message loading">Загрузка метаданных Jira…</p> }
                { metaError && <p className="status-message error">{ metaError }</p> }
                { ready && <p className="status-message success">Метаданные Jira успешно загружены</p> }
            </section>

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
                                <div className="field field-row full-width">
                                    <label>Стенд</label>
                                    <input
                                        type="text"
                                        value={ defaultStand }
                                        onChange={ e =>
                                        {
                                            const v = e.target.value;
                                            setDefaultStand(v);
                                            setTasks(ts => ts.map(t => ({ ...t, stand: v })));
                                        } }
                                    />
                                </div>
                                <div className="field">
                                    <label>Окружение</label>
                                    <input
                                        type="text"
                                        value={ defaultEnv }
                                        onChange={ e =>
                                        {
                                            const v = e.target.value;
                                            setDefaultEnv(v);
                                            setTasks(ts => ts.map(t => ({ ...t, env: v })));
                                        } }
                                    />
                                </div>
                                <div className="field">
                                    <label>Ссылка на требование</label>
                                    <input
                                        type="text"
                                        value={ defaultRequirementLink }
                                        onChange={ e =>
                                        {
                                            const v = e.target.value;
                                            setDefaultRequirementLink(v);
                                            setTasks(ts => ts.map(t => ({ ...t, requirementLink: v })));
                                        } }
                                    />
                                </div>
                                <div className="field">
                                    <label>Тестовые данные</label>
                                    <input
                                        type="text"
                                        value={ defaultTestData }
                                        onChange={ e =>
                                        {
                                            const v = e.target.value;
                                            setDefaultTestData(v);
                                            setTasks(ts => ts.map(t => ({ ...t, testData: v })));
                                        } }
                                    />
                                </div>
                                <div className="field">
                                    <label>Макет</label>
                                    <input
                                        type="text"
                                        value={ defaultMockup }
                                        onChange={ e =>
                                        {
                                            const v = e.target.value;
                                            setDefaultMockup(v);
                                            setTasks(ts => ts.map(t => ({ ...t, mockup: v })));
                                        } }
                                    />
                                </div>
                                <div className="field">
                                    <label>Воркер</label>
                                    <Select
                                        classNamePrefix="select"
                                        isClearable
                                        menuPortalTarget={ document.body }
                                        styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                                        options={ (fieldOptions.Worker || []).map(o => ({ value: o.id, label: o.name })) }
                                        value={ (fieldOptions.Worker || []).map(o => ({ value: o.id, label: o.name })).find(o => o.value === defaultWorker) || null }
                                        onChange={ opt =>
                                        {
                                            const v = opt?.value || '';
                                            setDefaultWorker(v);
                                            setTasks(ts => ts.map(t => ({ ...t, worker: v })));
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
                                    onClick={ handleFillAllWithAI }
                                    disabled={ aiFillAllLoading }
                                >
                                    { aiFillAllLoading ? 'Заполнение…' : 'Заполнить метаданные (AI)' }
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
                            <svg className="empty-state-dino" width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
                                <path d="M0,142L8,142L8,144L0,144L0,142ZM28,142L32,142L32,144L28,144L28,142ZM96,142L104,142L104,144L96,144L96,142ZM80,100L76,100L76,114L72,114L72,120L68,120L68,124L64,124L64,140L68,140L68,144L60,144L60,132L56,132L56,128L52,128L52,132L48,132L48,136L44,136L44,140L48,140L48,144L40,144L40,128L36,128L36,124L32,124L32,120L28,120L28,116L24,116L24,112L20,112L20,88L24,88L24,96L28,96L28,100L32,100L32,104L40,104L40,100L44,100L44,96L50,96L50,92L56,92L56,88L60,88L60,62L64,62L64,58L96,58L96,62L100,62L100,80L80,80L80,84L92,84L92,88L76,88L76,96L84,96L84,104L80,104L80,100ZM82,140L84,140L84,142L82,142L82,140ZM12,136L20,136L20,138L12,138L12,136ZM110,134L116,134L116,136L110,136L110,134ZM0,128L32,128L32,130L0,130L0,128ZM72,128L128,128L128,130L72,130L72,128ZM68,64L68,68L72,68L72,64L68,64Z" fill="currentColor" stroke="none" />
                            </svg>
                            <button type="button" className="btn btn-primary" onClick={ handleAdd }>
                                Добавить задачу
                            </button>
                        </div>
                    ) : selectedTaskIndex >= 0 && selectedTaskIndex < tasks.length ? (
                        <div className="task-list">
                            <CodeErrorCard
                                index={ selectedTaskIndex }
                                task={ tasks[selectedTaskIndex] }
                                onUpdate={ handleUpdate }
                                onDelete={ handleDelete }
                                onDeleteClick={ i => setDeleteSingleModalIndex(i) }
                                fieldOptions={ fieldOptions }
                                loadDefectOptions={ loadDefectOptions }
                                loadUserOptions={ loadUserOptions }
                                allureProject={ allureProject }
                                onDefectSelect={ fetchDefectDetails }
                                runAi={ runAi }
                                aiLoading={ aiLoading[selectedTaskIndex] }
                                fillFieldsWithAI={ fillFieldsWithAI }
                                aiFillLoading={ aiFillLoading[selectedTaskIndex] || false }
                                setAttachmentsMap={ setAttachmentsMap }
                                attachmentsMap={ attachmentsMap }
                                forceValidation={ forceValidationForTaskIndex === selectedTaskIndex }
                            />
                        </div>
                    ) : null }
                </div>
            </div>

            { launchDefectsModalOpen && (
                <div
                    className="modal"
                    onClick={ e =>
                    {
                        if (e.target === e.currentTarget) {
                            setLaunchDefectsModalOpen(false);
                            setSelectedLaunchForDefects(null);
                            setLaunchDefectsList([]);
                            setSelectedDefectIds(new Set());
                        }
                    } }
                >
                    <div className="modal-content" onClick={ e => e.stopPropagation() }>
                        <button className="modal-close-btn" onClick={ () =>
                        {
                            setLaunchDefectsModalOpen(false);
                            setSelectedLaunchForDefects(null);
                            setLaunchDefectsList([]);
                            setSelectedDefectIds(new Set());
                        } }>×</button>
                        <h2>{ selectedLaunchForDefects?.label || '' }</h2>
                        { launchDefectsLoading ? (
                            <p className="status-message loading">Загрузка дефектов…</p>
                        ) : launchDefectsList.length === 0 ? (
                            <p className="status-message">В этом запуске нет свободных дефектов (не привязанных к задачам).</p>
                        ) : (
                            <>
                                <div style={ { marginBottom: 8 } }>
                                    <button
                                        type="button"
                                        className="btn-link"
                                        onClick={ () =>
                                        {
                                            const allSelected = selectedDefectIds.size === launchDefectsList.length;
                                            setSelectedDefectIds(allSelected ? new Set() : new Set(launchDefectsList.map(d => d.id)));
                                        } }
                                    >
                                        { selectedDefectIds.size === launchDefectsList.length ? 'Снять выбор' : 'Выбрать все' }
                                    </button>
                                </div>
                                <div className="launch-defects-list">
                                    { launchDefectsList.map(d => (
                                        <div key={ d.id } className="launch-defect-item">
                                            <label className="launch-defect-checkbox-wrap">
                                                <input
                                                    type="checkbox"
                                                    checked={ selectedDefectIds.has(d.id) }
                                                    onChange={ e => handleDefectCheckboxChange(d.id, e.target.checked) }
                                                />
                                            </label>
                                            <a
                                                className="launch-defect-link"
                                                href={ `https://abanking.qatools.cloud/project/${allureProject}/defects/${d.id}` }
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                { d.name || `Дефект #${d.id}` } (ID: { d.id })
                                            </a>
                                        </div>
                                    )) }
                                </div>
                                <div className="buttons" style={ { marginTop: 16 } }>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={ () =>
                                        {
                                            setLaunchDefectsModalOpen(false);
                                            setSelectedLaunchForDefects(null);
                                            setLaunchDefectsList([]);
                                            setSelectedDefectIds(new Set());
                                        } }
                                    >
                                        Отмена
                                    </button>
                                    <button
                                        className="btn btn-primary"
                                        disabled={ selectedDefectIds.size === 0 }
                                        onClick={ handleConfirmDefectsFromLaunch }
                                    >
                                        Импортировать ({ selectedDefectIds.size })
                                    </button>
                                </div>
                            </>
                        ) }
                    </div>
                </div>
            ) }

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
                            <button
                                className="btn btn-secondary"
                                onClick={ handleDeleteSelected }
                            >
                                Да, удалить
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={ () => setDeleteModalOpen(false) }
                            >
                                Нет
                            </button>
                        </div>
                    </div>
                </div>
            ) }

            { deleteSingleModalIndex !== null && deleteSingleModalIndex < tasks.length && (
                <div
                    className="modal"
                    onClick={ e => { if (e.target === e.currentTarget) setDeleteSingleModalIndex(null); } }
                >
                    <div className="modal-content" onClick={ e => e.stopPropagation() }>
                        <h1>Удалить задачу?</h1>
                        <p className="delete-modal-task-name">{ tasks[deleteSingleModalIndex].summary || 'Без темы' }</p>
                        <div className="buttons" style={ { display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: 16 } }>
                            <button
                                className="btn btn-secondary"
                                onClick={ () =>
                                {
                                    handleDelete(deleteSingleModalIndex);
                                    setDeleteSingleModalIndex(null);
                                } }
                            >
                                Да, удалить
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={ () => setDeleteSingleModalIndex(null) }
                            >
                                Нет
                            </button>
                        </div>
                    </div>
                </div>
            ) }

            {
                modalOpen && (
                    <div
                        className="modal"
                        onClick={ e => { if (e.target === e.currentTarget) setModalOpen(false); } }
                    >
                        <div className="modal-content" onClick={ e => e.stopPropagation() }>
                            <button className="modal-close-btn" onClick={ () => setModalOpen(false) }>×</button>
                            <h2>Общие поля для ({ selectedTasksCount }) { tasksWord(selectedTasksCount, 'genitive') }</h2>
                            <fieldset disabled={ !ready || creating } className="common-fields-group">

                                {/* Epic Link */ }
                                <div className="field full-width">
                                    <label>Epic Link</label>
                                    <AsyncSelect
                                        classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={ input => loadIssueOptions(input, 'issuetype = "Эпик"') }
                                        placeholder="Начните вводить Epic Link…"
                                        value={ epicOption }
                                        onChange={ opt => setEpicOption(opt) }
                                        noOptionsMessage={ () => 'Нет совпадений' }
                                        isClearable
                                    />
                                </div>

                                {/* Исполнитель */ }
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
                                {/* Основной исполнитель */ }
                                <div className="field">
                                    <label>Основной исполнитель (необязательно)</label>
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

                                {/* Ревьюеры */ }
                                <div className="field">
                                    <label>Ревьюеры (необязательно)</label>
                                    <AsyncSelect
                                        classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={ loadUserOptions }
                                        placeholder="Начните вводить имена…"
                                        isMulti
                                        value={ reviewerOption || [] }
                                        onChange={ opts => setReviewerOption(opts || []) }
                                        noOptionsMessage={ () => 'Нет совпадений' }
                                        isClearable
                                    />
                                </div>
                                {/* Затронутая версия */ }
                                <div className={ `field ${versionTouched && !versionOption?.value ? 'field-invalid' : ''}` }>
                                    <label>Затронутая версия*</label>
                                    <AsyncSelect
                                        classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={ loadVersionOptions }
                                        placeholder="Начните вводить версию…"
                                        value={ versionOption }
                                        onChange={ opt => { setVersionOption(opt); if (opt?.value) setVersionTouched(false); } }
                                        onBlur={ () => setVersionTouched(true) }
                                        noOptionsMessage={ () => 'Нет совпадений' }
                                        isClearable
                                    />
                                </div>
                                {/* Целевой статус */ }
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
                            {/*
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
                                        // показываем только отфильтрованные
                                        options={ filteredLinkTypes }
                                        value={ filteredLinkTypes.find(o => o.value === requestLinkType) || null }
                                        onChange={ opt => setRequestLinkType(opt?.value || null) }
                                        isClearable
                                    />
                                </div>
                            </fieldset>
                            */}
                            <div className="buttons">
                                { selectedTasksCount === 0 ? (
                                    <button onClick={ () => setModalOpen(false) } className="btn btn-primary">
                                        Вернуться
                                    </button>
                                ) : (
                                    <button onClick={ handleCreateAll } disabled={ !ready || creating || !versionOption?.value } className="btn btn-primary">
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

                )
            }
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
            { showValidationToast && (
                <div className="validation-toast" role="alert">
                    Не заполнены обязательные поля
                </div>
            ) }
        </div >

    );
}
