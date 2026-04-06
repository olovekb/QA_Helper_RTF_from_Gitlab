/**
 * Утилиты для страницы TIA
 * @module TIAUtils
 */

import axios from 'axios';

/**
 * Проверяет, является ли JSON новым форматом TIA
 * @param {Object} json - Данные для проверки
 * @returns {boolean}
 */
export const isNewTiaFormat = (json) => json?.summary && Array.isArray(json.pages);

/**
 * Рекурсивный поиск папки по ID в дереве
 * @param {Array} folders - Дерево папок
 * @param {string|number} id - ID для поиска
 * @returns {Object|null}
 */
export const findFolderById = (folders, id) => {
    if (!id || !folders) return null;
    const idStr = id.toString().trim();
    for (const folder of folders) {
        if (folder.id?.toString().trim() === idStr) return folder;
        if (folder.children) {
            const found = findFolderById(folder.children, id);
            if (found) return found;
        }
    }
    return null;
};

/**
 * Рекурсивный поиск пути к папке
 * @param {Array} nodes - Узлы дерева
 * @param {string|number} targetId - Целевой ID
 * @param {Array} currentPath - Текущий путь
 * @returns {Array|null}
 */
export const findFolderPath = (nodes, targetId, currentPath = []) => {
    for (const node of nodes) {
        const nodeId = node.id;
        const newPath = [...currentPath, nodeId];
        if (String(nodeId) === String(targetId)) {
            return newPath;
        }
        if (node.children) {
            const found = findFolderPath(node.children, targetId, newPath);
            if (found) return found;
        }
    }
    return null;
};

/**
 * Форматирует отображаемое имя функционального блока
 * @param {Object} folder - Объект папки/блока
 * @param {number} [level=0] - Уровень вложенности
 * @returns {string}
 */
export const formatCustomFieldName = (folder, level = 0) => {
    if (folder.node_type === 'TEST_CASE') {
        const layerPrefix = folder.layer ? `[${folder.layer}] ` : '';
        return `${layerPrefix}${folder.name}`;
    }
    const type = folder.customFieldName || 'Блок';
    return `[${type}] ${folder.name}`;
};

/**
 * Фильтрация папок в зависимости от проекта (Nocode-специфика)
 * @param {Array} folders - Список папок
 * @param {string|number} projectId - ID проекта
 * @returns {Array}
 */
export const filterFoldersForProject = (folders, projectId) => {
    const nocodeProjectIds = ['307', '377'];
    if (!nocodeProjectIds.includes(String(projectId))) {
        return folders;
    }
    return folders.map(folder => ({
        ...folder,
        children: folder.children ? filterFoldersForProject(folder.children, projectId) : []
    }));
};

/**
 * Рекурсивный сбор всех ID потомков
 * @param {Object} folder - Родительский узел
 * @returns {string[]}
 */
export const getAllDescendantIds = (folder) => {
    const ids = [folder.id.toString()];
    if (folder.children && folder.children.length > 0) {
        folder.children.forEach(child => {
            ids.push(...getAllDescendantIds(child));
        });
    }
    return ids;
};

/**
 * Проверка, выбраны ли все потомки узла
 * @param {Object} folder - Узел
 * @param {string[]} mappings - Список замапленных ID
 * @returns {boolean}
 */
export const areAllDescendantsSelected = (folder, mappings) => {
    const folderId = folder.id.toString();
    if (mappings.includes(folderId)) return true;
    if (!folder.children || folder.children.length === 0) {
        return mappings.includes(folderId);
    }
    return folder.children.every(child => areAllDescendantsSelected(child, mappings));
};

/**
 * Извлечение компонентов из отчетов
 * @param {Object} frontendJSON - Отчет фронтенда
 * @param {Object} backendJSON - Отчет бэкенда
 * @param {Object} tiaReport - Общий отчет
 * @returns {Array}
 */
export const extractComponents = (frontendJSON, backendJSON, tiaReport) => {
    const componentsMap = new Map();

    const processReport = (report, defaultType) => {
        if (!report || !isNewTiaFormat(report)) return;
        const uniqueMap = report.unique_affected_components || {};

        const addComponent = (name, pageRisk, pageSummary, qaAdvice, detail, pageEnv) => {
            if (!name) return;
            const existing = componentsMap.get(name);
            const riskOrder = { HIGH: 3, MEDIUM: 2, LOW: 1, '': 0 };
            const bestRisk = existing && riskOrder[existing.riskLevel] > riskOrder[pageRisk] ? existing.riskLevel : (pageRisk || '');
            const mergedAdvice = [...(existing?.qaAdvice || []), ...(qaAdvice || [])];
            
            const nested = detail ? [{
                component_name: name,
                change_source: detail.change_source,
                changed_methods: detail.changed_methods || [],
                diff_snippet: detail.diff_snippet,
                file_path: detail.file_path,
                method_jsdoc: detail.method_jsdoc || {},
            }] : (existing?.nestedComponents || []);

            const envs = new Set(existing?.envs || []);
            if (pageEnv) envs.add(pageEnv);

            let compType = defaultType;
            if (report.type === 'backend' || detail?.type === 'backend') compType = 'backend';
            else if (report.type === 'frontend' || detail?.type === 'frontend') compType = 'frontend';

            componentsMap.set(name, {
                id: name,
                name,
                type: compType,
                riskLevel: bestRisk,
                summaryText: pageSummary || existing?.summaryText || '',
                qaAdvice: mergedAdvice,
                nestedComponents: nested,
                serviceName: detail?.file_path || existing?.serviceName || '',
                envs: Array.from(envs),
                jsdoc: detail?.jsdoc || detail?.class_description || detail?.description || existing?.jsdoc || null,
                uiContext: detail?.ui_context || existing?.uiContext || null,
                uiTrace: detail?.ui_trace || existing?.uiTrace || null
            });
        };

        (report.pages || []).forEach((page) => {
            const pageRisk = page.ai_analysis?.risk_level || '';
            const pageSummary = page.ai_analysis?.summary || '';
            const qaAdvice = page.ai_analysis?.qa_advice || [];
            const pageEnv = page.page_meta?.env;
            (page.depends_on_components || []).forEach((compName) => {
                const detail = uniqueMap[compName];
                addComponent(compName, pageRisk, pageSummary, qaAdvice, detail, pageEnv);
            });
        });

        if (report.backend_components && Array.isArray(report.backend_components)) {
            report.backend_components.forEach((bc) => {
                const key = `${bc.service_name || 'unknown'}::${bc.controller_name || bc.name}`;
                componentsMap.set(key, {
                    id: key,
                    name: bc.controller_name || bc.name,
                    serviceName: bc.service_name || '',
                    type: 'backend',
                    endpoints: bc.endpoints || [],
                    riskLevel: bc.risk_level || '',
                    summaryText: bc.summary || '',
                    qaAdvice: bc.qa_advice || [],
                    nestedComponents: [],
                    envs: bc.envs || [],
                    jsdoc: bc.description || null,
                });
            });
        }
    };

    processReport(frontendJSON, 'frontend');
    processReport(backendJSON, 'backend');

    return Array.from(componentsMap.values());
};

/**
 * Построение зависимостей компонентов от страниц
 * @param {Array} components - Список компонентов
 * @param {Object} frontendJSON - Отчет фронтенда
 * @param {Object} backendJSON - Отчет бэкенда
 * @returns {Array}
 */
export const buildPageDependencies = (components = [], frontendJSON, backendJSON) => {
    const dependencies = [];
    const componentTypeMap = new Map();
    components.forEach(comp => componentTypeMap.set(comp.name, comp.type));

    const processPages = (report) => {
        if (!report || !isNewTiaFormat(report)) return;
        (report.pages || []).forEach((page) => {
            const pageName = page.page_meta?.name;
            const pageRoute = page.page_meta?.route;
            if (pageName && page.depends_on_components) {
                page.depends_on_components.forEach((compName) => {
                    const realCompType = componentTypeMap.get(compName) || 'frontend';
                    const isPage = report.pages.some(p => p.page_meta?.name === compName);
                    dependencies.push({
                        pageName,
                        pageRoute: pageRoute || '',
                        componentName: compName,
                        componentType: isPage ? 'page' : 'component',
                        realComponentType: realCompType
                    });
                });
            }
        });
    };

    processPages(frontendJSON);
    processPages(backendJSON);
    return dependencies;
};

/**
 * Логирование ошибок
 * @param {string} type - Тип ошибки
 * @param {string} desc - Описание
 * @param {string} url - URL API
 */
export const logError = async (type, desc, url) => {
    try {
        await axios.post(`${url}/api/errors`, {
            errorType: type,
            description: desc,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('Logging failed', err.message);
    }
};
