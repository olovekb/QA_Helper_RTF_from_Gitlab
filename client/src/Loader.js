// client/src/components/Loader.js
import React from 'react';
import styles from './styles';

const Loader = ({ style = {}, size = '20px', color = 'var(--primary-accent)' }) => {
    const spinnerStyle = {
        width: size,
        height: size,
        border: `2px solid color-mix(in srgb, ${color} 20%, transparent)`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        ...style
    };

    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <style>
                {`
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `}
            </style>
            <div style={spinnerStyle}></div>
        </div>
    );
};

export default Loader;