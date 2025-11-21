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
    addExpectedResultToStep,
    linkIssueToTestCase,
    setTestCaseLayer,
    suggestTestLayers,
    getProjectCustomFieldSchema,
    fetchWithAuth,
    suggestTags,
    createTag,
    addParameterToTestCase,
    createTestCaseExamples,
    generatePairwiseExamples,
    createSharedStep,
    addStepToSharedStep,
    getSharedStepDetails
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
import { registerDebugRoutes } from './debug-routes.mjs';

// ═══════════════════════════════════════════════════════════════
// НОВЫЕ МОДУЛИ - АРХИТЕКТУРНЫЕ УЛУЧШЕНИЯ
// ═══════════════════════════════════════════════════════════════
import { validateTestCase, validateTestCases, SCHEMA_BY_LAYER } from './schemas/test-case-schemas.mjs';
import { parseAPISpecification, validateCodeAgainstAPISpec, formatAPISpecForPrompt } from './parsers/api-spec-parser.mjs';
import { normalizeTestCase, normalizeTestCases, splitCompositeCodesInModel } from './normalizers/test-case-normalizer.mjs';
import { reviewTestCases, mergeReviewResults } from './agents/review-agent.mjs';
import { validateUntilClean } from './agents/post-generation-validator.mjs';
import { planPhases, updatePhaseContext, buildPhasePrompt } from './generators/multi-phase-generator.mjs';
import {
    savePerfectExamples,
    getPerfectExamples,
    getAllPerfectExamplesByLayer,
    getPerfectExamplesStats,
    deletePerfectExample
} from './perfect-examples.mjs';
import {
    getConversationContext,
    createConversationContext,
    addMessageToContext,
    addErrorToContext,
    clearErrors,
    saveStateSnapshot,
    rollbackToSnapshot,
    getStateSnapshots,
    deleteConversationContext
} from './conversation-context.mjs';
import {
    buildSystemPrompt,
    addPerfectExamplesAsFewShot
} from './prompt-composer.mjs';
import {
    extractLogicAndConstraints,
    formatLogicConstraintsForPrompt
} from './logic-extractor.mjs';
import {
    runTestCaseLLMWithContext,
    validateFixedCases
} from './llm-with-context.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const app = express();
const PORT = 5000;

const TEST_CASE_JSON_SCHEMA = {
    type: 'object',
    properties: {
        cases: {
            type: 'array',
            description: 'Массив тест-кейсов, которые необходимо создать или исправить',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string', description: 'UUID тест-кейса' },
                    title: { type: 'string', minLength: 3 },
                    feature: { type: 'string', minLength: 1 },
                    story: { type: 'string', minLength: 1 },
                    scenario: { type: 'string' },
                    code: { type: 'string' },
                    layer: {
                        type: 'string',
                        enum: [
                            'E2E Tests',
                            'Integration frontend Tests',
                            'Integration backend Tests'
                        ]
                    },
                    precondition: { type: 'string' },
                    steps: {
                        type: 'array',
                        items: {
                            anyOf: [
                                { type: 'string' },
                                {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        text: { type: 'string' },
                                        expectedResult: { type: 'string' }
                                    },
                                    required: ['text']
                                },
                                {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        sharedStepId: {
                                            anyOf: [
                                                { type: 'number' },
                                                { type: 'string' }
                                            ]
                                        }
                                    },
                                    required: ['sharedStepId']
                                }
                            ]
                        }
                    },
                    expected: { type: 'string', minLength: 3 },
                    tags: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    priority: {
                        type: 'string',
                        enum: ['Critical', 'High', 'Medium', 'Low']
                    },
                    version: { type: 'string' },
                    parameters: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                name: { type: 'string' },
                                values: {
                                    type: 'array',
                                    items: { type: 'string' }
                                }
                            },
                            required: ['name', 'values']
                        }
                    },
                    examples: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                parameters: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        properties: {
                                            name: { type: 'string' },
                                            value: { type: 'string' }
                                        },
                                        required: ['name', 'value']
                                    }
                                }
                            },
                            required: ['parameters']
                        }
                    }
                },
                required: ['title', 'feature', 'story', 'steps', 'expected', 'layer']
            }
        }
    },
    required: ['cases'],
    additionalProperties: false
};

// ✅ КРИТИЧНО: Отдельная схема для fixTestCasesAsync с обязательным id
const TEST_CASE_JSON_SCHEMA_FIX = JSON.parse(JSON.stringify(TEST_CASE_JSON_SCHEMA));
TEST_CASE_JSON_SCHEMA_FIX.properties.cases.items.required = [
    'id', // ❗ ОБЯЗАТЕЛЬНО для фиксов!
    'title',
    'feature',
    'story',
    'steps',
    'expected',
    'layer'
];

const TEST_CASE_RESPONSE_FORMAT = {
    type: 'json_schema',
    json_schema: {
        name: 'test_cases_payload',
        strict: true,
        schema: TEST_CASE_JSON_SCHEMA
    }
};

// ✅ КРИТИЧНО: Отдельный формат для fixTestCasesAsync
const TEST_CASE_RESPONSE_FORMAT_FIX = {
    type: 'json_schema',
    json_schema: {
        name: 'test_cases_fix_payload',
        strict: true,
        schema: TEST_CASE_JSON_SCHEMA_FIX
    }
};

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
    origin: 'https://test-inspector.abanking.ru',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-OpenRouter-Key'],
    credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.options('*', cors(corsOptions));
const limit = pLimit(100);

// ============================================================================
// DEBUG API (автоматическое тестирование и улучшение агента)
// ============================================================================
registerDebugRoutes(app);



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
                    const removedCodes = [];
                    for (const cd of (sc.codes || [])) {
                        const ck = String(cd.text || '').trim();
                        if (!codeMap.has(ck)) {
                            codeMap.set(ck, { ...cd });
                        } else {
                            // if duplicate code with same text appears, drop it (no extra merge fields expected)
                            const existing = codeMap.get(ck);
                            removedCodes.push({
                                text: ck,
                                removedId: cd.id,
                                removedType: cd.type,
                                keptId: existing.id,
                                keptType: existing.type,
                                scenario: sc.text
                            });
                        }
                    }
                    if (removedCodes.length > 0) {
                        console.warn(`[normalizeModelStructure] ⚠️ Удалено ${removedCodes.length} дубликат(ов) Code в Scenario "${sc.text}":`);
                        removedCodes.forEach(removed => {
                            console.warn(`  - Удален Code: id=${removed.removedId}, type=${removed.removedType || 'N/A'}, text="${removed.text}"`);
                            console.warn(`    Оставлен Code: id=${removed.keptId}, type=${removed.keptType || 'N/A'}`);
                        });
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

/**
 * Нормализует текст Code: убирает префиксы, исправляет пользовательские действия, разделяет frontend+backend, убирает "При..."
 */
/**
 * Исправляет двойное экранирование placeholder'ов {{}} → {{}}
 * Убирает все варианты экранирования: \\{\\{, \{\{, {{ → {{
 */
function fixPlaceholderEscaping(text) {
    if (typeof text !== 'string') return text;
    // Исправляем все варианты двойного экранирования:
    // \\{\\{ → {{ (двойной обратный слэш + фигурные скобки)
    // \{\{ → {{ (одинарный обратный слэш + фигурные скобки)
    // {{ уже правильно, не трогаем
    return text
        .replace(/\\\\\{\\\{/g, '{{')  // \\{\\{ → {{
        .replace(/\\\\\}\\\}/g, '}}')  // \\}\\} → }}
        .replace(/\\\{\\{/g, '{{')     // \{\{ → {{
        .replace(/\\\}\}/g, '}}');     // \}\} → }}
}

function normalizeCodeText(rawText) {
    let text = String(rawText || '').trim();
    if (!text) return '';

    // Убираем префикс [step N]
    text = text.replace(/^\s*\[\s*step\s*\d+\s*]\s*/i, '').trim();

    // Если текст начинается с "Система" - убираем его (избыточно)
    text = text.replace(/^система\s+/i, '').trim();

    // ✅ НОВОЕ: Убираем "При..." из начала Code (это условие, а не действие системы)
    // "При выборе чек-бокса: перезаполнить поле" → "Перезаполнить поле"
    // "При нажатии кнопки: POST /api" → "POST /api"
    if (/^при\s+/i.test(text)) {
        // Ищем двоеточие или запятую после условия
        const match = text.match(/^при\s+[^:]+[:,\s]+(.+)/i);
        if (match && match[1]) {
            text = match[1].trim();
            console.warn(`[normalizeCodeText] Удалён префикс "При..." из Code: "${text}"`);
        } else {
            // Если нет разделителя, просто убираем "При" и следующее слово
            text = text.replace(/^при\s+\w+\s+/i, '').trim();
            console.warn(`[normalizeCodeText] Удалён префикс "При..." из Code: "${text}"`);
        }
    }

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
        console.log(`[extractJsonArray] 🚨 ВНИМАНИЕ: Найдено ${candidates.length} JSON массивов!`);
        console.log(`[extractJsonArray] 📊 Размеры массивов:`, candidates.map((c, i) => {
            const parsed = JSON5.parse(c);
            return `[${i}]: ${Array.isArray(parsed) ? parsed.length : 'не массив'} элементов`;
        }).join(', '));
        console.log(`[extractJsonArray] ⚠️ Это может означать дубликаты или игнорирование лимитов промпта!`);

        try {
            const allArrays = [];
            let successCount = 0;
            for (const candidate of candidates) {
                try {
                    // Пробуем сначала как есть
                    let parsed = null;
                    try {
                        parsed = JSON5.parse(candidate);
                    } catch (e1) {
                        // Если не получилось, пробуем с cleanup
                        try {
                            const cleaned = cleanupJsonText(candidate);
                            parsed = JSON5.parse(cleaned);
                        } catch (e2) {
                            console.warn(`[extractJsonArray] Ошибка парсинга кандидата (после cleanup): ${e2.message}`);
                            continue;
                        }
                    }
                    if (Array.isArray(parsed)) {
                        allArrays.push(...parsed);
                        successCount++;
                    }
                } catch (e) {
                    console.warn(`[extractJsonArray] Ошибка обработки кандидата: ${e.message}`);
                }
            }
            if (allArrays.length > 0) {
                console.log(`[extractJsonArray] Объединено ${allArrays.length} тест-кейсов из ${successCount}/${candidates.length} успешно распарсенных массивов`);
                // ✅ Возвращаем валидный JSON через JSON.stringify
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
        const response = await callWithCloudRuFallback(
            OPENROUTER_URL,
            [{ role: "user", content: prompt }],
            config.openRouterAiKey,
            {
                tools: tools,
                temperature: 0,
                models: config.cloudruModels  // Используем модели из конфига
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
- 🚨 КРИТИЧНО: Scenario = действие пользователя, НЕ поведение системы!
- ❌ ЗАПРЕЩЕНО начинать с "Отобразить" - это поведение системы, должно быть в Code!
- ❌ ЗАПРЕЩЕНО: "Отобразить кнопку..." - это НЕ Scenario, это Code (поведение системы)!
- ✅ Правильно: "Ввести несуществующее значение в поле поиска" (действие пользователя)
- ✅ А "Отобразить кнопку..." - это Code (поведение системы)!

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

                    // ✅ НОВОЕ: Разделяем frontend + backend в одном Code на отдельные
                    // Проверяем, есть ли в Code и frontend-действие, и HTTP-запрос
                    const hasHttpRequest = /(GET|POST|PUT|DELETE|PATCH)\s+\//i.test(code.text);
                    const hasFrontendAction = /(отобразить|заполнить|скрыть|показать|активировать|деактивировать|перезаполнить|очистить)/i.test(code.text);

                    if (hasHttpRequest && hasFrontendAction) {
                        // Разделяем на два Code
                        const parts = [];
                        const httpMatch = code.text.match(/((GET|POST|PUT|DELETE|PATCH)\s+\/[^\s,]+(?:\?[^\s,]+)?)/i);
                        const frontendPart = code.text.replace(/(GET|POST|PUT|DELETE|PATCH)\s+\/[^\s,]+(?:\?[^\s,]+)?/gi, '').trim().replace(/[,\s]+$/, '');

                        if (httpMatch && httpMatch[1]) {
                            parts.push({
                                id: uuidv4(),
                                text: httpMatch[1].trim(),
                                type: 'backend'
                            });
                        }

                        if (frontendPart) {
                            parts.push({
                                id: code.id || uuidv4(),
                                text: frontendPart.trim(),
                                type: code.type || 'frontend'
                            });
                        }

                        if (parts.length > 1) {
                            // Заменяем текущий Code на первый, добавляем остальные после него
                            const codeIndex = scenario.codes.indexOf(code);
                            scenario.codes[codeIndex] = parts[0];
                            scenario.codes.splice(codeIndex + 1, 0, ...parts.slice(1));
                            cleanedCount++;
                            console.log(`[postProcessModel] Разделён Code на ${parts.length} части: "${code.text}" → ${parts.map(p => `"${p.text}"`).join(' + ')}`);
                            continue; // Пропускаем дальнейшую обработку для уже разделённых Code
                        }
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
- Запрещено придумывать новые API, пути, коды ответов и параметры. Используй только API, указанные в разделе 3 требований, и только те UI‑элементы/сообщения, которые уже встречаются в сценариях и requirements. Не вводи новые абстрактные параметры типа "Код ответа", "Числовое значение"

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
- "POST /rest/stateful/corp/curr/inquiry_181 с параметром deal.previousBankRegNumber = true"
- "Заполнить поле 'Сумма' из параметра deal.amount"
- "Сбросить значение поля 'Примечание'"
- "Отобразить поле 'Ожидаемый срок репатриации' как обязательное для заполнения"

🚨 КРИТИЧЕСКИ ВАЖНО:
1. ⚠️ КАЖДЫЙ Code должен быть ОТДЕЛЬНЫМ действием (НЕ объединяй frontend + backend в один!)
   ❌ "Отобразить чек-бокс, GET /rest/stateful/corp/document/visual/byid"
   ✅ Раздели на два Code:
      - "GET /rest/stateful/corp/document/visual/byid" (backend)
      - "Отобразить чек-бокс 'УНК в другом банке' доступным для редактирования" (frontend)

2. ⚠️ Code НЕ должен начинаться с "При..." (это условие, а не действие системы!)
   ❌ "При выборе чек-бокса: перезаполнить поле 'Примечание'"
   ✅ "Перезаполнить поле 'Примечание' текстом 'Контракт стоит на учете в другом Банке'"
   
   ❌ "При нажатии кнопки 'Подписать и отправить' с выбранным чек-боксом: POST /rest/..."
   ✅ "POST /rest/stateful/corp/curr/inquiry_181 с параметром deal.previousBankRegNumber = true"

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
            defaultChunk: 40000  // ✅ Увеличено для очень больших документов (200k+ символов)
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

**Scenario** — ОДНО конкретное действие пользователя, ВСЕГДА начинается с номера и глагола действия:
  
  🚨 КРИТИЧНО: Scenario = АТОМАРНОЕ действие (один клик/ввод/выбор), НЕ последовательность!
  
  ✅ "1. Нажать на кнопку 'Безбумажный офис'"
  ✅ "2. Выбрать чекбокс 'УНК в другом банке'"
  ✅ "3. Ввести ОТП-код в модальное окно"
  ✅ "4. Кликнуть на товар из списка"
  ✅ "5. Выбрать способ оплаты 'Карта'"
  ✅ "6. Ввести номер телефона в поле ввода"
  ✅ "7. Выбрать статус 'Активен' из выпадающего списка"
  
  ❌ "Открыть окно, выбрать статус и отфильтровать список" - ЭТО 3 ДЕЙСТВИЯ! Раздели на 3 Scenario!
  ❌ "Нажать 'Создать', заполнить форму и получить ошибку" - ЭТО 2 ДЕЙСТВИЯ! Раздели на 2 Scenario!
  ❌ "Выбрать товар, добавить в корзину и отобразить уведомление" - ЭТО 3 ДЕЙСТВИЯ! Раздели на 3 Scenario!
  
  ❌ "Проверить отсутствие результатов поиска" - НЕПРАВИЛЬНО! Нет действия пользователя!
  ❌ "Проверить превышение лимита заказа" - НЕПРАВИЛЬНО! Нет действия пользователя!
  ❌ "Применить скидку 10%" - НЕПРАВИЛЬНО! Нет UI-действия! → ✅ "Нажать кнопку 'Применить скидку'"
  
  🚨 ЗАПРЕЩЁННЫЕ ГЛАГОЛЫ в начале Scenario:
  ❌ "Проверить", "Убедиться" - это НЕ действия пользователя!
  ❌ "Попытаться" - НЕ используй! Просто опиши действие: "Выбрать способ оплаты"
  ❌ "Дождаться" - НЕ используй! Это лишнее ожидание, пропусти его
  ❌ "Отобразить" - НЕ используй! Это поведение системы, НЕ действие пользователя!
  
  ✅ ПРАВИЛЬНЫЕ ГЛАГОЛЫ: 
  Нажать, Ввести, Выбрать, Кликнуть, Открыть, Перейти, Заполнить, Загрузить, 
  Применить, Повернуть, Подтвердить, Закрыть, Сохранить
  
  🎯 ОСОБЫЕ СЛУЧАИ (когда ДА можно использовать):
  ✅ "Применить фильтр 'Активные'" - ОК, если это явное действие из UI
  ✅ "Изменить статус на 'Выполнен'" - ОК, если это явное действие из UI
  ✅ "Подтвердить удаление" - ОК, если это явное действие (клик на кнопку "ОК")
  ✅ "Повернуть изображение на 90°" - ОК, если это явное действие из UI
  ✅ "Отменить удаление изображения из категории" - ОК, если это явное действие (клик на кнопку "Отмена")
  
  🚨 КРИТИЧНО: Scenario = действие пользователя, НЕ поведение системы!
  ❌ "4. Отобразить кнопку 'Загрузить своё' при отсутствии результатов поиска" - НЕПРАВИЛЬНО!
     Это поведение системы, НЕ действие пользователя! Это должно быть в Code, а НЕ в Scenario!
  ✅ Правильно: "4. Ввести несуществующее значение в поле поиска" (действие пользователя)
     А "Отобразить кнопку..." - это Code (поведение системы)!
  
  ПРИМЕРЫ ИСПРАВЛЕНИЙ:
  ❌ "Попытаться выбрать способ оплаты" → ✅ "Выбрать способ оплаты"
  ❌ "Дождаться загрузки данных" → ✅ Убери этот шаг полностью, не нужен!
  ❌ "Проверить отсутствие товаров" → ✅ "Ввести несуществующий ID товара"
  ❌ "Убедиться в отображении ошибки" → ✅ Это не Scenario, это Expected result!

**Code** — ПОВЕДЕНИЕ системы (что отправляется, что возвращается, что отображается):
  
  🔑 ЧТО ТАКОЕ CODE:
  - Code = НАБЛЮДАЕМОЕ поведение (Black Box подход)
  - Frontend code = что ОТПРАВЛЯЕТСЯ + что ОТОБРАЖАЕТСЯ
  - Backend code = что ВОЗВРАЩАЕТСЯ (HTTP статус + JSON структура)
  
  ✅ ПРАВИЛЬНО (Frontend - отправка запросов):
  - "Отправляется GET **/api/v1/users**" + type: "frontend"
  - "Отправляется POST **/api/v1/orders** с параметрами productId (number), quantity (number)" + type: "frontend"
  - "Отправляется DELETE **/api/v1/cart/{itemId}**" + type: "frontend"
  
  ✅ ПРАВИЛЬНО (Backend - ответы с JSON):
  - "Возвращается 200 OK с массивом пользователей: [{id, name, email}]" + type: "backend"
  - "Возвращается 200 OK с {id, orderNumber, total, status}" + type: "backend"
  - "Возвращается 400 Bad Request с {error: 'Invalid product ID'}" + type: "backend"
  - "Возвращается 404 Not Found с {error: 'Item not found'}" + type: "backend"
  
  ✅ ПРАВИЛЬНО (Frontend - отображение UI):
  - "Отображается модальное окно 'Подтверждение заказа' с полями" + type: "frontend"
  - "Отображается список товаров с названиями, ценами и описаниями" + type: "frontend"
  - "Отображается ошибка 'Товар недоступен'" + type: "frontend"
  - "Скрывается форма ввода" + type: "frontend"
  
  ❌ КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО:
  - "Frontend отправляет..." - префикс ЗАПРЕЩЁН! Просто: "Отправляется GET..."
  - "Backend возвращает..." - префикс ЗАПРЕЩЁН! Просто: "Возвращается 200 OK..."
  - "Backend обрабатывает загрузку" - это ВНУТРЕННЯЯ логика! НЕ code!
  - "Backend проверяет формат файла" - это ВНУТРЕННЯЯ логика! НЕ code!
  - "Backend валидирует размер" - это ВНУТРЕННЯЯ логика! НЕ code!
  - "POST /api/orders" без параметров - НЕПОЛНОЕ! Должно: "с параметрами productId, quantity"
  - "Возвращается 200 OK" без JSON - НЕПОЛНОЕ! Должно: "с {id, orderNumber, total}"
  - "GET /api/products" - эндпоинт БЕЗ жирного! Должно: "GET **/api/products**"
  
  🎯 СТРУКТУРА CODE ДЛЯ ОДНОГО SCENARIO:
  1. Frontend отправляет запрос: "Отправляется GET **/api/...**"
  2. Backend возвращает ответ: "Возвращается 200 OK с {json}"
  3. Frontend отображает результат: "Отображается список/окно/ошибка"
  
  ПРИМЕР для "Нажать кнопку 'Показать товары'":
  1. "Отправляется GET **/api/v1/products**" + type: "frontend"
  2. "Возвращается 200 OK с [{id, name, price}]" + type: "backend"
  3. "Отображается список товаров с названиями и ценами" + type: "frontend"
  4. "Отправляется GET **/api/v1/products/{productId}**" + type: "frontend"
  5. "Возвращается 200 OK с {id, name, price, description}" + type: "backend"
  6. "Отображается детальная информация о товаре" + type: "frontend"

═══════════════════════════════════════════════════════════════
🚨 КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ CODE
═══════════════════════════════════════════════════════════════

0. 🚨 СТРОГО СЛЕДУЙ ТРЕБОВАНИЯМ! НЕ ВЫДУМЫВАЙ API и функциональность!
   
   ✅ ПРАВИЛЬНО: Если в требованиях написано "фильтрация на клиенте" - НЕ добавляй query-параметр ?filter=
   ❌ НЕПРАВИЛЬНО: Добавлять GET /api/products/{id}?filter=active, если в требованиях этого нет!
   
   ✅ ПРАВИЛЬНО: Если в требованиях описан только API POST /api/orders - используй только его!
   ❌ НЕПРАВИЛЬНО: Выдумывать новые эндпоинты типа POST /api/update или PUT /api/modify, если их нет в требованиях!
   
   ✅ ПРАВИЛЬНО: Если в требованиях сказано "список пользователей возвращает {id, name}" - НЕ добавляй поле email!
   ❌ НЕПРАВИЛЬНО: Расширять JSON структуры полями, которых нет в требованиях!
   
   🎯 ПРАВИЛО: Model = ДОКУМЕНТАЦИЯ требований, НЕ твои догадки!

1. Code описывает ЧТО ДЕЛАЕТ СИСТЕМА, а НЕ что делает пользователь
   ✅ "Отобразить страницу 'Письмо отправлено'"
   ❌ "Пользователь видит страницу" (это Step в тест-кейсе)

2. ⚠️ КАЖДЫЙ Code должен быть ОТДЕЛЬНЫМ действием (НЕ объединяй frontend + backend + UI в один!)
   
   ❌ КРИТИЧЕСКАЯ ОШИБКА - ОБЪЕДИНЕНИЕ в одном Code:
   "GET /api/v1/products/{productId}, Возвращается 200 OK с [...], Отобразить список"
   ЭТО 3 ДЕЙСТВИЯ В ОДНОМ CODE! КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО!
   
   ✅ ПРАВИЛЬНО - РАЗДЕЛИТЬ на 3 отдельных Code:
   codes: [
     {text: "Отправляется GET **/api/v1/products/{productId}** с параметром productId (number)", type: "frontend"},
     {text: "Возвращается 200 OK с {id, name, price, description}", type: "backend"},
     {text: "Отображается детальная информация о товаре", type: "frontend"}
   ]
   
   ❌ КРИТИЧЕСКАЯ ОШИБКА - ОБЪЕДИНЕНИЕ запроса и ответа:
   "POST /api/orders с productId, quantity, Возвращается 400 Bad Request, Отобразить ошибку"
   ЭТО 3 ДЕЙСТВИЯ В ОДНОМ CODE!
   
   ✅ ПРАВИЛЬНО - РАЗДЕЛИТЬ на 3 отдельных Code:
   codes: [
     {text: "Отправляется POST **/api/v1/orders** с параметрами productId (number), quantity (number)", type: "frontend"},
     {text: "Возвращается 400 Bad Request с {error: 'Insufficient stock'}", type: "backend"},
     {text: "Отображается ошибка 'Недостаточно товара на складе'", type: "frontend"}
   ]
   
   🎯 ПРАВИЛО: 1 Code = 1 тип действия (ТОЛЬКО запрос ИЛИ ТОЛЬКО ответ ИЛИ ТОЛЬКО UI)
   
5. ⚠️ КРИТИЧНО: ОБЯЗАТЕЛЬНО генерируй backend коды для КАЖДОГО API-запроса!
   
   🚨 ПРАВИЛО: Минимум 30% всех кодов должны быть type: "backend"!
   
   ✅ ПРАВИЛЬНО: Для каждого frontend code с API-запросом ДОЛЖЕН быть соответствующий backend code:
   - Frontend: "Отправляется GET **/api/v1/users**" → Backend: "Возвращается 200 OK с [{id, name, email}]"
   - Frontend: "Отправляется POST **/api/v1/orders** с параметрами..." → Backend: "Возвращается 200 OK с {id, orderNumber, total}" ИЛИ "Возвращается 400 Bad Request с {error: '...'}"
   - Frontend: "Отправляется DELETE **/api/v1/cart/{itemId}**" → Backend: "Возвращается 200 OK с {message: '...'}" ИЛИ "Возвращается 404 Not Found с {error: '...'}"
   
   ❌ НЕПРАВИЛЬНО: Scenario с frontend code "Отправляется GET..." БЕЗ соответствующего backend code!
   ❌ НЕПРАВИЛЬНО: Только frontend коды в Scenario - ОБЯЗАТЕЛЬНО добавь backend коды!
   
   🎯 ПРАВИЛО: Каждый API-запрос (frontend) = ОБЯЗАТЕЛЬНО ответ (backend)!

3. ⚠️ Code НЕ должен начинаться с "При..." (это условие, а не действие системы!)
   ❌ НЕПРАВИЛЬНО: "При выборе чек-бокса: перезаполнить поле 'Примечание'"
   ✅ ПРАВИЛЬНО: "Перезаполнить поле 'Примечание' текстом 'Контракт стоит на учете в другом Банке'"
   
   ❌ НЕПРАВИЛЬНО: "При нажатии кнопки 'Подписать и отправить' с выбранным чек-боксом: POST /rest/..."
   ✅ ПРАВИЛЬНО: "POST /rest/stateful/corp/curr/inquiry_181 с параметром deal.previousBankRegNumber = true"

4. Code НЕ содержит префиксов "API:", "UI:", "Frontend:", "Backend:"
   ✅ "POST /confirm/code/check"
   ❌ "API: POST /confirm/code/check"

5. Code извлекается ТОЛЬКО из requirements (НЕ выдумывай!)
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
                        maxIterations: 20,  // ✅ Больше итераций, чтобы успевать собрать крупные требования
                        modelOptions: {
                            temperature: 0,
                            top_p: 0.9,
                            max_tokens: 20000,  // ✅ Уменьшили запас completion, чтобы не превышать лимит Cloud.ru на больших промптах
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
                            max_tokens: 20000,  // ✅ Синхронизировано с основным вызовом
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

            // ═══════════════════════════════════════════════════════════════
            // ОТКЛЮЧЕНО: Старая логика Coverage - не актуальна
            // ═══════════════════════════════════════════════════════════════
            // Причина: Теперь используем динамическую валидацию через API spec,
            // JSON schemas, normalizers и review agent. Старый coverage не нужен.
            //
            // if (reqStringForModel) {
            //     const reqCoverage = calculateRequirementsCoverage(cleanedModel, reqStringForModel, reqStructure);
            //     console.log(`[Coverage] Requirements: ${reqCoverage.covered}/${reqCoverage.total} (${reqCoverage.coveragePercent}%)`);
            //     if (reqCoverage.missing.length > 0) {
            //         console.warn(`[Coverage] Не покрыто ${reqCoverage.missing.length} requirements: ${reqCoverage.missing.slice(0, 10).join(', ')}${reqCoverage.missing.length > 10 ? '...' : ''}`);
            //     }
            //     coverageReportData.requirementsCoverage = reqCoverage;
            // }

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
                                max_tokens: 45000,  // ✅ Безопасное значение для MiniMax-M2 (лимит 196K, вход ~136K, оставляем запас 45K)
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

        // Сохраняем результат (метрики сохраняем только если столбец существует)
        const updateData = {
            status: 'completed',
            progress: 100,
            result: {
                testModel: cleanedModel,
                testModelId: taskId  // ✅ Сохраняем ID задачи для последующей загрузки модели
            },
            completed_at: new Date(),
            updated_at: new Date()
        };

        // ✅ Условное сохранение метрик (если столбец существует)
        try {
            // Пробуем обновить с метриками
            await db('generation_tasks').where('id', taskId).update({
                ...updateData,
                metrics: JSON.stringify(metrics)
            });
        } catch (error) {
            // Если столбец metrics не существует - сохраняем без метрик
            // Проверяем как русский, так и английский вариант ошибки
            const errorMsg = error.message || '';
            const isMetricsColumnError = 
                errorMsg.includes('столбец "metrics"') || 
                errorMsg.includes('column "metrics"') ||
                (errorMsg.includes('metrics') && (errorMsg.includes('does not exist') || errorMsg.includes('doesn\'t exist')));
            
            if (isMetricsColumnError) {
                console.warn('[generateTestModelAsync] Столбец metrics не существует, сохраняю без метрик');
                await db('generation_tasks').where('id', taskId).update(updateData);
            } else {
                throw error; // Пробрасываем другие ошибки
            }
        }

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
        console.log(`[create-test-cases] 📋 Получена схема кастомных полей: ${schema.length} элементов`);

        // Логируем первые несколько элементов для диагностики
        if (schema.length > 0) {
            console.log(`[create-test-cases] 📋 Примеры из схемы:`, JSON.stringify(schema.slice(0, 3), null, 2));
        }

        const cfMap = {};
        for (const e of schema) {
            const id = e?.customField?.id;
            const key = e?.key;
            const name = e?.customField?.name;

            // ✅ Принимаем любые ID (включая отрицательные), если они числа
            // Allure может использовать отрицательные ID для системных полей
            if (id != null && typeof id === 'number' && !isNaN(id)) {
                if (key) {
                    const keyLower = String(key).toLowerCase();
                    cfMap[keyLower] = id;
                    console.log(`[create-test-cases] 📋 Кастомное поле: key="${key}" -> id=${id} ${id < 0 ? '(отрицательный ID - возможно системное поле)' : ''}`);
                }
                if (name) {
                    const nameLower = String(name).toLowerCase();
                    cfMap[nameLower] = id;
                    console.log(`[create-test-cases] 📋 Кастомное поле: name="${name}" -> id=${id} ${id < 0 ? '(отрицательный ID - возможно системное поле)' : ''}`);
                }
            } else {
                console.warn(`[create-test-cases] ⚠️ Пропущено поле с невалидным ID: ${id} (тип: ${typeof id}, key="${key}", name="${name}")`);
            }
        }

        console.log(`[create-test-cases] ✅ Загружено ${Object.keys(cfMap).length} кастомных полей в cfMap`);

        // 3) Подгружаем существующие проектные теги (чтобы потом создавать новые, если их нет)
        const projectTags = await suggestTags(projectId);

        const created = [];

        // ✅ ВАЖНО: Создаём тест-кейсы ПОСЛЕДОВАТЕЛЬНО (как в старом коде), чтобы избежать race condition в Allure API
        for (const c of cases) {
            // 4) Создаём TC
            const tc = await createTestCaseAllure({ projectId, name: c.title });
            const testCaseId = tc.id;

            // 5) Обновляем precondition и expectedResult
            // ✅ Исправляем двойное экранирование placeholder'ов перед отправкой
            await updateTestCase(testCaseId, {
                precondition: fixPlaceholderEscaping(c.precondition),
                expectedResult: fixPlaceholderEscaping(c.expected),
            });

            // 6) Добавляем шаги
            let lastStepId;
            for (const step of c.steps || []) {
                const params = { testCaseId };

                if (typeof step === 'object' && step.sharedStepId) {
                    params.sharedStepId = step.sharedStepId;
                } else {
                    // ✅ Извлекаем текст шага и гарантируем, что это строка
                    let stepText;
                    if (typeof step === 'string') {
                        stepText = step;
                    } else if (typeof step === 'object' && step !== null) {
                        stepText = step.text || '';
                    } else {
                        stepText = String(step || '');
                    }

                    // ✅ Применяем fixPlaceholderEscaping только к строкам
                    params.body = typeof stepText === 'string' ? fixPlaceholderEscaping(stepText) : String(stepText || '');

                    // ✅ Если у шага есть expectedResult, он будет добавлен отдельно после создания шага
                }

                if (lastStepId) params.afterId = lastStepId;
                const added = await addStepToTestCase(testCaseId, params);
                // ✅ Из curl примера: ответ может содержать createdStepId в корне или в scenario.scenarioSteps
                const stepId = added.createdStepId ||
                    (added.scenario?.scenarioSteps && Object.keys(added.scenario.scenarioSteps)[0]) ||
                    added.id;
                lastStepId = stepId;

                // ✅ Если у шага есть expectedResult, добавляем его
                if (typeof step === 'object' && step.expectedResult) {
                    try {
                        // ✅ Гарантируем, что expectedResult - строка
                        const expectedResultRaw = step.expectedResult;
                        const expectedResultText = typeof expectedResultRaw === 'string'
                            ? fixPlaceholderEscaping(expectedResultRaw)
                            : String(expectedResultRaw || '');
                        if (expectedResultText && expectedResultText.trim()) {
                            await addExpectedResultToStep(testCaseId, stepId, expectedResultText);
                        }
                    } catch (expectedErr) {
                        console.error(`[create-test-cases] ❌ Ошибка при добавлении Expected Result к шагу для ТК ${testCaseId}:`, expectedErr.message);
                        // Не прерываем создание тест-кейса, продолжаем дальше
                    }
                }
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
                try {
                    await setTestCaseLayer(testCaseId, layerMap[c.layer]);
                    console.log(`[create-test-cases] ✅ Слой "${c.layer}" установлен для ТК ${testCaseId}`);
                } catch (layerErr) {
                    console.error(`[create-test-cases] ❌ Ошибка при установке слоя "${c.layer}" для ТК ${testCaseId}:`, layerErr.message);
                    // Не прерываем создание тест-кейса, продолжаем дальше
                    console.warn(`[create-test-cases] ⚠️ Продолжаю создание ТК ${testCaseId} без слоя`);
                }
            }

            // 11) Кастомные поля
            const cfvById = new Map();

            const putCF = (fieldNameOrKey, raw) => {
                if (raw == null) return;
                let val = String(raw).trim();
                if (!val) return;                      // не шлём пустые значения
                // ✅ Исправляем двойное экранирование placeholder'ов перед сохранением
                val = fixPlaceholderEscaping(val);
                const id = cfMap[String(fieldNameOrKey).toLowerCase()];
                if (!id && id !== 0) {
                    console.warn(`[create-test-cases] ⚠️ Кастомное поле "${fieldNameOrKey}" не найдено в схеме проекта`);
                    return;                            // такого CF нет в проекте
                }
                // ✅ Принимаем любые числовые ID (включая отрицательные)
                // Allure может использовать отрицательные ID для системных полей
                if (typeof id !== 'number' || isNaN(id)) {
                    console.error(`[create-test-cases] ❌ КРИТИЧЕСКАЯ ОШИБКА: Невалидный ID ${id} для поля "${fieldNameOrKey}"`);
                    return;
                }
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
                // ✅ ВАЖНО: Отправляем все кастомные поля ОДНИМ batch-запросом (как в старом коде)
                // Это работает надёжнее, чем последовательные запросы
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

            created.push({ id: testCaseId });
        }

        res.json({ success: true, created });
    } catch (err) {
        console.error('Ошибка при массовом создании ТК:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/perfect-examples
 * Сохраняет тест-кейсы как идеальные примеры для улучшения генерации
 */
app.post('/api/perfect-examples', async (req, res) => {
    const { testCases, projectId } = req.body;

    if (!Array.isArray(testCases) || testCases.length === 0) {
        return res.status(400).json({ error: 'testCases (массив) обязателен и не должен быть пустым' });
    }

    console.log(`[perfect-examples] Сохранение ${testCases.length} тест-кейсов как идеальных примеров...`);

    try {
        const saved = await savePerfectExamples(testCases, projectId, db);

        console.log(`[perfect-examples] ✅ Сохранено ${saved.length} идеальных примеров`);
        res.json({
            success: true,
            saved: saved.length,
            examples: saved,
            message: `Сохранено ${saved.length} идеальных примеров для улучшения генерации`
        });
    } catch (err) {
        console.error('[perfect-examples] ❌ Ошибка при сохранении идеальных примеров:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

/**
 * GET /api/perfect-examples/stats
 * Получает статистику по идеальным примерам
 */
app.get('/api/perfect-examples/stats', async (req, res) => {
    const { projectId } = req.query;

    try {
        const stats = await getPerfectExamplesStats(projectId, db);
        res.json({ success: true, stats });
    } catch (err) {
        console.error('[perfect-examples/stats] ❌ Ошибка при получении статистики:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/perfect-examples/:id
 * Удаляет идеальный пример по ID
 */
app.delete('/api/perfect-examples/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const deleted = await deletePerfectExample(id, db);
        if (deleted) {
            res.json({ success: true, message: 'Идеальный пример удалён' });
        } else {
            res.status(404).json({ error: 'Идеальный пример не найден' });
        }
    } catch (err) {
        console.error('[perfect-examples/:id] ❌ Ошибка при удалении:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/fix-test-cases
 * Исправляет тест-кейсы по промпту с использованием LLM и инструментов для запроса требований
 * ✅ НОВАЯ АРХИТЕКТУРА: Использует персистентный контекст диалога для сохранения истории между вызовами
 */
app.post('/api/fix-test-cases', async (req, res) => {
    const { testCases, fixPrompt, projectId, bearerToken, requirements, taskId: providedTaskId } = req.body;

    if (!Array.isArray(testCases) || !fixPrompt || typeof fixPrompt !== 'string' || !fixPrompt.trim()) {
        return res.status(400).json({ error: 'testCases (массив) и fixPrompt (строка) обязательны' });
    }

    // ✅ Генерируем taskId если не передан (для нового контекста)
    const taskId = providedTaskId || uuidv4();

    console.log(`[fix-test-cases] Начало правки ${testCases.length} тест-кейсов по промпту: "${fixPrompt.substring(0, 100)}..." (taskId: ${taskId})`);

    try {
        // ✅ Сохраняем снимок состояния до исправления
        saveStateSnapshot(taskId, testCases, 'before-fix');

        // Вызываем асинхронную функцию правки с контекстом
        const fixedTestCases = await fixTestCasesAsync({
            taskId, // ✅ Передаём taskId для сохранения контекста
            testCases,
            fixPrompt: fixPrompt.trim(),
            projectId,
            bearerToken,
            requirements
        });

        // ✅ Сохраняем снимок состояния после исправления
        saveStateSnapshot(taskId, fixedTestCases, 'after-fix');

        // ✅ Получаем информацию о контексте для ответа
        const context = getConversationContext(taskId);
        const attemptNumber = context ? context.metadata.attemptNumber : 0;

        console.log(`[fix-test-cases] ✅ Исправлено ${fixedTestCases.length} тест-кейсов (попытка #${attemptNumber}, taskId: ${taskId})`);
        res.json({
            success: true,
            fixedTestCases,
            taskId, // ✅ Возвращаем taskId для последующих вызовов
            attemptNumber,
            message: `Исправлено ${fixedTestCases.length} тест-кейсов`
        });
    } catch (err) {
        console.error('[fix-test-cases] ❌ Ошибка при правке ТК:', err);

        // ✅ Записываем ошибку в контекст для следующей попытки
        if (providedTaskId || taskId) {
            addErrorToContext(taskId, err.message, fixPrompt);
        }

        res.status(500).json({
            error: err.message,
            stack: err.stack,
            taskId, // ✅ Возвращаем taskId даже при ошибке для возможности повтора
            needRetry: true
        });
    }
});

/**
 * POST /api/fix-test-cases/rollback
 * Откатить к предыдущему снимку состояния
 */
app.post('/api/fix-test-cases/rollback', async (req, res) => {
    const { taskId, snapshotIndex = -1 } = req.body;

    if (!taskId) {
        return res.status(400).json({ error: 'taskId обязателен' });
    }

    try {
        const restored = rollbackToSnapshot(taskId, snapshotIndex);

        res.json({
            success: true,
            testCases: restored.testCases,
            snapshot: restored.snapshot,
            message: `Откат к снимку: ${restored.snapshot.label}`
        });
    } catch (err) {
        console.error('[fix-test-cases/rollback] ❌ Ошибка при откате:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fix-test-cases/context/:taskId
 * Получить информацию о контексте задачи
 */
app.get('/api/fix-test-cases/context/:taskId', async (req, res) => {
    const { taskId } = req.params;

    try {
        const context = getConversationContext(taskId);
        const snapshots = getStateSnapshots(taskId);

        if (!context) {
            return res.status(404).json({ error: 'Контекст не найден' });
        }

        res.json({
            success: true,
            context: {
                messagesCount: context.messages.length,
                attemptNumber: context.metadata.attemptNumber,
                previousErrors: context.metadata.previousErrors,
                createdAt: context.metadata.createdAt,
                lastUpdated: context.metadata.lastUpdated
            },
            snapshots: snapshots.map((s, i) => ({
                index: i,
                label: s.label,
                timestamp: s.timestamp,
                testCasesCount: s.testCases.length
            }))
        });
    } catch (err) {
        console.error('[fix-test-cases/context] ❌ Ошибка:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/fix-test-cases/context/:taskId
 * Удалить контекст задачи
 */
app.delete('/api/fix-test-cases/context/:taskId', async (req, res) => {
    const { taskId } = req.params;

    try {
        deleteConversationContext(taskId);
        res.json({ success: true, message: 'Контекст удалён' });
    } catch (err) {
        console.error('[fix-test-cases/context] ❌ Ошибка при удалении:', err);
        res.status(500).json({ error: err.message });
    }
});

function mergePreservingOriginals(originalCase, modifiedCase, fixPrompt = '') {
    if (!originalCase) {
        return modifiedCase;
    }

    const promptLower = (fixPrompt || '').toLowerCase();
    const safeCase = { ...modifiedCase };

    const stepsKeywords = ['шаг', 'step', 'действ', 'action', 'сценари', 'структур', 'detail', 'описан'];
    const titleKeywords = ['названи', 'title', 'имя', 'заголов', 'rename', 'переимен'];
    const tagsKeywords = ['tag', 'тег'];

    const mentionsSteps = stepsKeywords.some(kw => promptLower.includes(kw));
    const mentionsTitle = titleKeywords.some(kw => promptLower.includes(kw));
    const mentionsTags = tagsKeywords.some(kw => promptLower.includes(kw));

    const cleanupRules = extractStepCleanupRules(fixPrompt);
    const cleanupEvaluation = cleanupRules.length
        ? evaluateStepCleanup(originalCase, modifiedCase, cleanupRules)
        : null;
    const cleanupAllowed = cleanupEvaluation?.allowed;

    if (!mentionsSteps) {
        const originalSteps = JSON.stringify(originalCase.steps ?? []);
        const newSteps = JSON.stringify(modifiedCase.steps ?? []);
        if (originalSteps !== newSteps) {
            if (cleanupAllowed) {
                console.log(`[fixTestCasesAsync] 🧹 SmartMerge: разрешён step clean-up для ${originalCase.id} (удалено ${cleanupEvaluation.removedCount} шагов)`);
            } else {
                console.warn(`[fixTestCasesAsync] 🛡️ SmartMerge: откат steps для ${originalCase.id}`);
                safeCase.steps = originalCase.steps;
            }
        }
    }

    if (!mentionsTitle && originalCase.title !== modifiedCase.title) {
        console.warn(`[fixTestCasesAsync] 🛡️ SmartMerge: откат title для ${originalCase.id}`);
        safeCase.title = originalCase.title;
    }

    if (!mentionsTags) {
        safeCase.tags = originalCase.tags;
    }

    safeCase.feature = originalCase.feature;
    safeCase.story = originalCase.story;

    return safeCase;
}

/**
 * Исправляет тест-кейсы по промпту с использованием LLM и инструментов для запроса требований
 * @param {Object} options - Опции для правки ТК
 * @param {Array} options.testCases - Массив тест-кейсов для правки
 * @param {string} options.fixPrompt - Промпт с описанием доработок
 * @param {string} [options.projectId] - ID проекта Allure
 * @param {string} [options.bearerToken] - Токен для доступа к Confluence
 * @param {string} [options.requirements] - Требования (если нужно)
 * @returns {Promise<Array>} - Массив исправленных тест-кейсов
 */
async function fixTestCasesAsync({ taskId, testCases, fixPrompt, projectId, bearerToken, requirements }) {
    if (!taskId) {
        throw new Error('[fixTestCasesAsync] taskId обязателен для сохранения контекста диалога');
    }

    console.log(`[fixTestCasesAsync] Начало правки ${testCases.length} тест-кейсов (taskId: ${taskId})`);
    console.log(`[fixTestCasesAsync] Промпт: "${fixPrompt.substring(0, 200)}..."`);

    // ✅ Получаем существующий контекст или создаём новый
    let context = getConversationContext(taskId);
    const attemptNumber = context ? (context.metadata.previousErrors?.length || 0) + 1 : 1;

    // Шаг 1: Определяем какие ТК нужно править из промпта
    const targetCases = identifyTargetCases(testCases, fixPrompt);
    console.log(`[fixTestCasesAsync] Найдено ${targetCases.length} тест-кейсов для правки (попытка #${attemptNumber})`);

    if (targetCases.length === 0) {
        console.warn('[fixTestCasesAsync] ⚠️ Не найдено тест-кейсов для правки, возвращаем исходный список');
        return testCases;
    }

    const originalCasesMap = new Map(
        testCases.map(tc => [tc.id, JSON.parse(JSON.stringify(tc))])
    );

    // Шаг 2: Создаем контекст для запроса требований при необходимости
    const sourceRegistry = createContextSourceRegistry();
    const { register: registerSource } = sourceRegistry;

    if (requirements && typeof requirements === 'string' && requirements.trim()) {
        registerSource({
            id: 'user-requirements',
            title: 'Требования для правки ТК',
            description: 'Требования, переданные для контекста правки',
            type: 'requirement',
            content: requirements.trim()
        });
    }

    // Шаг 3: Создаем contextFetcher для запроса требований из Confluence при необходимости
    const contextFetcher = bearerToken
        ? async (requestedPageId) => {
            try {
                if (requestedPageId == null) return '';
                const requestedIdStr = String(requestedPageId);
                if (!requestedIdStr.trim() || !/^\d+$/.test(requestedIdStr)) return '';

                console.log(`[fixTestCasesAsync] Запрос контекста из Confluence: pageId=${requestedIdStr}`);
                const { markdown } = await fetchConfluencePage(bearerToken.trim(), requestedIdStr, { inlineTextAttachments: true });
                return markdown || '';
            } catch (err) {
                console.warn(`[fixTestCasesAsync] Ошибка загрузки контекста pageId=${requestedPageId}:`, err.message);
                return '';
            }
        }
        : null;

    const contextToolset = createContextToolset({
        sources: sourceRegistry.getSources(),
        fetcher: contextFetcher
    });

    const interactiveTools = Array.isArray(contextToolset.tools) ? contextToolset.tools : [];
    const contextToolHandlers = contextToolset.handlers || {};
    const toolSummary = contextToolset.summary || '—';

    const toolInstruction = interactiveTools.length
        ? `\n\n🛠️ ДОСТУПНЫЕ ИНСТРУМЕНТЫ ДЛЯ ЗАПРОСА ТРЕБОВАНИЙ:\n${toolSummary}\n\nЕсли нужно получить дополнительные требования для правильной правки тест-кейсов, используй эти инструменты.\n`
        : '';

    // Шаг 4: Загружаем идеальные примеры из БД для улучшения правки
    let perfectExamples = null;
    if (projectId) {
        try {
            perfectExamples = await getAllPerfectExamplesByLayer(projectId, db);
            console.log(`[fixTestCasesAsync] Загружено идеальных примеров из БД для проекта ${projectId}:`,
                Object.keys(perfectExamples).map(l => `${l}: ${perfectExamples[l].length}`).join(', '));
        } catch (err) {
            console.warn(`[fixTestCasesAsync] Ошибка загрузки идеальных примеров из БД:`, err.message);
            perfectExamples = null;
        }
    }

    // ✅ Шаг 5: Подготавливаем системный промпт для правки используя МОДУЛЬНУЮ СИСТЕМУ ПРОМПТОВ
    // Используем buildSystemPrompt для композиции промпта из модулей
    // Получаем историю ошибок из контекста для передачи в промпт
    const errorHistory = context ? (context.metadata.previousErrors || []) : [];

    // Формируем список идеальных примеров для промпта
    const perfectExamplesList = perfectExamples && Object.keys(perfectExamples).length > 0
        ? [
            ...(perfectExamples['E2E Tests'] || []).slice(0, 2),
            ...(perfectExamples['Integration frontend Tests'] || []).slice(0, 2),
            ...(perfectExamples['Integration backend Tests'] || []).slice(0, 2)
        ]
        : [];

    // ✅ Создаём системный промпт используя модульную систему
    const systemPrompt = buildSystemPrompt({
        mode: 'fix',
        requirements: requirements || null,
        examples: perfectExamplesList.length > 0 ? perfectExamplesList : null,
        errorHistory: errorHistory.length > 0 ? errorHistory : null,
        includeE2ERules: true,
        includeIntegrationRules: true
    });

    // ✅ Инициализируем или обновляем контекст диалога
    if (!context) {
        context = createConversationContext(taskId, {
            systemPrompt,
            metadata: {
                attemptNumber: 0,
                previousErrors: [],
                fixAttempts: [],
                projectId,
                requirements: requirements || null
            }
        });
        console.log(`[fixTestCasesAsync] Создан новый контекст для taskId: ${taskId}`);
    } else {
        // Если контекст существует, обновляем системный промпт если нужно (только при первой попытке)
        if (attemptNumber === 1 && context.messages.length === 1) {
            context.messages[0].content = systemPrompt;
            console.log(`[fixTestCasesAsync] Обновлён системный промпт в существующем контексте taskId: ${taskId}`);
        }
    }

    // ✅ Идеальные примеры и ошибки уже включены в systemPrompt через buildSystemPrompt
    // Дополнительно добавляем идеальные примеры в messages как few-shot learning
    const perfectExamplesForFewShot = perfectExamplesList.length > 0 ? perfectExamplesList : [];

    // ✅ Получаем контекст для добавления few-shot примеров в messages
    context = getConversationContext(taskId);
    if (context && perfectExamplesForFewShot.length > 0) {
        // Добавляем few-shot примеры в начало диалога (после system message)
        const fewShotMessages = addPerfectExamplesAsFewShot([], perfectExamplesForFewShot, 2);
        // Вставляем few-shot примеры после system message (если их ещё нет)
        if (context.messages.length === 1) {
            context.messages.push(...fewShotMessages);
            console.log(`[fixTestCasesAsync] Добавлено ${fewShotMessages.length} few-shot примеров в контекст taskId: ${taskId}`);
        }
    }

    // Шаг 6: Разбиваем ТК на чанки если их много (для оптимизации)
    const CHUNK_SIZE = 20; // Максимум 20 ТК за раз
    const chunks = [];
    for (let i = 0; i < targetCases.length; i += CHUNK_SIZE) {
        chunks.push(targetCases.slice(i, i + CHUNK_SIZE));
    }

    console.log(`[fixTestCasesAsync] Разбито на ${chunks.length} чанков по ${CHUNK_SIZE} ТК`);

    // Шаг 7: Обрабатываем каждый чанк через LLM
    const fixedCasesMap = new Map(); // id → исправленный ТК
    const allFixedCases = [...testCases]; // Начальный список всех ТК

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        console.log(`[fixTestCasesAsync] Обработка чанка ${chunkIdx + 1}/${chunks.length} (${chunk.length} ТК)...`);

        try {
            const strictConstraints = `
⛔⛔⛔ ЖЕСТКИЕ ЗАПРЕТЫ (CRITICAL RULES) ⛔⛔⛔

1. ЗАПРЕЩЕНО исправлять грамматику, пунктуацию или стиль, если это НЕ указано явно в промпте.
2. ЗАПРЕЩЕНО "улучшать" шаги, если промпт НЕ просит менять steps. Если шаги плохие — оставь их плохими.
3. ЗАПРЕЩЕНО менять "title", "feature", "story", если промпт НЕ касается переименования.
4. Если тест-кейс НЕ подпадает под критерии изменений — верни его БЕЗ ЕДИНОЙ ПРАВКИ.
5. Ты — оператор точечной хирургии, а не автор новых тестов. Выполняй ТОЛЬКО требуемые операции.
`;

            // Создаем user prompt с контекстом для этого чанка
            const userPrompt = `❗❗❗ КРИТИЧНО: СОХРАНИ ПОЛЕ "id" ИЗ КАЖДОГО ТЕСТ-КЕЙСА! ❗❗❗

🎯 ЗАДАЧА: Исправить следующие тест-кейсы согласно указанным доработкам.

🚨 ВАЖНО: В системном промпте выше есть раздел "⭐ ИДЕАЛЬНЫЕ ПРИМЕРЫ" — ОБЯЗАТЕЛЬНО используй их как эталон формата при исправлении!
Ориентируйся на структуру, стиль и формат из идеальных примеров — они показывают правильный способ оформления тест-кейсов!

❗❗❗ КРИТИЧНО К ШАГАМ (STEPS):
- ❌ ЗАПРЕЩЕНО: steps: [] или пустой массив — каждый тест-кейс ДОЛЖЕН иметь шаги!
- ✅ E2E тесты: минимум 3 детализированных шага (например, "Авторизоваться в системе", "Перейти в раздел 'Платежи'", "Нажать кнопку 'Создать платеж'")
- ✅ Integration тесты: минимум 1-2 детализированных шага
- ❌ ЗАПРЕЩЕНО: неконкретные шаги типа "Проверить функциональность" или "Выполнить действие"
- ✅ ПРАВИЛЬНО: детализированные шаги с конкретными действиями и элементами интерфейса

═══════════════════════════════════════════════════════════════
📋 ИСХОДНЫЕ ТЕСТ-КЕЙСЫ (С ID) - СОХРАНИ ID В ОТВЕТЕ!
═══════════════════════════════════════════════════════════════

${JSON.stringify(chunk.map(tc => ({ id: tc.id, title: tc.title, feature: tc.feature, story: tc.story })), null, 2)}

ТРЕБОВАНИЯ:
1. В ответе ОБЯЗАТЕЛЬНО верни ВСЕ ${chunk.length} тест-кейсов
2. КАЖДЫЙ тест-кейс ДОЛЖЕН содержать поле "id" с ТОЧНО ТАКИМ ЖЕ значением, как в исходном списке выше
3. Порядок тест-кейсов СОХРАНИ как в input

═══════════════════════════════════════════════════════════════
📋 ПРОМПТ С ДОРАБОТКАМИ
═══════════════════════════════════════════════════════════════

${fixPrompt}

${strictConstraints}

═══════════════════════════════════════════════════════════════
📝 ТЕСТ-КЕЙСЫ ДЛЯ ПРАВКИ (${chunk.length} тест-кейсов)
═══════════════════════════════════════════════════════════════

${JSON.stringify(chunk, null, 2)}

═══════════════════════════════════════════════════════════════
🧠 ПОШАГОВАЯ МЕТОДОЛОГИЯ РАБОТЫ
═══════════════════════════════════════════════════════════════

ВЫПОЛНИ СЛЕДУЮЩИЕ ШАГИ СТРОГО ПО ПОРЯДКУ:

ШАГ 1: АНАЛИЗ ПРОМПТА (ОБЯЗАТЕЛЬНО!)
- Разбери промпт на отдельные пункты (1., 2., 3., 4.)
- Для каждого пункта определи:
  * Что именно требуется исправить?
  * К каким тест-кейсам это относится? (фильтры: слой, story, название в кавычках)
  * Какие поля нужно изменить? (layer, precondition, title, steps, scenario)

Пример анализа:
  Пункт 1: "Слишком много Е2Е тестов - часть из них можно декомпозировать и вынести и интеграционные фронт - например в стори \"Выбор типа счета\""
  → Тип проблемы: ДЕКОМПОЗИЦИЯ E2E → Integration Frontend
  → Целевые ТК: E2E тесты из story "Выбор типа счета"
  → Действие: преобразовать часть E2E в "Integration frontend Tests"

ШАГ 2: КЛАССИФИКАЦИЯ ПРОБЛЕМ (ОБЯЗАТЕЛЬНО!)
Определи тип проблемы для каждого пункта промпта:
- 🔀 ДЕКОМПОЗИЦИЯ: "слишком много E2E", "декомпозировать" → преобразовать часть E2E в Integration frontend
- 🏷️ ПРЕДУСЛОВИЕ: "невалидно для E2E", "убери все предусловия" → убрать технические precondition'ы из E2E
- 📝 НАЗВАНИЕ: "невалиден", "от лица пользователя" → изменить title на пользовательский язык
- 🎯 КОЛИЧЕСТВО: "слишком много", "оставить 1" → сократить количество E2E тестов
- 🏗️ СТРУКТУРА: "не имеет scenario хотя должен", "проверь структуру", "E2E только story", "Integration story и scenario" → проверить и исправить структуру (E2E без scenario, Integration с scenario)
- 🏷️ ТЕГИ: "тег должен быть M", "кроме бекенд тестов", "удостоверься чтобы тег был M" → добавить/проверить теги (M для E2E и frontend, S для backend)

ШАГ 3: ПЛАНИРОВАНИЕ ИСПРАВЛЕНИЙ (ОБЯЗАТЕЛЬНО!)
Для КАЖДОГО тест-кейса из списка выше определи:
- К какому пункту промпта относится? (может быть несколько)
- Какой тип проблемы? (см. ШАГ 2)
- Что именно нужно изменить? (layer, precondition, title, steps, scenario)
- Какие поля оставить БЕЗ ИЗМЕНЕНИЙ? (id, feature, story, tags, priority, version и т.д.)

Пример планирования:
  ТК "Создание платежа с текущим счетом" (E2E Tests, story "Выбор типа счета"):
  - Пункт 1: ДЕКОМПОЗИЦИЯ → нужно преобразовать в Integration frontend Tests
  - Пункт 2: ПРЕДУСЛОВИЕ → нужно убрать "Сервер доступен, БД готова"
  - План: изменить layer на "Integration frontend Tests", добавить scenario, убрать технический precondition

ШАГ 4: ПРИМЕНЕНИЕ ИСПРАВЛЕНИЙ (ОБЯЗАТЕЛЬНО!)
- Внеси изменения строго согласно плану из ШАГ 3
- Сохрани все остальные поля БЕЗ ИЗМЕНЕНИЙ
- Убедись, что id каждого ТК остался ПРЕЖНИМ

ВАЖНО для каждого типа проблемы:
- 🔀 ДЕКОМПОЗИЦИЯ: выбери 1-2 самых важных E2E, остальные → Integration frontend Tests (добавь scenario, измени layer, добавь тег M)
- 🏷️ ПРЕДУСЛОВИЕ: для E2E тестов удали технические precondition'ы ("Сервер доступен", "БД готова")
- 📝 НАЗВАНИЕ: для E2E тестов измени технические названия на пользовательские ("Получить успешный ответ от API" → "Успешно выполнить действие")
- 🎯 КОЛИЧЕСТВО: оставь только указанное количество E2E (остальные либо удали, либо преобразуй в Integration)
- 🏗️ СТРУКТУРА: 
  * Для E2E тестов: удали scenario если есть (E2E НЕ должны иметь scenario!)
  * Для Integration тестов: добавь scenario если нет (Integration ОБЯЗАТЕЛЬНО должны иметь scenario!)
  * Если scenario неизвестен — запроси требования через инструменты или сгенерируй на основе title
- 🏷️ ТЕГИ: 
  * Integration backend Tests: добавь тег "S" если его нет 

ШАГ 5: ПРОВЕРКА РЕЗУЛЬТАТА (ОБЯЗАТЕЛЬНО!)
Для КАЖДОГО исправленного тест-кейса проверь:
- ✅ Соответствует ли результат требованиям из промпта?
- ✅ Сохранены ли все поля, которые не должны были меняться? (id, feature, story, tags, priority, version)
- ✅ Правильно ли изменён layer? (если требовалось)
- ✅ Убраны ли технические precondition'ы из E2E? (если требовалось)
- ✅ Изменён ли title на пользовательский язык? (если требовалось для E2E)
- ✅ СТРУКТУРА: E2E тесты имеют только feature + story (БЕЗ scenario)? Если есть scenario — удали!
- ✅ СТРУКТУРА: Integration тесты имеют feature + story + scenario? Если нет scenario — добавь!
- ✅ ТЕГИ: Integration backend имеет тег "S" (но не обязательно "M")?
- ✅ Добавлен ли scenario для Integration тестов? (если требовалось)

═══════════════════════════════════════════════════════════════
🚨 КРИТИЧЕСКИ ВАЖНО
═══════════════════════════════════════════════════════════════

1. ✅ СНАЧАЛА ПРОАНАЛИЗИРУЙ промпт (ШАГ 1), потом классифицируй проблемы (ШАГ 2), затем планируй (ШАГ 3), только потом применяй (ШАГ 4)
2. ✅ Сохраняй ВСЕ поля тест-кейса БЕЗ ИЗМЕНЕНИЙ: id, feature, story, scenario, code, layer (кроме случаев когда его нужно менять), tags, priority, version, parameters, examples, links, jiraIssue
3. ✅ Применяй изменения ТОЛЬКО к указанным в промпте аспектам — остальное оставляй без изменений
4. ✅ Если в промпте указано конкретное название ТК в кавычках — правишь ТОЛЬКО его
5. ✅ Если в промпте указан слой (E2E, Integration) — правишь ТОЛЬКО ТК этого слоя
6. ✅ Если нужно больше контекста для исправлений — используй доступные инструменты для запроса требований из Confluence
7. ✅ КРИТИЧЕСКИ ВАЖНО: Сохрани id каждого тест-кейса БЕЗ ИЗМЕНЕНИЙ — это критично для маппинга!
   - Каждый исправленный тест-кейс ДОЛЖЕН содержать поле "id" с ТОЧНО ТАКИМ ЖЕ значением, как в исходном списке
   - БЕЗ поля "id" система НЕ СМОЖЕТ сопоставить исправленный тест-кейс с исходным
   - Поле "id" ОБЯЗАТЕЛЬНО в JSON Schema и ДОЛЖНО присутствовать в КАЖДОМ тест-кейсе

═══════════════════════════════════════════════════════════════
📤 ФИНАЛЬНЫЙ ШАГ
═══════════════════════════════════════════════════════════════

После выполнения всех шагов (1-5) верни исправленные тест-кейсы через tool submit_fixed_cases.

ВАЖНО: Верни ВСЕ тест-кейсы из списка выше:
- Те, которые были исправлены — с изменениями
- Те, которые не требовали исправлений — БЕЗ изменений (исходные)
- Все должны иметь ПРЕЖНИЙ id!`;

            // Создаем инструмент для возврата исправленных ТК
            const buildSubmitFixedCasesTool = () => ({
                type: "function",
                function: {
                    name: "submit_fixed_cases",
                    description: "Верни исправленные тест-кейсы в массиве cases",
                    parameters: {
                        type: "object",
                        properties: {
                            cases: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string", description: "ID тест-кейса (обязательно сохрани исходный)" },
                                        feature: { type: "string" },
                                        story: { type: "string" },
                                        scenario: { type: "string" },
                                        code: { type: "string" },
                                        title: { type: "string" },
                                        precondition: { type: "string" },
                                        steps: {
                                            type: "array",
                                            items: {
                                                oneOf: [
                                                    { type: "string" },
                                                    { type: "object", properties: { sharedStepId: { type: "number" } }, required: ["sharedStepId"] },
                                                    { type: "object", properties: { text: { type: "string" }, expectedResult: { type: "string" } }, required: ["text", "expectedResult"] }
                                                ]
                                            }
                                        },
                                        expected: { type: "string" },
                                        tags: { type: "array", items: { type: "string" } },
                                        layer: { type: "string" },
                                        priority: { type: "string" },
                                        version: { type: "string" },
                                        parameters: {
                                            type: "array",
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
                                        },
                                        links: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    text: { type: "string" },
                                                    url: { type: "string" }
                                                },
                                                required: ["text", "url"]
                                            }
                                        },
                                        jiraIssue: { type: "string" }
                                    },
                                    required: ["id", "title", "feature", "story", "steps", "expected", "tags", "layer"]
                                }
                            }
                        },
                        required: ["cases"]
                    }
                }
            });

            const tools = [buildSubmitFixedCasesTool(), ...interactiveTools];

            // Создаем handler для submit_fixed_cases
            const fixedCasesHandler = async (args) => {
                console.log(`[fixTestCasesAsync] Получены исправленные ТК через tool: ${args.cases?.length || 0} кейсов`);
                return { success: true, message: `Принято ${args.cases?.length || 0} исправленных тест-кейсов` };
            };

            // ✅ Используем runTestCaseLLMWithContext для сохранения истории диалога
            // Формируем user prompt с контекстом предыдущих попыток
            let contextualUserPrompt = userPrompt;

            // Получаем актуальный контекст для получения истории ошибок
            context = getConversationContext(taskId);
            const currentErrorHistory = context ? (context.metadata.previousErrors || []) : [];

            if (attemptNumber > 1 && currentErrorHistory.length > 0) {
                const recentErrors = currentErrorHistory.slice(-3); // Последние 3 ошибки
                contextualUserPrompt = `🔄 ПОПЫТКА ИСПРАВЛЕНИЯ #${attemptNumber}

${recentErrors.length > 0 ? `
⚠️ ПРЕДЫДУЩИЕ ПОПЫТКИ НЕ СРАБОТАЛИ:

${recentErrors.map((err, i) => `
Попытка ${attemptNumber - recentErrors.length + i}:
${err.userRequest ? `- Запрос: ${err.userRequest.substring(0, 100)}...` : ''}
- Проблема: ${err.error}
`).join('\n')}

❗ НЕ ПОВТОРЯЙТЕ ОШИБКИ ВЫШЕ!
` : ''}

${userPrompt}`;
            }

            // ✅ Вызываем LLM с контекстом для сохранения истории
            const result = await runTestCaseLLMWithContext({
                taskId,
                userPrompt: contextualUserPrompt,
                systemPrompt, // Используем модульный промпт (если контекст новый, иначе будет использован существующий)
                tools,
                toolHandlers: {
                    ...contextToolHandlers,
                    submit_fixed_cases: fixedCasesHandler
                },
                finalToolNames: ['submit_fixed_cases'],
                modelOptions: {
                        maxIterations: 5,
                    temperature: 0,
                        top_p: 0.1,
                    max_tokens: 45000,
                    extra: { transforms: 'middle-out' }
                },
                maxTokens: 150000, // Максимальное количество токенов для контекста
                responseFormat: TEST_CASE_RESPONSE_FORMAT_FIX // ✅ Используем схему с обязательным id
            });

            // Извлекаем исправленные ТК из ответа
            let fixedCases = [];
            if (result.status === 'final-tool-call' && result.toolName === 'submit_fixed_cases' && result.args?.cases) {
                // Если модель вернула результат через tool
                fixedCases = result.args.cases;
                console.log(`[fixTestCasesAsync] ✅ Извлечено ${fixedCases.length} исправленных ТК через tool (попытка #${attemptNumber}, сообщений в контексте: ${result.context?.messagesCount || 'N/A'})`);
            } else if (result.response) {
                // Если модель вернула результат в response
                fixedCases = extractFixedCasesFromResponse(result.response, chunk);
                console.log(`[fixTestCasesAsync] ✅ Извлечено ${fixedCases.length} исправленных ТК из response (попытка #${attemptNumber}, сообщений в контексте: ${result.context?.messagesCount || 'N/A'})`);
            } else if (result.message?.content) {
                // ✅ ДОПОЛНИТЕЛЬНАЯ ОБРАБОТКА: Пытаемся извлечь из result.message.content напрямую
                console.log(`[fixTestCasesAsync] Пытаемся извлечь из result.message.content (${result.message.content.length} символов)`);
                // Используем улучшенную функцию extractFixedCasesFromResponse
                fixedCases = extractFixedCasesFromResponse({ choices: [{ message: result.message }] }, chunk);
                if (fixedCases.length > 0) {
                    console.log(`[fixTestCasesAsync] ✅ Извлечено ${fixedCases.length} исправленных ТК из message.content через extractFixedCasesFromResponse`);
                } else {
                    console.warn(`[fixTestCasesAsync] ⚠️ Не удалось извлечь ТК из message.content`);
                }
            } else {
                console.warn(`[fixTestCasesAsync] ⚠️ Не удалось извлечь исправленные ТК из ответа`);
            }

            // ✅ ВОССТАНОВЛЕНИЕ ID ПЕРЕД валидацией: если модель не вернула id, восстанавливаем по индексу или другим полям
            if (fixedCases.length > 0) {
                // Функция восстановления id
                const casesWithIds = fixedCases.map((fixed, index) => {
                    // Если id уже есть и валиден - возвращаем как есть
                    if (fixed.id && fixed.id !== 'undefined' && fixed.id !== undefined && fixed.id !== null) {
                        return fixed;
                    }

                    // ✅ FALLBACK 1: Пытаемся найти по индексу (если порядок сохранён)
                    if (index < chunk.length) {
                        const original = chunk[index];
                        console.warn(`[fixTestCasesAsync] 🔧 Восстановлен id по индексу ${index}: ${original.id} для ТК "${fixed.title || 'БЕЗ НАЗВАНИЯ'}"`);
                        return { ...fixed, id: original.id };
                    }

                    // ✅ FALLBACK 2: Пытаемся найти по title + feature + story (уже реализовано в extractFixedCasesFromResponse, но на всякий случай)
                    if (fixed.title && fixed.feature && fixed.story) {
                        const original = chunk.find(oc =>
                            oc.title === fixed.title &&
                            oc.feature === fixed.feature &&
                            oc.story === fixed.story
                        );

                        if (original) {
                            console.warn(`[fixTestCasesAsync] 🔧 Восстановлен id по title+feature+story: ${original.id} для ТК "${fixed.title}"`);
                            return { ...fixed, id: original.id };
                        }
                    }

                    // ✅ FALLBACK 3: Пытаемся найти по частичному совпадению title
                    if (fixed.title) {
                        const titleWords = fixed.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                        const original = chunk.find(oc => {
                            if (!oc.title) return false;
                            const ocTitleWords = oc.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                            const matches = titleWords.filter(w => ocTitleWords.includes(w));
                            return matches.length >= Math.min(2, Math.ceil(titleWords.length * 0.5));
                        });

                        if (original) {
                            console.warn(`[fixTestCasesAsync] 🔧 Восстановлен id по частичному совпадению title: ${original.id} для ТК "${fixed.title}"`);
                            return { ...fixed, id: original.id };
                        }
                    }

                    // Если не удалось восстановить - логируем ошибку
                    console.error(`[fixTestCasesAsync] ❌ Не удалось восстановить id для ТК "${fixed.title || 'БЕЗ НАЗВАНИЯ'}" (индекс ${index})`);
                    return fixed;
                });

                fixedCases = casesWithIds;
            }

            // ✅ Валидация исправленных ТК ПЕРЕД применением
            if (fixedCases.length > 0) {
                const validation = validateFixedCases(fixedCases, chunk);
                if (!validation.valid) {
                    // Записываем ошибки валидации в контекст для следующей попытки
                    const errorMsg = `Ошибки валидации: ${validation.errors.join('; ')}`;
                    addErrorToContext(taskId, errorMsg, fixPrompt);
                    console.warn(`[fixTestCasesAsync] ⚠️ Валидация не пройдена для чанка ${chunkIdx + 1}:`, validation.errors);
                    // Продолжаем, но логируем предупреждение
                } else {
                    console.log(`[fixTestCasesAsync] ✅ Валидация пройдена для чанка ${chunkIdx + 1}`);
                    // ✅ Очищаем ошибки после успешной валидации
                    if (attemptNumber === 1) {
                        clearErrors(taskId);
                    }
                }
            }

            if (fixedCases.length > 0) {
                console.log(`[fixTestCasesAsync] ✅ Чанк ${chunkIdx + 1}: исправлено ${fixedCases.length} ТК`);
                // Обновляем исправленные ТК в результирующем списке
                fixedCases.forEach(fixedCase => {
                    const index = allFixedCases.findIndex(tc => tc.id === fixedCase.id);
                    if (index !== -1) {
                        const originalCase = originalCasesMap.get(fixedCase.id) || allFixedCases[index];
                        const safeFixedCase = mergePreservingOriginals(originalCase, fixedCase, fixPrompt);
                        allFixedCases[index] = safeFixedCase;
                        fixedCasesMap.set(safeFixedCase.id, safeFixedCase);
                    } else {
                        console.warn(`[fixTestCasesAsync] ⚠️ Не найден ТК с id=${fixedCase.id} в исходном списке`);
                    }
                });
            } else {
                console.warn(`[fixTestCasesAsync] ⚠️ Чанк ${chunkIdx + 1}: не удалось извлечь исправленные ТК из ответа`);
            }

        } catch (chunkErr) {
            console.error(`[fixTestCasesAsync] ❌ Ошибка при обработке чанка ${chunkIdx + 1}:`, chunkErr.message);
            // Продолжаем обработку других чанков
        }
    }

    console.log(`[fixTestCasesAsync] ✅ Завершено. Исправлено ${fixedCasesMap.size} из ${targetCases.length} целевых ТК`);
    return allFixedCases;
}

/**
 * Определяет какие тест-кейсы нужно править на основе промпта
 * @param {Array} testCases - Массив всех тест-кейсов
 * @param {string} fixPrompt - Промпт с описанием доработок
 * @returns {Array} - Массив тест-кейсов для правки
 */
function identifyTargetCases(testCases, fixPrompt) {
    const promptLower = (fixPrompt || '').toLowerCase();
    const targetCases = [];
    const seenCaseIds = new Set();

    const addCase = (tc) => {
        const key = tc.id != null ? `id:${tc.id}` : `${tc.feature || ''}:${tc.story || ''}:${tc.title || ''}`;
        if (seenCaseIds.has(key)) {
            return;
        }
        seenCaseIds.add(key);
        targetCases.push(tc);
    };

    // Извлекаем указанные названия ТК из промпта (в кавычках)
    const titleMatches = fixPrompt.match(/"([^"]+)"/g);
    const targetTitles = titleMatches ? titleMatches.map(m => m.slice(1, -1).toLowerCase()) : [];

    const idFilters = extractIdFiltersFromPrompt(fixPrompt);
    if (idFilters.size > 0) {
        console.log(`[identifyTargetCases] Применяем фильтр по ID (${idFilters.size})`);
    }

    const regexFilters = extractRegexFiltersFromPrompt(fixPrompt);
    if (regexFilters.length > 0) {
        console.log(`[identifyTargetCases] Применяем фильтр по регулярным выражениям: ${regexFilters.map(r => r.toString()).join(', ')}`);
    }

    const matchesRegexFilters = (tc) => {
        if (!regexFilters.length) return false;
        const valuesToCheck = [
            tc.id != null ? String(tc.id) : '',
            tc.title || '',
            tc.story || '',
            tc.feature || '',
            tc.layer || ''
        ];

        return regexFilters.some(regex =>
            valuesToCheck.some(value => value && regex.test(value))
        );
    };

    // Определяем слой из промпта
    const isE2E = /e2e|е2е|e-2-e|полный цикл/i.test(fixPrompt);
    const isIntegration = /integration|интеграционн/i.test(fixPrompt);
    const isFrontend = /frontend|фронтенд|front-end/i.test(fixPrompt);
    const isBackend = /backend|бэкенд|back-end/i.test(fixPrompt);

    testCases.forEach(tc => {
        const titleLower = (tc.title || '').toLowerCase();
        const layer = (tc.layer || '').toLowerCase();
        const tcIdLower = tc.id != null ? String(tc.id).toLowerCase() : '';

        // Фильтр по конкретным ID
        if (idFilters.size > 0 && tcIdLower && idFilters.has(tcIdLower)) {
            addCase(tc);
            return;
        }

        // Фильтр по регулярным выражениям
        if (regexFilters.length > 0 && matchesRegexFilters(tc)) {
            addCase(tc);
            return;
        }

        // Фильтр по названию (если указано в промпте)
        if (targetTitles.length > 0) {
            const matchesTitle = targetTitles.some(targetTitle => titleLower.includes(targetTitle));
            if (matchesTitle) {
                addCase(tc);
                return;
            }
        }

        // Фильтр по слою
        if (isE2E && layer.includes('e2e')) {
            addCase(tc);
            return;
        }
        if (isIntegration) {
            if (layer.includes('integration')) {
                if ((isFrontend && layer.includes('frontend')) ||
                    (isBackend && layer.includes('backend')) ||
                    (!isFrontend && !isBackend)) {
                    addCase(tc);
                    return;
                }
            }
        }

        // Если конкретные фильтры не применены — проверяем упоминание в промпте
        if (targetTitles.length === 0 && !isE2E && !isIntegration && idFilters.size === 0 && regexFilters.length === 0) {
            // Если промпт упоминает название ТК (без кавычек)
            if (titleLower.length > 5 && promptLower.includes(titleLower.substring(0, Math.min(titleLower.length, 30)))) {
                addCase(tc);
                return;
            }
        }
    });

    const hasExplicitFilters = isE2E || isIntegration || targetTitles.length > 0 || idFilters.size > 0 || regexFilters.length > 0;

    // Если не нашли по фильтрам — возвращаем все (для общей правки)
    if (targetCases.length === 0 && !hasExplicitFilters) {
        console.log('[identifyTargetCases] Не найдено конкретных ТК по фильтрам, применяем правку ко всем');
        return testCases;
    }

    return targetCases;
}

function extractIdFiltersFromPrompt(fixPrompt = '') {
    const ids = new Set();
    if (!fixPrompt) {
        return ids;
    }

    const normalized = fixPrompt.replace(/\r/g, ' ');
    const addId = (rawId) => {
        if (rawId == null) return;
        const cleaned = String(rawId).trim().replace(/^["']|["']$/g, '');
        if (!cleaned) return;
        ids.add(cleaned.toLowerCase());
    };

    const bracketListPattern = /\bids?\s*(?:=|:)\s*\[([^\]]+)]/gi;
    let match;
    while ((match = bracketListPattern.exec(normalized)) !== null) {
        match[1].split(/[,;\s]+/).forEach(addId);
    }

    const inlineListPattern = /\bids?\s*(?:=|:)?\s*((?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)(?:\s*,\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+))+)/gi;
    while ((match = inlineListPattern.exec(normalized)) !== null) {
        match[1].split(/\s*,\s*/).forEach(addId);
    }

    const singleIdPattern = /\b(?:id|tc(?:-?id)?|case|тест(?:-|\s*)кейс)\s*(?:№|#|=|:)?\s*([A-Za-z0-9_-]{3,})/gi;
    while ((match = singleIdPattern.exec(normalized)) !== null) {
        addId(match[1]);
    }

    return ids;
}

function extractRegexFiltersFromPrompt(fixPrompt = '') {
    const filters = [];
    if (!fixPrompt) {
        return filters;
    }

    const normalized = fixPrompt.replace(/\r/g, '');
    const keywordPattern = /(regex|regexp|регулярк[аи]?|pattern)\s*(?:=|:)\s*([^\n]+)/gi;
    let match;
    while ((match = keywordPattern.exec(normalized)) !== null) {
        const chunk = match[2] || '';
        chunk.split(/\s*,\s*/).forEach(part => {
            const regex = buildRegexFromRaw(part.trim());
            if (regex) {
                filters.push(regex);
            }
        });
    }

    return filters;
}

function buildRegexFromRaw(rawPattern) {
    if (!rawPattern) {
        return null;
    }

    let pattern = rawPattern.trim();
    if (!pattern) {
        return null;
    }

    // Убираем завершающие точки/точки с запятой, часто попадающие из описаний
    pattern = pattern.replace(/[.;,]+$/, '');

    if ((pattern.startsWith('"') && pattern.endsWith('"')) || (pattern.startsWith("'") && pattern.endsWith("'"))) {
        pattern = pattern.slice(1, -1);
    }

    let flags = 'i';
    const literalMatch = pattern.match(/^\/((?:\\.|[^/])+?)\/([gimsuy]*)$/);
    if (literalMatch) {
        pattern = literalMatch[1];
        flags = literalMatch[2] || 'i';
    } else if (pattern.startsWith('/') && pattern.endsWith('/')) {
        pattern = pattern.slice(1, -1);
    }

    flags = (flags || 'i').replace(/[^gimsuy]/g, '');
    flags = flags.replace(/g/g, ''); // избегаем stateful RegExp
    if (!flags.includes('i')) {
        flags += 'i';
    }

    try {
        return new RegExp(pattern, flags);
    } catch (err) {
        console.warn(`[identifyTargetCases] ❌ Некорректное регулярное выражение "${rawPattern}": ${err.message}`);
        return null;
    }
}

function extractStepCleanupRules(fixPrompt = '') {
    const tokens = new Set();
    if (!fixPrompt) {
        return [];
    }

    const addToken = (token) => {
        const normalized = (token || '').trim().toLowerCase();
        if (normalized) {
            tokens.add(normalized);
        }
    };

    const cleanupQuotedPattern = /(?:убер(?:и|ать)|удал(?:и|ить)|remove|delete|clean)[^"\n]*(?:шаги|steps)[^"]*"([^"]+)"/gi;
    let match;
    while ((match = cleanupQuotedPattern.exec(fixPrompt)) !== null) {
        addToken(match[1]);
    }

    const cleanupWordPattern = /(?:убер(?:и|ать)|удал(?:и|ить)|remove|delete|clean)[^.\n]*(?:провер(?:к|ки|ок)|checks?)/gi;
    while ((match = cleanupWordPattern.exec(fixPrompt)) !== null) {
        const phrase = match[0];
        if (/провер/i.test(phrase)) {
            addToken('провер');
        }
        if (/check/i.test(phrase)) {
            addToken('check');
        }
    }

    return Array.from(tokens).map(token => ({ type: 'contains', token }));
}

function evaluateStepCleanup(originalCase, modifiedCase, cleanupRules) {
    if (!cleanupRules.length) {
        return { allowed: false, removedCount: 0 };
    }

    const diff = diffSteps(originalCase?.steps, modifiedCase?.steps);
    if (!diff.removed.length) {
        return { allowed: false, removedCount: 0 };
    }

    if (diff.added.length > 0) {
        return { allowed: false, removedCount: 0 };
    }

    const allRemovedMatchRule = diff.removed.every(stepText =>
        cleanupRules.some(rule => stepText.toLowerCase().includes(rule.token))
    );

    return {
        allowed: allRemovedMatchRule,
        removedCount: diff.removed.length
    };
}

function diffSteps(originalSteps = [], modifiedSteps = []) {
    const original = Array.isArray(originalSteps) ? originalSteps.map(canonicalStepValue) : [];
    const modified = Array.isArray(modifiedSteps) ? modifiedSteps.map(canonicalStepValue) : [];

    const modifiedCounters = new Map();
    modified.forEach(value => {
        modifiedCounters.set(value, (modifiedCounters.get(value) || 0) + 1);
    });

    const removed = [];
    original.forEach(value => {
        const counter = modifiedCounters.get(value) || 0;
        if (counter > 0) {
            modifiedCounters.set(value, counter - 1);
        } else {
            removed.push(value);
        }
    });

    const added = [];
    modifiedCounters.forEach((count, value) => {
        if (count > 0) {
            for (let i = 0; i < count; i++) {
                added.push(value);
            }
        }
    });

    return { removed, added };
}

function canonicalStepValue(step) {
    if (step == null) {
        return '';
    }

    if (typeof step === 'string') {
        return step.trim();
    }

    if (typeof step === 'object') {
        const text = typeof step.text === 'string' ? step.text.trim() : '';
        const expectedResult = typeof step.expectedResult === 'string' ? step.expectedResult.trim() : '';

        if (text || expectedResult) {
            return [text, expectedResult].filter(Boolean).join(' → ').trim();
        }

        if (step.sharedStepId != null) {
            return `shared:${step.sharedStepId}`;
        }
    }

    return JSON.stringify(step);
}

/**
 * Извлекает исправленные тест-кейсы из ответа LLM
 * @param {Object} aiResponse - Ответ от LLM
 * @param {Array} originalCases - Исходные ТК для этого чанка (для маппинга)
 * @returns {Array} - Массив исправленных тест-кейсов
 */
function extractFixedCasesFromResponse(aiResponse, originalCases) {
    const fixedCases = [];

    // ✅ Проверка на пустой response
    if (!aiResponse || !aiResponse.choices?.[0]?.message) {
        console.error('[extractFixedCasesFromResponse] Пустой response или нет message');
        return [];
    }

    // ✅ Проверка finish_reason для диагностики обрезанного ответа
    const finishReason = aiResponse.choices?.[0]?.finish_reason;
    if (finishReason && finishReason !== 'stop') {
        console.warn(`[extractFixedCasesFromResponse] ⚠️ finish_reason=${finishReason} (возможно обрезанный ответ)`);
    }

    // Пытаемся извлечь из tool_calls
    const toolCalls = aiResponse?.choices?.[0]?.message?.tool_calls || [];
    for (const toolCall of toolCalls) {
        if (toolCall.function?.name === 'submit_fixed_cases') {
            try {
                // ✅ СНАЧАЛА пытаемся нативный JSON.parse, потом JSON5
                let args;
                if (typeof toolCall.function.arguments === 'string') {
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (jsonError) {
                        console.warn('[extractFixedCasesFromResponse] JSON.parse failed for tool_call, trying JSON5...', jsonError.message);
                        try {
                            args = JSON5.parse(toolCall.function.arguments);
                        } catch (json5Error) {
                            console.error('[extractFixedCasesFromResponse] JSON5.parse тоже не сработал:', json5Error.message);
                            throw json5Error;
                        }
                    }
                } else {
                    args = toolCall.function.arguments;
                }

                if (args.cases && Array.isArray(args.cases)) {
                    // Маппим исправленные ТК к исходным по ID
                    args.cases.forEach(fixedCase => {
                        // ✅ СНАЧАЛА: Ищем по id (если есть)
                        let original = fixedCase.id
                            ? originalCases.find(oc => oc.id === fixedCase.id)
                            : null;

                        // ✅ FALLBACK: Если не нашли по id, пытаемся найти по title + feature + story
                        if (!original && fixedCase.title && fixedCase.feature && fixedCase.story) {
                            original = originalCases.find(oc =>
                                oc.title === fixedCase.title &&
                                oc.feature === fixedCase.feature &&
                                oc.story === fixedCase.story
                            );

                            if (original) {
                                console.log(`[extractFixedCasesFromResponse] 🔍 Tool_call: ТК "${fixedCase.title}" найден по title+feature+story, восстанавливаю id=${original.id}`);
                            }
                        }

                        if (original) {
                            // Сохраняем все исходные поля, которые не были изменены
                            const merged = {
                                ...original,
                                ...fixedCase,
                                // Гарантируем что id не изменился
                                id: original.id
                            };
                            fixedCases.push(merged);
                        } else {
                            // Если не нашли - логируем и добавляем как есть
                            if (!fixedCase.id) {
                                console.warn(`[extractFixedCasesFromResponse] ⚠️ Tool_call: ТК "${fixedCase.title || 'БЕЗ НАЗВАНИЯ'}" не найден в исходном списке и не имеет id`);
                            }
                            fixedCases.push(fixedCase);
                        }
                    });
                }
            } catch (parseErr) {
                console.error('[extractFixedCasesFromResponse] Ошибка парсинга tool_call:', parseErr.message);
            }
        }
    }

    // Если не нашли в tool_calls, пытаемся извлечь из content
    if (fixedCases.length === 0) {
        let content = aiResponse?.choices?.[0]?.message?.content || '';

        // ✅ Удаляем markdown-обёртку, если есть
        if (typeof content === 'string') {
            content = content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
        }

        // ✅ Логируем полный контент для диагностики
        console.log(`[extractFixedCasesFromResponse] Content length: ${content.length} chars`);
        console.log(`[extractFixedCasesFromResponse] Content start (first 300):`, content.substring(0, 300));
        console.log(`[extractFixedCasesFromResponse] Content end (last 300):`, content.substring(Math.max(0, content.length - 300)));

        if (content.trim()) {
            try {
                // ✅ СНАЧАЛА: Пытаемся найти объект { "cases": [...] } (основной формат)
                // Ищем начало объекта с cases (с учётом пробелов и переносов строк)
                let casesStartIdx = -1;

                // Пробуем разные варианты поиска
                const patterns = [
                    '{ "cases"',
                    '{"cases"',
                    '{\n\n\n  "cases"',
                    '{\n  "cases"',
                    '{\n"cases"',
                    '{ "cases":',
                    '{"cases":'
                ];

                for (const pattern of patterns) {
                    const idx = content.indexOf(pattern);
                    if (idx !== -1) {
                        casesStartIdx = idx;
                        console.log(`[extractFixedCasesFromResponse] 🔍 Найден объект cases с паттерном "${pattern}" в позиции ${idx}`);
                        break;
                    }
                }

                // Если точный поиск не сработал, ищем начало JSON объекта
                if (casesStartIdx === -1) {
                    // Ищем первое вхождение "cases" и откатываемся к ближайшей открывающей скобке
                    const casesIdx = content.indexOf('"cases"');
                    if (casesIdx !== -1) {
                        // Ищем открывающую скобку перед "cases"
                        for (let i = casesIdx - 1; i >= 0; i--) {
                            if (content[i] === '{') {
                                casesStartIdx = i;
                                console.log(`[extractFixedCasesFromResponse] 🔍 Найден объект cases по "cases" в позиции ${casesIdx}, начало объекта в ${i}`);
                                break;
                            }
                        }
                    }
                }

                if (casesStartIdx !== -1) {
                    // Берём всё от начала объекта до конца строки (может быть обрезано)
                    let jsonText = content.substring(casesStartIdx);

                    // ✅ Восстанавливаем обрезанный JSON: закрываем незакрытые скобки
                    const openBraces = (jsonText.match(/\{/g) || []).length;
                    const closeBraces = (jsonText.match(/\}/g) || []).length;
                    const openBrackets = (jsonText.match(/\[/g) || []).length;
                    const closeBrackets = (jsonText.match(/\]/g) || []).length;

                    console.log(`[extractFixedCasesFromResponse] 🔍 Найден объект cases, восстанавливаю JSON: открыто скобок [${openBrackets}]/[${openBraces}], закрыто [${closeBrackets}]/[${closeBraces}]`);

                    // Закрываем незакрытые скобки (сначала массив, потом объект)
                    if (closeBrackets < openBrackets) {
                        const missingBrackets = openBrackets - closeBrackets;
                        jsonText += ']'.repeat(missingBrackets);
                        console.log(`[extractFixedCasesFromResponse] 🔧 Добавлено ${missingBrackets} закрывающих скобок для массива`);
                    }
                    if (closeBraces < openBraces) {
                        const missingBraces = openBraces - closeBraces;
                        jsonText += '}'.repeat(missingBraces);
                        console.log(`[extractFixedCasesFromResponse] 🔧 Добавлено ${missingBraces} закрывающих скобок для объекта`);
                    }

                    // ✅ Очистка от синтаксических ошибок: удаляем лишние запятые перед } или ]
                    // Паттерн: запятая, за которой идут пробелы/переносы и закрывающая скобка
                    jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');

                    // ✅ Исправляем ошибки типа "field": value ,"nextField" (запятая с пробелами после значения перед закрывающей скобкой)
                    // Ищем: любое значение (строка, число, булево, null, массив, объект), пробелы, запятая, пробелы, закрывающая скобка
                    // Более точный паттерн: удаляем запятые, которые стоят после значения и перед закрывающей скобкой объекта/массива
                    jsonText = jsonText.replace(/(["\]\dtruefalsenull}])\s*,\s*([}\]])/g, '$1$2');

                    try {
                        // ✅ СНАЧАЛА пытаемся нативный JSON.parse
                        let parsed;
                        try {
                            parsed = JSON.parse(jsonText);
                        } catch (jsonError) {
                            console.warn('[extractFixedCasesFromResponse] JSON.parse failed, trying JSON5...', jsonError.message);
                            try {
                                parsed = JSON5.parse(jsonText);
                            } catch (json5Error) {
                                console.error('[extractFixedCasesFromResponse] JSON5.parse тоже не сработал:', json5Error.message);
                                throw json5Error;
                            }
                        }

                        if (parsed.cases && Array.isArray(parsed.cases)) {
                            parsed.cases.forEach(fixedCase => {
                                // ✅ СНАЧАЛА: Ищем по id (если есть)
                                let original = fixedCase.id
                                    ? originalCases.find(oc => oc.id === fixedCase.id)
                                    : null;

                                // ✅ FALLBACK: Если не нашли по id, пытаемся найти по title + feature + story
                                if (!original && fixedCase.title && fixedCase.feature && fixedCase.story) {
                                    original = originalCases.find(oc =>
                                        oc.title === fixedCase.title &&
                                        oc.feature === fixedCase.feature &&
                                        oc.story === fixedCase.story
                                    );

                                    if (original) {
                                        console.log(`[extractFixedCasesFromResponse] 🔍 ТК "${fixedCase.title}" найден по title+feature+story, восстанавливаю id=${original.id}`);
                                    }
                                }

                                if (original) {
                                    // Восстанавливаем id если его не было
                                    fixedCases.push({ ...original, ...fixedCase, id: original.id });
                                } else {
                                    // Если не нашли - логируем и добавляем как есть
                                    if (!fixedCase.id) {
                                        console.warn(`[extractFixedCasesFromResponse] ⚠️ ТК "${fixedCase.title || 'БЕЗ НАЗВАНИЯ'}" не найден в исходном списке и не имеет id`);
                                    }
                                    fixedCases.push(fixedCase);
                                }
                            });
                            console.log(`[extractFixedCasesFromResponse] ✅ Извлечено ${fixedCases.length} ТК из объекта { cases: [...] }`);
                            return fixedCases;
                        }
                    } catch (parseErr) {
                        console.warn(`[extractFixedCasesFromResponse] ⚠️ Не удалось распарсить объект cases после восстановления:`, parseErr.message);
                        console.warn(`[extractFixedCasesFromResponse] JSON текст (первые 500 символов):`, jsonText.substring(0, 500));

                        // ✅ Логируем проблемный участок вокруг позиции ошибки (если есть)
                        if (parseErr.message.includes('position')) {
                            const posMatch = parseErr.message.match(/position (\d+)/);
                            if (posMatch) {
                                const errorPos = parseInt(posMatch[1]);
                                const startPos = Math.max(0, errorPos - 100);
                                const endPos = Math.min(jsonText.length, errorPos + 100);
                                console.warn(`[extractFixedCasesFromResponse] Проблемный участок (позиция ${errorPos}):`, jsonText.substring(startPos, endPos));
                                console.warn(`[extractFixedCasesFromResponse] Контекст вокруг ошибки (строка ~${Math.floor(errorPos / 80)}):`,
                                    jsonText.substring(Math.max(0, errorPos - 50), Math.min(jsonText.length, errorPos + 50)));
                            }
                        }

                        // ✅ FALLBACK: Пытаемся извлечь отдельные объекты из массива cases
                        // Ищем начало массива cases
                        const arrayStartIdx = jsonText.indexOf('[');
                        if (arrayStartIdx !== -1) {
                            const arrayContent = jsonText.substring(arrayStartIdx);
                            // ✅ Улучшенный алгоритм: извлекаем объекты по подсчёту скобок
                            const extractedObjects = [];
                            let currentPos = 1; // После '['
                            let depth = 0; // Глубина вложенности объектов
                            let objStart = -1;

                            for (let i = 1; i < arrayContent.length; i++) {
                                const char = arrayContent[i];

                                if (char === '{') {
                                    if (depth === 0) {
                                        objStart = i; // Начало нового объекта
                                    }
                                    depth++;
                                } else if (char === '}') {
                                    depth--;
                                    if (depth === 0 && objStart !== -1) {
                                        // Найден полный объект
                                        const objText = arrayContent.substring(objStart, i + 1);
                                        try {
                                            // ✅ СНАЧАЛА пытаемся нативный JSON.parse
                                            let obj;
                                            try {
                                                obj = JSON.parse(objText);
                                            } catch (jsonError) {
                                                try {
                                                    obj = JSON5.parse(objText);
                                                } catch (json5Error) {
                                                    // Пропускаем невалидные объекты
                                                    throw json5Error;
                                                }
                                            }

                                            if (obj.id || obj.title || obj.layer) {
                                                extractedObjects.push(obj);
                                            } else {
                                                console.warn(`[extractFixedCasesFromResponse] ⚠️ Пропущен объект без id/title/layer`);
                                            }
                                        } catch (e) {
                                            // Пропускаем невалидные объекты
                                        }
                                        objStart = -1;
                                    }
                                } else if (char === ']' && depth === 0) {
                                    // Конец массива
                                    break;
                                }
                            }

                            // ✅ Если нашли начало объекта, но он обрезан - пытаемся восстановить
                            if (objStart !== -1 && depth > 0) {
                                console.log(`[extractFixedCasesFromResponse] 🔧 Найден обрезанный объект в позиции ${objStart}, пытаюсь восстановить (depth=${depth})`);
                                const objText = arrayContent.substring(objStart);
                                // Закрываем незакрытые скобки
                                let restoredObj = objText;
                                if (depth > 0) {
                                    // Нужно закрыть depth открытых объектов
                                    // Проверяем, есть ли незакрытые массивы
                                    const openInObj = (objText.match(/\[/g) || []).length;
                                    const closeInObj = (objText.match(/\]/g) || []).length;
                                    if (closeInObj < openInObj) {
                                        restoredObj += ']'.repeat(openInObj - closeInObj);
                                    }
                                    restoredObj += '}'.repeat(depth);
                                }

                                try {
                                    // ✅ СНАЧАЛА пытаемся нативный JSON.parse
                                    let obj;
                                    try {
                                        obj = JSON.parse(restoredObj);
                                    } catch (jsonError) {
                                        try {
                                            obj = JSON5.parse(restoredObj);
                                        } catch (json5Error) {
                                            throw json5Error;
                                        }
                                    }

                                    if (obj.id || obj.title || obj.layer) {
                                        extractedObjects.push(obj);
                                        console.log(`[extractFixedCasesFromResponse] ✅ Восстановлен обрезанный объект с id=${obj.id || 'N/A'}`);
                                    }
                                } catch (e) {
                                    console.warn(`[extractFixedCasesFromResponse] ⚠️ Не удалось восстановить обрезанный объект:`, e.message);
                                }
                            }

                            if (extractedObjects.length > 0) {
                                console.log(`[extractFixedCasesFromResponse] ✅ Fallback: извлечено ${extractedObjects.length} объектов напрямую из массива`);
                                extractedObjects.forEach(fixedCase => {
                                    // ✅ СНАЧАЛА: Ищем по id (если есть)
                                    let original = fixedCase.id
                                        ? originalCases.find(oc => oc.id === fixedCase.id)
                                        : null;

                                    // ✅ FALLBACK: Если не нашли по id, пытаемся найти по title + feature + story
                                    if (!original && fixedCase.title && fixedCase.feature && fixedCase.story) {
                                        original = originalCases.find(oc =>
                                            oc.title === fixedCase.title &&
                                            oc.feature === fixedCase.feature &&
                                            oc.story === fixedCase.story
                                        );

                                        if (original) {
                                            console.log(`[extractFixedCasesFromResponse] 🔍 Fallback: ТК "${fixedCase.title}" найден по title+feature+story, восстанавливаю id=${original.id}`);
                                        }
                                    }

                                    if (original) {
                                        fixedCases.push({ ...original, ...fixedCase, id: original.id });
                                    } else {
                                        if (!fixedCase.id) {
                                            console.warn(`[extractFixedCasesFromResponse] ⚠️ Fallback: ТК "${fixedCase.title || 'БЕЗ НАЗВАНИЯ'}" не найден в исходном списке`);
                                        }
                                        fixedCases.push(fixedCase);
                                    }
                                });
                                return fixedCases;
                            }
                        }
                    }
                }

                // ✅ FALLBACK: Пытаемся найти JSON массив [ ... ] в content
                const jsonMatch = content.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    let jsonText = jsonMatch[0];

                    // Восстанавливаем обрезанный массив
                    const openBrackets = (jsonText.match(/\[/g) || []).length;
                    const closeBrackets = (jsonText.match(/\]/g) || []).length;
                    if (closeBrackets < openBrackets) {
                        jsonText += ']'.repeat(openBrackets - closeBrackets);
                    }

                    try {
                        // ✅ СНАЧАЛА пытаемся нативный JSON.parse
                        let parsed;
                        try {
                            parsed = JSON.parse(jsonText);
                        } catch (jsonError) {
                            console.warn('[extractFixedCasesFromResponse] JSON.parse failed for array, trying JSON5...', jsonError.message);
                            try {
                                parsed = JSON5.parse(jsonText);
                            } catch (json5Error) {
                                console.error('[extractFixedCasesFromResponse] JSON5.parse тоже не сработал:', json5Error.message);
                                throw json5Error;
                            }
                        }

                        if (Array.isArray(parsed)) {
                            parsed.forEach(fixedCase => {
                                // ✅ СНАЧАЛА: Ищем по id (если есть)
                                let original = fixedCase.id
                                    ? originalCases.find(oc => oc.id === fixedCase.id)
                                    : null;

                                // ✅ FALLBACK: Если не нашли по id, пытаемся найти по title + feature + story
                                if (!original && fixedCase.title && fixedCase.feature && fixedCase.story) {
                                    original = originalCases.find(oc =>
                                        oc.title === fixedCase.title &&
                                        oc.feature === fixedCase.feature &&
                                        oc.story === fixedCase.story
                                    );

                                    if (original) {
                                        console.log(`[extractFixedCasesFromResponse] 🔍 Массив: ТК "${fixedCase.title}" найден по title+feature+story, восстанавливаю id=${original.id}`);
                                    }
                                }

                                if (original) {
                                    fixedCases.push({ ...original, ...fixedCase, id: original.id });
                                } else {
                                    if (!fixedCase.id) {
                                        console.warn(`[extractFixedCasesFromResponse] ⚠️ Массив: ТК "${fixedCase.title || 'БЕЗ НАЗВАНИЯ'}" не найден в исходном списке`);
                                    }
                                    fixedCases.push(fixedCase);
                                }
                            });
                            console.log(`[extractFixedCasesFromResponse] ✅ Извлечено ${fixedCases.length} ТК из массива [...]`);
                        }
                    } catch (parseErr) {
                        console.warn(`[extractFixedCasesFromResponse] ⚠️ Не удалось распарсить массив:`, parseErr.message);
                    }
                }
            } catch (parseErr) {
                console.error('[extractFixedCasesFromResponse] Ошибка парсинга content:', parseErr.message);
            }
        }
    }

    return fixedCases;
}

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
    // Объявляем переменные в начале функции
    let finalTestCases = [];
    const projectId = inputData?.projectId || inputData?.project_id; // ✅ ProjectId для Allure API
    const skipAllureAPICalls = inputData?.skipAllureAPICalls || false; // ✅ Флаг для debug режима
    const includeBackendTests = inputData?.includeBackendTests !== false; // ✅ По умолчанию true, если не указано

    if (skipAllureAPICalls) {
        console.log('[generateTestCasesAsync] 🐛 DEBUG MODE: skipAllureAPICalls=true (Allure API вызовы отключены)');
    }
    if (projectId) {
        console.log(`[generateTestCasesAsync] 🔑 ProjectId: ${projectId}`);
    }
    console.log(`[generateTestCasesAsync] 🔧 includeBackendTests: ${includeBackendTests} (${includeBackendTests ? 'генерируем E2E + Integration frontend + Integration backend' : 'генерируем только E2E + Integration frontend'})`);

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

            // ✅ Вспомогательная функция для извлечения текста шага
            const getStepText = (step) => {
                if (typeof step === 'string') {
                    return step;
                } else if (typeof step === 'object' && step !== null) {
                    // Может быть объектом с text, sharedStepId, или expectedResult
                    return step.text || step.body || String(step);
                }
                return String(step || '');
            };

            testCases.forEach((tc, idx) => {
                const tcNum = idx + 1;
                const title = tc.title || '';
                const steps = Array.isArray(tc.steps) ? tc.steps : [];
                const expected = tc.expected || '';
                const layer = tc.layer || '';
                const precondition = tc.precondition || '';

                // ✅ КРИТИЧНО: Проверка пустых шагов
                if (steps.length === 0) {
                    issues.push(`Тест-кейс ${tcNum} "${title}": имеет пустой массив steps: [] — ЗАПРЕЩЕНО! Каждый тест-кейс должен иметь минимум ${layer === 'E2E Tests' ? '3' : '1'} детализированных шага.`);
                }

                // ✅ КРИТИЧНО: Проверка недостаточного количества шагов
                if (layer === 'E2E Tests' && steps.length > 0 && steps.length < 3) {
                    issues.push(`Тест-кейс ${tcNum} "${title}": имеет недостаточно шагов (${steps.length}). Для E2E тестов требуется минимум 3 детализированных шага (например, "Авторизоваться в системе", "Перейти в раздел 'Платежи'", "Нажать кнопку 'Создать платеж'").`);
                }

                // ✅ КРИТИЧНО: Проверка неконкретных шагов
                const vagueSteps = steps.filter(step => {
                    const stepText = getStepText(step);
                    const stepTextLower = stepText.toLowerCase();
                    // Проверяем слишком короткие или абстрактные шаги
                    return stepText.length < 15 ||
                        /^(проверить|тест|действие|шаг|проверка)$/i.test(stepText) ||
                        /^(проверить\s+функциональность|проверить\s+работоспособность|выполнить\s+действие)$/i.test(stepTextLower);
                });

                if (vagueSteps.length > 0) {
                    const vagueTexts = vagueSteps.map(s => `"${getStepText(s).substring(0, 30)}${getStepText(s).length > 30 ? '...' : ''}"`).join(', ');
                    issues.push(`Тест-кейс ${tcNum} "${title}": содержит неконкретные или слишком короткие шаги: ${vagueTexts}. Шаги должны быть детализированными (например, "Авторизоваться в системе как пользователь с ролью 'Администратор'" вместо "Проверить функциональность").`);
                }

                // ✅ НОВАЯ ПРОВЕРКА 1: Заголовок E2E тестов не должен содержать "Полный цикл" или "E2E"
                if (layer === 'E2E Tests') {
                    const titleLower = title.toLowerCase();
                    if (titleLower.includes('полный цикл')) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": E2E тест содержит "Полный цикл" в заголовке - нужно информативное название сценария (например, "Создание документа..." вместо "Полный цикл создания документа")`);
                    }
                    if (titleLower.includes('e2e') || titleLower.includes('е2е')) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": E2E тест содержит слово "E2E" в заголовке - название должно быть информативным без указания типа теста (например, "Создание документа..." вместо "E2E: Создание документа")`);
                    }
                }

                // ✅ НОВАЯ ПРОВЕРКА 1.5: Заголовок не должен содержать плейсхолдеры {{Параметр}}
                if (title && title.includes('{{') && title.includes('}}')) {
                    issues.push(`Тест-кейс ${tcNum} "${title}": заголовок содержит плейсхолдер {{Параметр}} - параметры указываются в поле parameters, а не в названии! Используй информативное название без плейсхолдеров (например, "Создание документа с параметрами" вместо "Создание документа с {{Тип операции}}")`);
                }

                // ✅ НОВАЯ ПРОВЕРКА 1.6: E2E тесты не должны содержать детали HTTP-запросов, API-эндпоинтов, статус-кодов
                if (layer === 'E2E Tests') {
                    const hasApiDetails = /(GET|POST|PUT|DELETE|PATCH)\s+\/[^"'\s]+|http:\/\/|https:\/\/|эндпоинт|endpoint|api|статус\s*[-_]?код|status\s*code|deal\.|previousBankRegNumber|operationCode|status\s*\d{3}|\b200\b|\b400\b|\b404\b|\b500\b/gi;
                    const titleStepsExpected = `${title} ${steps.join(' ')} ${expected}`;
                    if (hasApiDetails.test(titleStepsExpected)) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": E2E тест содержит детали HTTP-запросов, API-эндпоинтов или статус-коды - E2E тесты это Black Box тестирование, не должны содержать технические детали! Если нужна проверка с техническими деталями - это Integration тест!`);
                    }
                }

                // ✅ НОВАЯ ПРОВЕРКА 1.7: E2E тесты не должны содержать параметризацию с множеством технических вариантов (коды операций, статусы, параметры API)
                if (layer === 'E2E Tests') {
                    const hasTechnicalParametrization = tc.parameters && Array.isArray(tc.parameters) && tc.parameters.some(p => {
                        const paramName = String(p.name || '').toLowerCase();
                        const paramValues = Array.isArray(p.values) ? p.values : [];
                        // Проверяем, не являются ли параметры техническими (коды операций, статусы, параметры API)
                        return paramName.includes('код операц') || paramName.includes('статус') || paramName.includes('http') ||
                            paramName.includes('deal.') || paramName.includes('параметр запрос') ||
                            (paramValues.length > 0 && paramValues.some(v => /^\d{5}$|^\d{3}$|^(true|false)$|deal\.|previousBankRegNumber/gi.test(String(v))));
                    });
                    if (hasTechnicalParametrization) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": E2E тест содержит параметризацию с техническими вариантами (коды операций, статусы, параметры API) - параметризация технических проверок должна быть в Integration тестах! E2E тесты покрывают полный путь пользователя, а не множественные технические варианты!`);
                    }
                }

                // ✅ НОВАЯ ПРОВЕРКА 2: Ожидаемый результат не должен начинаться с глагола действия (инфинитив)
                if (expected && expected.trim().length > 0) {
                    const expectedLower = expected.toLowerCase().trim();
                    // Проверяем, начинается ли с глаголов действия в инфинитиве
                    const actionVerbs = [
                        /^создать\s+/i, /^добавить\s+/i, /^удалить\s+/i, /^изменить\s+/i, /^обновить\s+/i,
                        /^отправить\s+/i, /^получить\s+/i, /^проверить\s+/i, /^выполнить\s+/i, /^заполнить\s+/i,
                        /^отобразить\s+/i, /^вернуть\s+/i, /^подменить\s+/i, /^передать\s+/i, /^сохранить\s+/i,
                        /^показать\s+/i, /^вывести\s+/i, /^открыть\s+/i, /^закрыть\s+/i, /^подписать\s+/i
                    ];

                    const startsWithActionVerb = actionVerbs.some(pattern => pattern.test(expectedLower));
                    if (startsWithActionVerb) {
                        // Предлагаем исправление: заменяем инфинитив на причастие прошедшего времени
                        let suggestedFix = expected;
                        if (/^создать\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^создать\s+/i, 'Создан ');
                        } else if (/^добавить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^добавить\s+/i, 'Добавлен ');
                        } else if (/^удалить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^удалить\s+/i, 'Удален ');
                        } else if (/^изменить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^изменить\s+/i, 'Изменен ');
                        } else if (/^обновить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^обновить\s+/i, 'Обновлен ');
                        } else if (/^отправить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^отправить\s+/i, 'Отправлен ');
                        } else if (/^получить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^получить\s+/i, 'Получен ');
                        } else if (/^выполнить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^выполнить\s+/i, 'Выполнено ');
                        } else if (/^заполнить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^заполнить\s+/i, 'Заполнено ');
                        } else if (/^отобразить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^отобразить\s+/i, 'Отображается ');
                        } else if (/^вернуть\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^вернуть\s+/i, 'Возвращается ');
                        } else if (/^подменить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^подменить\s+/i, 'Подменено ');
                        } else if (/^передать\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^передать\s+/i, 'Передано ');
                        } else if (/^сохранить\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^сохранить\s+/i, 'Сохранено ');
                        } else if (/^показать\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^показать\s+/i, 'Отображается ');
                        } else if (/^вывести\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^вывести\s+/i, 'Выведено ');
                        } else if (/^открыть\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^открыть\s+/i, 'Открыт ');
                        } else if (/^закрыть\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^закрыть\s+/i, 'Закрыт ');
                        } else if (/^подписать\s+/i.test(expectedLower)) {
                            suggestedFix = expected.replace(/^подписать\s+/i, 'Подписан ');
                        }

                        issues.push(`Тест-кейс ${tcNum} "${title}": ожидаемый результат начинается с глагола действия "${expected.substring(0, 20)}..." - должен быть результат уже выполненного действия (например, "${suggestedFix.substring(0, 30)}..." вместо "${expected.substring(0, 30)}...")`);
                    }
                }

                // ✅ НОВАЯ ПРОВЕРКА 3: Конфликт precondition и шагов (авторизация)
                if (precondition && precondition.trim().length > 0) {
                    const preconditionLower = precondition.toLowerCase();
                    // Проверяем, есть ли в precondition упоминание об авторизации
                    const isAuthorizedInPrecondition = /(пользователь\s+)?(авторизован|вошел|авторизовался|залогинен)/i.test(preconditionLower);

                    if (isAuthorizedInPrecondition && steps.length > 0) {
                        // Проверяем, есть ли в шагах шаг авторизации
                        const hasAuthStep = steps.some(step => {
                            const stepText = getStepText(step).toLowerCase();
                            return /авторизоваться|войти\s+в\s+систему|войти|залогиниться/i.test(stepText);
                        });

                        if (hasAuthStep) {
                            issues.push(`Тест-кейс ${tcNum} "${title}": конфликт precondition и шагов - в precondition указано "${precondition.substring(0, 50)}...", но в шагах есть "Авторизоваться в системе". Для E2E тестов нужно либо убрать precondition, либо убрать шаг авторизации (или использовать общий шаг авторизации, если он есть в списке shared steps)`);
                        }
                    }
                }

                // Проверка шагов
                steps.forEach((step, stepIdx) => {
                    const stepText = getStepText(step);
                    const stepLower = stepText.toLowerCase();

                    // Проверка на слово "Проверить" в шагах
                    if (stepLower.includes('проверить') || stepLower.includes('проверка')) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": шаг ${stepIdx + 1} содержит "Проверить" - проверка должна быть в expected, а не в steps!`);
                    }

                    // Проверка форматирования ключевых слов и эндпоинтов
                    if (stepText.includes('/') && !stepText.includes('**')) {
                        // Эндпоинт без выделения
                        const endpointMatch = stepText.match(/(\/[a-zA-Z0-9_\/-]+)/);
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
                    const uiActions = steps.some(step => {
                        const stepText = getStepText(step);
                        return /нажать|кликнуть|выбрать|заполнить|ввести/i.test(stepText) && !stepText.includes('Выполнить');
                    });
                    if (uiActions) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": Integration backend Tests содержит UI-действия - только "Выполнить POST/GET..."!`);
                    }
                }

                if (layer === 'Integration frontend Tests') {
                    // Frontend тесты не должны начинаться с авторизации
                    if (steps.length > 0) {
                        const firstStepText = getStepText(steps[0]);
                        if (/авторизоваться|перейти в раздел|открыть приложение/i.test(firstStepText)) {
                            issues.push(`Тест-кейс ${tcNum} "${title}": Integration frontend Tests начинается с авторизации - начинай сразу с действия на компоненте!`);
                        }
                    }

                    // Frontend тесты не должны содержать "Выполнить POST/GET"
                    if (steps.some(step => {
                        const stepText = getStepText(step);
                        return /выполнить\s+(post|get|put|delete|patch)/i.test(stepText);
                    })) {
                        issues.push(`Тест-кейс ${tcNum} "${title}": Integration frontend Tests содержит Backend-запросы - только UI-действия!`);
                    }
                }

                // Проверка параметризации
                if (tc.parameters && Array.isArray(tc.parameters) && tc.parameters.length > 0) {
                    // Проверяем использование параметров в steps и expected
                    const hasParamsInSteps = steps.some(step => {
                        const stepText = getStepText(step);
                        return stepText.includes('{{');
                    });
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



        // ✅ НОВАЯ ФУНКЦИЯ: Проверка дублей тест-кейсов
        function detectDuplicates(testCases) {
            console.log(`[detectDuplicates] Проверка дублей среди ${testCases.length} тест-кейсов...`);
            const duplicates = [];
            const processed = new Set();

            const normalize = (text) => String(text || '').toLowerCase().trim().replace(/\s+/g, ' ');

            for (let i = 0; i < testCases.length; i++) {
                if (processed.has(i)) continue;

                const tc1 = testCases[i];
                const group = [i];

                // Сравниваем с остальными тест-кейсами
                for (let j = i + 1; j < testCases.length; j++) {
                    if (processed.has(j)) continue;

                    const tc2 = testCases[j];

                    // Проверяем структурное сходство
                    if (tc1.layer !== tc2.layer) continue;
                    if (tc1.feature !== tc2.feature) continue;
                    if (tc1.story !== tc2.story) continue;
                    if (tc1.scenario !== tc2.scenario) continue;

                    // Нормализуем и сравниваем ключевые части
                    const title1 = normalize(tc1.title);
                    const title2 = normalize(tc2.title);

                    // Проверяем шаги (структурно)
                    const steps1 = JSON.stringify(tc1.steps || []).toLowerCase();
                    const steps2 = JSON.stringify(tc2.steps || []).toLowerCase();

                    // Проверяем expected
                    const expected1 = normalize(tc1.expected);
                    const expected2 = normalize(tc2.expected);

                    // Если titles очень похожи И steps похожи И expected похожи - это дубликат
                    const titleSimilarity = calculateSimilarity(title1, title2);
                    const stepsSimilarity = calculateSimilarity(steps1, steps2);
                    const expectedSimilarity = calculateSimilarity(expected1, expected2);

                    if (titleSimilarity > 0.85 && stepsSimilarity > 0.8 && expectedSimilarity > 0.8) {
                        group.push(j);
                        processed.add(j);
                    }
                }

                if (group.length > 1) {
                    duplicates.push({
                        indices: group,
                        testCases: group.map(idx => ({
                            index: idx,
                            title: testCases[idx].title,
                            layer: testCases[idx].layer,
                            feature: testCases[idx].feature,
                            story: testCases[idx].story
                        }))
                    });
                    group.forEach(idx => processed.add(idx));
                }
            }

            console.log(`[detectDuplicates] Найдено ${duplicates.length} групп дублей (${duplicates.reduce((sum, d) => sum + d.indices.length, 0)} тест-кейсов)`);
            return duplicates;
        }

        // Вспомогательная функция для расчета схожести строк
        function calculateSimilarity(str1, str2) {
            const longer = str1.length > str2.length ? str1 : str2;
            const shorter = str1.length > str2.length ? str2 : str1;
            if (longer.length === 0) return 1.0;

            const distance = levenshteinDistance(str1, str2);
            return (longer.length - distance) / longer.length;
        }

        function levenshteinDistance(str1, str2) {
            const matrix = [];
            for (let i = 0; i <= str2.length; i++) {
                matrix[i] = [i];
            }
            for (let j = 0; j <= str1.length; j++) {
                matrix[0][j] = j;
            }
            for (let i = 1; i <= str2.length; i++) {
                for (let j = 1; j <= str1.length; j++) {
                    if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        matrix[i][j] = Math.min(
                            matrix[i - 1][j - 1] + 1,
                            matrix[i][j - 1] + 1,
                            matrix[i - 1][j] + 1
                        );
                    }
                }
            }
            return matrix[str2.length][str1.length];
        }

        // ✅ НОВАЯ ФУНКЦИЯ: Проверка pairwise в параметрах и примерах
        function validatePairwise(testCase) {
            if (!testCase.parameters || !Array.isArray(testCase.parameters) || testCase.parameters.length === 0) {
                return { valid: true, issues: [] };
            }

            const issues = [];
            const params = testCase.parameters;

            // Проверка 1: Наличие examples
            if (!testCase.examples || !Array.isArray(testCase.examples) || testCase.examples.length === 0) {
                issues.push(`Тест-кейс "${testCase.title}": есть parameters, но отсутствуют examples!`);
                return { valid: false, issues };
            }

            const examples = testCase.examples;

            // Проверка 2: Каждый пример содержит все параметры
            const paramNames = new Set(params.map(p => p.name));
            for (let i = 0; i < examples.length; i++) {
                const example = examples[i];
                if (!example.parameters || !Array.isArray(example.parameters)) {
                    issues.push(`Тест-кейс "${testCase.title}": пример ${i + 1} не содержит массив parameters!`);
                    continue;
                }

                const exampleParamNames = new Set(example.parameters.map(p => p.name || p.parameter));

                // Проверяем, что все параметры присутствуют в примере
                for (const paramName of paramNames) {
                    if (!exampleParamNames.has(paramName)) {
                        issues.push(`Тест-кейс "${testCase.title}": пример ${i + 1} не содержит параметр "${paramName}"!`);
                    }
                }
            }

            // Проверка 3: Pairwise покрытие (если параметров 2+)
            let coveredPairsCount = undefined;
            if (params.length >= 2 && examples.length > 0) {
                const paramValues = {};
                params.forEach(p => {
                    paramValues[p.name] = new Set(p.values || []);
                });

                // Проверяем pairwise покрытие
                const pairs = [];
                for (let i = 0; i < params.length; i++) {
                    for (let j = i + 1; j < params.length; j++) {
                        pairs.push([params[i].name, params[j].name]);
                    }
                }

                const coveredPairs = new Set();
                examples.forEach(example => {
                    if (!example.parameters) return;
                    const exampleParams = {};
                    example.parameters.forEach(p => {
                        const name = p.name || p.parameter;
                        const value = p.value;
                        exampleParams[name] = value;
                    });

                    pairs.forEach(([param1, param2]) => {
                        if (exampleParams[param1] !== undefined && exampleParams[param2] !== undefined) {
                            coveredPairs.add(`${param1}=${exampleParams[param1]}|${param2}=${exampleParams[param2]}`);
                        }
                    });
                });

                coveredPairsCount = coveredPairs.size;

                // Ожидаемое минимальное количество примеров для pairwise
                const param1Values = params[0].values || [];
                const param2Values = params.length > 1 ? (params[1].values || []) : [];
                const expectedMinPairs = param1Values.length * param2Values.length;

                // Для 3+ параметров проверяем, что есть хотя бы некоторые комбинации
                if (params.length === 2) {
                    if (coveredPairs.size < Math.min(expectedMinPairs, examples.length * 2)) {
                        issues.push(`Тест-кейс "${testCase.title}": недостаточное pairwise покрытие (${coveredPairs.size} комбинаций вместо ожидаемых ${expectedMinPairs})!`);
                    }
                } else {
                    // Для 3+ параметров проверяем, что есть хотя бы минимальное покрытие
                    const minExpectedPairs = Math.min(pairs.length, examples.length * Math.ceil(pairs.length / params.length));
                    if (coveredPairs.size < minExpectedPairs) {
                        issues.push(`Тест-кейс "${testCase.title}": возможно недостаточное pairwise покрытие для ${params.length} параметров!`);
                    }
                }
            }

            return {
                valid: issues.length === 0,
                issues,
                coveredPairs: coveredPairsCount
            };
        }

        // ✅ НОВАЯ ФУНКЦИЯ: Проверка правильности использования shared steps
        function validateSharedSteps(testCases, sharedStepsMap) {
            console.log(`[validateSharedSteps] Проверка использования shared steps в ${testCases.length} тест-кейсах...`);
            const issues = [];

            if (!sharedStepsMap || sharedStepsMap.size === 0) {
                return { valid: true, issues: [] };
            }

            const getStepText = (step) => {
                if (typeof step === 'string') return step;
                if (typeof step === 'object' && step !== null) {
                    return step.text || step.body || String(step);
                }
                return String(step || '');
            };

            testCases.forEach((tc, tcIdx) => {
                const tcNum = tcIdx + 1;
                const steps = Array.isArray(tc.steps) ? tc.steps : [];

                steps.forEach((step, stepIdx) => {
                    // Если шаг использует sharedStepId
                    if (typeof step === 'object' && step.sharedStepId) {
                        // Проверяем, что shared step существует
                        let found = false;
                        for (const [name, info] of sharedStepsMap.entries()) {
                            if (info.id === step.sharedStepId) {
                                found = true;
                                break;
                            }
                        }

                        if (!found) {
                            issues.push(`Тест-кейс ${tcNum} "${tc.title}": шаг ${stepIdx + 1} использует несуществующий sharedStepId=${step.sharedStepId}!`);
                        }
                    } else {
                        // Если шаг - обычный текст, проверяем, можно ли использовать shared step
                        const stepText = getStepText(step);
                        const normalizedStepText = stepText.toLowerCase().trim();

                        // Ищем похожий shared step
                        for (const [name, info] of sharedStepsMap.entries()) {
                            const normalizedName = name.toLowerCase().trim();

                            // Если название shared step совпадает с текстом шага
                            if (normalizedStepText === normalizedName || normalizedStepText.includes(normalizedName)) {
                                // Проверяем, есть ли похожий шаг в shared step
                                const hasSimilarStep = info.steps.some(ssStep => {
                                    const normalizedSSStep = ssStep.toLowerCase().trim();
                                    const similarity = calculateSimilarity(normalizedStepText, normalizedSSStep);
                                    return similarity > 0.7;
                                });

                                if (hasSimilarStep) {
                                    issues.push(`Тест-кейс ${tcNum} "${tc.title}": шаг ${stepIdx + 1} можно заменить на shared step "${info.name}" (ID: ${info.id})!`);
                                }
                            }
                        }
                    }
                });
            });

            console.log(`[validateSharedSteps] Найдено ${issues.length} проблем с shared steps`);
            return {
                valid: issues.length === 0,
                issues
            };
        }

        // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ: Проверка покрытия требований через модель (БЕЗ регулярных выражений!)
        // Покрытие определяется через тестовую модель (Feature/Story/Scenario), а не через парсинг текста
        function checkRequirementsCoverageFixed(testCases, requirements, modelStructure) {
            console.log(`[checkRequirementsCoverageFixed] Проверка покрытия требований через модель (БЕЗ регулярных выражений)...`);

            if (!modelStructure || !Array.isArray(modelStructure) || modelStructure.length === 0) {
                console.warn(`[checkRequirementsCoverageFixed] Модель не предоставлена или пустая`);
                return {
                    coveragePercentage: 100,
                    covered: 0,
                    total: 0,
                    missingRequirementIds: [],
                    coveredRequirementIds: [],
                    missingStories: []
                };
            }

            // ✅ ПОКРЫТИЕ ОПРЕДЕЛЯЕТСЯ ТОЛЬКО ЧЕРЕЗ МОДЕЛЬ, БЕЗ ПАРСИНГА ТЕКСТА ТРЕБОВАНИЙ РЕГУЛЯРКАМИ!
            // Каждый проект может иметь свой формат требований, поэтому не используем регулярки
            // Вместо этого проверяем покрытие через структуру модели (Feature/Story/Scenario)

            // Собираем все Stories из модели (это и есть требования, которые нужно покрыть)
            const allStories = [];
            for (const feature of modelStructure) {
                for (const story of (feature.stories || [])) {
                    allStories.push({
                        feature: feature.text,
                        story: story.text,
                        storyId: story.id,
                        requirement: story.requirement // Если есть явное поле requirement
                    });
                }
            }

            if (allStories.length === 0) {
                console.warn(`[checkRequirementsCoverageFixed] В модели нет Stories`);
                return {
                    coveragePercentage: 100,
                    covered: 0,
                    total: 0,
                    missingRequirementIds: [],
                    coveredRequirementIds: [],
                    missingStories: []
                };
            }

            // Определяем покрытые Stories через тест-кейсы
            const coveredStories = new Set();
            const storyToTestCases = new Map(); // story -> количество тест-кейсов

            testCases.forEach(tc => {
                if (tc.feature && tc.story) {
                    const storyKey = `${tc.feature}|||${tc.story}`;
                    coveredStories.add(storyKey);

                    // Подсчитываем количество тест-кейсов для каждой Story
                    if (!storyToTestCases.has(storyKey)) {
                        storyToTestCases.set(storyKey, 0);
                    }
                    storyToTestCases.set(storyKey, storyToTestCases.get(storyKey) + 1);
                }
            });

            // Находим непокрытые Stories
            const missingStories = allStories.filter(s => {
                const storyKey = `${s.feature}|||${s.story}`;
                return !coveredStories.has(storyKey);
            });

            // Также собираем requirementId из Stories (если они есть)
            const coveredRequirementIds = new Set();
            const allRequirementIds = new Set();

            allStories.forEach(s => {
                if (s.requirement) {
                    allRequirementIds.add(s.requirement);
                    if (coveredStories.has(`${s.feature}|||${s.story}`)) {
                        coveredRequirementIds.add(s.requirement);
                    }
                }
            });

            const missingRequirementIds = [];
            for (const reqId of allRequirementIds) {
                if (!coveredRequirementIds.has(reqId)) {
                    missingRequirementIds.push(reqId);
                }
            }

            const total = allStories.length;
            const covered = total - missingStories.length;
            const coveragePercentage = total > 0 ? Math.round((covered / total) * 100) : 100;

            console.log(`[checkRequirementsCoverageFixed] Покрытие Stories: ${covered}/${total} (${coveragePercentage}%)`);
            console.log(`[checkRequirementsCoverageFixed] Покрытые Stories: ${Array.from(coveredStories).map(k => k.split('|||')[1]).join(', ')}`);
            console.log(`[checkRequirementsCoverageFixed] Недостающие Stories: ${missingStories.map(s => s.story).join(', ')}`);

            if (allRequirementIds.size > 0) {
                console.log(`[checkRequirementsCoverageFixed] Покрытие requirementId: ${coveredRequirementIds.size}/${allRequirementIds.size}`);
                console.log(`[checkRequirementsCoverageFixed] Покрытые requirementId: ${Array.from(coveredRequirementIds).sort().join(', ')}`);
                console.log(`[checkRequirementsCoverageFixed] Недостающие requirementId: ${missingRequirementIds.join(', ')}`);
            }

            return {
                coveragePercentage,
                covered,
                total,
                missingRequirementIds,
                coveredRequirementIds: Array.from(coveredRequirementIds),
                missingStories: missingStories
            };
        }

        // ✅ УДАЛЕНО: escapeRegex - больше не используется для парсинга требований
        // Покрытие теперь определяется через модель, без регулярных выражений

        // ✅ НОВАЯ ФУНКЦИЯ: Комплексная динамическая валидация качества
        async function validateQualityDynamically(testCases, modelStructure, requirements, sharedStepsMap, systemPrompt, baseCaseModelOptions) {
            console.log(`[validateQualityDynamically] Запуск комплексной валидации качества ${testCases.length} тест-кейсов...`);

            const allIssues = [];
            const regenerationNeeded = [];

            // ✅ НОВАЯ ПРОВЕРКА 0: Семантические ошибки (заголовки, expected, precondition)
            console.log(`[validateQualityDynamically] Проверка 0: Семантические ошибки (заголовки, expected, precondition)...`);
            const styleGuideIssues = validateTestCasesByStyleGuide(testCases, systemPrompt);
            if (styleGuideIssues.length > 0) {
                // Фильтруем только критичные ошибки для перегенерации
                const criticalStyleIssues = styleGuideIssues.filter(issue => {
                    return issue.includes('"Полный цикл"') ||
                        issue.includes('слово "E2E"') ||
                        issue.includes('глагола действия') ||
                        issue.includes('конфликт precondition') ||
                        issue.includes('плейсхолдер {{Параметр}}') ||
                        issue.includes('детали HTTP-запросов') ||
                        issue.includes('параметризацию с техническими вариантами');
                });

                if (criticalStyleIssues.length > 0) {
                    console.log(`[validateQualityDynamically] ⚠️ Найдено ${criticalStyleIssues.length} критичных семантических ошибок:`);
                    criticalStyleIssues.forEach(issue => console.log(`  - ${issue}`));

                    criticalStyleIssues.forEach((issue, idx) => {
                        // Определяем тип ошибки по содержимому
                        let issueType = 'semantic_error';
                        if (issue.includes('"Полный цикл"') || issue.includes('слово "E2E"')) {
                            issueType = 'e2e_title_format';
                        } else if (issue.includes('плейсхолдер {{Параметр}}')) {
                            issueType = 'title_placeholder';
                        } else if (issue.includes('детали HTTP-запросов') || issue.includes('параметризацию с техническими вариантами')) {
                            issueType = 'e2e_technical_details';
                        } else if (issue.includes('глагола действия')) {
                            issueType = 'expected_verb_form';
                        } else if (issue.includes('конфликт precondition')) {
                            issueType = 'precondition_conflict';
                        }

                        // Определяем индекс тест-кейса из сообщения об ошибке
                        const match = issue.match(/Тест-кейс\s+(\d+)\s+/);
                        const testCaseIndex = match ? parseInt(match[1]) - 1 : -1;

                        allIssues.push({
                            type: issueType,
                            severity: 'high',
                            message: issue,
                            testCaseIndex: testCaseIndex,
                            testCase: testCaseIndex >= 0 && testCaseIndex < testCases.length ? testCases[testCaseIndex] : null
                        });
                    });

                    // Добавляем задачу на перегенерацию
                    regenerationNeeded.push({
                        type: 'fix_semantic_errors',
                        issues: criticalStyleIssues
                    });
                }
            }

            // Проверка 1: Дубли
            console.log(`[validateQualityDynamically] Проверка 1: Дубли...`);
            const duplicates = detectDuplicates(testCases);
            if (duplicates.length > 0) {
                duplicates.forEach(dup => {
                    allIssues.push({
                        type: 'duplicate',
                        severity: 'high',
                        message: `Найдены дубликаты тест-кейсов: ${dup.testCases.map(tc => `"${tc.title}"`).join(', ')}`,
                        indices: dup.indices,
                        testCases: dup.testCases
                    });
                    regenerationNeeded.push({
                        type: 'remove_duplicates',
                        duplicateGroup: dup
                    });
                });
            }

            // Проверка 2: Pairwise в параметрах
            console.log(`[validateQualityDynamically] Проверка 2: Pairwise в параметрах...`);
            testCases.forEach((tc, idx) => {
                if (tc.parameters && tc.parameters.length > 0) {
                    const pairwiseValidation = validatePairwise(tc);
                    if (!pairwiseValidation.valid) {
                        allIssues.push({
                            type: 'pairwise',
                            severity: 'medium',
                            message: `Проблемы с pairwise в тест-кейсе "${tc.title}": ${pairwiseValidation.issues.join('; ')}`,
                            testCaseIndex: idx,
                            testCase: tc,
                            issues: pairwiseValidation.issues
                        });
                        regenerationNeeded.push({
                            type: 'fix_pairwise',
                            testCaseIndex: idx,
                            testCase: tc
                        });
                    }
                }
            });

            // Проверка 3: Shared steps
            console.log(`[validateQualityDynamically] Проверка 3: Shared steps...`);
            const sharedStepsValidation = validateSharedSteps(testCases, sharedStepsMap);
            if (!sharedStepsValidation.valid) {
                sharedStepsValidation.issues.forEach(issue => {
                    allIssues.push({
                        type: 'shared_steps',
                        severity: 'medium',
                        message: issue,
                        testCaseIndex: -1
                    });
                });
                // Для shared steps не делаем перегенерацию, только предупреждения
            }

            // Проверка 4: Покрытие (исправленная версия)
            console.log(`[validateQualityDynamically] Проверка 4: Покрытие требований...`);
            const reqText = Array.isArray(requirements) ? requirements.join('\n\n') : (requirements || '');
            const coverage = checkRequirementsCoverageFixed(testCases, reqText, modelStructure);

            if (coverage.coveragePercentage < 80) {
                allIssues.push({
                    type: 'coverage',
                    severity: 'high',
                    message: `Недостаточное покрытие требований: ${coverage.coveragePercentage}% (минимум 80%)`,
                    coveragePercentage: coverage.coveragePercentage,
                    missingRequirementIds: coverage.missingRequirementIds,
                    missingStories: coverage.missingStories || []
                });
                regenerationNeeded.push({
                    type: 'improve_coverage',
                    missingRequirementIds: coverage.missingRequirementIds,
                    missingStories: coverage.missingStories || []
                });
            }

            // Проверка 5: Покрытие модели (Scenarios)
            console.log(`[validateQualityDynamically] Проверка 5: Покрытие модели...`);
            const modelCoverage = calculateTestCasesCoverage(testCases, modelStructure);

            if (modelCoverage.coveragePercent < 90) {
                allIssues.push({
                    type: 'model_coverage',
                    severity: 'high',
                    message: `Недостаточное покрытие модели: ${modelCoverage.coveragePercent}% (минимум 90%)`,
                    coveragePercent: modelCoverage.coveragePercent,
                    missing: modelCoverage.missing
                });
                regenerationNeeded.push({
                    type: 'improve_model_coverage',
                    missingScenarios: modelCoverage.missing
                });
            }

            const result = {
                valid: allIssues.filter(i => i.severity === 'high').length === 0,
                issues: allIssues,
                regenerationNeeded: regenerationNeeded.length > 0,
                regenerationTasks: regenerationNeeded,
                summary: {
                    semanticErrors: allIssues.filter(i => i.type === 'e2e_title_format' || i.type === 'title_placeholder' || i.type === 'e2e_technical_details' || i.type === 'expected_verb_form' || i.type === 'precondition_conflict').length,
                    duplicates: duplicates.length,
                    pairwiseIssues: allIssues.filter(i => i.type === 'pairwise').length,
                    sharedStepsIssues: allIssues.filter(i => i.type === 'shared_steps').length,
                    coverage: coverage.coveragePercentage,
                    modelCoverage: modelCoverage.coveragePercent
                }
            };

            console.log(`[validateQualityDynamically] Валидация завершена:`);
            console.log(`  - Валидность: ${result.valid ? '✅' : '❌'}`);
            console.log(`  - Всего проблем: ${allIssues.length}`);
            console.log(`  - Требуется перегенерация: ${result.regenerationNeeded ? '✅' : '❌'}`);
            console.log(`  - Сводка:`, result.summary);

            return result;
        }

        // ✅ НОВАЯ ФУНКЦИЯ: Перегенерация тест-кейсов с исправлениями
        async function regenerateTestCasesWithFixes(testCases, validationResult, modelStructure, requirements, systemPrompt, baseCaseModelOptions, allowedCodes, allowedScenarios, buildSubmitCasesToolStrict, runTestCaseLLM, skipAllureAPICalls = false) {
            if (!validationResult.regenerationNeeded || validationResult.regenerationTasks.length === 0) {
                return testCases;
            }

            console.log(`[regenerateTestCasesWithFixes] Запуск перегенерации для исправления ${validationResult.regenerationTasks.length} проблем...`);

            let fixedCases = [...testCases];

            for (const task of validationResult.regenerationTasks) {
                try {
                    if (task.type === 'remove_duplicates') {
                        // Удаляем дубликаты, оставляя только первый
                        const indicesToRemove = task.duplicateGroup.indices.slice(1); // Все кроме первого
                        fixedCases = fixedCases.filter((_, idx) => !indicesToRemove.includes(idx));
                        console.log(`[regenerateTestCasesWithFixes] ✅ Удалено ${indicesToRemove.length} дубликатов`);
                    } else if (task.type === 'fix_pairwise') {
                        // Исправляем pairwise для конкретного тест-кейса
                        // ⚠️ ВАЖНО: Пропускаем в debug режиме, т.к. это вызов Allure API
                        if (skipAllureAPICalls) {
                            console.log(`[regenerateTestCasesWithFixes] ⚠️ Пропускаю pairwise generation (debug режим)`);
                        } else {
                            const tc = task.testCase;
                            if (tc.parameters && tc.parameters.length > 0) {
                                try {
                                    const pairwiseExamples = await generatePairwiseExamples(2, tc.parameters); // ✅ 2 = pairwise
                                    if (pairwiseExamples && pairwiseExamples.length > 0) {
                                        const index = fixedCases.findIndex(c => c.title === tc.title);
                                        if (index !== -1) {
                                            fixedCases[index].examples = pairwiseExamples;
                                            console.log(`[regenerateTestCasesWithFixes] ✅ Исправлен pairwise для "${tc.title}" (${pairwiseExamples.length} примеров)`);
                                        }
                                    }
                                } catch (err) {
                                    console.error(`[regenerateTestCasesWithFixes] Ошибка генерации pairwise для "${tc.title}":`, err.message);
                                }
                            }
                        }
                    } else if (task.type === 'fix_semantic_errors') {
                        // ✅ НОВАЯ ОБРАБОТКА: Исправление семантических ошибок (заголовки, expected, precondition)
                        console.log(`[regenerateTestCasesWithFixes] Исправление семантических ошибок: ${task.issues.length} проблем...`);

                        // Находим проблемные тест-кейсы по сообщениям об ошибках
                        const problematicCases = [];
                        task.issues.forEach(issue => {
                            // Извлекаем номер тест-кейса из сообщения об ошибке
                            const match = issue.match(/Тест-кейс\s+(\d+)\s+/);
                            if (match) {
                                const tcIndex = parseInt(match[1]) - 1; // Индексация с 0
                                if (tcIndex >= 0 && tcIndex < testCases.length) {
                                    problematicCases.push({
                                        index: tcIndex,
                                        testCase: testCases[tcIndex],
                                        issue: issue
                                    });
                                }
                            }
                        });

                        // Группируем по типам ошибок
                        const e2eTitleIssues = problematicCases.filter(pc => pc.issue.includes('"Полный цикл"') || pc.issue.includes('слово "E2E"'));
                        const e2eTechnicalIssues = problematicCases.filter(pc => pc.issue.includes('детали HTTP-запросов') || pc.issue.includes('параметризацию с техническими вариантами'));
                        const titlePlaceholderIssues = problematicCases.filter(pc => pc.issue.includes('плейсхолдер {{Параметр}}'));
                        const expectedVerbIssues = problematicCases.filter(pc => pc.issue.includes('глагола действия'));
                        const preconditionConflictIssues = problematicCases.filter(pc => pc.issue.includes('конфликт precondition'));

                        // Формируем промпт для исправления
                        let fixPrompt = `🚨 КРИТИЧЕСКИЕ СЕМАНТИЧЕСКИЕ ОШИБКИ В ТЕСТ-КЕЙСАХ! 🚨\n\n`;

                        if (e2eTitleIssues.length > 0) {
                            fixPrompt += `\n❌ ПРОБЛЕМА 1: Заголовки E2E тестов содержат "Полный цикл"\n`;
                            fixPrompt += `ПРАВИЛО: Заголовки E2E тестов должны быть информативными названиями сценария БЕЗ фразы "Полный цикл".\n`;
                            fixPrompt += `✅ ПРАВИЛЬНО: "Создание документа с выбором типа операции"\n`;
                            fixPrompt += `❌ НЕПРАВИЛЬНО: "Полный цикл создания документа"\n\n`;
                            e2eTitleIssues.forEach(pc => {
                                fixPrompt += `- Тест-кейс "${pc.testCase.title}": нужно убрать "Полный цикл" из заголовка\n`;
                            });
                        }

                        if (e2eTechnicalIssues.length > 0) {
                            fixPrompt += `\n❌ ПРОБЛЕМА 1.6: E2E тесты содержат технические детали (HTTP-запросы, API-эндпоинты, статус-коды, параметризация технических вариантов)\n`;
                            fixPrompt += `ПРАВИЛО: E2E тесты — это Black Box тестирование на уровне пользовательского контекста (C1)! Они НЕ должны содержать технические детали!\n`;
                            fixPrompt += `✅ ПРАВИЛЬНО для E2E: Только пользовательские действия ("Нажать", "Ввести", "Выбрать"), проверка результата с точки зрения пользователя\n`;
                            fixPrompt += `❌ НЕПРАВИЛЬНО для E2E: Детали HTTP-запросов, API-эндпоинты, статус-коды, параметры запросов (deal.dealMode, previousBankRegNumber)\n`;
                            fixPrompt += `❌ НЕПРАВИЛЬНО для E2E: Параметризация с техническими вариантами (коды операций, статусы, параметры API) — это Integration тесты!\n`;
                            fixPrompt += `РЕШЕНИЕ: Если нужна проверка с техническими деталями или параметризация технических вариантов — это Integration тест!\n\n`;
                            e2eTechnicalIssues.forEach(pc => {
                                fixPrompt += `- Тест-кейс "${pc.testCase.title}": убрать технические детали или перенести в Integration тест\n`;
                            });
                        }

                        if (titlePlaceholderIssues.length > 0) {
                            fixPrompt += `\n❌ ПРОБЛЕМА 1.5: Заголовки содержат плейсхолдеры {{Параметр}}\n`;
                            fixPrompt += `ПРАВИЛО: Заголовки тест-кейсов НЕ должны содержать плейсхолдеры {{Параметр}}! Параметры указываются в поле parameters, а {{Параметр}} используется ТОЛЬКО в steps и expected.\n`;
                            fixPrompt += `✅ ПРАВИЛЬНО: "Создание документа с выбором типа операции"\n`;
                            fixPrompt += `✅ ПРАВИЛЬНО: "Создание документа с параметрами dealMode и previousBankRegNumber"\n`;
                            fixPrompt += `❌ НЕПРАВИЛЬНО: "Создание документа с {{Тип операции}}"\n`;
                            fixPrompt += `❌ НЕПРАВИЛЬНО: "Создание документа с параметрами {{dealMode}} и {{previousBankRegNumber}}"\n\n`;
                            titlePlaceholderIssues.forEach(pc => {
                                fixPrompt += `- Тест-кейс "${pc.testCase.title}": нужно убрать {{Параметр}} из заголовка, использовать информативное название без плейсхолдеров\n`;
                            });
                        }

                        if (expectedVerbIssues.length > 0) {
                            fixPrompt += `\n❌ ПРОБЛЕМА 2: Ожидаемый результат начинается с глагола действия (инфинитив)\n`;
                            fixPrompt += `ПРАВИЛО: Ожидаемый результат должен описывать УЖЕ ВЫПОЛНЕННОЕ действие, используя причастие прошедшего времени или результат.\n`;
                            fixPrompt += `✅ ПРАВИЛЬНО: "Создан документ", "Добавлен элемент", "Отображается поле"\n`;
                            fixPrompt += `❌ НЕПРАВИЛЬНО: "Создать документ", "Добавить элемент", "Отобразить поле"\n\n`;
                            expectedVerbIssues.forEach(pc => {
                                fixPrompt += `- Тест-кейс "${pc.testCase.title}": expected "${pc.testCase.expected?.substring(0, 50)}..." - нужно заменить инфинитив на причастие прошедшего времени\n`;
                            });
                        }

                        if (preconditionConflictIssues.length > 0) {
                            fixPrompt += `\n❌ ПРОБЛЕМА 3: Конфликт precondition и шагов (авторизация)\n`;
                            fixPrompt += `ПРАВИЛО: Если в precondition указано "Пользователь авторизован в системе", то в шагах НЕ должно быть "Авторизоваться в системе".\n`;
                            fixPrompt += `РЕШЕНИЕ для E2E тестов:\n`;
                            fixPrompt += `1. Либо убрать precondition и оставить шаг авторизации в начале\n`;
                            fixPrompt += `2. Либо убрать шаг авторизации и оставить precondition\n`;
                            fixPrompt += `3. Либо использовать общий шаг авторизации из shared steps (если доступен)\n\n`;
                            preconditionConflictIssues.forEach(pc => {
                                fixPrompt += `- Тест-кейс "${pc.testCase.title}": precondition "${pc.testCase.precondition?.substring(0, 50)}..." конфликтует с шагом авторизации\n`;
                            });
                        }

                        fixPrompt += `\n🚨 ВАЖНО: Исправь ВСЕ указанные тест-кейсы согласно правилам выше!\n`;

                        // Перегенерируем проблемные тест-кейсы
                        for (const pc of problematicCases.slice(0, 10)) { // Ограничиваем до 10 для производительности
                            try {
                                const matchingChunk = findMatchingModelChunk(pc.testCase, modelStructure);
                                if (matchingChunk) {
                                    const allowedCodes = collectAllowedCodes(matchingChunk);
                                    const allowedScenarios = collectAllowedScenarios(matchingChunk);

                                    const submissionTool = buildSubmitCasesToolStrict(allowedCodes, allowedScenarios);
                                    const retryPrompt = `${systemPrompt}\n\n${fixPrompt}\n\nПРОБЛЕМНЫЙ ТЕСТ-КЕЙС ДЛЯ ИСПРАВЛЕНИЯ:\n${JSON.stringify(pc.testCase, null, 2)}`;

                                    const retryAi = await runTestCaseLLM({
                                        userPrompt: retryPrompt,
                                        submissionTool,
                                        modelOverrides: {
                                            temperature: 0,
                                            top_p: 1,
                                            max_tokens: 45000,  // ✅ Безопасное значение для MiniMax-M2
                                            extra: { transforms: 'middle-out' }
                                        }
                                    });

                                    const retryArgs = extractToolArgs(retryAi, 'submit_cases');
                                    if (retryArgs && retryArgs.cases && retryArgs.cases.length > 0) {
                                        // Заменяем старый тест-кейс на исправленный
                                        const fixedCase = retryArgs.cases[0];
                                        fixedCases[pc.index] = fixedCase;
                                        console.log(`[regenerateTestCasesWithFixes] ✅ Исправлен семантический дефект в тест-кейсе "${pc.testCase.title}"`);
                                    } else {
                                        console.warn(`[regenerateTestCasesWithFixes] ⚠️ Не удалось исправить семантический дефект в "${pc.testCase.title}", оставляем исходный`);
                                    }
                                } else {
                                    console.warn(`[regenerateTestCasesWithFixes] ⚠️ Не найден соответствующий чанк для "${pc.testCase.title}", оставляем исходный`);
                                }
                            } catch (err) {
                                console.error(`[regenerateTestCasesWithFixes] Ошибка при исправлении семантического дефекта в "${pc.testCase.title}":`, err.message);
                            }
                        }

                    } else if (task.type === 'improve_coverage' || task.type === 'improve_model_coverage') {
                        // Генерируем дополнительные тест-кейсы для недостающего покрытия
                        console.log(`[regenerateTestCasesWithFixes] Генерация дополнительных тест-кейсов для улучшения покрытия...`);

                        const missingScenarios = task.missingScenarios || [];
                        if (missingScenarios.length > 0) {
                            // Создаем промпт для генерации недостающих тест-кейсов
                            const userPrompt = `
Требуется сгенерировать дополнительные тест-кейсы для следующего недостающего покрытия:

${task.type === 'improve_model_coverage'
                                    ? `Недостающие Scenarios:\n${missingScenarios.map(sc => `- ${sc.feature} → ${sc.story} → ${sc.scenario}`).join('\n')}`
                                    : `Недостающие требования:\n${(task.missingRequirementIds || []).map(id => `- ${id}`).join('\n')}`
                                }

Требования:
${Array.isArray(requirements) ? requirements.join('\n\n') : requirements}

Модель:
${JSON.stringify(modelStructure, null, 2)}

Сгенерируй тест-кейсы для всех недостающих элементов. ОБЯЗАТЕЛЬНО:
1. Используй только существующие feature/story/scenario из модели
2. Для Integration тестов указывай scenario
3. Для E2E тестов указывай story
4. Избегай дубликатов с существующими тест-кейсами
`.trim();

                            const submissionTool = buildSubmitCasesToolStrict(allowedCodes, allowedScenarios);
                            const ai = await runTestCaseLLM({
                                systemPrompt,
                                userPrompt,
                                submissionTool,
                                modelOverrides: {
                                    temperature: 0.1,
                                    top_p: 0.95,
                                    max_tokens: 45000  // ✅ Безопасное значение для MiniMax-M2
                                }
                            });

                            // Извлекаем новые тест-кейсы из ответа
                            const extractCasesFromResponse = (ai) => {
                                const allTestCases = [];

                                if (ai.choices?.[0]?.message?.tool_calls) {
                                    for (const toolCall of ai.choices[0].message.tool_calls) {
                                        if (toolCall.function?.name === 'submit_cases') {
                                            try {
                                                const args = JSON.parse(toolCall.function.arguments || '{}');
                                                if (args.cases && Array.isArray(args.cases)) {
                                                    allTestCases.push(...args.cases);
                                                }
                                            } catch (e) {
                                                console.error(`[regenerateTestCasesWithFixes] Ошибка парсинга tool_call:`, e.message);
                                            }
                                        }
                                    }
                                }

                                if (allTestCases.length === 0) {
                                    const content = ai.choices?.[0]?.message?.content || '';
                                    if (content.trim()) {
                                        try {
                                            const rawJsonCandidate = extractJsonArray(content);
                                            if (rawJsonCandidate) {
                                                // ✅ ИСПРАВЛЕНО: Проверяем, является ли rawJsonCandidate уже валидным JSON (из JSON.stringify)
                                                // Если это валидный JSON, не применяем cleanupJsonText
                                                let jsonText = rawJsonCandidate;
                                                let parsed = null;

                                                // Пробуем сначала распарсить как есть (если это уже валидный JSON из JSON.stringify)
                                                try {
                                                    parsed = JSON5.parse(jsonText);
                                                } catch (e1) {
                                                    // Если не получилось, применяем cleanupJsonText
                                                    jsonText = cleanupJsonText(rawJsonCandidate);
                                                    try {
                                                        parsed = JSON5.parse(jsonText);
                                                    } catch (e2) {
                                                        // Если и после cleanup не получилось, логируем детали ошибки
                                                        console.error(`[regenerateTestCasesWithFixes] Ошибка парсинга JSON после cleanup: ${e2.message}`);
                                                        if (e2.index !== undefined) {
                                                            const errorPos = e2.index;
                                                            console.error(`[regenerateTestCasesWithFixes] Позиция ошибки: символ '${jsonText[errorPos] || '?'}' на позиции ${errorPos}`);
                                                            console.error(`[regenerateTestCasesWithFixes] Контекст ошибки: ${jsonText.substring(Math.max(0, errorPos - 50), Math.min(jsonText.length, errorPos + 50))}`);
                                                        }
                                                        throw e2;
                                                    }
                                                }

                                                const cases = Array.isArray(parsed) ? parsed : (parsed?.cases || []);
                                                allTestCases.push(...cases);
                                            }
                                        } catch (e) {
                                            console.error(`[regenerateTestCasesWithFixes] Ошибка парсинга content:`, e.message);
                                        }
                                    }
                                }

                                return allTestCases;
                            };

                            const newCases = extractCasesFromResponse(ai);
                            if (newCases.length > 0) {
                                // Проверяем на дубликаты перед добавлением
                                const existingTitles = new Set(fixedCases.map(tc => tc.title?.toLowerCase().trim()));
                                const uniqueNewCases = newCases.filter(tc => !existingTitles.has(tc.title?.toLowerCase().trim()));

                                fixedCases.push(...uniqueNewCases);
                                console.log(`[regenerateTestCasesWithFixes] ✅ Добавлено ${uniqueNewCases.length} новых тест-кейсов для покрытия`);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[regenerateTestCasesWithFixes] Ошибка при обработке задачи ${task.type}:`, err.message);
                }
            }

            return fixedCases;
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

🎯 СТРОГИЙ МАППИНГ УРОВНЕЙ (КРИТИЧНО!):
- layer: "E2E Tests" → ОБЯЗАТЕЛЬНО указать feature + story (БЕЗ scenario! E2E тесты покрывают полный путь Story)
- layer: "Integration frontend/backend Tests" → ОБЯЗАТЕЛЬНО указать feature + story + scenario (дополнительно code, если требуется для API шага)
                
                🚨 КРИТИЧНО: E2E тесты НЕ должны иметь поле scenario! E2E тесты покрывают полный путь Story (Feature → Story), а НЕ отдельный Scenario.
                
                🎯 ОБЯЗАТЕЛЬНЫЕ ПОЛЯ ДЛЯ КАЖДОГО ТЕСТ-КЕЙСА:
                1. title - название (строка)
                2. steps - массив шагов (МИНИМУМ 1 шаг!)
                3. expected - ожидаемый результат (строка)
                4. layer - слой тестирования (E2E/Integration)
                5. requirement - номер требования "${missingReq.requirementId}" (ОБЯЗАТЕЛЬНО!)
                6. feature - название фичи из модели
                7. story - название story из модели
                8. scenario - название scenario (ОБЯЗАТЕЛЬНО для Integration, ЗАПРЕЩЕНО для E2E!)
                10. priority - приоритет (High/Medium/Low)
                11. tags - массив тегов
                
                ПРИМЕРЫ ПРАВИЛЬНОЙ СТРУКТУРЫ:
                
                E2E тест (БЕЗ scenario!):
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
                        max_tokens: 45000,  // ✅ Безопасное значение для MiniMax-M2 (лимит 196K токенов)
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
                // НЕ применяем к Unit frontend Tests - они остаются как есть
                if (correctedLayer.includes('frontend') && !correctedLayer.includes('__fixed') && !correctedLayer.includes('Unit')) {
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
                // НЕ применяем к Unit frontend Tests - они остаются как есть
                if (correctedLayer.includes('backend') && !correctedLayer.includes('__fixed') && !correctedLayer.includes('Unit')) {
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

                    // ✅ КРИТИЧНО: E2E тесты НЕ должны иметь scenario! (согласно тестовой пирамиде)
                    // E2E тесты покрывают полный путь Story (Feature → Story), а НЕ отдельный Scenario
                    const isE2E = layer === 'E2E Tests';
                    const shouldHaveScenario = !isE2E && (layer?.includes('Integration') || layer === 'Unit frontend Tests');

                    return {
                        id: x.id || uuidv4(), // ✅ НОВОЕ: Генерируем уникальный ID, если его нет
                        title: take(x.title, 200),
                        description: take(x.description, 800),
                        precondition: take(x.precondition, 800),
                        steps,
                        expected,
                        tags,
                        layer,
                        feature: finalFeature,
                        story: finalStory,
                        // ✅ scenario назначается ТОЛЬКО для Integration и Unit тестов, НЕ для E2E!
                        scenario: shouldHaveScenario ? finalScenario : undefined,
                        // ✅ code назначается ТОЛЬКО для Unit тестов и опционально для Integration backend, НЕ для E2E!
                        code: (layer === 'Unit frontend Tests' || (layer === 'Integration backend Tests' && code)) ? extractTextFromModel(modelStructure, 'code', code) : undefined,
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

                    // ✅ ИСПРАВЛЕНО: Менее агрессивная дедупликация - только по полной сигнатуре
                    // Убираем проверку по title, так как одинаковые title могут быть у разных тестов с разными параметрами
                    const signature = getLogicSignature(x);
                    if (seenLogic.has(signature)) {
                        const existingTitle = seenLogic.get(signature);
                        console.log(`[sanitize] ⚠️ Дубликат по полной логике: "${x.title}" (уже есть: "${existingTitle}")`);
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
            text, pageId, glossary, glossaryPageId, context, contextPageIds, contextInstruction, bearerToken,
            projectId,
            testModelId  // Опционально: ID задачи генерации модели (игнорируется - используем только новую модель)
        } = inputData;

        // ✅ КРИТИЧЕСКИ ВАЖНО: НЕ ЗАГРУЖАЕМ СТАРЫЕ ТЕСТ-КЕЙСЫ ИЗ БД!
        // При генерации тест-кейсов используем ТОЛЬКО новую модель с фронтенда
        // Старые тест-кейсы из generation_tasks.result.testCases НЕ используются
        // Каждая генерация создает новые тест-кейсы с нуля на основе предоставленной модели
        console.log(`[generate-test-cases-async] ✅ ГЕНЕРАЦИЯ С НУЛЯ: Старые тест-кейсы из БД НЕ используются`);
        console.log(`[generate-test-cases-async] 📦 Получен model: type=${typeof rawModel}, isArray=${Array.isArray(rawModel)}`);

        let extractedModel = null;

        // Проверка 1: Если model - объект { testModel: [...] }
        if (rawModel && typeof rawModel === 'object' && !Array.isArray(rawModel)) {
            if (rawModel.testModel && Array.isArray(rawModel.testModel)) {
                extractedModel = rawModel.testModel;
                console.log(`[generate-test-cases-async] ✅ Извлечён model из объекта: testModel содержит ${extractedModel.length} Feature(s)`);
            } else if (rawModel.model && Array.isArray(rawModel.model)) {
                extractedModel = rawModel.model;
                console.log(`[generate-test-cases-async] ✅ Извлечён model из объекта: model содержит ${extractedModel.length} Feature(s)`);
            } else {
                // Пробуем найти массив в любом свойстве объекта
                for (const key in rawModel) {
                    if (Array.isArray(rawModel[key]) && rawModel[key].length > 0) {
                        const firstItem = rawModel[key][0];
                        // Проверяем, что это похоже на Feature (имеет text и stories)
                        if (firstItem && typeof firstItem === 'object' && firstItem.text && Array.isArray(firstItem.stories)) {
                            extractedModel = rawModel[key];
                            console.log(`[generate-test-cases-async] ✅ Извлечён model из объекта: ${key} содержит ${extractedModel.length} Feature(s)`);
                            break;
                        }
                    }
                }
            }
        }
        // Проверка 2: Если model - массив
        else if (Array.isArray(rawModel)) {
            if (rawModel.length > 0) {
                const firstItem = rawModel[0];
                // Проверяем, что это похоже на Feature
                if (firstItem && typeof firstItem === 'object' && firstItem.text && Array.isArray(firstItem.stories)) {
                    extractedModel = rawModel;
                    console.log(`[generate-test-cases-async] ✅ Используем model как массив: ${extractedModel.length} Feature(s)`);
                } else {
                    console.warn(`[generate-test-cases-async] ⚠️ model - массив, но первый элемент не похож на Feature:`, firstItem);
                }
            } else {
                console.warn(`[generate-test-cases-async] ⚠️ model - пустой массив`);
            }
        }
        // Проверка 3: model пустой/невалидный
        else if (!rawModel) {
            // ❌ ЗАПРЕЩЕНО: Загрузка старой модели из БД - используем ТОЛЬКО новую модель с фронтенда
            // Загрузка старой модели из БД может привести к использованию устаревших данных
            // Если модель не предоставлена - это ошибка, а не повод загружать старую
            const errorMsg = `[generate-test-cases-async] ❌ КРИТИЧЕСКАЯ ОШИБКА: Модель не предоставлена с фронтенда! testModelId=${testModelId || 'не указан'} игнорируется - используем ТОЛЬКО новую модель. Загрузка старых данных из БД ЗАПРЕЩЕНА!`;
            console.error(errorMsg);
            throw new Error('Модель обязательна для генерации тест-кейсов. Загрузка старых данных из БД запрещена. Пожалуйста, предоставьте модель с фронтенда.');
        }

        // Финальная проверка
        if (!extractedModel || !Array.isArray(extractedModel) || extractedModel.length === 0) {
            const errorMsg = `[generate-test-cases-async] ❌ КРИТИЧЕСКАЯ ОШИБКА: model пустой/невалидный! Нельзя генерировать тест-кейсы без модели!`;
            console.error(errorMsg);
            console.error(`[generate-test-cases-async] rawModel:`, JSON.stringify(rawModel, null, 2).substring(0, 500));
            throw new Error('Модель не предоставлена или невалидна. Невозможно сгенерировать тест-кейсы без тестовой модели.');
        }

        // Подсчитываем статистику модели
        const featuresCount = extractedModel.length;
        const storiesCount = extractedModel.reduce((sum, f) => sum + (f.stories || []).length, 0);
        const scenariosCount = extractedModel.reduce((sum, f) =>
            sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0);
        const codesCount = extractedModel.reduce((sum, f) =>
            sum + (f.stories || []).reduce((s, st) =>
                s + (st.scenarios || []).reduce((sc, scn) => sc + (scn.codes || []).length, 0), 0), 0);

        console.log(`[generate-test-cases-async] ✅ Используем переданную модель: Features=${featuresCount}, Stories=${storiesCount}, Scenarios=${scenariosCount}, Codes=${codesCount}`);

        // ✅ КРИТИЧЕСКИ ВАЖНО: Сохраняем ОРИГИНАЛЬНУЮ модель БЕЗ ИЗМЕНЕНИЙ для возврата в ответе
        // Модель НЕ должна модифицироваться в процессе генерации тест-кейсов!
        // Сохраняем оригинал с глубоким копированием
        const originalModel = JSON.parse(JSON.stringify(extractedModel));

        // ✅ СОЗДАЕМ РАБОЧУЮ КОПИЮ для внутреннего использования (только для чтения и валидации)
        // НО оригинальная модель остается нетронутой для возврата
        const workingModelCopy = JSON.parse(JSON.stringify(extractedModel));

        // ✅ ЛОГИРОВАНИЕ: Сохраняем статистику оригинальной модели
        const originalModelStats = {
            features: originalModel.length,
            stories: originalModel.reduce((sum, f) => sum + (f.stories || []).length, 0),
            scenarios: originalModel.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) => s + (st.scenarios || []).length, 0), 0),
            codes: originalModel.reduce((sum, f) =>
                sum + (f.stories || []).reduce((s, st) =>
                    s + (st.scenarios || []).reduce((sc, scn) => sc + (scn.codes || []).length, 0), 0), 0)
        };

        console.log(`[generate-test-cases-async] ✅ Оригинальная модель сохранена: Features=${originalModelStats.features}, Stories=${originalModelStats.stories}, Scenarios=${originalModelStats.scenarios}, Codes=${originalModelStats.codes}`);

        // ✅ КРИТИЧЕСКИ ВАЖНО: Модель уже отвалидирована QA инженером - она IMMUTABLE (неизменяема)!
        // НЕ вызываем normalizeModelStructure, deduplicateScenariosAcrossStories, mergeDetailedScenarios и т.д.
        // Модель используется как CONST - источник правды для генерации тест-кейсов
        // Используем оригинальную модель БЕЗ модификаций
        const modelStructure = workingModelCopy;

        console.log(`[generate-test-cases-async] ✅ Используем модель БЕЗ модификаций (QA-валидированная модель как источник правды)`);

        if ((!Array.isArray(requirements) && typeof requirements !== 'string') || !modelStructure) {
            throw new Error('requirements и modelStructure обязательны');
        }

        // ✅ ТЕХНИЧЕСКАЯ НЕОБХОДИМОСТЬ: Добавляем отсутствующее поле type для Code (ТОЛЬКО в рабочей копии modelStructure, НЕ в originalModel!)
        // ⚠️ ВАЖНО: Это НЕ модификация структуры - мы только добавляем отсутствующее поле type для работы генератора
        // НЕ меняем text, id, структуру или другие поля - только добавляем type, если его нет
        // originalModel остается полностью нетронутой!
        for (const feature of modelStructure || []) {
            for (const story of feature.stories || []) {
                for (const scenario of story.scenarios || []) {
                    for (const code of scenario.codes || []) {
                        // Добавляем только отсутствующее поле type, если его нет
                        // НЕ меняем text, id или другие поля!
                        if (!code.type && code.text) {
                            code.type = detectCodeType(code.text);
                        }
                    }
                }
            }
        }

        // ✅ ФУНКЦИЯ ДЛЯ ГЛУБОКОГО СРАВНЕНИЯ МОДЕЛЕЙ (объявлена один раз в начале функции)
        const normalizeModelForComparison = (obj) => {
            if (obj === null || obj === undefined) return obj;
            if (typeof obj !== 'object') return obj;
            if (Array.isArray(obj)) {
                return obj.map(normalizeModelForComparison);
            }
            const sorted = {};
            Object.keys(obj).sort().forEach(key => {
                sorted[key] = normalizeModelForComparison(obj[key]);
            });
            return sorted;
        };

        // ✅ КРИТИЧЕСКАЯ ПРОВЕРКА: Убеждаемся что originalModel не изменилась после всех операций
        // Сравниваем по JSON для глубокого сравнения структуры
        // Используем глубокое сравнение JSON (с сортировкой ключей для стабильности)
        const originalModelJson = JSON.stringify(normalizeModelForComparison(originalModel));
        const originalModelChecksum = originalModelJson.length; // Размер JSON для быстрой проверки
        const originalModelHashPreview = originalModelJson.substring(0, 1000); // Первые 1000 символов для детальной проверки

        console.log(`[generate-test-cases-async] ✅ Оригинальная модель сохранена (размер: ${originalModelChecksum} символов JSON, хеш: ${originalModelHashPreview.substring(0, 50)}...)`);

        // ✅ НОВОЕ: Получаем список shared steps для проекта (если projectId указан)
        let sharedStepsList = [];
        let sharedStepsMap = new Map(); // name -> { id, name, hasExpectedResult, steps, expectedResults }
        let sharedStepsDetailsForPrompt = []; // Массив с полной информацией для промпта

        if (projectId) {
            try {
                console.log(`[generateTestCasesAsync] Получаю список shared steps для проекта ${projectId}...`);
                const sharedStepsResponse = await getSharedStepsList({
                    projectId,
                    page: 0,
                    size: 100, // Получаем первые 100 shared steps
                    archived: false
                });

                if (sharedStepsResponse?.content && Array.isArray(sharedStepsResponse.content)) {
                    sharedStepsList = sharedStepsResponse.content;
                    console.log(`[generateTestCasesAsync] ✅ Найдено ${sharedStepsList.length} shared steps`);

                    // Создаем карту для быстрого поиска и собираем полную информацию о shared steps
                    for (const ss of sharedStepsList) {
                        // Получаем детали shared step (шаги, expected result)
                        try {
                            const details = await getSharedStepDetails(ss.id);

                            // ✅ Извлекаем шаги из правильной структуры Allure API
                            // Структура: details.scenario.sharedStepScenarioSteps или details.scenario.scenarioSteps
                            const scenario = details?.scenario || {};
                            const sharedStep = scenario?.sharedSteps?.[ss.id];

                            // Получаем ID шагов из children shared step
                            const stepIds = sharedStep?.children || [];

                            // Извлекаем шаги из sharedStepScenarioSteps
                            const steps = stepIds.map(stepId => {
                                const step = scenario?.sharedStepScenarioSteps?.[stepId];
                                return step;
                            }).filter(Boolean);

                            // Если нет шагов в sharedStepScenarioSteps, пробуем scenarioSteps
                            if (steps.length === 0) {
                                const rootChildren = scenario?.root?.children || [];
                                steps.push(...rootChildren.map(stepId => {
                                    const step = scenario?.scenarioSteps?.[stepId];
                                    return step;
                                }).filter(Boolean));
                            }

                            const hasExpectedResult = steps.some(step =>
                                step.expectedResultJson || step.expectedResult
                            ) || false;

                            // Извлекаем тексты шагов из TipTap формата
                            const stepTexts = steps.map(step => {
                                if (step.bodyJson?.content) {
                                    // Извлекаем текст из TipTap структуры
                                    const extractText = (node) => {
                                        if (node.type === 'text') return node.text || '';
                                        if (node.content && Array.isArray(node.content)) {
                                            return node.content.map(extractText).join('');
                                        }
                                        return '';
                                    };
                                    return extractText(step.bodyJson);
                                }
                                return step.body || '';
                            }).filter(Boolean);

                            // Извлекаем Expected Result (если есть)
                            const expectedResults = steps.map(step => {
                                if (step.expectedResultJson?.content) {
                                    const extractText = (node) => {
                                        if (node.type === 'text') return node.text || '';
                                        if (node.content && Array.isArray(node.content)) {
                                            return node.content.map(extractText).join('');
                                        }
                                        return '';
                                    };
                                    return extractText(step.expectedResultJson);
                                }
                                return step.expectedResult || '';
                            }).filter(Boolean);

                            const sharedStepInfo = {
                                id: ss.id,
                                name: ss.name,
                                hasExpectedResult,
                                steps: stepTexts,
                                expectedResults: expectedResults
                            };

                            sharedStepsMap.set(ss.name.toLowerCase().trim(), sharedStepInfo);
                            sharedStepsDetailsForPrompt.push(sharedStepInfo);

                            console.log(`[generateTestCasesAsync] ✅ Загружен shared step "${ss.name}" (ID: ${ss.id}): ${stepTexts.length} шаг(ов), Expected Result: ${hasExpectedResult ? 'да' : 'нет'}`);

                            // ✅ ДЕТАЛЬНЫЙ ЛОГ для debug режима
                            if (skipAllureAPICalls) {
                                console.log(`[DEBUG MODE] 📋 Shared Step "${ss.name}" (ID: ${ss.id}):`);
                                stepTexts.forEach((step, idx) => {
                                    console.log(`[DEBUG MODE]    ${idx + 1}. ${step}`);
                                });
                                if (expectedResults.length > 0) {
                                    console.log(`[DEBUG MODE]    Ожидаемый результат: ${expectedResults.join('; ')}`);
                                }
                            }
                        } catch (err) {
                            console.warn(`[generateTestCasesAsync] Не удалось получить детали shared step ${ss.id}:`, err.message);
                            // Добавляем без деталей
                            const sharedStepInfo = {
                                id: ss.id,
                                name: ss.name,
                                hasExpectedResult: false,
                                steps: [],
                                expectedResults: []
                            };
                            sharedStepsMap.set(ss.name.toLowerCase().trim(), sharedStepInfo);
                            sharedStepsDetailsForPrompt.push(sharedStepInfo);
                        }
                    }

                    // ✅ ИТОГОВЫЙ ЛОГ для debug режима
                    if (skipAllureAPICalls && sharedStepsDetailsForPrompt.length > 0) {
                        console.log(`\n[DEBUG MODE] ═══════════════════════════════════════════════════════════`);
                        console.log(`[DEBUG MODE] 📊 ИТОГО ЗАГРУЖЕНО ${sharedStepsDetailsForPrompt.length} SHARED STEPS ИЗ ПРОЕКТА ${projectId}:`);
                        console.log(`[DEBUG MODE] ═══════════════════════════════════════════════════════════\n`);
                        sharedStepsDetailsForPrompt.forEach((ss, idx) => {
                            console.log(`[DEBUG MODE] ${idx + 1}. "${ss.name}" (ID: ${ss.id}):`);
                            if (ss.steps.length > 0) {
                                ss.steps.forEach((step, stepIdx) => {
                                    console.log(`[DEBUG MODE]    ${stepIdx + 1}. ${step}`);
                                });
                            } else {
                                console.log(`[DEBUG MODE]    (шаги не загружены)`);
                            }
                            if (ss.expectedResults.length > 0) {
                                console.log(`[DEBUG MODE]    ✅ Expected: ${ss.expectedResults.join('; ')}`);
                            }
                            console.log('');
                        });
                        console.log(`[DEBUG MODE] ═══════════════════════════════════════════════════════════\n`);
                    }
                }
            } catch (error) {
                console.warn(`[generateTestCasesAsync] ⚠️ Ошибка получения shared steps:`, error.message);
                // Продолжаем без shared steps
            }
        } else {
            console.log(`[generateTestCasesAsync] ⚠️ projectId не указан, shared steps не будут загружены`);
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

ПРИМЕР E2E (БЕЗ scenario!):
{
  "title": "Авторизация и отправка отчёта BiZone",
  "layer": "E2E Tests",
  "feature": "${feature}",
  "story": "${story}",
  "steps": ["Авторизоваться в системе", "Открыть приложение", "Перейти к отправке отчёта BiZone", "Нажать 'Отправить отчёт'"],
  "expected": "Отчёта BiZone успешно отправлен, отображается уведомление об успешной отправке"
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

            // ✅ ИСПРАВЛЕНО: Используем ПОЛНУЮ модель для enum, а не только chunk
            const allowedForChunk = collectAllowedCodes(model);
            const allowedScenarios = collectAllowedScenarios(model);

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
Ты — SDET, генерирующий тест-кейсы на основе requirements и тестовой модели (Feature → Story → Scenario → Code).

🎯 ТИПЫ ТЕСТОВ (ОБЯЗАТЕЛЬНО ГЕНЕРИРУЙ ВСЕ ТРИ ТИПА!):
- **E2E Tests**: 🚨 ОБЯЗАТЕЛЬНО! Полные пользовательские сценарии через UI (начинаются с авторизации, без технических деталей API). Для КАЖДОЙ Story создай 1-2 E2E теста!
- **Integration frontend Tests**: Атомарные тесты UI-компонент (без предварительных шагов авторизации)
- **Integration backend Tests**: Атомарные тесты API (формат: "Выполнить GET /api/endpoint с параметрами X")
  
🚨 ПРАВИЛО ПРИВЯЗКИ BACKEND ТЕСТОВ К STORIES:
- Backend тест должен быть привязан к Story, которая ИСПОЛЬЗУЕТ этот API!
- Перед генерацией проверь: API из Code должен соответствовать Story!
  ❌ Backend тест "GET /api/categories" в Story "Редактирование изображения" → ✅ В Story "Поиск изображения"!
  ❌ Backend тест "DELETE /api/images/{id}" в Story "Редактирование изображения" → ✅ В Story "Удаление изображения"!
  ❌ Backend тест "POST /api/upload" в Story "Редактирование изображения" → ✅ В Story "Загрузка изображения в категорию"!
🚨 ПРАВИЛО СВЯЗИ С SCENARIO:
- Integration frontend Tests ОБЯЗАТЕЛЬНО указывают scenario из тестовой модели, где описан соответствующий frontend code.
- Integration backend Tests ОБЯЗАТЕЛЬНО указывают scenario из тестовой модели, где описан соответствующий backend code.

🚨 КРИТИЧЕСКИ ВАЖНО: НЕ ПРОПУСКАЙ E2E ТЕСТЫ!
- Каждая Story ДОЛЖНА иметь минимум 1 E2E тест
- E2E тесты описывают полный пользовательский путь от начала до конца
- E2E тесты НЕ содержат HTTP-методы, статус-коды, эндпоинты
- E2E тесты содержат только действия пользователя: "Нажать кнопку", "Ввести текст", "Выбрать категорию"
🚨 ОБЯЗАТЕЛЬНЫЕ ПОЛЯ ДЛЯ КАЖДОГО ТЕСТА:
1. **id**: ОБЯЗАТЕЛЬНО! Формат: "tc-e2e-001", "tc-if-001", "tc-ib-001" (НЕ оставляй пустым!)
2. **title**: Краткое описание БЕЗ "проверка|тестирование|валидация"
3. **feature**: Из тестовой модели
4. **story**: Из тестовой модели
5. **layer**: "E2E Tests" / "Integration frontend Tests" / "Integration backend Tests"
6. **steps**: Массив строк с действиями (БЕЗ "Попытаться", "Дождаться"!)
7. **expected**: С **жирным** ключевым словом в начале!
8. **tags**: ОБЯЗАТЕЛЬНО! ["D"] / ["M"] / ["S"] / ["D", "M"] (НЕ оставляй пустым!)
9. **priority**: "High" / "Medium" / "Low"
10. **version**: ОБЯЗАТЕЛЬНО! Всегда "stable"

🚫 ЗАПРЕЩЁННЫЕ СЛОВА В STEPS:
❌ "Попытаться выбрать файл..." → ✅ "Выбрать файл..."
❌ "Дождаться загрузки списка" → ✅ Убери этот шаг, не нужен!
❌ "Проверить отображение кнопки" → ✅ "Нажать кнопку..."
❌ "Убедиться, что выбрана категория" → ✅ Убери этот шаг! Это не действие пользователя!
❌ "открытия модального окна" → ❌ НЕПРАВИЛЬНО! Это не шаг, а описание состояния! Убери полностью!

🚨 КРИТИЧНО: КАЖДЫЙ ШАГ ДОЛЖЕН НАЧИНАТЬСЯ С ГЛАГОЛА ДЕЙСТВИЯ!
❌ "загрузки списка изображений" → ❌ НЕПРАВИЛЬНО! Это не шаг, а описание состояния! Убери полностью!
❌ "открытия модального окна 'Выбор изображения'" → ❌ НЕПРАВИЛЬНО! Это не шаг, а описание состояния! Убери полностью!
❌ "отображение кнопки" → ❌ НЕПРАВИЛЬНО! Это не шаг, а описание состояния! Убери полностью!
❌ "Дождаться загрузки списка изображений" → ❌ НЕПРАВИЛЬНО! "Дождаться" запрещено! Убери этот шаг!
❌ "Проверить отображение кнопки" → ❌ НЕПРАВИЛЬНО! "Проверить" запрещено! Убери этот шаг!
❌ "Убедиться, что выбрана категория" → ❌ НЕПРАВИЛЬНО! "Убедиться" запрещено! Убери этот шаг!
✅ ПРАВИЛЬНО: "Нажать кнопку 'Загрузить'", "Ввести текст", "Выбрать файл", "Кликнуть на изображение"
🎯 ПРАВИЛО: Шаг = действие пользователя (глагол + объект), НЕ описание состояния!
🎯 ПРАВИЛО: Если шаг НЕ начинается с глагола действия (Нажать, Ввести, Выбрать, Кликнуть) - УБЕРИ ЕГО!

🔐 PRECONDITION (обязательно для некоторых типов):
- E2E Tests: обычно "" (пустая строка), если нет особых предварительных настроек
- Integration frontend Tests: ОБЯЗАТЕЛЬНО! Описание состояния UI, например:
  ✅ "Пользователь авторизован, находится на странице с блоком 'Изображение'"
  ✅ "Модальное окно 'Выбор изображения' открыто, выбрана категория 'Пользовательские'"
  ❌ Integration frontend тест БЕЗ precondition → ОШИБКА! Добавь precondition!
- Integration backend Tests: ОБЯЗАТЕЛЬНО! Описание состояния сервера, например:
  ✅ "Сервер доступен, БД содержит данные категорий"
  ✅ "Изображение существует в базе данных"


📊 ПАРАМЕТРИЗАЦИЯ (используй где есть вариативность!):
- Категории: ["Пользовательские", "Документы", "Системные"]
- Форматы файлов: ["PNG", "JPG", "JPEG", "GIF", "BMP", "PDF"]
- Размеры: [1, 3, 5, 6] МБ
- Фильтры: ["Чёрно-белый", "Сепия", "Винтаж"]

⚡ EXPECTED RESULT - ТОЛЬКО ЭТИ КЛЮЧЕВЫЕ СЛОВА:
✅ **Отображается** - для UI (показывается элемент, окно, список)
✅ **Возвращается** - для API (200 OK, 400 Bad Request, JSON)
✅ **Скрывается** - для UI (элемент исчезает)
✅ **Создан** / **Удалён** / **Обновлён** - для объектов (пользователь создан, файл удалён)
❌ **Обновляется** - НЕПРАВИЛЬНО! Используй "**Отображается** обновлённое изображение"
❌ **Удаляется** - НЕПРАВИЛЬНО! Используй "**Отображается** пустой блок, изображение удалено"

🚨 КРИТИЧНО: НЕ ВЫДУМЫВАЙ ИНФОРМАЦИЮ, КОТОРОЙ НЕТ В ТРЕБОВАНИЯХ!
❌ НЕПРАВИЛЬНО: Если в требованиях указаны фильтры "Чёрно-белый", "Сепия", "Винтаж" - НЕ добавляй "Карандаш"!
❌ НЕПРАВИЛЬНО: Если в требованиях НЕТ API для редактирования - НЕ выдумывай POST /api/edit или PUT /api/rotate!
❌ НЕПРАВИЛЬНО: Если в требованиях НЕТ поля count в ответе категорий - НЕ добавляй его!
❌ НЕПРАВИЛЬНО: Если в требованиях НЕТ сообщения об ошибке - НЕ выдумывай текст ошибки!
❌ НЕПРАВИЛЬНО: Если в требованиях НЕТ несуществующего фильтра - НЕ создавай тест "Применить несуществующий фильтр"!
❌ НЕПРАВИЛЬНО: Если в требованиях НЕТ уведомления "Некорректные параметры" - НЕ добавляй его в expected!
✅ ПРАВИЛЬНО: Используй ТОЛЬКО ту информацию, которая явно указана в requirements!
🎯 ПРАВИЛО: Тест-кейс = проверка требований, НЕ твои догадки!
🚨 КРИТИЧНО: Если чего-то НЕТ в требованиях - НЕ придумывай шаги, тест-кейсы или ожидаемые результаты!

🚨 КРИТИЧНЫЕ ОШИБКИ - ИЗБЕГАЙ:

1. ❌ ТЕСТ БЕЗ id → ✅ "id": "uuid-генерируй-всегда" 
   🚨 КРИТИЧНО: КАЖДЫЙ тест ОБЯЗАН иметь id! Используй UUID или tc-{layer}-{number}
   
2. ❌ ТЕСТ БЕЗ version → ✅ "version": "stable"
   🚨 КРИТИЧНО: КАЖДЫЙ тест ОБЯЗАН иметь version!
   
3. ❌ ТЕСТ БЕЗ priority → ✅ "priority": "High" (E2E), "Medium" (Integration)
   🚨 КРИТИЧНО: КАЖДЫЙ тест ОБЯЗАН иметь priority!

4. ❌ ТЕСТ БЕЗ tags → ✅ "tags": ["M"] или ["D"] или ["A"] или ["S"]
   🚨 КРИТИЧНО: КАЖДЫЙ тест ОБЯЗАН иметь tags! Используй:
   - M = Mobile окружение
   - D = Desktop (веб) окружение
   - A = Автоматизация
   - S = Smoke тест
   
   🚨 ПРАВИЛА ТЕГОВ ПО LAYER (СТРОГО СОБЛЮДАЙ!):
   - E2E Tests: МОГУТ иметь теги M, D, A, PWA (в зависимости от требований), НО НЕ МОГУТ иметь тег S!
     ❌ E2E тест с тегами ["D", "S"] → ✅ ["D"]
   - Integration backend Tests: ОБЯЗАТЕЛЬНО имеют тег S (Smoke)
   - Integration frontend Tests: МОГУТ иметь теги M, D, A, PWA (в зависимости от требований), НО НЕ МОГУТ иметь тег S!

5. ❌ E2E тест БЕЗ precondition → ✅ "precondition": "Пользователь не авторизован"
   ❌ Integration backend БЕЗ precondition → ✅ "precondition": "Сервер доступен, БД содержит данные"

6. ❌ Expected: "Отображается список" → ✅ "**Отображается** список категорий"
   ❌ Expected: "**Обновляется** изображение" → ✅ "**Отображается** обновлённое изображение"
   ❌ Expected: "**Удаляется** файл" → ✅ "**Отображается** пустой блок, файл удалён"

7. ❌ Steps: "Выполнить GET /api/images" → ✅ "Выполнить GET **/api/images**" (эндпоинты ЖИРНЫМ!)
   ❌ Expected: "GET /api/categories возвращает" → ✅ "GET **/api/categories** возвращает"

✅ ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ (КАЖДЫЙ ТЕСТ!):
□ id сгенерирован (UUID или tc-{layer}-{num})?
□ tags указаны (M/D/A/S) и соответствуют layer (E2E НЕ имеет S, backend ОБЯЗАТЕЛЬНО имеет S)?
□ version = "stable" указана?
□ priority указан (High/Medium/Low)?
□ precondition указан (ОБЯЗАТЕЛЬНО для Integration frontend и Integration backend)?
□ Expected начинается с правильного **Ключевого слова** (Отображается/Возвращается/Скрывается)?
□ Есть параметризация где нужна вариативность (категории, форматы, размеры, фильтры)?
□ E2E тесты БЕЗ HTTP-методов/статус-кодов?
□ ВСЕ эндпоинты в Integration backend выделены ЖИРНЫМ (**/api/...**)?
□ Steps БЕЗ "Попытаться", "Дождаться", "Проверить"?
□ Backend тесты привязаны к правильной Story (API из Code соответствует Story)?
□ Integration frontend/backend тесты имеют корректный scenario (ссылка на scenario из модели), E2E тесты БЕЗ scenario?
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
ПРАВИЛА ПОКРЫТИЯ (СТРОГО СОБЛЮДАЙ!):
🚨 E2E: ОБЯЗАТЕЛЬНО 1-2 теста на КАЖДУЮ Story (основной путь + критичный негатив)
- БЕЗ E2E тестов = НЕПРАВИЛЬНО! Каждая Story ДОЛЖНА иметь минимум 1 E2E тест!
- Integration Frontend: 2-3 теста на Scenario (позитив + негатив + граничные)
- Integration Backend: 2-3 теста на Code backend (API endpoints)

═══════════════════════════════════════════════════════════════

ФОРМУЛА: 
Total = (Stories × 1.5) + (Scenarios × 2.5) ± 30%

ПРОВЕРКА перед submit_cases:
🚨 КРИТИЧНО: □ Каждая Story имеет ≥1 E2E? (БЕЗ E2E = ОШИБКА!)
□ Каждый Scenario имеет ≥2 Integration?
□ Expected конкретный во всех тестах?
`.trim();

        // ✅ НОВОЕ: Добавляем информацию о shared steps в system prompt с полной структурой
        const sharedStepsSection = sharedStepsDetailsForPrompt && sharedStepsDetailsForPrompt.length > 0 ? `
═══════════════════════════════════════════════════════════════
📋 ОБЩИЕ ШАГИ (SHARED STEPS) - ПОСЛЕДОВАТЕЛЬНОСТИ МНОГОКРАТНО ИСПОЛЬЗУЕМЫХ ШАГОВ
═══════════════════════════════════════════════════════════════

🔑 ЧТО ТАКОЕ SHARED STEP:
Shared Step = ПОСЛЕДОВАТЕЛЬНОСТЬ из 2+ шагов, объединённая под одним названием для повторного использования.

ПРИМЕР:
"Авторизоваться" - это НЕ один шаг, а последовательность:
  1. Ввести номер
  2. Ввести пароль
  3. Нажать кнопку "Войти"

Если эта последовательность встречается в 5 тест-кейсах → создай ОДИН shared step "Авторизоваться" и используй его везде!

🎯 ДОСТУПНЫЕ SHARED STEPS В ПРОЕКТЕ:

${sharedStepsDetailsForPrompt.map((ss, idx) => {
            const stepsText = ss.steps.length > 0
                ? ss.steps.map((step, i) => `   ${i + 1}. ${step}`).join('\n')
                : '   (шаги не загружены)';
            const expectedText = ss.expectedResults.length > 0
                ? `\n   Ожидаемый результат:\n${ss.expectedResults.map((er, i) => `   ${i + 1}. ${er}`).join('\n')}`
                : '';
            return `${idx + 1}. **"${ss.name}"** (ID: ${ss.id})
   Последовательность шагов:
${stepsText}${expectedText}
`;
        }).join('\n')}

📐 ПРАВИЛА СОЗДАНИЯ И ИСПОЛЬЗОВАНИЯ:

1. 🔍 ОБНАРУЖЕНИЕ ПОВТОРОВ (когда создавать shared step):
   ✅ Если одинаковая последовательность шагов встречается в 2+ тест-кейсах
   ✅ Если последовательность = стандартная операция ("Авторизоваться", "Открыть меню")
   ✅ Если последовательность логически связана (подготовка данных, настройка окружения)

   ПРИМЕРЫ последовательностей для shared step:
   - "Авторизоваться": ["Ввести email", "Ввести пароль", "Нажать Войти"]
   - "Открыть редактор контента": ["Перейти в раздел Контент", "Нажать Создать", "Выбрать тип Статья"]
   - "Настроить фильтр": ["Нажать Фильтры", "Выбрать категорию", "Применить фильтр"]

2. 📝 ИСПОЛЬЗОВАНИЕ СУЩЕСТВУЮЩЕГО shared step:
   {
     "steps": [
       { "sharedStepId": 123 },  // ← ID из списка выше (например, "Авторизоваться")
       "Перейти в раздел платежей"  // ← обычный шаг после shared step
     ]
   }

3. ➕ СОЗДАНИЕ НОВОГО shared step (если нет в списке, но нужен):
   - НЕ создавай shared step для одного шага!
   - Создавай ТОЛЬКО для последовательности из 2+ шагов
   - Используй инструмент create_shared_step({ name: "Название", steps: ["Шаг 1", "Шаг 2", ...] })

4. ⚠️ E2E ТЕСТЫ - ОСОБОЕ ПРАВИЛО:
   ✅ E2E БЕЗ "Авторизоваться" в steps → ДОБАВЬ shared step "Авторизоваться" первым
   ✅ E2E С "Авторизоваться" в steps → ЗАМЕНИ на shared step
   ❌ Integration frontend/backend → БЕЗ "Авторизоваться"!

ПРИМЕРЫ:

❌ НЕПРАВИЛЬНО (дублирование последовательности):
Тест 1: ["Ввести email", "Ввести пароль", "Нажать Войти", "Перейти в настройки"]
Тест 2: ["Ввести email", "Ввести пароль", "Нажать Войти", "Открыть профиль"]
Тест 3: ["Ввести email", "Ввести пароль", "Нажать Войти", "Загрузить файл"]

✅ ПРАВИЛЬНО (использование shared step):
Создать shared step "Авторизоваться" = ["Ввести email", "Ввести пароль", "Нажать Войти"]

Тест 1: [{ "sharedStepId": 123 }, "Перейти в настройки"]
Тест 2: [{ "sharedStepId": 123 }, "Открыть профиль"]
Тест 3: [{ "sharedStepId": 123 }, "Загрузить файл"]

❌ НЕПРАВИЛЬНО (shared step для одного шага):
create_shared_step({ name: "Нажать кнопку", steps: ["Нажать кнопку"] }) // НЕ ДЕЛАЙ ТАК!

✅ ПРАВИЛЬНО (shared step = последовательность):
create_shared_step({ 
  name: "Открыть форму редактирования", 
  steps: ["Перейти в раздел Контент", "Нажать на карточку статьи", "Нажать Редактировать"]
})

═══════════════════════════════════════════════════════════════
`.trim() : '';

        const baseSystemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${COVENANT}${sharedStepsSection ? '\n\n' + sharedStepsSection : ''}`;
        const baseCaseModelOptions = {
            models: config.cloudruModels,
            temperature: 0,
            top_p: 1,
            max_tokens: 45000,  // ✅ Безопасное значение для MiniMax-M2 (лимит 196K токенов)
            extra: { transforms: 'middle-out' }
        };

        const composeUserPrompt = (corePrompt) => {
            if (!toolInstruction) return corePrompt;
            const trimmedInstruction = toolInstruction.endsWith('\n') ? toolInstruction : `${toolInstruction}\n`;
            return `${trimmedInstruction}${corePrompt}`;
        };

        async function runTestCaseLLM({
            taskContextId = taskId,
            systemPrompt = baseSystemPrompt,
            userPrompt,
            submissionTool,
            modelOverrides = {},
            persistContext = true,
            responseFormat = TEST_CASE_RESPONSE_FORMAT
        }) {
            const decoratedUserPrompt = composeUserPrompt(userPrompt);
            const combinedTools = [...interactiveTools];
            const finalToolNames = [];

            if (submissionTool) {
                combinedTools.push(submissionTool);
                const toolName = submissionTool?.function?.name;
                if (toolName) finalToolNames.push(toolName);
            }

            const effectiveModelOptions = { ...baseCaseModelOptions, ...modelOverrides };

            if (persistContext && taskContextId) {
                try {
                    const contextualResult = await runTestCaseLLMWithContext({
                        taskId: taskContextId,
                        userPrompt: decoratedUserPrompt,
                        systemPrompt,
                        tools: combinedTools,
                        toolHandlers: contextToolHandlers,
                        finalToolNames,
                        modelOptions: effectiveModelOptions,
                        responseFormat
                    });
                    return contextualResult.response || contextualResult;
                } catch (contextError) {
                    console.warn(`[generate-test-cases] runTestCaseLLMWithContext failed, falling back to stateless mode: ${contextError.message}`);
                }
            }

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: decoratedUserPrompt }
            ];

            try {
                const interactiveResult = await runInteractiveLLM({
                    initialMessages: messages,
                    tools: combinedTools,
                    toolHandlers: contextToolHandlers,
                    finalToolNames,
                    modelOptions: { ...effectiveModelOptions, response_format: responseFormat }
                });
                return interactiveResult.response;
            } catch (interactiveError) {
                console.warn(`[generate-test-cases] interactive loop failed: ${interactiveError.message}`);
                return await callWithCloudRuFallback(
                    OPENROUTER_URL,
                    messages,
                    config.openRouterAiKey,
                    {
                        ...effectiveModelOptions,
                        tools: combinedTools,
                        response_format: responseFormat
                    }
                );
            }
        }


        // === tool-schema с жёстким enum для сценариев ===
        // ✅ ДОРАБОТКА 2: Обновлена функция для поддержки reqStructure
        const buildSubmitCasesToolStrict = (allowedCodes = [], allowedScenarios = [], reqStructure = null) => {
            // ✅ ИСПРАВЛЕНО: Извлекаем допустимые feature/story из modelStructure (не из reqStructure)
            // reqStructure может быть устаревшим, всегда используем актуальную modelStructure
            let allowedFeatures = [];
            let allowedStories = [];

            // ✅ ИСПРАВЛЕНО: Всегда используем modelStructure для enum, чтобы гарантировать точное соответствие
            if (modelStructure && Array.isArray(modelStructure) && modelStructure.length > 0) {
                allowedFeatures = modelStructure.map(f => f.text).filter(Boolean);
                allowedStories = modelStructure.flatMap(f => (f.stories || []).map(s => s.text).filter(Boolean));
            } else if (reqStructure && reqStructure.features && reqStructure.features.length > 0) {
                // Fallback: только если modelStructure недоступна
                allowedFeatures = reqStructure.features.map(f => f.name).filter(Boolean);
                allowedStories = reqStructure.features.flatMap(f => f.stories.map(s => s.name).filter(Boolean));
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
                                        steps: {
                                            type: "array",
                                            description: `Массив шагов. Может содержать:
- Строки: обычные шаги (например, "Перейти в раздел платежей")
- Объекты с sharedStepId: использование существующего shared step (например, { "sharedStepId": 123 })
- Объекты с text и expectedResult: шаг с ожидаемым результатом (например, { "text": "Нажать кнопку", "expectedResult": "Отображается модальное окно" })

🚨 ВАЖНО: 
1. Перед созданием шага проверь список доступных shared steps выше. Если есть подходящий shared step - используй его ID вместо дублирования текста!
2. Для каждого шага, где важен результат действия, указывай expectedResult (например, "2.1. На кнопке 'Отправить' отображается лоадер", "Открывается меню пользователя", "Появляется модальное окно с кнопками")
3. Expected Result должен быть КОНКРЕТНЫМ и описывать результат именно этого шага, а не всего тест-кейса!`,
                                            items: {
                                                oneOf: [
                                                    {
                                                        type: "string",
                                                        description: "Обычный шаг (текст действия). Используй, если нет подходящего shared step и не нужен Expected Result."
                                                    },
                                                    {
                                                        type: "object",
                                                        description: "Использование существующего shared step. Используй, если шаг уже есть в списке доступных shared steps или был создан через create_shared_step.",
                                                        properties: {
                                                            sharedStepId: {
                                                                type: "number",
                                                                description: "ID существующего shared step из списка доступных или созданного через create_shared_step tool. НЕ строка, а число!"
                                                            }
                                                        },
                                                        required: ["sharedStepId"],
                                                        additionalProperties: false
                                                    },
                                                    {
                                                        type: "object",
                                                        description: "Шаг с ожидаемым результатом. Используй для шагов, где важен результат действия (например, нажатие кнопки, выбор значения, заполнение поля).",
                                                        properties: {
                                                            text: {
                                                                type: "string",
                                                                description: "Текст шага (действие пользователя или системы). Например: 'Нажать на кнопку \"Отправить\"', 'Выбрать значение в выпадающем списке', 'Заполнить поле \"Сумма\"'"
                                                            },
                                                            expectedResult: {
                                                                type: "string",
                                                                description: "Ожидаемый результат этого конкретного шага. Должен быть КОНКРЕТНЫМ и описывать результат именно этого шага. ОБЯЗАТЕЛЬНО в форме РЕЗУЛЬТАТА (3-е лицо, настоящее время), НЕ действия! ✅ ПРАВИЛЬНО: 'Отображается поле \"Ожидаемый срок репатриации\"', 'На кнопке \"Отправить\" отображается лоадер', 'Открывается меню пользователя', 'Появляется модальное окно с кнопками', 'Поле \"Сумма\" заполнено значением {{сумма}}'. ❌ НЕПРАВИЛЬНО: 'Отобразить поле...', 'Открыть меню...' (это действия, а не результаты!)"
                                                            }
                                                        },
                                                        required: ["text", "expectedResult"],
                                                        additionalProperties: false
                                                    }
                                                ]
                                            }
                                        },
                                        expected: { type: "string" },
                                        tags: { type: "array", items: { type: "string" } },
                                        layer: {
                                            type: "string", enum: [
                                                "E2E Tests",
                                                "Integration frontend Tests",
                                                "Integration backend Tests"
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
        function extractCasesFromResponse(ai, existingCases = []) {
            const allTestCases = [];
            // ✅ КРИТИЧНО: Используем существующие тест-кейсы для проверки уникальности ID
            const usedIds = new Set(existingCases.map(tc => tc.id));

            // 1. Пробуем извлечь из tool_calls
            const toolCalls = ai.choices?.[0]?.message?.tool_calls || [];
            for (const toolCall of toolCalls) {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    if (args.cases && Array.isArray(args.cases)) {
                        for (const testCase of args.cases) {
                            // ✅ Проверяем использование shared steps и Expected Result
                            const steps = testCase.steps || [];
                            const sharedStepsUsed = steps.filter(s => typeof s === 'object' && s.sharedStepId).length;
                            const stepsWithExpectedResult = steps.filter(s => typeof s === 'object' && s.expectedResult).length;
                            if (sharedStepsUsed > 0) {
                                console.log(`[extractCasesFromResponse] ✅ Тест-кейс "${testCase.title}" использует ${sharedStepsUsed} shared step(s)`);
                            }
                            if (stepsWithExpectedResult > 0) {
                                console.log(`[extractCasesFromResponse] ✅ Тест-кейс "${testCase.title}" имеет ${stepsWithExpectedResult} шаг(ов) с Expected Result`);
                            }

                            // ✅ НОВОЕ: Генерируем уникальный ID для каждого тест-кейса
                            // ✅ КРИТИЧНО: E2E тесты НЕ должны иметь scenario! (согласно тестовой пирамиде)
                            const isE2E = testCase.layer === 'E2E Tests';
                            const shouldHaveScenario = !isE2E && (testCase.layer?.includes('Integration'))

                            // ✅ POST-PROCESSING: Определяем priority по layer если не указан
                            let priority = testCase.priority;
                            if (!priority) {
                                if (testCase.layer === 'E2E Tests') {
                                    priority = 'High';
                                } else if (testCase.layer && testCase.layer.includes('Integration')) {
                                    priority = 'Medium';
                                } else {
                                    priority = 'Low';
                                }
                            }

                            // ✅ КРИТИЧНО: Гарантируем уникальность ID (проверяем и в существующих, и в новых)
                            let testCaseId = testCase.id;
                            const allUsedIds = new Set([...usedIds, ...allTestCases.map(tc => tc.id)]);
                            if (!testCaseId || allUsedIds.has(testCaseId)) {
                                // Генерируем новый уникальный GUID
                                do {
                                    testCaseId = uuidv4();
                                } while (allUsedIds.has(testCaseId));
                                if (testCase.id && allUsedIds.has(testCase.id)) {
                                    console.warn(`[extractCasesFromResponse] ⚠️ Дубликат ID "${testCase.id}" для тест-кейса "${testCase.title}", сгенерирован новый: ${testCaseId}`);
                                }
                            }
                            // Добавляем новый ID в множество использованных
                            usedIds.add(testCaseId);
                            
                            allTestCases.push({
                                id: testCaseId, // ✅ Гарантированно уникальный ID
                                title: testCase.title,
                                steps: steps, 
                                expected: testCase.expected,
                                layer: testCase.layer,
                                feature: testCase.feature,
                                story: testCase.story,
                                // ✅ scenario назначается ТОЛЬКО для Integration и Unit тестов, НЕ для E2E!
                                scenario: shouldHaveScenario ? testCase.scenario : undefined,
                                // ✅ code назначается ТОЛЬКО для Unit тестов и опционально для Integration backend, НЕ для E2E!
                                code: ((testCase.layer === 'Integration backend Tests' && testCase.code)) ? testCase.code : undefined,
                                tags: testCase.tags || [],
                                priority: priority,
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
                            // ✅ Проверяем, является ли rawJsonCandidate уже валидным JSON (из JSON.stringify)
                            // Если это валидный JSON, не применяем cleanupJsonText
                            let jsonText = rawJsonCandidate;
                            let parsed = null;

                            // Пробуем сначала распарсить как есть (если это уже валидный JSON из JSON.stringify)
                            try {
                                parsed = JSON5.parse(jsonText);
                            } catch (e1) {
                                // Если не получилось, применяем cleanupJsonText
                                jsonText = cleanupJsonText(rawJsonCandidate);
                                try {
                                    parsed = JSON5.parse(jsonText);
                                } catch (e2) {
                                    // Если и после cleanup не получилось, логируем детали ошибки
                                    console.warn(`[extractCasesFromResponse] Ошибка парсинга JSON после cleanup: ${e2.message}`);
                                    if (e2.index !== undefined) {
                                        const errorPos = e2.index;
                                        console.warn(`[extractCasesFromResponse] Позиция ошибки: символ '${jsonText[errorPos] || '?'}' на позиции ${errorPos}`);
                                        console.warn(`[extractCasesFromResponse] Контекст ошибки: ${jsonText.substring(Math.max(0, errorPos - 50), Math.min(jsonText.length, errorPos + 50))}`);
                                    }
                                    throw e2;
                                }
                            }

                            const cases = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.cases) ? parsed.cases : []);
                            // ✅ НОВОЕ: Генерируем уникальные ID для каждого тест-кейса из content
                            // ✅ КРИТИЧНО: E2E тесты НЕ должны иметь scenario! (согласно тестовой пирамиде)
                            for (const testCase of cases) {
                                // ✅ КРИТИЧНО: Проверяем, что testCase - это объект, а не строка или другой тип
                                if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
                                    console.warn(`[extractCasesFromResponse] ⚠️ Пропущен некорректный элемент в cases: тип=${typeof testCase}, значение=`, testCase);
                                    continue;
                                }

                                // ✅ Проверяем, что это похоже на тест-кейс (есть хотя бы title или layer)
                                if (!testCase.title && !testCase.layer) {
                                    console.warn(`[extractCasesFromResponse] ⚠️ Пропущен элемент без title и layer:`, testCase);
                                    continue;
                                }

                                // ✅ POST-PROCESSING: Обязательные поля с проверкой уникальности (проверяем и в существующих, и в новых)
                                const allUsedIds = new Set([...usedIds, ...allTestCases.map(tc => tc.id)]);
                                if (!testCase.id || allUsedIds.has(testCase.id)) {
                                    // Генерируем новый уникальный GUID
                                    let newId;
                                    do {
                                        newId = uuidv4();
                                    } while (allUsedIds.has(newId));
                                    if (testCase.id && allUsedIds.has(testCase.id)) {
                                        console.warn(`[extractCasesFromResponse] ⚠️ Дубликат ID "${testCase.id}" для тест-кейса "${testCase.title}", сгенерирован новый: ${newId}`);
                                    }
                                    testCase.id = newId;
                                    usedIds.add(newId);
                                }
                                if (!testCase.version) {
                                    testCase.version = 'stable';
                                }
                                if (!testCase.priority) {
                                    // Priority по layer
                                    if (testCase.layer === 'E2E Tests') {
                                        testCase.priority = 'High';
                                    } else if (testCase.layer && testCase.layer.includes('Integration')) {
                                        testCase.priority = 'Medium';
                                    } else {
                                        testCase.priority = 'Low';
                                    }
                                }

                                // ✅ Убираем scenario для E2E тестов
                                const isE2E = testCase.layer === 'E2E Tests';
                                const shouldHaveScenario = !isE2E && (testCase.layer?.includes('Integration'));
                                if (isE2E) {
                                    testCase.scenario = undefined;
                                }
                                // ✅ Убираем code для E2E тестов
                                if (isE2E || (testCase.layer !== 'Integration backend Tests')) {
                                    testCase.code = undefined;
                                }
                                allTestCases.push(testCase);
                            }
                        }
                    } catch (e) {
                        console.warn('[extractCasesFromResponse] Ошибка парсинга content:', e.message);
                    }
                }
            }

            return allTestCases;
        }

        // ✅ ОПТИМИЗИРОВАННАЯ ВЕРСИЯ: ONE-SHOT с fallback + Few-Shot Learning + Logic Extraction
        async function genForChunkOptimized(chunk, requirements, existingE2E = [], modelStructure, reqStructure = null, contextId = null, existingCases = [], logicConstraints = null, isNegativePass = false, includeBackendTests = true) {
            const contextPrompt = buildContextPrompt(chunk, existingE2E);
            const relevantReqs = filterRelevantRequirements(requirements, chunk);
            // ✅ ИСПРАВЛЕНО: Используем ПОЛНУЮ модель для enum, а не только chunk
            // Это гарантирует, что все feature/story/scenario/code доступны в enum
            const allowedForChunk = collectAllowedCodes(modelStructure); // Используем полную модель
            const allowedScenarios = collectAllowedScenarios(modelStructure); // Используем полную модель

            // ✅ Выбираем релевантные примеры для Few-Shot Learning
            const mode = chunk[0].stories[0]._mode || 'FULL';
            // ✅ Загружаем идеальные примеры из БД для улучшения генерации
            let perfectExamples = null;
            // projectId и skipAllureAPICalls уже объявлены в начале функции generateTestCasesAsync
            if (projectId) {
                try {
                    perfectExamples = await getAllPerfectExamplesByLayer(projectId, db);
                    console.log(`[generateTestCasesAsync] Загружено идеальных примеров из БД для проекта ${projectId}:`,
                        Object.keys(perfectExamples).map(l => `${l}: ${perfectExamples[l].length}`).join(', '));
                } catch (err) {
                    console.warn(`[generateTestCasesAsync] Ошибка загрузки идеальных примеров из БД:`, err.message);
                    perfectExamples = null;
                }
            }

            const examples = await selectExamples(chunk, mode, perfectExamples, db, projectId);
            const examplesSection = buildExamplesSection(examples);

            // ✅ Форматируем логику и ограничения для промпта (если есть)
            const logicConstraintsSection = logicConstraints 
                ? formatLogicConstraintsForPrompt(logicConstraints)
                : '';

            // ✅ Формируем system prompt с примерами и логикой
            const systemPromptWithExamples = `
${BASE_SYSTEM_PROMPT}

${COVENANT}

═══════════════════════════════════════════════════════════════
⚡ ЛИМИТЫ НА КОЛИЧЕСТВО ТЕСТОВ (СТРОГО СОБЛЮДАЙ!)
═══════════════════════════════════════════════════════════════

🎯 ОПТИМАЛЬНОЕ ПОКРЫТИЕ (ОБЯЗАТЕЛЬНО ГЕНЕРИРУЙ ВСЕ ТИПЫ!):
🚨 E2E Tests: **1-2 теста на Story** (только позитивный + 1 базовый негативный)
- Основной упор на Integration тесты! E2E — только для основного Happy Path.
- Integration Tests: **8-12 тестов на Scenario** (frontend + backend вместе!)
- ⚡ Общий лимит: **10-15 тест-кейсов в ответе** (1-2 E2E + 8-12 Integration)
- 🎯 ПРИОРИТЕТ: Integration тесты покрывают бизнес-логику (негативные, граничные значения, валидации)

🚨 КРИТИЧНО: Если техники тест-дизайна требуют больше тестов, чем лимит:
   1. ПРИОРИТЕТ #1: Позитивные тесты для каждого Code (обязательно!)
   2. ПРИОРИТЕТ #2: Негативные тесты с параметризацией (объединяй через examples!)
   3. ПРИОРИТЕТ #3: Граничные значения (объединяй в ОДИН тест с параметризацией!)
   4. ПРИОРИТЕТ #4: UI логика и зависимости (если осталось место)
   
   ❌ НЕ превышай лимит 8-12 Integration тестов! Используй параметризацию для объединения!

🚨 ОБЯЗАТЕЛЬНАЯ ПАРАМЕТРИЗАЦИЯ:
- ❌ ЗАПРЕЩЕНО создавать дубликаты для разных значений (формат, размер, категория)
- ✅ ОБЯЗАТЕЛЬНО используй parameters + examples для вариаций
- Пример: вместо 5 тестов "Загрузить JPG", "Загрузить PNG", "Загрузить GIF" → 
  1 тест с параметром {{format}} и examples: [{format: "JPG"}, {format: "PNG"}, {format: "GIF"}]

🎯 ФОКУС НА КАЧЕСТВЕ, НЕ КОЛИЧЕСТВЕ:
- Лучше 8 идеальных тестов с параметризацией, чем 40 дубликатов!
- Каждый тест должен покрывать УНИКАЛЬНУЮ логику, не вариацию данных

═══════════════════════════════════════════════════════════════
📚 ЭТАЛОННЫЕ ПРИМЕРЫ (ИСПОЛЬЗУЙ КАК ШАБЛОНЫ!)
═══════════════════════════════════════════════════════════════

🚨 ПЕРЕД ГЕНЕРАЦИЕЙ - ИЗУЧИ ПРИМЕРЫ:
1. Посмотри на структуру JSON в примерах
2. Обрати внимание на формат параметризации (parameters + examples)
3. Заметь использование {{параметр}} в steps и expected
4. Проверь формат полей: feature, story, scenario, title, steps, expected, layer, priority, tags, version

${examplesSection}

${logicConstraintsSection}

🚨 КРИТИЧЕСКИ ВАЖНО:
- Примеры = ЭТАЛОН, строго следуй их формату
- Для параметризации ОБЯЗАТЕЛЬНО используй parameters + examples (как в примерах)
- В steps и expected используй {{параметр}} для подстановки значений
- Expected должен быть КОНКРЕТНЫМ (как в примерах)
- ❌ НЕ создавай дубликаты - используй параметризацию!
- ✅ Каждый тест-кейс должен иметь УНИКАЛЬНЫЙ title
- ✅ Правильно определяй layer по содержанию (E2E = полный путь, Integration = атомарный тест)
- ✅ Используй ТОЛЬКО feature/story/scenario/code из enum в tool definition!
- ⚡ ПОМНИ ЛИМИТ: максимум 8-12 тест-кейсов в ответе!
`.trim();

            const userPrompt = `
${contextPrompt}

Требования (релевантные):
${relevantReqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Модель:
${JSON.stringify(chunk, null, 2)}

${isNegativePass ? `
🚨🚨🚨 СПЕЦЗАДАНИЕ: НЕГАТИВНЫЕ И ГРАНИЧНЫЕ ТЕСТЫ 🚨🚨🚨

Ты сгенерировал основные сценарии. Теперь добавь кейсы "на слом":

1. Найди в требованиях все поля с валидацией (Сумма, Назначение платежа, и т.д.).
   - Создай Integration frontend тесты на нарушение этих валидаций.
${includeBackendTests ? '   - Создай Integration backend тесты на ошибки API (400, 500, таймаут).\n' : '   - ❌ НЕ создавай Integration backend тесты!\n'}

2. Найди логику "Если... то... иначе...".
   - Создай тест на ветку "Иначе" (например, нет торговых точек → отобразить алерт).

3. Найди кнопки и чекбоксы.
   - Создай тест: сняли галочку → поле очистилось и скрылось.

4. Найди граничные значения (мин/макс суммы, длины полей).
   - Создай ОДИН Boundary Test с параметризацией: Min-1, Min, Max, Max+1 (через parameters + examples).
   - ❌ НЕ создавай 4 отдельных теста! Используй параметризацию!

Не дублируй E2E. Делай это через Integration frontend (валидация UI)${includeBackendTests ? ' или Integration backend (ошибки API)' : ' (НЕ создавай Integration backend тесты!)'}.

🎯 ФОКУС: Только негативные и граничные тесты! Позитивные уже сгенерированы.
${!includeBackendTests ? '🚨 КРИТИЧНО: НЕ создавай Integration backend тесты! Только E2E и Integration frontend!\n' : ''}
` : `
🚨 КРИТИЧЕСКИ ВАЖНО - ОБЯЗАТЕЛЬНО ГЕНЕРИРУЙ E2E ТЕСТЫ:
- Для КАЖДОЙ Story в chunk ОБЯЗАТЕЛЬНО создай 1-2 E2E теста (layer: "E2E Tests")
- E2E тесты = полные пользовательские сценарии через UI (без технических деталей API)
- E2E тесты НЕ должны содержать HTTP-методы, статус-коды, эндпоинты
- E2E тесты должны описывать действия пользователя: "Нажать кнопку", "Ввести текст", "Выбрать категорию"
- После E2E тестов создай Integration frontend тесты для каждого Scenario
${includeBackendTests ? '- После Integration frontend создай Integration backend тесты для каждого Scenario с API\n' : '🚨 КРИТИЧНО: НЕ создавай Integration backend тесты! Только E2E и Integration frontend!\n'}
`}

🚨 ПРАВИЛА ТЕГОВ:
- E2E тесты: tags = ['D'] или ['M'] или ['D', 'M'], НЕ используй 'S'!
${includeBackendTests ? '- Integration backend: tags = [\'S\'] (обязательно)!\n' : '🚨 КРИТИЧНО: Integration backend тесты ЗАПРЕЩЕНЫ! НЕ создавай их!\n'}
- Integration frontend: tags = ['D'] или ['M'] или ['D', 'M'], НЕ используй 'S'!

🚨 ПРАВИЛА PRECONDITION:
- Integration frontend Tests: ОБЯЗАТЕЛЬНО добавь precondition с описанием состояния UI!
${includeBackendTests ? '- Integration backend Tests: ОБЯЗАТЕЛЬНО добавь precondition с описанием состояния сервера!\n' : ''}
${!includeBackendTests ? '🚨 КРИТИЧНО: НЕ создавай Integration backend тесты! Только E2E и Integration frontend!\n' : ''}

🚨 ПРАВИЛО ПРИВЯЗКИ BACKEND ТЕСТОВ:
- Backend тесты: проверь, что story соответствует API из Code! Если API используется в другой Story → привяжи к правильной Story!

🚨 ПРАВИЛО SCENARIO:
- Integration frontend и Integration backend тесты ОБЯЗАТЕЛЬНО должны ссылаться на scenario из тестовой модели, в которой описан соответствующий code.
- E2E тесты НЕ должны иметь scenario.

${isNegativePass ? `
⚡⚡⚡ ВАЖНО: Сгенерируй 5-10 негативных/граничных тест-кейсов! Фокус на Integration тесты!
` : `
⚡⚡⚡ ВАЖНО: Сгенерируй максимум 10-15 тест-кейсов (1-2 E2E + 8-12 Integration)! Используй ПАРАМЕТРИЗАЦИЮ для вариаций данных!
`}
`.trim();

            try {
                // Попытка 1: с tools
                const ai = await runTestCaseLLM({
                    taskContextId: contextId || taskId, // ✅ Используем переданный contextId или дефолтный taskId
                    systemPrompt: systemPromptWithExamples,
                    userPrompt,
                    submissionTool: buildSubmitCasesToolStrict(allowedForChunk, allowedScenarios, reqStructure),
                    modelOverrides: {
                        temperature: 0,
                        top_p: 1,
                        max_tokens: 10000  // ⚡ Оптимизировано: ~8-12 тест-кейсов (было 45000 = слишком много!)
                    }
                });

                let cases = extractCasesFromResponse(ai, existingCases);
                if (cases.length > 0) {
                    console.log(`[genForChunkOptimized] ✅ Получено ${cases.length} кейсов через tool_call`);

                    // 🔍 ПРОВЕРКА ДУБЛИКАТОВ ПО TITLE
                    const titles = cases.map(c => c.title);
                    const uniqueTitles = new Set(titles);
                    if (titles.length !== uniqueTitles.size) {
                        const duplicates = titles.filter((t, i) => titles.indexOf(t) !== i);
                        console.warn(`[genForChunkOptimized] ⚠️ НАЙДЕНЫ ДУБЛИКАТЫ! ${duplicates.length} повторяющихся title:`);
                        duplicates.slice(0, 5).forEach(t => console.warn(`   - "${t}"`));
                    } else {
                        console.log(`[genForChunkOptimized] ✅ Дубликатов по title нет`);
                    }

                    // 🔍 ПРОВЕРКА И ФИЛЬТРАЦИЯ ПО ЛИМИТУ
                    const e2eCases = cases.filter(tc => tc.layer === 'E2E Tests');
                    const integrationCases = cases.filter(tc => tc.layer?.includes('Integration'));
                    const totalLimit = 15; // Общий лимит: 1-2 E2E + 8-12 Integration = 10-15
                    const maxIntegration = 12; // Максимум Integration тестов
                    const maxE2E = 2; // Максимум E2E тестов
                    
                    // Фильтруем E2E (максимум 2)
                    const filteredE2E = e2eCases.slice(0, maxE2E);
                    if (e2eCases.length > maxE2E) {
                        console.warn(`[genForChunkOptimized] ⚠️ E2E тестов больше лимита (${e2eCases.length} > ${maxE2E}), оставляю первые ${maxE2E}`);
                    }
                    
                    // Фильтруем Integration по приоритетам (максимум 12)
                    let filteredIntegration = integrationCases;
                    if (integrationCases.length > maxIntegration) {
                        console.warn(`[genForChunkOptimized] ⚠️ ПРЕВЫШЕН ЛИМИТ Integration! Получено ${integrationCases.length} (ожидалось ≤${maxIntegration})`);
                        console.warn(`[genForChunkOptimized] 💡 Применяю фильтрацию по приоритетам...`);
                        
                        // Сортируем Integration тесты по приоритету:
                        // 1. Позитивные тесты (без слов "негатив", "ошибка", "невалид", "граничн" в title)
                        // 2. Негативные с параметризацией (есть examples)
                        // 3. Остальные негативные
                        const sortedIntegration = integrationCases.sort((a, b) => {
                            const aTitle = (a.title || '').toLowerCase();
                            const bTitle = (b.title || '').toLowerCase();
                            const aIsPositive = !aTitle.includes('негатив') && !aTitle.includes('ошибка') && !aTitle.includes('невалид') && !aTitle.includes('граничн');
                            const bIsPositive = !bTitle.includes('негатив') && !bTitle.includes('ошибка') && !bTitle.includes('невалид') && !bTitle.includes('граничн');
                            const aHasParams = Array.isArray(a.examples) && a.examples.length > 0;
                            const bHasParams = Array.isArray(b.examples) && b.examples.length > 0;
                            
                            if (aIsPositive && !bIsPositive) return -1;
                            if (!aIsPositive && bIsPositive) return 1;
                            if (aHasParams && !bHasParams) return -1;
                            if (!aHasParams && bHasParams) return 1;
                            return 0;
                        });
                        
                        filteredIntegration = sortedIntegration.slice(0, maxIntegration);
                        console.warn(`[genForChunkOptimized] ✅ Оставлено ${filteredIntegration.length} Integration тестов (приоритетные)`);
                    }
                    
                    // Объединяем и проверяем общий лимит
                    cases = [...filteredE2E, ...filteredIntegration];
                    if (cases.length > totalLimit) {
                        console.warn(`[genForChunkOptimized] ⚠️ Общий лимит превышен (${cases.length} > ${totalLimit}), обрезаю до ${totalLimit}`);
                        cases = cases.slice(0, totalLimit);
                    }
                    
                    if (e2eCases.length > maxE2E || integrationCases.length > maxIntegration || cases.length > totalLimit) {
                        console.warn(`[genForChunkOptimized] ✅ После фильтрации: ${filteredE2E.length} E2E + ${filteredIntegration.length} Integration = ${cases.length} тестов`);
                    }

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
                    { temperature: 0.3, max_tokens: 10000 }  // ⚡ Оптимизировано: ~8-12 тест-кейсов
                );

                cases = extractCasesFromResponse(retry, existingCases);
                if (cases.length > 0) {
                    console.log(`[genForChunkOptimized] ✅ Fallback: получено ${cases.length} кейсов`);

                    // 🔍 ПРОВЕРКА ДУБЛИКАТОВ ПО TITLE
                    const titles = cases.map(c => c.title);
                    const uniqueTitles = new Set(titles);
                    if (titles.length !== uniqueTitles.size) {
                        const duplicates = titles.filter((t, i) => titles.indexOf(t) !== i);
                        console.warn(`[genForChunkOptimized] ⚠️ НАЙДЕНЫ ДУБЛИКАТЫ! ${duplicates.length} повторяющихся title:`);
                        duplicates.slice(0, 5).forEach(t => console.warn(`   - "${t}"`));
                    }

                    // 🔍 ПРОВЕРКА И ФИЛЬТРАЦИЯ ПО ЛИМИТУ
                    const e2eCases = cases.filter(tc => tc.layer === 'E2E Tests');
                    const integrationCases = cases.filter(tc => tc.layer?.includes('Integration'));
                    const totalLimit = 15; // Общий лимит: 1-2 E2E + 8-12 Integration = 10-15
                    const maxIntegration = 12; // Максимум Integration тестов
                    const maxE2E = 2; // Максимум E2E тестов
                    
                    // Фильтруем E2E (максимум 2)
                    const filteredE2E = e2eCases.slice(0, maxE2E);
                    if (e2eCases.length > maxE2E) {
                        console.warn(`[genForChunkOptimized] ⚠️ E2E тестов больше лимита (${e2eCases.length} > ${maxE2E}), оставляю первые ${maxE2E}`);
                    }
                    
                    // Фильтруем Integration по приоритетам (максимум 12)
                    let filteredIntegration = integrationCases;
                    if (integrationCases.length > maxIntegration) {
                        console.warn(`[genForChunkOptimized] ⚠️ ПРЕВЫШЕН ЛИМИТ Integration! Получено ${integrationCases.length} (ожидалось ≤${maxIntegration})`);
                        console.warn(`[genForChunkOptimized] 💡 Применяю фильтрацию по приоритетам...`);
                        
                        // Сортируем Integration тесты по приоритету:
                        // 1. Позитивные тесты (без слов "негатив", "ошибка", "невалид", "граничн" в title)
                        // 2. Негативные с параметризацией (есть examples)
                        // 3. Остальные негативные
                        const sortedIntegration = integrationCases.sort((a, b) => {
                            const aTitle = (a.title || '').toLowerCase();
                            const bTitle = (b.title || '').toLowerCase();
                            const aIsPositive = !aTitle.includes('негатив') && !aTitle.includes('ошибка') && !aTitle.includes('невалид') && !aTitle.includes('граничн');
                            const bIsPositive = !bTitle.includes('негатив') && !bTitle.includes('ошибка') && !bTitle.includes('невалид') && !bTitle.includes('граничн');
                            const aHasParams = Array.isArray(a.examples) && a.examples.length > 0;
                            const bHasParams = Array.isArray(b.examples) && b.examples.length > 0;
                            
                            if (aIsPositive && !bIsPositive) return -1;
                            if (!aIsPositive && bIsPositive) return 1;
                            if (aHasParams && !bHasParams) return -1;
                            if (!aHasParams && bHasParams) return 1;
                            return 0;
                        });
                        
                        filteredIntegration = sortedIntegration.slice(0, maxIntegration);
                        console.warn(`[genForChunkOptimized] ✅ Оставлено ${filteredIntegration.length} Integration тестов (приоритетные)`);
                    }
                    
                    // Объединяем и проверяем общий лимит
                    cases = [...filteredE2E, ...filteredIntegration];
                    if (cases.length > totalLimit) {
                        console.warn(`[genForChunkOptimized] ⚠️ Общий лимит превышен (${cases.length} > ${totalLimit}), обрезаю до ${totalLimit}`);
                        cases = cases.slice(0, totalLimit);
                    }
                    
                    if (e2eCases.length > maxE2E || integrationCases.length > maxIntegration || cases.length > totalLimit) {
                        console.warn(`[genForChunkOptimized] ✅ После фильтрации: ${filteredE2E.length} E2E + ${filteredIntegration.length} Integration = ${cases.length} тестов`);
                    }

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
            const MAX_CHUNK_ATTEMPTS = 2;
            const CHUNK_RETRY_DELAY_MS = 2000;
            const failedChunks = [];

            // Обновляем progress после подготовки данных
            await db('generation_tasks').where('id', taskId).update({
                progress: 10,
                updated_at: new Date()
            });

            // ✅ НОВЫЙ ШАГ: Извлечение логики и ограничений из требований
            console.log(`[generate-test-cases-async] === Извлечение логики и ограничений ===`);
            let logicConstraints = null;
            try {
                const requirementsText = Array.isArray(refinedReqs) 
                    ? refinedReqs.join('\n\n') 
                    : (typeof refinedReqs === 'string' ? refinedReqs : '');
                
                if (requirementsText && requirementsText.trim().length > 100) {
                    logicConstraints = await extractLogicAndConstraints(requirementsText);
                    console.log(`[generate-test-cases-async] ✅ Извлечено ограничений: ${logicConstraints.validations.length} валидаций, ${logicConstraints.boundary_values.length} граничных значений, ${logicConstraints.negative_scenarios.length} негативных сценариев`);
                } else {
                    console.log(`[generate-test-cases-async] ⚠️ Требования слишком короткие для извлечения логики, пропускаем`);
                }
            } catch (error) {
                console.warn(`[generate-test-cases-async] ⚠️ Ошибка извлечения логики: ${error.message}, продолжаем без ограничений`);
            }

            // ✅ ONE-PASS: Генерируем E2E + Integration за один проход
            console.log(`[generate-test-cases-async] === ONE-PASS: Генерация E2E + Integration ===`);
            let allCases = [];
            const e2eTestsByStory = new Map(); // Для контекста в BATCH-режиме

            // ✅ АГРЕССИВНАЯ ОПТИМИЗАЦИЯ: Сброс контекста КАЖДЫЙ chunk для скорости
            let currentContextId = taskId;
            let previousFeature = null;

            for (let i = 0; i < storyChunks.length; i++) {
                const chunk = storyChunks[i];
                const storyText = chunk[0].stories[0].text;
                const currentFeature = chunk[0].text; // Feature name
                const mode = chunk[0].stories[0]._mode;
                const chunkProgress = 10 + Math.round((i / storyChunks.length) * 80);

                // ✅ Сбрасываем контекст КАЖДЫЙ chunk для максимальной скорости
                if (i > 0) {
                    currentContextId = `${taskId}-chunk-${i}`; // Новый contextId для каждого chunk
                    const resetReason = (previousFeature !== null && currentFeature !== previousFeature)
                        ? 'смена Feature'
                        : 'новый chunk';
                    console.log(`[generate-test-cases-async] 🔄 Сброс контекста: новый contextId="${currentContextId}" (причина: ${resetReason})`);
                }

                previousFeature = currentFeature;

                console.log(`[generate-test-cases-async] 🔄 Обработка Chunk ${i + 1}/${storyChunks.length}: "${storyText}" (${mode}) [contextId: ${currentContextId}]`);
                console.log(`[generate-test-cases-async] ⏱️ Прогресс: ${chunkProgress}%`);

                // Обновляем прогресс перед обработкой chunk
                await db('generation_tasks').where('id', taskId).update({
                    progress: chunkProgress,
                    updated_at: new Date()
                });

                // Для BATCH-режима используем контекст E2E из предыдущих FULL-чанков
                const existingE2E = mode === 'BATCH'
                    ? (e2eTestsByStory.get(storyText) || [])
                    : [];

                let chunkResult = null;
                let chunkElapsed = null;
                let attemptUsed = 0;

                for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt++) {
                    const attemptNumber = attempt + 1;
                    const chunkStartTime = Date.now();
                    console.log(`[generate-test-cases-async] 📤 Отправка запроса в LLM для chunk ${i + 1} (попытка ${attemptNumber}/${MAX_CHUNK_ATTEMPTS})...`);

                    try {
                        // ✅ Добавляем таймаут для генерации chunk (10 минут на chunk)
                        const CHUNK_TIMEOUT_MS = 10 * 60 * 1000;
                        const resultPromise = genForChunkOptimized(
                            chunk,
                            refinedReqs,
                            existingE2E,
                            modelStructure,
                            null, // reqStructure
                            currentContextId, // ✅ Передаём contextId для управления контекстом
                            allCases, // ✅ Передаём существующие тест-кейсы для проверки уникальности ID
                            logicConstraints, // ✅ Передаём извлеченные ограничения логики
                            false, // isNegativePass = false для первого прохода
                            includeBackendTests // ✅ Передаём флаг включения backend тестов
                        );

                        // Используем Promise.race для таймаута
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error(`Таймаут генерации chunk ${i + 1}: превышено ${CHUNK_TIMEOUT_MS / 1000 / 60} минут`)), CHUNK_TIMEOUT_MS);
                        });

                        chunkResult = await Promise.race([resultPromise, timeoutPromise]);
                        chunkElapsed = ((Date.now() - chunkStartTime) / 1000).toFixed(1);
                        attemptUsed = attemptNumber;
                        break;
                    } catch (err) {
                        console.error(`[generate-test-cases-async] ❌ Ошибка для chunk ${i + 1} (попытка ${attemptNumber}/${MAX_CHUNK_ATTEMPTS}):`, err.message || err);
                        console.error(`[generate-test-cases-async] ❌ Stack trace:`, err.stack);
                        if (attempt < MAX_CHUNK_ATTEMPTS - 1) {
                            console.warn(`[generate-test-cases-async] 🔁 Повторная попытка chunk ${i + 1} через ${CHUNK_RETRY_DELAY_MS / 1000}s...`);
                            await new Promise(resolve => setTimeout(resolve, CHUNK_RETRY_DELAY_MS));
                        } else {
                            failedChunks.push({ index: i + 1, story: storyText, mode, error: err.message || String(err) });
                        }
                    }
                }

                if (!chunkResult) {
                    continue;
                }

                const result = chunkResult;
                console.log(`[generate-test-cases-async] ✅ Chunk ${i + 1} завершен за ${chunkElapsed || '—'}s (попытка ${attemptUsed}/${MAX_CHUNK_ATTEMPTS})`);

                // Сохраняем E2E тесты для контекста
                const e2eFromResult = result.filter(tc => tc.layer === 'E2E Tests');
                if (e2eFromResult.length > 0) {
                    const existing = e2eTestsByStory.get(storyText) || [];
                    e2eTestsByStory.set(storyText, [...existing, ...e2eFromResult]);
                }

                allCases.push(...result);
                console.log(`[generate-test-cases-async] ✅ Chunk ${i + 1}: ${result.length} тестов (E2E: ${e2eFromResult.length}, Integration: ${result.length - e2eFromResult.length})`);

                // Обновляем прогресс после обработки chunk
                const nextProgress = 10 + Math.round(((i + 1) / storyChunks.length) * 80);
                await db('generation_tasks').where('id', taskId).update({
                    progress: nextProgress,
                    updated_at: new Date()
                });
                console.log(`[generate-test-cases-async] 📊 Прогресс обновлен: ${nextProgress}%`);
            }

            if (failedChunks.length > 0) {
                const summary = failedChunks.map(fc => `chunk ${fc.index} "${fc.story}" (${fc.mode}): ${fc.error}`).join('; ');
                throw new Error(`[generate-test-cases-async] Не удалось сгенерировать ${failedChunks.length} chunk(ов): ${summary}`);
            }

            console.log(`[generate-test-cases-async] ONE-PASS завершён: ${allCases.length} тестов`);

            // ✅ ФИЛЬТРАЦИЯ: Удаляем Integration backend тесты, если флаг выключен
            if (!includeBackendTests) {
                const beforeCount = allCases.length;
                allCases = allCases.filter(tc => tc.layer !== 'Integration backend Tests');
                const removedCount = beforeCount - allCases.length;
                if (removedCount > 0) {
                    console.log(`[generate-test-cases-async] 🚫 Удалено ${removedCount} Integration backend тестов (includeBackendTests=false)`);
                }
            }

            // ✅ ВТОРОЙ ПРОХОД: Генерация негативных и граничных тестов
            if (logicConstraints && (
                logicConstraints.validations.length > 0 ||
                logicConstraints.boundary_values.length > 0 ||
                logicConstraints.negative_scenarios.length > 0 ||
                logicConstraints.ui_logic.length > 0 ||
                logicConstraints.dependencies.length > 0
            )) {
                console.log(`[generate-test-cases-async] === ВТОРОЙ ПРОХОД: Генерация негативных и граничных тестов ===`);
                
                const negativeCases = [];
                for (let i = 0; i < storyChunks.length; i++) {
                    const chunk = storyChunks[i];
                    const storyText = chunk[0].stories[0].text;
                    const currentFeature = chunk[0].text;
                    const mode = chunk[0].stories[0]._mode;
                    
                    console.log(`[generate-test-cases-async] 🔄 Второй проход для Chunk ${i + 1}/${storyChunks.length}: "${storyText}"`);
                    
                    try {
                        const negativeResult = await genForChunkOptimized(
                            chunk,
                            refinedReqs,
                            [], // existingE2E - не нужны для негативных тестов
                            modelStructure,
                            null, // reqStructure
                            `${taskId}-negative-${i}`, // contextId для негативных тестов
                            allCases, // existingCases
                            logicConstraints, // logicConstraints
                            true, // isNegativePass = true
                            includeBackendTests // ✅ Передаём флаг включения backend тестов
                        );
                        
                        if (negativeResult && negativeResult.length > 0) {
                            negativeCases.push(...negativeResult);
                            console.log(`[generate-test-cases-async] ✅ Второй проход для Chunk ${i + 1}: ${negativeResult.length} негативных тестов`);
                        }
                    } catch (error) {
                        console.warn(`[generate-test-cases-async] ⚠️ Ошибка второго прохода для chunk ${i + 1}: ${error.message}`);
                        // Продолжаем без негативных тестов для этого chunk
                    }
                }
                
                if (negativeCases.length > 0) {
                    // ✅ ФИЛЬТРАЦИЯ: Удаляем Integration backend тесты из негативных, если флаг выключен
                    if (!includeBackendTests) {
                        const beforeCount = negativeCases.length;
                        negativeCases = negativeCases.filter(tc => tc.layer !== 'Integration backend Tests');
                        const removedCount = beforeCount - negativeCases.length;
                        if (removedCount > 0) {
                            console.log(`[generate-test-cases-async] 🚫 Удалено ${removedCount} Integration backend тестов из негативных (includeBackendTests=false)`);
                        }
                    }
                    
                    allCases.push(...negativeCases);
                    console.log(`[generate-test-cases-async] ✅ Второй проход завершён: добавлено ${negativeCases.length} негативных/граничных тестов`);
                } else {
                    console.log(`[generate-test-cases-async] ⚠️ Второй проход не сгенерировал тестов`);
                }
            } else {
                console.log(`[generate-test-cases-async] ⚠️ Нет ограничений логики для второго прохода, пропускаем`);
            }

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

        // ✅ НОВОЕ: LLM-валидация и автоисправление ВРАКОВ (итеративно)
        console.log(`[generate-test-cases-async] 🔍 LLM-валидация и автоисправление ВРАКОВ...`);
        try {
            const llmValidationResult = await validateUntilClean(
                finalTestCases,
                modelStructure,
                refinedReqs.join(''), // Объединяем все требования в одну строку
                2  // Макс. 2 итерации (быстро!)
            );
            finalTestCases = llmValidationResult.testCases;
            console.log(`[generate-test-cases-async] ✅ LLM исправил: ${llmValidationResult.totalFixedErrors} враков`);
        } catch (error) {
            console.error(`[generate-test-cases-async] ❌ Ошибка LLM-валидации враков:`, error.message);
            // Продолжаем без валидации враков
            console.warn(`[generate-test-cases-async] ⚠️ Продолжаем без исправления враков`);
        }

        // ✅ НОВОЕ: Автоматический PairWise для параметризованных тестов
        // ⚠️ ВАЖНО: Пропускаем в debug режиме (skipAllureAPICalls = true), т.к. это вызов Allure API
        if (!skipAllureAPICalls) {
            console.log(`[generate-test-cases-async] Проверяю параметризованные тесты для автоматической генерации PairWise...`);
            for (const testCase of finalTestCases) {
                if (testCase.parameters && testCase.parameters.length > 0 && (!testCase.examples || testCase.examples.length === 0)) {
                    console.log(`[generate-test-cases-async] Генерирую PairWise для "${testCase.title}"`);

                    try {
                        const pairwiseExamples = await generatePairwiseExamples(2, testCase.parameters); // ✅ 2 = pairwise
                        if (pairwiseExamples && pairwiseExamples.length > 0) {
                            testCase.examples = pairwiseExamples;
                            console.log(`[generate-test-cases-async] ✅ Сгенерировано ${pairwiseExamples.length} PairWise examples для "${testCase.title}"`);
                        }
                    } catch (error) {
                        console.error(`[generate-test-cases-async] Ошибка генерации PairWise для "${testCase.title}": ${error.message}`);
                    }
                }
            }
        } else {
            console.log(`[generate-test-cases-async] ⚠️ Пропускаю PairWise generation (debug режим, skipAllureAPICalls=true)`);
        }

        console.log(`[generate-test-cases-async] Generated ${finalTestCases.length} cases (after auto-parameterization)`);

        // ✅ НОВАЯ КОМПЛЕКСНАЯ ВАЛИДАЦИЯ КАЧЕСТВА С ПЕРЕГЕНЕРАЦИЕЙ
        console.log(`[generate-test-cases-async] === Запуск комплексной валидации качества ===`);
        await db('generation_tasks').where('id', taskId).update({
            progress: 91,
            updated_at: new Date()
        });

        const validationStartTime = Date.now();
        const VALIDATION_TIMEOUT_MS = 15 * 60 * 1000; // 15 минут на валидацию

        let validationResult;
        try {
            console.log(`[generate-test-cases-async] ⏱️ Запуск валидации (таймаут: ${VALIDATION_TIMEOUT_MS / 1000 / 60} минут)...`);
            const validationPromise = validateQualityDynamically(
                finalTestCases,
                modelStructure,
                refinedReqs,
                sharedStepsMap,
                baseSystemPrompt,
                baseCaseModelOptions
            );

            // Таймаут для валидации
            const validationTimeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Таймаут валидации: превышено ${VALIDATION_TIMEOUT_MS / 1000 / 60} минут`)), VALIDATION_TIMEOUT_MS);
            });

            validationResult = await Promise.race([validationPromise, validationTimeoutPromise]);
            const validationElapsed = ((Date.now() - validationStartTime) / 1000).toFixed(1);
            console.log(`[generate-test-cases-async] ✅ Валидация завершена за ${validationElapsed}s`);
        } catch (err) {
            console.error(`[generate-test-cases-async] ❌ Ошибка валидации:`, err.message || err);
            // Продолжаем без валидации, считаем все валидным
            validationResult = { valid: true, regenerationNeeded: false, regenerationTasks: [] };
        }

        // Если найдены проблемы, требующие перегенерации
        if (validationResult.regenerationNeeded) {
            console.log(`[generate-test-cases-async] ⚠️ Обнаружены проблемы, требующие исправления. Запуск перегенерации...`);
            await db('generation_tasks').where('id', taskId).update({
                progress: 93,
                updated_at: new Date()
            });

            const allowedForRegeneration = collectAllowedCodes(modelStructure);
            const allowedScenariosForRegeneration = collectAllowedScenarios(modelStructure);

            const REGENERATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 минут на регенерацию
            try {
                console.log(`[generate-test-cases-async] ⏱️ Запуск регенерации (таймаут: ${REGENERATION_TIMEOUT_MS / 1000 / 60} минут)...`);
                const regenerationPromise = regenerateTestCasesWithFixes(
                    finalTestCases,
                    validationResult,
                    modelStructure,
                    refinedReqs,
                    baseSystemPrompt,
                    baseCaseModelOptions,
                    allowedForRegeneration,
                    allowedScenariosForRegeneration,
                    buildSubmitCasesToolStrict,
                    runTestCaseLLM,
                    skipAllureAPICalls // ✅ Передаём флаг для debug режима
                );

                // Таймаут для регенерации
                const regenerationTimeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Таймаут регенерации: превышено ${REGENERATION_TIMEOUT_MS / 1000 / 60} минут`)), REGENERATION_TIMEOUT_MS);
                });

                finalTestCases = await Promise.race([regenerationPromise, regenerationTimeoutPromise]);
                console.log(`[generate-test-cases-async] ✅ Регенерация завершена`);
            } catch (err) {
                console.error(`[generate-test-cases-async] ❌ Ошибка регенерации:`, err.message || err);
                // Продолжаем с исходными тест-кейсами
            }

            // Повторная валидация после исправлений
            await db('generation_tasks').where('id', taskId).update({
                progress: 95,
                updated_at: new Date()
            });

            try {
                const reValidationResult = await validateQualityDynamically(
                    finalTestCases,
                    modelStructure,
                    refinedReqs,
                    sharedStepsMap,
                    baseSystemPrompt,
                    baseCaseModelOptions
                );

                if (reValidationResult.valid) {
                    console.log(`[generate-test-cases-async] ✅ Все проблемы исправлены после перегенерации!`);
                } else {
                    console.warn(`[generate-test-cases-async] ⚠️ Некоторые проблемы остались после перегенерации:`, reValidationResult.summary);
                }
            } catch (err) {
                console.error(`[generate-test-cases-async] ❌ Ошибка валидации после регенерации:`, err.message || err);
                // Продолжаем с исходными тест-кейсами
            }
        }

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

        // ✅ ИСПРАВЛЕНО: Используем исправленную функцию проверки покрытия
        const reqStringForModel = Array.isArray(refinedReqs) ? refinedReqs.join('\n\n') : refinedReqs;
        const requirementsCoverage = checkRequirementsCoverageFixed(finalTestCases, reqStringForModel, modelStructure);
        if (!requirementsCoverage) {
            console.error(`[generate-test-cases-async] checkRequirementsCoverageFixed вернула undefined`);
            throw new Error('checkRequirementsCoverageFixed вернула undefined');
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
                    // ✅ НОВОЕ: Pre-load всех чанков требований перед перегенерацией
                    let preloadedContext = '';
                    try {
                        const allSources = sourceRegistry.getSources();
                        console.log(`[generate-test-cases-async] 📦 Pre-load контекста: найдено ${allSources.length} источников`);

                        const contextChunks = [];
                        for (const source of allSources) {
                            if (source.content) {
                                // Если контент уже загружен, используем его
                                contextChunks.push(`\n---\n**${source.title || source.id}**\n${source.content}`);
                            } else if (source.pageId && contextFetcher) {
                                // Если есть pageId и fetcher, загружаем контент
                                try {
                                    const content = await contextFetcher(source.pageId);
                                    if (content) {
                                        contextChunks.push(`\n---\n**${source.title || source.id}**\n${content}`);
                                    }
                                } catch (err) {
                                    console.warn(`[generate-test-cases-async] ⚠️ Не удалось загрузить контент для ${source.id}:`, err.message);
                                }
                            }
                        }

                        if (contextChunks.length > 0) {
                            preloadedContext = `\n\n═══════════════════════════════════════════════════════════════\n📚 ПОЛНЫЙ КОНТЕКСТ ТРЕБОВАНИЙ (УЖЕ ЗАГРУЖЕН)\n═══════════════════════════════════════════════════════════════\n${contextChunks.join('\n')}\n═══════════════════════════════════════════════════════════════\n`;
                            console.log(`[generate-test-cases-async] ✅ Pre-loaded ${contextChunks.length} чанков контекста`);
                        }
                    } catch (preloadError) {
                        console.warn(`[generate-test-cases-async] ⚠️ Ошибка pre-load контекста:`, preloadError.message);
                    }

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

${preloadedContext ? `\n${preloadedContext}\n\n🚨 ВАЖНО: Контекст УЖЕ ЗАГРУЖЕН выше, НЕ запрашивай fetch_context_chunk! Используй только предоставленный контекст.\n` : ''}

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
                                        max_tokens: 45000,  // ✅ Безопасное значение для MiniMax-M2
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

        // ✅ КРИТИЧЕСКИ ВАЖНО: Проверка идентичности оригинальной модели входа и выхода
        console.log(`[generate-test-cases-async] === Проверка идентичности модели ===`);

        // ✅ ПРОВЕРКА: Сравниваем originalModel (сохраненную в начале) с extractedModel (входящей моделью)
        // Используем глубокое сравнение через JSON.stringify (без регулярок и статических проверок)
        // Это гарантирует, что модель не изменилась в процессе генерации
        function deepEqual(obj1, obj2) {
            return JSON.stringify(obj1) === JSON.stringify(obj2);
        }

        // ✅ Проверяем, что оригинальная модель не изменилась относительно входящей
        const isModelIdentical = deepEqual(originalModel, extractedModel);
        if (!isModelIdentical) {
            console.error(`[generate-test-cases-async] ❌ КРИТИЧЕСКАЯ ОШИБКА: Оригинальная модель изменилась в процессе генерации!`);
            console.error(`[generate-test-cases-async] ❌ Это недопустимо! Модель должна оставаться ТОЧНО такой же, как на входе!`);
            throw new Error('Модель была изменена в процессе генерации тест-кейсов. Это недопустимо!');
        }

        // ✅ Дополнительная проверка: убеждаемся, что originalModel не была модифицирована
        // Создаем новый хэш для финальной проверки
        const finalModelHash = JSON.stringify(originalModel);
        const originalModelHash = JSON.stringify(extractedModel);

        if (finalModelHash !== originalModelHash) {
            console.error(`[generate-test-cases-async] ❌ КРИТИЧЕСКАЯ ОШИБКА: Хэш модели изменился!`);
            console.error(`[generate-test-cases-async] ❌ Входящий размер: ${originalModelHash.length} символов`);
            console.error(`[generate-test-cases-async] ❌ Финальный размер: ${finalModelHash.length} символов`);
            throw new Error('Модель была изменена в процессе генерации тест-кейсов (проверка по хэшу). Это недопустимо!');
        }

        console.log(`[generate-test-cases-async] ✅ Модель проверена: идентичность сохранена (размер: ${originalModelHash.length} символов)`);
        console.log(`[generate-test-cases-async] ✅ Оригинальная модель будет возвращена в ответе БЕЗ изменений`);

        // Обновляем progress перед финальным сохранением
        await db('generation_tasks').where('id', taskId).update({
            progress: 95,
            updated_at: new Date()
        });

        // ✅ КРИТИЧЕСКАЯ ПРОВЕРКА: Убеждаемся что originalModel не изменилась перед сохранением
        // Используем ту же функцию нормализации для сравнения (normalizeModelForComparison объявлена выше)
        const finalOriginalModelJson = JSON.stringify(normalizeModelForComparison(originalModel));
        const finalOriginalModelChecksum = finalOriginalModelJson.length;
        const finalOriginalModelHashPreview = finalOriginalModelJson.substring(0, 1000);

        // ✅ ГЛУБОКАЯ ПРОВЕРКА: Сравниваем полный JSON, а не только размер
        if (originalModelJson !== finalOriginalModelJson) {
            console.error(`[generate-test-cases-async] ❌ КРИТИЧЕСКАЯ ОШИБКА: Оригинальная модель была изменена!`);
            console.error(`  Исходный размер: ${originalModelChecksum} символов, хеш: ${originalModelHashPreview.substring(0, 50)}...`);
            console.error(`  Финальный размер: ${finalOriginalModelChecksum} символов, хеш: ${finalOriginalModelHashPreview.substring(0, 50)}...`);

            // Дополнительная диагностика: находим различия
            if (originalModelChecksum === finalOriginalModelChecksum) {
                console.error(`[generate-test-cases-async] ⚠️ Размер совпадает, но содержимое разное - возможно изменён порядок полей или значения`);
            } else {
                console.error(`[generate-test-cases-async] ⚠️ Размер изменился: ${Math.abs(finalOriginalModelChecksum - originalModelChecksum)} символов`);
            }

            throw new Error('КРИТИЧЕСКАЯ ОШИБКА: Модель была изменена в процессе генерации! Модель должна оставаться неизменной!');
        }

        // ✅ ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Сравниваем структуру оригинальной модели с входящей
        const inputModelJson = JSON.stringify(normalizeModelForComparison(extractedModel));
        const inputModelChecksum = inputModelJson.length;

        if (originalModelJson !== inputModelJson) {
            console.error(`[generate-test-cases-async] ❌ КРИТИЧЕСКАЯ ОШИБКА: Оригинальная модель отличается от входящей!`);
            console.error(`  Входящая модель: ${inputModelChecksum} символов`);
            console.error(`  Оригинальная модель: ${originalModelChecksum} символов`);

            // Дополнительная диагностика
            if (originalModelChecksum === inputModelChecksum) {
                console.error(`[generate-test-cases-async] ⚠️ Размер совпадает, но содержимое разное - возможно изменён порядок полей или значения при копировании`);
            }

            throw new Error('КРИТИЧЕСКАЯ ОШИБКА: Модель была изменена при копировании! Модель должна оставаться неизменной!');
        }

        console.log(`[generate-test-cases-async] ✅ ПРОВЕРКА ПРОЙДЕНА: Модель не изменилась (размер: ${originalModelChecksum} символов, структура идентична)`);

        // ✅ КРИТИЧЕСКИ ВАЖНО: Сохраняем оригинальную модель в result вместе с тест-кейсами
        // Модель возвращается ТОЧНО такой же, как была на входе (без изменений)
        await db('generation_tasks').where('id', taskId).update({
            status: 'completed',
            progress: 100,
            result: {
                testCases: finalTestCases,
                testModel: originalModel  // ✅ Возвращаем ОРИГИНАЛЬНУЮ модель БЕЗ изменений
            },
            completed_at: new Date(),
            updated_at: new Date()
        });

        console.log(`[generate-test-cases-async] ✅ Результат сохранен: ${finalTestCases.length} тест-кейсов + оригинальная модель (${originalModel.length} Feature(s), размер: ${originalModelChecksum} символов JSON)`);
        console.log(`[generate-test-cases-async] ✅ ПРОВЕРКА: Модель в ответе идентична входящей модели (без изменений)`);

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
        console.log(`[generate-test-cases-async] 📦 Получен запрос на генерацию тест-кейсов`);
        console.log(`[generate-test-cases-async] 📋 modelStructure в запросе:`, req.body.modelStructure ? `type=${typeof req.body.modelStructure}, isArray=${Array.isArray(req.body.modelStructure)}` : 'ОТСУТСТВУЕТ');
        console.log(`[generate-test-cases-async] 📋 testModelId в запросе:`, req.body.testModelId || 'ОТСУТСТВУЕТ');

        // ❌ ОТКЛЮЧЕНО: Загрузка старой модели из БД по testModelId
        // Теперь используем ТОЛЬКО новую модель, переданную с фронтенда в req.body.modelStructure
        // Загрузка старой модели из БД может привести к использованию устаревших данных
        if (req.body.testModelId) {
            console.log(`[generate-test-cases-async] ℹ️ testModelId=${req.body.testModelId} передан, но ИГНОРИРУЕТСЯ - используем только новую модель с фронтенда`);
            console.log(`[generate-test-cases-async] ⚠️ ВАЖНО: Загрузка старой модели из БД отключена для предотвращения использования устаревших данных`);
        }

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

        // ✅ Запускаем генерацию с таймаутом и обработкой зависаний
        const MAX_TIMEOUT_MS = 300 * 60 * 1000; // 30 минут максимум
        const startTime = Date.now();

        // Функция для проверки таймаута
        const checkTimeout = async () => {
            const elapsed = Date.now() - startTime;
            if (elapsed > MAX_TIMEOUT_MS) {
                console.error(`[generate-test-cases-async] ⏱️ Таймаут генерации для taskId=${taskId}: ${elapsed}ms > ${MAX_TIMEOUT_MS}ms`);
                await db('generation_tasks').where('id', taskId).update({
                    status: 'failed',
                    error_message: `Таймаут генерации: превышено максимальное время выполнения (${MAX_TIMEOUT_MS / 1000 / 60} минут)`,
                    updated_at: new Date()
                });
                return true;
            }
            return false;
        };

        // Запускаем генерацию с обработкой ошибок и таймаутом
        generateTestCasesAsync(taskId, req.body).catch(async (error) => {
            console.error(`[generate-test-cases-async] ❌ Необработанная ошибка в generateTestCasesAsync для taskId=${taskId}:`, error);
            await db('generation_tasks').where('id', taskId).update({
                status: 'failed',
                error_message: error.message || 'Неизвестная ошибка при генерации',
                updated_at: new Date()
            });
        });

        // Периодически проверяем таймаут (каждые 5 минут)
        const timeoutCheckInterval = setInterval(async () => {
            const task = await db('generation_tasks').where('id', taskId).first();
            if (!task || task.status !== 'processing') {
                clearInterval(timeoutCheckInterval);
                return;
            }

            if (await checkTimeout()) {
                clearInterval(timeoutCheckInterval);
            } else {
                // Обновляем updated_at, чтобы показать, что задача еще активна
                await db('generation_tasks').where('id', taskId).update({
                    updated_at: new Date()
                });
            }
        }, 5 * 60 * 1000); // Каждые 5 минут

        // Очищаем интервал через MAX_TIMEOUT_MS
        setTimeout(() => clearInterval(timeoutCheckInterval), MAX_TIMEOUT_MS);

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
        const nocache = req.query.nocache; // ✅ Параметр для принудительной очистки кэша

        // ✅ КЭШ ТОЛЬКО ДЛЯ СТАТУСА: Кэш используется ТОЛЬКО для уменьшения нагрузки на БД при частых запросах статуса
        // Это НЕ означает использование старых тест-кейсов для генерации!
        // Генерация тест-кейсов всегда происходит с нуля, используя только новую модель с фронтенда
        // Кэш здесь - это просто оптимизация для возврата статуса задачи клиенту
        // ✅ ВАЖНО: Если передан параметр ?nocache, принудительно очищаем кэш для этой задачи
        if (nocache) {
            taskStatusCache.delete(cacheKey);
            console.log(`[generate-test-cases-status] 🔄 Принудительная очистка кэша для taskId=${taskId} (nocache=${nocache})`);
        }

        const cached = taskStatusCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5000 && !nocache) {
            console.log(`[generate-test-cases-status] ✅ Возвращаем статус из кэша (только для отображения, НЕ для генерации): taskId=${taskId}`);
            return res.json(cached.data);
        }

        const task = await db('generation_tasks').where('id', taskId).first();

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // ✅ ЛОГИРОВАНИЕ: Проверяем, не возвращаем ли старый результат
        // ⚠️ ВАЖНО: task.result используется ТОЛЬКО для возврата клиенту, НЕ для генерации новых тест-кейсов!
        // При генерации тест-кейсов старые данные из БД НЕ используются - генерация всегда происходит с нуля
        if (task.status === 'completed' && task.result) {
            console.log(`[generate-test-cases-status] 📋 Задача ${taskId} уже завершена, возвращаем результат из БД (только для отображения, НЕ для генерации)`);
            console.log(`[generate-test-cases-status] 📅 Дата создания: ${task.created_at}`);
            console.log(`[generate-test-cases-status] 📅 Дата завершения: ${task.completed_at}`);
            console.log(`[generate-test-cases-status] 📊 Количество тест-кейсов в результате: ${task.result.testCases?.length || 0}`);

            // Проверяем, не слишком ли старый результат
            const completedAt = new Date(task.completed_at);
            const now = new Date();
            const ageMinutes = (now - completedAt) / (1000 * 60);
            if (ageMinutes > 5) {
                console.warn(`[generate-test-cases-status] ⚠️ ВНИМАНИЕ: Результат старше ${Math.round(ageMinutes)} минут! Возможно, это старый результат!`);
            }
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
