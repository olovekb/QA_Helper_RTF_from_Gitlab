
/**
 * Экспорт xmind для структуры Ноукода
 * @param xmindData
 * @returns {FlatArray<([{block: *, subBlock: string, features: []}]|*)[], 1>[]|[{block: string, subBlock: string, features: *[]}]}
 */
export function extractAllureJSONStructureNocode(xmindData) {
    if (!xmindData || !xmindData[0] || !xmindData[0].rootTopic) {
        console.error('Ошибка: некорректная структура xmindData', xmindData);

        return [{ block: 'Не указано', subBlock: 'Не указано', features: [] }];
    }

    const rootTopic = xmindData[0].rootTopic;
    const level1Blocks = rootTopic.children?.attached || [];

    let blocks = [];

    if (!level1Blocks.length) {
        console.warn('Нет блоков первого уровня (level1Blocks), возвращаем значение по умолчанию');

        return [{
            block: 'Не указано',
            subBlock: 'Не указано',
            features: []
        }];
    }

    blocks = level1Blocks.map(level1 => {
        const blockTitle = level1.title?.trim() || 'Не указано';
        const level2SubBlocks = level1.children?.attached || [];

        if (!level2SubBlocks.length) {
            console.warn(`Нет subBlock для блока "${blockTitle}", возвращаем пустой features`);
            return [{
                block: blockTitle,
                subBlock: 'Не указано',
                features: []
            }];
        }

        return level2SubBlocks.map(level2 => {
            const subBlockTitle = level2.title?.trim() || 'Не указано';
            const featuresLevel = level2.children?.attached || [];
            const features = convertTopicToAllureFormat(featuresLevel);

            return {
                block: blockTitle,
                subBlock: subBlockTitle,
                features
            };
        });
    }).flat();

    return blocks;
}

// Преобразование первого уровня children в формат Allure
function convertTopicToAllureFormat(features) {
    const result = [];

    features.forEach(featureTopic => {
        const feature = {
            feature: featureTopic.title || 'Не указано',
            stories: featureTopic.children && featureTopic.children.attached
                ? featureTopic.children.attached.map(storyTopic => convertSubtopicToStory(storyTopic))
                : []
        };
        result.push(feature);
    });

    return result;
}

// Преобразование подпункта в story
function convertSubtopicToStory(storyTopic) {
    const e2eIndices = new Set(); // story-level E2E

    if (Array.isArray(storyTopic.boundaries)) {
        storyTopic.boundaries.forEach(b => {
            if (b.title === projectTestCaseLayers.e2eTests && typeof b.range === 'string') {
                const rangeMatch = b.range.match(/\((\d+),(\d+)\)/);
                if (rangeMatch) {
                    const start = parseInt(rangeMatch[1]);
                    const end = parseInt(rangeMatch[2]);
                    for (let i = start; i <= end; i++) e2eIndices.add(i);
                }
            }
        });
    }

    const children = storyTopic.children && storyTopic.children.attached ? storyTopic.children.attached : [];

    // Сформируем e2eCases на уровне story из указанных индексов
    const e2eCases = [];
    e2eIndices.forEach(idx => {
        const child = children[idx];

        if (child) {
            const steps = child.children && child.children.attached
                ? child.children.attached.map(grand => ({ step: grand.title }))
                : [];
            e2eCases.push({ name: child.title || 'Не указано', steps });
        }
    });

    const scenarios = children.length
        ? children.map((scenarioTopic, index) => {
            // Локальные границы на уровне конкретного сценария
            const hasLocalE2E = Array.isArray(scenarioTopic.boundaries) && scenarioTopic.boundaries.some(b => b.title === 'E2E Tests');
            // Собираем индексы интеграционных тестов по boundary.range
            const integrationIndexSet = new Set();
            if (Array.isArray(scenarioTopic.boundaries)) {
                scenarioTopic.boundaries.forEach(b => {
                    if (b.title === projectTestCaseLayers.integrationFrontendTests && typeof b.range === 'string') {
                        const m = b.range.match(/\((\d+),(\d+)\)/);
                        if (m) {
                            const start = parseInt(m[1]);
                            const end = parseInt(m[2]);
                            for (let i = start; i <= end; i++) integrationIndexSet.add(i);
                        }
                    }
                });
            }

            // story-level E2E: пропускаем такие пункты, они уже в e2eCases
            if (e2eIndices.has(index)) return null;

            const isE2EParent = hasLocalE2E; // локальный E2E на уровне сценария
            const hasIntegration = integrationIndexSet.size > 0;

            if (isE2EParent && scenarioTopic.children?.attached) {
                // Для E2E: родительский сценарий с шагами из дочерних элементов
                return {
                    scenario: scenarioTopic.title || 'Не указано',
                    isE2E: true,
                    isIntegration: false,
                    steps: scenarioTopic.children.attached.map(child => ({ step: child.title })),
                    codeList: [],
                    integrationSteps: [],
                    integrationCases: []
                };
            }

            const obj = convertSubtopicToScenario(scenarioTopic, false, hasIntegration);

            // Добавляем интеграционные шаги, сохраняя сценарий как папку
            if (hasIntegration && scenarioTopic.children?.attached) {
                const scChildren = scenarioTopic.children.attached;
                obj.integrationCases = [];
                obj.codeList = []; // без папок для остальных
                obj.steps = [];
                scChildren.forEach((child, idx) => {
                    if (integrationIndexSet.has(idx)) {
                        const steps = child.children && child.children.attached
                            ? child.children.attached.map(grand => ({ step: grand.title }))
                            : [];
                        obj.integrationCases.push({ name: child.title, steps });
                    } else {
                        obj.codeList.push({ code: child.title });
                    }
                });
            }
            return obj;
        })
        : [];

    const filteredScenarios = scenarios.filter(Boolean);

    return {
        story: storyTopic.title || 'Не указано',
        scenarios: filteredScenarios,
        e2eCases
    };
}

// Преобразование более глубокого подпункта в сценарий
function convertSubtopicToScenario(scenarioTopic, isE2E, isIntegration) {
    let steps = [];
    let codeList = [];

    if (isE2E || isIntegration) {
        // Для E2E и Integration: дочерние элементы как шаги (если не обработано как родительский E2E)
        steps = scenarioTopic.children && scenarioTopic.children.attached
            ? scenarioTopic.children.attached.map(stepTopic => ({ step: stepTopic.title }))
            : [];
    } else {
        // Для остальных: дочерние элементы как code
        codeList = scenarioTopic.children && scenarioTopic.children.attached
            ? scenarioTopic.children.attached.map(codeTopic => ({ code: codeTopic.title }))
            : [];
    }

    return {
        scenario: scenarioTopic.title || 'Не указано',
        isE2E,
        isIntegration,
        steps,
        codeList,
        integrationSteps: [],
        integrationCases: []
    };
}


const projectTestCaseLayers = {
    apiTests: 'API Tests',
    uiTests: 'UI Tests',
    unitTests: 'Units Tests',
    e2eTests: 'E2E Tests',
    integrationFrontendTests: 'Integration frontend Tests',
    integrationBackendTests: 'Integration backend Tests',
}