import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Modal from 'react-modal';
import { v4 as uuidv4 } from 'uuid';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import axios from 'axios';
import { ReactFlow, MiniMap, Controls, Background, Handle, Position, useNodesState, useEdgesState, MarkerType } from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import config from '../../config';
import JSZip from 'jszip';
import { trackEvent } from '../../analytics';

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

        .header-controls {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .minimize-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 20px;
            cursor: pointer;
            padding: 0 8px;
            transition: color 0.2s;
        }
        .minimize-btn:hover { 
            color: var(--accent-orange); 
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
            cursor: default;
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
        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
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

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        @keyframes shimmer {
            0% { background-position: -200px 0; }
            100% { background-position: calc(200px + 100%) 0; }
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


// Компонент для отображения diff изменений модели
const ModelDiffView = ({ diff }) => {
    if (!diff) return null;

    const renderDiffSection = (title, items, type) => {
        if (!items || items.length === 0) return null;

        return (
            <div style={{ marginBottom: '12px' }}>
                <h5 style={{ 
                    margin: '0 0 8px 0', 
                    fontSize: '0.9em', 
                    color: type === 'added' ? 'var(--accent-green)' : type === 'removed' ? 'var(--danger-red)' : 'var(--accent-orange)',
                    fontWeight: 600
                }}>
                    {title} ({items.length})
                </h5>
                <div style={{ 
                    paddingLeft: '12px',
                    fontSize: '0.85em',
                    maxHeight: '150px',
                    overflowY: 'auto'
                }}>
                    {items.map((item, idx) => (
                        <div key={idx} style={{ 
                            marginBottom: '4px',
                            padding: '4px 8px',
                            background: type === 'added' 
                                ? 'rgba(63, 185, 80, 0.1)' 
                                : type === 'removed' 
                                    ? 'rgba(248, 81, 73, 0.1)' 
                                    : 'rgba(211, 157, 52, 0.1)',
                            borderRadius: '4px',
                            borderLeft: `3px solid ${type === 'added' ? 'var(--accent-green)' : type === 'removed' ? 'var(--danger-red)' : 'var(--accent-orange)'}`
                        }}>
                            {type === 'modified' ? (
                                <div>
                                    <div style={{ color: 'var(--text-secondary)', textDecoration: 'line-through' }}>
                                        {item.old || item.old?.text || 'N/A'}
                                    </div>
                                    <div style={{ color: 'var(--text-primary)', marginTop: '4px' }}>
                                        → {item.new || item.new?.text || 'N/A'}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-primary)' }}>
                                    {item.text || item.id}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div>
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)', 
                gap: '12px',
                marginBottom: '16px',
                fontSize: '0.85em'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Features</div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>
                        {diff.metrics.old.featuresCount} → {diff.metrics.new.featuresCount}
                    </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Stories</div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>
                        {diff.metrics.old.storiesCount} → {diff.metrics.new.storiesCount}
                    </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Scenarios</div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>
                        {diff.metrics.old.scenariosCount} → {diff.metrics.new.scenariosCount}
                    </div>
                </div>
            </div>

            {renderDiffSection('➕ Добавлено', [
                ...diff.added.features,
                ...diff.added.stories,
                ...diff.added.scenarios,
                ...diff.added.codes
            ], 'added')}
            {renderDiffSection('✏️ Изменено', [
                ...diff.modified.features,
                ...diff.modified.stories,
                ...diff.modified.scenarios,
                ...diff.modified.codes
            ], 'modified')}
            {renderDiffSection('➖ Удалено', [
                ...diff.removed.features,
                ...diff.removed.stories,
                ...diff.removed.scenarios,
                ...diff.removed.codes
            ], 'removed')}
        </div>
    );
};

const TreeVisualizer = ({ treeData }) => {
    const nodeWidth = 220;
    const nodeHeight = 50;

    // Диагностика
    console.log('TreeVisualizer: treeData:', treeData?.length || 0, 'features');
    if (treeData && treeData.length > 0) {
        const totalStories = treeData.reduce((acc, f) => acc + (f.stories?.length || 0), 0);
        const totalScenarios = treeData.reduce((acc, f) => acc + (f.stories || []).reduce((a, s) => a + (s.scenarios?.length || 0), 0), 0);
        const totalCodes = treeData.reduce((acc, f) => acc + (f.stories || []).reduce((a, s) => a + (s.scenarios || []).reduce((a2, sc) => a2 + (sc.codes?.length || 0), 0), 0), 0);
        console.log('TreeVisualizer: stories:', totalStories, 'scenarios:', totalScenarios, 'codes:', totalCodes);
    }

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

void TreeVisualizer;

const FLOW_NODE_COLORS = {
    feature: { background: '#16324f', border: '#58a6ff', label: 'Feature' },
    story: { background: '#2f2615', border: '#d39d34', label: 'Story' },
    scenario: { background: '#1f3a2d', border: '#3fb950', label: 'Scenario' },
    code: { background: '#30223f', border: '#a371f7', label: 'Code' }
};

const getReadableNodeDimensions = (text = '', kind = 'story') => {
    const normalizedLength = String(text || '').trim().length;
    const minWidth = kind === 'feature' ? 240 : kind === 'code' ? 230 : 250;
    const maxWidth = kind === 'code' ? 320 : 360;
    const width = Math.min(maxWidth, Math.max(minWidth, 170 + normalizedLength * 1.4));
    const rows = Math.min(kind === 'code' ? 4 : 3, Math.max(2, Math.ceil(normalizedLength / 34)));
    return {
        width,
        height: 58 + rows * 18
    };
};

const ReadableFlowNode = ({ data }) => {
    const palette = FLOW_NODE_COLORS[data.kind] || FLOW_NODE_COLORS.story;

    return (
        <div
            title={data.fullText || data.label}
            style={{
                width: '100%',
                height: '100%',
                padding: '10px 12px',
                borderRadius: 14,
                border: `1px solid ${data.isMatch ? '#f85149' : palette.border}`,
                background: data.isMatch ? 'rgba(248, 81, 73, 0.16)' : palette.background,
                color: 'var(--text-primary)',
                boxSizing: 'border-box',
                boxShadow: data.isMatch
                    ? '0 0 0 2px rgba(248, 81, 73, 0.22)'
                    : '0 8px 20px rgba(0, 0, 0, 0.18)',
                cursor: data.kind === 'scenario' ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
            }}
        >
            <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
                {palette.label}
            </div>
            <div
                style={{
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: data.kind === 'code' ? 3 : 2,
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word'
                }}
            >
                {data.label}
            </div>
            {data.meta ? (
                <div
                    style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {data.meta}
                </div>
            ) : null}
            <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
        </div>
    );
};

const readableTreeNodeTypes = {
    modelNode: ReadableFlowNode
};

const ReadableTreeVisualizer = ({ treeData, modelSource = 'current_task' }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedScenarioIds, setExpandedScenarioIds] = useState({});
    const normalizedSearch = searchQuery.trim().toLowerCase();

    const scenarioIdsMatchingCodes = useMemo(() => {
        if (!normalizedSearch) return new Set();

        const matches = new Set();
        (treeData || []).forEach((feature) => {
            for (const story of feature.stories || []) {
                for (const scenario of story.scenarios || []) {
                    if ((scenario.codes || []).some(code => String(code.text || '').toLowerCase().includes(normalizedSearch))) {
                        matches.add(scenario.id);
                    }
                }
            }
        });
        return matches;
    }, [treeData, normalizedSearch]);

    const visibleScenarioIds = useMemo(() => {
        const expanded = Object.entries(expandedScenarioIds)
            .filter(([, isExpanded]) => Boolean(isExpanded))
            .map(([scenarioId]) => scenarioId);
        return new Set([...expanded, ...Array.from(scenarioIdsMatchingCodes)]);
    }, [expandedScenarioIds, scenarioIdsMatchingCodes]);

    const { nodes: initialNodes, edges: initialEdges, matchCount } = useMemo(() => {
        const allNodes = [];
        const allEdges = [];
        let yOffset = 0;
        let matches = 0;

        const matchesSearch = (value = '') => normalizedSearch && String(value || '').toLowerCase().includes(normalizedSearch);

        (treeData || []).forEach((feature) => {
            const dagreGraph = new dagre.graphlib.Graph();
            dagreGraph.setDefaultEdgeLabel(() => ({}));
            dagreGraph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 });

            const addNodeToGraph = (node, kind, parentId = null) => {
                const nodeText = node.text || `Unnamed ${kind}`;
                const { width, height } = getReadableNodeDimensions(nodeText, kind);
                const isMatch = matchesSearch(nodeText) || (kind === 'scenario' && scenarioIdsMatchingCodes.has(node.id));

                if (isMatch) matches++;

                let meta = '';
                if (kind === 'scenario' && Array.isArray(node.codes) && node.codes.length > 0) {
                    meta = visibleScenarioIds.has(node.id)
                        ? `Codes: ${node.codes.length} раскрыто`
                        : `Codes: ${node.codes.length} скрыто`;
                } else if (kind === 'story') {
                    meta = `Scenarios: ${node.scenarios?.length || 0}`;
                } else if (kind === 'feature') {
                    meta = `Stories: ${node.stories?.length || 0}`;
                }

                dagreGraph.setNode(node.id, {
                    width,
                    height,
                    originalNode: node,
                    kind,
                    isMatch,
                    meta
                });

                if (parentId) {
                    dagreGraph.setEdge(parentId, node.id);
                }

                const nextChildren =
                    kind === 'feature' ? (node.stories || []) :
                        kind === 'story' ? (node.scenarios || []) :
                            kind === 'scenario' ? (visibleScenarioIds.has(node.id) ? (node.codes || []) : []) :
                                [];

                nextChildren.forEach(child => {
                    const childKind = kind === 'feature'
                        ? 'story'
                        : kind === 'story'
                            ? 'scenario'
                            : 'code';
                    addNodeToGraph(child, childKind, node.id);
                });
            };

            addNodeToGraph(feature, 'feature');
            dagre.layout(dagreGraph);

            let maxY = 0;
            dagreGraph.nodes().forEach(nodeId => {
                const layoutNode = dagreGraph.node(nodeId);
                const yPos = layoutNode.y - layoutNode.height / 2 + yOffset;

                allNodes.push({
                    id: nodeId,
                    type: 'modelNode',
                    data: {
                        label: layoutNode.originalNode.text || `Unnamed ${layoutNode.kind}`,
                        fullText: layoutNode.originalNode.text || `Unnamed ${layoutNode.kind}`,
                        kind: layoutNode.kind,
                        meta: layoutNode.meta,
                        isMatch: layoutNode.isMatch
                    },
                    position: {
                        x: layoutNode.x - layoutNode.width / 2,
                        y: yPos
                    },
                    style: {
                        width: layoutNode.width,
                        height: layoutNode.height
                    }
                });

                if (yPos + layoutNode.height > maxY) {
                    maxY = yPos + layoutNode.height;
                }
            });

            dagreGraph.edges().forEach(edge => {
                allEdges.push({
                    id: `e-${edge.v}-${edge.w}`,
                    source: edge.v,
                    target: edge.w,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    type: 'smoothstep'
                });
            });

            yOffset = maxY + 110;
        });

        return { nodes: allNodes, edges: allEdges, matchCount: matches };
    }, [treeData, normalizedSearch, scenarioIdsMatchingCodes, visibleScenarioIds]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    const handleNodeClick = useCallback((_, node) => {
        if (node?.data?.kind !== 'scenario') return;
        setExpandedScenarioIds(prev => ({
            ...prev,
            [node.id]: !prev[node.id]
        }));
    }, []);

    const sourceLabel = modelSource === 'local_cache'
        ? 'Источник: восстановлено из локального кэша'
        : 'Источник: текущая задача';

    return (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--border-primary)',
                    background: 'rgba(22, 27, 34, 0.82)'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Поиск по feature, story, scenario и code"
                        style={{
                            width: '100%',
                            maxWidth: 360,
                            padding: '9px 12px',
                            borderRadius: 10,
                            border: '1px solid var(--border-primary)',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            outline: 'none'
                        }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {normalizedSearch ? `Совпадений: ${matchCount}` : 'Показаны Feature → Story → Scenario'}
                    </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {sourceLabel}
                </div>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={readableTreeNodeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={handleNodeClick}
                    fitView
                    fitViewOptions={{ padding: 0.15 }}
                    proOptions={{ hideAttribution: true }}
                >
                    <MiniMap pannable zoomable />
                    <Controls />
                    <Background variant="dots" gap={18} size={1} color="#484848" />
                </ReactFlow>
            </div>
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


export default function TestModelGeneratorModal({ 
    isOpen, 
    onClose, 
    initialCases, 
    onGenerate, 
    requirements, 
    jiraProject,
    jiraPat,
    buildRequirementsPayload,
    prepareRequirements,
    inputMode,
    solutionText,
    confluencePageId,
    bearerToken,
    glossary,
    glossaryPageId,
    contextText,
    contextPageIds,
    contextInstruction,
    tasks,
    // Состояния генерации тестовой модели
    modelGenerationTaskId,
    setModelGenerationTaskId,
    modelGenerationProgress,
    setModelGenerationProgress,
    modelGenerationStatus,
    setModelGenerationStatus,
    modelIsMinimized,
    setModelIsMinimized,
    checkModelGenerationStatus,
    generatedModel,
    projects,
    cancelGeneration
}) {
    const [treeData, setTreeData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGeneratingModel, setIsGeneratingModel] = useState(false);
    const [isGeneratingCases, setIsGeneratingCases] = useState(false);
    const [localGeneratedModel, setLocalGeneratedModel] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isGeneratingXmind, setIsGeneratingXmind] = useState(false);
    const [generationMode, setGenerationMode] = useState('create'); // 'create' | 'refine'
    const [reviewComment, setReviewComment] = useState('');
    const [modelVersion, setModelVersion] = useState(1);
    const [modelHistory, setModelHistory] = useState([]); // [{ version, model, timestamp, comment }]
    const [modelDiff, setModelDiff] = useState(null); // diff между v1 и v2
    const [showDiffView, setShowDiffView] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [modelDataSource, setModelDataSource] = useState('current_task');

    const storagePageScope = useMemo(() => {
        const rawValue = String(confluencePageId || '').trim();
        if (/^\d+$/.test(rawValue)) return rawValue;

        try {
            const url = new URL(rawValue);
            return url.searchParams.get('pageId') || rawValue || 'manual';
        } catch {
            const match = rawValue.match(/([0-9]{5,})/);
            return match ? match[1] : 'manual';
        }
    }, [confluencePageId]);

    const storageTaskScope = useMemo(
        () => String(modelGenerationTaskId || 'latest'),
        [modelGenerationTaskId]
    );

    const getScopedStorageKey = useCallback((baseKey, taskScope = storageTaskScope) => (
        `${baseKey}:${storagePageScope}:${taskScope}`
    ), [storagePageScope, storageTaskScope]);

    const idbGetModelValue = useCallback(async (baseKey) => {
        const scopedValue = await idbGet(getScopedStorageKey(baseKey)).catch(() => null);
        return scopedValue !== undefined ? scopedValue : null;
    }, [getScopedStorageKey]);

    const idbSetModelValueForScope = useCallback((baseKey, taskScope, value) => (
        idbSet(getScopedStorageKey(baseKey, taskScope), value)
    ), [getScopedStorageKey]);

    const idbSetModelValue = useCallback((baseKey, value) => {
        if (storageTaskScope === 'latest') {
            return idbSetModelValueForScope(baseKey, 'latest', value);
        }

        return Promise.all([
            idbSetModelValueForScope(baseKey, storageTaskScope, value),
            idbSetModelValueForScope(baseKey, 'latest', value)
        ]);
    }, [idbSetModelValueForScope, storageTaskScope]);

    // Функция для подсчета всех узлов в дереве
    const countAllNodes = (treeData) => {
        let count = 0;
        const countNodes = (nodes) => {
            if (!Array.isArray(nodes)) return;
            for (const node of nodes) {
                count++;
                if (node.children && Array.isArray(node.children)) {
                    countNodes(node.children);
                }
            }
        };
        countNodes(treeData);
        return count;
    };

    const handleGenerateXmind = async () => {
        trackEvent('export_xmind_modal', { page: '/solution' });
        setIsGeneratingXmind(true);

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
            const featureTopics = (localGeneratedModel || treeData).map((featureData) => {
                const featureName = featureData.text || 'Безымянная функция';

                const storyTopics = (featureData.stories || []).map((storyData) => {
                    const storyName = storyData.text || 'Безымянная история';

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
                            title: caseItem.title || 'Безымянный кейс',
                            testType,
                            markers: markers.length ? markers : undefined,
                        };
                    });

                    const scenarioTopics = (storyData.scenarios || []).map((scenarioData) => {
                        const scenarioName = scenarioData.text || 'Безымянный сценарий';

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
                                title: caseItem.title || 'Безымянный кейс',
                                testType,
                                markers: markers.length ? markers : undefined,
                            };
                        });

                        const codeTopics = (scenarioData.codes || []).map((codeData) => {
                            const codeName = codeData.text || 'Безымянный код';

                            const unitChildren = (codeData.cases || []).map((caseItem) => {
                                const markers = [];
                                if ((caseItem.layer || "").toLowerCase().includes("frontend")) markers.push({ markerId: "flag-green" });
                                if ((caseItem.layer || "").toLowerCase().includes("backend")) markers.push({ markerId: "flag-purple" });
                                return {
                                    id: caseItem.id || generateIdLocal(),
                                    class: "topic",
                                    title: caseItem.title || 'Безымянный кейс',
                                    testType: "unit",
                                    markers: markers.length ? markers : undefined,
                                };
                            });

                            // ✅ Используем поле type из Code (если есть), иначе определяем по cases
                            const codeType = codeData.type || 'integration';
                            const hasFE = codeType === 'frontend' || (codeData.cases || []).some((c) => (c.layer || "").toLowerCase().includes("frontend"));
                            const hasBE = codeType === 'backend' || (codeData.cases || []).some((c) => (c.layer || "").toLowerCase().includes("backend"));
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

            const contentJson = [
                {
                    id: generateIdLocal(),
                    class: "sheet",
                    title: "Тест-модель",
                    rootTopic: {
                        id: generateIdLocal(),
                        class: "topic",
                        title: jiraProject || 'Проект',
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

            const metadataJson = {
                dataStructureVersion: "2",
                creator: { name: "TestModelGenerator", version: "1.0.0" },
                layoutEngineVersion: "3",
            };

            const manifestJson = {
                "file-entries": { "content.json": {}, "metadata.json": {} },
            };

            const zip = new JSZip();
            zip.file("content.json", JSON.stringify(contentJson, null, 2));
            zip.file("metadata.json", JSON.stringify(metadataJson, null, 2));
            zip.file("manifest.json", JSON.stringify(manifestJson, null, 2));

            const blob = await zip.generateAsync({
                type: "blob",
                mimeType: "application/vnd.xmind.xmind",
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${jiraProject || 'test-model'}-${Date.now()}.xmind`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            a.remove();
        } catch (err) {
            console.error("Ошибка при генерации XMind файла:", err);
            alert("Не удалось сгенерировать XMind файл: " + err.message);
        } finally {
            setIsGeneratingXmind(false);
        }
    };


    const [editorWidth, setEditorWidth] = useState(800);
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
        
        // Если идет генерация, минимизируем вместо закрытия
        if (modelGenerationStatus === 'processing') {
            setModelIsMinimized(true);
        } else {
            // Убираем подтверждение, так как данные сохраняются в БД
            onClose();
        }
    };

    const handleMinimize = () => {
        setModelIsMinimized(true);
    };

    const handleRestore = () => {
        setModelIsMinimized(false);
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

    // Загрузка доступных моделей Cloud.ru
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const { data } = await axios.get(`${config.serverUrl}/cloudru-models`);
                if (data.models && data.models.length > 0) {
                    setAvailableModels(data.models);
                    setSelectedModel(data.models[0]); // По умолчанию первая модель
                }
            } catch (error) {
                console.warn('Не удалось загрузить список моделей:', error);
            }
        };
        fetchModels();
    }, []);

    useEffect(() => {
        if (availableModels.length === 0) return;

        let cancelled = false;

        const restoreSelectedModel = async () => {
            const savedModel = await idbGet('selectedCloudRuModel').catch(() => null);
            if (!cancelled && savedModel && availableModels.includes(savedModel)) {
                setSelectedModel(savedModel);
            }
        };

        restoreSelectedModel();
        return () => {
            cancelled = true;
        };
    }, [availableModels]);

    useEffect(() => {
        if (!selectedModel) return;
        idbSet('selectedCloudRuModel', selectedModel).catch(console.warn);
    }, [selectedModel]);


    // --- Core Logic (with minor refactoring for clarity) ---
    const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

    /**
     * Рекурсивно оборачивает исходный JSON в нужные поля и расставляет id/isExpanded.
     * @param {Array} items  — массив из фич или историй или сценариев в зависимости от depth
     * @param {number} depth — 1=features, 2=stories, 3=scenarios, 4=codes
     */
    const buildTreeWithIds = useCallback((items, depth = 1) => {
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
    }, []);

    // ✅ Функция для преобразования treeData обратно в формат модели (удаляет служебные поля)
    const convertTreeToModel = (treeData) => {
        return (treeData || []).map(feature => {
            const modelFeature = {
                id: feature.id,
                text: feature.text,
                ...(feature.stories && feature.stories.length > 0 ? {
                    stories: feature.stories.map(story => {
                        const modelStory = {
                            id: story.id,
                            text: story.text,
                            ...(story.scenarios && story.scenarios.length > 0 ? {
                                scenarios: story.scenarios.map(scenario => {
                                    const modelScenario = {
                                        id: scenario.id,
                                        text: scenario.text,
                                        ...(scenario.codes && scenario.codes.length > 0 ? {
                                            codes: scenario.codes.map(code => {
                                                const modelCode = {
                                                    id: code.id,
                                                    text: code.text,
                                                    ...(code.type ? { type: code.type } : {})
                                                };
                                                // Удаляем служебные поля
                                                delete modelCode.isExpanded;
                                                return modelCode;
                                            })
                                        } : {})
                                    };
                                    // Удаляем служебные поля
                                    delete modelScenario.isExpanded;
                                    return modelScenario;
                                })
                            } : {})
                        };
                        // Удаляем служебные поля
                        delete modelStory.isExpanded;
                        return modelStory;
                    })
                } : {})
            };
            // Удаляем служебные поля
            delete modelFeature.isExpanded;
            return modelFeature;
        });
    };

    useEffect(() => {
        if (!isOpen) { setIsLoading(true); return; }
        if (modelGenerationStatus === 'processing') { return; }

        // Загружаем сохраненные данные из IndexedDB при открытии модального окна
        const loadSavedData = async () => {
            try {
                const [savedTree, savedModel] = await Promise.all([
                    idbGetModelValue('testModelTree'),
                    idbGetModelValue('generatedTestModel')
                ]);
                
                if (savedTree && savedTree.length > 0) {
                    // Если есть сохраненные данные, используем их
                    console.log('TestModelGeneratorModal: ⚠️ Загружены СТАРЫЕ данные из IndexedDB! Это может быть причиной кеширования!');
                    console.log('TestModelGeneratorModal: savedTree features:', savedTree.length);
                    console.log('TestModelGeneratorModal: savedModel:', savedModel ? 'есть' : 'нет');
                    setTreeData(savedTree);
                    setModelDataSource('local_cache');
                    if (savedModel) {
                        setLocalGeneratedModel(savedModel);
                        setModelGenerationStatus('completed'); // Устанавливаем статус как завершенный
                    }
                } else {
                    // Иначе используем initialCases
        const dataToBuild = (initialCases && initialCases.length > 0) ? initialCases : [];
        const builtTree = buildTreeWithIds(dataToBuild);
        setTreeData(builtTree);
        setModelDataSource('current_task');
        idbSetModelValue('testModelTree', builtTree).catch(console.warn);
                }
            } catch (error) {
                console.warn('Ошибка загрузки сохраненных данных:', error);
                // Fallback к initialCases
                const dataToBuild = (initialCases && initialCases.length > 0) ? initialCases : [];
                const builtTree = buildTreeWithIds(dataToBuild);
                setTreeData(builtTree);
                setModelDataSource('current_task');
                idbSetModelValue('testModelTree', builtTree).catch(console.warn);
            }
        setIsLoading(false);
        };

        loadSavedData();
    }, [buildTreeWithIds, idbGetModelValue, idbSetModelValue, initialCases, isOpen, modelGenerationStatus, setModelGenerationStatus, storagePageScope, storageTaskScope]);


    useEffect(() => {
        if (!isOpen || isLoading || isGeneratingModel || modelGenerationStatus === 'processing') {
            return;
        }

        idbSetModelValue('testModelTree', treeData).catch(console.warn);
    }, [treeData, isOpen, isLoading, isGeneratingModel, modelGenerationStatus, idbSetModelValue]);

    // Обработка завершения генерации тестовой модели
    useEffect(() => {
        if (modelGenerationStatus === 'completed' && generatedModel) {
            // Преобразуем сгенерированную модель в treeData
            const newTree = buildTreeWithIds(generatedModel);
            setTreeData(newTree);
            setLocalGeneratedModel(generatedModel);
            setModelDataSource('current_task');
            
            // Сохраняем v1 в историю при первой генерации
            if (modelVersion === 1 && modelHistory.length === 0) {
                const v1Snapshot = {
                    version: 1,
                    model: generatedModel,
                    timestamp: new Date().toISOString(),
                    comment: 'Первичная генерация'
                };
                setModelHistory([v1Snapshot]);
                idbSetModelValue('modelHistory', [v1Snapshot]).catch(console.warn);
            }
            
            // Сохраняем в IndexedDB
            idbSetModelValue('generatedTestModel', generatedModel).catch(console.warn);
            idbSetModelValue('testModelTree', newTree).catch(console.warn);
            console.log('Тестовая модель загружена в редактор');
        }
    }, [buildTreeWithIds, generatedModel, idbSetModelValue, modelGenerationStatus, modelHistory.length, modelVersion]);

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
        trackEvent('generate_test_model_modal', { page: '/solution' });
        setIsGeneratingModel(true);
        setLocalGeneratedModel(null);
        // Очищаем предыдущие результаты при новой генерации
        setModelGenerationStatus(null);
        setModelGenerationProgress(0);
        // ✅ Очищаем treeData и IndexedDB, чтобы не использовать старые данные
        setTreeData([]);
        setModelDataSource('current_task');
        idbSetModelValueForScope('generatedTestModel', 'latest', null).catch(console.warn);
        idbSet('modelGenerationProgress', 0).catch(console.warn);
        idbSetModelValueForScope('testModelTree', 'latest', null).catch(console.warn); // ✅ Очищаем старый treeData
        idbSetModelValueForScope('modelHistory', 'latest', []).catch(console.warn);
        console.log('TestModelGeneratorModal: ✅ Очищены все данные перед новой генерацией модели');
        
        // Сбрасываем версию и историю при новой генерации
        setModelVersion(1);
        setModelHistory([]);
        setModelDiff(null);
        setShowDiffView(false);
        
        // Запрашиваем разрешение на уведомления
        if (window.Notification && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
        try {
            // Используем переданные данные вместо чтения из IndexedDB
            const payload = buildRequirementsPayload({ includeRequirements: true });
            
            // Добавляем выбранную модель в payload
            if (selectedModel) {
                payload.models = [selectedModel];
            }

            // Сначала пробуем асинхронный API
            try {
                const { data } = await axios.post(
                    `${config.serverUrl}/generate-test-model-async`,
                    payload
                );
                
                setModelGenerationTaskId(data.taskId);
                setModelGenerationProgress(0);
                setModelGenerationStatus('processing');
                checkModelGenerationStatus(data.taskId);
                return;
            } catch (asyncErr) {
                console.warn('Async API failed, falling back to sync:', asyncErr);
                // Fallback к синхронному API
            }

            // Fallback к старому синхронному API
            const { data } = await axios.post(
                `${config.serverUrl}/generate-test-model`,
                payload
            );

            const newTree = buildTreeWithIds(data);
            setTreeData(newTree);

            setLocalGeneratedModel(data);
            setModelDataSource('current_task');
            
            // Сохраняем v1 в историю
            const v1Snapshot = {
                version: 1,
                model: data,
                timestamp: new Date().toISOString(),
                comment: 'Первичная генерация'
            };
            setModelHistory([v1Snapshot]);
            idbSetModelValue('generatedTestModel', data).catch(console.warn);
            idbSetModelValue('testModelTree', newTree).catch(console.warn);
            idbSetModelValue('modelHistory', [v1Snapshot]).catch(console.warn);

        } catch (error) {
            console.error('Ошибка при генерации тестовой модели:', error);
            alert('Не удалось сгенерировать модель: ' + (error.response?.data?.error || error.message));
            setLocalGeneratedModel(null);
        } finally {
            setIsGeneratingModel(false);
        }
    };

    // Обработчик доработки модели
    const handleRefineModel = async () => {
        trackEvent('refine_test_model', { page: '/solution' });
        if (!localGeneratedModel || localGeneratedModel.length === 0) {
            alert('Сначала сгенерируйте модель');
            return;
        }

        // Комментарий опционален, но желателен
        if (!reviewComment.trim()) {
            if (!window.confirm('Комментарий ревьюера не указан. Продолжить доработку без конкретных замечаний?')) {
                return;
            }
        }

        setIsGeneratingModel(true);
        setModelGenerationStatus('processing');
        setModelGenerationProgress(0);

        try {
            const currentModel = convertTreeToModel(treeData);
            const oldModel = localGeneratedModel || currentModel;
            
            // Сохраняем baseline метрики
            const baselineMetrics = calculateBaselineMetrics(oldModel);
            
            // Парсим комментарий на список проблем (issues)
            const issues = reviewComment.trim()
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const requirementsPayload = buildRequirementsPayload({ includeRequirements: true });
            const payload = {
                ...requirementsPayload,
                oldModel: oldModel,
                reviewNotes: reviewComment.trim() || '',
                issues: issues,
                baselineMetrics: baselineMetrics,
                requirements: requirementsPayload.requirements || '',
                ...(selectedModel ? { models: [selectedModel] } : {})
            };

            console.log('TestModelGeneratorModal: selectedModel for refine:', selectedModel || '(default from config)');

            const { data } = await axios.post(
                `${config.serverUrl}/refine-test-model`,
                payload
            );

            // Валидация результата
            const validation = validateRefinedModel(oldModel, data.refinedModel, issues);
            
            if (!validation.isValid) {
                const criticalErrors = validation.errors.filter(e => e.type === 'critical');
                if (criticalErrors.length > 0) {
                    alert(`❌ Критические ошибки валидации:\n${criticalErrors.map(e => e.message).join('\n')}\n\nМодель не была обновлена.`);
                    setIsGeneratingModel(false);
                    setModelGenerationStatus(null);
                    return;
                }
            }

            // Вычисляем diff
            const diff = calculateModelDiff(oldModel, data.refinedModel);
            setModelDiff(diff);

            // Обновляем модель
            const newTree = buildTreeWithIds(data.refinedModel);
            setTreeData(newTree);
            setLocalGeneratedModel(data.refinedModel);
            setModelDataSource('current_task');

            // Сохраняем v2 в историю
            const v2Snapshot = {
                version: modelVersion + 1,
                model: data.refinedModel,
                timestamp: new Date().toISOString(),
                comment: reviewComment.trim() || 'Доработка модели',
                diff: diff,
                validation: validation
            };
            setModelHistory(prev => [...prev, v2Snapshot]);
            setModelVersion(modelVersion + 1);
            
            // Сохраняем в IndexedDB
            idbSetModelValue('generatedTestModel', data.refinedModel).catch(console.warn);
            idbSetModelValue('testModelTree', newTree).catch(console.warn);
            idbSetModelValue('modelHistory', [...modelHistory, v2Snapshot]).catch(console.warn);

            // Показываем предупреждения, если есть
            const warnings = validation.errors.filter(e => e.type === 'warning');
            if (warnings.length > 0) {
                console.warn('Предупреждения валидации:', warnings);
            }

            // Показываем diff view
            setShowDiffView(true);
            setReviewComment(''); // Очищаем комментарий

            alert(`✅ Модель доработана!\n\nДобавлено: ${diff.added.features.length} Feature, ${diff.added.stories.length} Story, ${diff.added.scenarios.length} Scenario\nИзменено: ${diff.modified.features.length} Feature, ${diff.modified.stories.length} Story, ${diff.modified.scenarios.length} Scenario`);

        } catch (error) {
            console.error('Ошибка при доработке модели:', error);
            alert('Не удалось доработать модель: ' + (error.response?.data?.error || error.message));
        } finally {
            setIsGeneratingModel(false);
            setModelGenerationStatus(null);
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

    // ✅ State для чекбокса "С интеграционными бекенд тестами"
    const [includeBackendTests, setIncludeBackendTests] = useState(true); // По умолчанию включено

    // Функция для вычисления baseline метрик модели
    const calculateBaselineMetrics = (model) => {
        if (!Array.isArray(model) || model.length === 0) {
            return {
                featuresCount: 0,
                storiesCount: 0,
                scenariosCount: 0,
                codesCount: 0,
                featureIds: [],
                storyIds: [],
                scenarioIds: [],
                codeIds: [],
                codeTexts: []
            };
        }

        const featureIds = [];
        const storyIds = [];
        const scenarioIds = [];
        const codeIds = [];
        const codeTexts = [];

        model.forEach(feature => {
            if (feature.id) featureIds.push(feature.id);
            (feature.stories || []).forEach(story => {
                if (story.id) storyIds.push(story.id);
                (story.scenarios || []).forEach(scenario => {
                    if (scenario.id) scenarioIds.push(scenario.id);
                    (scenario.codes || []).forEach(code => {
                        if (code.id) codeIds.push(code.id);
                        if (code.text) codeTexts.push(code.text);
                    });
                });
            });
        });

        return {
            featuresCount: featureIds.length,
            storiesCount: storyIds.length,
            scenariosCount: scenarioIds.length,
            codesCount: codeIds.length,
            featureIds,
            storyIds,
            scenarioIds,
            codeIds,
            codeTexts
        };
    };

    // Функция для вычисления diff между двумя версиями модели
    const calculateModelDiff = (oldModel, newModel) => {
        const oldMetrics = calculateBaselineMetrics(oldModel);
        const newMetrics = calculateBaselineMetrics(newModel);

        const diff = {
            added: {
                features: [],
                stories: [],
                scenarios: [],
                codes: []
            },
            removed: {
                features: [],
                stories: [],
                scenarios: [],
                codes: []
            },
            modified: {
                features: [],
                stories: [],
                scenarios: [],
                codes: []
            },
            metrics: {
                old: oldMetrics,
                new: newMetrics
            }
        };

        // Находим удаленные и измененные элементы
        const findInModel = (model, id, type) => {
            for (const feature of model || []) {
                if (type === 'feature' && feature.id === id) return feature;
                for (const story of feature.stories || []) {
                    if (type === 'story' && story.id === id) return story;
                    for (const scenario of story.scenarios || []) {
                        if (type === 'scenario' && scenario.id === id) return scenario;
                        for (const code of scenario.codes || []) {
                            if (type === 'code' && code.id === id) return code;
                        }
                    }
                }
            }
            return null;
        };

        // Проверяем features
        oldMetrics.featureIds.forEach(id => {
            const oldFeature = findInModel(oldModel, id, 'feature');
            const newFeature = findInModel(newModel, id, 'feature');
            if (!newFeature) {
                diff.removed.features.push({ id, text: oldFeature?.text });
            } else if (oldFeature?.text !== newFeature?.text) {
                diff.modified.features.push({ id, old: oldFeature?.text, new: newFeature?.text });
            }
        });

        // Проверяем stories
        oldMetrics.storyIds.forEach(id => {
            const oldStory = findInModel(oldModel, id, 'story');
            const newStory = findInModel(newModel, id, 'story');
            if (!newStory) {
                diff.removed.stories.push({ id, text: oldStory?.text });
            } else if (oldStory?.text !== newStory?.text) {
                diff.modified.stories.push({ id, old: oldStory?.text, new: newStory?.text });
            }
        });

        // Проверяем scenarios
        oldMetrics.scenarioIds.forEach(id => {
            const oldScenario = findInModel(oldModel, id, 'scenario');
            const newScenario = findInModel(newModel, id, 'scenario');
            if (!newScenario) {
                diff.removed.scenarios.push({ id, text: oldScenario?.text });
            } else if (oldScenario?.text !== newScenario?.text) {
                diff.modified.scenarios.push({ id, old: oldScenario?.text, new: newScenario?.text });
            }
        });

        // Проверяем codes
        oldMetrics.codeIds.forEach(id => {
            const oldCode = findInModel(oldModel, id, 'code');
            const newCode = findInModel(newModel, id, 'code');
            if (!newCode) {
                diff.removed.codes.push({ id, text: oldCode?.text });
            } else if (oldCode?.text !== newCode?.text || oldCode?.type !== newCode?.type) {
                diff.modified.codes.push({ 
                    id, 
                    old: { text: oldCode?.text, type: oldCode?.type },
                    new: { text: newCode?.text, type: newCode?.type }
                });
            }
        });

        // Находим добавленные элементы
        newMetrics.featureIds.forEach(id => {
            if (!oldMetrics.featureIds.includes(id)) {
                const feature = findInModel(newModel, id, 'feature');
                diff.added.features.push({ id, text: feature?.text });
            }
        });

        newMetrics.storyIds.forEach(id => {
            if (!oldMetrics.storyIds.includes(id)) {
                const story = findInModel(newModel, id, 'story');
                diff.added.stories.push({ id, text: story?.text });
            }
        });

        newMetrics.scenarioIds.forEach(id => {
            if (!oldMetrics.scenarioIds.includes(id)) {
                const scenario = findInModel(newModel, id, 'scenario');
                diff.added.scenarios.push({ id, text: scenario?.text });
            }
        });

        newMetrics.codeIds.forEach(id => {
            if (!oldMetrics.codeIds.includes(id)) {
                const code = findInModel(newModel, id, 'code');
                diff.added.codes.push({ id, text: code?.text, type: code?.type });
            }
        });

        return diff;
    };

    // Функция валидации модели после правок
    const validateRefinedModel = (oldModel, newModel, issues = []) => {
        const oldMetrics = calculateBaselineMetrics(oldModel);
        const newMetrics = calculateBaselineMetrics(newModel);
        const diff = calculateModelDiff(oldModel, newModel);

        const validationErrors = [];

        // Проверка: критические элементы не должны исчезнуть без причины
        if (diff.removed.features.length > 0 && issues.length === 0) {
            validationErrors.push({
                type: 'critical',
                message: `Удалены Feature без указания причины: ${diff.removed.features.map(f => f.text).join(', ')}`
            });
        }

        if (diff.removed.stories.length > 3) {
            validationErrors.push({
                type: 'warning',
                message: `Удалено слишком много Story (${diff.removed.stories.length}). Возможно, это ошибка.`
            });
        }

        // Проверка: новая модель должна быть валидной структурно
        if (newMetrics.featuresCount === 0) {
            validationErrors.push({
                type: 'critical',
                message: 'Модель не содержит ни одной Feature'
            });
        }

        // Проверка покрытия: если были проблемы со статусами, они должны быть исправлены
        const statusIssues = issues.filter(i => i.includes('статус') || i.includes('status') || i.includes('polling'));
        if (statusIssues.length > 0 && newMetrics.scenariosCount < oldMetrics.scenariosCount) {
            validationErrors.push({
                type: 'warning',
                message: 'Количество Scenario уменьшилось, но были проблемы со статусами. Проверьте, что они исправлены.'
            });
        }

        return {
            isValid: validationErrors.filter(e => e.type === 'critical').length === 0,
            errors: validationErrors,
            diff,
            metrics: {
                old: oldMetrics,
                new: newMetrics
            }
        };
    };

    const handleSubmitForCases = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isGeneratingCases || isGeneratingModel || isGeneratingXmind) return;

        trackEvent('to_test_cases', { page: '/solution', extra: { featuresCount: convertTreeToModel(treeData)?.length, includeBackendTests } });

        try {
            if (typeof onGenerate === 'function') {
                // ✅ Преобразуем treeData обратно в формат модели (удаляем служебные поля id, isExpanded)
                const modelStructure = convertTreeToModel(treeData);
                
                console.log('TestModelGeneratorModal: передаем отредактированную структуру в генерацию тест-кейсов');
                console.log('TestModelGeneratorModal: treeData (с служебными полями):', treeData);
                console.log('TestModelGeneratorModal: modelStructure (без служебных полей):', modelStructure);
                console.log('TestModelGeneratorModal: количество Features:', modelStructure.length);
                console.log('TestModelGeneratorModal: includeBackendTests:', includeBackendTests);
                console.log('TestModelGeneratorModal: selectedModel for test cases:', selectedModel);
                
                // ✅ Передаем преобразованную модель и флаг includeBackendTests
                onGenerate(modelStructure, includeBackendTests, selectedModel);
                onClose(); // Закрываем модалку сразу
            } else {
                console.error("onGenerate prop is not a function!");
            }
        } catch (error) {
            console.error("Ошибка во время генерации тест-кейсов:", error);
            window.alert('Ошибка при генерации тест-кейсов: ' + (error.message || 'Неизвестная ошибка'));
        }
    };

    // Show a simple loading state until initial data is processed
    if (isLoading && isOpen) {
        return (
            <Modal isOpen={true} onRequestClose={handleCloseWithConfirm} overlayClassName="modal-overlay" className="modal-content">
                <LoaderOverlay text="Загрузка редактора..." />
            </Modal>
        );
    }

    // Обновленная логика для определения состояния "занят"
    const isBusy = isGeneratingModel || isGeneratingXmind;

    // Исправленный текст лоадера
    const getLoaderText = () => {
        if (isGeneratingModel) {
            if (modelGenerationStatus === 'processing') {
                return `Генерация тестовой модели... ${modelGenerationProgress}%`;
            }
            return "Генерация тестовой модели...";
        }
        if (isGeneratingXmind) return "Генерация Xmind карты...";
        return "Загрузка...";
    };

    return (
        <>
        <Modal isOpen={isOpen && !modelIsMinimized} onRequestClose={isBusy ? () => { } : handleCloseWithConfirm} overlayClassName="modal-overlay" className="modal-content">
            <StyleInjector />
            {isBusy && <LoaderOverlay text={getLoaderText()} />}

                    {modelGenerationStatus === 'processing' && (
                        <div style={{ 
                            position: 'absolute', 
                            top: '70px', 
                            left: '20px', 
                            right: '20px', 
                            zIndex: 1002,
                            backgroundColor: 'rgba(13, 17, 23, 0.95)', 
                            border: '1px solid #30363d', 
                            borderRadius: 12, 
                            padding: 20,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                            backdropFilter: 'blur(10px)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{
                                        width: 12,
                                        height: 12,
                                        backgroundColor: '#58a6ff',
                                        borderRadius: '50%',
                                        animation: 'pulse 1.5s infinite'
                                    }} />
                                    <h4 style={{ margin: 0, color: '#c9d1d9', fontSize: 16, fontWeight: 600 }}>Генерация тестовой модели</h4>
                                </div>
                                <span style={{ fontSize: 14, fontWeight: 'bold', color: '#58a6ff' }}>{modelGenerationProgress}%</span>
                            </div>
                            
                            <div style={{ 
                                fontSize: 14, 
                                color: '#8b949e', 
                                lineHeight: 1.5,
                                marginBottom: 16
                            }}>
                                Генерация выполняется в фоновом режиме. Вы можете закрыть это окно и продолжить работу. 
                                Результат будет сохранен автоматически.
                            </div>
                            
                            {/* Анимированный прогресс-бар */}
                            <div style={{ 
                                marginBottom: 16,
                                backgroundColor: '#21262d',
                                borderRadius: 8,
                                height: 8,
                                overflow: 'hidden',
                                position: 'relative'
                            }}>
                                <div style={{
                                    width: `${modelGenerationProgress}%`,
                                    height: '100%',
                                    background: 'linear-gradient(90deg, #58a6ff 0%, #79c0ff 50%, #58a6ff 100%)',
                                    backgroundSize: '200px 100%',
                                    animation: 'shimmer 2s infinite linear',
                                    borderRadius: 8,
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                            
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                                <button 
                                    onClick={handleMinimize}
                                    style={{
                                        background: 'none',
                                        border: '1px solid #30363d',
                                        color: '#8b949e',
                                        borderRadius: 6,
                                        padding: '8px 16px',
                                        cursor: 'pointer',
                                        fontSize: 14,
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.borderColor = '#58a6ff';
                                        e.target.style.color = '#58a6ff';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.borderColor = '#30363d';
                                        e.target.style.color = '#8b949e';
                                    }}
                                >
                                    Свернуть
                                </button>
                            </div>
                        </div>
                    )}

            <div className="modal-header">
                <h2>Редактор тестовой модели {modelVersion > 1 && <span style={{ fontSize: '0.8em', color: 'var(--text-secondary)' }}>(v{modelVersion})</span>}</h2>
                <div className="header-actions">
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginRight: '12px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <label style={{ fontSize: '0.9em', color: 'var(--text-secondary)', marginRight: '8px' }}>
                                Модель:
                            </label>
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                disabled={isBusy || modelGenerationStatus === 'processing' || availableModels.length === 0}
                                style={{
                                    background: 'var(--bg-content)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)',
                                    borderRadius: '4px',
                                    padding: '6px 12px',
                                    fontSize: '0.85em',
                                    cursor: (isBusy || modelGenerationStatus === 'processing' || availableModels.length === 0) ? 'default' : 'pointer',
                                    maxWidth: '220px'
                                }}
                            >
                                {availableModels.map(model => (
                                    <option key={model} value={model}>{model}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <label style={{ fontSize: '0.9em', color: 'var(--text-secondary)', marginRight: '8px' }}>
                                Режим:
                            </label>
                            <select
                                value={generationMode}
                                onChange={(e) => setGenerationMode(e.target.value)}
                                disabled={isBusy || modelGenerationStatus === 'processing'}
                                style={{
                                    background: 'var(--bg-content)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)',
                                    borderRadius: '4px',
                                    padding: '6px 12px',
                                    fontSize: '0.9em',
                                    cursor: (isBusy || modelGenerationStatus === 'processing') ? 'default' : 'pointer'
                                }}
                            >
                                <option value="create">Создать с нуля</option>
                                <option value="refine" disabled={!localGeneratedModel || localGeneratedModel.length === 0}>Доработать текущую</option>
                            </select>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="button-base button-accent"
                        onClick={generationMode === 'create' ? handleGenerateModel : handleRefineModel}
                        disabled={isBusy || modelGenerationStatus === 'processing' || (generationMode === 'refine' && (!localGeneratedModel || localGeneratedModel.length === 0))}
                        style={{
                            opacity: (isBusy || modelGenerationStatus === 'processing' || (generationMode === 'refine' && (!localGeneratedModel || localGeneratedModel.length === 0))) ? 0.6 : 1,
                            cursor: (isBusy || modelGenerationStatus === 'processing' || (generationMode === 'refine' && (!localGeneratedModel || localGeneratedModel.length === 0))) ? 'default' : 'pointer'
                        }}
                    >
                        {modelGenerationStatus === 'processing' 
                            ? `${generationMode === 'create' ? 'Генерация' : 'Доработка'}... ${modelGenerationProgress}%` 
                            : generationMode === 'create' 
                                ? 'Сгенерировать модель по требованиям'
                                : 'Доработать модель'}
                    </button>
                    {modelDiff && (
                        <button
                            type="button"
                            className="button-base button-secondary"
                            onClick={() => setShowDiffView(!showDiffView)}
                            disabled={isBusy}
                        >
                            {showDiffView ? 'Скрыть изменения' : 'Показать изменения'}
                        </button>
                    )}
                    <button
                        type="button"
                        className="button-base button-secondary"
                        onClick={handleGenerateXmind}
                        disabled={isBusy}
                    >
                        Сгенерировать Xmind
                    </button>
                </div>
                <div className="header-controls">
                    {modelGenerationStatus === 'processing' && (
                        <button 
                            className="minimize-btn" 
                            onClick={handleMinimize} 
                            title="Свернуть в фоновый режим"
                        >
                            −
                        </button>
                    )}
                <button className="close-btn" onClick={handleCloseWithConfirm} disabled={isBusy}>×</button>
                </div>
            </div>

            <div className="modal-main-split">
                <div ref={editorPaneRef} className="editor-pane" style={{ width: `${editorWidth}px` }}>
                    <DragDropContext onDragEnd={onDragEnd}>
                        <form onSubmit={handleSubmitForCases} className="modal-form">
                            {generationMode === 'refine' && (
                                <div style={{ 
                                    padding: '12px 16px', 
                                    borderBottom: '1px solid var(--border-primary)',
                                    backgroundColor: 'var(--bg-tertiary)'
                                }}>
                                    <label style={{ 
                                        display: 'block', 
                                        marginBottom: '8px', 
                                        fontSize: '0.9em', 
                                        color: 'var(--text-secondary)',
                                        fontWeight: 600
                                    }}>
                                        Комментарий ревьюера (опционально):
                                    </label>
                                    <textarea
                                        value={reviewComment}
                                        onChange={(e) => setReviewComment(e.target.value)}
                                        placeholder="Например: слишком толстые Story, нет сценариев по статусам, убрать дубли Code по методам статуса..."
                                        disabled={isBusy || modelGenerationStatus === 'processing'}
                                        style={{
                                            width: '100%',
                                            minHeight: '80px',
                                            padding: '8px',
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-primary)',
                                            borderRadius: '4px',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.9em',
                                            fontFamily: 'inherit',
                                            resize: 'vertical'
                                        }}
                                    />
                                    <div style={{ 
                                        marginTop: '8px', 
                                        fontSize: '0.85em', 
                                        color: 'var(--text-secondary)',
                                        fontStyle: 'italic'
                                    }}>
                                        Укажите конкретные проблемы для более точной доработки
                                    </div>
                                </div>
                            )}
                            {showDiffView && modelDiff && (
                                <div style={{ 
                                    padding: '12px 16px', 
                                    borderBottom: '1px solid var(--border-primary)',
                                    backgroundColor: 'var(--bg-tertiary)',
                                    maxHeight: '300px',
                                    overflowY: 'auto'
                                }}>
                                    <h4 style={{ margin: '0 0 12px 0', fontSize: '1em', color: 'var(--text-primary)' }}>
                                        Изменения модели (v{modelVersion - 1} → v{modelVersion})
                                    </h4>
                                    <ModelDiffView diff={modelDiff} />
                                </div>
                            )}
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
                                <div className="backend-tests-checkbox">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={includeBackendTests}
                                            onChange={(e) => setIncludeBackendTests(e.target.checked)}
                                            disabled={isBusy || modelGenerationStatus === 'processing'}
                                        />
                                        <span>С интеграционными бекенд тестами</span>
                                    </label>
                                </div>
                                <button type="button" className="button-base button-secondary" onClick={handleCloseWithConfirm} disabled={isBusy}>
                                    Отмена
                                </button>
                                <button
                                    type="submit"
                                    className="button-base button-primary"
                                    disabled={isBusy || modelGenerationStatus === 'processing' || countAllNodes(treeData) === 0}
                                >
                                    Далее к тесткейсам
                                </button>
                            </div>
                        </form>
                    </DragDropContext>
                </div>

                <div className={`resizer ${isResizing ? 'is-resizing' : ''}`} onMouseDown={handleMouseDown}></div>

                <div className="visualizer-pane">
                    {treeData && treeData.length > 0 ? (
                        <ReadableTreeVisualizer treeData={treeData} modelSource={modelDataSource} />
                    ) : (
                        <div style={{ padding: 20, color: 'var(--text-secondary)', textAlign: 'center' }}>
                            Нет данных для отображения диаграммы
                        </div>
                    )}
                </div>
            </div>
        </Modal>

        {/* Уведомление в фоновом режиме */}
        {modelIsMinimized && modelGenerationStatus === 'processing' && (
            <div style={{
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: 1001,
                backgroundColor: 'rgba(13, 17, 23, 0.95)',
                border: '1px solid #30363d',
                borderRadius: 12,
                padding: 16,
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                backdropFilter: 'blur(10px)',
                minWidth: 320,
                maxWidth: 400,
                animation: 'slideInRight 0.3s ease-out'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                            width: 8,
                            height: 8,
                            backgroundColor: '#58a6ff',
                            borderRadius: '50%',
                            animation: 'pulse 1.5s infinite'
                        }} />
                        <h4 style={{ margin: 0, color: '#c9d1d9', fontSize: 14, fontWeight: 600 }}>Генерация тестовой модели</h4>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 'bold', color: '#58a6ff' }}>{modelGenerationProgress}%</span>
                </div>
                
                <div style={{ marginBottom: 12 }}>
                    <div style={{ 
                        width: '100%', 
                        height: 6, 
                        backgroundColor: '#21262d', 
                        borderRadius: 3, 
                        overflow: 'hidden',
                        position: 'relative'
                    }}>
                        <div style={{ 
                            width: `${modelGenerationProgress}%`, 
                            height: '100%', 
                            backgroundColor: '#58a6ff', 
                            transition: 'width 0.5s ease',
                            borderRadius: 3,
                            position: 'relative'
                        }}>
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                                animation: 'shimmer 2s infinite'
                            }} />
                        </div>
                    </div>
                </div>
                
                <div style={{ 
                    fontSize: 12, 
                    color: '#8b949e',
                    marginBottom: 12,
                    lineHeight: 1.4
                }}>
                    Выполняется в фоновом режиме
                </div>
                
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button 
                        onClick={handleRestore}
                        style={{
                            background: 'none',
                            border: '1px solid #30363d',
                            color: '#8b949e',
                            borderRadius: 6,
                            padding: '6px 12px',
                            cursor: 'pointer',
                            fontSize: 12,
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.borderColor = '#58a6ff';
                            e.target.style.color = '#58a6ff';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.borderColor = '#30363d';
                            e.target.style.color = '#8b949e';
                        }}
                    >
                        Открыть
                    </button>
                </div>
            </div>
        )}
        </>
    );
}
