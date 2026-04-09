
export const TIA_COLORS = {
    primary: 'var(--primary-accent)',
    primaryHover: 'var(--primary-hover)',
    success: 'var(--success)',
    successBg: 'var(--success-bg)',
    error: 'var(--error)',
    errorBg: 'var(--error-bg)',
    warning: 'var(--warning)',
    warningBg: 'var(--warning-bg)',
    textPrimary: 'var(--text-primary)',
    textSecondary: 'var(--text-secondary)',
    textMuted: 'var(--text-muted)',
    border: 'var(--border-color)',
    bgContent: 'var(--bg-content)',
    bgInput: 'var(--bg-input)',
    shadowSm: 'var(--shadow-sm)',
    shadowMd: 'var(--shadow-md)',
    shadowLg: 'var(--shadow-lg)'
};

// Бейджи
export const badge = (color) => ({
    padding: '4px 10px',
    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
    color: color,
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 800,
    border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase'
});

export const mappingTag = (type) => {
    const base = {
        padding: '0 8px 0 12px',
        borderRadius: '8px',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 600,
        border: '1px solid transparent',
        height: '32px',
        maxWidth: '220px',
        flexShrink: 0,
        userSelect: 'none'
    };

    const textStyle = {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1
    };

    let colors = {};
    switch (type) {
        case 'direct':
            colors = {
                backgroundColor: 'var(--success-bg)',
                border: '1px solid var(--success)',
                color: 'var(--success)'
            };
            break;
        case 'page':
        case 'auto':
            colors = {
                backgroundColor: 'var(--warning-bg)',
                border: '1px solid var(--warning)',
                color: 'var(--warning)'
            };
            break;
        default:
            colors = {};
    }

    return { ...base, ...colors, textStyle };
};

export const removeButton = {
    width: '32px',
    height: '32px',
    borderRadius: '12px',
    border: 'none',
    backgroundColor: 'var(--error-bg)',
    color: 'var(--error)',
    fontSize: '10px',
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '-1px'
};

// Карточка компонента
export const componentCard = (isSelected, hasMapping) => ({
    padding: '20px',
    borderRadius: '16px',
    backgroundColor: 'var(--bg-content)',
    border: `2px solid ${isSelected ? TIA_COLORS.primary : (hasMapping ? 'var(--success)' : 'var(--border-color)')}`,
    marginBottom: '16px',
    boxShadow: isSelected ? 'var(--shadow-md)' : 'var(--shadow-sm)',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer'
});

// Стили воркспейса и модалок
export const styles = {
    container: {
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        backgroundColor: 'var(--bg-main)',
        fontFamily: 'var(--font-main), "Inter", "Outfit", "Roboto", sans-serif',
        color: 'var(--text-primary)',
    },
    headerSection: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0',
        marginBottom: '40px',
    },
    title: {
        fontSize: '32px',
        color: 'var(--text-primary)',
        margin: 0,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        textShadow: 'none'
    },
    backButton: {
        padding: '0 20px',
        height: '52px',
        backgroundColor: 'var(--bg-content)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border-color)',
        borderRadius: '14px',
        fontWeight: 600,
        fontSize: '15px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
    },
    primaryButton: {
        padding: '0 28px',
        height: '52px',
        backgroundColor: 'var(--primary-accent)',
        color: '#fff',
        border: 'none',
        borderRadius: '14px',
        fontWeight: 600,
        fontSize: '15px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
    },
    setupCard: {
        backgroundColor: 'var(--bg-content)',
        padding: '32px',
        borderRadius: '24px',
        marginBottom: '40px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.02)',
    },
    card: {
        backgroundColor: 'var(--bg-content)',
        border: '1px solid var(--border-color)',
        borderRadius: '16px',
        boxShadow: 'var(--shadow-sm)',
        padding: '24px',
    },
    cardSectionTitle: {
        fontSize: '12px',
        fontWeight: 800,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '12px'
    },
    codeBlock: {
        backgroundColor: '#0f172a',
        color: '#e2e8f0',
        padding: '16px',
        borderRadius: '12px',
        fontSize: '13px',
        fontFamily: 'Fira Code, monospace',
        overflowX: 'auto',
        lineHeight: 1.5,
        border: '1px solid #1e293b'
    },
    riskIndicator: {
        width: '6px',
        height: '100%',
        position: 'absolute',
        left: 0,
        top: 0
    },
    riskAlert: {
        padding: '16px 20px',
        backgroundColor: 'var(--warning-bg)',
        border: '1px solid var(--warning)',
        borderRadius: '12px',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    },
    mappingModalOverlay: {
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
    },
    mappingModalContent: {
        backgroundColor: 'var(--bg-content)',
        borderRadius: '24px',
        width: '98vw',
        maxWidth: '1920px',
        height: '95vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        border: 'none',
        overflow: 'hidden',
    },
    mappingModalHeader: {
        padding: '18px 28px',
        borderBottom: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-input)',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    mappingModalFooter: {
        padding: '16px 28px',
        borderTop: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-input)',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '12px',
        flexShrink: 0
    },
    mappingColumn: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-content)',
        borderRight: '1px solid var(--border-color)',
        overflow: 'hidden'
    },
    columnHeader: {
        padding: '16px 20px',
        backgroundColor: 'var(--bg-input)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'auto',
        flexShrink: 0
    },
    columnScrollable: {
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '20px'
    },
    mappingTabsContainer: {
        display: 'flex',
        padding: '12px 20px',
        backgroundColor: 'var(--bg-input)',
        borderBottom: '1px solid var(--border-color)',
        gap: '8px'
    },
    mappingTabButton: (isActive) => ({
        padding: '8px 16px',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: 700,
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.2s',
        backgroundColor: isActive ? TIA_COLORS.primary : 'transparent',
        color: isActive ? '#fff' : TIA_COLORS.textSecondary,
    }),
    footer: {
        marginTop: '40px',
        paddingTop: '24px',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
    },
    submitButton: {
        padding: '16px 40px',
        fontSize: '16px',
        fontWeight: 700,
        color: '#ffffff',
        background: 'linear-gradient(135deg, var(--success) 0%, #059669 100%)',
        border: 'none',
        borderRadius: '16px',
        cursor: 'pointer',
        transition: 'all 0.3s',
        boxShadow: '0 10px 25px -5px color-mix(in srgb, var(--success) 40%, transparent)',
        width: '100%',
        maxWidth: '400px',
    },
    error: {
        padding: '14px 20px',
        backgroundColor: 'var(--error-bg)',
        border: '1px solid var(--error)',
        color: 'var(--error)',
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 500,
        textAlign: 'center',
        width: '100%',
    },
    success: {
        padding: '14px 20px',
        backgroundColor: 'var(--success-bg)',
        border: '1px solid var(--success)',
        color: 'var(--success)',
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 500,
        textAlign: 'center',
        width: '100%',
    },
    select: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '14px 16px',
        fontSize: '15px',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
        backgroundColor: 'var(--bg-input)',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        outline: 'none',
    },
    modalButtonCancel: {
        padding: '12px 24px',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-input)',
        color: 'var(--text-secondary)',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
    },
    modalButtonConfirm: {
        padding: '12px 28px',
        borderRadius: '14px',
        border: 'none',
        background: 'linear-gradient(135deg, var(--primary-accent) 0%, var(--primary-hover) 100%)',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: '0 4px 12px color-mix(in srgb, var(--primary-accent) 30%, transparent)',
        whiteSpace: 'nowrap',
    },
};

// Стили форм
export const setupStyles = {
    form: { display: 'flex', flexDirection: 'column', gap: '28px' },
    formGroup: { display: 'flex', flexDirection: 'column', gap: '10px' },
    label: {
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '4px',
    },
    select: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '14px 16px',
        fontSize: '15px',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
        backgroundColor: 'var(--bg-input)',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
    },
    uploadContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '10px 20px',
        backgroundColor: 'var(--bg-input)',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        cursor: 'pointer',
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '54px'
    },
    fileInput: { fontSize: '14px', color: 'var(--text-secondary)', cursor: 'pointer' },
    fileName: {
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--primary-accent)',
        backgroundColor: 'color-mix(in srgb, var(--primary-accent) 15%, transparent)',
        padding: '0 16px',
        borderRadius: '10px',
        border: '1px solid var(--border-color)',
        maxWidth: '220px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        height: '32px',
        margin: 0
    },
    modeToggleContainer: {
        display: 'flex',
        backgroundColor: 'var(--bg-input)',
        borderRadius: '16px',
        padding: '4px',
        width: 'fit-content',
        marginBottom: '4px'
    },
    modeToggleButton: (isActive) => ({
        padding: '10px 24px',
        borderRadius: '12px',
        border: 'none',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        backgroundColor: isActive ? 'var(--bg-content)' : 'transparent',
        color: isActive ? 'var(--primary-accent)' : 'var(--text-muted)',
        boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
        marginTop: 0
    }),
    modeToggleLabel: { fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }
};

const TIAStyles = {
    ...styles,
    ...setupStyles,
    badge,
    mappingTag,
    componentCard,
    removeButton,
    TIA_COLORS
};

export default TIAStyles;

