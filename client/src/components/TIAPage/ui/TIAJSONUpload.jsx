import React from 'react';
import { useTIA } from '../context/TIAContext';
import TIAStyles, { setupStyles } from '../styles/TIAStyles';

/**
 * Загрузка JSON файлов для TIA
 */
const TIAJSONUpload = ({ type }) => {
    const {
        frontendJSON,
        backendJSON,
        frontendFileName,
        backendFileName,
        isLoading,
        handleFrontendJSONUpload,
        handleBackendJSONUpload,
        setFrontendJSON,
        setBackendJSON,
        setFrontendFileName,
        setBackendFileName,
        setTiaReport
    } = useTIA();

    const fileInputRef = React.useRef(null);

    const isFrontend = type === 'frontend';
    const currentJSON = isFrontend ? frontendJSON : backendJSON;
    const currentFileName = isFrontend ? frontendFileName : backendFileName;
    const uploadHandler = isFrontend ? handleFrontendJSONUpload : handleBackendJSONUpload;

    const handleRemove = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }

        if (isFrontend) {
            setFrontendJSON(null);
            setFrontendFileName('');
        } else {
            setBackendJSON(null);
            setBackendFileName('');
        }

        if ((isFrontend && !backendJSON) || (!isFrontend && !frontendJSON)) {
            setTiaReport(null);
        }
    };

    return (
        <div style={{
            ...setupStyles.uploadContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
        }}>
            <div style={{ width: '130px', overflow: 'hidden', flexShrink: 0 }}>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={uploadHandler}
                    style={{ ...setupStyles.fileInput, width: '200%', color: 'transparent' }}
                    disabled={isLoading}
                />
            </div>

            {currentJSON && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                    <span
                        title={currentFileName || (isFrontend ? 'frontend.json' : 'backend.json')}
                        style={setupStyles.fileName}
                    >
                        {currentFileName || (isFrontend ? 'frontend.json' : 'backend.json')}
                    </span>
                    <button
                        onClick={handleRemove}
                        style={TIAStyles.removeButton}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--error)';
                            e.currentTarget.style.color = '#fff';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--error-bg)';
                            e.currentTarget.style.color = 'var(--error)';
                        }}
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
};

export default TIAJSONUpload;
