// Нормализация шагов тест-кейса для статического анализа

// Отступы по уровню вложенности (depth 0, 1, 2+)
const INDENT = ['', '   ', '      '];

// ─── Типы (JSDoc) ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} FlatStep
 * @property {string}  text          - Текст действия (очищенный)
 * @property {string|null} expectedResult - Ожидаемый результат шага (или null)
 * @property {number}  depth         - Уровень вложенности: 0=основной, 1=подшаг, 2=глубокий
 * @property {boolean} isSharedStep  - Является ли общим шагом
 */

// ─── Утилиты ─────────────────────────────────────────────────────────────────

/**
 * Очистить текст шага от переносов, пробелов; текст шага преобразовывается в одну строку
 * @param text
 */
function sanitizeStepText (text)
{
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\r\n|\r/g, '\n')   // унификация переносов строк
    .replace(/\n{2,}/g, ' ')     // несколько переносов = пробел
    .replace(/\n/g, ' ')         // одиночный перенос внутри шага = пробел
    .replace(/\s{2,}/g, ' ')     // несколько пробелов = один
    .trim();
}

/**
 * Извлечь текст из шага любого формата
 * @param step
 */
function extractText (step)
{
  if (!step) return '';
  if (typeof step === 'string') return sanitizeStepText(step);
  if (typeof step.body === 'string') return sanitizeStepText(step.body);
  if (typeof step.description === 'string') return sanitizeStepText(step.description);

  if (step.bodyJson?.content && Array.isArray(step.bodyJson.content)) {
    const text = step.bodyJson.content
      .map(paragraph =>
        (paragraph.content || []).map(item => item.text || '').join(' ')
      )
      .join(' ');
    return sanitizeStepText(text);
  }

  return '';
}

/**
 * Извлечь текст ожидаемого результата из шага
 * @param expectedResultId
 * @param scenarioSteps - словарь шагов
 */
function extractExpectedResultText (expectedResultId, scenarioSteps)
{
  if (!expectedResultId || !scenarioSteps) return null;

  const container = scenarioSteps[expectedResultId];
  if (!container) return null;

  let text = '';

  if (Array.isArray(container.children) && container.children.length > 0) {
    // ОР вынесен в дочерние узлы
    text = container.children
      .map(childId => extractText(scenarioSteps[childId]))
      .filter(Boolean)
      .join('\n');
  } else {
    const raw = extractText(container);
    const lower = raw.toLowerCase();
    // Игнорируем технические заголовки
    if (raw && lower !== 'expected result' && lower !== 'ожидаемый результат') {
      text = raw;
    }
  }

  return text.trim() || null;
}

/**
 * Рекурсивная обработка шагов из scenarioSteps.
 */
function normalizeAllureStep (stepId, scenarioSteps, sharedSteps, sharedStepScenarioSteps, depth)
{
  const step = scenarioSteps[stepId];
  if (!step) return [];

  const result = [];

  if (step.sharedStepId) {
    const shared = sharedSteps[step.sharedStepId];
    if (!shared) return [];

    const text = extractText(shared);
    if (text) {
      result.push({ text, expectedResult: null, depth, isSharedStep: true });
    }

    // Обработка дочерних шагов shared step в sharedStepScenarioSteps
    if (Array.isArray(shared.children)) {
      for (const childId of shared.children) {
        result.push(
          ...normalizeAllureStep(childId, sharedStepScenarioSteps, sharedSteps, sharedStepScenarioSteps, depth + 1)
        );
      }
    }
  } else {
    // Обычный шаг
    const text = extractText(step);
    const expectedResult = extractExpectedResultText(step.expectedResultId, scenarioSteps);

    if (text) {
      result.push({ text, expectedResult, depth, isSharedStep: false });
    }

    if (Array.isArray(step.children)) {
      for (const childId of step.children) {
        result.push(
          ...normalizeAllureStep(childId, scenarioSteps, sharedSteps, sharedStepScenarioSteps, depth + 1)
        );
      }
    }
  }

  return result;
}

/**
 * Нормализовать Allure-объект в FlatStep[]
 * @param tepsObj  - объект с полями root/scenarioSteps/sharedSteps/sharedStepScenarioSteps
 */
function normalizeAllureObject (stepsObj)
{
  const root = stepsObj.root ?? stepsObj.scenario?.root;
  const scenarioSteps = stepsObj.scenarioSteps ?? stepsObj.scenario?.scenarioSteps ?? {};
  const sharedSteps = stepsObj.sharedSteps ?? {};
  const sharedStepScenarioSteps = stepsObj.sharedStepScenarioSteps ?? {};

  if (!root || !Array.isArray(root.children)) {
    // фоллбэк: перебрать все scenarioSteps по значениям
    return Object.values(scenarioSteps)
      .map(step =>
      {
        const text = extractText(step);
        return text ? { text, expectedResult: null, depth: 0, isSharedStep: false } : null;
      })
      .filter(Boolean);
  }

  const result = [];
  for (const stepId of root.children) {
    result.push(
      ...normalizeAllureStep(stepId, scenarioSteps, sharedSteps, sharedStepScenarioSteps, 0)
    );
  }
  return result;
}

/**
 * Рекурсивноая нормализация одного шага из массива
 * @param step
 * @param depth
 */
function normalizeArrayStep (step, depth)
{
  const result = [];

  if (step.type === 'sharedStep') {
    const text = extractText(step);
    if (text) {
      result.push({ text, expectedResult: null, depth, isSharedStep: true });
    }

    if (Array.isArray(step.childSteps)) {
      for (const child of step.childSteps) {
        // childSteps могут иметь description и expectedResult как поля
        const childText = sanitizeStepText(child.description || extractText(child));
        const childER = child.expectedResult
          ? sanitizeStepText(typeof child.expectedResult === 'string'
            ? child.expectedResult
            : extractText(child.expectedResult))
          : null;

        if (childText) {
          result.push({ text: childText, expectedResult: childER || null, depth: depth + 1, isSharedStep: false });
        }
      }
    }
  } else {
    const text = extractText(step);

    const expectedResult = step.expectedResult
      ? sanitizeStepText(typeof step.expectedResult === 'string'
        ? step.expectedResult
        : extractText(step.expectedResult))
      : null;

    if (text) {
      result.push({ text, expectedResult: expectedResult || null, depth, isSharedStep: false });
    }

    // Рекурсия, если  у шага есть children
    if (Array.isArray(step.children)) {
      for (const child of step.children) {
        result.push(...normalizeArrayStep(child, depth + 1));
      }
    }
  }

  return result;
}

/**
 * Нормализация массива шагов в FlatStep[]
 */
function normalizeStepsArray (stepsArray)
{
  const result = [];
  for (const step of stepsArray) {
    result.push(...normalizeArrayStep(step, 0));
  }
  return result;
}

/**
 * Определить формат входа и нормализовать шаги в FlatStep[]
 */
export function normalizeStepsToFlat (steps)
{
  if (!steps) return [];

  if (Array.isArray(steps)) {
    return normalizeStepsArray(steps);
  }

  if (typeof steps === 'object') {
    return normalizeAllureObject(steps);
  }

  return [];
}

/**
 * Преобразовать ожидаемый результат в многострочный маркированный список
 *
 * @param  text
 * @param baseIndent - отступ родительского шага
 */
function renderExpectedResult (text, baseIndent)
{
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const orIndent = baseIndent + '  ';
  return [
    `${orIndent}Ожидаемый результат:`,
    ...lines.map(l => `${orIndent}  - ${l}`)
  ];
}

/**
 * Преобразовать FlatStep[] в текст для AI-промпта
 *
 * Формат вывода:
 *   1. Основной шаг (depth=0, нумерованный)
 *      Ожидаемый результат:
 *        - пункт
 *   - подшаг (depth=1)
 *        Ожидаемый результат:
 *          - пункт
 */
export function renderFlatSteps (flatSteps)
{
  if (!flatSteps || flatSteps.length === 0) return 'не указаны';

  const lines = [];
  let stepNumber = 1;

  for (const step of flatSteps) {
    const indent = INDENT[Math.min(step.depth, INDENT.length - 1)];
    const isTop = step.depth === 0;

    // Префикс: нумерация для основных, дефис для вложенных
    const prefix = isTop ? `${stepNumber++}.` : '-';

    // Заглавная буква только для основных шагов
    const text = isTop
      ? step.text.charAt(0).toUpperCase() + step.text.slice(1)
      : step.text;

    const label = step.isSharedStep ? `${text} (общий шаг)` : text;
    lines.push(`${indent}${prefix} ${label}`);

    if (step.expectedResult) {
      lines.push(...renderExpectedResult(step.expectedResult, indent));
    }
  }

  return lines.join('\n');
}

/**
 * Замена formatStepsForPrompt
 */
export function formatStepsForPrompt (steps)
{
  const flat = normalizeStepsToFlat(steps);
  return renderFlatSteps(flat);
}
