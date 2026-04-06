import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TIAProvider, useTIA } from './components/TIAPage/context/TIAContext';
import { styles, setupStyles } from './components/TIAPage/styles/TIAStyles';
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
import { extractComponents } from './components/TIAPage/utils/tiaUtils';

/**
 * Внутренний контент страницы TIA, использующий контекст.
 * Переключается между Setup Mode (Screenshot 2) и Results Mode (Screenshot 1).
 * @returns {JSX.Element}
 */
const TIAPageContent = () => {
    const {
        error,
        successMessage,
        frontendJSON,
        backendJSON,
        tiaReport,
        setComponents,
        hasStarted,
        setHasStarted
    } = useTIA();

    useEffect(() => {
        if (frontendJSON || backendJSON || tiaReport) {
            const extracted = extractComponents(frontendJSON, backendJSON, tiaReport);
            setComponents(extracted);
        }
    }, [frontendJSON, backendJSON, tiaReport, setComponents]);

    const handleStart = () => {
        setHasStarted(true);
    };

    return (
        <div style={{
            ...styles.container,
            backgroundColor: '#f8fafc',
            minHeight: '100vh',
            padding: '60px 0'
        }}>
            <GlobalBackgroundProgress />

            <div style={{
                maxWidth: '1100px',
                margin: '0 auto',
                padding: '0 40px'
            }}>
                {/* Dynamic Header */}
                <TIAPageHeader />

                {!hasStarted ? (
                    // --- SETUP MODE (Screenshot 2) ---
                    <div style={{ ...setupStyles.setupCard, marginTop: '20px' }}>
                        <TIAModeToggle />
                        <TIAProjectSelect />
                        <TIAJSONUpload />
                        
                        <button 
                            onClick={handleStart}
                            style={setupStyles.mainButton}
                            onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                        >
                            Создать запуски тестирования
                        </button>
                    </div>
                ) : (
                    // --- RESULTS MODE (Screenshot 1) ---
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                        {/* Compact Setup Panel for Results Page */}
                        <div style={{
                            ...setupStyles.setupCard,
                            padding: '32px 48px',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr 1fr',
                            gap: '32px',
                            alignItems: 'end',
                            borderRadius: '24px'
                        }}>
                            <TIAProjectSelect />
                            <div style={{ gridColumn: 'span 2' }}>
                                <TIAJSONUpload />
                            </div>
                        </div>

                        {/* Analysis & Mapping */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                            <TIALightSummary />
                            <TIAMappingView />
                        </div>
                    </div>
                )}
            </div>

            {/* Notifications */}
            {(error || successMessage) && (
                <div style={{ position: 'fixed', bottom: '32px', right: '32px', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {error && (
                        <div style={{ backgroundColor: '#fee2e2', color: '#dc2626', padding: '16px 24px', borderRadius: '16px', fontWeight: 700, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #fecaca' }}>
                            {error}
                        </div>
                    )}
                    {successMessage && (
                        <div style={{ backgroundColor: '#dcfce7', color: '#16a34a', padding: '16px 24px', borderRadius: '16px', fontWeight: 700, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #bbf7d0' }}>
                            {successMessage}
                        </div>
                    )}
                </div>
            )}

            {/* Modals */}
            <TIASplitModal />
            <TIAUnmappedModal />
            <TIAEmptyGroupsModal />
        </div>
    );
};

/**
 * Основной компонент страницы Test Impact Analysis
 */
const TIAPage = ({ projects, ...props }) => {
    return (
        <TIAProvider projects={projects}>
            <TIAPageContent {...props} />
        </TIAProvider>
    );
};

export default TIAPage;
