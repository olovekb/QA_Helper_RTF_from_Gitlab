import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTIA } from '../context/TIAContext';
import Loader from '../../../Loader';

/**
 * Хедер страницы TIA со сводной информацией и кнопками действий.
 * Поддерживает два режима: Setup (Screenshot 2) и Results (Screenshot 1).
 * @returns {JSX.Element}
 */
const TIAPageHeader = () => {
    const navigate = useNavigate();
    const {
        frontendJSON,
        backendJSON,
        tiaReport,
        handleMappingConfirm,
        loadingState,
        hasStarted
    } = useTIA();

    // --- РЕЖИМ SETUP (Screenshot 2) ---
    if (!hasStarted) {
        return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '44px' }}>
                <h1 style={{ fontSize: '42px', fontWeight: 900, color: '#1e293b', margin: 0, letterSpacing: '-0.02em' }}>Test Impact Analysis</h1>
                <div style={{ display: 'flex', gap: '20px' }}>
                    <button
                        onClick={() => navigate('/')}
                        style={{
                            padding: '14px 28px',
                            backgroundColor: '#fff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '16px',
                            color: '#1e293b',
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontSize: '15px',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.backgroundColor = '#f8fafc'}
                        onMouseOut={e => e.currentTarget.style.backgroundColor = '#fff'}
                    >
                        Назад
                    </button>
                    <button
                        onClick={() => navigate('/heatmap')}
                        style={{
                            padding: '14px 32px',
                            backgroundColor: '#007bff',
                            border: 'none',
                            borderRadius: '16px',
                            color: '#fff',
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontSize: '15px',
                            boxShadow: '0 10px 25px rgba(0, 123, 255, 0.2)',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                        onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                        Тепловая карта дефектов
                    </button>
                </div>
            </div>
        );
    }

    // --- РЕЖИМ RESULTS (Screenshot 1) ---
    return (
        <div style={{
            backgroundColor: '#fff',
            borderRadius: '40px',
            padding: '32px 48px',
            marginBottom: '40px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.05)',
            border: '1px solid rgba(255,255,255,0.3)',
            backdropFilter: 'blur(10px)',
            position: 'sticky',
            top: '20px',
            zIndex: 1000,
        }}>
            {/* Stats Section */}
            <div style={{ display: 'flex', gap: '60px' }}>
                {/* Status Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Статус данных</span>
                    <div style={{ display: 'flex', gap: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: frontendJSON ? '#10b981' : '#cbd5e1' }} />
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>Frontend</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: backendJSON ? '#10b981' : '#cbd5e1' }} />
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>Backend</span>
                        </div>
                    </div>
                </div>

                {/* Mode Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Режим</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#1e293b' }}>Маппинг</span>
                </div>
            </div>

            {/* Actions Section */}
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <button
                    onClick={handleMappingConfirm}
                    style={{
                        padding: '16px 32px',
                        backgroundColor: 'transparent',
                        border: '2px solid #e2e8f0',
                        borderRadius: '16px',
                        color: '#475569',
                        fontWeight: 700,
                        fontSize: '15px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                    }}
                    onMouseOver={e => e.currentTarget.style.borderColor = '#94a3b8'}
                    onMouseOut={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                >
                    Сохранить маппинг
                </button>

                <button
                    style={{
                        padding: '16px 40px',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '16px',
                        fontSize: '15px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.3)',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}
                    onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                    {loadingState.launch && <Loader size="18px" color="white" />}
                    {loadingState.launch ? 'Запуск...' : 'Создать запуск Allure'}
                </button>
            </div>
        </div>
    );
};

export default TIAPageHeader;
