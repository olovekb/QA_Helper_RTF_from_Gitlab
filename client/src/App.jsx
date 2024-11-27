import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './style.css';
import config from './config.json';

function App() {
    const [projectId, setProjectId] = useState(config.projectId);
    const [jiraIssue, setJiraIssue] = useState(config.jiraIssue);
    const [loading, setLoading] = useState(false);
    const [htmlReport, setHtmlReport] = useState('');
    const [fixStatus, setFixStatus] = useState(false); // Состояние фиксации

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
        { id: 67, name: 'РНКБ ЛК' }
    ];

    // Загружаем состояние из localStorage при монтировании компонента
    useEffect(() => {
        const savedFixStatus = localStorage.getItem('fixStatus');
        if (savedFixStatus) {
            setFixStatus(JSON.parse(savedFixStatus)); // Восстанавливаем из localStorage
        }

        const savedReport = localStorage.getItem('htmlReport');
        if (savedReport) {
            setHtmlReport(savedReport);
        }
    }, []);

    // Функция для обработки клика и сохранения состояния в localStorage
    const toggleFixStatus = () => {
        const newFixStatus = !fixStatus;
        setFixStatus(newFixStatus);

        // Сохраняем состояние в localStorage
        localStorage.setItem('fixStatus', JSON.stringify(newFixStatus));
    };


    // Функция для привязки событий после вставки HTML
    useEffect(() => {
        if (htmlReport) {
            // Убедитесь, что скрипты с функциями загружены и доступны
            const script = document.createElement('script');
            script.innerHTML = `
                   function toggleFixStatus(testId) {
                const checkbox = document.getElementById('fix-' + testId);
                const testLink = document.querySelector('a[href="#test-' + testId + '"]');

                if (checkbox.checked) {
                    testLink.style.textDecoration = 'line-through'; // Перечеркиваем ссылку, если ошибка исправлена
                    testLink.style.color = '#999'; // Меняем цвет на серый
                } else {
                    testLink.style.textDecoration = 'none'; // Убираем перечеркивание
                    testLink.style.color = ''; // Возвращаем цвет по умолчанию
                }
                    const newFixStatus = !localStorage.getItem('fixStatus');
                    localStorage.setItem('fixStatus', JSON.stringify(newFixStatus));
            }
            `;
            document.body.appendChild(script);

            // Привязать обработчик события для элементов в вставленном HTML
            const fixButtons = document.querySelectorAll('.fix-status-button');
            fixButtons.forEach(button => {
                button.addEventListener('click', toggleFixStatus);
            });

            // Очистка при размонтировании компонента
            return () => {
                document.body.removeChild(script);
                fixButtons.forEach(button => {
                    button.removeEventListener('click', toggleFixStatus);
                });
            };
        }
    }, [htmlReport]); // Выполняем только при изменении htmlReport

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setHtmlReport(''); // Очищаем предыдущее содержимое

        try {
            const response = await axios.post('http://localhost:5000/api/analyze', {
                projectId,
                jiraIssue,
            });

            // Ожидаем, что сервер вернет HTML-строку
            const newReport = response.data;
            setHtmlReport(newReport);

            // Сохраняем новый отчет в localStorage
            localStorage.setItem('htmlReport', newReport);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="App">
            <h1>Статический анализ тест-кейсов</h1>
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
    );
}

export default App;
