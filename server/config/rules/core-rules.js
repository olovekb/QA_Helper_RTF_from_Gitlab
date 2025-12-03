// config/rules/core-rules.js

// ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВИЛ - импортируется везде

export const RULES = {
  // ═══════════════════════════════════════════════════════════════
  // ТЕСТ-МОДЕЛЬ
  // ═══════════════════════════════════════════════════════════════
  testModel: {
    hierarchy: "Feature → Story → Scenario → Codes[frontend|backend]",
    
    scenario: {
      // Сценарий = ОДНО атомарное действие
      atomicity: "ONE action = ONE Scenario",
      mustStartWith: ["Нажать", "Ввести", "Выбрать", "Перейти", "Открыть", "Закрыть", 
                      "Подтвердить", "Отменить", "Скроллить", "Свайпнуть", "Загрузить",
                      "Проверить состояние"],
      // Разные исходы = разные сценарии
      outcomeRule: "Успех/Ошибка/Отмена = ОТДЕЛЬНЫЕ Scenario",
      forbidden: ["Пользователь должен", "Если...", "успешно", "корректно"]
    },
    
    code: {
      types: ["frontend", "backend"],  // НЕТ integration!
      frontend: {
        patterns: ["Отображается...", "Отправляется...", "Скрывается...", "Активируется...", "Блокируется..."]
      },
      backend: {
        patterns: ["Возвращается..."]
      },
      // Codes используются для формирования expected, НЕ записываются в тест-кейс
      purpose: "SOURCE_FOR_EXPECTED_ONLY"
    }
  },
  // ═══════════════════════════════════════════════════════════════
  // ТЕСТ-КЕЙСЫ
  // ═══════════════════════════════════════════════════════════════
  testCases: {
    layers: ["E2E Tests", "Integration frontend Tests", "Integration backend Tests"],
    
    // E2E: МИНИМУМ 1 на Feature
    "E2E Tests": {
      quantity: { min: 1, max: 3, per: "Feature" },  // МИНИМУМ 1!
      requiredFields: ["title", "layer", "steps", "expected", "feature", "story", "precondition"],
      forbiddenFields: ["scenario", "code"],
      stepsFormat: "object",  // { text, expectedResult }
      tagsAllowed: ["M", "D", "A", "PWA", "Smoke"],
      tagsForbidden: ["S"],
      parametersAllowed: false
    },
    
    "Integration frontend Tests": {
      quantity: { min: 3, max: 8, per: "Story" },
      requiredFields: ["title", "layer", "steps", "expected", "feature", "story", "scenario", "precondition"],
      forbiddenFields: ["code"],  // code НЕ записывается!
      stepsFormat: "string",
      tagsAllowed: ["M", "D", "A", "PWA"],
      tagsForbidden: ["S", "Smoke"],
      parametersAllowed: true
    },
    
    "Integration backend Tests": {
      quantity: { min: 1, max: 3, per: "Story", condition: "if backend Codes exist" },
      requiredFields: ["title", "layer", "steps", "expected", "feature", "story", "scenario"],
      forbiddenFields: ["code"],  // code НЕ записывается!
      stepsFormat: "string",
      tagsAllowed: ["S"],
      tagsForbidden: ["M", "D", "A", "PWA", "Smoke"],
      parametersAllowed: true
    }
  },
  // ═══════════════════════════════════════════════════════════════
  // ТЕГИ (ПЛАТФОРМЫ)
  // ═══════════════════════════════════════════════════════════════
  tags: {
    platforms: {
      "M": { name: "Mobile", description: "iOS/Android приложение" },
      "D": { name: "Desktop", description: "Web браузер" },
      "A": { name: "Adaptive", description: "Адаптивная вёрстка" },
      "PWA": { name: "PWA", description: "Progressive Web App" },
      "S": { name: "Backend", description: "API/Backend тесты" }
    },
    special: {
      "Smoke": { description: "Критичный Happy Path", appliesTo: ["E2E Tests"] }
    },
    rules: {
      "E2E Tests": "Комбинация [M, D, A, PWA] + опционально Smoke",
      "Integration frontend Tests": "Комбинация [M, D, A, PWA]",
      "Integration backend Tests": "ТОЛЬКО [S]"
    }
  },
  // ═══════════════════════════════════════════════════════════════
  // ЖЕЛЕЗНЫЕ ПРАВИЛА (из твоего промпта)
  // ═══════════════════════════════════════════════════════════════
  ironRules: {
    noPlaceholdersIn: ["title", "expected", "precondition"],
    placeholdersAllowedIn: ["steps", "examples"],
    noActionsInPrecondition: true,
    preconditionIs: "WHERE (контекст, состояние)",
    stepsIs: "WHAT (действия)",
    expectedIs: "RESULT (статичный текст, не формула)"
  },
  // ═══════════════════════════════════════════════════════════════
  // ANTI-HALLUCINATION (из твоего промпта)
  // ═══════════════════════════════════════════════════════════════
  antiHallucination: {
    forbidden: [
      "Выдумывать URL если их нет в требованиях",
      "Выдумывать HTTP коды (400, 404, 500) если их нет",
      "Выдумывать errorCode, message если их нет",
      "Выдумывать JSON поля если их нет"
    ],
    alternative: {
      unknownError: "Возвращается ошибка сервера",
      unknownUI: "Отображается сообщение об ошибке"
    }
  },
  // ═══════════════════════════════════════════════════════════════
  // ПАРАМЕТРИЗАЦИЯ
  // ═══════════════════════════════════════════════════════════════
  parametrization: {
    when: [
      "Одинаковые шаги, разные входные данные",
      "Граничные значения (min, max, min-1, max+1)",
      "Разные форматы одного типа"
    ],
    whenNot: [
      "E2E тесты (никогда!)",
      "Разная логика (разные шаги)",
      "Разные результаты по смыслу"
    ],
    format: {
      parameters: [{ name: "string", values: ["array", "of", "strings"] }],
      examples: [{ parameters: [{ name: "string", value: "string" }] }]
    },
    maxExamples: 8
  }
};

export default RULES;
