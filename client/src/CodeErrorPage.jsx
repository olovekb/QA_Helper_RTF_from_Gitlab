// src/CodeErrorPage.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import { get as idbGet, set as idbSet, clear as idbClear } from 'idb-keyval';
import './CodeErrorPage.css';
import config from './config.json';
import { useNavigate } from 'react-router-dom';





// --- Пользовательские хуки (без изменений) ---
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
    useEffect(() => {
        let mounted = true;
        idbGet(key).then(stored => {
            if (mounted && stored !== undefined) {
                setState(stored);
            }
        }).catch(console.warn);
        return () => { mounted = false; };
    }, [key]);

    const setPersistent = updaterOrValue => {
        setState(prev => {
            const newValue = typeof updaterOrValue === 'function'
                ? updaterOrValue(prev)
                : updaterOrValue;
            idbSet(key, newValue).catch(err => {
                console.warn('Не удалось записать в IndexedDB:', err);
            });
            return newValue;
        });
    };
    return [state, setPersistent];
}


// ===============================================
//   Обновленный компонент: CodeErrorCard
// ===============================================
const CodeErrorCard = ({
    task, index, onUpdate, onDelete,
    fieldOptions, loadDefectOptions, onDefectSelect,
    allureProject, runAi, aiLoading,
    isCollapsed, onToggleCollapse // NEW props for collapse
}) => {
    const handleChange = field => e => {
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        onUpdate(index, { ...task, [field]: v });
    };

    const toOptions = key => (fieldOptions[key] || []).map(o => ({ value: o.id, label: o.name }));

    const formatAllureOptionLabel = (opt, { context }) => {
        if (context === 'value') {
            return opt.label.split('(')[0].trim();
        }
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
                {/* NEW: Collapse button */}
                <button className="collapse-toggle" onClick={() => onToggleCollapse(index)} title={isCollapsed ? "Развернуть" : "Свернуть"}>
                    {isCollapsed ? '▶' : '▼'}
                </button>
                <input
                    type="checkbox"
                    checked={task.selected}
                    onChange={handleChange('selected')}
                    title="Выбрать/снять выбор с задачи"
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
                <button
                    className="delete-task-btn"
                    onClick={() => onDelete(index)}
                    title="Удалить задачу"
                >
                    ❌
                </button>
            </div>
            {task.aiSummary && (
                <div className="ai-feedback full-width">
                    <strong>AI Тема:</strong> {task.aiSummary}
                </div>
            )}

            {/* NEW: Collapsible body */}
            <div className={`card-body ${isCollapsed ? 'collapsed' : ''}`}>
                {/* MOVED: Allure Defect field is now at the top */}
                <div className="field full-width">
                    <label>Дефект Allure</label>
                    <AsyncSelect
                        classNamePrefix="select"
                        cacheOptions
                        defaultOptions
                        loadOptions={input => loadDefectOptions(allureProject, input)}
                        isClearable
                        placeholder="Начните вводить для поиска..."
                        value={task.allureDefect}
                        onChange={opt => {
                            onUpdate(index, { ...task, allureDefect: opt });
                            if (opt?.value) onDefectSelect(index, opt.value);
                        }}
                        noOptionsMessage={() => allureProject ? 'Нет совпадений' : 'Выберите проект Allure'}
                        isOptionDisabled={opt => opt.linked}
                        formatOptionLabel={formatAllureOptionLabel}
                        formatGroupLabel={group => (
                            <div
                                style={{
                                    fontWeight: 600,
                                    padding: '4px 8px',
                                    backgroundColor: 'var(--bg-input)',
                                    color: group.label.includes('Свободные') ? 'var(--success)' : 'var(--warning)'
                                }}
                            >
                                {group.label} ({group.options.length})
                            </div>
                        )}
                    />

                </div>

                {/* --- Основные поля баг-репорта --- */}
                <div className="field full-width">
                    <label htmlFor={`description-${index}`}>Подробное описание*</label>
                    <textarea id={`description-${index}`} rows={4} placeholder="Детальное описание, контекст..." value={task.description} onChange={handleChange('description')} />
                    {task.aiDescription && <div className="ai-feedback"><strong>AI Описание:</strong> {task.aiDescription}</div>}
                </div>
                <div className="field full-width">
                    <label htmlFor={`steps-${index}`}>Шаги воспроизведения*</label>
                    <textarea id={`steps-${index}`} rows={4} placeholder="1. Открыть...&#10;2. Нажать...&#10;3. Увидеть ошибку..." value={task.steps} onChange={handleChange('steps')} />
                    {task.aiSteps && <div className="ai-feedback"><strong>AI Шаги:</strong> {task.aiSteps}</div>}
                </div>

                <div className="field-group">
                    <div className="field full-width">
                        <label htmlFor={`actual-${index}`}>Фактический результат*</label>
                        <textarea id={`actual-${index}`} rows={2} placeholder="Что произошло на самом деле" value={task.actual} onChange={handleChange('actual')} />
                        {task.aiActual && <div className="ai-feedback"><strong>AI Факт. рез-т:</strong> {task.aiActual}</div>}
                    </div>
                    <div className="field full-width">
                        <label htmlFor={`expected-${index}`}>Ожидаемый результат*</label>
                        <textarea id={`expected-${index}`} rows={2} placeholder="Что должно было произойти" value={task.expected} onChange={handleChange('expected')} />
                        {task.aiExpected && <div className="ai-feedback"><strong>AI Ожид. рез-т:</strong> {task.aiExpected}</div>}
                    </div>
                </div>

                {/* --- Дополнительная информация --- */}
                <div className="field-group">
                    <div className="field"><label>Стенд</label><input type="text" placeholder="e.g., test-01" value={task.stand} onChange={handleChange('stand')} /></div>
                    <div className="field"><label>Окружение</label><input type="text" placeholder="e.g., Chrome, Android" value={task.env} onChange={handleChange('env')} /></div>
                    <div className="field"><label>Ссылка на требование</label><input type="text" placeholder="URL в Confluence" value={task.requirementLink} onChange={handleChange('requirementLink')} /></div>
                    <div className="field"><label>Тестовые данные</label><input type="text" placeholder="Логин/пароль" value={task.testData} onChange={handleChange('testData')} /></div>
                    <div className="field"><label>Макет</label><input type="text" placeholder="URL в Figma" value={task.mockup} onChange={handleChange('mockup')} /></div>
                </div>

                {/* --- Поля Jira --- */}
                <div className="field-group">
                    <div className="field"><label>Серьезность*</label><Select menuPortalTarget={document.body}
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }} classNamePrefix="select" placeholder="Выберите..." options={toOptions('Severity')} value={toOptions('Severity').find(o => o.value === task.severity) || null} onChange={opt => onUpdate(index, { ...task, severity: opt?.value || '' })} /></div>
                    <div className="field"><label>Симптом*</label><Select menuPortalTarget={document.body}
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }} classNamePrefix="select" isMulti placeholder="Выберите..." options={toOptions('Symptom')} value={toOptions('Symptom').filter(o => task.symptom.includes(o.value))} onChange={opts => onUpdate(index, { ...task, symptom: opts.map(o => o.value) })} /></div>
                    <div className="field"><label>Платформа*</label><Select menuPortalTarget={document.body}
                        menuPosition="fixed"
                        menuPlacement="auto"
                        styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }} classNamePrefix="select" isMulti placeholder="Выберите..." options={toOptions('Platform')} value={toOptions('Platform').filter(o => task.platform.includes(o.value))} onChange={opts => onUpdate(index, { ...task, platform: opts.map(o => o.value) })} /></div>
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
                            isClearable={false}        // запретим “пустой” выбор после того, как пользователь выбрал
                        />
                    </div>

                </div>

                <div className="ai-controls">
                    <button onClick={() => runAi(index)} disabled={aiLoading} className="btn ai-btn">
                        {aiLoading ? 'Проверка AI…' : '✨ Проверить AI'}
                    </button>
                </div>
            </div>
        </div>
    );
};


// ===============================================
//   Обновленный основной компонент страницы
// ===============================================
export default function CodeErrorPage({ projects }) {

    // ——— блок default-значений
    const [defaultStand, setDefaultStand] = usePersistentState('defaultStand', '');
    const [defaultEnv, setDefaultEnv] = usePersistentState('defaultEnv', '');
    const [defaultRequirementLink, setDefaultRequirementLink] = usePersistentState('defaultRequirementLink', '');
    const [defaultTestData, setDefaultTestData] = usePersistentState('defaultTestData', '');
    const [defaultMockup, setDefaultMockup] = usePersistentState('defaultMockup', '');
    const [defaultProdBug, setDefaultProdBug] = usePersistentState('defaultProdBug', '');

    // --- Состояния и хуки ---
    const [tasks, setTasks] = usePersistentState('codeErrorTasks', []);
    const [jiraProject, setJiraProject] = usePersistentState('jiraProject', '');
    const [jiraPat, setJiraPat] = usePersistentState('jiraPat', '');
    const [epicLink, setEpicLink] = usePersistentState('epicLink', '');
    const [assignee, setAssignee] = usePersistentState('assignee', '');
    const [affectedVersion, setAffectedVersion] = usePersistentState('affectedVersion', '');
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
    const debProject = useDebounce(jiraProject, 500);
    const debPat = useDebounce(jiraPat, 500);
    // NEW state for collapsed cards
    const [collapsedStates, setCollapsedStates] = useState({});
    useEffect(() => {
        if (!defaultProdBug) return;  // ждём, пока defaultProdBug станет truthy
        setTasks(tasks =>
            tasks.map(t => ({
                ...t,
                prodBug: t.prodBug || defaultProdBug
            }))
        );
    }, [defaultProdBug, setTasks]);

    const cardRefs = useRef([]);

    // синхронизируем длину списка ref'ов с кол-вом задач
    useEffect(() => {
        cardRefs.current = tasks.map((_, i) => cardRefs.current[i] || React.createRef());
    }, [tasks]);


    // --- Функции загрузки данных (логика не изменена) ---
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
            const sample = 'JMT-14707';
            const { data } = await axios.get(`${config.serverUrl}/jira/transitions`, { params: { issueKey: sample, pat: jiraPat } });
            setTransitions(data);
        } catch { console.warn('Не удалось загрузить transitions'); }
    }, [debProject, debPat]);
    useEffect(() => { if (modalOpen) loadTransitions(); }, [modalOpen, loadTransitions]);
    useEffect(() => {
        // Если список опций уже есть, и дефолт ещё не установлен
        if (fieldOptions.ProdBug?.length && !defaultProdBug) {
            const noOption = fieldOptions.ProdBug.find(o => o.name === 'Нет');
            if (noOption) {
                setDefaultProdBug(noOption.id);
            }
        }
    }, [fieldOptions.ProdBug, defaultProdBug, setDefaultProdBug]);
    
    const loadDefectOptions = async (projectId, input) => {
        if (!projectId) return [];

        // 1) Получаем у бэкенда до 100 дефектов
        const { data: defects } = await axios.get(
            `${config.serverUrl}/allure/defects`,
            {
                params: {
                    projectId,
                    page: 0,
                    size: 100,
                    // можем оставить query, чтобы сервер тоже попытался фильтровать
                    query: input || undefined
                }
            }
        );

        // 2) Клиентская фильтрация: по части имени или по ID
        const needle = input.trim().toLowerCase();
        const filtered = needle
            ? defects.filter(d => {
                // матчим и по тексту, и по цифрам
                return (
                    d.name.toLowerCase().includes(needle) ||
                    String(d.id).includes(needle)
                );
            })
            : defects;

        // 3) Группируем на свободные и привязанные
        const opts = filtered.map(d => ({
            value: d.id,
            label: `${d.name} (ID: ${d.id})`,
            linked: Boolean(d.issue)
        }));
        const unlinked = opts.filter(o => !o.linked);
        const linked = opts.filter(o => o.linked);

        return [
            { label: 'Свободные дефекты', options: unlinked },
            { label: 'Уже привязанные дефекты', options: linked }
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

    const runAi = async idx => {
        const t = tasks[idx];
        setAiLoading(l => ({ ...l, [idx]: true }));
        try {
            const { data } = await axios.post(`${config.serverUrl}/api/bug/ai-review`, { task: t });
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
    const handleAdd = () => {
        setTasks(ts => [{
            summary: '', description: '', steps: '', actual: '', expected: '',
            stand: defaultStand,
            env: defaultEnv,
            requirementLink: defaultRequirementLink,
            testData: defaultTestData,
            mockup: defaultMockup,
            severity: '', symptom: [], platform: [], prodBug: defaultProdBug,
            selected: true, isNew: true, allureDefect: null,
            aiSummary: '', aiDescription: '', aiSteps: '', aiActual: '', aiExpected: ''
        }, ...ts]);
        // NEW: expand the newly added card
        setCollapsedStates(prev => {
            const newStates = { 0: false }; // new task is at index 0 and expanded
            Object.keys(prev).forEach(key => {
                newStates[parseInt(key, 10) + 1] = prev[key];
            });
            return newStates;
        });
    };

    const handleDelete = i => {
        setTasks(ts => ts.filter((_, idx) => idx !== i));
        // NEW: clean up collapsed state
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
        if (!affectedVersion) {
            alert('Выберите затронутую версию.');
            return;
        }
        setCreating(true);
        setResults([]);
        const out = [];

        for (const t of tasks.filter(t => t.selected)) {
            const desc = `h3. Подробное описание\n${t.description}\n\nh3. Шаги воспроизведения\n${t.steps}\n\nh3. Фактический результат\n${t.actual}\n\nh3. Ожидаемый результат\n${t.expected}\n\n*Стенд:* ${t.stand || 'не указано'}\n*Окружение:* ${t.env || 'не указано'}\n*Тестовые данные:* ${t.testData || 'не указано'}\n*Макет:* ${t.mockup || 'не указано'}`;
            const fields = {
                project: { key: jiraProject },
                issuetype: { id: '12811' },
                summary: t.summary,
                description: desc,
                versions: [{ id: affectedVersion }],
                [fieldIds.Severity]: { id: t.severity },
                [fieldIds.Symptom]: t.symptom.map(id => ({ id })),
                [fieldIds.Platform]: t.platform.map(id => ({ id }))
            };
            if (t.prodBug) fields[fieldIds.ProdBug] = { id: t.prodBug };
            if (epicLink) fields[fieldIds['Epic Link']] = epicLink;
            if (assignee) fields.assignee = { name: assignee };

            try {
                const r = await axios.post(`${config.serverUrl}/jira/create-issue`, { pat: jiraPat, payload: { fields } });
                const key = r.data.key;
                out.push({ success: true, summary: t.summary, key });

                if (targetStatus) {
                    await axios.post(`${config.serverUrl}/jira/transition-issues`, { pat: jiraPat, issueKeys: [key], transitionId: targetStatus });
                }
                if (t.allureDefect) {
                    try {
                        await axios.post(`${config.serverUrl}/allure/defect/${t.allureDefect.value}/issue`, { integrationId: 67, name: key });
                    } catch (linkErr) {
                        out.push({ success: false, summary: `Привязка ${t.summary}`, key, error: linkErr.response?.data?.error || linkErr.message });
                    }
                }
            } catch (e) {
                out.push({ success: false, summary: t.summary, error: e.response?.data?.error || e.message });
            }
        }
        setResults(out);
        setTasks(ts => ts.filter(t => !out.find(r => r.success && r.summary === t.summary && !r.error?.includes('Привязка'))));
        setCreating(false);
    };

    const ready = !isMetaLoading && !metaError && Object.keys(fieldOptions).length > 0;
    const selectedTasksCount = tasks.filter(t => t.selected).length;
    const navigate = useNavigate();

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
                <button className="btn btn-primary" disabled={selectedTasksCount === 0 || !ready} onClick={() => { setResults([]); setModalOpen(true); }}>
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
            )}

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
                            key={i} // Using index as key is okay here because we don't re-order tasks except on add/delete
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
                            isCollapsed={!!collapsedStates[i]} // NEW prop
                            onToggleCollapse={handleToggleCollapse} // NEW prop
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
                            {/* FIXED: Added field wrapper and label */}
                            <div className="field full-width">
                                <label>Epic Link</label>
                                <input type="text" value={epicLink} onChange={e => setEpicLink(e.target.value)} required placeholder="PROJ-123" />
                            </div>
                            <div className="field">
                                <label>Исполнитель (необязательно)</label>
                                <AsyncSelect classNamePrefix="select" cacheOptions defaultOptions isClearable loadOptions={loadUserOptions} placeholder="Начните вводить имя..." onChange={opt => setAssignee(opt?.value || '')} noOptionsMessage={() => 'Нет совпадений'} />
                            </div>
                            <div className="field">
                                <label>Затронутая версия*</label>
                                <AsyncSelect classNamePrefix="select" cacheOptions defaultOptions isClearable loadOptions={loadVersionOptions} placeholder="Начните вводить версию..." onChange={opt => setAffectedVersion(opt?.value || '')} noOptionsMessage={() => 'Нет совпадений'} />
                            </div>
                            <div className="field">
                                <label>Статус после создания (необязательно)</label>
                                <Select classNamePrefix="select" placeholder="Оставить по умолчанию..." options={transitions.map(t => ({ value: t.id, label: t.name }))} value={transitions.map(t => ({ value: t.id, label: t.name })).find(o => o.value === targetStatus) || null} onChange={opt => setTargetStatus(opt?.value || null)} />
                            </div>
                        </fieldset>
                        <div className="buttons">
                            <button onClick={handleCreateAll} disabled={!ready || creating || !affectedVersion} className="btn btn-primary">
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