import React from 'react';
import { useTIA } from '../context/TIAContext';
import { styles } from '../styles/TIAStyles';
import Loader from '../../../Loader';

/**
 * Модальное окно для создания стаб-тестов в пустых функциональных блоках Allure
 * @returns {JSX.Element|null}
 */
const TIAEmptyGroupsModal = () => {
    const { 
        showEmptyGroupsModal, 
        setShowEmptyGroupsModal, 
        emptyGroupsData, 
        isCreatingStubs, 
        handleCreateStubs 
    } = useTIA();

    if (!showEmptyGroupsModal) return null;

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ backgroundColor: 'var(--bg-content)', width: '100%', maxWidth: '550px', borderRadius: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {/* Header */}
                <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                        💨 Пустые группы Allure
                    </h3>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                        Следующие блоки не содержат ни одного теста. Allure не позволяет создавать запуски с пустыми группами.
                    </p>
                </div>

                {/* List */}
                <div style={{ padding: '24px 40px', maxHeight: '350px', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {emptyGroupsData.map((group, idx) => (
                            <div key={idx} style={{ padding: '10px 14px', backgroundColor: 'var(--bg-input)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>{group.name}</span>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ID: {group.id}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Info Text */}
                <div style={{ padding: '0 40px 24px', fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
                    Нажмите «Создать заглушки», чтобы автоматически добавить пустой тест в каждый из этих блоков. Это позволит успешно сформировать запуск.
                </div>

                {/* Footer */}
                <div style={{ padding: '32px 40px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                    <button onClick={() => setShowEmptyGroupsModal(false)} style={styles.modalButtonCancel}>
                        Отмена
                    </button>
                    <button 
                        onClick={handleCreateStubs} 
                        disabled={isCreatingStubs}
                        style={{ ...styles.modalButtonConfirm, display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px', justifyContent: 'center', background: 'linear-gradient(135deg, var(--primary-accent) 0%, var(--primary-hover) 100%)', boxShadow: '0 10px 15px -3px rgba(99, 102, 241, 0.4)' }}
                    >
                        {isCreatingStubs ? <Loader size="16px" color="#fff" /> : '🏗️'}
                        {isCreatingStubs ? 'Создание...' : 'Создать заглушки'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TIAEmptyGroupsModal;
