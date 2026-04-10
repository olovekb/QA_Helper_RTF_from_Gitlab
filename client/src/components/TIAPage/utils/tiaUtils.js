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
    const name = typeof folder.name === 'object'
        ? (folder.name.name || folder.name.title || JSON.stringify(folder.name))
        : (folder.name === '[object Object]' ? `ID: ${folder.id}` : folder.name);
    return `[${type}] ${name}`;
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
 * @param {string[]|Set} mappings - Список замапленных ID
 * @returns {boolean}
 */
export const areAllDescendantsSelected = (folder, mappings) => {
    const mappingsSet = mappings instanceof Set ? mappings : new Set(mappings);
    const folderId = folder.id.toString();

    if (mappingsSet.has(folderId)) return true;

    if (!folder.children || folder.children.length === 0) {
        return mappingsSet.has(folderId);
    }

    return folder.children.every(child => areAllDescendantsSelected(child, mappingsSet));
};

/**
 * Извлечение компонентов из отчетов
 * @param {Object} frontendJSON - Отчет фронтенда
 * @param {Object} backendJSON - Отчет бэкенда
 * @param {Object} tiaReport - Общий отчет
 * @returns {Array}
 */
export const extractComponents = (frontendJSON, backendJSON, tiaReport) => {
    console.time('extractComponents');
    const componentsMap = new Map();

    const processReport = (report, defaultType) => {
        if (!report || !isNewTiaFormat(report)) return;
        const uniqueDetails = report.unique_affected_components || {};

        const addComponent = (name, pageRisk, pageSummary, qaAdvice, detail, pageEnv) => {
            if (!name) return;

            const isBackend = report.type === 'backend' || detail?.type === 'backend' || defaultType === 'backend';
            const compKey = isBackend
                ? `${detail?.file_path || report.service_name || 'unknown'}::${name}`
                : name;

            const existing = componentsMap.get(compKey);

            const riskOrder = { HIGH: 3, MEDIUM: 2, LOW: 1, '': 0 };
            const bestRisk = (existing && riskOrder[existing.riskLevel] > riskOrder[pageRisk])
                ? existing.riskLevel
                : (pageRisk || '');

            const adviceMap = new Map();
            const addAdvice = (items) => {
                if (!items || !Array.isArray(items)) return;
                items.forEach(item => {
                    if (!item) return;
                    const key = `${item.area}|${item.priority}|${(item.scenarios || []).join(',')}`;
                    if (!adviceMap.has(key)) {
                        adviceMap.set(key, item);
                    }
                });
            };

            if (existing?.qaAdvice) addAdvice(existing.qaAdvice);
            addAdvice(qaAdvice);
            if (detail?.qa_advice) addAdvice(detail.qa_advice);

            const mergedAdvice = Array.from(adviceMap.values());

            const newNested = detail ? {
                component_name: name,
                change_source: detail.change_source,
                changed_methods: detail.changed_methods || [],
                diff_snippet: detail.diff_snippet,
                file_path: detail.file_path,
                method_jsdoc: detail.method_jsdoc || {},
                type: detail.type || defaultType
            } : null;

            const mergedNested = existing?.nestedComponents || [];
            if (newNested && !mergedNested.some(n => n.file_path === newNested.file_path && n.change_source === newNested.change_source)) {
                mergedNested.push(newNested);
            }

            const envs = new Set(existing?.envs || []);
            if (pageEnv) envs.add(pageEnv);
            if (detail?.envs) detail.envs.forEach(e => envs.add(e));

            let compType = existing?.type || defaultType;
            if (isBackend) compType = 'backend';

            let bestSummary = existing?.summaryText || '';
            const componentSummary = detail?.ai_analysis?.summary || detail?.summary || pageSummary || '';

            if (componentSummary && (!bestSummary || componentSummary.length > bestSummary.length)) {
                bestSummary = componentSummary;
            }

            componentsMap.set(compKey, {
                id: compKey,
                name,
                type: compType,
                riskLevel: bestRisk,
                summaryText: bestSummary,
                qaAdvice: mergedAdvice,
                nestedComponents: mergedNested,
                serviceName: detail?.file_path || report.service_name || existing?.serviceName || '',
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
                const detail = uniqueDetails[compName];
                addComponent(compName, pageRisk, pageSummary, qaAdvice, detail, pageEnv);
            });
        });

        if (report.backend_components && Array.isArray(report.backend_components)) {
            report.backend_components.forEach((bc) => {
                const bcName = bc.controller_name || bc.name;
                addComponent(bcName, bc.risk_level, bc.summary, bc.qa_advice, bc, null);
            });
        }

        Object.entries(uniqueDetails).forEach(([compName, detail]) => {
            const risk = detail.risk_level || detail.criticality?.criticality_level || '';
            const summary = detail.ai_analysis?.summary || detail.summary || '';
            const advice = detail.ai_analysis?.qa_advice || detail.qa_advice || [];
            addComponent(compName, risk, summary, advice, detail, null);
        });
    };

    if (frontendJSON) processReport(frontendJSON, 'frontend');
    if (backendJSON) processReport(backendJSON, 'backend');
    if (tiaReport && !frontendJSON && !backendJSON) processReport(tiaReport, 'frontend');

    const result = Array.from(componentsMap.values());
    console.timeEnd('extractComponents');
    console.log(`TIA Performance: Extracted ${result.length} unique components`);
    return result;
};

/**
 * Проверка, является ли одна папка подпапкой другой
 * @param {Array} folders - Дерево папок
 * @param {string|number} parentId
 * @param {string|number} childId
 * @returns {boolean}
 */
export const isSubfolderOf = (folders, parentId, childId) => {
    const parent = findFolderById(folders, parentId);
    if (!parent) return false;
    const descendantIds = getAllDescendantIds(parent);
    return descendantIds.includes(childId.toString());
};

/**
 * Построение зависимостей компонентов от страниц
 * @param {Array} components - Список компонентов
 * @param {Object} frontendJSON - Отчет фронтенда
 * @param {Object} backendJSON - Отчет бэкенда
 * @returns {Array}
 */
export const buildPageDependencies = (components = [], frontendJSON, backendJSON) => {
    console.time('buildPageDependencies');
    const dependencies = [];
    const componentTypeMap = new Map();
    components.forEach(comp => componentTypeMap.set(comp.name, comp.type));

    const processPages = (report) => {
        if (!report || !isNewTiaFormat(report)) return;

        const pageNamesSet = new Set((report.pages || []).map(p => p.page_meta?.name).filter(Boolean));

        (report.pages || []).forEach((page) => {
            const pageName = page.page_meta?.name;
            const pageRoute = page.page_meta?.route;
            if (pageName && page.depends_on_components) {
                page.depends_on_components.forEach((compName) => {
                    const realCompType = componentTypeMap.get(compName) || 'frontend';
                    const isPage = pageNamesSet.has(compName);
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

    console.timeEnd('buildPageDependencies');
    return dependencies;
};

/**
 * Логирование ошибок
 * @param {string} type
 * @param {string} desc
 * @param {string} url
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
