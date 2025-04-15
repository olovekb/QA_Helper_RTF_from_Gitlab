
import fetch from "node-fetch";

/**
 * Извлекает идентификатор страницы (pageId) из URL Confluence.
 * Предполагается, что URL содержит параметр ?pageId=XXXXX.
 * @param {string} url - URL страницы Confluence.
 * @returns {string} - pageId.
 */
function extractPageId(url) {
    const match = url.match(/pageId=(\d+)/);
    if (match && match[1]) {
        return match[1];
    }
    throw new Error('Не удалось извлечь pageId из URL.');
}

/**
 * Получает содержимое страницы Confluence в виде HTML.
 *
 * Делается запрос по схеме:
 * GET {baseUrl}/rest/api/content/{pageId}?expand=body.storage
 *
 * @param {string} url - Полный URL страницы Confluence.
 * @param {string} baseUrl - Базовый URL вашего Confluence (например, "https://confluence.artsofte.ru").
 * @param {string} [authToken] - Токен авторизации (если требуется).
 * @returns {Promise<string>} - HTML-содержимое страницы.
 */
export async function fetchConfluenceContent(url, baseUrl, authToken = null) {
    // Извлекаем pageId из URL
    const pageId = extractPageId(url);
    // Формируем URL запроса к REST API Confluence
    const apiUrl = `${baseUrl}/rest/api/content/${pageId}?expand=body.storage`;

    const headers = {
        'Content-Type': 'application/json'
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(apiUrl, { headers });
    if (!response.ok) {
        throw new Error(`Ошибка запроса к Confluence API: ${response.status}`);
    }

    const data = await response.json();

    // HTML-содержимое страницы хранится в data.body.storage.value
    const html = data?.body?.storage?.value;
    if (!html) {
        throw new Error('Не найден HTML контент на странице');
    }

    return html;
}

/**
 * Преобразует HTML в простой текст.
 * Здесь используется простая замена – для более качественной обработки можно использовать библиотеку "html-to-text".
 *
 * @param {string} html - HTML строка.
 * @returns {string} - Простой текст.
 */
export function convertHtmlToText(html) {
    return html.replace(/<[^>]+>/g, ' ');
}


