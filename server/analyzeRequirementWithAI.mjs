// analyzeRequirementWithAI.mjs
import fs from 'fs';
import { prepareContextWithAI } from './contextRefiner.mjs';
import { callWithCloudRuFallback } from './cloudruClient.mjs';
import config from './config.json' assert { type: 'json' };
// Жёсткая инструкция к финальному ответу: только нужные Markdown-блоки
const SYSTEM_ENFORCER =
  'Ты — старший эксперт по системному анализу. ' +
  'Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. ' +
  'Если поведение относится к UI — трактуй его для Angular; если к серверу/API — трактуй для .NET. ' +
  'Верни ТОЛЬКО набор Markdown-блоков строго заданного формата (только в ```), ' +
  'без каких-либо пояснений вне блоков. ' +
  'Если нет ошибок — верни пустую строку.';

// Настройки API
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = config.openRouterAiKey;

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
  opts = {},
  apiKey = null
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
        maxContext: 50,
        apiToken: apiKey || OPENROUTER_API_KEY  // Передаём пользовательский ключ!
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

**Секции, на которые ссылается исходное требование (используй ТОЛЬКО для прояснения ссылок; не выводи сюда новые требования)**:
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


  // ---------- 2) Вызов LLM с Cloud.ru приоритетом и OpenRouter fallback ----------
  try {
    const data = await callWithCloudRuFallback(
      OPENROUTER_URL,
      [
        { role: 'system', content: SYSTEM_ENFORCER },
        { role: 'user', content: prompt }
      ],
      apiKey || OPENROUTER_API_KEY,
            {
              models: config.cloudruModels,
              temperature: 0.25,
              max_tokens: 24000,  // Снижено с 24000 до 8000 для ускорения
              logRateLimit: true
            }
    );

    let content = data.choices?.[0]?.message?.content?.trim();
    console.log(`[analyze] AI response length: ${content?.length || 0} chars`);
    console.log(`[analyze] AI response preview: "${content?.slice(0, 200) || 'no content'}..."`);
    
    if (!content || content === '```' || content === '```\n```') {
      console.warn('[analyze] Empty or invalid AI response, falling back to OpenRouter');
      
      // Fallback на OpenRouter при пустом ответе от Cloud.ru
      try {
        console.log('[analyze] Attempting OpenRouter fallback...');
        const fallbackData = await callWithCloudRuFallback(
          OPENROUTER_URL,
          [
            { role: 'system', content: SYSTEM_ENFORCER },
            { role: 'user', content: prompt }
          ],
          OPENROUTER_API_KEY,
                {
                  temperature: 0.25,
                  max_tokens: 24000,  // Снижено с 24000 до 8000 для ускорения
                  logRateLimit: true
                }
        );
        
        const fallbackContent = fallbackData.choices?.[0]?.message?.content?.trim() || '';
        console.log(`[analyze] OpenRouter fallback response length: ${fallbackContent.length} chars`);
        
        if (fallbackContent && fallbackContent !== '```' && fallbackContent !== '```\n```') {
          console.log('[analyze] OpenRouter fallback successful');
          content = fallbackContent;
        } else {
          console.error('[analyze] OpenRouter fallback also returned empty response. Full data:', JSON.stringify(fallbackData, null, 2));
          throw new Error('Все AI провайдеры вернули пустой ответ');
        }
      } catch (fallbackError) {
        console.warn('[analyze] OpenRouter fallback failed:', fallbackError.message);
        throw new Error('Ответ от модели пустой и fallback не удался');
      }
    }

    // Нормализация вывода для моделей, склонных вставлять пустые или "```markdown" блоки
    content = content.replace(/```\s*markdown\s*/g, '```');
    content = content.replace(/```\s*\n\s*```/g, ''); // удаляем пустые блоки ```\n```

    // Если вся выдача в одном общем fenced-блоке — режем по секциям "### ..."
    const startsFence = /^\s*```/.test(content);
    const endsFence = /```\s*$/.test(content);
    if (startsFence && endsFence) {
      const inner = content.replace(/^\s*```\s*/, '').replace(/\s*```\s*$/, '').trim();
      const parts = inner.split(/\n(?=###\s)/).map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        content = parts.map(p => '```\n' + p + '\n```').join('\n\n');
      }
    }

    // Если вообще нет fenced-блоков, но есть заголовки — обернём каждую секцию
    if (!/```/.test(content) && /(^|\n)###\s/.test(content)) {
      const parts = content.split(/\n(?=###\s)/).map(s => s.trim()).filter(Boolean);
      if (parts.length) {
        content = parts.map(p => '```\n' + p + '\n```').join('\n\n');
      }
    }

    // Если в тексте уже есть несколько fenced-блоков — отфильтруем шумовые
    const multiBlocks = content.match(/```[\s\S]*?```/g);
    if (multiBlocks && multiBlocks.length > 1) {
      const filtered = multiBlocks
        .map(b => ({ raw: b, inner: b.replace(/^```\s*/,'').replace(/\s*```$/,'').trim() }))
        .filter(x => x.inner && /^###\s/.test(x.inner));
      if (filtered.length) {
        content = filtered.map(x => '```\n' + x.inner + '\n```').join('\n\n');
      }
    }

    // Сохраняем для отладки
    try {
      fs.writeFileSync('requirement-analysis.txt', content, 'utf8');
    } catch (e) {
      console.warn('Не удалось записать requirement-analysis.txt:', e.message);
    }

    return content;
  } catch (err) {
    console.error('[analyze] Ошибка анализа требования:', err.message);
    throw err;
  }
}
