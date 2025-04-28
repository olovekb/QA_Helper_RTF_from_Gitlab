import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const CONFLUENCE_BASE = 'https://confluence.artsofte.ru';
const CONTENT_URL = (pageId) => `${CONFLUENCE_BASE}/rest/api/content/${pageId}?expand=body.view`;

export async function fetchConfluencePage(bearerToken, pageId) {
    // Получаем содержимое страницы через API
    const contentRes = await fetch(CONTENT_URL(pageId), {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearerToken}`
        }
    });

    const bodyText = await contentRes.text();

    if (!contentRes.ok) {
        throw new Error(`Content fetch failed: ${contentRes.status} ${bodyText.trim().slice(0, 200)}…`);
    }

    const data = JSON.parse(bodyText);
    const html = data.body?.view?.value;

    if (!html) {
        throw new Error('Не найдено поле body.view.value');
    }

    // Парсим HTML через JSDOM
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Удаляем все style и script теги
    doc.querySelectorAll('style, script').forEach(el => el.remove());

    // Функция для форматирования текста с сохранением структуры
    const formatText = (element) => {
        if (!element) return '';

        const processNode = (node, level = 0) => {
            let result = '';
            const children = Array.from(node.childNodes);

            for (const child of children) {
                if (child.nodeType === 3) { // Текстовый узел
                    const text = child.textContent.trim();
                    if (text) {
                        result += text + (child.nextSibling ? ' ' : '');
                    }
                } else if (child.nodeType === 1) { // Элемент
                    const tagName = child.tagName.toLowerCase();
                    const childText = processNode(child, level + 1);

                    if (!childText) continue;

                    if (tagName === 'h1') {
                        result += `# ${childText}\n\n`;
                    } else if (tagName === 'h2') {
                        result += `## ${childText}\n\n`;
                    } else if (tagName === 'h3') {
                        result += `### ${childText}\n\n`;
                    } else if (tagName === 'li') {
                        result += `- ${childText}\n`;
                    } else if (tagName === 'p' || tagName === 'div') {
                        result += `${childText}\n`;
                    } else {
                        result += childText;
                    }
                }
            }

            return result.trim();
        };

        const text = processNode(element);
        // Убираем лишние пустые строки
        return text.split(/\n+/).map(line => line.trim()).filter(line => line).join('\n');
    };

    // Ищем все вкладки и их содержимое
    const containers = Array.from(doc.querySelectorAll('div.aura-tab-container'));
    const result = {
        businessRequirements: '',
        solutionConcept: '',
        scenarios: ''
    };

    for (const container of containers) {
        const labels = Array.from(container.querySelectorAll('.aura-tab-nav .aura-tab-item'));
        const contents = Array.from(container.querySelectorAll('.aura-tab-content > div[role="tabpanel"]'));

        if (labels.length !== contents.length) {
            console.warn(`⚠️ Кол-во табов (${labels.length}) и контента (${contents.length}) не совпадает`);
        }

        for (let i = 0; i < Math.min(labels.length, contents.length); i++) {
            const label = labels[i]?.textContent?.trim();
            const contentElement = contents[i];
            const content = formatText(contentElement);

            if (label) {
                const normalizedLabel = label.toLowerCase();
                if (normalizedLabel.includes('бизнес требования') || normalizedLabel.includes('бизнес-требования')) {
                    result.businessRequirements = content || '[пусто]';
                } else if (normalizedLabel.includes('варианты реализации')) {
                    result.solutionConcept = content || '[пусто]';
                } else if (normalizedLabel.includes('сценарии')) {
                    result.scenarios = content || '[пусто]';
                }
            }
        }
    }

    // Проверяем, найдены ли данные
    if (!result.businessRequirements && !result.solutionConcept && !result.scenarios) {
        return '[empty]';
    }

    // Формируем структурированный результат в виде строки
    let output = '';
    if (result.businessRequirements) {
        output += `### Бизнес-требования\n\n${result.businessRequirements}\n\n---\n\n`;
    }
    if (result.solutionConcept) {
        output += `### Образ решения\n\n${result.solutionConcept}\n\n---\n\n`;
    }
    if (result.scenarios) {
        output += `### Сценарии\n\n${result.scenarios}\n\n---\n\n`;
    }

    return output.trim() || '[empty]';
}