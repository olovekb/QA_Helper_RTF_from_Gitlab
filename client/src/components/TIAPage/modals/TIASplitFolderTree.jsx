import React from 'react';
import { Draggable } from 'react-beautiful-dnd';
import { useTIA } from '../context/TIAContext';
import { formatCustomFieldName } from '../utils/tiaUtils';

/**
 * Рекурсивное отображение дерева папок для модального окна разделения
 */
const TIASplitFolderTree = ({ folders, level = 0, unassignedIds = [] }) => {
    const { expandedFolders, setExpandedFolders } = useTIA();

    if (!folders) return null;

    /**
     * Проверяет, нужно ли отображать узел
     */
    const isRelevant = (node) => {
        if (unassignedIds.includes(node.id.toString())) return true;
        if (node.children && node.children.length > 0) {
            return node.children.some(child => isRelevant(child));
        }
        return false;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {folders.map((folder) => {
                if (!isRelevant(folder)) return null;

                const folderId = folder.id.toString();
                const isUnassigned = unassignedIds.includes(folderId);
                const isExpanded = !!expandedFolders[folder.id];
                const hasChildren = folder.children && folder.children.length > 0;

                const content = (provided, snapshot) => (
                    <div
                        ref={provided?.innerRef}
                        {...(provided?.draggableProps || {})}
                        {...(provided?.dragHandleProps || {})}
                        style={{
                            ...(provided?.draggableProps?.style || {}),
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px 12px',
                            backgroundColor: snapshot?.isDragging ? 'var(--primary-accent)' : 'var(--bg-content)',
                            color: snapshot?.isDragging ? '#fff' : 'var(--text-primary)',
                            borderRadius: '10px',
                            border: `1px solid ${snapshot?.isDragging ? 'transparent' : 'var(--border-color)'}`,
                            marginLeft: `${level * 12}px`,
                            fontSize: '14px',
                            fontWeight: hasChildren ? 600 : 400,
                            boxShadow: snapshot?.isDragging ? '0 10px 15px -3px rgba(0, 0, 0, 0.1)' : 'none',
                            transition: 'all 0.2s',
                            cursor: isUnassigned ? (snapshot?.isDragging ? 'grabbing' : 'grab') : 'default'
                        }}
                        onMouseEnter={(e) => {
                            if (!snapshot?.isDragging) {
                                e.currentTarget.style.backgroundColor = 'var(--bg-input)';
                                e.currentTarget.style.borderColor = 'var(--primary-accent)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!snapshot?.isDragging) {
                                e.currentTarget.style.backgroundColor = 'var(--bg-content)';
                                e.currentTarget.style.borderColor = 'var(--border-color)';
                            }
                        }}
                    >
                        {/* Стрелка раскрытия */}
                        {hasChildren ? (
                            <span
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedFolders(prev => ({ ...prev, [folder.id]: !prev[folder.id] }));
                                }}
                                style={{
                                    fontSize: '12px',
                                    color: '#94a3b8',
                                    width: '24px',
                                    height: '24px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s ease',
                                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                    marginRight: '6px',
                                    cursor: 'pointer',
                                    borderRadius: '6px'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                ▶
                            </span>
                        ) : <span style={{ width: '30px' }} />}

                        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {formatCustomFieldName(folder, level)}
                        </span>

                        {!snapshot?.isDragging && isUnassigned && (
                            <span style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                backgroundColor: '#f1f5f9',
                                color: '#64748b',
                                borderRadius: '4px',
                                marginLeft: '8px',
                                fontWeight: 700
                            }}>
                                READY
                            </span>
                        )}
                    </div>
                );

                return (
                    <div key={folder.id} style={{ marginBottom: '4px' }}>
                        {isUnassigned ? (
                            <Draggable draggableId={`folder-${folderId}`} index={unassignedIds.indexOf(folderId)}>
                                {(provided, snapshot) => content(provided, snapshot)}
                            </Draggable>
                        ) : content()}

                        {isExpanded && hasChildren && (
                            <div style={{ marginTop: '4px' }}>
                                <TIASplitFolderTree
                                    folders={folder.children}
                                    level={level + 1}
                                    unassignedIds={unassignedIds}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TIASplitFolderTree;
