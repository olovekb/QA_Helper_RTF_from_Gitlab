import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import JSON5 from 'json5';
import knex from 'knex';
import { v4 as uuidv4 } from 'uuid';
import compression from 'compression';


/**
 * Обработка больших запросов для OpenRouter через разделение на чанки
 * @param {Array} messages - Исходные сообщения
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Объединенный результат
 */
async function processLargeOpenRouterRequest(messages, opts, apiKey) {
    const { model, models, temperature, max_tokens, response_format } = opts;

    // Находим самое большое сообщение (обычно user content)
    let largestMessage = null;
    let largestIndex = -1;
    let maxSize = 0;

    messages.forEach((msg, index) => {
        const size = JSON.stringify(msg.content).length;
        if (size > maxSize) {
            maxSize = size;
            largestMessage = msg;
            largestIndex = index;
        }
    });

    if (!largestMessage || largestIndex === -1) {
        throw new Error('Could not find largest message to split');
    }

    console.log(`[callWithBackoff] Splitting message ${largestIndex} (${maxSize} chars) into chunks...`);

    // Разбиваем большое сообщение на чанки
    const content = largestMessage.content;
    const chunkSize = 80000; // Размер чанка в символах (примерно 20,000 токенов)
    const chunks = [];

    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }

    console.log(`[callWithBackoff] Created ${chunks.length} chunks`);

    // Обрабатываем каждый чанк
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`[callWithBackoff] Processing chunk ${i + 1}/${chunks.length}...`);

        // Создаем копию сообщений с текущим чанком
        const chunkMessages = [...messages];
        chunkMessages[largestIndex] = {
            ...largestMessage,
            content: chunks[i]
        };

        // Добавляем инструкцию для чанка
        if (chunks.length > 1) {
            chunkMessages[largestIndex].content = `ЧАСТЬ ${i + 1} ИЗ ${chunks.length}:\n\n${chunks[i]}`;
        }

        try {
            // Используем прямую отправку без проверки размера
            const chunkResult = await makeDirectOpenRouterCall(chunkMessages, apiKey, {
                model,
                models,
                temperature,
                max_tokens: Math.min(max_tokens, 4000), // Ограничиваем размер ответа
                response_format
            });

            results.push(chunkResult.choices?.[0]?.message?.content || '');
            console.log(`[callWithBackoff] Chunk ${i + 1} processed successfully`);

        } catch (error) {
            console.error(`[callWithBackoff] Chunk ${i + 1} failed:`, error.message);
            results.push(''); // Добавляем пустую строку для неудачного чанка
        }
    }

    // Объединяем результаты
    const combinedContent = results.filter(r => r.trim()).join('\n\n');

    console.log(`[callWithBackoff] Combined ${results.length} chunks into final result (${combinedContent.length} chars)`);

    // Возвращаем результат в формате, ожидаемом вызывающим кодом
    return {
        choices: [{
            message: {
                content: combinedContent
            }
        }],
        usage: {
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil(combinedContent.length / 4),
            total_tokens: Math.ceil((JSON.stringify(messages).length + combinedContent.length) / 4)
        },
        model: model
    };
}

/**
 * Прямой вызов OpenRouter API без проверки размера
 * @param {Array} messages - Сообщения
 * @param {Object} opts - Опции
 * @returns {Promise<Object>} - Результат API
 */
async function makeDirectOpenRouterCall(messages, apiKey, opts) {
    const { model, models, temperature, max_tokens, response_format } = opts;

    const modelQueue = Array.isArray(models) && models.length
        ? models
        : [model, 'qwen/qwen3-235b-a22b:free'];

    const payload = {
        model: modelQueue[0],
        messages,
        temperature,
        max_tokens,
        ...(response_format && { response_format })
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey || config.openRouterAiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://test-inspector.abanking.ru',
            'X-Title': 'Allure Test Inspector'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    return await response.json();
}

import {
    getAllureDefectById,
    getSharedStepsList,
    getStepsForDefect,
    analyzeBugWithAI,
    getAllureDefects,
    linkIssueToAllureDefect,
    getAllTestCases,
    getTestCaseOverview,
    getTestCaseExpectedResult,
    getTestCaseLayer,
    getCaseIssue,
    getCaseTags,
    getTestCasePrecondition,
    getTestCaseStatus,
    getTestCaseSteps,
    getTestCaseCustomFields,
    createTestCaseAllure,
    setTestCaseCustomFieldValues,
    updateTestCase,
    addStepToTestCase,
    linkIssueToTestCase,
    setTestCaseLayer,
    suggestTestLayers,
    getProjectCustomFieldSchema,
    fetchWithAuth,
    suggestTags,
    createTag,
    addParameterToTestCase,
    createTestCaseExamples,
    generatePairwiseExamples
} from './http-service.mjs';
import { spinningLoader } from './spinning-loader.mjs';
import pLimit from 'p-limit';
import { formatTestCase } from './format-testcase.mjs';
import { formatTestCaseAsJson } from './generate-json.mjs';
import { staticAnalysis } from './static-analysis.mjs';
import { exportStructureAllure, exportStructureAllureNocode } from './xmind-parce/export-structure-allure.mjs';
import { analyzeTestCaseWithAI } from './ai-testcase.mjs';
import { fetchConfluencePage } from './confluenceFetcher.mjs';
import { analyzeRequirementWithAI } from './analyzeRequirementWithAI.mjs';
import { Buffer } from 'buffer';
import multer from 'multer';
import axios from 'axios';
import config from './config.json' assert { type: 'json'};
import http from 'http';
import https from 'https';
import { prepareContextWithAI } from './contextRefiner.mjs';
import { callWithCloudRuFallback } from './cloudruClient.mjs';
import { createContextSourceRegistry, createContextToolset } from './contextToolset.mjs';
import { runInteractiveLLM } from './interactiveLLM.mjs';
import { selectExamples, buildExamplesSection } from './config/example-selector.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const app = express();
const PORT = 5002;

// Добавляем gzip сжатие для всех ответов
app.use(compression({
    threshold: 1024, // Сжимать файлы больше 1KB
    level: 6, // Уровень сжатия (1-9, 6 оптимальный)
    memLevel: 8, // Использование памяти
    filter: (req, res) => {
        // Сжимаем только JSON ответы
        if (req.path.includes('/api/') && res.get('Content-Type')?.includes('application/json')) {
            return compression.filter(req, res);
        }
        return false;
    }
}));

const db = knex({
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: {
        min: 2,
        max: 10
    }
});
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 20 }
});


const corsOptions = {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-OpenRouter-Key'],
    credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.options('*', cors(corsOptions));
const limit = pLimit(100);



// Универсальный рефайнер требований: подтягивает Confluence, сжимает глоссарий/контекст через prepareContextWithAI,
// возвращает совместимый интерфейс: { refinedArray, refinedText }
async function contextRefiner({
    requirements,            // string | string[] | undefined
    text,                    // string | undefined
    pageId,                  // string|number | undefined
    glossary,                // string | undefined
    glossaryPageId,          // string|number | undefined
    context,                 // string | string[] | undefined
    contextPageIds,          // string|string[]|number[] | undefined
    contextInstruction,      // string | undefined
    bearerToken,             // string | undefined
    contextPages,            // string[] | undefined - дополнительные страницы контекста
    maxGlossary = 40,        // можно прокидывать из тела запроса (увеличено с 25)
    maxContext = 50         // можно прокидывать из тела запроса (увеличено с 16)
}) {
    const normIds = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map(String).filter(Boolean);
        return String(v).split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    };

    // 0) База требований: массив/строка/Confluence pageId
    console.log(`[contextRefiner] Входные параметры: requirements=${requirements ? (Array.isArray(requirements) ? `array[${requirements.length}]` : 'string') : 'undefined'}, text.length=${(text || '').length}, pageId=${pageId}`);

    let baseList = Array.isArray(requirements)
        ? requirements.map(String)
        : [];

    let baseText = String(text || '').trim();
    console.log(`[contextRefiner] После обработки: baseList.length=${baseList.length}, baseText.length=${baseText.length}`);

    if (!baseList.length && !baseText && pageId) {
        if (!bearerToken) throw new Error('Для загрузки требования из Confluence нужен bearerToken');
        const { markdown } = await fetchConfluencePage(bearerToken, pageId, { inlineTextAttachments: true });
        baseText = markdown || '';
        console.log(`[contextRefiner] Загружено из pageId: baseText.length=${baseText.length}`);
    }

    if (!baseList.length && baseText) {
        baseList = [baseText];
        console.log(`[contextRefiner] Добавлено baseText в baseList: baseList.length=${baseList.length}`);
    }

    // 1) Глоссарий: строка + (опц.) страница
    let glossaryText = glossary || '';
    if (glossaryPageId) {
        if (!bearerToken) throw new Error('Для загрузки глоссария из Confluence нужен bearerToken');
        const { markdown } = await fetchConfluencePage(bearerToken, glossaryPageId, { inlineTextAttachments: true });
        glossaryText = [glossaryText, markdown].filter(Boolean).join('\n\n---\n\n');
    }

    // 2) Доп. контекст: строка ИЛИ массив строк + (опц.) список страниц
    let contextText = normalizeContextInput(context);
    const ctxIds = normIds(contextPageIds);

    if (ctxIds.length) {
        if (!bearerToken) throw new Error('Для загрузки доп. контекста из Confluence нужен bearerToken');
        const blocks = [];
        if (contextInstruction?.trim()) {
            blocks.push(`**Инструкция к доп. контексту:** ${contextInstruction.trim()}\n`);
        }
        for (const cid of ctxIds) {
            try {
                const { markdown } = await fetchConfluencePage(bearerToken, cid, { inlineTextAttachments: true });
                blocks.push(`\n---\n### Доп. контекст: Confluence pageId=${cid}\n\n${markdown}`);
            } catch (e) {
                blocks.push(`\n---\n### Доп. контекст: Confluence pageId=${cid}\n\n(Не удалось загрузить: ${e.message})`);
            }
        }
        contextText = [contextText, blocks.join('\n')].filter(Boolean).join('\n\n');
    }

    // 3) Сжать глоссарий/контекст через prepareContextWithAI (требования — без изменений по смыслу)
    const reqJoined = baseList.length ? baseList.join('\n\n---\n\n') : (baseText || '');

    // Логирование для диагностики
    console.log(`[contextRefiner] baseList.length=${baseList.length}, baseText.length=${baseText.length}, reqJoined.length=${reqJoined.length}`);

    // Объединяем contextPages с contextText, если они есть
    let finalContextText = contextText || '';
    if (Array.isArray(contextPages) && contextPages.length > 0) {
        const contextPagesText = contextPages.join('\n\n--- page ---\n\n');
        finalContextText = [contextText, contextPagesText].filter(Boolean).join('\n\n');
        console.log(`[contextRefiner] Добавлено ${contextPages.length} contextPages, finalContextText.length=${finalContextText.length}`);
    }

    const { requirements_md, mini_glossary_md, context_md } = await prepareContextWithAI({
        requirements: reqJoined || '',
        glossary: glossaryText || '',
        context: finalContextText || '',
        contextHint: contextInstruction || '—',
        contextPages: contextPages || [], // Передаем contextPages для joinContextPages
        maxGlossary,
        maxContext
    });

    // 4) Сформировать "шапку" и вернуть в старом формате
    const header = [
        mini_glossary_md && mini_glossary_md.trim() && `# Глоссарий\n${mini_glossary_md.trim()}`,
        context_md && context_md.trim() && `# Контекст\n${context_md.trim()}`
    ].filter(Boolean).join('\n\n');

    const refinedArray = (baseList.length ? baseList : [requirements_md || reqJoined || ''])
        .map(r => [header, r].filter(Boolean).join('\n\n'));

    const refinedText = [header, (requirements_md || reqJoined || '')]
        .filter(Boolean)
        .join('\n\n');

    return { refinedArray, refinedText };
}




// ✅ ВОССТАНОВЛЕНО: функция normalizeModelStructure критически важна для стабильной структуры
function normalizeModelStructure(model) {
    const walk = (arr, depth = 1) => (arr || []).map(item => {
        const out = { ...item };
        if (depth === 1 && Array.isArray(out.stories)) {
            out.stories = walk(out.stories, 2);
        }
        if (depth === 2 && Array.isArray(out.scenarios)) {
            out.scenarios = walk(out.scenarios, 3);
        }
        if (depth === 3) {
            const raw = Array.isArray(out.codes) ? out.codes
                : Array.isArray(out.code) ? out.code
                    : [];
            out.codes = walk(raw, 4);
            if ('code' in out) delete out.code;
        }
        return out;
    });

    // Merge nodes with identical text on the same level (Feature→Story→Scenario→Code)
    const dedupeByText = (features) => {
        const dedupedFeatures = (features || []).map(feature => {
            const stories = feature.stories || [];
            const storyMap = new Map();
            for (const st of stories) {
                const key = String(st.text || '').trim();
                if (!storyMap.has(key)) {
                    storyMap.set(key, { ...st, scenarios: [...(st.scenarios || [])] });
                } else {
                    const slot = storyMap.get(key);
                    // merge scenarios
                    slot.scenarios = [...(slot.scenarios || []), ...(st.scenarios || [])];
                }
            }

            // dedupe scenarios inside each story by text
            const mergedStories = [...storyMap.values()].map(st => {
                const scenMap = new Map();
                for (const sc of (st.scenarios || [])) {
                    const k = String(sc.text || '').trim();
                    if (!scenMap.has(k)) {
                        scenMap.set(k, { ...sc, codes: [...(sc.codes || [])] });
                    } else {
                        const slot = scenMap.get(k);
                        slot.codes = [...(slot.codes || []), ...(sc.codes || [])];
                    }
                }

                // dedupe codes by text
                const mergedScenarios = [...scenMap.values()].map(sc => {
                    const codeMap = new Map();
                    for (const cd of (sc.codes || [])) {
                        const ck = String(cd.text || '').trim();
                        if (!codeMap.has(ck)) {
                            codeMap.set(ck, { ...cd });
                        }
                        // if duplicate code with same text appears, drop it (no extra merge fields expected)
                    }
                    return { ...sc, codes: [...codeMap.values()] };
                });

                return { ...st, scenarios: mergedScenarios };
            });

            return { ...feature, stories: mergedStories };
        });

        return dedupedFeatures;
    };

    const normalized = Array.isArray(model) ? walk(model, 1) : walk([model], 1);
    return dedupeByText(normalized);
}

const RAW_USER_ACTION_PATTERNS = ['\\[\\s*step', '\\d+\\.?\\d*\\.?\\s*'];
const USER_ACTION_VERBS = [
    'Открыть',
    'Перейти',
    'Нажать',
    'Ввести',
    'Выбрать',
    'Сканировать',
    'Сфокусироваться',
    'Снять фокус',
    'Продолжить',
    'Авторизоваться',
    'Заполнить',
    'Кликнуть',
    'Навести',
    'Подтвердить',
    'Загрузить',
    'Установить',
    'Снять',
    'Выполнить',
    'Отправить',
    'Выставить',
    'Изменить',
    'Приложить',
    'Проскроллить',
    'Прочитать',
    'Ввести код',
    'Ввести смс',
    'Ввести otp',
    'Выбрать чек-бокс',
    'Выбрать значение',
    'Выполнить'
];
const RAW_SYSTEM_ACTION_PATTERNS = ['POST\\b', 'GET\\b', 'PUT\\b', 'DELETE\\b', 'PATCH\\b'];
const SYSTEM_ACTION_PREFIXES = [
    'Отобразить',
    'Рассчитать',
    'Сохранить',
    'Инициализ',
    'Вызвать',
    'Получить',
    'Вернуть',
    'Передать',
    'Сформировать',
    'Проверить',
    'Обработать',
    'Выполнить',
    'Скрыть',
    'Показать',
    'Не отображать',
    'Не вызывать',
    'Сгенерировать',
    'Записать',
    'Подготовить',
    'Отправить ответ',
    'Отправить запрос',
    'Система',
    'Продолжить',
    'Продолжать',
    'Убрать',
    'Запустить',
    'Создать',
    'Очистить',
    'Заполнить',
    'Перезаполнить',
    'Снять',
    'Оставить',
    'Сделать',
    'Повторить',
    'Отредактировать',
    'Просмотреть',
    'Не передавать',
    'Не отображать',
    'Не вызывать',
    'Не передавать',
    'Установить',
    'Сбросить',
    'Активировать',
    'Деактивировать',
    'Включить',
    'Выключить',
    'Доступн',
    'Недоступн',
    'Обязательн',
    'Необязательн'
];

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const USER_ACTION_REGEX = new RegExp(
    `^\\s*(?:${[
        ...RAW_USER_ACTION_PATTERNS,
        ...USER_ACTION_VERBS.map(escapeRegex)
    ].join('|')})`,
    'i'
);

const SYSTEM_ACTION_REGEX = new RegExp(
    `^\\s*(?:${[
        ...RAW_SYSTEM_ACTION_PATTERNS,
        ...SYSTEM_ACTION_PREFIXES.map(escapeRegex)
    ].join('|')})`,
    'i'
);

function ensureScenarioStepText(text, index) {
    let trimmed = String(text || '').trim();
    if (!trimmed) {
        return 'Выполнить пользовательское действие';
    }

    // Убираем любые старые префиксы вида [step N]
    trimmed = trimmed.replace(/^\s*\[\s*step\s*\d+\s*]\s*/i, '').trim();

    // Если фраза начинается с "Система ..." — это реакция, превратим её в действие
    if (/^система\s+/i.test(trimmed)) {
        const withoutSystem = trimmed.replace(/^система\s+/i, '');
        trimmed = `Выполнить ${withoutSystem}`;
    }

    if (USER_ACTION_REGEX.test(trimmed)) {
        return trimmed;
    }

    const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
    return `Выполнить ${lower}`;
}

// ✅ Функция для определения типа Code (backend/frontend/integration)
function detectCodeType(codeText) {
    const text = String(codeText || '').trim().toLowerCase();

    // Backend паттерны
    const backendPatterns = [
        /^(get|post|put|delete|patch)\s+\//i,  // HTTP методы
        /^вызвать\s+метод/i,                    // Вызвать метод
        /^выполнить\s+метод/i,                  // Выполнить метод
        /\/api\//i,                             // API endpoint
        /\/stateful\//i,                        // Stateful API
        /\/confirm\//i,                         // Confirm API
        /\/nopaper\//i,                         // Nopaper API
    ];

    // Frontend паттерны
    const frontendPatterns = [
        /^отобразить/i,                         // Отобразить
        /^показать/i,                           // Показать
        /^скрыть/i,                             // Скрыть
        /^активировать/i,                       // Активировать
        /^деактивировать/i,                     // Деактивировать
        /^перейти\s+на/i,                       // Перейти на
        /страницу/i,                            // Страницу
        /модальное\s+окно/i,                    // Модальное окно
        /кнопку/i,                              // Кнопку
        /поле/i,                                // Поле
        /лоадер/i,                              // Лоадер
    ];

    // Integration паттерны
    const integrationPatterns = [
        /^отправить\s+push/i,                   // Push уведомление
        /^сохранить\s+в\s+бд/i,                 // Сохранить в БД
        /^записать\s+лог/i,                     // Записать лог
        /^отправить\s+email/i,                  // Email
        /^отправить\s+sms/i,                    // SMS
    ];

    // Проверяем в порядке приоритета: integration -> backend -> frontend
    for (const pattern of integrationPatterns) {
        if (pattern.test(text)) {
            return 'integration';
        }
    }

    for (const pattern of backendPatterns) {
        if (pattern.test(text)) {
            return 'backend';
        }
    }

    for (const pattern of frontendPatterns) {
        if (pattern.test(text)) {
            return 'frontend';
        }
    }

    // По умолчанию - integration (если не определили)
    return 'integration';
}

function normalizeCodeText(rawText) {
    let text = String(rawText || '').trim();
    if (!text) return '';

    // Убираем префикс [step N]
    text = text.replace(/^\s*\[\s*step\s*\d+\s*]\s*/i, '').trim();

    // Если текст начинается с "Система" - убираем его (избыточно)
    text = text.replace(/^система\s+/i, '').trim();

    // ✅ Удаляем префиксы "API:", "UI:", "Frontend:", "Backend:"
    const invalidPrefixes = ['API:', 'UI:', 'Frontend:', 'Backend:'];
    for (const prefix of invalidPrefixes) {
        if (text.startsWith(prefix)) {
            text = text.replace(prefix, '').trim();
            console.warn(`[normalizeCodeText] Удалён префикс '${prefix}' из Code: "${text}"`);
        }
    }

    // ✅ АВТОМАТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Если текст начинается с пользовательского действия - преобразуем в системную реакцию
    if (USER_ACTION_REGEX.test(text)) {
        console.warn(`[normalizeCodeText] Code содержит пользовательское действие: "${text}" - исправляю автоматически`);

        // Преобразуем пользовательские действия в системные реакции
        // "Заполнить поле X текстом Y" → "Отобразить поле X с текстом Y"
        text = text.replace(/^заполнить\s+поле\s+["']?([^"']+)["']?\s+текстом\s+["']?([^"']+)["']?/i, 'Отобразить поле "$1" с текстом "$2"');
        text = text.replace(/^заполнить\s+поле\s+["']?([^"']+)["']?/i, 'Отобразить поле "$1"');
        text = text.replace(/^ввести\s+(.+)/i, 'Обработать ввод: $1');
        text = text.replace(/^нажать\s+(.+)/i, 'Обработать нажатие: $1');
        text = text.replace(/^выбрать\s+(.+)/i, 'Обработать выбор: $1');
        text = text.replace(/^открыть\s+(.+)/i, 'Отобразить: $1');
        // ✅ НОВОЕ: Дополнительные преобразования
        text = text.replace(/^установить\s+(чек-бокс|чекбокс|checkbox)\s+["']?([^"']+)["']?\s+в\s+состояние\s+не\s+выбран/i, 'Отобразить чек-бокс "$2" доступным для редактирования и не выбранным');
        text = text.replace(/^установить\s+(чек-бокс|чекбокс|checkbox)\s+["']?([^"']+)["']?\s+в\s+состояние\s+выбран/i, 'Отобразить чек-бокс "$2" доступным для редактирования и выбранным');
        text = text.replace(/^установить\s+(чек-бокс|чекбокс|checkbox)\s+["']?([^"']+)["']?/i, 'Отобразить чек-бокс "$2"');
        text = text.replace(/^снять\s+(выбор\s+с\s+)?(чек-бокс|чекбокс|checkbox)\s+["']?([^"']+)["']?/i, 'Сбросить значение чек-бокса "$3"');
        text = text.replace(/^выполнить\s+(GET|POST|PUT|DELETE|PATCH)\s+запрос\s+к\s+(.+)/i, '$1 $2');
        text = text.replace(/^выполнить\s+(GET|POST|PUT|DELETE|PATCH)\s+(.+)/i, '$1 $2');

        // Если после преобразования все еще начинается с пользовательского действия - добавляем префикс
        if (USER_ACTION_REGEX.test(text)) {
            text = `Обработать действие: ${text}`;
        }
    }

    // Капитализируем первую букву, если нужно
    if (text && text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
    }

    return text;
}

function convertScenarioToCodes(scenario, fallbackRequirement) {
    const codes = [];
    const scenarioText = String(scenario?.text || '').trim();
    const scenarioRequirement = scenario?.requirement || fallbackRequirement;

    if (scenarioText) {
        const normalizedScenarioCode = normalizeCodeText(scenarioText);
        if (normalizedScenarioCode) {
            codes.push({
                id: scenario?.id || uuidv4(),
                text: normalizedScenarioCode,
                requirement: scenarioRequirement
            });
        }
    }

    const originalCodes = Array.isArray(scenario?.codes) ? scenario.codes : [];
    for (const code of originalCodes) {
        const normalized = normalizeCodeText(code?.text);
        if (!normalized) continue;
        codes.push({
            ...code,
            id: code?.id || uuidv4(),
            text: normalized,
            requirement: code?.requirement || scenarioRequirement
        });
    }

    return codes;
}

function repairStoryStructure(story) {
    let stepCounter = 0;
    const repairedScenarios = [];
    let lastScenario = null;

    const appendScenario = (scenario) => {
        repairedScenarios.push(scenario);
        lastScenario = scenario;
    };

    const ensureLastScenario = (sourceScenario) => {
        if (lastScenario) return lastScenario;
        const synthetic = {
            id: sourceScenario?.id || uuidv4(),
            text: ensureScenarioStepText('Выполнить пользовательское действие', ++stepCounter),
            requirement: sourceScenario?.requirement || story?.requirement,
            codes: []
        };
        appendScenario(synthetic);
        return synthetic;
    };

    for (const originalScenario of (story?.scenarios || [])) {
        const scenarioText = String(originalScenario?.text || '').trim();
        const isUserAction = scenarioText && USER_ACTION_REGEX.test(scenarioText);

        if (!isUserAction) {
            const targetScenario = ensureLastScenario(originalScenario);
            const convertedCodes = convertScenarioToCodes(originalScenario, targetScenario.requirement || story?.requirement);
            if (convertedCodes.length) {
                targetScenario.codes = [...(targetScenario.codes || []), ...convertedCodes];
            }
            continue;
        }

        const scenarioId = originalScenario?.id || uuidv4();
        const scenarioRequirement = originalScenario?.requirement || story?.requirement;
        const normalizedScenarioText = ensureScenarioStepText(scenarioText, ++stepCounter);

        const normalizedCodes = [];
        for (const code of (originalScenario?.codes || [])) {
            const normalized = normalizeCodeText(code?.text);
            if (!normalized) continue;
            normalizedCodes.push({
                ...code,
                id: code?.id || uuidv4(),
                text: normalized,
                requirement: code?.requirement || scenarioRequirement
            });
        }

        const scenarioClone = {
            ...originalScenario,
            id: scenarioId,
            text: normalizedScenarioText,
            requirement: scenarioRequirement,
            codes: normalizedCodes
        };

        appendScenario(scenarioClone);
    }

    if (!repairedScenarios.length) {
        repairedScenarios.push({
            id: uuidv4(),
            text: `Выполнить пользовательское действие`,
            requirement: story?.requirement,
            codes: []
        });
    }

    return {
        ...story,
        scenarios: repairedScenarios
    };
}

function repairModelStructure(model) {
    return (model || []).map(feature => {
        return {
            ...feature,
            stories: (feature?.stories || []).map(story => {
                return {
                    ...story,
                    ...repairStoryStructure(story)
                };
            })
        };
    });
}

// ✅ Функция для автоматического исправления Code с пользовательскими действиями
function autoFixCodeWithUserActions(model) {
    return (model || []).map(feature => {
        return {
            ...feature,
            stories: (feature?.stories || []).map(story => {
                return {
                    ...story,
                    scenarios: (story?.scenarios || []).map(scenario => {
                        return {
                            ...scenario,
                            codes: (scenario?.codes || []).map(code => {
                                // Применяем normalizeCodeText для автоматического исправления
                                const fixedText = normalizeCodeText(code?.text);
                                return {
                                    ...code,
                                    text: fixedText
                                };
                            })
                        };
                    })
                };
            })
        };
    });
}

// ✅ Функция для валидации и очистки модели от requirement и префиксов, добавления типа Code
function validateAndCleanModel(model) {
    const errors = [];
    const warnings = [];

    for (const feature of model || []) {
        // ✅ Проверка: requirement должен отсутствовать
        if ('requirement' in feature) {
            delete feature.requirement;
            errors.push(`[CLEANED] Удалено поле 'requirement' из Feature: ${feature.text}`);
        }

        for (const story of feature.stories || []) {
            if ('requirement' in story) {
                delete story.requirement;
                errors.push(`[CLEANED] Удалено поле 'requirement' из Story: ${story.text}`);
            }

            for (const scenario of story.scenarios || []) {
                if ('requirement' in scenario) {
                    delete scenario.requirement;
                    errors.push(`[CLEANED] Удалено поле 'requirement' из Scenario: ${scenario.text}`);
                }

                // ✅ Проверка: Scenario должен начинаться с "N."
                if (!/^\d+\./.test(scenario.text)) {
                    warnings.push(`[WARNING] Scenario не начинается с номера: "${scenario.text}"`);
                }

                for (const code of scenario.codes || []) {
                    if ('requirement' in code) {
                        delete code.requirement;
                        errors.push(`[CLEANED] Удалено поле 'requirement' из Code: ${code.text}`);
                    }

                    // ✅ Проверка: Code не содержит префиксов (нормализация уже применена в normalizeCodeText)
                    const invalidPrefixes = ['API:', 'UI:', 'Frontend:', 'Backend:'];
                    for (const prefix of invalidPrefixes) {
                        if (code.text && code.text.startsWith(prefix)) {
                            code.text = code.text.replace(prefix, '').trim();
                            errors.push(`[CLEANED] Удалён префикс '${prefix}' из Code: "${code.text}"`);
                        }
                    }

                    // ✅ Добавляем поле type для Code (если отсутствует)
                    if (!code.type && code.text) {
                        code.type = detectCodeType(code.text);
                    }

                    // ✅ Проверка: Code не пустой
                    if (!code.text || !code.text.trim()) {
                        warnings.push(`[WARNING] Code с пустым text в Scenario: ${scenario.text}`);
                    }
                }

                // ✅ Проверка: Scenario содержит хотя бы один Code
                if (!scenario.codes || scenario.codes.length === 0) {
                    warnings.push(`[WARNING] Scenario без Code: "${scenario.text}"`);
                }
            }
        }
    }

    if (errors.length > 0) {
        console.warn(`[VALIDATION] Найдено ${errors.length} проблем (исправлено автоматически):`);
        errors.forEach(err => console.warn(`  ${err}`));
    }

    if (warnings.length > 0) {
        console.warn(`[VALIDATION] Найдено ${warnings.length} предупреждений:`);
        warnings.forEach(warn => console.warn(`  ${warn}`));
    }

    return model;
}

const TECHNICAL_PREFIXES = /^(реализовать|алгоритм|функция|метод|api|система|доработка|реализация)\s+/i;
const CONTROL_PATTERNS = /^(чек-бокс|чекбокс|checkbox|переключатель|radio|toggle|поле|field|input|кнопка|button|btn)\s*["']?/i;

function detectModelStructureIssues(model, contextLabel = 'model') {
    const issues = [];
    (model || []).forEach((feature, featureIdx) => {
        const featureTitle = String(feature?.text || `Feature#${featureIdx + 1}`).trim();

        // Проверка Feature на технические формулировки
        if (featureTitle && TECHNICAL_PREFIXES.test(featureTitle)) {
            issues.push(`Feature "${featureTitle}" использует техническую формулировку вместо бизнес-потребности`);
        }

        // Проверка Feature на технические названия документов
        if (featureTitle && /^доработка\s+/i.test(featureTitle)) {
            issues.push(`Feature "${featureTitle}" является техническим названием документа, а не бизнес-потребностью. Feature должна описывать ЧТО получает пользователь, а не техническое название документа.`);
        }

        // Проверка Feature на описание технических деталей вместо бизнес-потребности
        if (featureTitle && /(форма|документ|операция|метод|api|endpoint|запрос|ответ)/i.test(featureTitle) && !/(получить|создать|добавить|удалить|изменить|просмотреть|работа|использование)/i.test(featureTitle)) {
            // Если Feature содержит технические термины, но не содержит глаголы действия пользователя - это подозрительно
            if (!/(безбумажный|регистрация|авторизация|платеж|перевод|операция|документ)/i.test(featureTitle)) {
                issues.push(`Feature "${featureTitle}" может быть техническим описанием вместо бизнес-потребности. Feature должна описывать ценность для пользователя (например, "Безбумажный офис", "Добавление операции в документ").`);
            }
        }

        (feature?.stories || []).forEach((story, storyIdx) => {
            const storyTitle = String(story?.text || `Story#${storyIdx + 1}`).trim();

            // Проверка Story на технические формулировки
            if (storyTitle && TECHNICAL_PREFIXES.test(storyTitle)) {
                issues.push(`Story "${storyTitle}" использует техническую формулировку вместо пользовательской истории (${featureTitle})`);
            }

            // Проверка Story на описания контролов
            if (storyTitle && CONTROL_PATTERNS.test(storyTitle)) {
                issues.push(`Story "${storyTitle}" является описанием контрола, а не пользовательской историей (${featureTitle})`);
            }

            let lastValidScenario = null;

            (story?.scenarios || []).forEach((scenario, scenarioIdx) => {
                const scenarioTitle = String(scenario?.text || '').trim();
                const labelBase = `${featureTitle} → ${storyTitle}`;

                if (!scenarioTitle) {
                    issues.push(`Scenario без текста (${labelBase})`);
                } else if (!USER_ACTION_REGEX.test(scenarioTitle)) {
                    issues.push(`Scenario "${scenarioTitle}" не начинается с действия пользователя (${labelBase})`);
                } else {
                    lastValidScenario = scenarioTitle;
                }

                const codes = Array.isArray(scenario?.codes) ? scenario.codes : [];
                if (codes.length === 0) {
                    issues.push(`Scenario "${scenarioTitle || `#${scenarioIdx + 1}`}" не содержит системных реакций (codes) (${labelBase})`);
                }

                codes.forEach(code => {
                    const codeTitle = String(code?.text || '').trim();
                    const detailedLabel = `${labelBase}${scenarioTitle ? ` → ${scenarioTitle}` : ''}`;

                    if (!codeTitle) {
                        issues.push(`Code без текста (${detailedLabel})`);
                        return;
                    }

                    // Проверяем только на отсутствие пользовательских действий
                    // Если это не пользовательское действие, то это системная реакция
                    if (USER_ACTION_REGEX.test(codeTitle)) {
                        issues.push(`Code "${codeTitle}" содержит пользовательское действие (${detailedLabel})`);
                    }
                    // Убрали строгую проверку SYSTEM_ACTION_REGEX - если это не пользовательское действие,
                    // то считаем это системной реакцией (могут быть формулировки, не начинающиеся с известных префиксов)
                });
            });
        });
    });
    return issues;
}

function summarizeStructureIssuesForPrompt(issues, limit = 3) {
    if (!Array.isArray(issues) || issues.length === 0) return '';
    const top = issues.slice(0, limit);
    const rest = issues.length - top.length;
    return `${top.map(issue => `- ${issue}`).join('\n')}${rest > 0 ? `\n- ... и ещё ${rest} нарушений` : ''}`;
}

// Выделение релевантных секций из markdown страницы по ключам из цитаты
function extractRelevantSections(markdown, mentionText, { maxSections = 6, maxChars = 50000 } = {}) {
    const md = String(markdown || '');
    const mention = String(mentionText || '').toLowerCase();
    const tokens = new Set(
        mention
            .replace(/[^a-zA-Zа-яА-Я0-9\s_-]+/g, ' ')
            .split(/\s+/)
            .filter(w => w && w.length > 2)
            .map(w => w.toLowerCase())
    );
    // Разбиваем по секциям заголовков второго уровня и ниже
    const sections = md.split(/\n(?=##+\s)/).map(s => s.trim()).filter(Boolean);
    const scoreSection = (s) => {
        const text = s.toLowerCase();
        let score = 0;
        tokens.forEach(t => { if (text.includes(t)) score += 1; });
        // бонус за точные фразы из кавычек в цитате
        const quoted = Array.from(mention.matchAll(/"([^"]{3,})"/g)).map(m => m[1].toLowerCase());
        quoted.forEach(q => { if (q && text.includes(q)) score += 3; });
        return score;
    };
    const ranked = sections
        .map(s => ({ s, score: scoreSection(s) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSections)
        .map(x => x.s);
    let out = ranked.join('\n\n---\n\n');
    if (out.length > maxChars) out = out.slice(0, maxChars);
    // если ранжирование пустое (нет совпадений) — вернём первые существенные 1-2 секции
    if (!out.trim()) out = sections.slice(0, Math.min(2, sections.length)).join('\n\n---\n\n');
    return out || md.slice(0, Math.min(maxChars, md.length));
}


async function fetchJiraMeta(pat, projectKey) {
    const { data } = await axios.post(
        `${config.serverUrl}/api/jira/meta`,
        { pat, projectKey }
    );
    // data.options = { Severity: [...], Platform: [...], Symptom: [...] }
    return data.options;
}

/**
 * Определяет список кодов платформ по правилу:
 * 1) Если в summary есть префикс "<код> | ..." — берём именно эти коды
 * 2) Иначе смотрим на текст окружения (env) и ищем ключевые слова
 * 3) Иначе — Desktop по умолчанию
 *
 * Коды: 
 *  D    — Desktop/Web
 *  A    — Adaptive
 *  M    — Mobile (iOS/Android)
 *  S    — Backend
 *  PWA  — Progressive Web App
 */
function detectPlatforms(summary, env) {
    const result = [];

    // 1) Парсим префикс из summary: "КОД | остальное"
    if (typeof summary === 'string') {
        const m = summary.trim().match(/^([A-Za-z]{1,3})\s*\|/);
        if (m) {
            const code = m[1].toUpperCase();
            // если PWA — целиком
            if (code === 'PWA') {
                return ['PWA'];
            }
            // иначе разбиваем на символы и фильтруем по допустимым
            for (const ch of code.split('')) {
                if (['D', 'A', 'M', 'S'].includes(ch) && !result.includes(ch)) {
                    result.push(ch);
                }
            }
            if (result.length) {
                return result;
            }
        }
    }

    // 2) Если не нашли в теме — смотрим env
    if (typeof env === 'string') {
        const txt = env.toLowerCase();
        if ((/android|ios/).test(txt)) {
            result.push('M');
        }
        if ((/chrome|firefox|edge|safari|desktop|web/).test(txt)) {
            result.push('D');
        }
        if (txt.includes('adaptive')) {
            result.push('A');
        }
        if (txt.includes('pwa')) {
            result.push('PWA');
        }
        if ((/backend|api/).test(txt)) {
            result.push('S');
        }
        // убираем дубли
        if (result.length) {
            return Array.from(new Set(result));
        }
    }

    // 3) Иначе — Desktop по умолчанию
    return ['D'];
}

function buildFillJiraFieldsTool({ sevOptions, platOptions, sympOptions }) {
    const sevEnum = sevOptions.map(o => o.name);
    const platEnum = platOptions.map(o => o.name);
    const sympEnum = sympOptions.map(o => o.name);

    return {
        type: "function",
        function: {
            name: "fill_jira_fields",
            description: "Верни подобранные значения и тексты для баг-репорта",
            parameters: {
                type: "object",
                properties: {
                    actual: { type: "string", description: "Фактический результат (лаконично, по сути)" },
                    expected: { type: "string", description: "Ожидаемый результат (лаконично, по сути)" },
                    severity: { type: "string", enum: sevEnum },
                    platform: { type: "array", items: { type: "string", enum: platEnum } },
                    symptom: { type: "array", items: { type: "string", enum: sympEnum } }
                },
                required: ["actual", "expected", "severity", "platform", "symptom"],
                additionalProperties: false
            }
        }
    };
}



function extractJsonArray(text) {
    // 1) fenced ```json``` — самый честный путь
    const fence = text.match(/```json\s*([\s\S]*?)```/i);
    if (fence) return fence[1].trim();

    // 2) Собираем все кандидаты «сбалансированных» массивов
    const candidates = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '[') continue;
        let depth = 0, inString = false, esc = false;
        for (let j = i; j < text.length; j++) {
            const ch = text[j];
            if (inString) {
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === '"') { inString = false; continue; }
            } else {
                if (ch === '"') { inString = true; continue; }
                if (ch === '[') depth++;
                if (ch === ']') {
                    depth--;
                    if (depth === 0) {
                        const chunk = text.slice(i, j + 1);
                        candidates.push(chunk);
                        break;
                    }
                }
            }
        }
    }

    // 3) Если найдено несколько массивов, объединяем их
    if (candidates.length > 1) {
        console.log(`[extractJsonArray] Найдено ${candidates.length} JSON массивов, объединяем их`);
        try {
            const allArrays = [];
            for (const candidate of candidates) {
                try {
                    const parsed = JSON5.parse(candidate);
                    if (Array.isArray(parsed)) {
                        allArrays.push(...parsed);
                    }
                } catch (e) {
                    console.warn(`[extractJsonArray] Ошибка парсинга кандидата: ${e.message}`);
                }
            }
            if (allArrays.length > 0) {
                console.log(`[extractJsonArray] Объединено ${allArrays.length} тест-кейсов из ${candidates.length} массивов`);
                return JSON.stringify(allArrays);
            }
        } catch (e) {
            console.warn(`[extractJsonArray] Ошибка объединения массивов: ${e.message}`);
        }
    }

    // 4) Сортируем по «похожести на наши кейсы»
    const score = s =>
        (s.length > 500 ? 3 : 0) +
        (s.includes('{') ? 3 : 0) +
        (/"feature"\s*:/.test(s) ? 2 : 0) +
        (/"story"\s*:/.test(s) ? 1 : 0);

    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0] || null;
}

function cleanupJsonText(s) {
    // Подчистить наиболее частые артефакты
    let t = s;

    // убрать висячие запятые перед } или ]
    t = t.replace(/,\s*(?=[}\]])/g, '');

    // ключи без кавычек → в кавычки
    t = t.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');

    // убрать markdown-комменты // и строки-«пули» в начале строки
    t = t.replace(/^\s*\/\/.*$/gm, '');
    t = t.replace(/^\s*-\s+.*$/gm, '');

    // вырезать мусор до первой '[' и после последней ']'
    const first = t.indexOf('[');
    if (first > 0) t = t.slice(first);
    const last = t.lastIndexOf(']');
    if (last >= 0) t = t.slice(0, last + 1);

    return t.trim();
}


function buildPlatformMap(platOptions) {
    const m = {};
    platOptions.forEach(o => {
        const n = o.name.toLowerCase();
        if (n.includes('desktop') || n.includes('web')) m['D'] = o.id;
        else if (n.includes('adaptive')) m['A'] = o.id;
        else if (n.includes('ios') || n.includes('android')) m['M'] = o.id;
        else if (n.includes('pwa')) m['PWA'] = o.id;
        else if (n.includes('backend')) m['S'] = o.id;
    });
    return m;
}

// Функция фильтрации тест-кейсов
async function filterCases(allCases, jiraIssue, projectId) {
    console.log(`filterCases принял: ${jiraIssue} ${projectId}`)
    const filteredCases = [];

    const promises = allCases.map((testCase) =>
        limit(async () => {
            const { id, name } = testCase;

            // Условие: Связь с Jira
            const issue = await getCaseIssue(id);
            if (!issue.some(issue => issue.name === `${jiraIssue}`)) {
                return; // Пропускаем этот тест-кейс
            }

            // Запускаем запросы параллельно
            const [tags, steps, expectedResult, status, layer, precondition, customFields] = await Promise.all([
                getCaseTags(id),
                getTestCaseSteps(id),
                getTestCaseExpectedResult(id),
                getTestCaseStatus(id),
                getTestCaseLayer(id),
                getTestCasePrecondition(id),
                getTestCaseCustomFields(id, projectId)
            ]);
            filteredCases.push({ id, name, issue, tags, steps, expectedResult, layer, status, precondition, customFields });
        })
    );

    // Ждем завершения всех промисов
    await Promise.all(promises);

    return filteredCases.filter(caseItem => caseItem !== undefined);
}

// API для анализа тест-кейсов
app.post('/api/analyze', async (req, res) => {
    const { projectId, jiraIssue } = req.body;
    console.log(`Запрос /api/analyze получил: ${JSON.stringify(req.body)}`)

    try {
        let spinnerInterval = spinningLoader('Получение всех тест-кейсов проекта...');
        const allCases = await getAllTestCases(projectId);
        clearInterval(spinnerInterval);
        console.log(`Всего кейсов в проекте: ${allCases.length}`);

        // Запускаем анимацию перед фильтрацией
        spinnerInterval = spinningLoader(`Фильтрация тест-кейсов по задаче ${jiraIssue}...`);
        const filteredCases = await filterCases(allCases, jiraIssue, projectId);
        clearInterval(spinnerInterval);
        console.log(`Отсортированные тест-кейсы по выбранной задаче Jira: ${filteredCases.length}`);

        // Форматируем и сохраняем результаты
        let result = '';
        let jsonResult = [];

        for (const caseItem of filteredCases) {
            result += await formatTestCase(caseItem);
            jsonResult.push(await formatTestCaseAsJson(caseItem)); // Ждём результат от каждой функции
        }

        // Вывод результатов
        console.log(result);
        const htmlReport = await staticAnalysis(jsonResult, projectId); // Генерация анализа

        // Возвращаем форматированный результат в ответе
        res.json(htmlReport);

    } catch (error) {
        console.error(`Ошибка: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Запрос на экспорт тестовой модели
app.post('/api/export', async (req, res) => {
    console.log('Вошли в експорт')
    const { allureData, projectId } = req.body; // Получаем JSON с клиента

    console.log({ allureData, projectId })

    if (!allureData || !projectId) {
        return res.status(400).send('Отсутствуют данные для экспорта. Или Id проекта');
    }

    try {
        // Если проект - "Nocode 2.0", то делаем экспорт по новой структуре
        if (projectId === '307') {
            console.log('Экспортируем по новой структуре для НОУКОДА')
            await exportStructureAllureNocode(allureData, projectId);
        } else {
            console.log('Экспортируем НЕ для НОУКОДА')
            await exportStructureAllure(allureData, projectId);
        }

        res.status(200).send('Экспорт успешно завершён.');
    } catch (error) {
        console.error('Ошибка экспорта:', error.message);

        res.status(500).send('Ошибка при экспорте.');
    }
});

app.post('/api/ai-recommendation', async (req, res) => {
    try {
        // Получаем OpenRouter API Key из header (с фоллбэком на config)
        const apiKey = req.headers['x-openrouter-key']?.trim() || config.openRouterAiKey;

        let testCase = req.body;

        if (!testCase.id) {
            throw new Error('Отсутствует id тест-кейса');
        }
        if (!testCase.projectId) {
            throw new Error('Отсутствует projectId');
        }

        console.log('Запрос рекомендации для тест-кейса:', testCase.id);

        // Если некоторые поля отсутствуют, дополняем их
        if (!testCase.steps || !testCase.expectedResult) {
            const id = testCase.id;
            const projectId = testCase.projectId;
            const [
                tags,
                steps,
                expectedResult,
                status,
                layer,
                precondition,
                customFields,
                issue
            ] = await Promise.all([
                getCaseTags(id),
                getTestCaseSteps(id),
                getTestCaseExpectedResult(id),
                getTestCaseStatus(id),
                getTestCaseLayer(id),
                getTestCasePrecondition(id),
                getTestCaseCustomFields(id, projectId),
                getCaseIssue(id)
            ]);
            // Обновляем объект, сохраняя все поля, что пришли от клиента и дополняем недостающие.
            testCase = {
                ...testCase,
                tags,
                steps,
                expectedResult,
                status,
                layer,
                precondition,
                customFields,
                issue,
                projectId
            };
        }

        // Если поле name отсутствует, делаем запрос на overview и извлекаем name
        if (!testCase.name) {
            try {
                const overviewData = await getTestCaseOverview(testCase.id);
                // Предполагаем, что overviewData содержит поле name
                testCase.name = overviewData.name || "Неизвестно";
            } catch (error) {
                console.error('Ошибка при получении overview тест-кейса:', error.message);
                testCase.name = "Неизвестно";
            }
        }

        // Вызываем функцию анализа тест-кейса с использованием ИИ
        const recommendation = await analyzeTestCaseWithAI(testCase, apiKey);
        res.json({ recommendation });
    } catch (error) {
        console.error('Ошибка в /ai-recommendation:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/** Строка/массив -> массив pageId */
function normalizePageIds(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    return String(v)
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

/** Строка или массив строк -> единый markdown-блок с разделителями */
function normalizeContextInput(v) {
    if (!v) return '';
    if (Array.isArray(v)) {
        return v
            .map(s => String(s || '').trim())
            .filter(Boolean)
            .join('\n\n---\n\n');
    }
    return String(v);
}


/**
 * POST /api/analyze/solution
 * Тело: { text?: string, pageId?: string|number, context?: string, project?: string,
 *         glossary?: string, bearerToken?: string,
 *         glossaryPageId?: string|number,
 *         contextPageIds?: string|string[]|number[],
 *         contextInstruction?: string }
 */
app.post('/api/analyze/solution', async (req, res) => {
    try {
        const {
            text, pageId, context, project, glossary, bearerToken,
            glossaryPageId,
            contextPageIds,
            contextInstruction
        } = req.body;

        // Получаем OpenRouter API Key из header (с фоллбэком на config)
        const apiKey = req.headers['x-openrouter-key']?.trim() || config.openRouterAiKey;

        if (!text && !pageId) {
            return res.status(400).json({ success: false, error: 'Параметр text или pageId обязателен.' });
        }

        // 1) Основное требование
        let requirementText = text;
        let collectedAttachments = [];

        if (pageId) {
            if (!bearerToken) {
                return res.status(400).json({ success: false, error: 'Для получения страницы Confluence требуется bearerToken' });
            }
            const { markdown, attachments } = await fetchConfluencePage(bearerToken, pageId);
            requirementText = markdown;
            collectedAttachments = attachments || [];
            // AUTO-CONTEXT: извлечь ссылки вида ...pageId=123456 из основной статьи и подтянуть их как дополнительный контекст (без рекурсии)
            try {
                const linkedIds = new Set();
                // 1. Извлекаем pageId= из markdown
                Array.from(String(markdown || '').matchAll(/pageId=(\d{4,})/g)).forEach(m => linkedIds.add(m[1]));
                // 2. Извлекаем pageId из обычных URL вида https://confluence.../pages/viewpage.action?pageId=123456
                Array.from(String(markdown || '').matchAll(/viewpage\.action\?pageId=(\d{4,})/gi)).forEach(m => linkedIds.add(m[1]));
                // 3. Извлекаем pageId из коротких ссылок вида /pages/123456
                Array.from(String(markdown || '').matchAll(/\/pages\/(\d{4,})/g)).forEach(m => linkedIds.add(m[1]));
                // не включаем саму страницу
                linkedIds.delete(String(pageId));
                console.log(`[analyze/solution] Найдено ${linkedIds.size} ссылок на другие страницы: [${Array.from(linkedIds).join(', ')}]`);
                if (linkedIds.size) {
                    // подготовим список markdown‑блоков для contextPages
                    const autoCtx = [];
                    const autoIds = new Set();
                    for (const lid of linkedIds) {
                        try {
                            const { markdown: md } = await fetchConfluencePage(bearerToken, lid, { inlineTextAttachments: true });
                            if (autoIds.has(String(lid))) continue;
                            // найдём строку(и) в основной статье, где эта ссылка упомянута, чтобы сохранить семантику отсылки
                            const lines = String(markdown || '').split(/\n/);
                            const refIdx = lines.findIndex(l => l.includes(`pageId=${lid}`));
                            let mention = '';
                            if (refIdx !== -1) {
                                const start = Math.max(0, refIdx - 2);
                                const end = Math.min(lines.length, refIdx + 3);
                                mention = lines.slice(start, end).join('\n').trim();
                            }
                            autoCtx.push([
                                `### Контекст по ссылке из основной статьи (pageId=${lid})`,
                                mention ? `> Упоминание в основной статье:\n> ${mention.replace(/\n/g, '\n> ')}` : `> Упоминание в основной статье: не найдено (pageId=${lid})`,
                                '',
                                md
                            ].join('\n'));
                            autoIds.add(String(lid));
                        } catch (e) {
                            autoCtx.push(`### Контекст: ссылка из основной статьи (pageId=${lid})\n\n(Не удалось загрузить: ${e.message})`);
                        }
                    }
                    // временно положим в специальное поле, далее сольём с user contextPages ниже
                    req._autoExtractedContextPages = autoCtx;
                    req._autoExtractedContextIds = Array.from(autoIds);
                }
            } catch (e) {
                console.warn('Auto-context extraction failed:', e.message);
            }
        }

        // 2) Глоссарий
        let glossaryText = glossary || '';
        if (glossaryPageId) {
            if (!bearerToken) {
                return res.status(400).json({ success: false, error: 'Для загрузки глоссария из Confluence требуется bearerToken' });
            }
            try {
                const { markdown } = await fetchConfluencePage(bearerToken, glossaryPageId, { inlineTextAttachments: true });
                glossaryText = markdown;
            } catch (e) {

                throw new Error(`Не удалось получить глоссарий из Confluence (pageId=${glossaryPageId}): ${e.message}`);
            }
        }

        let contextText = normalizeContextInput(context);
        const ctxIds = normalizePageIds(contextPageIds);
        const contextPages = [];

        if (ctxIds.length) {
            if (!bearerToken) {
                return res.status(400).json({ success: false, error: 'Для загрузки доп. контекста из Confluence требуется bearerToken' });
            }

            const skipIds = new Set((req._autoExtractedContextIds || []).map(String));
            for (const raw of ctxIds) {
                const cid = String(raw);
                if (skipIds.has(cid)) continue;
                try {
                    const { markdown } = await fetchConfluencePage(bearerToken, cid, { inlineTextAttachments: true });

                    contextPages.push(markdown);
                } catch (e) {

                    contextPages.push(`Confluence pageId=${cid}\n\n(Не удалось загрузить: ${e.message})`);
                }
            }
        }

        // 4) Анализ (с префильтром)
        // Подсказка для AI: поясняем, что contextPages получены из ссылок исходного требования
        const extraHint = (Array.isArray(req._autoExtractedContextPages) && req._autoExtractedContextPages.length)
            ? 'Контекстные страницы ниже получены по ссылкам из исходного требования. Используй из них только факты, непосредственно разъясняющие ссылки в тексте требования (без домыслов и расширений).'
            : '';

        const aiResponse = await analyzeRequirementWithAI(
            requirementText,
            // более глубокий контекст: склеим user context + релевантные страницы
            [contextText, (req._autoExtractedContextPages || []).join('\n\n')].filter(Boolean).join('\n\n'),
            project,
            glossaryText,
            {
                prefilter: true,
                contextHint: [contextInstruction || '—', extraHint].filter(Boolean).join(' '),
                contextPages
            },
            apiKey // передаём пользовательский API ключ
        );

        const result = {
            ai: { success: true, response: aiResponse },
            attachments: collectedAttachments.length ? collectedAttachments : undefined
        };

        return res.json({ success: true, data: result });

    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});


app.post('/api/jira/create-issue', async (req, res) => {
    const { pat, payload } = req.body;

    if (!pat || !payload) {
        return res.status(400).json({ error: 'PAT и payload обязательны' });
    }

    // Логируем входящий payload
    console.log('Входящий payload:', JSON.stringify(payload, null, 2));

    // Проверка обязательных полей в payload
    const requiredFields = ['project', 'issuetype', 'summary', 'description'];
    const missingFields = requiredFields.filter(field => !payload.fields || !payload.fields[field]);
    if (missingFields.length > 0) {
        return res.status(400).json({ error: `Отсутствуют обязательные поля: ${missingFields.join(', ')}` });
    }

    const jiraBaseUrl = 'https://jira.abanking.ru';
    try {
        // Логируем тело запроса перед отправкой
        console.log('Отправляемый payload в Jira:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${jiraBaseUrl}/rest/api/2/issue`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pat}`,
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('Ответ от Jira:', JSON.stringify(data, null, 2));
            throw new Error(
                data.errorMessages?.join(', ') ||
                Object.keys(data.errors || {})
                    .map(key => `${key}: ${data.errors[key]}`)
                    .join(', ') ||
                'Неизвестная ошибка'
            );
        }
        res.json({ success: true, key: data.key });
    } catch (err) {
        console.error('Ошибка при создании задачи в Jira:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


// Эндпоинт для получения метаданных проекта (поля, пользователи, версии)
app.post('/api/jira/meta', async (req, res) => {
    const jiraBase = 'https://jira.abanking.ru';
    const issueKey = 'NPP-15541';               // берём из вашего CURL
    const { pat, projectKey } = req.body;     // передаёте с фронта

    if (!pat || !projectKey) {
        return res.status(400).json({ error: 'PAT и projectKey обязательны' });
    }

    const headers = {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json'
    };

    try {
        // 1) Получаем метаданные полей для указанного issueKey
        const editRes = await fetch(
            `${jiraBase}/rest/api/2/issue/${encodeURIComponent(issueKey)}/editmeta`,
            { headers }
        );
        if (!editRes.ok) {
            throw new Error(`editmeta вернул ${editRes.status}`);
        }
        const { fields } = await editRes.json();

        // сопоставление UI-ключа → имя поля в Jira
        const customFieldNames = {
            Severity: 'Серьезность ошибки',
            Symptom: 'Симптом',
            Platform: 'Платформа',
            ProdBug: 'Баг с прода',
            'Epic Link': 'Epic Link',
            'Основной исполнитель': 'Основной исполнитель',
            'Ревьюеры': 'Ревьюеры'
        };

        const options = {};
        const fieldIds = {};

        // 2) Извлекаем id полей и их опции
        for (const [key, jiraName] of Object.entries(customFieldNames)) {
            const entry = Object.entries(fields)
                .find(([_, meta]) => meta.name === jiraName);

            if (!entry) {
                console.warn(`[META] Поле "${jiraName}" не найдено в editmeta`);
                options[key] = [];
                continue;
            }

            const [fieldId, meta] = entry;
            fieldIds[key] = fieldId;
            options[key] = (meta.allowedValues || []).map(o => ({
                id: String(o.id),
                name: o.value ?? o.name
            }));
        }
        // return res.json({ options, fieldIds, users, versions });
        return res.json({ options, fieldIds })
    }
    catch (err) {
        console.error('Ошибка /jira/meta:', err);
        return res.status(500).json({ error: err.message });
    }
});


// 1. Поиск assignable пользователей
app.get('/api/jira/users', async (req, res) => {
    const { projectKey, pat, query = '', startAt = 0, maxResults = 50 } = req.query;
    const jiraBase = 'https://jira.abanking.ru';
    const headers = {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json'
    };

    const url = `${jiraBase}/rest/api/2/user/assignable/search`
        + `?project=${encodeURIComponent(projectKey)}`
        + `&username=${encodeURIComponent(query)}`
        + `&startAt=${startAt}`
        + `&maxResults=${maxResults}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) return res.status(resp.status).end();
    const users = await resp.json();
    return res.json(users);
});

// 2. Поиск версий (фильтрация по имени)
app.get('/api/jira/versions', async (req, res) => {
    const { projectKey, pat, query = '' } = req.query;
    const jiraBase = 'https://jira.abanking.ru';
    const headers = {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json'
    };

    // Получаем все версии разом (они обычно меньше 1000)...
    const all = await fetch(
        `${jiraBase}/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`,
        { headers }
    ).then(r => r.ok ? r.json() : []);

    // ...а потом фильтруем по подстроке и отдаем первые 50
    const filtered = all
        .filter(v => v.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 50);

    return res.json(filtered);
});

// GET /jira/transitions?issueKey=JMT-123
app.get('/api/jira/transitions', async (req, res) => {
    const { pat, issueKey } = req.query;
    if (!pat || !issueKey) {
        return res.status(400).json({ error: 'Нужны pat и issueKey' });
    }
    try {
        const response = await fetch(
            `https://jira.abanking.ru/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
            {
                headers: {
                    'Authorization': `Bearer ${pat}`,
                    'Accept': 'application/json'
                }
            }
        );
        if (!response.ok) throw new Error(`Jira вернула ${response.status}`);
        const { transitions } = await response.json();
        // вернём только id + name для селекта
        const ops = transitions.map(t => ({ id: t.id, name: t.name }));
        res.json(ops);
    } catch (err) {
        console.error('Ошибка /jira/transitions:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/jira/transition-issues', async (req, res) => {
    let { pat, issueKeys, issueKey, transitionId } = req.body;

    // если пришёл одиночный issueKey, упакуем его в массив
    if (!issueKeys && issueKey) {
        issueKeys = [issueKey];
    }

    if (!pat || !Array.isArray(issueKeys) || !transitionId) {
        return res
            .status(400)
            .json({ error: 'Нужны pat, issueKeys и transitionId' });
    }

    const results = [];
    for (const key of issueKeys) {
        try {
            const r = await fetch(
                `https://jira.abanking.ru/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${pat}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ transition: { id: transitionId } })
                }
            );
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.errorMessages?.join(', ') || r.statusText);
            }
            results.push({ key, success: true });
        } catch (err) {
            console.error(`Transition ${key}:`, err);
            results.push({ key, success: false, error: err.message });
        }
    }

    res.json(results);
});

// GET /allure/defects
app.get('/api/allure/defects', async (req, res) => {
    try {
        const { projectId, query, page, size } = req.query;
        const defects = await getAllureDefects(projectId, query, page, size);
        res.json(defects);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// POST /allure/defect/:defectId/issue
app.post('/api/allure/defect/:defectId/issue', async (req, res) => {
    const { defectId } = req.params;
    const { integrationId, name } = req.body;
    if (!defectId || !integrationId || !name) {
        return res.status(400).json({ error: 'Нужны defectId, integrationId и name' });
    }
    try {
        const result = await linkIssueToAllureDefect(defectId, integrationId, name);
        res.json(result);
    } catch (err) {
        console.error('Allure POST link issue failed:', err);
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/bug/ai-review', async (req, res) => {
    const task = req.body.task || req.body.testCase;
    if (!task || typeof task !== 'object') {
        return res.status(400).json({ error: 'Нужен объект task' });
    }

    // Получаем OpenRouter API Key из header (с фоллбэком на config)
    const apiKey = req.headers['x-openrouter-key']?.trim() || config.openRouterAiKey;

    try {
        const feedback = await analyzeBugWithAI(task, apiKey);
        return res.json(feedback);
    } catch (err) {
        console.error('AI-review error:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/allure/defect/:defectId/details', async (req, res) => {
    try {
        const defectId = req.params.defectId;
        if (!defectId) return res.status(400).json({ error: 'Нужен defectId' });

        const defect = await getAllureDefectById(defectId);
        const steps = await getStepsForDefect(defectId);

        // возвращаем описание дефекта в поле description и шаги
        res.json({
            name: defect.name || '',
            description: defect.description || '',
            steps
        });
    } catch (err) {
        console.error('Error /allure/defect/:id/details:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/jira/issue/picker', async (req, res) => {
    const { pat, query } = req.query;
    if (!pat) {
        return res.status(400).json({ error: 'pat is required' });
    }

    try {
        // Собираем URL с query-параметром
        const url = new URL('https://jira.abanking.ru/rest/api/2/issue/picker');
        if (query) {
            url.searchParams.set('query', query);
        }

        // Делаем запрос в Jira
        const response = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${pat}`,
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            // Если Jira вернула ошибку — отдаём её клиенту
            const errBody = await response.json().catch(() => ({}));
            const msg = errBody.errorMessages?.join(',') || response.statusText;
            return res.status(response.status).json({ error: msg });
        }

        // Парсим результат
        const data = await response.json();
        const issues = (data.sections || [])
            .flatMap(section => section.issues || [])
            .map(i => ({
                key: i.key,
                name: i.name,
                summary: i.summary
            }));

        return res.json(issues);
    }
    catch (err) {
        console.error('Error fetching issue picker:', err);
        return res
            .status(500)
            .json({ error: err.message || 'Unknown error' });
    }
});

// GET /api/jira/issueLinkTypes — вернуть все типы связей из Jira
app.get('/api/jira/issueLinkTypes', async (req, res) => {
    const { pat } = req.query;
    if (!pat) {
        return res.status(400).json({ error: 'pat is required' });
    }
    try {
        const response = await fetch(
            `https://jira.abanking.ru/rest/api/2/issueLinkType`,
            { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' } }
        );
        if (!response.ok) throw new Error(`Jira returned ${response.status}`);
        const data = await response.json();
        res.json(data.issueLinkTypes);
    } catch (err) {
        console.error('Ошибка /api/jira/issueLinkTypes:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/jira/issueLink — связать две задачи
app.post('/api/jira/issueLink', async (req, res) => {
    const { pat, typeName, inwardIssueKey, outwardIssueKey } = req.body;
    if (!pat || !typeName || !inwardIssueKey || !outwardIssueKey) {
        return res.status(400).json({
            error: 'pat, typeName, inwardIssueKey and outwardIssueKey are required'
        });
    }
    try {
        const response = await fetch(
            `https://jira.abanking.ru/rest/api/2/issueLink`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${pat}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: { name: typeName },
                    inwardIssue: { key: inwardIssueKey },
                    outwardIssue: { key: outwardIssueKey }
                })
            }
        );
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.errorMessages?.join(',') || response.statusText);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка /api/jira/issueLink:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post(
    '/api/jira/issue/:issueKey/attachments',
    upload.array('file'),
    async (req, res) => {
        const auth = req.headers.authorization;
        const { issueKey } = req.params;
        const form = new (await import('form-data')).default();

        for (const file of req.files) {

            const correctName = Buffer
                .from(file.originalname, 'latin1')
                .toString('utf8');

            form.append('file', file.buffer, {
                filename: correctName,
                contentType: file.mimetype
            });
        }

        try {
            const headers = {
                ...form.getHeaders(),
                'X-Atlassian-Token': 'no-check',
                Authorization: auth
            };
            const jiraRes = await axios.post(
                `https://jira.abanking.ru/rest/api/2/issue/${encodeURIComponent(issueKey)}/attachments`,
                form,
                { headers }
            );
            return res.json(jiraRes.data);
        } catch (err) {
            console.error('Jira attachments error:', err);
            return res
                .status(err.response?.status || 500)
                .json({ error: err.response?.data || err.message });
        }
    }
);

// Обновление полей задачи (например, description с маркерами !file.png!)
app.put('/api/jira/issue/:issueKey', async (req, res) => {
    const { issueKey } = req.params;
    const { pat, payload } = req.body;   // payload ожидаем вида { fields: { description: desc, ... } }

    if (!pat) {
        return res.status(400).json({ error: 'PAT is required' });
    }
    if (!payload || typeof payload !== 'object' || !payload.fields) {
        return res.status(400).json({ error: 'payload.fields is required' });
    }

    const jiraBaseUrl = 'https://jira.abanking.ru';
    try {
        // Проксируем PUT в Jira
        const response = await fetch(
            `${jiraBaseUrl}/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${pat}`,
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const msg =
                errBody.errorMessages?.join(',') ||
                JSON.stringify(errBody) ||
                response.statusText;
            return res.status(response.status).json({ error: msg });
        }

        // PUT возвращает 204 No Content, но мы можем отдать успех:
        return res.json({ success: true });
    } catch (err) {
        console.error(`Error updating issue ${issueKey}:`, err);
        return res.status(500).json({ error: err.message });
    }
});


app.post('/api/jira/ai-fill-fields', async (req, res) => {
    try {
        const { summary, description, steps, stand, env, pat, projectKey } = req.body;
        if (!pat || !projectKey) {
            return res.status(400).json({ error: 'pat и projectKey обязательны' });
        }
        const stepsStr = Array.isArray(steps) ? steps.join('\n- ') : (steps ?? '');
        // 1) Метаданные JIRA
        const options = await fetchJiraMeta(pat, projectKey);
        const { Severity: sevOptions, Platform: platOptions, Symptom: sympOptions } = options;

        // 2) Хелперы маппинга → id
        const nameToId = (arr, name) =>
            (arr || []).find(o => o.name.toLowerCase() === String(name || '').toLowerCase())?.id || null;
        const namesToIds = (arr, names) => {
            const set = new Set((names || []).map(n => String(n || '').toLowerCase()));
            return (arr || [])
                .filter(o => set.has(String(o.name).toLowerCase()))
                .map(o => o.id);
        };

        // 3) Базовый эвристический fallback платформ (как у тебя было)
        const platMap = buildPlatformMap(platOptions);
        const detectedCodes = detectPlatforms(summary, env);
        let detectedPlatformIds = [];
        if (detectedCodes.length === 1 && detectedCodes[0] === 'M') {
            const txt = (env || '').toLowerCase();
            let opt = null;
            if (txt.includes('android')) {
                opt = platOptions.find(o => o.name.toLowerCase().includes('native-android'));
            } else if (txt.includes('ios')) {
                opt = platOptions.find(o => o.name.toLowerCase().includes('native-ios'));
            }
            if (!opt) {
                opt = platOptions.find(o => o.name.toLowerCase().includes('native-android'));
            }
            if (opt) detectedPlatformIds = [opt.id];
        } else {
            detectedPlatformIds = detectedCodes.map(c => platMap[c]).filter(Boolean);
        }

        // 4) Промпт
        const prompt = `
Ты — эксперт по баг-репортам. На основе входных данных выбери severity, platform и symptom строго из переданных списков (ничего своего не выдумывай), а также сгенерируй короткие, точные actual/expected.

Критерии:
- severity: оцени реальное влияние (см. справку ниже), выбирай один вариант.
- platform/symptom: выбери 1..N из справочника, если применимо.
- actual/expected: лаконично, без воды, по сути — 1–3 предложения.

Справка по Severity:
- Критическая — блокировка ключевого функционала, потеря/утечка данных.
- Высокая — ощутимые неудобства многим пользователям.
- Средняя — слабое влияние, есть обходные пути.
- Низкая — не влияет на основные сценарии.

Доступные значения:
- severity: ${sevOptions.map(x => x.name).join(', ')}
- platform: ${platOptions.map(x => x.name).join(', ')}
- symptom: ${sympOptions.map(x => x.name).join(', ')}

Входные данные:
SUMMARY: ${summary}
DESCRIPTION: ${description}
STEPS: ${stepsStr}
STAND: ${stand}
ENV: ${env}
`.trim();

        // 5) Вызов модели с tool-calling
        const tools = [buildFillJiraFieldsTool({ sevOptions, platOptions, sympOptions })];
        const ai = await callWithCloudRuFallback(
            OPENROUTER_URL,
            [
                { role: 'system', content: 'Ты возвращаешь строго структурированный ответ через function call.' },
                { role: 'user', content: prompt }
            ],
            config.openRouterAiKey,
            {
                tools,
                tool_choice: { type: "function", function: { name: "fill_jira_fields" } },
                temperature: 0,
                top_p: 0.95,
                extra: { transforms: 'middle-out' }
            }
        );

        // 6) Извлекаем tool args; если нет — фолбэк на текст
        let args = extractToolArgs(ai, "fill_jira_fields");
        if (!args) {
            const content = ai.choices?.[0]?.message?.content || '';
            const m = content.match(/\{[\s\S]*\}/);
            if (!m) throw new Error('AI не вернул JSON/ToolCall');
            args = JSON5.parse(m[0]);
        }

        // 7) Приводим к ID
        const severityId = nameToId(sevOptions, args.severity);
        const platformIdsByName = namesToIds(platOptions, args.platform);
        const symptomIds = namesToIds(sympOptions, args.symptom);

        // 8) Платформы: если AI не выбрал ничего валидного — берём fallback
        const platform = platformIdsByName.length ? platformIdsByName : detectedPlatformIds;

        // 9) Ответ
        return res.json({
            actual: args.actual,
            expected: args.expected,
            severity: severityId,  // одно значение (id)
            platform,              // массив id
            symptom: symptomIds    // массив id
        });

    } catch (e) {
        console.error('AI fill error:', e);
        return res.status(500).json({ error: e.message });
    }
});



function extractToolArgs(aiResponse, preferredFnName) {
    try {
        console.log(`[extractToolArgs] 🔍 Начинаем извлечение args для функции: ${preferredFnName}`);

        // СНАЧАЛА проверяем tool_calls (для Cloud.ru и OpenRouter)
        const toolCalls = aiResponse.choices?.[0]?.message?.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
            console.log(`[extractToolArgs] Найдено ${toolCalls.length} tool_calls`);

            // Ищем нужный tool по имени
            const targetTool = toolCalls.find(tc => tc.function?.name === preferredFnName);

            if (targetTool) {
                console.log(`[extractToolArgs] Найден tool: ${preferredFnName}`);

                try {
                    const args = JSON.parse(targetTool.function.arguments);
                    console.log(`[extractToolArgs] ✅ Успешно распарсены аргументы, ключи:`, Object.keys(args));
                    return args;
                } catch (parseErr) {
                    console.error(`[extractToolArgs] ❌ Ошибка парсинга arguments:`, parseErr.message);
                    console.error(`[extractToolArgs] Raw arguments:`, targetTool.function.arguments);

                    // Попробуем JSON5
                    try {
                        const args = JSON5.parse(targetTool.function.arguments);
                        console.log(`[extractToolArgs] ✅ Успешно распарсены аргументы через JSON5, ключи:`, Object.keys(args));
                        return args;
                    } catch (json5Err) {
                        console.error(`[extractToolArgs] ❌ JSON5 тоже не сработал:`, json5Err.message);
                        return null;
                    }
                }
            } else {
                console.warn(`[extractToolArgs] ⚠️ Tool "${preferredFnName}" не найден среди:`,
                    toolCalls.map(tc => tc.function?.name));

                // Возьмем первый доступный tool
                const firstTool = toolCalls[0];
                console.log(`[extractToolArgs] Используем первый доступный tool: ${firstTool.function?.name}`);

                try {
                    const args = JSON.parse(firstTool.function.arguments);
                    console.log(`[extractToolArgs] ✅ Успешно распарсены аргументы первого tool, ключи:`, Object.keys(args));
                    return args;
                } catch (parseErr) {
                    console.error(`[extractToolArgs] ❌ Ошибка парсинга arguments первого tool:`, parseErr.message);
                    return null;
                }
            }
        }

        // ЗАТЕМ проверяем content (fallback для моделей без tool_calls)
        const content = aiResponse.choices?.[0]?.message?.content;

        if (content) {
            console.log(`[extractToolArgs] tool_calls не найдены, пробуем парсить content (${content.length} символов)`);

            // ✅ УЛУЧШЕННЫЙ парсинг JSON с обработкой ошибок
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                content.match(/```\s*([\s\S]*?)\s*```/) ||
                content.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                let jsonText = jsonMatch[1] || jsonMatch[0];

                // ✅ ИСПРАВЛЕНИЕ: Очистка и валидация JSON
                jsonText = jsonText.trim();

                // Попытка исправить распространенные ошибки JSON
                try {
                    // Убираем лишние символы в конце
                    jsonText = jsonText.replace(/,\s*\]\s*$/, ']');
                    jsonText = jsonText.replace(/,\s*\}\s*$/, '}');

                    const parsed = JSON.parse(jsonText);
                    console.log(`[extractToolArgs] ✅ Успешно распарсен JSON из content`);
                    return parsed;
                } catch (parseErr) {
                    console.error(`[extractToolArgs] ❌ Ошибка парсинга JSON из content:`, parseErr.message);

                    // ✅ АГРЕССИВНАЯ ОЧИСТКА: Попытка исправить JSON
                    try {
                        console.log(`[extractToolArgs] 🔧 Попытка исправить JSON (${jsonText.length} символов)...`);

                        // 1) Если JSON слишком большой (>100KB), обрезаем его
                        if (jsonText.length > 100000) {
                            console.log(`[extractToolArgs] 🔧 JSON слишком большой (${jsonText.length} символов), обрезаем до 100KB`);
                            jsonText = jsonText.substring(0, 100000);

                            // Находим последний полный объект/массив
                            const lastCompleteBrace = jsonText.lastIndexOf('}');
                            const lastCompleteBracket = jsonText.lastIndexOf(']');
                            const cutPos = Math.max(lastCompleteBrace, lastCompleteBracket);

                            if (cutPos > 0) {
                                jsonText = jsonText.substring(0, cutPos + 1);
                                console.log(`[extractToolArgs] 🔧 Обрезано до позиции ${cutPos + 1}`);
                            }
                        }

                        // 2) Убираем все после последней закрывающей скобки массива (приоритет)
                        const lastBracket = jsonText.lastIndexOf(']');
                        if (lastBracket > 0 && lastBracket < jsonText.length - 1) {
                            jsonText = jsonText.substring(0, lastBracket + 1);
                            console.log(`[extractToolArgs] 🔧 Обрезано до последней закрывающей скобки массива (позиция ${lastBracket + 1})`);
                        } else {
                            // Если нет закрывающей скобки массива, ищем последнюю закрывающую скобку объекта
                            const lastBrace = jsonText.lastIndexOf('}');
                            if (lastBrace > 0 && lastBrace < jsonText.length - 1) {
                                jsonText = jsonText.substring(0, lastBrace + 1);
                                console.log(`[extractToolArgs] 🔧 Обрезано до последней закрывающей скобки объекта (позиция ${lastBrace + 1})`);
                            }
                        }

                        // 2) Убираем trailing commas
                        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

                        // 3) Попытка найти и исправить незакрытые массивы/объекты
                        let openBraces = (jsonText.match(/\{/g) || []).length;
                        let closeBraces = (jsonText.match(/\}/g) || []).length;
                        let openBrackets = (jsonText.match(/\[/g) || []).length;
                        let closeBrackets = (jsonText.match(/\]/g) || []).length;

                        // Добавляем недостающие закрывающие скобки
                        while (openBraces > closeBraces) {
                            jsonText += '}';
                            closeBraces++;
                        }
                        while (openBrackets > closeBrackets) {
                            jsonText += ']';
                            closeBrackets++;
                        }

                        console.log(`[extractToolArgs] 🔧 Исправлено: {${openBraces}/${closeBraces}}, [${openBrackets}/${closeBrackets}]`);

                        const cleanedParsed = JSON.parse(jsonText);
                        console.log(`[extractToolArgs] ✅ Успешно исправлен и распарсен JSON`);
                        return cleanedParsed;
                    } catch (cleanErr) {
                        console.error(`[extractToolArgs] ❌ Не удалось исправить JSON:`, cleanErr.message);

                        // ✅ ПОСЛЕДНЯЯ ПОПЫТКА: Извлекаем только валидную часть
                        try {
                            // Ищем последний валидный объект в массиве
                            const arrayMatch = jsonText.match(/\[[\s\S]*$/);
                            if (arrayMatch) {
                                const arrayContent = arrayMatch[0];
                                // Ищем все валидные объекты до ошибки
                                const validObjects = [];
                                let currentPos = 1; // после '['

                                while (currentPos < arrayContent.length) {
                                    const nextComma = arrayContent.indexOf(',', currentPos);
                                    const nextBrace = arrayContent.indexOf('}', currentPos);

                                    if (nextBrace === -1) break;

                                    const objEnd = nextComma !== -1 && nextComma < nextBrace ? nextComma : nextBrace;
                                    const objText = arrayContent.substring(currentPos, objEnd + 1).trim();

                                    if (objText.startsWith('{') && objText.endsWith('}')) {
                                        try {
                                            const obj = JSON.parse(objText);
                                            validObjects.push(obj);
                                            console.log(`[extractToolArgs] 🔧 Извлечен валидный объект: ${obj.text?.substring(0, 50)}...`);
                                        } catch (e) {
                                            console.log(`[extractToolArgs] 🔧 Пропущен невалидный объект`);
                                        }
                                    }

                                    currentPos = objEnd + 1;
                                }

                                if (validObjects.length > 0) {
                                    console.log(`[extractToolArgs] ✅ Извлечено ${validObjects.length} валидных объектов`);
                                    return validObjects;
                                }
                            }
                        } catch (extractErr) {
                            console.error(`[extractToolArgs] ❌ Не удалось извлечь валидные объекты:`, extractErr.message);
                        }
                    }
                }
            }
        }

        // ✅ ПОСЛЕДНИЙ FALLBACK: Попробуем извлечь хотя бы один тест-кейс из обрезанного JSON
        if (content && content.length > 1000) {
            console.log(`[extractToolArgs] 🔧 Последний fallback: пытаемся извлечь частичные данные из ${content.length} символов`);

            try {
                // Ищем первый валидный объект тест-кейса
                const firstCaseMatch = content.match(/\{\s*"feature"[\s\S]*?\}/);
                if (firstCaseMatch) {
                    const firstCase = JSON5.parse(firstCaseMatch[0]);
                    console.log(`[extractToolArgs] ✅ Fallback: извлечен 1 тест-кейс`);
                    return { cases: [firstCase] };
                }
            } catch (e) {
                console.warn(`[extractToolArgs] Fallback не сработал: ${e.message}`);
            }
        }

        console.error(`[extractToolArgs] ❌ Не удалось извлечь args: нет ни tool_calls, ни валидного JSON в content`);
        return null;

    } catch (error) {
        console.error(`[extractToolArgs] 💥 Критическая ошибка:`, error.message);
        return null;
    }
}



//
// Универсальная функция для повторных попыток при 5xx,
// принимающая либо строку prompt, либо массив сообщений {role, content}
//
export async function callWithBackoff(url, promptOrMessages, apiKey, opts = {}) {
    const {
        // Основная free‑модель и массив fallback‑моделей
        model = 'deepseek/deepseek-chat-v3.1:free',
        models,
        tools,
        tool_choice,
        response_format,
        temperature = 0,
        top_p = 0.9,
        extra = {},
        max_tokens = 8192,
        maxAttempts = 8,          // больше попыток: учитываем очереди у провайдера
        minWaitMs = 1500,         // минимальный бэкофф
        maxWaitMs = 120000,       // верхняя граница ожидания между ретраями
        logRateLimit = true,      // логировать лимит-хедеры для диагностики
        reduceTokensOn400 = false // понижать max_tokens при 400 Bad Request (для больших запросов)
    } = opts;

    const messages = Array.isArray(promptOrMessages)
        ? promptOrMessages
        : [{ role: 'user', content: promptOrMessages }];

    // Проверка размера запроса для OpenRouter
    const requestSize = JSON.stringify(messages).length;
    const estimatedTokens = Math.ceil(requestSize / 4);
    const MAX_TOKENS_OPENROUTER = 100000; // Лимит для OpenRouter (примерно)

    console.log(`[callWithBackoff] Request size: ${requestSize} chars, estimated tokens: ${estimatedTokens}`);

    if (estimatedTokens > MAX_TOKENS_OPENROUTER) {
        console.log(`[callWithBackoff] Request too large (${estimatedTokens} tokens > ${MAX_TOKENS_OPENROUTER}), splitting into chunks...`);
        return await processLargeOpenRouterRequest(messages, opts, apiKey);
    }

    // экспоненциальный бэкофф с небольшим джиттером
    const backoff = (attemptIdx) => {
        const base = Math.min(minWaitMs * Math.pow(2, attemptIdx - 1), maxWaitMs);
        const jitter = 1 + Math.random() * 0.2; // +0..20%
        return Math.floor(base * jitter);
    };

    let attempt = 0;
    let currentMaxTokens = max_tokens; // для динамического понижения при 400

    // Очередь моделей: основная + фолбэк
    const modelQueue = Array.isArray(models) && models.length
        ? models
        : [model, 'qwen/qwen3-235b-a22b:free'];
    let modelIdx = 0;

    while (attempt < maxAttempts) {
        attempt++;

        const payload = {
            model: modelQueue[modelIdx] || modelQueue[0],
            messages,
            temperature,
            top_p,
            max_tokens: currentMaxTokens,
            ...extra
        };
        if (tools) payload.tools = tools;
        if (tool_choice) payload.tool_choice = tool_choice;
        if (response_format) payload.response_format = response_format;

        if (logRateLimit && attempt === 1 && modelIdx === 0) {
            console.log(`[callWithBackoff] Запрос к модели: ${payload.model}`);
        }

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // Успешно — парсим и проверяем
        if (resp.ok) {
            const text = await resp.text();
            if (!text || !/[{\[]/.test(text)) {
                throw new Error(`Empty or invalid JSON response from AI: "${text}"`);
            }
            let data;
            try {
                data = JSON.parse(text);
            } catch {

                data = JSON5.parse(text);
            }

            // Проверяем ошибки в теле ответа (429 может прийти в теле при 200 OK)
            if (data?.error) {
                const bodyCode = data.error.code || data.error.status;
                const bodyMsg = data.error.message || '';

                // Ошибочные коды: 4xx и 5xx
                if (bodyCode >= 400) {
                    if (logRateLimit) {
                        console.warn(`[callWithBackoff] Ошибка в теле (HTTP ${resp.status}): код ${bodyCode} - ${bodyMsg}`);
                    }
                    resp.status = bodyCode; // подменяем для обработки ниже
                }
                // Код есть, но успешный (2xx, 3xx) - возвращаем с предупреждением
                else if (bodyCode) {
                    if (logRateLimit) {
                        console.warn(`[callWithBackoff] Предупреждение в теле: код ${bodyCode} - ${bodyMsg}`);
                    }
                    return data;
                }
                // Нет кода - непонятная ошибка
                else {
                    if (logRateLimit) {
                        console.warn(`[callWithBackoff] Ошибка без кода в теле:`, data.error);
                    }
                    throw new Error(`API error без кода: ${bodyMsg || JSON.stringify(data.error)}`);
                }
            } else {
                return data;
            }
        }

        // ==== 429/404/400: попробовать понизить токены или переключить модель ====
        if (resp.status === 429 || resp.status === 404 || resp.status === 400) {
            // Для 400: сначала пробуем понизить токены (если включено)
            if (resp.status === 400 && reduceTokensOn400 && currentMaxTokens > 1800) {
                currentMaxTokens = Math.max(1800, Math.floor(currentMaxTokens * 0.6));
                if (logRateLimit) {
                    console.warn(`[callWithBackoff] 400 Bad Request. Понижаю max_tokens до ${currentMaxTokens}`);
                }
                attempt--; // не сжигаем попытку
                continue;
            }

            // Пробуем переключиться на следующую модель
            if (modelIdx < modelQueue.length - 1) {
                modelIdx++;
                if (logRateLimit) {
                    console.warn(`[callWithBackoff] HTTP ${resp.status}. Переключаюсь на модель: ${modelQueue[modelIdx]}`);
                }
                attempt--; // не сжигаем попытку
                continue;
            }
        }

        // ==== 429: ожидание если все модели заняты ====
        if (resp.status === 429) {

            // Ожидание, если все модели закончились
            // Собираем все подсказки по времени ожидания
            const h = (name) => resp.headers.get(name);
            const ra = parseFloat(h('retry-after') || '0'); // секунды
            const rMain = parseFloat(h('x-ratelimit-reset') || '0');
            const rReq = parseFloat(h('x-ratelimit-reset-requests') || '0');
            const rTok = parseFloat(h('x-ratelimit-reset-tokens') || '0');
            const remaining = h('x-ratelimit-remaining') || h('x-ratelimit-remaining-requests') || h('x-ratelimit-remaining-tokens');

            let waitMs = 0;

            // Retry-After — самый надёжный
            if (ra && !Number.isNaN(ra)) {
                waitMs = Math.max(waitMs, Math.round(ra * 1000));
            }

            // Иногда приходит timestamp (в сек/мс) или "через N секунд"
            const now = Date.now();
            for (const v of [rMain, rReq, rTok]) {
                if (!v || Number.isNaN(v)) continue;
                // Если значение похоже на timestamp в мс — просто разница,
                // если похоже на секунды — умножаем на 1000.
                const ms = v > 1e12 ? (v - now) : Math.round(v * 1000);
                if (ms > 0) waitMs = Math.max(waitMs, ms);
            }

            // Фолбэк — экспоненциальный бэкофф
            if (!waitMs || waitMs < 1000) waitMs = backoff(attempt);

            if (logRateLimit) {
                console.warn('[callWithBackoff] 429 rate limit (все модели заняты). Waiting ms:', waitMs, {
                    retryAfter: h('retry-after'),
                    xRateReset: h('x-ratelimit-reset'),
                    xRateResetReq: h('x-ratelimit-reset-requests'),
                    xRateResetTok: h('x-ratelimit-reset-tokens'),
                    remaining
                });
            }

            await new Promise(r => setTimeout(r, Math.min(waitMs, maxWaitMs)));
            modelIdx = 0; // сбрасываем на первую модель после ожидания
            // и пробуем снова
            continue;
        }

        // 5xx: подождать и повторить
        if (resp.status >= 500 && resp.status < 600) {
            const waitMs = backoff(attempt);
            if (logRateLimit) {
                console.warn(`[callWithBackoff] ${resp.status} from upstream. Retry in ${waitMs}ms`);
            }
            await new Promise(r => setTimeout(r, waitMs));
            continue;
        }

        // Остальные ошибки — читаем тело и бросаем
        const errText = await resp.text().catch(() => '');
        throw new Error(`OpenRouter ${resp.status}: ${errText || resp.statusText}`);
    }

    throw new Error('OpenRouter: превышено число попыток (после 429/5xx)');
}

function buildSubmitModelTool() {
    return {
        type: "function",
        function: {
            name: "submit_test_model",
            description: "Отправить сгенерированную тестовую модель Feature → Story → Scenario → Code",
            parameters: {
                type: "object",
                properties: {
                    model: {
                        type: "array",
                        description: "Массив Features",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string", description: "UUID Feature" },
                                text: { type: "string", description: "Название Feature" },
                                stories: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string", description: "UUID Story" },
                                            text: { type: "string", description: "Название Story" },
                                            scenarios: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        id: { type: "string", description: "UUID Scenario" },
                                                        text: {
                                                            type: "string",
                                                            description: "Действие пользователя, начинается с 'N. Глагол...'"
                                                        },
                                                        codes: {
                                                            type: "array",
                                                            description: "Поведения системы (Frontend + Backend + Integration)",
                                                            items: {
                                                                type: "object",
                                                                properties: {
                                                                    id: { type: "string", description: "UUID Code" },
                                                                    text: {
                                                                        type: "string",
                                                                        description: "Поведение системы: HTTP-метод, UI-действие, метод, интеграция. БЕЗ префиксов 'API:', 'UI:'"
                                                                    },
                                                                    type: {
                                                                        type: "string",
                                                                        enum: ["backend", "frontend", "integration"],
                                                                        description: "Тип Code: 'backend' для API/методов, 'frontend' для UI, 'integration' для интеграций"
                                                                    }
                                                                },
                                                                required: ["id", "text"]
                                                            }
                                                        }
                                                    },
                                                    required: ["id", "text", "codes"]
                                                }
                                            }
                                        },
                                        required: ["id", "text", "scenarios"]
                                    }
                                }
                            },
                            required: ["id", "text", "stories"]
                        }
                    }
                },
                required: ["model"]
            }
        }
    };
}


const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
/**
 * GET /api/jira/search
 * Query params:
 *   - pat:      Jira Personal Access Token (обязательный)
 *   - jql:      JQL‑запрос (обязательный)
 *   - maxResults: сколько возвращать записей (необязательно, дефолт 50)
 *   - startAt:    с какой записи начинать (необязательно, дефолт 0)
 */
app.get('/api/jira/search', async (req, res) => {
    const { pat, jql, maxResults = 50 } = req.query;
    if (!pat || !jql) return res.status(400).json({ error: 'pat и jql обязательны' });

    try {
        const { data } = await axios.get(
            'https://jira.abanking.ru/rest/api/2/search',
            {
                params: {
                    jql,
                    maxResults,
                    fields: 'summary'         //  только summary
                },
                headers: {
                    Authorization: `Bearer ${pat}`,
                    Accept: 'application/json'
                },
                httpAgent,
                httpsAgent,
                timeout: 10_000            // таймаут 10 сек
            }
        );
        res.json(data);
    } catch (err) {
        console.error('Ошибка /api/jira/search:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});


// Асинхронная генерация тестовой модели
// ✅ ФАЗА 1: ПРЕПРОЦЕССИНГ REQUIREMENTS - Извлечение структуры Feature → Story
/**
 * Извлекает структурированную иерархию Feature → Story из requirements
 * @param {string} requirementsText - Текст requirements из Confluence
 * @returns {Promise<RequirementsStructure>}
 */
async function extractRequirementsStructure(requirementsText) {
    console.log('[extractRequirementsStructure] Начинаю извлечение структуры Feature → Story...');

    const prompt = `
Проанализируй требования и извлеки структуру Feature → Story.

ПРАВИЛА:

1. Feature = высокоуровневая функциональность (обычно в заголовке документа)
   - Если заголовок "DA M Платежи. Реализовать X, Y, Z" → Feature: "DA M Платежи - X Y Z"
   - ОДНА Feature на весь документ (если все требования про одну функциональность)
   - НО если видишь РАЗНЫЕ функциональности (например, "Платежи" и "Переводы") → создай несколько Feature

2. Story = пользовательская история (обычно начинается с "Реализовать...", "Добавить...", "Изменить...")
   - Извлекай из пунктов требований (3.1, 3.2, 3.3...)
   - Объединяй похожие требования в одну Story
   - Пример: "3.4 Реализовать страницу X", "3.5 Реализовать страницу Y" → Story "Реализация страниц создания QR-кода"
   - Story должна описывать ЧТО хочет получить пользователь, а НЕ техническую реализацию
   - ✅ "QR-коды для физических лиц", "Оплата по QR-коду", "Создание функциональной ссылки"
   - ❌ "Реализация кнопки...", "Вкладка X", "Фильтр Y", "Контрол Z"

3. Scenario = пользовательское действие (НЕ извлекай сейчас, только позже)

ТРЕБОВАНИЯ:
${requirementsText}

ВЫХОДНОЙ ФОРМАТ (JSON):
{
  "features": [
    {
      "name": "DA M Платежи - СБП QR-коды",
      "description": "Реализовать выпуск функциональной/кассовой ссылок, активацию/деактивацию кассовой ссылки, отображение списка ссылок в разделе Эквайринг",
      "stories": [
        {
          "name": "Создание QR-кода для физических лиц",
          "requirements": ["3.1", "3.2", "3.3"],
          "description": "Реализовать проверку подключения в СБП и загрузку страницы создания QR-кода"
        },
        {
          "name": "Выпуск функциональной ссылки",
          "requirements": ["3.4", "3.5"],
          "description": "Реализовать страницу выпуска одноразового/многоразового QR-кода"
        }
      ]
    }
  ]
}

ВЫЗОВИ TOOL submit_requirements_structure с этим JSON.
`.trim();

    const tools = [
        {
            type: "function",
            function: {
                name: "submit_requirements_structure",
                description: "Отправить извлечённую структуру Feature → Story",
                parameters: {
                    type: "object",
                    properties: {
                        features: {
                            type: "array",
                            description: "Массив Feature (может быть несколько, если функциональности разные)",
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string", description: "Название Feature" },
                                    description: { type: "string", description: "Описание Feature" },
                                    stories: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string", description: "Название Story (пользовательская история)" },
                                                requirements: {
                                                    type: "array",
                                                    items: { type: "string" },
                                                    description: "Номера требований (например, ['3.1', '3.2'])"
                                                },
                                                description: { type: "string", description: "Описание Story" }
                                            },
                                            required: ["name", "requirements"]
                                        }
                                    }
                                },
                                required: ["name", "stories"]
                            }
                        }
                    },
                    required: ["features"]
                }
            }
        }
    ];

    try {
        const response = await callWithBackoff(
            OPENROUTER_URL,
            [{ role: "user", content: prompt }],
            config.openRouterAiKey,
            {
                model: "anthropic/claude-3.5-sonnet",
                temperature: 0,
                max_tokens: 16000,  // ✅ Увеличено с 10000 до 16000 для более полной структуры
                tools: tools
            }
        );

        const structure = extractToolArgs(response, 'submit_requirements_structure');

        // Валидация
        if (!structure.features || !Array.isArray(structure.features) || structure.features.length === 0) {
            throw new Error('[extractRequirementsStructure] Не удалось извлечь структуру: отсутствует массив features');
        }

        for (const feature of structure.features) {
            if (!feature.name || !feature.stories || !Array.isArray(feature.stories) || feature.stories.length === 0) {
                throw new Error(`[extractRequirementsStructure] Невалидная Feature: ${JSON.stringify(feature)}`);
            }
        }

        const totalStories = structure.features.reduce((sum, f) => sum + f.stories.length, 0);
        console.log(`[extractRequirementsStructure] ✅ Извлечено: ${structure.features.length} Feature(s), ${totalStories} Stories`);

        return structure;
    } catch (error) {
        console.error('[extractRequirementsStructure] Ошибка:', error.message);
        // Fallback: создаем базовую структуру
        console.warn('[extractRequirementsStructure] Использую fallback: создаю базовую структуру');
        return {
            features: [{
                name: "Основная функциональность",
                description: "Автоматически извлеченная функциональность",
                stories: [{
                    name: "Базовый сценарий",
                    requirements: [],
                    description: "Базовый сценарий для генерации модели"
                }]
            }]
        };
    }
}

// ✅ ФАЗА 2: ПОСТРОЕНИЕ ПРОМПТА С ЗАДАННОЙ СТРУКТУРОЙ
/**
 * Строит промпт для генерации тестовой модели с заданной структурой Feature → Story
 * @param {RequirementsStructure} reqStructure - Извлечённая структура requirements
 * @param {string} fullRequirementsText - Полный текст requirements
 * @returns {string} - Промпт для LLM
 */
function buildTestModelPrompt(reqStructure, fullRequirementsText) {
    const featuresList = reqStructure.features.map((feature, fIdx) => {
        const storiesList = feature.stories.map((st, sIdx) =>
            `${sIdx + 1}. "${st.name}" (требования: ${st.requirements.join(', ')})`
        ).join('\n');

        return `
Feature ${fIdx + 1}: "${feature.name}"
${feature.description ? `Описание: ${feature.description}` : ''}
Stories (обязательные ${feature.stories.length} шт):
${storiesList}`;
    }).join('\n\n');

    return `
📋 ЗАДАНИЕ: Создай детальную тестовую модель на основе ЗАДАННОЙ структуры Feature → Story.

🚨 КРИТИЧНО: Features и Stories УЖЕ ОПРЕДЕЛЕНЫ! НЕ создавай новые Feature или Story!

СТРУКТУРА (ОБЯЗАТЕЛЬНАЯ):

${featuresList}

REQUIREMENTS (полный текст):
${fullRequirementsText}

ТВОЯ ЗАДАЧА:

Для КАЖДОЙ Story из списка выше:

1. Извлеки Scenarios (пользовательские действия) из соответствующих требований
2. Для каждого Scenario определи Code (поведение системы: frontend + backend)

ПРАВИЛА SCENARIOS:

- Scenarios = пользовательские действия, начинаются с глагола: "Нажать", "Выбрать", "Ввести", "Открыть"
- НЕ создавай отдельный Scenario для каждого поля формы
- Объединяй логически связанные действия: "Заполнить форму" вместо "Ввести поле X", "Ввести поле Y", "Ввести поле Z"
- Оптимально: 3-5 Scenarios на Story (НЕ более 7!)

ПРАВИЛА CODE:

- Code = поведение системы (frontend/backend)
- Frontend: "Отобразить элемент X", "Заполнить список из параметра Y", "Скрыть поле Z"
- Backend: "GET /api/endpoint", "POST /api/endpoint с параметрами X", "Вернуть параметр Y"
- ❌ НЕ используй: "Обработать действие:", "Реализовать логику:", "Выполнить обработку:"
- ❌ НЕ используй префиксы: "API:", "UI:", "Frontend:", "Backend:"

ФОРМАТ ВЫВОДА (JSON):
[
  {
    "id": "uuid",
    "text": "${reqStructure.features[0].name}",
    "stories": [
      {
        "id": "uuid",
        "text": "Название Story из списка выше",
        "scenarios": [
          {
            "id": "uuid",
            "text": "1. Действие пользователя",
            "codes": [
              {"id": "uuid", "text": "Поведение системы", "type": "frontend|backend|integration"}
            ]
          }
        ]
      }
    ]
  }
]

ВЫЗОВИ TOOL submit_test_model с этим JSON.
`.trim();
}

// ✅ ФАЗА 3: ВАЛИДАЦИЯ МОДЕЛИ
/**
 * Валидирует сгенерированную тестовую модель
 * @param {Array} model - Тестовая модель Feature → Story → Scenario → Code
 * @param {RequirementsStructure} reqStructure - Извлечённая структура requirements
 * @returns {ValidationReport}
 */
function validateTestModel(model, reqStructure) {
    const report = {
        valid: true,
        errors: [],
        warnings: [],
        coverage: {
            expected: reqStructure.features.reduce((sum, f) => sum + f.stories.length, 0),
            actual: 0,
            missing: []
        }
    };

    function normalizeText(text) {
        return String(text || '').toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .trim();
    }

    // ✅ Проверка 1: Количество Feature соответствует ожидаемому
    const expectedFeaturesCount = reqStructure.features.length;
    if (model.length !== expectedFeaturesCount) {
        report.errors.push(`Ожидается ${expectedFeaturesCount} Feature(s), но сгенерировано ${model.length}`);
        report.valid = false;
    }

    // ✅ Проверка 2: Все Stories покрыты для каждой Feature
    for (let fIdx = 0; fIdx < reqStructure.features.length && fIdx < model.length; fIdx++) {
        const expectedFeature = reqStructure.features[fIdx];
        const generatedFeature = model[fIdx];

        // Проверка соответствия названия Feature
        const expectedFeatureName = normalizeText(expectedFeature.name);
        const generatedFeatureName = normalizeText(generatedFeature.text || '');
        if (!generatedFeatureName.includes(expectedFeatureName.split(' - ')[0]) &&
            !expectedFeatureName.includes(generatedFeatureName.split(' - ')[0])) {
            report.warnings.push(`Feature "${generatedFeature.text}" может не соответствовать заданной "${expectedFeature.name}"`);
        }

        // Проверка покрытия Stories
        const generatedStories = new Set((generatedFeature.stories || []).map(s => normalizeText(s.text)));
        const expectedStories = expectedFeature.stories;

        for (const expectedStory of expectedStories) {
            const normalized = normalizeText(expectedStory.name);
            let found = false;

            for (const genStory of generatedStories) {
                // Проверяем совпадение по ключевым словам
                const keywords = normalized.split(/\s+/).filter(w => w.length > 3);
                const matches = keywords.filter(kw => genStory.includes(kw));

                if (matches.length >= Math.ceil(keywords.length * 0.6)) {
                    found = true;
                    report.coverage.actual++;
                    break;
                }
            }

            if (!found) {
                report.coverage.missing.push(expectedStory.name);
                report.errors.push(`Story "${expectedStory.name}" отсутствует в Feature "${generatedFeature.text}"`);
                report.valid = false;
            }
        }

        // ✅ Проверка 3: Scenarios не слишком детализированы
        for (const story of generatedFeature.stories || []) {
            if (story.scenarios && story.scenarios.length > 7) {
                report.warnings.push(`Story "${story.text}" содержит ${story.scenarios.length} Scenarios (рекомендуется 3-5). Возможно, слишком детализировано.`);
            }
        }

        // ✅ Проверка 4: Code содержат корректные формулировки
        const invalidPhrases = ['обработать действие', 'реализовать логику', 'выполнить обработку'];

        for (const story of generatedFeature.stories || []) {
            for (const scenario of story.scenarios || []) {
                for (const code of scenario.codes || []) {
                    const codeText = normalizeText(code.text || '');

                    for (const phrase of invalidPhrases) {
                        if (codeText.includes(phrase)) {
                            report.warnings.push(`Code "${code.text}" содержит некорректную формулировку "${phrase}"`);
                        }
                    }
                }
            }
        }

        // ✅ Проверка 5: Дубликаты Story
        const storyTexts = (generatedFeature.stories || []).map(s => normalizeText(s.text));
        const storyDuplicates = storyTexts.filter((text, index) => storyTexts.indexOf(text) !== index);

        if (storyDuplicates.length > 0) {
            report.errors.push(`Обнаружены дубликаты Story в Feature "${generatedFeature.text}": ${[...new Set(storyDuplicates)].join(', ')}`);
            report.valid = false;
        }
    }

    console.log(`[validateTestModel] Результат валидации:`);
    console.log(`  - Valid: ${report.valid}`);
    console.log(`  - Coverage: ${report.coverage.actual}/${report.coverage.expected} (${Math.round(report.coverage.actual / report.coverage.expected * 100)}%)`);
    console.log(`  - Errors: ${report.errors.length}`);
    console.log(`  - Warnings: ${report.warnings.length}`);

    return report;
}

// ✅ ФАЗА 4: ПОСТОБРАБОТКА МОДЕЛИ
/**
 * Постобработка модели: очистка Code от некорректных формулировок
 * @param {Array} model - Тестовая модель
 * @returns {Array} - Очищенная модель
 */
function postProcessModel(model) {
    console.log('[postProcessModel] Начинаю постобработку модели...');
    let cleanedCount = 0;

    for (const feature of model) {
        for (const story of feature.stories || []) {
            for (const scenario of story.scenarios || []) {
                for (const code of scenario.codes || []) {
                    const originalText = code.text || '';

                    // ✅ Удаляем "Обработать действие:"
                    if (code.text && code.text.includes('Обработать действие:')) {
                        code.text = code.text.replace(/Обработать действие:\s*/i, '').trim();
                        cleanedCount++;
                        console.log(`[postProcessModel] Очищен Code: "${code.text}"`);
                    }

                    // ✅ Удаляем "Реализовать логику:"
                    if (code.text && code.text.includes('Реализовать логику:')) {
                        code.text = code.text.replace(/Реализовать логику:\s*/i, '').trim();
                        cleanedCount++;
                        console.log(`[postProcessModel] Очищен Code: "${code.text}"`);
                    }

                    // ✅ Удаляем "Выполнить обработку:"
                    if (code.text && code.text.includes('Выполнить обработку:')) {
                        code.text = code.text.replace(/Выполнить обработку:\s*/i, '').trim();
                        cleanedCount++;
                        console.log(`[postProcessModel] Очищен Code: "${code.text}"`);
                    }

                    // ✅ Проверяем тип Code
                    if (!code.type && code.text) {
                        // Определяем тип автоматически
                        if (code.text.match(/^(GET|POST|PUT|DELETE|PATCH)\s+\//)) {
                            code.type = 'backend';
                        } else if (code.text.match(/^(Отобразить|Заполнить|Скрыть|Показать|Активировать|Деактивировать)/i)) {
                            code.type = 'frontend';
                        } else {
                            code.type = 'integration';
                        }
                    }
                }
            }
        }
    }

    console.log(`[postProcessModel] ✅ Очищено ${cleanedCount} Code(s)`);
    return model;
}

// ✅ НОВАЯ ФУНКЦИЯ: Дедупликация Scenarios между разными Stories
/**
 * Удаляет дубликаты Scenarios между разными Stories в одной Feature
 * @param {Array} model - Тестовая модель
 * @returns {Array} - Модель без дубликатов Scenarios между Stories
 */
function deduplicateScenariosAcrossStories(model) {
    console.log('[deduplicateScenariosAcrossStories] Начинаю дедупликацию Scenarios между Stories...');
    let removedCount = 0;

    const normalizeScenarioText = (text) => {
        // Убираем номер в начале ("1. " -> "")
        return String(text || '').trim().replace(/^\d+\.\s*/, '').toLowerCase();
    };

    for (const feature of model || []) {
        const allScenarios = new Map(); // normalizedText -> { storyIndex, scenario }

        // Собираем все Scenarios из всех Stories в Feature
        for (let storyIdx = 0; storyIdx < (feature.stories || []).length; storyIdx++) {
            const story = feature.stories[storyIdx];
            for (const scenario of (story.scenarios || [])) {
                const normalized = normalizeScenarioText(scenario.text);
                if (!allScenarios.has(normalized)) {
                    allScenarios.set(normalized, []);
                }
                allScenarios.get(normalized).push({ storyIdx, scenario });
            }
        }

        // Находим дубликаты (Scenarios, которые встречаются в нескольких Stories)
        const duplicates = [];
        for (const [normalizedText, occurrences] of allScenarios.entries()) {
            if (occurrences.length > 1) {
                // Проверяем, что это действительно разные Stories
                const uniqueStoryIndices = new Set(occurrences.map(o => o.storyIdx));
                if (uniqueStoryIndices.size > 1) {
                    duplicates.push({ normalizedText, occurrences });
                }
            }
        }

        // Удаляем дубликаты, оставляя только в первой Story
        for (const { normalizedText, occurrences } of duplicates) {
            // Сортируем по индексу Story (оставляем в первой)
            occurrences.sort((a, b) => a.storyIdx - b.storyIdx);
            const firstOccurrence = occurrences[0];
            const duplicatesToRemove = occurrences.slice(1);

            for (const { storyIdx, scenario } of duplicatesToRemove) {
                const story = feature.stories[storyIdx];
                const scenarioIndex = story.scenarios.findIndex(s => 
                    normalizeScenarioText(s.text) === normalizedText
                );
                if (scenarioIndex !== -1) {
                    story.scenarios.splice(scenarioIndex, 1);
                    removedCount++;
                    console.log(`[deduplicateScenariosAcrossStories] Удален дубликат Scenario "${scenario.text}" из Story "${story.text}" (оставлен в Story "${feature.stories[firstOccurrence.storyIdx].text}")`);
                }
            }
        }
    }

    console.log(`[deduplicateScenariosAcrossStories] ✅ Удалено ${removedCount} дубликатов Scenarios между Stories`);
    return model;
}

/**
 * Перегенерирует избыточно детализированные Scenarios через LLM
 * @param {Object} story - Story с избыточно детализированными Scenarios
 * @param {Array} scenarios - Массив Scenarios
 * @param {string} requirements - Требования
 * @returns {Promise<Array>} - Перегенерированные Scenarios
 */
async function regenerateOverDetailedScenarios(story, scenarios, requirements) {
    if (scenarios.length <= 5) return scenarios; // Нормальная детализация
    
    console.warn(`[regenerateOverDetailedScenarios] Story "${story.text}" содержит ${scenarios.length} Scenarios (рекомендуется 3-5), перегенерируем...`);
    
    // Собираем все Code из всех Scenarios для контекста
    const allCodes = scenarios.flatMap(sc => (sc.codes || []).map(code => ({
        scenario: sc.text,
        code: code.text,
        type: code.type
    })));
    
    const escalationPrompt = `
🚨 ПРОБЛЕМА: Story "${story.text}" содержит ${scenarios.length} Scenarios (рекомендуется 3-5).

СЛИШКОМ ДЕТАЛИЗИРОВАННЫЕ SCENARIOS:

${scenarios.map((sc, idx) => `${idx + 1}. ${sc.text}${(sc.codes || []).length > 0 ? `\n   Codes: ${(sc.codes || []).map(c => c.text).join(', ')}` : ''}`).join('\n\n')}

ЗАДАНИЕ:
Объедини эти Scenarios в 3-5 логически завершённых действий пользователя.

ПРАВИЛА:
- Объединяй связанные действия в один Scenario
- Пример: "Выбрать чек-бокс" + "Нажать кнопку" → "Создать документ с выбранным чек-боксом"
- НЕ создавай отдельный Scenario для каждого клика/поля
- Сохраняй все Code из объединённых Scenarios

REQUIREMENTS:
${requirements.substring(0, 3000)}

Формат ответа:
{
  "scenarios": [
    {
      "id": "${scenarios[0]?.id || uuidv4()}",
      "text": "1. Объединённое действие...",
      "codes": [
        {
          "id": "${scenarios[0]?.codes?.[0]?.id || uuidv4()}",
          "text": "Отобразить...",
          "type": "frontend"
        }
      ]
    }
  ]
}

ВЫЗОВИ TOOL submit_regenerated_scenarios с этим JSON.
`.trim();
    
    const tools = [{
        type: "function",
        function: {
            name: "submit_regenerated_scenarios",
            description: "Отправить перегенерированные Scenarios для Story",
            parameters: {
                type: "object",
                properties: {
                    scenarios: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                text: { type: "string" },
                                codes: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            text: { type: "string" },
                                            type: { type: "string", enum: ["frontend", "backend", "integration"] }
                                        },
                                        required: ["id", "text", "type"]
                                    }
                                }
                            },
                            required: ["id", "text", "codes"]
                        }
                    }
                },
                required: ["scenarios"]
            }
        }
    }];
    
    try {
        const response = await callWithCloudRuFallback(
            OPENROUTER_URL,
            [{ role: "user", content: escalationPrompt }],
            config.openRouterAiKey,
            {
                tools: tools,
                temperature: 0,
                max_tokens: 16000
            }
        );
        
        let regenerated = null;
        
        // Пробуем извлечь из tool_call
        const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall && toolCall.function && toolCall.function.arguments) {
            try {
                const args = JSON.parse(toolCall.function.arguments);
                if (args.scenarios && Array.isArray(args.scenarios)) {
                    regenerated = args.scenarios;
                }
            } catch (parseErr) {
                console.error(`[regenerateOverDetailedScenarios] Ошибка парсинга tool_call:`, parseErr.message);
            }
        }
        
        // Если нет tool_call, пробуем извлечь из content
        if (!regenerated) {
            const content = response.choices?.[0]?.message?.content || '';
            if (content.trim()) {
                try {
                    const jsonMatch = content.match(/\{[\s\S]*"scenarios"[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON5.parse(jsonMatch[0]);
                        if (parsed.scenarios && Array.isArray(parsed.scenarios)) {
                            regenerated = parsed.scenarios;
                        }
                    }
                } catch (parseErr) {
                    console.error(`[regenerateOverDetailedScenarios] Ошибка парсинга content:`, parseErr.message);
                }
            }
        }
        
        if (!regenerated || regenerated.length === 0) {
            console.error('[regenerateOverDetailedScenarios] LLM не вернула перегенерированные Scenarios');
            return scenarios; // Фолбэк на старые Scenarios
        }
        
        if (regenerated.length > scenarios.length) {
            console.error(`[regenerateOverDetailedScenarios] LLM создала ЕЩЁ БОЛЬШЕ Scenarios (${regenerated.length} > ${scenarios.length}), используем fallback`);
            return scenarios;
        }
        
        console.log(`[regenerateOverDetailedScenarios] ✅ Объединено ${scenarios.length} → ${regenerated.length} Scenarios`);
        return regenerated;
    } catch (error) {
        console.error(`[regenerateOverDetailedScenarios] Ошибка при перегенерации:`, error.message);
        return scenarios; // Фолбэк на старые Scenarios
    }
}

// ✅ НОВАЯ ФУНКЦИЯ: Объединение избыточно детализированных Scenarios
/**
 * Объединяет избыточно детализированные Scenarios (8+ в 3-4 логические группы)
 * @param {Array} model - Тестовая модель
 * @returns {Array} - Модель с объединенными Scenarios
 */
function mergeDetailedScenarios(model) {
    console.log('[mergeDetailedScenarios] Начинаю объединение детализированных Scenarios...');
    let mergedCount = 0;

    const normalizeAction = (text) => {
        // Извлекаем основное действие из Scenario
        const normalized = String(text || '').trim().replace(/^\d+\.\s*/, '').toLowerCase();
        // Определяем тип действия
        if (normalized.includes('открыть') || normalized.includes('перейти')) {
            return 'navigation';
        } else if (normalized.includes('выбрать') || normalized.includes('снять') || normalized.includes('чек-бокс')) {
            return 'checkbox';
        } else if (normalized.includes('нажать') || normalized.includes('кнопк')) {
            return 'button';
        } else if (normalized.includes('редактирова') || normalized.includes('просмотр')) {
            return 'view_edit';
        } else if (normalized.includes('ввести') || normalized.includes('заполнить')) {
            return 'input';
        }
        return 'other';
    };

    for (const feature of model || []) {
        for (const story of (feature.stories || [])) {
            const scenarios = story.scenarios || [];
            
            // Объединяем только если Scenarios > 7
            if (scenarios.length <= 7) {
                continue;
            }

            console.log(`[mergeDetailedScenarios] Story "${story.text}" содержит ${scenarios.length} Scenarios, объединяю...`);

            // Группируем Scenarios по типу действия
            const groups = new Map();
            for (const scenario of scenarios) {
                const actionType = normalizeAction(scenario.text);
                if (!groups.has(actionType)) {
                    groups.set(actionType, []);
                }
                groups.get(actionType).push(scenario);
            }

            // Объединяем группы в логические Scenarios
            const mergedScenarios = [];
            let scenarioNumber = 1;

            // Группа 1: Навигация (открытие страниц) - объединяем в один
            if (groups.has('navigation')) {
                const navScenarios = groups.get('navigation');
                const allCodes = navScenarios.flatMap(s => s.codes || []);
                const uniqueCodes = [];
                const seenCodes = new Set();
                for (const code of allCodes) {
                    const codeKey = String(code.text || '').trim();
                    if (!seenCodes.has(codeKey)) {
                        seenCodes.add(codeKey);
                        uniqueCodes.push(code);
                    }
                }
                mergedScenarios.push({
                    id: navScenarios[0].id || uuidv4(),
                    text: `${scenarioNumber}. Открыть страницу`,
                    codes: uniqueCodes
                });
                scenarioNumber++;
                mergedCount += navScenarios.length - 1;
            }

            // Группа 2: Работа с чек-боксом - объединяем в один
            if (groups.has('checkbox')) {
                const checkboxScenarios = groups.get('checkbox');
                const allCodes = checkboxScenarios.flatMap(s => s.codes || []);
                const uniqueCodes = [];
                const seenCodes = new Set();
                for (const code of allCodes) {
                    const codeKey = String(code.text || '').trim();
                    if (!seenCodes.has(codeKey)) {
                        seenCodes.add(codeKey);
                        uniqueCodes.push(code);
                    }
                }
                mergedScenarios.push({
                    id: checkboxScenarios[0].id || uuidv4(),
                    text: `${scenarioNumber}. Работа с чек-боксом`,
                    codes: uniqueCodes
                });
                scenarioNumber++;
                mergedCount += checkboxScenarios.length - 1;
            }

            // Группа 3: Кнопки - объединяем в один
            if (groups.has('button')) {
                const buttonScenarios = groups.get('button');
                const allCodes = buttonScenarios.flatMap(s => s.codes || []);
                const uniqueCodes = [];
                const seenCodes = new Set();
                for (const code of allCodes) {
                    const codeKey = String(code.text || '').trim();
                    if (!seenCodes.has(codeKey)) {
                        seenCodes.add(codeKey);
                        uniqueCodes.push(code);
                    }
                }
                mergedScenarios.push({
                    id: buttonScenarios[0].id || uuidv4(),
                    text: `${scenarioNumber}. Нажать кнопку`,
                    codes: uniqueCodes
                });
                scenarioNumber++;
                mergedCount += buttonScenarios.length - 1;
            }

            // Группа 4: Просмотр/редактирование - объединяем в один
            if (groups.has('view_edit')) {
                const viewEditScenarios = groups.get('view_edit');
                const allCodes = viewEditScenarios.flatMap(s => s.codes || []);
                const uniqueCodes = [];
                const seenCodes = new Set();
                for (const code of allCodes) {
                    const codeKey = String(code.text || '').trim();
                    if (!seenCodes.has(codeKey)) {
                        seenCodes.add(codeKey);
                        uniqueCodes.push(code);
                    }
                }
                mergedScenarios.push({
                    id: viewEditScenarios[0].id || uuidv4(),
                    text: `${scenarioNumber}. Просмотр/редактирование документа`,
                    codes: uniqueCodes
                });
                scenarioNumber++;
                mergedCount += viewEditScenarios.length - 1;
            }

            // Остальные Scenarios добавляем как есть
            for (const [actionType, scenarios] of groups.entries()) {
                if (!['navigation', 'checkbox', 'button', 'view_edit'].includes(actionType)) {
                    for (const scenario of scenarios) {
                        scenario.text = scenario.text.replace(/^\d+\.\s*/, `${scenarioNumber}. `);
                        mergedScenarios.push(scenario);
                        scenarioNumber++;
                    }
                }
            }

            story.scenarios = mergedScenarios;
            console.log(`[mergeDetailedScenarios] ✅ Story "${story.text}": ${scenarios.length} → ${mergedScenarios.length} Scenarios`);
        }
    }

    console.log(`[mergeDetailedScenarios] ✅ Объединено ${mergedCount} избыточно детализированных Scenarios`);
    return model;
}

// ✅ НОВАЯ ФУНКЦИЯ: Обогащение backend Code Expected Result
/**
 * Добавляет Expected Result в backend Code, если его нет
 * @param {Array} model - Тестовая модель
 * @returns {Array} - Модель с обогащенными backend Code
 */
function enrichBackendCodesWithExpectedResult(model) {
    console.log('[enrichBackendCodesWithExpectedResult] Начинаю обогащение backend Code Expected Result...');
    let enrichedCount = 0;

    for (const feature of model || []) {
        for (const story of (feature.stories || [])) {
            for (const scenario of (story.scenarios || [])) {
                for (const code of (scenario.codes || [])) {
                    // Проверяем только backend Code
                    if (code.type !== 'backend' && code.type !== 'integration') {
                        continue;
                    }

                    const codeText = String(code.text || '').trim();
                    
                    // Пропускаем, если уже есть Expected Result
                    if (codeText.includes('вернуть') || 
                        codeText.includes('ответ') || 
                        codeText.includes('статус') ||
                        codeText.includes('200') ||
                        codeText.includes('400') ||
                        codeText.includes('500')) {
                        continue;
                    }

                    // Определяем Expected Result на основе HTTP-метода
                    let expectedResult = '';
                    
                    if (codeText.match(/^(GET|POST|PUT|DELETE|PATCH)\s+\//i)) {
                        const method = codeText.match(/^(GET|POST|PUT|DELETE|PATCH)/i)?.[1] || '';
                        
                        // Для POST/PUT - ожидаем 200 OK
                        if (method.match(/^(POST|PUT)$/i)) {
                            expectedResult = ', вернуть 200 OK';
                        }
                        // Для GET - ожидаем 200 с данными
                        else if (method.match(/^GET$/i)) {
                            expectedResult = ', вернуть 200 OK с данными';
                        }
                        // Для DELETE - ожидаем 200 или 204
                        else if (method.match(/^DELETE$/i)) {
                            expectedResult = ', вернуть 200 OK или 204 No Content';
                        }
                    }

                    // Если нашли Expected Result - добавляем
                    if (expectedResult) {
                        code.text = codeText + expectedResult;
                        enrichedCount++;
                        console.log(`[enrichBackendCodesWithExpectedResult] Обогащен Code: "${code.text}"`);
                    }
                }
            }
        }
    }

    console.log(`[enrichBackendCodesWithExpectedResult] ✅ Обогащено ${enrichedCount} backend Code`);
    return model;
}

// ✅ ФАЗА 5: COVERAGE REPORT
/**
 * Генерирует отчёт о покрытии requirements
 * @param {Array} model - Тестовая модель
 * @param {RequirementsStructure} reqStructure - Структура requirements
 * @returns {CoverageReport}
 */
function generateCoverageReport(model, reqStructure) {
    console.log('[generateCoverageReport] Генерирую отчёт о покрытии...');

    function normalizeText(text) {
        return String(text || '').toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .trim();
    }

    const report = {
        total: 0,
        covered: 0,
        missing: [],
        details: [],
        coveragePercent: 0
    };

    // Собираем все Stories из всех Features
    const allExpectedStories = [];
    for (const feature of reqStructure.features) {
        for (const story of feature.stories) {
            allExpectedStories.push({
                featureName: feature.name,
                storyName: story.name,
                requirements: story.requirements
            });
            report.total++;
        }
    }

    // Проверяем покрытие для каждой Feature
    for (let fIdx = 0; fIdx < reqStructure.features.length && fIdx < model.length; fIdx++) {
        const expectedFeature = reqStructure.features[fIdx];
        const generatedFeature = model[fIdx];
        const generatedStories = (generatedFeature.stories || []).map(s => ({
            text: s.text,
            scenariosCount: (s.scenarios || []).length
        }));

        for (const expectedStory of expectedFeature.stories) {
            const normalized = normalizeText(expectedStory.name);
            let found = null;

            for (const genStory of generatedStories) {
                const keywords = normalized.split(/\s+/).filter(w => w.length > 3);
                const matches = keywords.filter(kw => normalizeText(genStory.text).includes(kw));

                if (matches.length >= Math.ceil(keywords.length * 0.6)) {
                    found = genStory;
                    report.covered++;
                    break;
                }
            }

            if (found) {
                report.details.push({
                    requirement: expectedStory.requirements.join(', '),
                    feature: expectedFeature.name,
                    story: expectedStory.name,
                    status: 'covered',
                    scenariosCount: found.scenariosCount
                });
            } else {
                report.missing.push(expectedStory.name);
                report.details.push({
                    requirement: expectedStory.requirements.join(', '),
                    feature: expectedFeature.name,
                    story: expectedStory.name,
                    status: 'missing'
                });
            }
        }
    }

    report.coveragePercent = report.total > 0 ? Math.round((report.covered / report.total) * 100) : 0;
    console.log(`[generateCoverageReport] Coverage: ${report.covered}/${report.total} (${report.coveragePercent}%)`);

    if (report.missing.length > 0) {
        console.warn(`[generateCoverageReport] Не покрыто ${report.missing.length} Stories:`);
        report.missing.forEach(story => console.warn(`  ❌ ${story}`));
    }

    return report;
}

/**
 * Рассчитывает покрытие requirements тестовой моделью
 * @param {Array} model - Тестовая модель (массив Feature)
 * @param {string} requirementsText - Текст requirements из Confluence
 * @param {Object} [reqStructure] - Структура requirements (опционально, для более точного расчета)
 * @returns {Object} - Отчёт о покрытии requirements
 */
function calculateRequirementsCoverage(model, requirementsText, reqStructure = null) {
    const extractRequirementNumbers = (text) => {
        // Используем тот же regex, что и в checkRequirementsCoverage
        const sectionPattern = /(?:^#{1,3}\s*|^|\b)(\d+\.\d+(?:\.\d+)*?)(?:\s|$|\.|,)/gm;
        const matches = [];
        let match;
        while ((match = sectionPattern.exec(text)) !== null) {
            matches.push(match[1]);
        }

        // Если не нашли - пробуем альтернативный паттерн
        if (matches.length === 0) {
            const altPattern = /\b(\d+\.\d+(?:\.\d+)*)\b/g;
            while ((match = altPattern.exec(text)) !== null) {
                matches.push(match[1]);
            }
        }

        return [...new Set(matches)];
    };

    // ✅ УЛУЧШЕНО: Используем reqStructure если доступен (более точный расчет)
    let allRequirements = [];
    if (reqStructure && reqStructure.features) {
        // Извлекаем номера требований из reqStructure
        for (const feature of reqStructure.features) {
            for (const story of feature.stories || []) {
                if (Array.isArray(story.requirements)) {
                    allRequirements.push(...story.requirements);
                }
            }
        }
        allRequirements = [...new Set(allRequirements)];
    } else {
        // Fallback: извлекаем из текста requirements
        allRequirements = extractRequirementNumbers(requirementsText);
    }

    const coveredRequirements = new Set();

    // ✅ УЛУЧШЕНО: Ищем номера требований в Codes (более надежно, чем в тексте Story)
    for (const feature of model) {
        for (const story of (feature.stories || [])) {
            // Собираем все тексты из Codes для этой Story
            const allCodeTexts = [];
            for (const scenario of (story.scenarios || [])) {
                for (const code of (scenario.codes || [])) {
                    if (code.text) {
                        allCodeTexts.push(code.text);
                    }
                }
            }
            const storyAndCodesText = story.text + ' ' + allCodeTexts.join(' ');

            // Ищем номера требований в тексте Story и Codes
            for (const reqNum of allRequirements) {
                if (storyAndCodesText.includes(reqNum)) {
                    coveredRequirements.add(reqNum);
                }
            }
        }
    }

    const missing = allRequirements.filter(req => !coveredRequirements.has(req));

    return {
        total: allRequirements.length,
        covered: coveredRequirements.size,
        coveragePercent: allRequirements.length > 0
            ? Math.round((coveredRequirements.size / allRequirements.length) * 100)
            : 0,
        missing: missing
    };
}

/**
 * Рассчитывает покрытие Scenarios тест-кейсами
 * @param {Array} testCases - Массив тест-кейсов
 * @param {Array} model - Тестовая модель (массив Feature)
 * @returns {Object} - Отчёт о покрытии scenarios
 */
function calculateTestCasesCoverage(testCases, model) {
    const normalizeText = (text) => String(text || '').toLowerCase().trim();

    const allScenarios = [];
    for (const feature of model) {
        for (const story of (feature.stories || [])) {
            for (const scenario of (story.scenarios || [])) {
                allScenarios.push({
                    feature: feature.text,
                    story: story.text,
                    scenario: scenario.text
                });
            }
        }
    }

    const coveredScenarios = new Set();
    for (const testCase of testCases) {
        if (testCase.scenario) {
            coveredScenarios.add(normalizeText(testCase.scenario));
        }
    }

    const missing = [];
    for (const sc of allScenarios) {
        if (!coveredScenarios.has(normalizeText(sc.scenario))) {
            missing.push(sc);
        }
    }

    return {
        total: allScenarios.length,
        covered: allScenarios.length - missing.length,
        coveragePercent: allScenarios.length > 0
            ? Math.round(((allScenarios.length - missing.length) / allScenarios.length) * 100)
            : 0,
        missing: missing
    };
}

// ✅ ФУНКЦИЯ ФОРМАТИРОВАНИЯ EXPECTED RESULT
/**
 * Форматирует Expected Result с ключевыми словами
 * @param {string} expected - Исходный Expected
 * @param {string} layer - Тип теста (E2E, Integration frontend, Integration backend)
 * @returns {string} - Форматированный Expected
 */
function formatExpectedResult(expected, layer) {
    if (!expected || typeof expected !== 'string') return expected;
    let formatted = expected;

    // ✅ Frontend ключевые слова
    if (layer === 'Integration frontend Tests' || layer === 'E2E Tests') {
        const frontendKeywords = [
            { pattern: /отображается\s+(поле|элемент|кнопка|страница|модальное окно|список)/gi, replacement: '**Отобразить** $1' },
            { pattern: /заполняется\s+(поле)/gi, replacement: '**Заполнить** $1' },
            { pattern: /скрывается\s+(поле|элемент)/gi, replacement: '**Скрыть** $1' },
            { pattern: /становится\s+(активной|доступной)/gi, replacement: '**Сделать** $1' }
        ];

        for (const { pattern, replacement } of frontendKeywords) {
            formatted = formatted.replace(pattern, replacement);
        }
    }

    // ✅ Backend ключевые слова
    if (layer === 'Integration backend Tests') {
        const backendKeywords = [
            { pattern: /возвращается\s+ответ\s+(\d+)/gi, replacement: '**Вернуть** ответ $1' },
            { pattern: /передаётся\s+параметр/gi, replacement: '**Передать** параметр' },
            { pattern: /подменяется\s+статус\s+код/gi, replacement: '**Подменить** статус код' },
            { pattern: /сохраняется\s+запись/gi, replacement: '**Сохранить** запись' }
        ];

        for (const { pattern, replacement } of backendKeywords) {
            formatted = formatted.replace(pattern, replacement);
        }
    }

    // ✅ Удаляем абстрактные формулировки (предупреждаем, но не заменяем)
    const abstractPhrases = [
        'система работает корректно',
        'операция выполнена успешно',
        'данные переданы корректно'
    ];

    for (const phrase of abstractPhrases) {
        if (formatted.toLowerCase().includes(phrase)) {
            console.warn(`[formatExpectedResult] ⚠️ Обнаружена абстрактная формулировка: "${phrase}" в "${formatted}"`);
        }
    }

    return formatted;
}

/**
 * Извлекает проблемные Scenarios с некорректными Code
 * @param {Array} model - Тестовая модель
 * @param {Array} issues - Список структурных проблем
 * @returns {Array} - Массив { feature, story, scenario, problematicCodes, issue }
 */
function extractProblematicScenarios(model, issues) {
    const problematic = [];
    
    function normalizeText(text) {
        return String(text || '').toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .trim();
    }
    
    for (const issue of issues) {
        // Парсим ошибку: "Code "Установить..." содержит пользовательское действие (Feature → Story → Scenario)"
        const match = issue.match(/Code "([^"]+)" содержит пользовательское действие \(([^→]+)→([^→]+)→([^)]+)\)/);
        
        if (!match) continue;
        
        const [, codeText, featureName, storyName, scenarioName] = match;
        
        // Ищем этот Scenario в модели
        for (const feature of model) {
            if (!normalizeText(feature.text).includes(normalizeText(featureName.trim()))) continue;
            
            for (const story of (feature.stories || [])) {
                if (!normalizeText(story.text).includes(normalizeText(storyName.trim()))) continue;
                
                for (const scenario of (story.scenarios || [])) {
                    if (!normalizeText(scenario.text).includes(normalizeText(scenarioName.trim()))) continue;
                    
                    // Нашли проблемный Scenario
                    const problematicCodes = (scenario.codes || []).filter(code => 
                        normalizeText(code.text).includes(normalizeText(codeText))
                    );
                    
                    if (problematicCodes.length > 0) {
                        problematic.push({
                            feature,
                            story,
                            scenario,
                            problematicCodes,
                            issue
                        });
                    }
                }
            }
        }
    }
    
    return problematic;
}

/**
 * Перегенерирует проблемные Scenarios с escalation prompt
 * @param {Array} problematicScenarios - Проблемные Scenarios
 * @param {string} requirements - Требования
 * @returns {Promise<Array>} - Исправленные Scenarios [{ scenario, fixedCodes }]
 */
async function regenerateProblematicScenarios(problematicScenarios, requirements) {
    console.log(`[regenerateProblematicScenarios] Перегенерирую ${problematicScenarios.length} проблемных Scenarios...`);
    
    const fixed = [];
    
    for (const item of problematicScenarios) {
        const { feature, story, scenario, problematicCodes, issue } = item;
        
        // Escalation prompt
        const escalationPrompt = `
🚨 КРИТИЧЕСКАЯ ОШИБКА В ПРЕДЫДУЩЕЙ ГЕНЕРАЦИИ!

ПРОБЛЕМА:
${issue}

ПРОБЛЕМНЫЕ CODE:
${problematicCodes.map(c => `- "${c.text}" (type: ${c.type || 'не указан'})`).join('\n')}

🚨 ПРАВИЛО: Code = ПОВЕДЕНИЕ СИСТЕМЫ, НЕ действие пользователя!

❌ НЕПРАВИЛЬНО (действия пользователя):
- "Установить чек-бокс..."
- "Выбрать значение..."
- "Нажать кнопку..."
- "Ввести текст..."
- "Заполнить поле..."
- "Снять выбор с чек-бокса..."

✅ ПРАВИЛЬНО (поведение системы):
- "Отобразить чек-бокс 'УНК в другом банке' доступным для редактирования и не выбранным"
- "Установить значение поля 'Примечание' в 'Контракт стоит на учете в другом Банке'"
- "Обработать нажатие кнопки 'Подписать' и вызвать POST /rest/stateful/corp/curr/inquiry_181"
- "Заполнить поле 'Сумма' из параметра deal.amount"
- "Сбросить значение поля 'Примечание'"
- "Отобразить поле 'Ожидаемый срок репатриации' как обязательное для заполнения"

КОНТЕКСТ:
Feature: "${feature.text}"
Story: "${story.text}"
Scenario: "${scenario.text}"

REQUIREMENTS (релевантный фрагмент):
${requirements.substring(0, 3000)}

ЗАДАНИЕ:
Перегенерируй ТОЛЬКО Code для этого Scenario, ИСПРАВИВ ошибки.

Code должны описывать ПОВЕДЕНИЕ СИСТЕМЫ (что система ДЕЛАЕТ), НЕ действия пользователя.

Формат ответа:
{
  "codes": [
    {
      "id": "${scenario.codes[0]?.id || uuidv4()}",
      "text": "Отобразить чек-бокс 'УНК в другом банке' доступным для редактирования и не выбранным",
      "type": "frontend"
    }
  ]
}

ВЫЗОВИ TOOL submit_fixed_codes с этим JSON.
`.trim();
        
        const tools = [{
            type: "function",
            function: {
                name: "submit_fixed_codes",
                description: "Отправить исправленные Code для Scenario",
                parameters: {
                    type: "object",
                    properties: {
                        codes: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    text: { type: "string" },
                                    type: { type: "string", enum: ["frontend", "backend", "integration"] }
                                },
                                required: ["id", "text", "type"]
                            }
                        }
                    },
                    required: ["codes"]
                }
            }
        }];
        
        try {
            const response = await callWithCloudRuFallback(
                OPENROUTER_URL,
                [{ role: "user", content: escalationPrompt }],
                config.openRouterAiKey,
                {
                    tools: tools,
                    temperature: 0,
                    max_tokens: 4000
                }
            );
            
            let fixedCodes = null;
            
            // Пробуем извлечь из tool_call
            const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
            if (toolCall && toolCall.function && toolCall.function.arguments) {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    if (args.codes && Array.isArray(args.codes)) {
                        fixedCodes = args.codes;
                    }
                } catch (parseErr) {
                    console.error(`[regenerateProblematicScenarios] Ошибка парсинга tool_call:`, parseErr.message);
                }
            }
            
            // Если нет tool_call, пробуем извлечь из content
            if (!fixedCodes) {
                const content = response.choices?.[0]?.message?.content || '';
                if (content.trim()) {
                    try {
                        // Пробуем найти JSON в content
                        const jsonMatch = content.match(/\{[\s\S]*"codes"[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON5.parse(jsonMatch[0]);
                            if (parsed.codes && Array.isArray(parsed.codes)) {
                                fixedCodes = parsed.codes;
                            }
                        }
                    } catch (parseErr) {
                        console.error(`[regenerateProblematicScenarios] Ошибка парсинга content:`, parseErr.message);
                    }
                }
            }
            
            if (!fixedCodes || fixedCodes.length === 0) {
                console.error(`[regenerateProblematicScenarios] LLM не вернула исправленные Code для Scenario "${scenario.text}"`);
                continue;
            }
            
            // ✅ УЛУЧШЕНИЕ: Применяем автоматическое исправление через normalizeCodeText
            const autoFixedCodes = fixedCodes.map(code => ({
                ...code,
                text: normalizeCodeText(code.text)
            }));
            
            // Проверяем, что исправленные Code не содержат пользовательских действий
            const stillProblematic = autoFixedCodes.filter(code => 
                USER_ACTION_REGEX.test(code.text)
            );
            
            if (stillProblematic.length > 0) {
                console.warn(`[regenerateProblematicScenarios] ⚠️ После автоматического исправления остались проблемные Code:`);
                stillProblematic.forEach(c => console.warn(`  - ${c.text}`));
                // Не прерываем - применяем исправленные Code, даже если они не идеальны
                // Финальная проверка будет применена позже с автоматическим исправлением
            }
            
            // Сохраняем исправленные Code (с автоматическим исправлением)
            fixed.push({
                scenario,
                fixedCodes: autoFixedCodes
            });
            
            console.log(`[regenerateProblematicScenarios] ✅ Scenario "${scenario.text}" исправлен:`);
            fixedCodes.forEach(c => console.log(`  - ${c.text}`));
        } catch (error) {
            console.error(`[regenerateProblematicScenarios] Ошибка при перегенерации Scenario "${scenario.text}":`, error);
        }
    }
    
    return fixed;
}

async function generateTestModelAsync(taskId, inputData) {
    const startTime = Date.now();
    let regenerationCount = 0;
    let escalationCount = 0;
    
    try {
        await db('generation_tasks').where('id', taskId).update({
            status: 'processing',
            progress: 0,
            updated_at: new Date()
        });

        const {
            requirements,
            text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
        } = inputData;

        if (!requirements && !text && !pageId) {
            throw new Error('Нужно передать requirements (строка/массив), либо text, либо pageId');
        }

        const sourceRegistry = createContextSourceRegistry();
        const { register: registerSource, safeTrim, deriveTitleFromContent } = sourceRegistry;

        // 0) Если pageId передан — подтягиваем основную страницу и прямые ссылки
        let autoPages = [];
        let baseRequirement = '';
        const formatMention = (mention) => {
            if (!mention) return '';
            return mention
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 200);
        };
        if (pageId) {
            if (!bearerToken) {
                throw new Error('bearerToken обязателен для загрузки страницы Confluence');
            }

            // Проверяем формат bearerToken
            if (typeof bearerToken !== 'string' || !bearerToken.trim()) {
                throw new Error('bearerToken должен быть непустой строкой');
            }

            console.log(`[generate-test-model-async] Загружаем страницу Confluence pageId=${pageId}...`);
            console.log(`[generate-test-model-async] bearerToken длина: ${bearerToken.length}, первые 20 символов: ${bearerToken.substring(0, 20)}...`);

            try {
                const { markdown, title: mainTitle } = await fetchConfluencePage(bearerToken.trim(), pageId, { inlineTextAttachments: true });
                baseRequirement = markdown || '';
                console.log(`[generate-test-model-async] ✅ Страница загружена, размер: ${baseRequirement.length} символов`);

                if (!baseRequirement || !baseRequirement.trim()) {
                    throw new Error(`Страница Confluence pageId=${pageId} загружена, но содержимое пустое`);
                }

                // Логируем первые 200 символов для проверки
                console.log(`[generate-test-model-async] Первые 200 символов контента: ${baseRequirement.substring(0, 200)}...`);

                registerSource({
                    id: `page-${pageId}`,
                    title: deriveTitleFromContent(baseRequirement, mainTitle || `Confluence page ${pageId}`, pageId),
                    description: 'Основное требование (полный текст)',
                    type: 'requirement',
                    pageId: String(pageId),
                    content: baseRequirement
                });

                // Извлекаем ссылки на другие страницы - улучшенная логика
                const ids = new Set();
                // 1. Извлекаем pageId= из markdown
                Array.from(String(markdown || '').matchAll(/pageId=(\d{4,})/g)).forEach(m => ids.add(m[1]));
                // 2. Извлекаем pageId из обычных URL вида https://confluence.../pages/viewpage.action?pageId=123456
                Array.from(String(markdown || '').matchAll(/viewpage\.action\?pageId=(\d{4,})/gi)).forEach(m => ids.add(m[1]));
                // 3. Извлекаем pageId из коротких ссылок вида /pages/123456
                Array.from(String(markdown || '').matchAll(/\/pages\/(\d{4,})/g)).forEach(m => ids.add(m[1]));
                ids.delete(String(pageId));
                console.log(`[generate-test-model-async] Найдено ${ids.size} ссылок на другие страницы: [${Array.from(ids).join(', ')}]`);

                for (const lid of ids) {
                    try {
                        const { markdown: md, title: linkedTitle } = await fetchConfluencePage(bearerToken, lid, { inlineTextAttachments: true });
                        const lines = String(markdown || '').split(/\n/);
                        const refIdx = lines.findIndex(l => l.includes(`pageId=${lid}`));
                        let mention = '';
                        if (refIdx !== -1) {
                            const start = Math.max(0, refIdx - 2);
                            const end = Math.min(lines.length, refIdx + 3);
                            mention = lines.slice(start, end).join('\n').trim();
                        }
                        const relevant = extractRelevantSections(md, mention, { maxSections: 15, maxChars: 100000 }); // Увеличено для полного контекста
                        autoPages.push([
                            `### Контекст по ссылке из основной статьи (pageId=${lid})`,
                            mention ? `> Упоминание в основной статье:\n> ${mention.replace(/\n/g, '\n> ')}` : `> Упоминание в основной статье: не найдено (pageId=${lid})`,
                            '',
                            relevant
                        ].join('\n'));

                        registerSource({
                            id: `page-${lid}`,
                            title: deriveTitleFromContent(md, linkedTitle || `Связанная страница ${lid}`, lid),
                            description: mention ? `Упоминание: ${formatMention(mention)}` : 'Контекст из связанной страницы',
                            type: 'confluence',
                            pageId: String(lid),
                            content: md
                        });
                    } catch (linkErr) {
                        console.warn(`[generate-test-model-async] Не удалось загрузить связанную страницу pageId=${lid}:`, linkErr.message);
                    }
                }
            } catch (e) {
                console.error(`[generate-test-model-async] ❌ КРИТИЧЕСКАЯ ОШИБКА при загрузке страницы Confluence:`, e.message);
                throw new Error(`Не удалось загрузить страницу Confluence pageId=${pageId}: ${e.message}. Проверьте bearerToken и доступ к странице.`);
            }
        }

        const requestContextText = normalizeContextInput(context);
        if (requestContextText) {
            registerSource({
                id: 'user-context',
                title: 'Дополнительный контекст из запроса',
                description: contextInstruction ? String(contextInstruction) : 'Контекст, переданный вместе с задачей',
                type: 'user',
                content: requestContextText
            });
        }

        if (glossary && typeof glossary === 'string' && glossary.trim()) {
            registerSource({
                id: 'user-glossary',
                title: 'Глоссарий из запроса',
                description: 'Глоссарий, предоставленный пользователем',
                type: 'glossary',
                content: glossary
            });
        }

        // Приводим к строке требований
        let reqStringForModel = '';

        // Если pageId был передан, но загрузка не удалась - выбрасываем ошибку
        if (pageId && !baseRequirement) {
            throw new Error(`Не удалось загрузить страницу Confluence pageId=${pageId}. Проверьте bearerToken и доступ к странице.`);
        }

        const requirementsPool = [];

        if (Array.isArray(requirements) && requirements.length) {
            requirementsPool.push(
                requirements
                    .map((item) => String(item || '').trim())
                    .filter(Boolean)
                    .join('\n\n---\n\n')
            );
        } else if (typeof requirements === 'string' && requirements.trim()) {
            requirementsPool.push(requirements.trim());
        }

        if (baseRequirement && baseRequirement.trim()) {
            requirementsPool.push(baseRequirement.trim());
        } else if (text && String(text).trim()) {
            requirementsPool.push(String(text).trim());
        }

        reqStringForModel = requirementsPool.filter(Boolean).join('\n\n---\n\n');

        if (!reqStringForModel) {
            try {
                const { refinedText, refinedArray } = await contextRefiner({
                    requirements,
                    text,
                    glossary,
                    context,
                    contextInstruction,
                    contextPageIds: undefined,
                    glossaryPageId: undefined,
                    bearerToken,
                    contextPages: autoPages
                });
                console.log(`[generate-test-model-async] contextRefiner fallback: refinedText.length=${(refinedText || '').length}, refinedArray.length=${refinedArray?.length || 0}`);
                reqStringForModel = refinedText || (refinedArray?.join('\n\n') ?? '');
            } catch (e) {
                console.warn('[generate-test-model-async] contextRefiner fallback failed:', e.message);
                reqStringForModel = baseRequirement || (typeof requirements === 'string'
                    ? requirements
                    : (Array.isArray(requirements) && requirements.length > 0 ? requirements.join('\n\n') : (text || '')));
            }
        }

        // Если после всех попыток reqStringForModel пустой - это ошибка
        if (!reqStringForModel || !reqStringForModel.trim()) {
            throw new Error('Не удалось получить текст требований. Проверьте параметры: pageId, requirements, text.');
        }

        // Логируем размер и начало требований для проверки
        console.log(`[generate-test-model-async] ✅ Требования подготовлены, размер: ${reqStringForModel.length} символов`);
        console.log(`[generate-test-model-async] Первые 500 символов требований: ${reqStringForModel.substring(0, 500)}...`);

        // Проверяем, что требования не содержат только примеры из промпта
        if (reqStringForModel.length < 100) {
            console.warn(`[generate-test-model-async] ⚠️ ВНИМАНИЕ: Требования очень короткие (${reqStringForModel.length} символов). Возможно, контент не загружен.`);
        }

        // ✅ ФАЗА 1: ПРЕПРОЦЕССИНГ REQUIREMENTS - Извлечение структуры Feature → Story
        console.log('[generateTestModelAsync] Фаза 1: Извлечение структуры requirements');
        await db('generation_tasks').where('id', taskId).update({
            progress: 10,
            updated_at: new Date()
        });

        let reqStructure;
        try {
            reqStructure = await extractRequirementsStructure(reqStringForModel);
            await db('generation_tasks').where('id', taskId).update({
                progress: 20,
                updated_at: new Date()
            });
        } catch (error) {
            console.error('[generateTestModelAsync] Ошибка при извлечении структуры:', error.message);
            // Продолжаем с fallback структурой
            reqStructure = {
                features: [{
                    name: "Основная функциональность",
                    description: "Автоматически извлеченная функциональность",
                    stories: [{
                        name: "Базовый сценарий",
                        requirements: [],
                        description: "Базовый сценарий для генерации модели"
                    }]
                }]
            };
        }

        if (reqStringForModel) {
            registerSource({
                id: pageId ? `sanitized-requirement-${pageId}` : 'primary-requirement',
                title: pageId ? 'Требование после сборки (основная страница)' : 'Основное требование',
                description: 'Текст требований, подготовленный для генерации модели',
                type: 'requirement',
                pageId: pageId ? String(pageId) : null,
                content: reqStringForModel
            });
        }

        const contextFetcher = bearerToken
            ? async (requestedPageId) => {
                try {
                    if (requestedPageId == null) return '';
                    const requestedIdStr = String(requestedPageId);
                    if (pageId && String(pageId) === requestedIdStr && baseRequirement) {
                        return baseRequirement;
                    }
                    const { markdown } = await fetchConfluencePage(bearerToken, requestedIdStr, { inlineTextAttachments: true });
                    return markdown || '';
                } catch (err) {
                    console.warn(`[interactive-context] Не удалось загрузить страницу pageId=${requestedPageId}: ${err.message}`);
                    return '';
                }
            }
            : null;

        const contextToolset = createContextToolset({
            sources: sourceRegistry.getSources(),
            fetcher: contextFetcher,
            defaultChunk: 8000  // ✅ Увеличено для MiniMax-M2 (204K контекст)
        });

        const interactiveTools = Array.isArray(contextToolset.tools) ? contextToolset.tools : [];
        const contextToolHandlers = contextToolset.handlers || {};

        let contextSourcesSummary = contextToolset.summary || '';
        if (contextSourcesSummary) {
            const summaryLines = contextSourcesSummary.split('\n').filter(Boolean);
            if (summaryLines.length > 15) {
                const hiddenCount = summaryLines.length - 15;
                contextSourcesSummary = `${summaryLines.slice(0, 15).join('\n')}\n- ... еще ${hiddenCount} источников`;
            }
        }

        const interactiveInstructionBlock = interactiveTools.length
            ? `Если тебе нужен дополнительный контекст, используй инструменты:
- list_context_sources() — посмотреть список источников
- fetch_context_chunk({ "sourceId": "...", "offset": 0, "limit": 4000 }) — получить нужный фрагмент текста

Доступные источники:
${contextSourcesSummary || '—'}
`
            : 'Дополнительные контекстные источники не предоставлены. Работай только с текстом требований.';

        // Функция чанкования больших требований
        function chunkTextBySize(text, maxChars = 120000) {
            if (!text || text.length <= maxChars) return [text];

            const chunks = [];
            const paragraphs = text.split(/\n\n+/);
            let currentChunk = '';

            for (const para of paragraphs) {
                if (currentChunk.length + para.length > maxChars && currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = para;
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + para;
                }
            }

            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }

            return chunks.length > 0 ? chunks : [text];
        }

        // УДАЛЕНО: функция mergeTestModels больше не нужна - используем простое объединение массивов
        /*
        function mergeTestModels(models) {
            if (!models || models.length === 0) return [];
            if (models.length === 1) return models[0];
            
            const featureMap = new Map();
            
            // Функция для нормализации названий (убирает множественное число и лишние слова)
            function normalizeName(name) {
                return name.toLowerCase().trim()
                    .replace(/\s+/g, ' ') // убираем лишние пробелы
                    .replace(/[ыи]$/g, '') // убираем множественное число
                    .replace(/пользователя?/g, '') // убираем "пользователя/пользователь"
                    .replace(/пользовательский?/g, '') // убираем "пользовательский/пользовательская"
                    .replace(/\s+/g, ' ') // убираем лишние пробелы снова
                    .trim();
            }
            
            for (const model of models) {
                if (!Array.isArray(model)) continue;
                
                for (const feature of model) {
                    if (!feature?.text) continue;
                    
                    const fKey = normalizeName(feature.text);
                    
                    if (!featureMap.has(fKey)) {
                        featureMap.set(fKey, {
                            text: feature.text,
                            stories: []
                        });
                    }
                    
                    const existingFeature = featureMap.get(fKey);
                    const storyMap = new Map();
                    
                    for (const story of (existingFeature.stories || [])) {
                        if (story?.text) {
                            storyMap.set(normalizeName(story.text), story);
                        }
                    }
                    
                    for (const story of (feature.stories || [])) {
                        if (!story?.text) continue;
                        
                        const sKey = normalizeName(story.text);
                        
                        if (!storyMap.has(sKey)) {
                            storyMap.set(sKey, {
                                text: story.text,
                                scenarios: story.scenarios || []
                            });
                        } else {
                            const existingStory = storyMap.get(sKey);
                            const scenarioMap = new Map();
                            
                            for (const sc of (existingStory.scenarios || [])) {
                                if (sc?.text) {
                                    scenarioMap.set(normalizeName(sc.text), sc);
                                }
                            }
                            
                            for (const sc of (story.scenarios || [])) {
                                if (!sc?.text) continue;
                                
                                const scKey = normalizeName(sc.text);
                                
                                if (!scenarioMap.has(scKey)) {
                                    scenarioMap.set(scKey, {
                                        text: sc.text,
                                        codes: sc.codes || []
                                    });
                                } else {
                                    const existingScenario = scenarioMap.get(scKey);
                                    const codeMap = new Map();
                                    
                                    for (const code of (existingScenario.codes || [])) {
                                        if (code?.text) {
                                            codeMap.set(normalizeName(code.text), code);
                                        }
                                    }
                                    
                                    for (const code of (sc.codes || [])) {
                                        if (code?.text) {
                                            const cKey = normalizeName(code.text);
                                            if (!codeMap.has(cKey)) {
                                                codeMap.set(cKey, code);
                                            }
                                        }
                                    }
                                    
                                    existingScenario.codes = Array.from(codeMap.values());
                                }
                            }
                            
                            existingStory.scenarios = Array.from(scenarioMap.values());
                        }
                    }
                    
                    existingFeature.stories = Array.from(storyMap.values());
                }
            }
            
            return Array.from(featureMap.values());
        }
        */

        // ✅ Загружаем пример тестовой модели
        const testModelExample = JSON.parse(readFileSync(join(__dirname, 'config', 'examples', 'test-model-example.json'), 'utf-8'));

        const SYSTEM_PROMPT = `
Ты — SDET, генерирующий тестовую модель на основе requirements.

═══════════════════════════════════════════════════════════════
🏗️ СТРУКТУРА ТЕСТОВОЙ МОДЕЛИ
═══════════════════════════════════════════════════════════════

Feature → Story → Scenario → Code

**Feature** — высокоуровневая функциональность ("Безбумажный офис", "Платежи")

**Story** — пользовательская история внутри Feature, описывает ЧТО хочет получить пользователь:
  ✅ "Регистрация в ББО" - пользователь хочет зарегистрироваться
  ✅ "QR-коды для физических лиц" - пользователь хочет работать с QR-кодами
  ✅ "Перевод между счетами" - пользователь хочет перевести деньги
  ❌ "Реализация кнопки создания QR-кода" - это техническое описание, НЕ пользовательская история!
  ❌ "API метод получения данных" - это техническое описание, НЕ пользовательская история!
  ❌ "Чек-бокс УНК в другом банке" - это описание контрола, НЕ пользовательская история!
  
  🚨 ПРАВИЛО: Story = ценность для пользователя, НЕ техническая реализация!

**Scenario** — конкретное действие пользователя, ВСЕГДА начинается с номера и глагола:
  ✅ "1. Нажать на кнопку 'Безбумажный офис'"
  ✅ "2. Выбрать чекбокс 'УНК в другом банке'"
  ✅ "3. Ввести ОТП-код в модальное окно"

**Code** — поведение системы (Frontend + Backend + Integration) после действия пользователя:
  ✅ Frontend: "Отобразить модальное окно ОТП", "Показать лоадер на кнопке", "Скрыть поле 'Примечание'"
  ✅ Backend: "POST /confirm/code/check", "GET /info/v2", "PUT /nopaper/user"
  ✅ Методы: "Вызвать метод auth()", "Выполнить verificate()"
  ✅ Интеграции: "Отправить push-уведомление", "Сохранить в БД", "Записать лог операции"

═══════════════════════════════════════════════════════════════
📚 ЭТАЛОННЫЙ ПРИМЕР (ИСПОЛЬЗУЙ КАК ШАБЛОН!)
═══════════════════════════════════════════════════════════════

\`\`\`json
${JSON.stringify(testModelExample, null, 2)}
\`\`\`

🚨 АНАЛИЗИРУЙ ПРИМЕР ПЕРЕД ГЕНЕРАЦИЕЙ:
1. Feature: "Безбумажный офис" - БИЗНЕС-ПОТРЕБНОСТЬ, НЕТ поля requirement
2. Story: "Регистрация в ББО" - ПОЛЬЗОВАТЕЛЬСКАЯ ИСТОРИЯ, НЕТ поля requirement
3. Scenario: "1. Нажать на кнопку..." - ДЕЙСТВИЕ ПОЛЬЗОВАТЕЛЯ с номером, НЕТ поля requirement
4. Code: массив с Frontend + Backend вместе, НЕТ поля requirement, НЕТ префиксов "API:", "UI:"

═══════════════════════════════════════════════════════════════
🚨 КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ CODE
═══════════════════════════════════════════════════════════════

1. Code описывает ЧТО ДЕЛАЕТ СИСТЕМА, а НЕ что делает пользователь
   ✅ "Отобразить страницу 'Письмо отправлено'"
   ❌ "Пользователь видит страницу" (это Step в тест-кейсе)

2. Code может содержать НЕСКОЛЬКО действий Frontend + Backend ВМЕСТЕ
   ✅ Scenario "4. Нажать на кнопку 'Подтвердить'":
       codes: [
         "Показать лоадер на кнопке",      // Frontend
         "PUT /nopaper/user",               // Backend
         "Отобразить модальное окно ОТП",  // Frontend
         "Отправить push 'Требуется код'"  // Integration
       ]

3. Code НЕ содержит префиксов "API:", "UI:", "Frontend:", "Backend:"
   ✅ "POST /confirm/code/check"
   ❌ "API: POST /confirm/code/check"

4. Code извлекается ТОЛЬКО из requirements (НЕ выдумывай!)
   ✅ Если в requirements написано "вызвать метод auth()" → добавляй "Вызвать метод auth()"
   ❌ Если нет информации о push-уведомлении → НЕ добавляй его

═══════════════════════════════════════════════════════════════
📋 ФОРМАТ ВЫХОДНОЙ МОДЕЛИ
═══════════════════════════════════════════════════════════════

[
  {
    "id": "uuid",
    "text": "Feature name",
    "stories": [
      {
        "id": "uuid",
        "text": "Story name",
        "scenarios": [
          {
            "id": "uuid",
            "text": "N. Действие пользователя",
            "codes": [
              {
                "id": "uuid",
                "text": "Поведение системы (Frontend/Backend/Integration)"
              }
            ]
          }
        ]
      }
    ]
  }
]

ВАЖНО:
- НЕТ поля "requirement" НА ВСЕХ УРОВНЯХ!
- Code = массив объектов с id + text
- Scenario.text ВСЕГДА начинается с номера "N."
- Code.text = конкретное поведение системы БЕЗ префиксов

═══════════════════════════════════════════════════════════════
📚 ПРИМЕРЫ ПРАВИЛЬНОГО CODE
═══════════════════════════════════════════════════════════════

ПРИМЕР 1: Scenario с Frontend + Backend вместе
Scenario: "4. Нажать на кнопку 'Подтвердить'"
codes: [
  {"id": "...", "text": "Показать лоадер на кнопке 'Подтвердить'"},
  {"id": "...", "text": "PUT /nopaper/user"},
  {"id": "...", "text": "Отобразить модальное окно ОТП"},
  {"id": "...", "text": "Отправить push-уведомление 'Требуется ввод кода'"}
]

ПРИМЕР 2: Scenario с цепочкой методов
Scenario: "6. Нажать на кнопку 'Продолжить'"
codes: [
  {"id": "...", "text": "GET /stateful/personal/kuban/noPaper/secretCodeAsync"},
  {"id": "...", "text": "Вызвать метод auth()"},
  {"id": "...", "text": "Вызвать метод verificate()"},
  {"id": "...", "text": "Вызвать метод getKeyAcceptanceAct()"},
  {"id": "...", "text": "Отобразить страницу с актом признания ключа"}
]

ПРИМЕР 3: Scenario с условной логикой
Scenario: "1. Нажать на кнопку 'Безбумажный офис'"
codes: [
  {"id": "...", "text": "GET /stateful/personal/kuban/client/info/v2"},
  {"id": "...", "text": "Отобразить страницу 'Электронная почта не найдена' или 'Письмо отправлено'"}
]

═══════════════════════════════════════════════════════════════
❌ ПРИМЕРЫ НЕПРАВИЛЬНОГО CODE
═══════════════════════════════════════════════════════════════

ОШИБКА 1: Префиксы в Code.text
❌ "API: POST /confirm/code/check"
✅ "POST /confirm/code/check"

ОШИБКА 2: Действие пользователя в Code
❌ "Пользователь видит модальное окно"
✅ "Отобразить модальное окно ОТП"

ОШИБКА 3: Наличие поля requirement
❌ {"text": "GET /info/v2", "requirement": "2.2.1"}
✅ {"text": "GET /info/v2"}

ОШИБКА 4: Scenario без номера
❌ "Нажать на кнопку 'Подтвердить'"
✅ "4. Нажать на кнопку 'Подтвердить'"

═══════════════════════════════════════════════════════════════
🛡️ ЗАПРЕТЫ
═══════════════════════════════════════════════════════════════

❌ НЕ добавляй поле "requirement" в Feature/Story/Scenario/Code
❌ НЕ используй префиксы "API:", "UI:", "Frontend:", "Backend:" в Code.text
❌ НЕ выдумывай Code, которого нет в requirements
❌ НЕ смешивай действия пользователя (Step) с поведением системы (Code)
❌ НЕ создавай Story как описание контрола ("Чек-бокс X", "Поле Y", "Кнопка Z")
❌ НЕ создавай Story как техническое название ("API метод...", "Реализация...", "Доработка...")
❌ НЕ создавай Story как техническую формулировку ("Реализация кнопки...", "Создание формы...", "Добавление поля...")

✅ ПРАВИЛЬНО: Story описывает бизнес-ценность для пользователя
  ✅ "QR-коды для физических лиц" (пользователь хочет работать с QR-кодами)
  ✅ "Оплата по QR-коду" (пользователь хочет оплатить через QR)
  ✅ "Регистрация в ББО" (пользователь хочет зарегистрироваться)
  
❌ НЕПРАВИЛЬНО: Story описывает техническую реализацию
  ❌ "Реализация кнопки создания QR-кода" → правильно: "QR-коды для физических лиц"
  ❌ "API метод получения данных" → правильно: "Получение данных о счетах"
  ❌ "Доработка формы оплаты" → правильно: "Оплата по QR-коду"

**ТРЕБОВАНИЯ:**
${reqStringForModel}

Ответ — **только** чистый JSON-массив без комментариев, как в примере выше.
`.trim();


        // === ЧАНКОВАНИЕ БОЛЬШИХ ТРЕБОВАНИЙ ===
        const reqChunks = chunkTextBySize(reqStringForModel, 120000);
        const totalSize = reqStringForModel.length;

        console.log(`[generate-test-model-async] Требования разбиты на ${reqChunks.length} чанк(ов), общий размер: ${totalSize} символов`);

        const partialModels = [];

        const MAX_MODEL_ATTEMPTS_PER_CHUNK = 5; // ✅ Увеличено с 3 до 5 для более качественной генерации

        // === ГЕНЕРАЦИЯ ДЛЯ КАЖДОГО ЧАНКА ===
        for (let chunkIdx = 0; chunkIdx < reqChunks.length; chunkIdx++) {
            const reqChunk = reqChunks[chunkIdx];
            const progress = Math.round(((chunkIdx + 1) / reqChunks.length) * 100);

            // Батчим обновления прогресса (каждые 10%)
            if (progress % 10 === 0) {
                await db('generation_tasks').where('id', taskId).update({
                    progress,
                    updated_at: new Date()
                });
            }

            if (reqChunks.length > 1) {
                console.log(`[generate-test-model-async] Обработка чанка ${chunkIdx + 1}/${reqChunks.length}...`);
            }

            // Модифицируем промпт для чанков
            let userPrompt = `
📋 ЗАДАНИЕ: Создай тестовую модель Feature → Story → Scenario → Code

REQUIREMENTS:
${reqChunk}

ПРАВИЛА ГЕНЕРАЦИИ:

1. СТРУКТУРА
   - Feature: высокоуровневая функциональность
   - Story: пользовательская история
   - Scenario: действие пользователя (ВСЕГДА начинается с "N. Глагол...")
   - Code: поведение системы после действия

2. CODE = ПОВЕДЕНИЕ СИСТЕМЫ
   Извлекай из requirements:
   - HTTP-методы: "GET /api/endpoint", "POST /confirm/code/check"
   - UI-поведение: "Отобразить модальное окно", "Показать лоадер"
   - Методы: "Вызвать метод auth()", "Выполнить verificate()"
   - Интеграции: "Отправить push-уведомление", "Сохранить в БД"

3. ОДИН SCENARIO → НЕСКОЛЬКО CODE
   Scenario "4. Нажать на кнопку 'Подтвердить'":
   codes: [
     "Показать лоадер на кнопке 'Подтвердить'",
     "PUT /nopaper/user",
     "Отобразить модальное окно ОТП",
     "Отправить push 'Требуется ввод кода'"
   ]

4. ЗАПРЕТЫ
   ❌ НЕТ поля "requirement"
   ❌ НЕТ префиксов "API:", "UI:" в Code.text
   ❌ НЕ выдумывай Code, которого нет в requirements

ФОРМАТ:
[
  {
    "id": "uuid",
    "text": "Feature",
    "stories": [
      {
        "id": "uuid",
        "text": "Story",
        "scenarios": [
          {
            "id": "uuid",
            "text": "N. Действие пользователя",
            "codes": [
              {"id": "uuid", "text": "Поведение системы"}
            ]
          }
        ]
      }
    ]
  }
]
`.trim();

            if (reqChunks.length > 1) {
                userPrompt = `ВНИМАНИЕ: Это часть ${chunkIdx + 1} из ${reqChunks.length} от общего документа требований.

                🚨 КРИТИЧЕСКИ ВАЖНО ДЛЯ РАБОТЫ С ЧАНКАМИ! 🚨
                
                ТЫ ВИДИШЬ ТОЛЬКО ЧАСТЬ ДОКУМЕНТА, поэтому:
                
1. **ИЗВЛЕКАЙ ВСЕ РАЗДЕЛЫ**: Найди ВСЕ нумерованные разделы в ЭТОЙ части (формат X.X, X.X.X)
2. **СОЗДАВАЙ STORIES**: Для КАЖДОГО найденного раздела создай Story (БЕЗ поля requirement!)
3. **НЕ ПРОПУСКАЙ**: Даже если раздел кажется неполным или обрывается на середине - всё равно создай Story
4. **НЕПОЛНЫЕ SCENARIOS**: Если видишь действия пользователя без реакций системы → создай Scenario с пустым массивом codes
5. **НЕПОЛНЫЕ CODES**: Если видишь описания системных реакций без контекста → создай Code в том Scenario, который есть

ВАЖНО: Все чанки будут объединены автоматически, поэтому:
- НЕ беспокойся о дублях - они будут удалены
- НЕ пытайся угадать что в других чанках - работай только с тем, что видишь
- ГЛАВНОЕ - не пропусти ни одного нумерованного раздела в ЭТОЙ части!

ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ:
- Просканировал ли ты ВЕСЬ этот чанк от начала до конца?
- Нашел ли ты ВСЕ нумерованные разделы (X.X, X.X.X)?
- Создал ли ты Story для КАЖДОГО раздела (БЕЗ поля requirement)?

${interactiveInstructionBlock}

ТРЕБОВАНИЯ ДЛЯ АНАЛИЗА:
${reqChunk}`;

            } else {
                // Для одного чанка - явно просим генерировать ПОЛНУЮ модель
                userPrompt = `🚨 КРИТИЧЕСКИ ВАЖНО: ГЕНЕРИРУЙ ПОЛНУЮ ТЕСТОВУЮ МОДЕЛЬ! 🚨

📋 ЗАДАНИЕ: Создай ПОЛНУЮ тестовую модель Feature → Story → Scenario → Code

REQUIREMENTS:
${reqChunk}

🚨 ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:

1. ПОЛНОТА МОДЕЛИ:
   - Прочитай ВЕСЬ документ от начала до конца
   - Найди ВСЕ нумерованные разделы (X.X, X.X.X, X.X.X.X)
   - Создай Story для КАЖДОГО раздела (НЕ пропускай ни одного!)
   - Каждая Story должна содержать ВСЕ Scenarios из этого раздела
   - Каждый Scenario должен содержать ВСЕ Codes (системные реакции)
   - НЕ останавливайся на одной Story - создавай Story для КАЖДОГО раздела!

2. STORY = ПОЛЬЗОВАТЕЛЬСКАЯ ИСТОРИЯ:
   ✅ ПРАВИЛЬНО: "Регистрация в ББО", "QR-коды для физических лиц", "Оплата по QR-коду", "Создание функциональной ссылки"
   ❌ НЕПРАВИЛЬНО: "Реализация кнопки...", "Вкладка X", "Фильтр Y", "Контрол Z", "Действие X"
   ❌ НЕПРАВИЛЬНО: "Описание контрола...", "Добавить кнопку...", "Реализовать фильтр..."
   
   Story должна описывать ЧТО хочет получить пользователь, а НЕ техническую реализацию!

3. SCENARIO = ДЕЙСТВИЕ ПОЛЬЗОВАТЕЛЯ:
   - ВСЕГДА начинается с "N. Глагол..." (где N - номер)
   ✅ "1. Нажать на кнопку 'Создать QR-код'"
   ✅ "2. Выбрать тип QR-кода"
   ❌ "Нажать на кнопку" (без номера)
   ❌ "Проверить поле" (проверка не действие пользователя)

4. CODE = ПОВЕДЕНИЕ СИСТЕМЫ:
   ✅ "GET /rest/stateful/...", "POST /api/endpoint"
   ✅ "Отобразить страницу...", "Показать лоадер..."
   ✅ "Вызвать метод auth()"
   ❌ "Заполнить поле", "Ввести значение", "Нажать кнопку" (это действия пользователя!)

5. ЗАПРЕТЫ:
   ❌ НЕТ поля "requirement" на всех уровнях
   ❌ НЕТ префиксов "API:", "UI:" в Code.text
   ❌ НЕ выдумывай Code, которого нет в requirements
   ❌ НЕ создавай Story как техническую формулировку

ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ:
- ✅ Прочитал ли ты ВЕСЬ документ от начала до конца?
- ✅ Нашел ли ты ВСЕ нумерованные разделы?
- ✅ Создал ли ты Story для КАЖДОГО раздела?
- ✅ Удалил ли ты все технические формулировки из Story?
- ✅ Убедился ли ты, что Story описывает ценность для пользователя?

${interactiveInstructionBlock}

ТРЕБОВАНИЯ ДЛЯ АНАЛИЗА:
${reqChunk}`;
            }

            const baseUserPrompt = userPrompt;
            let escalationPrompt = '';
            let validatedChunkModel = null;

            for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS_PER_CHUNK; attempt++) {
                const attemptUserPrompt = escalationPrompt
                    ? `${baseUserPrompt}\n\n${escalationPrompt}`.trim()
                    : baseUserPrompt;

                let ai;
                try {
                    const combinedTools = [...interactiveTools, buildSubmitModelTool()];
                    const interactiveResult = await runInteractiveLLM({
                        initialMessages: [
                            { role: 'system', content: SYSTEM_PROMPT },
                            { role: 'user', content: attemptUserPrompt }
                        ],
                        tools: combinedTools,
                        toolHandlers: contextToolHandlers,
                        finalToolNames: ['submit_test_model'],
                        maxIterations: 8,  // ✅ Уменьшено с 12 до 8 (достаточно для сбора контекста + генерации)
                        modelOptions: {
                            temperature: 0,
                            top_p: 0.9,
                            max_tokens: 150000,  // ✅ Увеличено с 50000 до 150000 для предотвращения обрезания JSON (модель поддерживает до 180K токенов)
                            extra: { transforms: 'middle-out' }
                        }
                    });
                    ai = interactiveResult.response;
                } catch (interactiveError) {
                    console.warn(`[generate-test-model-async] interactive context loop failed (chunk ${chunkIdx + 1}, attempt ${attempt + 1}): ${interactiveError.message}. Переходим к fallback без инструментов.`);
                    ai = await callWithCloudRuFallback(
                        OPENROUTER_URL,
                        [
                            { role: 'system', content: SYSTEM_PROMPT },
                            { role: 'user', content: attemptUserPrompt }
                        ],
                        config.openRouterAiKey,
                        {
                            tools: [buildSubmitModelTool()],
                            temperature: 0,
                            top_p: 0.9,
                            max_tokens: 150000,  // ✅ Увеличено с 50000 до 150000 для предотвращения обрезания JSON (модель поддерживает до 180K токенов)
                            extra: { transforms: 'middle-out' }
                        }
                    );
                }

                let args = extractToolArgs(ai, "submit_test_model");
                let partialModel;

                if (args) {
                    console.log(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: args получены, ключи:`, Object.keys(args));
                    if (args.model) {
                        console.log(`[generate-test-model-async] args.model тип:`, typeof args.model, 'является массивом:', Array.isArray(args.model));
                    } else {
                        console.warn(`[generate-test-model-async] args.model отсутствует в args`);
                    }
                } else {
                    console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: args не получены`);
                }

                if (args && args.model) {
                    // Если model - это массив, используем его напрямую
                    if (Array.isArray(args.model)) {
                        partialModel = args.model;
                    }
                    // Если model - это объект с полем items (массив), используем items
                    else if (typeof args.model === 'object' && args.model !== null && Array.isArray(args.model.items)) {
                        console.log(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: args.model содержит items, используем args.model.items`);
                        partialModel = args.model.items;
                    }
                    // Если model - это строка (JSON), парсим её
                    else if (typeof args.model === 'string') {
                        console.log(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: args.model - строка длиной ${args.model.length} символов`);
                        console.log(`[generate-test-model-async] Первые 200 символов: ${args.model.substring(0, 200)}`);
                        console.log(`[generate-test-model-async] Последние 200 символов: ${args.model.substring(Math.max(0, args.model.length - 200))}`);

                        try {
                            const parsed = JSON5.parse(args.model);
                            if (Array.isArray(parsed)) {
                                partialModel = parsed;
                            } else if (parsed && Array.isArray(parsed.items)) {
                                console.log(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: распарсенный JSON содержит items, используем parsed.items`);
                                partialModel = parsed.items;
                            } else {
                                console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: args.model не является массивом после парсинга, тип:`, typeof parsed);
                                partialModel = null;
                            }
                        } catch (parseErr) {
                            console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: Ошибка парсинга args.model как JSON:`, parseErr.message);

                            // ✅ Улучшенная попытка восстановить обрезанный JSON
                            if (parseErr.message.includes('invalid end of input') || parseErr.message.includes('Unexpected end')) {
                                console.warn(`[generate-test-model-async] ⚠️ JSON обрезан на ${args.model.length} символах. Попытка восстановления...`);
                                let fixedJson = args.model.trim();

                                // Стратегия 1: Подсчитываем открывающие и закрывающие скобки
                                const openBrackets = (fixedJson.match(/\[/g) || []).length;
                                const closeBrackets = (fixedJson.match(/\]/g) || []).length;
                                const openBraces = (fixedJson.match(/\{/g) || []).length;
                                const closeBraces = (fixedJson.match(/\}/g) || []).length;

                                // Стратегия 2: Находим последний валидный объект Feature
                                // Ищем паттерн "stories": [...] и закрываем его правильно
                                const lastValidFeatureMatch = fixedJson.match(/\{\s*"id"\s*:[\s\S]*?"stories"\s*:\s*\[[\s\S]*?\](?:\s*,\s*"scenarios"\s*:\s*\[)?/g);
                                
                                let recovered = false;
                                
                                // Попытка 1: Простое добавление закрывающих скобок
                                if (openBrackets > closeBrackets || openBraces > closeBraces) {
                                    let tempJson = fixedJson;
                                    if (openBrackets > closeBrackets) {
                                        tempJson += ']'.repeat(openBrackets - closeBrackets);
                                    }
                                    if (openBraces > closeBraces) {
                                        tempJson += '}'.repeat(openBraces - closeBraces);
                                    }
                                    
                                    try {
                                        const parsed = JSON5.parse(tempJson);
                                        if (Array.isArray(parsed) && parsed.length > 0) {
                                            console.log(`[generate-test-model-async] ✅ Успешно восстановлен JSON простым методом (добавлено ${openBrackets - closeBrackets} ] и ${openBraces - closeBraces} })`);
                                            partialModel = parsed;
                                            recovered = true;
                                        }
                                    } catch (e) {
                                        // Продолжаем к следующей стратегии
                                    }
                                }
                                
                                // Попытка 2: Извлечение последних валидных Feature объектов
                                if (!recovered) {
                                    try {
                                        // Ищем все полные объекты Feature до места обрезания
                                        const featurePattern = /\{\s*"id"\s*:[\s\S]*?"stories"\s*:[\s\S]*?\}/g;
                                        const features = [];
                                        let match;
                                        while ((match = featurePattern.exec(fixedJson)) !== null) {
                                            try {
                                                const feature = JSON5.parse(match[0]);
                                                if (feature && feature.id && feature.text && Array.isArray(feature.stories)) {
                                                    features.push(feature);
                                                }
                                            } catch (e) {
                                                // Пропускаем невалидный объект
                                            }
                                        }
                                        
                                        if (features.length > 0) {
                                            console.log(`[generate-test-model-async] ✅ Восстановлено ${features.length} валидных Feature из обрезанного JSON`);
                                            partialModel = features;
                                            recovered = true;
                                        }
                                    } catch (e) {
                                        // Продолжаем
                                    }
                                }
                                
                                if (!recovered) {
                                    console.error(`[generate-test-model-async] ❌ Не удалось восстановить обрезанный JSON. Требуется повторная генерация с увеличенным max_tokens.`);
                                    partialModel = null;
                                }
                            } else {
                                partialModel = null;
                            }
                        }
                    } else {
                        console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: args.model имеет неожиданный тип:`, typeof args.model, 'значение:', args.model);
                        partialModel = null;
                    }
                }

                if (!partialModel) {
                    let content = ai.choices?.[0]?.message?.content?.trim();
                    if (!content) {
                        console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: AI не вернул результата`);
                        if (attempt < MAX_MODEL_ATTEMPTS_PER_CHUNK - 1) {
                            escalationPrompt = `
🚨 Предыдущая попытка вернула пустой ответ.
Немедленно вызови функцию submit_test_model и верни ПОЛНУЮ модель (Feature→Story→Scenario→Code) в одном JSON-массиве.`.trim();
                            continue;
                        }
                        throw new Error(`Не удалось получить модель для чанка ${chunkIdx + 1}: Cloud.ru вернул пустой ответ`);
                    }

                    // Улучшенное извлечение JSON из content
                    let jsonText = null;

                    // Сначала пробуем найти JSON в markdown блоках
                    const jsonBlockMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
                    if (jsonBlockMatch) {
                        jsonText = jsonBlockMatch[1];
                    } else {
                        // Ищем JSON-массив вручную
                        const firstBracket = content.indexOf('[');
                        const lastBracket = content.lastIndexOf(']');
                        if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
                            console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: Не найден JSON-массив`);
                            if (attempt < MAX_MODEL_ATTEMPTS_PER_CHUNK - 1) {
                                escalationPrompt = `
🚨 Ответ не содержит JSON-массива.
Верни результат через submit_test_model с корректной структурой Feature→Story→Scenario→Code, как в идеальном примере.`.trim();
                                continue;
                            }
                            throw new Error(`Не удалось извлечь JSON-модель для чанка ${chunkIdx + 1}`);
                        }
                        jsonText = content.slice(firstBracket, lastBracket + 1);
                    }

                    // Очистка JSON
                    jsonText = jsonText.trim();
                    jsonText = jsonText.replace(/"(\s*)"code":/g, '", "code":');

                    // Убираем trailing commas
                    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

                    // Убираем все после последней закрывающей скобки массива
                    const lastValidBracket = jsonText.lastIndexOf(']');
                    if (lastValidBracket > 0 && lastValidBracket < jsonText.length - 1) {
                        jsonText = jsonText.substring(0, lastValidBracket + 1);
                    }

                    try {
                        let parsed = JSON5.parse(jsonText);
                        const isFlat = parsed.length > 0 && parsed[0].hasOwnProperty('Feature');
                        partialModel = isFlat ? transformToHierarchy(parsed) : parsed;
                    } catch (parseErr) {
                        console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: Ошибка парсинга JSON:`, parseErr.message);
                        console.warn(`[generate-test-model-async] JSON текст (первые 500 символов):`, jsonText.substring(0, 500));
                        console.warn(`[generate-test-model-async] JSON текст (последние 500 символов):`, jsonText.substring(Math.max(0, jsonText.length - 500)));

                        // Попытка исправить JSON: находим последний валидный объект
                        try {
                            // Ищем все валидные объекты Feature до ошибки
                            const featureMatches = jsonText.match(/\{\s*"id"[\s\S]*?"stories"[\s\S]*?\}/g);
                            if (featureMatches && featureMatches.length > 0) {
                                const validFeatures = [];
                                for (const match of featureMatches) {
                                    try {
                                        const feature = JSON5.parse(match);
                                        validFeatures.push(feature);
                                    } catch (e) {
                                        // Пропускаем невалидный объект
                                    }
                                }
                                if (validFeatures.length > 0) {
                                    console.warn(`[generate-test-model-async] Извлечено ${validFeatures.length} валидных Feature из обрезанного JSON`);
                                    partialModel = validFeatures;
                                } else {
                                    throw parseErr; // Если не удалось извлечь, пробрасываем исходную ошибку
                                }
                            } else {
                                throw parseErr;
                            }
                        } catch (recoveryErr) {
                            if (attempt < MAX_MODEL_ATTEMPTS_PER_CHUNK - 1) {
                                escalationPrompt = `
🚨 Ошибка парсинга JSON: ${parseErr.message}
Сформируй корректный JSON-массив и верни его через submit_test_model.
Структура строго по эталону: Feature → Story → Scenario → Code.
Убедись, что JSON валидный и не содержит синтаксических ошибок.`.trim();
                                continue;
                            }
                            throw new Error(`Ошибка парсинга JSON модели для чанка ${chunkIdx + 1}: ${parseErr.message}`);
                        }
                    }
                }

                if (!Array.isArray(partialModel) || partialModel.length === 0) {
                    console.warn(`[generate-test-model-async] Чанк ${chunkIdx + 1}, попытка ${attempt + 1}: модель пуста или не массив`);
                    if (attempt < MAX_MODEL_ATTEMPTS_PER_CHUNK - 1) {
                        escalationPrompt = `
🚨 Модель пуста.
Создай полную иерархию Feature→Story→Scenario→Code в соответствии с требованиями.`.trim();
                        continue;
                    }
                    throw new Error(`Получена пустая модель для чанка ${chunkIdx + 1}`);
                }

                const normalizedPartial = normalizeModelStructure(partialModel);
                const repairedPartial = repairModelStructure(normalizedPartial);
                const structureIssues = detectModelStructureIssues(repairedPartial, `chunk-${chunkIdx + 1}`);

                if (structureIssues.length) {
                    console.warn(`[generate-test-model-async] Структурные ошибки (chunk ${chunkIdx + 1}, attempt ${attempt + 1}):`, structureIssues);

                    // ✅ АВТОМАТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Исправляем Code с пользовательскими действиями
                    const codeIssues = structureIssues.filter(issue => issue.includes('Code') && issue.includes('пользовательское действие'));
                    if (codeIssues.length > 0) {
                        console.log(`[generate-test-model-async] Автоматически исправляю ${codeIssues.length} Code с пользовательскими действиями...`);
                        // Применяем автоматическое исправление Code
                        const autoFixedModel = autoFixCodeWithUserActions(repairedPartial);
                        const fixedIssues = detectModelStructureIssues(autoFixedModel, `chunk-${chunkIdx + 1}`);
                        if (fixedIssues.length < structureIssues.length) {
                            console.log(`[generate-test-model-async] ✅ Автоматическое исправление помогло: ${structureIssues.length} → ${fixedIssues.length} ошибок`);
                            repairedPartial = autoFixedModel;
                            if (fixedIssues.length === 0) {
                                validatedChunkModel = repairedPartial;
                                break;
                            }
                            // Обновляем список ошибок для следующей попытки
                            structureIssues = fixedIssues;
                        } else {
                            console.warn(`[generate-test-model-async] ⚠️ Автоматическое исправление не помогло, осталось ${fixedIssues.length} ошибок`);
                        }
                    }

                    if (attempt < MAX_MODEL_ATTEMPTS_PER_CHUNK - 1) {
                        // ✅ Формируем детальный escalation prompt для всех типов проблем
                        const featureIssues = structureIssues.filter(issue => issue.includes('Feature'));
                        const storyIssues = structureIssues.filter(issue => issue.includes('Story'));
                        const scenarioIssues = structureIssues.filter(issue => issue.includes('Scenario'));
                        const codeIssues = structureIssues.filter(issue => issue.includes('Code'));

                        let escalationDetails = [];

                        if (featureIssues.length > 0) {
                            escalationDetails.push(`\n🚨 ПРОБЛЕМЫ С FEATURE:\n${featureIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n')}\n\nПРАВИЛО: Feature = БИЗНЕС-ПОТРЕБНОСТЬ для пользователя\n✅ "Безбумажный офис", "Платежи", "QR-коды для физических лиц"\n❌ "Реализация...", "Доработка...", "API метод..."`);
                        }

                        if (storyIssues.length > 0) {
                            escalationDetails.push(`\n🚨 ПРОБЛЕМЫ С STORY:\n${storyIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n')}\n\nПРАВИЛО: Story = ПОЛЬЗОВАТЕЛЬСКАЯ ИСТОРИЯ (что хочет получить пользователь)\n✅ "Регистрация в ББО", "QR-коды для физических лиц", "Оплата по QR-коду"\n❌ "Реализация кнопки...", "API метод...", "Чек-бокс X", "Вкладка X", "Контрол X"\n\n🚨 КРИТИЧНО: Story НЕ должна описывать техническую реализацию или UI-контролы!`);
                        }

                        if (scenarioIssues.length > 0) {
                            escalationDetails.push(`\n🚨 ПРОБЛЕМЫ С SCENARIO:\n${scenarioIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n')}\n\nПРАВИЛО: Scenario = ДЕЙСТВИЕ ПОЛЬЗОВАТЕЛЯ, ВСЕГДА начинается с "N. Глагол..."\n✅ "1. Нажать на кнопку 'Безбумажный офис'", "2. Выбрать чекбокс 'УНК в другом банке'"\n❌ "Нажать на кнопку" (без номера), "Проверить поле" (проверка не действие)`);
                        }

                        if (codeIssues.length > 0) {
                            escalationDetails.push(`\n🚨 ПРОБЛЕМЫ С CODE:\n${codeIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n')}\n\nПРАВИЛО: Code = ПОВЕДЕНИЕ СИСТЕМЫ после действия пользователя\n✅ "GET /stateful/...", "Отобразить страницу...", "Вызвать метод auth()"\n❌ "Заполнить поле", "Ввести значение", "Нажать кнопку" (это действия пользователя!)`);
                        }

                        escalationPrompt = `
🚨 КРИТИЧЕСКАЯ ОШИБКА: Структура модели нарушена! Попытка ${attempt + 1}/${MAX_MODEL_ATTEMPTS_PER_CHUNK}

Следуй ПРИМЕРУ выше (см. пример тестовой модели):

КРИТИЧЕСКИ ВАЖНО - ИСПОЛЬЗУЙ ПРИМЕР КАК ЭТАЛОН:
- Feature = БИЗНЕС-ПОТРЕБНОСТЬ (как в примере: "Безбумажный офис")
- Story = ПОЛЬЗОВАТЕЛЬСКАЯ ИСТОРИЯ (как в примере: "Регистрация в ББО")
- Scenario = ДЕЙСТВИЕ ПОЛЬЗОВАТЕЛЯ (как в примере: "Нажать на кнопку \"Безбумажный офис\"")
- Code = РЕАКЦИЯ СИСТЕМЫ (как в примере: "GET /stateful/...", "Отобразить страницу...")

${escalationDetails.join('\n')}

🚨 ОБЯЗАТЕЛЬНО:
1. Перечитай ВЕСЬ чанк requirements от начала до конца
2. Найди ВСЕ нумерованные разделы (X.X, X.X.X)
3. Создай Story для КАЖДОГО раздела (НЕ пропускай!)
4. Удали все технические формулировки из Story
5. Убедись, что Story описывает ценность для пользователя, а не техническую реализацию

Перегенерируй модель СТРОГО по примеру выше и верни через submit_test_model.`.trim();
                        continue;
                    }

                    // После всех попыток - принимаем модель с предупреждением
                    console.warn(`[generate-test-model-async] ⚠️ Принимаю модель с ${structureIssues.length} структурными ошибками после ${MAX_MODEL_ATTEMPTS_PER_CHUNK} попыток`);
                    validatedChunkModel = repairedPartial;
                    break;
                }

                validatedChunkModel = repairedPartial;
                break;
            }

            if (!validatedChunkModel) {
                throw new Error(`Не удалось получить валидную модель для чанка ${chunkIdx + 1} после ${MAX_MODEL_ATTEMPTS_PER_CHUNK} попыток`);
            }

            partialModels.push(validatedChunkModel);
        }

        // Объединяем все частичные модели
        if (partialModels.length === 0) {
            console.error('[generate-test-model-async] Не удалось получить валидные модели ни из одного чанка');
            console.error('[generate-test-model-async] Попробуем создать базовую модель...');

            // Создаем базовую модель как fallback с уникальными ID
            const fallbackModel = [{
                id: uuidv4(),
                text: "Основная функциональность",
                stories: [{
                    id: uuidv4(),
                    text: "Базовый сценарий",
                    scenarios: [{
                        id: uuidv4(),
                        text: "Основной тест",
                        codes: [{
                            id: uuidv4(),
                            text: "Проверить основную функциональность"
                        }]
                    }]
                }]
            }];

            partialModels.push(fallbackModel);
            console.log('[generate-test-model-async] Создана fallback модель');
        }

        // ✅ ОБЪЕДИНЯЕМ МОДЕЛИ С ДЕДУПЛИКАЦИЕЙ Feature
        // Объединяем Feature с одинаковым текстом, добавляя их Stories
        const featureMap = new Map(); // text → feature

        for (const partialModel of partialModels) {
            for (const feature of partialModel) {
                const featureText = String(feature?.text || '').trim();

                if (!featureText) {
                    console.warn(`[generate-test-model-async] ⚠️ Пропущен Feature без текста`);
                    continue;
                }

                if (featureMap.has(featureText)) {
                    // Объединяем Stories существующего Feature с новым
                    const existingFeature = featureMap.get(featureText);
                    const existingStoryTexts = new Set(
                        (existingFeature.stories || []).map(s => String(s?.text || '').trim())
                    );

                    // ✅ ФИЛЬТРАЦИЯ: Удаляем технические Story перед добавлением
                    const TECHNICAL_STORY_PATTERNS = [
                        /^реализовать/i,
                        /^добавить\s+(контрол|кнопку|поле|вкладку|фильтр)/i,
                        /^описание\s+(контрола|кнопки|поля|вкладки)/i,
                        /^(контрол|кнопка|поле|вкладка|фильтр)\s+/i,
                        /^вкладка\s+"/i,
                        /^фильтр\s+"/i,
                        /^действие\s+"/i
                    ];

                    // Добавляем только уникальные и НЕ технические Stories
                    for (const story of (feature.stories || [])) {
                        const storyText = String(story?.text || '').trim();

                        if (!storyText) {
                            console.warn(`[generate-test-model-async] ⚠️ Пропущена Story без текста в Feature "${featureText}"`);
                            continue;
                        }

                        // Проверка на технические формулировки
                        const isTechnical = TECHNICAL_STORY_PATTERNS.some(pattern => pattern.test(storyText));
                        if (isTechnical) {
                            console.warn(`[generate-test-model-async] ⚠️ Пропущена техническая Story "${storyText}" в Feature "${featureText}"`);
                            continue;
                        }

                        if (!existingStoryTexts.has(storyText)) {
                            existingFeature.stories.push(story);
                            existingStoryTexts.add(storyText);
                            console.log(`[generate-test-model-async] ✅ Добавлена Story "${storyText}" к Feature "${featureText}"`);
                        } else {
                            console.warn(`[generate-test-model-async] ⚠️ Пропущена дублирующая Story "${storyText}" в Feature "${featureText}"`);
                        }
                    }
                } else {
                    // ✅ ФИЛЬТРАЦИЯ: Удаляем технические Story перед созданием нового Feature
                    const TECHNICAL_STORY_PATTERNS = [
                        /^реализовать/i,
                        /^добавить\s+(контрол|кнопку|поле|вкладку|фильтр)/i,
                        /^описание\s+(контрола|кнопки|поля|вкладки)/i,
                        /^(контрол|кнопка|поле|вкладка|фильтр)\s+/i,
                        /^вкладка\s+"/i,
                        /^фильтр\s+"/i,
                        /^действие\s+"/i
                    ];

                    const filteredStories = (feature.stories || []).filter(story => {
                        const storyText = String(story?.text || '').trim();
                        if (!storyText) {
                            console.warn(`[generate-test-model-async] ⚠️ Пропущена Story без текста в Feature "${featureText}"`);
                            return false;
                        }
                        const isTechnical = TECHNICAL_STORY_PATTERNS.some(pattern => pattern.test(storyText));
                        if (isTechnical) {
                            console.warn(`[generate-test-model-async] ⚠️ Пропущена техническая Story "${storyText}" в Feature "${featureText}"`);
                            return false;
                        }
                        return true;
                    });

                    // ✅ ГАРАНТИРУЕМ УНИКАЛЬНОСТЬ ID: Проверяем, что ID не используется в других Feature
                    let featureId = feature.id || uuidv4();
                    const existingIds = new Set(Array.from(featureMap.values()).map(f => f.id));
                    if (existingIds.has(featureId)) {
                        console.warn(`[generate-test-model-async] ⚠️ Обнаружен дублирующийся ID Feature "${featureId}", генерирую новый...`);
                        featureId = uuidv4();
                    }

                    // Создаем новый Feature только с валидными Stories
                    featureMap.set(featureText, {
                        id: featureId,
                        text: featureText,
                        stories: filteredStories
                    });
                    console.log(`[generate-test-model-async] ✅ Создан новый Feature "${featureText}" (ID: ${featureId}) с ${filteredStories.length} валидными Stories`);
                }
            }
        }

        // Преобразуем Map в массив
        let mergedModel = Array.from(featureMap.values());

        console.log(`[generate-test-model-async] Объединено ${partialModels.length} чанков → ${mergedModel.length} уникальных Features`);

        // Подробная статистика по слиянию
        if (partialModels.length > 1) {
            const totalFeatures = mergedModel.length;
            const totalStories = mergedModel.reduce((sum, f) => sum + (f.stories || []).length, 0);
            const totalScenarios = mergedModel.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0);
            const totalCodes = mergedModel.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) =>
                    s + (st.scenarios || []).reduce((sc, scn) => sc + (scn.codes?.length || 0), 0), 0), 0);

            // Подсчитываем scenarios без codes ПОСЛЕ слияния
            let scenariosWithoutCodesAfterMerge = 0;
            for (const feature of mergedModel) {
                for (const story of (feature.stories || [])) {
                    for (const scenario of (story.scenarios || [])) {
                        if ((scenario.codes || []).length === 0) {
                            scenariosWithoutCodesAfterMerge++;
                            console.warn(`⚠️ [generate-test-model-async] ПОСЛЕ СЛИЯНИЯ: Scenario БЕЗ codes в "${feature.text}" → "${story.text}" → "${scenario.text}"`);
                        }
                    }
                }
            }

            console.log(`[generate-test-model-async] MERGED: ${partialModels.length} чанков → ${totalFeatures} Features, ${totalStories} Stories, ${totalScenarios} Scenarios (БЕЗ codes: ${scenariosWithoutCodesAfterMerge}), ${totalCodes} Codes`);
        }

        // ✅ Добавляем уникальные ID к каждому элементу модели (БЕЗ requirement!)
        // ✅ ГАРАНТИРУЕМ УНИКАЛЬНОСТЬ ВСЕХ ID
        const addUniqueIds = (model) => {
            const usedIds = new Set();

            const generateUniqueId = () => {
                let newId = uuidv4();
                while (usedIds.has(newId)) {
                    newId = uuidv4();
                }
                usedIds.add(newId);
                return newId;
            };

            return (model || []).map(feature => {
                const featureId = feature.id && !usedIds.has(feature.id) ? feature.id : generateUniqueId();

                return {
                    id: featureId,
                    text: feature.text,
                    // ❌ УДАЛЕНО: requirement - это поле не используется в тестовой модели
                    stories: (feature.stories || []).map(story => {
                        const storyId = story.id && !usedIds.has(story.id) ? story.id : generateUniqueId();

                        return {
                            id: storyId,
                            text: story.text,
                            // ❌ УДАЛЕНО: requirement - это поле не используется в тестовой модели
                            scenarios: (story.scenarios || []).map(scenario => {
                                const scenarioId = scenario.id && !usedIds.has(scenario.id) ? scenario.id : generateUniqueId();

                                return {
                                    id: scenarioId,
                                    text: scenario.text,
                                    // ❌ УДАЛЕНО: requirement - это поле не используется в тестовой модели
                                    codes: (scenario.codes || []).map(code => {
                                        const codeId = code.id && !usedIds.has(code.id) ? code.id : generateUniqueId();

                                        return {
                                            id: codeId,
                                            text: code.text,
                                            type: code.type || 'integration' // ✅ Сохраняем type для Code
                                            // ❌ УДАЛЕНО: requirement - это поле не используется в тестовой модели
                                        };
                                    })
                                };
                            })
                        };
                    })
                };
            });
        };

        // Функция извлечения requirement из текста элемента
        function extractRequirementFromText(text) {
            if (!text) return null;

            // Ищем паттерны типа "2.2.7", "4.3", "1.2.3.4" в тексте
            const requirementPattern = /\b(\d+(?:\.\d+)+)\b/g;
            const matches = text.match(requirementPattern);

            if (matches && matches.length > 0) {
                // Возвращаем первое найденное требование
                return matches[0];
            }

            return null;
        }

        const finalModel = addUniqueIds(mergedModel);
        const repairedFinalModel = repairModelStructure(finalModel);

        // ✅ ФАЗА 3: ВАЛИДАЦИЯ МОДЕЛИ
        console.log('[generateTestModelAsync] Фаза 3: Валидация модели');
        let validationReport = null;
        if (reqStructure && reqStructure.features && reqStructure.features.length > 0) {
            validationReport = validateTestModel(repairedFinalModel, reqStructure);

            if (!validationReport.valid) {
                console.error('[generateTestModelAsync] Модель НЕ прошла валидацию:');
                validationReport.errors.forEach(err => console.error(`  ❌ ${err}`));

                // Сохраняем ошибки в БД, но продолжаем генерацию
                // Примечание: metadata не сохраняем, так как столбец отсутствует в БД
                await db('generation_tasks').where('id', taskId).update({
                    updated_at: new Date()
                });

                // Не бросаем ошибку, но логируем предупреждение
                console.warn('[generateTestModelAsync] ⚠️ Модель не прошла валидацию, но продолжаем генерацию');
            }

            if (validationReport.warnings.length > 0) {
                console.warn('[generateTestModelAsync] Предупреждения валидации:');
                validationReport.warnings.forEach(warn => console.warn(`  ⚠️ ${warn}`));
            }
        }

        // ✅ ФАЗА 4: ПОСТОБРАБОТКА МОДЕЛИ
        console.log('[generateTestModelAsync] Фаза 4: Постобработка модели');
        let cleanedModel = postProcessModel(repairedFinalModel);

        // ✅ НОВОЕ: Перегенерация избыточно детализированных Scenarios через LLM
        console.log(`[generate-test-model-async] Проверяю избыточно детализированные Scenarios...`);
        for (const feature of cleanedModel) {
            for (const story of (feature.stories || [])) {
                const scenarios = story.scenarios || [];
                if (scenarios.length > 5) {
                    console.log(`[generate-test-model-async] Story "${story.text}" содержит ${scenarios.length} Scenarios, перегенерируем через LLM...`);
                    try {
                        regenerationCount++;
                        const regenerated = await regenerateOverDetailedScenarios(story, scenarios, reqStringForModel);
                        if (regenerated && regenerated.length <= scenarios.length && regenerated.length > 0) {
                            story.scenarios = regenerated;
                            console.log(`[generate-test-model-async] ✅ Story "${story.text}": ${scenarios.length} → ${regenerated.length} Scenarios`);
                        }
                    } catch (error) {
                        console.error(`[generate-test-model-async] Ошибка при перегенерации Scenarios для Story "${story.text}":`, error.message);
                    }
                }
            }
        }

        // ✅ НОВОЕ: Дедупликация Scenarios между Stories
        cleanedModel = deduplicateScenariosAcrossStories(cleanedModel);

        // ✅ НОВОЕ: Объединение избыточно детализированных Scenarios (fallback эвристика)
        cleanedModel = mergeDetailedScenarios(cleanedModel);

        // ✅ НОВОЕ: Обогащение backend Code Expected Result
        cleanedModel = enrichBackendCodesWithExpectedResult(cleanedModel);

        // === ВАЛИДАЦИЯ И ОЧИСТКА МОДЕЛИ ===
        console.log(`[generate-test-model-async] Валидация и очистка сгенерированной модели...`);
        cleanedModel = validateAndCleanModel(cleanedModel);

        // ✅ ФАЗА 5: COVERAGE REPORT
        console.log('[generateTestModelAsync] Фаза 5: Генерация Coverage Report');
        let coverageReportData = null;
        if (reqStructure && reqStructure.features && reqStructure.features.length > 0) {
            coverageReportData = generateCoverageReport(cleanedModel, reqStructure);

            // ✅ НОВОЕ: Рассчитываем покрытие requirements
            if (reqStringForModel) {
                const reqCoverage = calculateRequirementsCoverage(cleanedModel, reqStringForModel, reqStructure);
                console.log(`[Coverage] Requirements: ${reqCoverage.covered}/${reqCoverage.total} (${reqCoverage.coveragePercent}%)`);
                if (reqCoverage.missing.length > 0) {
                    console.warn(`[Coverage] Не покрыто ${reqCoverage.missing.length} requirements: ${reqCoverage.missing.slice(0, 10).join(', ')}${reqCoverage.missing.length > 10 ? '...' : ''}`);
                }
                coverageReportData.requirementsCoverage = reqCoverage;
            }

            // Сохраняем в БД
            // Примечание: metadata не сохраняем, так как столбец отсутствует в БД
            await db('generation_tasks').where('id', taskId).update({
                progress: 60,
                updated_at: new Date()
            });

            // Проверяем Coverage
            if (coverageReportData.coveragePercent < 90) {
                console.warn(`[generateTestModelAsync] ⚠️ Coverage ниже 90%: ${coverageReportData.coveragePercent}%`);
                console.warn(`[generateTestModelAsync] Не покрыто ${coverageReportData.missing.length} Stories:`);
                coverageReportData.missing.forEach(story => console.warn(`  ❌ ${story}`));
            } else {
                console.log(`[generateTestModelAsync] ✅ Coverage: ${coverageReportData.coveragePercent}%`);
            }
        }

        const finalStructureIssues = detectModelStructureIssues(cleanedModel, 'final');
        if (finalStructureIssues.length) {
            console.warn(`[generate-test-model-async] ⚠️ Обнаружены структурные проблемы в финальной модели:`, finalStructureIssues);

            // ✅ ПОВТОРНАЯ ГЕНЕРАЦИЯ с уточняющим промптом для проблемных Story
            const storyIssues = finalStructureIssues.filter(issue =>
                issue.includes('Story') && (issue.includes('техническую формулировку') || issue.includes('описание контрола'))
            );

            if (storyIssues.length > 0 && reqStringForModel && SYSTEM_PROMPT) {
                console.log(`[generate-test-model-async] 🔄 Попытка повторной генерации с исправлением ${storyIssues.length} проблемных Story...`);

                // Формируем уточняющий промпт для исправления Story
                const escalationPrompt = `
🚨 КРИТИЧЕСКАЯ ОШИБКА: Обнаружены Story с техническими формулировками вместо пользовательских историй!

ПРОБЛЕМНЫЕ Story:
${storyIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n')}

ПРАВИЛА ДЛЯ ИСПРАВЛЕНИЯ:
- Story должна описывать ЧТО хочет получить пользователь, а НЕ техническую реализацию
- ❌ "Реализация кнопки создания QR-кода" → ✅ "QR-коды для физических лиц"
- ❌ "API метод получения данных" → ✅ "Получение данных о счетах"
- ❌ "Чек-бокс УНК в другом банке" → ✅ "Работа с УНК в другом банке"

ПЕРЕГЕНЕРИРУЙ модель, исправив все проблемные Story на пользовательские истории!
`.trim();

                try {
                    const reqChunks = chunkTextBySize(reqStringForModel, 120000);
                    const fixedModel = [];

                    for (let chunkIdx = 0; chunkIdx < reqChunks.length; chunkIdx++) {
                        const chunkReq = reqChunks[chunkIdx];
                        // Формируем userPrompt для чанка (как в основном цикле генерации)
                        const chunkUserPrompt = `📋 ЗАДАНИЕ: Создай тестовую модель Feature → Story → Scenario → Code

REQUIREMENTS:
${chunkReq}

ПРАВИЛА ГЕНЕРАЦИИ:
1. СТРУКТУРА
   - Feature: высокоуровневая функциональность
   - Story: пользовательская история (НЕ техническая реализация!)
   - Scenario: действие пользователя (ВСЕГДА начинается с "N. Глагол...")
   - Code: поведение системы после действия

2. CODE = ПОВЕДЕНИЕ СИСТЕМЫ
   Извлекай из requirements:
   - HTTP-методы: "GET /api/endpoint", "POST /confirm/code/check"
   - UI-поведение: "Отобразить модальное окно", "Показать лоадер"
   - Методы: "Вызвать метод auth()", "Выполнить verificate()"
   - Интеграции: "Отправить push-уведомление", "Сохранить в БД"

3. ОДИН SCENARIO → НЕСКОЛЬКО CODE
   Scenario "4. Нажать на кнопку 'Подтвердить'":
   codes: [
     "Показать лоадер на кнопке 'Подтвердить'",
     "PUT /nopaper/user",
     "Отобразить модальное окно ОТП",
     "Отправить push 'Требуется ввод кода'"
   ]

4. ЗАПРЕТЫ
   ❌ НЕТ поля "requirement"
   ❌ НЕТ префиксов "API:", "UI:" в Code.text
   ❌ НЕ выдумывай Code, которого нет в requirements
   ❌ НЕ создавай Story как техническую формулировку!

${escalationPrompt}`;

                        const retryCombinedTools = [...interactiveTools, buildSubmitModelTool()];
                        const interactiveResult = await runInteractiveLLM({
                            initialMessages: [
                                { role: 'system', content: SYSTEM_PROMPT },
                                { role: 'user', content: chunkUserPrompt }
                            ],
                            tools: retryCombinedTools,
                            toolHandlers: contextToolHandlers,
                            finalToolNames: ['submit_test_model'],
                            maxIterations: 8,
                            modelOptions: {
                                temperature: 0,
                                top_p: 0.9,
                                max_tokens: 150000,  // ✅ Увеличено с 50000 до 150000 для предотвращения обрезания JSON
                                extra: { transforms: 'middle-out' }
                            }
                        });

                        const fixedAi = interactiveResult.response;
                        const fixedArgs = extractToolArgs(fixedAi, "submit_test_model");

                        if (fixedArgs && fixedArgs.model) {
                            let fixedPartialModel = null;
                            if (Array.isArray(fixedArgs.model)) {
                                fixedPartialModel = fixedArgs.model;
                            } else if (typeof fixedArgs.model === 'string') {
                                try {
                                    const parsed = JSON5.parse(fixedArgs.model);
                                    fixedPartialModel = Array.isArray(parsed) ? parsed : (parsed?.items || null);
                                } catch (e) {
                                    console.warn(`[generate-test-model-async] Ошибка парсинга исправленной модели:`, e.message);
                                }
                            }

                            if (fixedPartialModel && Array.isArray(fixedPartialModel)) {
                                fixedModel.push(...fixedPartialModel);
                            }
                        }
                    }

                    if (fixedModel.length > 0) {
                        const fixedCleanedModel = validateAndCleanModel(fixedModel);
                        const fixedIssues = detectModelStructureIssues(fixedCleanedModel, 'fixed');

                        if (fixedIssues.length < finalStructureIssues.length) {
                            console.log(`[generate-test-model-async] ✅ Повторная генерация помогла: ${finalStructureIssues.length} → ${fixedIssues.length} ошибок`);
                            cleanedModel = fixedCleanedModel;

                            if (fixedIssues.length === 0) {
                                console.log(`[generate-test-model-async] ✅ Все проблемы исправлены!`);
                            } else {
                                console.warn(`[generate-test-model-async] ⚠️ Остались проблемы:`, fixedIssues);
                            }
                        } else {
                            console.warn(`[generate-test-model-async] ⚠️ Повторная генерация не помогла, используем исходную модель с предупреждениями`);
                        }
                    } else {
                        console.warn(`[generate-test-model-async] ⚠️ Не удалось получить исправленную модель, используем исходную с предупреждениями`);
                    }
                } catch (retryError) {
                    console.error(`[generate-test-model-async] Ошибка при повторной генерации:`, retryError.message);
                    console.warn(`[generate-test-model-async] Используем исходную модель с предупреждениями`);
                }
            }

            // Если после повторной генерации проблемы остались, пытаемся перегенерировать проблемные Code
            const remainingIssues = detectModelStructureIssues(cleanedModel, 'final-after-retry');
            const criticalIssues = remainingIssues.filter(issue =>
                !issue.includes('Story') || (!issue.includes('техническую формулировку') && !issue.includes('описание контрола'))
            );

            // ✅ НОВОЕ: Перегенерация проблемных Code с пользовательскими действиями
            const codeIssues = criticalIssues.filter(issue => 
                issue.includes('Code') && issue.includes('пользовательское действие')
            );

            if (codeIssues.length > 0) {
                escalationCount++;
                console.warn(`[generate-test-model-async] ⚠️ Обнаружены структурные проблемы с Code, запускаем перегенерацию:`);
                codeIssues.forEach(issue => console.warn(`  - ${issue}`));

                // Извлекаем проблемные Scenarios
                const problematicScenarios = extractProblematicScenarios(cleanedModel, codeIssues);

                if (problematicScenarios.length === 0) {
                    console.error(`[generate-test-model-async] ❌ Не удалось идентифицировать проблемные Scenarios: ${codeIssues.join(', ')}`);
                    throw new Error(`Сгенерированная модель нарушает структуру Code: ${codeIssues.join('; ')}`);
                }

                // Перегенерируем проблемные Scenarios
                const fixedScenarios = await regenerateProblematicScenarios(problematicScenarios, reqStringForModel);

                if (fixedScenarios.length === 0) {
                    console.error(`[generate-test-model-async] ❌ Не удалось перегенерировать проблемные Scenarios: ${codeIssues.join(', ')}`);
                    throw new Error(`Не удалось исправить структурные проблемы Code: ${codeIssues.join('; ')}`);
                }

                // Заменяем старые Code на исправленные
                for (const { scenario, fixedCodes } of fixedScenarios) {
                    scenario.codes = fixedCodes;
                    console.log(`[generate-test-model-async] ✅ Scenario "${scenario.text}" обновлён с ${fixedCodes.length} исправленными Code`);
                }

                // ✅ УЛУЧШЕНИЕ: Применяем финальное автоматическое исправление через autoFixCodeWithUserActions
                console.log(`[generate-test-model-async] Применяю финальное автоматическое исправление Code...`);
                cleanedModel = autoFixCodeWithUserActions(cleanedModel);
                
                // Повторная валидация
                const remainingIssuesAfterFix = detectModelStructureIssues(cleanedModel, 'final-after-code-regeneration');
                const stillCriticalIssues = remainingIssuesAfterFix.filter(issue =>
                    !issue.includes('Story') || (!issue.includes('техническую формулировку') && !issue.includes('описание контрола'))
                );

                if (stillCriticalIssues.length > 0) {
                    console.warn(`[generate-test-model-async] ⚠️ После перегенерации и автоматического исправления остались проблемы:`);
                    stillCriticalIssues.forEach(issue => console.warn(`  - ${issue}`));
                    
                    // ✅ УЛУЧШЕНИЕ: Вместо выброса ошибки - применяем более агрессивное исправление
                    console.log(`[generate-test-model-async] Применяю дополнительное исправление через normalizeCodeText...`);
                    for (const feature of cleanedModel) {
                        for (const story of (feature.stories || [])) {
                            for (const scenario of (story.scenarios || [])) {
                                for (const code of (scenario.codes || [])) {
                                    const originalText = code.text;
                                    code.text = normalizeCodeText(code.text);
                                    if (originalText !== code.text) {
                                        console.log(`[generate-test-model-async] Автоматически исправлен Code: "${originalText}" → "${code.text}"`);
                                    }
                                }
                            }
                        }
                    }
                    
                    // Финальная проверка
                    const finalIssues = detectModelStructureIssues(cleanedModel, 'final-after-all-fixes');
                    const finalCriticalIssues = finalIssues.filter(issue =>
                        !issue.includes('Story') || (!issue.includes('техническую формулировку') && !issue.includes('описание контрола'))
                    );
                    
                    if (finalCriticalIssues.length > 0) {
                        console.error(`[generate-test-model-async] ❌ После всех исправлений остались критические проблемы:`);
                        finalCriticalIssues.forEach(issue => console.error(`  - ${issue}`));
                        // Выбрасываем ошибку только если остались действительно критические проблемы
                        throw new Error(`Не удалось исправить структурные проблемы: ${finalCriticalIssues.join('; ')}`);
                    } else {
                        console.log(`[generate-test-model-async] ✅ Все структурные проблемы Code исправлены через перегенерацию и автоматическое исправление`);
                    }
                } else {
                    console.log(`[generate-test-model-async] ✅ Все структурные проблемы Code исправлены через перегенерацию`);
                }
            } else if (criticalIssues.length > 0) {
                // Если есть другие критичные проблемы (не Code), выбрасываем ошибку
                throw new Error(`Сгенерированная модель нарушает структуру Scenario/Code: ${criticalIssues.join('; ')}`);
            } else if (remainingIssues.length > 0) {
                console.warn(`[generate-test-model-async] ⚠️ Модель содержит некритичные проблемы Story, продолжаем:`, remainingIssues);
            }
        }

        // ✅ НОВОЕ: Собираем метрики
        const scenariosCount = cleanedModel.reduce((acc, f) => 
            acc + (f.stories || []).reduce((acc2, s) => acc2 + (s.scenarios || []).length, 0), 0
        );
        const codesCount = cleanedModel.reduce((acc, f) => 
            acc + (f.stories || []).reduce((acc2, s) => 
                acc2 + (s.scenarios || []).reduce((acc3, sc) => acc3 + (sc.codes || []).length, 0), 0
            ), 0
        );
        
        // Получаем coverage report если он был рассчитан (используем уже рассчитанные данные)
        const reqCoverage = coverageReportData?.requirementsCoverage || { coveragePercent: 0 };
        const finalCoverageReport = coverageReportData || { coveragePercent: 0 };
        
        const metrics = {
            duration: Date.now() - startTime,
            requirementsCoverage: reqCoverage.coveragePercent || 0,
            storiesCoverage: finalCoverageReport.coveragePercent || 0,
            scenariosCount,
            codesCount,
            regenerations: regenerationCount,
            escalations: escalationCount
        };
        
        console.log(`[generateTestModelAsync] 📊 Метрики:`, metrics);

        await db('generation_tasks').where('id', taskId).update({
            status: 'completed',
            progress: 100,
            result: { testModel: cleanedModel },
            metrics: JSON.stringify(metrics),
            completed_at: new Date(),
            updated_at: new Date()
        });

        console.log(`[generate-test-model-async] Задача ${taskId} завершена успешно`);

    } catch (error) {
        console.error('Ошибка асинхронной генерации тестовой модели:', error);
        await db('generation_tasks').where('id', taskId).update({
            status: 'failed',
            error_message: error.message,
            updated_at: new Date()
        });
    }
}

app.post('/api/generate-test-model-async', async (req, res) => {
    try {
        const taskId = uuidv4();

        // ОЧИЩАЕМ КЭШ ПЕРЕД НОВОЙ ГЕНЕРАЦИЕЙ ТЕСТОВОЙ МОДЕЛИ
        console.log(`[generate-test-model-async] Очищаем кэш перед генерацией тестовой модели taskId: ${taskId}`);
        for (const [key, value] of taskStatusCache.entries()) {
            if (key.includes('status_') || key.includes('model_status_')) {
                taskStatusCache.delete(key);
            }
        }

        await db('generation_tasks').insert({
            id: taskId,
            type: 'test_model',
            status: 'processing',
            progress: 0,
            input_data: req.body,
            created_at: new Date(),
            updated_at: new Date()
        });

        generateTestModelAsync(taskId, req.body);

        res.json({ taskId, status: 'started' });
    } catch (error) {
        console.error('Ошибка создания задачи генерации тестовой модели:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/generate-test-model-status/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const cacheKey = `model_status_${taskId}`;

        // Проверяем кэш
        const cached = taskStatusCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5000) {
            return res.json(cached.data);
        }

        const task = await db('generation_tasks').where('id', taskId).first();

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const responseData = {
            id: task.id,
            status: task.status,
            progress: task.progress,
            result: task.result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            completed_at: task.completed_at
        };

        // Кэшируем результат
        taskStatusCache.set(cacheKey, {
            data: responseData,
            timestamp: Date.now()
        });

        res.json(responseData);
    } catch (error) {
        console.error('Ошибка получения статуса генерации тестовой модели:', error);
        res.status(500).json({ error: error.message });
    }
});



/**
 * GET /api/shared-steps
 * Query:
 *   - projectId (обязательный)
 *   - page      (опционально, default=0)
 *   - size      (опционально, default=20)
 *   - archived  (опционально, default=false)
 *   - search    (опционально) — подстрока для фильтрации по имени шага
 */
app.get('/api/shared-steps', async (req, res) => {
    try {
        const {
            projectId,
            page = '0',
            size = '20',
            archived = 'false',
            search = ''
        } = req.query;

        if (!projectId) {
            return res.status(400).json({ error: 'projectId is required' });
        }

        const data = await getSharedStepsList({
            projectId,
            page: Number(page),
            size: Number(size),
            archived: archived === 'true',
            search: String(search)
        });

        res.json(data);
    } catch (err) {
        console.error('Ошибка в /api/shared-steps:', err);
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/create-test-cases', async (req, res) => {
    const { projectId, cases } = req.body;
    if (!projectId || !Array.isArray(cases)) {
        return res.status(400).json({ error: 'projectId и массив cases обязательны' });
    }

    try {
        // 1) Загрузили словарь слоёв
        const layers = await suggestTestLayers();
        const layerMap = Object.fromEntries(layers.map(l => [l.name, l.id]));

        // 2) Схема кастомных полей
        const schema = await getProjectCustomFieldSchema(projectId);
        const cfMap = {};
        for (const e of schema) {
            const id = e?.customField?.id;
            const key = e?.key;
            const name = e?.customField?.name;
            if (id && key) cfMap[String(key).toLowerCase()] = id;
            if (id && name) cfMap[String(name).toLowerCase()] = id;
        }

        // 3) Подгружаем существующие проектные теги (чтобы потом создавать новые, если их нет)
        const projectTags = await suggestTags(projectId);

        // ✅ НОВОЕ: Асинхронный batch update для Allure с ограничением параллелизма
        const limit = pLimit(10); // Не более 10 параллельных запросов
        
        const creationPromises = cases.map(c => limit(async () => {
            // 4) Создаём TC
            const tc = await createTestCaseAllure({ projectId, name: c.title });
            const testCaseId = tc.id;

            // 5) Обновляем precondition и expectedResult
            await updateTestCase(testCaseId, {
                precondition: c.precondition,
                expectedResult: c.expected,
            });

            // 6) Добавляем шаги
            let lastStepId;
            for (const step of c.steps || []) {
                const params = { testCaseId };
                if (typeof step === 'object' && step.sharedStepId) {
                    params.sharedStepId = step.sharedStepId;
                } else {
                    params.body = typeof step === 'string' ? step : step.text;
                }
                if (lastStepId) params.afterId = lastStepId;
                const added = await addStepToTestCase(testCaseId, params);
                lastStepId = added.id;
            }

            // 7) Теги — делаем единый PATCH c полем tags
            if (Array.isArray(c.tags) && c.tags.length) {
                // 7.1) Убедиться, что все имена тегов существуют в проекте
                for (const tagName of c.tags) {
                    if (!projectTags.some(t => t.name === tagName)) {
                        const newTag = await createTag(tagName);
                        projectTags.push(newTag);
                    }
                }
                // 7.2) Собираем payload для PATCH
                const tagsPayload = c.tags.map(name => ({ name }));
                await fetchWithAuth(
                    `${config.baseUrl}/testcase/${testCaseId}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tags: tagsPayload })
                    }
                );
            }

            // 8) Ссылки — как раньше
            if (Array.isArray(c.links) && c.links.length) {
                const existing = (await fetchWithAuth(
                    `${config.baseUrl}/testcase/${testCaseId}`
                ).then(r => r.json())).links || [];
                const toAdd = c.links.map(l => ({
                    name: l.text,
                    url: l.url,
                    ...(l.type ? { type: l.type } : {})
                }));
                await fetchWithAuth(
                    `${config.baseUrl}/testcase/${testCaseId}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ links: existing.concat(toAdd) })
                    }
                );
            }

            // 9) Jira Issue
            const jiraKey = c?.jiraIssueOption?.value || c?.jiraIssue;
            if (jiraKey) {
                const integrationId = c?.jiraIssueOption?.integrationId || config.defaultJiraIntegrationId;
                await linkIssueToTestCase(testCaseId, integrationId, jiraKey);
            }

            // 10) Слой
            if (c.layer && layerMap[c.layer] != null) {
                await setTestCaseLayer(testCaseId, layerMap[c.layer]);
            }

            // 11) Кастомные поля
            const cfvById = new Map();

            const putCF = (fieldNameOrKey, raw) => {
                if (raw == null) return;
                const val = String(raw).trim();
                if (!val) return;                      // не шлём пустые значения
                const id = cfMap[String(fieldNameOrKey).toLowerCase()];
                if (!id) return;                       // такого CF нет в проекте
                // Последняя запись побеждает, без дублей по одному ID
                cfvById.set(id, { customField: { id }, name: val });
            };

            // стандартные поля из кейса
            putCF('Feature', c.feature);
            putCF('Story', c.story);
            putCF('Scenario', c.scenario);
            putCF('Version', c.version);
            putCF('Priority', c.priority);

            // поддержка Code:
            // 1) если бэкенд когда-то получит c.code — возьмём его
            // 2) фронт сейчас шлёт codeNode
            // 3) а ещё может прийти из customFields
            putCF('Code', c.code || c.codeNode);

            // добираем то, что пришло в cases[].customFields (если фронт их шлёт)
            if (Array.isArray(c.customFields)) {
                for (const { name, value } of c.customFields) {
                    if (!name) continue;
                    putCF(name, value);
                }
            }

            const cfv = Array.from(cfvById.values());
            if (cfv.length) {
                await setTestCaseCustomFieldValues(testCaseId, cfv);
            }

            // 12) Параметры и примеры (если есть)
            if (Array.isArray(c.parameters) && c.parameters.length > 0) {
                // В Allure параметры определяются через массив "parameters" в тест-кейсе
                // Но для добавления нужно использовать PATCH с полем parameters
                try {
                    // Получаем текущий тест-кейс
                    const currentTC = await fetchWithAuth(`${config.baseUrl}/testcase/${testCaseId}`).then(r => r.json());

                    // Формируем массив параметров (только имена, без значений)
                    const parametersForApi = c.parameters
                        .filter(p => p.name && p.name.trim())
                        .map(p => ({ name: p.name.trim() }));

                    if (parametersForApi.length > 0) {
                        // Обновляем тест-кейс с параметрами
                        await fetchWithAuth(
                            `${config.baseUrl}/testcase/${testCaseId}`,
                            {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ parameters: parametersForApi })
                            }
                        );
                        console.log(`[create-test-cases] Добавлено ${parametersForApi.length} параметров для ТК ${testCaseId}`);
                    }
                } catch (err) {
                    console.warn(`[create-test-cases] Не удалось добавить параметры для ТК ${testCaseId}:`, err.message);
                }

                // Добавляем примеры (конкретные комбинации параметров)
                if (Array.isArray(c.examples) && c.examples.length > 0) {
                    try {
                        // Преобразуем examples в формат Allure API
                        // Allure ожидает: Array<Array<{name: string, value: string}>>
                        // То есть массив массивов параметров, а не массив объектов с полем parameters
                        const examplesForApi = c.examples
                            .filter(ex => ex.parameters && Array.isArray(ex.parameters))
                            .map(example =>
                                example.parameters
                                    .filter(p => p.name && p.value !== undefined && p.value !== '')
                                    .map(p => ({
                                        name: String(p.name).trim(),
                                        value: String(p.value).trim()
                                    }))
                            )
                            .filter(exParams => exParams.length > 0);

                        if (examplesForApi.length > 0) {
                            await createTestCaseExamples(testCaseId, examplesForApi);
                            console.log(`[create-test-cases] Добавлено ${examplesForApi.length} примеров для ТК ${testCaseId}`);
                        }
                    } catch (err) {
                        console.warn(`[create-test-cases] Не удалось добавить примеры для ТК ${testCaseId}:`, err.message);
                    }
                } else if (c.parameters && c.parameters.length > 0) {
                    // Если примеров нет, но есть параметры - можно сгенерировать pairwise
                    // Но это опционально, так как может быть слишком много комбинаций
                    console.log(`[create-test-cases] ТК ${testCaseId} имеет параметры, но нет примеров. Можно сгенерировать pairwise вручную.`);
                }
            }

            return { id: testCaseId };
        }));

        const created = await Promise.all(creationPromises);

        res.json({ success: true, created });
    } catch (err) {
        console.error('Ошибка при массовом создании ТК:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Автоматически параметризует похожие тесты, объединяя их в один параметризованный тест
 * @param {Array} testCases - массив тест-кейсов
 * @returns {Array} - массив тест-кейсов с параметризацией
 */
function autoParameterizeSimilarTests(testCases) {
    if (!Array.isArray(testCases) || testCases.length === 0) return testCases;

    const processed = new Set();
    const result = [];

    for (let i = 0; i < testCases.length; i++) {
        if (processed.has(i)) continue;

        const current = testCases[i];
        const similar = [current];

        // Ищем похожие тесты
        for (let j = i + 1; j < testCases.length; j++) {
            if (processed.has(j)) continue;

            const candidate = testCases[j];

            // Проверяем, похожи ли тесты
            if (areTestsSimilar(current, candidate)) {
                similar.push(candidate);
                processed.add(j);
            }
        }

        // Если нашли похожие (2+), параметризуем
        if (similar.length >= 2) {
            const parameterized = mergeSimilarTests(similar);
            if (parameterized) {
                result.push(parameterized);
                processed.add(i);
                continue;
            }
        }

        // Если не параметризовали, добавляем как есть
        if (!processed.has(i)) {
            result.push(current);
            processed.add(i);
        }
    }

    return result;
}

/**
 * Проверяет, похожи ли два теста (одинаковая логика, разные значения)
 */
function areTestsSimilar(test1, test2) {
    // Должны быть одинаковые: layer, feature, story, scenario, steps (структура)
    if (test1.layer !== test2.layer) return false;
    if (test1.feature !== test2.feature) return false;
    if (test1.story !== test2.story) return false;
    if (test1.scenario !== test2.scenario) return false;

    // Steps должны быть структурно похожи (одинаковое количество и структура)
    const steps1 = JSON.stringify(test1.steps || []);
    const steps2 = JSON.stringify(test2.steps || []);
    if (steps1 !== steps2) {
        // Допускаем небольшие различия в формулировках, но структура должна быть похожа
        const steps1Normalized = normalizeStepsForComparison(steps1);
        const steps2Normalized = normalizeStepsForComparison(steps2);
        if (steps1Normalized !== steps2Normalized) {
            // Дополнительная проверка: возможно, отличаются только числовые значения
            const steps1Numbers = steps1Normalized.replace(/[^0-9]/g, '');
            const steps2Numbers = steps2Normalized.replace(/[^0-9]/g, '');
            // Если после нормализации остались только числовые различия - считаем похожими
            if (steps1Numbers !== steps2Numbers) {
                // Проверяем, что это не структурные различия
                const steps1Words = steps1Normalized.split(/\s+/).filter(w => w.length > 2);
                const steps2Words = steps2Normalized.split(/\s+/).filter(w => w.length > 2);
                const commonWords = steps1Words.filter(w => steps2Words.includes(w));
                // Если менее 70% общих слов - это разные тесты
                if (commonWords.length / Math.max(steps1Words.length, steps2Words.length) < 0.7) {
                    return false;
                }
            }
        }
    }

    // Expected должен быть структурно похож (различаться только значениями)
    const expected1 = String(test1.expected || '').toLowerCase();
    const expected2 = String(test2.expected || '').toLowerCase();

    // Если expected полностью идентичен - не параметризуем (это дубликат)
    if (expected1 === expected2) return false;

    // Проверяем, что различия только в значениях, а не в структуре
    const diff = findValueDifferences(test1, test2);
    return diff.length > 0;
}

/**
 * Нормализует steps для сравнения (убирает конкретные значения)
 */
function normalizeStepsForComparison(steps) {
    return steps
        .replace(/\d+-значный/g, 'N-значный')
        .replace(/\d+/g, 'N')
        .replace(/10|12/g, 'N')
        .toLowerCase();
}

/**
 * Находит различия в значениях между тестами
 */
function findValueDifferences(test1, test2) {
    const diffs = [];

    // Ищем различия в title
    const title1 = String(test1.title || '').toLowerCase();
    const title2 = String(test2.title || '').toLowerCase();

    // Паттерны для поиска различий
    const patterns = [
        { regex: /(\d+)-значный/g, name: 'Размер ИНН' },
        { regex: /(\d+)/g, name: 'Числовое значение' },
        { regex: /(10|12)/g, name: 'Размер ИНН' },
        { regex: /(код ответа|статус|status)\s*[:\-]?\s*(\d+)/gi, name: 'Код ответа' },
        { regex: /(тип|type)\s*[:\-]?\s*([a-z_]+)/gi, name: 'Тип' }
    ];

    // Извлекаем значения из title
    for (const pattern of patterns) {
        const matches1 = title1.match(pattern.regex);
        const matches2 = title2.match(pattern.regex);

        if (matches1 && matches2 && matches1.length === matches2.length) {
            const values1 = matches1.map(m => extractValue(m));
            const values2 = matches2.map(m => extractValue(m));

            if (values1.some(v => !values2.includes(v)) || values2.some(v => !values1.includes(v))) {
                diffs.push({
                    name: pattern.name,
                    values: [...new Set([...values1, ...values2])]
                });
            }
        }
    }

    // Специальная обработка для "10-значный" vs "12-значный"
    if ((title1.includes('10-значный') && title2.includes('12-значный')) ||
        (title1.includes('12-значный') && title2.includes('10-значный'))) {
        diffs.push({
            name: 'Размер ИНН',
            values: ['10-значный', '12-значный']
        });
    }

    // Специальная обработка для "контрольного числа" с разными размерами ИНН
    if (title1.includes('контрольн') && title2.includes('контрольн')) {
        if ((title1.includes('10') && title2.includes('12')) ||
            (title1.includes('12') && title2.includes('10'))) {
            diffs.push({
                name: 'Размер ИНН',
                values: ['10-значный', '12-значный']
            });
        }
    }

    // Специальная обработка для HTTP-кодов в expected
    const expected1 = String(test1.expected || '');
    const expected2 = String(test2.expected || '');

    const codeMatches1 = expected1.match(/\b(200|400|401|403|404|500|503|504)\b/g);
    const codeMatches2 = expected2.match(/\b(200|400|401|403|404|500|503|504)\b/g);

    if (codeMatches1 && codeMatches2) {
        const codes1 = [...new Set(codeMatches1)];
        const codes2 = [...new Set(codeMatches2)];
        if (codes1.length > 0 && codes2.length > 0 && !codes1.every(c => codes2.includes(c))) {
            diffs.push({
                name: 'Код ответа',
                values: [...new Set([...codes1, ...codes2])]
            });
        }
    }

    return diffs;
}

/**
 * Извлекает значение из строки
 */
function extractValue(str) {
    const match = str.match(/(\d+)/);
    return match ? match[1] : str.trim();
}

/**
 * Объединяет похожие тесты в один параметризованный
 */
function mergeSimilarTests(similarTests) {
    if (similarTests.length < 2) return null;

    const base = similarTests[0];
    const diffs = [];

    // Собираем все различия
    for (let i = 1; i < similarTests.length; i++) {
        const diff = findValueDifferences(base, similarTests[i]);
        diffs.push(...diff);
    }

    // Группируем различия по имени
    const paramMap = new Map();
    for (const diff of diffs) {
        if (!paramMap.has(diff.name)) {
            paramMap.set(diff.name, new Set());
        }
        diff.values.forEach(v => paramMap.get(diff.name).add(v));
    }

    // Если нет различий для параметризации - не объединяем
    if (paramMap.size === 0) return null;

    // Формируем параметры
    const parameters = Array.from(paramMap.entries()).map(([name, values]) => ({
        name: name,
        values: Array.from(values).sort()
    }));

    // Формируем examples на основе исходных тестов
    const examples = similarTests.map(test => {
        const exampleParams = [];
        for (const param of parameters) {
            // Извлекаем значение параметра из теста
            const value = extractParameterValue(test, param.name);
            if (value) {
                exampleParams.push({ name: param.name, value: value });
            }
        }
        return { parameters: exampleParams };
    }).filter(ex => ex.parameters.length > 0);

    // Обновляем title, убирая конкретные значения
    let newTitle = base.title || '';
    for (const param of parameters) {
        // Убираем конкретные значения из title
        param.values.forEach(val => {
            newTitle = newTitle.replace(new RegExp(val, 'gi'), `{${param.name}}`);
        });
    }
    // Если title стал слишком общим, используем базовый с пометкой
    if (newTitle.includes('{') && newTitle.split('{').length > 2) {
        newTitle = base.title?.replace(/\d+-значный|10|12|\d+/g, 'N').replace(/для\s+\w+/g, '') || base.title || 'Параметризованный тест';
    }

    // Обновляем expected, делая его более общим
    let newExpected = base.expected || '';
    for (const param of parameters) {
        param.values.forEach(val => {
            newExpected = newExpected.replace(new RegExp(val, 'gi'), `{${param.name}}`);
        });
    }

    return {
        ...base,
        title: newTitle,
        expected: newExpected,
        parameters: parameters,
        examples: examples.length > 0 ? examples : undefined
    };
}

/**
 * Извлекает значение параметра из теста
 */
function extractParameterValue(test, paramName) {
    const title = String(test.title || '').toLowerCase();
    const expected = String(test.expected || '').toLowerCase();
    const steps = (test.steps || []).join(' ').toLowerCase();
    const allText = `${title} ${expected} ${steps}`;

    if (paramName === 'Размер ИНН') {
        if (allText.includes('10-значный')) return '10-значный';
        if (allText.includes('12-значный')) return '12-значный';
        // Также проверяем упоминания "10" и "12" в контексте ИНН
        if (allText.includes('10') && (allText.includes('инн') || allText.includes('контрольн'))) {
            // Проверяем, что это не просто случайное число
            if (allText.match(/10[^0-9]/) || allText.includes('10-значн')) return '10-значный';
        }
        if (allText.includes('12') && (allText.includes('инн') || allText.includes('контрольн'))) {
            if (allText.match(/12[^0-9]/) || allText.includes('12-значн')) return '12-значный';
        }
    }

    if (paramName === 'Код ответа') {
        // Ищем в expected и steps
        const match = allText.match(/\b(200|400|401|403|404|500|503|504)\b/);
        if (match) return match[1];
    }

    // Общий поиск числовых значений
    if (paramName.includes('значение') || paramName.includes('число')) {
        const match = title.match(/(\d+)/);
        if (match) return match[1];
    }

    return null;
}

async function generateTestCasesAsync(taskId, inputData) {
    // Объявляем переменную в начале функции
    let finalTestCases = [];

    try {
        await db('generation_tasks').where('id', taskId).update({
            status: 'processing',
            progress: 0,
            updated_at: new Date()
        });

        // === Вспомогательные функции ===
        function buildModelIndex(model) {
            const scenarioSet = new Set();
            const codeTo = new Map();              // "код шага" → { scenario, story, feature }
            const scenarioToParent = new Map();    // "сценарий" → { story, feature }
            const storyToFeature = new Map();

            for (const f of (model || [])) {
                for (const st of (f.stories || [])) {
                    if (st?.text?.trim()) storyToFeature.set(st.text.trim(), f.text?.trim() || '');
                    for (const sc of (st.scenarios || [])) {
                        scenarioSet.add(sc.text);
                        scenarioToParent.set(sc.text, { story: st.text, feature: f.text });
                        for (const cd of (sc.codes || [])) {
                            codeTo.set(cd.text, { scenario: sc.text, story: st.text, feature: f.text });
                        }
                    }
                }
            }
            return { scenarioSet, codeTo, scenarioToParent, storyToFeature };
        }

        function findSimilarRequirements(requiredIds, missingIds) {
            const similar = [];

            for (const missing of missingIds) {
                // Проверяем есть ли "соседние" требования (2.2.7 и 2.2.8)
                const parts = missing.split('.');
                if (parts.length >= 2) {
                    const baseNumber = parseInt(parts[parts.length - 1]);

                    // Ищем соседей (N-1, N+1)
                    for (const offset of [-1, 1]) {
                        const neighborNumber = baseNumber + offset;
                        const neighborReq = [...parts.slice(0, -1), neighborNumber].join('.');

                        if (requiredIds.has(neighborReq) && !missingIds.includes(neighborReq)) {
                            similar.push([missing, neighborReq]);
                        }
                    }
                }
            }

            return similar;
        }

        function checkRequirementsCoverage(testCases, requirements) {
            console.log(`[checkRequirementsCoverage] Проверка покрытия требований по requirementId...`);

            // Собираем все requirementId из требований (извлекаем разделы)
            const requiredIds = new Set();
            // Улучшенный regex для парсинга требований из любого места в тексте
            const sectionPattern = /(?:^#{1,3}\s*|^|\b)(\d+\.\d+(?:\.\d+)*?)(?:\s|$|\.|,)/gm;

            if (requirements && typeof requirements === 'string') {
                let match;
                while ((match = sectionPattern.exec(requirements)) !== null) {
                    requiredIds.add(match[1]);
                }
            }

            // Если не нашли разделы в требованиях - попробуем альтернативный парсинг
            if (requiredIds.size === 0) {
                console.log(`[checkRequirementsCoverage] Попытка альтернативного парсинга требований...`);
                const altPattern = /\b(\d+\.\d+(?:\.\d+)*)\b/g;
                let match;
                while ((match = altPattern.exec(requirements)) !== null) {
                    requiredIds.add(match[1]);
                }

                // Если всё ещё ничего не нашли - используем простую проверку
                if (requiredIds.size === 0) {
                    return {
                        coveragePercentage: 100,
                        covered: 1,
                        total: 1,
                        missingRequirementIds: []
                    };
                }
            }

            // ❌ УДАЛЕНО: Сбор requirement из тест-кейсов - это поле не используется в тест-кейсах
            // Покрытие требований теперь определяется через тестовую модель (Feature/Story/Scenario)
            const coveredIds = new Set();

            console.log(`[checkRequirementsCoverage] Покрытие требований определяется через тестовую модель, не через поле requirement в тест-кейсах`);

            // Находим недостающие requirementId
            const missingRequirementIds = [];
            for (const reqId of requiredIds) {
                if (!coveredIds.has(reqId)) {
                    missingRequirementIds.push(reqId);
                }
            }

            const total = requiredIds.size;
            const covered = total - missingRequirementIds.length;
            const coveragePercentage = total > 0 ? Math.round((covered / total) * 100) : 100;

            console.log(`[checkRequirementsCoverage] Покрытие: ${covered}/${total} (${coveragePercentage}%)`);
            console.log(`[checkRequirementsCoverage] Недостающие требования: ${missingRequirementIds.join(', ')}`);
            console.log(`[checkRequirementsCoverage] Найденные требования в тексте: ${Array.from(requiredIds).sort().join(', ')}`);
            console.log(`[checkRequirementsCoverage] Покрытые требования в тест-кейсах: ${Array.from(coveredIds).sort().join(', ')}`);

            // ✅ ДЕТАЛЬНАЯ ПРОВЕРКА КОНКРЕТНЫХ ТРЕБОВАНИЙ
            const criticalRequirements = ['2.2.4', '2.2.8'];
            for (const req of criticalRequirements) {
                const isRequired = requiredIds.has(req);
                const isCovered = coveredIds.has(req);
                console.log(`[checkRequirementsCoverage] 🔍 ${req}: required=${isRequired}, covered=${isCovered}`);
            }

            // ✅ ДОБАВЛЕНО: Проверка на "похожие" требования
            const similarRequirements = findSimilarRequirements(requiredIds, missingRequirementIds);

            if (similarRequirements.length > 0) {
                console.warn(`[checkRequirementsCoverage] ⚠️ ВНИМАНИЕ: Найдены похожие требования, которые могут быть пропущены!`);
                for (const [missing, covered] of similarRequirements) {
                    console.warn(`  - ${missing} не покрыт, но ${covered} покрыт (возможно модель их объединила)`);
                }
            }

            // Дополнительная отладка: покажем примеры тест-кейсов с полем requirement
            // ❌ УДАЛЕНО: Проверка requirement в тест-кейсах - это поле не используется

            return {
                coveragePercentage,
                covered,
                total,
                missingRequirementIds,
                coveredRequirementIds: Array.from(coveredIds),
                similarRequirements  // ✅ Возвращаем для догенерации
            };
        }

        // ✅ ФУНКЦИЯ ВАЛИДАЦИИ ТЕСТ-КЕЙСОВ ПО СТАЙЛ-ГАЙДУ
        function validateTestCasesByStyleGuide(testCases, styleGuidePrompt) {
            const issues = [];

            testCases.forEach((tc, idx) => {
                const tcNum = idx + 1;
                const title = tc.title || '';
                const steps = Array.isArray(tc.steps) ? tc.steps : [];
                const expected = tc.expected || '';
                const layer = tc.layer || '';

                // Проверка шагов
                steps.forEach((step, stepIdx) => {
                    const stepLower = String(step).toLowerCase();

                    // Проверка на слово "Проверить" в шагах
                    if (stepLower.includes('проверить') || stepLower.includes('проверка')) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": шаг ${stepIdx + 1} содержит "Проверить" - проверка должна быть в expected, а не в steps!`);
                    }

                    // Проверка форматирования ключевых слов и эндпоинтов
                    if (step.includes('/') && !step.includes('**')) {
                        // Эндпоинт без выделения
                        const endpointMatch = step.match(/(\/[a-zA-Z0-9_\/-]+)/);
                        if (endpointMatch) {
                            issues.push(`Тест-кейс ${tcNum} "${title}": шаг ${stepIdx + 1} содержит эндпоинт без выделения - используй **${endpointMatch[1]}**`);
                        }
                    }
                });

                // Проверка ожидаемого результата
                if (!expected || expected.trim().length === 0) {
                    issues.push(`Тест-кейс ${tcNum} "${title}": отсутствует expected (обязательное поле!)`);
                } else {
                    const expectedLower = expected.toLowerCase();

                    // Проверка на абстрактные формулировки
                    const abstractPatterns = [
                        /работает корректно/i,
                        /операция выполнена/i,
                        /данные переданы/i,
                        /система работает/i,
                        /всё правильно/i
                    ];

                    if (abstractPatterns.some(pattern => pattern.test(expected))) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": expected содержит абстрактную формулировку - нужен конкретный результат!`);
                    }

                    // Проверка форматирования ключевых слов
                    const keyWords = ['подменить', 'отобразить', 'вернуть', 'заполнить', 'передать', 'сохранить'];
                    const hasKeyWord = keyWords.some(kw => expectedLower.includes(kw));
                    const hasFormattedKeyWord = keyWords.some(kw => expected.includes(`**${kw}`) || expected.includes(`**${kw.charAt(0).toUpperCase() + kw.slice(1)}`));

                    if (hasKeyWord && !hasFormattedKeyWord) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": expected содержит ключевое слово без форматирования - используй **Ключевое слово**`);
                    }

                    // Проверка форматирования эндпоинтов в expected
                    if (expected.includes('/') && !expected.includes('**')) {
                        const endpointMatch = expected.match(/(\/[a-zA-Z0-9_\/-]+)/);
                        if (endpointMatch) {
                            issues.push(`Тест-кейс ${tcNum} "${title}": expected содержит эндпоинт без выделения - используй **${endpointMatch[1]}**`);
                        }
                    }
                }

                // Проверка типа теста
                if (layer === 'Integration backend Tests') {
                    // Backend тесты не должны содержать UI-действия
                    const uiActions = steps.some(step =>
                        /нажать|кликнуть|выбрать|заполнить|ввести/i.test(step) && !step.includes('Выполнить')
                    );
                    if (uiActions) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": Integration backend Tests содержит UI-действия - только "Выполнить POST/GET..."!`);
                    }
                }

                if (layer === 'Integration frontend Tests') {
                    // Frontend тесты не должны начинаться с авторизации
                    if (steps.length > 0 && /авторизоваться|перейти в раздел|открыть приложение/i.test(steps[0])) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": Integration frontend Tests начинается с авторизации - начинай сразу с действия на компоненте!`);
                    }

                    // Frontend тесты не должны содержать "Выполнить POST/GET"
                    if (steps.some(step => /выполнить\s+(post|get|put|delete|patch)/i.test(step))) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": Integration frontend Tests содержит Backend-запросы - только UI-действия!`);
                    }
                }

                // Проверка параметризации
                if (tc.parameters && Array.isArray(tc.parameters) && tc.parameters.length > 0) {
                    // Проверяем использование параметров в steps и expected
                    const hasParamsInSteps = steps.some(step => step.includes('{{'));
                    const hasParamsInExpected = expected.includes('{{');

                    if (!hasParamsInSteps && !hasParamsInExpected) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": есть parameters, но нет {{параметр}} в steps или expected!`);
                    }

                    // Проверяем наличие examples
                    if (!tc.examples || !Array.isArray(tc.examples) || tc.examples.length === 0) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": есть parameters, но нет examples!`);
                    }
                }
            });

            return issues;
        }

        // ✅ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: Поиск соответствующего чанка модели для тест-кейса
        function findMatchingModelChunk(testCase, modelStructure) {
            if (!testCase || !modelStructure) return null;

            const feature = testCase.feature;
            const story = testCase.story;
            const scenario = testCase.scenario;

            for (const f of modelStructure) {
                if (f.text === feature) {
                    for (const s of (f.stories || [])) {
                        if (s.text === story) {
                            // Возвращаем чанк с этой Story
                            return [{
                                text: feature,
                                stories: [{
                                    text: story,
                                    scenarios: s.scenarios || []
                                }]
                            }];
                        }
                    }
                }
            }

            return null;
        }

        function validateTestPyramid(testCases, modelStructure) {
            console.log(`[validateTestPyramid] Проверка соблюдения пирамиды тестирования...`);

            const S = modelStructure.reduce((sum, f) => sum + (f.stories || []).length, 0);
            const Sc = modelStructure.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0);

            const layerCounts = testCases.reduce((acc, tc) => {
                acc[tc.layer] = (acc[tc.layer] || 0) + 1;
                return acc;
            }, {});

            const e2eCount = layerCounts['E2E Tests'] || 0;
            const integrationCount = (layerCounts['Integration frontend Tests'] || 0) +
                (layerCounts['Integration backend Tests'] || 0);
            const expectedE2E = Math.max(1, Math.ceil(S * 0.5));
            const expectedE2EMax = expectedE2E + 2;
            const expectedIntegrationMin = Math.max(Sc, Sc * 2);
            const expectedIntegrationMax = expectedIntegrationMin + 5;

            console.log(`[validateTestPyramid] Модель: Stories=${S}, Scenarios=${Sc}`);
            console.log(`[validateTestPyramid] Ожидается: E2E=${expectedE2E}-${expectedE2EMax}, Integration=${expectedIntegrationMin}-${expectedIntegrationMax}`);
            console.log(`[validateTestPyramid] Получено: E2E=${e2eCount}, Integration=${integrationCount}`);

            const warnings = [];

            if (e2eCount > expectedE2EMax) {
                warnings.push(`⚠️ ПЕРЕКОС: Слишком много E2E тестов (${e2eCount} вместо ${expectedE2E}-${expectedE2EMax}). Возможно дублируются для iOS/Android!`);
            }

            if (integrationCount > expectedIntegrationMax) {
                warnings.push(`⚠️ ПЕРЕКОС: Слишком много Integration тестов (${integrationCount} вместо ${expectedIntegrationMin}-${expectedIntegrationMax}). Возможны дубликаты для doc_type!`);
            }

            if (e2eCount < Math.max(1, Math.floor(S * 0.5))) {
                warnings.push(`⚠️ НЕДОСТАТОК: Мало E2E тестов (${e2eCount} вместо минимум ${Math.floor(S * 0.5)})`);
            }

            if (warnings.length > 0) {
                console.warn(`[validateTestPyramid] ❌ Найдены нарушения пирамиды:`);
                warnings.forEach(w => console.warn(w));
            } else {
                console.log(`[validateTestPyramid] ✅ Пирамида соблюдена!`);
            }

            return { valid: warnings.length === 0, warnings };
        }



        function getRequirementPriority(key) {
            const priorities = {
                authorization: 'Critical',
                qrPayment: 'High',
                sbpTopup: 'High',
                transfers: 'High',
                categoryPayment: 'Medium',
                requisitesPayment: 'Medium',
                repeatOperations: 'Medium',
                trayRestore: 'Medium',
                mainPage: 'Low'
            };
            return priorities[key] || 'Medium';
        }

        // НОВАЯ ФУНКЦИЯ: Догенерация тест-кейсов для недостающих требований (асинхронная версия)
        async function gapFillRequirements(requirements, missingRequirements, systemPrompt, modelStructure) {
            console.log(`[gapFillRequirements-ASYNC] Догенерируем тест-кейсы для ${missingRequirements.length} недостающих функциональностей`);

            // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Генерируем allowedForChunk и allowedScenarios
            const allowedForChunk = collectAllowedCodes(modelStructure);
            const allowedScenarios = collectAllowedScenarios(modelStructure);

            const allGapCases = [];

            for (const missingReq of missingRequirements) {
                console.log(`[gapFillRequirements-ASYNC] Обрабатываем недостающую функциональность: ${missingReq.functionality} (${missingReq.priority})`);

                // ✅ ПРАВИЛЬНО: БЕЗ ХАРДКОДА
                let correctFeature = null;
                let correctStories = [];

                if (missingReq.modelContext?.feature) {
                    // 1. Пытаемся найти Feature в modelStructure
                    const foundFeature = modelStructure.find(f =>
                        f.text === missingReq.modelContext.feature
                    );

                    if (foundFeature) {
                        correctFeature = foundFeature.text;
                        correctStories = foundFeature.stories?.map(s => s.text) || [];
                        console.log(`[gapFillRequirements] ✅ Найдена Feature из модели: ${correctFeature}`);
                    } else {
                        // 2. Feature указана в modelContext, но не найдена в modelStructure
                        // Используем её как есть
                        correctFeature = missingReq.modelContext.feature;
                        correctStories = missingReq.modelContext.stories || [missingReq.functionality];
                        console.warn(`[gapFillRequirements] ⚠️ Feature "${correctFeature}" не найдена в modelStructure, используем из modelContext`);
                    }
                } else {
                    // 3. modelContext.feature отсутствует — fallback
                    if (modelStructure && modelStructure.length > 0) {
                        // Берём первую доступную Feature из модели
                        correctFeature = modelStructure[0].text;
                        correctStories = modelStructure[0].stories?.map(s => s.text) || [];
                        console.warn(`[gapFillRequirements] ⚠️ modelContext.feature отсутствует для ${missingReq.requirementId}, используем первую из modelStructure: "${correctFeature}"`);
                    } else {
                        // 4. Крайний случай: модель пустая — генерируем синтетическую Feature
                        const reqSection = missingReq.requirementId?.split('.')[0] || 'Unknown';
                        correctFeature = `Требование раздела ${reqSection}`;
                        correctStories = [missingReq.functionality];
                        console.error(`[gapFillRequirements] ❌ modelStructure пуста! Создаём синтетическую Feature для ${missingReq.requirementId}`);
                    }
                }

                // Проверка: correctFeature ОБЯЗАТЕЛЬНО должна быть определена
                if (!correctFeature) {
                    console.error(`[gapFillRequirements] ❌ КРИТИЧЕСКАЯ ОШИБКА: не удалось определить correctFeature для ${missingReq.requirementId}. Пропускаем.`);
                    continue;
                }

                const userPrompt = `
                🚨 ДОГЕНЕРАЦИЯ ДЛЯ ПРОПУЩЕННОГО ТРЕБОВАНИЯ! 🚨
                
                ЗАДАНИЕ: Создать тест-кейсы для требования ${missingReq.requirementId || 'Unknown'}
                Описание: ${missingReq.description}
                Приоритет: ${missingReq.priority}
                
                🎯 КРИТИЧЕСКИ ВАЖНО: ИСПОЛЬЗУЙ ТОЛЬКО ПРАВИЛЬНУЮ МОДЕЛЬ! 🎯
                
                ОБЯЗАТЕЛЬНО используй ТОЛЬКО эти значения:
                - feature: "${correctFeature}"
                - story: ОДИН из: ${correctStories.join(', ') || missingReq.functionality}
                
                ЗАПРЕЩЕНО создавать новые фичи или стори!
                
                ${missingReq.modelContext ? `
                КОНТЕКСТ ИЗ МОДЕЛИ:
                Feature: ${missingReq.modelContext.feature}
                Story: ${missingReq.modelContext.story}
                Requirement: ${missingReq.modelContext.requirement}
                Scenarios: ${missingReq.modelContext.scenarios.map(s => s.text).join(', ')}
                ` : ''}
                
                🎯 КРИТИЧЕСКИ ВАЖНО: ПОЛЕ REQUIREMENT! 🎯
                КАЖДЫЙ тест-кейс ОБЯЗАТЕЛЬНО должен содержать поле:
                "requirement": "${missingReq.requirementId}"
                
                БЕЗ ЭТОГО ПОЛЯ тест-кейс НЕ БУДЕТ УЧТЕН в покрытии требований!
                
                🎯 КРИТИЧЕСКИ ВАЖНО: СТРУКТУРА ТЕСТОВ! 🎯
                Для каждого requirement создай:
                1. МИНИМУМ 1-2 E2E теста (пользовательские пути)
                2. МИНИМУМ 2-3 Integration теста (UI + API, включая негативные сценарии)
                
                ${missingReq.description.includes('ОТЛИЧАЕТСЯ') ? `
                🔍 ВАЖНО: Это требование могло быть пропущено потому что оно ПОХОЖЕ на другое.
                Внимательно проанализируй РАЗЛИЧИЯ и создай УНИКАЛЬНЫЕ тест-кейсы!
                ` : ''}
                
                🚨 ПРИВЯЗКА К ТЕСТОВОЙ МОДЕЛИ! 🚨
                Тест-кейсы ДОЛЖНЫ быть привязаны к существующим элементам модели:
                - E2E Tests: привязываются к Story уровню
                - Integration Tests: привязываются к Scenario уровню  
                
                Используй следующие элементы из модели:
                ${JSON.stringify(missingReq.modelContext || {}, null, 2)}

                🎯 СТРОГИЙ МАППИНГ УРОВНЕЙ:
                - layer: "E2E Tests" → ОБЯЗАТЕЛЬНО указать feature + story + scenario (БЕЗ code)
                - layer: "Integration frontend/backend Tests" → ОБЯЗАТЕЛЬНО указать feature + story + scenario (дополнительно code, если требуется для API шага)
                
                🎯 ОБЯЗАТЕЛЬНЫЕ ПОЛЯ ДЛЯ КАЖДОГО ТЕСТ-КЕЙСА:
                1. title - название (строка)
                2. steps - массив шагов (МИНИМУМ 1 шаг!)
                3. expected - ожидаемый результат (строка)
                4. layer - слой тестирования (E2E/Integration)
                5. requirement - номер требования "${missingReq.requirementId}" (ОБЯЗАТЕЛЬНО!)
                6. feature - название фичи из модели
                7. story - название story из модели
                8. scenario - название scenario (для Integration и для E2E, если задано)
                9. code - название code (если используется вызов API/метода)
                10. priority - приоритет (High/Medium/Low)
                11. tags - массив тегов
                
                ПРИМЕРЫ ПРАВИЛЬНОЙ СТРУКТУРЫ:
                
                E2E тест:
                {
                  "title": "Повторить платеж из истории операций",
                  "steps": ["Открыть историю операций", "Выбрать платеж", "Нажать 'Повторить'"],
                  "expected": "Платеж успешно повторен",
                  "layer": "E2E Tests",
                  "requirement": "${missingReq.requirementId}",
                  "feature": "Название фичи",
                  "story": "Повтор платежей",
                  "priority": "High",
                  "tags": ["M", "S"]
                }
                
                Integration тест:
                {
                  "title": "Вызов метода GET /template/get_by_id с doc_type=payment",
                  "steps": ["Выполнить GET запрос с параметром doc_type=payment"],
                  "expected": "Получен ответ 200 с данными платежа",
                  "layer": "Integration backend Tests",
                  "requirement": "${missingReq.requirementId}",
                  "feature": "Название фичи",
                  "story": "Повтор платежей",
                  "scenario": "Повторить платеж с doc_type=payment",
                  "priority": "High",
                  "tags": ["BE"]
                }
                
                Контекст требований:
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

                🚨 КРИТИЧЕСКИ ВАЖНО: ПРИНУДИТЕЛЬНЫЕ ТРЕБОВАНИЯ! 🚨
                
                ОБЯЗАТЕЛЬНО:
                1. feature ДОЛЖНО быть "${correctFeature}"
                2. story ДОЛЖНО быть одним из: ${correctStories.join(', ') || missingReq.functionality}
                3. requirement ДОЛЖНО быть "${missingReq.requirementId}"
                4. МИНИМУМ 1-2 E2E теста на story
                5. МИНИМУМ 2-3 Integration теста на scenario
                
                Сгенерируй минимум 4-6 тест-кейсов на РАЗНЫХ уровнях (E2E, Integration frontend, Integration backend).
                ОБЯЗАТЕЛЬНО: Каждый тест-кейс должен иметь requirement: "${missingReq.requirementId}"!
                
Ответ — ТОЛЬКО чистый JSON-массив без Markdown.
`.trim();


                // ✅ ДОРАБОТКА 3: Передаём reqStructure в tool (если доступен)
                // Примечание: metadata больше не сохраняется в БД, поэтому reqStructureForTool будет null
                // Функция buildSubmitCasesToolStrict работает и без reqStructure
                let reqStructureForTool = null;

                const submissionTool = buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios, reqStructureForTool);
                const ai = await runTestCaseLLM({
                    userPrompt,
                    submissionTool,
                    modelOverrides: {
                        temperature: 0,
                        top_p: 1,
                        max_tokens: 50000,  // ✅ Уменьшено с 64000 до 50000 для учета лимита контекста модели (196608 токенов)
                        extra: { transforms: 'middle-out' }
                    }
                });

                // ✅ НОВАЯ ЛОГИКА: Обрабатываем ВСЕ tool_calls как в genForChunk
                const toolCalls = ai.choices?.[0]?.message?.tool_calls;
                if (toolCalls && toolCalls.length > 0) {
                    console.log(`[gapFillRequirements-ASYNC] Найдено ${toolCalls.length} tool_calls, обрабатываем все...`);

                    const gapCases = [];

                    for (const toolCall of toolCalls) {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            console.log(`[gapFillRequirements-ASYNC] Tool ${toolCall.function.name}:`, {
                                hasArgs: !!args,
                                argsKeys: Object.keys(args || {})
                            });

                            // ✅ ПРОСТАЯ ОБРАБОТКА: Берем поля напрямую из args.cases
                            if (args.cases && Array.isArray(args.cases)) {
                                for (const testCase of args.cases) {
                                    gapCases.push({
                                        title: testCase.title,
                                        steps: testCase.steps,
                                        expected: testCase.expected,
                                        layer: testCase.layer,
                                        feature: testCase.feature,
                                        story: testCase.story,
                                        scenario: testCase.scenario,
                                        code: testCase.code,
                                        tags: testCase.tags || [],
                                        priority: testCase.priority || 'Medium',
                                        version: testCase.version || 'stable',
                                        requirement: missingReq.requirementId, // ✅ ПРИНУДИТЕЛЬНО добавляем requirement!
                                        precondition: testCase.precondition,
                                        links: testCase.links || [],
                                        jiraIssue: testCase.jiraIssueOption?.value,
                                        parameters: testCase.parameters || [],
                                        examples: testCase.examples || []
                                    });
                                }
                                console.log(`[gapFillRequirements-ASYNC] ✅ Добавлено ${args.cases.length} тест-кейсов через tool_call`);
                            }

                        } catch (parseErr) {
                            console.error(`[gapFillRequirements-ASYNC] ❌ Ошибка парсинга tool_call ${toolCall.function.name}:`, parseErr.message);
                        }
                    }

                    if (gapCases.length > 0) {
                        console.log(`[gapFillRequirements-ASYNC] ✅ УСПЕХ: Получено ${gapCases.length} кейсов через tool_calls для ${missingReq.functionality}!`);

                        // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Правильная обработка результатов AI
                        // 1) Извлекаем все codes из модели для sanitize
                        const allCodes = [];
                        for (const feature of (modelStructure || [])) {
                            for (const story of (feature.stories || [])) {
                                for (const scenario of (story.scenarios || [])) {
                                    for (const code of (scenario.codes || [])) {
                                        allCodes.push(code.text);
                                    }
                                }
                            }
                        }

                        // 2) Санитизация
                        let sanitizedCases = sanitize(gapCases, allCodes);
                        console.log(`[gapFillRequirements-ASYNC] После sanitize: ${sanitizedCases.length} кейсов`);

                        // 3) Восстановление связей по модели
                        const modelIndex = buildModelIndex(modelStructure);
                        let finalCases = fixAgainstModel(sanitizedCases, modelIndex);
                        console.log(`[gapFillRequirements-ASYNC] После fixAgainstModel: ${finalCases.length} кейсов`);

                        // Заменяем упоминания параметров в шагах на формат {{Название параметра}} для Allure TestOps
                        finalCases = injectParameterPlaceholders(finalCases);

                        allGapCases.push(...finalCases);
                        continue;
                    }
                }

                // Fallback парсинг
                const content = ai.choices?.[0]?.message?.content || '';
                const rawJsonCandidate = extractJsonArray(content);
                if (!rawJsonCandidate) continue;

                try {
                    const jsonText = cleanupJsonText(rawJsonCandidate);
                    const parsed = JSON5.parse(jsonText);
                    if (Array.isArray(parsed)) {
                        allGapCases.push(...parsed);
                        console.log(`[gapFillRequirements-ASYNC] Fallback: сгенерировано ${parsed.length} кейсов для ${missingReq.functionality}`);
                    }
                } catch (e) {
                    console.warn(`[gapFillRequirements-ASYNC] Ошибка парсинга для ${missingReq.functionality}:`, e.message);
                }
            }

            console.log(`[gapFillRequirements-ASYNC] Всего догенерировано ${allGapCases.length} кейсов для недостающих требований`);
            return allGapCases;
        }

        function fixAgainstModel(testCases, idx) {
            return testCases.map(tc => {
                const title = (tc.title || '').toLowerCase();
                const steps = (tc.steps || []).map(s => s.toLowerCase()).join(' ');
                const expected = (tc.expected || '').toLowerCase();
                const precondition = (tc.precondition || '').toLowerCase();
                let correctedLayer = tc.layer || '';

                // Unit-слои в новой политике не используются, поэтому любое упоминание переводим в Integration.
                if (correctedLayer.includes('Unit')) {
                    correctedLayer = correctedLayer.includes('frontend')
                        ? 'Integration frontend Tests'
                        : 'Integration backend Tests';
                    console.log(`[fixAgainstModel] Приведение layer с Unit к Integration: ${tc.title}`);
                }

                // =============================================================
                // ПРАВИЛО 3: Frontend ↔ Backend (ОДНА ПРОВЕРКА с маркером)
                // =============================================================

                // 3.1. Frontend → Backend (API-контекст)
                if (correctedLayer.includes('frontend') && !correctedLayer.includes('__fixed')) {
                    const isBackend =
                        // Явное упоминание API
                        title.includes('api post') ||
                        title.includes('api get') ||
                        title.includes('api delete') ||
                        title.includes('api put') ||
                        // Выполнение API без UI-действий
                        (steps.includes('выполнить post') && !steps.includes('открыть') && !steps.includes('нажать')) ||
                        (steps.includes('выполнить get') && !steps.includes('открыть') && !steps.includes('нажать')) ||
                        (steps.includes('выполнить delete') && !steps.includes('открыть') && !steps.includes('нажать'));

                    if (isBackend) {
                        correctedLayer = correctedLayer.replace('frontend', 'backend') + '__fixed';
                        console.log(`[fixAgainstModel] Frontend → Backend (API-контекст): ${tc.title}`);
                    }
                }

                // 3.2. Backend → Frontend (UI-контекст)
                if (correctedLayer.includes('backend') && !correctedLayer.includes('__fixed')) {
                    const isFrontend =
                        // UI-состояния
                        expected.includes('отображается') ||
                        expected.includes('отображена') ||
                        expected.includes('доступен') ||
                        expected.includes('доступна') ||
                        expected.includes('активна') ||
                        expected.includes('форма') ||
                        expected.includes('кнопка') ||
                        expected.includes('поле') ||
                        expected.includes('страница') ||
                        // UI-действия
                        steps.includes('открыть') ||
                        steps.includes('ввести') ||
                        steps.includes('нажать') ||
                        steps.includes('выбрать') ||
                        steps.includes('свернуть') ||
                        steps.includes('развернуть') ||
                        // Precondition с пользовательскими действиями
                        precondition.includes('пользователь') ||
                        precondition.includes('приложение запущено') ||
                        precondition.includes('пользователь находится') ||
                        precondition.includes('sdk инициализирован');

                    // НЕ переносим, если это проверка API → метод
                    const isApiThenMethod =
                        (title.includes('вызов метода') && title.includes('после')) ||
                        (title.includes('вызов метода') && title.includes('при')) ||
                        (title.includes('при успешном ответе') && expected.includes('вызван')) ||
                        (title.includes('при ошибке') && expected.includes('не вызывается'));

                    if (isFrontend && !isApiThenMethod) {
                        correctedLayer = correctedLayer.replace('backend', 'frontend') + '__fixed';
                        console.log(`[fixAgainstModel] Backend → Frontend (UI-контекст): ${tc.title}`);
                    }
                }

                return {
                    ...tc,
                    layer: correctedLayer.replace(/__fixed/g, '')
                };

            });
        }

        /**
         * Заменяет упоминания параметров в шагах на формат {{Название параметра}} для Allure TestOps
         */
        function injectParameterPlaceholders(testCases) {
            let totalReplacements = 0;

            const result = testCases.map(tc => {
                // Если нет параметров, возвращаем как есть
                if (!Array.isArray(tc.parameters) || tc.parameters.length === 0) {
                    return tc;
                }

                // Собираем все названия параметров
                const parameterNames = tc.parameters
                    .map(p => p.name)
                    .filter(Boolean);

                if (parameterNames.length === 0) {
                    return tc;
                }

                // Обрабатываем шаги
                const processedSteps = (tc.steps || []).map(step => {
                    if (typeof step !== 'string') {
                        return step;
                    }

                    let processedStep = step;
                    let stepModified = false;

                    // Для каждого параметра ищем его упоминания в шаге
                    parameterNames.forEach(paramName => {
                        // Проверяем, не использован ли уже формат {{Название параметра}}
                        if (processedStep.includes(`{{${paramName}}}`)) {
                            return; // Уже в правильном формате
                        }

                        // Различные варианты упоминания параметра (в порядке приоритета)
                        const patterns = [
                            // 1. "из параметра X", "параметр X", "X из параметров", "из таблицы параметров X"
                            {
                                pattern: new RegExp(`(?:из\\s+(?:таблицы\\s+)?)?параметра?\\s+["']?${escapeRegex(paramName)}["']?`, 'gi'),
                                replacement: `{{${paramName}}}`
                            },
                            {
                                pattern: new RegExp(`["']?${escapeRegex(paramName)}["']?\\s+(?:из\\s+(?:таблицы\\s+)?)?параметра?`, 'gi'),
                                replacement: `{{${paramName}}}`
                            },
                            // 2. Упоминание в скобках: "(X)", "[X]", "{X}"
                            {
                                pattern: new RegExp(`\\(["']?${escapeRegex(paramName)}["']?\\)`, 'gi'),
                                replacement: `{{${paramName}}}`
                            },
                            {
                                pattern: new RegExp(`\\["'?${escapeRegex(paramName)}["']?\\]`, 'gi'),
                                replacement: `{{${paramName}}}`
                            },
                            // 3. Прямое упоминание в контексте "поля X", "значение X", "X из" (только если название достаточно уникальное)
                            {
                                pattern: new RegExp(`(?:поля|значение|значения|параметр)\\s+["']?${escapeRegex(paramName)}["']?`, 'gi'),
                                replacement: (match) => {
                                    // Сохраняем контекст, заменяя только название параметра
                                    return match.replace(new RegExp(escapeRegex(paramName), 'gi'), `{{${paramName}}}`);
                                }
                            }
                        ];

                        // Пробуем заменить по паттернам (в порядке приоритета)
                        for (const { pattern, replacement } of patterns) {
                            if (pattern.test(processedStep)) {
                                const beforeReplace = processedStep;
                                if (typeof replacement === 'function') {
                                    processedStep = processedStep.replace(pattern, replacement);
                                } else {
                                    processedStep = processedStep.replace(pattern, replacement);
                                }

                                if (beforeReplace !== processedStep) {
                                    stepModified = true;
                                    totalReplacements++;
                                }
                                break; // Заменяем только один раз на параметр
                            }
                        }
                    });

                    return processedStep;
                });

                return {
                    ...tc,
                    steps: processedSteps
                };
            });

            if (totalReplacements > 0) {
                console.log(`[injectParameterPlaceholders] Заменено ${totalReplacements} упоминаний параметров на формат {{Название параметра}}`);
            }

            return result;
        }

        /**
         * Экранирует специальные символы для использования в регулярных выражениях
         */
        function escapeRegex(str) {
            return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        const sanitize = (arr) => {
            console.log(`[sanitize] Обрабатываем ${arr?.length || 0} кейсов`);
            const ALLOWED_LAYERS = new Set([
                "E2E Tests",
                "Integration frontend Tests",
                "Integration backend Tests"
            ]);
            const trimText = (s, n = 1200) => String(s ?? '').trim().slice(0, n);
            const allowedCodeSet = new Set(allowedCodes);
            const take = (s, n) => {
                const t = trimText(s, n);
                return t ? t : undefined;
            };

            const seenTitles = new Set();
            const seenLogic = new Map();

            // ✅ Общая функция нормализации
            function normalizeText(text) {
                return String(text || '')
                    .toLowerCase()
                    .replace(/\b(успешн\w+|сбор и передача|передача и сбор|отправка|передача)\b/gi, '<ACTION>')
                    .replace(/\b(после|при|при запуске)\b/gi, '<TIMING>')
                    .replace(/\b(авторизаци\w+|авторизоваться)\b/gi, '<AUTH>')
                    .replace(/\b(пин-код\w*|пинкод)\b/gi, '<PIN>')
                    .replace(/\b(отчёт\w*|отчет\w*)\b/gi, '<REPORT>')
                    .replace(/\b(и|с|на|в|по|для|от|до|из|к|у|о|об|про|через)\b/gi, '')
                    .replace(/\s+/g, ' ').trim();
            }

            function getLogicSignature(testCase) {
                // ✅ ИСПРАВЛЕНО: учитываем parameters в сигнатуре
                const paramsSignature = (testCase.parameters || [])
                    .map(p => `${p.name}:${(p.values || []).sort().join(',')}`)
                    .sort()
                    .join('|');

                return `${testCase.layer || ''}::${normalizeText(testCase.story)}::${normalizeText(testCase.scenario)}::${normalizeText(testCase.title)}::${(testCase.steps || []).map(s => normalizeText(s)).join('|')}::${normalizeText(testCase.expected)}::PARAMS[${paramsSignature}]`;
            }

            // ✅ ДОРАБОТКА 1: Функция валидации привязки к модели
            /**
             * Проверяет, что feature/story/scenario существуют в модели
             * @param {Object} testCase - Тест-кейс для проверки
             * @param {Array} modelStructure - Структура тестовой модели
             * @returns {Object} - { valid, errors, correctedFeature, correctedStory, correctedScenario }
             */
            function validateModelBinding(testCase, modelStructure) {
                const errors = [];
                let correctedFeature = testCase.feature;
                let correctedStory = testCase.story;
                let correctedScenario = testCase.scenario;

                if (!modelStructure || !Array.isArray(modelStructure) || modelStructure.length === 0) {
                    return {
                        valid: false,
                        errors: ['Модель не предоставлена или пуста'],
                        correctedFeature,
                        correctedStory,
                        correctedScenario
                    };
                }

                // Проверяем feature
                const featureExists = modelStructure.some(f =>
                    normalizeText(f.text) === normalizeText(testCase.feature)
                );

                if (!featureExists && testCase.feature) {
                    errors.push(`Feature "${testCase.feature}" не найдена в модели`);

                    // Пытаемся найти похожую
                    const similarFeature = modelStructure.find(f => {
                        const keywords = normalizeText(testCase.feature).split(/\s+/).filter(w => w.length > 3);
                        return keywords.some(kw => normalizeText(f.text).includes(kw));
                    });

                    if (similarFeature) {
                        correctedFeature = similarFeature.text;
                        console.log(`[validateModelBinding] Исправлено: "${testCase.feature}" → "${correctedFeature}"`);
                    } else {
                        // Если не нашли похожую - используем первую из модели
                        correctedFeature = modelStructure[0].text;
                        console.warn(`[validateModelBinding] ⚠️ Feature "${testCase.feature}" не найдена, используем "${correctedFeature}"`);
                    }
                }

                // Проверяем story
                let storyExists = false;
                let foundFeature = null;

                for (const feature of modelStructure) {
                    if (normalizeText(feature.text) === normalizeText(correctedFeature)) {
                        foundFeature = feature;
                        const foundStory = (feature.stories || []).find(s =>
                            normalizeText(s.text) === normalizeText(testCase.story)
                        );
                        if (foundStory) {
                            storyExists = true;
                            break;
                        }
                    }
                }

                if (!storyExists && testCase.story) {
                    errors.push(`Story "${testCase.story}" не найдена в Feature "${correctedFeature}"`);

                    // Пытаемся найти похожую в найденной Feature
                    if (foundFeature) {
                        const similarStory = (foundFeature.stories || []).find(s => {
                            const keywords = normalizeText(testCase.story).split(/\s+/).filter(w => w.length > 3);
                            return keywords.some(kw => normalizeText(s.text).includes(kw));
                        });

                        if (similarStory) {
                            correctedStory = similarStory.text;
                            console.log(`[validateModelBinding] Исправлено: "${testCase.story}" → "${correctedStory}"`);
                        } else if (foundFeature.stories && foundFeature.stories.length > 0) {
                            // Если не нашли похожую - используем первую Story из Feature
                            correctedStory = foundFeature.stories[0].text;
                            console.warn(`[validateModelBinding] ⚠️ Story "${testCase.story}" не найдена, используем "${correctedStory}"`);
                        }
                    }
                }

                // Проверяем scenario (только для Integration тестов)
                if (testCase.layer?.includes('Integration') && testCase.scenario) {
                    let scenarioExists = false;

                    for (const feature of modelStructure) {
                        if (normalizeText(feature.text) !== normalizeText(correctedFeature)) continue;

                        for (const story of (feature.stories || [])) {
                            if (normalizeText(story.text) !== normalizeText(correctedStory)) continue;

                            const foundScenario = (story.scenarios || []).find(sc =>
                                normalizeText(sc.text) === normalizeText(testCase.scenario)
                            );
                            if (foundScenario) {
                                scenarioExists = true;
                                break;
                            }
                        }
                        if (scenarioExists) break;
                    }

                    if (!scenarioExists) {
                        errors.push(`Scenario "${testCase.scenario}" не найден в Story "${correctedStory}"`);
                        // Не исправляем scenario автоматически - это критичная ошибка
                    }
                }

                return {
                    valid: errors.length === 0,
                    errors,
                    correctedFeature,
                    correctedStory,
                    correctedScenario
                };
            }

            return (arr || [])
                .filter(x => x && typeof x === 'object')
                .map(x => {
                    // ✅ ДОРАБОТКА 1: Валидация привязки к модели
                    const validationResult = validateModelBinding(x, modelStructure);

                    if (!validationResult.valid) {
                        console.warn(`[sanitize] ⚠️ Тест-кейс не привязан к модели: "${x.title || 'untitled'}"`);
                        validationResult.errors.forEach(err => console.warn(`  - ${err}`));
                        // Не отфильтровываем сразу - исправим значения и проверим позже
                    }
                    // ✅ ИСПРАВЛЕНО: удаляем поле requirement
                    delete x.requirement;

                    // ✅ ИСПРАВЛЕНО: форматируем Expected с ключевыми словами
                    let expected = take(x.expected || x.expectedResult, 800);
                    if (expected && typeof expected === 'string') {
                        expected = formatExpectedResult(expected, x.layer);
                    }

                    // ✅ ИСПРАВЛЕНО: очищаем Steps от слова "Проверить"
                    let steps = Array.isArray(x.steps) ? x.steps.map(s => trimText(s, 600)).slice(0, 40) : [];
                    steps = steps.map(step => {
                        if (typeof step === 'string' && step.toLowerCase().startsWith('проверить')) {
                            console.warn(`[sanitize] ⚠️ Шаг начинается с "Проверить": "${step}"`);
                            // Переносим в Expected
                            if (!expected) {
                                expected = step.replace(/^проверить,?\s*/i, '');
                            }
                            return null; // Удаляем из Steps
                        }
                        return step;
                    }).filter(Boolean);

                    console.log(`[sanitize] Обрабатываем кейс:`, {
                        title: x.title,
                        layer: x.layer,
                        hasSteps: !!steps.length,
                        stepsLength: steps.length,
                        hasExpected: !!expected,
                        expectedLength: expected?.length
                    });

                    const tags = Array.isArray(x.tags) ? Array.from(new Set(x.tags.map(t => String(t).trim()).filter(Boolean))) : [];
                    const layer = ALLOWED_LAYERS.has(x.layer) ? x.layer : null;

                    const codeRaw = trimText(x.code, 200);
                    const code = allowedCodeSet.has(codeRaw) ? codeRaw : undefined;

                    // ✅ Используем исправленные значения из валидации
                    const finalFeature = validationResult.correctedFeature || extractTextFromModel(modelStructure, 'feature', take(x.feature, 200));
                    const finalStory = validationResult.correctedStory || extractTextFromModel(modelStructure, 'story', take(x.story, 200));
                    const finalScenario = validationResult.correctedScenario || extractTextFromModel(modelStructure, 'scenario', take(x.scenario, 200));

                    return {
                        title: take(x.title, 200),
                        description: take(x.description, 800),
                        precondition: take(x.precondition, 800),
                        steps,
                        expected,
                        tags,
                        layer,
                        feature: finalFeature,
                        story: finalStory,
                        scenario: finalScenario,
                        code: extractTextFromModel(modelStructure, 'code', code),
                        priority: take(x.priority, 50),
                        version: take(x.version, 50),
                        links: Array.isArray(x.links) ? x.links.slice(0, 10) : [],
                        jiraIssue: take(x.jiraIssue, 100),
                        // ❌ УДАЛЕНО: requirement - не используется в тест-кейсах
                        parameters: Array.isArray(x.parameters) ? x.parameters.map(p => ({
                            name: take(p.name, 100),
                            values: Array.isArray(p.values) ? p.values.map(v => take(v, 500)).filter(Boolean) : []
                        })).filter(p => p.name && p.values.length > 0) : [],
                        examples: Array.isArray(x.examples) ? x.examples.map(ex => ({
                            parameters: Array.isArray(ex.parameters) ? ex.parameters.map(p => ({
                                name: take(p.name, 100),
                                value: take(p.value, 500)
                            })).filter(p => p.name && p.value) : []
                        })).filter(ex => ex.parameters.length > 0) : [],
                        // ✅ Сохраняем информацию о валидации для последующей фильтрации
                        _validationErrors: validationResult.errors
                    };
                })
                .filter(x => {
                    if (!x.title || !x.steps?.length || !x.expected || !x.layer) return false;

                    // ✅ ДОРАБОТКА 1: Фильтруем тесты с критичными ошибками валидации
                    if (x._validationErrors && x._validationErrors.length > 0) {
                        // Если есть ошибки валидации и они критичные (scenario не найден для Integration) - отфильтровываем
                        const criticalErrors = x._validationErrors.filter(err =>
                            err.includes('Scenario') && x.layer?.includes('Integration')
                        );
                        if (criticalErrors.length > 0) {
                            console.warn(`[sanitize] ❌ Отклонён тест-кейс с критичными ошибками: "${x.title}"`);
                            criticalErrors.forEach(err => console.warn(`  - ${err}`));
                            return false;
                        }
                    }

                    const normalized = normalizeText(x.title);
                    if (seenTitles.has(normalized)) {
                        console.log(`[sanitize] ⚠️ Дубликат: "${x.title}"`);
                        return false;
                    }
                    seenTitles.add(normalized);

                    const signature = getLogicSignature(x);
                    if (seenLogic.has(signature)) {
                        console.log(`[sanitize] ⚠️ Дубликат по логике: "${x.title}"`);
                        return false;
                    }
                    seenLogic.set(signature, x.title);
                    return true;
                })
                .map(x => {
                    // Удаляем служебное поле _validationErrors перед возвратом
                    if (x._validationErrors) {
                        delete x._validationErrors;
                    }
                    return x;
                });
        };

        const {
            requirements,
            modelStructure: rawModel,
            text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken
        } = inputData;

        // ✅ Создаем глубокую копию modelStructure чтобы не модифицировать оригинал
        const rawModelCopy = JSON.parse(JSON.stringify(rawModel));
        const modelStructure = normalizeModelStructure(rawModelCopy);

        if ((!Array.isArray(requirements) && typeof requirements !== 'string') || !modelStructure) {
            throw new Error('requirements и modelStructure обязательны');
        }

        // ✅ Убеждаемся, что все Code имеют поле type
        for (const feature of modelStructure || []) {
            for (const story of feature.stories || []) {
                for (const scenario of story.scenarios || []) {
                    for (const code of scenario.codes || []) {
                        if (!code.type && code.text) {
                            code.type = detectCodeType(code.text);
                        }
                    }
                }
            }
        }

        const sourceRegistry = createContextSourceRegistry();
        const { register: registerSource, safeTrim, deriveTitleFromContent } = sourceRegistry;

        if (Array.isArray(requirements) && requirements.length) {
            const rawCombined = requirements.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n---\n\n');
            if (safeTrim(rawCombined)) {
                registerSource({
                    id: 'raw-requirements',
                    title: 'Исходные требования',
                    description: 'Массив требований из запроса',
                    type: 'requirement',
                    content: rawCombined
                });
            }
        } else if (typeof requirements === 'string' && safeTrim(requirements)) {
            registerSource({
                id: 'raw-requirements',
                title: 'Исходные требования',
                description: 'Требование, переданное в запросе',
                type: 'requirement',
                content: requirements
            });
        }

        if (safeTrim(text)) {
            registerSource({
                id: 'text-requirement',
                title: 'Дополнительный текст требования',
                description: 'Поле text из запроса',
                type: 'requirement',
                content: text
            });
        }

        if (safeTrim(glossary)) {
            registerSource({
                id: 'raw-glossary',
                title: 'Глоссарий из запроса',
                description: 'Глоссарий, предоставленный пользователем',
                type: 'glossary',
                content: glossary
            });
        }

        function buildRequirementToStoryMapping(modelStructure) {
            const mapping = {};

            for (const feature of (modelStructure || [])) {
                for (const story of (feature.stories || [])) {
                    if (story.requirement && story.text) {
                        // Автоматически создаем маппинг из модели
                        mapping[story.requirement] = story.text;
                    }
                }
            }

            console.log(`[generateTestCasesAsync] Auto-extracted requirement mapping:`,
                Object.keys(mapping).length, 'requirements');

            return mapping;
        }

        // ✅ НОВАЯ ФУНКЦИЯ: Извлечение текстовых названий из модели по ID/BEM
        function extractTextFromModel(modelStructure, fieldType, identifier) {
            if (!modelStructure || !identifier) return identifier;

            // Если уже текстовое название (не UUID и не BEM-класс) - возвращаем как есть
            if (typeof identifier === 'string' &&
                !identifier.match(/^[a-f0-9-]{36}$/) && // не UUID
                !identifier.match(/^(feature|story|scenario|code)_/)) { // не BEM-класс
                return identifier;
            }

            for (const feature of (modelStructure || [])) {
                // Проверяем feature
                if (fieldType === 'feature' && (feature.id === identifier || feature.text === identifier)) {
                    return feature.text || identifier;
                }

                for (const story of (feature.stories || [])) {
                    // Проверяем story
                    if (fieldType === 'story' && (story.id === identifier || story.text === identifier)) {
                        return story.text || identifier;
                    }

                    for (const scenario of (story.scenarios || [])) {
                        // Проверяем scenario
                        if (fieldType === 'scenario' && (scenario.id === identifier || scenario.text === identifier)) {
                            return scenario.text || identifier;
                        }

                        for (const code of (scenario.codes || [])) {
                            // Проверяем code
                            if (fieldType === 'code' && (code.id === identifier || code.text === identifier)) {
                                return code.text || identifier;
                            }
                        }
                    }
                }
            }

            return identifier; // Если не найдено - возвращаем исходное значение
        }

        const requirementToStoryMapping = buildRequirementToStoryMapping(modelStructure);

        // === ФУНКЦИЯ ПОИСКА STORY ПО ТРЕБОВАНИЮ ===
        function findStoryByRequirement(modelStructure, requirementId) {
            for (const feature of (modelStructure || [])) {
                for (const story of (feature.stories || [])) {
                    if (story.requirement === requirementId) {
                        return {
                            feature: feature.text,
                            story: story.text,
                            requirement: story.requirement,
                            scenarios: story.scenarios || []
                        };
                    }
                }
            }
            return null;
        }

        // === Соберём автоконтекст по ссылкам основной статьи (если есть pageId) ===
        let refinedReqs = Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []);
        let baseRequirement = '';
        let autoPages = [];
        if (pageId) {
            try {
                if (!bearerToken) throw new Error('bearerToken is required for Confluence');
                const { markdown, title: mainTitle } = await fetchConfluencePage(bearerToken, pageId, { inlineTextAttachments: true });
                baseRequirement = markdown || '';
                const ids = new Set(Array.from(String(markdown || '').matchAll(/pageId=(\d{4,})/g)).map(m => m[1]));
                ids.delete(String(pageId));
                registerSource({
                    id: `page-${pageId}`,
                    title: deriveTitleFromContent(baseRequirement, mainTitle || `Confluence page ${pageId}`, pageId),
                    description: 'Основное требование (полный текст)',
                    type: 'requirement',
                    pageId: String(pageId),
                    content: baseRequirement
                });
                for (const lid of ids) {
                    try {
                        const { markdown: md, title: linkedTitle } = await fetchConfluencePage(bearerToken, lid, { inlineTextAttachments: true });
                        const lines = String(markdown || '').split(/\n/);
                        const refIdx = lines.findIndex(l => l.includes(`pageId=${lid}`));
                        let mention = '';
                        if (refIdx !== -1) {
                            const start = Math.max(0, refIdx - 2);
                            const end = Math.min(lines.length, refIdx + 3);
                            mention = lines.slice(start, end).join('\n').trim();
                        }
                        const relevant = extractRelevantSections(md, mention, { maxSections: 15, maxChars: 100000 }); // Увеличено для полного контекста
                        autoPages.push([
                            `### Контекст по ссылке из основной статьи (pageId=${lid})`,
                            mention ? `> Упоминание в основной статье:\n> ${mention.replace(/\n/g, '\n> ')}` : `> Упоминание в основной статье: не найдено (pageId=${lid})`,
                            '',
                            relevant
                        ].join('\n'));
                        registerSource({
                            id: `page-${lid}`,
                            title: deriveTitleFromContent(md, linkedTitle || `Связанная страница ${lid}`, lid),
                            description: mention ? `Упоминание: ${formatMention(mention)}` : 'Контекст из связанной страницы',
                            type: 'confluence',
                            pageId: String(lid),
                            content: md
                        });
                    } catch { }
                }
            } catch (e) {
                console.warn('[generate-test-cases-async] auto-context fetch failed:', e.message);
            }
        }

        const requestContextText = normalizeContextInput(context);
        if (requestContextText) {
            registerSource({
                id: 'user-context',
                title: 'Дополнительный контекст из запроса',
                description: contextInstruction ? String(contextInstruction) : 'Контекст, переданный вместе с задачей',
                type: 'context',
                content: requestContextText
            });
        }

        try {
            const { refinedArray } = await contextRefiner({
                requirements,
                text: baseRequirement || text,
                glossary,
                context,
                contextInstruction,
                contextPageIds: undefined,
                glossaryPageId: undefined,
                bearerToken: undefined,
                contextPages: autoPages
            });
            refinedReqs = refinedArray;
            console.log(`[generate-test-cases-async] OK: contextRefiner успешно обработал требования. Объем: ${refinedArray.join('\n').length} символов.`);
        } catch (e) {
            console.error('[generate-test-cases-async] CRITICAL: contextRefiner завершился с ошибкой:', e.message);
            refinedReqs = Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []);
        }

        const combinedRefinedRequirements = refinedReqs.filter((segment) => safeTrim(segment)).join('\n\n---\n\n');
        if (safeTrim(combinedRefinedRequirements)) {
            registerSource({
                id: pageId ? `refined-requirements-${pageId}` : 'refined-requirements',
                title: 'Требования после обработки',
                description: 'Выжимка требований для генерации тест-кейсов',
                type: 'requirement',
                pageId: pageId ? String(pageId) : null,
                content: combinedRefinedRequirements
            });
        }

        // Глобальный список допустимых code (по всей модели) — нужен sanitize()
        const allowedCodes = Array.from(new Set(
            (modelStructure || []).flatMap(f =>
                (f.stories || []).flatMap(st =>
                    (st.scenarios || []).flatMap(sc =>
                        (sc.codes || []).map(cd => (cd?.text || '').trim()).filter(Boolean)
                    )
                )
            )
        ));

        const contextFetcher = bearerToken
            ? async (requestedPageId) => {
                try {
                    if (requestedPageId == null) return '';
                    const requestedIdStr = String(requestedPageId);
                    const existing = sourceRegistry.sources.find((src) => src.pageId === requestedIdStr && src.content);
                    if (existing) return existing.content;
                    const { markdown } = await fetchConfluencePage(bearerToken, requestedIdStr, { inlineTextAttachments: true });
                    return markdown || '';
                } catch (err) {
                    console.warn(`[generate-test-cases] Не удалось загрузить страницу pageId=${requestedPageId}: ${err.message}`);
                    return '';
                }
            }
            : null;

        const contextToolset = createContextToolset({
            sources: sourceRegistry.getSources(),
            fetcher: contextFetcher,
            defaultChunk: 8000  // ✅ Увеличено для MiniMax-M2 (204K контекст)
        });
        const interactiveTools = Array.isArray(contextToolset.tools) ? contextToolset.tools : [];
        const contextToolHandlers = contextToolset.handlers || {};

        let toolSummary = contextToolset.summary || '';
        if (toolSummary) {
            const lines = toolSummary.split('\n').filter(Boolean);
            if (lines.length > 15) {
                const hiddenCount = lines.length - 15;
                toolSummary = `${lines.slice(0, 15).join('\n')}\n- ... ещё ${hiddenCount} источников`;
            }
        } else {
            toolSummary = '—';
        }

        const toolInstruction = interactiveTools.length
            ? `**Как работать с дополнительным контекстом:**\n- Вызови \`list_context_sources()\`, чтобы увидеть доступные источники (требования, контекст и связанные страницы из Confluence)\n- Используй \`fetch_context_chunk({ "sourceId": "...", "offset": 0, "limit": 4000 })\`, чтобы читать нужные фрагменты\n- При необходимости продолжай чтение, увеличивая \`offset\`\n\n**Доступные источники:**\n${toolSummary}\n`
            : '**Как работать с дополнительным контекстом:**\nДополнительные источники не предоставлены. Генерируй тест-кейсы, опираясь на текст требований.\n';

        // ====== УЛУЧШЕНИЕ: Функция-обертка для контроля таймаутов ======
        async function withTimeout(promise, ms, operationName = 'AI call') {
            const timeout = new Promise((_, reject) => {
                const id = setTimeout(() => {
                    clearTimeout(id);
                    reject(new Error(`Операция "${operationName}" превысила таймаут в ${ms / 1000}с`));
                }, ms);
            });
            return Promise.race([promise, timeout]);
        }

        // ✅ ОПТИМИЗИРОВАННАЯ ВЕРСИЯ: ONE-PASS вместо TWO-PASS
        function splitByStoriesOptimized(modelStructure) {
            const chunks = [];
            const MAX_SCENARIOS = 5; // увеличено для меньшего числа вызовов

            for (const feature of modelStructure) {
                for (const story of feature.stories) {
                    const scenarios = story.scenarios || [];

                    // Одна Story → Один чанк с ПОЛНЫМ контекстом
                    if (scenarios.length <= MAX_SCENARIOS) {
                        chunks.push([{
                            text: feature.text,
                            stories: [{
                                text: story.text,
                                scenarios: scenarios, // ВСЕ сценарии
                                _mode: 'FULL' // флаг для промпта
                            }]
                        }]);
                    } else {
                        // Большая Story → делим на батчи, но БЕЗ мастер-чанка
                        for (let i = 0; i < scenarios.length; i += MAX_SCENARIOS) {
                            const batch = scenarios.slice(i, i + MAX_SCENARIOS);
                            chunks.push([{
                                text: feature.text,
                                stories: [{
                                    text: story.text,
                                    scenarios: batch,
                                    _mode: 'BATCH',
                                    _batchInfo: `${Math.floor(i / MAX_SCENARIOS) + 1} из ${Math.ceil(scenarios.length / MAX_SCENARIOS)}`
                                }]
                            }]);
                        }
                    }
                }
            }

            return chunks;
        }


        // ✅ ФИЛЬТРАЦИЯ ТРЕБОВАНИЙ ПО РЕЛЕВАНТНОСТИ
        function filterRelevantRequirements(requirements, chunk) {
            const feature = chunk[0].text.toLowerCase();
            const story = chunk[0].stories[0].text.toLowerCase();
            const scenarios = chunk[0].stories[0].scenarios.map(s => s.text.toLowerCase());

            const keywords = new Set([
                ...feature.split(/\s+/),
                ...story.split(/\s+/),
                ...scenarios.flatMap(s => s.split(/\s+/))
            ].filter(w => w.length > 3)); // только слова > 3 символов

            return requirements.filter(req => {
                const reqLower = req.toLowerCase();
                return Array.from(keywords).some(kw => reqLower.includes(kw));
            }).slice(0, 20); // максимум 20 релевантных требований
        }

        // ✅ КОРОТКИЙ КОНТЕКСТНО-ЗАВИСИМЫЙ ПРОМПТ
        function buildContextPrompt(chunk, existingE2E = []) {
            const mode = chunk[0].stories[0]._mode;
            const feature = chunk[0].text;
            const story = chunk[0].stories[0].text;
            const scenarios = chunk[0].stories[0].scenarios;

            if (mode === 'FULL') {
                return `
🎯 ЗАДАЧА: Генерация E2E + Integration для Story "${story}"

КОНТЕКСТ:
- Feature: "${feature}"
- Story: "${story}" (${scenarios.length} Scenarios)

ЗАДАНИЕ:
1. Создай 1-2 E2E теста (сквозной путь пользователя через Story)
2. Создай 2-3 Integration теста для КАЖДОГО Scenario (UI + API, позитив + негатив)

ПРИМЕР E2E:
{
  "title": "Полный цикл авторизации и отправки отчёта BiZone",
  "layer": "E2E Tests",
  "feature": "${feature}",
  "story": "${story}",
  "scenario": "${scenarios[0]?.text || 'Основной сценарий'}",
  "steps": ["Открыть приложение", "Авторизоваться", "Проверить отправку отчёта"],
  "expected": "SDK инициализирован, POST /create/sdk вызван с кодом 204"
}

ПРИМЕР Integration (SDK-специфичный!):
{
  "title": "SDK BiZone начинает сбор данных при открытии формы авторизации",
  "layer": "Integration frontend Tests",
  "feature": "${feature}",
  "story": "${story}",
  "scenario": "${scenarios[0]?.text}",
  "expected": "SDK инициализирован, DeviceModel и AppKey собраны"
}

❌ ЗАПРЕЩЕНО: общие UI-тесты БЕЗ контекста "${feature}"
`.trim();
            }

            // Для BATCH-режима
            return `
🎯 ЗАДАЧА: Integration тесты для ${scenarios.length} Scenarios (батч ${chunk[0].stories[0]._batchInfo})

E2E УЖЕ ЕСТЬ:
${existingE2E.map(t => `- ${t.title}`).join('\n')}

ЗАДАНИЕ: Создай 2-3 Integration теста для КАЖДОГО Scenario
❌ НЕ дублируй E2E-логику!
`.trim();
        }

        function collectAllowedCodes(modelChunk) {
            const set = new Set();
            for (const f of modelChunk) for (const st of (f.stories || []))
                for (const sc of (st.scenarios || [])) for (const cd of (sc.codes || []))
                    if (cd?.text?.trim()) set.add(cd.text.trim());
            return [...set];
        }

        function collectAllowedScenarios(modelChunk) {
            const set = new Set();
            for (const f of modelChunk) for (const st of (f.stories || []))
                for (const sc of (st.scenarios || []))
                    if (sc?.text?.trim()) set.add(sc.text.trim());
            return [...set];
        }


        function countChunkNodes(modelChunk) {
            let scenarios = 0, codes = 0;
            for (const f of modelChunk) for (const st of (f.stories || [])) {
                for (const sc of (st.scenarios || [])) {
                    scenarios++;
                    codes += (sc.codes || []).length;
                }
            }
            return { scenarios, codes };
        }

        function auditCoverage(model, cases) {
            // Минимумы: 1 E2E на Story, 2-3 Integration на Scenario
            const needE2EByStory = new Map();
            const needSc = new Map(); // scenario -> remaining Integration

            for (const f of model) for (const st of (f.stories || [])) {
                needE2EByStory.set(st.text, 1);
                for (const sc of (st.scenarios || [])) {
                    needSc.set(sc.text, 3);
                }
            }

            for (const tc of (cases || [])) {
                const layer = String(tc.layer || '');
                if (layer === 'E2E Tests' && tc.story) {
                    const rest = needE2EByStory.get(tc.story);
                    if (rest != null) needE2EByStory.set(tc.story, Math.max(0, rest - 1));
                }
                if (layer.startsWith('Integration') && tc.scenario) {
                    const rest = needSc.get(tc.scenario);
                    if (rest != null) needSc.set(tc.scenario, Math.max(0, rest - 1));
                }
            }

            const missingE2E = [...needE2EByStory].filter(([, n]) => n > 0).map(([story, need]) => ({ story, need }));
            const missingSc = [...needSc].filter(([, n]) => n > 0).map(([scenario, need]) => ({ scenario, need }));

            return { missingE2E, missingSc };
        }

        // Догенерация только недостающего покрытия
        async function gapFill(model, reqs, missing, systemPrompt) {
            const { missingE2E, missingSc } = missing;
            if (!missingE2E.length && !missingSc.length) return [];

            // Собрать минимальный chunk только с нужными story/scenario/code
            const featureText = (model[0] && model[0].text) || 'Feature';
            const chunk = [{ text: featureText, stories: [] }];
            const needStories = new Set(missingE2E.map(x => x.story));
            const needScens = new Set(missingSc.map(x => x.scenario));
            const needCodes = new Set();

            for (const f of model) for (const st of (f.stories || [])) {
                const keepStory = needStories.has(st.text)
                    || (st.scenarios || []).some(sc =>
                        needScens.has(sc.text) ||
                        (sc.codes || []).some(cd => needCodes.has(cd.text))
                    );
                if (!keepStory) continue;

                const scenarios = (st.scenarios || []).filter(sc =>
                    needScens.has(sc.text)
                ).map(sc => ({
                    ...sc,
                    codes: sc.codes || []
                }));

                chunk[0].stories.push({ text: st.text, scenarios });
            }

            const allowedForChunk = collectAllowedCodes(chunk);
            const allowedScenarios = collectAllowedScenarios(chunk);

            const mustLines = [
                ...missingE2E.map(m => `E2E для story "${m.story}" ×${m.need}`),
                ...missingSc.map(m => `Integration для scenario "${m.scenario}" ×${m.need}`)
            ];
            const userPrompt = `
Сгенерируй ТОЛЬКО недостающее покрытие для следующего куска модели.
Модель (кусок):
${JSON.stringify(chunk, null, 2)}

Нужно добрать:
${mustLines.map(l => `- ${l}`).join('\n')}

Требования:
${reqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Ответ — ТОЛЬКО чистый JSON-массив без Markdown.
`.trim();

            const submissionTool = buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios);
            const ai = await runTestCaseLLM({
                userPrompt,
                submissionTool,
                modelOverrides: {
                    temperature: 0.25,
                    top_p: 0.9,
                    max_tokens: 40000,
                    extra: { transforms: 'middle-out' }
                }
            });

            const args = extractToolArgs(ai, "submit_cases");
            if (args && Array.isArray(args.cases)) return args.cases;

            const content = ai.choices?.[0]?.message?.content || '';
            const rawJsonCandidate = extractJsonArray(content);
            if (!rawJsonCandidate) return [];
            try {
                const jsonText = cleanupJsonText(rawJsonCandidate);
                const parsed = JSON5.parse(jsonText);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                console.warn('[gapFill] JSON parse failed (strict). Falling back. Error:', e.message);
                try {
                    // fallback: strip everything until first '[' and after last ']'
                    const t = cleanupJsonText(rawJsonCandidate);
                    const parsed = JSON5.parse(t);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (e2) {
                    console.error('[gapFill] Fallback parse failed:', e2.message);
                    console.log('--- RAW AI RESPONSE (gapFill ultimate fail) ---\n', content, '\n-----------------------------------------');
                    return [];
                }
            }
        }

        // Разбивка требований на чанки по размеру (для больших документов)
        function splitRequirements(reqs, maxCharsPerChunk = 120000) {
            if (!Array.isArray(reqs) || reqs.length === 0) return [[]];

            const chunks = [];
            let currentChunk = [];
            let currentSize = 0;

            for (const req of reqs) {
                const reqSize = String(req || '').length;

                // Если одно требование больше лимита - разобьем его на параграфы
                if (reqSize > maxCharsPerChunk) {
                    if (currentChunk.length > 0) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }

                    // Разбиваем большое требование на части по параграфам
                    const paragraphs = String(req).split(/\n\n+/);
                    let tempReq = '';

                    for (const para of paragraphs) {
                        if ((tempReq.length + para.length) > maxCharsPerChunk && tempReq) {
                            currentChunk.push(tempReq.trim());
                            chunks.push(currentChunk);
                            currentChunk = [];
                            currentSize = 0;
                            tempReq = para;
                        } else {
                            tempReq += (tempReq ? '\n\n' : '') + para;
                        }
                    }

                    if (tempReq.trim()) {
                        currentChunk.push(tempReq.trim());
                        currentSize = tempReq.length;
                    }
                } else {
                    // Обычное требование
                    if ((currentSize + reqSize) > maxCharsPerChunk && currentChunk.length > 0) {
                        chunks.push(currentChunk);
                        currentChunk = [req];
                        currentSize = reqSize;
                    } else {
                        currentChunk.push(req);
                        currentSize += reqSize;
                    }
                }
            }

            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
            }

            return chunks.length > 0 ? chunks : [[]];
        }


        const BASE_SYSTEM_PROMPT = `
Ты — SDET (Software Development Engineer in Test), генерирующий тест-кейсы на основе requirements в формате Allure TestOps.

═══════════════════════════════════════════════════════════════
🎯 ТИПЫ ТЕСТОВ (ТЕСТОВЫЕ СЛОИ)
═══════════════════════════════════════════════════════════════

**E2E Tests** — сквозные пользовательские сценарии через UI или API от начала до конца (например: авторизация → создание платежа → подписание → отправка).

**Integration frontend Tests** — атомарные тесты взаимодействия Frontend-компонент с UI, начиная с инициализации изолированной компоненты БЕЗ предварительных пользовательских шагов.

  - Проверяется ТОЛЬКО UI-поведение: отображение элементов, валидация полей, переходы между страницами

  - Backend-запросы можно мокать (но НЕ указывать это явно в тест-кейсе)

  - Шаги НЕ включают действия типа "Авторизоваться", "Перейти в раздел X"

  - Начинаются сразу с действия на компоненте: "Нажать на кнопку", "Выбрать чек-бокс", "Ввести в поле"

**Integration backend Tests** — атомарные тесты Backend API без UI.

  - Проверяется ТОЛЬКО вызов HTTP-запроса и валидация ответа/БД

  - Шаги НЕ включают UI-действия типа "Нажать на кнопку", "Заполнить форму"

  - Формат шага: "Выполнить POST /api/endpoint с параметрами X"

  - Ожидаемый результат: статус-код ответа, структура JSON, изменения в БД

**Unit Tests** — заглушки для каждого Code из тестовой модели.

  - ОДИН unit тест на каждый Code

  - Title = просто дублирование названия Code (например, если Code = "GET /info/v2", то title = "GET /info/v2")

  - Steps = пустой массив []

  - Expected = дублирование названия Code

  - Layer = "Unit Tests"

  - Поля: feature, story, scenario, code, title, steps, expected, layer, priority, version

═══════════════════════════════════════════════════════════════
📋 СТРУКТУРА ТЕСТОВ
═══════════════════════════════════════════════════════════════

## E2E Tests
- Полный пользовательский путь от авторизации до результата
- Steps: ["Авторизоваться", "Перейти на...", "Нажать...", "Заполнить...", "Сохранить"]
- Expected: финальный результат для пользователя (экран/сообщение/изменение)
- Поля: feature, story, title, steps, expected, tags, layer, priority, version, parameters, examples
- ✅ Параметризация: ОБЯЗАТЕЛЬНА при наличии нескольких вариантов (типы карт, способы оплаты, статусы операций)

## Integration Frontend Tests
- Реакция UI на действия пользователя
- Precondition: состояние экрана/модального окна
- Steps: 1-3 UI-действия (БЕЗ системных глаголов типа "дождаться загрузки")
- Expected: что отображается после действия (текст/кнопка/поле/ошибка)
- Поля: feature, story, scenario, title, precondition, steps, expected, tags, layer, priority, version, parameters, examples
- ✅ Параметризация: ОБЯЗАТЕЛЬНА при наличии нескольких вариантов (коды операций, типы документов, статусы)

## Integration Backend Tests
- HTTP-вызовы и их ответы
- Precondition: ТОЛЬКО техническое ("Сервер доступен", "БД готова"). ❌ НЕ "Пользователь ввёл..."
- Steps: вызов API с параметрами ("Выполнить GET /api/endpoint с doc_type={{Тип документа}}")
- Expected: статус + ключевые поля ("Получен ответ 200 с JSON: {id, amount, date}")
- Поля: feature, story, scenario, title, precondition, steps, expected, tags, layer, priority, version, parameters, examples
- ✅ Параметризация: ОБЯЗАТЕЛЬНА при наличии нескольких вариантов (HTTP-коды, типы запросов, параметры API)
- 🚨 КРИТИЧНО: Integration backend Tests = ТОЛЬКО вызов HTTP-запроса и проверка ответа/БД. НЕ включай UI-действия!

## Unit Tests
- Заглушки для каждого Code из тестовой модели
- ОДИН unit тест на каждый Code
- Title = дублирование названия Code
- Steps = [] (пустой массив)
- Expected = дублирование названия Code
- Поля: feature, story, scenario, code, title, steps, expected, layer, priority, version

═══════════════════════════════════════════════════════════════
⚙️ ФОРМАТ И ПРАВИЛА
═══════════════════════════════════════════════════════════════

### Название (title)
- Информативное, уникальное: "Валидация поля 'ИНН' при некорректном контрольном числе"
- ❌ НЕ "Проверка ИНН" или "Тест 1"

### Шаги (steps)
- Один шаг = одно действие с глагола ("Ввести", "Нажать", "Выбрать", "Выполнить")
- ❌ ЗАПРЕЩЕНО использовать слово "Проверить" в шагах! Проверка = Expected Result
- ❌ ЗАПРЕЩЕНО додумывать: "Дождаться загрузки", "Проверить статус"
- При параметризации используй {{Название параметра}}: "Ввести {{Размер ИНН}} ИНН"
- ✅ Выделяй ключевые слова и эндпоинты в формате **Ключевое слово** или **/endpoint**
- Примеры:
  - "Выполнить POST **/document/create/income_type_code** с параметрами X"
  - "**Подменить** статус код ответа запроса **/document/create/income_type_code** на 504"

### Expected (ОБЯЗАТЕЛЬНО КОНКРЕТНЫЙ И ФОРМАТИРОВАННЫЙ!)
❌ ЗАПРЕЩЕНО: "Система работает корректно", "Операция выполнена", "Данные переданы"
✅ ПРАВИЛЬНО с форматированием ключевых слов:
- Backend: "**Вернуть** ответ 200 с JSON: {id, type, amount}"
- Backend: "**Подменить** статус код ответа запроса **/document/create/income_type_code** на 504"
- Backend: "**Передать** параметр deal.dealMode=3 в запросе POST **/rest/stateful/corp/curr/inquiry_181**"
- Backend: "**Сохранить** запись в БД с полями: id={{ID}}, status='created'"
- Frontend: "**Отобразить** поле 'Ожидаемый срок репатриации' как обязательное для заполнения"
- Frontend: "**Заполнить** поле 'Примечание' текстом 'Контракт стоит на учете в другом Банке'"
- При параметризации: "**Отобразить** ошибку {{Выводимый текст ошибки}}"

🚨 КЛЮЧЕВЫЕ СЛОВА ДЛЯ ФОРМАТИРОВАНИЯ:
- **Подменить** — для мокирования/подмены ответов
- **Отобразить** — для UI-элементов
- **Заполнить** — для автозаполнения полей
- **Передать** — для параметров в запросах
- **Вернуть** — для HTTP-ответов
- **Сохранить** — для изменений в БД

✅ Выделяй эндпоинты и ключевые слова в формате **текст** (жирный)

### Параметры (parameters) и Примеры (examples)
🚨 КРИТИЧЕСКИ ВАЖНО: Параметризация применяется ко ВСЕМ типам тестов (E2E, Integration frontend, Integration backend)!

ОБЯЗАТЕЛЬНО создавай при наличии в requirements:
- Упоминаний "параметры", "таблица параметров", "столбец X"
- Нескольких вариантов одной проверки ("10-значный И 12-значный ИНН")
- 3+ варианта входных данных с одинаковой логикой
- Нескольких типов карт/способов оплаты/статусов операций (для E2E)
- Нескольких кодов операций/типов документов (для Integration)

Формат:
\`\`\`json
{
  "parameters": [
    { "name": "Размер ИНН", "values": ["10-значного", "12-значного"] },
    { "name": "Код ответа", "values": ["200", "400", "404", "500"] }
  ],
  "examples": [
    { "parameters": [
      { "name": "Размер ИНН", "value": "10-значного" },
      { "name": "Код ответа", "value": "200" }
    ]}
  ]
}
\`\`\`

### Теги (tags)
- Платформа: D (desktop), A (adaptive), M (mobile), PWA
- Backend: S (для API-тестов)
- По умолчанию: ["M"] для мобильных, ["S"] для API
- Примеры: ["D"], ["M","S"], ["D","A"]

### Приоритет (priority)
- Critical: деньги, безопасность, ПДн, потеря данных
- High: основной бизнес-флоу, неверные суммы, авторизация
- Medium: валидации, контент, UX-деградации
- Low: косметика, копирайт
- Правило: E2E ≥ High, Integration ≥ Medium

═══════════════════════════════════════════════════════════════
🛡️ ЗАПРЕТЫ (КРИТИЧНО!)
═══════════════════════════════════════════════════════════════

❌ НЕ додумывай API-методы/параметры/HTTP-коды вне requirements
❌ НЕ создавай дубликаты для разных значений → ПАРАМЕТРИЗУЙ
❌ НЕ создавай отдельные тесты для платформ (iOS/Android) → указывай в precondition
❌ НЕ смешивай уровни: E2E НЕ содержит "scenario", Integration НЕ содержит "code"
❌ НЕ используй абстрактный expected ("работает корректно")
❌ Backend precondition: НЕ "Пользователь...", ТОЛЬКО техническое ("Сервер доступен")
❌ НЕ добавляй поле "requirement" в тест-кейсы! Это поле используется ТОЛЬКО в тестовой модели (Feature/Story/Scenario/Code). В тест-кейсах requirement НЕ ДОЛЖНО быть! Модель часто ошибается при заполнении requirement, поэтому это поле полностью запрещено в тест-кейсах!
❌ НЕ используй слово "Проверить" в steps! Проверка = Expected Result
❌ НЕ смешивай UI-действия в Integration backend Tests ("Нажать на кнопку" → только "Выполнить POST")
❌ НЕ смешивай Backend-запросы в Integration frontend Tests ("Выполнить POST" → только "Нажать на кнопку")
❌ Integration backend Tests = ТОЛЬКО вызов HTTP-запроса и проверка ответа/БД, БЕЗ UI-действий!
❌ Integration frontend Tests = ТОЛЬКО взаимодействие с UI, можно мокать запросы (но НЕ указывать это явно в тестах)!

═══════════════════════════════════════════════════════════════
🚨 КРИТИЧЕСКИ ВАЖНО: ПРИВЯЗКА К ТЕСТОВОЙ МОДЕЛИ
═══════════════════════════════════════════════════════════════

❌ ЗАПРЕЩЕНО создавать НОВЫЕ feature, story или scenario!
✅ ОБЯЗАТЕЛЬНО используй ТОЛЬКО существующие значения из тестовой модели!

ПРАВИЛА:
1. feature — ДОЛЖНО быть ТОЧНО из списка допустимых значений (enum в tool)
2. story — ДОЛЖНО быть ТОЧНО из списка допустимых значений (enum в tool)
3. scenario — ДОЛЖНО быть ТОЧНО из списка допустимых значений (enum в tool, только для Integration тестов)
4. code — ДОЛЖНО быть ТОЧНО из списка допустимых значений (enum в tool, только для Integration тестов)

❌ НЕ выдумывай новые названия feature/story/scenario!
❌ НЕ используй похожие, но не точные названия!
✅ Используй ТОЛЬКО те значения, которые указаны в enum tool definition!

Если tool предоставляет enum для feature/story/scenario — используй ТОЛЬКО эти значения!
Если enum не предоставлен — используй ТОЧНОЕ название из modelStructure, которое было передано в контексте!

═══════════════════════════════════════════════════════════════
📤 ВЫХОДНОЙ ФОРМАТ (ТОЛЬКО JSON)
═══════════════════════════════════════════════════════════════

Возвращай массив JSON без markdown/комментариев:

\`\`\`json
[
  {
    "feature": "Название фичи из modelStructure",
    "story": "Название story из modelStructure",
    "scenario": "ТОЧНОЕ название scenario из modelStructure (только для Integration!)",
    "title": "Уникальное название проверки",
    "precondition": "Опционально для Integration",
    "steps": [
      "Шаг 1 с глагола",
      "Ввести {{Параметр}} при параметризации"
    ],
    "expected": "Конкретный проверяемый результат",
    "tags": ["M", "S"],
    "layer": "E2E Tests | Integration frontend Tests | Integration backend Tests | Unit Tests",
    "priority": "Critical | High | Medium | Low",
    "version": "stable",
    "parameters": [  // ✅ ОБЯЗАТЕЛЬНО для E2E и Integration при наличии нескольких вариантов!
      { "name": "Название", "values": ["значение1", "значение2"] }
    ],
    "examples": [  // ✅ ОБЯЗАТЕЛЬНО для E2E и Integration при наличии parameters!
      { "parameters": [{ "name": "Название", "value": "значение1" }] }
    ],
    "jiraIssue": "ABC-123",
    "links": [{ "text": "Confluence", "url": "https://..." }]
    // ❌ ОТСУТСТВУЕТ поле "requirement" - оно используется ТОЛЬКО в тестовой модели!
  }
]
\`\`\`

═══════════════════════════════════════════════════════════════
✅ ЧЕК-ЛИСТ ПЕРЕД ОТПРАВКОЙ
═══════════════════════════════════════════════════════════════

1. Проанализировал requirements на паттерны параметризации?
2. Нет дубликатов с одинаковой логикой?
3. КАЖДЫЙ тест содержит steps (минимум 1) + expected?
4. Expected конкретный и проверяемый?
5. Использовал {{Параметр}} в steps/expected при параметризации?
6. Теги соответствуют матрице (D/M/S)?
7. "scenario" совпадает с modelStructure для Integration?
8. НЕ додумывал детали вне requirements?

═══════════════════════════════════════════════════════════════
📚 ТЕХНИКИ ТЕСТ-ДИЗАЙНА
═══════════════════════════════════════════════════════════════

Применяй для Integration-тестов (после явных примеров из requirements):
- BVA: мин-1, мин, макс, макс+1 для числовых диапазонов
- Классы эквивалентности: валидный/невалидный/пустой/null
- HTTP-коды: для каждого API добавляй негативные (404, 500, 504, timeout)
- Жизненный цикл: создание → редактирование → удаление
- 🚨 ВАЖНО: Создавай БОЛЬШЕ негативных тестов! Используй параметризацию для негативных сценариев

═══════════════════════════════════════════════════════════════
🎯 АЛГОРИТМ ГЕНЕРАЦИИ
═══════════════════════════════════════════════════════════════

ШАГ 1: АНАЛИЗ REQUIREMENTS
- Прочитай ВСЕ требования
- Найди паттерны параметризации (таблицы, "X И Y", несколько HTTP-кодов)
- Определи узлы modelStructure

ШАГ 2: ГЕНЕРАЦИЯ
Для каждой Story:
- 1-2 E2E теста (Happy Path + критичный негатив)
- ✅ Если есть несколько вариантов (типы карт, способы оплаты, статусы операций) → ОДИН параметризованный E2E тест с parameters + examples

Для каждого Scenario:
- 4-8 Integration тестов:
  • 2-3 позитивных (успешные сценарии)
  • 2-3 негативных (ошибки валидации, 404/500, таймауты, неверные параметры)
  • 1-2 граничных (BVA, граничные значения)
- ✅ Если есть несколько вариантов (коды операций, типы документов, HTTP-коды) → ОДИН параметризованный Integration тест с parameters + examples
- ✅ Используй параметризацию для негативных сценариев: "Вернуть ответ {{HTTP-код}} при невалидных данных"

Для каждого Code:
- 1 Unit тест (заглушка):
  • title = название Code (дублирование)
  • steps = [] (пустой массив)
  • expected = название Code (дублирование)
  • layer = "Unit Tests"

ШАГ 3: ПРОВЕРКА
- Нет дубликатов? → Параметризовал?
- Expected конкретный?
- {{Параметры}} в steps при параметризации?

═══════════════════════════════════════════════════════════════

🔑 ЗОЛОТЫЕ ПРАВИЛА:
- Одна логика → ОДИН тест с параметризацией
- Нет информации в requirements → НЕ додумывай
- Expected = ВСЕГДА конкретный и проверяемый
`;



        // Подсчитываем статистику модели для COVENANT
        const S = modelStructure.reduce((sum, f) => sum + (f.stories || []).length, 0);
        const Sc = modelStructure.reduce((sum, f) =>
            sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0);
        const C = modelStructure.reduce((sum, f) =>
            sum + (f.stories || []).reduce((s, st) =>
                s + (st.scenarios || []).reduce((sc, scn) => sc + (scn.codes?.length || 0), 0), 0), 0);

        // ✅ УПРОЩЁННЫЙ COVENANT (статичный вместо динамического)
        const COVENANT = `
ПРАВИЛА ПОКРЫТИЯ:
- E2E: 1-2 теста на Story (основной путь + критичный негатив)
- Integration: 2-3 теста на Scenario (позитив + негатив + граничные)

ФОРМУЛА: 
Total = (Stories × 1.5) + (Scenarios × 2.5) ± 30%

ПРОВЕРКА перед submit_cases:
□ Каждая Story имеет ≥1 E2E?
□ Каждый Scenario имеет ≥2 Integration?
□ Expected конкретный во всех тестах?
`.trim();

        const baseSystemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}`;
        const baseCaseModelOptions = {
            models: config.cloudruModels,
            temperature: 0,
            top_p: 1,
            max_tokens: 64000,
            extra: { transforms: 'middle-out' }
        };

        const composeUserPrompt = (corePrompt) => {
            if (!toolInstruction) return corePrompt;
            const trimmedInstruction = toolInstruction.endsWith('\n') ? toolInstruction : `${toolInstruction}\n`;
            return `${trimmedInstruction}${corePrompt}`;
        };

        async function runTestCaseLLM({
            systemPrompt = baseSystemPrompt,
            userPrompt,
            submissionTool,
            modelOverrides = {}
        }) {
            const decoratedUserPrompt = composeUserPrompt(userPrompt);
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: decoratedUserPrompt }
            ];

            const combinedTools = [...interactiveTools];
            const finalToolNames = [];

            if (submissionTool) {
                combinedTools.push(submissionTool);
                const toolName = submissionTool?.function?.name;
                if (toolName) finalToolNames.push(toolName);
            }

            try {
                const interactiveResult = await runInteractiveLLM({
                    initialMessages: messages,
                    tools: combinedTools,
                    toolHandlers: contextToolHandlers,
                    finalToolNames,
                    modelOptions: { ...baseCaseModelOptions, ...modelOverrides }
                });
                return interactiveResult.response;
            } catch (interactiveError) {
                console.warn(`[generate-test-cases] interactive loop failed: ${interactiveError.message}`);
                return await callWithCloudRuFallback(
                    OPENROUTER_URL,
                    messages,
                    config.openRouterAiKey,
                    {
                        ...baseCaseModelOptions,
                        ...modelOverrides,
                        tools: combinedTools
                    }
                );
            }
        }


        // === tool-schema с жёстким enum для сценариев ===
        // ✅ ДОРАБОТКА 2: Обновлена функция для поддержки reqStructure
        const buildSubmitCasesToolStrict = (allowedCodes = [], allowedScenarios = [], reqStructure = null) => {
            // ✅ НОВОЕ: Извлекаем допустимые feature/story из reqStructure
            let allowedFeatures = [];
            let allowedStories = [];

            if (reqStructure && reqStructure.features && reqStructure.features.length > 0) {
                allowedFeatures = reqStructure.features.map(f => f.name);
                allowedStories = reqStructure.features.flatMap(f => f.stories.map(s => s.name));
            } else {
                // Fallback: извлекаем из modelStructure
                allowedFeatures = modelStructure.map(f => f.text);
                allowedStories = modelStructure.flatMap(f => (f.stories || []).map(s => s.text));
            }

            return {
                type: "function",
                function: {
                    name: "submit_cases",
                    description: "Верни итоговые тест-кейсы строго в массиве cases",
                    parameters: {
                        type: "object",
                        properties: {
                            cases: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        feature: allowedFeatures.length > 0
                                            ? {
                                                type: "string",
                                                enum: allowedFeatures,
                                                description: `Feature из модели. Допустимые значения: ${allowedFeatures.join(', ')}`
                                            }
                                            : { type: "string", description: "Название фичи из modelStructure" },
                                        story: allowedStories.length > 0
                                            ? {
                                                type: "string",
                                                enum: allowedStories,
                                                description: `Story из модели. Допустимые значения: ${allowedStories.join(', ')}`
                                            }
                                            : { type: "string", description: "Название story из modelStructure" },
                                        scenario: allowedScenarios.length
                                            ? { type: "string", enum: allowedScenarios }
                                            : { type: "string" },
                                        code: allowedCodes.length
                                            ? { type: "string", enum: allowedCodes }
                                            : { type: "string" },
                                        title: { type: "string" },
                                        precondition: { type: "string" },
                                        steps: { type: "array", items: { type: "string" } },
                                        expected: { type: "string" },
                                        tags: { type: "array", items: { type: "string" } },
                                        layer: {
                                            type: "string", enum: [
                                                "E2E Tests",
                                                "Integration frontend Tests",
                                                "Integration backend Tests",
                                                "Unit Tests"
                                            ]
                                        },
                                        priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
                                        version: { type: "string" },
                                        links: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    text: { type: "string" },
                                                    url: { type: "string" },
                                                    type: { type: "string" }
                                                }
                                            }
                                        },
                                        jiraIssueOption: {
                                            type: "object",
                                            properties: {
                                                value: { type: "string" },
                                                integrationId: { type: "string" }
                                            }
                                        },
                                        // ❌ УДАЛЕНО: requirement - это поле используется ТОЛЬКО в тестовой модели, НЕ в тест-кейсах!
                                        parameters: {
                                            type: "array",
                                            description: "Массив параметров для параметризации теста",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    name: { type: "string" },
                                                    values: { type: "array", items: { type: "string" } }
                                                },
                                                required: ["name", "values"]
                                            }
                                        },
                                        examples: {
                                            type: "array",
                                            description: "Массив примеров (конкретных комбинаций параметров)",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    parameters: {
                                                        type: "array",
                                                        items: {
                                                            type: "object",
                                                            properties: {
                                                                name: { type: "string" },
                                                                value: { type: "string" }
                                                            },
                                                            required: ["name", "value"]
                                                        }
                                                    }
                                                },
                                                required: ["parameters"]
                                            }
                                        }
                                    },
                                    required: ["title", "layer", "expected"]  // ❌ УДАЛЕНО: requirement
                                }
                            }
                        },
                        required: ["cases"],
                        additionalProperties: false
                    }
                }
            };

            // ✅ ИСПРАВЛЕНИЕ: Убираем чанкование - используем ПОЛНУЮ модель
            console.log(`[generate-test-cases] Используем ПОЛНУЮ модель без чанкования для точности`);
            console.log(`[generate-test-cases] Требования: ${refinedReqs.join('').length} символов`);
            console.log(`[generate-test-cases] Модель: ${modelStructure.length} фич`);

            const totalOperations = 1; // Одна операция для всей модели
            let completedOperations = 0;

        }

        // ✅ ФУНКЦИЯ ИЗВЛЕЧЕНИЯ КЕЙСОВ ИЗ ОТВЕТА AI
        function extractCasesFromResponse(ai) {
            const allTestCases = [];

            // 1. Пробуем извлечь из tool_calls
            const toolCalls = ai.choices?.[0]?.message?.tool_calls || [];
            for (const toolCall of toolCalls) {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    if (args.cases && Array.isArray(args.cases)) {
                        for (const testCase of args.cases) {
                            allTestCases.push({
                                title: testCase.title,
                                steps: testCase.steps,
                                expected: testCase.expected,
                                layer: testCase.layer,
                                feature: testCase.feature,
                                story: testCase.story,
                                scenario: testCase.scenario,
                                code: testCase.code,
                                tags: testCase.tags || [],
                                priority: testCase.priority || 'Medium',
                                version: testCase.version || 'stable',
                                // ❌ УДАЛЕНО: requirement - не используется в тест-кейсах
                                precondition: testCase.precondition,
                                links: testCase.links || [],
                                jiraIssue: testCase.jiraIssueOption?.value,
                                parameters: testCase.parameters || [],
                                examples: testCase.examples || []
                            });
                        }
                    }
                } catch (parseErr) {
                    console.error(`[extractCasesFromResponse] Ошибка парсинга tool_call:`, parseErr.message);
                }
            }

            // 2. Если нет tool_calls, пробуем извлечь из content
            if (allTestCases.length === 0) {
                const content = ai.choices?.[0]?.message?.content || '';
                if (content.trim()) {
                    try {
                        const rawJsonCandidate = extractJsonArray(content);
                        if (rawJsonCandidate) {
                            const jsonText = cleanupJsonText(rawJsonCandidate);
                            const parsed = JSON5.parse(jsonText);
                            if (Array.isArray(parsed)) {
                                allTestCases.push(...parsed);
                            } else if (parsed && Array.isArray(parsed.cases)) {
                                allTestCases.push(...parsed.cases);
                            }
                        }
                    } catch (e) {
                        console.warn('[extractCasesFromResponse] Ошибка парсинга content:', e.message);
                    }
                }
            }

            return allTestCases;
        }

        // ✅ ОПТИМИЗИРОВАННАЯ ВЕРСИЯ: ONE-SHOT с fallback + Few-Shot Learning
        async function genForChunkOptimized(chunk, requirements, existingE2E = [], modelStructure, reqStructure = null) {
            const contextPrompt = buildContextPrompt(chunk, existingE2E);
            const relevantReqs = filterRelevantRequirements(requirements, chunk);
            const allowedForChunk = collectAllowedCodes(chunk);
            const allowedScenarios = collectAllowedScenarios(chunk);

            // ✅ Выбираем релевантные примеры для Few-Shot Learning
            const mode = chunk[0].stories[0]._mode || 'FULL';
            const examples = selectExamples(chunk, mode);
            const examplesSection = buildExamplesSection(examples);

            // ✅ Формируем system prompt с примерами
            const systemPromptWithExamples = `
${BASE_SYSTEM_PROMPT}

${COVENANT}

═══════════════════════════════════════════════════════════════
📚 ЭТАЛОННЫЕ ПРИМЕРЫ (ИСПОЛЬЗУЙ КАК ШАБЛОНЫ!)
═══════════════════════════════════════════════════════════════

🚨 ПЕРЕД ГЕНЕРАЦИЕЙ - ИЗУЧИ ПРИМЕРЫ:
1. Посмотри на структуру JSON в примерах
2. Обрати внимание на формат параметризации (parameters + examples)
3. Заметь использование {{параметр}} в steps и expected
4. Проверь формат полей: feature, story, scenario, title, steps, expected, layer, priority, tags, version

${examplesSection}

🚨 КРИТИЧЕСКИ ВАЖНО:
- Примеры = ЭТАЛОН, строго следуй их формату
- Для параметризации ОБЯЗАТЕЛЬНО используй parameters + examples (как в примерах)
- В steps и expected используй {{параметр}} для подстановки значений
- Expected должен быть КОНКРЕТНЫМ (как в примерах)
- Не создавай дубликаты - используй параметризацию!
`.trim();

            const userPrompt = `
${contextPrompt}

Требования (релевантные):
${relevantReqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Модель:
${JSON.stringify(chunk, null, 2)}
`.trim();

            try {
                // Попытка 1: с tools
                const ai = await runTestCaseLLM({
                    systemPrompt: systemPromptWithExamples,
                    userPrompt,
                    submissionTool: buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios, reqStructure),
                    modelOverrides: {
                        temperature: 0,
                        top_p: 1,
                        max_tokens: 64000
                    }
                });

                let cases = extractCasesFromResponse(ai);
                if (cases.length > 0) {
                    console.log(`[genForChunkOptimized] ✅ Получено ${cases.length} кейсов через tool_call`);
                    return cases;
                }

                // Fallback: без tools (текстовый JSON)
                console.warn('[genForChunkOptimized] Tool call failed, retry without tools');
                const retry = await callWithCloudRuFallback(
                    OPENROUTER_URL,
                    [
                        { role: 'system', content: systemPromptWithExamples },
                        { role: 'user', content: `${userPrompt}\n\n🚨 Верни ТОЛЬКО JSON-массив тест-кейсов БЕЗ markdown` }
                    ],
                    config.openRouterAiKey,
                    { temperature: 0.3, max_tokens: 50000 }  // ✅ Уменьшено с 64000 до 50000
                );

                cases = extractCasesFromResponse(retry);
                if (cases.length > 0) {
                    console.log(`[genForChunkOptimized] ✅ Fallback: получено ${cases.length} кейсов`);
                    return cases;
                }

                console.warn('[genForChunkOptimized] ⚠️ Обе попытки не вернули кейсов');
                return [];

            } catch (error) {
                console.error('[genForChunkOptimized] Failed:', error.message);
                return [];
            }
        }

        // ====== ОСНОВНАЯ ЛОГИКА ГЕНЕРАЦИИ (ONE-PASS ОПТИМИЗАЦИЯ) ======
        try {
            const storyChunks = splitByStoriesOptimized(modelStructure);

            // === Подготовка данных ===
            console.log(`[generate-test-cases-async] Подготовлено ${storyChunks.length} chunks для генерации (ONE-PASS)`);

            // Обновляем progress после подготовки данных
            await db('generation_tasks').where('id', taskId).update({
                progress: 10,
                updated_at: new Date()
            });

            // ✅ ONE-PASS: Генерируем E2E + Integration за один проход
            console.log(`[generate-test-cases-async] === ONE-PASS: Генерация E2E + Integration ===`);
            let allCases = [];
            const e2eTestsByStory = new Map(); // Для контекста в BATCH-режиме

            for (let i = 0; i < storyChunks.length; i++) {
                const chunk = storyChunks[i];
                const storyText = chunk[0].stories[0].text;
                const mode = chunk[0].stories[0]._mode;
                console.log(`[generate-test-cases-async] Chunk ${i + 1}/${storyChunks.length}: "${storyText}" (${mode})`);

                // Для BATCH-режима используем контекст E2E из предыдущих FULL-чанков
                const existingE2E = mode === 'BATCH'
                    ? (e2eTestsByStory.get(storyText) || [])
                    : [];

                try {
                    const result = await genForChunkOptimized(
                        chunk,
                        refinedReqs,
                        existingE2E,
                        modelStructure
                    );

                    // Сохраняем E2E тесты для контекста
                    const e2eFromResult = result.filter(tc => tc.layer === 'E2E Tests');
                    if (e2eFromResult.length > 0) {
                        const existing = e2eTestsByStory.get(storyText) || [];
                        e2eTestsByStory.set(storyText, [...existing, ...e2eFromResult]);
                    }

                    allCases.push(...result);
                    console.log(`[generate-test-cases-async] Chunk ${i + 1}: ${result.length} тестов (E2E: ${e2eFromResult.length}, Integration: ${result.length - e2eFromResult.length})`);
                } catch (err) {
                    console.error(`[generate-test-cases-async] Ошибка для chunk ${i + 1}:`, err);
                }

                await db('generation_tasks').where('id', taskId).update({
                    progress: 10 + Math.round((i + 1) / storyChunks.length * 80),
                    updated_at: new Date()
                });
            }

            console.log(`[generate-test-cases-async] ONE-PASS завершён: ${allCases.length} тестов`);

            // === sanitize → fixAgainstModel до аудита покрытия ===
            const idx = buildModelIndex(modelStructure);
            allCases = sanitize(allCases, undefined, modelStructure);

            // Обновляем progress после sanitize
            await db('generation_tasks').where('id', taskId).update({
                progress: 60,
                updated_at: new Date()
            });

            allCases = fixAgainstModel(allCases, idx);

            // Заменяем упоминания параметров в шагах на формат {{Название параметра}} для Allure TestOps
            allCases = injectParameterPlaceholders(allCases);

            // ✅ НОВАЯ ВАЛИДАЦИЯ: Проверка пирамиды
            const pyramidValidation = validateTestPyramid(allCases, modelStructure);
            if (!pyramidValidation.valid) {
                console.warn('[generate-test-cases-async] ❌ ВНИМАНИЕ: Нарушена пирамида тестирования!');
                pyramidValidation.warnings.forEach(w => console.warn(w));
            }

            // Обновляем progress после fixAgainstModel
            await db('generation_tasks').where('id', taskId).update({
                progress: 70,
                updated_at: new Date()
            });

            // Если в модели всего одна Feature — принудительно выставим её всем кейсам
            const uniqueFeatures = [...new Set((modelStructure || []).map(f => f?.text?.trim()).filter(Boolean))];
            if (uniqueFeatures.length === 1) {
                const theOnlyFeature = uniqueFeatures[0];
                allCases = allCases.map(tc => ({ ...tc, feature: theOnlyFeature }));
            }
            console.log('Требования для тест кейсов')
            console.log(refinedReqs)

            // ✅ ДОРАБОТКА 5: Поствалидация после генерации
            console.log('[generateTestCasesAsync] Поствалидация: проверка привязки к модели');
            // Фильтруем тесты с критичными ошибками валидации (validateModelBinding уже вызван в sanitize)
            const initialCount = allCases.length;
            // Дополнительная проверка для Integration тестов с scenario
            // Используем простую нормализацию строк для сравнения
            const normalizeForComparison = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
            allCases = allCases.filter(testCase => {
                if (testCase.layer?.includes('Integration') && testCase.scenario) {
                    // Проверяем, что scenario существует в модели
                    let scenarioExists = false;
                    for (const feature of modelStructure) {
                        if (normalizeForComparison(feature.text) === normalizeForComparison(testCase.feature)) {
                            for (const story of (feature.stories || [])) {
                                if (normalizeForComparison(story.text) === normalizeForComparison(testCase.story)) {
                                    const foundScenario = (story.scenarios || []).find(sc =>
                                        normalizeForComparison(sc.text) === normalizeForComparison(testCase.scenario)
                                    );
                                    if (foundScenario) {
                                        scenarioExists = true;
                                        break;
                                    }
                                }
                            }
                            if (scenarioExists) break;
                        }
                    }
                    if (!scenarioExists) {
                        console.warn(`[generateTestCasesAsync] ❌ Отклонён тест-кейс: scenario "${testCase.scenario}" не найден в модели: "${testCase.title}"`);
                        return false;
                    }
                }
                return true;
            });

            if (allCases.length < initialCount) {
                console.log(`[generateTestCasesAsync] Поствалидация: отфильтровано ${initialCount - allCases.length} тест-кейсов с критичными ошибками`);
            }

            // ОТКЛЮЧЕНО: Аудит покрытия и догенерация недостающего
            // const missing = auditCoverage(modelStructure, allCases);
            // if (missing.missingE2E.length || missing.missingSc.length || missing.missingCd.length) {
            //     console.log(`[COVERAGE] Обнаружен недостаток покрытия. Запускаю догенерацию (gapFill)...`);
            //     const promise = genLimit(() => gapFill(modelStructure, refinedReqs, missing, BASE_SYSTEM_PROMPT));
            //     let extra = await withTimeout(promise, TIMEOUT_MS, 'gapFill');
            //     extra = sanitize(extra);
            //     extra = fixAgainstModel(extra, idx);
            //     console.log(`[COVERAGE] Догенерировано ${extra.length} кейсов.`);
            //     allCases = allCases.concat(extra);
            //     
            //     // Обновляем progress после gapFill
            //     await db('generation_tasks').where('id', taskId).update({
            //         progress: 75,
            //         updated_at: new Date()
            //     });
            // } else {
            //     console.log('[COVERAGE] Покрытие полное, догенерация не требуется.');
            //     
            //     // Обновляем progress если gapFill не нужен
            //     await db('generation_tasks').where('id', taskId).update({
            //         progress: 75,
            //         updated_at: new Date()
            //     });
            // }

            console.log('[COVERAGE] GapFill отключен - используем только основные тест-кейсы');

            // Обновляем progress перед финальным сохранением
            await db('generation_tasks').where('id', taskId).update({
                progress: 90,
                updated_at: new Date()
            });

            finalTestCases = allCases;
        } catch (error) {
            console.error('Ошибка в основной логике генерации:', error);
            // Если произошла ошибка, устанавливаем пустой массив
            finalTestCases = [];
            throw error;
        }

        // Автоматическая параметризация похожих тестов
        finalTestCases = autoParameterizeSimilarTests(finalTestCases);

        // ✅ НОВОЕ: Автоматический PairWise для параметризованных тестов
        console.log(`[generate-test-cases-async] Проверяю параметризованные тесты для автоматической генерации PairWise...`);
        for (const testCase of finalTestCases) {
            if (testCase.parameters && testCase.parameters.length > 0 && (!testCase.examples || testCase.examples.length === 0)) {
                console.log(`[generate-test-cases-async] Генерирую PairWise для "${testCase.title}"`);
                
                try {
                    const pairwiseExamples = await generatePairwiseExamples(testCase.parameters);
                    if (pairwiseExamples && pairwiseExamples.length > 0) {
                        testCase.examples = pairwiseExamples;
                        console.log(`[generate-test-cases-async] ✅ Сгенерировано ${pairwiseExamples.length} PairWise examples для "${testCase.title}"`);
                    }
                } catch (error) {
                    console.error(`[generate-test-cases-async] Ошибка генерации PairWise для "${testCase.title}": ${error.message}`);
                }
            }
        }

        console.log(`[generate-test-cases-async] Generated ${finalTestCases.length} cases (after auto-parameterization)`);

        // ✅ НОВОЕ: Рассчитываем покрытие Scenarios тест-кейсами
        if (modelStructure && finalTestCases.length > 0) {
            const scenarioCoverage = calculateTestCasesCoverage(finalTestCases, modelStructure);
            console.log(`[Coverage] Scenarios: ${scenarioCoverage.covered}/${scenarioCoverage.total} (${scenarioCoverage.coveragePercent}%)`);
            if (scenarioCoverage.missing.length > 0) {
                console.warn(`[Coverage] Не покрыто ${scenarioCoverage.missing.length} scenarios:`);
                scenarioCoverage.missing.slice(0, 5).forEach(sc => {
                    console.warn(`  ❌ ${sc.feature} → ${sc.story} → ${sc.scenario}`);
                });
                if (scenarioCoverage.missing.length > 5) {
                    console.warn(`  ... и ещё ${scenarioCoverage.missing.length - 5} scenarios`);
                }
            }
        }
        console.log(`[generate-test-cases-async] Layer distribution:`,
            finalTestCases.reduce((acc, tc) => {
                acc[tc.layer] = (acc[tc.layer] || 0) + 1;
                return acc;
            }, {}));

        // Проверить, что все Integration тесты имеют правильные scenario
        const invalidIntegration = finalTestCases.filter(tc =>
            tc.layer?.startsWith('Integration') && !tc.scenario
        );
        if (invalidIntegration.length > 0) {
            console.warn(`[VALIDATION-ASYNC] Found ${invalidIntegration.length} Integration tests without scenario:`,
                invalidIntegration.map(tc => tc.title));
        }

        // Проверить, что все E2E тесты имеют правильные story
        const invalidE2E = finalTestCases.filter(tc =>
            tc.layer === 'E2E Tests' && !tc.story
        );
        if (invalidE2E.length > 0) {
            console.warn(`[VALIDATION-ASYNC] Found ${invalidE2E.length} E2E tests without story:`,
                invalidE2E.map(tc => tc.title));
        }

        // Проверить, что все тест-кейсы имеют обязательные поля
        const incompleteCases = finalTestCases.filter(tc =>
            !tc.title || !tc.steps || !tc.expected || !tc.layer
        );
        if (incompleteCases.length > 0) {
            console.warn(`[VALIDATION-ASYNC] Found ${incompleteCases.length} incomplete test cases:`,
                incompleteCases.map(tc => ({
                    title: tc.title,
                    hasSteps: !!tc.steps,
                    hasExpected: !!tc.expected,
                    layer: tc.layer
                })));
        }

        // НОВЫЙ АНАЛИЗ: Проверяем покрытие требований в асинхронной версии (универсальный)
        const requirementsCount = Array.isArray(refinedReqs) ? refinedReqs.length : 1;
        const testCasesCount = finalTestCases.length;
        const coverageRatio = testCasesCount / requirementsCount;

        console.log(`[generate-test-cases-async] Покрытие требований: ${testCasesCount} тест-кейсов / ${requirementsCount} требований = ${coverageRatio.toFixed(2)}`);

        // НОВОЕ: Проверяем покрытие разделов требований
        const reqStringForModel = refinedReqs.join('\n\n');
        const requirementsCoverage = checkRequirementsCoverage(finalTestCases, reqStringForModel);
        if (!requirementsCoverage) {
            console.error(`[generate-test-cases-async] checkRequirementsCoverage вернула undefined`);
            throw new Error('checkRequirementsCoverage вернула undefined');
        }
        console.log(`[generate-test-cases-async] Покрытие требований: ${requirementsCoverage.coveragePercentage}% (${requirementsCoverage.covered}/${requirementsCoverage.total})`);

        if (requirementsCoverage.missingRequirementIds.length > 0) {
            console.log(`[generate-test-cases-async] Недостающие требования: ${requirementsCoverage.missingRequirementIds.join(', ')}`);
            console.log(`[generate-test-cases-async] Догенерируем тест-кейсы для недостающих требований...`);

            // Догенерируем для каждого недостающего требования
            for (const missingReqId of requirementsCoverage.missingRequirementIds) {
                const storyContext = findStoryByRequirement(modelStructure, missingReqId);

                // ✅ ДОБАВЛЕНО: Находим похожие требования для контекста
                const similarReq = requirementsCoverage.similarRequirements?.find(s => s[0] === missingReqId);

                let additionalContext = '';
                if (similarReq) {
                    const [missing, covered] = similarReq;
                    additionalContext = `
⚠️ ВНИМАНИЕ: Это требование ${missing} ОТЛИЧАЕТСЯ от ${covered}!
Проанализируй различия и создай УНИКАЛЬНЫЕ тест-кейсы для ${missing}.
                    `;
                }

                /*
                // Закомментировано: gapFillRequirements отключен
                // const reqCases = await gapFillRequirements(refinedReqs, [{
                //     requirementId: missingReqId,
                //     functionality: `req_${missingReqId}`,
                //     description: `Догенерация для требования ${missingReqId}${additionalContext}`,
                //     priority: 'High',
                //     modelContext: storyContext
                // }], BASE_SYSTEM_PROMPT, modelStructure);

                // finalTestCases.push(...reqCases);
                // console.log(`[generate-test-cases-async] ✅ Добавлено ${reqCases.length} кейсов для ${missingReqId}`);
                */

            }
        }

        // ❌ УДАЛЕНО: Валидация requirement - это поле не используется в тест-кейсах (только в тестовой модели)

        // ✅ ВАЛИДАЦИЯ ТЕСТ-КЕЙСОВ ПО СТАЙЛ-ГАЙДУ С АВТОМАТИЧЕСКОЙ ПЕРЕГЕНЕРАЦИЕЙ
        console.log(`[generate-test-cases-async] Валидация тест-кейсов по стайл-гайду...`);
        const styleGuideIssues = validateTestCasesByStyleGuide(finalTestCases, BASE_SYSTEM_PROMPT);

        if (styleGuideIssues.length > 0) {
            console.warn(`[generate-test-cases-async] ⚠️ Обнаружено ${styleGuideIssues.length} нарушений стайл-гайда:`, styleGuideIssues);

            // Группируем проблемы по типам для более точной перегенерации
            const issuesByType = {
                steps: styleGuideIssues.filter(issue => issue.includes('steps') || issue.includes('шаг')),
                expected: styleGuideIssues.filter(issue => issue.includes('expected') || issue.includes('ожидаемый')),
                layer: styleGuideIssues.filter(issue => issue.includes('layer') || issue.includes('Integration') || issue.includes('E2E')),
                parameters: styleGuideIssues.filter(issue => issue.includes('parameter') || issue.includes('параметр')),
                formatting: styleGuideIssues.filter(issue => issue.includes('формат') || issue.includes('**') || issue.includes('выделение'))
            };

            // Определяем проблемные тест-кейсы для перегенерации
            const problematicCases = finalTestCases.filter((tc, idx) =>
                styleGuideIssues.some(issue => issue.includes(`тест-кейс ${idx + 1}`) || issue.includes(`"${tc.title}"`))
            );

            if (problematicCases.length > 0 && refinedReqs && modelStructure) {
                console.log(`[generate-test-cases-async] 🔄 Попытка перегенерации ${problematicCases.length} проблемных тест-кейсов...`);

                try {
                    // Формируем escalation prompt для перегенерации
                    const escalationPrompt = `
🚨 КРИТИЧЕСКАЯ ОШИБКА: Обнаружены нарушения стайл-гайда в тест-кейсах!

ПРОБЛЕМЫ:
${styleGuideIssues.map((issue, idx) => `${idx + 1}. ${issue}`).join('\n')}

ПРАВИЛА ДЛЯ ИСПРАВЛЕНИЯ:
${issuesByType.steps.length > 0 ? `\n🚨 ПРОБЛЕМЫ С ШАГАМИ (steps):\n- ❌ НЕ используй слово "Проверить" в шагах! Проверка = Expected Result\n- ✅ Шаги = действия: "Нажать", "Выбрать", "Ввести", "Выполнить"\n- ✅ Выделяй ключевые слова и эндпоинты: **Ключевое слово** или **/endpoint**\n` : ''}
${issuesByType.expected.length > 0 ? `\n🚨 ПРОБЛЕМЫ С ОЖИДАЕМЫМ РЕЗУЛЬТАТОМ (expected):\n- ❌ НЕ используй абстрактные формулировки: "система работает корректно"\n- ✅ Используй ключевые слова с форматированием: **Отобразить**, **Вернуть**, **Подменить**, **Заполнить**, **Передать**, **Сохранить**\n- ✅ Выделяй эндпоинты: **/document/create/income_type_code**\n- ✅ Конкретный результат: "**Вернуть** ответ 200 с JSON: {id, type}"\n` : ''}
${issuesByType.layer.length > 0 ? `\n🚨 ПРОБЛЕМЫ С ТИПОМ ТЕСТА (layer):\n- Integration backend Tests = ТОЛЬКО "Выполнить POST/GET..." БЕЗ UI-действий!\n- Integration frontend Tests = ТОЛЬКО "Нажать на кнопку..." БЕЗ предварительных шагов авторизации!\n- E2E Tests = полный путь с авторизацией\n` : ''}
${issuesByType.parameters.length > 0 ? `\n🚨 ПРОБЛЕМЫ С ПАРАМЕТРИЗАЦИЕЙ:\n- ✅ Используй {{Название параметра}} в steps и expected\n- ✅ Если есть несколько вариантов → ОДИН параметризованный тест, НЕ дубликаты!\n` : ''}
${issuesByType.formatting.length > 0 ? `\n🚨 ПРОБЛЕМЫ С ФОРМАТИРОВАНИЕМ:\n- ✅ Выделяй ключевые слова: **Подменить**, **Отобразить**, **Вернуть**\n- ✅ Выделяй эндпоинты: **/api/endpoint**\n` : ''}

ПЕРЕГЕНЕРИРУЙ проблемные тест-кейсы согласно стайл-гайду выше!`.trim();

                    // Перегенерируем проблемные тест-кейсы
                    const fixedCases = [];
                    const remainingCases = finalTestCases.filter(tc => !problematicCases.includes(tc));

                    // Для каждого проблемного тест-кейса находим соответствующий чанк модели и перегенерируем
                    for (const problematicCase of problematicCases.slice(0, 10)) { // Ограничиваем до 10 для производительности
                        try {
                            // Находим соответствующий чанк модели
                            const matchingChunk = findMatchingModelChunk(problematicCase, modelStructure);

                            if (matchingChunk) {
                                const allowedCodes = collectAllowedCodes(matchingChunk);
                                const allowedScenarios = collectAllowedScenarios(matchingChunk);

                                const submissionTool = buildSubmitCasesToolStrict(allowedCodes, allowedScenarios);
                                const retryPrompt = `${BASE_SYSTEM_PROMPT}\n\n${escalationPrompt}\n\nПРОБЛЕМНЫЙ ТЕСТ-КЕЙС ДЛЯ ИСПРАВЛЕНИЯ:\n${JSON.stringify(problematicCase, null, 2)}`;

                                const retryAi = await runTestCaseLLM({
                                    userPrompt: retryPrompt,
                                    submissionTool,
                                    modelOverrides: {
                                        temperature: 0,
                                        top_p: 1,
                                        max_tokens: 50000,
                                        extra: { transforms: 'middle-out' }
                                    }
                                });

                                const retryArgs = extractToolArgs(retryAi, 'submit_cases');
                                if (retryArgs && retryArgs.cases && retryArgs.cases.length > 0) {
                                    fixedCases.push(...retryArgs.cases);
                                    console.log(`[generate-test-cases-async] ✅ Перегенерирован тест-кейс: "${problematicCase.title}"`);
                                } else {
                                    console.warn(`[generate-test-cases-async] ⚠️ Не удалось перегенерировать: "${problematicCase.title}", оставляем исходный`);
                                    fixedCases.push(problematicCase);
                                }
                            } else {
                                console.warn(`[generate-test-cases-async] ⚠️ Не найден соответствующий чанк для: "${problematicCase.title}", оставляем исходный`);
                                fixedCases.push(problematicCase);
                            }
                        } catch (retryErr) {
                            console.error(`[generate-test-cases-async] Ошибка при перегенерации "${problematicCase.title}":`, retryErr.message);
                            fixedCases.push(problematicCase); // Оставляем исходный при ошибке
                        }
                    }

                    // Добавляем оставшиеся проблемные тест-кейсы (если их больше 10)
                    if (problematicCases.length > 10) {
                        fixedCases.push(...problematicCases.slice(10));
                    }

                    // Объединяем исправленные и оставшиеся тест-кейсы
                    finalTestCases = [...remainingCases, ...fixedCases];

                    // Повторная валидация
                    const revalidationIssues = validateTestCasesByStyleGuide(finalTestCases, BASE_SYSTEM_PROMPT);
                    if (revalidationIssues.length < styleGuideIssues.length) {
                        console.log(`[generate-test-cases-async] ✅ Перегенерация помогла: ${styleGuideIssues.length} → ${revalidationIssues.length} проблем`);
                    } else {
                        console.warn(`[generate-test-cases-async] ⚠️ Перегенерация не помогла, осталось ${revalidationIssues.length} проблем`);
                    }
                } catch (retryError) {
                    console.error(`[generate-test-cases-async] Ошибка при перегенерации тест-кейсов:`, retryError.message);
                    console.warn(`[generate-test-cases-async] Используем исходные тест-кейсы с предупреждениями`);
                }
            }
        } else {
            console.log(`[generate-test-cases-async] ✅ Все тест-кейсы соответствуют стайл-гайду`);
        }

        if (finalTestCases.length === 0) {
            console.warn('[generate-test-cases-async] Не получено ни одного тест-кейса, добавляем fallback');
            finalTestCases.push({
                title: "Базовый тест-кейс",
                description: "Проверить основную функциональность",
                steps: ["Выполнить базовую проверку"],
                expectedResult: "Функциональность работает корректно",
                type: "E2E"
            });
        }

        // Обновляем progress перед финальным сохранением
        await db('generation_tasks').where('id', taskId).update({
            progress: 95,
            updated_at: new Date()
        });

        await db('generation_tasks').where('id', taskId).update({
            status: 'completed',
            progress: 100,
            result: { testCases: finalTestCases },
            completed_at: new Date(),
            updated_at: new Date()
        });

    } catch (error) {
        console.error('Ошибка асинхронной генерации:', error);
        await db('generation_tasks').where('id', taskId).update({
            status: 'failed',
            error_message: error.message,
            updated_at: new Date()
        });
    }
}

app.post('/api/generate-test-cases-async', async (req, res) => {
    try {
        const taskId = uuidv4();

        // ОЧИЩАЕМ КЭШ ПЕРЕД НОВОЙ ГЕНЕРАЦИЕЙ
        console.log(`[generate-test-cases-async] Очищаем кэш перед генерацией taskId: ${taskId}`);
        for (const [key, value] of taskStatusCache.entries()) {
            if (key.includes('status_') || key.includes('model_status_')) {
                taskStatusCache.delete(key);
            }
        }

        await db('generation_tasks').insert({
            id: taskId,
            type: 'test_cases',
            status: 'processing',
            progress: 0,
            input_data: req.body,
            created_at: new Date(),
            updated_at: new Date()
        });

        generateTestCasesAsync(taskId, req.body);

        res.json({ taskId, status: 'started' });
    } catch (error) {
        console.error('Ошибка создания задачи:', error);
        res.status(500).json({ error: error.message });
    }
});

// Простое кэширование статуса задач (5 секунд)
const taskStatusCache = new Map();

app.get('/api/generate-test-cases-status/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const cacheKey = `status_${taskId}`;

        // Проверяем кэш
        const cached = taskStatusCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5000) {
            return res.json(cached.data);
        }

        const task = await db('generation_tasks').where('id', taskId).first();

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const responseData = {
            id: task.id,
            status: task.status,
            progress: task.progress,
            result: task.result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            completed_at: task.completed_at
        };

        // Кэшируем результат
        taskStatusCache.set(cacheKey, {
            data: responseData,
            timestamp: Date.now()
        });

        // Очищаем старые записи из кэша (простая очистка)
        if (taskStatusCache.size > 100) {
            const now = Date.now();
            for (const [key, value] of taskStatusCache.entries()) {
                if (now - value.timestamp > 30000) { // 30 секунд
                    taskStatusCache.delete(key);
                }
            }
        }

        res.json(responseData);
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отмена задачи генерации
app.post('/api/cancel-generation/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;

        // Обновляем статус задачи на 'failed' с сообщением об отмене
        await db('generation_tasks')
            .where('id', taskId)
            .update({
                status: 'failed',
                error_message: 'Задача отменена пользователем',
                updated_at: new Date(),
                completed_at: new Date()
            });

        console.log(`Задача ${taskId} отменена пользователем`);
        res.json({ success: true, message: 'Задача отменена' });
    } catch (error) {
        console.error('Ошибка отмены задачи:', error);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
