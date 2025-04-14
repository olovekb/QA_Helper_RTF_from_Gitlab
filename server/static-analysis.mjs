import { writeFileSync, mkdirSync } from 'fs'; // Модуль для работы с файловой системой
import { dirname } from 'path';
import config from './config.json' assert { type: 'json' };

export async function staticAnalysis(testCases, projectId) {
    let output = ''; // Для хранения анализа каждого теста
    const successfulTests = []; // Успешные тесты
    const failedTests = []; // Тесты с ошибками

    // Обрабатываем каждый тест-кейс
    for (let testCase of testCases) {
        const { report, hasErrors } = await generateTestCaseReport(testCase, projectId);
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
            test => `<li><a href="#test-${test.id}" class="passed-text">${test.name} (ID: ${test.id})</a></li>`
        ).join('')}</ul>`
        : '<p>Нет успешных тестов</p>';

    const failedTestsList = failedTests.length > 0
        ? `<h2>Тесты с ошибками: ${failedTests.length}</h2>
       <ul class="scrollable-list">${failedTests.map(
            test => `<li>
                    <a href="#test-${test.id}" class="failed-text">${test.name} (ID: ${test.id})</a>
                    <label>
                      <input type="checkbox" class="fix-checkbox" data-test-id="${test.id}">
                      Исправлено
                    </label>
                  </li>`
        ).join('')}</ul>`
        : '<p>Нет тестов с ошибками</p>';

    // Генерация HTML-отчёта без встроенных скриптов
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
        <h1>Результат по задаче <a href="${config.jiraUrl}/${testCases[0].issue}" target="_blank">${testCases[0].issue}</a></h1>
        ${resolution}
        <ul class="success-list">${successfulTestsList || '<li>Нет успешных тестов</li>'}</ul>
        <ul class="failed-list">${failedTestsList || '<li>Нет тестов с ошибками</li>'}</ul>
        ${output}
      </body>
    </html>
  `;

    // Сохраняем HTML-отчёт в файл
    const fileName = `./report/report_test_cases.${testCases[0].issue}.html`;
    mkdirSync(dirname(fileName), { recursive: true });
    writeFileSync(fileName, htmlReport, 'utf8');

    console.log(`Отчет сохранен в файл: ${fileName}`);
    return htmlReport;
}

async function generateTestCaseReport(testCase, projectId) {
    let errors = []; // Массив для ошибок
    let output = ''; // Вывод анализа тест-кейса

    // Глобальный массив субъективных слов и фраз – для проверки ожидаемого результата и шагов
    const subjectiveWords = [
        "хорошо", "верно", "быстро", "адекватно", "быть способным", "легко",
        "обеспечивать", "как минимум", "эффективно", "своевременно", "применимо",
        "если возможно", "будет определено позже", "по мере необходимости",
        "если это целесообразно", "но не ограничиваясь", "иметь возможность",
        "нормально", "минимизировать", "максимизировать", "оптимизировать", "удобно",
        "просто", "часто", "обычно", "большой", "гибкий", "устойчивый",
        "по последнему слову техники", "улучшенный", "результативно"
    ];

    // Вывод ID и названия тест-кейса
    output += `<h1>${testCase.name} (ID: ${testCase.id})</h1>`;
    output += `
    <p>
      <a href="${config.url}/project/${projectId}/test-cases/${testCase.id}" target="_blank">
        Ссылка на тест-кейс из Allure (ТестОпс)
      </a>
    </p>`;

    // Проверка status
    if (testCase.status !== 'Review') {
        errors.push('Ошибка: Статус должен быть "Review"');
    }
    output += `<p><strong>Статус:</strong> ${testCase.status} ${testCase.status !== 'Review' ? '<span style="color:red;">Ошибка: Статус должен быть "Review"</span>' : ''}</p>`;

    // Проверка tags
    const validTags = ['M', 'D', 'S', 'A', 'PWA'];
    const hasValidTag = testCase.tags.some(tag => validTags.includes(tag));
    if (!hasValidTag) {
        errors.push('Ошибка: Тег должен содержать хотя бы одно из значений: \'M\', \'D\', \'S\', \'PWA\' или \'A\'');
    }
    output += `<p><strong>Теги:</strong> ${testCase.tags.join(', ') || 'Нет значений'} ${!hasValidTag ? '<span style="color:red;">Ошибка: Тег должен содержать хотя бы одно из значений: \'M\', \'D\', \'S\', \'PWA\' или \'A\'</span>' : ''}</p>`;

    // Проверка layer
    const validLayers = ['E2E Tests', 'Integration frontend Tests', 'Integration backend Tests'];
    if (!validLayers.includes(testCase.layer)) {
        errors.push('Ошибка: Слой должен быть одним из: \'E2E Tests\', \'Integration frontend Tests\' или \'Integration backend Tests\'');
    }
    output += `<p><strong>Слои:</strong> ${testCase.layer} ${!validLayers.includes(testCase.layer) ? '<span style="color:red;">Ошибка: Слой должен быть одним из: \'E2E Tests\', \'Integration frontend Tests\' или \'Integration backend Tests\'</span>' : ''}</p>`;

    // Проверка customFields
    const requiredFields = ['Priority', 'Version'];
    const missingFields = [];
    const customFieldsOutput = testCase.customFields
        .filter(field => field.value !== 'Нет значений')
        .map(field => `${field.name}: ${field.value}`)
        .join(', ');
    for (const fieldName of requiredFields) {
        const field = testCase.customFields.find(field => field.name === fieldName);
        if (!field || field.value === 'Нет значений') {
            missingFields.push(fieldName);
        }
    }
    let customFieldsText = `<p><strong>Кастомные поля:</strong> ${customFieldsOutput || 'Нет значений'}`;
    if (missingFields.length > 0) {
        const missingFieldsMessage = `Не указаны или некорректны кастомные поля: ${missingFields.join(', ')}`;
        customFieldsText += `<span style="color:red;"><strong> Ошибка:</strong> ${missingFieldsMessage}</span>`;
        errors.push(`Ошибка: ${missingFieldsMessage}`);
    }
    customFieldsText += '</p>';
    output += customFieldsText;

    // Проверка expectedResult
    if (testCase.expectedResult === 'Нет результата') {
        errors.push('Ошибка: Конечный ожидаемый результат тест-кейса должен быть заполнен');
    }
    if (testCase.expectedResult !== 'Нет результата') {
        if (/если.*то/i.test(testCase.expectedResult)) {
            errors.push('Ошибка: Ожидаемый результат не должен содержать конструкцию "Если ... то".');
        }
        const subjectiveFound = subjectiveWords.filter(word =>
            testCase.expectedResult.toLowerCase().includes(word)
        );
        if (subjectiveFound.length > 0) {
            errors.push(`Ошибка: Ожидаемый результат содержит субъективные формулировки: ${subjectiveFound.join(', ')}`);
        }
    }
    output += `<p><strong>Ожидаемый результат:</strong> ${testCase.expectedResult} ${testCase.expectedResult === 'Нет результата' ? '<span style="color:red;"><strong>Ошибка:</strong> Конечный ожидаемый результат тест-кейса должен быть заполнен</span>' : ''}</p>`;

    // Проверка шагов
    output += `<h3>Шаги:</h3>`;
    if (!testCase.steps || testCase.steps.length === 0) {
        errors.push("Ошибка: тест-кейс должен содержать хотя бы один шаг.");
        output += `<p style="color:red;"><strong>Ошибка:</strong> Тест-кейс должен содержать хотя бы один шаг.</p>`;
    } else {
        testCase.steps.forEach((step, index) => {
            let stepErrors = [];
            if (!step.description) {
                stepErrors.push(`Описание шага ${index + 1} отсутствует.`);
            } else {
                if (!/^([а-яА-ЯёЁa-zA-Z])/.test(step.description)) {
                    stepErrors.push(`Описание шага ${index + 1} должно начинаться с буквы.`);
                }
                if (!/^([А-ЯЁ][а-яё]+(ть|ться|ти))/.test(step.description.trim())) {
                    stepErrors.push(`Описание шага ${index + 1} должно начинаться с глагола в неопределенной форме (окончания "ть", "ться" или "ти").`);
                }
                if (/если.*то/i.test(step.description)) {
                    stepErrors.push(`Описание шага ${index + 1} не должно содержать конструкцию "Если ... то".`);
                }
                const subjectiveFoundStep = subjectiveWords.filter(word =>
                    step.description.toLowerCase().includes(word)
                );
                if (subjectiveFoundStep.length > 0) {
                    stepErrors.push(`Описание шага ${index + 1} содержит субъективные формулировки: ${subjectiveFoundStep.join(', ')}`);
                }
            }
            if (stepErrors.length > 0) {
                errors.push(...stepErrors);
                output += `<p><strong>${index + 1}:</strong> ${step.description || '—'} <span style="color:red;">${stepErrors.join(' ')}</span></p>`;
            } else {
                output += `<p><strong>${index + 1}:</strong> ${step.description}</p>`;
            }
        });
    }

    if (errors.length > 0) {
        output += `<h2><strong>Ошибки</strong>:</h2><ul>${errors.map(error => `<li style="color:red;">${error}</li>`).join('')}</ul>`;
    } else {
        output += `<h2 class="passed">Тест-кейс прошел статический анализ</h2>`;
    }

    // Добавляем блок для запроса рекомендаций от ИИ с data-атрибутами
    output += `
    <div class="ai-recommendations">
      <button class="ai-recommend-btn" data-test-id="${testCase.id}">Запросить рекомендации от AI</button>
      <p id="ai-rec-text-${testCase.id}"></p>
    </div>
  `;
    output += `</div>`;
    return { report: output, hasErrors: errors.length > 0 };
}
