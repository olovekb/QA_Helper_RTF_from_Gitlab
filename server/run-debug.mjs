/**
 * Простой скрипт для итеративного тестирования агента
 * Запуск: node run-debug.mjs
 * Цель: score >= 80, errors = 0
 */

import axios from 'axios';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5002';
const MAX_ITERATIONS = 5;
const TARGET_SCORE = 80;

// 🔑 PROJECT_ID для загрузки shared steps из Allure TestOps
// Укажи свой projectId если хочешь использовать существующие shared steps
// Оставь null если shared steps не нужны
const PROJECT_ID = 166; // Замени на свой projectId или оставь null

// Тестовые требования (ОТ ПОЛЬЗОВАТЕЛЯ)
const TEST_REQUIREMENTS = `
Инициатива: TEST-IMG-001

Статус: Согласована
Дата: 17.11.2025

1. Описание функциональности

Реализовать блок "Изображение" с возможностью поиска, загрузки, редактирования и удаления изображений по категориям.

2. Требования

2.1. Поиск изображения

Кнопка "Найти изображение" открывает модальное окно "Выбор изображения"

Модальное окно содержит:
- Выпадающий список категорий (Пользовательские, Документы, Системные)
- Поле поиска по названию
- Кнопку "Загрузить своё"

При открытии окна по умолчанию отображается категория "Пользовательские"
При выборе категории отображается список изображений этой категории
При вводе текста в поиск фильтруется список по названию
При отсутствии результатов поиска отображается кнопка "Загрузить своё"

2.2. Загрузка изображения в категорию

Кнопка "Загрузить своё" открывает диалог выбора файла
Поддерживаемые форматы: PNG, JPG, JPEG, GIF
Максимальный размер: 5 МБ
После выбора файла изображение загружается в текущую выбранную категорию
При превышении размера отображается ошибка "Максимальный размер файла — 5 МБ"
При невалидном формате отображается ошибка "Поддерживаемые форматы: PNG, JPG, JPEG, GIF"

2.3. Загрузка изображения в блок

При клике на изображение из списка оно загружается в блок
В блоке отображается превью изображения
Под превью отображается название файла

2.4. Редактирование изображения

Кнопка "Отредактировать изображение" доступна при наличии изображения в блоке
При клике открывается редактор с инструментами:
- Обрезка
- Поворот (90°, 180°, 270°)
- Фильтры (Чёрно-белый, Сепия, Винтаж)
После применения изменений изображение обновляется в блоке

2.5. Удаление изображения

Кнопка "Удалить изображение из блока" удаляет изображение из текущего блока
Кнопка "Удалить изображение из категории" удаляет изображение из категории и базы данных
При удалении из категории отображается подтверждение "Удалить изображение?"

3. API

3.1. Получение списка категорий
- Метод: GET
- URL: /api/v1/images/categories
- Ответ (200 OK): [{"id": 1, "name": "Пользовательские"}, {"id": 2, "name": "Документы"}, {"id": 3, "name": "Системные"}]

3.2. Получение изображений категории
- Метод: GET
- URL: /api/v1/images/category/{categoryId}
- Параметры: categoryId (number): ID категории
- Ответ (200 OK): [{"id": 101, "name": "logo.png", "url": "/images/logo.png", "size": 1024000}, ...]

3.3. Загрузка изображения
- Метод: POST
- URL: /api/v1/images/upload
- Параметры: file (binary): файл изображения, categoryId (number): ID категории
- Ответ (200 OK): {"id": 103, "name": "photo.png", "url": "/images/photo.png", "size": 512000, "categoryId": 1}
- Ответ (400 Bad Request): {"error": "File size exceeds 5 MB"} или {"error": "Unsupported file format"}

3.4. Удаление изображения
- Метод: DELETE
- URL: /api/v1/images/{imageId}
- Параметры: imageId (number): ID изображения
- Ответ (200 OK): {"message": "Image deleted successfully"}
- Ответ (404 Not Found): {"error": "Image not found"}
`;

// Функция ожидания ввода пользователя
function waitForUser(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Сохраняет результаты в файл и выводит краткую информацию
 */
function saveAndDisplayResults(iteration, result) {
    const outputDir = './debug-output';
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `iteration-${iteration}_${timestamp}.json`;
    const filepath = path.join(outputDir, filename);

    // Сохраняем полный результат в JSON
    const fullResult = {
        iteration,
        timestamp: new Date().toISOString(),
        score: result.score,
        testModel: result.testModel,
        testCases: result.testCases,
        errors: result.errors,
        warnings: result.warnings,
        testModelStats: result.testModelStats,
        testCasesStats: result.testCasesStats
    };

    fs.writeFileSync(filepath, JSON.stringify(fullResult, null, 2), 'utf-8');
    console.log(`\n💾 Результаты сохранены: ${filepath}\n`);

    // Выводим краткую информацию о тест-кейсах
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📝 СГЕНЕРИРОВАННЫЕ ТЕСТ-КЕЙСЫ:');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (result.testCases && result.testCases.length > 0) {
        result.testCases.forEach((tc, idx) => {
            console.log(`${idx + 1}. [${tc.layer || 'NO_LAYER'}] ${tc.title || 'NO_TITLE'}`);
            console.log(`   ID: ${tc.id || '❌ ОТСУТСТВУЕТ'}`);
            console.log(`   Feature: ${tc.feature || 'N/A'}`);
            console.log(`   Story: ${tc.story || 'N/A'}`);
            
            // Показываем шаги
            if (tc.steps && tc.steps.length > 0) {
                const stepsPreview = tc.steps.slice(0, 2).map(step => {
                    if (typeof step === 'string') {
                        return step.substring(0, 60);
                    } else if (step.sharedStepId) {
                        return `[Shared Step ID: ${step.sharedStepId}]`;
                    }
                    return JSON.stringify(step).substring(0, 60);
                });
                console.log(`   Steps: ${stepsPreview.join(' → ')}${tc.steps.length > 2 ? ' ...' : ''}`);
            }
            
            // Показываем expected result
            if (tc.expected) {
                const expectedPreview = tc.expected.substring(0, 80);
                console.log(`   Expected: ${expectedPreview}${tc.expected.length > 80 ? '...' : ''}`);
            }
            
            // Показываем параметры если есть
            if (tc.parameters && tc.parameters.length > 0) {
                console.log(`   Parameters: ${tc.parameters.length} (${tc.parameters.map(p => p.name).join(', ')})`);
            }
            
            console.log(`   Tags: [${tc.tags?.join(', ') || 'N/A'}], Priority: ${tc.priority || 'N/A'}\n`);
        });
        
        // ✅ СТАТИСТИКА ПО SHARED STEPS
        const sharedStepUsage = result.testCases.reduce((acc, tc) => {
            if (tc.steps) {
                tc.steps.forEach(step => {
                    if (typeof step === 'object' && step.sharedStepId) {
                        acc.count++;
                        if (!acc.testCases.includes(tc.title)) {
                            acc.testCases.push(tc.title);
                        }
                    }
                });
            }
            return acc;
        }, { count: 0, testCases: [] });
        
        if (sharedStepUsage.count > 0) {
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('🔗 ИСПОЛЬЗОВАНИЕ SHARED STEPS:');
            console.log('═══════════════════════════════════════════════════════════════\n');
            console.log(`✅ Shared steps используются в ${sharedStepUsage.testCases.length} тест-кейсах (всего ${sharedStepUsage.count} использований)`);
            console.log(`Тест-кейсы: ${sharedStepUsage.testCases.slice(0, 3).join(', ')}${sharedStepUsage.testCases.length > 3 ? '...' : ''}\n`);
        } else {
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('⚠️  Shared steps НЕ используются в тест-кейсах');
            console.log('═══════════════════════════════════════════════════════════════\n');
        }
    } else {
        console.log('❌ Тест-кейсы не сгенерированы!\n');
    }

    console.log('═══════════════════════════════════════════════════════════════\n');

    // Выводим краткую информацию о тестовой модели
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🗂️  ТЕСТОВАЯ МОДЕЛЬ:');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (result.testModel && result.testModel.length > 0) {
        result.testModel.forEach((feature, fIdx) => {
            console.log(`Feature ${fIdx + 1}: ${feature.text}`);
            if (feature.stories && feature.stories.length > 0) {
                feature.stories.forEach((story, sIdx) => {
                    console.log(`  Story ${sIdx + 1}: ${story.text}`);
                    if (story.scenarios && story.scenarios.length > 0) {
                        story.scenarios.forEach((scenario, scIdx) => {
                            console.log(`    Scenario ${scIdx + 1}: ${scenario.text}`);
                            if (scenario.codes && scenario.codes.length > 0) {
                                scenario.codes.forEach((code, cIdx) => {
                                    const codePreview = code.text.substring(0, 60);
                                    console.log(`      Code ${cIdx + 1} [${code.type}]: ${codePreview}${code.text.length > 60 ? '...' : ''}`);
                                });
                            }
                        });
                    }
                });
            }
            console.log('');
        });
    } else {
        console.log('❌ Тестовая модель не сгенерирована!\n');
    }

    console.log('═══════════════════════════════════════════════════════════════\n');

    // Выводим эталонный пример для сравнения
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ ЭТАЛОННЫЙ ПРИМЕР (для сравнения):');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('Пример E2E теста:');
    console.log('  ID: tc-e2e-001');
    console.log('  Title: "Поиск и загрузка изображения"');
    console.log('  Steps: ["Авторизоваться в системе", "Перейти в раздел Изображения", ...]');
    console.log('  Expected: "**Отображается** превью загруженного изображения"\n');
    
    console.log('Пример Integration Frontend теста:');
    console.log('  ID: tc-if-001');
    console.log('  Title: "Фильтрация списка по категории"');
    console.log('  Scenario: "Выбрать категорию из выпадающего списка"');
    console.log('  Steps: ["Выбрать категорию {{Категория}}"]');
    console.log('  Expected: "**Отображается** список изображений категории {{Категория}}"');
    console.log('  Parameters: [{"name": "Категория", "values": ["Пользовательские", "Документы"]}]\n');
    
    console.log('Пример Integration Backend теста:');
    console.log('  ID: tc-ib-001');
    console.log('  Title: "GET /api/v1/images/categories возвращает список"');
    console.log('  Scenario: "Получить список категорий"');
    console.log('  Precondition: "Сервер доступен"');
    console.log('  Steps: ["Выполнить GET **/api/v1/images/categories**"]');
    console.log('  Expected: "**Возвращается** 200 OK с массивом [{id, name, count}]"');
    console.log('  Tags: ["S"]\n');
    
    console.log('═══════════════════════════════════════════════════════════════\n');
}

// Главная функция
async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🤖 АВТОМАТИЧЕСКОЕ ТЕСТИРОВАНИЕ АГЕНТА');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`📋 Параметры:`);
    console.log(`   - Сервер: ${BASE_URL}`);
    console.log(`   - Макс итераций: ${MAX_ITERATIONS}`);
    console.log(`   - Целевой score: ${TARGET_SCORE}+`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    let iteration = 0;
    let bestScore = 0;

    while (iteration < MAX_ITERATIONS) {
        iteration++;

        console.log('');
        console.log('───────────────────────────────────────────────────────────────');
        console.log(`🔄 ИТЕРАЦИЯ ${iteration}/${MAX_ITERATIONS}`);
        console.log('───────────────────────────────────────────────────────────────');
        console.log('');

        try {
            console.log(`[Итерация ${iteration}] Отправка запроса на тестирование...`);
            if (PROJECT_ID) {
                console.log(`[Итерация ${iteration}] 🔑 Используем ProjectId: ${PROJECT_ID} (для загрузки shared steps)`);
            }

            const payload = { requirements: TEST_REQUIREMENTS };
            if (PROJECT_ID) {
                payload.projectId = PROJECT_ID;
            }

            const response = await axios.post(`${BASE_URL}/api/debug/test-agent`, payload, {
                timeout: 12000000 // 20 минут
            });

            const result = response.data;

            console.log('');
            console.log('═══════════════════════════════════════════════════════════════');
            console.log(`📊 РЕЗУЛЬТАТ ИТЕРАЦИИ ${iteration}`);
            console.log('═══════════════════════════════════════════════════════════════');
            console.log(`Score: ${result.score}/100 ${result.score >= TARGET_SCORE ? '✅' : '❌'}`);
            console.log(`Тестовая модель: ${result.errors.model.length} ошибок, ${result.warnings.model.length} предупреждений`);
            console.log(`Тест-кейсы: ${result.errors.cases.length} ошибок, ${result.warnings.cases.length} предупреждений`);
            console.log(`Features: ${result.testModelStats.featuresCount}, Stories: ${result.testModelStats.storiesCount}, Scenarios: ${result.testModelStats.scenariosCount}, Codes: ${result.testModelStats.codesCount}`);
            console.log(`Тест-кейсов: ${result.testCasesStats.totalCases} (E2E: ${result.testCasesStats.e2eCases}, IF: ${result.testCasesStats.integrationFrontendCases}, IB: ${result.testCasesStats.integrationBackendCases})`);
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('');

            // Сохраняем и выводим подробные результаты
            saveAndDisplayResults(iteration, result);

            bestScore = Math.max(bestScore, result.score);

            // Если score >= 80 и нет ошибок - УСПЕХ!
            if (result.score >= TARGET_SCORE && result.errors.model.length === 0 && result.errors.cases.length === 0) {
                console.log('');
                console.log('🎉 ═══════════════════════════════════════════════════════════════');
                console.log('🎉 УСПЕХ! Достигнут целевой score >= 80 и нет ошибок!');
                console.log('🎉 ═══════════════════════════════════════════════════════════════');
                console.log('');
                process.exit(0);
            }

            // Если score < 80 - показываем рекомендации и ПАУЗА
            if (result.score < TARGET_SCORE) {
                console.log('📋 РЕКОМЕНДАЦИИ ПО УЛУЧШЕНИЮ:');
                console.log('');

                if (result.suggestions && result.suggestions.length > 0) {
                    result.suggestions.forEach((suggestion, idx) => {
                        console.log(`${idx + 1}. [${suggestion.priority.toUpperCase()}] ${suggestion.type}`);
                        if (suggestion.issues && suggestion.issues.length > 0) {
                            console.log(`   Проблем: ${suggestion.issues.length}`);
                            suggestion.issues.slice(0, 3).forEach(issue => {
                                console.log(`   - ${issue.substring(0, 100)}${issue.length > 100 ? '...' : ''}`);
                            });
                        }
                        console.log('');
                    });
                }

                console.log('');
                console.log('⚠️  Score < 80 - требуются исправления промптов в server.js');
                console.log('');

                // ПАУЗА - ждем подтверждения пользователя
                await waitForUser('Нажмите Enter после исправления промптов для продолжения... ');
            }

        } catch (error) {
            console.error(`[Итерация ${iteration}] ❌ ОШИБКА:`, error.message);

            if (error.response) {
                console.error(`   Статус: ${error.response.status}`);
                console.error(`   Данные:`, JSON.stringify(error.response.data, null, 2));
            }

            console.log('');
            await waitForUser('Нажмите Enter для повтора... ');
        }
    }

    // Если не достигли успеха за MAX_ITERATIONS
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`❌ Не удалось достичь score >= ${TARGET_SCORE} за ${MAX_ITERATIONS} итераций`);
    console.log(`Лучший результат: ${bestScore}/100`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    process.exit(1);
}

// Запуск
console.log('Проверка доступности сервера...');
axios.get(`${BASE_URL}/api/debug/validate-model`, {
    timeout: 5000,
    validateStatus: () => true // любой статус ok
}).then(() => {
    console.log('✅ Сервер доступен');
    main();
}).catch((error) => {
    console.error('❌ Сервер недоступен:', error.message);
    console.error('');
    console.error('Запустите сервер командой:');
    console.error('  cd server && npm start');
    console.error('');
    process.exit(1);
});
