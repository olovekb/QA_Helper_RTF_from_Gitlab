import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
export const StyleInjector = () => {
    const styles = `
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #010409;
            --bg-tertiary: #161b22;
            --border-primary: #30363d;
            --border-secondary: #21262d;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --accent-blue: #58a6ff;
            --accent-green: #3fb950;
            --accent-purple: #a371f7;
            --accent-orange: #d39d34;
            --danger-red: #f85149;

            --btn-primary-bg: #238636;
            --btn-primary-border: #2ea043;
            --btn-primary-hover-bg: #2ea44f;
            
            --btn-accent-bg: #388bfd;
            --btn-accent-border: #388bfd;
            --btn-accent-hover-bg: #58a6ff;

            --btn-secondary-bg: #21262d;
            --btn-secondary-border: #30363d;
            --btn-secondary-hover-bg: #30363d;
        }

        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.85);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            
        }

      .modal-content {
          background: var(--bg-primary);
          color: var(--text-primary);
          border-radius: 8px;
          outline: none;
          padding: 0;
          border: 1px solid var(--border-primary);
          
          /* --- ИЗМЕНЕНИЯ ЗДЕСЬ --- */
          width: 90%; /* Ширина в процентах от экрана */
          max-width: 1800px; /* Максимальная ширина в пикселях */
          height: 95vh; /* Высота почти на весь экран */
          
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative; /* For loader positioning */
      }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 24px;
            border-bottom: 1px solid var(--border-primary);
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
            color: var(--text-secondary);
            font-size: 24px;
            cursor: pointer;
            padding: 0 8px;
            transition: color 0.2s;
        }
        .close-btn:hover { color: var(--text-primary); }

        .modal-main-split {
            display: flex;
            height: calc(100% - /* высота header+footer */ 112px);
            flex-direction: row;
            flex-grow: 1;
            overflow: hidden;
        }
        
        .editor-pane {
            flex: 0 0 auto;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            flex-shrink: 0; /* Prevent shrinking */
        }

        .resizer {
            width: 5px;
            cursor: col-resize;
            background-color: var(--border-primary);
            flex-shrink: 0;
            transition: background-color 0.2s;
        }
        .resizer:hover, .is-resizing {
             background-color: var(--accent-blue);
        }

        .visualizer-pane {
            flex-grow: 1;
            background-color: var(--bg-secondary);
        }
        
.modal-form {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 800px;
    overflow: hidden;
}
        .modal-body {
            padding: 1rem;
            overflow-y: auto;
            background-color: var(--bg-secondary);
            flex: 1 1 auto; /* This correctly handles flexible height */
            width: 100%; /* Changed from 600px to fill the parent width */
            box-sizing: border-box;
        }

        .modal-footer {
            padding: 1rem;
            display: flex;
            justify-content: flex-end;
            border-top: 1px solid var(--border-primary);
            background-color: var(--bg-primary);
            flex-shrink: 0;
        }


        
        .button-base {
            padding: 10px 20px;
            border-radius: 6px;
            border: 1px solid transparent;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s ease-in-out;
            white-space: nowrap;
        }
        .button-base:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .button-primary {
            background-color: var(--btn-primary-bg);
            color: white;
            border-color: var(--btn-primary-border);
        }
        .button-primary:not(:disabled):hover { background-color: var(--btn-primary-hover-bg); }
        
        .button-accent {
            background-color: var(--btn-accent-bg);
            color: white;
            border-color: var(--btn-accent-border);
        }
        .button-accent:not(:disabled):hover { background-color: var(--btn-accent-hover-bg); }

        .button-secondary {
            background-color: var(--btn-secondary-bg);
            color: var(--text-primary);
            border-color: var(--btn-secondary-border);
            margin-right: 10px;
        }
        .button-secondary:not(:disabled):hover { background-color: var(--btn-secondary-hover-bg); }

        .add-feature-btn {
            background-color: var(--btn-secondary-bg);
            color: var(--accent-blue);
            border-color: var(--border-primary);
            margin-top: 1rem;
            width: 100%;
        }
        .add-feature-btn:not(:disabled):hover { border-color: var(--accent-blue); }

        .tree-node {
            background-color: var(--bg-tertiary);
            border-radius: 6px;
            margin-top: 8px;
            border: 1px solid var(--border-primary);
            transition: border-color 0.2s;
        }
        .is-dragging {
            background: var(--bg-secondary);
            border: 1px dashed var(--accent-blue);
        }
        .tree-node:hover {
            border-color: var(--text-secondary);
        }

        .node-header {
            display: flex;
            align-items: center;
            padding: 8px;
            gap: 6px; /* Consistent spacing */
        }

        .node-drag-handle { cursor: grab; padding: 0 4px; color: var(--text-secondary); }
        .node-toggle { cursor: pointer; display: flex; align-items: center; }
        .node-icon { margin-right: 4px; display: flex; align-items: center; }

        .node-name-input {
            flex-grow: 1;
            flex-shrink: 1;
            min-width: 0;
            background: transparent;
            border: none;
            color: var(--text-primary);
            padding: 4px;
            border-radius: 4px;
            outline: none;
            font-size: 1rem;
        }
        .node-name-input:focus { background-color: var(--bg-secondary); }
        .node-name-input::placeholder { color: var(--text-secondary); opacity: 0.7; }

        .node-actions { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0;}

        .action-btn {
            background: var(--btn-secondary-bg);
            border: 1px solid var(--border-primary);
            color: var(--text-secondary);
            border-radius: 4px;
            cursor: pointer;
            width: 28px;
            height: 28px;
            font-weight: bold;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .action-btn-delete { color: var(--danger-red); }
        .action-btn:hover { background: var(--border-primary); color: var(--text-primary); }
        .action-btn-delete:hover { background: #f8514933; }

        .node-children-container {
            padding-left: 20px;
            margin-left: 18px; /* Align with icon/text */
            border-left: 1px solid var(--border-secondary);
        }
        .node-children {
            padding: 0 8px 8px 8px;
            min-height: 10px;
            border-radius: 0 0 6px 6px;
        }
        .is-over { background-color: rgba(88, 166, 255, 0.1); }
        
        /* React Flow Node Styles */
        .flow-node-feature { background: #2a3042; color: #a5b4fc; border: 1px solid #6366f1; padding: 10px; border-radius: 6px; }
        .flow-node-story { background: #2a4230; color: #a5fccb; border: 1px solid #34d399; padding: 10px; border-radius: 6px; }
        .flow-node-scenario { background: #422a3d; color: #fca5f1; border: 1px solid #d334c4; padding: 10px; border-radius: 6px; }
        .flow-node-code { background: #423a2a; color: #fcd7a5; border: 1px solid #d39d34; padding: 10px; border-radius: 6px; }
    `;
    return <style>{styles}</style>;
};

// --- Loader Overlay Component ---
export const LoaderOverlay = ({ text }) => {
    const loaderStyles = `
        .loader-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(13, 17, 23, 0.8);
            z-index: 1001; /* Above modal content */
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            backdrop-filter: blur(5px);
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid var(--border-primary);
            border-top-color: var(--accent-blue);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        .loader-text {
            font-size: 1.1rem;
            font-weight: 500;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    return (
        <>
            <style>{loaderStyles}</style>
            <div className="loader-overlay">
                <div className="spinner"></div>
                <div className="loader-text">{text}</div>
            </div>
        </>
    );
};

Modal.setAppElement('#root');


const ChevronDown = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>;
const ChevronRight = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>;
const FolderIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>;
const StoryIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>;
const ScenarioIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 18v-6m0 0V6m0 6H6m12 0h6"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="6" r="3"></circle></svg>;
const CodeFileIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;


const TreeVisualizer = ({ treeData }) => {
    const nodeWidth = 220;
    const nodeHeight = 50;

    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        const allNodes = [];
        const allEdges = [];
        let yOffset = 0;

        treeData.forEach(feature => {
            const dagreGraph = new dagre.graphlib.Graph();
            dagreGraph.setDefaultEdgeLabel(() => ({}));
            dagreGraph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 70 });

            const buildGraphElements = (nodesToLayout, parentId = null) => {
                nodesToLayout.forEach(node => {
                    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
                    if (parentId) dagreGraph.setEdge(parentId, node.id);

                    // Собираем ВСЕ три массива:
                    const children = [
                        ...(node.stories || []),
                        ...(node.scenarios || []),
                        ...(node.codes || [])
                    ];
                    if (children.length) {
                        buildGraphElements(children, node.id);
                    }
                });
            };

            buildGraphElements([feature]);
            dagre.layout(dagreGraph);

            let maxY = 0;
            const findNodeById = (nodes, id) => {
                for (const node of nodes) {
                    if (node.id === id) return node;
                    const children = [
                        ...(node.stories || []),
                        ...(node.scenarios || []),
                        ...(node.codes || [])
                    ];
                    if (children.length) {
                        const found = findNodeById(children, id);
                        if (found) return found;
                    }
                }
                return null;
            };

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
                allNodes.push({
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
                allEdges.push({
                    id: `e-${edge.v}-${edge.w}`,
                    source: edge.v,
                    target: edge.w,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    type: 'smoothstep',
                });
            });
            yOffset = maxY + 80;
        });
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


// --- Refactored TreeNode Component ---
const TreeNode = ({ node, index, path, handlers }) => {
    // Developer Comment: Определяем тип узла и его свойства на основе уровня вложенности (длины path).
    // Это делает компонент универсальным для всех уровней дерева.
    const level = path.length;

    let type, children, childType, placeholder, icon;
    if (level === 1) { // Feature
        type = 'feature'; children = node.stories; childType = 'story'; placeholder = 'Feature'; icon = <FolderIcon />;
    } else if (level === 2) { // Story
        type = 'story'; children = node.scenarios; childType = 'scenario'; placeholder = 'Story'; icon = <StoryIcon />;
    } else if (level === 3) { // Scenario
        type = 'scenario'; children = node.codes; childType = 'code'; placeholder = 'Scenario'; icon = <ScenarioIcon />;
    } else { // Code
        type = 'code'; children = null; childType = null; placeholder = 'Code'; icon = <CodeFileIcon />;
    }

    return (
        <Draggable draggableId={node.id} index={index}>
            {(provided, snapshot) => (
                <div ref={provided.innerRef} {...provided.draggableProps} className={snapshot.isDragging ? 'is-dragging' : ''}>
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
                                onKeyDown={(e) => handlers.onKeyDown(e, path, type, childType)}
                            />
                            <div className="node-actions">
                                {childType && <button type="button" title={`Add new ${childType}`} className="action-btn" onClick={() => handlers.onAddNode(path, childType)}>+</button>}
                                <button type="button" title="Delete node" className="action-btn action-btn-delete" onClick={() => handlers.onDeleteNode(path)}>×</button>
                            </div>
                        </div>
                    </div>
                    {/* Developer Comment: Контейнер для дочерних элементов вынесен наружу,
                        чтобы отступ и левая граница применялись ко всей группе детей, а не к каждому узлу.
                        Это и исправляет визуальную иерархию. */}
                    {node.isExpanded && children && (
                        <div className="node-children-container">
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
                        </div>
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

    // --- State and logic for resizable panels ---
    const [editorWidth, setEditorWidth] = useState(800); // Initial width
    const [isResizing, setIsResizing] = useState(false);
    const editorPaneRef = useRef(null);

    const handleMouseDown = (e) => {
        e.preventDefault();
        setIsResizing(true);
    };

    const handleMouseUp = useCallback(() => {
        setIsResizing(false);
    }, []);

    const handleCloseWithConfirm = () => {
        if (isGeneratingModel || isGeneratingCases) return;
        if (window.confirm('Вы уверены? Данные не сохранятся')) {
            onClose();
        }
    };

    const handleMouseMove = useCallback((e) => {
        if (isResizing && editorPaneRef.current) {
            const newWidth = e.clientX - editorPaneRef.current.getBoundingClientRect().left;
            // Add constraints for min/max width
            if (newWidth > 350 && newWidth < window.innerWidth * 0.8) {
                setEditorWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, handleMouseMove, handleMouseUp]);


    // --- Core Logic (with minor refactoring for clarity) ---
    const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

    /**
     * Рекурсивно оборачивает исходный JSON в нужные поля и расставляет id/isExpanded.
     * @param {Array} items  — массив из фич или историй или сценариев в зависимости от depth
     * @param {number} depth — 1=features, 2=stories, 3=scenarios, 4=codes
     */
    const buildTreeWithIds = (items, depth = 1) => {
        return (items || []).map(item => {
            // Сначала задаём базовые поля
            const newItem = {
                ...item,
                id: item.id || uuidv4(),
                isExpanded: item.isExpanded !== undefined ? item.isExpanded : true,
                // убираем любые “лишние” пустые массивы
            };

            // В зависимости от глубины кладём детей в правильное свойство:
            if (depth === 1 && Array.isArray(item.stories)) {
                newItem.stories = buildTreeWithIds(item.stories, 2);
            }
            if (depth === 2 && Array.isArray(item.scenarios)) {
                newItem.scenarios = buildTreeWithIds(item.scenarios, 3);
            }
            if (depth === 3) {
                const raw = Array.isArray(item.codes)
                    ? item.codes
                    : Array.isArray(item.code)
                        ? item.code
                        : [];
                newItem.codes = buildTreeWithIds(raw, 4);
                if ('code' in newItem) delete newItem.code;
            }

            return newItem;
        });
    };

    useEffect(() => {
        if (!isOpen) { setIsLoading(true); return; }

        const dataToBuild = (initialCases && initialCases.length > 0) ? initialCases : [];
        const builtTree = buildTreeWithIds(dataToBuild);
        setTreeData(builtTree);
        idbSet('testModelTree', builtTree).catch(console.warn);
        setIsLoading(false);
    }, [isOpen, initialCases]);


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

                const childrenKey =
                    Array.isArray(node.stories) ? 'stories' :
                        Array.isArray(node.scenarios) ? 'scenarios' :
                            Array.isArray(node.codes) ? 'codes' :
                                null;
                if (childrenKey) return findNodeAndParent(node[childrenKey], tail, node);
            }
        }
        return null;
    };
    const sanitizeRequirementsForPayload = (req, inputMode) => {
        // если грузим из Confluence — текст требований не нужен
        if (inputMode === 'confluence') return '';

        const s = Array.isArray(req) ? req.join('\n\n---\n\n') : String(req || '').trim();

        // строка целиком — только "Confluence Page ID: 123456"
        if (/^confluence\s*page\s*id\s*:\s*\d+\s*$/i.test(s)) return '';

        // вырежем возможную строку с Page ID, вдруг она замешалась в текст
        const cleaned = s.replace(/^\s*confluence\s*page\s*id\s*:\s*\d+\s*$/gmi, '').trim();

        return cleaned;
    };

    // --- helpers (локальные, без регрессии) ---
    const getConfluencePageId = (raw) => {
        if (!raw) return '';
        const s = String(raw).trim();
        if (/^\d+$/.test(s)) return s;
        try {
            const u = new URL(s);
            const pid = u.searchParams.get('pageId');
            if (pid) return pid;
            const m = u.href.match(/pageId=(\d+)/i) || u.pathname.match(/(\d{5,})$/);
            return m ? m[1] : '';
        } catch {
            // поддержим формат "Confluence Page ID: 133465419"
            const m = s.match(/confluence\s*page\s*id[:\s]*([0-9]+)/i);
            return m ? m[1] : '';
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

    // --- новый handleGenerateModel ---
    const handleGenerateModel = async () => {
        setIsGeneratingModel(true);
        try {

            // 2) Тянем всё, что уже лежит в IndexedDB (SolutionPage это туда кладёт)
            const [
                inputMode,
                idbConfluencePageId,
                idbBearerToken,
                idbGlossary,
                idbGlossaryPageId,
                idbContextPageIds,        // ← читаем современное хранилище (мультиселект)
                idbContextInstruction,
                idbContextText,
            ] = await Promise.all([
                idbGet('inputMode').catch(() => undefined),
                idbGet('confluencePageId').catch(() => undefined),
                idbGet('bearerToken').catch(() => undefined),
                idbGet('glossary').catch(() => undefined),
                idbGet('glossaryPageId').catch(() => undefined),
                idbGet('contextPageIds').catch(() => undefined),   // ← вот оно
                idbGet('contextInstruction').catch(() => undefined),
                idbGet('contextText').catch(() => undefined),
            ]);
            const requirementsString = sanitizeRequirementsForPayload(requirements, inputMode);
            // 3) Пытаемся аккуратно извлечь pageId (работает и для "Confluence Page ID: 123")
            const pageIdFromReq =
                Array.isArray(requirements)
                    ? '' // когда с задач — уже чистый текст, pageId берём из IDB
                    : getConfluencePageId(requirementsString);

            const pageId =
                getConfluencePageId(idbConfluencePageId) || pageIdFromReq || '';

            const glossaryPageId = getConfluencePageId(idbGlossaryPageId);
            const contextPageIds = Array.isArray(idbContextPageIds)
                ? [...new Set(idbContextPageIds.map(getConfluencePageId).filter(Boolean))]
                : [];

            const payload = {
                ...(requirementsString ? { requirements: requirementsString } : {}),
                pageId: pageId || undefined,
                bearerToken: idbBearerToken || undefined,
                glossary: idbGlossary || undefined,
                glossaryPageId: glossaryPageId || undefined,
                context: idbContextText || undefined,
                contextPageIds: contextPageIds.length ? contextPageIds : undefined, // ← ок
                contextInstruction: idbContextInstruction || undefined,
                inputMode: inputMode || undefined,
            };

            const { data } = await axios.post(
                `${config.serverUrl}/generate-test-model`,
                payload
            );

            // 5) Рендерим полученную модель
            const newTree = buildTreeWithIds(data);
            setTreeData(newTree);
        } catch (error) {
            console.error('Ошибка при генерации тестовой модели:', error);
            window.alert(
                'Не удалось сгенерировать тестовую модель: ' +
                (error.response?.data?.error || error.message)
            );
        } finally {
            setIsGeneratingModel(false);
        }
    };


    const handlers = useMemo(() => ({
        onAddNode: (path, type) => {
            const newTree = deepClone(treeData);
            const newNode = { id: uuidv4(), text: '', isExpanded: true };
            if (!path) { // Add root feature
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
        onKeyDown: (e, path, type, childType) => {
            // Developer Comment: Added dual keyboard shortcuts for better UX.
            // Enter -> Creates a sibling node.
            // Ctrl/Cmd + Enter -> Creates a child node inside the current one.
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    // Create child node
                    if (childType) {
                        const newTree = deepClone(treeData);
                        const result = findNodeAndParent(newTree, path);
                        if (!result) return;

                        // Expand parent if it wasn't already
                        if (!result.node.isExpanded) {
                            result.node.isExpanded = true;
                        }

                        // Use the main onAddNode handler
                        handlers.onAddNode(path, childType);
                    }
                } else {
                    // Create sibling node
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
        }
    }), [treeData]); // handlers dependency is just treeData now

    const onDragEnd = useCallback(result => {
        const { source, destination, type } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;

        const newTree = deepClone(treeData);

        const getContainer = (droppableId) => {
            if (droppableId === 'root-droppable') return { container: newTree };
            const path = JSON.parse(droppableId);
            const result = findNodeAndParent(newTree, path);
            if (!result) return { container: null };

            const parentNode = result.node;
            const containerMap = { 'FEATURE': 'stories', 'STORY': 'scenarios', 'SCENARIO': 'codes', 'CODE': 'codes' };
            const childrenKey = containerMap[type];

            return { container: parentNode && parentNode[childrenKey] ? parentNode[childrenKey] : null };
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
            if (typeof onGenerate === 'function') {
                await onGenerate(treeData);
            } else {
                console.error("onGenerate prop is not a function!");
            }
        }
        catch (error) { console.error("Ошибка во время генерации тест-кейсов:", error); }
        finally { setIsGeneratingCases(false); }
    };

    // Show a simple loading state until initial data is processed
    if (isLoading && isOpen) {
        return (
            <Modal isOpen={true} onRequestClose={handleCloseWithConfirm} overlayClassName="modal-overlay" className="modal-content">
                <LoaderOverlay text="Загрузка редактора..." />
            </Modal>
        );
    }

    const isBusy = isGeneratingModel || isGeneratingCases;
    const loaderText = isGeneratingModel ? "Генерация тестовой модели..." : `При больших требованиях генерация может быть минут 10, сходи покури или попей чай`;

    return (
        <Modal isOpen={isOpen} onRequestClose={isBusy ? () => { } : handleCloseWithConfirm} overlayClassName="modal-overlay" className="modal-content">
            <StyleInjector />
            {isBusy && <LoaderOverlay text={loaderText} />}

            <div className="modal-header">
                <h2>Редактор тестовой модели</h2>
                <div className="header-actions">
                    <button
                        type="button"
                        className="button-base button-accent"
                        onClick={handleGenerateModel}
                        disabled={isBusy}
                    >
                        Сгенерировать модель по требованиям
                    </button>
                </div>
                <button className="close-btn" onClick={handleCloseWithConfirm} disabled={isBusy}>×</button>
            </div>

            <div className="modal-main-split">
                <div ref={editorPaneRef} className="editor-pane" style={{ width: `${editorWidth}px` }}>
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
                                <button type="button" className="button-base add-feature-btn" onClick={() => handlers.onAddNode(null, 'feature')} disabled={isBusy}>
                                    + Добавить Feature
                                </button>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="button-base button-secondary" onClick={handleCloseWithConfirm} disabled={isBusy}>Отмена</button>
                                <button type="submit" className="button-base button-primary" disabled={isBusy || treeData.length === 0}>
                                    Сгенерировать тест-кейсы
                                </button>
                            </div>
                        </form>
                    </DragDropContext>
                </div>

                <div className={`resizer ${isResizing ? 'is-resizing' : ''}`} onMouseDown={handleMouseDown}></div>

                <div className="visualizer-pane">
                    <TreeVisualizer treeData={treeData} />
                </div>
            </div>
        </Modal>
    );
}