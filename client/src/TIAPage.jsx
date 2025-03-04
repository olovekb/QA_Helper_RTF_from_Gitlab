// client/src/components/TIAPage.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';

// Компонент для страницы Test Impact Analysis (TIA)
const TIAPage = ({ projects }) => {
    const [projectId, setProjectId] = useState('');
    const [frontendJSON, setFrontendJSON] = useState(null);
    const [backendJSON, setBackendJSON] = useState(null);
    const [jiraLink, setJiraLink] = useState('');
    const [folders, setFolders] = useState([]);
    const [expandedFolders, setExpandedFolders] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [allureLink, setAllureLink] = useState('');

    // Состояния для маппинга компонентов
    const [components, setComponents] = useState([]); // Список всех компонентов
    const [componentMappings, setComponentMappings] = useState({}); // Маппинг { componentId: folderId }
    const [showMappingModal, setShowMappingModal] = useState(false); // Управление модальным окном

    useEffect(() => {
        console.log('Projects in TIAPage:', projects);
    }, [projects]);

    useEffect(() => {
        return () => {
            setProjectId('');
            setFrontendJSON(null);
            setBackendJSON(null);
            setJiraLink('');
            setFolders([]);
            setExpandedFolders({});
            setError('');
            setSuccessMessage('');
            setAllureLink('');
            setComponents([]);
            setComponentMappings({});
            setShowMappingModal(false);
        };
    }, []);

    const handleProjectChange = async (e) => {
        const selectedProjectId = e.target.value;
        setProjectId(selectedProjectId);
        setError('');
        setSuccessMessage('');
        setFolders([]);
        setExpandedFolders({});

        if (selectedProjectId) {
            setIsLoading(true);
            try {
                const response = await axios.get(`http://localhost:5001/api/structure`, {
                    params: { projectId: selectedProjectId, skipCustomFieldIds: '-3' },
                });

                const { folders: fetchedFolders } = response.data;
                setFolders(fetchedFolders || []);
            } catch (err) {
                setError('Не удалось загрузить структуру проекта. Попробуйте позже.');
                logError('Fetch structure error', err.message);
            } finally {
                setIsLoading(false);
            }
        }
    };

    const handleFrontendJSONUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    console.log('Frontend JSON loaded:', json);
                    setFrontendJSON(json);
                    setError('');
                } catch (err) {
                    setError('Неверный формат JSON-файла для фронтенда.');
                    logError('Frontend JSON parse error', err.message);
                }
            };
            reader.readAsText(file);
        }
    };

    const handleBackendJSONUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    console.log('Backend JSON loaded:', json);
                    setBackendJSON(json);
                    setError('');
                } catch (err) {
                    setError('Неверный формат JSON-файла для бэкенда.');
                    logError('Backend JSON parse error', err.message);
                }
            };
            reader.readAsText(file);
        }
    };

    const handleJiraLinkChange = (e) => {
        setJiraLink(e.target.value);
        setError('');
    };

    const handleFolderToggle = (folderId) => {
        setExpandedFolders((prev) => ({
            ...prev,
            [folderId]: !prev[folderId],
        }));
    };

    // Обновленная функция извлечения компонентов из JSON-файлов с отладкой
    const extractComponents = () => {
        console.log('Extracting components - frontendJSON:', frontendJSON);
        console.log('Extracting components - backendJSON:', backendJSON);

        // Извлечение фронтенд-компонентов
        const frontendComponents = frontendJSON?.frontendComponent?.map((comp, index) => ({
            id: `${comp.name}-${index}`, // Генерируем ID
            name: comp.name,
            type: 'frontend',
            endpoints: [], // У фронтенда нет эндпоинтов
        })) || [];

        // Извлечение бэкенд-компонентов (контроллеров) с их эндпоинтами
        const backendComponents = backendJSON?.Controllers?.map((controller, index) => ({
            id: `${controller.ControllerName}-${index}`, // Генерируем ID
            name: controller.ControllerName,
            type: 'backend',
            endpoints: controller.Endpoints || [], // Сохраняем список эндпоинтов
        })) || [];

        const allComponents = [...frontendComponents, ...backendComponents];
        console.log('Extracted components:', allComponents);
        return allComponents;
    };

    // Обновленная функция добавления маппинга компонента через API
    const saveComponentMapping = async (component, folderId) => {
        try {
            await axios.post('http://localhost:5001/api/components', {
                projectId,
                componentType: component.type,
                componentName: component.name, // Добавляем имя компонента
                functionalBlock: folderId,
            });
        } catch (err) {
            logError('Save component mapping error', err.message);
            throw new Error(`Не удалось сохранить маппинг для компонента ${component.name}.`);
        }
    };

    // Обновленная функция создания тест-плана с отладкой
    const handleCreateTestPlan = async () => {
        console.log('Starting handleCreateTestPlan - projectId:', projectId);
        console.log('Starting handleCreateTestPlan - frontendJSON:', frontendJSON);
        console.log('Starting handleCreateTestPlan - backendJSON:', backendJSON);
        console.log('Starting handleCreateTestPlan - jiraLink:', jiraLink);

        if (!projectId) {
            setError('Выберите проект.');
            console.log('Error: No project selected');
            return;
        }
        if (!frontendJSON && !backendJSON) {
            setError('Загрузите хотя бы один JSON-файл (фронтенд или бэкенд).');
            console.log('Error: No JSON files uploaded');
            return;
        }
        if (!jiraLink) {
            setError('Введите ссылку на задачу в Jira.');
            console.log('Error: No Jira link provided');
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccessMessage('');

        try {
            const extractedComponents = extractComponents();
            console.log('Extracted components in handleCreateTestPlan:', extractedComponents);

            if (extractedComponents.length === 0) {
                setError('Компоненты не найдены в загруженных JSON-файлах. Проверьте структуру файлов.');
                console.log('Error: No components extracted');
                setIsLoading(false);
                return;
            }

            setComponents(extractedComponents);
            setComponentMappings({});
            setShowMappingModal(true);
            console.log('Successfully opened mapping modal');
        } catch (err) {
            setError('Произошла ошибка при обработке компонентов. Проверьте данные и повторите попытку.');
            logError('Component extraction error', err.message);
            console.log('Error in handleCreateTestPlan:', err.message);
            setIsLoading(false);
        }
    };

    // Функция для создания тест-плана после маппинга
    const createTestPlan = async () => {
        try {
            const usedFunctionalBlocks = folders
                .filter(folder => Object.values(componentMappings).includes(folder.id))
                .map(folder => ({
                    id: folder.id,
                    name: folder.name,
                    customFieldId: folder.customFieldId,
                    customFieldName: folder.customFieldName,
                }));

            const formData = new FormData();
            if (frontendJSON) formData.append('frontendJson', new Blob([JSON.stringify(frontendJSON)], { type: 'application/json' }));
            if (backendJSON) formData.append('backendJson', new Blob([JSON.stringify(backendJSON)], { type: 'application/json' }));

            const response = await axios.post('http://localhost:5001/api/launch', {
                jiraTaskUrl: jiraLink,
                projectId,
                functionalBlocks: usedFunctionalBlocks,
            }, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });

            const { allureLink } = response.data;
            setSuccessMessage('Тест-план успешно создан!');
            setAllureLink(allureLink);
        } catch (err) {
            setError('Произошла ошибка при создании тест-плана. Проверьте данные и повторите попытку.');
            logError('Test plan creation error', err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Обработчик подтверждения маппинга
    const handleMappingConfirm = async () => {
        setIsLoading(true);
        try {
            for (const component of components) {
                const folderId = componentMappings[component.id];
                if (folderId) {
                    await saveComponentMapping(component, folderId);
                }
            }
            await createTestPlan();
            setShowMappingModal(false);
        } catch (err) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    const handleMappingCancel = () => {
        setShowMappingModal(false);
        setComponentMappings({});
        setComponents([]);
        setIsLoading(false);
    };

    const handleMappingChange = (componentId, folderId) => {
        setComponentMappings((prev) => ({
            ...prev,
            [componentId]: folderId,
        }));
    };

    const logError = async (errorType, description) => {
        try {
            await axios.post('http://localhost:5001/api/errors', {
                errorType,
                description,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            console.error('Failed to log error:', err);
        }
    };

    const renderFolderTree = (folders, level = 0) => {
        return folders.map((folder) => (
            <div
                key={folder.id}
                style={{
                    marginLeft: `${level * 20}px`,
                    marginBottom: '12px',
                    transition: 'all 0.3s ease',
                }}
            >
                <div
                    style={{
                        cursor: 'pointer',
                        padding: level === 0 ? '12px 16px' : '8px 12px',
                        backgroundColor: level === 0 ? '#dfe6e9' : '#e8ecef',
                        color: '#343a40',
                        border: '1px solid #ced4da',
                        borderRadius: '6px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                        transition: 'background-color 0.2s, transform 0.1s',
                        '&:hover': {
                            backgroundColor: level === 0 ? '#c8d6e5' : '#dee2e6',
                            transform: 'translateY(-1px)',
                        },
                    }}
                    onClick={() => handleFolderToggle(folder.id)}
                >
                    {folder.children && folder.children.length > 0 && (
                        <span style={{ marginRight: '8px', color: '#495057' }}>
                            {expandedFolders[folder.id] ? '▼' : '►'}
                        </span>
                    )}
                    <span style={{ fontWeight: level === 0 ? '600' : '400' }}>
                        {folder.customFieldName} - {folder.name}
                    </span>
                </div>
                {expandedFolders[folder.id] && folder.children && folder.children.length > 0 && (
                    <div
                        style={{
                            marginTop: '8px',
                            transition: 'max-height 0.3s ease',
                            maxHeight: expandedFolders[folder.id] ? '1000px' : '0',
                            overflow: 'hidden',
                        }}
                    >
                        {renderFolderTree(folder.children, level + 1)}
                    </div>
                )}
            </div>
        ));
    };

    // Функция для рендеринга списка папок в виде выпадающего списка
    const renderFolderOptions = (folders, level = 0) => {
        let options = [];
        folders.forEach((folder) => {
            options.push(
                <option key={folder.id} value={folder.id}>
                    {'-'.repeat(level)} {folder.customFieldName} - {folder.name}
                </option>
            );
            if (folder.children && folder.children.length > 0) {
                options = options.concat(renderFolderOptions(folder.children, level + 1));
            }
        });
        return options;
    };

    // Проверка, можно ли активировать кнопку "Создать тест-план"
    const isCreateButtonDisabled = () => {
        return !projectId || (!frontendJSON && !backendJSON) || !jiraLink || isLoading;
    };

    return (
        <div style={styles.container}>
            <h1 style={styles.header}>Test Impact Analysis (TIA)</h1>

            <div style={styles.form}>
                <div style={styles.formGroup}>
                    <label style={styles.label}>Выберите проект:</label>
                    <select
                        value={projectId}
                        onChange={handleProjectChange}
                        style={styles.select}
                        disabled={isLoading}
                    >
                        <option value="">-- Выберите проект --</option>
                        {projects && projects.length > 0 ? (
                            projects.map((proj) => (
                                <option key={proj.id} value={proj.id}>
                                    {proj.name}
                                </option>
                            ))
                        ) : (
                            <option value="" disabled>
                                Проекты не доступны
                            </option>
                        )}
                    </select>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON фронтенда (опционально):</label>
                    <input
                        type="file"
                        accept=".json"
                        onChange={handleFrontendJSONUpload}
                        style={styles.fileInput}
                        disabled={isLoading}
                    />
                </div>
                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON бэкенда (опционально):</label>
                    <input
                        type="file"
                        accept=".json"
                        onChange={handleBackendJSONUpload}
                        style={styles.fileInput}
                        disabled={isLoading}
                    />
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Ссылка на задачу в Jira:</label>
                    <input
                        type="text"
                        value={jiraLink}
                        onChange={handleJiraLinkChange}
                        placeholder="https://jira.example.com/task/123"
                        style={styles.input}
                        disabled={isLoading}
                    />
                </div>

                {folders.length > 0 && (
                    <div style={styles.mappingSection}>
                        <h2 style={styles.subHeader}>Структура папок</h2>
                        {renderFolderTree(folders)}
                    </div>
                )}

                <button
                    onClick={handleCreateTestPlan}
                    style={styles.submitButton}
                    disabled={isCreateButtonDisabled()}
                >
                    {isLoading ? 'Создание...' : 'Создать тест-план'}
                </button>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            {successMessage && (
                <div style={styles.success}>
                    {successMessage}
                    {allureLink && (
                        <div>
                            <a href={allureLink} target="_blank" rel="noopener noreferrer">
                                Перейти к тест-плану в Allure
                            </a>
                        </div>
                    )}
                </div>
            )}

            {isLoading && <div style={styles.loader}>Загрузка...</div>}

            {/* Модальное окно для маппинга */}
            {showMappingModal && (
                <div style={styles.modalOverlay}>
                    <div style={styles.modal}>
                        <h2 style={styles.modalHeader}>Сопоставление компонентов</h2>
                        <div style={styles.modalContent}>
                            {components.length === 0 ? (
                                <div style={styles.noComponents}>
                                    Компоненты не найдены. Проверьте загруженные JSON-fайлы.
                                </div>
                            ) : (
                                components.map((comp) => (
                                    <div key={comp.id} style={styles.mappingRow}>
                                        <div style={styles.componentContainer}>
                                            {/* Название компонента с цветовой индикацией */}
                                            <span
                                                style={{
                                                    ...styles.mappingLabel,
                                                    color: componentMappings[comp.id] ? '#28a745' : '#ffc107',
                                                }}
                                            >
                                                {comp.type}: {comp.name}
                                            </span>
                                            {/* Список API-методов для бэкенд-компонентов */}
                                            {comp.type === 'backend' && comp.endpoints.length > 0 && (
                                                <ul style={styles.endpointList}>
                                                    {comp.endpoints.map((endpoint, index) => (
                                                        <li key={`${comp.id}-endpoint-${index}`} style={styles.endpointItem}>
                                                            -- {endpoint.HttpMethod} {endpoint.RoutePath}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                        <select
                                            value={componentMappings[comp.id] || ''}
                                            onChange={(e) => handleMappingChange(comp.id, e.target.value)}
                                            style={styles.mappingSelect}
                                        >
                                            <option value="">-- Выберите функциональный блок --</option>
                                            {renderFolderOptions(folders)}
                                        </select>
                                    </div>
                                ))
                            )}
                        </div>
                        <div style={styles.modalActions}>
                            <button
                                onClick={handleMappingCancel}
                                style={styles.modalButtonCancel}
                            >
                                Отмена
                            </button>
                            <button
                                onClick={handleMappingConfirm}
                                style={styles.modalButtonConfirm}
                                disabled={Object.keys(componentMappings).length < components.length || components.length === 0}
                            >
                                Подтвердить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Стили
const styles = {
    container: {
        padding: '20px',
        maxWidth: '800px',
        margin: '0 auto',
        backgroundColor: '#f1f3f5',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
    },
    header: {
        fontSize: '24px',
        marginBottom: '20px',
        textAlign: 'center',
        color: '#343a40',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
    },
    formGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
    },
    label: {
        fontSize: '16px',
        fontWeight: 'bold',
        color: '#343a40',
    },
    select: {
        padding: '8px',
        fontSize: '14px',
        borderRadius: '5px',
        border: '1px solid #ced4da',
        color: '#343a40',
        backgroundColor: '#fff',
        transition: 'border-color 0.2s',
        '&:focus': {
            borderColor: '#007bff',
            outline: 'none',
        },
    },
    fileInput: {
        padding: '8px 0',
    },
    input: {
        padding: '8px',
        fontSize: '14px',
        borderRadius: '5px',
        border: '1px solid #ced4da',
        color: '#343a40',
        transition: 'border-color 0.2s',
        '&:focus': {
            borderColor: '#007bff',
            outline: 'none',
        },
    },
    mappingSection: {
        marginTop: '20px',
        padding: '10px',
        backgroundColor: '#fff',
        borderRadius: '6px',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.05)',
    },
    subHeader: {
        fontSize: '20px',
        marginBottom: '10px',
        color: '#343a40',
    },
    submitButton: {
        padding: '10px 20px',
        fontSize: '16px',
        color: '#fff',
        backgroundColor: '#28a745',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        marginTop: '20px',
        transition: 'background-color 0.2s, transform 0.1s',
        '&:hover': {
            backgroundColor: '#218838',
            transform: 'translateY(-1px)',
        },
        '&:disabled': {
            backgroundColor: '#6c757d',
            cursor: 'not-allowed',
        },
    },
    error: {
        marginTop: '20px',
        padding: '10px',
        backgroundColor: '#f8d7da',
        color: '#721c24',
        borderRadius: '5px',
        textAlign: 'center',
    },
    success: {
        marginTop: '20px',
        padding: '10px',
        backgroundColor: '#d4edda',
        color: '#155724',
        borderRadius: '5px',
        textAlign: 'center',
    },
    loader: {
        marginTop: '20px',
        textAlign: 'center',
        fontSize: '16px',
        color: '#007bff',
    },
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: '0',
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    modal: {
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '8px',
        width: '500px',
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    },
    modalHeader: {
        fontSize: '20px',
        marginBottom: '20px',
        color: '#343a40',
        borderBottom: '1px solid #ced4da',
        paddingBottom: '10px',
    },
    modalContent: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
    },
    noComponents: {
        fontSize: '14px',
        color: '#721c24',
        textAlign: 'center',
    },
    mappingRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
    },
    componentContainer: {
        flex: '1',
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
    },
    mappingLabel: {
        fontSize: '14px',
        color: '#343a40',
    },
    endpointList: {
        margin: 0,
        paddingLeft: '20px',
        fontSize: '12px',
        color: '#6c757d',
    },
    endpointItem: {
        marginBottom: '2px',
    },
    mappingSelect: {
        flex: '2',
        padding: '6px',
        fontSize: '14px',
        borderRadius: '5px',
        border: '1px solid #ced4da',
        color: '#343a40',
        backgroundColor: '#fff',
    },
    modalActions: {
        marginTop: '20px',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
    },
    modalButtonCancel: {
        padding: '8px 16px',
        fontSize: '14px',
        color: '#fff',
        backgroundColor: '#6c757d',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        '&:hover': {
            backgroundColor: '#5a6268',
        },
    },
    modalButtonConfirm: {
        padding: '8px 16px',
        fontSize: '14px',
        color: '#fff',
        backgroundColor: '#28a745',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        '&:hover': {
            backgroundColor: '#218838',
        },
        '&:disabled': {
            backgroundColor: '#6c757d',
            cursor: 'not-allowed',
        },
    },
};

export default TIAPage;