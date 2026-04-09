import React from 'react';
import { useTIA } from '../context/TIAContext';
import { styles } from '../styles/TIAStyles';

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
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000, padding: '24px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ backgroundColor: 'var(--bg-content)', width: '100%', maxWidth: '650px', borderRadius: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '40px 48px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: 'var(--bg-input)' }}>
                    <h3 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                        Незамапленные компоненты
                    </h3>
                    <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.6' }}>
                        Следующие компоненты не привязаны ни к одному функциональному блоку Allure. Они будут пропущены при создании запуска тестирования.
                    </p>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', padding: '16px 48px 0', gap: '12px', backgroundColor: 'var(--bg-input)' }}>
                    {['frontend', 'backend'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveUnmappedTab(tab)}
                            style={{
                                padding: '10px 24px',
                                borderRadius: '14px',
                                border: 'none',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                backgroundColor: activeUnmappedTab === tab ? 'var(--primary-accent)' : 'transparent',
                                color: activeUnmappedTab === tab ? '#fff' : 'var(--text-muted)',
                                transition: 'all 0.2s'
                            }}
                        >
                            {tab === 'frontend' ? 'Frontend' : 'Backend'}
                        </button>
                    ))}
                </div>

                {/* List Container */}
                <div style={{ padding: '24px 48px 40px', backgroundColor: 'var(--bg-input)' }}>
                    <div style={{ maxHeight: '350px', overflowY: 'auto', padding: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {filtered.length > 0 ? (
                            filtered.map((comp, idx) => (
                                <div key={idx} style={{
                                    padding: '14px 20px',
                                    backgroundColor: 'var(--bg-content)',
                                    borderRadius: '16px',
                                    border: '1px solid var(--border-color)',
                                    fontSize: '14px',
                                    color: 'var(--text-primary)',
                                    fontWeight: 600,
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px'
                                }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--warning-accent, #f59e0b)' }} />
                                    {comp.name}
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '60px 40px', textAlign: 'center', backgroundColor: 'var(--bg-content)', borderRadius: '24px', border: '2px dashed var(--border-color)' }}>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '16px' }}>Все компоненты замаплены.</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '32px 48px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '16px', backgroundColor: 'var(--bg-content)' }}>
                    <button
                        onClick={() => setShowUnmappedModal(false)}
                        style={{
                            ...styles.modalButtonCancel,
                            backgroundColor: 'transparent',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)',
                            fontWeight: 700,
                            padding: '14px 28px',
                            borderRadius: '16px'
                        }}
                    >
                        Вернуться к маппингу
                    </button>
                    <button
                        onClick={() => {
                            setShowUnmappedModal(false);
                            handleOpenSplitModal(true);
                        }}
                        style={{
                            ...styles.modalButtonConfirm,
                            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                            boxShadow: '0 10px 20px -5px rgba(245, 158, 11, 0.4)',
                            fontWeight: 800,
                            padding: '14px 32px',
                            borderRadius: '16px'
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
