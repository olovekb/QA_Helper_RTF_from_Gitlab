import React from 'react';
import TIAComponentList from './TIAComponentList';
import TIAMappingPanel from '../ui/TIAMappingPanel';

/**
 * Контейнер для режима маппинга (Split View)
 * @returns {JSX.Element}
 */
const TIAMappingView = () => {
    return (
        <div style={{ 
            display: 'flex', 
            gap: '40px', 
            alignItems: 'flex-start',
            animation: 'fadeIn 0.5s ease-out',
            marginTop: '32px'
        }}>
            {/* Left Column: Components */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#1e293b', margin: '0 0 24px 0' }}>Сопоставление компонентов</h2>
                <TIAComponentList />
            </div>

            {/* Right Column: Fixed Panel */}
            <div style={{ width: '480px', flexShrink: 0, position: 'sticky', top: '32px' }}>
                <TIAMappingPanel />
            </div>
        </div>
    );
};

export default TIAMappingView;
