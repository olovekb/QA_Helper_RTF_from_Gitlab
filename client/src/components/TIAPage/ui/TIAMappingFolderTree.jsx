import React from 'react';
import { useTIA } from '../context/TIAContext';
import { formatCustomFieldName } from '../utils/tiaUtils';

/**
 * Рекурсивное отображение дерева папок специально для модального окна маппинга.
 * @param {Object} props - Свойства компонента
 * @param {Array} props.folders - Узлы дерева
 * @param {number} [props.level=0] - Уровень вложенности
 * @param {string|number} [props.componentId] - ID текущего маппируемого компонента
 * @returns {JSX.Element}
 */
const TIAMappingFolderTree = ({ folders, level = 0, componentId = null }) => {
    const {
        expandedFolders,
        setExpandedFolders,
        selectedComponentId,
        componentMappings,
        setComponentMappings,
        autoMappedBlocks,
        folderSearchTerm,
        markComponentAsDirty
    } = useTIA();

    const targetComponentId = componentId || selectedComponentId;

    if (!folders || !targetComponentId) return null;

    /**
     * Рекурсивный сбор всех ID узла и его потомков
     */
    const getAllDescendantIds = (folder) => {
        const ids = [folder.id.toString()];
        if (folder.children && folder.children.length > 0) {
            folder.children.forEach(child => {
                ids.push(...getAllDescendantIds(child));
            });
        }
        return ids;
    };

    /**
     * Проверяет, выбраны ли все потомки
     */
    const areAllDescendantsSelected = (folder, mappings) => {
        const folderId = folder.id.toString();
        if (mappings.includes(folderId)) return true;
        if (!folder.children || folder.children.length === 0) {
            return mappings.includes(folderId);
        }
        return folder.children.every(child => areAllDescendantsSelected(child, mappings));
    };

    /**
     * Проверка видимости узла при поиске
     */
    const isNodeVisible = (node) => {
        if (!folderSearchTerm) return true;
        const normalizedSearch = folderSearchTerm.toLowerCase();
        const matchesName = node.name.toLowerCase().includes(normalizedSearch);
        const matchesCustomField = node.customFieldName && node.customFieldName.toLowerCase().includes(normalizedSearch);
        if (matchesName || matchesCustomField) return true;
        if (node.children) {
            return node.children.some(child => isNodeVisible(child));
        }
        return false;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {folders.map((folder) => {
                if (!isNodeVisible(folder)) return null;

                const isExpanded = !!expandedFolders[folder.id];
                const hasChildren = folder.children && folder.children.length > 0;
                const folderId = folder.id.toString();

                const currentSelected = componentMappings[targetComponentId] || [];
                const isDirectlySelected = currentSelected.includes(folderId);
                const isAutoMapped = (autoMappedBlocks[targetComponentId] || []).some(id => id.toString() === folderId);

                const allDescendantsIds = getAllDescendantIds(folder);
                const areAllSelected = allDescendantsIds.every(id => currentSelected.includes(id));

                const someDescendantsSelected = hasChildren &&
                    allDescendantsIds.some(id => currentSelected.includes(id) && id !== folderId);

                const isPartiallySelected = !isDirectlySelected && someDescendantsSelected;

                return (
                    <div key={folder.id} style={{ marginBottom: '2px' }}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '6px 10px',
                                backgroundColor: isDirectlySelected ? '#f5f3ff' : isPartiallySelected ? '#f8fafc' : '#ffffff',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                marginLeft: `${level * 16}px`,
                                border: `1px solid ${isDirectlySelected ? '#818cf8' : isPartiallySelected ? '#e2e8f0' : '#f1f5f9'}`,
                                boxShadow: isDirectlySelected ? '0 2px 8px rgba(99, 102, 241, 0.08)' : 'none',
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                const folderIdStr = folder.id.toString();
                                const currentMappings = componentMappings[targetComponentId] || [];

                                if (currentMappings.includes(folderIdStr)) {
                                    setComponentMappings(prev => ({
                                        ...prev,
                                        [targetComponentId]: currentMappings.filter(id => id !== folderIdStr)
                                    }));
                                } else {
                                    setComponentMappings(prev => ({
                                        ...prev,
                                        [targetComponentId]: [...currentMappings, folderIdStr]
                                    }));
                                }
                                markComponentAsDirty(targetComponentId);
                            }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (!targetComponentId) return;

                                const allIds = getAllDescendantIds(folder);
                                const currentMappings = componentMappings[targetComponentId] || [];
                                const areAllCurrentSelected = allIds.every(id => currentMappings.includes(id));

                                if (areAllCurrentSelected) {
                                    const newMappings = currentMappings.filter(id => !allIds.includes(id));
                                    setComponentMappings(prev => ({ ...prev, [targetComponentId]: newMappings }));
                                } else {
                                    const newMappingsSet = new Set([...currentMappings, ...allIds]);
                                    setComponentMappings(prev => ({ ...prev, [targetComponentId]: Array.from(newMappingsSet) }));
                                }
                                markComponentAsDirty(targetComponentId);
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = isDirectlySelected ? '#eff6ff' : '#f8fafc';
                                e.currentTarget.style.transform = 'translateX(2px)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = isDirectlySelected ? '#f5f3ff' : isPartiallySelected ? '#f8fafc' : '#ffffff';
                                e.currentTarget.style.transform = 'translateX(0)';
                            }}
                            title={folder.customFieldName || folder.name}
                        >
                            <div style={{
                                width: '18px',
                                height: '18px',
                                borderRadius: '5px',
                                border: `2px solid ${isDirectlySelected ? '#6366f1' : '#cbd5e1'}`,
                                backgroundColor: isDirectlySelected ? '#6366f1' : isPartiallySelected ? '#eef2ff' : '#fff',
                                marginRight: '10px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                flexShrink: 0
                            }}>
                                {isDirectlySelected && (
                                    <span style={{ color: '#fff', fontSize: '11px', fontWeight: 900 }}>✓</span>
                                )}
                                {!isDirectlySelected && isPartiallySelected && (
                                    <div style={{ width: '8px', height: '2px', backgroundColor: '#6366f1', borderRadius: '1px' }} />
                                )}
                            </div>

                            {hasChildren ? (
                                <span
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedFolders(prev => ({
                                            ...prev,
                                            [folder.id]: !prev[folder.id]
                                        }));
                                    }}
                                    style={{
                                        fontSize: '10px',
                                        color: isExpanded ? '#6366f1' : '#94a3b8',
                                        width: '24px',
                                        height: '24px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s',
                                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                        marginRight: '4px',
                                        cursor: 'pointer',
                                        borderRadius: '4px'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.08)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    ▶
                                </span>
                            ) : <span style={{ width: '28px' }} />}

                            <span style={{
                                fontSize: '13px',
                                fontWeight: hasChildren ? 700 : 500,
                                color: isDirectlySelected ? '#1e1b4b' : '#334155',
                                flex: 1,
                                userSelect: 'none',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {formatCustomFieldName(folder, level)}
                            </span>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {hasChildren && areAllSelected && !isDirectlySelected && (
                                    <span style={{
                                        color: '#059669',
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        backgroundColor: '#ecfdf5',
                                        padding: '2px 6px',
                                        borderRadius: '12px',
                                        textTransform: 'uppercase'
                                    }}>
                                        ALL
                                    </span>
                                )}

                                {isAutoMapped && (
                                    <span style={{
                                        fontSize: '9px',
                                        padding: '2px 6px',
                                        backgroundColor: '#e0e7ff',
                                        color: '#4338ca',
                                        borderRadius: '4px',
                                        fontWeight: 800,
                                        letterSpacing: '0.05em'
                                    }}>
                                        AUTO
                                    </span>
                                )}
                            </div>
                        </div>

                        {isExpanded && hasChildren && (
                            <div style={{ marginTop: '2px' }}>
                                <TIAMappingFolderTree
                                    folders={folder.children}
                                    level={level + 1}
                                    componentId={targetComponentId}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TIAMappingFolderTree;
