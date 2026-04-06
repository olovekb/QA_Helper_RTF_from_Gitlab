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
        handleMappingConfirm 
    } = useTIA();

    if (!showUnmappedModal) return null;

    const filtered = unmappedComponentsList.filter(c => c.type === activeUnmappedTab);

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ backgroundColor: 'var(--bg-content)', width: '100%', maxWidth: '600px', borderRadius: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {/* Header */}
                <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                        ⚠️ Имеются незамапленные компоненты
                    </h3>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                        Эти компоненты не привязаны ни к одному функциональному блоку Allure и будут пропущены при создании запуска.
                    </p>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', padding: '16px 40px 0', gap: '12px' }}>
                    {['frontend', 'backend'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveUnmappedTab(tab)}
                            style={{
                                padding: '8px 20px',
                                borderRadius: '12px',
                                border: 'none',
                                fontSize: '13px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                backgroundColor: activeUnmappedTab === tab ? 'var(--primary-accent)' : 'var(--bg-input)',
                                color: activeUnmappedTab === tab ? '#fff' : 'var(--text-muted)',
                                transition: 'all 0.2s'
                            }}
                        >
                            {tab.toUpperCase()}
                        </button>
                    ))}
                </div>

                {/* List */}
                <div style={{ padding: '24px 40px', maxHeight: '400px', overflowY: 'auto' }}>
                    {filtered.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {filtered.map((comp, idx) => (
                                <div key={idx} style={{ padding: '10px 14px', backgroundColor: 'var(--bg-input)', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '13px', color: 'var(--text-primary)' }}>
                                    {comp.name}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Все компоненты замаплены!
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '32px 40px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                    <button onClick={() => setShowUnmappedModal(false)} style={styles.modalButtonCancel}>
                        Вернуться к маппингу
                    </button>
                    <button 
                        onClick={() => {
                            setShowUnmappedModal(false);
                            handleMappingConfirm('launch');
                        }} 
                        style={{ ...styles.modalButtonConfirm, background: 'linear-gradient(135deg, var(--warning) 0%, #d97706 100%)', boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)' }}
                    >
                        Продолжить без них
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TIAUnmappedModal;
