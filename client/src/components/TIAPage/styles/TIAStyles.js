
export const TIA_COLORS = {
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    success: '#10b981',
    successBg: '#f0fdf4',
    error: '#ef4444',
    errorBg: '#fef2f2',
    warning: '#f59e0b',
    warningBg: '#fffbeb',
    textPrimary: '#1e293b',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    border: '#e2e8f0',
    bgContent: '#ffffff',
    bgInput: '#f8fafc',
    shadowSm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    shadowMd: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    shadowLg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
};

// Бейджи
export const badge = (color) => ({
    padding: '4px 10px',
    backgroundColor: `${color}15`,
    color: color,
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 800,
    border: `1px solid ${color}33`,
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
                backgroundColor: '#f0fdf4',
                border: '1px solid #dcfce7',
                color: '#166534'
            };
            break;
        case 'page':
        case 'auto':
            colors = {
                backgroundColor: '#fefce8',
                border: '1px solid #fef08a',
                color: '#854d0e'
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
    backgroundColor: '#fee2e2',
    color: '#dc2626',
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
    backgroundColor: '#ffffff',
    border: `2px solid ${isSelected ? TIA_COLORS.primary : (hasMapping ? '#86efac' : '#e2e8f0')}`,
    marginBottom: '16px',
    boxShadow: isSelected ? '0 10px 25px -5px rgba(59, 130, 246, 0.1)' : '0 4px 6px -1px rgba(0,0,0,0.05)',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer'
});

// Стили воркспейса и модалок
export const styles = {
    container: {
        padding: '24px',
        maxWidth: '1000px',
        margin: '0 auto',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        backgroundColor: '#ffffff',
        borderRadius: '6px',
        boxShadow: TIA_COLORS.shadowLg,
        fontFamily: 'Inter, sans-serif',
        border: `1px solid ${TIA_COLORS.border}`,
        overflow: 'hidden',
    },
    headerSection: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '32px',
        borderBottom: `2px solid ${TIA_COLORS.border}`,
        paddingBottom: '20px'
    },
    title: {
        fontSize: '32px',
        color: TIA_COLORS.textPrimary,
        margin: 0,
        fontWeight: 800,
        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
    },
    backButton: {
        padding: '10px 18px',
        backgroundColor: '#fff',
        border: `1px solid ${TIA_COLORS.border}`,
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 700,
        color: TIA_COLORS.textSecondary,
        cursor: 'pointer',
        transition: 'all 0.2s'
    },
    card: {
        padding: '24px',
        backgroundColor: '#fff',
        border: `1px solid ${TIA_COLORS.border}`,
        borderRadius: '16px',
        boxShadow: TIA_COLORS.shadowSm
    },
    cardSectionTitle: {
        fontSize: '12px',
        fontWeight: 800,
        color: TIA_COLORS.textMuted,
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
        backgroundColor: '#fffbeb',
        border: '1px solid #fef3c7',
        borderRadius: '12px',
        color: '#92400e',
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
        backgroundColor: '#ffffff',
        borderRadius: '24px',
        width: '95vw',
        maxWidth: '1750px',
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 70px -10px rgba(0, 0, 0, 0.4)',
        border: '1px solid #334155',
        overflow: 'hidden',
    },
    mappingModalHeader: {
        padding: '18px 28px',
        borderBottom: `1px solid ${TIA_COLORS.border}`,
        backgroundColor: '#f1f5f9',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    mappingModalFooter: {
        padding: '16px 28px',
        borderTop: `1px solid ${TIA_COLORS.border}`,
        backgroundColor: '#f8fafc',
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
        backgroundColor: '#ffffff',
        borderRight: `1px solid ${TIA_COLORS.border}`,
        overflow: 'hidden'
    },
    columnHeader: {
        padding: '16px 20px',
        backgroundColor: '#f8fafc',
        borderBottom: `1px solid ${TIA_COLORS.border}`,
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
        backgroundColor: '#f8fafc',
        borderBottom: `1px solid ${TIA_COLORS.border}`,
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
        borderTop: `1px solid ${TIA_COLORS.border}`,
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
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        border: 'none',
        borderRadius: '16px',
        cursor: 'pointer',
        transition: 'all 0.3s'
    },
    error: {
        padding: '14px 20px',
        backgroundColor: '#fef2f2',
        border: '1px solid #ef4444',
        color: '#ef4444',
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 500,
        textAlign: 'center',
        width: '100%',
    },
    success: {
        padding: '14px 20px',
        backgroundColor: '#f0fdf4',
        border: '1px solid #10b981',
        color: '#10b981',
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
        border: '1px solid #e2e8f0',
        color: '#1e293b',
        backgroundColor: '#f8fafc',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        outline: 'none',
    },
    /**
     * Кнопка отмены в модальных окнах
     */
    modalButtonCancel: {
        padding: '12px 24px',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        backgroundColor: '#f8fafc',
        color: '#475569',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
    },
    /**
     * Главная кнопка подтверждения в модальных окнахв
     */
    modalButtonConfirm: {
        padding: '12px 28px',
        borderRadius: '14px',
        border: 'none',
        background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
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
        color: TIA_COLORS.textSecondary,
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
        border: `1px solid ${TIA_COLORS.border}`,
        color: TIA_COLORS.textPrimary,
        backgroundColor: '#f8fafc',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
    },
    uploadContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '10px 20px',
        backgroundColor: '#f8fafc',
        borderRadius: '16px',
        border: `2px dashed ${TIA_COLORS.border}`,
        cursor: 'pointer',
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '54px'
    },
    fileInput: { fontSize: '14px', color: TIA_COLORS.textSecondary, cursor: 'pointer' },
    fileName: {
        fontSize: '13px',
        fontWeight: 600,
        color: TIA_COLORS.primary,
        backgroundColor: '#eff6ff',
        padding: '0 16px',
        borderRadius: '10px',
        border: '1px solid #dbeafe',
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
        backgroundColor: '#f1f5f9',
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
        backgroundColor: isActive ? '#ffffff' : 'transparent',
        color: isActive ? TIA_COLORS.primary : TIA_COLORS.textMuted,
        boxShadow: isActive ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none',
        marginTop: 0
    }),
    modeToggleLabel: { fontSize: '14px', fontWeight: 600, color: TIA_COLORS.textSecondary, marginBottom: '10px' }
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
