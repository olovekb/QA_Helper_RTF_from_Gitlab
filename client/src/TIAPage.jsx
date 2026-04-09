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
        showMappingModal,
        isMappingLoading,
        handleMappingCancel,
        handleMappingConfirm,
        handlePartialSave,
        isPartialSaving,
        partialSaveMessage,
        handleCreateTestPlan,
        isCreateButtonDisabled,
        getCreateButtonDisabledReason,
        structureLoading
    } = useTIA();

    useEffect(() => {
        if (frontendJSON || backendJSON || tiaReport) {
            const extracted = extractComponents(frontendJSON, backendJSON, tiaReport);
            setComponents(extracted);
        }
    }, [frontendJSON, backendJSON, tiaReport, setComponents]);

    return (
        <div style={TIAStyles.container} className="app-page-container">
            {/* Глобальный фоновый прогресс-бар */}
            <GlobalBackgroundProgress />

            <TIAPageHeader />

            {/* Форма настройки */}
            <div style={TIAStyles.setupCard}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <TIAModeToggle />
                    <TIAProjectSelect />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <label style={TIAStyles.label}>
                            Загрузить JSON фронтенда (опционально)
                        </label>
                        <TIAJSONUpload type="frontend" />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <label style={TIAStyles.label}>
                            Загрузить JSON бэкенда (опционально)
                        </label>
                        <TIAJSONUpload type="backend" />
                    </div>
                </div>
            </div>

            <TIALightSummary />

            <div style={{ marginTop: '48px', paddingTop: '32px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
                {error && !showMappingModal && <div style={{ padding: '16px 24px', backgroundColor: 'var(--error-bg)', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: '16px', fontSize: '14px', fontWeight: 600, textAlign: 'center', width: '100%', boxShadow: '0 4px 12px color-mix(in srgb, var(--error) 10%, transparent)' }}>{error}</div>}
                {successMessage && (
                    <div style={{
                        padding: '20px 28px',
                        backgroundColor: 'var(--bg-content)',
                        border: '1px solid var(--success)',
                        color: 'var(--text-primary)',
                        borderRadius: '20px',
                        fontSize: '15px',
                        fontWeight: 700,
                        textAlign: 'center',
                        width: '100%',
                        boxShadow: 'var(--shadow-md)'
                    }}>
                        <div style={{ marginBottom: allureLink ? '16px' : '0', color: 'var(--success)' }}>
                            {successMessage}
                        </div>
                        {allureLink && (
                            <a
                                href={allureLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    color: '#fff',
                                    backgroundColor: 'var(--primary-accent)',
                                    padding: '10px 28px',
                                    borderRadius: '14px',
                                    display: 'inline-block',
                                    fontWeight: 800,
                                    textDecoration: 'none',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: '0 8px 20px color-mix(in srgb, var(--primary-accent) 30%, transparent)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.02em',
                                    fontSize: '13px'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 12px 24px color-mix(in srgb, var(--primary-accent) 40%, transparent)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 8px 20px color-mix(in srgb, var(--primary-accent) 30%, transparent)';
                                }}
                            >
                                Перейти к запуску в ТестОпс
                            </a>
                        )}
                    </div>
                )}


                {mode === 'mapping' && (
                    <button
                        onClick={handleCreateTestPlan}
                        disabled={isCreateButtonDisabled()}
                        title={getCreateButtonDisabledReason()}
                        style={{
                            padding: '18px 48px',
                            fontSize: '16px',
                            fontWeight: 800,
                            color: '#ffffff',
                            background: isCreateButtonDisabled() ? 'var(--border-color)' : 'linear-gradient(135deg, var(--success) 0%, var(--primary-accent) 100%)',
                            border: 'none',
                            borderRadius: '18px',
                            cursor: isCreateButtonDisabled() ? 'not-allowed' : 'pointer',
                            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: isCreateButtonDisabled() ? 'none' : '0 12px 30px -5px color-mix(in srgb, var(--primary-accent) 40%, transparent)',
                            width: '100%',
                            maxWidth: '450px',
                            opacity: isCreateButtonDisabled() ? 0.6 : 1,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                        }}
                    >
                        {isLoading ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                                <Loader color="#fff" size="24px" />
                                <span>Обработка...</span>
                            </div>
                        ) : 'Создать запуски тестирования'}
                    </button>
                )}
            </div>

            {showMappingModal && (
                <div style={TIAStyles.mappingModalOverlay}>
                    <div style={TIAStyles.mappingModalContent}>
                        <div style={{
                            padding: '24px 32px',
                            borderBottom: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-input)',
                            flexShrink: 0,
                            zIndex: 10
                        }}>
                            <h2 style={{
                                ...TIAStyles.title,
                                margin: 0,
                                fontSize: '24px'
                            }}>
                                Сопоставление компонентов
                            </h2>
                            {(partialSaveMessage || error) && (
                                <div style={{ marginTop: '16px' }}>
                                    {partialSaveMessage && (
                                        <div style={{
                                            padding: '10px 16px',
                                            backgroundColor: 'var(--bg-content)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '14px',
                                            color: 'var(--text-muted)',
                                            fontSize: '14px',
                                            fontWeight: 700,
                                            boxShadow: 'var(--shadow-sm)'
                                        }}>
                                            {partialSaveMessage}
                                        </div>
                                    )}
                                    {error && (
                                        <div style={{
                                            padding: '10px 16px',
                                            backgroundColor: 'var(--error-bg)',
                                            borderRadius: '14px',
                                            border: '1px solid var(--error)',
                                            color: 'var(--error)',
                                            fontSize: '14px',
                                            fontWeight: 700
                                        }}>
                                            {error}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                            <TIAMappingView />
                        </div>

                        {/* Футер модалки */}
                        <div style={{
                            padding: '20px 32px',
                            borderTop: '1px solid var(--border-color)',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '16px',
                            backgroundColor: 'var(--bg-input)',
                            flexShrink: 0,
                            zIndex: 10
                        }}>
                            <div style={{ flex: 1, color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {isPartialSaving && <span>Сохраняем изменения...</span>}
                            </div>
                            <button
                                onClick={handleMappingCancel}
                                style={{
                                    padding: '12px 28px',
                                    borderRadius: '16px',
                                    fontWeight: 800,
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                    backgroundColor: 'transparent',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-muted)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em'
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
                                    fontWeight: 800,
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    backgroundColor: 'var(--bg-content)',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-primary)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    boxShadow: 'var(--shadow-sm)'
                                }}
                                disabled={isPartialSaving || isMappingLoading}
                            >
                                {isPartialSaving
                                    ? <Loader color="var(--primary-accent)" size="20px" />
                                    : 'Сохранить маппинг'}
                            </button>
                            <button
                                onClick={() => handleMappingConfirm('launch')}
                                style={{
                                    padding: '12px 32px',
                                    borderRadius: '16px',
                                    fontWeight: 800,
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    backgroundColor: 'var(--primary-accent)',
                                    border: 'none',
                                    color: '#ffffff',
                                    boxShadow: '0 8px 20px color-mix(in srgb, var(--primary-accent) 30%, transparent)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em'
                                }}
                                disabled={isPartialSaving || isMappingLoading || isCreateButtonDisabled()}
                                title={getCreateButtonDisabledReason()}
                            >
                                {isMappingLoading
                                    ? <Loader color="#fff" size="20px" />
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
