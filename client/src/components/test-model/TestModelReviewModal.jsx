import React, { useState, useEffect, useCallback } from 'react';
import Modal from 'react-modal';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import config from '../../config.json';
import axios from 'axios';
import AsyncSelect from 'react-select/async';

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

// --- UTILITY FUNCTIONS ---
const generateId = () => `case_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const createNewTestCase = (feature, story, scenario = '') => ({
    id: generateId(),
    title: 'Новый тест-кейс',
    feature,
    story,
    scenario,
    precondition: '',
    sharedSteps: [],
    steps: [''],
    expected: '',
    tags: [],
    layer: 'E2E',
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
        const { feature, story, scenario = '' } = testCase;
        if (!tree[feature]) tree[feature] = { stories: {}, isExpanded: true };
        if (!tree[feature].stories[story])
            tree[feature].stories[story] = { scenarios: {}, cases: [], isExpanded: true };
        if (scenario && !tree[feature].stories[story].scenarios[scenario]) {
            tree[feature].stories[story].scenarios[scenario] = { cases: [], isExpanded: true };
        }
        if (scenario) {
            tree[feature].stories[story].scenarios[scenario].cases.push(testCase);
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
                    priority: c.priority,
                    version: c.version,
                };
                flat.push(base);
            });

            // кейсы с сценарием
            Object.entries(sData.scenarios).forEach(([scenario, scData]) => {
                (scData.cases || []).forEach(c => {
                    const base = { ...c, feature, story, scenario, priority: c.priority, version: c.version };
                    flat.push(base);
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
                                        loadOptions={(inputValue) =>
                                            axios
                                                .get(`${config.serverUrl}/shared-steps`, {
                                                    params: { projectId, query: inputValue },
                                                })
                                                .then((res) =>
                                                    res.data.content.map((s) => ({
                                                        value: s.id,
                                                        label: s.name,
                                                    }))
                                                )
                                        }
                                        onMenuOpen={() =>
                                            axios
                                                .get(`${config.serverUrl}/shared-steps`, {
                                                    params: { projectId, query: '' },
                                                })
                                                .then((res) =>
                                                    setSharedOptions(
                                                        res.data.content.map((s) => ({
                                                            value: s.id,
                                                            label: s.name,
                                                        }))
                                                    )
                                                )
                                        }
                                        options={sharedOptions}
                                        placeholder="+ Добавить общий шаг…"
                                        onChange={(opt) =>
                                            opt &&
                                            addArrayItem('steps', {
                                                sharedStepId: opt.value,
                                                text: opt.label,
                                            })
                                        }
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

const ScenarioNode = ({
    name,
    cases,
    path,
    onUpdate,
    onDelete,
    onToggleExpand,
    isExpanded,
    onAddTestCase,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => (
    <div className="tree-node scenario-node">
        <div className="node-header" onClick={onToggleExpand}>
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

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                        + Тест-кейс
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
                        path={[...path, scenarioName]}
                        isExpanded={scenarioData.isExpanded}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onToggleExpand={() => onToggleExpand([...path, scenarioName])}
                        onAddTestCase={onAddTestCase}
                        projectId={projectId}
                        jiraProject={jiraProject}
                        jiraPat={jiraPat}
                        onDeleteNode={onDeleteNode}
                    />
                ))}

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                        + Тест-кейс
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
                        idx = (storyNode.scenarios[sc].cases || []).findIndex((c) => c.id === caseId);
                        if (idx !== -1) {
                            storyNode.scenarios[sc].cases[idx] = updatedCase;
                            return newTree;
                        }
                    }
                }
            return prevTree;
        });
    }, []);

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
        const srcPath = JSON.parse(source.droppableId);
        const dstPath = JSON.parse(destination.droppableId);
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s, sc] = srcPath;
            let srcArr = sc
                ? newTree[f].stories[s].scenarios[sc].cases
                : newTree[f].stories[s].cases;
            const [moved] = srcArr.splice(source.index, 1);
            moved.feature = dstPath[0];
            moved.story = dstPath[1];
            moved.scenario = dstPath[2] || '';
            const [df, ds, dsc] = dstPath;
            let dstArr = dsc
                ? newTree[df].stories[ds].scenarios[dsc].cases
                : newTree[df].stories[ds].cases;
            dstArr.splice(destination.index, 0, moved);
            return newTree;
        });
    };

    const handleAdd = (path, type) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s] = path;
            if (type === 'case') {
                const nc = createNewTestCase(f, s, path[2] || '');
                if (path.length === 3) newTree[f].stories[s].scenarios[path[2]].cases.push(nc);
                else newTree[f].stories[s].cases.push(nc);
            } else {
                const name = prompt(`Введите название (${type}):`);
                if (!name) return prevTree;
                if (type === 'feature' && !newTree[name]) newTree[name] = { stories: {}, isExpanded: true };
                if (type === 'story' && !newTree[f].stories[name])
                    newTree[f].stories[name] = { scenarios: {}, cases: [], isExpanded: true };
                if (type === 'scenario' && !newTree[f].stories[s].scenarios[name])
                    newTree[f].stories[s].scenarios[name] = { cases: [], isExpanded: true };
            }
            return newTree;
        });
    };

    const handleToggleExpand = (path) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s, sc] = path;
            let node = newTree[f];
            if (s && !sc) node = node.stories[s];
            if (sc) node = node.stories[s].scenarios[sc];
            node.isExpanded = !node.isExpanded;
            return newTree;
        });
    };

    // Удаление фичи/истории/сценария по пути и типу
    const handleDeleteNode = useCallback((path, type) => {
        setTreeData(prev => {
            const newTree = JSON.parse(JSON.stringify(prev));
            const [f, s, sc] = path;
            if (type === 'feature') {
                delete newTree[f];
            } else if (type === 'story') {
                delete newTree[f].stories[s];
            } else if (type === 'scenario') {
                delete newTree[f].stories[s].scenarios[sc];
            }
            return newTree;
        });
    }, []);


    const handleConfirm = () => {
        const cases = flattenTreeToCases(treeData);
        axios.post(
            `${config.serverUrl}/create-test-cases`,
            {
                projectId,
                cases
            },
            { headers: { 'Content-Type': 'application/json' } }
        )
            .then(() => {
                if (onConfirmSend) onConfirmSend(cases);
                onClose();
            })
            .catch(err => {
                console.error('Ошибка при отправке тест-кейсов:', err);
                alert('Не удалось отправить тест-кейсы: ' + (err.response?.data?.error || err.message));
            });
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
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
      `}</style>

            <div className="modal-header">
                <h2>Ревью и редактирование тест-кейсов</h2>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>

            <main className="modal-body">
                <DragDropContext onDragEnd={onDragEnd}>
                    <Droppable droppableId="features" type="STRUCTURE">
                        {(prov) => (
                            <div ref={prov.innerRef} {...prov.droppableProps}>
                                {Object.entries(treeData).map(([featureName, featureData], idx) => (
                                    <Draggable key={featureName} draggableId={featureName} index={idx} type="STRUCTURE">
                                        {(dragProv) => (
                                            <div
                                                ref={dragProv.innerRef}
                                                {...dragProv.draggableProps}
                                            // структура тоже через иконку перетаскивается
                                            >
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
                >
                    + Добавить фичу
                </button>
            </main>

            <footer className="modal-footer">
                <button className="button-secondary" onClick={onClose}>Отмена</button>
                <button className="button-primary" onClick={handleConfirm}>Отправить в Allure</button>
            </footer>
        </Modal>
    );
}
