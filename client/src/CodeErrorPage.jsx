import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Select from 'react-select';             // npm install react-select
import AsyncSelect from 'react-select/async';  // npm install react-select
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
const CodeErrorCard = ({ task, index, onUpdate, onDelete, fieldOptions }) => {
    const handleChange = field => e => {
        const v = e.target.type === 'checkbox'
            ? e.target.checked
            : e.target.value;
        onUpdate(index, { ...task, [field]: v });
    };
    const handleSelect = field => option => {
        onUpdate(index, { ...task, [field]: option ? option.value : '' });
    };
    const handleMultiChange = field => options => {
        onUpdate(index, { ...task, [field]: options.map(o => o.value) });
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
                <button
                    className="delete-task-btn"
                    onClick={() => onDelete(index)}
                >❌</button>
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

                <input
                    type="text"
                    placeholder="Стенд"
                    value={task.stand}
                    onChange={handleChange('stand')}
                />
                <input
                    type="text"
                    placeholder="Окружение"
                    value={task.env}
                    onChange={handleChange('env')}
                />
                <input
                    type="text"
                    placeholder="Ссылка на требование"
                    value={task.requirementLink}
                    onChange={handleChange('requirementLink')}
                />
                <input
                    type="text"
                    placeholder="Тестовые данные"
                    value={task.testData}
                    onChange={handleChange('testData')}
                />
                <input
                    type="text"
                    placeholder="Макет"
                    value={task.mockup}
                    onChange={handleChange('mockup')}
                />
                <input
                    type="number"
                    placeholder="ID дефекта из Allure"
                    value={task.allureId}
                    onChange={handleChange('allureId')}
                />

                {/* Severity */}
                <Select
                    placeholder="Серьезность*"
                    options={toOptions('Severity')}
                    value={toOptions('Severity').find(o => o.value === task.severity) || null}
                    onChange={handleSelect('severity')}
                />

                {/* Symptom */}
                <Select
                    isMulti
                    placeholder="Симптом*"
                    options={toOptions('Symptom')}
                    value={toOptions('Symptom').filter(o => task.symptom.includes(o.value))}
                    onChange={handleMultiChange('symptom')}
                />

                {/* Platform */}
                <Select
                    isMulti
                    placeholder="Платформа*"
                    options={toOptions('Platform')}
                    value={toOptions('Platform').filter(o => task.platform.includes(o.value))}
                    onChange={handleMultiChange('platform')}
                />

                {/* ProdBug */}
                <Select
                    placeholder="Баг с прода"
                    options={toOptions('ProdBug')}
                    value={toOptions('ProdBug').find(o => o.value === task.prodBug) || null}
                    onChange={handleSelect('prodBug')}
                />
            </div>
        </div>
    );
};

// main page component
export default function CodeErrorPage() {
    const [tasks, setTasks] = useState([]);
    const [jiraProject, setJiraProject] = useState('');
    const [jiraPat, setJiraPat] = useState('');
    const [epicLink, setEpicLink] = useState('');
    const [assignee, setAssignee] = useState('');
    const [affectedVersion, setAffectedVersion] = useState('');
    const [fieldOptions, setFieldOptions] = useState({});
    const [fieldIds, setFieldIds] = useState({});
    const [isMetaLoading, setIsMetaLoading] = useState(false);
    const [metaError, setMetaError] = useState('');
    const [creating, setCreating] = useState(false);
    const [results, setResults] = useState([]);
    const [modalOpen, setModalOpen] = useState(false);

    const debProject = useDebounce(jiraProject, 500);
    const debPat = useDebounce(jiraPat, 500);

    // load only field-options & field-ids once project+pat are typed
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

    useEffect(() => { loadMeta(); }, [loadMeta]);

    // dynamic load for assignees
    const loadUserOptions = input =>
        axios.get(`${config.serverUrl}/jira/users`, {
            params: { projectKey: jiraProject, pat: jiraPat, query: input }
        }).then(r => r.data.map(u => ({ value: u.name, label: u.displayName })));

    // dynamic load for versions
    const loadVersionOptions = input =>
        axios.get(`${config.serverUrl}/jira/versions`, {
            params: { projectKey: jiraProject, pat: jiraPat, query: input }
        }).then(r => r.data.map(v => ({ value: v.id, label: v.name })));

    const handleAdd = () => setTasks(ts => [{
        summary: '', description: '', steps: '', actual: '', expected: '',
        stand: '', env: '', requirementLink: '', testData: '', mockup: '',
        allureId: '', severity: '', symptom: [], platform: [], prodBug: '',
        selected: true, isNew: true
    }, ...ts]);

    const handleDelete = i => setTasks(ts => ts.filter((_, idx) => idx !== i));
    const handleUpdate = (i, upd) => setTasks(ts => ts.map((t, idx) => idx === i ? upd : t));

    const handleCreateAll = async () => {
        if (!affectedVersion) {
            alert('Выберите затронутую версию.');
            return;
        }
        setCreating(true);
        const out = [];
        for (const t of tasks.filter(t => t.selected)) {
            if (!t.summary || !t.description || !t.steps || !t.actual || !t.expected || !t.severity || !t.symptom.length || !t.platform.length) {
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
*ID Allure:* ${t.allureId || 'не указано'}
      `;
            const fields = {
                project: { key: jiraProject },
                issuetype: { id: '12811' },
                summary: t.summary,
                description: desc,
                versions: [{ id: affectedVersion }],
            };
            fields[fieldIds.Severity] = { id: t.severity };
            fields[fieldIds.Symptom] = t.symptom.map(id => ({ id }));
            fields[fieldIds.Platform] = t.platform.map(id => ({ id }));
            if (t.prodBug) fields[fieldIds.ProdBug] = { id: t.prodBug };
            if (epicLink) fields[fieldIds['Epic Link']] = epicLink;
            if (assignee) fields.assignee = { name: assignee };

            try {
                const r = await axios.post(
                    `${config.serverUrl}/jira/create-issue`,
                    { pat: jiraPat, payload: { fields } }
                );
                out.push({ success: true, summary: t.summary, key: r.data.key });
            } catch (e) {
                out.push({ success: false, summary: t.summary, error: e.message });
            }
        }
        setResults(out);
        setTasks(ts => ts.filter(t => !out.find(r => r.success && r.summary === t.summary)));
        setCreating(false);
        setModalOpen(false);
    };

    const ready = !isMetaLoading && !metaError && Object.keys(fieldOptions).length > 0;

    return (
        <div className="solution-page">
            <h1>Массовое создание ошибок кода</h1>

            {/* Jira connection */}
            <div className="jira-main-settings">
                <h2>1. Настройки подключения к Jira</h2>
                <div className="settings-grid">
                    <div className="field">
                        <label>Project Key</label>
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
                </div>
                {isMetaLoading && <p className="status-message loading">Загрузка…</p>}
                {metaError && <p className="status-message error">{metaError}</p>}
                {ready && <p className="status-message success">Данные загружены</p>}
            </div>

            {/* Task controls */}
            <div className="task-controls">
                <button className="add-task-btn" onClick={handleAdd}>➕ Добавить задачу</button>
                <button
                    className="create-jira-btn"
                    disabled={!tasks.some(t => t.selected)}
                    onClick={() => setModalOpen(true)}
                >⚙️ Создать ({tasks.filter(t => t.selected).length})</button>
            </div>

            {/* Task list */}
            <div className="task-list">
                {tasks.map((t, i) => (
                    <CodeErrorCard
                        key={i}
                        index={i}
                        task={t}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        fieldOptions={fieldOptions}
                    />
                ))}
            </div>

            {/* Modal */}
            {modalOpen && (
                <div className="modal">
                    <div className="modal-content">
                        <button className="modal-close-btn" onClick={() => setModalOpen(false)}>×</button>
                        <h2>2. Общие поля для всех задач</h2>
                        <fieldset className="common-fields-group" disabled={!ready}>
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
                            {results.map((r, i) => r.success
                                ? <p key={i} className="success">
                                    ✅ <a
                                        href={`${config.jiraBaseUrl || 'https://jira.abanking.ru'}/browse/${r.key}`}
                                        target="_blank"
                                        rel="noreferrer"
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
