# Система автоматической отладки агента генерации тест-кейсов

## Обзор

Эта система предназначена для автоматического тестирования, анализа и улучшения агента генерации тестовых моделей и тест-кейсов.

## Компоненты

### 1. `debug-agent.mjs`
Модуль автоматической отладки с функциями валидации и сравнения:
- `validateTestModelStructure()` - валидирует структуру тестовой модели
- `validateTestCases()` - валидирует тест-кейсы
- `compareWithReference()` - сравнивает сгенерированные результаты с эталоном
- `runAutomatedTest()` - запускает полный цикл тестирования

### 2. `prompt-optimizer.mjs`
Модуль автоматической коррекции промптов:
- `analyzeProblems()` - анализирует ошибки и генерирует рекомендации
- `optimizePrompts()` - создает рекомендации по улучшению промптов

### 3. `debug-routes.mjs`
API маршруты для отладки:
- `POST /api/debug/test-agent` - автоматическое тестирование агента
- `POST /api/debug/validate-model` - валидация тестовой модели
- `POST /api/debug/validate-cases` - валидация тест-кейсов

### 4. `auto-debug.mjs`
Главный скрипт для итеративного тестирования и улучшения

## Использование

### Быстрый старт

1. **Запустить сервер** (если еще не запущен):
```bash
cd server
npm start
```

2. **Запустить автоматическую отладку** (в отдельном терминале):
```bash
cd server
node auto-debug.mjs
```

Скрипт автоматически:
- Отправит тестовые требования на генерацию
- Получит тестовую модель и тест-кейсы
- Проверит их на соответствие эталонной структуре
- Оценит качество (score 0-100)
- Сгенерирует рекомендации по улучшению промптов
- Повторит процесс до достижения score >= 80 или максимального количества итераций

### Ручное тестирование через API

#### Тестирование агента
```bash
curl -X POST http://localhost:5005/api/debug/test-agent \
  -H "Content-Type: application/json" \
  -d '{
    "requirements": "# Управление задачами\n\n## Создание задачи\n- Кнопка \"Создать\" открывает форму\n- POST /api/tasks с параметрами..."
  }'
```

#### Валидация тестовой модели
```bash
curl -X POST http://localhost:5005/api/debug/validate-model \
  -H "Content-Type: application/json" \
  -d '{
    "testModel": [
      {
        "id": "uuid",
        "text": "Feature Name",
        "stories": [...]
      }
    ]
  }'
```

## Эталонные структуры

### Тестовая модель

```json
{
  "testModel": [
    {
      "id": "uuid",
      "text": "Feature Name",
      "stories": [
        {
          "id": "uuid",
          "text": "Story Name",
          "scenarios": [
            {
              "id": "uuid",
              "text": "1. User action",
              "codes": [
                {
                  "id": "uuid",
                  "text": "System behavior",
                  "type": "frontend" | "backend"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Тест-кейс

```json
{
  "id": "tc-001",
  "feature": "Feature Name",
  "story": "Story Name",
  "scenario": "Scenario Name (for Integration)",
  "title": "Test case title",
  "layer": "E2E Tests" | "Integration frontend Tests" | "Integration backend Tests",
  "precondition": "Optional precondition",
  "steps": [
    "Step 1",
    { "text": "Step 2", "expectedResult": "Result" }
  ],
  "expected": "Overall expected result",
  "tags": ["M"],
  "priority": "High",
  "version": "stable",
  "parameters": [...],
  "examples": [...]
}
```

## Правила валидации

### Тестовая модель
- ✅ Минимум 1 Feature
- ✅ Минимум 3 Stories на Feature
- ✅ Минимум 2 Scenarios на Story
- ✅ Минимум 2 Codes на Scenario
- ✅ Баланс frontend/backend: минимум 30% каждого
- ✅ Все Codes имеют type: "frontend" или "backend"

### Тест-кейсы
- ✅ Обязательные поля: id, feature, story, title, layer, steps, expected, tags, priority, version
- ✅ E2E тесты: минимум 3 шага, НЕ содержат технических деталей (HTTP, API, статус-коды)
- ✅ Integration тесты: минимум 1 шаг, содержат scenario из модели
- ✅ Expected result в правильной форме ("Отображается", "Возвращается", НЕ "Отобразить")
- ✅ Steps конкретные (минимум 15 символов)
- ✅ НЕТ дубликатов (используется параметризация)

## Оценка качества (Score)

Score рассчитывается по формуле:
```
Score = 100 
        - (ошибки тестовой модели × 10) 
        - (ошибки тест-кейсов × 10)
        - (предупреждения тестовой модели × 2)
        - (предупреждения тест-кейсов × 2)
        + бонусы за хорошую структуру
```

Целевой score: **80+**

## Рекомендации по улучшению

После каждой итерации система генерирует файл `prompt-improvements.md` с рекомендациями по улучшению промптов.

Пример рекомендации:
```markdown
## 1. test_model_prompt → ПРАВИЛА CODE

**Проблема:** Модель не содержит необходимые поля или структура нарушена

**Рекомендация:**
🔧 УСИЛЕНИЕ ПРОМПТА ДЛЯ ТЕСТОВОЙ МОДЕЛИ:
В секции "ПРАВИЛА CODE" добавить явное требование:
...
```

## Файлы результатов

После выполнения `auto-debug.mjs` создаются:
- `auto-debug-report.json` - детальный отчет по всем итерациям
- `prompt-improvements.md` - рекомендации по улучшению промптов

## Troubleshooting

### Ошибка "Connection refused"
Убедитесь, что сервер запущен на порту 5005:
```bash
cd server
npm start
```

### Низкий score (<50)
1. Проверьте рекомендации в `prompt-improvements.md`
2. Примените рекомендации к промптам в `server.js`
3. Перезапустите сервер
4. Повторите тестирование

### Задача не завершается
- Проверьте логи сервера
- Проверьте, что база данных доступна
- Увеличьте таймауты в `debug-agent.mjs`

## Настройка

Параметры в `auto-debug.mjs`:
```javascript
const CONFIG = {
    baseURL: 'http://localhost:5005',
    maxIterations: 5,        // Максимум итераций
    targetScore: 80,         // Целевой score
    iterationDelay: 5000,    // Задержка между итерациями (мс)
};
```

## Примеры использования

### Пример 1: Базовое тестирование
```bash
node auto-debug.mjs
```

### Пример 2: Тестирование конкретных требований
Отредактируйте `TEST_REQUIREMENTS` в `auto-debug.mjs` и запустите:
```bash
node auto-debug.mjs
```

### Пример 3: Валидация существующей модели
```javascript
import { validateTestModelStructure } from './debug-agent.mjs';

const model = [...]; // ваша модель
const validation = validateTestModelStructure(model);
console.log(validation);
```

## Интеграция с CI/CD

Можно добавить автоматическое тестирование в CI/CD пайплайн:

```yaml
# .github/workflows/test-agent.yml
name: Test Agent Quality

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: cd server && npm install
      - name: Start server
        run: cd server && npm start &
      - name: Wait for server
        run: sleep 10
      - name: Run automated tests
        run: cd server && node auto-debug.mjs
      - name: Upload report
        uses: actions/upload-artifact@v2
        with:
          name: debug-report
          path: server/auto-debug-report.json
```

## Поддержка

Если у вас возникли вопросы или проблемы:
1. Проверьте логи сервера
2. Проверьте файл `auto-debug-report.json`
3. Проверьте рекомендации в `prompt-improvements.md`

