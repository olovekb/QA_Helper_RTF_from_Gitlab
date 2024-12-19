import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './style.css';
import config from './config.json';
import { parseXmindFile } from './parce.xmind.mjs'

function App() {
    const [projectId, setProjectId] = useState(config.projectId);
    const [jiraIssue, setJiraIssue] = useState(config.jiraIssue);
    const [loading, setLoading] = useState(false);
    const [htmlReport, setHtmlReport] = useState('');
    const [fixStatus, setFixStatus] = useState(false);
    const [activeTab, setActiveTab] = useState('analysis'); // Состояние для активной вкладки
    const [xmindFile, setXmindFile] = useState(null); // Файл XMind
    const [exportMessage, setExportMessage] = useState(''); // Сообщения об экспорте
    const [exportResult, setExportResult] = useState(null); // Результат экспорта


    // Список проектов с их ID
    const projects = [
        { id: 1, name: 'Nocode' },
        { id: 2, name: 'Nopaper' },
        { id: 3, name: 'DBO-X' },
        { id: 4, name: 'Ингосстрах' },
        { id: 5, name: 'ККБ-ФЛ' },
        { id: 6, name: 'ККБ-ЮЛ' },
        { id: 7, name: 'РНКБ' },
        { id: 34, name: 'USB' },
        { id: 67, name: 'РНКБ ЛК' },
        { id: 199, name: 'Test' },
    ];

    // Загружаем состояние из sessionStorage при монтировании компонента
    useEffect(() => {
        const savedFixStatus = sessionStorage.getItem('fixStatus');
        if (savedFixStatus) {
            setFixStatus(JSON.parse(savedFixStatus));
        }

        const savedReport = sessionStorage.getItem('htmlReport');
        if (savedReport) {
            setHtmlReport(savedReport);
        }
    }, []);


    const downloadHtml = () => {
        const htmlContent = sessionStorage.getItem('htmlReport');
        const projectId = sessionStorage.getItem('projectId'); // Предполагаем, что projectId сохранен в sessionStorage
        const jiraIssue = sessionStorage.getItem('jiraIssue'); // Предполагаем, что jiraIssue сохранен в sessionStorage

        if (!htmlContent) {
            console.error('HTML отчет не найден в sessionStorage');
            return;
        }

        if (!projectId || !jiraIssue) {
            console.error('Данные projectId или jiraIssue отсутствуют в sessionStorage');
            return;
        }

        // Формируем название файла
        const fileName = `Результат ревью тест-кейсов ${jiraIssue}.html`;

        // Создаем Blob и скачиваем HTML
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName; // Устанавливаем динамическое имя файла
        link.click(); // Имитируем клик для скачивания
    };
    // Функция для обработки клика и сохранения состояния в sessionStorage
    const toggleFixStatus = () => {
        const newFixStatus = !fixStatus;
        setFixStatus(newFixStatus);
        sessionStorage.setItem('fixStatus', JSON.stringify(newFixStatus));
    };

    // Функция для обработки отправки формы
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setHtmlReport(''); // Очищаем предыдущее содержимое

        try {
            const response = await axios.post(`${config.serverUrl}/api/analyze`, {
                projectId,
                jiraIssue,
            });

            const newReport = response.data;
            setHtmlReport(newReport);
            sessionStorage.setItem('htmlReport', newReport);
            // Сохраняем projectId и jiraIssue в sessionStorage
            sessionStorage.setItem('projectId', projectId);
            sessionStorage.setItem('jiraIssue', jiraIssue);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Обработчик загрузки файла XMind
    const handleXmindFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setXmindFile(file);
        }
    };

    // Обработчик экспорта XMind в Allure
    const handleExportClick = async () => {
        setLoading(true);
        if (!xmindFile) {
            setExportMessage('Пожалуйста, загрузите файл XMind.');
            return;
        }

        if (!projectId) {
            setExportMessage('Пожалуйста, выберите проект.');
            return;
        }

        setExportMessage('Обработка файла и экспорт данных...');
        try {
            // Парсим XMind файл
            const allureData = await parseXmindFile(xmindFile);

            // Вызов метода API для экспорта
            const response = await axios.post(`${config.serverUrl}/api/export`, {
                allureData,
                projectId,
            });

            // Проверяем успешность вызова
            if (response.status === 200) {
                const allureLink = `https://abanking.qatools.cloud/project/${projectId}/test-cases`;
                setExportMessage('Экспорт завершён! Посмотреть результат: ');
                setExportResult(allureLink); // Сохраняем ссылку
            } else {
                setExportMessage('Ошибка при экспорте данных.');
            }
        } catch (error) {
            console.error('Ошибка экспорта:', error);
            setExportMessage('Ошибка при обработке и экспорте файла.');
        }
        finally {
            setLoading(false);
        }
    };



    // Функция для смены активной вкладки
    const handleTabChange = (tab) => {
        setActiveTab(tab);
    };

    return (
        <div className="App">
            <h1>QA-helper</h1>

            {/* Вкладки */}
            <div className="tabs">
                <button onClick={() => handleTabChange('analysis')} className={activeTab === 'analysis' ? 'active' : ''}>
                    Анализ тестов
                </button>
                <button onClick={() => handleTabChange('export')} className={activeTab === 'export' ? 'active' : ''}>
                    Экспорт Xmind в Allure
                </button>
            </div>

            {/* Контент в зависимости от активной вкладки */}
            {activeTab === 'analysis' && (
                <div>
                    {/* Ваш текущий функционал для анализа */}
                    <form onSubmit={handleSubmit}>
                        <div>
                            <label>
                                Выберите проект:
                                <select
                                    value={projectId}
                                    onChange={(e) => setProjectId(e.target.value)}
                                >
                                    <option value="">Выберите проект</option>
                                    {projects.map((project) => (
                                        <option key={project.id} value={project.id}>
                                            {project.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <div>
                            <label>
                                Номер задачи из Jira:
                                <input
                                    type="text"
                                    value={jiraIssue}
                                    onChange={(e) => setJiraIssue(e.target.value)}
                                />
                            </label>
                        </div>
                        <button type="submit" disabled={loading}>
                            {loading ? 'Анализ запущен' : 'Запустить анализ'}
                        </button>
                    </form>
                    {/* Кнопка для скачивания отчёта */}
                    {htmlReport && !loading && (
                        <button onClick={downloadHtml} className="download-btn">
                            Скачать отчёт
                        </button>
                    )}
                    <div>
                        {loading ? <div className="spinner"></div> : (
                            htmlReport ? (
                                <div dangerouslySetInnerHTML={{ __html: htmlReport }} />
                            ) : (
                                <p>Не найдено тест-кейсов для анализа</p>
                            )
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'export' && (
                <div>
                    <h2>Экспорт XMind в Allure</h2>
                    <div className="form-group">
                        <label>
                            Выберите проект:
                            <select
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                            >
                                <option value="">Выберите проект</option>
                                {projects.map((project) => (
                                    <option key={project.id} value={project.id}>
                                        {project.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <div className="form-group">
                        <label>
                            Загрузить XMind файл:
                            <input
                                type="file"
                                accept=".xmind"
                                onChange={handleXmindFileChange}
                            />
                        </label>
                    </div>
                    <button onClick={handleExportClick} disabled={loading || !xmindFile}>
                        <div>
                            {loading ? <div className="spinner"></div> : <p>Экспорт</p>}
                        </div>
                    </button>
                    {exportMessage && <p className="export-message">{exportMessage}</p>}
                    {exportResult && (
                        <div className="export-link">
                            <a href={exportResult} target="_blank" rel="noopener noreferrer">
                                Открыть проект в Allure
                            </a>
                        </div>
                    )}
                </div>
            )}

        </div>
    );
}

export default App;
