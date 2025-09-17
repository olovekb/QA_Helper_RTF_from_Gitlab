// contextRefiner.mjs
import fetch from 'node-fetch';
import config from './config.json' assert { type: 'json' };

/**
 * Оркестратор подготовки входных данных:
 *  1) (удалено) — требования не меняем, возвращаем как есть
 *  2) reduceGlossary() — выжимает глоссарий чанками
 *  3) reduceContext()  — выжимает контекст по страницам/чанкам
 *
 * На 429 ждём минуту (или Retry-After), ретраим и продолжаем.
 * Подробные логи в каждом шаге.
 */

// === Конфиг модели / API ===
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.REFINER_MODEL || 'deepseek/deepseek-chat-v3.1:free';

const API_TOKEN = config.openRouterAiKey;

// Жёсткая директива: только валидный JSON, без размышлений и Markdown
const SYSTEM_JSON_ONLY =
    'Ты — парсер. Отвечай ТОЛЬКО валидным JSON-объектом. ' +
    'НИКАКИХ пояснений/Markdown/```/префиксов/суффиксов/доп. текста. ' +
    'НЕ добавляй <think>/<reflection> и любые скрытые рассуждения. ' +
    'ВСЕ значения — JSON-строки, экранируй внутри: \\" , \\\\ , \\n. ' +
    'Ответ ДОЛЖЕН начинаться с { и заканчиваться }.';

const CLIP_REQ_IN = 120000;
const CLIP_GLS_IN = 160000;
const CLIP_CTX_IN = 300000;
const LIMIT_GLS_OUT = 24000;   // увеличить выход глоссария
const LIMIT_CTX_OUT = 36000;   // увеличить выход контекста

// === Чанкование ===
const CHUNK_SIZE_GLOSSARY = 64000;
const CHUNK_SIZE_CONTEXT = 64000;

// === Retry / Rate-limit ===
const MAX_ATTEMPTS_TOTAL = 6;
const BASE_RETRY_MS = 1000;
const DEFAULT_RATE_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 5;

// === Управление tool-calls ===
const ENV_TOOLS_DISABLED = /^(1|true|yes)$/i.test(String(process.env.REFINER_DISABLE_TOOLS || ''));
let TOOLS_ENABLED = !ENV_TOOLS_DISABLED; // по умолчанию включены

// --- Утилиты ------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


function joinContextPages(p) {
    if (Array.isArray(p.contextPages) && p.contextPages.length) {
        return p.contextPages
            .map(x => typeof x === 'string' ? x : (x?.text || ''))
            .filter(Boolean)
            .join('\n\n--- page ---\n\n'); // маркер понимает splitContextIntoPages
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
    // Retry-After может быть секундами или датой
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
    // Выпиливаем любые fenced-блоки, кроме явно json
    s = s.replace(/```(?!json)[\s\S]*?```/gi, '');
    return s
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\|\s*begin(?:_of)?_?(?:thought|think)\s*\|>[\s\S]*?<\|\s*end(?:_of)?_?(?:thought|think)\s*\|>/gi, '')
        .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
        .trim();
}

// «Ремонт» строк: внутри кавычек заменяем сырые переводы строк на \n и экранируем непарные кавычки
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

    // 1) Если есть fenced-блок с json — берём его содержимое
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

    // 2) Объекты — ищем те, где есть ожидаемые ключи
    const objCandidates = extractBalancedBlocks(s, '{', '}');
    const keyRegex = expectedKeys.length ? new RegExp(`"(${expectedKeys.join('|')})"\\s*:`) : null;

    for (const cand of objCandidates) {
        if (!keyRegex || keyRegex.test(cand)) {
            const parsed = tryParse(cand);
            if (parsed && (!expectedKeys.length || expectedKeys.every((k) => k in parsed))) return parsed;
        }
    }

    // 3) Массивы
    const arrCandidates = extractBalancedBlocks(s, '\\[', '\\]');
    for (const cand of arrCandidates) {
        const parsed = tryParse(cand);
        if (parsed && typeof parsed === 'object') return parsed;
    }

    // 4) Последняя попытка — самый длинный объект
    if (objCandidates.length) {
        const longest = objCandidates.sort((a, b) => b.length - a.length)[0];
        const parsed = tryParse(longest);
        if (parsed) return parsed;
    }

    throw new Error('Не найден JSON в ответе модели');
}

// Безопасный пустой результат
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

function splitContextIntoPages(ctx) {
    const s = String(ctx || '').trim();
    if (!s) return [];

    // 1) Явный разделитель страниц
    const byExplicit = s.split(/\n+---+\s*(?:page|страница)?\s*---+\n+/i);
    if (byExplicit.length > 1) return byExplicit.map(x => x.trim()).filter(Boolean);

    // 2) Начало новой статьи по маркеру Confluence Page ID
    const byPid = s.split(/\n+(?=Confluence\s*Page\s*ID\s*:\s*\d+)/i);
    if (byPid.length > 1) return byPid.map(x => x.trim()).filter(Boolean);

    // 3) Заголовки как границы страниц
    const byHead = s.split(/\n(?=###[^\n]*|##[^\n]*)/);
    if (byHead.length > 1) return byHead.map(x => x.trim()).filter(Boolean);

    return [s];
}


function splitBySize(s, size) {
    const out = [];
    let i = 0;
    while (i < s.length) { out.push(s.slice(i, i + size)); i += size; }
    return out;
}

function sanitizeRequirementsForContext(req) {
    let s = String(req || '');
    s = s.replace(/^---[\s\S]*?---\s*/i, '');          // front-matter
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');   // [text](url) → text
    s = s.replace(/\bhttps?:\/\/[^\s)]+/gi, '');       // naked URLs
    s = s.replace(/^\s*url:\s*".*?"\s*$/gmi, '');      // url: "..."
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

// ---------- Tool-calls (если поддерживается модель) ----------
function buildTool(name, propName, description = 'Return strict JSON payload') {
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: {
                type: 'object',
                properties: { [propName]: { type: 'string' } },
                required: [propName],
                additionalProperties: false
            }
        }
    };
}

function safeParseArgs(args, expectedKeys) {
    if (!args) return null;
    try { return JSON.parse(args); } catch {
        try { return parseMaybeJSON(args, expectedKeys); } catch { return null; }
    }
}

function extractToolArgsFromData(data, toolName, expectedKeys) {
    const m = data?.choices?.[0]?.message;
    if (m?.tool_calls?.length) {
        const tc = m.tool_calls.find((t) => t?.function?.name === toolName);
        if (tc?.function?.arguments) return safeParseArgs(tc.function.arguments, expectedKeys);
    }
    if (m?.function_call?.name === toolName) {
        return safeParseArgs(m.function_call.arguments, expectedKeys);
    }
    return null;
}

async function callTools(messages, tool, { maxTokens = 1800, temperature = 0.0, expectedKeys = [] } = {}) {
    if (!TOOLS_ENABLED) return null;

    const headers = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };
    const req = {
        model: MODEL,
        max_tokens: maxTokens,
        temperature,
        tools: [tool],
        tool_choice: { type: 'function', function: { name: tool.function.name } },
        messages
    };

    let rateRetries = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_TOTAL; attempt++) {
        try {
            console.log(`[refiner] callTOOLS attempt=${attempt} rateRetries=${rateRetries} maxTok=${maxTokens} tool=${tool.function.name}`);
            const res = await fetch(OPENROUTER_URL, { method: 'POST', headers, body: JSON.stringify(req) });

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                console.warn(`[refiner] TOOLS HTTP ${res.status}. retry-after=${res.headers.get('retry-after') || '-'} txt.head=${txt.slice(0, 200)}`);

                // 404 — эндпоинт не поддерживает tools → выключаем на сессию
                if (res.status === 404 && /No endpoints.*tool use/i.test(txt)) {
                    console.warn('[refiner] Модель не поддерживает tool-calls → отключаю tools на сессию.');
                    TOOLS_ENABLED = false;
                    return null;
                }

                if (res.status === 429) {
                    const waitMs = pickRetryAfterMs(res);
                    console.warn(`[refiner] 429 (tools): ждём ${Math.round(waitMs / 1000)}s…`);
                    await sleep(waitMs);
                    rateRetries++;
                    if (rateRetries > MAX_RATE_LIMIT_RETRIES) return null;
                    attempt--; // не сжигаем попытку
                    continue;
                }
                await sleep(BASE_RETRY_MS * attempt);
                continue;
            }

            const data = await res.json().catch(() => null);
            const args = extractToolArgsFromData(data, tool.function.name, expectedKeys);
            if (args) return args;

            // если tool-call не случился — мягкий фолбэк на обычный JSON из content
            const content = data?.choices?.[0]?.message?.content || '';
            console.log(`[refiner] TOOLS fallback: content.len=${content.length}`);
            return parseMaybeJSON(content, expectedKeys);

        } catch (e) {
            console.warn(`[refiner] callTOOLS error: ${e?.message || e}`);
            await sleep(BASE_RETRY_MS * attempt);
        }
    }
    console.warn('[refiner] все попытки callTOOLS исчерпаны');
    return null;
}

async function callJSON(
    messages,
    { maxTokens = 2500, temperature = 0.0, schemaName, schemaProps, expectedKeys = [] } = {}
) {
    const headers = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };

    const makeReq = (useSchema) => {
        const base = { model: MODEL, max_tokens: maxTokens, temperature, messages };
        if (useSchema && schemaName && schemaProps) {
            base.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: schemaName,
                    schema: { type: 'object', properties: schemaProps, required: Object.keys(schemaProps), additionalProperties: false },
                    strict: true
                }
            };
        } else {
            base.response_format = { type: 'json_object' };
        }
        return base;
    };

    let useSchema = true; // пробуем json_schema сначала, затем json_object
    let rateRetries = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_TOTAL; attempt++) {
        try {
            const body = JSON.stringify(makeReq(useSchema));
            const res = await fetch(OPENROUTER_URL, { method: 'POST', headers, body });
            const txt = await res.text();

            if (!res.ok) {
                const unsupported = /response[_-]?format|json[_-]?schema/i.test(txt);
                if (res.status === 429) {
                    const waitMs = pickRetryAfterMs(res);
                    await sleep(waitMs);
                    if (++rateRetries > MAX_RATE_LIMIT_RETRIES) return null;
                    attempt--; continue;
                }
                if (unsupported && useSchema) { useSchema = false; attempt--; continue; }
                await sleep(BASE_RETRY_MS * attempt);
                continue;
            }

            const data = JSON.parse(txt);
            const content = data?.choices?.[0]?.message?.content?.trim() || '';
            return safeParseContent(content, data, expectedKeys);
        } catch (e) {
            await sleep(BASE_RETRY_MS * attempt + 500); // небольшая доп. пауза для снижения 429
        }
    }
    return null;
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

// Простой «текстовый» вызов (fallback)
async function callText(messages, { maxTokens = 1200, temperature = 0.0 } = {}) {
    const headers = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };
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
                    console.warn(`[refiner] 429 (text): ждём ${Math.round(waitMs / 1000)}s…`);
                    await sleep(waitMs);
                    rateRetries++;
                    if (rateRetries > MAX_RATE_LIMIT_RETRIES) return '';
                    attempt--;
                    continue;
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

// === ЭТАП 2. Ужать глоссарий (чанками) =======================================

async function reduceGlossary(originalRequirements, glossaryRaw, maxItems, limitChars = LIMIT_GLS_OUT) {
    const glossary = hardClip(glossaryRaw || '', CLIP_GLS_IN);
    console.log(`[refiner] Stage#2 glossary in.len=${glossary.length}`);
    if (!glossary.trim()) return '';

    // Для модели используем "санитизированные" требования, но не изменяем оригинал
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

        //    if (TOOLS_ENABLED) {
        //       const tool = buildTool('submit_glossary', 'mini_glossary_md', 'Return mini_glossary_md list');
        //       out = await callTools(messages, tool, { maxTokens: 700, temperature: 0.0, expectedKeys: ['mini_glossary_md'] });
        //       part = String(out?.mini_glossary_md || '');
        //   }

        if (!part) {
            out = await callJSON(messages, {
                maxTokens: 10000,
                temperature: 0.0,
                schemaName: 'ReduceGlossary',
                schemaProps: { mini_glossary_md: { type: 'string' } },
                expectedKeys: ['mini_glossary_md']
            });
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

// === ЭТАП 3. Ужать доп. контекст =============================================

async function reduceContext(originalRequirements, contextRaw, hintText, maxItems, limitChars = LIMIT_CTX_OUT) {
    const raw = hardClip(contextRaw || '', CLIP_CTX_IN);
    console.log(`[refiner] Stage#3 context in.len=${raw.length}`);
    if (!raw.trim()) return '';

    // Требования: только как ориентир (не источник фактов)
    const reqForModel = sanitizeRequirementsForContext(
        hardClip(originalRequirements || '', CLIP_REQ_IN)
    );

    const allowedUrls = extractUrls(raw);
    const forbiddenUrls = extractUrls(originalRequirements);
    const fmMatch = String(originalRequirements || '').match(/^\s*url:\s*"([^"]+)"/mi);
    if (fmMatch && fmMatch[1]) forbiddenUrls.add(fmMatch[1]);

    const pages = splitContextIntoPages(raw);
    const pageChunksList = pages.map(pg => splitBySize(pg, CHUNK_SIZE_CONTEXT));
    const perPageCap = Math.max(1, Math.ceil(maxItems / Math.max(1, pages.length)));
    const acc = [];

    console.log(`[refiner] Stage#3 allowedUrls.size=${allowedUrls.size} forbiddenUrls.size=${forbiddenUrls.size}`);

    for (let p = 0; p < pages.length && acc.length < maxItems; p++) {
        const pageChunks = pageChunksList[p];
        let producedForPage = 0;

        for (let c = 0; c < pageChunks.length && acc.length < maxItems; c++) {
            const remainForPage = Math.min(perPageCap - producedForPage, maxItems - acc.length);
            if (remainForPage <= 0) break;

            const whitelistNote = allowedUrls.size
                ? `Если ты указываешь источник, используй URL ТОЛЬКО из этого списка:\n${[...allowedUrls].slice(0, 50).map(u => `- ${u}`).join('\n')}`
                : `Если в фрагменте нет URL — не добавляй "(источник: ...)".`;

            const user = `
СТРОГИЙ РЕЖИМ ИЗВЛЕЧЕНИЯ.
Используй блок "Требования" ниже ТОЛЬКО как ОРИЕНТИР, чтобы понять, какие факты из "Контекст фрагмент" релевантны.
Ничего из Требований НЕ БРАТЬ в факты. Факты извлекать ТОЛЬКО из "Контекст фрагмент".
Если во фрагменте нет релевантных фактов — верни пустую строку "".
Не более ${remainForPage} коротких пунктов.
${whitelistNote}

Подсказка (что считать фактом):
${hintText || 'Опред., ограничения, допущения, роли/права, зависимости, конфиги.'}

Требования (только для ориентира):
---------------------------------------
${reqForModel}
---------------------------------------

Контекст фрагмент (page ${p + 1}/${pages.length}, chunk ${c + 1}/${pageChunks.length}) — ИСТОЧНИК ФАКТОВ:
---------------------------------------
${pageChunks[c]}
---------------------------------------

ФОРМАТ ОТВЕТА:
{ "context_md": "- [краткий факт 1]\\n- [краткий факт 2]" }
`.trim();


            const messages = [
                { role: 'system', content: SYSTEM_JSON_ONLY },
                { role: 'user', content: user }
            ];

            let out = null, part = '';

            //  if (TOOLS_ENABLED) {
            //      const tool = buildTool('submit_context', 'context_md', 'Return context_md list');
            //       out = await callTools(messages, tool, { maxTokens: 700, temperature: 0.0, expectedKeys: ['context_md'] });
            //       part = String(out?.context_md || '');
            //    }

            if (!part) {
                out = await callJSON(messages, {
                    maxTokens: 900,
                    temperature: 0.0,
                    schemaName: 'ReduceContext',
                    schemaProps: { context_md: { type: 'string' } },
                    expectedKeys: ['context_md']
                });
                part = String(out?.context_md || '');
            }

            if (!part) {
                console.warn(`[refiner] Stage#3 page=${p + 1} chunk=${c + 1}: fallback to text-mode`);
                const user2 = `
Верни ТОЛЬКО список Markdown-пунктов (до ${remainForPage}). Источники — ТОЛЬКО из списка ниже.
${whitelistNote}

Используй "Требования" ниже ТОЛЬКО как ориентир релевантности. Факты брать ТОЛЬКО из "Контекст фрагмент".

Подсказка:
${hintText}

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
                    { maxTokens: 600, temperature: 0.0 }
                );
            }

            let items = mdToItems(part);
            // Пост-фильтр: пункты должны реально быть основаны на текущем чанке
            const chunk = pageChunks[c];
            const RATIO_MIN = 0.18; // было 0.25
            let filtered = items.filter(line => contentRatio(line, chunk) >= RATIO_MIN);
            // если всё отфильтровали, но модель что-то вернула — возьмём хотя бы первый пункт
            if (!filtered.length && items.length) filtered = [items[0]];
            items = filtered;

            items = filterContextItemsByAllowedSources(items, allowedUrls, forbiddenUrls);

            const limited = items.slice(0, remainForPage);
            acc.push(...limited);
            producedForPage += limited.length;
            console.log(`[refiner] Stage#3 page=${p + 1} chunk=${c + 1} items=${items.length} acc=${acc.length}/${maxItems}`);
        }
    }

    const dedup = dedupLines(acc, maxItems);
    const md = dedup.join('\n').slice(0, limitChars);
    console.log(`[refiner] Stage#3 context out.len=${md.length} items=${dedup.length}`);
    return md;
}

// === Публичный оркестратор ====================================================

/**
 * @param {object} p
 * @param {string} p.requirements          — исходные требования (возвращаем без изменений)
 * @param {string} [p.glossary]
 * @param {string} [p.context]
 * @param {string} [p.contextHint]
 * @param {number} [p.maxGlossary=25]
 * @param {number} [p.maxContext=16]
 * @returns {Promise<{requirements_md:string, mini_glossary_md:string, context_md:string}>}
 */
export async function prepareContextWithAI(p) {
    const maxGlossary = Number.isFinite(p.maxGlossary) ? p.maxGlossary : 25;
    const maxContext = Number.isFinite(p.maxContext) ? p.maxContext : 30;

    console.log('[refiner] === ORCHESTRATION START ===');
    console.log(`[refiner] inputs: req.len=${(p.requirements || '').length} gloss.len=${(p.glossary || '').length} ctx.len=${(p.context || '').length}`);
    console.log(`[refiner] limits: maxGlossary=${maxGlossary} maxContext=${maxContext}`);
    console.log(`[refiner] model=${MODEL} toolsEnabled=${TOOLS_ENABLED} envToolsDisabled=${ENV_TOOLS_DISABLED}`);

    try {
        // 1) Требования не меняем: возвращаем как есть
        const requirements_md = String(p.requirements || '');

        // 2) Глоссарий — выжимка
        const mini_glossary_md = await reduceGlossary(requirements_md, p.glossary || '', maxGlossary);

        // 3) Контекст — выжимка
        const ctxHint =
            (p.contextHint && p.contextHint.trim() && p.contextHint.trim() !== '—')
                ? p.contextHint.trim()
                : 'Возьми только релевантные для проверки требований факты: определения, ограничения, допущения, роли/права, зависимости, конфиги.';

        const context_md = await reduceContext(
            requirements_md,
            joinContextPages(p) || '',
            ctxHint,
            maxContext,
            LIMIT_CTX_OUT
        );

        console.log('[refiner] === ORCHESTRATION DONE ===');
        console.log(`[refiner] outputs: req.len=${requirements_md.length} gloss.len=${mini_glossary_md.length} ctx.len=${context_md.length}`);

        return { requirements_md, mini_glossary_md, context_md };
    } catch (e) {
        console.warn('[refiner] orchestration failed:', e?.message || e);
        return emptyRefine();
    }
}
