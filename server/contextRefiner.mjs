import fetch from 'node-fetch';
import { callCloudRuAPI } from './cloudruClient.mjs';
import config from './config.json' assert { type: 'json' };

/**
 * Оркестратор подготовки входных данных:
 *  1) reduceGlossary() — выжимает глоссарий чанками
 *  2) reduceContext()  — выжимает контекст по страницам/чанкам
 *
 * На 429 ждём минуту (или Retry-After), ретраим и продолжаем.
 * Подробные логи в каждом шаге.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.REFINER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';

const API_TOKEN = config.openRouterAiKey;
const CLOUDRU_API_KEY = config.cloudruApiKey;

const SYSTEM_JSON_ONLY =
    'Ты — парсер. Отвечай ТОЛЬКО валидным JSON-объектом. ' +
    'НИКАКИХ пояснений/Markdown/```/префиксов/суффиксов/доп. текста. ' +
    'НЕ добавляй <think>/<reflection> и любые скрытые рассуждения. ' +
    'ВСЕ значения — JSON-строки, экранируй внутри: \\" , \\\\ , \\n. ' +
    'Ответ ДОЛЖЕН начинаться с { и заканчиваться }.';

const CLIP_REQ_IN = 120000;
const CLIP_GLS_IN = 160000;
const CLIP_CTX_IN = 500000;
const LIMIT_GLS_OUT = 40000;
const LIMIT_CTX_OUT = 120000;

const CHUNK_SIZE_GLOSSARY = 128000;
const CHUNK_SIZE_CONTEXT = 128000;
const MAX_ATTEMPTS_TOTAL = 6;
const BASE_RETRY_MS = 1000;
const DEFAULT_RATE_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 5;

const ENV_TOOLS_DISABLED = /^(1|true|yes)$/i.test(String(process.env.REFINER_DISABLE_TOOLS || ''));
let TOOLS_ENABLED = !ENV_TOOLS_DISABLED;

const MAX_CONCURRENT_REQUESTS = 3;
const requestSemaphore = {
    running: 0,
    queue: [],

    async acquire() {
        return new Promise((resolve) => {
            if (this.running < MAX_CONCURRENT_REQUESTS) {
                this.running++;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    },

    release() {
        this.running--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.running++;
            next();
        }
    }
};

async function callHybridAPI(messages, opts = {}) {
    const {
        maxTokens = 2500,
        temperature = 0.0,
        schemaName,
        schemaProps,
        expectedKeys = [],
        apiToken = API_TOKEN
    } = opts;

    const cloudModels = config.cloudruModels || [];
    for (const model of cloudModels) {
        try {
            console.log(`[refiner] Trying Cloud.ru model: ${model}`);

            const response_format = schemaName && schemaProps ? {
                type: 'json_schema',
                json_schema: {
                    name: schemaName,
                    schema: {
                        type: 'object',
                        properties: schemaProps,
                        required: Object.keys(schemaProps),
                        additionalProperties: false
                    },
                    strict: true
                }
            } : null;

            const result = await callCloudRuAPI(messages, {
                model,
                temperature,
                max_tokens: maxTokens,
                response_format,
                useResponseFormatForCloudRu: true
            });

            const content = result.choices?.[0]?.message?.content || '';
            const toolCalls = result.choices?.[0]?.message?.tool_calls || [];

            if (content) {
                console.log(`[refiner] Cloud.ru success with ${model}`);
                return safeParseContent(content, result, expectedKeys);
            }

            if (toolCalls.length > 0) {
                console.log(`[refiner] Content пустой, но есть tool_calls у ${model}`);
                for (const toolCall of toolCalls) {
                    if (toolCall.function?.arguments) {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            if (typeof args === 'object') {
                                console.log(`[refiner] Извлечён объект из tool_call arguments`);
                                return args;
                            }
                        } catch (e) { }
                    }
                }
            }

            console.warn(`[refiner] Model ${model} returned empty content, trying next...`);
        } catch (err) {
            console.warn(`[refiner] Cloud.ru model ${model} failed: ${err.message}`);
        }
    }

    console.log(`[refiner] Falling back to OpenRouter (MODEL=${MODEL})`);
    return await callJSON(messages, { maxTokens, temperature, schemaName, schemaProps, expectedKeys, apiToken });
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


function joinContextPages(p) {
    if (Array.isArray(p.contextPages) && p.contextPages.length) {
        return p.contextPages
            .map(x => typeof x === 'string' ? x : (x?.text || ''))
            .filter(Boolean)
            .join('\n\n--- page ---\n\n');
    }
    return p.context || '';
}

function contentRatio(a, b) {
    const norm = s => String(s || '')
        .replace(/[`*_#>\-\d\.\)\(]+/g, ' ')
        .replace(/\bhttps?:\/\/\S+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(x => x && x.length > 2);
    const A = new Set(norm(a)), B = new Set(norm(b));
    const inter = [...A].filter(x => B.has(x)).length;
    return inter / (A.size || 1);
}



function pickRetryAfterMs(res) {
    const h = res.headers?.get?.('retry-after');
    if (!h) return DEFAULT_RATE_WAIT_MS;
    const secs = Number(h);
    if (!Number.isNaN(secs) && secs > 0) return secs * 1000;
    const when = Date.parse(h);
    if (!Number.isNaN(when)) {
        const diff = when - Date.now();
        return diff > 0 ? diff : DEFAULT_RATE_WAIT_MS;
    }
    return DEFAULT_RATE_WAIT_MS;
}

function hardClip(str, max) {
    if (!str) return '';
    const s = String(str);
    return s.length <= max ? s : s.slice(0, max);
}

function stripReasoningWrappers(s) {
    s = String(s || '');
    s = s.replace(/```(?!json)[\s\S]*?```/gi, '');
    return s
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\|\s*begin(?:_of)?_?(?:thought|think)\s*\|>[\s\S]*?<\|\s*end(?:_of)?_?(?:thought|think)\s*\|>/gi, '')
        .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
        .trim();
}

// внутри кавычек заменяем сырые переводы строк на \n и экранируем непарные кавычки
function escapeBrokenJSONString(candidate) {
    let out = '';
    let inStr = false, esc = false;
    for (let i = 0; i < candidate.length; i++) {
        const ch = candidate[i];
        if (inStr) {
            if (esc) { out += ch; esc = false; continue; }
            if (ch === '\\') { out += ch; esc = true; continue; }
            if (ch === '"') { inStr = false; out += ch; continue; }
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\r') { out += '\\r'; continue; }
            out += ch;
        } else {
            out += ch;
            if (ch === '"') inStr = true;
        }
    }
    return out;
}

// Возвращает все сбалансированные блоки по типу скобок
function extractBalancedBlocks(s, openChar, closeChar) {
    const open = new RegExp(openChar, 'g');
    const close = new RegExp(closeChar, 'g');
    const opens = [], res = [];
    const markers = [];
    for (let m; (m = open.exec(s));) markers.push({ i: m.index, t: 'o' });
    for (let m; (m = close.exec(s));) markers.push({ i: m.index, t: 'c' });
    markers.sort((a, b) => a.i - b.i);

    for (const m of markers) {
        if (m.t === 'o') opens.push(m.i);
        else if (opens.length) {
            const start = opens.pop();
            if (!opens.length) res.push(s.slice(start, m.i + 1));
        }
    }
    return res;
}

function parseMaybeJSON(raw, expectedKeys = []) {
    if (!raw) throw new Error('Пустой ответ модели');
    let s = String(raw).trim();

    s = stripReasoningWrappers(s);

    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();

    const tryParse = (candidate) => {
        if (!candidate) return null;
        let c = candidate.trim()
            .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
            .replace(/,\s*([}\]])/g, '$1');
        try { return JSON.parse(c); } catch { }
        try { return JSON.parse(escapeBrokenJSONString(c)); } catch { }
        try { return JSON.parse(c.replace(/[\u0000-\u001F\u007F]/g, '')); } catch { }
        return null;
    };

    const objCandidates = extractBalancedBlocks(s, '{', '}');
    const keyRegex = expectedKeys.length ? new RegExp(`"(${expectedKeys.join('|')})"\\s*:`) : null;

    for (const cand of objCandidates) {
        if (!keyRegex || keyRegex.test(cand)) {
            const parsed = tryParse(cand);
            if (parsed && (!expectedKeys.length || expectedKeys.every((k) => k in parsed))) return parsed;
        }
    }


    const arrCandidates = extractBalancedBlocks(s, '\\[', '\\]');
    for (const cand of arrCandidates) {
        const parsed = tryParse(cand);
        if (parsed && typeof parsed === 'object') return parsed;
    }

    if (objCandidates.length) {
        const longest = objCandidates.sort((a, b) => b.length - a.length)[0];
        const parsed = tryParse(longest);
        if (parsed) return parsed;
    }

    throw new Error('Не найден JSON в ответе модели');
}

function emptyRefine() {
    return { requirements_md: '', mini_glossary_md: '', context_md: '' };
}

function mdToItems(md) {
    return String(md || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !/^#+\s/.test(s));
}

function dedupLines(lines, limit) {
    const seen = new Set();
    const out = [];
    for (const line of lines || []) {
        const key = line.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:()«»"'`]/g, '').trim();
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(line);
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Разбивает контекст на страницы для последующей обработки LLM
 * 
 * Логика разбиения (в порядке приоритета):
 * 1. Явные разделители (--- page ---): используются, если есть;
 * 2. Confluence Page ID: разные статьи обрабатываются отдельно;
 * 3. Группировка по главным заголовкам (#): все подзаголовки ## и ### под одним # объединяются в одну страницу;
 * 4. Объединение небольших страниц (меньше 3kb): накапливаются в буфере до достижения MIN_PAGE_SIZE
 * 
 * @param ctx исходный контекст
 */
function splitContextIntoPages(ctx) {
    const s = String(ctx || '').trim();
    if (!s) return [];

    const byExplicit = s.split(/\n+---+\s*(?:page|страница)?\s*---+\n+/i);
    if (byExplicit.length > 1) {
        return byExplicit.map(x => x.trim()).filter(Boolean);
    }

    const pidRegex = /\n+(?=(?:Confluence\s*Page\s*ID\s*:\s*\d+|\[CONFLUENCE_PAGE:\s*id=\d+))/i;
    const byPid = s.split(pidRegex);
    if (byPid.length > 1) {
        return byPid.map(x => x.trim()).filter(Boolean);
    }

    const lines = s.split('\n');
    const groups = [];
    let currentGroup = [];

    for (const line of lines) {
        if (/^#\s+[^\n]+/.test(line) && !/^##/.test(line)) {
            if (currentGroup.length > 0) {
                groups.push(currentGroup.join('\n').trim());
                currentGroup = [];
            }
            currentGroup.push(line);
        } else {
            currentGroup.push(line);
        }
    }

    if (currentGroup.length > 0) {
        groups.push(currentGroup.join('\n').trim());
    }

    if (groups.length === 0) return [s];

    const MIN_PAGE_SIZE = 3000;
    const merged = [];
    let buffer = '';

    for (const group of groups) {
        const trimmedGroup = group.trim();
        if (!trimmedGroup) continue;

        const potentialBuffer = buffer ? buffer + '\n\n' + trimmedGroup : trimmedGroup;

        if (potentialBuffer.length <= CHUNK_SIZE_CONTEXT) {
            buffer = potentialBuffer;
            if (buffer.length >= MIN_PAGE_SIZE) {
                merged.push(buffer);
                buffer = '';
            }
        } else {
            if (buffer) {
                merged.push(buffer);
            }
            buffer = trimmedGroup;
        }
    }

    if (buffer) merged.push(buffer);

    return merged.filter(Boolean);
}


function splitBySize(s, size) {
    const out = [];
    let i = 0;
    while (i < s.length) { out.push(s.slice(i, i + size)); i += size; }
    return out;
}

function sanitizeRequirementsForContext(req) {
    let s = String(req || '');
    s = s.replace(/^---[\s\S]*?---\s*/i, '');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    s = s.replace(/\bhttps?:\/\/[^\s)]+/gi, '');
    s = s.replace(/^\s*url:\s*".*?"\s*$/gmi, '');
    return s.trim();
}

function extractUrls(text) {
    const urls = new Set();
    String(text || '').replace(/\bhttps?:\/\/[^\s)]+/gi, (m) => { urls.add(m); return m; });
    return urls;
}

function filterContextItemsByAllowedSources(items, allowedUrls, forbiddenUrls) {
    return (items || []).map((line) => {
        const m = line.match(/\(источник:\s*([^)]+)\)/i);
        if (!m) return line;
        const url = m[1].trim();
        if (forbiddenUrls.has(url)) return '';
        if (allowedUrls.size && !allowedUrls.has(url)) {
            return line.replace(/\s*\(источник:[^)]+\)\s*$/i, '').trim();
        }
        return line;
    }).filter(Boolean);
}



async function callJSON(
    messages,
    { maxTokens = 2500, temperature = 0.0, schemaName, schemaProps, expectedKeys = [], apiToken = API_TOKEN } = {}
) {
    return await callHybridAPI(messages, { maxTokens, temperature, schemaName, schemaProps, expectedKeys, apiToken });
}

function safeParseContent(content, data, expectedKeys = []) {
    try {
        return parseMaybeJSON(content, expectedKeys);
    } catch (e) {
        const parsed = data?.choices?.[0]?.message?.parsed;
        if (parsed && typeof parsed === 'object') return parsed;
        console.warn('[refiner] parse error:', e.message);
        console.warn('[refiner] first 400 chars:', content.slice(0, 400));
        return null;
    }
}


async function callText(messages, { maxTokens = 1200, temperature = 0.0, apiToken = API_TOKEN } = {}) {
    const cloudModels = config.cloudruModels || [];
    for (const model of cloudModels) {
        try {
            console.log(`[refiner] Trying Cloud.ru model (text): ${model}`);
            const result = await callCloudRuAPI(messages, {
                model,
                temperature,
                max_tokens: maxTokens,
                useResponseFormatForCloudRu: false
            });
            const content = result.choices?.[0]?.message?.content || '';
            if (content) {
                console.log(`[refiner] Cloud.ru text success with ${model}`);
                return stripReasoningWrappers(content);
            }
        } catch (e) {
            console.warn(`[refiner] Cloud.ru text model ${model} failed: ${e.message}`);
        }
    }

    console.log(`[refiner] Falling back to OpenRouter for text (MODEL=${MODEL})`);
    const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };
    const req = { model: MODEL, max_tokens: maxTokens, temperature, messages };

    let rateRetries = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_TOTAL; attempt++) {
        try {
            console.log(`[refiner] callTEXT attempt=${attempt} rateRetries=${rateRetries} maxTok=${maxTokens}`);
            const res = await fetch(OPENROUTER_URL, { method: 'POST', headers, body: JSON.stringify(req) });

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                console.warn(`[refiner] TEXT HTTP ${res.status}. retry-after=${res.headers.get('retry-after') || '-'} txt.head=${txt.slice(0, 200)}`);
                if (res.status === 429) {
                    const waitMs = pickRetryAfterMs(res);
                    await sleep(waitMs);
                    if (++rateRetries > MAX_RATE_LIMIT_RETRIES) return '';
                    attempt--; continue;
                }
                await sleep(BASE_RETRY_MS * attempt);
                continue;
            }

            const data = await res.json().catch(() => ({}));
            const content = data?.choices?.[0]?.message?.content?.trim() || '';
            return stripReasoningWrappers(content);
        } catch (e) {
            console.warn(`[refiner] callTEXT error: ${e?.message || e}`);
            await sleep(BASE_RETRY_MS * attempt);
        }
    }
    return '';
}


async function reduceGlossary(originalRequirements, glossaryRaw, maxItems, limitChars = LIMIT_GLS_OUT, apiToken = API_TOKEN) {
    const glossary = hardClip(glossaryRaw || '', CLIP_GLS_IN);
    console.log(`[refiner] Stage#2 glossary in.len=${glossary.length}`);
    if (!glossary.trim()) return '';

    const reqForModel = sanitizeRequirementsForContext(hardClip(originalRequirements || '', CLIP_REQ_IN));

    const chunks = splitBySize(glossary, CHUNK_SIZE_GLOSSARY);
    const acc = [];

    for (let i = 0; i < chunks.length; i++) {
        const remain = Math.max(0, maxItems - acc.length);
        if (remain === 0) break;

        const user = `
Оставь ТОЛЬКО термины, необходимые/встречающиеся для этих требований.
Не более ${remain} пунктов. Формат: "- **Термин** — краткое определение".
Если рядом в тексте есть URL (Confluence) — добавь " (источник: URL)".

Требования (контекст отбора, без ссылок):
---------------------------------------
${reqForModel}
---------------------------------------

Фрагмент глоссария (chunk ${i + 1}/${chunks.length}):
---------------------------------------
${chunks[i]}
---------------------------------------

ФОРМАТ ОТВЕТА:
{ "mini_glossary_md": "- **...** — ...\\n- **...** — ..." }
`.trim();

        const messages = [
            { role: 'system', content: SYSTEM_JSON_ONLY },
            { role: 'user', content: user }
        ];

        let out = null, part = '';

        if (!part) {
            const result = await callHybridAPI(messages, {
                maxTokens: 10000,
                temperature: 0.0,
                schemaName: 'ReduceGlossary',
                schemaProps: { mini_glossary_md: { type: 'string' } },
                expectedKeys: ['mini_glossary_md'],
                apiToken
            });
            out = result;
            part = String(out?.mini_glossary_md || '');
        }

        const items = mdToItems(part);
        console.log(`[refiner] Stage#2 chunk=${i + 1} items=${items.length} acc=${acc.length + items.length}/${maxItems}`);
        acc.push(...items);
    }

    const dedup = dedupLines(acc, maxItems);
    const md = dedup.join('\n').slice(0, limitChars);
    console.log(`[refiner] Stage#2 glossary out.len=${md.length} items=${dedup.length}`);
    return md;
}


async function reduceContext(originalRequirements, contextRaw, hintText, maxItems, limitChars = LIMIT_CTX_OUT, apiToken = API_TOKEN) {
    const raw = hardClip(contextRaw || '', CLIP_CTX_IN);
    console.log(`[refiner] Stage#3 context in.len=${raw.length}`);
    if (!raw.trim()) return '';

    const debugMode = process.env.DEBUG_CONTEXT_PAGES === '1' || config.debugContextPages === true;

    const reqForModel = sanitizeRequirementsForContext(
        hardClip(originalRequirements || '', CLIP_REQ_IN)
    );

    const allowedUrls = extractUrls(raw);
    const forbiddenUrls = extractUrls(originalRequirements);
    const fmMatch = String(originalRequirements || '').match(/^\s*url:\s*"([^"]+)"/mi);
    if (fmMatch && fmMatch[1]) forbiddenUrls.add(fmMatch[1]);

    const pages = splitContextIntoPages(raw);

    if (debugMode) {
        const fs = await import('fs');
        const debugDir = './debug-context';
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

        fs.writeFileSync(`${debugDir}/01-raw-context.md`, raw);

        pages.forEach((page, i) => {
            const sizeKB = Math.round(page.length / 1000);
            fs.writeFileSync(`${debugDir}/02-page-${String(i + 1).padStart(2, '0')}-${sizeKB}kb.md`, page);
        });

        console.log(`[refiner] DEBUG: Saved ${pages.length} pages to ${debugDir}/`);
    }

    console.log(`[refiner] Stage#3 pages: ${pages.length}, sizes: [${pages.map(p => Math.round(p.length / 1000) + 'KB').join(', ')}]`);

    const pageChunksList = pages.map(pg => splitBySize(pg, CHUNK_SIZE_CONTEXT));
    const perPageCap = Math.max(1, Math.ceil(maxItems / Math.max(1, pages.length)));

    console.log(`[refiner] Stage#3 allowedUrls.size=${allowedUrls.size} forbiddenUrls.size=${forbiddenUrls.size}`);

    async function processPage(p) {
        await requestSemaphore.acquire();
        try {
            const pageChunks = pageChunksList[p];
            let producedForPage = 0;
            const pageAcc = [];

            for (let c = 0; c < pageChunks.length && producedForPage < perPageCap; c++) {
                const remainForPage = perPageCap - producedForPage;
                if (remainForPage <= 0) break;

                const whitelistNote = allowedUrls.size
                    ? `Если ты указываешь источник, используй URL ТОЛЬКО из этого списка:\n${[...allowedUrls].slice(0, 50).map(u => `- ${u}`).join('\n')}`
                    : `Если в фрагменте нет URL — не добавляй "(источник: ...)".`;

                const user = `
СТРОГИЙ РЕЖИМ ИЗВЛЕЧЕНИЯ.
Используй блок "Требования" ниже ТОЛЬКО как ОРИЕНТИР, чтобы понять, какие факты из "Контекст фрагмент" релевантны.
Ничего из Требований НЕ БРАТЬ в факты. Факты извлекать ТОЛЬКО из "Контекст фрагмент".
ВАЖНО: Извлекай ВСЕ релевантные факты, даже если их больше ${remainForPage}. Не ограничивай себя этим числом — это только ориентир.
Если во фрагменте нет релевантных фактов — верни пустую строку "".
${whitelistNote}

Подсказка (что считать фактом):
${hintText || 'Определения, ограничения, допущения, роли/права, зависимости, конфиги, API-методы, параметры запросов, форматы данных, бизнес-правила, валидации, статусы, коды ошибок.'}

🚨 КРИТИЧЕСКИ ВАЖНО: ОБЯЗАТЕЛЬНО сохраняй предложения, содержащие ключевые слова:
   - Условия: "если", "иначе", "при условии", "когда"
   - Ограничения: "максимум", "минимум", "не более", "не менее", "от ... до"
   - Валидации: "обязательно", "запрещено", "должно быть", "не может быть"
   - Ошибки: "ошибка", "некорректно", "невалидно", "отклонено"
   - UI логика: "автоматически", "предзаполнить", "очистить", "скрыть", "показать"
   
   Эти слова — "золото" для тестировщика! НИКОГДА не выкидывай факты, содержащие их!

Требования (только для ориентира):
---------------------------------------
${reqForModel}
---------------------------------------

Контекст фрагмент (page ${p + 1}/${pages.length}, chunk ${c + 1}/${pageChunks.length}) — ИСТОЧНИК ФАКТОВ:
---------------------------------------
${pageChunks[c]}
---------------------------------------

ФОРМАТ ОТВЕТА:
{ "context_md": "- [детальный факт 1 с контекстом]\\n- [детальный факт 2 с контекстом]\\n- [детальный факт 3 с контекстом]" }

ВАЖНО: Пиши факты ДЕТАЛЬНО, сохраняя важные детали (названия методов, параметры, значения, условия). Не сокращай критичную информацию!
`.trim();

                const messages = [
                    { role: 'system', content: SYSTEM_JSON_ONLY },
                    { role: 'user', content: user }
                ];

                let out = null, part = '';

                if (!part) {
                    const result = await callHybridAPI(messages, {
                        maxTokens: 2000,
                        temperature: 0.0,
                        schemaName: 'ReduceContext',
                        schemaProps: { context_md: { type: 'string' } },
                        expectedKeys: ['context_md'],
                        apiToken
                    });
                    out = result;
                    part = String(out?.context_md || '');
                }

                if (!part) {
                    console.warn(`[refiner] Stage#3 page=${p + 1} chunk=${c + 1}: fallback to text-mode`);
                    const user2 = `
Верни ТОЛЬКО список Markdown-пунктов. Извлекай ВСЕ релевантные факты, не ограничивай себя числом ${remainForPage}.
Источники — ТОЛЬКО из списка ниже.
${whitelistNote}

Используй "Требования" ниже ТОЛЬКО как ориентир релевантности. Факты брать ТОЛЬКО из "Контекст фрагмент".

Подсказка (что считать фактом):
${hintText || 'Определения, ограничения, допущения, роли/права, зависимости, конфиги, API-методы, параметры запросов, форматы данных, бизнес-правила, валидации, статусы, коды ошибок.'}

🚨 КРИТИЧЕСКИ ВАЖНО: ОБЯЗАТЕЛЬНО сохраняй предложения, содержащие ключевые слова:
   - Условия: "если", "иначе", "при условии", "когда"
   - Ограничения: "максимум", "минимум", "не более", "не менее", "от ... до"
   - Валидации: "обязательно", "запрещено", "должно быть", "не может быть"
   - Ошибки: "ошибка", "некорректно", "невалидно", "отклонено"
   - UI логика: "автоматически", "предзаполнить", "очистить", "скрыть", "показать"
   
   Эти слова — "золото" для тестировщика! НИКОГДА не выкидывай факты, содержащие их!

ВАЖНО: Пиши факты ДЕТАЛЬНО, сохраняя важные детали (названия методов, параметры, значения, условия). Не сокращай критичную информацию!

Требования (только ориентир):
---------------------------------------
${reqForModel}
---------------------------------------

Контекст фрагмент (ИСТОЧНИК ФАКТОВ):
---------------------------------------
${pageChunks[c]}
---------------------------------------
`.trim();

                    part = await callText(
                        [
                            { role: 'system', content: 'Отвечай ТОЛЬКО списком Markdown, по одному пункту на строку.' },
                            { role: 'user', content: user2 }
                        ],
                        { maxTokens: 1500, temperature: 0.0, apiToken }
                    );
                }

                let items = mdToItems(part);
                const chunk = pageChunks[c];
                const RATIO_MIN = 0.12;

                const criticalKeywords = [
                    'если', 'иначе', 'при условии', 'когда',
                    'максимум', 'минимум', 'не более', 'не менее', 'от', 'до',
                    'обязательно', 'запрещено', 'должно быть', 'не может быть',
                    'ошибка', 'некорректно', 'невалидно', 'отклонено',
                    'автоматически', 'предзаполнить', 'очистить', 'скрыть', 'показать'
                ];
                const hasCriticalKeyword = (line) => {
                    const lineLower = line.toLowerCase();
                    return criticalKeywords.some(kw => lineLower.includes(kw));
                };
                const criticalItems = items.filter(hasCriticalKeyword);
                const normalItems = items.filter(line => !hasCriticalKeyword(line));

                let filteredNormal = normalItems.filter(line => contentRatio(line, chunk) >= RATIO_MIN);
                if (!filteredNormal.length && normalItems.length) {
                    filteredNormal = normalItems.slice(0, Math.min(3, normalItems.length));
                }

                items = [...criticalItems, ...filteredNormal];

                items = filterContextItemsByAllowedSources(items, allowedUrls, forbiddenUrls);

                const limited = items.slice(0, remainForPage);
                pageAcc.push(...limited);
                producedForPage += limited.length;
                console.log(`[refiner] Stage#3 page=${p + 1} chunk=${c + 1} items=${items.length} pageAcc=${pageAcc.length}/${perPageCap}`);
            }

            return pageAcc;
        } finally {
            requestSemaphore.release();
        }
    }

    const pagePromises = pages.map((_, p) => processPage(p));
    const pageResults = await Promise.all(pagePromises);

    const acc = [];
    for (let p = 0; p < pageResults.length && acc.length < maxItems; p++) {
        const remain = maxItems - acc.length;
        const take = pageResults[p].slice(0, Math.min(perPageCap, remain));
        acc.push(...take);
    }

    const dedup = dedupLines(acc, maxItems);
    const md = dedup.join('\n').slice(0, limitChars);

    if (debugMode) {
        const fs = await import('fs');
        fs.writeFileSync('./debug-context/03-final-context.md', md);
        console.log(`[refiner] DEBUG: Контекст сохранен (${md.length} символов, ${dedup.length} пунктов)`);
    }

    console.log(`[refiner] Stage#3 context out.len=${md.length} items=${dedup.length}`);
    return md;
}

/**
 * @param {object} p
 * @param {string} p.requirements        
 * @param {string} [p.glossary]
 * @param {string} [p.context]
 * @param {string} [p.contextHint]
 * @param {number} [p.maxGlossary=40]
 * @param {number} [p.maxContext=50]
 * @returns {Promise<{requirements_md:string, mini_glossary_md:string, context_md:string}>}
 */
export async function prepareContextWithAI(p) {
    const maxGlossary = Number.isFinite(p.maxGlossary) ? p.maxGlossary : 40;
    const maxContext = Number.isFinite(p.maxContext) ? p.maxContext : 50;
    const apiToken = p.apiToken || API_TOKEN;

    const maskedKey = apiToken ? `${apiToken.slice(0, 10)}...${apiToken.slice(-4)}` : 'NONE';
    console.log('[refiner] === ORCHESTRATION START ===');
    console.log(`[refiner] inputs: req.len=${(p.requirements || '').length} gloss.len=${(p.glossary || '').length} ctx.len=${(p.context || '').length}`);
    console.log(`[refiner] limits: maxGlossary=${maxGlossary} maxContext=${maxContext}`);
    console.log(`[refiner] model=${MODEL} toolsEnabled=${TOOLS_ENABLED} envToolsDisabled=${ENV_TOOLS_DISABLED}`);
    console.log(`[refiner] using API key: ${maskedKey}`);

    try {
        const requirements_md = String(p.requirements || '');

        const mini_glossary_md = await reduceGlossary(requirements_md, p.glossary || '', maxGlossary, LIMIT_GLS_OUT, apiToken);

        const ctxHint =
            (p.contextHint && p.contextHint.trim() && p.contextHint.trim() !== '—')
                ? p.contextHint.trim()
                : 'Возьми только релевантные для проверки требований факты: определения, ограничения, допущения, роли/права, зависимости, конфиги.';

        const context_md = await reduceContext(
            requirements_md,
            joinContextPages(p) || '',
            ctxHint,
            maxContext,
            LIMIT_CTX_OUT,
            apiToken
        );

        console.log('[refiner] === ORCHESTRATION DONE ===');
        console.log(`[refiner] outputs: req.len=${requirements_md.length} gloss.len=${mini_glossary_md.length} ctx.len=${context_md.length}`);

        return { requirements_md, mini_glossary_md, context_md };
    } catch (e) {
        console.warn('[refiner] orchestration failed:', e?.message || e);
        return emptyRefine();
    }
}
