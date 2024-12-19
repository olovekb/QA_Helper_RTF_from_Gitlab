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
        console.log(extractAllureJSONStructure(parsedData))
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
    const result = [];

    children.forEach(child => {
        // Каждый child является feature
        const feature = {
            feature: child.title, // Название feature
            stories: child.children && child.children.attached
                ? child.children.attached.map(subtopic => convertSubtopicToStory(subtopic)) // Преобразуем вложенные элементы в story
                : [] // Если нет вложенных элементов, ставим пустой массив
        };
        result.push(feature);
    });

    return result;
}

// Преобразование подпункта в story
function convertSubtopicToStory(subtopic) {
    return {
        story: subtopic.title, // Каждое подзаголовок - это story
        scenarios: subtopic.children && subtopic.children.attached
            ? subtopic.children.attached.map(subsubtopic => convertSubtopicToScenario(subsubtopic)) // Преобразуем вложенные элементы в сценарии
            : [] // Если нет вложенных сценариев, ставим пустой массив
    };
}

// Преобразование более глубокого подпункта в сценарий
function convertSubtopicToScenario(subtopic) {
    return { scenario: subtopic.title }; // Название сценария
}
