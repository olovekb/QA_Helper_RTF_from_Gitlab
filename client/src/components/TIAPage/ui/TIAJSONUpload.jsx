import React, { useRef } from 'react';
import { useTIA } from '../context/TIAContext';
import { setupStyles } from '../styles/TIAStyles';

/**
 * Компонент загрузки JSON файлов для фронтенда и бэкенда
 * @returns {JSX.Element}
 */
const TIAJSONUpload = () => {
    const { 
        handleFrontendJSONUpload, 
        handleBackendJSONUpload,
        frontendFileName,
        backendFileName,
        setFrontendFileName,
        setBackendFileName,
        setFrontendJSON,
        setBackendJSON
    } = useTIA();

    const frontendInputRef = useRef(null);
    const backendInputRef = useRef(null);

    const handleRemoveFile = (type) => {
        if (type === 'frontend') {
            setFrontendJSON(null);
            setFrontendFileName('');
        } else {
            setBackendJSON(null);
            setBackendFileName('');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {/* Frontend JSON */}
            <div>
                <h3 style={setupStyles.sectionTitle}>Загрузить JSON Фронтенда (Опционально)</h3>
                <div style={setupStyles.uploadBox(!!frontendFileName)}>
                    <input
                        type="file"
                        ref={frontendInputRef}
                        onChange={(e) => handleFrontendJSONUpload(e.target.files[0])}
                        style={{ display: 'none' }}
                        accept=".json"
                    />
                    <button 
                        onClick={() => frontendInputRef.current.click()}
                        style={setupStyles.uploadButton}
                        onMouseOver={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                        onMouseOut={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                    >
                        Выберите файл
                    </button>

                    {frontendFileName && (
                        <div style={setupStyles.fileTag}>
                            <span>{frontendFileName}</span>
                            <button 
                                onClick={() => handleRemoveFile('frontend')}
                                style={setupStyles.removeFileBtn}
                            >
                                ×
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Backend JSON */}
            <div>
                <h3 style={setupStyles.sectionTitle}>Загрузить JSON Бэкенда (Опционально)</h3>
                <div style={setupStyles.uploadBox(!!backendFileName)}>
                    <input
                        type="file"
                        ref={backendInputRef}
                        onChange={(e) => handleBackendJSONUpload(e.target.files[0])}
                        style={{ display: 'none' }}
                        accept=".json"
                    />
                    <button 
                        onClick={() => backendInputRef.current.click()}
                        style={setupStyles.uploadButton}
                        onMouseOver={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                        onMouseOut={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                    >
                        Выберите файл
                    </button>

                    {backendFileName && (
                        <div style={setupStyles.fileTag}>
                            <span>{backendFileName}</span>
                            <button 
                                onClick={() => handleRemoveFile('backend')}
                                style={setupStyles.removeFileBtn}
                            >
                                ×
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TIAJSONUpload;
