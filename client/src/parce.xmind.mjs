import JSZip from 'jszip';

export const parseXmindFile = async (file) => {
    try {
        // Используем JSZip для распаковки файла XMind
        const zip = new JSZip();
        const zipData = await zip.loadAsync(file);  // Распаковываем архив

        // Ищем JSON файл в архиве
        const jsonFiles = Object.keys(zipData.files).filter((filename) => filename.endsWith('.json'));

        if (jsonFiles.length === 0) {
            throw new Error('Не найден JSON файл в архиве XMind');
        }

        const jsonData = await zipData.files[jsonFiles[0]].async('text');  // Читаем JSON файл
        const parsedData = JSON.parse(jsonData);  // Парсим JSON

        // Преобразуем данные в формат Allure
        console.log('Преобразованные данные:',extractAllureJSONStructure(parsedData))
        return extractAllureJSONStructure(parsedData);
    } catch (error) {
        console.error('Ошибка при обработке файла:', error);
        throw error;
    }
};

// Функция для извлечения данных из структуры XMind
function extractAllureJSONStructure(xmindData) {
    const rootTopic = xmindData[0].rootTopic;

    // Процесс начинается с дочерних элементов rootTopic
    return convertTopicToAllureFormat(rootTopic.children.attached);
}

// Преобразование первого уровня children в формат Allure
function convertTopicToAllureFormat(children) {
    try {
        const result = [];

        children.forEach(child => {
            // Каждый child является feature
            const feature = {
                feature: child.title, // Название feature
                stories: child.children && child.children.attached
                    ? child.children.attached.map(subtopic => convertSubtopicToStory(subtopic))
                    // Преобразуем вложенные элементы в story
                    : [] // Если нет вложенных элементов, ставим пустой массив
            };

            console.log('ФИЧА', child.title);


            result.push(feature);
        });

        return result;
    } catch (error) {
        console.error(`Ошибка при преобразовании первого уровня rootTopic.children.attached. ${error}`);
    }

}

// Преобразование подпункта в story
function convertSubtopicToStory(subtopic) {
    try {
        return {
            story: subtopic.title, // Каждое подзаголовок - это story
            scenarios: subtopic.children && subtopic.children.attached
                ? subtopic.children.attached.map(scenario => convertSubtopicToScenario(scenario)) // Преобразуем вложенные элементы в сценарии
                : [] // Если нет вложенных сценариев, ставим пустой массив
        };
    } catch (error) {
        console.error(`Ошибка при преобразовании второго уровня в story. ${error}`);
    }
}


// Преобразование более глубокого подпункта в сценарий
function convertSubtopicToScenario(scenario) {
    try {
        return {
            scenario: scenario.title, // Название сценария
            codeList: scenario.children && scenario.children.attached ?
                scenario.children.attached.map(code => convertScenarioToCode(code))
                : []
        };
    } catch (error) {
        console.error(`Ошибка при преобразовании третьего уровня в Scenario. ${error}`);
    }

}

// Получение поля code
function convertScenarioToCode(code) {
    try {
        return {
            code: code.title
        }
    } catch (error) {
        console.error(`Ошибка при преобразовании 4-го уровня в Code. ${error}`);
    }
}
