import baseStyles from '../../../styles';

export const styles = baseStyles;

export const selectStyles = {
    control: (provided) => ({
        ...provided,
        minHeight: '38px',
        width: '100%',
        minWidth: '300px',
        borderRadius: '8px',
        border: `1px solid ${baseStyles.borderLight || 'var(--border-color)'}`,
        boxShadow: 'none',
        '&:hover': { borderColor: baseStyles.primary },
    }),
    multiValue: (provided) => ({
        ...provided,
        backgroundColor: baseStyles.lightGray || 'var(--bg-input)',
        borderRadius: '4px',
    }),
    multiValueLabel: (provided) => ({
        ...provided,
        color: baseStyles.textDark,
    }),
    multiValueRemove: (provided) => ({
        ...provided,
        color: baseStyles.textMuted,
        '&:hover': { backgroundColor: baseStyles.dangerColor || 'var(--error)', color: 'white' },
    }),
    menu: (provided) => ({
        ...provided,
        zIndex: 1001,
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        maxHeight: '300px',
        overflowY: 'auto',
        color: baseStyles.textDark
    }),
    menuList: (provided) => ({
        ...provided,
        maxHeight: '300px',
        padding: '8px',
        color: baseStyles.textDark
    })
};

export const setupStyles = {
    setupCard: {
        backgroundColor: '#fff',
        borderRadius: '32px',
        padding: '60px 80px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.04)',
        width: '100%',
        maxWidth: '1000px',
        margin: '0 auto',
    },
    sectionTitle: {
        fontSize: '12px',
        fontWeight: 700,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '16px',
        marginTop: '32px',
    },
    modeToggleContainer: {
        display: 'inline-flex',
        backgroundColor: '#f1f5f9',
        borderRadius: '16px',
        padding: '6px',
        gap: '4px',
        marginBottom: '8px',
    },
    modeButton: (active) => ({
        padding: '10px 24px',
        borderRadius: '12px',
        border: 'none',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.2s',
        backgroundColor: active ? '#fff' : 'transparent',
        color: active ? '#6366f1' : '#64748b',
        boxShadow: active ? '0 4px 12px rgba(0, 0, 0, 0.08)' : 'none',
    }),
    uploadBox: (hasFile) => ({
        display: 'flex',
        alignItems: 'center',
        padding: '24px 32px',
        borderRadius: '20px',
        border: `2px dashed ${hasFile ? '#6366f1' : '#cbd5e1'}`,
        backgroundColor: hasFile ? '#f8fafc' : 'transparent',
        transition: 'all 0.2s',
        minHeight: '80px',
        gap: '20px',
    }),
    uploadButton: {
        padding: '10px 20px',
        backgroundColor: '#f1f5f9',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        color: '#475569',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s',
    },
    fileTag: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '12px',
        backgroundColor: '#e0e7ff',
        color: '#4338ca',
        padding: '8px 16px',
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 500,
        marginLeft: 'auto',
    },
    removeFileBtn: {
        border: 'none',
        backgroundColor: '#fee2e2',
        color: '#ef4444',
        width: '24px',
        height: '24px',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: '18px',
    },
    mainButton: {
        width: '100%',
        maxWidth: '400px',
        padding: '20px',
        borderRadius: '16px',
        border: 'none',
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        color: '#fff',
        fontSize: '18px',
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.3)',
        transition: 'all 0.2s',
        margin: '40px auto 0',
        display: 'block',
    }
};

export default baseStyles;
