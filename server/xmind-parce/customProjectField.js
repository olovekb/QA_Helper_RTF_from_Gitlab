/**
 * Объект с кастомными полями проекта по C4
 * @description
 * Для ноукода добавлены block и subBlock
 * @type {{feature: string, story: string, scenario: string, code: string, version: string, priority: string}}
 */
export const customProjectField = {
    feature: 'Feature',
    story: 'Story',
    scenario: 'Scenario',
    block: 'Block',
    subBlock: 'SubBlock',
    code: 'Code',
    version: 'Version',
    priority: 'Priority'
}

/**
 * Объект со слоями
 * @type {{apiTests: string, uiTests: string, unitTests: string, e2eTests: string, integrationFrontendTests: string, integrationBackendTests: string}}
 */
export const projectTestCaseLayers = {
    apiTests: 'API Tests',
    uiTests: 'UI Tests',
    unitTests: 'Units Tests',
    e2eTests: 'E2E Tests',
    integrationFrontendTests: 'Integration frontend Tests',
    integrationBackendTests: 'Integration backend Tests',
}