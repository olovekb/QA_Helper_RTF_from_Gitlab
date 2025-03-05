# Test Impact Analysis (TIA) Backend

## Описание проекта

Test Impact Analysis (TIA) — это серверное приложение на Node.js, разработанное для автоматизации создания тест-планов на основе данных из фронтенда, бэкенда и структуры тест-кейсов из Allure API. Приложение взаимодействует с Allure TestOps для получения структуры проектов, управления тест-кейсами и создания запусков (launches) для регрессионного тестирования, связанного с задачами в Jira. Основная цель — упростить процесс анализа влияния изменений в коде на тесты, минимизируя ручную работу разработчиков и тестировщиков.

Бэкенд предоставляет REST API для:
- Получения иерархической структуры функциональных блоков (Feature, Story и т.д.) из Allure.
- Сохранения и управления маппингом компонентов (фронтенд/бэкенд) с функциональными блоками.
- Создания тест-планов с динамической привязкой к задачам Jira и автоматической обработкой ошибок (например, `jobsMapping` или `test-case-bulk.nothing-to-run`).

Приложение использует Express.js как основной фреймворк, PostgreSQL для хранения данных маппингов, и авторизацию через токен для работы с Allure API.

---

## Требования

Перед запуском проекта убедитесь, что на вашей системе установлены следующие зависимости:

- **Node.js** (версия 16.x или выше, рекомендуется LTS)
- **npm** (обычно устанавливается вместе с Node.js)
- **PostgreSQL** (версия 12.x или выше)
- **Git** (для клонирования репозитория)

Дополнительно:
- Доступ к Allure TestOps API (нужен токен авторизации).
- Доступ к Jira API (для интеграции с задачами).

---

## Установка

1. **Клонируйте репозиторий**:
   ```bash
   git clone <URL_вашего_репозитория>
   cd tia-backend
Установите зависимости:
bash

Collapse

Wrap

Salin
npm install
Настройте базу данных:
Убедитесь, что PostgreSQL запущен.
Создайте базу данных, например, tia_db:
sql

Collapse

Wrap

Salin
CREATE DATABASE tia_db;
Настройте подключение к базе данных в файле db/pool.js:
javascript

Collapse

Wrap

Salin
const pool = new pg.Pool({
  user: 'your_username',
  host: 'localhost',
  database: 'tia_db',
  password: 'your_password',
  port: 5432,
});
Замените your_username, your_password и другие параметры на свои.
Настройте конфигурацию Allure API:
Откройте файл config/index.js и настройте параметры для Allure TestOps:
javascript

Collapse

Wrap

Salin
const config = {
  allureBaseUrl: 'https://abanking.qatools.cloud',
  // Другие параметры, если нужны
};
Убедитесь, что у вас есть токен авторизации для Allure API и он настроен в utils/allureAuth.js:
javascript

Collapse

Wrap

Salin
export const authHeaders = {
  Authorization: `Bearer your_allure_token_here`,
  // Другие заголовки, если нужны
};
Создайте таблицы в базе данных:
Выполните SQL-скрипты для создания таблиц (например, для хранения маппингов компонентов). Пример структуры:
sql

Collapse

Wrap

Salin
CREATE TABLE component_mappings (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    component_type VARCHAR(50) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    functional_block_allure_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
Запуск проекта
Запустите сервер:
bash

Collapse

Wrap

Salin
npm start
Сервер будет запущен на порту 5001 по умолчанию (см. index.js или package.json).
Проверка работы:
Откройте браузер или используйте инструменты вроде Postman для тестирования API:
GET /api/structure?projectId=4 — получение структуры функциональных блоков для проекта с projectId=4.
POST /api/launch — создание тест-плана с данными о проекте, Jira-ссылке и маппинге компонентов.
GET /api/components?projectId=4 — получение существующих маппингов компонентов для проекта.
POST /api/components — сохранение нового маппинга компонентов.
Логи:
Логирование осуществляется через модуль utils/logger.js. Логи выводятся в консоль с уровнями logInfo, logWarn, logError. При необходимости настройте вывод в файл или другую систему (например, через Winston или Bunyan).
Структура проекта
text

Collapse

Wrap

Salin
tia-backend/
├── api/
│   ├── launch.js           — Логика создания тест-планов, интеграция с Allure API для запуска тестов.
│   ├── structure.js        — Получение и обработка иерархической структуры проектов из Allure.
│   └── components.js       — Управление маппингом компонентов с функциональными блоками, работа с базой данных.
├── utils/
│   ├── allureAuth.js       — Утилиты для авторизации и работы с Allure API (токен, заголовки).
│   ├── logger.js           — Модуль логирования для отладки и мониторинга.
│   └── index.js            — Экспорт утилит для использования в других модулях.
├── config/
│   └── index.js            — Конфигурация приложения (URL Allure, порты, другие параметры).
├── db/
│   └── pool.js             — Подключение к PostgreSQL для хранения данных маппингов.
├── index.js                — Точка входа приложения, настройка Express и маршрутов.
├── package.json            — Зависимости и скрипты проекта.
└── README.md               — Этот файл.
Основные модули
1. api/launch.js
Описание: Этот модуль отвечает за создание тест-планов в Allure TestOps. Он принимает данные о проекте, ссылке на задачу в Jira и маппинге компонентов, формирует запросы к Allure API (/api/v2/test-case/bulk/run/new) и обрабатывает возможные ошибки (например, jobsMapping или test-case-bulk.nothing-to-run).
Ключевые функции:
createTestPlan: Создаёт тест-план, динамически получая treeId и jobId, если требуется, и отправляет запрос на запуск тестов.
Использует fetchWithAuth из utils/allureAuth.js для авторизованных запросов к Allure API.
Логирует все запросы и ответы через utils/logger.js.
2. api/structure.js
Описание: Получает иерархическую структуру проектов (функциональные блоки: Feature, Story и т.д.) из Allure API и сохраняет её в базу данных для последующего использования.
Ключевые функции:
getProjectStructure: Выполняет запросы к /api/tree и /api/v2/project/{projectId}/test-case/tree/tree-node, обрабатывает вложенную структуру, фильтрует ненужные узлы и кэширует результаты.
Использует кэширование через Map для оптимизации производительности.
3. api/components.js
Описание: Управляет маппингом компонентов (фронтенд/бэкенд) с функциональными блоками Allure. Сохраняет и извлекает данные из PostgreSQL.
Ключевые функции:
Принимает POST-запросы для сохранения маппингов и GET-запросы для получения существующих маппингов.
4. utils/allureAuth.js
Описание: Содержит утилиты для авторизации в Allure API, включая токен и заголовки для HTTP-запросов.
Ключевые функции:
fetchWithAuth: Обрабатывает авторизованные запросы к Allure с использованием токена из authHeaders.
5. utils/logger.js
Описание: Модуль для логирования операций, ошибок и предупреждений. Использует консоль для вывода, но может быть расширен для записи в файлы или внешние системы.
Ключевые функции:
logInfo, logWarn, logError: Логирование с разными уровнями важности.
6. config/index.js
Описание: Хранит конфигурационные параметры, такие как URL Allure API, порты и другие настройки.
Ключевые данные:
allureBaseUrl: Базовый URL для Allure TestOps.
7. db/pool.js
Описание: Настраивает подключение к PostgreSQL для работы с базой данных, где хранятся маппинги компонентов.
Ключевые функции:
Использует pg (PostgreSQL client для Node.js) для создания пула подключений.
API
Метод	Эндпоинт	Описание
GET	/api/structure	Получает структуру функциональных блоков для проекта.
POST	/api/launch	Создаёт тест-план с данными о проекте, Jira и маппинге компонентов.
GET	/api/components	Получает существующие маппинги компонентов для проекта.
POST	/api/components	Сохраняет новый маппинг компонентов с функциональными блоками.
Примеры запросов
1. Получение структуры
bash

Collapse

Wrap

Salin
GET /api/structure?projectId=4
Ответ (200):

json

Collapse

Wrap

Salin
{
    "projectId": "4",
    "folders": [
        { "id": 1825, "name": "Feature - Вопросы", "customFieldName": "Feature", "children": [...] },
        { "id": 1820, "name": "Story - Информер", "customFieldName": "Story", "children": [] }
    ]
}
2. Создание тест-плана
bash

Collapse

Wrap

Salin
POST /api/launch
Тело:

json

Collapse

Wrap

Salin
{
    "projectId": "4",
    "jiraLink": "https://jira.abanking.ru/browse/SBK-20930",
    "componentMappings": {
        "RegistrationWebPage-0": ["1825", "1820"]
    }
}
Ответ (200):

json

Collapse

Wrap

Salin
{
    "id": "12345"
}
Рекомендации по разработке
1. Тестирование
Используйте Postman или аналогичные инструменты для тестирования API.
Добавьте модульные тесты с использованием Jest и Supertest для проверки маршрутов (api/launch.js, api/structure.js, api/components.js).
Тестируйте обработку ошибок, таких как отсутствие токена, некорректные данные или ошибки Allure API.
2. Оптимизация
Используйте кэширование (cache в api/structure.js и api/launch.js) для уменьшения запросов к Allure API.
Настройте пул подключений к PostgreSQL в db/pool.js для производительности при большом количестве запросов.
3. Безопасность
Храните токен Allure API в переменных окружения (.env), а не в коде. Используйте dotenv:
bash

Collapse

Wrap

Salin
npm install dotenv
Пример .env:
text

Collapse

Wrap

Salin
ALLURE_TOKEN=your_token_here
Обновите utils/allureAuth.js для чтения токена из process.env.
Ограничьте доступ к API с помощью middleware (например, проверка токена в заголовках).
4. Мониторинг и логи
Настройте utils/logger.js для записи логов в файл или внешнюю систему (например, ELK Stack, Graylog).
Добавьте метрики производительности с использованием Prometheus или аналогичных инструментов.
5. Масштабируемость
Разделите большие модули (например, api/launch.js) на более мелкие файлы, если функциональность вырастет.
Используйте миграции базы данных (например, Knex.js или Sequelize) для управления схемой PostgreSQL.
Устранение неполадок
Проблема	Возможное решение
Ошибка авторизации в Allure API	Проверьте токен в utils/allureAuth.js и убедитесь, что он действителен.
Ошибка подключения к базе данных	Убедитесь, что PostgreSQL запущен и параметры в db/pool.js корректны.
Сбой при запросе структуры	Проверьте config/index.js (URL Allure) и логи в utils/logger.js для диагностики.
Ошибка jobsMapping или test-case-bulk.nothing-to-run	Убедитесь, что проект в Allure настроен корректно, и все необходимые джобы и тест-кейсы существуют.