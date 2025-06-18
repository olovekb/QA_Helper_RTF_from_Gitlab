import nlp from 'compromise';
import nlpNumbers from 'compromise-numbers';
nlp.extend(nlpNumbers);

/**
 * =================================================================
 * Новая архитектура правил: Декларативно и расширяемо
 * =================================================================
 * Каждый объект в массиве rules представляет одно правило проверки.
 * - id: Уникальный идентификатор правила.
 * - category: Категория ошибки (по ISO 29148).
 * - severity: 'critical', 'major', 'minor' – помогает приоритизировать.
 * - message: Шаблон сообщения об ошибке.
 * - check: Функция, выполняющая проверку. Принимает текст, возвращает массив совпадений.
 */
const rules = [
  // --- КАТЕГОРИЯ: ЗАВЕРШЕННОСТЬ (Completeness) ---
  {
    id: 'completeness.tbd',
    category: 'Завершённость',
    severity: 'critical',
    message: 'Требование не завершено. Замените плейсхолдер "[match]" на конкретное значение.',
    check: (text) => text.match(/\b(TBD|TODO|FIXME|XXX|\[уточнить\])\b/gi)
  },
  {
    id: 'completeness.etc',
    category: 'Завершённость',
    severity: 'major',
    message: 'Неполное перечисление. Замените "[match]" на полный список элементов.',
    check: (text) => text.match(/\b(и т\.д\.|и т\.п\.|etc\.)/gi)
  },
  {
    id: 'completeness.no_negative_scenarios',
    category: 'Завершённость',
    severity: 'major',
    message: 'В требованиях отсутствуют описания негативных сценариев или обработки ошибок. Добавьте раздел про поведение системы в случае ошибок.',
    check: (text) => !/\b(error|fail|exception|ошибк|отказ|неуспешн|негативн)/i.test(text) ? [{ match: 'Отсутствие негативных сценариев', index: 0 }] : null
  },
  {
    id: 'completeness.figure_mismatch',
    category: 'Завершённость',
    severity: 'minor',
    message: 'Обнаружено несоответствие ссылок на рисунки (ссылок: [refs], определений: [defs]). Проверьте нумерацию.',
    check: (text) => {
      const refs = (text.match(/рис\.\s*\d+/gi) || []).length;
      const defs = (text.match(/Рис(унок)?\.\s*\d+/gi) || []).length;
      if (refs > 0 && refs !== defs) {
        return [{ match: `(ссылок: ${refs}, определений: ${defs})`, index: text.search(/рис\.\s*\d+/gi) }];
      }
      return null;
    }
  },

  // --- КАТЕГОРИЯ: НЕДВУСМЫСЛЕННОСТЬ (Unambiguity) ---
  {
    id: 'ambiguity.weak_words',
    category: 'Недвусмысленность',
    severity: 'major',
    message: 'Найдено расплывчатое слово "[match]". Замените его на конкретный, измеримый критерий.',
    check: (text) => text.match(/\b(адекватно|быстро|удобно|эффективно|нормально|достаточно|значительно|улучшенный|легко|прозрачно|скоро|максимально|оптимально)\b/gi)
  },
  {
    id: 'ambiguity.unspecified_acronym',
    category: 'Недвусмысленность',
    severity: 'major',
    message: 'Аббревиатура "[match]" используется без предварительной расшифровки. Добавьте полное название при первом упоминании.',
    check: (text) => {
      const KNOWN_ACRONYMS = new Set(['API', 'HTTP', 'JSON', 'XML', 'GET', 'POST', 'PUT', 'DELETE', 'PWA', 'REST']);
      const acronyms = nlp(text).acronyms().out('array').filter(a => !KNOWN_ACRONYMS.has(a));
      // Проверяем, что для акронима нет расшифровки в скобках рядом
      return acronyms.filter(acronym => {
        const regex = new RegExp(`\\b${acronym}\\b\\s*\\(`, 'i');
        return !regex.test(text);
      });
    }
  },
  {
    id: 'ambiguity.passive_voice',
    category: 'Недвусмысленность',
    severity: 'minor',
    message: 'Используется пассивный залог: "[match]". Переформулируйте в активном залоге ("Система должна...") для ясности.',
    check: (text) => text.match(/(будет сделан[ао]?|должен быть|должны быть|была реализована|реализовано|отображается)/gi)
  },

  // --- КАТЕГОРИЯ: АТОМАРНОСТЬ (Atomicity) ---
  {
    id: 'atomicity.multiple_verbs',
    category: 'Атомарность',
    severity: 'major',
    message: 'Предложение содержит несколько действий ("[match]"). Возможно, требование стоит разделить на несколько атомарных.',
    check: (text) => {
      const sentences = nlp(text).sentences().json();
      const issues = [];
      for (const s of sentences) {
        // Проверяем предложения, которые похожи на требования (начинаются с "Система должна", "Пользователь может" и т.д.)
        if (/^(система|пользователь|модуль)/i.test(s.text)) {
          const verbs = nlp(s.text).verbs().out('array');
          if (verbs.length > 2 && s.text.includes(' и ')) {
            issues.push(s.text);
          }
        }
      }
      return issues;
    }
  },

  // --- КАТЕГОРИЯ: КОРРЕКТНОСТЬ И ПРОВЕРЯЕМОСТЬ (Correctness & Verifiability) ---
  {
    id: 'verifiability.not_measurable',
    category: 'Проверяемость',
    severity: 'critical',
    message: 'Неизмеримое требование к качеству: "[match]". Добавьте конкретные цифры (время отклика в мс, нагрузка в RPS и т.д.).',
    check: (text) => {
      // Ищем слова, связанные с производительностью, но без цифр рядом
      const qualityWords = text.match(/\b(производительность|скорость|время отклика|нагрузк[ауи]|быстродействие)\b/gi) || [];
      return qualityWords.filter(word => {
        const index = text.indexOf(word);
        const context = text.substring(index - 30, index + 30);
        return !/\d/.test(context); // Если в контексте нет цифр, это проблема
      });
    }
  },
  {
    id: 'correctness.api_no_method',
    category: 'Корректность API',
    severity: 'major',
    message: 'REST-эндпоинт "[match]" указан без HTTP-метода (GET, POST и т.д.).',
    check: (text) => {
      const urls = text.match(/\/rest\/[^\s,."'()]+/g) || [];
      return urls.filter(url => {
        const index = text.indexOf(url);
        const prefix = text.substring(Math.max(0, index - 10), index);
        return !/\b(GET|POST|PUT|DELETE|PATCH)\s*$/i.test(prefix);
      });
    }
  },
  {
    id: 'correctness.api_200_with_error',
    category: 'Корректность API',
    severity: 'critical',
    message: 'Противоречие в ответе API: успешный статус 200 OK и поле ошибки. Для ошибок должны использоваться статусы 4xx/5xx.',
    check: (text) => text.match(/200 OK\s*\+.*errorCode/gi)
  },
];


/**
 * Основная функция анализа.
 * @param {string} textToAnalyze - Текст требований для анализа.
 * @returns {{ issues: Array }}
 */
export function analyzeRequirements(textToAnalyze) {
  if (!textToAnalyze || typeof textToAnalyze !== 'string') {
    console.error('Ошибка: на вход должна подаваться непустая строка.');
    return { issues: [] };
  }

  const issues = [];

  // Функция для унифицированной записи найденных проблем
  const recordIssue = (rule, match) => {
    const fullMatch = typeof match === 'string' ? match : match.match;
    const index = typeof match === 'string' ? textToAnalyze.indexOf(match) : match.index;

    issues.push({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      message: rule.message.replace('[match]', fullMatch),
      line: textToAnalyze.substring(0, index).split('\n').length,
      excerpt: fullMatch.length > 80 ? fullMatch.substring(0, 80) + '...' : fullMatch
    });
  };

  // Проходим по всем правилам и выполняем их проверки
  for (const rule of rules) {
    try {
      const matches = rule.check(textToAnalyze);
      if (matches && matches.length > 0) {
        matches.forEach(match => recordIssue(rule, match));
      }
    } catch (e) {
      console.error(`Ошибка при выполнении правила "${rule.id}":`, e.message);
    }
  }

  // Сортируем проблемы по серьезности
  const severityOrder = { 'critical': 1, 'major': 2, 'minor': 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { issues };
}