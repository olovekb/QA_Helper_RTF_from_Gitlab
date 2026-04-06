import { useTIA } from '../context/TIAContext';
import { formatCustomFieldName } from '../utils/tiaUtils';

/**
 * Рекурсивное отображение дерева папок для модального окна маппинга
 * @param {Object} props - Свойства компонента
 * @param {Array} props.folders - Узлы дерева
 * @param {number} [props.level=0] - Уровень вложенности
 * @returns {JSX.Element}
 */
const TIAMappingFolderTree = ({ folders: folderNodes, level = 0 }) => {
    const {
        expandedFolders,
        handleFolderToggle,
        selectedComponentId,
        componentMappings,
        setComponentMappings,
        autoMappedBlocks,
        folderSearchTerm
    } = useTIA();

    if (!folderNodes) return null;

    /**
     * Обработка выбора чекбокса
     * @param {Object} folder - Выбранный узел
     */
    const handleCheckboxChange = (folder) => {
        if (!selectedComponentId) return;
        const folderId = folder.id.toString();
        const currentSelected = componentMappings[selectedComponentId] || [];

        const isSelected = currentSelected.some(id => id.toString() === folderId);
        let newSelected;

        if (isSelected) {
            newSelected = currentSelected.filter(id => id.toString() !== folderId);
        } else {
            newSelected = [...currentSelected, folderId];
        }

        setComponentMappings(prev => ({
            ...prev,
            [selectedComponentId]: newSelected
        }));
    };

    /**
     * Проверка видимости узла при поиске
     * @param {Object} node - Узел дерева
     * @returns {boolean}
     */
    const isNodeVisible = (node) => {
        if (!folderSearchTerm) return true;
        const normalizedSearch = folderSearchTerm.toLowerCase();
        const matchesName = node.name.toLowerCase().includes(normalizedSearch);
        const matchesId = node.id.toString().includes(normalizedSearch);
        if (matchesName || matchesId) return true;
        if (node.children) {
            return node.children.some(child => isNodeVisible(child));
        }
        return false;
    };

    /**
     * Рендеринг отдельного узла дерева
     * @param {Object} folder - Узел
     * @returns {JSX.Element|null}
     */
    const renderNode = (folder) => {
        if (!isNodeVisible(folder)) return null;

        const isExpanded = expandedFolders[folder.id];
        const hasChildren = folder.children && folder.children.length > 0;
        const folderId = folder.id.toString();
        const isSelected = (componentMappings[selectedComponentId] || []).some(id => id.toString() === folderId);
        const isAutoMapped = (autoMappedBlocks[selectedComponentId] || []).some(id => id.toString() === folderId);

        return (
            <div key={folder.id} style={{ marginLeft: `${level * 20}px`, borderLeft: level > 0 ? '1px solid #e5e7eb' : 'none' }}>
                <div
                    style={{
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                        borderRadius: '8px',
                        transition: 'background-color 0.2s',
                        backgroundColor: isSelected ? '#f5f3ff' : 'transparent',
                        '&:hover': { backgroundColor: '#f9fafb' }
                    }}
                    onClick={() => handleFolderToggle(folder.id)}
                >
                    {hasChildren ? (
                        <span style={{ fontSize: '10px', color: '#9ca3af', width: '12px' }}>
                            {isExpanded ? '▼' : '▶'}
                        </span>
                    ) : <span style={{ width: '12px' }} />}

                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                            e.stopPropagation();
                            handleCheckboxChange(folder);
                        }}
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#6366f1' }}
                    />

                    <span style={{
                        fontSize: '14px',
                        color: isSelected ? '#4f46e5' : '#374151',
                        fontWeight: isSelected ? 600 : 400,
                        flex: 1
                    }}>
                        {formatCustomFieldName(folder, level)}
                    </span>

                    {isAutoMapped && (
                        <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#e0e7ff', color: '#4338ca', borderRadius: '4px', fontWeight: 600 }}>
                            AUTO
                        </span>
                    )}

                    <span style={{ fontSize: '11px', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                        ID: {folder.id}
                    </span>
                </div>

                {isExpanded && hasChildren && (
                    <TIAMappingFolderTree folders={folder.children} level={level + 1} />
                )}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {folderNodes.map(folder => renderNode(folder))}
        </div>
    );
};

export default TIAMappingFolderTree;
