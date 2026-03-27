import fetch from 'node-fetch';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { JSDOM } from 'jsdom';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { join } from 'path';
import os from 'os';
import pLimit from 'p-limit';

const execAsync = promisify(exec);
const ocrLimit = pLimit(1);

const CONFLUENCE_BASE = process.env.CONFLUENCE_BASE || 'https://confluence.artsofte.ru';
const CONTENT_URL = (pageId) =>
    `${CONFLUENCE_BASE}/rest/api/content/${pageId}?expand=body.export_view,version,metadata.labels,ancestors`;
const ATTACHMENTS_URL = (pageId, limit = 200) =>
    `${CONFLUENCE_BASE}/rest/api/content/${pageId}/child/attachment?limit=${limit}&expand=version,metadata`;
const CHILD_PAGES_URL = (pageId, limit = 100) =>
    `${CONFLUENCE_BASE}/rest/api/content/${pageId}/child/page?limit=${limit}`;
const VIEW_URL = (pageId) => `${CONFLUENCE_BASE}/pages/viewpage.action?pageId=${pageId}`;

// --- Утилиты ------------------------------------------------------------------
const TEXTUAL_MIMES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/xml',
    'text/html',
    'application/json',
    'application/xml',
    'application/yaml',
    'application/x-yaml',
]);

const collapseWS = (s) => String(s).replace(/\s+/g, ' ').trim();

function absolutizeUrls(html, base) {
    return html.replace(/(src|href)=(["'])\/(?!\/)/g, (_m, attr, quote) => `${attr}=${quote}${base}/`);
}

function canonicalizeConfluenceUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.hostname.includes('confluence')) {
            u.searchParams.delete('atl_token');
            if (u.pathname.endsWith('/pages/createpage.action')) {
                const from = u.searchParams.get('fromPageId') || u.searchParams.get('pageId');
                if (from) {
                    u.pathname = u.pathname.replace('/createpage.action', '/viewpage.action');
                    u.search = `pageId=${from}`;
                }
            }
        }
        return u.toString();
    } catch {
        return raw;
    }
}

function canonicalizeAllLinksInMarkdown(md) {
    return md.replace(/\((https?:\/\/[^)\s]+)\)/g, (_, url) => `(${canonicalizeConfluenceUrl(url)})`);
}

// Убираем CSS-макросы/шум
function stripCssNoiseFromMarkdown(md) {
    const lines = md.split('\n');
    const out = [];
    let inCss = false;
    let brace = 0;

    for (let line of lines) {
        const t = line.trim();

        if (!inCss && (t.startsWith('.') || t.startsWith('#')) && t.includes('{') && /[;:{}#\[\]]/.test(t)) {
            inCss = true;
            brace = (t.match(/{/g) || []).length - (t.match(/}/g) || []).length;
            continue;
        }
        if (inCss) {
            brace += (t.match(/{/g) || []).length - (t.match(/}/g) || []).length;
            if (brace <= 0) inCss = false;
            continue;
        }
        out.push(line);
    }
    return out.filter((l) => !/^(?:\.|#)[\w\-].*{.*}/.test(l.trim())).join('\n');
}

// Сносим подписи табов, дублирующие заголовки
function stripConfluenceTabCaptions(md) {
    const tabNames = ['Бизнес-требования', 'Варианты реализации', 'Сценарии', 'Экранные формы'];
    const lines = md.split('\n');
    const filtered = lines.filter((line) => {
        const t = line.trim();
        if (!t) return true;
        return !(tabNames.includes(t) && !t.startsWith('#'));
    });
    return filtered.join('\n');
}

// Сплющиваем вложенные блокквоты
function flattenBlockquotes(md) {
    return md.replace(/^>+\s?/gm, '> ');
}

// Дедуп и нормализация admonitions
function normalizeAdmonitions(md) {
    let out = flattenBlockquotes(md);
    out = out.replace(/(^>\s*\[!NOTE][^\n]*\n)(?:^>\s*\[!NOTE][^\n]*\n)+/gm, '$1');
    return out;
}

// Перенумерация упорядоченных списков по уровням (1..n на каждом уровне)
function renumberOrderedLists(md) {
    const lines = md.split('\n');
    const out = [];
    const counters = [];
    let inCode = false;

    const olRx = /^(\s*)(\d+)[\.\)]\s+(.*)$/;
    const fenceRx = /^\s*```/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (fenceRx.test(line)) {
            inCode = !inCode;
            out.push(line);
            continue;
        }
        if (inCode) {
            out.push(line);
            continue;
        }

        const m = line.match(olRx);
        if (!m) {
            if (!line.trim() || line.startsWith('#') || line.trim().startsWith('|') || line.trim().startsWith('>')) {
                counters.length = 0;
            }
            out.push(line);
            continue;
        }

        const indent = m[1] || '';
        const level = Math.floor(indent.length / 2);
        const text = m[3];

        if (counters.length <= level) {
            while (counters.length <= level) counters.push(0);
        } else {
            counters.length = level + 1;
        }
        counters[level] = (counters[level] || 0) + 1;

        out.push(`${'  '.repeat(level)}${counters[level]}. ${text}`);
    }
    return out.join('\n');
}

export function normalizeNestedLists(md) {
    const lines = md.split('\n');

    const rx = /^(\s*)([-–—*•]|(\d+)[.)]|([A-Za-zА-Яа-я])[.)]|([ivxlcdmIVXLCDM]+)[.)])\s+(.*)$/;
    const KIND = { NUM: 'num', ALPHA: 'alpha', ROMAN: 'roman', BULLET: 'bullet' };

    const getKind = (m) => {
        if (m[3]) return KIND.NUM;
        if (m[4]) return KIND.ALPHA;
        if (m[5]) return KIND.ROMAN;
        return KIND.BULLET;
    };

    let prevKind = null;
    let prevIndent = 0;
    let level = 0;

    const out = [];

    for (const raw of lines) {
        const m = raw.match(rx);
        if (!m) {
            if (/^\s*#/.test(raw) || /^\s*\|/.test(raw) || !raw.trim()) {
                prevKind = null;
                prevIndent = 0;
                level = 0;
            }
            out.push(raw);
            continue;
        }

        let [, indent, , /*num*/, alpha, roman, rest] = m;
        const kind = getKind(m);
        const curIndent = indent.length;

        let target = Math.floor(curIndent / 2);

        if (curIndent === prevIndent && prevKind && prevKind !== kind) {
            if (prevKind === KIND.NUM && (kind === KIND.ALPHA || kind === KIND.ROMAN || kind === KIND.BULLET)) {
                target = Math.max(level + 1, target);
            } else if (prevKind === KIND.ALPHA && (kind === KIND.ROMAN || kind === KIND.BULLET)) {
                target = Math.max(level + 1, target);
            }
        }

        if (curIndent > prevIndent) target = Math.max(level + 1, target);
        if (curIndent < prevIndent) target = Math.min(target, level, Math.floor(curIndent / 2));

        level = Math.max(0, target);
        prevIndent = curIndent;
        prevKind = kind;

        const pad = '  '.repeat(level);

        if (kind === KIND.ALPHA) {
            out.push(`${pad}- ${alpha}.) ${rest}`);
        } else if (kind === KIND.ROMAN) {
            out.push(`${pad}- ${roman}.) ${rest}`);
        } else if (kind === KIND.BULLET) {
            out.push(`${pad}- ${rest}`);
        } else {
            out.push(`${pad}1. ${rest}`);
        }
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// Полностью удаляем inline-изображения
function stripInlineImagesFromMarkdown(md) {
    let out = md;
    out = out.replace(/!\[[^\]]*]\([^)\n]+\)/g, '');
    out = out.replace(/\n{3,}/g, '\n\n');
    return out;
}

// ---------------------- Надёжная конверсия HTML-таблиц → Markdown ------------
function serializeInline(node) {
    // текстовая сборка содержимого ячейки с поддержкой ссылок/BR, без картинок
    if (node.nodeType === 3) return node.nodeValue || '';
    const name = (node.nodeName || '').toUpperCase();
    if (name === 'BR') return ' / ';
    if (name === 'IMG' || name === 'SVG') return '';
    if (name === 'A') {
        const href = node.getAttribute('href') || '';
        const text = collapseWS(Array.from(node.childNodes).map(serializeInline).join(''));
        if (!text) return '';
        const url = canonicalizeConfluenceUrl(href);
        return `[${text}](${url})`;
    }
    return Array.from(node.childNodes).map(serializeInline).join('');
}

function tableToMarkdown(tableEl) {
    // 1) собираем строки
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (!rows.length) return '';

    // 2) определяем число колонок (с учётом colspan)
    const colCount = rows.reduce((max, tr) => {
        const sum = Array.from(tr.children).reduce((acc, td) => acc + (parseInt(td.getAttribute('colspan') || '1', 10) || 1), 0);
        return Math.max(max, sum);
    }, 0);

    // 3) заполняем сетку с учётом rowspan/colspan
    const grid = [];
    const carry = new Array(colCount).fill(0); // сколько строк ещё «занято» из-за rowspan

    for (const tr of rows) {
        const row = new Array(colCount).fill('');
        // сначала помечаем занятые колонки пустыми, уменьшаем счетчики
        for (let c = 0; c < colCount; c++) if (carry[c] > 0) carry[c]--;

        let col = 0;
        const cells = Array.from(tr.children);
        for (const cell of cells) {
            // ищем первую свободную колонку
            while (col < colCount && carry[col] > 0) col++;
            if (col >= colCount) break;

            const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
            const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);

            let text = collapseWS(serializeInline(cell));
            // частые артефакты глоссариев
            if (/^\s*(изображение|image)\s*$/i.test(text)) text = '';

            row[col] = text;

            // бронируем последующие колонки в текущей строке
            for (let k = 1; k < colspan; k++) row[col + k] = '';

            // помечаем занятие строк из-за rowspan
            for (let k = 0; k < colspan; k++) if (rowspan > 1) carry[col + k] = Math.max(carry[col + k], rowspan - 1);

            col += colspan;
        }
        grid.push(row);
    }

    // 4) определяем правую «полезную» границу (чтобы не тянуть хвосты пустых)
    let lastUseful = colCount - 1;
    outer: for (; lastUseful >= 0; lastUseful--) {
        for (const r of grid) if ((r[lastUseful] || '').trim()) break outer;
    }
    const width = Math.max(0, lastUseful + 1);
    const trimmed = grid.map(r => r.slice(0, width));

    if (!trimmed.length || !width) return '';

    // 5) первая строка — заголовок, если есть thead/th, иначе берём первую ненулевую
    const hasTh = !!tableEl.querySelector('th');
    const headerRowIndex = 0; // минимально инвазивно: всегда первая
    const header = trimmed[headerRowIndex].map(c => c || ' ');
    const body = trimmed.slice(headerRowIndex + 1);

    const headerSep = new Array(width).fill('---');

    const toLine = (arr) => `| ${arr.map(x => (x || '').trim()).join(' | ')} |`;

    const lines = [
        toLine(header),
        toLine(headerSep),
        ...body.map(toLine),
    ];

    return '\n' + lines.join('\n') + '\n\n';
}

// Turndown + правила -----------------------------------------------------------
function buildTurndown() {
    const td = new TurndownService({
        codeBlockStyle: 'fenced',
        headingStyle: 'atx',
        bulletListMarker: '-',
        emDelimiter: '*',
        br: '\n',
    });
    td.use(gfm);

    // Чистим содержимое ячеек таблиц (схлопываем пробелы/переносы)
    td.addRule('clean-cells', {
        filter: ['td', 'th'],
        replacement: function (content) {
            return content.replace(/\s+/g, ' ').trim();
        },
    });

    // Переопределяем конверсию TABLE целиком (надёжнее, чем gfm по сложным макросам)
    td.addRule('strong-table', {
        filter: (node) => node.nodeName === 'TABLE',
        replacement: (_content, node) => {
            try {
                return tableToMarkdown(node);
            } catch {
                // если что-то пошло не так — даём шанс стандартному конвертору (не регрессим)
                return '\n\n';
            }
        }
    });

    // Панели/инфобоксы Confluence
    td.addRule('aui-panels', {
        filter: (node) =>
            node.nodeName === 'DIV' &&
            node.getAttribute('class') &&
            /(?:aui-message|confluence-information-macro)/.test(node.getAttribute('class')),
        replacement: (content, node) => {
            const titleEl =
                node.querySelector('.title, .aui-message-header') ||
                node.querySelector('.confluence-information-macro-title');
            const title = titleEl ? titleEl.textContent.trim() : 'Note';
            const body = content.trim().replace(/^\s+|\s+$/g, '');
            return `\n> [!NOTE] ${title}\n> ${body.replace(/\n/g, '\n> ')}\n\n`;
        },
    });

    // Fenced code
    td.addRule('fenced-pre', {
        filter: (node) => node.nodeName === 'PRE' && node.firstElementChild && node.firstElementChild.nodeName === 'CODE',
        replacement: (_content, node) => {
            const codeEl = node.firstElementChild;
            const langMatch =
                (codeEl.getAttribute('data-syntaxhighlighter-params') || '').match(/brush:(\w+)/i) ||
                (codeEl.getAttribute('class') || '').match(/language-(\w+)/i);
            const lang = langMatch ? langMatch[1] : '';
            const text = codeEl.textContent.replace(/\n+$/, '');
            return `\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
        },
    });

    return td;
}

function frontMatter(meta) {
    const labels = (meta?.metadata?.labels?.results || []).map((l) => l.name);
    const fm = {
        source: 'Confluence',
        pageId: meta?.id,
        title: meta?.title,
        version: meta?.version?.number,
        lastUpdated: meta?.version?.when,
        labels,
        url: VIEW_URL(meta?.id),
    };
    const esc = (v) => String(v).replace(/"/g, '\\"');
    return [
        '---',
        `source: ${fm.source}`,
        `pageId: ${fm.pageId}`,
        `title: "${esc(fm.title || '')}"`,
        `version: ${fm.version || ''}`,
        `lastUpdated: "${fm.lastUpdated || ''}"`,
        `labels: [${labels.map((x) => `"${esc(x)}"`).join(', ')}]`,
        `url: "${fm.url}"`,
        '---',
        '',
    ].join('\n');
}

function buildAttachmentUrl(att) {
    const dl = att?._links?.download || att?._links?.self || '';
    if (dl?.startsWith('/')) return `${CONFLUENCE_BASE}${dl}`;
    if (dl) return dl;
    const id = att?.id || att?._id;
    const title = encodeURIComponent(att?.title || 'file');
    return `${CONFLUENCE_BASE}/download/attachments/${id}/${title}`;
}

async function tryFetchTextAttachment(url, bearer) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (![...TEXTUAL_MIMES].some((m) => ct.includes(m))) return null;
    return await r.text();
}

// --- Основная функция ----------------------------------------------------------
/**
 * Получает Markdown страницы и её вложения
 * @param {string} bearerToken Токен авторизации
 * @param {string|number} pageId ID страницы
 * @param {object} options Настройки
 * @param {boolean} [options.inlineTextAttachments=true] Инлайнить текст
 * @param {boolean} [options.includeChildren=false] Включать дочерние страницы
 * @param {boolean} [options.ocr=false] Выполнять OCR для изображений
 * @param {number} [options.depth=0] Текущая глубина рекурсии
 */
export async function fetchConfluencePage(
    bearerToken,
    pageId,
    { inlineTextAttachments = true, includeChildren = false, ocr = false, depth = 0 } = {}
) {
    // Валидация входных параметров
    if (!bearerToken || typeof bearerToken !== 'string' || !bearerToken.trim()) {
        throw new Error('bearerToken обязателен и должен быть непустой строкой');
    }
    if (!pageId) {
        throw new Error('pageId обязателен');
    }

    const cleanToken = bearerToken.trim();
    const url = CONTENT_URL(pageId);

    console.log(`[fetchConfluencePage] Запрос к Confluence: pageId=${pageId}, URL=${url}`);
    console.log(`[fetchConfluencePage] bearerToken длина: ${cleanToken.length}, первые 20 символов: ${cleanToken.substring(0, 20)}...`);

    // 1) HTML export_view
    const contentRes = await fetch(url, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${cleanToken}`
        },
    });
    const bodyText = await contentRes.text();
    if (!contentRes.ok) {
        const errorMsg = bodyText.trim().slice(0, 500);
        console.error(`[fetchConfluencePage] ❌ Ошибка ${contentRes.status}: ${errorMsg}`);
        if (contentRes.status === 401) {
            throw new Error(`Ошибка авторизации (401) при загрузке страницы Confluence pageId=${pageId}. Проверьте bearerToken. Ответ сервера: ${errorMsg}`);
        }
        throw new Error(`Content fetch failed: ${contentRes.status} ${errorMsg}…`);
    }
    const data = JSON.parse(bodyText);
    const rawHtml = data.body?.export_view?.value;
    if (!rawHtml) throw new Error('Не найдено поле body.export_view.value');

    // 2) Абсолютизация ссылок
    const html = absolutizeUrls(rawHtml, CONFLUENCE_BASE.replace(/\/+$/, ''));

    // 3) HTML → Markdown
    const td = buildTurndown();
    const dom = new JSDOM(html);
    let mdBody = td.turndown(dom.window.document.body);

    if (!ocr) {
        mdBody = stripInlineImagesFromMarkdown(mdBody);
    }

    // 5) Вложения
    const attRes = await fetch(ATTACHMENTS_URL(pageId), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${bearerToken}` },
    });
    const attText = await attRes.text();
    if (!attRes.ok) {
        throw new Error(`Attachments fetch failed: ${attRes.status} ${attText.trim().slice(0, 200)}…`);
    }
    const attJson = JSON.parse(attText);
    // исключаем изображения из итогового списка вложений
    const attachments = (attJson.results || [])
        .map((a) => ({
            name: a.title,
            url: buildAttachmentUrl(a),
            mediaType: a.metadata?.mediaType || a.mimeType,
            size: a.extensions?.fileSize || a.filesize,
        }));

    if (!ocr) {
        attachments.filter((a) => !/^image\//i.test(a.mediaType || ''));
    }

    // 6) Список вложений + инлайн текстовых
    let attachmentsMd = '';
    for (const a of attachments) {
        attachmentsMd += `- [${a.name}](${canonicalizeConfluenceUrl(a.url)})${a.mediaType ? ` — ${a.mediaType}` : ''}${a.size ? ` (${a.size} bytes)` : ''}\n`;
    }

    let inlineSection = '';
    if (inlineTextAttachments && attachments.length) {
        const textOnes = [];
        for (const a of attachments) {
            try {
                const text = await tryFetchTextAttachment(a.url, bearerToken);
                if (text) textOnes.push({ name: a.name, text });
            } catch {
                /* пропускаем */
            }
        }
        if (textOnes.length) {
            inlineSection =
                '\n---\n\n' +
                textOnes
                    .map(
                        ({ name, text }) =>
                            `--- НАЧАЛО ВЛОЖЕНИЯ: ${name} ---\n\n${text.trim()}\n\n--- КОНЕЦ ВЛОЖЕНИЯ: ${name} ---`
                    )
                    .join('\n\n') +
                '\n';
        }
    }

    // 7) Сборка MD
    let md =
        frontMatter(data) +
        mdBody.trim() +
        (attachments.filter(a => !/^image\//i.test(a.mediaType || '')).length ? `\n\n## Вложения\n\n${attachmentsMd}` : '') +
        inlineSection;

    if (ocr) {
        const imageAttachments = attachments.filter(a => /^image\//i.test(a.mediaType || ''));
        if (imageAttachments.length > 0) {
            console.log(`[fetchConfluencePage] Найдено ${imageAttachments.length} изображений для OCR`);
            const ocrResults = await processOcrForImages(imageAttachments, bearerToken);
            if (ocrResults) {
                md += '\n\n## Результаты OCR изображений\n\n' + ocrResults;
            }
        }
    }

    md = `[CONFLUENCE_PAGE: id=${pageId}, title="${data.title || ''}"]\n\n` + md;

    if (includeChildren && depth < 5) {
        console.log(`[fetchConfluencePage] Загрузка дочерних страниц для ${pageId} (глубина ${depth})`);
        const childPages = await fetchChildPagesRecursively(pageId, bearerToken, {
            inlineTextAttachments,
            includeChildren,
            ocr,
            depth: (depth || 0) + 1
        });
        return {
            id: String(pageId),
            title: data.title,
            markdown: md.trim(),
            attachments: attachments.filter(a => !/^image\//i.test(a.mediaType || '')),
            childPages
        };
    }

    return {
        id: String(pageId),
        title: data.title,
        markdown: md.trim(),
        attachments: attachments.filter(a => !/^image\//i.test(a.mediaType || ''))
    };
}

/**
 * Выполняет OCR для списка изображений
 * @param {Array} images 
 * @param {string} token 
 */
async function processOcrForImages(images, token) {
    let combinedResults = '';
    const tempDir = join(os.tmpdir(), `confluence_ocr_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
        const ocrPromises = images.map(img => ocrLimit(async () => {
            const fileName = img.name || `image_${Date.now()}.png`;
            const filePath = join(tempDir, fileName);

            try {
                const response = await fetch(img.url, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`);

                const buffer = await response.buffer();
                await fs.writeFile(filePath, buffer);

                const ocrText = await runOcrScript(filePath);
                if (ocrText) {
                    return `### Изображение: ${img.name}\n\n> [!OCR Result]\n> ${ocrText.replace(/\n/g, '\n> ')}\n\n`;
                }
            } catch (err) {
                console.error(`[OCR] Ошибка обработки ${img.name}:`, err.message);
                return `### Изображение: ${img.name}\n\n> [!ERROR]\n> Не удалось распознать: ${err.message}\n\n`;
            }
            return ''; // Return empty string if no OCR text or error
        }));

        const results = await Promise.all(ocrPromises);
        combinedResults = results.join('');

    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }

    return combinedResults;
}

/**
 * Запускает Python-скрипт OCR
 * @param {string} filePath 
 */
async function runOcrScript(filePath) {
    const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = join(process.cwd(), 'server', 'scripts', 'ocr_worker.py');
    const command = `"${pythonPath}" "${scriptPath}" "${filePath}" "all"`;

    try {
        const { stdout, stderr } = await execAsync(command, {
            env: { ...process.env },
            maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large OCR results
        });

        if (stderr) console.log(`[OCR Python Stderr] ${stderr}`);

        const result = JSON.parse(stdout);
        if (result.error) throw new Error(result.error);
        return result.text;
    } catch (err) {
        if (err.stderr) console.error(`[OCR Python Error Stderr] ${err.stderr}`);
        throw err;
    }
}

/**
 * Рекурсивно собирает дочерние страницы с поддержкой пагинации
 * @param {string} parentId 
 * @param {string} token 
 * @param {object} options 
 */
async function fetchChildPagesRecursively(parentId, token, options) {
    let nextUrl = CHILD_PAGES_URL(parentId);
    const childrenList = [];

    // 1) Собираем список всех детей (с учетом пагинации)
    while (nextUrl) {
        const response = await fetch(nextUrl, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
        });

        if (!response.ok) break;

        const data = await response.json();
        if (data.results) {
            childrenList.push(...data.results);
        }

        if (data._links?.next) {
            nextUrl = CONFLUENCE_BASE + data._links.next;
        } else {
            nextUrl = null;
        }
    }

    const pages = [];
    // 2) Обрабатываем каждого ребенка
    // Параллельная загрузка дочерних страниц
    const childPages = await Promise.all(childrenList.map(child =>
        fetchConfluencePage(token, child.id, options)
    ));
    pages.push(...childPages);

    return pages;
}
