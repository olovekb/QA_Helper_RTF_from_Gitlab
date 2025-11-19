# 🏗️ АРХИТЕКТУРНЫЕ УЛУЧШЕНИЯ V2

## 📋 Обзор

Это новая версия генератора тест-кейсов с **5 критическими улучшениями**:

1. **Жёсткие JSON Schema** для каждого слоя тестов
2. **API-DSL парсер** для извлечения и валидации API спецификации
3. **Агрессивный нормализатор** для автоматического исправления типичных ошибок
4. **Многофазная генерация** (E2E → Integration → Unit)
5. **Ревью-агент** (Self-Critique) для второго прохода проверки

---

## 🗂️ Структура проекта

```
server/
├── schemas/
│   └── test-case-schemas.mjs         # JSON Schema для каждого layer
├── parsers/
│   └── api-spec-parser.mjs           # Парсинг API из требований
├── normalizers/
│   └── test-case-normalizer.mjs      # Auto-fix типичных ошибок
├── agents/
│   └── review-agent.mjs              # Self-critique агент
├── generators/
│   └── multi-phase-generator.mjs     # Многофазная генерация
├── generate-test-cases-v2.mjs        # ⭐ Главная функция V2
└── server.js                         # Основной сервер (интеграция)
```

---

## 📚 МОДУЛЬ 1: JSON Schema

**Файл:** `server/schemas/test-case-schemas.mjs`

### Что делает:
- Определяет **строгие** JSON Schema для каждого слоя:
  - `E2E_TEST_SCHEMA`
  - `INTEGRATION_FRONTEND_SCHEMA`
  - `INTEGRATION_BACKEND_SCHEMA`
  - `UNIT_FRONTEND_SCHEMA`
- Валидирует тест-кейсы по схемам

### Примеры правил:

#### E2E Tests:
```javascript
{
  layer: "E2E Tests",
  steps: { minItems: 3 },                    // Минимум 3 шага
  scenario: null,                            // НЕ должен иметь scenario
  code: null,                                // НЕ должен иметь code
  priority: "High",                          // Всегда High
  expected: "**Отображается**...",           // НЕ "Возвращается"
  steps: {
    not: { pattern: "Выполнить (GET|POST)" } // БЕЗ HTTP-методов!
  }
}
```

#### Integration Backend Tests:
```javascript
{
  layer: "Integration backend Tests",
  steps: {
    minItems: 1,
    maxItems: 3,
    pattern: "^Выполнить (GET|POST|PUT|DELETE|PATCH) \\*\\*/" // ОБЯЗАТЕЛЬНО HTTP-методы с жирным!
  },
  expected: "**Возвращается** {код}...",     // ОБЯЗАТЕЛЬНО с кодом ответа
  precondition: "Сервер доступен"
}
```

### Использование:
```javascript
import { validateTestCases } from './schemas/test-case-schemas.mjs';

const result = validateTestCases(testCases);

if (!result.valid) {
  console.log(`Ошибок: ${result.totalErrors}`);
  result.failedTests.forEach(failed => {
    console.log(`${failed.title}: ${failed.errors.join(', ')}`);
  });
}
```

---

## 📚 МОДУЛЬ 2: API-DSL парсер

**Файл:** `server/parsers/api-spec-parser.mjs`

### Что делает:
- Парсит API секцию из требований
- Извлекает эндпоинты с параметрами и JSON структурами
- Валидирует Codes из модели против спецификации
- Детектирует **выдуманные API** от LLM

### Форматы парсинга:

#### Structured Format:
```
3.1. Получение списка категорий
- Метод: GET
- URL: /api/v1/images/categories
- Ответ (200 OK): [{"id": 1, "name": "..."}]
```

#### Inline Format:
```
GET /api/v1/images/categories → 200 OK: [{"id": 1, "name": "..."}]
```

### Использование:
```javascript
import { parseAPISpecification, validateCodeAgainstAPISpec } from './parsers/api-spec-parser.mjs';

const apiSpec = parseAPISpecification(requirements);
console.log(`Найдено эндпоинтов: ${apiSpec.endpoints.length}`);

// Валидация Code против API Spec
const validation = validateCodeAgainstAPISpec("GET **/api/fake**", apiSpec);
if (!validation.valid) {
  console.log(validation.errors); // ["API эндпоинт GET /api/fake НЕ найден в требованиях! Это выдумка LLM!"]
}
```

---

## 📚 МОДУЛЬ 3: Агрессивный нормализатор

**Файл:** `server/normalizers/test-case-normalizer.mjs`

### Что делает:
- Автоматически исправляет типичные ошибки LLM
- Добавляет обязательные поля (`id`, `version`, `priority`, `tags`, `precondition`)
- Исправляет `expected` (добавляет жирное ключевое слово)
- Убирает запрещённые слова ("Попытаться", "Дождаться", "Проверить")
- Разбивает составные Codes на атомарные
- Генерирует Unit тесты для всех frontend кодов

### Примеры исправлений:

#### До нормализации:
```json
{
  "title": "Проверка загрузки",
  "steps": ["Попытаться загрузить файл", "Выполнить GET /api/upload"],
  "expected": "Отображается успешное сообщение"
}
```

#### После нормализации:
```json
{
  "id": "tc-if-001",
  "title": "Проверка загрузки",
  "version": "stable",
  "priority": "Medium",
  "tags": ["D"],
  "precondition": "Пользователь авторизован",
  "steps": ["Загрузить файл", "Выполнить GET **/api/upload**"],
  "expected": "**Отображается** успешное сообщение"
}
```

### Использование:
```javascript
import { normalizeTestCases, generateUnitTestsForAllFrontendCodes } from './normalizers/test-case-normalizer.mjs';

// Нормализация
const normalized = normalizeTestCases(testCases, { testModel, apiSpec });

// Генерация Unit тестов
const unitTests = generateUnitTestsForAllFrontendCodes(testModel);
```

---

## 📚 МОДУЛЬ 4: Ревью-агент (Self-Critique)

**Файл:** `server/agents/review-agent.mjs`

### Что делает:
- Второй проход LLM для критики сгенерированных тест-кейсов
- Проверяет соответствие стайл-гайду
- Находит недостающие Unit тесты
- Исправляет ошибки

### Процесс ревью:
1. Анализирует ВСЕ тест-кейсы и модель
2. Находит ВСЕ ошибки и несоответствия
3. Исправляет и возвращает исправленные тест-кейсы

### Формат ответа:
```json
{
  "issues": [
    {"severity": "critical", "testId": "...", "field": "expected", "problem": "...", "fix": "..."}
  ],
  "fixedTestCases": [...],
  "additionalUnitTests": [...],
  "statistics": {
    "totalIssues": 10,
    "criticalIssues": 3,
    "fixedAutomatically": 7
  }
}
```

### Использование:
```javascript
import { reviewTestCases, mergeReviewResults } from './agents/review-agent.mjs';

const reviewResult = await reviewTestCases(testCases, testModel, requirements, apiSpec);
const finalTestCases = mergeReviewResults(testCases, reviewResult);
```

---

## 📚 МОДУЛЬ 5: Многофазная генерация

**Файл:** `server/generators/multi-phase-generator.mjs`

### Что делает:
- Разделяет генерацию на отдельные фазы
- Каждая фаза — отдельный вызов LLM с меньшим контекстом
- Улучшает качество и уменьшает размер промпта

### Фазы:

#### Фаза 1: E2E Tests
```javascript
{
  name: 'E2E Tests',
  order: 1,
  description: 'Генерация E2E тестов (полный путь пользователя)',
  contextRequired: ['testModel', 'requirements', 'sharedSteps'],
  maxTokens: 8000,
  temperature: 0
}
```

#### Фаза 2: Integration Frontend Tests
```javascript
{
  name: 'Integration Frontend Tests',
  order: 2,
  description: 'Генерация Integration Frontend тестов (атомарные UI проверки)',
  contextRequired: ['testModel', 'requirements', 'e2eTests'],
  maxTokens: 12000,
  temperature: 0
}
```

#### Фаза 3: Integration Backend Tests
```javascript
{
  name: 'Integration Backend Tests',
  order: 3,
  description: 'Генерация Integration Backend тестов (API проверки)',
  contextRequired: ['testModel', 'requirements', 'apiSpec'],
  maxTokens: 10000,
  temperature: 0
}
```

#### Фаза 4: Unit Frontend Tests
```javascript
{
  name: 'Unit Frontend Tests',
  order: 4,
  description: 'Генерация Unit Frontend тестов (заглушки для каждого Code)',
  contextRequired: ['testModel'],
  maxTokens: 5000,
  temperature: 0
}
```

### Использование:
```javascript
import { planPhases, updatePhaseContext, buildPhasePrompt } from './generators/multi-phase-generator.mjs';

const phases = planPhases({ testModel, requirements, apiSpec, sharedSteps });

for (let i = 0; i < phases.length; i++) {
  const phase = phases[i];
  updatePhaseContext(phases, i, previousResults);
  
  const prompt = buildPhasePrompt(phase, phase.context);
  // ... вызов LLM ...
}
```

---

## 🚀 ГЛАВНАЯ ФУНКЦИЯ: `generateTestCasesV2`

**Файл:** `server/generate-test-cases-v2.mjs`

### Полный пайплайн:

```
1. Парсинг API спецификации
   ↓
2. Разделение составных Codes
   ↓
3. Валидация Model vs API Spec
   ↓
4. Многофазная генерация (E2E → Integration → Unit)
   ↓
5. Автоматическая генерация Unit тестов для всех frontend Codes
   ↓
6. Агрессивная нормализация
   ↓
7. Валидация по JSON Schema
   ↓
8. Ревью-агент (Self-Critique)
   ↓
9. Финальная валидация
```

### Использование:

```javascript
import { generateTestCasesV2 } from './generate-test-cases-v2.mjs';

const result = await generateTestCasesV2({
  requirements: "...",
  testModel: [...],
  projectId: 2523,
  skipAllureAPICalls: true,
  sharedSteps: [...],
  onProgress: ({ progress, message }) => {
    console.log(`[${progress}%] ${message}`);
  }
});

console.log(`Сгенерировано ${result.testCases.length} тест-кейсов`);
console.log(`Ошибок Schema: ${result.validationResult.totalErrors}`);
console.log(`Проблем от ревью: ${result.reviewResult.statistics.totalIssues}`);
```

---

## 📊 СТАТИСТИКА

Пример вывода после генерации:

```
═══════════════════════════════════════════════════════════════
📊 СТАТИСТИКА ГЕНЕРАЦИИ:
═══════════════════════════════════════════════════════════════
⏱️  Время: 45.3s
📝 Всего тест-кейсов: 28
   - E2E: 5
   - Integration Frontend: 10
   - Integration Backend: 8
   - Unit Frontend: 5
🔧 API Эндпоинтов: 7
🧩 Frontend Кодов: 5
🤖 Auto-генерировано Unit: 5
⚠️  Ошибок Schema: 0
🔍 Проблем от ревью-агента: 3
═══════════════════════════════════════════════════════════════
```

---

## 🔧 ИНТЕГРАЦИЯ В СУЩЕСТВУЮЩИЙ СЕРВЕР

Чтобы использовать новую архитектуру в `debug-agent.mjs` или `server.js`:

```javascript
// В debug-agent.mjs или server.js
import { generateTestCasesV2 } from './generate-test-cases-v2.mjs';

// Заменяем старую генерацию на новую:
const result = await generateTestCasesV2({
  requirements,
  testModel,
  projectId,
  skipAllureAPICalls,
  sharedSteps,
  onProgress
});

// Используем result.testCases для дальнейшей обработки
```

---

## ✅ ПРЕИМУЩЕСТВА

### 1. **Качество**
- Жёсткие схемы валидации
- Автоматическое исправление ошибок
- Двойная проверка (генерация + ревью)

### 2. **Надёжность**
- Детектирование выдуманных API
- Валидация против требований
- Автоматическое покрытие Unit тестами

### 3. **Скорость**
- Многофазная генерация (меньший контекст = быстрее)
- Параллельная генерация фаз (потенциально)
- Автоматическая генерация Unit (без LLM)

### 4. **Прозрачность**
- Детальная статистика
- Логирование каждого шага
- Понятные ошибки с объяснениями

---

## 🧪 ТЕСТИРОВАНИЕ

### Запуск отладки с новой архитектурой:

```bash
# 1. Обновить debug-agent.mjs для использования V2
# 2. Перезапустить сервер
npm start

# 3. Запустить debug
cd server && node run-debug.mjs
```

### Ожидаемый результат:
- `score >= 80`
- `errors = 0`
- Все тест-кейсы проходят Schema валидацию
- Нет выдуманных API эндпоинтов

---

## 📝 TODO

- [ ] Интегрировать `generateTestCasesV2` в `debug-agent.mjs`
- [ ] Завершить `generatePhaseTestCases` (вызов LLM)
- [ ] Добавить параллельную генерацию фаз
- [ ] Добавить кэширование API спецификации
- [ ] Улучшить ревью-агента (добавить Few-Shot примеры)

---

## 🎯 СЛЕДУЮЩИЕ ШАГИ

1. **Протестировать каждый модуль отдельно**
2. **Интегрировать V2 в debug-agent.mjs**
3. **Запустить итерацию #2**
4. **Сравнить результаты с итерацией #1**
5. **Продолжить улучшения на основе feedback**

---

*Создано: 18 ноября 2025*
*Версия: 2.0.0*

