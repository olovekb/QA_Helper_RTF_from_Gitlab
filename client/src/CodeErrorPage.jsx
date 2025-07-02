// src/CodeErrorPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import './CodeErrorPage.css';
import config from './config.json';

// debounce hook
function useDebounce(value, delay) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const h = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(h);
    }, [value, delay]);
    return debounced;
}

// single task card component
const CodeErrorCard = ({
    task, index, onUpdate, onDelete, fieldOptions,
    loadDefectOptions, allureProject
}) => {
    const handleChange = field => e => {
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        onUpdate(index, { ...task, [field]: v });
    };
    const handleSelect = field => opt => {
        onUpdate(index, { ...task, [field]: opt ? opt.value : '' });
    };
    const handleMulti = field => opts => {
        onUpdate(index, { ...task, [field]: opts.map(o => o.value) });
    };
    const toOptions = key =>
        (fieldOptions[key] || []).map(o => ({ value: o.id, label: o.name }));

    return (
        <div className={`task-card ${task.isNew ? 'new-task' : ''}`}>
            <div className="task-header">
                <input
                    type="checkbox"
                    checked={task.selected}
                    onChange={handleChange('selected')}
                />
                <input
                    className="task-summary-input"
                    type="text"
                    placeholder="Тема*"
                    value={task.summary}
                    onChange={handleChange('summary')}
                />
                <button className="delete-task-btn" onClick={() => onDelete(index)}>❌</button>
            </div>
            <div className="task-body-grid">
                <textarea
                    className="span-two-columns"
                    rows={3}
                    placeholder="Подробное описание*"
                    value={task.description}
                    onChange={handleChange('description')}
                />
                <textarea
                    className="span-two-columns"
                    rows={3}
                    placeholder="Шаги воспроизведения*"
                    value={task.steps}
                    onChange={handleChange('steps')}
                />
                <textarea
                    className="span-two-columns"
                    rows={2}
                    placeholder="Фактический результат*"
                    value={task.actual}
                    onChange={handleChange('actual')}
                />
                <textarea
                    className="span-two-columns"
                    rows={2}
                    placeholder="Ожидаемый результат*"
                    value={task.expected}
                    onChange={handleChange('expected')}
                />

                <input type="text" placeholder="Стенд" value={task.stand} onChange={handleChange('stand')} />
                <input type="text" placeholder="Окружение" value={task.env} onChange={handleChange('env')} />
                <input type="text" placeholder="Ссылка на требование" value={task.requirementLink} onChange={handleChange('requirementLink')} />
                <input type="text" placeholder="Тестовые данные" value={task.testData} onChange={handleChange('testData')} />
                <input type="text" placeholder="Макет" value={task.mockup} onChange={handleChange('mockup')} />

                <Select
                    placeholder="Серьезность*"
                    options={toOptions('Severity')}
                    value={toOptions('Severity').find(o => o.value === task.severity) || null}
                    onChange={handleSelect('severity')}
                />
                <Select
                    isMulti
                    placeholder="Симптом*"
                    options={toOptions('Symptom')}
                    value={toOptions('Symptom').filter(o => task.symptom.includes(o.value))}
                    onChange={handleMulti('symptom')}
                />
                <Select
                    isMulti
                    placeholder="Платформа*"
                    options={toOptions('Platform')}
                    value={toOptions('Platform').filter(o => task.platform.includes(o.value))}
                    onChange={handleMulti('platform')}
                />
                <Select
                    placeholder="Баг с прода"
                    options={toOptions('ProdBug')}
                    value={toOptions('ProdBug').find(o => o.value === task.prodBug) || null}
                    onChange={handleSelect('prodBug')}
                />

                {/* Allure defect picker */}
                <div className="field">
                    <label>Дефект Allure</label>
                    <AsyncSelect
                        cacheOptions
                        loadOptions={input => loadDefectOptions(allureProject, input)}
                        defaultOptions
                        isClearable
                        placeholder="Начните вводить…"
                        value={task.allureDefect}
                        onChange={opt => onUpdate(index, { ...task, allureDefect: opt })}
                        noOptionsMessage={() => 'Нет совпадений'}
                        isOptionDisabled={opt => opt.linked}
                        formatOptionLabel={opt => (
                            <div style={{ opacity: opt.linked ? 0.5 : 1 }}>
                                {opt.label} {opt.linked && <em>(уже привязан)</em>}
                            </div>
                        )}
                    />
                </div>
            </div>
        </div>
    );
};

export default function CodeErrorPage({ projects }) {
    const [tasks, setTasks] = useState([]);
    const [jiraProject, setJiraProject] = useState('');
    const [jiraPat, setJiraPat] = useState('');
    const [epicLink, setEpicLink] = useState('');
    const [assignee, setAssignee] = useState('');
    const [affectedVersion, setAffectedVersion] = useState('');
    const [targetStatus, setTargetStatus] = useState(null);
    const [allureProject, setAllureProject] = useState('');

    const [fieldOptions, setFieldOptions] = useState({});
    const [fieldIds, setFieldIds] = useState({});
    const [transitions, setTransitions] = useState([]);

    const [isMetaLoading, setIsMetaLoading] = useState(false);
    const [metaError, setMetaError] = useState('');
    const [creating, setCreating] = useState(false);
    const [results, setResults] = useState([]);
    const [modalOpen, setModalOpen] = useState(false);

    const debProject = useDebounce(jiraProject, 500);
    const debPat = useDebounce(jiraPat, 500);

    // 1) Load Jira meta
    const loadMeta = useCallback(async () => {
        if (!debProject || !debPat) return;
        setIsMetaLoading(true);
        setMetaError('');
        try {
            const { data } = await axios.post(
                `${config.serverUrl}/jira/meta`,
                { projectKey: debProject, pat: debPat }
            );
            setFieldOptions(data.options);
            setFieldIds(data.fieldIds);
        } catch (e) {
            setMetaError(e.response?.data?.error || e.message);
        } finally {
            setIsMetaLoading(false);
        }
    }, [debProject, debPat]);
    useEffect(() => { loadMeta() }, [loadMeta]);

    // 2) Async load users / versions
    const loadUserOptions = input =>
        axios.get(`${config.serverUrl}/jira/users`, {
            params: { projectKey: jiraProject, pat: jiraPat, query: input }
        }).then(r => r.data.map(u => ({ value: u.name, label: u.displayName })));
    const loadVersionOptions = input =>
        axios.get(`${config.serverUrl}/jira/versions`, {
            params: { projectKey: jiraProject, pat: jiraPat, query: input }
        }).then(r => r.data.map(v => ({ value: v.id, label: v.name })));

    // 3) Load transitions on modal open
    const loadTransitions = useCallback(async () => {
        if (!debProject || !debPat) return;
        try {
            const sample = 'JMT-14707';
            const { data } = await axios.get(
                `${config.serverUrl}/jira/transitions`,
                { params: { issueKey: sample, pat: jiraPat } }
            );
            setTransitions(data);
        } catch (e) {
            console.warn('Не удалось загрузить transitions:', e);
        }
    }, [debProject, debPat, jiraPat]);
    useEffect(() => {
        if (modalOpen) loadTransitions();
    }, [modalOpen, loadTransitions]);

    // 4) Async load Allure defects, marking already linked
    const loadDefectOptions = (projectId, input) => {
        if (!projectId) return Promise.resolve([]);
        return axios.get(`${config.serverUrl}/allure/defects`, {
            params: { projectId, query: input }
        }).then(r => r.data.map(d => ({
            value: d.id,
            label: `${d.name} (${d.id})`,
            linked: Boolean(d.issue)
        })));
    };

    // 5) Task list handlers
    const handleAdd = () => setTasks(ts => [{
        summary: '', description: '', steps: '', actual: '', expected: '',
        stand: '', env: '', requirementLink: '', testData: '', mockup: '',
        severity: '', symptom: [], platform: [], prodBug: '',
        selected: true, isNew: true, allureDefect: null
    }, ...ts]);
    const handleDelete = i => setTasks(ts => ts.filter((_, idx) => idx !== i));
    const handleUpdate = (i, upd) => setTasks(ts => ts.map((t, idx) => idx === i ? upd : t));

    // 6) Create, transition, link Allure defect
    const handleCreateAll = async () => {
        if (!affectedVersion) {
            alert('Выберите затронутую версию.');
            return;
        }
        setCreating(true);
        const out = [];

        for (const t of tasks.filter(t => t.selected)) {
            if (!t.summary || !t.description || !t.steps || !t.actual || !t.expected
                || !t.severity || !t.symptom.length || !t.platform.length) {
                alert(`Заполните все * поля в "${t.summary || 'Без темы'}".`);
                setCreating(false);
                return;
            }
            const desc = `
h3. Подробное описание
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
`;
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
                // create in Jira
                const r = await axios.post(
                    `${config.serverUrl}/jira/create-issue`,
                    { pat: jiraPat, payload: { fields } }
                );
                const key = r.data.key;
                out.push({ success: true, summary: t.summary, key });

                // do transition if requested
                if (targetStatus) {
                    await axios.post(
                        `${config.serverUrl}/jira/transition-issues`,
                        { pat: jiraPat, issueKeys: [key], transitionId: targetStatus }
                    );
                }

                // link Allure defect if chosen
                if (t.allureDefect) {
                    try {
                        await axios.post(
                            `${config.serverUrl}/allure/defect/${t.allureDefect.value}/issue`,
                            { integrationId: 67, name: key }
                        );
                    } catch (linkErr) {
                        // catch 409 conflict
                        if (linkErr.response?.status === 409) {
                            out.push({
                                success: false,
                                summary: t.summary,
                                key,
                                error: 'Дефект уже привязан к задаче.'
                            });
                        } else {
                            out.push({
                                success: false,
                                summary: t.summary,
                                key,
                                error: linkErr.response?.data?.error || linkErr.message
                            });
                        }
                    }
                }

            } catch (e) {
                out.push({ success: false, summary: t.summary, error: e.message });
            }
        }

        setResults(out);
        setTasks(ts => ts.filter(t =>
            !out.find(r => r.success && r.summary === t.summary)
        ));
        setCreating(false);
        setModalOpen(false);
    };

    const ready = !isMetaLoading && !metaError && Object.keys(fieldOptions).length > 0;

    return (
        <div className="solution-page">
            <h1>Массовое создание ошибок кода</h1>

            {/* 1) Connection settings */}
            <div className="jira-main-settings">
                <h2>1. Настройки подключения</h2>
                <div className="settings-grid">
                    <div className="field">
                        <label>Project Key (Jira)</label>
                        <input
                            value={jiraProject}
                            onChange={e => setJiraProject(e.target.value.toUpperCase())}
                            placeholder="PROJ"
                        />
                    </div>
                    <div className="field">
                        <label>Jira PAT</label>
                        <input
                            type="password"
                            value={jiraPat}
                            onChange={e => setJiraPat(e.target.value)}
                            placeholder="Ваш PAT"
                        />
                    </div>
                    <div className="field">
                        <label>Проект Allure</label>
                        <Select
                            placeholder="Выберите проект Allure…"
                            options={projects.map(p => ({ value: p.id, label: p.name }))}
                            isClearable
                            onChange={opt => setAllureProject(opt?.value || '')}
                        />
                    </div>
                </div>
                {isMetaLoading && <p className="status-message loading">Загрузка метаданных Jira…</p>}
                {metaError && <p className="status-message error">{metaError}</p>}
                {ready && <p className="status-message success">Данные Jira загружены</p>}
            </div>

            {/* 2) Controls */}
            <div className="task-controls">
                <button className="add-task-btn" onClick={handleAdd}>➕ Добавить задачу</button>
                <button
                    className="create-jira-btn"
                    disabled={!tasks.some(t => t.selected)}
                    onClick={() => setModalOpen(true)}
                >⚙️ Создать ({tasks.filter(t => t.selected).length})</button>
            </div>

            {/* 3) Task list */}
            <div className="task-list">
                {tasks.map((t, i) =>
                    <CodeErrorCard
                        key={i}
                        index={i}
                        task={t}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        fieldOptions={fieldOptions}
                        loadDefectOptions={loadDefectOptions}
                        allureProject={allureProject}
                    />
                )}
            </div>

            {/* 4) Modal */}
            {modalOpen && (
                <div className="modal">
                    <div className="modal-content">
                        <button className="modal-close-btn" onClick={() => setModalOpen(false)}>×</button>
                        <h2>2. Общие поля для всех задач</h2>
                        <fieldset disabled={!ready} className="common-fields-group">
                            <legend>Общие поля</legend>

                            <div className="field">
                                <label>Epic Link</label>
                                <input
                                    value={epicLink}
                                    onChange={e => setEpicLink(e.target.value)}
                                    placeholder="PROJ-123"
                                />
                            </div>

                            <div className="field">
                                <label>Исполнитель</label>
                                <AsyncSelect
                                    cacheOptions
                                    loadOptions={loadUserOptions}
                                    defaultOptions
                                    isClearable
                                    placeholder="Начните вводить…"
                                    onChange={opt => setAssignee(opt?.value || '')}
                                    noOptionsMessage={() => 'Нет совпадений'}
                                />
                            </div>

                            <div className="field">
                                <label>Затронутые версии*</label>
                                <AsyncSelect
                                    cacheOptions
                                    loadOptions={loadVersionOptions}
                                    defaultOptions
                                    isClearable
                                    placeholder="Начните вводить…"
                                    onChange={opt => setAffectedVersion(opt?.value || '')}
                                    noOptionsMessage={() => 'Нет совпадений'}
                                />
                            </div>

                            <div className="field">
                                <label>Статус после создания</label>
                                <Select
                                    placeholder="Выберите статус…"
                                    options={transitions.map(t => ({ value: t.id, label: t.name }))}
                                    value={transitions
                                        .map(t => ({ value: t.id, label: t.name }))
                                        .find(o => o.value === targetStatus) || null}
                                    onChange={opt => setTargetStatus(opt?.value || null)}
                                />
                            </div>
                        </fieldset>

                        <div className="buttons">
                            <button
                                onClick={handleCreateAll}
                                disabled={!ready || creating || !affectedVersion}
                            >
                                {creating ? 'Создание…' : `Создать (${tasks.filter(t => t.selected).length})`}
                            </button>
                        </div>

                        <div className="jira-result">
                            {results.map((r, i) =>
                                r.success
                                    ? <p key={i} className="success">
                                        ✅ <a
                                            href={`${config.jiraBaseUrl || 'https://jira.abanking.ru'}/browse/${r.key}`}
                                            target="_blank" rel="noreferrer"
                                        >
                                            {r.summary}: {r.key}
                                        </a>
                                    </p>
                                    : <p key={i} className="error">❌ {r.summary}: {r.error}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
