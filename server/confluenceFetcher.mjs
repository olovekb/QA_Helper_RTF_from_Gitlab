import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const CONFLUENCE_BASE = 'https://confluence.artsofte.ru';
const CONTENT_URL = (pageId) => `${CONFLUENCE_BASE}/rest/api/content/${pageId}?expand=body.view`;

/**
 * =================================================================
 * УЛУЧШЕННЫЙ HTML-TO-MARKDOWN КОНВЕРТЕР
 * =================================================================
 * Эта функция рекурсивно обходит DOM-дерево и преобразует его в Markdown.
 */
function htmlToMarkdown(element) {
    if (!element) return '';

    const processNode = (node) => {
        // 1. Обработка текстовых узлов
        if (node.nodeType === 3) { // 3 = Text Node
            // Заменяем множественные пробелы и переносы на один пробел
            return node.textContent.replace(/\s+/g, ' ');
        }

        // 2. Обработка узлов-элементов
        if (node.nodeType === 1) { // 1 = Element Node
            const tagName = node.tagName.toLowerCase();
            const childrenMarkdown = Array.from(node.childNodes).map(processNode).join('');

            // 3. Обработка тегов
            switch (tagName) {
                // Блочные элементы с переносами строк
                case 'h1': return `# ${childrenMarkdown.trim()}\n\n`;
                case 'h2': return `## ${childrenMarkdown.trim()}\n\n`;
                case 'h3': return `### ${childrenMarkdown.trim()}\n\n`;
                case 'h4': return `#### ${childrenMarkdown.trim()}\n\n`;
                case 'p': return `${childrenMarkdown.trim()}\n\n`;
                case 'div': return `${childrenMarkdown.trim()}\n`; // div может быть и строчным, и блочным, добавляем один перенос
                case 'li': return `- ${childrenMarkdown.trim()}\n`;
                case 'ul':
                case 'ol': return `\n${childrenMarkdown}\n`;
                case 'blockquote':
                    // Добавляем '>' к каждой строке внутри цитаты
                    return `> ${childrenMarkdown.trim().replace(/\n/g, '\n> ')}\n\n`;

                // Обработка таблиц - КЛЮЧЕВОЕ УЛУЧШШЕНИЕ
                case 'table':
                    const headerRow = node.querySelector('thead tr, tr:first-child');
                    if (!headerRow) return '';
                    const colCount = headerRow.cells.length;
                    const separator = `|${' --- |'.repeat(colCount)}\n`;
                    return `\n${childrenMarkdown}${separator}`;
                case 'tr':
                    return `| ${childrenMarkdown.trim()} |\n`;
                case 'td':
                case 'th':
                    // Заменяем переносы строк внутри ячейки на <br> для корректного отображения в Markdown
                    return `${childrenMarkdown.trim().replace(/\n/g, '<br>')} | `;

                // Блоки кода (часто в Confluence)
                case 'pre':
                    return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;

                // Строчные элементы
                case 'strong':
                case 'b':
                    return `**${childrenMarkdown.trim()}**`;
                case 'em':
                case 'i':
                    return `*${childrenMarkdown.trim()}*`;
                case 'a':
                    let href = node.getAttribute('href') || '';
                    if (href.startsWith('/')) {
                        href = CONFLUENCE_BASE + href;
                    }
                    return `[${childrenMarkdown.trim()}](${href})`;

                // Игнорируемые теги
                case 'style':
                case 'script':
                    return '';

                // Все остальные теги просто рендерят своих детей
                default:
                    return childrenMarkdown;
            }
        }
        return ''; // Игнорируем другие типы узлов (комментарии и т.д.)
    };

    let markdown = processNode(element);

    // Финальная очистка: убираем лишние пробелы в начале строк и множественные пустые строки
    return markdown
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n') // Не более двух переносов подряд
        .trim();
}


export async function fetchConfluencePage(bearerToken, pageId) {
    const contentRes = await fetch(CONTENT_URL(pageId), {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${bearerToken}` }
    });

    const bodyText = await contentRes.text();
    if (!contentRes.ok) {
        throw new Error(`Content fetch failed: ${contentRes.status} ${bodyText.trim().slice(0, 200)}…`);
    }

    const data = JSON.parse(bodyText);
    const html = data.body?.view?.value;
    if (!html) throw new Error('Не найдено поле body.view.value');

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // --- УЛУЧШЕННАЯ ЛОГИКА ИЗВЛЕЧЕНИЯ КОНТЕНТА ---

    const containers = Array.from(doc.querySelectorAll('div.aura-tab-container'));
    let combinedContent = '';

    if (containers.length > 0) {
        // Если нашли табы, обрабатываем их как раньше
        const result = { businessRequirements: '', solutionConcept: '', scenarios: '' };
        for (const container of containers) {
            const labels = Array.from(container.querySelectorAll('.aura-tab-nav .aura-tab-item'));
            const contents = Array.from(container.querySelectorAll('.aura-tab-content > div[role="tabpanel"]'));

            for (let i = 0; i < Math.min(labels.length, contents.length); i++) {
                const label = labels[i]?.textContent?.trim().toLowerCase();
                const contentElement = contents[i];
                // Используем новый, улучшенный парсер
                const content = htmlToMarkdown(contentElement);

                if (label) {
                    if (label.includes('бизнес требования') || label.includes('бизнес-требования')) {
                        result.businessRequirements = content || '[пусто]';
                    } else if (label.includes('варианты реализации') || label.includes('образ решения')) {
                        result.solutionConcept = content || '[пусто]';
                    } else if (label.includes('сценарии')) {
                        result.scenarios = content || '[пусто]';
                    }
                }
            }
        }
        // Собираем результат из табов
        if (result.businessRequirements) combinedContent += `## Бизнес-требования\n\n${result.businessRequirements}\n\n---\n\n`;
        if (result.solutionConcept) combinedContent += `## Образ решения\n\n${result.solutionConcept}\n\n---\n\n`;
        if (result.scenarios) combinedContent += `## Сценарии\n\n${result.scenarios}\n\n---\n\n`;

    } else {
        // ЕСЛИ ТАБОВ НЕТ - парсим основное содержимое страницы. Это делает парсер более универсальным.
        console.warn('⚠️ Контейнеры с табами (.aura-tab-container) не найдены. Парсится все содержимое страницы.');
        // Часто основной контент в Confluence находится в <div id="main-content">
        const mainContent = doc.querySelector('#main-content') || doc.body;
        combinedContent = htmlToMarkdown(mainContent);
    }

    return combinedContent.trim() || '[empty]';
}