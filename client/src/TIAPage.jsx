// client/src/components/TIAPage.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const TIAPage = ({ projects }) => {
    const [projectId, setProjectId] = useState('');
    const [frontendJSON, setFrontendJSON] = useState(null);
    const [backendJSON, setBackendJSON] = useState(null);
    const [jiraLink, setJiraLink] = useState('');
    const [folders, setFolders] = useState([]); // Храним папки
    const [testCases, setTestCases] = useState([]); // Храним тест-кейсы для маппинга
    const [components, setComponents] = useState([]); // Храним компоненты
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [allureLink, setAllureLink] = useState('');

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
            setTestCases([]);
            setComponents([]);
            setError('');
            setSuccessMessage('');
            setAllureLink('');
        };
    }, []);

    const handleProjectChange = async (e) => {
        const selectedProjectId = e.target.value;
        setProjectId(selectedProjectId);
        setError('');
        setSuccessMessage('');

        if (selectedProjectId) {
            setIsLoading(true);
            try {
                const response = await axios.get(`http://localhost:5001/api/structure`, {
                    params: { projectId: selectedProjectId },
                });

                const { folders: fetchedFolders, testCases: fetchedTestCases, components: fetchedComponents } = response.data;
                setFolders(fetchedFolders || []);
                setTestCases(fetchedTestCases || []);
                setComponents(fetchedComponents || []);
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
                    setFrontendJSON(json);
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
                    setBackendJSON(json);
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

    const areAllTestCasesMapped = () => {
        return testCases.every((testCase) => testCase.functionalBlockId);
    };

    const handleComponentMapping = async (testCaseId, functionalBlockId) => {
        try {
            await axios.post('http://localhost:5001/api/components', {
                projectId,
                componentType: 'testCase', // Указываем тип как тест-кейс
                functionalBlock: functionalBlockId,
                componentId: testCaseId, // Передаём ID тест-кейса как componentId
            });

            setTestCases(
                testCases.map((testCase) =>
                    testCase.id === testCaseId
                        ? { ...testCase, functionalBlockId }
                        : testCase
                )
            );
        } catch (err) {
            setError('Ошибка при сопоставлении тест-кейса. Попробуйте снова.');
            logError('Test case mapping error', err.message);
        }
    };

    const handleCreateTestPlan = async () => {
        if (!projectId) {
            setError('Выберите проект.');
            return;
        }
        if (!frontendJSON && !backendJSON) {
            setError('Загрузите хотя бы один JSON-файл (фронтенд или бэкенд).');
            return;
        }
        if (!jiraLink) {
            setError('Введите ссылку на задачу в Jira.');
            return;
        }
        if (!areAllTestCasesMapped()) {
            setError('Необходимо сопоставить все тест-кейсы с функциональными блоками.');
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccessMessage('');

        try {
            const formData = new FormData();
            if (frontendJSON) formData.append('frontendJson', new Blob([JSON.stringify(frontendJSON)], { type: 'application/json' }));
            if (backendJSON) formData.append('backendJson', new Blob([JSON.stringify(backendJSON)], { type: 'application/json' }));

            const response = await axios.post('http://localhost:5001/api/launch', {
                jiraTaskUrl: jiraLink,
                projectId,
                functionalBlocks: testCases.map((testCase) => ({
                    componentId: testCase.id,
                    functionalBlockId: testCase.functionalBlockId,
                })),
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
                        <h2 style={styles.subHeader}>Сопоставление тест-кейсов</h2>
                        {folders.map((folder) =>
                            folder.testCases?.map((testCase) => (
                                <div
                                    key={testCase.id}
                                    style={{
                                        ...styles.componentItem,
                                        backgroundColor: testCase.functionalBlockId ? '#e6ffe6' : '#fff3cd',
                                    }}
                                >
                                    <span>{testCase.name} (Папка: {folder.name})</span>
                                    <select
                                        value={testCase.functionalBlockId || ''}
                                        onChange={(e) =>
                                            handleComponentMapping(testCase.id, e.target.value)
                                        }
                                        style={styles.select}
                                        disabled={isLoading}
                                    >
                                        <option value="">-- Выберите функциональный блок --</option>
                                        {components.map((block) => (
                                            <option key={block.id} value={block.id}>
                                                {block.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))
                        )}
                    </div>
                )}

                <button
                    onClick={handleCreateTestPlan}
                    style={{
                        ...styles.submitButton,
                        backgroundColor: areAllTestCasesMapped() ? '#28a745' : '#ccc',
                    }}
                    disabled={isLoading || !areAllTestCasesMapped()}
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
        </div>
    );
};

const styles = {
    container: {
        padding: '20px',
        maxWidth: '800px',
        margin: '0 auto',
    },
    header: {
        fontSize: '24px',
        marginBottom: '20px',
        textAlign: 'center',
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
    },
    select: {
        padding: '8px',
        fontSize: '14px',
        borderRadius: '5px',
        border: '1px solid #ccc',
    },
    fileInput: {
        padding: '8px 0',
    },
    input: {
        padding: '8px',
        fontSize: '14px',
        borderRadius: '5px',
        border: '1px solid #ccc',
    },
    mappingSection: {
        marginTop: '20px',
    },
    subHeader: {
        fontSize: '20px',
        marginBottom: '10px',
    },
    componentItem: {
        padding: '10px',
        marginBottom: '10px',
        borderRadius: '5px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    submitButton: {
        padding: '10px 20px',
        fontSize: '16px',
        color: '#fff',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        marginTop: '20px',
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
};

export default TIAPage;