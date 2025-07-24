/* eslint-disable no-undef */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import { get as idbGet, set as idbSet, clear as idbClear } from 'idb-keyval';
import './CodeErrorPage.css';
import config from './config.json';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import useAttachmentsMap from './components/useAttachmentsMap'
import { serializeFile } from './components/fileStorage'

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

        if (key === 'codeErrorTasks') {
            const toPersist = (Array.isArray(state) ? state : []).map(t => {
                const {
                    attachments,
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


export const CodeErrorCard = ({
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
        const serialized = await Promise.all(rawFiles.map(f => serializeFile(f)))
        setAttachmentsMap(m => ({
            ...m,
            [task.id]: {
                ...(m[task.id] || {}),
                common: [...(m[task.id]?.common || []), ...serialized],
                [field]: [...(m[task.id]?.[field] || []), ...renamedFiles]
            }
        }));
    };



    // утилита: превратить fieldOptions в [{value, label}]
    const toOptions = key =>
        (fieldOptions[key] || []).map(o => ({ value: o.id, label: o.name }));

    // кастомный рендер для Allure Defect
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
                {/* Allure Defect */}
                <div className="field full-width">
                    <label>Дефект Allure</label>
                    <AsyncSelect
                        key={allureProject}
                        classNamePrefix="select"
                        cacheOptions
                        defaultOptions
                        loadOptions={input => loadDefectOptions(allureProject, input)}
                        isClearable
                        placeholder="Начните вводить..."
                        value={task.allureDefect}
                        onChange={opt => {
                            onUpdate(index, { ...task, allureDefect: opt });
                            if (opt?.value) onDefectSelect(index, opt.value);
                        }}
                        noOptionsMessage={() =>
                            allureProject ? 'Нет совпадений' : 'Выберите проект'
                        }
                        isOptionDisabled={opt => opt.linked}
                        formatOptionLabel={formatAllureOptionLabel}
                        formatGroupLabel={group => (
                            <div
                                style={{
                                    fontWeight: 600,
                                    padding: '4px 8px',
                                    backgroundColor: 'var(--bg-input)',
                                    color: group.label.includes('Свободные')
                                        ? 'var(--success)'
                                        : 'var(--warning)'
                                }}
                            >
                                {group.label} ({group.options.length})
                            </div>
                        )}
                    />
                </div>

                {/* Подробное описание */}
                <div className="field full-width">
                    <label htmlFor={`description-${index}`}>Подробное описание*</label>
                    <textarea
                        id={`description-${index}`}
                        rows={4}
                        placeholder="Детальное описание, контекст..."
                        value={task.description}
                        onChange={handleChange('description')}
                        onPaste={handlePaste('description')}
                    />
                </div>
                {/* ← вот этот блок добавляем */}
                {task.aiDescription && (
                    <div className="ai-feedback full-width">
                        <strong>AI Описание:</strong> {task.aiDescription}
                    </div>
                )}
                {/* Шаги воспроизведения */}
                <div className="field full-width">
                    <label htmlFor={`steps-${index}`}>Шаги воспроизведения*</label>
                    <textarea
                        id={`steps-${index}`}
                        rows={4}
                        placeholder="1. Открыть... 2. Нажать... 3. Увидеть ошибку..."
                        value={task.steps}
                        onChange={handleChange('steps')}
                        onPaste={handlePaste('steps')}
                    />
                </div>
                {task.aiSteps && (
                    <div className="ai-feedback full-width">
                        <strong>AI Шаги:</strong> {task.aiSteps}
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
                                    {/* кнопка удаления */}
                                    <button
                                        type="button"
                                        className="remove-attachment-btn"
                                        onClick={() => {
                                            // 1) Убираем из UI‑массива
                                            const newAttachments = task.attachments.filter((_, idx) => idx !== i);
                                            onUpdate(index, { ...task, attachments: newAttachments });

                                            // 2) Синхронно убираем из serialized‑мапы
                                            setAttachmentsMap(m => {
                                                const entry = m[task.id] || {};
                                                // удаляем из common
                                                const common = (entry.common || []).filter(x => x.name !== f.name);
                                                // если у вас есть field‑specific вложения, аналогично удалите из entry.description, entry.steps и т.д.
                                                return {
                                                    ...m,
                                                    [task.id]: {
                                                        ...entry,
                                                        common,
                                                        // description: (entry.description || []).filter(x => x.name !== f.name),
                                                        // steps:       (entry.steps       || []).filter(x => x.name !== f.name),
                                                        // actual:      (entry.actual      || []).filter(x => x.name !== f.name),
                                                        // expected:    (entry.expected    || []).filter(x => x.name !== f.name),
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
                        <label>Стенд</label>
                        <input
                            type="text"
                            placeholder="e.g., test-01"
                            value={task.stand}
                            onChange={handleChange('stand')}
                        />
                    </div>
                    <div className="field">
                        <label>Окружение</label>
                        <input
                            type="text"
                            placeholder="e.g., Chrome, Android"
                            value={task.env}
                            onChange={handleChange('env')}
                        />
                    </div>
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
                        <label>Тестовые данные</label>
                        <input
                            type="text"
                            placeholder="Логин/пароль"
                            value={task.testData}
                            onChange={handleChange('testData')}
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

                {/* === Жирные JIRA‑селекты === */}
                <div className="field-group">
                    <div className="field">
                        <label>Серьезность*</label>
                        <Select
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            menuPlacement="auto"
                            styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                            classNamePrefix="select"
                            placeholder="Выберите..."
                            options={toOptions('Severity')}
                            value={toOptions('Severity').find(o => o.value === task.severity) || null}
                            onChange={opt => onUpdate(index, { ...task, severity: opt?.value || '' })}
                        />
                    </div>
                    <div className="field">
                        <label>Симптом*</label>
                        <Select
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            menuPlacement="auto"
                            styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                            classNamePrefix="select"
                            isMulti
                            placeholder="Выберите..."
                            options={toOptions('Symptom')}
                            value={toOptions('Symptom').filter(o => task.symptom.includes(o.value))}
                            onChange={opts => onUpdate(index, { ...task, symptom: opts.map(o => o.value) })}
                        />
                    </div>
                    <div className="field">
                        <label>Платформа*</label>
                        <Select
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            menuPlacement="auto"
                            styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                            classNamePrefix="select"
                            isMulti
                            placeholder="Выберите..."
                            options={toOptions('Platform')}
                            value={toOptions('Platform').filter(o => task.platform.includes(o.value))}
                            onChange={opts => onUpdate(index, { ...task, platform: opts.map(o => o.value) })}
                        />
                    </div>
                    <div className="field">
                        <label>Баг с прода*</label>
                        <Select
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            menuPlacement="auto"
                            styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                            classNamePrefix="select"
                            placeholder="Да/Нет"
                            options={toOptions('ProdBug')}
                            value={toOptions('ProdBug').find(o => o.value === task.prodBug) || null}
                            onChange={opt => onUpdate(index, { ...task, prodBug: opt.value })}
                            isClearable={false}
                        />
                    </div>
                </div>

                {/* AI‑кнопка */}
                <div className="ai-controls">
                    <button
                        onClick={() => runAi(index)}
                        disabled={aiLoading}
                        className="btn ai-btn"
                    >
                        {aiLoading ? 'Проверка AI…' : '✨ Проверить AI'}
                    </button>
                    <button
                        onClick={() => fillFieldsWithAI(index)}
                        disabled={aiFillLoading}
                        className="btn ai-fill-btn"
                        style={{ marginLeft: '8px' }}
                        title="🤖 Заполнить поля AI"
                    >
                        {aiFillLoading ? '⏳ …' : '🤖 AI‑поля'}
                    </button>
                </div>
            </div>
        </div >
    );
};




//основной компонент страницы
export default function CodeErrorPage({ projects }) {
    console.log('%c<CodeErrorPage/> render', 'color: #999;');
    const [attachmentsMap, setAttachmentsMap] = useAttachmentsMap('codeErrorAttachmentsMap');
    // блок default-значений
    const [defaultStand, setDefaultStand] = usePersistentState('defaultStand', '');
    const [defaultEnv, setDefaultEnv] = usePersistentState('defaultEnv', '');
    const [defaultRequirementLink, setDefaultRequirementLink] = usePersistentState('defaultRequirementLink', '');
    const [defaultTestData, setDefaultTestData] = usePersistentState('defaultTestData', '');
    const [defaultMockup, setDefaultMockup] = usePersistentState('defaultMockup', '');
    const [defaultProdBug, setDefaultProdBug] = usePersistentState('defaultProdBug', '');

    // Состояния и хуки
    const [tasks, setTasks] = usePersistentState('codeErrorTasks', []);
    const [jiraProject, setJiraProject] = usePersistentState('jiraProject', '');
    const [jiraPat, setJiraPat] = usePersistentState('jiraPat', '');
    const [epicOption, setEpicOption] = usePersistentState('codeErrorEpic', null);
    const [assigneeOption, setAssigneeOption] = usePersistentState('codeErrorAssignee', null);
    const [versionOption, setVersionOption] = usePersistentState('codeErrorVersion', null);
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
    const [requestLinkOption, setRequestLinkOption] = usePersistentState('codeErrorReqLink', null);
    const [aiFillAllLoading, setAiFillAllLoading] = useState(false);
    const [aiFillLoading, setAiFillLoading] = useState({});
    const [linkTypes, setLinkTypes] = useState([]);
    const [requestLinkType, setRequestLinkType] = usePersistentState('codeErrorReqLinkType', null);
    const debProject = useDebounce(jiraProject, 500);
    const debPat = useDebounce(jiraPat, 500);
    const allowedLinkNames = ['Блокирует', 'Относится', 'Клонирование', 'Порождение'];
    const [collapsedStates, setCollapsedStates] = useState({});
    const requestLinkIssue = requestLinkOption?.value || null;
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
    useEffect(() => {
        if (!defaultProdBug) return;
        setTasks(tasks =>
            tasks.map(t => ({
                ...t,
                prodBug: t.prodBug || defaultProdBug
            }))
        );
    }, [defaultProdBug]);

    const cardRefs = useRef([]);

    useEffect(() => {
        cardRefs.current = tasks.map((_, i) => cardRefs.current[i] || React.createRef());
        console.log('%c[tasks] changed:', 'color: #0a0;', tasks);
    }, [tasks]);

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

    const loadVersionOptions = input =>
        axios.get(`${config.serverUrl}/jira/versions`, { params: { projectKey: jiraProject, pat: jiraPat, query: input } })
            .then(r => r.data.map(v => ({ value: v.id, label: v.name })))
            .catch(() => []);

    const loadTransitions = useCallback(async () => {
        if (!debProject || !debPat) return;
        try {
            const sample = 'JMT-14927';
            const { data } = await axios.get(`${config.serverUrl}/jira/transitions`, { params: { issueKey: sample, pat: jiraPat } });
            setTransitions(data);
        } catch { console.warn('Не удалось загрузить transitions'); }
    }, [debProject, debPat]);
    useEffect(() => { if (modalOpen) loadTransitions(); }, [modalOpen, loadTransitions]);
    useEffect(() => {
        if (fieldOptions.ProdBug?.length && !defaultProdBug) {
            const noOption = fieldOptions.ProdBug.find(o => o.name === 'Нет');
            if (noOption) {
                setDefaultProdBug(noOption.id);
            }
        }
    }, [fieldOptions.ProdBug, defaultProdBug, setDefaultProdBug]);
    useEffect(() => {
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
            // по очереди обрабатываем все выбранные задачи
            const updated = await Promise.all(tasks.map(async (t) => {
                if (!t.selected) return t;
                // собираем полезные поля
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
                    expected: data.expected,
                    severity: data.severity,
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
            // data: { actual, expected, severity, platform: [], symptom: [] }
            setTasks(ts => ts.map((c, i) => i === idx
                ? {
                    ...c,
                    actual: data.actual,
                    expected: data.expected,
                    severity: data.severity,
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

    const runAi = async idx => {
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

    const handleAdd = () => {
        console.log('handleAdd вызван'); // чтобы убедиться, что срабатывает
        console.log('%chandleAdd start', 'color: #00f; font-weight: bold;');
        console.trace('trace handleAdd');

        // 1) Сгенерировать уникальный ID
        const newId = uuidv4();
        console.log(' — новый ID:', newId);

        // 2) Инициализировать пустые массивы вложений для этого ID
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

        // 3) Создать новый таск и вставить в начало списка
        setTasks(prev => [{
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
            symptom: [],
            platform: [],
            prodBug: defaultProdBug,
            selected: true,
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
        }, ...prev]);

        // 4) Развернуть новую карточку (index 0) и сдвинуть старые collapsedStates
        setCollapsedStates(prev => {
            const next = { 0: false };
            Object.entries(prev).forEach(([key, val]) => {
                next[Number(key) + 1] = val;
            });
            return next;
        });
        console.log('%chandleAdd end, tasks after add will be:', 'color: #00f;', /* вы не можете логнуть сразу новый tasks */);

    };


    const handleDelete = i => {
        console.log(`%chandleDelete index=${i}`, 'color: #f00; font-weight: bold;');
        setTasks(ts => {
            const next = ts.filter((_, idx) => idx !== i);
            console.log(' — tasks после удаления будут:', next);
            return next;
        });
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

    // NEW: handler to toggle card collapse state
    const handleToggleCollapse = index => {
        setCollapsedStates(prev => ({
            ...prev,
            [index]: !prev[index] // Toggle state, default to expanded if undefined
        }));
    };

    const handleCreateAll = async () => {
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
*Макет:* ${t.mockup || 'не указано'}`;

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
            if (t.prodBug) fields[fieldIds.ProdBug] = { id: t.prodBug };
            if (!versionOption?.value) {
                alert('Выберите затронутую версию.');
                return;
            }
            if (epicOption?.value) {
                fields[fieldIds['Epic Link']] = epicOption.value;
            }
            if (assigneeOption?.value) {
                fields.assignee = { name: assigneeOption.value };
            }

            try {
                // 2) создаём задачу
                const { data: { key } } = await axios.post(
                    `${config.serverUrl}/jira/create-issue`,
                    { pat: jiraPat, payload: { fields } }
                );
                out.push({ success: true, summary: t.summary, key });

                // 3) собираем **все** файлы из четырёх разделов + общего
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
                                inwardIssueKey: requestLinkIssue,
                                outwardIssueKey: key
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
    const filteredLinkTypes = linkTypes.filter(o =>
        allowedLinkNames.includes(o.value)
    );
    return (
        <div className="solution-page">
            <h1>Массовое создание баг-репортов</h1>

            <section className="page-section">
                <h2>1. Настройки подключения</h2>
                <div className="settings-grid">
                    {/* FIXED: Added field wrapper and label */}
                    <div className="field full-width">
                        <label>Project Key (Jira)</label>
                        <input type="text" value={jiraProject} onChange={e => setJiraProject(e.target.value.toUpperCase())} required placeholder="PROJ" />
                    </div>
                    <div className="field">
                        <label>Jira PAT (Personal Access Token)</label>
                        <input type="password" value={jiraPat} onChange={e => setJiraPat(e.target.value)} placeholder="Ваш токен доступа Jira" />
                    </div>
                    {/* FIXED: Added field wrapper and label */}
                    <div className="field">
                        <label>Проект Allure</label>
                        <Select
                            classNamePrefix="select"
                            placeholder="Выберите проект Allure…"
                            options={projects.map(p => ({ value: p.id, label: p.name }))}
                            value={projects.map(p => ({ value: p.id, label: p.name })).find(o => o.value === allureProject) || null}
                            isClearable
                            onChange={opt => setAllureProject(opt?.value || '')}
                        />
                    </div>
                </div>
                {isMetaLoading && <p className="status-message loading">Загрузка метаданных Jira…</p>}
                {metaError && <p className="status-message error">{metaError}</p>}
                {ready && <p className="status-message success">Метаданные Jira успешно загружены</p>}
            </section>

            <div className="task-controls">
                <button className="btn btn-secondary" onClick={handleAdd}>➕ Добавить задачу</button>
                <button
                    className="btn btn-secondary"
                    onClick={handleFillAllWithAI}
                    disabled={aiFillAllLoading}
                    style={{ marginLeft: '8px' }}
                >
                    {aiFillAllLoading ? 'Заполнение всех…' : '🤖 Заполнить метаданные для всех задач'}
                </button>
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
            {
                tasks.length > 3 && (
                    <div className="mini-nav">
                        {tasks.map((t, i) => (
                            <button
                                key={i}
                                onClick={() => {
                                    const ref = cardRefs.current[i];
                                    if (ref && ref.current) {
                                        ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                }}
                            >
                                {i + 1}. {t.summary || 'Без темы'}
                            </button>
                        ))}
                    </div>
                )
            }

            <div className="task-list">
                <div className="defaults-panel">
                    <h3>Значения по умолчанию для полей</h3>
                    <div className="field-group">
                        <div className="field">
                            <label>Стенд</label>
                            <input
                                type="text"
                                value={defaultStand}
                                onChange={e => {
                                    const v = e.target.value;
                                    setDefaultStand(v);
                                    // обновляем ВСЕ карточки
                                    setTasks(ts => ts.map(t => ({ ...t, stand: v })));
                                }}
                            />
                        </div>
                        <div className="field">
                            <label>Окружение</label>
                            <input
                                type="text"
                                value={defaultEnv}
                                onChange={e => {
                                    const v = e.target.value;
                                    setDefaultEnv(v);
                                    setTasks(ts => ts.map(t => ({ ...t, env: v })));
                                }}
                            />
                        </div>
                        <div className="field">
                            <label>Ссылка на требование</label>
                            <input
                                type="text"
                                value={defaultRequirementLink}
                                onChange={e => {
                                    const v = e.target.value;
                                    setDefaultRequirementLink(v);
                                    setTasks(ts => ts.map(t => ({ ...t, requirementLink: v })));
                                }}
                            />
                        </div>
                        <div className="field">
                            <label>Тестовые данные</label>
                            <input
                                type="text"
                                value={defaultTestData}
                                onChange={e => {
                                    const v = e.target.value;
                                    setDefaultTestData(v);
                                    setTasks(ts => ts.map(t => ({ ...t, testData: v })));
                                }}
                            />
                        </div>
                        <div className="field">
                            <label>Макет</label>
                            <input
                                type="text"
                                value={defaultMockup}
                                onChange={e => {
                                    const v = e.target.value;
                                    setDefaultMockup(v);
                                    setTasks(ts => ts.map(t => ({ ...t, mockup: v })));
                                }}
                            />
                        </div>
                    </div>
                </div>
                {tasks.map((t, i) => (
                    <div key={i} ref={cardRefs.current[i]}>
                        <CodeErrorCard
                            index={i}
                            task={t}
                            onUpdate={handleUpdate}
                            onDelete={handleDelete}
                            key={i}
                            index={i}
                            //   task={t}
                            //   onUpdate={handleUpdate}
                            //   onDelete={handleDelete}
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

            {
                modalOpen && (
                    <div className="modal">
                        <div className="modal-content">
                            <button className="modal-close-btn" onClick={() => setModalOpen(false)}>×</button>
                            <h2>2. Общие поля для ({selectedTasksCount}) задач</h2>
                            <fieldset disabled={!ready || creating} className="common-fields-group">
                                <legend>Общие поля Jira</legend>

                                {/* Epic Link */}
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

                                {/* Исполнитель */}
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

                                {/* Затронутая версия */}
                                <div className="field">
                                    <label>Затронутая версия*</label>
                                    <AsyncSelect
                                        classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={loadVersionOptions}
                                        placeholder="Начните вводить версию…"
                                        value={versionOption}
                                        onChange={opt => setVersionOption(opt)}
                                        noOptionsMessage={() => 'Нет совпадений'}
                                        isClearable
                                    />
                                </div>
                                {/* Целевой статус */}
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
                                        // показываем только отфильтрованные
                                        options={filteredLinkTypes}
                                        value={filteredLinkTypes.find(o => o.value === requestLinkType) || null}
                                        onChange={opt => setRequestLinkType(opt?.value || null)}
                                        isClearable
                                    />
                                </div>
                            </fieldset>
                            <div className="buttons">
                                <button onClick={handleCreateAll} disabled={!ready || creating || !versionOption?.value} className="btn btn-primary">
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

                )
            }
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
        </div >

    );
}