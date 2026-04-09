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
        <div style={{ ...TIAStyles.mappingColumn, borderRight: 'none', backgroundColor: 'var(--bg-content)' }}>
            {/* Header */}
            <div style={{
                ...TIAStyles.columnHeader,
                padding: '20px 24px',
                borderBottom: '1px solid var(--border-color)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <h3 style={{
                        fontSize: '16px',
                        fontWeight: 800,
                        margin: 0,
                        color: 'var(--text-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                    }}>
                        Тестовая модель
                    </h3>
                </div>
            </div>

            {/* поиск */}
            <div style={{
                padding: '16px 24px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-input)'
            }}>
                <div style={{ position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="Поиск по функциональному дереву..."
                        value={folderSearchTerm}
                        onChange={(e) => setFolderSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px 16px 12px 40px',
                            borderRadius: '12px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-content)',
                            color: 'var(--text-primary)',
                            fontSize: '14px',
                            outline: 'none',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>
            </div>

            {/* Alert / Context */}
            <div style={{ padding: '16px 24px' }}>
                {!selectedComponentId ? (
                    <div style={{
                        backgroundColor: 'var(--warning-bg)',
                        border: '1px solid var(--warning)',
                        borderRadius: '14px',
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        boxShadow: 'var(--shadow-sm)'
                    }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Выберите компонент слева, чтобы настроить его маппинг
                        </span>
                    </div>
                ) : (
                    <div style={{
                        backgroundColor: 'color-mix(in srgb, var(--primary-accent) 10%, transparent)',
                        border: '1px solid var(--primary-accent)',
                        borderRadius: '14px',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'var(--primary-accent)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        boxShadow: 'var(--shadow-sm)'
                    }}>
                        <span>Настройка маппинга: {selectedComponent?.name}</span>
                        <span style={{
                            backgroundColor: 'var(--primary-accent)',
                            color: '#fff',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '10px'
                        }}>АКТИВЕН</span>
                    </div>
                )}
            </div>

            {/* Scrollable Tree */}
            <div style={{
                ...TIAStyles.columnScrollable,
                padding: '0 24px 24px 24px',
                flex: 1
            }}>
                <TIAMappingFolderTree folders={folders} searchTerm={folderSearchTerm} />
            </div>
        </div>
    );
};

export default TIAMappingPanel;
