import { useTIA } from '../context/TIAContext';
import { formatCustomFieldName, filterFoldersForProject } from '../utils/tiaUtils';

/**
 * Рекурсивный компонент отображения дерева папок
 * @param {Object} props - Свойства компонента
 * @param {Array} props.folders - Узлы дерева
 * @param {number} [props.level=0] - Уровень вложенности
 * @param {string|number} [props.selectedId=null] - Выбранный ID
 * @returns {JSX.Element}
 */
const TIAFolderTree = ({ folders, level = 0, selectedId = null }) => {
    const { 
        projectId, 
        expandedFolders, 
        handleFolderToggle 
    } = useTIA();

    if (!folders) return null;

    const currentFolders = filterFoldersForProject(folders, projectId);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {currentFolders.map((folder) => {
                const isExpanded = expandedFolders[folder.id];
                const hasChildren = folder.children && folder.children.length > 0;
                const isSelected = selectedId?.toString() === folder.id.toString();

                return (
                    <div key={folder.id} style={{ marginLeft: `${level * 16}px` }}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 10px',
                                cursor: 'pointer',
                                borderRadius: '8px',
                                backgroundColor: isSelected ? 'var(--bg-input)' : 'transparent',
                                transition: 'all 0.2s ease',
                                border: isSelected ? '1px solid var(--primary-accent)' : '1px solid transparent',
                            }}
                            onClick={() => handleFolderToggle(folder.id)}
                        >
                            {hasChildren ? (
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', width: '12px' }}>
                                    {isExpanded ? '▼' : '▶'}
                                </span>
                            ) : (
                                <span style={{ width: '12px' }} />
                            )}
                            <span style={{ 
                                fontSize: '14px', 
                                color: isSelected ? 'var(--primary-accent)' : 'var(--text-primary)',
                                fontWeight: isSelected ? 600 : 400 
                            }}>
                                {formatCustomFieldName(folder, level)}
                            </span>
                        </div>
                        {isExpanded && hasChildren && (
                            <TIAFolderTree folders={folder.children} level={level + 1} selectedId={selectedId} />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TIAFolderTree;
