# 🎯 ДИНАМИЧЕСКАЯ ВАЛИДАЦИЯ (вместо хардкода)

## 🚨 ПРОБЛЕМА БЫЛА:

### **Хардкоженный блэклист:**
```javascript
// ❌ ПЛОХО: работает ТОЛЬКО для "Управление изображениями"
const BLACKLIST_PATTERNS = [
    { pattern: /\?search=/i, error: "Query-параметр ?search= НЕ описан..." },
    { pattern: /204\s+No\s+Content/i, error: "Статус 204..." },
    { pattern: /"count":/i, error: 'Поле "count" НЕ описано...' }
];
```

### **Проблемы:**
1. ❌ Если в других требованиях **ЕСТЬ** `?search=` - **ложное срабатывание**
2. ❌ Если в других требованиях **ЕСТЬ** `204` - **ложное срабатывание**
3. ❌ Если в других требованиях **ЕСТЬ** поле `count` - **ложное срабатывание**
4. ❌ Нужно вручную обновлять блэклист для каждого проекта

---

## ✅ РЕШЕНИЕ: Динамическая валидация

### **Принцип:**
Вместо хардкода проверяем **"есть ли это в распарсенной API спецификации"**.

### **Как работает:**

#### **Шаг 1: Парсинг API спецификации**
```javascript
const apiSpec = parseAPISpecification(requirements);
// Извлекает:
// - endpoints: [{method: "GET", url: "/api/v1/images/categories", ...}]
// - responses: [{statusCode: "200", body: {id, name}}]
// - parameters: [{name: "categoryId", type: "path"}]
```

#### **Шаг 2: Динамическая проверка**
```javascript
const check = checkAgainstAPISpec(code.text, apiSpec);
// Проверяет:
// 1. Эндпоинт есть в apiSpec.endpoints?
// 2. Query-параметр описан для этого эндпоинта?
// 3. Статус-код есть в apiSpec.responses?
// 4. JSON поле есть в apiSpec.responses[].body?
```

---

## 📊 ПРИМЕРЫ:

### **Пример 1: Проект "Управление изображениями"**

**Требования:**
```
API:
GET /api/v1/images/categories
  → 200 OK: [{"id": 1, "name": "..."}]
```

**Code 1 (правильный):**
```
GET **/api/v1/images/categories**
Возвращается 200 OK с [{id, name}]
```
✅ **Валидация:** OK (эндпоинт, статус 200, поля id/name найдены)

**Code 2 (выдуманный):**
```
GET **/api/v1/images/categories?search=logo**
Возвращается 200 OK с [{id, name, count}]
```
❌ **Валидация:** 
- Query-параметр `?search=` НЕ описан для `GET /api/v1/images/categories`!
- Поле `"count"` НЕ описано в response!

---

### **Пример 2: Другой проект с query-параметрами**

**Требования:**
```
API:
GET /api/users?search={text}&role={role}
  → 200 OK: [{"id": 1, "name": "...", "count": 10}]
  → 204 No Content
```

**Code 1 (правильный):**
```
GET **/api/users?search=John&role=admin**
Возвращается 200 OK с [{id, name, count}]
```
✅ **Валидация:** OK (эндпоинт, query-параметры search/role, статус 200, поля id/name/count найдены)

**Code 2 (правильный):**
```
GET **/api/users**
Возвращается 204 No Content
```
✅ **Валидация:** OK (эндпоинт, статус 204 описан)

**Code 3 (выдуманный):**
```
GET **/api/users?filter=active**
Возвращается 200 OK с [{id, name, email}]
```
❌ **Валидация:** 
- Query-параметр `?filter=` НЕ описан для `GET /api/users`!
- Поле `"email"` НЕ описано в response!

---

## 🔍 ЧТО ПРОВЕРЯЕТСЯ:

### **1. HTTP Методы и эндпоинты**
```javascript
// Ищем: GET **/api/v1/images/categories**
const endpoint = findEndpoint(apiSpec.endpoints, "GET", "/api/v1/images/categories");
if (!endpoint) {
    errors.push("❌ API эндпоинт GET /api/v1/images/categories НЕ найден!");
}
```

### **2. Query-параметры**
```javascript
// Ищем: GET **/api/categories?search=logo**
const queryParams = extractQueryParams("search=logo");
for (const qp of queryParams) {
    const hasParam = endpoint.parameters?.some(p => p.name === qp);
    if (!hasParam) {
        errors.push("❌ Query-параметр ?search= НЕ описан!");
    }
}
```

### **3. Статус-коды**
```javascript
// Ищем: 204 No Content
const hasStatus = apiSpec.endpoints.some(ep => 
    ep.responses?.some(r => r.statusCode === "204")
);
if (!hasStatus) {
    errors.push("❌ Статус 204 No Content НЕ описан!");
}
```

### **4. JSON поля**
```javascript
// Ищем: {"id": 1, "name": "...", "count": 10}
const mentionedFields = ["id", "name", "count"];
for (const field of mentionedFields) {
    const hasField = apiSpec.endpoints.some(ep => 
        ep.responses?.some(r => hasFieldInJSON(r.body, field))
    );
    if (!hasField) {
        errors.push(`⚠️ Поле "${field}" НЕ описано в API response!`);
    }
}
```

---

## 🚀 УНИВЕРСАЛЬНОСТЬ:

### **✅ Работает для ЛЮБЫХ требований:**

| Проект | API в требованиях | Валидация |
|--------|-------------------|-----------|
| Управление изображениями | `GET /api/v1/images/categories` БЕЗ query | ✅ Блокирует `?search=` |
| Поиск пользователей | `GET /api/users?search={text}` С query | ✅ Разрешает `?search=` |
| REST API с PATCH | `PATCH /api/items/{id}` | ✅ Разрешает PATCH |
| REST API БЕЗ PATCH | Только GET/POST/PUT/DELETE | ✅ Блокирует PATCH |

### **✅ Автоматическая адаптация:**
- Парсится API секция из требований
- Извлекаются все легитимные эндпоинты, методы, параметры, поля
- Валидация проверяет только то, что реально описано

---

## 💡 ОПЦИОНАЛЬНАЯ ПРОВЕРКА БИЗНЕС-ЛОГИКИ:

```javascript
// Опционально: можно отключить если требования всегда полные
const businessPatterns = [
    { pattern: /\bправ[аы]|роле[йи]|permission/i, term: 'права/роли' },
    { pattern: /\bаутентификаци|authentication/i, term: 'аутентификация' }
];

for (const bp of businessPatterns) {
    if (bp.pattern.test(text)) {
        errors.push(`⚠️ Упоминается тема "${bp.term}", которая может отсутствовать`);
    }
}
```

---

## 📋 КАК ИСПОЛЬЗОВАТЬ:

### **В debug-agent.mjs:**
```javascript
// 1. Парсим API спецификацию
const apiSpec = parseAPISpecification(requirements);

// 2. Проверяем модель
for (const code of scenario.codes) {
    const check = checkBlacklist(code.text, apiSpec); // Передаём apiSpec!
    if (!check.valid) {
        console.log(check.errors);
    }
}

// 3. Проверяем тест-кейсы
for (const tc of testCases) {
    const check = checkBlacklist(tc.steps.join(' '), apiSpec);
    if (!check.valid) {
        console.log(check.errors);
    }
}
```

### **В промпте:**
```javascript
const apiPrompt = formatAPISpecForPrompt(apiSpec);
// Автоматически добавляет:
// - Список всех эндпоинтов
// - Список всех допустимых методов
// - Список всех допустимых статус-кодов
// - Список всех допустимых JSON полей
```

---

## 🎉 РЕЗУЛЬТАТ:

### **Без динамической валидации:**
- ❌ Хардкод под конкретный проект
- ❌ Ложные срабатывания на других проектах
- ❌ Нужно вручную обновлять блэклист

### **С динамической валидацией:**
- ✅ Универсально для ЛЮБЫХ требований
- ✅ Автоматическая адаптация
- ✅ Точная детекция выдуманных вещей
- ✅ Нет ложных срабатываний

---

## 📝 ФАЙЛЫ:

- `server/parsers/api-spec-parser.mjs` - парсинг + динамическая валидация
- `server/debug-agent.mjs` - использование валидации
- `server/generate-test-cases-v2.mjs` - полный пайплайн

---

*Создано: 18 ноября 2025*
*Версия: 2.1.0 - Динамическая валидация*

