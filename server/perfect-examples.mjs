/**
 * Модуль для работы с идеальными примерами тест-кейсов
 * Идеальные примеры - это примеры тест-кейсов, отредактированные QA и сохранённые как образцы для улучшения генерации
 */

/**
 * Сохранить тест-кейсы как идеальные примеры
 * @param {Array} testCases - Массив тест-кейсов для сохранения
 * @param {string} [projectId] - ID проекта Allure (опционально)
 * @param {Object} db - Knex instance для работы с БД
 * @returns {Promise<Array>} - Массив сохранённых примеров с ID
 */
export async function savePerfectExamples(testCases, projectId, db) {
    if (!Array.isArray(testCases) || testCases.length === 0) {
        throw new Error('testCases должен быть непустым массивом');
    }

    const saved = [];
    
    for (const testCase of testCases) {
        if (!testCase.layer) {
            console.warn(`[savePerfectExamples] Пропущен ТК без layer: ${testCase.title || testCase.id}`);
            continue;
        }

        // Проверяем, нет ли уже такого примера (по layer и title)
        const existing = await db('perfect_examples')
            .where({
                layer: testCase.layer,
                project_id: projectId || null
            })
            .whereRaw(`test_case->>'title' = ?`, [testCase.title || ''])
            .first();

        if (existing) {
            console.log(`[savePerfectExamples] Пример уже существует, обновляем: ${testCase.title}`);
            // Обновляем существующий пример
            const [updated] = await db('perfect_examples')
                .where('id', existing.id)
                .update({
                    test_case: testCase,
                    quality_score: 100, // Обновляем качество до идеального
                    updated_at: new Date(),
                    project_id: projectId || null
                })
                .returning('*');
            
            saved.push(updated);
        } else {
            // Создаём новый пример
            const [newExample] = await db('perfect_examples')
                .insert({
                    layer: testCase.layer,
                    test_case: testCase,
                    project_id: projectId || null,
                    quality_score: 100,
                    usage_count: 0
                })
                .returning('*');
            
            saved.push(newExample);
            console.log(`[savePerfectExamples] ✅ Сохранён новый идеальный пример: ${testCase.layer} - ${testCase.title}`);
        }
    }

    return saved;
}

/**
 * Получить идеальные примеры для указанного слоя
 * @param {string} layer - Слой тестов (E2E Tests, Integration frontend Tests, и т.д.)
 * @param {string} [projectId] - ID проекта Allure (опционально, для фильтрации)
 * @param {number} [limit] - Максимальное количество примеров (по умолчанию 10)
 * @param {Object} db - Knex instance для работы с БД
 * @returns {Promise<Array>} - Массив идеальных примеров
 */
export async function getPerfectExamples(layer, projectId, limit = 10, db) {
    if (!layer) {
        throw new Error('layer обязателен');
    }

    let query = db('perfect_examples')
        .where('layer', layer)
        .orderBy('quality_score', 'desc')
        .orderBy('usage_count', 'desc')
        .orderBy('last_used_at', 'desc')
        .limit(limit);

    // Если указан projectId, приоритизируем примеры для этого проекта
    if (projectId) {
        query = query.orderByRaw(`CASE WHEN project_id = ? THEN 0 ELSE 1 END`, [projectId]);
    }

    const examples = await query;
    
    // Извлекаем test_case из каждого примера и обновляем счётчик использования
    const result = examples.map(ex => {
        // Обновляем статистику использования (асинхронно, не блокируем)
        db('perfect_examples')
            .where('id', ex.id)
            .update({
                usage_count: db.raw('usage_count + 1'),
                last_used_at: new Date()
            })
            .catch(err => console.error(`[getPerfectExamples] Ошибка обновления статистики для ${ex.id}:`, err));

        return ex.test_case;
    });

    console.log(`[getPerfectExamples] Получено ${result.length} идеальных примеров для layer: ${layer}`);
    
    return result;
}

/**
 * Получить все идеальные примеры, сгруппированные по слоям
 * @param {string} [projectId] - ID проекта Allure (опционально)
 * @param {Object} db - Knex instance для работы с БД
 * @returns {Promise<Object>} - Объект с примерами по слоям: { 'E2E Tests': [...], 'Integration frontend Tests': [...] }
 */
export async function getAllPerfectExamplesByLayer(projectId, db) {
    let query = db('perfect_examples')
        .select('layer', 'test_case', 'quality_score', 'usage_count', 'id')
        .orderBy('quality_score', 'desc')
        .orderBy('usage_count', 'desc');

    if (projectId) {
        query = query.orderByRaw(`CASE WHEN project_id = ? THEN 0 ELSE 1 END`, [projectId]);
    }

    const examples = await query;

    // Группируем по слоям
    const grouped = {};
    const layerLimits = {
        'E2E Tests': 5,
        'Integration frontend Tests': 5,
        'Integration backend Tests': 5,
        'Unit frontend Tests': 3,
        'Unit backend Tests': 3
    };

    for (const ex of examples) {
        const layer = ex.layer;
        if (!grouped[layer]) {
            grouped[layer] = [];
        }

        const limit = layerLimits[layer] || 5;
        if (grouped[layer].length < limit) {
            grouped[layer].push(ex.test_case);
            
            // Обновляем статистику использования (асинхронно, не блокируем)
            db('perfect_examples')
                .where('id', ex.id)
                .update({
                    usage_count: db.raw('usage_count + 1'),
                    last_used_at: new Date()
                })
                .catch(err => console.error(`[getAllPerfectExamplesByLayer] Ошибка обновления статистики:`, err));
        }
    }

    console.log(`[getAllPerfectExamplesByLayer] Получено примеров по слоям:`, Object.keys(grouped).map(l => `${l}: ${grouped[l].length}`).join(', '));
    
    return grouped;
}

/**
 * Удалить идеальный пример по ID
 * @param {string} exampleId - ID примера для удаления
 * @param {Object} db - Knex instance для работы с БД
 * @returns {Promise<boolean>} - true если удалён, false если не найден
 */
export async function deletePerfectExample(exampleId, db) {
    const deleted = await db('perfect_examples')
        .where('id', exampleId)
        .del();
    
    return deleted > 0;
}

/**
 * Получить статистику по идеальным примерам
 * @param {string} [projectId] - ID проекта Allure (опционально)
 * @param {Object} db - Knex instance для работы с БД
 * @returns {Promise<Object>} - Статистика по примерам
 */
export async function getPerfectExamplesStats(projectId, db) {
    let query = db('perfect_examples');

    if (projectId) {
        query = query.where('project_id', projectId);
    }

    const stats = await query
        .select('layer')
        .count('* as count')
        .sum('usage_count as total_usage')
        .avg('quality_score as avg_quality')
        .groupBy('layer');

    const total = await query.clone().count('* as total').first();

    return {
        byLayer: stats,
        total: parseInt(total?.total || 0)
    };
}

