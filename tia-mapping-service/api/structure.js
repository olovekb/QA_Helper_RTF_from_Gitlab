import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js'; // Импорт функции авторизации и заголовков
import config from '../config/index.js'; // Импорт конфигурации проекта
import { logInfo, logError, logWarn } from '../utils/logger.js'; // Импорт функций логирования

/**
 * Получает иерархическую структуру проекта (только папки) из Allure API, включая все уровни вложенности
 * @param {string} projectId - Идентификатор проекта в Allure
 * @returns {Promise<Object>} - Структура проекта с папками, содержащими name, customFieldId, их названия и вложенные дети
 * @throws {Error} - Если запрос не удался
 */
export async function getProjectStructure(projectId) {
    try {
        logInfo(`Запрашиваем иерархическую структуру папок проекта с ID ${projectId} из Allure API`); // Логирование запроса

        // Шаг 1: Получаем treeId для проекта через эндпоинт /api/tree
        const treeUrl = `${config.allureBaseUrl}/api/tree?projectId=${projectId}`;
        let treeId = null;

        logInfo(`Получаем treeId для проекта ${projectId}`); // Логирование шага
        const treeResponse = await fetchWithAuth(treeUrl, {
            headers: {
                ...authHeaders, // Используем глобальные заголовки с токеном
                'Content-Type': 'application/json', // Тип контента
            },
        });

        if (!treeResponse.ok) {
            const errorMessage = await treeResponse.text();
            logError(`Ошибка получения treeId для проекта ${projectId}: ${treeResponse.statusText}`, errorMessage); // Логирование ошибки
            throw new Error(`Не удалось получить treeId: ${treeResponse.statusText} - ${errorMessage}`);
        }

        const treeData = await treeResponse.json();
        logInfo(`Ответ от /api/tree для projectId ${projectId}:`, JSON.stringify(treeData)); // Логирование ответа для отладки
        // Извлекаем treeId из ответа, предполагая, что это поле 'id' в объекте 'content[0]'
        treeId = treeData.content?.[0]?.id || 0; // Используем 0 как запасной вариант, если id не найден
        if (!treeId) {
            logWarn(`treeId не найден в ответе для проекта ${projectId}, используем значение по умолчанию (0)`); // Логирование предупреждения
            treeId = 0; // Значение по умолчанию, если treeId не определён
        }

        logInfo(`Найден treeId ${treeId} для проекта ${projectId}`); // Логирование успеха

        // Шаг 2: Получаем структуру дерева для конкретного treeId через /api/tree/{treeId}
        const treeDetailUrl = `${config.allureBaseUrl}/api/tree/${treeId}`;
        let customFields = [];

        logInfo(`Получаем детали дерева с treeId ${treeId} для проекта ${projectId}`); // Логирование шага
        const treeDetailResponse = await fetchWithAuth(treeDetailUrl, {
            headers: {
                ...authHeaders, // Используем глобальные заголовки с токеном
                'Content-Type': 'application/json', // Тип контента
            },
        });

        if (!treeDetailResponse.ok) {
            const errorMessage = await treeDetailResponse.text();
            logError(`Ошибка получения деталей дерева для treeId ${treeId}: ${treeDetailResponse.statusText}`, errorMessage); // Логирование ошибки
            throw new Error(`Не удалось получить детали дерева: ${treeDetailResponse.statusText} - ${errorMessage}`);
        }

        const treeDetailData = await treeDetailResponse.json();
        logInfo(`Ответ от /api/tree/${treeId}:`, JSON.stringify(treeDetailData)); // Логирование ответа для отладки
        // Извлекаем поля (fields) из ответа, где содержатся customFieldId и их названия
        customFields = treeDetailData.fields || [];
        logInfo(`Успешно получены custom fields для treeId ${treeId}: ${customFields.length} полей`); // Логирование успеха

        // Шаг 3: Получаем основную структуру дерева тест-кейсов с использованием полученного treeId
        const structureUrl = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node`;
        const baseQueryParams = new URLSearchParams({
            treeId: treeId.toString(), // Используем полученный treeId
            page: '0', // Начальная страница
            size: '100', // Размер страницы, чтобы получить достаточно данных
            sort: 'nodeSortOrder,asc', // Сортировка, как в твоём примере
            deleted: 'false', // Фильтруем неудалённые узлы
        });

        // Выполняем начальный запрос структуры с авторизацией
        const initialStructureResponse = await fetchWithAuth(`${structureUrl}?${baseQueryParams.toString()}`, {
            headers: {
                ...authHeaders, // Используем глобальные заголовки с токеном
                'Content-Type': 'application/json', // Тип контента
            },
        });

        if (!initialStructureResponse.ok) {
            const errorMessage = await initialStructureResponse.text();
            logError(`Ошибка получения структуры проекта ${projectId} для treeId ${treeId}: ${initialStructureResponse.statusText}`, errorMessage); // Логирование ошибки
            throw new Error(`Не удалось получить структуру проекта: ${initialStructureResponse.statusText} - ${errorMessage}`);
        }

        const initialData = await initialStructureResponse.json();
        logInfo(`Ответ от /api/v2/project/${projectId}/test-case/tree/tree-node (корень):`, JSON.stringify(initialData)); // Логирование ответа для отладки

        logInfo(`Успешно получена начальная структура проекта ${projectId} с treeId ${treeId}`); // Логирование успеха

        // Рекурсивно получаем всю структуру, начиная с корневого узла
        const rootFolders = await getNestedFolders(projectId, null, treeId, customFields);

        return {
            projectId,
            folders: rootFolders, // Возвращаем только папки с полной вложенностью
        };
    } catch (error) {
        logError(`Ошибка обработки запроса структуры проекта ${projectId}:`, error.message); // Логирование ошибки
        throw error; // Пробрасываем ошибку для обработки выше
    }
}

/**
 * Рекурсивно получает папки и их вложенные дети из Allure API
 * @param {string} projectId - Идентификатор проекта в Allure
 * @param {number|null} parentNodeId - ID родительского узла (null для корня)
 * @param {number} treeId - Идентификатор дерева
 * @param {Array} customFields - Список пользовательских полей с id и названиями
 * @returns {Promise<Array>} - Массив отформатированных папок с их детьми
 */
async function getNestedFolders(projectId, parentNodeId, treeId, customFields) {
    const structureUrl = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node`;
    const queryParams = new URLSearchParams({
        treeId: treeId.toString(),
        page: '0',
        size: '100',
        sort: 'nodeSortOrder,asc',
        deleted: 'false',
    });

    if (parentNodeId !== null) {
        queryParams.append('parentNodeId', parentNodeId.toString());
    }

    logInfo(`Запрашиваем вложенные папки для projectId ${projectId}, treeId ${treeId}, parentNodeId ${parentNodeId}`); // Логирование шага
    const structureResponse = await fetchWithAuth(`${structureUrl}?${queryParams.toString()}`, {
        headers: {
            ...authHeaders, // Используем глобальные заголовки с токеном
            'Content-Type': 'application/json', // Тип контента
        },
    });

    if (!structureResponse.ok) {
        const errorMessage = await structureResponse.text();
        logError(`Ошибка получения вложенных папок для projectId ${projectId}, parentNodeId ${parentNodeId}: ${structureResponse.statusText}`, errorMessage); // Логирование ошибки
        throw new Error(`Не удалось получить вложенные папки: ${structureResponse.statusText} - ${errorMessage}`);
    }

    const data = await structureResponse.json();
    logInfo(`Ответ для parentNodeId ${parentNodeId}:`, JSON.stringify(data)); // Логирование ответа для отладки

    const folders = [];
    const customFieldsMap = new Map();
    customFields.forEach(field => {
        customFieldsMap.set(field.id, field.name);
    });

    for (const node of data.children?.content || []) {
        if (node.type === 'GROUP') {
            const folder = {
                id: node.id,
                name: node.name,
                customFieldId: node.customFieldId || null,
                customFieldName: customFieldsMap.get(node.customFieldId) || 'Неизвестное поле',
                count: node.children?.content?.length || 0,
                children: await getNestedFolders(projectId, node.id, treeId, customFields), // Рекурсивно получаем вложенные папки
            };
            folders.push(folder);
        }
    }

    logInfo(`Отформатировано папок для parentNodeId ${parentNodeId}: ${folders.length}`, JSON.stringify(folders)); // Логирование для отладки
    return folders;
}