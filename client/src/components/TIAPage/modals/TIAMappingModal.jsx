import React from 'react';
import { useTIA } from '../context/TIAContext';
import { styles } from '../styles/TIAStyles';
import Loader from '../../../Loader';
import TIAMappingFolderTree from '../ui/TIAMappingFolderTree';

/**
 * Модальное окно для маппинга компонентов на функциональные блоки Allure
 * @returns {JSX.Element|null}
 */
const TIAMappingModal = () => {
    const { 
        showMappingModal, 
        handleMappingCancel, 
        handleMappingConfirm, 
        isMappingLoading, 
        selectedComponentId, 
        components, 
        folders, 
        folderSearchTerm, 
        setFolderSearchTerm 
    } = useTIA();

    if (!showMappingModal) return null;

    const component = components.find(c => c.id === selectedComponentId);

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ backgroundColor: 'var(--bg-content)', width: '100%', maxWidth: '900px', maxHeight: '90vh', borderRadius: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {/* Header */}
                <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to right, var(--bg-content), var(--bg-input))', borderRadius: '32px 32px 0 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <h3 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            Выбор функциональных блоков
                        </h3>
                        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                            Для компонента: <span style={{ fontWeight: 700, color: 'var(--primary-accent)' }}>{component?.name || 'Безымянный'}</span>
                        </p>
                    </div>
                    <button onClick={handleMappingCancel} style={{ padding: '8px', borderRadius: '12px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-input)' } }}>
                        <span style={{ fontSize: '24px', color: 'var(--text-muted)' }}>×</span>
                    </button>
                </div>

                {/* Search */}
                <div style={{ padding: '16px 40px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <input
                            type="text"
                            placeholder="Поиск по названию блока или ID в дереве..."
                            value={folderSearchTerm}
                            onChange={(e) => setFolderSearchTerm(e.target.value)}
                            style={{ ...styles.select, padding: '14px 16px 14px 20px', width: '100%' }}
                        />
                    </div>
                </div>

                {/* Tree Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', background: 'var(--bg-content)' }}>
                    {isMappingLoading ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', gap: '20px' }}>
                            <Loader size="48px" color="var(--primary-accent)" />
                            <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-muted)' }}>Анализируем структуру блоков...</span>
                        </div>
                    ) : (
                        <TIAMappingFolderTree folders={folders} />
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '32px 40px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '16px', borderRadius: '0 0 32px 32px' }}>
                    <button onClick={handleMappingCancel} style={styles.modalButtonCancel}>
                        Отмена
                    </button>
                    <button onClick={handleMappingConfirm} style={styles.modalButtonConfirm}>
                        Готово
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TIAMappingModal;
