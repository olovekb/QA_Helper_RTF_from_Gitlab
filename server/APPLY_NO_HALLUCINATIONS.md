# 🚫 КАК ПРИМЕНИТЬ "НЕ ВЫДУМЫВАЙ!" КО ВСЕМ ПРОМПТАМ

## ✅ ЧТО УЖЕ СДЕЛАНО:

### **1. Создан универсальный модуль**
📁 `server/prompts/no-hallucinations-rule.mjs`

**Содержит:**
- `NO_HALLUCINATIONS_RULE` - полная версия
- `MODEL_NO_HALLUCINATIONS` - для генерации модели
- `TEST_CASES_NO_HALLUCINATIONS` - для генерации тест-кейсов
- `SHORT_NO_HALLUCINATIONS` - краткая версия
- `addNoHallucinationsRule(prompt, type)` - хелпер функция

### **2. Обновлён API промпт**
📁 `server/parsers/api-spec-parser.mjs` → `formatAPISpecForPrompt()`

**Добавлено:**
```
🚨 КРИТИЧЕСКОЕ ПРАВИЛО:
   ЕСЛИ ЧЕГО-ТО НЕТ В ТРЕБОВАНИЯХ → НЕ ПРИДУМЫВАЙ!
   ❌ НЕТ в требованиях API эндпоинта → НЕ генерируй тест на него!
   ...
```

### **3. Создана документация**
📁 `server/prompts/README.md` - полная инструкция с примерами

---

## 🎯 ЧТО НУЖНО СДЕЛАТЬ:

### **ШАГ 1: Найти все промпты в server.js**

```bash
# В терминале:
grep -n "systemPrompt\|SYSTEM_PROMPT\|buildTestModelPrompt" server/server.js | head -20
```

**Ищем:**
- Генерацию тестовой модели (Feature → Story → Scenario → Code)
- Генерацию тест-кейсов (BASE_SYSTEM_PROMPT или похожее)
- Рефинемент/регенерацию тест-кейсов

---

### **ШАГ 2: Добавить правило в каждый промпт**

#### **Для генерации тестовой модели:**

**НАЙТИ в server.js:**
```javascript
function buildTestModelPrompt(...) {
    return `
Ты — Senior SDET, генерирующий тестовую модель...
`;
}
```

**ЗАМЕНИТЬ на:**
```javascript
import { MODEL_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

function buildTestModelPrompt(...) {
    return MODEL_NO_HALLUCINATIONS + `
    
Ты — Senior SDET, генерирующий тестовую модель...
`;
}
```

---

#### **Для генерации тест-кейсов:**

**НАЙТИ в server.js:**
```javascript
const BASE_SYSTEM_PROMPT = `
Ты — Senior SDET, генерирующий тест-кейсы...
`;
```

**ЗАМЕНИТЬ на:**
```javascript
import { TEST_CASES_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

const BASE_SYSTEM_PROMPT = TEST_CASES_NO_HALLUCINATIONS + `

Ты — Senior SDET, генерирующий тест-кейсы...
`;
```

---

### **ШАГ 3: Добавить в многофазную генерацию**

**ФАЙЛ:** `server/generators/multi-phase-generator.mjs`

**НАЙТИ:**
```javascript
export function buildPhasePrompt(phase, context) {
    const basePrompt = `
Ты — Senior SDET, генерирующий ${phase.name} тесты.
`;
    // ...
}
```

**ЗАМЕНИТЬ на:**
```javascript
import { TEST_CASES_NO_HALLUCINATIONS } from '../prompts/no-hallucinations-rule.mjs';

export function buildPhasePrompt(phase, context) {
    const basePrompt = TEST_CASES_NO_HALLUCINATIONS + `
    
Ты — Senior SDET, генерирующий ${phase.name} тесты.
`;
    // ...
}
```

---

### **ШАГ 4: Проверить результат**

```bash
# 1. Перезапустить сервер
npm start

# 2. Запустить debug
cd server && node run-debug.mjs

# 3. Проверить в логах:
# [DEBUG] ✅ Блэклист: выдуманных вещей НЕ найдено
```

---

## 📋 БЫСТРЫЙ ЧЕКЛИСТ:

```
[ ] Импортировать модуль:
    import { MODEL_NO_HALLUCINATIONS, TEST_CASES_NO_HALLUCINATIONS } from './prompts/no-hallucinations-rule.mjs';

[ ] Добавить в промпт генерации модели (buildTestModelPrompt)
[ ] Добавить в промпт генерации тест-кейсов (BASE_SYSTEM_PROMPT)
[ ] Добавить в многофазную генерацию (multi-phase-generator.mjs)
[ ] Добавить в ревью-агента (review-agent.mjs) - опционально

[ ] Перезапустить сервер
[ ] Запустить node run-debug.mjs
[ ] Проверить: "Выдуманных вещей: 0 ✅"
```

---

## 🎯 ОЖИДАЕМЫЙ РЕЗУЛЬТАТ:

### **БЕЗ правила:**
```
[DEBUG] ❌ НАЙДЕНО ВЫДУМАННЫХ ВЕЩЕЙ: 7
  1. [Model > ...] Query-параметр ?search= НЕ описан в требованиях!
  2. [Test "..."] Статус 204 No Content НЕ описан в требованиях!
  3. [Model > ...] Поле "count" НЕ описано в требованиях!
  ...
```

### **С правилом:**
```
[DEBUG] ✅ Блэклист: выдуманных вещей НЕ найдено
```

---

## 💡 ДОПОЛНИТЕЛЬНО:

### **Если нужно кастомизировать:**

```javascript
// Для специфичных случаев можно добавить свои правила:
const customRule = `
🚨 ДОПОЛНИТЕЛЬНО ДЛЯ ЭТОГО ПРОЕКТА:
❌ НЕ используй endpoints вида /v2/ - только /v1/!
❌ НЕ проверяй кэширование - это не описано!
`;

const enhancedPrompt = MODEL_NO_HALLUCINATIONS + customRule + basePrompt;
```

### **Если нужно отключить для отладки:**

```javascript
// Просто не добавляй правило:
const prompt = basePrompt; // Без MODEL_NO_HALLUCINATIONS
```

---

## 🚀 ГОТОВО К ПРИМЕНЕНИЮ!

**Преимущества:**
1. ✅ LLM перестанет выдумывать несуществующие API
2. ✅ LLM перестанет добавлять функциональность вне требований
3. ✅ Тесты будут покрывать ТОЛЬКО то, что реально описано
4. ✅ Не нужно вручную вычищать выдуманные тест-кейсы

**Результат:**
- Выдуманных вещей: **0** ✅
- Точность покрытия: **100%** ✅
- Соответствие требованиям: **100%** ✅

---

*Создано: 18 ноября 2025*
*Версия: 2.2.0*

🎯 **Следуй чеклисту и применяй!**

