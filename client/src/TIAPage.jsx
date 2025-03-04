// client/src/components/TIAPage.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select'; // Импортируем react-select для мультиселекта
import styles from './styles'; // Импортируем стили

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
    const [componentMappings, setComponentMappings] = useState({}); // Маппинг { componentId: [folderIds] } для мультиселекта
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

    // Обновленная функция добавления маппинга компонента через API (для мультиселекта, отправляем массив)
    const saveComponentMapping = async (component, folderIds) => {
        try {
            // Отправляем один запрос с массивом functionalBlock
            await axios.post('http://localhost:5001/api/components', {
                projectId,
                componentType: component.type,
                componentName: component.name,
                functionalBlock: folderIds.map(id => id.toString()), // Отправляем массив строк
            });
        } catch (err) {
            logError('Save component mapping error', err.message);
            throw new Error(`Не удалось сохранить маппинг для компонента ${component.name}.`);
        }
    };

    // Обновленная функция создания тест-плана с отладкой и получением маппингов
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

            // Получаем существующие маппинги для проекта
            const existingMappings = await fetchExistingMappings(projectId);
            setComponents(extractedComponents);

            // Инициализируем маппинги с существующими значениями, собирая все маппинги для компонента
            const initialMappings = {};
            extractedComponents.forEach(component => {
                const mappingsForComponent = existingMappings.filter(
                    m => m.component_name === component.name && m.component_type === component.type
                );
                console.log(`Mappings for ${component.name}:`, mappingsForComponent); // Отладка
                const folderIds = mappingsForComponent
                    .map(m => findFolderAllureId(m.functional_block_allure_id)?.toString() || '')
                    .filter(id => id); // Фильтруем пустые значения
                initialMappings[component.id] = folderIds.length > 0 ? folderIds : [];
            });
            setComponentMappings(initialMappings);

            setShowMappingModal(true);
            console.log('Successfully opened mapping modal with existing mappings');
        } catch (err) {
            setError('Произошла ошибка при обработке компонентов. Проверьте данные и повторите попытку.');
            logError('Component extraction error', err.message);
            console.log('Error in handleCreateTestPlan:', err.message);
            setIsLoading(false);
        }
    };

    // Обновленная функция для получения существующих маппингов
    const fetchExistingMappings = async (projectId) => {
        try {
            const response = await axios.get(`http://localhost:5001/api/components`, {
                params: { projectId },
            });
            console.log('Existing mappings response:', response.data.mappings); // Добавь для отладки
            return response.data.mappings || []; // Предполагаем, что API возвращает массив маппингов с functional_block_allure_id
        } catch (err) {
            logError('Fetch existing mappings error', err.message);
            return [];
        }
    };

    // Обновленная функция для поиска allure_id по functional_block_allure_id (с учётом разных форматов)
    const findFolderAllureId = (functionalBlockAllureId) => {
        if (!functionalBlockAllureId || !folders) {
            console.log('No functionalBlockAllureId or folders:', { functionalBlockAllureId, folders }); // Отладка
            return null;
        }

        const findInFolders = (foldersList) => {
            for (const folder of foldersList) {
                console.log(`Checking folder:`, folder); // Отладка
                // Преобразуем оба значения в строки для корректного сравнения
                const folderIdStr = folder.id.toString();
                const functionalBlockAllureIdStr = functionalBlockAllureId.toString();
                if (folderIdStr === functionalBlockAllureIdStr) {
                    console.log(`Match found for ${functionalBlockAllureIdStr}:`, folderIdStr); // Отладка
                    return folderIdStr; // Возвращаем id как строку
                }
                // Проверяем также children рекурсивно
                if (folder.children && folder.children.length > 0) {
                    const result = findInFolders(folder.children);
                    if (result) return result;
                }
            }
            return null;
        };

        const result = findInFolders(folders);
        console.log(`findFolderAllureId result for ${functionalBlockAllureId}:`, result); // Отладка
        return result;
    };

    // Обновленная функция для создания тест-плана
    const createTestPlan = async () => {
        try {
            // Собираем все уникальные folderIds из componentMappings
            const allFolderIds = new Set();
            Object.values(componentMappings).forEach(folderIds => {
                folderIds.forEach(id => allFolderIds.add(id));
            });
            const groupsInclude = Array.from(allFolderIds).map(id => parseInt(id, 10)); // Преобразуем в числа

            // Формируем тело запроса для отправки на сервер
            const requestBody = {
                projectId,
                jiraLink,
                componentMappings, // Передаём текущие маппинги
            };

            console.log('Request body for test plan to server:', requestBody);

            // Отправляем POST-запрос на серверный эндпоинт /api/launch
            const response = await axios.post('http://localhost:5001/api/launch', requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            const { id } = response.data; // Получаем только id из ответа
            const allureLink = `https://abanking.qatools.cloud/launch/${id}`; // Формируем ссылку
            setSuccessMessage('Тест-план успешно создан!');
            setAllureLink(allureLink);
        } catch (err) {
            setError('Произошла ошибка при создании тест-плана. Проверьте данные и повторите попытку.');
            logError('Test plan creation error', err.message);
            console.log('Error in createTestPlan:', err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Обработчик подтверждения маппинга
    const handleMappingConfirm = async () => {
        setIsLoading(true);
        try {
            console.log('Confirming mappings - components:', components);
            console.log('Confirming mappings - componentMappings:', componentMappings);

            for (const component of components) {
                const folderIds = componentMappings[component.id] || [];
                console.log(`Processing component ${component.name} with folderIds:`, folderIds);

                if (folderIds.length > 0) {
                    await saveComponentMapping(component, folderIds);
                }
            }
            await createTestPlan();
            setShowMappingModal(false);
        } catch (err) {
            setError(err.message);
            logError('Mapping confirmation error', err.message);
            console.log('Error in handleMappingConfirm:', err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleMappingCancel = () => {
        setShowMappingModal(false);
        setComponentMappings({});
        setComponents([]);
        setIsLoading(false);
    };

    const handleMappingChange = (componentId, selectedOptions) => {
        setComponentMappings((prev) => ({
            ...prev,
            [componentId]: selectedOptions.map(option => option.value.toString()), // Гарантируем, что это строки
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
            console.error('Failed to log error:', err.message);
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
                    ...(level === 0 ? {
                        padding: '12px 16px',
                        backgroundColor: styles.dfe6e9,
                        color: styles.textDark,
                        border: `1px solid ${styles.borderLight}`,
                        borderRadius: '6px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                        '&:hover': {
                            backgroundColor: styles.c8d6e5,
                            transform: 'translateY(-1px)',
                        },
                    } : {
                        padding: '8px 12px',
                        backgroundColor: styles.e8ecef,
                        color: styles.textDark,
                        border: `1px solid ${styles.borderLight}`,
                        borderRadius: '6px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                        '&:hover': {
                            backgroundColor: styles.dee2e6,
                            transform: 'translateY(-1px)',
                        },
                    }),
                }}
                onClick={() => handleFolderToggle(folder.id)}
            >
                {folder.children && folder.children.length > 0 && (
                    <span style={{ marginRight: '8px', color: styles.textMuted }}>
                        {expandedFolders[folder.id] ? '▼' : '►'}
                    </span>
                )}
                <span style={{ fontWeight: level === 0 ? '600' : '400' }}>
                    {folder.customFieldName} - {folder.name}
                </span>
            </div>
        ));
    };

    // Обновленная функция для подготовки опций для мультиселекта
    const getFolderOptions = (folders) => {
        const options = [];
        const traverseFolders = (folderList, level = 0) => {
            folderList.forEach((folder) => {
                options.push({
                    value: folder.id.toString(), // Гарантируем, что это строка (allure_id)
                    label: `${'-'.repeat(level)} ${folder.customFieldName} - ${folder.name}`,
                });
                if (folder.children && folder.children.length > 0) {
                    traverseFolders(folder.children, level + 1);
                }
            });
        };
        traverseFolders(folders);
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
                        placeholder="https://jira.abanking.ru/browse/CTMM-528"
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
                <div>
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
                                                    color: componentMappings[comp.id]?.length > 0 ? styles.success : styles.warning,
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
                                        <Select
                                            options={getFolderOptions(folders)}
                                            value={getFolderOptions(folders).filter(option =>
                                                componentMappings[comp.id]?.includes(option.value)
                                            )}
                                            onChange={(selectedOptions) => handleMappingChange(comp.id, selectedOptions)}
                                            isMulti // Включаем мультиселект
                                            placeholder="Выберите функциональный блок(и)..."
                                            styles={selectStyles} // Кастомные стили для react-select
                                            isSearchable // Включаем поиск
                                        />
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
                                disabled={Object.values(componentMappings).every(ids => ids.length === 0) || components.length === 0}
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

// Новые стили для react-select (вынесем в styles.js позже, если нужно)
const selectStyles = {
    control: (provided) => ({
        ...provided,
        minHeight: '38px',
        borderRadius: '5px',
        border: `1px solid ${styles.borderLight}`,
        boxShadow: 'none',
        '&:hover': {
            borderColor: styles.primary,
        },
    }),
    multiValue: (provided) => ({
        ...provided,
        backgroundColor: styles.lightGray,
        borderRadius: '4px',
    }),
    multiValueLabel: (provided) => ({
        ...provided,
        color: styles.textDark,
    }),
    multiValueRemove: (provided) => ({
        ...provided,
        color: styles.textMuted,
        '&:hover': {
            backgroundColor: styles.danger,
            color: 'white',
        },
    }),
    menu: (provided) => ({
        ...provided,
        zIndex: 1001, // Убедимся, что меню выше модального окна
    }),
};

const logError = async (errorType, description) => {
    try {
        await axios.post('http://localhost:5001/api/errors', {
            errorType,
            description,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('Failed to log error:', err.message);
    }
};

export default TIAPage;