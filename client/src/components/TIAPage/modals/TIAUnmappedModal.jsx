import { useTIA } from '../context/TIAContext';
import { styles, setupStyles } from '../styles/TIAStyles';

/**
 * Модальное окно подтверждения при наличии незамапленных компонентов
 * @returns {JSX.Element|null}
 */
const TIAUnmappedModal = () => {
    const {
        showUnmappedModal,
        setShowUnmappedModal,
        unmappedComponentsList,
        activeUnmappedTab,
        setActiveUnmappedTab,
        handleOpenSplitModal
    } = useTIA();

    if (!showUnmappedModal) return null;

    const filtered = unmappedComponentsList.filter(c => c.type === activeUnmappedTab);

    return (
        <div style={styles.mappingModalOverlay}>
            <div style={{ 
                ...styles.mappingModalContent, 
                maxWidth: '750px', 
                height: 'auto', 
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Header */}
                <div style={{ 
                    ...styles.mappingModalHeader, 
                    padding: '24px 32px', 
                    flexDirection: 'column', 
                    alignItems: 'flex-start', 
                    gap: '4px',
                    flexShrink: 0 
                }}>
                    <h3 style={{ ...styles.title, fontSize: '22px' }}>
                        Незамапленные компоненты
                    </h3>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5', maxWidth: '600px' }}>
                        Следующие компоненты не привязаны ни к одному функциональному блоку Allure. Они будут пропущены при создании запуска тестирования.
                    </p>
                </div>

                {/* Tabs / Filter */}
                <div style={{ padding: '16px 32px 0', backgroundColor: 'var(--bg-input)', flexShrink: 0 }}>
                    <div style={setupStyles.modeToggleContainer}>
                        <button
                            onClick={() => setActiveUnmappedTab('frontend')}
                            style={setupStyles.modeToggleButton(activeUnmappedTab === 'frontend')}
                        >
                            Frontend ({unmappedComponentsList.filter(c => c.type === 'frontend').length})
                        </button>
                        <button
                            onClick={() => setActiveUnmappedTab('backend')}
                            style={setupStyles.modeToggleButton(activeUnmappedTab === 'backend')}
                        >
                            Backend ({unmappedComponentsList.filter(c => c.type === 'backend').length})
                        </button>
                    </div>
                </div>

                {/* List Container */}
                <div style={{ 
                    padding: '16px 32px 24px', 
                    backgroundColor: 'var(--bg-input)', 
                    flex: 1, 
                    minHeight: 0, 
                    display: 'flex', 
                    flexDirection: 'column' 
                }}>
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        paddingRight: '12px'
                    }}>
                        {filtered.length > 0 ? (
                            filtered.map((comp, idx) => (
                                <div key={idx} style={{
                                    padding: '12px 20px',
                                    backgroundColor: 'var(--bg-content)',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border-color)',
                                    fontSize: '14px',
                                    color: 'var(--text-primary)',
                                    fontWeight: 600,
                                    boxShadow: 'var(--shadow-sm)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    transition: 'all 0.2s ease'
                                }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--warning)', boxShadow: '0 0 6px color-mix(in srgb, var(--warning) 40%, transparent)' }} />
                                    {comp.name}
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '40px 20px', textAlign: 'center', backgroundColor: 'var(--bg-content)', borderRadius: '20px', border: '1px dashed var(--border-color)' }}>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '16px' }}>Все компоненты замаплены</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={styles.mappingModalFooter}>
                    <button
                        onClick={() => setShowUnmappedModal(false)}
                        style={styles.backButton}
                    >
                        Вернуться к маппингу
                    </button>
                    <button
                        onClick={() => {
                            setShowUnmappedModal(false);
                            handleOpenSplitModal(true);
                        }}
                        style={{
                            ...styles.primaryButton,
                            background: 'linear-gradient(135deg, var(--warning) 0%, #d97706 100%)',
                            boxShadow: '0 8px 16px color-mix(in srgb, var(--warning) 30%, transparent)'
                        }}
                    >
                        Продолжить без них
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TIAUnmappedModal;
