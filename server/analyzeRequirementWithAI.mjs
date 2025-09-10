// analyzeRequirementWithAI.mjs
import fetch from 'node-fetch';
import fs from 'fs';
import { prepareContextWithAI } from './contextRefiner.mjs';
import config from './config.json' assert { type: 'json' };
// Жёсткая инструкция к финальному ответу: только нужные Markdown-блоки
const SYSTEM_ENFORCER =
  'Ты — старший эксперт по системному анализу. ' +
  'Верни ТОЛЬКО набор Markdown-блоков строго заданного формата (только в ```), ' +
  'без каких-либо пояснений вне блоков. ' +
  'Если нет ошибок — верни пустую строку.';

// Вынес настройки OpenRouter в константы
const API_TOKEN = config.openRouterAiKey;

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'qwen/qwen3-235b-a22b:free';

/**
 * Анализирует требование с учётом статического анализа и LLM.
 *
 * @param {string} requirementText — текст требования (сырой)
 * @param {string} [context='—'] — доп. контекст (сырой, можно большой)
 * @param {string} [project='—'] — идентификатор проекта
 * @param {string} [glossary='—'] — глоссарий (сырой, можно большой)
 * @param {object} [opts]
 * @param {boolean} [opts.prefilter=true] — включать ли промежуточную “уборку”
 * @param {string[]} [opts.contextPages=[]] — подсказка что вытаскивать из контекста
 * @returns {Promise<string>} — ответ AI (markdown-блоки по вашему шаблону)
 */
export async function analyzeRequirementWithAI(
  requirementText,
  context = '—',
  project = '—',
  glossary = '—',
  opts = {}
) {
  const {
    prefilter = true,
    contextHint = '—',
    contextPages = []
  } = opts;

  // ---------- 0) Промежуточная "уборка" ----------
  let cleanedReq = requirementText;
  let miniGlossary = glossary;
  let filteredContext = context;

  if (prefilter) {
    try {
      const refined = await prepareContextWithAI({
        requirements: requirementText,
        glossary,
        context,
        contextHint,
        contextPages,
        maxGlossary: 40,
        maxContext: 50
      });
      if (refined?.requirements_md?.trim()) cleanedReq = refined.requirements_md;
      if (refined?.mini_glossary_md?.trim()) miniGlossary = refined.mini_glossary_md;
      if (refined?.context_md?.trim()) filteredContext = refined.context_md;
    } catch (e) {
      console.warn('[analyze] prefilter failed, fallback to original input:', e.message);
    }
  }

  // ---------- 1) Финальный промпт ----------
  const prompt = `Ты — ведущий системный аналитик-аудитор с 20-летним опытом в финтех-проектах. Ты перфекционист, предельно внимательный к деталям. Твоя задача — провести исчерпывающий аудит качества требований по стандартам ISO/IEC/IEEE 29148 и лучшим QA-практикам. Найди ВСЕ возможные ошибки, неясности, риски и потенциальные проблемы, даже самые незначительные. От качества твоей проверки зависит успех всего проекта, и любая пропущенная ошибка приведет к серьезным финансовым потерям. Не принимай ничего на веру, подвергай сомнению каждую формулировку.

Анализируйте следующие требования:
---------------------------------------
${cleanedReq}
---------------------------------------

**Дополнительный контекст**:
${filteredContext || '—'}

**Проект**: ${project}

**Глоссарий проекта (сокращения и термины):**
${miniGlossary || '—'}

**Критерии проверки:**
1. Завершённость — полная информация без пропусков (негативные сценарии, параметры)
2. Атомарность — описывает одну ситуацию/условие, без объединения нескольких
3. Непротиворечивость — нет внутренних или межтребовательных конфликтов
4. Недвусмысленность — однозначная формулировка без расплывчатых слов и неочевидных аббревиатур
5. Выполнимость — технологически и ресурсно реализуемо
6. Обязательность — ясно, обязательно ли требование, опционально или устарело
7. Корректность и проверяемость — есть чёткий критерий проверки, нет опечаток, адекватный уровень детализации

**Инструкция по анализу:**
Сначала по каждому требованию проведи внутренний анализ шаг за шагом. Для каждого из 7 критериев (Завершённость, Атомарность и т.д.) подумай, нарушен ли он. Если да, то почему. Только после этого внутреннего анализа сформируй итоговый ответ в Markdown-блоках. Не показывай свои рассуждения в итоговом ответе.
Перед анализом восстанови вложенность списков:
— последовательности вида «1.» затем «a.)/i.)/–» трактуй как вложенные подпункты предыдущего пункта;
— если отступы отсутствуют, используй порядок приоритетов уровней: число → буква → римская → маркер «–»;
— не меняй порядок элементов.

**Формат ответа — обязательно использовать ровно этот шаблон Markdown**:

Для каждого требования:

\`\`\`
### [Текст требования]

**Ошибка документации**:
- **Тема**: [краткое название дефекта] в части «[цитата из проблемного фрагмента требования]»
- **Описание**: [в чём несоответствие]
- **Нарушены свойства**: [список свойств через запятую]
- **Фактический результат**: [что написано сейчас]
- **Ожидаемый результат**: [что нужно написать, или уточняющий вопрос]
\`\`\`

**Правила:**
- Никакого текста вне блоков
- Каждый блок начинается и заканчивается \`\`\`
- Между блоками — одна пустая строка
- Не добавлять заголовки, списки, markdown за пределами шаблона
- Если нет ошибок — не выводить ничего
- Формулировки внутри блока — только по делу, без вступлений
- Уточняющие вопросы писать ТОЛЬКО в поле "Ожидаемый результат"

**Пример:**

\`\`\`
### Если параметр count = 0, текст "Счета к оплате" должен отображаться без счётчика.

**Ошибка документации**:
- **Тема**: Нет описания альтернативного отображения при count=0 в части «если count = 0»
- **Описание**: не указано, что должно быть показано вместо счётчика
- **Нарушены свойства**: Завершённость, Проверяемость
- **Фактический результат**: «текст "Счета к оплате" должен отображаться без счётчика»
- **Ожидаемый результат**: Уточнить формулировку: “Если count = 0, отображать только заголовок ‘Счета к оплате’ без цифрового индикатора.”
\`\`\`
\`\`\`
### Если на форме настроены зависимости старых версий - они будут работать, но внести изменения, добавить новые зависимости будет нельзя.

**Ошибка документации**:
- **Тема**: Неоднозначность и неполнота процесса обновления зависимостей в части «внести изменения, добавить новые зависимости будет нельзя»
- **Описание**: Требование не определяет, как именно система должна блокировать изменения. Будет ли это скрытие кнопок, их деактивация, или всплывающее уведомление? Также неясно, что произойдет, если пользователь попытается обойти ограничение (например, через API).
- **Нарушены свойства**: Завершённость, Недвусмысленность, Проверяемость
- **Фактический результат**: «внести изменения, добавить новые зависимости будет нельзя»
- **Ожидаемый результат**: Уточнить механизм блокировки: "При открытии формы с зависимостями старых версий, все элементы управления для добавления и редактирования зависимостей должны быть деактивированы (disabled). При попытке сохранить изменения через API должен возвращаться код ошибки 422 с сообщением 'Редактирование устаревших зависимостей запрещено. Пожалуйста, пересоздайте форму для использования новой версии'."
\`\`\`
`;
  console.log('[analyze] Финальный промпт:\n', prompt);


  // ---------- 2) Вызов LLM с ретраями ----------
  const headers = {
    Authorization: `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const makeBody = () =>
    JSON.stringify({
      model: MODEL,
      max_tokens: 24000,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_ENFORCER },
        { role: 'user', content: prompt }
      ]
    });

  const maxRetries = 3;
  let rateRetries = 0;

  const RATE_LIMIT_MAX_RETRIES = Number(process.env.RATE_LIMIT_MAX_RETRIES || 7);
  const RETRY_AFTER_DEFAULT_MS = Number(process.env.RETRY_AFTER_DEFAULT_MS || 20000);

  const getRetryAfterMs = (res) => {
    try {
      const h = res?.headers?.get?.('retry-after');
      if (!h) return RETRY_AFTER_DEFAULT_MS;
      const secs = Number(h);
      if (!Number.isNaN(secs) && secs > 0) return secs * 1000;
      const when = Date.parse(h);
      if (!Number.isNaN(when)) {
        const diff = when - Date.now();
        return diff > 0 ? diff : RETRY_AFTER_DEFAULT_MS;
      }
      return RETRY_AFTER_DEFAULT_MS;
    } catch {
      return RETRY_AFTER_DEFAULT_MS;
    }
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(URL, { method: 'POST', headers, body: makeBody() });

      // Прямой 429 от сервера
      if (res.status === 429) {
        const waitMs = getRetryAfterMs(res);
        console.warn(`[analyze] 429 rate-limited, wait ${waitMs}ms (retry ${rateRetries + 1}/${RATE_LIMIT_MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, waitMs));
        rateRetries++;
        if (rateRetries > RATE_LIMIT_MAX_RETRIES) {
          throw new Error('Rate limit exceeded repeatedly (HTTP 429)');
        }
        attempt--; // не сжигаем попытку
        continue;
      }

      const data = await res.json().catch(() => ({}));

      // 429 может прийти в теле при 200 OK
      const bodyCode = data?.error?.code || data?.error?.status;
      const bodyMsg = data?.error?.message || '';
      if (res.status === 429 || bodyCode === 429 || /rate.?limit/i.test(String(bodyMsg))) {
        const waitMs = getRetryAfterMs(res);
        console.warn(`[analyze] 429(body) rate-limited, wait ${waitMs}ms (retry ${rateRetries + 1}/${RATE_LIMIT_MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, waitMs));
        rateRetries++;
        if (rateRetries > RATE_LIMIT_MAX_RETRIES) {
          throw new Error('Rate limit exceeded repeatedly (429 via body)');
        }
        attempt--; // не сжигаем попытку
        continue;
      }

      if (!res.ok || data?.error) {
        const errMsg = data?.error?.message || JSON.stringify(data?.error || {});
        throw new Error(`${res.status} ${res.statusText}: ${errMsg}`.trim());
      }

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('Ответ от модели пустой');

      // Cохраняем для отладки
      try {
        fs.writeFileSync('requirement-analysis.txt', content, 'utf8');
      } catch (e) {
        console.warn('Не удалось записать requirement-analysis.txt:', e.message);
      }

      return content;
    } catch (err) {
      // если это серверная 5xx — попробуем повторить
      const is5xx = /\b5\d{2}\b/.test(err.message) || /ECONNRESET|ETIMEDOUT/i.test(err.message);
      if (attempt < maxRetries && is5xx) {
        const delay = 1000 * 2 ** (attempt - 1);
        console.warn(`[analyze] попытка ${attempt} не удалась (${err.message}), retry через ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error('Ошибка анализа требования:', err.message);
      throw err;
    }
  }
}
