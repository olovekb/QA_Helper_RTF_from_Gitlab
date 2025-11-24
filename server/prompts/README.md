# 🚫 ПРАВИЛО "НЕ ВЫДУМЫВАЙ!" - Инструкция

## 📋 Назначение

Универсальные секции промптов для **предотвращения галлюцинаций LLM**.

LLM часто "выдумывают" API эндпоинты, параметры, функциональность которых **НЕТ в требованиях**. Это правило явно запрещает это делать.

---

## 🎯 Проблема

### **Типичные галлюцинации:**

1. **Выдуманные API:**
   - Требования: `GET /api/categories`
   - LLM генерирует: `GET /api/categories?search=logo` ❌

2. **Выдуманные поля:**
   - Требования: `{id, name}`
   - LLM генерирует: `{id, name, count}` ❌

3. **Выдуманные статус-коды:**
   - Требования: `200 OK, 400 Bad Request`
   - LLM генерирует: `204 No Content` ❌

4. **Выдуманная функциональность:**
   - Требования: "Загрузка изображений"
   - LLM генерирует тесты на: "Проверка прав доступа" ❌

---

## ✅ Решение

### **3 уровня правил:**

#### **1. SHORT - Краткая версия**
```javascript
import { SHORT_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

const prompt = SHORT_NO_HALLUCINATIONS + '\n' + yourPrompt;
```

**Добавляет:**
```
🚨 НЕ ВЫДУМЫВАЙ! Генерируй ТОЛЬКО то, что ЯВНО описано в требованиях!
```

**Когда использовать:** для коротких промптов, где нужно краткое напоминание.

---

#### **2. MODEL - Для генерации тестовой модели**
```javascript
import { MODEL_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

const prompt = MODEL_NO_HALLUCINATIONS + '\n' + buildTestModelPrompt(...);
```

**Добавляет:**
```
═══════════════════════════════════════════════════════════════
🚨 ДЛЯ ТЕСТОВОЙ МОДЕЛИ: НЕ ВЫДУМЫВАЙ СЦЕНАРИИ!
═══════════════════════════════════════════════════════════════

❌ НЕ СОЗДАВАЙ Story/Scenario, которых НЕТ в требованиях!
❌ НЕ ДОБАВЛЯЙ Code для API, которые НЕ описаны!
...
```

**Когда использовать:** в промпте для генерации тестовой модели (Feature → Story → Scenario → Code).

---

#### **3. TESTCASES - Для генерации тест-кейсов**
```javascript
import { TEST_CASES_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

const prompt = TEST_CASES_NO_HALLUCINATIONS + '\n' + BASE_SYSTEM_PROMPT;
```

**Добавляет:**
```
═══════════════════════════════════════════════════════════════
🚨 ДЛЯ ТЕСТ-КЕЙСОВ: НЕ ВЫДУМЫВАЙ ШАГИ И ПРОВЕРКИ!
═══════════════════════════════════════════════════════════════

❌ НЕ СОЗДАВАЙ шаги, которые проверяют функциональность вне требований!
❌ НЕ ДОБАВЛЯЙ проверки, которые не описаны!
...
```

**Когда использовать:** в промпте для генерации тест-кейсов.

---

#### **4. FULL - Полная версия**
```javascript
import { NO_HALLUCINATIONS_RULE } from './prompts/no-hallucinations-rule.mjs';

const prompt = NO_HALLUCINATIONS_RULE + '\n' + yourPrompt;
```

**Добавляет:** полное детальное правило с примерами.

**Когда использовать:** для критичных случаев, где нужно максимальное объяснение.

---

## 🛠️ Использование

### **Вариант 1: Прямое добавление**

```javascript
import { MODEL_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

const systemPrompt = MODEL_NO_HALLUCINATIONS + `
Ты — Senior SDET, генерирующий тестовую модель...
`;
```

### **Вариант 2: Хелпер функция**

```javascript
import { addNoHallucinationsRule } from './prompts/no-hallucinations-rule.mjs';

const basePrompt = 'Ты — Senior SDET...';
const enhancedPrompt = addNoHallucinationsRule(basePrompt, 'model');
```

### **Вариант 3: В генераторе промптов**

```javascript
import { TEST_CASES_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

function buildSystemPrompt(examples, sharedSteps) {
    return TEST_CASES_NO_HALLUCINATIONS + `
    
Ты — Senior SDET...

ПРИМЕРЫ:
${examples}

SHARED STEPS:
${sharedSteps}
...
`;
}
```

---

## 📊 Примеры

### **ПРИМЕР 1: Генерация модели**

**Требования:**
```
2. Функциональность:
   2.1. Поиск изображений по категориям
   2.2. Загрузка изображений в категорию
```

**БЕЗ правила:**
```javascript
// LLM выдумывает:
{
  stories: [
    "Поиск изображений по категориям",
    "Загрузка изображений в категорию",
    "Удаление изображений из категории",  // ❌ ВЫДУМКА!
    "Редактирование метаданных изображения", // ❌ ВЫДУМКА!
    "Управление правами доступа"  // ❌ ВЫДУМКА!
  ]
}
```

**С правилом:**
```javascript
// LLM генерирует ТОЛЬКО описанное:
{
  stories: [
    "Поиск изображений по категориям",
    "Загрузка изображений в категорию"
  ]
}
```

---

### **ПРИМЕР 2: Генерация тест-кейсов**

**Требования:**
```
3. API:
   GET /api/v1/images/categories
   → 200 OK: [{"id": 1, "name": "..."}]
```

**БЕЗ правила:**
```javascript
// LLM выдумывает:
{
  steps: [
    "Выполнить GET /api/v1/images/categories?search=logo",  // ❌ ?search= выдумка!
    "Проверить статус 200 OK",
    "Проверить права доступа пользователя"  // ❌ прав НЕТ в требованиях!
  ],
  expected: "Возвращается [{id, name, count}]"  // ❌ count выдумка!
}
```

**С правилом:**
```javascript
// LLM генерирует ТОЛЬКО описанное:
{
  steps: [
    "Выполнить GET **/api/v1/images/categories**",
    "Проверить статус 200 OK"
  ],
  expected: "**Возвращается** [{id, name}]"
}
```

---

## 🔗 Интеграция

### **В server.js:**

```javascript
import { MODEL_NO_HALLUCINATIONS, TEST_CASES_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

// Для генерации модели:
function buildTestModelPrompt(requirements, structure) {
    return MODEL_NO_HALLUCINATIONS + `
    
Требования:
${requirements}

Структура:
${structure}
...
`;
}

// Для генерации тест-кейсов:
const BASE_SYSTEM_PROMPT = TEST_CASES_NO_HALLUCINATIONS + `

Ты — Senior SDET...
...
`;
```

### **В multi-phase-generator.mjs:**

```javascript
import { TEST_CASES_NO_HALLUCINATIONS } from '../prompts/no-hallucinations-rule.mjs';

function buildPhasePrompt(phase, context) {
    let basePrompt = `Ты — Senior SDET, генерирующий ${phase.name} тесты...`;
    return TEST_CASES_NO_HALLUCINATIONS + '\n\n' + basePrompt;
}
```

### **В debug-agent.mjs:**

```javascript
import { NO_HALLUCINATIONS_RULE } from './prompts/no-hallucinations-rule.mjs';

// Добавляем в начало любого промпта при генерации:
const enhancedPrompt = NO_HALLUCINATIONS_RULE + originalPrompt;
```

---

## ✅ Чеклист применения

- [ ] Добавлено в промпт генерации тестовой модели
- [ ] Добавлено в промпт генерации тест-кейсов (BASE_SYSTEM_PROMPT)
- [ ] Добавлено в промпты всех фаз (multi-phase-generator)
- [ ] Добавлено в API спецификацию (formatAPISpecForPrompt) ✅ УЖЕ ЕСТЬ
- [ ] Протестировано на реальных требованиях

---

## 📝 TODO

### **Следующие шаги:**

1. **Найти все места генерации промптов в server.js:**
   ```bash
   grep -n "systemPrompt" server/server.js
   grep -n "SYSTEM_PROMPT" server/server.js
   grep -n "buildTestModelPrompt" server/server.js
   ```

2. **Добавить правило в каждое место:**
   - Генерация тестовой модели
   - Генерация тест-кейсов (BASE_SYSTEM_PROMPT)
   - Рефинемент тест-кейсов (если есть)

3. **Протестировать:**
   ```bash
   cd server && node run-debug.mjs
   ```

4. **Проверить в логах:**
   - "Выдуманных вещей (блэклист): 0 ✅"

---

*Создано: 18 ноября 2025*
*Версия: 2.2.0 - Правило "НЕ ВЫДУМЫВАЙ!"*



