import { writeFileSync } from 'fs'; // Подключаем модуль для работы с файловой системой
import config from './config.json' assert { type: 'json' };
import { analyzeTestCaseWithAI } from './ai-testcase.mjs'

export async function staticAnalysis(testCases) {
    let output = ''; // Для хранения анализа каждого теста
    const successfulTests = []; // Успешные тесты
    const failedTests = []; // Тесты с ошибками

    // Обрабатываем каждый тест-кейс
    for (let testCase of testCases) {
        const { report, hasErrors } = await generateTestCaseReport(testCase);
        output += `<div id="test-${testCase.id}" class="test-case">${report}</div>`;

        // Классифицируем тесты
        if (hasErrors) {
            failedTests.push(testCase);
        } else {
            successfulTests.push(testCase);
        }
    }

    // Определяем резолюцию
    const resolution = failedTests.length > 0
        ? '<p style="color: red;">Есть ошибки в тест-кейсах</p>'
        : '<p style="color: green;">Все тест-кейсы прошли анализ</p>';

    // Формируем списки успешных и неуспешных тестов с ограничением по высоте
    const successfulTestsList = successfulTests.length > 0
        ? `<h2>Успешно пройденные тесты: ${successfulTests.length}</h2>
       <ul class="scrollable-list">${successfulTests.map(
            (test) =>
                `<li><a href="#test-${test.id}" class="passed-text">${test.name} (ID: ${test.id})</a></li>`
        ).join('')}</ul>`
        : '<p>Нет успешных тестов</p>';

    // Формируем список тестов с ошибками с чекбоксами
    const failedTestsList = failedTests.length > 0
        ? `<h2>Тесты с ошибками: ${failedTests.length}</h2>
       <ul class="scrollable-list">${failedTests.map(
            (test) =>
                `<li>
                    <a href="#test-${test.id}" class="failed-text">${test.name} (ID: ${test.id})</a>
                    <label>
                        <input type="checkbox" id="fix-${test.id}" onchange="toggleFixStatus(${test.id})">
                        Исправлено
                    </label>
                </li>`
        ).join('')}</ul>`
        : '<p>Нет тестов с ошибками</p>';

    // Генерация HTML-отчета
    const htmlReport = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Статический анализ тест-кейсов</title>
        <link rel="stylesheet" href="style.css">
    </head>
    <body>
        <h1>Статический анализ тест-кейсов по задаче <a href="${config.jiraUrl}/${testCases[0].issue}">${testCases[0].issue}</a></h1>
        ${resolution}
        <ul class="success-list">${successfulTestsList || '<li>Нет успешных тестов</li>'}</ul>
        <ul class="failed-list">${failedTestsList || '<li>Нет тестов с ошибками</li>'}</ul>
        ${output}
        <script>
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
            }
        </script>
    </body>
    </html>
`;


    // Сохраняем HTML-отчет в файл
    const fileName = `./report/report_test_cases.${testCases[0].issue}.html`;
    writeFileSync(fileName, htmlReport, 'utf8');

    console.log(`Отчет сохранен в файл: ${fileName}`);
    return htmlReport;
}



async function generateTestCaseReport(testCase) {
    let errors = []; // Массив для сбора ошибок
    let output = ''; // Для хранения результатов анализа одного теста
    let aiRecommendations = null; // Храним рекомендации, если они успешны
    let aiErrorOccurred = false; // Флаг ошибки для анализа с AI

    // Попробуем получить рекомендации от нейросети
    try {
       // aiRecommendations = await analyzeTestCaseWithAI(testCase);
       // пока делаем true - пока не решим с openAI
       aiErrorOccurred = true;
    } catch (error) {
        console.error('Ошибка при вызове AI:', error.message);
        aiErrorOccurred = true; // Устанавливаем флаг, если произошла ошибка
    }

    // Вывод ID и названия тест-кейса
    output += `<h1>${testCase.name} (ID: ${testCase.id})</h1>`;

    // Добавление ссылки на тест-кейс в Allure (ТестОпс)
    output += `
        <p>
            <a href="${config.url}/project/${config.projectId}/test-cases/${testCase.id}" target="_blank">
                Ссылка на тест-кейс из Allure (ТестОпс)
            </a>
        </p>`;

    // Проверка status
    if (testCase.status !== 'Review') {
        errors.push('Ошибка: Статус должен быть "Review"');
    }
    output += `<p><strong>Статус:</strong> ${testCase.status} ${testCase.status !== 'Review' ? '<span style="color:red;">Ошибка: Статус должен быть "Review"</span>' : ''}</p>`;

    // Проверка tags
    const validTags = ['M', 'D', 'S', 'A'];
    const hasValidTag = testCase.tags.some(tag => validTags.includes(tag));
    if (!hasValidTag) {
        errors.push('Ошибка: Тег должен содержать хотя бы одно из значений: \'M\', \'D\', \'S\', или \'A\'');
    }
    output += `<p><strong>Теги:</strong> ${testCase.tags.join(', ') || 'Нет значений'} ${!hasValidTag ? '<span style="color:red;">Ошибка: Тег должен содержать хотя бы одно из значений: \'M\', \'D\', \'S\', или \'A\'</span>' : ''}</p>`;

    // Проверка layer
    const validLayers = ['E2E Tests', 'Integration frontend Tests', 'Integration backend Tests'];
    if (!validLayers.includes(testCase.layer)) {
        errors.push('Ошибка: Слой должен быть одним из: \'E2E Tests\', \'Integration frontend Tests\', или \'Integration backend Tests\'');
    }
    output += `<p><strong>Слои:</strong> ${testCase.layer} ${!validLayers.includes(testCase.layer) ? '<span style="color:red;">Ошибка: Слой должен быть одним из: \'E2E Tests\', \'Integration frontend Tests\', или \'Integration backend Tests\'</span>' : ''}</p>`;

    // Проверка customFields
    const missingFields = [];

    // Проверяем наличие кастомных полей
    const customFieldsOutput = testCase.customFields
        .filter(field => field.value !== 'Нет значений' && (field.name === 'Priority' || field.name === 'Version'))
        .map(field => `${field.name}: ${field.value}`)
        .join(', ');

    // Проверка на наличие кастомных полей Priority и Version
    if (!testCase.customFields.some(field => field.name === 'Priority')) {
        missingFields.push('Priority');
    }
    if (!testCase.customFields.some(field => field.name === 'Version')) {
        missingFields.push('Version');
    }

    // Формируем вывод для кастомных полей
    let customFieldsText = `<p><strong>Кастомные поля:</strong> ${customFieldsOutput || 'Нет значений'}`;

    // Если есть ошибки с кастомными полями, добавляем их к выводу
    if (missingFields.length > 0) {
        customFieldsText += ` <span style="color:red;"><strong>Ошибка:</strong> Не указаны кастомные поля: ${missingFields.join(', ')}</span>`;
    }

    // Закрываем тег для кастомных полей
    customFieldsText += '</p>';

    // Добавляем это в итоговый вывод
    output += customFieldsText;


    // Проверка expectedResult
    if (testCase.expectedResult === 'Нет результата') {
        errors.push('Ошибка: Конечный ожидаемый результат тест-кейса должен быть заполнен');
    }
    output += `<p><strong>Ожидаемый результат:</strong> ${testCase.expectedResult} ${testCase.expectedResult === 'Нет результата' ? '<span style="color:red;"><strong>Ошибка:</strong> Конечный ожидаемый результат тест-кейса должен быть заполнен</span>' : ''}</p>`;

    // Проверка шагов
    output += `<h3>Шаги:</h3>`;

    if (!testCase.steps || testCase.steps.length === 0) {
        errors.push("Ошибка: тест-кейс должен содержать хотя бы один шаг.");
        output += `<p style="color:red;"><strong>Ошибка:</strong> Тест-кейс должен содержать хотя бы один шаг.</p>`;
    } else {
        testCase.steps.forEach((step, index) => {
            let stepError = "";
            if (!step.description) {
                stepError = `Ошибка: описание шага ${index + 1} отсутствует.`;
            } else if (!/^([а-яА-ЯёЁa-zA-Z])/.test(step.description)) {
                stepError = `Ошибка: описание шага ${index + 1} должно начинаться с буквы.`;
            } else if (!/^([А-ЯЁ][а-яё]+(ть|ться|ти))/.test(step.description.trim())) {
                stepError = `Ошибка: описание шага ${index + 1} должно начинаться с глагола в неопределенной форме (окончания "ть", "ться" или "ти").`;
            }

            if (stepError) {
                errors.push(stepError);
                output += `<p><strong>${index + 1}:</strong> ${step.description || '—'} <span style="color:red;">${stepError}</span></p>`;
            } else {
                output += `<p><strong>${index + 1}:</strong> ${step.description}</p>`;
            }
        });
    }

    // Если есть ошибки, выводим их
    if (errors.length > 0) {
        output += `<h2><strong>Ошибки</strong>:</h2><ul>${errors.map(error => `<li style="color:red;">${error}</li>`).join('')}</ul>`;
    } else {
        output += `<h2 class="passed">Тест-кейс прошел статический анализ</h2>`;
    }

    output += `</div>`;

    // Добавляем рекомендации (если ошибки не было)
    if (!aiErrorOccurred) {
        output += `
            <div class="ai-recommendations">
                <h3>Рекомендации по улучшению:</h3>
                <p>${aiRecommendations}</p>
            </div>`;
    } else {
        output += `
            <div class="ai-recommendations">
                <h3>Рекомендации по улучшению:</h3>
                <p>Нет рекомендаций, так как произошла ошибка при анализе с AI.</p>
            </div>`;
    }

    return { report: output, hasErrors: errors.length > 0 };
}

