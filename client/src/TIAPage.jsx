import React, { useEffect } from 'react';
import { TIAProvider, useTIA } from './components/TIAPage/context/TIAContext';
import TIAStyles from './components/TIAPage/styles/TIAStyles';
import TIAPageHeader from './components/TIAPage/ui/TIAPageHeader';
import TIAProjectSelect from './components/TIAPage/ui/TIAProjectSelect';
import TIAModeToggle from './components/TIAPage/ui/TIAModeToggle';
import TIAJSONUpload from './components/TIAPage/ui/TIAJSONUpload';
import TIALightSummary from './components/TIAPage/views/TIALightSummary';
import TIAMappingView from './components/TIAPage/views/TIAMappingView';
import TIASplitModal from './components/TIAPage/modals/TIASplitModal';
import TIAUnmappedModal from './components/TIAPage/modals/TIAUnmappedModal';
import TIAEmptyGroupsModal from './components/TIAPage/modals/TIAEmptyGroupsModal';
import GlobalBackgroundProgress from './components/GlobalBackgroundProgress';
import Loader from './Loader';
import { extractComponents } from './components/TIAPage/utils/tiaUtils';

/**
 * Внутренний контент страницы TIA
 */
const TIAPageContent = () => {
    const {
        error,
        successMessage,
        allureLink,
        frontendJSON,
        backendJSON,
        tiaReport,
        setComponents,
        mode,
        isLoading,
        structureLoading,
        showMappingModal,
        isMappingLoading,
        handleMappingCancel,
        handleMappingConfirm,
        handlePartialSave,
        isPartialSaving,
        partialSaveMessage,
        handleCreateTestPlan,
        isCreateButtonDisabled,
        getCreateButtonDisabledReason
    } = useTIA();

    useEffect(() => {
        if (frontendJSON || backendJSON || tiaReport) {
            const extracted = extractComponents(frontendJSON, backendJSON, tiaReport);
            setComponents(extracted);
        }
    }, [frontendJSON, backendJSON, tiaReport, setComponents]);

    return (
        <div style={TIAStyles.container}>
            {/* Глобальный фоновый прогресс-бар */}
            <GlobalBackgroundProgress />

            {/* Хедер страницы (Заголовок + Кнопки навигации) */}
            <TIAPageHeader />

            {/* Форма настройки (Setup Form) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', marginBottom: '28px' }}>
                <TIAModeToggle />
                <TIAProjectSelect />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                        Загрузить JSON фронтенда (опционально):
                    </label>
                    <TIAJSONUpload type="frontend" />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                        Загрузить JSON бэкенда (опционально):
                    </label>
                    <TIAJSONUpload type="backend" />
                </div>
            </div>

            {/* Сводка в лайт-режиме (если есть отчет) */}
            <TIALightSummary />

            {/* Футер страницы (Ошибки, Успех, Лоадер и Кнопка действия) */}
            <div style={{ marginTop: '40px', paddingTop: '24px', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                {error && !showMappingModal && <div style={{ padding: '14px 20px', backgroundColor: '#fef2f2', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '12px', fontSize: '14px', fontWeight: 500, textAlign: 'center', width: '100%' }}>{error}</div>}
                {successMessage && (
                    <div style={{
                        padding: '16px 24px',
                        backgroundColor: '#fff',
                        border: '1px solid #e2e8f0',
                        color: '#334155',
                        borderRadius: '16px',
                        fontSize: '14px',
                        fontWeight: 600,
                        textAlign: 'center',
                        width: '100%',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
                    }}>
                        <div style={{ marginBottom: allureLink ? '12px' : '0' }}>
                            {successMessage}
                        </div>
                        {allureLink && (
                            <a
                                href={allureLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    color: '#fff',
                                    backgroundColor: '#6366f1',
                                    padding: '8px 20px',
                                    borderRadius: '10px',
                                    display: 'inline-block',
                                    fontWeight: 600,
                                    textDecoration: 'none',
                                    transition: 'all 0.2s',
                                    boxShadow: '0 4px 10px rgba(99, 102, 241, 0.2)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4f46e5'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6366f1'}
                            >
                                Перейти к запуску в Allure
                            </a>
                        )}
                    </div>
                )}

                {(isLoading || structureLoading) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                        <Loader />
                        <div style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>
                            {structureLoading ? 'Загрузка структуры проекта...' : 'Анализ изменений...'}
                        </div>
                    </div>
                )}

                {mode === 'mapping' && (
                    <button
                        onClick={handleCreateTestPlan}
                        disabled={isCreateButtonDisabled()}
                        title={getCreateButtonDisabledReason()}
                        style={{
                            padding: '16px 40px',
                            fontSize: '16px',
                            fontWeight: 700,
                            color: '#ffffff',
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            border: 'none',
                            borderRadius: '16px',
                            cursor: isCreateButtonDisabled() ? 'not-allowed' : 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 10px 25px -5px rgba(16, 185, 129, 0.4)',
                            width: '100%',
                            maxWidth: '400px',
                            opacity: isCreateButtonDisabled() ? 0.6 : 1,
                        }}
                    >
                        {isLoading ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                <Loader style={{ width: '20px', height: '20px' }} />
                                <span>Обработка...</span>
                            </div>
                        ) : 'Создать запуски тестирования'}
                    </button>
                )}
            </div>

            {/* МОДАЛЬНОЕ ОКНО МАППИНГА (1:1 Overlay) */}
            {showMappingModal && (
                <div style={TIAStyles.mappingModalOverlay}>
                    <div style={TIAStyles.mappingModalContent}>
                        {/* Хедер модалки */}
                        {/* Хедер модалки */}
                        <div style={{
                            padding: '18px 28px',
                            borderBottom: '1px solid #e2e8f0',
                            backgroundColor: '#f1f5f9',
                            flexShrink: 0,
                            zIndex: 10
                        }}>
                            <h2 style={{
                                ...TIAStyles.title,
                                margin: 0
                            }}>
                                Сопоставление компонентов
                            </h2>
                            {(partialSaveMessage || error) && (
                                <div style={{ marginTop: '12px' }}>
                                    {partialSaveMessage && (
                                        <div style={{
                                            padding: '8px 12px',
                                            backgroundColor: '#ffffff',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '12px',
                                            color: '#64748b',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                                        }}>
                                            {partialSaveMessage}
                                        </div>
                                    )}
                                    {error && (
                                        <div style={{
                                            padding: '8px 12px',
                                            backgroundColor: '#ffeef0',
                                            borderRadius: '4px',
                                            color: '#cb2431',
                                            fontSize: '14px'
                                        }}>
                                            {error}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Воркспейс маппинга (50/50 Split) */}
                        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                            <TIAMappingView />
                        </div>

                        {/* Футер модалки */}
                        <div style={{
                            padding: '18px 28px',
                            borderTop: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '12px',
                            backgroundColor: '#f1f5f9',
                            flexShrink: 0,
                            zIndex: 10
                        }}>
                            <div style={{ flex: 1, color: '#64748b', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center' }}>
                                {isPartialSaving && <span>Сохраняем изменения...</span>}
                            </div>
                            <button
                                onClick={handleMappingCancel}
                                style={{
                                    padding: '12px 28px',
                                    borderRadius: '16px',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                    backgroundColor: 'transparent',
                                    border: '1px solid #cbd5e1',
                                    color: '#64748b'
                                }}
                                disabled={isPartialSaving || isMappingLoading}
                            >
                                Отмена
                            </button>
                            <button
                                onClick={handlePartialSave}
                                style={{
                                    padding: '12px 28px',
                                    borderRadius: '16px',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    backgroundColor: '#cbd5e1',
                                    border: 'none',
                                    color: '#334155'
                                }}
                                disabled={isPartialSaving || isMappingLoading}
                            >
                                {isPartialSaving
                                    ? <Loader style={{ width: '100%', height: 20 }} />
                                    : 'Сохранить маппинг'}
                            </button>
                            <button
                                onClick={() => handleMappingConfirm('launch')}
                                style={{
                                    padding: '12px 28px',
                                    borderRadius: '16px',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    backgroundColor: '#3b82f6',
                                    border: 'none',
                                    color: '#ffffff',
                                    boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.2)'
                                }}
                                disabled={isPartialSaving || isMappingLoading || isCreateButtonDisabled()}
                                title={getCreateButtonDisabledReason()}
                            >
                                {isMappingLoading
                                    ? <Loader style={{ width: '100%', height: 20 }} />
                                    : 'Создать запуск'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Дополнительные модалки */}
            <TIASplitModal />
            <TIAUnmappedModal />
            <TIAEmptyGroupsModal />
        </div>
    );
};

const TIAPage = ({ projects, ...props }) => {
    return (
        <TIAProvider projects={projects}>
            <TIAPageContent {...props} />
        </TIAProvider>
    );
};

export default TIAPage;
