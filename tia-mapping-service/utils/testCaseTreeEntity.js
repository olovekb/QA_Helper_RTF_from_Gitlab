import databasePool from '../db/pool.js';

/**
 * Получить путь от корня (Feature) до группы (Story, Scenario)
 * Возвращает массив allure_id
 */
export async function resolveGroupPathFromDb (projectId, allureId)
{
    let currentId = allureId.toString();
    const path = [];

    let depth = 0;
    const maxDepth = 20;

    while (currentId && depth < maxDepth) {
        path.unshift(Number(currentId));

        const block = await databasePool('functional_blocks')
            .where({ allure_id: currentId, project_id: projectId.toString() })
            .first();

        if (!block || !block.parent_id) {
            break;
        }

        const parentBlock = await databasePool('functional_blocks')
            .where({ id: block.parent_id })
            .first();

        if (parentBlock) {
            currentId = parentBlock.allure_id;
            depth++;
        } else {
            break;
        }
    }

    return path;
}
