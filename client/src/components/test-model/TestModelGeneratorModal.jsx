import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from 'react-modal';
import { v4 as uuidv4 } from 'uuid';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import axios from 'axios';
import { ReactFlow, MiniMap, Controls, Background, useNodesState, useEdgesState, MarkerType } from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import config from '../../config.json';

// --- Component-specific styles ---
const StyleInjector = () => {
    const styles = `
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.75);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background: #0d1117;
            color: #c9d1d9;
            border-radius: 8px;
            outline: none;
            padding: 0;
            border: 1px solid #30363d;
            width: 90vw;
            height: 90vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .modal-content.large {
            width: 95%;
            max-width: 1800px;
            height: 95vh;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 24px;
            border-bottom: 1px solid #30363d;
            flex-shrink: 0;
            gap: 16px;
        }

        .modal-header h2 {
            margin: 0;
            font-size: 1.25rem;
            flex-grow: 1;
        }
        
        .header-actions button {
             margin-left: 10px;
        }

        .close-btn {
            background: none;
            border: none;
            color: #8b949e;
            font-size: 24px;
            cursor: pointer;
            padding: 0 8px;
        }

        .modal-main-split {
            display: flex;
            flex-direction: row;
            flex-grow: 1;
            overflow: hidden;
        }
        
        .editor-pane {
            width: 45%;
            min-width: 500px;
            display: flex;
            flex-direction: column;
            border-right: 1px solid #30363d;
            overflow: hidden;
        }

        .visualizer-pane {
            flex-grow: 1;
            background-color: #010409;
        }
        
        .modal-form {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }

        .modal-body {
            padding: 1rem;
            overflow-y: auto;
            flex-grow: 1;
            background-color: #010409;
        }

        .modal-footer {
            padding: 1rem;
            display: flex;
            justify-content: flex-end;
            border-top: 1px solid #30363d;
            background-color: #0d1117;
            flex-shrink: 0;
        }
        
        .button-primary, .button-secondary, .add-feature-btn {
            padding: 10px 20px;
            border-radius: 6px;
            border: 1px solid transparent;
            cursor: pointer;
            font-weight: 600;
            transition: background-color 0.2s;
        }

        .button-primary {
            background-color: #238636;
            color: white;
            border-color: #2ea043;
        }
        .button-primary:hover { background-color: #2ea44f; }
        .button-primary:disabled { background-color: #23863688; cursor: not-allowed; }
        
        .button-accent {
            background-color: #388bfd;
            color: white;
            border-color: #388bfd;
        }
        .button-accent:hover { background-color: #58a6ff; }
        .button-accent:disabled { background-color: #388bfd88; cursor: not-allowed; }

        .button-secondary {
            background-color: #21262d;
            color: #c9d1d9;
            border-color: #30363d;
            margin-right: 10px;
        }
        .button-secondary:hover { background-color: #30363d; }
        .button-secondary:disabled { background-color: #21262d88; cursor: not-allowed; }

        .add-feature-btn {
            background-color: #21262d;
            color: #58a6ff;
            border-color: #30363d;
            margin-top: 1rem;
        }
        .add-feature-btn:hover { border-color: #58a6ff; }

        .tree-node-wrapper {
            margin-left: 20px;
            padding-left: 20px;
            border-left: 1px solid #21262d;
            position: relative;
        }
        
        .tree-node-wrapper:first-child {
            margin-left: 0;
            padding-left: 0;
            border-left: none;
        }

        .tree-node {
            background-color: #161b22;
            border-radius: 6px;
            margin-top: 8px;
            border: 1px solid #30363d;
        }
        .is-dragging {
            background: #21262d;
            border: 1px dashed #58a6ff;
        }

        .node-header {
            display: flex;
            align-items: center;
            padding: 8px;
        }

        .node-drag-handle { cursor: grab; padding: 0 8px; color: #8b949e; }
        .node-toggle { cursor: pointer; padding: 0 4px; }
        .node-icon { margin: 0 4px; }

        .node-name-input {
            flex-grow: 1;
            background: transparent;
            border: none;
            color: #c9d1d9;
            padding: 4px;
            border-radius: 4px;
        }
        .node-name-input:focus { outline: none; background-color: #010409; }

        .node-actions { display: flex; gap: 4px; }

        .action-btn, .action-btn-delete {
            background: #21262d;
            border: 1px solid #30363d;
            color: #8b949e;
            border-radius: 4px;
            cursor: pointer;
            width: 24px;
            height: 24px;
            font-weight: bold;
        }
        .action-btn-delete { color: #f85149; }
        .action-btn:hover { background: #30363d; color: #c9d1d9; }
        .action-btn-delete:hover { background: #f8514933; }

        .node-children { padding: 0 8px 8px 30px; min-height: 10px; }
        .is-over { background-color: rgba(88, 166, 255, 0.1); }

        /* React Flow Node Styles */
        .flow-node-feature { background: #2a3042; color: #a5b4fc; border-color: #6366f1; }
        .flow-node-story { background: #2a4230; color: #a5fccb; border-color: #34d399; }
        .flow-node-scenario { background: #422a3d; color: #fca5f1; border-color: #d334c4; }
        .flow-node-code { background: #423a2a; color: #fcd7a5; border-color: #d39d34; }
    `;
    return <style>{styles}</style>;
};

Modal.setAppElement('#root');

// --- Icons (No changes) ---
const ChevronDown = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>;
const ChevronRight = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>;
const FolderIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>;
const StoryIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>;
const ScenarioIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 18v-6m0 0V6m0 6H6m12 0h6"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="6" r="3"></circle></svg>;
const CodeFileIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;

// --- TreeVisualizer Component (UPDATED to handle multiple root features) ---
const TreeVisualizer = ({ treeData }) => {
    const nodeWidth = 220;
    const nodeHeight = 50;

    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        const allNodes = [];
        const allEdges = [];
        let yOffset = 0;

        // Process each feature as a separate graph
        treeData.forEach(feature => {
            const dagreGraph = new dagre.graphlib.Graph();
            dagreGraph.setDefaultEdgeLabel(() => ({}));
            dagreGraph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 70 });

            const featureNodes = [];
            const featureEdges = [];

            // Recursive function to build nodes and edges for one feature tree
            const buildGraphElements = (nodesToLayout, parentId = null) => {
                nodesToLayout.forEach(node => {
                    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
                    if (parentId) {
                        dagreGraph.setEdge(parentId, node.id);
                    }
                    const children = node.stories || node.scenarios || node.codes;
                    if (children && children.length > 0) {
                        buildGraphElements(children, node.id);
                    }
                });
            };

            buildGraphElements([feature]);
            dagre.layout(dagreGraph);

            let maxY = 0;

            dagreGraph.nodes().forEach(nodeId => {
                const nodeWithPosition = dagreGraph.node(nodeId);
                const originalNode = findNodeById(treeData, nodeId);
                if (!originalNode) return;

                let type = 'default';
                if ('stories' in originalNode) type = 'feature';
                else if ('scenarios' in originalNode) type = 'story';
                else if ('codes' in originalNode) type = 'scenario';
                else type = 'code';

                const yPos = nodeWithPosition.y - nodeHeight / 2 + yOffset;
                featureNodes.push({
                    id: nodeId,
                    type: 'default',
                    data: { label: originalNode.text || `Безымянный ${type}` },
                    position: { x: nodeWithPosition.x - nodeWidth / 2, y: yPos },
                    className: `flow-node-${type}`
                });
                if (yPos + nodeHeight > maxY) {
                    maxY = yPos + nodeHeight;
                }
            });

            dagreGraph.edges().forEach(edge => {
                featureEdges.push({
                    id: `e-${edge.v}-${edge.w}`,
                    source: edge.v,
                    target: edge.w,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    type: 'smoothstep',
                });
            });

            allNodes.push(...featureNodes);
            allEdges.push(...featureEdges);
            yOffset = maxY + 80; // Add padding for the next graph
        });

        // Helper to find the original node data from the tree
        function findNodeById(nodes, id) {
            for (const node of nodes) {
                if (node.id === id) return node;
                const children = node.stories || node.scenarios || node.codes;
                if (children) {
                    const found = findNodeById(children, id);
                    if (found) return found;
                }
            }
            return null;
        }

        return { nodes: allNodes, edges: allEdges };
    }, [treeData]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    return (
        <div style={{ height: '100%', width: '100%' }}>
            <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
                <MiniMap />
                <Controls />
                <Background variant="dots" gap={16} size={1} color="#484848" />
            </ReactFlow>
        </div>
    );
};

// --- TreeNode Component (No changes) ---
const TreeNode = ({ node, index, path, handlers }) => {
    let type, children, childType, placeholder, icon;

    if ('stories' in node) {
        type = 'feature'; children = node.stories; childType = 'story'; placeholder = 'Feature'; icon = <FolderIcon />;
    } else if ('scenarios' in node) {
        type = 'story'; children = node.scenarios; childType = 'scenario'; placeholder = 'Story'; icon = <StoryIcon />;
    } else if ('codes' in node) {
        type = 'scenario'; children = node.codes; childType = 'code'; placeholder = 'Scenario'; icon = <ScenarioIcon />;
    } else {
        type = 'code'; placeholder = 'Code/Unit Test'; icon = <CodeFileIcon />;
    }

    return (
        <Draggable draggableId={node.id} index={index}>
            {(provided, snapshot) => (
                <div ref={provided.innerRef} {...provided.draggableProps} className={`tree-node-wrapper ${snapshot.isDragging ? 'is-dragging' : ''}`}>
                    <div className={`tree-node tree-node-${type}`}>
                        <div className="node-header">
                            <span className="node-drag-handle" {...provided.dragHandleProps}>⠿</span>
                            {children && (
                                <span className="node-toggle" onClick={() => handlers.onToggleExpand(path)}>
                                    {node.isExpanded ? <ChevronDown /> : <ChevronRight />}
                                </span>
                            )}
                            <span className="node-icon">{icon}</span>
                            <input
                                className="node-name-input"
                                placeholder={placeholder}
                                value={node.text}
                                onChange={(e) => handlers.onUpdateText(path, e.target.value)}
                                onKeyDown={(e) => handlers.onKeyDown(e, path, type)}
                            />
                            <div className="node-actions">
                                {childType && <button type="button" className="action-btn" onClick={() => handlers.onAddNode(path, childType)}>+</button>}
                                <button type="button" className="action-btn-delete" onClick={() => handlers.onDeleteNode(path)}>×</button>
                            </div>
                        </div>
                    </div>
                    {node.isExpanded && children && (
                        <Droppable droppableId={JSON.stringify(path)} type={childType.toUpperCase()}>
                            {(provided, snapshot) => (
                                <div ref={provided.innerRef} {...provided.droppableProps} className={`node-children ${snapshot.isDraggingOver ? 'is-over' : ''}`}>
                                    {children.map((childNode, childIndex) => (
                                        <TreeNode key={childNode.id} node={childNode} index={childIndex} path={[...path, childNode.id]} handlers={handlers} />
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    )}
                </div>
            )}
        </Draggable>
    );
};


export default function TestModelGeneratorModal({ isOpen, onClose, initialCases, onGenerate, requirements }) {
    const [treeData, setTreeData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGeneratingModel, setIsGeneratingModel] = useState(false);
    const [isGeneratingCases, setIsGeneratingCases] = useState(false);


    const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

    const buildTreeWithIds = (items) => (items || []).map(item => {
        const newItem = { ...item, id: item.id || uuidv4(), isExpanded: item.isExpanded !== undefined ? item.isExpanded : true };
        if (newItem.stories) newItem.stories = buildTreeWithIds(newItem.stories);
        if (newItem.scenarios) newItem.scenarios = buildTreeWithIds(newItem.scenarios);
        if (newItem.codes) newItem.codes = buildTreeWithIds(newItem.codes);
        return newItem;
    });

    useEffect(() => {
        if (!isOpen) { setIsLoading(true); return; }
        // When the modal opens, load the initial data, which could be from a previous session or AI-generated
        const dataToBuild = (initialCases && initialCases.length > 0) ? initialCases : [];
        const builtTree = buildTreeWithIds(dataToBuild);
        setTreeData(builtTree);
        // Also save this initial state to IndexedDB
        idbSet('testModelTree', builtTree).catch(console.warn);
        setIsLoading(false);
    }, [isOpen, initialCases]);


    // This effect saves any manual changes to the tree to IndexedDB
    useEffect(() => {
        if (isOpen && !isLoading) {
            idbSet('testModelTree', treeData).catch(console.warn);
        }
    }, [treeData, isOpen, isLoading]);

    const findNodeAndParent = (nodes, path, parent = null) => {
        const [head, ...tail] = path;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.id === head) {
                if (tail.length === 0) return { node, parent, index: i, siblings: nodes };
                const childrenKey = Object.keys(node).find(k => Array.isArray(node[k]));
                if (childrenKey) return findNodeAndParent(node[childrenKey], tail, node);
            }
        }
        return null;
    };
    const handleGenerateModel = async () => {
        setIsGeneratingModel(true);
        try {
            const requirementsString = Array.isArray(requirements)
                ? requirements.join('\n\n')
                : requirements;

            const { data } = await axios.post(
                `${config.serverUrl}/generate-test-model`,
                { requirements: requirementsString }
            );

            const newTree = buildTreeWithIds(data);
            setTreeData(newTree);

        } catch (error) {
            console.error("Ошибка при генерации тестовой модели:", error);
            // Using a custom modal for alerts is better, but window.alert is a fallback
            window.alert("Не удалось сгенерировать тестовую модель: " + (error.response?.data?.error || error.message));
        } finally {
            setIsGeneratingModel(false);
        }
    };

    const handlers = useMemo(() => ({
        onAddNode: (path, type) => {
            const newTree = deepClone(treeData);
            const newNode = { id: uuidv4(), text: '', isExpanded: true };
            if (!path) { // Adding a root feature
                newNode.stories = [];
                newTree.push(newNode);
                setTreeData(newTree);
                return;
            }
            switch (type) {
                case 'story': newNode.scenarios = []; break;
                case 'scenario': newNode.codes = []; break;
                case 'code': delete newNode.isExpanded; break;
                default: return;
            }
            const result = findNodeAndParent(newTree, path);
            if (!result) return;
            const { node: parentNode } = result;
            if (type === 'story' && parentNode.stories) parentNode.stories.push(newNode);
            else if (type === 'scenario' && parentNode.scenarios) parentNode.scenarios.push(newNode);
            else if (type === 'code' && parentNode.codes) parentNode.codes.push(newNode);
            setTreeData(newTree);
        },
        onDeleteNode: (path) => {
            let newTree = deepClone(treeData);
            if (path.length === 1) {
                newTree = newTree.filter(f => f.id !== path[0]);
            } else {
                const parentPath = path.slice(0, -1);
                const nodeIdToDelete = path.at(-1);
                const result = findNodeAndParent(newTree, parentPath);
                if (result) {
                    const parentNode = result.node;
                    if (parentNode.stories) parentNode.stories = parentNode.stories.filter(n => n.id !== nodeIdToDelete);
                    if (parentNode.scenarios) parentNode.scenarios = parentNode.scenarios.filter(n => n.id !== nodeIdToDelete);
                    if (parentNode.codes) parentNode.codes = parentNode.codes.filter(n => n.id !== nodeIdToDelete);
                }
            }
            setTreeData(newTree);
        },
        onUpdateText: (path, text) => {
            const newTree = deepClone(treeData);
            const result = findNodeAndParent(newTree, path);
            if (result && result.node) { result.node.text = text; setTreeData(newTree); }
        },
        onToggleExpand: (path) => {
            const newTree = deepClone(treeData);
            const result = findNodeAndParent(newTree, path);
            if (result && result.node) { result.node.isExpanded = !result.node.isExpanded; setTreeData(newTree); }
        },
        onKeyDown: (e, path, type) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const newTree = deepClone(treeData);
                const result = findNodeAndParent(newTree, path);
                if (!result) return;
                const newNode = { id: uuidv4(), text: '', isExpanded: true };
                switch (type) {
                    case 'feature': newNode.stories = []; break;
                    case 'story': newNode.scenarios = []; break;
                    case 'scenario': newNode.codes = []; break;
                    case 'code': delete newNode.isExpanded; break;
                    default: return;
                }
                result.siblings.splice(result.index + 1, 0, newNode);
                setTreeData(newTree);
            }
        }
    }), [treeData]);

    const onDragEnd = useCallback(result => {
        const { source, destination, type } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;
        const newTree = deepClone(treeData);
        const getContainer = (pathStr) => {
            if (pathStr === 'root-droppable') return { container: newTree };
            const path = JSON.parse(pathStr);
            const result = findNodeAndParent(newTree, path);
            if (!result) return { container: null };
            const parentNode = result.node;
            let childrenKey;
            if (type === 'STORY') childrenKey = 'stories';
            else if (type === 'SCENARIO') childrenKey = 'scenarios';
            else if (type === 'CODE') childrenKey = 'codes';
            else return { container: null };
            return { container: parentNode[childrenKey] };
        };
        const { container: sourceContainer } = getContainer(source.droppableId);
        const { container: destContainer } = getContainer(destination.droppableId);
        if (!sourceContainer || !destContainer) return;
        const [movedItem] = sourceContainer.splice(source.index, 1);
        destContainer.splice(destination.index, 0, movedItem);
        setTreeData(newTree);
    }, [treeData]);

    const handleSubmitForCases = async (e) => {
        e.preventDefault();
        if (isGeneratingCases) return;
        setIsGeneratingCases(true);
        try {
            // FIX: Changed onGenerateCases to onGenerate to match the prop being passed.
            // Also ensure onGenerate is a function before calling it.
            if (typeof onGenerate === 'function') {
                await onGenerate(treeData);
            } else {
                console.error("onGenerate prop is not a function!");
            }
        }
        catch (error) { console.error("Ошибка во время генерации тест-кейсов:", error); }
        finally { setIsGeneratingCases(false); }
    };

    if (isLoading) {
        return (
            <Modal isOpen={isOpen} onRequestClose={onClose} overlayClassName="modal-overlay" className="modal-content large">
                <div style={{ padding: '2rem' }}>Загрузка...</div>
            </Modal>
        );
    }

    return (
        <Modal isOpen={isOpen} onRequestClose={onClose} overlayClassName="modal-overlay" className="modal-content large">
            <StyleInjector />
            <div className="modal-header">
                <h2>Редактор тестовой модели</h2>
                <div className="header-actions">
                    <button
                        type="button"
                        className="button-accent"
                        onClick={handleGenerateModel}
                        disabled={isGeneratingModel}
                    >
                        {isGeneratingModel ? 'Генерация...' : 'Сгенерировать тестовую модель'}
                    </button>
                </div>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>
            <div className="modal-main-split">
                <div className="editor-pane">
                    <DragDropContext onDragEnd={onDragEnd}>
                        <form onSubmit={handleSubmitForCases} className="modal-form">
                            <div className="modal-body">
                                <Droppable droppableId="root-droppable" type="FEATURE">
                                    {(provided) => (
                                        <div {...provided.droppableProps} ref={provided.innerRef}>
                                            {treeData.map((feature, index) => (
                                                <TreeNode key={feature.id} node={feature} index={index} path={[feature.id]} handlers={handlers} />
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </Droppable>
                                <button type="button" className="add-feature-btn" onClick={() => handlers.onAddNode(null, 'feature')}>
                                    + Добавить Feature
                                </button>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="button-secondary" onClick={onClose} disabled={isGeneratingCases}>Отмена</button>
                                <button type="submit" className="button-primary" disabled={isGeneratingCases || treeData.length === 0}>
                                    {isGeneratingCases ? 'Генерация...' : 'Сгенерировать тест-кейсы'}
                                </button>
                            </div>
                        </form>
                    </DragDropContext>
                </div>
                <div className="visualizer-pane">
                    <TreeVisualizer treeData={treeData} />
                </div>
            </div>
        </Modal>
    );
}