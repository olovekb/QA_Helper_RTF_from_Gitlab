# Test Impact Analysis (TIA) Backend

## Описание проекта

**Test Impact Analysis (TIA)** — это серверное приложение на **Node.js**, разработанное для автоматизации создания тест-планов на основе данных из фронтенда, бэкенда и структуры тест-кейсов из **Allure API**. Приложение взаимодействует с **Allure TestOps** для получения структуры проектов, управления тест-кейсами и создания запусков (**launches**) для регрессионного тестирования, связанного с задачами в **Jira**. Основная цель — упростить процесс анализа влияния изменений в коде на тесты, минимизируя ручную работу разработчиков и тестировщиков.

Бэкенд предоставляет **REST API** для:
- Получения иерархической структуры функциональных блоков (**Feature, Story** и т.д.) из **Allure**.
- Сохранения и управления маппингом компонентов (**фронтенд/бэкенд**) с функциональными блоками.
- Создания тест-планов с динамической привязкой к задачам **Jira** и автоматической обработкой ошибок (например, `jobsMapping` или `test-case-bulk.nothing-to-run`).

Приложение использует **Express.js** как основной фреймворк, **PostgreSQL** для хранения данных маппингов и авторизацию через токен для работы с **Allure API**.

---

## Требования

Перед запуском проекта убедитесь, что на вашей системе установлены следующие зависимости:

- **Node.js** (версия **16.x** или выше, рекомендуется **LTS**)
- **npm** (обычно устанавливается вместе с **Node.js**)
- **PostgreSQL** (версия **12.x** или выше)
- **Git** (для клонирования репозитория)

Дополнительно:
- Доступ к **Allure TestOps API** (нужен **токен авторизации**).
- Доступ к **Jira API** (для интеграции с задачами).

---

## Установка

### 1. Клонирование репозитория
```bash
git clone <URL_вашего_репозитория>
cd tia-backend
```

### 2. Установка зависимостей
```bash
npm install
```

### 3. Настройка базы данных

Убедитесь, что **PostgreSQL** запущен, затем создайте базу данных:

```sql
CREATE DATABASE tia_db;
```

Настройте подключение к базе данных в файле `db/pool.js`:

```javascript
const pool = new pg.Pool({
  user: 'your_username',
  host: 'localhost',
  database: 'tia_db',
  password: 'your_password',
  port: 5432,
});
```

Замените `your_username`, `your_password` и другие параметры на свои.

### 4. Настройка конфигурации Allure API

Откройте файл `config/index.js` и настройте параметры для **Allure TestOps**:

```javascript
const config = {
  allureBaseUrl: 'https://abanking.qatools.cloud',
};
```

Убедитесь, что у вас есть **токен авторизации** для **Allure API**, и настройте его в `utils/allureAuth.js`:

```javascript
export const authHeaders = {
  Authorization: `Bearer your_allure_token_here`,
};
```

### 5. Создание таблиц в базе данных

```sql
CREATE TABLE component_mappings (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    component_type VARCHAR(50) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    functional_block_allure_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6. Запуск сервера

```bash
npm start
```

Сервер будет запущен на порту **5001** (см. `index.js` или `package.json`).

### 7. Проверка работы

Используйте **Postman** или **cURL** для тестирования API:

```bash
GET /api/structure?projectId=4  # Получение структуры
POST /api/launch               # Создание тест-плана
GET /api/components?projectId=4 # Получение маппингов
POST /api/components           # Сохранение маппинга
```

---

## Структура проекта

```
tia-backend/
├── api/
│   ├── launch.js       # Логика создания тест-планов
│   ├── structure.js    # Получение структуры проектов из Allure
│   ├── components.js   # Управление маппингом компонентов
├── utils/
│   ├── allureAuth.js   # Авторизация в Allure API
│   ├── logger.js       # Логирование
├── config/
│   ├── index.js        # Конфигурация
├── db/
│   ├── pool.js         # Подключение к PostgreSQL
├── index.js            # Точка входа
├── package.json        # Зависимости и скрипты
└── README.md           # Этот файл
```

---

## API

| Метод | Эндпоинт         | Описание |
|--------|-----------------|----------------------------------------------|
| `GET`  | `/api/structure` | Получает структуру функциональных блоков |
| `POST` | `/api/launch`    | Создаёт тест-план |
| `GET`  | `/api/components` | Получает существующие маппинги |
| `POST` | `/api/components` | Сохраняет маппинг |

### Примеры запросов

#### 1. Получение структуры

```bash
GET /api/structure?projectId=4
```
**Ответ:**

```json
{
  "projectId": "4",
  "folders": [
    { "id": 1825, "name": "Feature - Вопросы", "children": [] },
    { "id": 1820, "name": "Story - Информер", "children": [] }
  ]
}
```

#### 2. Создание тест-плана

```bash
POST /api/launch
```
**Тело запроса:**

```json
{
  "projectId": "4",
  "jiraLink": "https://jira.abanking.ru/browse/SBK-20930",
  "componentMappings": {
    "RegistrationWebPage-0": ["1825", "1820"]
  }
}
```

**Ответ:**

```json
{
  "id": "12345"
}
```

---

## Рекомендации по разработке

### 🔍 Тестирование
- Используйте **Postman** для тестирования API.
- Добавьте **Jest + Supertest** для unit-тестов.
- Проверяйте обработку ошибок, например, отсутствие токена.

### 🚀 Оптимизация
- Используйте **кэширование** для уменьшения запросов к **Allure API**.
- Настройте **пул подключений** к **PostgreSQL**.

### 🔒 Безопасность
- Храните токены в **.env**:

```bash
ALLURE_TOKEN=your_token_here
```

- Ограничьте доступ к API с **middleware** (проверка токена в заголовках).

### 📊 Мониторинг и логи
- Настройте **logger.js** для записи логов.
- Добавьте **Prometheus** для метрик.

---

## ❌ Устранение неполадок

| Проблема | Возможное решение |
|----------|-------------------|
| Ошибка авторизации в Allure | Проверьте **токен** в `utils/allureAuth.js` |
| Ошибка подключения к БД | Проверьте **PostgreSQL** и `db/pool.js` |
| Ошибка jobsMapping | Проверьте настройки **Allure** и **Jira** |