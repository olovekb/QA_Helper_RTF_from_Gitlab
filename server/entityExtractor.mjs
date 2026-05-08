// entityExtractor.mjs - Извлечение сущностей и связей из текста требований
// Двухуровневый граф: Document → Section → Chunk + Сущности (RequirementFragment, ScenarioSeed, APIEndpoint, etc.)

import { callCloudRuAPI } from './cloudruClient.mjs';

// Типы узлов (по graph.md)
const ENTITY_TYPES = [
  'RequirementFragment', 
  'ScenarioSeed',  // новое: сценарное зерно
  'APIEndpoint', 
  'ResponseParam', 
  'UIElement', 
  'BusinessRule', 
  'ExternalRef'
];

// Типы связей (по graph.md)
const RELATIONSHIP_TYPES = [
  'EXTRACTED_FROM',      // RequirementFragment извлечен из Chunk
  'SEEDED_FROM',         // ScenarioSeed создано из RequirementFragment
  'USES_METHOD',         // RequirementFragment использует API
  'RETURNS_PARAM',       // API возвращает параметр
  'CONTROLS_UI',         // BusinessRule управляет UI
  'REFERENCES',          // ссылка на ExternalRef или другой RequirementFragment
  'DEPENDS_ON',          // зависимость
  'LOCATED_IN_CHUNK'     // сущность находится в чанке
];

const GRAPH_ENTITY_EXTRACTION_MODELS = [
  'Qwen/Qwen3-235B-A22B-Instruct-2507',
  'Qwen/Qwen3-Coder-Next'
];

function parseEntityExtractionContent(content) {
  const cleaned = String(content || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  if (!cleaned) {
    const error = new Error('empty_response');
    error.reason = 'empty_response';
    throw error;
  }

  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.entities) || !Array.isArray(parsed.relationships)) {
    const error = new Error('invalid_structure');
    error.reason = 'invalid_structure';
    throw error;
  }

  return parsed;
}

async function extractEntitiesWithModelFallback(messages, options = {}) {
  const {
    maxTokens = 4000,
    chunkId,
    documentId,
    llmClient = callCloudRuAPI,
    models = GRAPH_ENTITY_EXTRACTION_MODELS
  } = options;
  const attempts = [];
  const modelsToTry = Array.isArray(models) && models.length > 0
    ? models.slice(0, 2)
    : GRAPH_ENTITY_EXTRACTION_MODELS;

  for (const model of modelsToTry) {
    const attempt = {
      model,
      status: 'failed',
      reason: null,
      finishReason: null,
      contentLength: 0
    };
    attempts.push(attempt);

    try {
      const response = await llmClient(messages, {
        model,
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        useResponseFormatForCloudRu: true
      });

      attempt.finishReason = response.choices?.[0]?.finish_reason || null;
      const content = response.choices?.[0]?.message?.content || '';
      attempt.contentLength = content.length;
      const parsed = parseEntityExtractionContent(content);

      const entities = (parsed.entities || [])
        .filter(e => ENTITY_TYPES.includes(e.type) && e.name)
        .map(e => ({
          ...e,
          sourceChunkId: chunkId,
          sourceDocumentId: documentId
        }));

      const relationships = (parsed.relationships || [])
        .filter(r =>
          RELATIONSHIP_TYPES.includes(r.relType) &&
          r.fromName && r.fromType && r.toName && r.toType
        );

      if (entities.length === 0) {
        attempt.reason = 'no_entities_extracted';
        continue;
      }

      attempt.status = 'success';
      return {
        entities,
        relationships,
        diagnostics: {
          status: 'success',
          reason: null,
          attempts,
          modelUsed: model
        }
      };
    } catch (error) {
      attempt.reason = error.reason || (error.message === 'empty_response' ? 'empty_response' : 'json_parse_failed');
      attempt.errorMessage = error.message;
      console.error(`[entityExtractor] РћС€РёР±РєР° РјРѕРґРµР»Рё ${model}:`, error.message);
    }
  }

  const lastAttempt = attempts[attempts.length - 1] || {};
  return {
    entities: [],
    relationships: [],
    diagnostics: {
      status: 'failed',
      reason: lastAttempt.reason || 'extraction_failed',
      attempts,
      modelUsed: null
    }
  };
}

export async function extractEntitiesAndRelationships(text, options = {}) {
  const {
    maxTokens = 4000,
    chunkId,
    documentId,
    llmClient = callCloudRuAPI,
    models = GRAPH_ENTITY_EXTRACTION_MODELS
  } = options;
  
  if (!text || !text.trim()) {
    console.log('[entityExtractor] ⚠️ Пустой текст, пропускаем извлечение сущностей');
    return { entities: [], relationships: [] };
  }
  
  console.log('[entityExtractor] 🔍 Начинаем извлечение сущностей из текста...');
  console.log(`[entityExtractor] 📏 Длина текста: ${text.length} символов`);
  
  const SYSTEM_PROMPT = `Ты — эксперт по извлечению структурированной информации из требований.
Извлеки сущности и их связи из текста требований.

ТИПЫ СУЩНОСТЕЙ (узлы графа):
- RequirementFragment: фрагмент требования (описание функции, бизнес-логика, сценарий)
- ScenarioSeed: сценарное зерно - минимальная сценарная гипотеза из требования. Примеры:
  * "отображение рекомендаций при открытии модального окна смены пароля"
  * "проверка текста подсказки при пустом ответе метода"
  * "проверка отображения строк рекомендаций в зависимости от параметров ответа"
- APIEndpoint: API-эндпоинт (endpoint, метод, URL, описание)
- ResponseParam: параметр ответа API (поле, тип, описание)
- UIElement: UI-элемент (кнопка, поле, список, секция, название интерфейса)
- BusinessRule: бизнес-правило (валидация, ограничение, условие)
- ExternalRef: внешняя ссылка (документ, ссылка на требование, спецификация)

ТИПЫ СВЯЗЕЙ (ребра графа):
- EXTRACTED_FROM: RequirementFragment извлечен из Chunk (источник)
- SEEDED_FROM: ScenarioSeed создано из RequirementFragment (сценарная гипотеза)
- USES_METHOD: RequirementFragment использует APIEndpoint
- RETURNS_PARAM: APIEndpoint возвращает ResponseParam
- CONTROLS_UI: BusinessRule управляет UIElement
- REFERENCES: RequirementFragment ссылается на ExternalRef или другой RequirementFragment
- DEPENDS_ON: ScenarioSeed зависит от BusinessRule, ResponseParam или UIElement
- LOCATED_IN_CHUNK: сущность находится в конкретном чанке

ПРАВИЛА:
1. Извлекай ТОЛЬКО то, что ЯВНО описано в тексте
2. Связи только между реальными сущностями
3. ScenarioSeed - это НЕ полный Scenario, а минимальная сценарная гипотеза
4. UIElement: извлекай названия кнопок, полей, разделов
5. BusinessRule: валидации, условия, ограничения
6. ExternalRef: ссылки на документы, требования, спецификации

ФОРМАТ ОТВЕТА (строгий JSON):
{
  "entities": [
    {
      "type": "ScenarioSeed",
      "name": "отображение рекомендаций при открытии модального окна",
      "properties": {
        "description": "проверка отображения рекомендаций"
      }
    }
  ],
  "relationships": [
    {
      "fromName": "отображение рекомендаций при открытии модального окна",
      "fromType": "ScenarioSeed",
      "toName": "GET /api/recommendations",
      "toType": "APIEndpoint",
      "relType": "DEPENDS_ON"
    }
  ]
}`;

  const USER_PROMPT = `Извлеки сущности и связи из следующего текста требований:

${text.substring(0, 50000)}

Верни ТОЛЬКО JSON без markdown и пояснений.`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT }
  ];

  return await extractEntitiesWithModelFallback(messages, {
    maxTokens,
    chunkId,
    documentId,
    llmClient,
    models
  });
}

export async function extractEntitiesFromChunks(chunks, options = {}) {
  const {
    sessionId,
    documentId,
    llmClient = callCloudRuAPI,
    models = GRAPH_ENTITY_EXTRACTION_MODELS
  } = options;

  console.log(`[entityExtractor] graph extraction start: chunks=${chunks.length}, sessionId=${sessionId}`);

  const allEntities = [];
  const allRelationships = [];
  const diagnostics = {
    chunksTotal: chunks.length,
    chunksProcessed: 0,
    chunksSkipped: 0,
    chunksSucceeded: 0,
    chunksFailed: 0,
    parseErrors: 0,
    emptyResponses: 0,
    emptyEntityChunks: 0,
    modelsTried: {},
    chunkResults: []
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = typeof chunks[i] === 'string' ? chunks[i] : (chunks[i].text || chunks[i].content || '');
    const chunkId = chunks[i]?.chunkId || `chunk-${i}`;
    const position = chunks[i]?.position ?? i;

    if (!chunk || chunk.length < 50) {
      diagnostics.chunksSkipped++;
      diagnostics.chunkResults.push({
        chunkId,
        position,
        status: 'skipped',
        reason: 'too_short',
        attempts: [],
        modelUsed: null,
        entitiesCount: 0,
        relationshipsCount: 0
      });
      continue;
    }

    diagnostics.chunksProcessed++;
    const result = await extractEntitiesAndRelationships(chunk, {
      chunkId,
      documentId,
      llmClient,
      models
    });

    const chunkDiagnostics = {
      chunkId,
      position,
      status: result.diagnostics?.status || (result.entities.length > 0 ? 'success' : 'failed'),
      reason: result.diagnostics?.reason || null,
      attempts: result.diagnostics?.attempts || [],
      modelUsed: result.diagnostics?.modelUsed || null,
      entitiesCount: result.entities.length,
      relationshipsCount: result.relationships.length
    };
    diagnostics.chunkResults.push(chunkDiagnostics);

    if (chunkDiagnostics.status === 'success') {
      diagnostics.chunksSucceeded++;
    } else {
      diagnostics.chunksFailed++;
    }

    for (const attempt of chunkDiagnostics.attempts) {
      diagnostics.modelsTried[attempt.model] = (diagnostics.modelsTried[attempt.model] || 0) + 1;
      if (attempt.reason === 'empty_response') diagnostics.emptyResponses++;
      if (attempt.reason === 'json_parse_failed' || attempt.reason === 'invalid_structure') diagnostics.parseErrors++;
      if (attempt.reason === 'no_entities_extracted') diagnostics.emptyEntityChunks++;
    }

    for (const entity of result.entities) {
      allRelationships.push({
        fromName: entity.name,
        fromType: entity.type,
        toName: chunkId,
        toType: 'Chunk',
        relType: 'EXTRACTED_FROM'
      });
    }

    allEntities.push(...result.entities);
    allRelationships.push(...result.relationships);
  }

  const seen = new Set();
  const uniqueEntities = [];
  for (const e of allEntities) {
    const key = `${e.type}:${e.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEntities.push(e);
    }
  }

  const seenRel = new Set();
  const uniqueRelationships = [];
  for (const r of allRelationships) {
    const key = `${r.fromName}->${r.relType}->${r.toName}`;
    if (!seenRel.has(key)) {
      seenRel.add(key);
      uniqueRelationships.push(r);
    }
  }

  diagnostics.uniqueEntities = uniqueEntities.length;
  diagnostics.uniqueRelationships = uniqueRelationships.length;

  return { entities: uniqueEntities, relationships: uniqueRelationships, diagnostics };
}

export async function extractUIFromText(text) {
  // Специализированное извлечение UI-компонентов из текста
  
  const UI_EXTRACTION_PROMPT = `
Ты — эксперт по UI-анализу требований.
Извлеки из текста ТОЛЬКО те UI-компоненты и пользовательские пути, которые ЯВНО упомянуты в самом тексте.

КРИТИЧЕСКИЕ ПРАВИЛА:
1. Не придумывай элементы интерфейса, которых нет во входном тексте.
2. Не копируй примеры из инструкции в ответ.
3. Если в тексте нет явного UI-компонента или пользовательского пути, верни пустые массивы.
4. Не добавляй общие догадки вроде "Главное меню", "Создать", "ИНН", если они отсутствуют во входном тексте.
5. Для каждого элемента используй оригинальную формулировку из текста или её близкую нормализованную форму.

КЛАССЫ UI-КОМПОНЕНТОВ:
- button: кнопка или action control
- input: поле ввода или редактируемое поле
- section: раздел, вкладка, экран, блок, список
- dropdown: выпадающий список, селект, раскрываемый выбор
- checkbox: чекбокс, флажок, переключатель
- modal: модальное окно, диалог, popup, toast, уведомление

ПОЛЬЗОВАТЕЛЬСКИЙ ПУТЬ:
- Это только явно описанная последовательность действий или навигации.
- Если путь не описан пошагово, не создавай его.

ФОРМАТ JSON:
{
  "uiElements": [
    {
      "type": "button|input|section|dropdown|checkbox|modal",
      "name": "Точное имя элемента из текста",
      "context": "контекст из текста или пустая строка",
      "action": "действие из текста или пустая строка"
    }
  ],
  "userPaths": [
    {
      "name": "Краткое имя пути",
      "steps": ["Шаг 1 из текста", "Шаг 2 из текста"]
    }
  ]
}`;

  try {
    const messages = [
      { role: 'system', content: 'Ты — эксперт по UI-анализу. Возвращай только элементы, явно присутствующие во входном тексте. Ничего не придумывай и не копируй примеры из инструкции.' },
      { role: 'user', content: `${UI_EXTRACTION_PROMPT}\n\nТекст:\n${text.substring(0, 30000)}\n\nВерни JSON без markdown.` }
    ];
    
    const response = await callCloudRuAPI(messages, {
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });
    
    const content = response.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    
    return parsed;
  } catch (error) {
    console.warn('[entityExtractor] Ошибка извлечения UI:', error.message);
    return { uiElements: [], userPaths: [] };
  }
}

export function convertUIToEntities(uiExtraction, options = {}) {
  const { chunkId, documentId } = options;
  const entities = [];
  const relationships = [];
  
  // Конвертируем UI-элементы в сущности UIElement
  for (const el of uiExtraction.uiElements || []) {
    entities.push({
      type: 'UIElement',
      name: el.name,
      properties: {
        elementType: el.type,
        context: el.context,
        action: el.action
      },
      sourceChunkId: chunkId,
      sourceDocumentId: documentId
    });
  }
  
  // Конвертируем пользовательские пути в BusinessRule
  for (const path of uiExtraction.userPaths || []) {
    entities.push({
      type: 'BusinessRule',
      name: path.name,
      properties: {
        pathSteps: path.steps
      },
      sourceChunkId: chunkId,
      sourceDocumentId: documentId
    });
    
    // Создаем связи между шагами пути
    if (path.steps && path.steps.length > 1) {
      for (let i = 0; i < path.steps.length - 1; i++) {
        relationships.push({
          fromName: path.steps[i],
          fromType: 'UIElement',
          toName: path.steps[i + 1],
          toType: 'UIElement',
          relType: 'CONTROLS_UI'
        });
      }
    }
  }
  
  return { entities, relationships };
}

export { ENTITY_TYPES, RELATIONSHIP_TYPES, GRAPH_ENTITY_EXTRACTION_MODELS };
