import JSZip from 'jszip';
import { extractAllureJSONStructureNocode } from "./extractAllureJsonStructureNocode.js";
import { extractAllureJSONStructure } from "./extractAllureJsonStructure.js";


export const parseXmindFile = async (file, projectId) => {
    try {
        const zip = new JSZip();
        const zipData = await zip.loadAsync(file);

        const jsonFiles = Object.keys(zipData.files).filter((filename) => filename.endsWith('.json'));

        if (jsonFiles.length === 0) {
            throw new Error('Не найден JSON файл в архиве XMind');
        }

        const jsonData = await zipData.files[jsonFiles[0]].async('text');
        const parsedData = JSON.parse(jsonData);


        if (projectId === '307') {
            return extractAllureJSONStructureNocode(parsedData);
        } else {
            return extractAllureJSONStructure(parsedData)
        }

    } catch (error) {
        console.error('Ошибка при обработке файла:', error);
        throw error;
    }
};

