/**
 * Парсит JSON-файлы фронтенда и бэкенда, извлекая компоненты для маппинга.
 * Поддерживает старый формат (frontendComponent/Controllers) и новый формат TIA-отчёта (summary/pages).
 * @param {Object|null} frontendJson - JSON-файл фронтенда с компонентами
 * @param {Object|null} backendJson - JSON-файл бэкенда с контроллерами и эндпоинтами или новый TIA-отчёт
 * @returns {Array} - Массив объектов компонентов с типом и названием
 */
export function parseJsonFiles(frontendJson, backendJson) {
  const components = [];

  const tiaReport = backendJson || frontendJson;
  if (tiaReport && Array.isArray(tiaReport.pages) && tiaReport.summary) {
    if (tiaReport.unique_affected_components) {
      Object.values(tiaReport.unique_affected_components).forEach((comp) => {
        components.push({
          type: 'component',
          name: comp.component_name,
        });
      });
    } else {
      tiaReport.pages.forEach((page, idx) => {
        (page.depends_on_components || []).forEach((name) => {
          components.push({
            type: 'component',
            name,
          });
        });
        const pageName = page.page_meta?.name || `Page_${idx + 1}`;
        components.push({
          type: 'page',
          name: pageName,
        });
      });
    }
    return components;
  }

  if (frontendJson && Array.isArray(frontendJson.frontendComponent)) {
    frontendJson.frontendComponent.forEach((component) => {
      components.push({
        type: 'frontend',
        name: component.name,
      });
    });
  }

  if (backendJson && Array.isArray(backendJson.Controllers)) {
    backendJson.Controllers.forEach((controller) => {
      components.push({
        type: 'backend',
        name: controller.ControllerName,
      });

      (controller.Endpoints || []).forEach((endpoint) => {
        components.push({
          type: 'backend',
          name: `${controller.ControllerName}.${endpoint.RoutePath}`,
        });
      });
    });
  }

  return components;
}