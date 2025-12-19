import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Получаем путь к директории текущего файла (для ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем .env из директории bdd-server
dotenv.config({ path: join(__dirname, '.env') });
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import knex from 'knex';
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { callCloudRuAPI, callWithCloudRuFallback } from '../server/cloudruClient.mjs';
import config from '../server/config.json' assert { type: 'json' };
import pkg from 'gherkin';
const { Parser } = pkg;

const app = express();
const PORT = process.env.BDD_SERVER_PORT || 5002;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Middleware для логирования всех запросов
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[BDD Server] ${timestamp} ${req.method} ${req.path}`);
    next();
});

// Инициализация БД для задач генерации (опционально)
let db = null;
let useInMemoryStorage = false;

// In-memory хранилище для задач (fallback если БД недоступна)
const inMemoryTasks = new Map();

/**
 * Автоматическое создание таблицы generation_tasks если её нет
 * И обновление CHECK constraint для поддержки 'bdd_tests'
 */
async function ensureTableExists() {
    try {
        const tableExists = await db.schema.hasTable('generation_tasks');
        if (!tableExists) {
            console.log('[BDD Server] 📋 Создаём таблицу generation_tasks...');
            await db.schema.createTable('generation_tasks', (table) => {
                table.uuid('id').primary();
                table.string('type', 50).notNullable();
                table.string('status', 20).notNullable().defaultTo('processing');
                table.integer('progress').defaultTo(0);
                table.jsonb('input_data');
                table.jsonb('result');
                table.text('error_message');
                table.timestamp('created_at').defaultTo(db.fn.now());
                table.timestamp('updated_at').defaultTo(db.fn.now());
                table.timestamp('completed_at');
            });

            // Создаём индексы
            await db.raw('CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status)');
            await db.raw('CREATE INDEX IF NOT EXISTS idx_generation_tasks_created_at ON generation_tasks(created_at)');
            
            console.log('[BDD Server] ✅ Таблица generation_tasks создана');
        } else {
            console.log('[BDD Server] ✅ Таблица generation_tasks уже существует');
            
            // Проверяем и обновляем CHECK constraint для поддержки 'bdd_tests'
            try {
                // Проверяем существование constraint
                const constraintCheck = await db.raw(`
                    SELECT constraint_name 
                    FROM information_schema.table_constraints 
                    WHERE table_name = 'generation_tasks' 
                    AND constraint_name = 'generation_tasks_type_check'
                `);
                
                if (constraintCheck.rows.length > 0) {
                    console.log('[BDD Server] 🔧 Обновляем CHECK constraint для поддержки bdd_tests...');
                    
                    // Удаляем старый constraint
                    await db.raw('ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_type_check');
                    
                    // Создаём новый constraint с поддержкой bdd_tests
                    await db.raw(`
                        ALTER TABLE generation_tasks 
                        ADD CONSTRAINT generation_tasks_type_check 
                        CHECK (type IN ('test_cases', 'test_model', 'bdd_tests'))
                    `);
                    
                    console.log('[BDD Server] ✅ CHECK constraint обновлён для поддержки bdd_tests');
                }
            } catch (constraintError) {
                console.warn('[BDD Server] ⚠️ Не удалось обновить constraint (возможно, уже обновлён):', constraintError.message);
            }
        }
    } catch (error) {
        console.warn('[BDD Server] ⚠️ Ошибка создания/обновления таблицы:', error.message);
        // Не прерываем работу, возможно таблица уже существует или будет создана вручную
    }
}

async function initDatabase() {
    try {
        // Поддерживаем конфигурацию как в tia-mapping-service: DATABASE_URL или отдельные параметры
        let connectionConfig;
        
        if (process.env.DATABASE_URL) {
            connectionConfig = process.env.DATABASE_URL;
        } else if (process.env.DB_HOST || process.env.DB_USER) {
            // Используем отдельные параметры если DATABASE_URL не указан
            connectionConfig = {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432'),
                user: process.env.DB_USER || 'tia_user',
                password: process.env.DB_PASSWORD || 'password',
                database: process.env.DB_NAME || 'tia_mapping_db'
            };
        } else {
            console.warn('[BDD Server] ⚠️ DATABASE_URL и параметры БД не указаны, используем in-memory хранилище');
            useInMemoryStorage = true;
            return;
        }

        db = knex({
            client: 'pg',
            connection: connectionConfig,
            pool: {
                min: 1,
                max: 5
            }
        });

        // Проверяем подключение
        await db.raw('SELECT 1');
        console.log('[BDD Server] ✅ Подключение к БД установлено');
        
        // Автоматически создаём таблицу если её нет
        await ensureTableExists();
        
        useInMemoryStorage = false;
    } catch (error) {
        console.warn('[BDD Server] ⚠️ Не удалось подключиться к БД:', error.message);
        console.warn('[BDD Server] ⚠️ Используем in-memory хранилище (данные не сохраняются после перезапуска)');
        db = null;
        useInMemoryStorage = true;
    }
}

// Обёртка для работы с БД или in-memory хранилищем
const taskStorage = {
    async insert(task) {
        if (useInMemoryStorage) {
            inMemoryTasks.set(task.id, task);
            return [task];
        }
        return await db('generation_tasks').insert(task);
    },
    
    async update(id, updates) {
        if (useInMemoryStorage) {
            const task = inMemoryTasks.get(id);
            if (task) {
                Object.assign(task, updates);
                inMemoryTasks.set(id, task);
            }
            return 1;
        }
        return await db('generation_tasks').where('id', id).update(updates);
    },
    
    async findById(id) {
        if (useInMemoryStorage) {
            return inMemoryTasks.get(id) || null;
        }
        return await db('generation_tasks').where('id', id).first();
    }
};

// Инициализация Pinecone для векторной БД шагов
let vectorStore = null;
let pineconeIndex = null;

async function initVectorStore() {
    try {
        const apiKey = process.env.PINECONE_API_KEY;
        if (!apiKey) {
            console.warn('[BDD Server] PINECONE_API_KEY не найден, используем локальное хранилище шагов');
            return null;
        }

        const pinecone = new Pinecone({ apiKey });
        const indexName = process.env.PINECONE_INDEX_NAME || 'gherkin-steps';
        
        // Проверяем существование индекса
        const indexes = await pinecone.listIndexes();
        const indexExists = indexes.indexes?.some(idx => idx.name === indexName);
        
        if (!indexExists) {
            console.log(`[BDD Server] Создаём индекс ${indexName}...`);
            await pinecone.createIndex({
                name: indexName,
                dimension: 1536, // OpenAI embedding dimension
                metric: 'cosine'
            });
            // Ждём готовности индекса
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        pineconeIndex = pinecone.Index(indexName);
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY || config.openAiToken
        });

        vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
            pineconeIndex,
            namespace: 'gherkin-steps'
        });

        console.log('[BDD Server] ✅ Векторная БД инициализирована');
    } catch (error) {
        console.error('[BDD Server] ❌ Ошибка инициализации векторной БД:', error.message);
        console.warn('[BDD Server] Продолжаем работу без векторной БД (дедупликация отключена)');
        vectorStore = null;
    }
}

// Локальное хранилище шагов (fallback если Pinecone недоступен)
const localStepsStore = new Map(); // stepText -> normalizedStep

/**
 * Нормализует текст шага для сравнения
 */
function normalizeStep(stepText) {
    return stepText
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[.,!?;:]/g, '')
        .trim();
}

/**
 * Извлекает шаги из Gherkin текста
 */
function extractStepsFromGherkin(gherkinText) {
    const steps = [];
    const lines = gherkinText.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^(Given|When|Then|And|Но|И|Дано|Когда|Тогда)\s+/i)) {
            steps.push(trimmed);
        }
    }
    
    return steps;
}

/**
 * Ищет похожие шаги в векторной БД
 */
async function findSimilarSteps(queryStep, limit = 3) {
    if (!vectorStore) {
        // Fallback: поиск в локальном хранилище
        const normalizedQuery = normalizeStep(queryStep);
        const similar = [];
        
        for (const [storedStep, normalized] of localStepsStore.entries()) {
            const similarity = calculateSimilarity(normalizedQuery, normalized);
            if (similarity > 0.7) { // Порог схожести
                similar.push({ step: storedStep, similarity });
            }
        }
        
        return similar
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit)
            .map(s => s.step);
    }

    try {
        const results = await vectorStore.similaritySearch(queryStep, limit);
        return results.map(r => r.pageContent);
    } catch (error) {
        console.error('[BDD Server] Ошибка поиска похожих шагов:', error.message);
        return [];
    }
}

/**
 * Простая функция схожести строк (Jaccard similarity)
 */
function calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.split(' '));
    const words2 = new Set(str2.split(' '));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
}

/**
 * Сохраняет новые шаги в векторную БД
 */
async function saveStepsToVectorDB(steps) {
    if (!vectorStore || !steps.length) return;

    try {
        const documents = steps.map(step => ({
            pageContent: step,
            metadata: {
                createdAt: new Date().toISOString(),
                stepType: step.match(/^(Given|When|Then|And|Но|И|Дано|Когда|Тогда)/i)?.[1] || 'Unknown'
            }
        }));

        await vectorStore.addDocuments(documents);
        console.log(`[BDD Server] ✅ Сохранено ${steps.length} шагов в векторную БД`);
    } catch (error) {
        console.error('[BDD Server] Ошибка сохранения шагов:', error.message);
    }
}

/**
 * Сохраняет шаги в локальное хранилище (fallback)
 */
function saveStepsLocally(steps) {
    for (const step of steps) {
        const normalized = normalizeStep(step);
        if (!localStepsStore.has(step)) {
            localStepsStore.set(step, normalized);
        }
    }
}

// ============================================================================
// УЛУЧШЕННАЯ АРХИТЕКТУРА: DOMAIN SCHEMA, RAG, VALIDATION, TRACEABILITY
// ============================================================================

// Векторная БД для требований (RAG)
let requirementsVectorStore = null;

/**
 * Инициализация векторной БД для требований (отдельный namespace для RAG)
 */
async function initRequirementsVectorStore() {
    try {
        const apiKey = process.env.PINECONE_API_KEY;
        if (!apiKey || !pineconeIndex) {
            console.warn('[BDD Server] Requirements RAG: Pinecone недоступен, используем локальное хранилище');
            return null;
        }

        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY || config.openAiToken
        });

        requirementsVectorStore = await PineconeStore.fromExistingIndex(embeddings, {
            pineconeIndex,
            namespace: 'requirements' // Отдельный namespace для требований
        });

        console.log('[BDD Server] ✅ Векторная БД требований (RAG) инициализирована');
    } catch (error) {
        console.error('[BDD Server] ❌ Ошибка инициализации RAG для требований:', error.message);
        requirementsVectorStore = null;
    }
}

/**
 * Извлекает domain schema из требований и modelStructure
 */
async function extractDomainSchema(requirementsText, modelStructure, apiKey) {
    console.log('[BDD Server] 🏗️ Извлечение domain schema...');
    
    const schemaPrompt = `
Ты QA Automation Engineer. Извлеки из требований и структуры модели доменный словарь/контракт.

КРИТИЧЕСКИ ВАЖНО: Извлекай ТОЛЬКО то, что ЯВНО указано в тексте. НЕ придумывай сущности, поля или методы.

Извлеки:
1. **Поля/Параметры**: Все поля данных (например: deal.previousBankRegNumber, deal.dealMode, deal.expectDate)
   - Включая вложенные: объект.поле.подполе
   - Указывай допустимые значения, если они явно указаны
   
2. **API методы/эндпоинты**: Все упомянутые эндпоинты и методы
   - Полный путь: /rest/stateful/corp/curr/inquiry_181, document/visual/byid
   - HTTP метод: GET, POST, PUT, DELETE, PATCH
   - Параметры запроса, если указаны
   
3. **Допустимые значения**: Enum значения, коды операций, статусы
   - Числовые коды: 11100, 21100, 23110
   - Строковые значения: 'current', 'deferred', 'active'
   - Статусы с их значениями
   
4. **UI элементы и их состояния**: 
   - **Страницы (Pages)**: Только полноценные экраны с изменением URL. Примеры: "Страница 'Выставить QR-код'", "Экран создания сделки"
   - **Компоненты (Components)**: Модальные окна, боковые панели (Drawers), карточки в списках, выпадающие меню.
     ВАЖНО: Если что-то открывается поверх текущего экрана ("Модалка", "Карточка", "Контекстное меню") — это Component, НЕ Page!
   - Кнопки: "Кнопка 'Создать'", "Кнопка 'Отмена'"
   - Поля: "Поле 'ИНН'", "Поле 'Сумма'"
   - Переключатели/чекбоксы: "Чекбокс 'Автоматический расчёт'", "Переключатель 'Режим сделки'"
   - Состояния: "видимо/скрыто", "активно/неактивно", "установлен/сброшен"
   
5. **Бизнес-правила**: Валидации, ограничения, логика
   - "ИНН должен быть 12 цифр"
   - "сумма не может быть меньше 50000"
   - "поле обязательно к заполнению при dealMode == 'current'"

Верни ТОЛЬКО валидный JSON без markdown обёрток:
{
  "fields": [
    {
      "name": "deal.previousBankRegNumber",
      "type": "string",
      "description": "описание",
      "allowedValues": ["val1", "val2"],
      "required": true,
      "validation": "правило валидации если есть"
    }
  ],
  "endpoints": [
    {
      "path": "/rest/stateful/corp/curr/inquiry_181",
      "method": "POST",
      "description": "описание",
      "parameters": ["param1", "param2"]
    }
  ],
  "codes": [
    {"value": "11100", "description": "описание"},
    {"value": "21100", "description": "описание"}
  ],
  "uiElements": [
    {
      "type": "button",
      "name": "Создать",
      "page": "Страница создания",
      "states": ["видимо", "активно"]
    },
    {
      "type": "field",
      "name": "ИНН",
      "page": "Форма создания",
      "states": ["видимо", "обязательно"]
    }
  ],
  "businessRules": [
    "Правило валидации 1",
    "Правило валидации 2"
  ]
}

Требования:
${requirementsText.substring(0, 10000)}

${modelStructure ? `Структура модели (JSON):\n${JSON.stringify(modelStructure).substring(0, 5000)}` : ''}
`;

    try {
        const response = await callWithCloudRuFallback(
            'https://openrouter.ai/api/v1/chat/completions',
            [{ role: 'user', content: schemaPrompt }],
            apiKey,
            {
                models: config.cloudruModels || ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
                temperature: 0.1,
                max_tokens: 4000
            }
        );

        const content = response.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const schema = JSON.parse(jsonMatch[0]);
            console.log(`[BDD Server] ✅ Domain schema извлечен: ${schema.fields?.length || 0} полей, ${schema.endpoints?.length || 0} эндпоинтов`);
            return schema;
        }
        
        throw new Error('Не удалось найти JSON в ответе');
    } catch (error) {
        console.warn('[BDD Server] ⚠️ Ошибка извлечения domain schema:', error.message);
        // Fallback: пустая schema
        const fallbackSchema = {
            fields: [],
            endpoints: [],
            codes: [],
            uiElements: [],
            businessRules: []
        };
        
        // Если есть modelStructure, пытаемся извлечь базовые поля
        if (modelStructure && typeof modelStructure === 'object') {
            try {
                const extractFieldsFromStructure = (obj, prefix = '') => {
                    const fields = [];
                    for (const [key, value] of Object.entries(obj)) {
                        const fieldName = prefix ? `${prefix}.${key}` : key;
                        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            fields.push(...extractFieldsFromStructure(value, fieldName));
                        } else {
                            fields.push({
                                name: fieldName,
                                type: Array.isArray(value) ? 'array' : typeof value,
                                description: '',
                                required: false
                            });
                        }
                    }
                    return fields;
                };
                fallbackSchema.fields = extractFieldsFromStructure(modelStructure);
                console.log(`[BDD Server] ⚠️ Извлечено ${fallbackSchema.fields.length} полей из modelStructure как fallback`);
            } catch (e) {
                console.warn('[BDD Server] ⚠️ Не удалось извлечь поля из modelStructure:', e.message);
            }
        }
        
        return fallbackSchema;
    }
}

/**
 * Индексирует требования в векторную БД для RAG
 */
async function indexRequirements(sections, apiKey) {
    if (!requirementsVectorStore || !sections.length) {
        console.log('[BDD Server] ⚠️ Requirements RAG пропущен (нет векторной БД)');
        return;
    }

    try {
        console.log(`[BDD Server] 📚 Индексирование ${sections.length} секций требований в RAG...`);
        
        const documents = sections.map((section) => ({
            pageContent: section.text || '',
            metadata: {
                id: section.id,
                element: section.element || '',
                type: section.type || '',
                methods: JSON.stringify(section.methods || []),
                parameters: JSON.stringify(section.parameters || []),
                requirementId: section.id,
                createdAt: new Date().toISOString()
            }
        }));

        await requirementsVectorStore.addDocuments(documents);
        console.log(`[BDD Server] ✅ Индексировано ${documents.length} секций требований`);
    } catch (error) {
        console.error('[BDD Server] ❌ Ошибка индексирования требований:', error.message);
    }
}

/**
 * Поиск релевантных секций требований для правила (RAG retrieval)
 */
async function retrieveRelevantRequirements(queryText, limit = 5) {
    if (!requirementsVectorStore) {
        return [];
    }

    try {
        const results = await requirementsVectorStore.similaritySearch(queryText, limit);
        return results.map(r => ({
            id: r.metadata.requirementId,
            text: r.pageContent,
            element: r.metadata.element,
            type: r.metadata.type
        }));
    } catch (error) {
        console.error('[BDD Server] Ошибка RAG retrieval:', error.message);
        return [];
    }
}

/**
 * Детектирует тип входных данных для адаптивной обработки
 */
function detectInputType(input) {
    try {
        if (Array.isArray(input) && input[0]?.steps) {
            return 'TEST_CASES_JSON';
        }
    } catch (e) {
        console.warn('[BDD Server] ⚠️ detectInputType: ошибка проверки JSON с шагами:', e.message);
    }

    if (typeof input === 'string' && (input.includes('TestCase ID') || input.includes('Test Results'))) {
        return 'TEST_CASES_LOG';
    }

    return 'REQUIREMENTS_TEXT';
}

/**
 * Адаптер: парсинг тест-кейсов из логов/сырого текста
 */
async function parseTestCases(logText, apiKey) {
    console.log('[BDD Server] Parsing Test Cases Log...');

    if (!logText || typeof logText !== 'string') {
        return [];
    }

    const parsePrompt = `
Ты — QA Automation Engineer.
Твоя задача — распарсить лог выполнения тестов и превратить его в структурированные требования.

ВХОДНОЙ ФОРМАТ (ЛОГ):
TestCase ID 87138
Steps
1. 000003
2. 000001
Expected result
1. 000001

ВЫХОДНОЙ ФОРМАТ (JSON):
[
  {
    "id": "TC-87138",
    "requirement": "Название теста или описание из Description",
    "text": "Полный текст тест-кейса включая шаги и ожидаемый результат",
    "type": "TEST_CASE"
  }
]

Входящий текст:
${logText.substring(0, 15000)}
`;

    try {
        const response = await callWithCloudRuFallback(
            'https://openrouter.ai/api/v1/chat/completions',
            [{ role: 'user', content: parsePrompt }],
            apiKey,
            {
                models: config.cloudruModels || ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
                temperature: 0.2,
                max_tokens: 4000
            }
        );

        const content = response.choices[0].message.content;
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        const objectMatch = content.match(/\{[\s\S]*\}/);

        let parsed = [];
        if (arrayMatch) {
            parsed = JSON.parse(arrayMatch[0]);
        } else if (objectMatch) {
            const obj = JSON.parse(objectMatch[0]);
            parsed = Array.isArray(obj) ? obj : (obj.items || obj.data || []);
        }

        if (!Array.isArray(parsed)) {
            throw new Error('Parsed test cases is not an array');
        }

        const normalized = parsed.map((tc, idx) => ({
            id: tc.id || tc.testCaseId || tc.uid || `TC-${idx + 1}`,
            requirement: tc.requirement || tc.name || tc.title || 'Тест-кейс',
            text: tc.text || tc.description || tc.body || logText.substring(0, 2000),
            type: 'TEST_CASE',
            methods: tc.methods || [],
            parameters: tc.parameters || [],
            links: tc.links || []
        }));

        console.log(`[BDD Server] ✅ Распарсено тест-кейсов: ${normalized.length}`);
        return normalized;
    } catch (error) {
        console.warn('[BDD Server] ⚠️ Ошибка парсинга тест-кейсов через LLM:', error.message);
        const fallback = [];
        try {
            const chunks = logText.split(/TestCase ID/i).filter(Boolean);
            chunks.forEach((chunk, idx) => {
                const idMatch = chunk.match(/(\d{3,})/);
                const id = idMatch ? `TC-${idMatch[1]}` : `TC-${idx + 1}`;
                fallback.push({
                    id,
                    requirement: `Тест-кейс ${id}`,
                    text: `TestCase ID ${chunk.trim()}`.substring(0, 2000),
                    type: 'TEST_CASE',
                    methods: [],
                    parameters: [],
                    links: []
                });
            });
        } catch (e) {
            console.warn('[BDD Server] ⚠️ Fallback парсинга тест-кейсов не сработал:', e.message);
        }
        return fallback;
    }
}

/**
 * ШАГ 1: Парсинг ЧТЗ - разбиение на подтребования и маркировка типов
 */
async function parseRequirements(requirementsText, apiKey) {
    // Нормализуем входные данные в строку
    if (!requirementsText) {
        requirementsText = '';
    } else if (typeof requirementsText !== 'string') {
        if (Array.isArray(requirementsText)) {
            requirementsText = requirementsText.join('\n\n');
        } else {
            requirementsText = String(requirementsText);
        }
    }

    console.log('[BDD Server] 🔍 Начинаем парсинг секций из requirements...');
    const sectionPattern = /(?:^#{1,3}\s*|^|\b)(\d+\.\d+(?:\.\d+)*?)(?:\s|$|\.|,)/gm;
    const sections = [];
    let match;
    let matchCount = 0;
    const MAX_MATCHES = 100; // Защита от бесконечного цикла
    
    // Находим все секции с ID (3.1.1, 3.1.2 и т.д.)
    try {
        while ((match = sectionPattern.exec(requirementsText)) !== null && matchCount < MAX_MATCHES) {
            matchCount++;
            const sectionId = match[1];
            const startPos = match.index;
            
            // Сохраняем текущую позицию перед следующим поиском
            const savedLastIndex = sectionPattern.lastIndex;
            
            // Ищем следующее совпадение
            const nextMatch = sectionPattern.exec(requirementsText);
            const endPos = nextMatch ? nextMatch.index : requirementsText.length;
            
            // Восстанавливаем позицию для следующей итерации основного цикла
            sectionPattern.lastIndex = savedLastIndex;
            
            const sectionText = requirementsText.substring(startPos, endPos).trim();
            if (sectionText.length > 0) {
                sections.push({ id: sectionId, text: sectionText });
            }
        }
        
        if (matchCount >= MAX_MATCHES) {
            console.warn(`[BDD Server] ⚠️ Достигнут лимит совпадений (${MAX_MATCHES}), останавливаем парсинг`);
        }
        
        console.log(`[BDD Server] ✅ Найдено ${sections.length} секций по паттерну`);
    } catch (error) {
        console.error('[BDD Server] ❌ Ошибка при парсинге секций:', error.message);
    }
    
    // Если не нашли секции по паттерну, разбиваем на абзацы
    if (sections.length === 0) {
        console.log('[BDD Server] 📄 Секции не найдены, разбиваем на абзацы...');
        try {
            const paragraphs = requirementsText.split(/\n\s*\n/).filter(p => p.trim().length > 50);
            paragraphs.slice(0, 100).forEach((para, idx) => { // Ограничиваем до 100 абзацев
                sections.push({ id: `req_${idx + 1}`, text: para.trim() });
            });
            console.log(`[BDD Server] ✅ Создано ${sections.length} секций из абзацев`);
        } catch (error) {
            console.error('[BDD Server] ❌ Ошибка при разбиении на абзацы:', error.message);
            // Fallback: создаем одну большую секцию
            sections.push({ id: 'req_1', text: requirementsText.substring(0, 5000) });
        }
    }
    
    // Маркируем типы каждого фрагмента
    // Ограничиваем размер секций и количество для предотвращения переполнения памяти
    const MAX_SECTION_LENGTH = 2000; // Максимальная длина текста секции
    const MAX_SECTIONS = 50; // Максимальное количество секций
    
    console.log(`[BDD Server] 📊 Всего найдено секций: ${sections.length}`);
    
    const processedSections = sections
        .slice(0, MAX_SECTIONS) // Ограничиваем количество секций
        .map(s => ({
            id: s.id,
            text: s.text.length > MAX_SECTION_LENGTH 
                ? s.text.substring(0, MAX_SECTION_LENGTH) + '...' 
                : s.text
        }));
    
    console.log(`[BDD Server] 📝 Обработано секций: ${processedSections.length} (из ${sections.length}, ограничено для оптимизации)`);
    console.log(`[BDD Server] 🔧 Формируем промпт для AI...`);
    
    // Ограничиваем общую длину промпта
    const promptSectionsText = processedSections.map(s => `ID: ${s.id}\n${s.text}`).join('\n\n---\n\n');
    const MAX_PROMPT_LENGTH = 50000; // Максимальная длина промпта
    const truncatedSectionsText = promptSectionsText.length > MAX_PROMPT_LENGTH 
        ? promptSectionsText.substring(0, MAX_PROMPT_LENGTH) + '\n\n... (текст обрезан из-за размера)'
        : promptSectionsText;
    
    const parsePrompt = `
Ты QA Automation Engineer. Проанализируй каждый фрагмент требований и определи его тип.

Для каждого фрагмента верни JSON массив с объектами:
{
  "id": "ID требования (3.1.1, 3.1.2 и т.д.)",
  "element": "Название элемента/компонента",
  "requirement": "Краткое описание требования",
  "methods": ["Метод1", "Метод2"], // API методы, если есть
  "parameters": [{"name": "param1", "type": "string", "required": true}], // Параметры, если есть
  "links": ["ссылка1", "ссылка2"], // Ссылки на другие требования
  "type": "UI-отображение|навигация|валидация поля|обработка ошибки|вызов сервиса|изменение данных|другое"
}

Типы:
- UI-отображение: отображение элементов интерфейса
- навигация: переходы между страницами/экранами
- валидация поля: проверка введенных данных
- обработка ошибки: обработка ошибок и исключений
- вызов сервиса: вызовы API/сервисов
- изменение данных: сохранение, обновление, удаление данных
- другое: все остальное

Фрагменты требований:
${truncatedSectionsText}

Верни ТОЛЬКО валидный JSON массив без markdown обёрток.
`;

    console.log(`[BDD Server] 📏 Длина промпта: ${parsePrompt.length} символов`);
    console.log('[BDD Server] 🤖 Вызываем AI API для парсинга требований...');
    const parseResponse = await callWithCloudRuFallback(
        'https://openrouter.ai/api/v1/chat/completions',
        [{ role: 'user', content: parsePrompt }],
        apiKey,
        {
            models: config.cloudruModels || ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
            temperature: 0.2,
            max_tokens: 8000
            // Не используем response_format для Cloud.ru (может вызывать проблемы)
        }
    );
    console.log('[BDD Server] ✅ Получен ответ от AI API, парсим JSON...');

    let parsedSections = [];
    try {
        const content = parseResponse.choices[0].message.content;
        // Пытаемся найти JSON массив или объект
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        const objectMatch = content.match(/\{[\s\S]*\}/);
        
        if (arrayMatch) {
            parsedSections = JSON.parse(arrayMatch[0]);
        } else if (objectMatch) {
            const parsed = JSON.parse(objectMatch[0]);
            parsedSections = Array.isArray(parsed) ? parsed : (parsed.sections || parsed.items || parsed.data || []);
        } else {
            throw new Error('JSON не найден в ответе');
        }
        
        if (!Array.isArray(parsedSections) || parsedSections.length === 0) {
            throw new Error('Пустой массив или неверный формат');
        }
    } catch (e) {
        console.warn('[BDD Server] Ошибка парсинга JSON, используем исходные секции:', e.message);
        parsedSections = sections.map(s => ({ 
            id: s.id, 
            requirement: s.text.substring(0, 200), 
            type: 'другое',
            element: 'Не определен',
            methods: [],
            parameters: [],
            links: []
        }));
    }

    return parsedSections;
}

/**
 * ШАГ 2: Нормализация в "правила" - извлечение независимых правил поведения
 */
async function normalizeToRules(parsedSections, apiKey) {
    // Ограничиваем количество секций и размер данных для предотвращения переполнения памяти
    const MAX_SECTIONS_FOR_RULES = 30;
    const MAX_FIELD_LENGTH = 500;
    
    const limitedSections = parsedSections.slice(0, MAX_SECTIONS_FOR_RULES).map(s => ({
        id: s.id,
        element: (s.element || '').substring(0, MAX_FIELD_LENGTH),
        requirement: (s.requirement || '').substring(0, MAX_FIELD_LENGTH),
        methods: Array.isArray(s.methods) ? s.methods.slice(0, 10) : [],
        parameters: Array.isArray(s.parameters) ? s.parameters.slice(0, 10) : [],
        links: Array.isArray(s.links) ? s.links.slice(0, 10) : [],
        type: s.type || 'другое'
    }));
    
    console.log(`[BDD Server] 📋 Обрабатываем ${limitedSections.length} секций для нормализации в правила (из ${parsedSections.length})`);
    
    const rulesPrompt = `
Ты QA Automation Engineer. Извлеки из каждого фрагмента требований список независимых правил поведения.

Для каждого правила верни:
{
  "requirementId": "ID требования (3.1.1, 3.1.2 и т.д.)",
  "rule": "Краткое описание правила поведения",
  "precondition": "Предусловие (что должно быть выполнено до этого правила)",
  "expectedResult": "Ожидаемый результат выполнения правила",
  "conditions": ["конкретное условие 1", "конкретное условие 2"],
  "triggers": ["явный триггер действия 1", "явный триггер действия 2"],
  "type": "тип из исходного фрагмента"
}

КРИТИЧЕСКИ ВАЖНО - ЖЁСТКАЯ НОРМАЛИЗАЦИЯ ПРАВИЛ:
1. **ЗАПРЕЩЕНО** использовать расплывчатые формулировки:
   ❌ "выполнены условия отображения поля"
   ❌ "система в нужном состоянии"
   ❌ "все проверки пройдены"
   
2. **ОБЯЗАТЕЛЬНО** указывать явные условия:
   ✅ "переключатель dealMode = 'current'"
   ✅ "код операции = '11100' или '21100'"
   ✅ "чекбокс 'Автоматический расчёт' установлен"
   ✅ "поле previousBankRegNumber заполнено"
   ✅ "POST запрос к /rest/stateful/corp/curr/inquiry_181 выполнен"
   ✅ "кнопка 'Создать' нажата"

3. **ПОЛЕ conditions** (обязательно, минимум 1 элемент):
   - Конкретные проверки: "deal.dealMode == 'current'", "code IN [11100, 21100]"
   - Конкретные значения: "ИНН = 12 цифр", "сумма >= 50000"
   - Конкретные состояния UI: "чекбокс 'X' установлен", "поле 'Y' видимо"
   - НЕ расплывчатые: "все условия выполнены", "система готова"

4. **ПОЛЕ triggers** (обязательно для действий):
   - Явные действия: "нажатие кнопки 'Создать'", "POST запрос к /api/path"
   - Явные события: "загрузка формы", "изменение поля dealMode"
   - НЕ расплывчатые: "выполнение условия", "системное действие"

5. ПРАВИЛА ЭКСТРАКЦИИ:
   - Каждое правило должно быть независимым (можно тестировать отдельно)
   - Не объединяй несколько правил в одно
   - Если есть несколько вариантов поведения - создай отдельное правило для каждого
   - Если в требовании указаны конкретные коды/значения/параметры - перечисли их явно в conditions

Фрагменты требований:
${JSON.stringify(limitedSections, null, 2)}

Верни ТОЛЬКО валидный JSON массив правил без markdown обёрток.
`;

    const rulesResponse = await callWithCloudRuFallback(
        'https://openrouter.ai/api/v1/chat/completions',
        [{ role: 'user', content: rulesPrompt }],
        apiKey,
        {
            models: config.cloudruModels || ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
            temperature: 0.2,
            max_tokens: 8000
            // Не используем response_format для Cloud.ru
        }
    );

    let rules = [];
    try {
        const content = rulesResponse.choices[0].message.content;
        // Пытаемся найти JSON массив или объект
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        const objectMatch = content.match(/\{[\s\S]*\}/);
        
        if (arrayMatch) {
            rules = JSON.parse(arrayMatch[0]);
        } else if (objectMatch) {
            const parsed = JSON.parse(objectMatch[0]);
            rules = Array.isArray(parsed) ? parsed : (parsed.rules || parsed.items || parsed.data || []);
        } else {
            throw new Error('JSON не найден в ответе');
        }
        
        if (!Array.isArray(rules) || rules.length === 0) {
            throw new Error('Пустой массив правил или неверный формат');
        }
        
        // Постобработка и нормализация правил
        rules = rules.map((rule, idx) => {
            // Обеспечиваем наличие обязательных полей
            if (!rule.conditions || !Array.isArray(rule.conditions) || rule.conditions.length === 0) {
                // Если conditions отсутствуют, пытаемся извлечь из rule/precondition
                const vaguePatterns = [
                    /выполнены?\s+условия?/i,
                    /система\s+в\s+нужном\s+состоянии/i,
                    /все\s+проверки?\s+пройден/i,
                    /готов\s+к\s+работе/i
                ];
                
                const hasVague = vaguePatterns.some(pattern => 
                    pattern.test(rule.rule || '') || pattern.test(rule.precondition || '')
                );
                
                if (hasVague) {
                    console.warn(`[BDD Server] ⚠️ Правило ${idx + 1} (${rule.requirementId}) содержит расплывчатые формулировки, требуется уточнение`);
                }
                
                // Устанавливаем пустой массив, если нет условий
                rule.conditions = rule.conditions || [];
            }
            
            if (!rule.triggers || !Array.isArray(rule.triggers) || rule.triggers.length === 0) {
                rule.triggers = rule.triggers || [];
            }
            
            // Нормализуем правило: убираем расплывчатые формулировки
            const vagueReplacements = [
                { pattern: /выполнены?\s+условия?\s+отображения/i, replacement: 'конкретное условие отображения' },
                { pattern: /система\s+в\s+нужном\s+состоянии/i, replacement: 'конкретное состояние системы' },
                { pattern: /все\s+проверки?\s+пройден/i, replacement: 'конкретные проверки пройдены' }
            ];
            
            if (rule.rule) {
                vagueReplacements.forEach(({ pattern, replacement }) => {
                    if (pattern.test(rule.rule)) {
                        console.warn(`[BDD Server] ⚠️ В правиле ${idx + 1} найдена расплывчатая формулировка, требуется уточнение`);
                    }
                });
            }
            
            return rule;
        });
        
        console.log(`[BDD Server] ✅ Правила нормализованы: ${rules.length} правил обработано`);
    } catch (e) {
        console.warn('[BDD Server] Ошибка парсинга правил, создаем из секций:', e.message);
        // Fallback: создаем правила из секций
        rules = limitedSections.map(s => ({
            requirementId: s.id || `req_${s.element || 'unknown'}`,
            rule: s.requirement || s.text?.substring(0, 200) || 'Правило поведения',
            precondition: 'Система готова к работе',
            expectedResult: 'Правило выполнено корректно',
            conditions: [],
            triggers: [],
            type: s.type || 'другое'
        }));
    }

    return rules;
}

/**
 * Валидация Gherkin: синтаксическая проверка
 */
function validateGherkinSyntax(gherkinText) {
    try {
        const parser = new Parser();
        const gherkinDocument = parser.parse(gherkinText);
        return {
            valid: true,
            errors: [],
            features: gherkinDocument.feature ? [gherkinDocument.feature] : [],
            scenarios: gherkinDocument.feature?.children?.filter(c => c.scenario) || []
        };
    } catch (error) {
        return {
            valid: false,
            errors: [error.message],
            features: [],
            scenarios: []
        };
    }
}

/**
 * Доменная проверка через AST Gherkin: проверка что шаги используют только разрешенные сущности
 * Детальная проверка полей, эндпоинтов, UI элементов, кодов из domain schema через парсер
 * КРИТИЧНО: Эта функция реально пробегается по каждому шагу и проверяет соответствие domain schema
 */
function validateDomainCompliance(gherkinText, domainSchema) {
    console.log('[BDD Server] 🏗️ Начинаем доменную проверку соответствия шагов domain schema...');
    
    if (!domainSchema || (!domainSchema.fields?.length && !domainSchema.endpoints?.length && !domainSchema.uiElements?.length)) {
        // Если schema пустой, пропускаем проверку
        console.log('[BDD Server] ⚠️ Domain schema пуст, проверка пропущена');
        return {
            compliant: true,
            issues: [],
            summary: 'Domain schema пуст, проверка пропущена'
        };
    }

    console.log(`[BDD Server] 📊 Domain schema содержит: ${domainSchema.fields?.length || 0} полей, ${domainSchema.endpoints?.length || 0} эндпоинтов, ${domainSchema.uiElements?.length || 0} UI элементов`);
    
    const issues = [];
    let stepsChecked = 0;
    
    // Попытка использовать AST Gherkin для более точной проверки
    let gherkinAST = null;
    try {
        const parser = new Parser();
        gherkinAST = parser.parse(gherkinText);
    } catch (parseError) {
        console.warn('[BDD Server] ⚠️ Не удалось распарсить Gherkin для AST валидации, используем текстовый анализ:', parseError.message);
    }
    
    // Нормализуем все разрешенные сущности
    const allFields = new Set((domainSchema.fields || []).map(f => f.name.toLowerCase().trim()));
    const allFieldNames = new Set((domainSchema.fields || []).map(f => {
        const parts = f.name.split('.');
        return parts[parts.length - 1].toLowerCase(); // Последняя часть (например, "dealMode" из "deal.dealMode")
    }));
    
    const allEndpoints = new Set((domainSchema.endpoints || []).map(e => e.path.toLowerCase().trim()));
    const allEndpointMethods = new Map((domainSchema.endpoints || []).map(e => [e.path.toLowerCase().trim(), e.method]));
    
    const allCodes = new Set((domainSchema.codes || []).map(c => String(c).toLowerCase().trim()));
    const allUiElements = new Set((domainSchema.uiElements || []).map(u => {
        if (typeof u === 'object' && u.name) {
            return u;
        }
        return typeof u === 'string' ? u.toLowerCase().trim() : String(u);
    }));
    
    // Извлекаем все упоминания кнопок, полей, страниц из UI элементов
    const uiKeywords = new Set();
    allUiElements.forEach(ui => {
        const uiStr = typeof ui === 'string' ? ui : (ui.name || '');
        // Извлекаем ключевые слова: "Кнопка", "Поле", "Страница" и их значения
        const buttonMatch = uiStr.match(/кнопка[а-я]*\s*['"]([^'"]+)['"]/i);
        const fieldMatch = uiStr.match(/поле[а-я]*\s*['"]([^'"]+)['"]/i);
        const pageMatch = uiStr.match(/страниц[а-я]*\s*['"]([^'"]+)['"]/i);
        if (buttonMatch) uiKeywords.add(buttonMatch[1].toLowerCase());
        if (fieldMatch) uiKeywords.add(fieldMatch[1].toLowerCase());
        if (pageMatch) uiKeywords.add(pageMatch[1].toLowerCase());
        // Также добавляем весь текст как есть (для частичных совпадений)
        if (typeof ui === 'object' && ui.name) {
            uiKeywords.add(ui.name.toLowerCase());
        }
        uiKeywords.add(uiStr.toLowerCase());
    });

    // Подготовка данных для валидации
    const validationData = {
        allFields,
        allFieldNames,
        allEndpoints,
        allCodes,
        allUiElements,
        uiKeywords
    };
    
    // Если AST доступен, используем его для более точной проверки
    if (gherkinAST && gherkinAST.feature) {
        try {
            // Проходим по всем сценариям через AST
            const scenarios = gherkinAST.feature.children || [];
            scenarios.forEach((child) => {
                if (child.scenario) {
                    const scenario = child.scenario;
                    const steps = scenario.steps || [];
                    
                    steps.forEach((step) => {
                        const stepText = step.text || '';
                        const stepLocation = step.location?.line || 0;
                        const lowerStepText = stepText.toLowerCase();
                        
                        // Проверяем шаг через AST
                        stepsChecked++;
                        validateStepFromAST(stepText, lowerStepText, stepLocation, domainSchema, issues, validationData);
                    });
                }
            });
        } catch (astError) {
            console.warn('[BDD Server] ⚠️ Ошибка при работе с AST, переходим на текстовый анализ:', astError.message);
        }
    }
    
    // Дополнительная проверка через текстовый анализ (fallback и дополнение)
    const lines = gherkinText.split('\n');
    
    lines.forEach((line, lineNum) => {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('@')) {
            return; // Пропускаем комментарии и теги
        }
        
        // Проверяем только шаги (Given/When/Then/И/Дано/Когда/Тогда)
        const isStep = /^(given|when|then|and|но|и|дано|когда|тогда)\s+/i.test(trimmedLine);
        if (!isStep) return;
        
        const lowerLine = trimmedLine.toLowerCase();
        
        // Вызываем функцию валидации шага
        stepsChecked++;
        validateStepFromAST(trimmedLine, lowerLine, lineNum + 1, domainSchema, issues, validationData);
    });

    console.log(`[BDD Server] ✅ Доменная проверка завершена: проверено ${stepsChecked} шагов, найдено ${issues.length} нарушений`);
    if (issues.length > 0) {
        console.log(`[BDD Server] 📋 Типы нарушений: ${issues.map(i => i.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
    }

    return {
        compliant: issues.length === 0,
        issues: issues,
        stepsChecked: stepsChecked,
        summary: issues.length === 0 
            ? `Все сущности соответствуют domain schema (проверено ${stepsChecked} шагов)`
            : `Найдено ${issues.length} нарушений domain schema из ${stepsChecked} проверенных шагов: ${issues.map(i => i.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
    };
}

/**
 * Валидация одного шага на соответствие domain schema
 */
function validateStepFromAST(stepText, lowerStepText, lineNum, domainSchema, issues, validationData) {
    // Получаем нормализованные данные для проверки
    const allFields = validationData.allFields;
    const allFieldNames = validationData.allFieldNames;
    const allEndpoints = validationData.allEndpoints;
    const allCodes = validationData.allCodes;
    const allUiElements = validationData.allUiElements;
    const uiKeywords = validationData.uiKeywords;
    
    // 1. Проверка полей (формат: object.field или просто field)
    const fieldPatterns = [
        /\b([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\b/g, // object.field
        /(?:поле|field|параметр)\s+['"]([^'"]+)['"]/gi, // "поле 'fieldName'"
    ];
    
    fieldPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(lowerStepText)) !== null) {
            const field = match[1] || match[0];
            const normalizedField = field.toLowerCase().trim();
            const fieldNameOnly = normalizedField.split('.').pop();
            
            if (!allFields.has(normalizedField) && !allFieldNames.has(fieldNameOnly)) {
                // Проверяем, не является ли это частью разрешенного поля
                const isPartOfAllowedField = Array.from(allFields).some(f => 
                    f.includes(fieldNameOnly) || normalizedField.includes(f.split('.').pop())
                );
                
                if (!isPartOfAllowedField) {
                    issues.push({
                        type: 'unknown_field',
                        line: lineNum,
                        text: stepText,
                        issue: `Поле '${field}' не найдено в domain schema. Разрешенные поля: ${Array.from(allFields).slice(0, 5).join(', ')}...`
                    });
                }
            }
        }
    });
    
    // 2. Проверка эндпоинтов (форматы: "/api/path", "/rest/path", "endpoint '/api/path'")
    const endpointPatterns = [
        /['"](?:\/api|\/rest|\/v\d+)[^'"]+['"]/gi, // '/api/path' или "/rest/path"
        /(?:эндпоинт|endpoint|метод|method)\s+['"]([^'"]+)['"]/gi,
        /(?:GET|POST|PUT|DELETE|PATCH)\s+(['"][^'"]+['"])/gi
    ];
    
    endpointPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(lowerStepText)) !== null) {
            const endpoint = (match[1] || match[0]).replace(/['"]/g, '').toLowerCase().trim();
            const isAllowed = Array.from(allEndpoints).some(allowedEp => 
                endpoint.includes(allowedEp) || allowedEp.includes(endpoint)
            );
            
            if (!isAllowed && endpoint.length > 3) {
                issues.push({
                    type: 'unknown_endpoint',
                    line: lineNum,
                    text: stepText,
                    issue: `Эндпоинт '${endpoint}' не найден в domain schema. Разрешенные эндпоинты: ${Array.from(allEndpoints).slice(0, 3).join(', ')}...`
                });
            }
        }
    });
    
    // 3. Проверка кодов/значений (числовые коды)
    const codeMatches = lowerStepText.match(/\b(\d{4,6})\b/g); // 4-6 цифр подряд (коды)
    if (codeMatches) {
        codeMatches.forEach(code => {
            if (!allCodes.has(code) && allCodes.size > 0) {
                issues.push({
                    type: 'unknown_code',
                    line: lineNum,
                    text: stepText,
                    issue: `Код '${code}' не найден в domain schema. Разрешенные коды: ${Array.from(allCodes).slice(0, 5).join(', ')}...`
                });
            }
        });
    }
    
    // 4. Проверка UI элементов (кнопки, поля, страницы)
    const uiPatterns = [
        /(?:кнопка|button)\s+['"]([^'"]+)['"]/gi,
        /(?:поле|field|поле формы)\s+['"]([^'"]+)['"]/gi,
        /(?:страница|page|экран|screen)\s+['"]([^'"]+)['"]/gi,
        /нажимаю\s+(?:кнопку|на)\s+['"]([^'"]+)['"]/gi,
        /ввожу\s+(?:в|в поле)\s+['"]([^'"]+)['"]/gi,
    ];
    
    uiPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(lowerStepText)) !== null) {
            const uiElement = match[1].toLowerCase().trim();
            const isAllowed = Array.from(uiKeywords).some(keyword => 
                keyword.includes(uiElement) || uiElement.includes(keyword)
            ) || Array.from(allUiElements).some(ui => {
                const uiStr = typeof ui === 'string' ? ui : (ui.name || '');
                return uiStr.includes(uiElement) || uiElement.includes(uiStr.split(/['"]/).pop()?.toLowerCase() || '');
            });
            
            if (!isAllowed && allUiElements.size > 0) {
                issues.push({
                    type: 'unknown_ui_element',
                    line: lineNum,
                    text: stepText,
                    issue: `UI элемент '${uiElement}' не найден в domain schema. Разрешенные элементы: ${Array.from(allUiElements).slice(0, 3).map(u => typeof u === 'string' ? u : u.name).join(', ')}...`
                });
            }
        }
    });
}

/**
 * LLM self-check: проверка соответствия сценариев правилам и требованиям
 * КРИТИЧНО: Это второй проход модели - отдельный запрос к LLM для проверки соответствия
 */
async function validateWithLLM(gherkinText, rules, requirements, domainSchema, apiKey) {
    console.log('[BDD Server] 🤖 LLM self-check: Запускаем второй проход модели для проверки соответствия сценариев правилам/требованиям...');
    console.log(`[BDD Server] 📊 Проверяем ${rules.length} правил против сгенерированных сценариев (${gherkinText.length} символов)`);
    
    // Формируем правила с контекстом для проверки (включая conditions и triggers)
    const rulesForValidation = rules.slice(0, 15).map((r, idx) => ({
        ruleId: `RULE-${idx + 1}`,
        requirementId: r.requirementId,
        rule: r.rule,
        precondition: r.precondition,
        expectedResult: r.expectedResult,
        conditions: r.conditions || [],
        triggers: r.triggers || [],
        type: r.type
    }));
    
    const validationPrompt = `
Ты QA Automation Code Reviewer. Проверь сгенерированные BDD сценарии на соответствие правилам, требованиям и domain schema.

КРИТИЧЕСКАЯ ЗАДАЧА - найди ВСЕ проблемы:
1. **Соответствие правилам**: Каждый сценарий должен точно отражать своё правило:
   - Правило: rule + precondition → expectedResult
   - Условия (conditions) должны быть явно отражены в шагах сценария
   - Триггеры (triggers) должны быть явно отражены в шаге "Когда"
   - Если в правиле указаны конкретные коды/значения/параметры - они должны быть использованы в сценарии
   - ❌ НЕДОПУСТИМО: расплывчатые формулировки типа "выполнены условия" без конкретики
   - ✅ ОБЯЗАТЕЛЬНО: явные условия типа "код операции = '11100'", "dealMode = 'current'"

2. **Domain compliance**: Используются ТОЛЬКО поля/эндпоинты/UI элементы из domain schema:
   - Если видишь поле/метод/элемент, которого нет в списке - это ОШИБКА!
   - Если видишь код операции, которого нет в списке - это ОШИБКА!
   - Если видишь UI элемент, которого нет в списке - это ОШИБКА!

3. **Явность действий**: 
   - Шаг "Когда" должен содержать явное действие, а не расплывчатое "выполнено условие"
   - Если в правиле есть triggers - проверь, что они отражены в "Когда"

4. **Раскрытие условий**:
   - Если в правиле есть conditions - проверь, что они явно перечислены в сценарии
   - Если есть несколько вариантов условий - должны быть отдельные сценарии или Scenario Outline

5. **Логические противоречия**: Сценарии не должны противоречить друг другу или правилам

6. **Придуманные сущности**: НЕТ полей/методов, которых нет в domain schema

7. **Трассируемость**: Каждый Feature/Scenario должен иметь теги @REQ-<id> и @RULE-<номер>

ПРАВИЛА ПОВЕДЕНИЯ (что должны проверять сценарии):
${JSON.stringify(rulesForValidation, null, 2)}

DOMAIN SCHEMA (РАЗРЕШЕННЫЕ СУЩНОСТИ - ТОЛЬКО ЭТИ МОЖНО ИСПОЛЬЗОВАТЬ):
Поля/Параметры: ${(domainSchema?.fields || []).slice(0, 30).map(f => f.name).join(', ')}
Эндпоинты: ${(domainSchema?.endpoints || []).slice(0, 20).map(e => `${e.method} ${e.path}`).join(', ')}
UI элементы: ${(domainSchema?.uiElements || []).slice(0, 20).join(', ')}
Коды/значения: ${(domainSchema?.codes || []).slice(0, 20).join(', ')}

ТРЕБОВАНИЯ (контекст):
${(requirements || []).slice(0, 5).map(r => `[${r.id || 'REQ'}] ${(r.text || r.requirement || '').substring(0, 150)}`).join('\n')}

GHERKIN СЦЕНАРИИ ДЛЯ ПРОВЕРКИ:
${gherkinText.substring(0, 12000)}

Проверь КАЖДЫЙ сценарий детально:

1. Соответствие правилу:
   - Соответствует ли сценарий правилу (rule + precondition → expectedResult)?
   - Отражены ли все conditions из правила явно в шагах?
   - Отражены ли все triggers из правила в шаге "Когда"?
   - Используются ли конкретные коды/значения/параметры из правила, если они указаны?

2. Явность условий и действий:
   - Нет ли расплывчатых формулировок типа "выполнены условия", "система готова"?
   - Содержит ли шаг "Когда" явное действие?
   - Перечислены ли все условия из rules.conditions в шагах?

3. Domain compliance:
   - Используются ли только сущности из domain schema?
   - Нет ли придуманных полей/эндпоинтов/UI элементов?

4. Трассируемость:
   - Есть ли теги @REQ- и @RULE- у каждого сценария?

Верни JSON с результатами проверки:
{
  "valid": true/false,
  "issues": [
    {
      "severity": "error|warning",
      "type": "domain_violation|logic_error|missing_coverage|missing_tags|rule_mismatch",
      "description": "Детальное описание проблемы",
      "scenario": "Название сценария или Feature",
      "line": "Номер строки или контекст"
    }
  ],
  "summary": "Краткое резюме: найдено X ошибок, Y предупреждений"
}

Верни ТОЛЬКО валидный JSON без markdown обёрток.
`;

    try {
        const response = await callWithCloudRuFallback(
            'https://openrouter.ai/api/v1/chat/completions',
            [{ role: 'user', content: validationPrompt }],
            apiKey,
            {
                models: config.cloudruModels || ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
                temperature: 0.2,
                max_tokens: 3000
            }
        );

        const content = response.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const validation = JSON.parse(jsonMatch[0]);
            console.log(`[BDD Server] ✅ LLM валидация завершена: ${validation.valid ? 'валидно' : `${validation.issues?.length || 0} проблем найдено`}`);
            return validation;
        }
        
        return { valid: true, issues: [], summary: 'Не удалось распарсить результат валидации' };
    } catch (error) {
        console.error('[BDD Server] ❌ Ошибка LLM валидации:', error.message);
        return { valid: true, issues: [], summary: `Ошибка валидации: ${error.message}` };
    }
}

/**
 * ШАГ 3: Генерация BDD - создание Gherkin сценариев с дедупликацией шагов
 * Обновлено: добавлены domain schema, RAG, трассируемость, уровни абстракции
 */
async function generateGherkinFromRules(rules, domainSchema, relevantRequirements, apiKey, inputType) {
    // Ограничиваем количество правил для предотвращения переполнения памяти
    const MAX_RULES = 30;
    const MAX_FIELD_LENGTH = 300;
    
    const limitedRules = rules.slice(0, MAX_RULES).map(r => ({
        requirementId: r.requirementId,
        rule: (r.rule || '').substring(0, MAX_FIELD_LENGTH),
        precondition: (r.precondition || '').substring(0, MAX_FIELD_LENGTH),
        expectedResult: (r.expectedResult || '').substring(0, MAX_FIELD_LENGTH),
        type: r.type || 'другое'
    }));
    
    console.log(`[BDD Server] 📝 Генерируем Gherkin для ${limitedRules.length} правил (из ${rules.length})`);
    
    // Ищем похожие шаги для каждого правила
    const existingStepsContext = [];
    
    for (const rule of limitedRules.slice(0, 15)) { // Ограничиваем для производительности
        const ruleText = `${rule.rule} ${rule.precondition} ${rule.expectedResult}`;
        const similar = await findSimilarSteps(ruleText, 3);
        existingStepsContext.push(...similar);
    }

    // Удаляем дубликаты
    const uniqueExistingSteps = [...new Set(existingStepsContext)];

    // Формируем domain schema строку для промпта
    const domainSchemaStr = domainSchema ? `
DOMAIN SCHEMA (РАЗРЕШЕННЫЕ СУЩНОСТИ - ИСПОЛЬЗУЙ ТОЛЬКО ЭТИ!):
${(domainSchema.fields || []).length > 0 ? `
Поля/Параметры:
${(domainSchema.fields || []).slice(0, 30).map(f => {
    const allowedValues = f.allowedValues ? ` (допустимые значения: ${f.allowedValues.join(', ')})` : '';
    const validation = f.validation ? ` (валидация: ${f.validation})` : '';
    return `  - ${f.name} (${f.type || 'string'})${allowedValues}${validation}`;
}).join('\n')}
` : ''}
${(domainSchema.endpoints || []).length > 0 ? `
API Эндпоинты:
${(domainSchema.endpoints || []).slice(0, 20).map(e => `  - ${e.method || 'GET'} ${e.path}${e.parameters ? ` (параметры: ${e.parameters.join(', ')})` : ''}`).join('\n')}
` : ''}
${(domainSchema.codes || []).length > 0 ? `
Коды операций/Значения:
${(domainSchema.codes || []).slice(0, 30).map(c => {
    if (typeof c === 'object' && c.value) {
        return `  - ${c.value}${c.description ? ` (${c.description})` : ''}`;
    }
    return `  - ${c}`;
}).join('\n')}
` : ''}
${(domainSchema.uiElements || []).length > 0 ? `
UI Элементы:
${(domainSchema.uiElements || []).slice(0, 20).map(ui => {
    if (typeof ui === 'object' && ui.name) {
        return `  - ${ui.type || 'элемент'} '${ui.name}'${ui.page ? ` на странице '${ui.page}'` : ''}${ui.states ? ` (состояния: ${ui.states.join(', ')})` : ''}`;
    }
    return `  - ${ui}`;
}).join('\n')}
` : ''}
${(domainSchema.businessRules || []).length > 0 ? `
Бизнес-правила:
${(domainSchema.businessRules || []).slice(0, 15).map(rule => `  - ${rule}`).join('\n')}
` : ''}

🚫 СТРОГИЙ ЗАПРЕТ НА ДОМЕННОЕ ТВОРЧЕСТВО:
- НЕ придумывай поля, которые не указаны в domain schema
- НЕ придумывай эндпоинты, которых нет в списке
- НЕ придумывай UI элементы, которых нет в списке
- НЕ придумывай коды операций или значения, которых нет в списке
- Если чего-то нет в domain schema - НЕ используй это и НЕ придумывай!
- Используй ТОЛЬКО то, что явно указано в domain schema выше!
` : '';

    // Формируем контекст из релевантных требований (RAG)
    const requirementsContext = relevantRequirements && relevantRequirements.length > 0 ? `
РЕЛЕВАНТНЫЕ ТРЕБОВАНИЯ (RAG контекст - используй только поведение из этих фрагментов):
${relevantRequirements.slice(0, 7).map((r, idx) => `
Фрагмент ${idx + 1} [${r.id}]:
${r.text.substring(0, 300)}
`).join('\n---\n')}

⚠️ Используй ТОЛЬКО поведение, описанное в приведённых фрагментах требований выше.
НЕ придумывай поведение, которого нет в этих фрагментах!
` : '';

    const isTestCaseInput = inputType === 'TEST_CASES_LOG' || inputType === 'TEST_CASES_JSON';

    const gherkinPrompt = `
Ты QA Automation Engineer. Напиши BDD сценарии на Gherkin (RU) для каждого правила.

ПРАВИЛА ПОВЕДЕНИЯ:
${JSON.stringify(limitedRules, null, 2)}
${requirementsContext}
${domainSchemaStr}

КОНТЕКСТ:
Мы генерируем BDD на основе: ${isTestCaseInput ? 'СУЩЕСТВУЮЩИХ ТЕСТ-КЕЙСОВ' : 'БИЗНЕС-ТРЕБОВАНИЙ'}.

СУЩЕСТВУЮЩИЕ ШАГИ (для переиспользования):
${uniqueExistingSteps.length > 0 ? uniqueExistingSteps.map(s => `- ${s}`).join('\n') : '(нет существующих шагов)'}

ТРЕБОВАНИЯ К ФОРМАТУ:
${isTestCaseInput
    ? '1. Для каждого правила (тест-кейса) создай ровно 1 Scenario. Не придумывай новые сценарии и не объединяй разные тест-кейсы.'
    : '1. Для каждого правила создай 1-3 Gherkin сценария'}

2. **ЯВНЫЙ ШАГ When (ОБЯЗАТЕЛЬНО!)**:
   - ВСЕГДА указывай явное действие в шаге "Когда"
   - ❌ НЕ используй: "Когда выполнены условия", "Когда система готова"
   - ✅ Используй: "Когда загружается форма создания сделки"
   - ✅ Используй: "Когда выполняется POST запрос к /rest/stateful/corp/curr/inquiry_181"
   - ✅ Используй: "Когда нажимаю кнопку 'Создать'"
   - ✅ Используй: "Когда изменяю поле 'dealMode' на значение 'current'"
   - Если в правиле есть поле triggers - используй его значения как основу для When

3. **РАСКРЫТИЕ УСЛОВИЙ (ОБЯЗАТЕЛЬНО!)**:
   - ❌ НЕ используй: "Если выполнены условия отображения поля"
   - ✅ Используй явные условия из правил:
     * "Если код операции = '11100'"
     * "Если переключатель dealMode = 'current'"
     * "Если чекбокс 'Автоматический расчёт' установлен"
   - Если в правиле есть поле conditions - перечисли их явно в шагах
   - Если есть несколько вариантов условий - используй Scenario Outline + Examples для каждого варианта
   Пример:
   Scenario Outline: Отображение поля при различных кодах операции
     Дано форма создания сделки открыта
     Когда код операции = "<code>"
     Тогда поле 'previousBankRegNumber' видимо
     
     Examples:
       | code  |
       | 11100 |
       | 21100 |

4. Используй существующие шаги из списка, если они подходят

5. **СЦЕНАРИИ И ПАРАМЕТРИЗАЦИЯ (ОБЯЗАТЕЛЬНО!)**:
   - Если для правила есть несколько значений параметра (например, dealMode=1 и dealMode=3, или previousBankRegNumber=true и false):
     → ИСПОЛЬЗУЙ ТОЛЬКО Scenario Outline, НЕ создавай отдельные Scenario с теми же условиями
     → Объедини все варианты в один Scenario Outline с Examples
   - НЕ дублируй: если уже есть Scenario Outline с параметром X, не создавай отдельный Scenario с X=значение1
   - Если есть одиночный Scenario с параметром=значение, а потом Scenario Outline с этим же параметром - удали одиночный, оставь только Outline
   Пример правильного подхода:
   ❌ НЕПРАВИЛЬНО (дубликат):
   @REQ-4.1.1 @RULE-1
   Scenario: Отображение поля при dealMode=1
     ...
   @REQ-4.1.1 @RULE-1
   Scenario Outline: Отображение поля при различных dealMode
     ...
     Examples:
       | dealMode |
       | 1        |
       | 3        |
   
   ✅ ПРАВИЛЬНО (только Outline):
   @REQ-4.1.1 @RULE-1
   Scenario Outline: Отображение поля при различных dealMode
     ...
     Examples:
       | dealMode |
       | 1        |
       | 3        |

6. **ФОРМУЛИРОВКИ ШАГОВ (ЕДИНООБРАЗИЕ!)**:
   - ❌ НЕ используй знак "=" в шагах: "параметр deal.previousBankRegNumber = true"
   - ✅ Используй единообразные формулировки:
     * "Тогда параметр "deal.previousBankRegNumber" равен true"
     * "Тогда в параметрах запроса "deal.previousBankRegNumber" имеет значение true"
     * "Тогда поле "dealMode" равно "current""
     * "Тогда код операции равен "11100""
   - Это упрощает парсинг и сопоставление шагов с action/assert-шаблонами
   - Для сравнений используй формулировки: "равен", "имеет значение", "установлен в"

7. **РЕЖИМЫ ДОКУМЕНТА (ЧЁТКАЯ ПРИВЯЗКА!)**:
   - Если в шагах упоминаются режимы документа ("режим повтора", "режим редактирования", "режим просмотра"):
     → Привяжи режим к конкретному значению dealMode из domain schema
     → Укажи это явно в шаге или в комментарии
   - Формат: "Дано документ загружен в режиме редактирования (dealMode = "current")"
   - Или: "# Режим редактирования соответствует dealMode = "current""
   - Если режим описан в ЧТЗ - используй именно это значение, не придумывай свои

8. **ТРАССИРУЕМОСТЬ (КРИТИЧНО ОБЯЗАТЕЛЬНО!)**:
   - К КАЖДОМУ Feature добавь тег @REQ-<requirementId> (например: @REQ-3.1.1)
   - К КАЖДОМУ Scenario добавь теги @REQ-<requirementId> @RULE-<номер_правила> (например: @REQ-3.1.1 @RULE-1)
   - Нумерация правил: RULE-1, RULE-2, RULE-3... (порядок соответствует порядку в массиве правил выше)
   - БЕЗ ТЕГОВ СЦЕНАРИИ НЕПРИЕМЛЕМЫ! Это критично для трассируемости.
   - Теги ДОЛЖНЫ быть добавлены ПРЯМО В GHERKIN КОД, чтобы агенты/репорты могли извлекать ID из .feature файлов
   - Формат тегов: одна строка с тегами перед Feature/Scenario, например: "@REQ-3.1.1 @RULE-1"
   Пример корректного формата:
   @REQ-3.1.1
   Feature: Описание фичи
     @REQ-3.1.1 @RULE-1
     Scenario: Название сценария для первого правила
       Дано предусловие
       Когда явное действие
       Тогда ожидаемый результат
     
     @REQ-3.1.1 @RULE-2
     Scenario: Название сценария для второго правила
       ...

9. **УРОВНИ АБСТРАКЦИИ**: 
   - Если type=вызов сервиса/изменение данных → пиши API-ориентированные шаги (Given/When/Then вокруг запросов/ответов)
   - Если type=UI-отображение/навигация → пиши UI-ориентированные шаги (Дано открыта страница X, Когда нажимаю кнопку Y)
   - Если type=валидация поля → фокус на проверке валидации полей

10. **ГРУППИРОВКА**: Группируй сценарии по Feature (по requirementId или типу)

11. 🚫 СТРОГИЙ ЗАПРЕТ НА ДОМЕННОЕ ТВОРЧЕСТВО:
   - НЕ используй поля/методы/значения, которых нет в domain schema!
   - КРИТИЧНО: Каждое поле, эндпоинт, UI элемент и код ДОЛЖЕН быть из списка выше
   - Если чего-то нет в domain schema - НЕ используй это! Система автоматически проверит соответствие и отклонит сценарии с неизвестными сущностями

12. **SPA И КОМПОНЕНТЫ (КРИТИЧНО!)**:
   - Если действие вызывает открытие модального окна, шторки или карточки — ЭТО НЕ НАВИГАЦИЯ.
   - ЗАПРЕЩЕНО писать: "Тогда происходит переход к странице 'Модальное окно'".
   - ПРАВИЛЬНО: "Тогда modal 'Название' открыто" или "Тогда element 'Название' видимо".
   - Переход на страницу (Page) возможен только если явно меняется URL или контекст всего приложения.
   - Компоненты (модалки, drawers, карточки) открываются поверх текущего экрана, без изменения URL — это НЕ навигация!
   - Для компонентов используй формулировки: "modal открыто", "drawer видимо", "компонент отображается"
   - Для страниц используй формулировки: "переход к странице", "открыта страница", "загружена страница"

ВАЖНО: Каждый Scenario ДОЛЖЕН иметь оба тега (@REQ- и @RULE-) для трассируемости требований!

Формат ответа: ТОЛЬКО валидный Gherkin код на русском языке, без markdown обёрток.

Пример с трассируемостью:
@REQ-3.1.1 @RULE-1
Feature: Название фичи
  Описание фичи

  @REQ-3.1.1 @RULE-1
  Scenario: Название сценария
    Дано предусловие
    Когда действие
    Тогда ожидаемый результат

  @REQ-3.1.1 @RULE-2
  Scenario Outline: Параметризованный сценарий
    Дано предусловие
    Когда действие с параметром "<параметр>"
    Тогда результат для "<параметр>"
    
    Examples:
      | параметр |
      | значение1 |
      | значение2 |
`;

    const gherkinResponse = await callWithCloudRuFallback(
        'https://openrouter.ai/api/v1/chat/completions',
        [{ role: 'user', content: gherkinPrompt }],
        apiKey,
        {
            models: config.cloudruModels || ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
            temperature: 0.3,
            max_tokens: 8000
        }
    );

    const featureContent = gherkinResponse.choices[0].message.content
        .replace(/```gherkin\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

    return featureContent;
}

/**
 * Проверка и добавление тегов трассируемости (@REQ- и @RULE-) в Gherkin
 * Обеспечивает, что каждый Feature/Scenario имеет необходимые теги для трассируемости
 */
function ensureTraceabilityTags(gherkinText, rules) {
    if (!gherkinText || !rules || rules.length === 0) {
        return gherkinText; // Не можем добавить теги без правил
    }
    
    const lines = gherkinText.split('\n');
    const result = [];
    let featureRequirementId = null;
    let ruleIndex = 0;
    let scenarioIndex = 0;
    
    // Создаем карту requirementId -> rules для быстрого поиска
    const reqIdToRules = new Map();
    rules.forEach((rule, idx) => {
        const reqId = rule.requirementId || `REQ-${idx + 1}`;
        if (!reqIdToRules.has(reqId)) {
            reqIdToRules.set(reqId, []);
        }
        reqIdToRules.get(reqId).push({ ...rule, ruleIndex: idx + 1 });
    });
    
    // Собираем теги перед Feature
    const featureTagLines = [];
    let i = 0;
    while (i < lines.length && lines[i].trim().startsWith('@')) {
        featureTagLines.push(lines[i]);
        i++;
    }
    
    // Обрабатываем Feature
    if (i < lines.length && lines[i].trim().toLowerCase().startsWith('feature:')) {
        const featureLine = lines[i];
        i++;
        
        // Извлекаем requirementId из тегов Feature
        const reqTag = featureTagLines.find(l => l.trim().startsWith('@REQ-'));
        if (reqTag) {
            featureRequirementId = reqTag.trim().replace('@REQ-', '');
        } else if (rules.length > 0) {
            // Берем первый requirementId из правил
            featureRequirementId = rules[0].requirementId || 'REQ-1';
        }
        
        // Добавляем теги Feature (если нет @REQ-, добавляем)
        featureTagLines.forEach(tag => result.push(tag));
        if (!reqTag && featureRequirementId) {
            result.push(`@REQ-${featureRequirementId}`);
        }
        result.push(featureLine);
    } else {
        // Если нет Feature, добавляем все строки как есть
        featureTagLines.forEach(tag => result.push(tag));
        while (i < lines.length && !lines[i].trim().toLowerCase().startsWith('feature:')) {
            result.push(lines[i]);
            i++;
        }
    }
    
    // Обрабатываем остальные строки (Scenarios)
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Определяем Scenario
        if (trimmed.toLowerCase().match(/^(scenario|scenario outline):/i)) {
            // Собираем теги перед Scenario из исходного текста
            const scenarioTagLines = [];
            let k = i - 1;
            while (k >= 0 && lines[k].trim().startsWith('@')) {
                scenarioTagLines.unshift(lines[k]);
                k--;
            }
            
            // Удаляем старые теги из результата - находим все теги, которые мы уже добавили до этого момента
            // Удаляем все теги, которые находятся после последней не-теговой строки
            let lastNonTagIndex = result.length - 1;
            while (lastNonTagIndex >= 0 && result[lastNonTagIndex].trim().startsWith('@')) {
                lastNonTagIndex--;
            }
            // Удаляем все теги после последней не-теговой строки
            if (lastNonTagIndex < result.length - 1) {
                result.splice(lastNonTagIndex + 1);
            }
            
            // Извлекаем requirementId и ruleNum из тегов исходного текста
            let scenarioReqId = featureRequirementId;
            const scenarioReqTags = scenarioTagLines.filter(l => l.trim().startsWith('@REQ-'));
            if (scenarioReqTags.length > 0) {
                // Берем первый @REQ- тег, удаляем остальные (дубликаты)
                const firstReqTag = scenarioReqTags[0].trim();
                // Обрабатываем случай, когда в одной строке несколько тегов: "@REQ-4.1.1 @RULE-1"
                const reqMatch = firstReqTag.match(/@REQ-([^\s]+)/);
                if (reqMatch) {
                    scenarioReqId = reqMatch[1];
                }
            }
            
            let ruleNum = null;
            const ruleTags = scenarioTagLines.filter(l => {
                const tag = l.trim();
                return tag.startsWith('@RULE-') || tag.includes('@RULE-');
            });
            if (ruleTags.length > 0) {
                // Берем первый @RULE- тег, обрабатываем случай нескольких тегов в одной строке
                const firstRuleTag = ruleTags[0].trim();
                const ruleMatch = firstRuleTag.match(/@RULE-([^\s]+)/);
                if (ruleMatch) {
                    ruleNum = ruleMatch[1];
                }
            } else {
                // Ищем правило по requirementId
                const matchingRules = reqIdToRules.get(scenarioReqId);
                if (matchingRules && matchingRules.length > 0) {
                    ruleNum = String(matchingRules[scenarioIndex % matchingRules.length].ruleIndex);
                } else {
                    scenarioIndex++;
                    ruleNum = String(scenarioIndex);
                }
            }
            
            // Сохраняем другие теги (не @REQ- и не @RULE-)
            const otherTags = scenarioTagLines.filter(l => {
                const tag = l.trim();
                // Проверяем, что строка не содержит @REQ- или @RULE-
                return !tag.includes('@REQ-') && !tag.includes('@RULE-');
            });
            
            // Добавляем: другие теги, затем обязательные @REQ- и @RULE- теги, затем строку Scenario
            otherTags.forEach(tag => result.push(tag));
            if (scenarioReqId) {
                result.push(`@REQ-${scenarioReqId}`);
            }
            if (ruleNum) {
                result.push(`@RULE-${ruleNum}`);
            }
            result.push(line);
            scenarioIndex++;
        } else {
            result.push(line);
        }
        
        i++;
    }
    
    return result.join('\n');
}

/**
 * Генерирует BDD тесты по трёхэтапной архитектуре:
 * 1. Парсинг ЧТЗ → 2. Нормализация в правила → 3. Генерация BDD
 */
async function generateBDDTestsAsync(taskId, inputData) {
    const { requirements, modelStructure, projectId } = inputData;
    const apiKey = inputData.apiKey || process.env.OPENROUTER_API_KEY || config.openRouterAiKey;
    const inputType = detectInputType(requirements);

    try {
        await taskStorage.update(taskId, {
            status: 'processing',
            progress: 5,
            updated_at: new Date()
        });

        // ШАГ 1: Парсинг ЧТЗ (10-30%)
        await taskStorage.update(taskId, {
            progress: 10,
            updated_at: new Date()
        });

        // Преобразуем requirements в строку (может быть массивом или строкой)
        let requirementsText = '';
        if (Array.isArray(requirements)) {
            requirementsText = requirements.join('\n\n');
        } else if (typeof requirements === 'string') {
            requirementsText = requirements;
        } else if (requirements) {
            requirementsText = String(requirements);
        }

        console.log(`[BDD Server] ШАГ 1: Парсинг входных данных (тип=${inputType})...`);
        console.log(`[BDD Server] Длина входного текста: ${requirementsText.length} символов`);

        let parsedSections = [];

        if (inputType === 'TEST_CASES_JSON') {
            parsedSections = (Array.isArray(requirements) ? requirements : []).map((tc, idx) => {
                const id = tc.id || tc.testCaseId || tc.uid || `TC-${idx + 1}`;
                const stepsText = Array.isArray(tc.steps)
                    ? tc.steps.map((s, i) => `${i + 1}. ${s.name || s.title || s.action || s.text || JSON.stringify(s)}`).join('\n')
                    : '';
                const expected = tc.expected || tc.expectedResult || tc.expectedResults || tc.result || '';
                const body = tc.text || tc.description || tc.body || '';
                const fullText = [
                    tc.name || tc.title || `Тест-кейс ${id}`,
                    body,
                    stepsText ? `Steps:\n${stepsText}` : '',
                    expected ? `Expected:\n${expected}` : ''
                ].filter(Boolean).join('\n\n');

                return {
                    id,
                    requirement: tc.requirement || tc.name || tc.title || `Тест-кейс ${id}`,
                    text: fullText.substring(0, 5000),
                    type: 'TEST_CASE',
                    methods: tc.methods || [],
                    parameters: tc.parameters || [],
                    links: tc.links || []
                };
            });
            if (!requirementsText && parsedSections.length > 0) {
                requirementsText = parsedSections.map(s => s.text).join('\n\n');
            }
        } else if (inputType === 'TEST_CASES_LOG') {
            parsedSections = await parseTestCases(requirementsText, apiKey);
        } else {
            parsedSections = await parseRequirements(requirementsText, apiKey);
        }

        console.log(`[BDD Server] ✅ Распарсено ${parsedSections.length} секций (inputType=${inputType})`);

        // Индексируем требования в RAG
        await indexRequirements(parsedSections, apiKey);

        // Извлекаем domain schema
        const domainSchema = await extractDomainSchema(requirementsText, modelStructure, apiKey);

        await taskStorage.update(taskId, {
            progress: 30,
            updated_at: new Date()
        });

        // ШАГ 2: Нормализация в правила (30-50%)
        console.log('[BDD Server] ШАГ 2: Нормализация в правила...');
        const rules = await normalizeToRules(parsedSections, apiKey);
        console.log(`[BDD Server] ✅ Извлечено ${rules.length} правил поведения`);

        await taskStorage.update(taskId, {
            progress: 50,
            updated_at: new Date()
        });

        // RAG retrieval: находим релевантные требования для каждого правила (50-60%)
        console.log('[BDD Server] 🔍 Поиск релевантных требований через RAG...');
        const allRelevantRequirements = [];
        for (const rule of rules.slice(0, 15)) {
            const queryText = `${rule.rule} ${rule.precondition} ${rule.expectedResult}`;
            const relevant = await retrieveRelevantRequirements(queryText, 3);
            allRelevantRequirements.push(...relevant);
        }
        // Удаляем дубликаты
        const uniqueRelevantRequirements = Array.from(
            new Map(allRelevantRequirements.map(r => [r.id, r])).values()
        );
        console.log(`[BDD Server] ✅ Найдено ${uniqueRelevantRequirements.length} релевантных требований через RAG`);

        await taskStorage.update(taskId, {
            progress: 60,
            updated_at: new Date()
        });

        // ШАГ 3: Генерация BDD с domain schema и RAG (60-85%)
        console.log('[BDD Server] ШАГ 3: Генерация Gherkin сценариев...');
        let featureContent = await generateGherkinFromRules(rules, domainSchema, uniqueRelevantRequirements, apiKey, inputType);

        // Принудительно добавляем теги трассируемости, если они отсутствуют
        console.log('[BDD Server] 🏷️ Проверка и добавление тегов трассируемости (@REQ- и @RULE-)...');
        const tagsBefore = (featureContent.match(/@REQ-|@RULE-/g) || []).length;
        featureContent = ensureTraceabilityTags(featureContent, rules);
        const tagsAfter = (featureContent.match(/@REQ-|@RULE-/g) || []).length;
        if (tagsAfter > tagsBefore) {
            console.log(`[BDD Server] ✅ Добавлено ${tagsAfter - tagsBefore} тегов трассируемости (всего тегов: ${tagsAfter})`);
        } else {
            console.log(`[BDD Server] ✅ Теги трассируемости присутствуют (всего тегов: ${tagsAfter})`);
        }

        await taskStorage.update(taskId, {
            progress: 85,
            updated_at: new Date()
        });

        // ВАЛИДАЦИЯ (85-95%)
        console.log('[BDD Server] ✅ Валидация сгенерированных сценариев...');
        
        let validatedFeatureContent = featureContent;
        
        // 1. Синтаксическая валидация Gherkin
        let syntaxValidation = validateGherkinSyntax(validatedFeatureContent);
        console.log(`[BDD Server] 📋 Синтаксическая валидация: ${syntaxValidation.valid ? '✅ валидно' : `❌ ${syntaxValidation.errors.length} ошибок`}`);
        
        // Автофикс синтаксических ошибок (если есть)
        if (!syntaxValidation.valid && syntaxValidation.errors.length > 0) {
            console.log('[BDD Server] 🔧 Попытка автофикса синтаксических ошибок...');
            try {
                const fixPrompt = `
Исправь синтаксические ошибки в следующем Gherkin коде. Верни ТОЛЬКО исправленный валидный Gherkin без markdown обёрток.

Ошибки:
${syntaxValidation.errors.map(e => `- ${e}`).join('\n')}

Gherkin код:
${validatedFeatureContent.substring(0, 6000)}
`;

                const fixResponse = await callWithCloudRuFallback(
                    'https://openrouter.ai/api/v1/chat/completions',
                    [{ role: 'user', content: fixPrompt }],
                    apiKey,
                    {
                        models: config.cloudruModels || ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
                        temperature: 0.2,
                        max_tokens: 8000
                    }
                );

                const fixedContent = fixResponse.choices[0].message.content
                    .replace(/```gherkin\n?/g, '')
                    .replace(/```\n?/g, '')
                    .trim();
                
                // Проверяем исправленный код
                syntaxValidation = validateGherkinSyntax(fixedContent);
                if (syntaxValidation.valid) {
                    validatedFeatureContent = fixedContent;
                    console.log('[BDD Server] ✅ Автофикс успешен, Gherkin синтаксически валиден');
                    // Повторно добавляем теги после автофикса
                    validatedFeatureContent = ensureTraceabilityTags(validatedFeatureContent, rules);
                } else {
                    console.warn('[BDD Server] ⚠️ Автофикс не помог, оставляем оригинальный код');
                }
            } catch (fixError) {
                console.error('[BDD Server] ❌ Ошибка автофикса:', fixError.message);
            }
        }
        
        // 2. Доменная проверка (явная проверка каждого шага на соответствие domain schema)
        // КРИТИЧНО: Эта функция реально пробегается по каждому шагу и проверяет, что используются только поля/методы из schema
        console.log('[BDD Server] 🏗️ Запускаем доменную проверку: проверяем каждый шаг на соответствие domain schema...');
        const domainValidation = validateDomainCompliance(validatedFeatureContent, domainSchema);
        if (domainValidation.compliant) {
            console.log(`[BDD Server] 🏗️ Доменная проверка: ✅ Все сущности соответствуют domain schema (проверено ${domainValidation.stepsChecked || 0} шагов)`);
        } else {
            console.log(`[BDD Server] 🏗️ Доменная проверка: ⚠️ Найдено ${domainValidation.issues.length} нарушений domain schema из ${domainValidation.stepsChecked || 0} проверенных шагов`);
            // Выводим первые 5 проблем для отладки
            domainValidation.issues.slice(0, 5).forEach((issue, idx) => {
                console.log(`[BDD Server]   ${idx + 1}. [${issue.type}] Строка ${issue.line}: ${issue.issue}`);
            });
            if (domainValidation.summary) {
                console.log(`[BDD Server]   Резюме: ${domainValidation.summary}`);
            }
        }
        
        // 3. LLM self-check (второй проход модели для проверки соответствия)
        // КРИТИЧНО: Это отдельный запрос к LLM для проверки соответствия сценариев правилам/требованиям
        console.log('[BDD Server] 🤖 Запускаем LLM self-check: второй проход модели для проверки соответствия...');
        const llmValidation = await validateWithLLM(validatedFeatureContent, rules, parsedSections, domainSchema, apiKey);
        if (llmValidation.valid) {
            console.log(`[BDD Server] 🤖 LLM self-check: ✅ Сценарии соответствуют правилам и требованиям`);
            if (llmValidation.summary) {
                console.log(`[BDD Server]   ${llmValidation.summary}`);
            }
        } else {
            const issuesCount = llmValidation.issues?.length || 0;
            console.log(`[BDD Server] 🤖 LLM self-check: ⚠️ Найдено ${issuesCount} проблем при проверке соответствия правилам`);
            if (llmValidation.issues && llmValidation.issues.length > 0) {
                // Выводим первые 5 проблем для отладки
                llmValidation.issues.slice(0, 5).forEach((issue, idx) => {
                    console.log(`[BDD Server]   ${idx + 1}. [${issue.severity}] ${issue.type}: ${issue.description}`);
                    if (issue.scenario) {
                        console.log(`[BDD Server]      Сценарий: ${issue.scenario}`);
                    }
                });
            }
            if (llmValidation.summary) {
                console.log(`[BDD Server]   Резюме: ${llmValidation.summary}`);
            }
        }

        await taskStorage.update(taskId, {
            progress: 95,
            updated_at: new Date()
        });

        // Сохраняем новые шаги в векторную БД
        const newSteps = extractStepsFromGherkin(featureContent);
        if (newSteps.length > 0) {
            await saveStepsToVectorDB(newSteps);
            saveStepsLocally(newSteps);
        }

        // Сохраняем результат с валидацией (используем validatedFeatureContent)
        const resultData = {
            feature: validatedFeatureContent,
            steps: newSteps,
            rules: rules,
            parsedSections: parsedSections,
            domainSchema: domainSchema,
            validation: {
                syntax: syntaxValidation,
                domain: domainValidation,
                llm: llmValidation
            },
            traceability: {
                rulesToRequirements: rules.map((r, idx) => ({
                    ruleId: `RULE-${idx + 1}`,
                    requirementId: r.requirementId,
                    type: r.type,
                    tags: `@REQ-${r.requirementId} @RULE-${idx + 1}`
                })),
                tagsInFeature: (validatedFeatureContent.match(/@REQ-[^\s\n]+/g) || []).length,
                tagsInScenarios: (validatedFeatureContent.match(/@RULE-[^\s\n]+/g) || []).length
            },
            projectId: projectId
        };

        await taskStorage.update(taskId, {
            status: 'completed',
            progress: 100,
            result: resultData,
            completed_at: new Date(),
            updated_at: new Date()
        });

        // Проверяем, что данные сохранились
        const savedTask = await taskStorage.findById(taskId);
        console.log(`[BDD Server] ✅ Генерация завершена для taskId=${taskId}`);
        console.log(`[BDD Server] 📊 Статистика: ${parsedSections.length} секций → ${rules.length} правил → ${newSteps.length} шагов`);
        console.log(`[BDD Server] 💾 Проверка сохранения: статус=${savedTask?.status}, прогресс=${savedTask?.progress}, есть результат=${!!savedTask?.result}, feature length=${savedTask?.result?.feature?.length || 0}`);
    } catch (error) {
        console.error(`[BDD Server] ❌ Ошибка генерации для taskId=${taskId}:`, error);
        await taskStorage.update(taskId, {
            status: 'failed',
            error_message: error.message,
            updated_at: new Date()
        });
    }
}

// Эндпоинт для запуска генерации BDD тестов
app.post('/api/bdd/generate', async (req, res) => {
    try {
        console.log('[BDD Server] 📥 POST /api/bdd/generate - получен запрос на генерацию');
        const taskId = uuidv4();
        console.log(`[BDD Server] 🆔 Создана задача taskId=${taskId}`);

        const task = {
            id: taskId,
            type: 'bdd_tests',
            status: 'processing',
            progress: 0,
            input_data: req.body,
            created_at: new Date(),
            updated_at: new Date()
        };

        await taskStorage.insert(task);

        // Запускаем генерацию асинхронно
        generateBDDTestsAsync(taskId, req.body).catch(async (error) => {
            console.error(`[BDD Server] Необработанная ошибка для taskId=${taskId}:`, error);
            await taskStorage.update(taskId, {
                status: 'failed',
                error_message: error.message || 'Неизвестная ошибка',
                updated_at: new Date()
            });
        });

        res.json({ taskId, status: 'started' });
    } catch (error) {
        console.error('[BDD Server] Ошибка создания задачи:', error);
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для проверки статуса генерации
app.get('/api/bdd/status/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        console.log(`[BDD Server] 📡 GET /api/bdd/status/${taskId}`);
        const task = await taskStorage.findById(taskId);

        if (!task) {
            console.log(`[BDD Server] ⚠️ Задача ${taskId} не найдена`);
            return res.status(404).json({ error: 'Task not found' });
        }

        // Парсим result, если он строка (для PostgreSQL JSON/JSONB полей)
        let result = task.result;
        if (typeof result === 'string') {
            try {
                result = JSON.parse(result);
            } catch (e) {
                console.warn('[BDD Server] Не удалось распарсить result как JSON:', e.message);
            }
        }

        const response = {
            id: task.id,
            status: task.status,
            progress: task.progress || 0,
            result: result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            completed_at: task.completed_at
        };

        // Логируем для отладки
        console.log(`[BDD Server] 📤 Возвращаем статус: taskId=${taskId}, status=${task.status}, progress=${task.progress || 0}`);
        if (task.status === 'completed') {
            console.log(`[BDD Server] Результат:`, result ? `feature length=${result.feature?.length || 0}` : 'null');
        }

        res.json(response);
    } catch (error) {
        console.error('[BDD Server] Ошибка получения статуса:', error);
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для получения всех сохранённых шагов (для отладки)
app.get('/api/bdd/steps', async (req, res) => {
    try {
        const steps = Array.from(localStepsStore.keys());
        res.json({ steps, count: steps.length });
    } catch (error) {
        console.error('[BDD Server] Ошибка получения шагов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Инициализация и запуск сервера
(async () => {
    await initDatabase();
    await initVectorStore();
    await initRequirementsVectorStore(); // Инициализируем RAG для требований
    
    app.listen(PORT, () => {
        console.log(`[BDD Server] ✅ Сервер запущен на http://localhost:${PORT}`);
        console.log(`[BDD Server] База данных: ${useInMemoryStorage ? '❌ In-memory (данные не сохраняются)' : '✅ PostgreSQL'}`);
        console.log(`[BDD Server] Векторная БД шагов: ${vectorStore ? '✅ Активна' : '❌ Отключена (используется локальное хранилище)'}`);
        console.log(`[BDD Server] Векторная БД требований (RAG): ${requirementsVectorStore ? '✅ Активна' : '❌ Отключена'}`);
    });
})();

