import React, { useState, useEffect, useCallback } from 'react';
import Modal from 'react-modal';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import config from '../../config.json';
import axios from 'axios';
import AsyncSelect from 'react-select/async';
import { StyleInjector, LoaderOverlay } from './TestModelGeneratorModal';
import JSZip from 'jszip';

// --- Иконки (простые SVG для независимости от библиотек) ---
const ChevronDown = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);
const ChevronRight = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);
const FolderIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
);
const StoryIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
);
const ScenarioIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 18v-6m0 0V6m0 6H6m12 0h6" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="6" r="3" />
    </svg>
);
const CaseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
    </svg>
);

const CodeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
        viewBox="0 0 24 24" fill="none" stroke="#d29922"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* < /> */}
        <polyline points="10 6 6 12 10 18" />
        <polyline points="14 6 18 12 14 18" />
    </svg>
);
// Иконка перетаскивания (шесть точек)
const DragHandleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        {[2, 6, 10].map(y =>
            [4, 8].map(x => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />
            ))
        )}
    </svg>
);

const debouncePromise = (fn, delay = 300) => {
    let t;
    return (...args) =>
        new Promise((resolve) => {
            clearTimeout(t);
            t = setTimeout(async () => resolve(await fn(...args)), delay);
        });
};


// --- UTILITY FUNCTIONS ---
const generateId = () => `case_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const createNewTestCase = (feature, story, scenario = '', code = '') => ({
    id: generateId(),
    title: 'Новый тест-кейс',
    feature,
    story,
    scenario,
    code,
    precondition: '',
    sharedSteps: [],
    steps: [''],
    expected: '',
    tags: [],
    layer: 'E2E Tests',
    links: [],
    jiraIssue: '',
    priority: 'Medium',
    version: 'stable',
    parameters: '',
    attachments: [],
});

// --- STATE MANAGEMENT HELPERS ---
const buildTreeFromCases = (cases) => {
    const tree = {};
    (cases || []).forEach((c) => {
        const testCase = {
            ...c,
            id: c.id || generateId(),
            priority: c.priority ?? 'Medium',
            version: c.version ?? undefined,
        };
        const { feature, story, scenario = '', code = '' } = testCase;
        if (!tree[feature]) tree[feature] = { stories: {}, isExpanded: true };
        if (!tree[feature].stories[story])
            tree[feature].stories[story] = { scenarios: {}, cases: [], isExpanded: true };
        if (scenario && !tree[feature].stories[story].scenarios[scenario]) {
            tree[feature].stories[story].scenarios[scenario] = { codes: {}, cases: [], isExpanded: true };
        }
        if (scenario) {
            if (code) {
                if (!tree[feature].stories[story].scenarios[scenario].codes[code]) {
                    tree[feature].stories[story].scenarios[scenario].codes[code] = { cases: [], isExpanded: true };
                }
                tree[feature].stories[story].scenarios[scenario].codes[code].cases.push(testCase);
            } else {
                tree[feature].stories[story].scenarios[scenario].cases.push(testCase);
            }
        } else {
            tree[feature].stories[story].cases.push(testCase);
        }
    });
    return tree;
};

const flattenTreeToCases = (tree) => {
    const flat = [];

    Object.entries(tree).forEach(([feature, fData]) => {
        Object.entries(fData.stories).forEach(([story, sData]) => {

            // кейсы без сценариев
            (sData.cases || []).forEach(c => {
                const base = {
                    ...c,
                    feature,
                    story,
                    scenario: '',
                    code: c.code || '',
                    priority: c.priority,
                    version: c.version,
                };
                flat.push(base);
            });

            // кейсы со сценариями
            Object.entries(sData.scenarios).forEach(([scenario, scData]) => {
                // кейсы прямо под сценарием
                (scData.cases || []).forEach(c => {
                    const base = { ...c, feature, story, scenario, code: c.code || '', priority: c.priority, version: c.version };
                    flat.push(base);
                });

                // кейсы под конкретными code-узлами (unit)
                Object.entries(scData.codes || {}).forEach(([code, codeData]) => {
                    (codeData.cases || []).forEach(c => {
                        const base = { ...c, feature, story, scenario, code, priority: c.priority, version: c.version };
                        flat.push(base);
                    });
                });
            });

        });
    });

    return flat;
};

// --- UI COMPONENTS ---
export function TestCaseCard({
    testCase,
    index,
    onUpdate,
    onDelete,
    projectId,
    jiraProject,
    jiraPat,
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [sharedOptions, setSharedOptions] = useState([]);

    const PAGE_SIZE = 20;

    const loadSharedStepOptions = React.useMemo(
        () =>
            debouncePromise(async (inputValue) => {
                if (!projectId) return [];
                const { data } = await axios.get(`${config.serverUrl}/shared-steps`, {
                    params: {
                        projectId,
                        page: 0,
                        size: PAGE_SIZE,
                        archived: false,
                        search: String(inputValue || '').trim(),
                    },
                });
                const items = data?.content || [];
                return items.map((s) => ({ value: s.id, label: s.name }));
            }, 300),
        [projectId]
    );


    const handleFieldChange = (field, value) =>
        onUpdate(testCase.id, { ...testCase, [field]: value });

    const addArrayItem = (field, newItem) =>
        handleFieldChange(field, [...(testCase[field] || []), newItem]);

    const removeArrayItem = (field, idx) =>
        handleFieldChange(field, (testCase[field] || []).filter((_, i) => i !== idx));

    const handleLinkChange = (linkIndex, linkField, value) => {
        const newLinks = [...(testCase.links || [])];
        newLinks[linkIndex] = { ...newLinks[linkIndex], [linkField]: value };
        handleFieldChange('links', newLinks);
    };

    const loadIssueOptions = async (input) => {
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
        const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
        if (!resp.ok) return [];
        const { issues } = await resp.json();
        return issues.map((issue) => ({
            value: issue.key,
            label: `${issue.key} — ${issue.fields.summary}`,
        }));
    };

    return (
        <Draggable draggableId={testCase.id} index={index}>
            {(prov, snap) => (
                <div
                    ref={prov.innerRef}
                    {...prov.draggableProps}
                    className={`case-card ${snap.isDragging ? 'is-dragging' : ''}`}
                >
                    <div className="case-card-header">
                        <span
                            className="drag-handle"
                            {...prov.dragHandleProps}
                        >
                            <DragHandleIcon />
                        </span>
                        <CaseIcon />
                        <span className="node-title" onClick={() => setIsExpanded(!isExpanded)}>
                            {testCase.title || 'Тест-кейс без названия'}
                        </span>
                        <button
                            className="delete-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(testCase.id);
                            }}
                        >
                            ×
                        </button>
                    </div>

                    {isExpanded && (
                        <div className="case-card-details">
                            <div className="case-field">
                                <label>Название*</label>
                                <input
                                    type="text"
                                    value={testCase.title}
                                    onChange={(e) => handleFieldChange('title', e.target.value)}
                                />
                            </div>
                            <div className="case-field">
                                <label>Предварительное условие</label>
                                <textarea
                                    value={testCase.precondition}
                                    onChange={(e) => handleFieldChange('precondition', e.target.value)}
                                />
                            </div>
                            <div className="case-field">
                                <label>Шаги (Сценарий)*</label>
                                <DragDropContext
                                    onDragEnd={({ source, destination }) => {
                                        if (!destination) return;
                                        const arr = Array.from(testCase.steps);
                                        const [moved] = arr.splice(source.index, 1);
                                        arr.splice(destination.index, 0, moved);
                                        handleFieldChange('steps', arr);
                                    }}
                                >
                                    <Droppable droppableId={`steps-${testCase.id}`} type="STEP">
                                        {(dropProv) => (
                                            <div ref={dropProv.innerRef} {...dropProv.droppableProps}>
                                                {testCase.steps.map((step, idx) => (
                                                    <Draggable
                                                        key={idx}
                                                        draggableId={`step-${testCase.id}-${idx}`}
                                                        index={idx}
                                                    >
                                                        {(dragProv) => (
                                                            <div
                                                                ref={dragProv.innerRef}
                                                                {...dragProv.draggableProps}
                                                                {...dragProv.dragHandleProps}
                                                                className={`array-item ${typeof step === 'string' ? '' : 'shared-step-item'
                                                                    }`}
                                                            >
                                                                {typeof step === 'string' ? (
                                                                    <textarea
                                                                        value={step}
                                                                        placeholder={`Шаг ${idx + 1}`}
                                                                        onChange={(e) => {
                                                                            const arr = [...testCase.steps];
                                                                            arr[idx] = e.target.value;
                                                                            handleFieldChange('steps', arr);
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <div className="shared-step-label">{step.text}</div>
                                                                )}
                                                                <button
                                                                    className="remove-item-btn"
                                                                    onClick={() => removeArrayItem('steps', idx)}
                                                                >
                                                                    −
                                                                </button>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {dropProv.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
                                <button
                                    className="add-item-btn"
                                    onClick={() => addArrayItem('steps', '')}
                                >
                                    + Добавить шаг
                                </button>
                                <div style={{ marginTop: 8 }}>
                                    <AsyncSelect
                                        classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={loadSharedStepOptions}
                                        placeholder="+ Добавить общий шаг…"
                                        onChange={(opt) =>
                                            opt &&
                                            addArrayItem('steps', {
                                                sharedStepId: opt.value,
                                                text: opt.label,
                                            })
                                        }
                                        noOptionsMessage={() => 'Ничего не найдено'}
                                        styles={{
                                            container: (base) => ({ ...base, marginTop: 4 }),
                                            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                                        }}
                                        menuPortalTarget={document.body}
                                    />
                                </div>
                            </div>
                            <div className="case-field">
                                <label>Ожидаемый результат*</label>
                                <textarea
                                    value={testCase.expected}
                                    onChange={(e) => handleFieldChange('expected', e.target.value)}
                                />
                            </div>
                            <div className="field-grid">
                                <div className="case-field">
                                    <label>Теги (через запятую)*</label>
                                    <input
                                        type="text"
                                        value={(testCase.tags || []).join(', ')}
                                        onChange={(e) =>
                                            handleFieldChange(
                                                'tags',
                                                e.target.value.split(',').map((t) => t.trim())
                                            )
                                        }
                                    />
                                </div>
                                <div className="case-field">
                                    <label>Тестовый слой*</label>
                                    <select
                                        value={testCase.layer}
                                        onChange={(e) => handleFieldChange('layer', e.target.value)}
                                    >
                                        <option value="E2E Tests">E2E Tests</option>
                                        <option value="Integration frontend Tests">
                                            Integration frontend Tests
                                        </option>
                                        <option value="Integration backend Tests">
                                            Integration backend Tests
                                        </option>
                                        <option value="Unit frontend Tests">Unit frontend Tests</option>
                                        <option value="Unit backend Tests">Unit backend Tests</option>
                                    </select>
                                </div>
                                <div className="case-field">
                                    <label>Связанные задачи (Jira)*</label>
                                    <AsyncSelect
                                        classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={loadIssueOptions}
                                        placeholder="Начните вводить..."
                                        value={testCase.jiraIssueOption || null}
                                        onChange={(opt) => handleFieldChange('jiraIssueOption', opt)}
                                        noOptionsMessage={() =>
                                            !jiraProject || !jiraPat
                                                ? 'Укажите проект и PAT'
                                                : 'Ничего не найдено'
                                        }
                                        styles={{
                                            container: (base) => ({ ...base, marginTop: 4 }),
                                            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                                        }}
                                        menuPortalTarget={document.body}
                                    />
                                </div>
                                <div className="case-field">
                                    <label>Приоритет*</label>
                                    <select
                                        value={testCase.priority}
                                        onChange={(e) => handleFieldChange('priority', e.target.value)}
                                    >
                                        <option value="Medium">Medium</option>
                                        <option value="Critical">Critical</option>
                                        <option value="High">High</option>
                                        <option value="Low">Low</option>
                                    </select>
                                </div>
                            </div>
                            <div className="case-field">
                                <label>Ссылки (Confluence, Figma)</label>
                                {(testCase.links || []).map((link, i) => (
                                    <div key={i} className="array-item link-item">
                                        <input
                                            type="text"
                                            placeholder="Текст ссылки"
                                            value={link.text}
                                            onChange={(e) => handleLinkChange(i, 'text', e.target.value)}
                                        />
                                        <input
                                            type="text"
                                            placeholder="URL"
                                            value={link.url}
                                            onChange={(e) => handleLinkChange(i, 'url', e.target.value)}
                                        />
                                        <button
                                            className="remove-item-btn"
                                            onClick={() => removeArrayItem('links', i)}
                                        >
                                            −
                                        </button>
                                    </div>
                                ))}
                                <button
                                    className="add-item-btn"
                                    onClick={() => addArrayItem('links', { text: '', url: '' })}
                                >
                                    + Добавить ссылку
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Draggable>
    );
}

const Node = ({ droppableId, children }) => (
    <Droppable droppableId={droppableId} type="CASE">
        {(provided, snapshot) => (
            <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`node-children ${snapshot.isDraggingOver ? 'is-over' : ''}`}
            >
                {children}
                {provided.placeholder}
            </div>
        )}
    </Droppable>
);

const CodeNode = ({
    name,
    cases,
    path,
    onUpdate,
    onDelete,
    onToggleExpandSelf, // <— новое имя
    isExpanded,
    onAddTestCase,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => {
    const hasFE = Array.isArray(cases) && cases.some(c => String(c.layer || '').toLowerCase().includes('frontend'));
    const hasBE = Array.isArray(cases) && cases.some(c => String(c.layer || '').toLowerCase().includes('backend'));

    return (
        <div className="tree-node code-node">
            <div
                className="node-header code-header"
                onClick={(e) => { e.stopPropagation(); onToggleExpandSelf(); }} // <— стопим всплытие
            >
                <div className="node-icon">{isExpanded ? <ChevronDown /> : <ChevronRight />}</div>
                <div className="node-icon"><CodeIcon /></div>
                <span className="node-title">{name}</span>

                <div className="node-badges" onClick={(e) => e.stopPropagation()}>
                    {hasFE && <span className="badge badge-fe" title="Фронтенд-поведение">FE</span>}
                    {hasBE && <span className="badge badge-be" title="Бэкенд-поведение">BE</span>}
                </div>

                <button
                    className="delete-btn"
                    onClick={e => {
                        e.stopPropagation();
                        if (window.confirm('Удалить code-узел и все кейсы в нём?')) {
                            onDeleteNode(path, 'code');
                        }
                    }}
                >
                    ×
                </button>
            </div>

            {isExpanded && (
                <>
                    <Node droppableId={JSON.stringify(path)}>
                        {cases.map((c, i) => (
                            <TestCaseCard
                                key={c.id}
                                testCase={c}
                                index={i}
                                onUpdate={onUpdate}
                                onDelete={onDelete}
                                projectId={projectId}
                                jiraProject={jiraProject}
                                jiraPat={jiraPat}
                            />
                        ))}
                    </Node>
                    <div className="add-buttons">
                        <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                            + Тест-кейс code
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};



const ScenarioNode = ({
    name,
    cases,
    scenarioData,
    path,
    onUpdate,
    onDelete,
    onToggleExpand,
    isExpanded,
    onAddTestCase,
    onAddCode,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => (
    <div className="tree-node scenario-node">
        <div className="node-header" onClick={() => onToggleExpand(path)}>
            <div className="node-icon">{isExpanded ? <ChevronDown /> : <ChevronRight />}</div>
            <div className="node-icon">
                <ScenarioIcon />
            </div>
            <span className="node-title">{name}</span>
            <button
                className="delete-btn"
                onClick={e => {
                    e.stopPropagation();
                    if (window.confirm('Удалить сценарий и все кейсы в нём?')) {
                        onDeleteNode(path, 'scenario');
                    }
                }}
            >
                ×
            </button>
        </div>
        {isExpanded && (
            <>
                <Node droppableId={JSON.stringify(path)}>
                    {cases.map((c, i) => (
                        <TestCaseCard
                            key={c.id}
                            testCase={c}
                            index={i}
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                            projectId={projectId}
                            jiraProject={jiraProject}
                            jiraPat={jiraPat}
                        />
                    ))}
                </Node>

                {/* Code-узлы (юниты живут здесь) */}
                {Object.entries(scenarioData?.codes || {}).map(([codeName, codeData]) => (
                    <CodeNode
                        key={codeName}
                        name={codeName}
                        cases={codeData.cases}
                        path={[...path, codeName]}           // [feature, story, scenario, code]
                        isExpanded={codeData.isExpanded}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onToggleExpandSelf={() => onToggleExpand([...path, codeName])}
                        onAddTestCase={onAddTestCase}
                        projectId={projectId}
                        jiraProject={jiraProject}
                        jiraPat={jiraPat}
                        onDeleteNode={onDeleteNode}
                    />
                ))}

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                        + Тест-кейс scenario
                    </button>
                    <button className="add-node-btn" onClick={() => onAddCode(path)}>
                        + Код (unit-узел)
                    </button>
                </div>
            </>
        )}
    </div>
);

const StoryNode = ({
    name,
    storyData,
    path,
    onUpdate,
    onDelete,
    onAddScenario,
    onToggleExpand,
    onAddTestCase,
    onAddCode,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => (
    <div className="tree-node story-node">
        <div className="node-header" onClick={() => onToggleExpand(path)}>
            <div className="node-icon">
                {storyData.isExpanded ? <ChevronDown /> : <ChevronRight />}
            </div>
            <div className="node-icon">
                <StoryIcon />
            </div>
            <span className="node-title">{name}</span>
            <button
                className="delete-btn"
                onClick={e => {
                    e.stopPropagation();
                    if (window.confirm('Удалить историю и всё внутри?')) {
                        onDeleteNode(path, 'story');
                    }
                }}
            >
                ×
            </button>
        </div>
        {storyData.isExpanded && (
            <div className="pl-4">
                <Node droppableId={JSON.stringify(path)}>
                    {storyData.cases.map((c, i) => (
                        <TestCaseCard
                            key={c.id}
                            testCase={c}
                            index={i}
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                            projectId={projectId}
                            jiraProject={jiraProject}
                            jiraPat={jiraPat}
                        />
                    ))}
                </Node>

                {Object.entries(storyData.scenarios).map(([scenarioName, scenarioData]) => (
                    <ScenarioNode
                        key={scenarioName}
                        name={scenarioName}
                        cases={scenarioData.cases}
                        scenarioData={scenarioData}
                        path={[...path, scenarioName]}
                        isExpanded={scenarioData.isExpanded}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onToggleExpand={onToggleExpand}
                        onAddTestCase={onAddTestCase}
                        onAddCode={onAddCode}
                        projectId={projectId}
                        jiraProject={jiraProject}
                        jiraPat={jiraPat}
                        onDeleteNode={onDeleteNode}
                    />
                ))}

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                        + Тест-кейс story
                    </button>
                    <button className="add-node-btn" onClick={() => onAddScenario(path)}>
                        + Сценарий
                    </button>
                </div>
            </div>
        )}
    </div>
);

const FeatureNode = ({
    name,
    featureData,
    path,
    onUpdate,
    onDelete,
    onAddStory,
    onAddScenario,
    onToggleExpand,
    onAddTestCase,
    onAddCode,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => (
    <div className="tree-node feature-node">
        <div className="node-header" onClick={() => onToggleExpand(path)}>
            <div className="node-icon">
                {featureData.isExpanded ? <ChevronDown /> : <ChevronRight />}
            </div>
            <div className="node-icon">
                <FolderIcon />
            </div>
            <span className="node-title feature-title">{name}</span>
            <button
                className="delete-btn"
                onClick={e => {
                    e.stopPropagation();
                    if (window.confirm('Удалить фичу и всё внутри?')) {
                        onDeleteNode(path, 'feature');
                    }
                }}
            >
                ×
            </button>
        </div>
        {featureData.isExpanded && (
            <div className="pl-4">
                {Object.entries(featureData.stories).map(([storyName, storyData]) => (
                    <StoryNode
                        key={storyName}
                        name={storyName}
                        storyData={storyData}
                        path={[...path, storyName]}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onAddScenario={onAddScenario}
                        onAddTestCase={onAddTestCase}
                        onAddCode={onAddCode}
                        onToggleExpand={onToggleExpand}
                        projectId={projectId}
                        jiraProject={jiraProject}
                        jiraPat={jiraPat}
                        onDeleteNode={onDeleteNode}
                    />
                ))}

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddStory(path)}>
                        + История
                    </button>
                </div>
            </div>
        )}
    </div>
);

export default function TestModelReviewModal({
    isOpen,
    onClose,
    initialCases = [],
    onConfirmSend,
    projectId,
    jiraProject,
    jiraPat,
}) {
    const [treeData, setTreeData] = useState({});
    const [sharedStepsOptions, setSharedStepsOptions] = useState([]);
    const [isSending, setIsSending] = useState(false);
    const [allureLink, setAllureLink] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        if (!isOpen || !projectId) return;
        setTreeData(buildTreeFromCases(initialCases));
        axios
            .get(`${config.serverUrl}/shared-steps`, { params: { projectId } })
            .then((resp) =>
                setSharedStepsOptions(resp.data.map((s) => ({ value: s.id, label: s.body })))
            )
            .catch(console.error);
    }, [isOpen, projectId, initialCases]);
    const handleCloseWithConfirm = useCallback(() => {
        if (isGenerating || isSending) return; // не даём закрыть во время процессов
        if (window.confirm('Вы уверены? Данные не сохранятся')) {
            setAllureLink(null); // на всякий случай очищаем состояние успеха
            onClose();
        }
    }, [isGenerating, isSending, onClose]);
    const handleUpdateCase = useCallback((caseId, updatedCase) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            for (const f in newTree)
                for (const s in newTree[f].stories) {
                    const storyNode = newTree[f].stories[s];
                    let idx = (storyNode.cases || []).findIndex((c) => c.id === caseId);
                    if (idx !== -1) {
                        storyNode.cases[idx] = updatedCase;
                        return newTree;
                    }
                    for (const sc in storyNode.scenarios) {
                        // сценарный уровень
                        idx = (storyNode.scenarios[sc].cases || []).findIndex((c) => c.id === caseId);
                        if (idx !== -1) {
                            storyNode.scenarios[sc].cases[idx] = updatedCase;
                            return newTree;
                        }
                        // code-уровень
                        for (const code in (storyNode.scenarios[sc].codes || {})) {
                            idx = (storyNode.scenarios[sc].codes[code].cases || []).findIndex((c) => c.id === caseId);
                            if (idx !== -1) {
                                storyNode.scenarios[sc].codes[code].cases[idx] = updatedCase;
                                return newTree;
                            }
                        }
                    }
                }
            return prevTree;
        });
    }, []);

    const handleGenerateXmind = async () => {
        setIsGenerating(true);

        const STYLE_IDS = {
            e2e: 'b-e2e',
            integration: 'b-int',
            unit: 'b-unit',
        };

        const SHEET_BOUNDARY_STYLES = [
            {
                id: 'b-e2e', class: 'org.xmind.ui.boundary',
                properties: { 'svg:stroke': '#22c55e', 'svg:fill': '#dcfce7' }
            },
            {
                id: 'b-int', class: 'org.xmind.ui.boundary',
                properties: { 'svg:stroke': '#38bdf8', 'svg:fill': '#e0f2fe' }
            },
            {
                id: 'b-unit', class: 'org.xmind.ui.boundary',
                properties: { 'svg:stroke': '#a78bfa', 'svg:fill': '#ede9fe' }
            },
        ];

        const BOUNDARY_STYLE = {
            e2e: { 'svg:fill': '#DCFCE7', 'svg:stroke': '#22C55E' }, // зелёный
            integration: { 'svg:fill': '#E0F2FE', 'svg:stroke': '#38BDF8' }, // голубой
            unit: { 'svg:fill': '#EDE9FE', 'svg:stroke': '#A78BFA' }, // фиолетовый
        };

        const TYPE_MARKERS = {
            feature: "tag-blue",
            story: "tag-orange",
            scenario: "tag-purple",
            code: "tag-yellow",
        };

        const BOUNDARY_STYLES = {
            e2e: { lineColor: "#22c55e", fillColor: "#dcfce7" },          // зелёный
            integration: { lineColor: "#38bdf8", fillColor: "#e0f2fe" },  // голубой
            unit: { lineColor: "#a78bfa", fillColor: "#ede9fe" },         // фиолетовый
        };

        const withTypeMeta = (topic, type) => ({
            ...topic,
            labels: [...(topic.labels || []), type.toUpperCase()],
            markers: [...(topic.markers || []), { markerId: TYPE_MARKERS[type] }],
        });

        const generateIdLocal = () => Math.random().toString(36).substr(2, 9);

        try {
            // 1) Строим иерархию
            const featureTopics = Object.entries(treeData).map(([featureName, featureData]) => {
                const storyTopics = Object.entries(featureData.stories).map(([storyName, storyData]) => {
                    // кейсы прямо под story
                    const directStoryCases = (storyData.cases || []).map((caseItem) => {
                        const markers = [];
                        if ((caseItem.layer || "").toLowerCase().includes("frontend")) markers.push({ markerId: "flag-green" });
                        if ((caseItem.layer || "").toLowerCase().includes("backend")) markers.push({ markerId: "flag-purple" });
                        const layer = caseItem.layer || "";
                        let testType = null;
                        if (layer === "E2E Tests") testType = "e2e";
                        else if (layer.startsWith("Integration")) testType = "integration";
                        else if (layer.startsWith("Unit")) testType = "unit";
                        return {
                            id: caseItem.id || generateIdLocal(),
                            class: "topic",
                            title: caseItem.title,
                            testType,
                            markers: markers.length ? markers : undefined,
                        };
                    });

                    const scenarioTopics = Object.entries(storyData.scenarios || {}).map(([scenarioName, scenarioData]) => {
                        const scenarioChildren = (scenarioData.cases || []).map((caseItem) => {
                            const markers = [];
                            if ((caseItem.layer || "").toLowerCase().includes("frontend")) markers.push({ markerId: "flag-green" });
                            if ((caseItem.layer || "").toLowerCase().includes("backend")) markers.push({ markerId: "flag-purple" });
                            const layer = caseItem.layer || "";
                            let testType = null;
                            if (layer === "E2E Tests") testType = "e2e";
                            else if (layer.startsWith("Integration")) testType = "integration";
                            else if (layer.startsWith("Unit")) testType = "unit";
                            return {
                                id: caseItem.id || generateIdLocal(),
                                class: "topic",
                                title: caseItem.title,
                                testType,
                                markers: markers.length ? markers : undefined,
                            };
                        });

                        // code-узлы (unit)
                        const codeTopics = Object.entries(scenarioData.codes || {}).map(([codeName, codeData]) => {
                            const unitChildren = (codeData.cases || []).map((caseItem) => {
                                const markers = [];
                                if ((caseItem.layer || "").toLowerCase().includes("frontend")) markers.push({ markerId: "flag-green" });
                                if ((caseItem.layer || "").toLowerCase().includes("backend")) markers.push({ markerId: "flag-purple" });
                                return {
                                    id: caseItem.id || generateIdLocal(),
                                    class: "topic",
                                    title: caseItem.title,
                                    testType: "unit",
                                    markers: markers.length ? markers : undefined,
                                };
                            });

                            const hasFE = (codeData.cases || []).some((c) => (c.layer || "").toLowerCase().includes("frontend"));
                            const hasBE = (codeData.cases || []).some((c) => (c.layer || "").toLowerCase().includes("backend"));
                            const codeMarkers = [];
                            if (hasFE) codeMarkers.push({ markerId: "flag-green" });
                            if (hasBE) codeMarkers.push({ markerId: "flag-purple" });

                            const unitIdxs = unitChildren.map((_, idx) => idx);
                            const boundaries = unitIdxs.length
                                ? [{
                                    id: generateIdLocal(),
                                    range: `(${unitIdxs[0]},${unitIdxs[unitIdxs.length - 1]})`,
                                    title: "Unit тесты",
                                    styleId: 'b-unit'
                                }]
                                : undefined;

                            const codeTopic = {
                                id: generateIdLocal(),
                                class: "topic",
                                title: codeName,
                                branch: "folded",
                                children: { attached: unitChildren },
                                boundaries,
                                markers: codeMarkers.length ? codeMarkers : undefined,
                            };

                            return withTypeMeta(codeTopic, "code");
                        });

                        const childrenArray = [...scenarioChildren, ...codeTopics];

                        // границы внутри сценария
                        const intIdxs = [];
                        const e2eIdxs = [];
                        childrenArray.forEach((it, idx) => {
                            if (it.testType === "integration") intIdxs.push(idx);
                            if (it.testType === "e2e") e2eIdxs.push(idx);
                        });

                        const boundaries = [];
                        if (intIdxs.length)
                            boundaries.push({
                                id: generateIdLocal(),
                                range: `(${intIdxs[0]},${intIdxs[intIdxs.length - 1]})`,
                                title: "Интеграционные тесты",
                                styleId: 'b-int'
                            });
                        if (e2eIdxs.length)
                            boundaries.push({
                                id: generateIdLocal(),
                                range: `(${e2eIdxs[0]},${e2eIdxs[e2eIdxs.length - 1]})`,
                                title: "E2E тесты",
                                style: BOUNDARY_STYLE.e2e,
                            });

                        const scenarioTopic = {
                            id: generateIdLocal(),
                            class: "topic",
                            title: scenarioName,
                            branch: "folded",
                            markers: [{ markerId: "people-blue" }],
                            children: { attached: childrenArray },
                            boundaries: boundaries.length ? boundaries : undefined,
                        };

                        return withTypeMeta(scenarioTopic, "scenario");
                    });

                    const casesAndScenarios = [...directStoryCases, ...scenarioTopics];

                    // story-level границы
                    const intAll = [];
                    const e2eAll = [];
                    casesAndScenarios.forEach((item, idx) => {
                        if (item.testType === "integration") intAll.push(idx);
                        if (item.testType === "e2e") e2eAll.push(idx);
                    });

                    const storyBoundaries = [];
                    if (intAll.length)
                        storyBoundaries.push({
                            id: generateIdLocal(),
                            range: `(${intAll[0]},${intAll[intAll.length - 1]})`,
                            title: "Интеграционные тесты",
                            styleId: 'b-int'
                        });
                    if (e2eAll.length)
                        storyBoundaries.push({
                            id: generateIdLocal(),
                            range: `(${e2eAll[0]},${e2eAll[e2eAll.length - 1]})`,
                            title: "E2E тесты",
                            style: BOUNDARY_STYLE.e2e,
                        });

                    const storyTopic = {
                        id: generateIdLocal(),
                        class: "topic",
                        title: storyName,
                        branch: "folded",
                        children: { attached: casesAndScenarios },
                        boundaries: storyBoundaries.length ? storyBoundaries : undefined,
                    };

                    return withTypeMeta(storyTopic, "story");
                });

                const featureTopic = {
                    id: generateIdLocal(),
                    class: "topic",
                    title: featureName,
                    branch: "folded",
                    children: { attached: storyTopics },
                };

                return withTypeMeta(featureTopic, "feature");
            });

            // 2) content.json
            const contentJson = [
                {
                    id: generateIdLocal(),
                    class: "sheet",
                    title: "Тест-модель",
                    rootTopic: {
                        id: generateIdLocal(),
                        class: "topic",
                        title: jiraProject,
                        structureClass: "org.xmind.ui.timeline.horizontal",
                        children: { attached: featureTopics },
                    },
                    theme: {
                        map: { id: "423cea10-5cf2-4b9c-a86a-10cba3fa1981", properties: { "svg:fill": "#ffffff" } },
                        centralTopic: { id: "c8f9a13b-cef1-4f3b-96aa-09472b8358f0", properties: { "svg:fill": "#3949AB" } },
                        mainTopic: { id: "50792793-7789-468b-9722-4e2ec235f632", properties: { "svg:fill": "#EEEEEE" } },
                        subTopic: { id: "a36e6db3-7a1f-4996-8f4b-f6bcffceeb5f", properties: { "svg:fill": "#EEEEEE" } },
                    },
                    styles: SHEET_BOUNDARY_STYLES,
                },
            ];

            // 3) metadata.json
            const metadataJson = {
                dataStructureVersion: "2",
                creator: { name: "YourAppName", version: "1.0.0" },
                layoutEngineVersion: "3",
            };

            // 4) manifest.json
            const manifestJson = {
                "file-entries": { "content.json": {}, "metadata.json": {} },
            };

            // 5) упаковка
            const zip = new JSZip();
            zip.file("content.json", JSON.stringify(contentJson, null, 2));
            zip.file("metadata.json", JSON.stringify(metadataJson, null, 2));
            zip.file("manifest.json", JSON.stringify(manifestJson, null, 2));

            const blob = await zip.generateAsync({
                type: "blob",
                mimeType: "application/vnd.xmind.xmind",
            });

            // 6) скачивание
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${jiraProject}-test-model-${Date.now()}.xmind`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            a.remove();
        } catch (err) {
            console.error("Ошибка при генерации XMind файла:", err);
        } finally {
            setIsGenerating(false);
        }
    };


    const handleDeleteCase = useCallback((caseId) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            for (const f in newTree)
                for (const s in newTree[f].stories) {
                    const storyNode = newTree[f].stories[s];
                    storyNode.cases = (storyNode.cases || []).filter((c) => c.id !== caseId);
                    for (const sc in storyNode.scenarios) {
                        storyNode.scenarios[sc].cases = (
                            storyNode.scenarios[sc].cases || []
                        ).filter((c) => c.id !== caseId);
                        for (const code in (storyNode.scenarios[sc].codes || {})) {
                            storyNode.scenarios[sc].codes[code].cases = (
                                storyNode.scenarios[sc].codes[code].cases || []
                            ).filter((c) => c.id !== caseId);
                        }
                    }
                }
            return newTree;
        });
    }, []);

    const onDragEnd = (result) => {
        const { source, destination, type } = result;
        if (!destination) return;
        if (type === 'STRUCTURE') {
            setTreeData((prev) => {
                const keys = Object.keys(prev);
                const order = Array.from(keys);
                const [moved] = order.splice(source.index, 1);
                order.splice(destination.index, 0, moved);
                const np = {};
                order.forEach((k) => (np[k] = prev[k]));
                return np;
            });
            return;
        }
        const srcPath = JSON.parse(source.droppableId);      // [f,s], [f,s,sc], [f,s,sc,code]
        const dstPath = JSON.parse(destination.droppableId);

        const getCasesArrayByPath = (tree, path) => {
            const [f, s, sc, code] = path;
            if (path.length === 2) return tree[f].stories[s].cases;
            if (path.length === 3) return tree[f].stories[s].scenarios[sc].cases;
            if (path.length === 4) return tree[f].stories[s].scenarios[sc].codes[code].cases;
            throw new Error('Unsupported path: ' + JSON.stringify(path));
        };

        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const srcArr = getCasesArrayByPath(newTree, srcPath);
            const [moved] = srcArr.splice(source.index, 1);

            moved.feature = dstPath[0];
            moved.story = dstPath[1];
            moved.scenario = dstPath[2] || '';
            moved.code = dstPath[3] || '';

            const dstArr = getCasesArrayByPath(newTree, dstPath);
            dstArr.splice(destination.index, 0, moved);
            return newTree;
        });
    };

    const handleAdd = (path, type) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s, sc, code] = path;
            if (type === 'case') {
                const nc = createNewTestCase(f, s, path[2] || '', path[3] || '');
                if (path.length === 4) {
                    newTree[f].stories[s].scenarios[sc].codes[code].cases.push(nc);
                } else if (path.length === 3) {
                    newTree[f].stories[s].scenarios[sc].cases.push(nc);
                } else {
                    newTree[f].stories[s].cases.push(nc);
                }
            } else {
                const name = prompt(`Введите название (${type}):`);
                if (!name) return prevTree;
                if (type === 'feature' && !newTree[name]) newTree[name] = { stories: {}, isExpanded: true };
                if (type === 'story' && !newTree[f].stories[name])
                    newTree[f].stories[name] = { scenarios: {}, cases: [], isExpanded: true };
                if (type === 'scenario' && !newTree[f].stories[s].scenarios[name])
                    newTree[f].stories[s].scenarios[name] = { codes: {}, cases: [], isExpanded: true };
                if (type === 'code' && !newTree[f].stories[s].scenarios[sc].codes[name])
                    newTree[f].stories[s].scenarios[sc].codes[name] = { cases: [], isExpanded: true };
            }
            return newTree;
        });
    };

    const handleToggleExpand = (path) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s, sc, code] = path;
            let node = newTree[f];
            if (s && !sc) node = node.stories[s];
            if (sc && !code) node = node.stories[s].scenarios[sc];
            if (code) node = node.stories[s].scenarios[sc].codes[code];
            node.isExpanded = !node.isExpanded;
            return newTree;
        });
    };

    // Удаление фичи/истории/сценария/кода по пути и типу
    const handleDeleteNode = useCallback((path, type) => {
        setTreeData(prev => {
            const newTree = JSON.parse(JSON.stringify(prev));
            const [f, s, sc, code] = path;
            if (type === 'feature') {
                delete newTree[f];
            } else if (type === 'story') {
                delete newTree[f].stories[s];
            } else if (type === 'scenario') {
                delete newTree[f].stories[s].scenarios[sc];
            } else if (type === 'code') {
                delete newTree[f].stories[s].scenarios[sc].codes[code];
            }
            return newTree;
        });
    }, []);


    const handleConfirm = async () => {
        const rawCases = flattenTreeToCases(treeData);
        const cases = rawCases.map(c => ({
            feature: c.feature,
            story: c.story,
            scenario: c.scenario || undefined,
            codeNode: c.code || undefined,              // <— не «code», чтобы не конфликтовало
            title: (c.title || '').trim(),
            precondition: (c.precondition || '').trim(),
            steps: (c.steps || []).map(s => typeof s === 'string' ? s : { sharedStepId: s.sharedStepId }),
            expected: (c.expected || '').trim(),
            tags: (c.tags || []).filter(Boolean),
            layer: c.layer,
            priority: c.priority || 'Medium',
            version: c.version || 'stable',
            links: (c.links || []).filter(l => l?.text || l?.url),
            jiraIssue: c.jiraIssueOption?.value || c.jiraIssue || undefined,
            // Если хочешь передавать уже в формате кастомок:
            customFields: [
                { name: 'Scenario', value: c.scenario || '' },
                { name: 'Code', value: c.code || '' },
                { name: 'Version', value: c.version || 'stable' },
                { name: 'Priority', value: c.priority || 'Medium' },
            ]
        }));
        setIsSending(true);

        try {
            const resp = await axios.post(
                `${config.serverUrl}/create-test-cases`,
                { projectId, cases },
                { headers: { 'Content-Type': 'application/json' } }
            );

            // resp.data.created = [{ id: 123501 }, { id: 123502 }, ...]
            const firstCreated = resp.data.created?.[0]?.id;
            if (!firstCreated) {
                throw new Error('Сервер вернул пустой список созданных кейсов');
            }

            // Собираем ссылку на Allure
            const link = `${config.url}/project/${projectId}/test-cases/${firstCreated}`;
            setAllureLink(link);
        } catch (err) {
            console.error(err);
            alert('Ошибка при отправке: ' + err.message);
        } finally {
            setIsSending(false);
        }
    };



    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={handleCloseWithConfirm}
            overlayClassName="modal-overlay"
            className="modal-content"
            appElement={typeof window !== 'undefined' ? document.getElementById('root') : undefined}
        >
            <style>{`
      .modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:1000;}
      .modal-content{background:#161b22;color:#c9d1d9;border-radius:8px;width:95%;max-width:1200px;height:90vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid #30363d;}
      .modal-header{padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #30363d;}
      .modal-header h2{margin:0;font-size:1.25rem;}
      .close-btn{background:none;border:none;color:#8b949e;font-size:24px;cursor:pointer;}
      .modal-body{flex:1 1 auto;overflow-y:auto;padding:16px 24px;}
      .modal-footer{padding:12px 24px;display:flex;justify-content:flex-end;gap:12px;border-top:1px solid #30363d;}
      .button-primary{background:#238636;color:#fff;border:1px solid #2ea043;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:500;}
      .button-secondary{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:500;}
      .tree-node{margin-bottom:4px;}
      .node-header{display:flex;align-items:center;padding:4px 8px;border-radius:6px;cursor:pointer;transition:background-color .2s;}
      .node-header:hover{background:rgba(139,148,158,0.1);}
      .node-icon{margin-right:8px;color:#8b949e;display:flex;align-items:center;}
      .node-title{flex:1;}
      .feature-title{font-size:1.1rem;font-weight:bold;color:#58a6ff;}
      .pl-4{padding-left:1rem;}
      .node-children{padding-top:4px;padding-left:16px;border-left:1px solid #30363d;min-height:10px;}
      .node-children.is-over{background:rgba(88,166,255,0.1);border-left-color:#58a6ff;}
      .add-buttons{padding-left:24px;padding-top:8px;}
      .add-node-btn{background:none;border:1px dashed #30363d;color:#8b949e;padding:4px 10px;border-radius:6px;font-size:.8rem;cursor:pointer;margin-right:8px;}
      .add-node-btn:hover{background:#30363d;color:#c9d1d9;}
      .case-card{background:#21262d;border:1px solid #30363d;border-radius:6px;margin:8px 0;}
      .case-card.is-dragging{box-shadow:0 0 15px rgba(88,166,255,0.5);border-color:#58a6ff;}
      .case-card-header{display:flex;align-items:center;padding:10px 12px;}
      .drag-handle{cursor:grab;margin-right:8px;}
      .case-card-header .node-title{cursor:pointer;flex:1;}
      .delete-btn{background:none;border:none;color:#f85149;font-size:20px;cursor:pointer;line-height:1;opacity:.6;}
      .delete-btn:hover{opacity:1;}
      .case-card-details{padding:12px;border-top:1px solid #30363d;margin-top:8px;}
      .case-field{margin-bottom:14px;}
      .case-field label{display:block;margin-bottom:6px;font-size:.85rem;color:#8b949e;}
      .case-field input,.case-field textarea,.case-field select{width:100%;background:#161b22;border:1px solid #30363d;border-radius:4px;padding:8px 10px;color:#c9d1d9;box-sizing:border-box;}
      .case-field input:focus,.case-field textarea:focus,.case-field select:focus{outline:none;border-color:#58a6ff;}
      .field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;}
      .array-item{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;}
      .array-item>*{flex:1;}
      .link-item input{width:50%;}
      .remove-item-btn{background:#373e47;border:1px solid #484f58;color:#c9d1d9;border-radius:4px;width:38px;height:38px;font-size:1.2rem;cursor:pointer;flex:0 0 auto;}
      .remove-item-btn:hover{background:#f85149;border-color:#f85149;color:#fff;}
      .add-item-btn{background:none;border:1px solid #30363d;color:#8b949e;padding:6px 10px;border-radius:4px;font-size:.85rem;cursor:pointer;margin-top:4px;}
      .add-item-btn:hover{background:#30363d;color:#c9d1d9;}
       .loader-overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(13, 17, 23, 0.8);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
      }
      .spinner {
        width: 50px;
        height: 50px;
        border: 4px solid #30363d;
        border-top-color: #58a6ff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 20px;
      }
      .loader-text {
        font-size: 1.1rem;
        font-weight: 500;
        color: #c9d1d9;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
       .success-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
      }
      .success-body p {
        font-size: 1.25rem;
        margin-bottom: 16px;
        color: #c9d1d9;
      }
      .success-body a {
        font-size: 1.15rem;
        color: #58a6ff;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: border-color .2s;
      }
      .success-body a:hover {
        border-color: #58a6ff;
      }
        /* Стили для shared-step-item */
.array-item.shared-step-item {
  background: #1f242b;           /* чуть более светлый фон, чем у контейнера */
  border: 1px dashed #484f58;    /* пунктирная граница */
  border-radius: 4px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.array-item.shared-step-item .shared-step-label {
  flex: 1;
  font-style: italic;
  color: #8b949e;
}

/* Убираем кнопку перетаскивания у общих шагов */
.array-item.shared-step-item .drag-handle {
  visibility: hidden;
}

/* Скрываем textarea и заменяем её на просто лейбл */
.array-item.shared-step-item textarea {
  display: none;
}

/* Чуть сильнее смещаем code-узел вправо, чтобы визуально отличался от сценария */
.code-node{ margin-left: 12px; }

/* Цвет заголовка code-узла (у тебя уже был, на всякий случай оставляю) */
.code-node .node-title{ color:#d29922; }

/* Бейджи FE/BE (если ещё не добавлял из прошлой правки) */
.node-badges{ display:flex; gap:6px; margin-left:8px; }
.badge{ font-size:10px; padding:2px 6px; border-radius:999px; line-height:1; border:1px solid transparent; }
.badge-fe{ background:#3fb950; color:#0b1117; border-color:#2ea043; }
.badge-be{ background:#a371f7; color:#0b1117; border-color:#8957e5; }
/* Чтобы хедер кода не перекрывался ничем и клик не «залипал» */
.code-header { position: relative; z-index: 2; }
.scenario-node > .node-header { position: relative; z-index: 1; }

/* Чуть правее code-узел, чтобы визуально отличался */
.code-node { margin-left: 12px; }
    `}</style>

            {/* Loader поверх всего */}
            {(isSending || isGenerating) && (
                <div className="loader-overlay">
                    <div className="spinner" />
                    <div className="loader-text">
                        {isGenerating
                            ? 'Генерация XMind…'
                            : 'Отправка тест-кейсов в Allure…'}
                    </div>
                </div>
            )}

            {allureLink ? (
                // --- экран успеха ---
                <>
                    <div className="modal-header">
                        <h2>Успешно отправлено</h2>
                        <button
                            className="close-btn"
                            onClick={handleCloseWithConfirm}
                        >×</button>
                    </div>
                    <div className="modal-body" style={{ textAlign: 'center' }}>
                        <p>Тест-кейсы созданы в Allure по ссылке:</p>
                        <a href={allureLink} target="_blank" rel="noopener noreferrer">
                            {allureLink}
                        </a>
                    </div>
                    <div className="modal-footer">
                        <button
                            className="button-primary"
                            onClick={handleCloseWithConfirm}
                        >
                            Закрыть
                        </button>
                    </div>
                </>
            ) : (
                // --- экран ревью/редактирования ---
                <>
                    <div className="modal-header">
                        <h2>Ревью и редактирование тест-кейсов</h2>
                        <button className="close-btn" onClick={handleCloseWithConfirm} disabled={isSending}>×</button>
                    </div>

                    <main className="modal-body">
                        <DragDropContext onDragEnd={onDragEnd}>
                            <Droppable droppableId="features" type="STRUCTURE">
                                {(prov) => (
                                    <div ref={prov.innerRef} {...prov.droppableProps}>
                                        {Object.entries(treeData).map(([featureName, featureData], idx) => (
                                            <Draggable key={featureName} draggableId={featureName} index={idx} type="STRUCTURE">
                                                {(dragProv) => (
                                                    <div ref={dragProv.innerRef} {...dragProv.draggableProps}>
                                                        <FeatureNode
                                                            name={featureName}
                                                            featureData={featureData}
                                                            path={[featureName]}
                                                            onUpdate={handleUpdateCase}
                                                            onDelete={handleDeleteCase}
                                                            onAddStory={(path) => handleAdd(path, 'story')}
                                                            onAddScenario={(path) => handleAdd(path, 'scenario')}
                                                            onToggleExpand={handleToggleExpand}
                                                            onAddTestCase={(path) => handleAdd(path, 'case')}
                                                            onAddCode={(path) => handleAdd(path, 'code')}
                                                            projectId={projectId}
                                                            jiraProject={jiraProject}
                                                            jiraPat={jiraPat}
                                                            onDeleteNode={handleDeleteNode}
                                                        />
                                                    </div>
                                                )}
                                            </Draggable>
                                        ))}
                                        {prov.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>

                        <button
                            className="add-node-btn"
                            style={{ width: '100%', marginTop: '16px', padding: '8px' }}
                            onClick={() => handleAdd([], 'feature')}
                            disabled={isSending}
                        >
                            + Добавить фичу
                        </button>
                    </main>

                    <footer className="modal-footer">
                        <button className="button-secondary" onClick={handleCloseWithConfirm} disabled={isSending}>
                            Отмена
                        </button>
                        <button
                            className="button-primary"
                            onClick={handleGenerateXmind}
                            disabled={isSending || !Object.keys(treeData).length}
                            style={{ marginRight: '8px' }}
                        >
                            Сгенерировать Xmind
                        </button>
                        <button className="button-primary" onClick={handleConfirm} disabled={isSending}>
                            Отправить в Allure
                        </button>
                    </footer>
                </>
            )}
        </Modal>
    );


}
