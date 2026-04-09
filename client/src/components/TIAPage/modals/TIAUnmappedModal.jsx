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
            <div style={{ ...styles.mappingModalContent, maxWidth: '750px', height: 'auto', maxHeight: '90vh' }}>
                {/* Header */}
                <div style={{ ...styles.mappingModalHeader, padding: '32px 40px', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                    <h3 style={{ ...styles.title, fontSize: '24px' }}>
                        Незамапленные компоненты
                    </h3>
                    <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.6', maxWidth: '600px' }}>
                        Следующие компоненты не привязаны ни к одному функциональному блоку Allure. Они будут пропущены при создании запуска тестирования.
                    </p>
                </div>

                {/* Tabs / Filter */}
                <div style={{ padding: '24px 40px 0', backgroundColor: 'var(--bg-input)' }}>
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
                <div style={{ padding: '24px 40px 32px', backgroundColor: 'var(--bg-input)' }}>
                    <div style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        padding: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        paddingRight: '12px'
                    }}>
                        {filtered.length > 0 ? (
                            filtered.map((comp, idx) => (
                                <div key={idx} style={{
                                    padding: '16px 24px',
                                    backgroundColor: 'var(--bg-content)',
                                    borderRadius: '16px',
                                    border: '1px solid var(--border-color)',
                                    fontSize: '15px',
                                    color: 'var(--text-primary)',
                                    fontWeight: 600,
                                    boxShadow: 'var(--shadow-sm)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '14px',
                                    transition: 'all 0.2s ease'
                                }}>
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--warning)', boxShadow: '0 0 8px color-mix(in srgb, var(--warning) 40%, transparent)' }} />
                                    {comp.name}
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '60px 40px', textAlign: 'center', backgroundColor: 'var(--bg-content)', borderRadius: '24px', border: '1px dashed var(--border-color)' }}>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '18px' }}>Все компоненты замаплены</div>
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
