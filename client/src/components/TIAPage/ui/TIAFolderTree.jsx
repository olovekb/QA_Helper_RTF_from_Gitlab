import { useTIA } from '../context/TIAContext';
import { formatCustomFieldName, filterFoldersForProject } from '../utils/tiaUtils';
import { treeStyles } from '../styles/TIAStyles';

/**
 * Рекурсивный компонент отображения дерева папок для основного экрана
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {currentFolders.map((folder) => {
                const isExpanded = !!expandedFolders[folder.id];
                const hasChildren = folder.children && folder.children.length > 0;
                const isSelected = selectedId?.toString() === folder.id.toString();
                const isRoot = level === 0;

                return (
                    <div key={folder.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                            style={{
                                ...treeStyles.folder(level, isRoot),
                                backgroundColor: isSelected ? '#f1f5f9' : (isRoot ? '#f8fafc' : '#fff'),
                                borderColor: isSelected ? '#e2e8f0' : '#f1f5f9',
                                boxShadow: isRoot ? '0 2px 4px rgba(0,0,0,0.02)' : 'none'
                            }}
                            onClick={(e) => handleFolderToggle(folder.id, e)}
                        >
                            {hasChildren ? (
                                <span style={treeStyles.arrow(isExpanded)}>
                                    ▶
                                </span>
                            ) : (
                                <span style={{ width: '14px' }} />
                            )}

                            <span style={{
                                ...treeStyles.name(isRoot),
                                color: isSelected ? '#6366f1' : '#0f172a'
                            }}>
                                {formatCustomFieldName(folder, level)}
                            </span>
                        </div>

                        {isExpanded && hasChildren && (
                            <div style={{
                                borderLeft: '1px dashed #e2e8f0',
                                marginLeft: `${level * 12 + 18}px`,
                                paddingLeft: '8px',
                                marginTop: '4px'
                            }}>
                                <TIAFolderTree
                                    folders={folder.children}
                                    level={level + 1}
                                    selectedId={selectedId}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TIAFolderTree;
