import databasePool from './connection.js'; // Импорт пула подключений к PostgreSQL

/**
 * Получение всех функциональных блоков для указанного проекта
 * @param {string} projectId - Идентификатор проекта в Allure
 * @returns {Promise<Array>} - Массив объектов функциональных блоков
 */
export async function getFunctionalBlocks(projectId) {
  const query = 'SELECT * FROM functional_blocks WHERE project_id = $1'; // SQL-запрос для выборки блоков
  const result = await databasePool.query(query, [projectId]); // Выполнение запроса с параметром
  return result.rows; // Возвращаем строки результата
}

/**
 * Получение всех компонентов для указанного проекта
 * @param {string} projectId - Идентификатор проекта
 * @returns {Promise<Array>} - Массив объектов компонентов
 */
export async function getComponents(projectId) {
  const query = 'SELECT * FROM components WHERE project_id = $1'; // SQL-запрос для выборки компонентов
  const result = await databasePool.query(query, [projectId]); // Выполнение запроса
  return result.rows; // Возвращаем строки результата
}

/**
 * Создание нового компонента с маппингом на функциональный блок
 * @param {string} projectId - Идентификатор проекта
 * @param {string} componentType - Тип компонента (frontend/backend)
 * @param {string} name - Название компонента
 * @param {string|null} functionalBlockId - Идентификатор функционального блока (может быть null)
 * @returns {Promise<number>} - ID созданного компонента
 */
export async function createComponent(projectId, componentType, name, functionalBlockId = null) {
  const query = `
    INSERT INTO components (project_id, component_type, name, functional_block_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING id
  `;
  const result = await databasePool.query(query, [projectId, componentType, name, functionalBlockId]);
  return result.rows[0].id; // Возвращаем ID созданного компонента
}

/**
 * Обновление маппинга компонента на новый функциональный блок
 * @param {string} componentId - Идентификатор компонента
 * @param {string} functionalBlockId - Новый идентификатор функционального блока
 * @returns {Promise<Object>} - Обновлённая запись компонента
 */
export async function updateComponent(componentId, functionalBlockId) {
  const query = `
    UPDATE components 
    SET functional_block_id = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `;
  const result = await databasePool.query(query, [functionalBlockId, componentId]);
  return result.rows[0]; // Возвращаем обновлённую запись
}

/**
 * Удаление компонента по его идентификатору
 * @param {string} componentId - Идентификатор компонента
 * @returns {Promise<Object|null>} - Удалённая запись или null, если компонент не найден
 */
export async function deleteComponent(componentId) {
  const query = 'DELETE FROM components WHERE id = $1 RETURNING *';
  const result = await databasePool.query(query, [componentId]);
  return result.rows[0]; // Возвращаем удалённую запись или null
}

/**
 * Создание нового тест-плана
 * @param {string} projectId - Идентификатор проекта
 * @param {string} jiraTaskUrl - URL задачи Jira
 * @param {Array} functionalBlocks - Список функциональных блоков с маппингом компонентов
 * @returns {Promise<number>} - ID созданного тест-плана
 */
export async function createTestPlan(projectId, jiraTaskUrl, functionalBlocks) {
  const query = `
    INSERT INTO test_plans (project_id, jira_task_url, functional_blocks, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id
  `;
  const result = await databasePool.query(query, [projectId, jiraTaskUrl, JSON.stringify(functionalBlocks)]);
  return result.rows[0].id; // Возвращаем ID созданного тест-плана
}