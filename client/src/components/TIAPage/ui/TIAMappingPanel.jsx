import React from 'react';
import { useTIA } from '../context/TIAContext';
import TIAMappingFolderTree from './TIAMappingFolderTree';
import TIAStyles from '../styles/TIAStyles';

/**
 * Панель маппинга "Дерево функциональности"
 * @returns {JSX.Element}
 */
const TIAMappingPanel = () => {
    const {
        selectedComponentId,
        components,
        folders,
        folderSearchTerm,
        setFolderSearchTerm
    } = useTIA();

    const selectedComponent = components.find(c => c.id === selectedComponentId);

    return (
        <div style={{ ...TIAStyles.mappingColumn, borderRight: 'none' }}>
            {/* Header */}
            <div style={TIAStyles.columnHeader}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                        Чем покрыть
                    </h3>
                </div>
            </div>

            {/* поиск */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                <input
                    type="text"
                    placeholder="Поиск по дереву"
                    value={folderSearchTerm}
                    onChange={(e) => setFolderSearchTerm(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '10px 16px',
                        borderRadius: '10px',
                        border: '1px solid #e2e8f0',
                        backgroundColor: '#ffffff',
                        color: '#1e293b',
                        fontSize: '13px',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                        boxSizing: 'border-box'
                    }}
                />
            </div>

            {/* */}
            {!selectedComponentId ? (
                <div style={{
                    margin: '12px 20px',
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fef3c7',
                    borderRadius: '10px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400e' }}>
                        Выберите компонент слева, чтобы связать его с фичами
                    </span>
                </div>
            ) : (
                <div style={{
                    margin: '12px 20px',
                    backgroundColor: '#f0f9ff',
                    border: '1px solid #e0f2fe',
                    borderRadius: '10px',
                    padding: '10px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#0369a1',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <span>Редактирование: {selectedComponent?.name}</span>
                </div>
            )}

            {/* */}
            <div style={{
                ...TIAStyles.columnScrollable,
                padding: '0 20px 20px 20px',
                flex: 1
            }}>
                <TIAMappingFolderTree folders={folders} searchTerm={folderSearchTerm} />
            </div>
        </div>
    );
};

export default TIAMappingPanel;
