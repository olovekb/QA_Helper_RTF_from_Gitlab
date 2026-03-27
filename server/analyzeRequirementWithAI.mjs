// analyzeRequirementWithAI.mjs
import fs from 'fs';
import { prepareContextWithAI } from './contextRefiner.mjs';
import { callWithCloudRuFallback } from './cloudruClient.mjs';
import { createContextSourceRegistry, createContextToolset } from './contextToolset.mjs';
import { runInteractiveLLM } from './interactiveLLM.mjs';
import config from './config.json' assert { type: 'json' };
const SYSTEM_ENFORCER =
  'Ты — старший эксперт по системному анализу. ' +
  'Технологический стек проекта: фронтенд — Angular (TypeScript), бэкенд — .NET/C#. ' +
  'Если поведение относится к UI — трактуй его для Angular; если к серверу/API — трактуй для .NET. ' +
  'ВАЖНО: Документация может состоять из нескольких связанных страниц (иерархия). ' +
  'НЕ считай верхнеуровневое описание ошибкой ("неполнота" или "неоднозначность"), если подробная детализация приведена ниже в тексте (в дочерних разделах). ' +
  'Сначала изучи ВЕСЬ предоставленный текст, прежде чем фиксировать дефект. ' +
  'Верни ТОЛЬКО набор Markdown-блоков строго заданного формата (только в ```), ' +
  'без каких-либо пояснений вне блоков. ' +
  'Если нет ошибок — верни пустую строку.';

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
  let rawResponse = null;

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
        contextPages: [],
        maxGlossary: 100,
        maxContext: 200,
        apiToken: apiKey || OPENROUTER_API_KEY
      });
      if (refined?.requirements_md?.trim()) cleanedReq = refined.requirements_md;
      if (refined?.mini_glossary_md?.trim()) miniGlossary = refined.mini_glossary_md;
      if (refined?.context_md?.trim()) filteredContext = refined.context_md;
    } catch (e) {
      console.warn('[analyze] ошибка префильтрации, откат к исходным данным:', e.message);
    }
  }

  const confluenceFullContent = (Array.isArray(contextPages) ? contextPages : [])
    .filter(Boolean)
    .join('\n\n---\n\n');

  const sourceRegistry = createContextSourceRegistry();
  const { register, safeTrim, deriveTitleFromContent, extractPageId } = sourceRegistry;

  if (safeTrim(requirementText)) {
    register({
      id: 'raw-requirement',
      title: 'Исходное требование',
      description: 'Полный текст требования без предварительной обработки',
      type: 'requirement',
      content: requirementText
    });
  }

  if (safeTrim(cleanedReq) && safeTrim(cleanedReq) !== safeTrim(requirementText)) {
    register({
      id: 'cleaned-requirement',
      title: 'Требование после очистки',
      description: 'Текст требования после предварительной подготовки',
      type: 'requirement',
      content: cleanedReq
    });
  }

  if (safeTrim(glossary)) {
    register({
      id: 'raw-glossary',
      title: 'Глоссарий (полный)',
      description: 'Глоссарий, переданный в запросе',
      type: 'glossary',
      content: glossary
    });
  }

  if (safeTrim(miniGlossary) && safeTrim(miniGlossary) !== safeTrim(glossary)) {
    register({
      id: 'filtered-glossary',
      title: 'Глоссарий (выжимка)',
      description: 'Сокращённый глоссарий после предварительной обработки',
      type: 'glossary',
      content: miniGlossary
    });
  }

  if (safeTrim(context)) {
    register({
      id: 'raw-context',
      title: 'Дополнительный контекст (сырые данные)',
      description: contextHint && contextHint !== '—' ? String(contextHint) : 'Контекст, переданный в запросе',
      type: 'context',
      content: context
    });
  }

  if (safeTrim(filteredContext) && safeTrim(filteredContext) !== safeTrim(context)) {
    register({
      id: 'filtered-context',
      title: 'Дополнительный контекст (выжимка)',
      description: 'Контекст после предварительной обработки',
      type: 'context',
      content: filteredContext
    });
  }

  if (Array.isArray(contextPages) && contextPages.length) {
    contextPages.forEach((rawPage, idx) => {
      const pageContent = typeof rawPage === 'string'
        ? rawPage
        : safeTrim(rawPage?.content || rawPage?.text || '');

      if (!safeTrim(pageContent)) return;

      const foundPageId = extractPageId(pageContent);
      const sourceId = foundPageId ? `page-${foundPageId}` : `context-page-${idx + 1}`;
      const title = deriveTitleFromContent(
        pageContent,
        foundPageId ? `Контекст Confluence ${foundPageId}` : `Контекст ${idx + 1}`,
        foundPageId
      );

      register({
        id: sourceId,
        title,
        description: foundPageId
          ? `Автоматически загруженный контекст из Confluence (pageId=${foundPageId})`
          : 'Дополнительный контекст из Confluence',
        type: 'confluence',
        pageId: foundPageId,
        content: pageContent
      });
    });
  }

  const contextToolset = createContextToolset({
    sources: sourceRegistry.getSources()
  });

  const interactiveTools = Array.isArray(contextToolset.tools) ? contextToolset.tools : [];
  const contextToolHandlers = contextToolset.handlers || {};

  let toolSummary = contextToolset.summary || '';
  if (toolSummary) {
    const lines = toolSummary.split('\n').filter(Boolean);
    if (lines.length > 15) {
      const hiddenCount = lines.length - 15;
      toolSummary = `${lines.slice(0, 15).join('\n')}\n- ... ещё ${hiddenCount} источников`;
    }
  } else {
    toolSummary = '—';
  }

  const toolInstruction = interactiveTools.length
    ? `**Как работать с дополнительным контекстом:**\n- Вызови \`list_context_sources()\`, чтобы получить список источников (они уже загружены из Confluence и запроса)\n- Используй \`fetch_context_chunk({ "sourceId": "...", "offset": 0, "limit": 4000 })\`, чтобы читать нужные фрагменты\n- Если требуется продолжить чтение, увеличивай значение \`offset\`\n\n**Доступные источники:**\n${toolSummary}\n`
    : '**Как работать с дополнительным контекстом:**\nДополнительные источники не предоставлены, анализируй только текст требования.\n';

  // ---------- 1) Финальный промпт ----------
  const prompt = `Ты — ведущий системный аналитик-аудитор с 20-летним опытом в финтех-проектах. Ты перфекционист, предельно внимательный к деталям. Твоя задача — провести исчерпывающий аудит качества требований по стандартам ISO/IEC/IEEE 29148 и лучшим QA-практикам. Найди ВСЕ возможные ошибки, неясности, риски и потенциальные проблемы, даже самые незначительные. От качества твоей проверки зависит успех всего проекта, и любая пропущенная ошибка приведет к серьезным финансовым потерям. Не принимай ничего на веру, подвергай сомнению каждую формулировку.

Анализируйте следующие требования:
---------------------------------------
${cleanedReq}
---------------------------------------

**Секции, на которые ссылается исходное требование (сжатый контекст внешних ссылок; используй ТОЛЬКО для прояснения ссылок)**:
${filteredContext || '—'}

**ПОЛНЫЙ ТЕКСТ СВЯЗАННОЙ ДОКУМЕНТАЦИИ (Дерево Confluence):**
${confluenceFullContent || '—'}

**Проект**: ${project}

**Глоссарий проекта (сокращения и термины):**
${miniGlossary || '—'}

${toolInstruction}

**ВАЖНО: Разделы, которые НЕ нужно анализировать**

1. **Раздел "Тест-кейсы":**
   - Полностью игнорируй любые разделы с названием "Тест-кейсы", "Test cases", "Тестовые сценарии"
   - НЕ проверяй наличие или отсутствие тест-кейсов
   - НЕ требуй добавления тест-кейсов в требования
   - НЕ анализируй содержимое секции с тест-кейсами
   - Тест-кейсы ведутся отдельно и не являются частью требований

2. **Ссылки на тест-кейсы:**
   - НЕ требуй наличия ссылок на тест-кейсы в Confluence или других системах
   - НЕ проверяй корректность ссылок на тест-кейсы
   - Это не практикуется в данном проекте

**ВАЖНО: UI-компоненты и макеты**

1. **Описание UI-компонентов:**
   - Примерное/общее описание UI-компонентов ДОПУСКАЕТСЯ
   - НЕ требуй детального описания визуальных компонентов, если макеты не готовы
   - НЕ требуй точных размеров, отступов, цветов и других визуальных характеристик
   - Достаточно функционального описания компонента (например, "кнопка", "поле ввода", "список")

2. **Отсутствие макетов:**
   - НЕ считай ошибкой отсутствие детального описания UI
   - НЕ требуй наличия макетов или ссылок на макеты
   - Макеты часто создаются позже, на этапе написания аналитики их может не быть

3. **Что можно требовать:**
   - Функциональное поведение компонента (что происходит при нажатии, какие данные отображаются)
   - Условия отображения/скрытия компонента
   - Взаимодействие компонента с другими элементами
   - Валидацию и обработку ошибок

4. **Что НЕ нужно требовать:**
   - Точные размеры и позиционирование элементов
   - Цветовую схему и стилизацию
   - Шрифты и типографику
   - Подробное описание анимаций и переходов
   - Pixel-perfect описание UI

**КРИТИЧЕСКИ ВАЖНО: Параметры между методами**

1. **Переиспользование параметров:**
   - Параметры могут передаваться между методами: из ЗАПРОСА метода A в ЗАПРОС метода B
   - Это нормальная практика, НЕ требуй обоснования

2. **Формулировки:**
   - "из входного параметра X метода Y" = из ЗАПРОСА метода Y
   - "из выходного параметра X метода Y" = из ОТВЕТА метода Y
   - "из параметра X метода Y" (без уточнения) = обычно из ответа, но проверь спецификацию

3. **Проверка перед багом:**
   - Проверь спецификацию API — где находится параметр (запрос/ответ)
   - Оцени логичность: совместима ли семантика параметров?
   - Проверь аналоги: используется ли похожая схема в других методах?
   - При сомнении — НЕ создавай баг

4. **Баг только если:**
   - Явное противоречие спецификации (параметр должен быть в ответе, но его там нет)
   - Несовместимая семантика (userId вместо documentId)
   - Логическая невозможность (серверный timestamp из клиентского запроса)

**Главное правило:** Переиспользование параметров — норма. Баг только при ЯВНОЙ проблеме.

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

**КРИТИЧЕСКИ ВАЖНО: Правильная интерпретация нумерации методов и опечаток**

1. **Нумерация методов (Метод1, Метод2, REST API методы):**
   - Нумерация методов может быть ЛОКАЛЬНОЙ для каждого блока функциональности
   - Если в разделе 3.2.7 есть "Метод1" и "Метод2", а в разделе 5.3 тоже есть "Метод1" и "Метод2" — это НОРМАЛЬНО
   - Каждый блок функциональности может иметь свою внутреннюю нумерацию методов
   - НЕ считай это ошибкой, если нумерация повторяется в разных разделах
   - НЕ требуй глобальной сквозной нумерации методов по всему документу

2. **Опечатки и несоответствия в названиях параметров:**
   - ПЕРЕД тем как определить опечатку как баг, ПРОВЕРЬ контекст:
     * Действительно ли это опечатка, или это разные параметры?
     * Влияет ли это на функциональность или это просто опечатка в документации?
     * Используется ли параметр одинаково в разных местах (тогда это опечатка)?
   - НЕ считай опечатку багом, если:
     * Параметр используется одинаково везде (одинаковое количество символов, одинаковое использование)
     * Это явно опечатка в документации, но не влияет на функциональность
     * В других методах используется правильное название
   - Считай опечатку багом ТОЛЬКО если:
     * Это создает реальную неоднозначность в требованиях
     * Это может привести к ошибкам в реализации
     * Это противоречит другим частям документа, где используется правильное название
   - Пример: Если в требованиях написано \`accId\` в одном месте и \`accld\` в другом, но:
     * В обоих местах используется одинаково (одинаковое количество символов, одинаковый контекст)
     * В других методах используется \`accId\`
     * Это явно опечатка (l вместо I), но не влияет на функциональность
     * → НЕ создавай баг-репорт, это просто опечатка в документации

3. **Проверка перед созданием баг-репорта:**
   - Всегда проверяй контекст использования
   - Всегда проверяй, влияет ли это на функциональность
   - Всегда проверяй, используется ли это одинаково в разных местах
   - Если сомневаешься — лучше НЕ создавай баг-репорт, чем создавать ложный

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
- **Источник**: [ссылка на страницу (автозамена)]
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
- **Источник**: https://confluence.example.com/pages/viewpage.action?pageId=123#id-Heading
\`\`\`
\`\`\`
### Если на форме настроены зависимости старых версий - они будут работать, но внести изменения, добавить новые зависимости будет нельзя.

**Ошибка документации**:
- **Тема**: Неоднозначность и неполнота процесса обновления зависимостей в части «внести изменения, добавить новые зависимости будет нельзя»
- **Описание**: Требование не определяет, как именно система должна блокировать изменения. Будет ли это скрытие кнопок, их деактивация, или всплывающее уведомление? Также неясно, что произойдет, если пользователь попытается обойти ограничение (например, через API).
- **Нарушены свойства**: Завершённость, Недвусмысленность, Проверяемость
- **Фактический результат**: «внести изменения, добавить новые зависимости будет нельзя»
- **Ожидаемый результат**: Уточнить механизм блокировки: "При открытии формы с зависимостями старых версий, все элементы управления для добавления и редактирования зависимостей должны быть деактивированы (disabled). При попытке сохранить изменения через API должен возвращаться код ошибки 422 с сообщением 'Редактирование устаревших зависимостей запрещено. Пожалуйста, пересоздайте форму для использования новой версии'."
- **Источник**: https://confluence.example.com/pages/viewpage.action?pageId=456#id-Heading
\`\`\`
`;
  console.log('[analyze] Финальный промпт:\n', prompt);


  // ---------- 2) Вызов LLM с поддержкой интерактивного контекста ----------
  const messagesFactory = () => ([
    { role: 'system', content: SYSTEM_ENFORCER },
    { role: 'user', content: prompt }
  ]);

  const baseModelOptions = {
    models: config.cloudruModels,
    temperature: 0.25,
    max_tokens: 24000,
    logRateLimit: true
  };

  let content = '';

  try {
    console.log('[analyze] Запуск интерактивного режима (tools-enabled)');
    const interactiveResult = await runInteractiveLLM({
      initialMessages: messagesFactory(),
      tools: interactiveTools,
      toolHandlers: contextToolHandlers,
      modelOptions: baseModelOptions
    });

    rawResponse = interactiveResult.response;

    if (interactiveResult.status === 'assistant-message') {
      content = interactiveResult.message?.content?.trim() || '';
    } else if (interactiveResult.status === 'final-tool-call') {
      console.warn(`[analyze] Модель завершила работу через инструмент "${interactiveResult.toolName}" — возвращаем аргументы как текст`);
      content = JSON.stringify(interactiveResult.args || {}, null, 2);
    }

    console.log(`[analyze] Длина интерактивного ответа: ${content.length}`);
  } catch (interactiveError) {
    console.warn('[analyze] Интерактивный режим не удался, fallback к одиночному запросу:', interactiveError.message);
  }

  const singleShotCall = async (useOpenRouterOnly = false) => {
    return await callWithCloudRuFallback(
      OPENROUTER_URL,
      messagesFactory(),
      useOpenRouterOnly ? OPENROUTER_API_KEY : (apiKey || OPENROUTER_API_KEY),
      useOpenRouterOnly
        ? {
          temperature: 0.25,
          max_tokens: 24000,
          logRateLimit: true
        }
        : baseModelOptions
    );
  };

  if (!content || content === '```' || content === '```\n```') {
    try {
      console.warn('[analyze] Результат пустой или некорректный — пробуем одиночный вызов (Cloud.ru -> OpenRouter)');
      const singleShotResponse = await singleShotCall(false);
      rawResponse = singleShotResponse;
      content = singleShotResponse.choices?.[0]?.message?.content?.trim() || '';
      console.log(`[analyze] Single-shot response length: ${content.length}`);

      if (!content || content === '```' || content === '```\n```') {
        console.warn('[analyze] Cloud.ru вернул пустой ответ, пробуем OpenRouter напрямую');
        const fallbackResponse = await singleShotCall(true);
        rawResponse = fallbackResponse;
        content = fallbackResponse.choices?.[0]?.message?.content?.trim() || '';
        console.log(`[analyze] OpenRouter-only response length: ${content.length}`);

        if (!content || content === '```' || content === '```\n```') {
          console.error('[analyze] Все провайдеры вернули пустой ответ');
          throw new Error('Все AI провайдеры вернули пустой ответ');
        }
      }
    } catch (fallbackError) {
      console.error('[analyze] Ошибка во время fallback:', fallbackError.message);
      throw fallbackError;
    }
  }

  console.log(`[analyze] Итоговая длина ответа: ${content.length} символов`);
  console.log(`[analyze] Ответ (первые 200 символов): "${content.slice(0, 200) || 'пусто'}..."`);

  content = content.replace(/```\s*markdown\s*/g, '```');
  content = content.replace(/```[ \t]*\n[ \t]*```/g, '');

  const startsFence = /^\s*```/.test(content);
  const endsFence = /```\s*$/.test(content);
  if (startsFence && endsFence) {
    const inner = content.replace(/^\s*```\s*/, '').replace(/\s*```\s*$/, '').trim();
    const parts = inner.split(/\n(?=###\s)/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      content = parts.map(p => '```\n' + p + '\n```').join('\n\n');
    }
  }

  if (!/```/.test(content) && /(^|\n)###\s/.test(content)) {
    const parts = content.split(/\n(?=###\s)/).map(s => s.trim()).filter(Boolean);
    if (parts.length) {
      content = parts.map(p => '```\n' + p + '\n```').join('\n\n');
    }
  }

  const multiBlocks = content.match(/```[\s\S]*?```/g);
  if (multiBlocks && multiBlocks.length > 1) {
    const filtered = multiBlocks
      .map(b => ({ raw: b, inner: b.replace(/^```\s*/, '').replace(/\s*```$/, '').trim() }))
      .filter(x => x.inner && /^###\s/.test(x.inner));
    if (filtered.length) {
      content = filtered.map(x => '```\n' + x.inner + '\n```').join('\n\n');
    }
  }

  content = enrichAnalysisWithLinks(content, requirementText);

  try {
    fs.writeFileSync('requirement-analysis.txt', content, 'utf8');
  } catch (e) {
    console.warn('Не удалось записать requirement-analysis.txt:', e.message);
  }

  return content;
}
/**
 * Программное вычисление ссылок на основе найденного текста
 */
function enrichAnalysisWithLinks(aiMarkdown, fullSource) {
  const blocks = aiMarkdown.match(/```[\s\S]*?```/g);
  if (!blocks) return aiMarkdown;

  let enriched = aiMarkdown;

  for (const block of blocks) {
    const inner = block.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    const titleMatch = inner.match(/^###\s+\[(.*?)\]/);
    if (!titleMatch) continue;

    const reqTitle = titleMatch[1].trim();
    const pos = fullSource.indexOf(reqTitle);
    if (pos === -1) continue;

    const beforeText = fullSource.slice(0, pos);

    const pageMatches = [...beforeText.matchAll(/\[CONFLUENCE_PAGE:\s+id=(\d+),/g)];
    const pageId = pageMatches.length ? pageMatches[pageMatches.length - 1][1] : null;

    const headingMatches = [...beforeText.matchAll(/(?:^|\n)(#{1,6})\s+(.*)/g)];
    const lastHeading = headingMatches.length ? headingMatches[headingMatches.length - 1][2].trim() : '';

    if (pageId) {
      const anchor = lastHeading ? `#id-${lastHeading.replace(/\s+/g, '')}` : '';
      const finalLink = `https://confluence.artsofte.ru/pages/viewpage.action?pageId=${pageId}${anchor}`;

      // Ищем поле Источник или добавляем в конец
      if (inner.includes('**Источник**:')) {
        const newInner = inner.replace(/\*\*Источник\*\*:\s*[^\n]*($|\n)/, `**Источник**: ${finalLink}\n`);
        enriched = enriched.replace(block, '```\n' + newInner + '\n```');
      } else {
        const newInner = inner + `\n- **Источник**: ${finalLink}`;
        enriched = enriched.replace(block, '```\n' + newInner + '\n```');
      }
    }
  }

  return enriched;
}
