import React, { useState } from 'react';
import { useTIA } from '../context/TIAContext';
import TIAMappingFolderTree from './TIAMappingFolderTree';

/**
 * Панель маппинга "Чем покрыть" (правая колонка)
 * @returns {JSX.Element}
 */
const TIAMappingPanel = () => {
    const { 
        selectedComponentId, 
        components 
    } = useTIA();

    const [searchTerm, setSearchTerm] = useState('');

    const selectedComponent = components.find(c => c.id === selectedComponentId);

    return (
        <div style={{ 
            backgroundColor: '#fff', 
            borderRadius: '32px', 
            padding: '32px', 
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05)',
            border: '1px solid rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            position: 'sticky',
            top: '24px',
            maxHeight: 'calc(100vh - 48px)',
            minWidth: '450px'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1e293b', margin: 0 }}>Чем покрыть</h3>
                <div style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '12px', color: '#6366f1' }}>
                    💡
                </div>
            </div>

            {/* Search Bar */}
            <div style={{ position: 'relative' }}>
                <input 
                    type="text" 
                    placeholder="Поиск по дереву фич..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '14px 20px',
                        backgroundColor: '#334155',
                        border: 'none',
                        borderRadius: '16px',
                        color: '#fff',
                        fontSize: '14px',
                        fontWeight: 500,
                        outline: 'none',
                        boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'
                    }}
                />
            </div>

            {/* Selected Component Status */}
            {!selectedComponentId ? (
                <div style={{ 
                    backgroundColor: '#fffbeb', 
                    border: '1px solid #fef3c7', 
                    borderRadius: '16px', 
                    padding: '16px 20px', 
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}>
                    <span style={{ fontSize: '18px' }}>⚠️</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#92400e' }}>
                        Выберите компонент слева, чтобы связать его с фичами
                    </span>
                </div>
            ) : (
                <div style={{ 
                    backgroundColor: '#f0f9ff', 
                    border: '1px solid #e0f2fe', 
                    borderRadius: '16px', 
                    padding: '12px 20px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#0369a1'
                }}>
                    Маппинг для: <span style={{ color: '#0284c7' }}>{selectedComponent?.name}</span>
                </div>
            )}

            {/* Tree Area */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                <TIAMappingFolderTree searchTerm={searchTerm} />
            </div>
        </div>
    );
};

export default TIAMappingPanel;
