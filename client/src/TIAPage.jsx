import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select'; // Импортируем react-select для мультиселекта
import { useNavigate } from 'react-router-dom'; // Для навигации назад
import styles from './styles'; // Импортируем стили
import Loader from './Loader'; // Предполагаем, что есть компонент Loader
import config from './config.json';

const TIAPage = ({ projects }) => {
    const [projectId, setProjectId] = useState('');
    const [frontendJSON, setFrontendJSON] = useState(null);
    const [backendJSON, setBackendJSON] = useState(null);
    const [jiraLink, setJiraLink] = useState('');
    const [folders, setFolders] = useState([]);
    const [expandedFolders, setExpandedFolders] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [structureLoading, setStructureLoading] = useState(false); // Лоудер для загрузки блоков
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [allureLink, setAllureLink] = useState('');

    // Состояния для маппинга компонентов
    const [components, setComponents] = useState([]); // Список всех компонентов
    const [componentMappings, setComponentMappings] = useState({}); // Маппинг { componentId: [folderIds] } для мультиселекта
    const [showMappingModal, setShowMappingModal] = useState(false); // Управление модальным окном
    const [isMappingLoading, setIsMappingLoading] = useState(false); // Лоудер для маппинга

    const navigate = useNavigate(); // Для навигации назад

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
            setIsMappingLoading(false);
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
            setStructureLoading(true);
            try {
                const response = await axios.get(`${config.TIAUrl}/api/structure`, {
                    params: { projectId: selectedProjectId, skipCustomFieldIds: '-3' },
                });

                const { folders: fetchedFolders } = response.data;
                setFolders(fetchedFolders || []);
            } catch (err) {
                setError('Не удалось загрузить структуру проекта. Попробуйте позже.');
                logError('Fetch structure error', err.message);
            } finally {
                setStructureLoading(false);
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
        setJiraLink(e.target.value.trim()); // Убираем лишние пробелы
        setError('');
    };

    const handleFolderToggle = (folderId, event) => {
        event.stopPropagation();
        setExpandedFolders((prev) => ({
            ...prev,
            [folderId]: !prev[folderId],
        }));
    };

    const extractComponents = () => {
        console.log('Extracting components - frontendJSON:', frontendJSON);
        console.log('Extracting components - backendJSON:', backendJSON);

        const frontendComponents = frontendJSON?.frontendComponent?.map((comp, index) => ({
            id: `${comp.name}-${index}`,
            name: comp.name,
            type: 'frontend',
            endpoints: [],
        })) || [];

        const backendComponents = backendJSON?.Controllers?.map((controller, index) => ({
            id: `${controller.ControllerName}-${index}`,
            name: controller.ControllerName,
            type: 'backend',
            endpoints: controller.Endpoints || [],
        })) || [];

        const allComponents = [...frontendComponents, ...backendComponents];
        console.log('Extracted components:', allComponents);
        return allComponents;
    };

    const saveComponentMapping = async (component, folderIds) => {
        try {
            await axios.post(`${config.TIAUrl}/api/components`, {
                projectId,
                componentType: component.type,
                componentName: component.name,
                functionalBlock: folderIds.map(id => id.toString()),
            });
        } catch (err) {
            logError('Save component mapping error', err.message);
            throw new Error(`Не удалось сохранить маппинг для компонента ${component.name}.`);
        }
    };

    const handleCreateTestPlan = () => {
        if (!projectId) {
            setError('Пожалуйста, выберите проект.');
            return;
        }
        if (!frontendJSON && !backendJSON) {
            setError('Пожалуйста, загрузите хотя бы один JSON-файл (фронтенд или бэкенд).');
            return;
        }
        if (!jiraLink || !jiraLink.match(/^https?:\/\/jira\.abanking\.ru\/browse\/[A-Z]+-\d+$/)) {
            setError('Пожалуйста, введите корректную ссылку на задачу в Jira (например, https://jira.abanking.ru/browse/CTMM-528).');
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccessMessage('');

        const extractedComponents = extractComponents();

        if (extractedComponents.length === 0) {
            setError('Компоненты не найдены в загруженных JSON-файлах. Проверьте структуру файлов.');
            setIsLoading(false);
            return;
        }

        fetchExistingMappings(projectId)
            .then(existingMappings => {
                setComponents(extractedComponents);

                const initialMappings = {};
                extractedComponents.forEach(component => {
                    const mappingsForComponent = existingMappings.filter(
                        m => m.component_name === component.name && m.component_type === component.type
                    );
                    const folderIds = mappingsForComponent
                        .map(m => findFolderAllureId(m.functional_block_allure_id)?.toString() || '')
                        .filter(id => id);
                    initialMappings[component.id] = folderIds.length > 0 ? folderIds : [];
                });
                setComponentMappings(initialMappings);

                setShowMappingModal(true);
            })
            .catch(err => {
                setError('Произошла ошибка при обработке компонентов. Проверьте данные и повторите попытку.');
                logError('Component extraction error', err.message);
                setIsLoading(false);
            });
    };

    const fetchExistingMappings = async (projectId) => {
        try {
            const response = await axios.get(`${config.TIAUrl}/api/components`, {
                params: { projectId },
            });
            return response.data.mappings || [];
        } catch (err) {
            logError('Fetch existing mappings error', err.message);
            return [];
        }
    };

    const findFolderAllureId = (functionalBlockAllureId) => {
        if (!functionalBlockAllureId || !folders) return null;

        const findInFolders = (foldersList) => {
            for (const folder of foldersList) {
                const folderIdStr = folder.id.toString();
                const functionalBlockAllureIdStr = functionalBlockAllureId.toString();
                if (folderIdStr === functionalBlockAllureIdStr) return folderIdStr;
                if (folder.children && folder.children.length > 0) {
                    const result = findInFolders(folder.children);
                    if (result) return result;
                }
            }
            return null;
        };

        return findInFolders(folders);
    };

    const createTestPlan = async () => {
        try {
            const allFolderIds = new Set();
            Object.values(componentMappings).forEach(folderIds => folderIds.forEach(id => allFolderIds.add(id)));
            const groupsInclude = Array.from(allFolderIds).map(id => parseInt(id, 10));

            const requestBody = {
                projectId,
                jiraLink,
                componentMappings,
            };

            const response = await axios.post(`${config.TIAUrl}/api/launch`, requestBody, {
                headers: { 'Content-Type': 'application/json' },
            });

            const { id } = response.data;
            const allureLink = `${config.url}/launch/${id}`;
            setSuccessMessage('Тест-план успешно создан!');
            setAllureLink(allureLink);
        } catch (err) {
            if (err.response && err.response.status === 400 && err.response.data.error === 'На выбранных блоках отсутствуют тест-кейсы. Добавьте хотя бы один для возможности создания тест-плана.') {
                setError(err.response.data.error);
            } else {
                setError('Произошла ошибка при создании тест-плана. Проверьте данные и повторите попытку.');
                logError('Test plan creation error', err.message);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleMappingConfirm = async () => {
        setIsMappingLoading(true); // Включаем лоудер для маппинга
        try {
            for (const component of components) {
                const folderIds = componentMappings[component.id] || [];
                if (folderIds.length > 0) await saveComponentMapping(component, folderIds);
            }
            await createTestPlan();
            setShowMappingModal(false);
        } catch (err) {
            setError(err.message);
            logError('Mapping confirmation error', err.message);
        } finally {
            setIsMappingLoading(false); // Выключаем лоудер
        }
    };

    const handleMappingCancel = () => {
        setShowMappingModal(false);
        setComponentMappings({});
        setComponents([]);
    };

    const handleMappingChange = (componentId, selectedOptions) => {
        setComponentMappings(prev => ({
            ...prev,
            [componentId]: selectedOptions.map(option => option.value.toString()),
        }));
    };

    const logError = async (errorType, description) => {
        try {
            await axios.post(`${config.TIAUrl}/api/errors`, {
                errorType, description, timestamp: new Date().toISOString(),
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
                    ...(level === 0 ? styles.featureLevel : styles.storyLevel),
                    cursor: 'pointer',
                }}
                onClick={(e) => handleFolderToggle(folder.id, e)}
            >
                {folder.children && folder.children.length > 0 && (
                    <span style={styles.toggleIcon}>
                        {expandedFolders[folder.id] ? '▼' : '►'}
                    </span>
                )}
                <span style={{ ...styles.folderName, fontWeight: level === 0 ? 600 : 400 }}>
                    {folder.customFieldName} - {folder.name}
                </span>
                {expandedFolders[folder.id] && folder.children && folder.children.length > 0 && (
                    <div style={{ ...styles.nestedFolders, maxHeight: expandedFolders[folder.id] ? '1000px' : '0' }}>
                        {renderFolderTree(folder.children, level + 1)}
                    </div>
                )}
            </div>
        ));
    };

    const getFolderOptions = (folders) => {
        const options = [];
        const traverseFolders = (folderList, level = 0) => {
            folderList.forEach((folder) => {
                options.push({ value: folder.id.toString(), label: `${'-'.repeat(level)} ${folder.customFieldName} - ${folder.name}` });
                if (folder.children) traverseFolders(folder.children, level + 1);
            });
        };
        traverseFolders(folders);
        return options;
    };

    const isCreateButtonDisabled = () => !projectId || (!frontendJSON && !backendJSON) || !jiraLink || isLoading;

    // Обновленная логика для проверки, что все компоненты имеют хотя бы один блок
    const isMappingConfirmDisabled = components.some(component => !componentMappings[component.id] || componentMappings[component.id].length === 0);

    return (
        <div style={styles.container}>
            <div style={styles.headerSection}>
                <h1 style={styles.title}>Test Impact Analysis (TIA)</h1>
                <button style={styles.backButton} onClick={() => navigate('/')}>
                    Назад
                </button>
            </div>

            <div style={styles.form}>
                <div style={styles.formGroup}>
                    <label style={styles.label}>Выберите проект:</label>
                    <select
                        value={projectId}
                        onChange={handleProjectChange}
                        style={styles.select}
                        disabled={isLoading || structureLoading}
                    >
                        <option value="">-- Выберите проект --</option>
                        {projects.map((proj) => (
                            <option key={proj.id} value={proj.id}>
                                {proj.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON фронтенда (опционально):</label>
                    <div style={styles.uploadContainer}>
                        <input
                            type="file"
                            accept=".json"
                            onChange={handleFrontendJSONUpload}
                            style={styles.fileInput}
                            disabled={isLoading || structureLoading}
                        />
                        {frontendJSON && <span style={styles.fileName}>Файл: {frontendJSON.name || 'frontend.json'}</span>}
                    </div>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON бэкенда (опционально):</label>
                    <div style={styles.uploadContainer}>
                        <input
                            type="file"
                            accept=".json"
                            onChange={handleBackendJSONUpload}
                            style={styles.fileInput}
                            disabled={isLoading || structureLoading}
                        />
                        {backendJSON && <span style={styles.fileName}>Файл: {backendJSON.name || 'backend.json'}</span>}
                    </div>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Ссылка на задачу Jira:</label>
                    <input
                        type="text"
                        value={jiraLink}
                        onChange={handleJiraLinkChange}
                        placeholder="https://jira.abanking.ru/browse/CTMM-528"
                        style={styles.jiraInput}
                        disabled={isLoading || structureLoading}
                    />
                </div>

                {structureLoading ? (
                    <div style={styles.loader}><Loader /></div>
                ) : folders.length > 0 && (
                    <div style={styles.mappingSection}>
                        <h2 style={styles.subHeader}>Структура папок</h2>
                        {renderFolderTree(folders)}
                    </div>
                )}
            </div>

            <div style={styles.footer}>
                {error && <div style={styles.error}>{error}</div>}
                {successMessage && (
                    <div>
                        {successMessage}
                        {allureLink && (
                            <a href={allureLink} target="_blank" rel="noopener noreferrer" style={styles.successLink}>
                                Перейти к тест-плану в Allure
                            </a>
                        )}
                    </div>
                )}
                {isLoading && !structureLoading && <div style={styles.loader}><Loader /></div>}
                <button
                    onClick={handleCreateTestPlan}
                    disabled={isCreateButtonDisabled()}
                >
                    {isLoading ? <Loader style={{ display: 'inline-block', width: '20px', height: '20px', verticalAlign: 'middle' }} /> : 'Создать тест-план'}
                </button>
            </div>

            {showMappingModal && (
                <div style={{ ...styles.modalOverlay, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div style={{ ...styles.modal, backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px', width: '800px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)' }}>
                        <h2 style={{ ...styles.modalHeader, fontSize: '24px', marginBottom: '20px', color: '#2c3e50', fontWeight: 700, borderBottom: '2px solid #ced4da', paddingBottom: '16px' }}>Сопоставление компонентов</h2>
                        <div style={{ ...styles.modalContent, display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: 'calc(90vh - 120px)', overflowY: 'auto' }}>
                            {components.length === 0 ? (
                                <div style={{ ...styles.noComponents, fontSize: '16px', color: '#721c24', textAlign: 'center', padding: '16px', backgroundColor: '#ffebee', borderRadius: '8px' }}>
                                    Компоненты не найдены. Проверьте загруженные JSON-файлы.
                                </div>
                            ) : (
                                components.map((comp) => (
                                    <div key={comp.id} style={{ ...styles.mappingRow, display: 'flex', alignItems: 'center', gap: '16px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)' }}>
                                        <div style={{ ...styles.componentContainer, flex: 1, display: 'flex' }}>
                                            <span style={{ ...styles.mappingLabel, fontSize: '16px', fontWeight: 600, color: componentMappings[comp.id]?.length > 0 ? styles.success : styles.warning }}>
                                                {comp.type}: {comp.name}
                                            </span>
                                            {comp.type === 'backend' && comp.endpoints.length > 0 && (
                                                <ul style={{ ...styles.endpointList, margin: 0, paddingLeft: '20px', fontSize: '14px', color: '#6c757d', listStyle: 'none' }}>
                                                    {comp.endpoints.map((endpoint, index) => (
                                                        <li key={`${comp.id}-endpoint-${index}`} style={styles.endpointItem}>
                                                            {endpoint.HttpMethod} {endpoint.RoutePath}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                        <Select
                                            options={getFolderOptions(folders)}
                                            value={getFolderOptions(folders).filter(option => componentMappings[comp.id]?.includes(option.value))}
                                            onChange={(selectedOptions) => handleMappingChange(comp.id, selectedOptions)}
                                            isMulti
                                            placeholder="Выберите функциональный блок(и)..."
                                            styles={selectStyles}
                                            isSearchable
                                        />
                                    </div>
                                ))
                            )}
                        </div>
                        <div style={{ ...styles.modalFooter, marginTop: '20px', paddingTop: '16px', borderTop: '2px solid #ced4da', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                            <button onClick={handleMappingCancel} style={styles.modalButtonCancel}>Отмена</button>
                            <button
                                onClick={handleMappingConfirm}
                                style={{ ...styles.modalButtonConfirm, position: 'relative' }}
                                disabled={isMappingConfirmDisabled}
                            >
                                {isMappingLoading ? <Loader style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '20px', height: '20px' }} /> : 'Подтвердить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Новые стили для react-select
const selectStyles = {
    control: (provided) => ({
        ...provided,
        minHeight: '38px',
        width: '100%', // Занимает всю доступную ширину
        minWidth: '300px', // Минимальная ширина
        borderRadius: '8px',
        border: `1px solid ${styles.borderLight}`,
        boxShadow: 'none',
        '&:hover': { borderColor: styles.primary },
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
        '&:hover': { backgroundColor: styles.danger, color: 'white' },
    }),
    menu: (provided) => ({
        ...provided,
        zIndex: 1001,
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        maxHeight: '300px', // Ограничиваем высоту меню
        overflowY: 'auto',  // Добавляем вертикальный скролл
        color: styles.textDark
    }),
    menuList: (provided) => ({
        ...provided,
        maxHeight: '300px', // Ограничиваем высоту списка
        padding: '8px',     // Добавляем отступы для красоты
        color: styles.textDark
    })
};

const logError = async (errorType, description) => {
    try {
        await axios.post(`${config.TIAUrl}/api/errors`, {
            errorType, description, timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('Failed to log error:', err.message);
    }
};

export default TIAPage;