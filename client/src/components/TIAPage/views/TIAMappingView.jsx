import React from 'react';
import TIALeftMappingPanel from './TIALeftMappingPanel';
import TIAMappingPanel from '../ui/TIAMappingPanel';

/**
 * Интерфейс маппинга 
 * в
 * @returns {JSX.Element}
 */
const TIAMappingView = () => {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'row',
            height: '100%',
            width: '100%',
            overflow: 'hidden',
            backgroundColor: 'var(--bg-content)'
        }}>
            {/* Левая колонка (Аналитика и компоненты) */}
            <div style={{
                flex: 1,
                height: '100%',
                borderRight: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <TIALeftMappingPanel />
            </div>

            {/* Правая колонка (Дерево функциональности) */}
            <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <TIAMappingPanel />
            </div>
        </div>
    );
};

export default TIAMappingView;
