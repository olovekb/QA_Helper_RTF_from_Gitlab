// Новая версия buildTestCaseSystemPrompt и buildCovenant
// Этот файл - временный, для копирования кода

function buildTestCaseSystemPrompt({
    mode = 'FULL',
    includeBackendTests = true,
    scenariosCount = 0,
    storiesCount = 0,
    featuresCount = 1,
    targetLayer = null
}) {
    // ═══════════════════════════════════════════════════════════════
    // РАСЧЕТ ЛИМИТОВ (ИСПРАВЛЕНО: E2E минимум 1)
    // ═══════════════════════════════════════════════════════════════
    const needsE2E = mode === 'FULL' || mode === 'BATCH';
    const effectiveFeaturesCount = Math.max(1, featuresCount);
    
    // E2E: МИНИМУМ 1, МАКСИМУМ 3 на Feature
    const minE2E = needsE2E ? effectiveFeaturesCount : 0;  // 🔥 МИНИМУМ 1 на Feature
    const maxE2E = needsE2E ? Math.min(3, effectiveFeaturesCount * 2) : 0;
    
    const baseIntegrationLimit = Math.max(20, Math.ceil(scenariosCount * 5));
    // ═══════════════════════════════════════════════════════════════
    // СЕКЦИЯ 1: РОЛЬ
    // ═══════════════════════════════════════════════════════════════
    const roleSection = `
Ты — Senior SDET. Генерируй тест-кейсы СТРОГО по правилам.

Целевой слой: **${targetLayer || 'ALL LAYERS'}**

`.trim();

    // ═══════════════════════════════════════════════════════════════
    // СЕКЦИЯ 2: СЛОИ И ЛИМИТЫ
    // ═══════════════════════════════════════════════════════════════
    const layersSection = `
## 📊 СЛОИ ТЕСТИРОВАНИЯ И ЛИМИТЫ

### 1. E2E Tests ${needsE2E ? '(ОБЯЗАТЕЛЬНО!)' : '(не требуется)'}

${needsE2E ? `
- **Количество:** МИНИМУМ ${minE2E}, максимум ${maxE2E} (1-2 на Feature)

- **scenario:** ❌ НЕ УКАЗЫВАТЬ

- **code:** ❌ НЕ УКАЗЫВАТЬ

- **steps:** Объекты с expectedResult: \`{ "text": "Действие", "expectedResult": "Промежуточный результат" }\`

- **tags:** Комбинация [M, D, A, PWA] + Smoke для критичных

- **parameters:** ❌ ЗАПРЕЩЕНО

- **Что тестировать:** Сквозные бизнес-процессы (Happy Path + Critical Errors)

` : '- Не генерировать в этом режиме'}

### 2. Integration frontend Tests

- **Количество:** 3-8 на Story

- **scenario:** ✅ ОБЯЗАТЕЛЬНО из тест-модели

- **code:** ❌ НЕ УКАЗЫВАТЬ (Codes из модели используются только для формирования expected!)

- **steps:** Строки: \`["Нажать кнопку", "Ввести значение"]\`

- **steps ЗАПРЕЩЕНО:** "Отправить GET", "200 OK", технические детали

- **tags:** Комбинация [M, D, A, PWA]

- **parameters:** ✅ Обязательно для однотипных проверок

- **Что тестировать:** UI валидация, состояния кнопок, отображение данных

${includeBackendTests ? `

### 3. Integration backend Tests

- **Количество:** 1-3 на Story (если есть backend Codes в модели)

- **scenario:** ✅ ОБЯЗАТЕЛЬНО из тест-модели

- **code:** ❌ НЕ УКАЗЫВАТЬ

- **steps:** Строки: \`["Отправить POST /api/transfer с {{Body}}"]\`

- **tags:** ТОЛЬКО [S]

- **parameters:** ✅ Для разных статус-кодов

- **Что тестировать:** API контракты, коды ответов

` : ''}

`.trim();

    // ═══════════════════════════════════════════════════════════════
    // СЕКЦИЯ 3: ТЕГИ (ПЛАТФОРМЫ)
    // ═══════════════════════════════════════════════════════════════
    const tagsSection = `
## 🏷️ ТЕГИ (ПЛАТФОРМЫ) - ОБЯЗАТЕЛЬНО!

| Тег | Значение | Для слоёв |
|-----|----------|-----------|
| **M** | Mobile (iOS/Android) | E2E, Integration frontend |
| **D** | Desktop/Web | E2E, Integration frontend |
| **A** | Adaptive (адаптивная вёрстка) | E2E, Integration frontend |
| **PWA** | Progressive Web App | E2E, Integration frontend |
| **S** | Backend/API | ТОЛЬКО Integration backend |
| **Smoke** | Smoke test (критичный путь) | ТОЛЬКО E2E |

### Правила проставления тегов:

- **E2E Tests:** Обязательно указать платформы [M, D, A, PWA]. Добавить Smoke если критичный Happy Path.

- **Integration frontend Tests:** Обязательно указать платформы [M, D, A, PWA].

- **Integration backend Tests:** ТОЛЬКО тег [S]. Никаких M, D, A, PWA!

\`\`\`json
// E2E пример:
"tags": ["M", "D", "A", "PWA", "Smoke"]

// Integration frontend пример:
"tags": ["M", "D", "A", "PWA"]

// Integration backend пример:
"tags": ["S"]
\`\`\`

`.trim();

    // ═══════════════════════════════════════════════════════════════
    // СЕКЦИЯ 4: ЖЕЛЕЗНЫЕ ПРАВИЛА
    // ═══════════════════════════════════════════════════════════════
    const ironRulesSection = `
## 🔥 ЖЕЛЕЗНЫЕ ПРАВИЛА (НАРУШЕНИЕ = ПРОВАЛ)

### 1. 🚫 NO {{}} IN TITLE/EXPECTED/PRECONDITION

Плейсхолдеры \`{{param}}\` разрешены **ТОЛЬКО** в:

- \`steps\` (шаги)

- \`parameters\` и \`examples\` (таблица данных)

❌ ЗАПРЕЩЕНО:

\`\`\`json
"title": "Ввод суммы {{amount}}"           // ❌
"expected": "Отображается ошибка {{error}}" // ❌
"precondition": "Пользователь на странице {{page}}" // ❌
\`\`\`

✅ ПРАВИЛЬНО:

\`\`\`json
"title": "Проверка валидации суммы (параметризованный)"
"expected": "Отображается сообщение об ошибке валидации"
"precondition": "Открыта форма перевода"
"steps": ["Ввести {{Сумма}} в поле 'Сумма'"]
\`\`\`

### 2. 🚫 NO ACTIONS IN PRECONDITION

- **Precondition** = ГДЕ я нахожусь (состояние системы)

- **Steps** = ЧТО я делаю (действия)

❌ ПЛОХО: \`"precondition": "Авторизоваться и открыть форму"\`

✅ ХОРОШО: \`"precondition": "Пользователь авторизован, открыта форма перевода"\`

### 3. 🚫 CODE НЕ ЗАПИСЫВАЕТСЯ В ТЕСТ-КЕЙС

Поле \`code\` в тест-кейсе **НЕ ЗАПОЛНЯЕТСЯ**!

Codes из тест-модели используются **ТОЛЬКО** для понимания что писать в \`expected\`.

### 4. ✅ E2E = ДЛИННАЯ ЦЕПОЧКА

E2E тест — это ПОЛНЫЙ бизнес-путь (3+ экранов). Не дроби его!

Промежуточные проверки — через \`expectedResult\` в steps.

`.trim();

    // ═══════════════════════════════════════════════════════════════
    // СЕКЦИЯ 5: КАК ИСПОЛЬЗОВАТЬ CODES ИЗ МОДЕЛИ
    // ═══════════════════════════════════════════════════════════════
    const codeUsageSection = `
## 🔗 КАК ИСПОЛЬЗОВАТЬ CODES ИЗ ТЕСТ-МОДЕЛИ

Codes в Scenario — это техническая реализация. Используй их ТАК:

### Для Integration frontend:

1. Найди Scenario в модели

2. Посмотри на **frontend** Codes

3. Используй их текст для формирования \`expected\`

Пример:

\`\`\`
// В модели:
Scenario: "Нажать кнопку 'Оплатить'"
Codes: [
  { "text": "Отправляется POST /api/pay", "type": "frontend" },
  { "text": "Отображается лоадер", "type": "frontend" }
]

// В тест-кейсе:
{
  "steps": ["Нажать кнопку 'Оплатить'"],
  "expected": "**Отображается** лоадер. **Отправляется** POST /api/pay"
  // code: НЕ УКАЗЫВАЕМ!
}
\`\`\`

### Для Integration backend:

1. Найди Scenario в модели

2. Посмотри на **backend** Codes

3. Используй их для формирования \`expected\`

Пример:

\`\`\`
// В модели:
Codes: [{ "text": "Возвращается 200 OK с {transactionId}", "type": "backend" }]

// В тест-кейсе:
{
  "steps": ["Отправить POST /api/pay с {{Body}}"],
  "expected": "Возвращается 200 OK, тело содержит transactionId"
  // code: НЕ УКАЗЫВАЕМ!
}
\`\`\`

`.trim();

    // ═══════════════════════════════════════════════════════════════
    // СЕКЦИЯ 6: ПАРАМЕТРИЗАЦИЯ
    // ═══════════════════════════════════════════════════════════════
    const parametrizationSection = `
## 🔄 ПАРАМЕТРИЗАЦИЯ (ОБЪЕДИНЯЙ ДУБЛИ!)

### Когда параметризовать:

✅ Одинаковые шаги, разные входные данные

✅ Граничные значения (min, max, min-1, max+1)

✅ Разные форматы (валидный/невалидный email)

✅ Разные статус-коды для backend

### Когда НЕ параметризовать:

❌ E2E тесты (никогда!)

❌ Разная логика (разные шаги)

❌ Разные результаты по смыслу

### ПРАВИЛЬНЫЙ ФОРМАТ (из схемы):

\`\`\`json
{
  "title": "Проверка валидации email",
  "steps": ["Ввести {{Email}} в поле 'Email'", "Нажать 'Отправить'"],
  "expected": "Система реагирует согласно типу ввода",
  "parameters": [
    { "name": "Email", "values": ["test", "@mail.ru", "valid@mail.ru"] }
  ],
  "examples": [
    { "parameters": [{ "name": "Email", "value": "test" }] },
    { "parameters": [{ "name": "Email", "value": "@mail.ru" }] },
    { "parameters": [{ "name": "Email", "value": "valid@mail.ru" }] }
  ]
}
\`\`\`

⚠️ ВАЖНО: \`examples\` содержит массив объектов с полем \`parameters\`!

`.trim();

    // ═══════════════════════════════════════════════════════════════
    // СЕКЦИЯ 7: ФОРМАТ JSON
    // ═══════════════════════════════════════════════════════════════
    const jsonFormatSection = `
## 📋 ФОРМАТ JSON (СТРОГО ПО СХЕМЕ)

\`\`\`json
{
  "cases": [
    {
      "id": "uuid",
      "title": "Статичный заголовок без {{}}",
      "layer": "Integration frontend Tests",
      "feature": "Название фичи из модели",
      "story": "Название story из модели",
      "scenario": "Название scenario из модели",  // ❌ для E2E не указывать!
      "precondition": "Состояние системы (не действия!)",
      "steps": [
        "Простой шаг строкой",
        { "text": "Шаг с проверкой", "expectedResult": "Промежуточный результат" }
      ],
      "expected": "Финальный ожидаемый результат (статичный текст)",
      "tags": ["M", "D", "A", "PWA"],
      "priority": "High",
      "version": "stable",
      "parameters": [
        { "name": "Параметр", "values": ["значение1", "значение2"] }
      ],
      "examples": [
        { "parameters": [{ "name": "Параметр", "value": "значение1" }] }
      ]
    }
  ]
}
\`\`\`

`.trim();

    // ═══════════════════════════════════════════════════════════════
    // СБОРКА
    // ═══════════════════════════════════════════════════════════════
    return [
        roleSection,
        layersSection,
        tagsSection,
        ironRulesSection,
        codeUsageSection,
        parametrizationSection,
        jsonFormatSection
    ].join('\n\n');
}

function buildCovenant({
    mode = 'FULL',
    includeBackendTests = true,
    scenariosCount = 0,
    storiesCount = 0,
    featuresCount = 1
}) {
    const needsE2E = mode === 'FULL' || mode === 'BATCH';
    const effectiveFeaturesCount = Math.max(1, featuresCount);
    
    // E2E: МИНИМУМ 1 на Feature
    const minE2E = needsE2E ? effectiveFeaturesCount : 0;
    const maxE2E = needsE2E ? effectiveFeaturesCount * 2 : 0;
    
    const baseIntegrationLimit = Math.max(20, Math.ceil(scenariosCount * 5));
    return `
═══════════════════════════════════════════════════════════════
🛡️ THE COVENANT (ФИНАЛЬНЫЙ ЧЕК-ЛИСТ ПЕРЕД ГЕНЕРАЦИЕЙ)
═══════════════════════════════════════════════════════════════
📏 ЛИМИТЫ:
${needsE2E ? `□ E2E: МИНИМУМ ${minE2E}, максимум ${maxE2E} тестов` : '□ E2E: Не генерировать'}
□ Integration frontend: ~${baseIntegrationLimit} тестов (3-8 на Story)
${includeBackendTests ? `□ Integration backend: 1-3 на Story (если есть backend Codes)` : '□ Integration backend: Не генерировать'}
🏷️ ТЕГИ (ПРОВЕРЬ КАЖДЫЙ ТЕСТ!):
□ E2E → tags: [M, D, A, PWA] + Smoke для критичных
□ Integration frontend → tags: [M, D, A, PWA]
□ Integration backend → tags: ТОЛЬКО [S]
🔥 ЖЕЛЕЗНЫЕ ПРАВИЛА (ПРОВЕРЬ КАЖДЫЙ ТЕСТ!):
□ [TITLE] НЕТ {{param}} в заголовке
□ [EXPECTED] НЕТ {{param}} в expected
□ [PRECONDITION] НЕТ действий, только состояние
□ [CODE] Поле code НЕ заполнено (❌ запрещено!)
□ [SCENARIO] E2E тесты НЕ имеют scenario
□ [E2E] E2E = длинная цепочка (3+ экранов)
□ [PARAMS] Дубли объединены через parameters/examples
🎯 ПРИОРИТЕТЫ:
1. Сначала Integration (глубокое покрытие)
2. В конце E2E (сквозные пути)
═══════════════════════════════════════════════════════════════
`.trim();
}
