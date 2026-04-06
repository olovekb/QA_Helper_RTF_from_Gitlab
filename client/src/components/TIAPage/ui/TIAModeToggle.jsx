import React from 'react';
import { useTIA } from '../context/TIAContext';
import { setupStyles } from '../styles/TIAStyles';

/**
 * Переключатель режимов работы TIA (Маппинг / Лайт-режим)
 * @returns {JSX.Element}
 */
const TIAModeToggle = () => {
    const { mode, setMode } = useTIA();

    return (
        <div style={{ marginBottom: '24px' }}>
            <h3 style={setupStyles.sectionTitle}>Режим работы</h3>
            <div style={setupStyles.modeToggleContainer}>
                <button
                    style={setupStyles.modeButton(mode === 'mapping')}
                    onClick={() => setMode('mapping')}
                >
                    Маппинг
                </button>
                <button
                    style={setupStyles.modeButton(mode === 'light')}
                    onClick={() => setMode('light')}
                >
                    Лайт-режим
                </button>
            </div>
        </div>
    );
};

export default TIAModeToggle;
