/**
 * Парсит JSON-файлы фронтенда и бэкенда, извлекая компоненты для маппинга
 * @param {Object|null} frontendJson - JSON-файл фронтенда с компонентами
 * @param {Object|null} backendJson - JSON-файл бэкенда с контроллерами и эндпоинтами
 * @returns {Array} - Массив объектов компонентов с типом и названием
 */
export function parseJsonFiles(frontendJson, backendJson) {
    const components = []; // Массив для хранения всех компонентов
  
    // Парсинг компонентов фронтенда из JSON
    if (frontendJson && frontendJson.frontendComponent) {
      frontendJson.frontendComponent.forEach(component => {
        components.push({
          type: 'frontend', // Тип компонента (фронтенд)
          name: component.name // Название компонента
        });
      });
    }
  
    // Парсинг компонентов бэкенда (контроллеры и эндпоинты) из JSON
    if (backendJson && backendJson.Controllers) {
      backendJson.Controllers.forEach(controller => {
        // Добавляем имя контроллера как компонент
        components.push({
          type: 'backend', // Тип компонента (бэкенд)
          name: controller.ControllerName // Название контроллера
        });
  
        // Добавляем каждый эндпоинт как отдельный компонент
        controller.Endpoints.forEach(endpoint => {
          components.push({
            type: 'backend', // Тип компонента (бэкенд)
            name: `${controller.ControllerName}.${endpoint.RoutePath}` // Название эндпоинта с префиксом контроллера
          });
        });
      });
    }
  
    return components; // Возвращаем список всех компонентов
  }