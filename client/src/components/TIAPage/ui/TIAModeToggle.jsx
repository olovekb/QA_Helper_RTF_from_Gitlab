import React from 'react';
import { useTIA } from '../context/TIAContext';
import { setupStyles } from '../styles/TIAStyles';

/**
 * Переключатель режимов работы TIA
 */
const TIAModeToggle = () => {
    const { mode, setMode } = useTIA();

    return (
        <div style={setupStyles.formGroup}>
            <label style={setupStyles.label}>Режим работы</label>
            <div style={setupStyles.modeToggleContainer}>
                <button
                    onClick={() => setMode('mapping')}
                    style={setupStyles.modeToggleButton(mode === 'mapping')}
                >
                    Маппинг
                </button>
                <button
                    onClick={() => setMode('light')}
                    style={setupStyles.modeToggleButton(mode === 'light')}
                >
                    Лайт-режим
                </button>
            </div>
        </div>
    );
};

export default TIAModeToggle;
