import JSZip from 'jszip';
import {extractAllureJSONStructureNocode} from "./extractAllureJsonStructureNocode.js";
import {extractAllureJSONStructure} from "./extractAllureJsonStructure.js";


export const parseXmindFile = async (file, projectId) => {
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

        // Если проект Nocode 2.0, то парсим по новой вложенности
        if (projectId === '307') {
            console.log('Экспорт для ноукода', projectId)
            return extractAllureJSONStructureNocode(parsedData);
        } else {
            console.log('Экспорт не для ноукода', projectId)
            return extractAllureJSONStructure(parsedData)
        }

    } catch (error) {
        console.error('Ошибка при обработке файла:', error);
        throw error;
    }
};

