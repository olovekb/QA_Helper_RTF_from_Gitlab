import nlp from 'compromise';
import nlpNumbers from 'compromise-numbers';
import nlpSentences from 'compromise-sentences';
// расширяем библиотеку
nlp.extend(nlpNumbers).extend(nlpSentences);

// паттерны для категорий
const patterns = {
  completeness: [
    { regex: /парол(ь|и|ей).*?(хранить|хранятся|хранение)/gi, message: 'Укажите алгоритм шифрования для хранения паролей.' },
    { regex: /\bTBD\b|\bto be defined\b/gi, message: 'Неполное требование (TBD). Уточните значение.' },
    { regex: /\bи т\.д\.\b/gi, message: 'Неполное перечисление ("и т.д."). Уточните полный список.' }
  ],
  negativeScenarios: [/\b(error|fail|exception|ошибк|отказ)\b/i],
  ambiguityWords: [
    'адекватно', 'быстро', 'удобно', 'эффективно', 'нормально',
    'желательно', 'возможно', 'и т.д.', 'часто', 'редко', 'иногда',
    'по мере необходимости', 'как можно скорее', 'максимально',
    'оптимально', 'достаточно', 'значительно', 'существенный',
    'улучшенный', 'результативно', 'свободно', 'легко', 'прозрачно',
    'скоро', 'возможно, стоит', 'без ограничений', 'по аналогии',
    'примерно', 'etc'
  ],
  contradiction: [
    {
      regex: /(должен|обязательно).*?(не должен|запрещено)/gi,
      message: 'Противоречивые формулировки: обязательность и запрет.'
    }
  ],
  feasibility: [
    {
      regex: /(искусственн\w* интеллект|нейросет\w*)/gi,
      message: 'Сложно реализуемая конструкция с ИИ.'
    }
  ],
  apiPatterns: [
    {
      regex: /\/rest\/[^\s]+/g,
      validator: (url) => {
        if (!/(GET|POST|PUT|DELETE|PATCH|HEAD)\s+\//.test(url)) {
          return 'REST-метод без указания HTTP-метода';
        }
        if (url.includes('//rest/')) return 'Двойной слэш в URL';
        return null;
      }
    },
    {
      regex: /(Метод \d+):\s*([^\n]+)/g,
      message: 'Формат описания методов: "Метод X: HTTP-метод /path/endpoint - Описание"'
    }
  ],
  mobilePatterns: [
    {
      regex: /мобильн\w+ приложени\w+/gi,
      validator: (text) => {
        if (!/с учетом ограничений мобильных платформ/i.test(text)) {
          return 'Упомянуты мобильные приложения без указания платформо-специфичных ограничений';
        }
        return null;
      }
    }
  ],
  httpPatterns: [
    {
      regex: /200 ОК\s*\+\s*errorCode/gi,
      message: 'Противоречивый HTTP-статус (200 OK + errorCode). Используйте 4xx/5xx для ошибок'
    }
  ]
};

/**
 * Анализ требований по 7 свойствам качества
 * @param {{ text: string }} data
 * @returns {{ issues: Array, stats: Object }}
 */
export function analyzeSolution(data) {
  console.log('Запуск анализа требований...');
  if (!data || typeof data.text !== 'string') {
    console.error('Неверный формат данных: ожидается строка текст требований');
    throw new Error('Неверный формат данных: требуется поле text.');
  }

  const raw = data.text;
  console.log('Входной текст требований:\n', raw);
  const text = raw.trim();
  const baseOffset = raw.indexOf(text);

  // разбиваем на предложения
  const doc = nlp(text);
  const sentences = doc.sentences().out('array');
  const issues = [];

  // вспомогательные функции
  const getGlobalIndex = idx => idx + baseOffset;
  function findLine(idx) {
    const lines = raw.split(/\r?\n/);
    let pos = 0;
    for (const line of lines) {
      const len = line.length + 1;
      if (idx < pos + len) return line.trim();
      pos += len;
    }
    return '';
  }
  function record(category, message, localIdx) {
    const idx = getGlobalIndex(localIdx);
    const line = findLine(idx);
    console.log(`Нарушение [${category}] в строке:`, line);
    issues.push({
      category,
      message,
      index: idx,
      line,
      excerpt: raw.substr(idx, 80).replace(/\r?\n/g, ' ')
    });
  }

  // 1. Завершённость
  patterns.completeness.forEach(p => {
    let m;
    while ((m = p.regex.exec(text)) !== null) {
      record('Завершённость', p.message, m.index);
    }
  });

  // негативные сценарии
  if (!patterns.negativeScenarios[0].test(text)) {
    record('Завершённость',
      'Не найдены негативные сценарии (ошибки, исключения). Уточните возможные отказы.',
      0);
  }

  // условия «если...то» и таблица решений
  const ifThenAll = text.match(/\bесли[\s\S]{0,100}?\bто\b/gi) || [];
  if (ifThenAll.length > 3 && !/таблица решений/i.test(text)) {
    record('Завершённость',
      `Найдено ${ifThenAll.length} условий «если...то». Рассмотрите использование таблицы решений.`,
      0);
  }

  // Проверка сложных условий
  const complexIfRegex = /если[\s\S]{10,}?(?:иначе|и если|или если)/gi;
  let complexIf;
  while ((complexIf = complexIfRegex.exec(text)) !== null) {
    const nestedIf = complexIf[0].match(/если/gi)?.length || 0;
    if (nestedIf > 2) {
      record('Читаемость',
        `Слишком сложное условие (${nestedIf} уровней вложенности). Рассмотрите вынос в отдельную таблицу решений.`,
        complexIf.index);
    }
  }

  // 2. Атомарность
  sentences.forEach(sent => {
    const localIdx = text.indexOf(sent);
    if (/^\s*\d+[\.\)]/.test(sent) || /\/rest\//.test(sent) || sent.length > 200) return;

    const conjMatches = sent.match(/\b(и|или)\b/gi) || [];
    if (conjMatches.length > 1) {
      record('Атомарность',
        `Найдено несколько союзов 'и/или' (${conjMatches.join(', ')}). Возможно объединены несколько требований.`,
        localIdx);
    }
  });

  // 3. Непротиворечивость
  patterns.contradiction.forEach(p => {
    let m;
    while ((m = p.regex.exec(text)) !== null) {
      record('Непротиворечивость', p.message, m.index);
    }
  });

  // Проверка параметров на дублирование
  const paramSection = text.match(/Используемые параметры на проекте:[\s\S]+?(?=(\n\s*\n|$))/gi);
  if (paramSection) {
    const params = paramSection[0].match(/"([^"]+)"/g);
    if (params && params.length > 0) {
      const uniqueParams = [...new Set(params)];
      if (uniqueParams.length !== params.length) {
        record('Непротиворечивость',
          'Обнаружены дублирующиеся параметры в описании',
          text.indexOf(paramSection[0]));
      }
    }
  }

  // 4. Недвусмысленность
  patterns.ambiguityWords.forEach(w => {
    const re = new RegExp(`\\b${w}\\b`, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      record('Недвусмысленность',
        `Расплывчатая фраза "${w}". Уточните конкретный параметр.`,
        m.index);
    }
  });

  // аббревиатуры без расшифровки
  const acronyms = doc.match('#Acronym').out('array');
  acronyms.forEach(abbr => {
    if (/^[A-ZА-ЯЁ]{2,}$/.test(abbr) &&
      !['API', 'HTTP', 'JSON', 'XML', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'M', 'PWA', 'DA', 'D'].includes(abbr)) {
      const idx = text.indexOf(abbr);
      record('Недвусмысленность',
        `Аббревиатура "${abbr}" без расшифровки. Добавьте определение.`,
        idx);
    }
  });

  // 5. Выполнимость
  patterns.feasibility.forEach(p => {
    let m;
    while ((m = p.regex.exec(text)) !== null) {
      record('Выполнимость', p.message, m.index);
    }
  });

  // Проверка API
  let m;
  const apiRule = patterns.apiPatterns[0];
  while ((m = apiRule.regex.exec(text)) !== null) {
    const url = m[0];
    const pos = m.index;
    const prefix = text.slice(Math.max(0, pos - 20), pos);

    // 1) если перед URL явно указан HTTP‑метод — пропускаем
    if (/\b(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*$/.test(prefix)) {
      continue;
    }
    // 2) если перед URL стоит "Метод N:" — пропускаем
    if (/\bМетод\s*\d+\s*:\s*$/.test(prefix)) {
      continue;
    }

    // остальная валидация (двойной слэш, отсутствие метода и т.п.)
    const error = apiRule.validator(url);
    if (error) {
      record('Корректность API', error, pos);
    }
  }
  // 5. Проверка «голых» REST‑URL без явного HTTP‑метода или «Метод N:»
  {
    const apiUrlRe = /\/rest\/[^\s]+/g;
    let m;
    while ((m = apiUrlRe.exec(text)) !== null) {
      const url = m[0];
      const pos = m.index;
      // захватим контекст 20 символов до и 10 после URL
      const ctxStart = Math.max(0, pos - 20);
      const ctxEnd = Math.min(text.length, pos + url.length + 10);
      const ctx = text.slice(ctxStart, ctxEnd);

      // если перед "/rest/" есть HTTP‑метод — пропускаем
      if (/(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\/rest\//i.test(ctx)) {
        continue;
      }
      // все остальные — действительно «REST‑метод без указания HTTP‑метода»
      const error = patterns.apiPatterns[0].validator(url);
      if (error) {
        record('Корректность API', error, pos);
      }
    }
  }

  // Проверка мобильных требований
  let mobileMatch;
  while ((mobileMatch = patterns.mobilePatterns[0].regex.exec(text)) !== null) {
    const error = patterns.mobilePatterns[0].validator(mobileMatch[0]);
    if (error) record('Мобильные требования', error, mobileMatch.index);
  }

  // 6. Обязательность
  doc.match('желательно').forEach(m => {
    const str = m.text();
    const idx = text.indexOf(str);
    record('Обязательность',
      'Слово "желательно" указывает на опциональность. Проверьте необходимость.',
      idx);
  });

  // 7. Корректность и проверяемость
  const hasNumbers = /\b\d+\b/.test(text);
  const hasMeasurable = /(\d+\s*%|\d+\s*(сек|мин|час|мс)|responseTime|timeout)/i.test(text);
  if (!hasNumbers || !hasMeasurable) {
    record('Корректность',
      hasNumbers ? 'Нет измеримых критериев (таймауты, лимиты)' : 'Нет числовых параметров',
      0);
  }

  // Проверка HTTP-статусов
  patterns.httpPatterns.forEach(p => {
    let httpMatch;
    while ((httpMatch = p.regex.exec(text)) !== null) {
      record('Корректность API', p.message, httpMatch.index);
    }
  });

  // Проверка ссылок на рисунки
  const figureRefs = text.match(/рис\.\s*\d+/gi) || [];
  const figureDefs = text.match(/Рис\.\s*\d+/gi) || [];
  if (figureRefs.length !== figureDefs.length) {
    record('Завершенность',
      `Несоответствие ссылок на рисунки (ссылок: ${figureRefs.length}, определений: ${figureDefs.length})`,
      text.indexOf(figureRefs[0] || figureDefs[0] || ''));
  }

  // сбор статистики
  const stats = {
    total: issues.length,
    byCategory: issues.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {})
  };
  console.log('Итоговая статистика:', stats);

  return { issues, stats };
}