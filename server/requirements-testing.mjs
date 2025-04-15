/**
 * Расширенный анализатор требований по свойствам качества
 * @param {Object} data - Объект с данными для анализа
 * @param {string} data.text - Текст требований
 * @param {boolean} [data.useDeepseek=false] - Флаг для вызова рекомендаций от deepseek
 * @returns {Object} Результаты анализа
 */
export function analyzeSolution(data) {
    if (!data || typeof data.text !== 'string') {
        throw new Error('Неверный формат данных: ожидается объект с полем "text".');
    }

    // Нормализация текста: удаляем лишние пробелы, приводим к единому формату
    const text = data.text.replace(/\s+/g, ' ').trim();
    const issues = [];
    let match;

    // 1. Завершённость ========================================================
    // 1.1. Неполные перечисления
    const incompleteEnumerations = [
        { pattern: /и т\.д\./gi, message: 'Неполное перечисление ("и т.д.")' },
        { pattern: /и т\.п\./gi, message: 'Неполное перечисление ("и т.п.")' },
        { pattern: /и др\./gi, message: 'Неполное перечисление ("и др.")' },
        { pattern: /и другие/gi, message: 'Неполное перечисление ("и другие")' },
        { pattern: /и прочие/gi, message: 'Неполное перечисление ("и прочие")' }
    ];

    incompleteEnumerations.forEach(item => {
        while ((match = item.pattern.exec(text)) !== null) {
            issues.push(createIssue(
                'Завершённость',
                `${item.message}. Уточните полный перечень.`,
                match.index,
                text
            ));
        }
    });

    // 1.2. Отсутствие деталей в критичных требованиях
    const completenessPatterns = [
        {
            trigger: /парол(ь|и|ей).*?(хранить|хранятся|хранение)/gi,
            required: /алгоритм.*?(шифрован|криптограф|aes|rsa|sha)/gi,
            message: 'Укажите алгоритм шифрования для хранения паролей'
        },
        {
            trigger: /формат(ы|ах|ов).*(экспорт|импорт|сохранен)/gi,
            required: /(pdf|png|jpeg|json|xml|csv)/gi,
            message: 'Уточните конкретные форматы файлов'
        },
        {
            trigger: /(ограничен|лимит).*(количество|число)/gi,
            required: /\d+/,
            message: 'Укажите конкретные числовые ограничения'
        }
    ];

    completenessPatterns.forEach(item => {
        if (item.trigger.test(text) && !item.required.test(text)) {
            const index = text.search(item.trigger);
            issues.push(createIssue(
                'Завершённость',
                item.message,
                index,
                text
            ));
        }
    });

    // 1.3. Проверка CRUD
    const crudCheck = /(создан|чтение|обновл|удален|create|read|update|delete)/gi;
    const hasCrud = crudCheck.test(text);
    const hasFullCrud = /(создан.*?чтение.*?обновл.*?удален)|(create.*?read.*?update.*?delete)/gis.test(text);

    if (hasCrud && !hasFullCrud && !text.match(/переход|виджет|настраивать|отображение|фильтр/i)) {
        issues.push(createIssue(
            'Завершённость',
            'Обнаружены не все CRUD-операции. Проверьте наличие всех необходимых: создание, чтение, обновление, удаление.',
            0,
            text
        ));
    }

    // 1.4. Проверка условий "если-то"
    const ifThenPattern = /если\s*?(.*?)\s*?(?:то|-)\s*?(.*?)(?=\n|$|\.|;)/gis;
    const conditions = [];

    while ((match = ifThenPattern.exec(text)) !== null) {
        const condition = match[1].trim();
        const result = match[2].trim();

        // Проверка на пустые/неполные условия
        if (!condition || !result) {
            issues.push(createIssue(
                'Завершённость',
                'Неполное условие "если-то". Уточните и условие, и результат.',
                match.index,
                text
            ));
        }

        // Проверка на расплывчатые условия
        if (/(что-то|какие-то|некоторые|такой момент|момент)/i.test(condition)) {
            issues.push(createIssue(
                'Недвусмысленность',
                `Расплывчатое условие в конструкции "если-то": "${condition}". Уточните конкретные условия.`,
                match.index,
                text
            ));
        }

        conditions.push({ condition, result, index: match.index });
    }

    // 1.5. Проверка таблицы решений
    if (conditions.length > 3 && !text.match(/таблица решений/i)) {
        issues.push(createIssue(
            'Завершённость',
            `Обнаружено ${conditions.length} условий "если-то". Рассмотрите возможность использования таблицы решений для сложной логики.`,
            conditions[0].index,
            text
        ));
    }

    // 1.6. Проверка негативных сценариев
    if (!text.match(/ошибк|отказ|исключение|граничн|заглушка/i)) {
        issues.push(createIssue(
            'Завершённость',
            'Не описаны негативные сценарии или граничные условия. Уточните возможные ошибки или отказы.',
            0,
            text
        ));
    }

    // 2. Атомарность =========================================================
    // 2.1. Союзы в требованиях
    const conjunctionPattern = /(и|или|а также|, а|, но)/gi;
    const sentences = text.split(/[.!?]\s+/);

    sentences.forEach(sentence => {
        const conjMatches = sentence.match(conjunctionPattern);
        if (conjMatches && conjMatches.length > 1) {
            if (sentence.match(/переход.*?(и|или).*?без/i) ||
                sentence.match(/настраивать.*?(и|или).*?отображение/i) ||
                sentence.match(/фильтровать.*?(и|или).*?наличию/i) ||
                sentence.match(/отображать.*?(и|или).*?процессы/i) ||
                sentence.match(/группирован.*?(и|или).*?(таб|аккордеон)/i) ||
                sentence.match(/ошибк.*?(и|или).*?отсутстви/i)) {
                return; // Пропускаем единые процессы
            }
            const index = text.indexOf(sentence);
            issues.push(createIssue(
                'Атомарность',
                'Требование содержит несколько союзов, что может указывать на объединение нескольких требований в одном. Разбейте на отдельные требования.',
                index,
                text
            ));
        }
    });

    // 2.2. Множественные условия
    const multiConditionPattern = /(если|когда|при условии).*?(и|или).*?(?:то|-)/gi;
    while ((match = multiConditionPattern.exec(text)) !== null) {
        issues.push(createIssue(
            'Атомарность',
            'Требование содержит несколько условий. Разбейте на отдельные требования для каждого условия.',
            match.index,
            text
        ));
    }

    // 3. Непротиворечивость =================================================
    // 3.1. Противоречивые утверждения
    const contradictions = [
        {
            pattern: /(должен|обязательно).*?(не должен|запрещено)/gi,
            message: 'Обнаружено противоречивое требование: одновременно указаны обязательность и запрет'
        },
        {
            pattern: /(включить|активен).*?(выключить|неактивен)/gi,
            message: 'Обнаружено противоречие между включением и выключением'
        },
        {
            pattern: /(обязательно|должен).*?(опционально|может)/gi,
            message: 'Обнаружено противоречие между обязательным и опциональным'
        }
    ];

    contradictions.forEach(item => {
        while ((match = item.pattern.exec(text)) !== null) {
            issues.push(createIssue(
                'Непротиворечивость',
                item.message,
                match.index,
                text
            ));
        }
    });

    // 3.2. Проверка согласованности терминов
    const terms = extractTerms(text);
    const inconsistentTerms = checkTermConsistency(terms);

    inconsistentTerms.forEach(term => {
        issues.push(createIssue(
            'Непротиворечивость',
            `Обнаружены различные варианты написания термина: "${term.term}" (варианты: ${term.variants.join(', ')})`,
            term.index,
            text
        ));
    });

    // 3.3. Проверка противоречий между требованиями
    const requirementObjects = text.matchAll(/ТР-\d+\.\s+.*?[.!?]/g);
    const objectsMap = new Map();

    for (const req of requirementObjects) {
        const reqText = req[0];
        const objMatch = reqText.match(/(заявк|виджет|процесс|документ|окно)\s+(\w+)/i);
        if (objMatch) {
            const obj = objMatch[2];
            if (!objectsMap.has(obj)) {
                objectsMap.set(obj, []);
            }
            objectsMap.get(obj).push(reqText);
        }
    }

    for (const [obj, reqs] of objectsMap) {
        if (reqs.length > 1) {
            const hasConflict = reqs.some((r1, i) =>
                reqs.slice(i + 1).some(r2 => r1.match(/должен|обязательно/i) && r2.match(/не должен|запрещено/i))
            );
            if (hasConflict) {
                issues.push(createIssue(
                    'Непротиворечивость',
                    `Обнаружено противоречие между требованиями для объекта "${obj}". Проверьте согласованность.`,
                    text.indexOf(reqs[0]),
                    text
                ));
            }
        }
    }

    // 4. Недвусмысленность ===================================================
    // 4.1. Расплывчатые формулировки
    const ambiguousPhrases = [
        'адекватно', 'красиво', 'быть способным', 'легко', 'как минимум',
        'эффективно', 'своевременно', 'применимо', 'если возможно',
        'будет определено позже', 'по мере необходимости', 'если это целесообразно',
        'но не ограничиваясь', 'иметь возможность', 'нормально', 'минимизировать',
        'максимизировать', 'оптимизировать', 'быстро', 'удобно', 'просто',
        'часто', 'обычно', 'большой', 'гибкий', 'устойчивый', 'по последнему слову техники',
        'улучшенный', 'результативно', 'значительный', 'существенный', 'некоторый',
        'достаточно', 'в разумные сроки', 'при необходимости', 'при наличии возможности',
        'такой момент', 'момент', 'режем', 'по аналогии',
        // Добавленные неоднозначные формулировки из требований
        'если они есть',
        'желательно',
        'возможно, стоит',
        'без счётчика'
    ];

    ambiguousPhrases.forEach(phrase => {
        // Экранируем специальные символы в фразе
        const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|\\W)${escapedPhrase}(?=\\W|$)`, 'gi');

        while ((match = pattern.exec(text)) !== null) {
            issues.push(createIssue(
                'Недвусмысленность',
                `Обнаружена расплывчатая формулировка: "${phrase}". Уточните конкретные параметры.`,
                match.index,
                text
            ));
        }
    });

    // Дополнительная проверка для фразы "кодом, отличным от 200"
    const not200Pattern = /кодом,?\s*отличным\s*от\s*200/gi;
    while ((match = not200Pattern.exec(text)) !== null) {
        issues.push(createIssue(
            'Недвусмысленность',
            'Формулировка "с кодом, отличным от 200" неясна. Укажите явно возможные коды ошибок или их диапазон.',
            match.index,
            text
        ));
    }

    // 4.2. Аббревиатуры без расшифровки
    const abbreviationPattern = /\b([А-ЯA-Z]{2,})\b(?!\s*[—-]\s*[А-ЯA-Z])/g;
    const definedAbbreviations = [];

    const abbreviationDefinitions = text.match(/[А-ЯA-Z]{2,}\s*[—-]\s*.+?(?=\n|$|\.|;)/gi) || [];
    abbreviationDefinitions.forEach(def => {
        const abbr = def.match(/[А-ЯA-Z]{2,}/i)[0];
        definedAbbreviations.push(abbr.toLowerCase());
    });

    while ((match = abbreviationPattern.exec(text)) !== null) {
        const abbr = match[1];
        const wellKnown = ['API', 'UI', 'UX', 'HTTP', 'HTTPS', 'SQL', 'PDF', 'PNG', 'JSON', 'XML', 'POST', 'GET', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'REST'];

        if (!wellKnown.includes(abbr) &&
            !definedAbbreviations.includes(abbr.toLowerCase()) &&
            text.indexOf(`${abbr} `) !== text.lastIndexOf(`${abbr} `) &&
            !abbr.match(/ТР-\d+/)) {
            issues.push(createIssue(
                'Недвусмысленность',
                `Аббревиатура "${abbr}" используется без расшифровки. Укажите расшифровку при первом упоминании.`,
                match.index,
                text
            ));
        }
    }

    // 5. Выполнимость ========================================================
    // 5.1. Технически сложные требования
    const complexTechPatterns = [
        { pattern: /(искусственн\w* интеллект|AI\b|нейросет\w*|машинн\w* обучен)/gi, message: 'Требование с ИИ может быть сложно реализуемым' },
        { pattern: /(распознаван\w* жестов|3D\s*ввод|тр[её]хмерн\w*)/gi, message: 'Требование с 3D-вводом может быть сложно реализуемым' },
        { pattern: /(реал\w* врем\w*|мгновенн\w* реакц)/gi, message: 'Требование реального времени может быть сложно реализуемым' },
        { pattern: /(все возможные варианты|все случаи|любые условия)/gi, message: 'Абсолютная полнота покрытия может быть недостижима' }
    ];

    complexTechPatterns.forEach(item => {
        while ((match = item.pattern.exec(text)) !== null) {
            issues.push(createIssue(
                'Выполнимость',
                item.message,
                match.index,
                text
            ));
        }
    });

    // 5.2. Требования к пользователю
    const userRequirementsPattern = /пользователь должен (.*?)(?=\n|$|\.|;)/gi;
    while ((match = userRequirementsPattern.exec(text)) !== null) {
        issues.push(createIssue(
            'Выполнимость',
            'Требование предписывает действия пользователю, а не системе. Переформулируйте как требование к системе.',
            match.index,
            text
        ));
    }

    // 6. Обязательность ======================================================
    // 6.1. Необязательные формулировки
    const optionalPatterns = [
        { pattern: /на всякий случай/gi, message: 'Требование добавлено "на всякий случай" - проверьте его необходимость' },
        { pattern: /не очень важн\w*/gi, message: 'Требование помечено как "не очень важное" - проверьте его актуальность' },
        { pattern: /если будет время/gi, message: 'Требование с условием "если будет время" - проверьте его приоритет' },
        { pattern: /в будущем релизе/gi, message: 'Требование отложено на будущее - проверьте его актуальность для текущей версии' },
        // Добавленные проверки для опциональных формулировок
        { pattern: /\bжелательно\b/gi, message: 'Требование сформулировано как рекомендация ("желательно"). Проверьте, должно ли оно быть обязательным.' },
        { pattern: /\bвозможно,?\s+стоит\b/gi, message: 'Требование содержит предположение ("возможно, стоит"). Проверьте его обязательность.' }
    ];

    optionalPatterns.forEach(item => {
        while ((match = item.pattern.exec(text)) !== null) {
            issues.push(createIssue(
                'Обязательность',
                item.message,
                match.index,
                text
            ));
        }
    });

    // 7. Корректность и проверяемость ========================================
    // 7.1. Критерии приемки
    if (!/(критери\w* приемк|acceptance criteria|тест-кейс)/gi.test(text)) {
        if (!text.match(/переход|отображение|настраивать|виджет|фильтр|группирован/i)) {
            issues.push(createIssue(
                'Корректность и проверяемость',
                'Отсутствуют явные критерии приемки. Добавьте четкие критерии для проверки выполнения требования.',
                0,
                text
            ));
        }
    }

    // 7.2. Измеримые показатели
    const measurablePattern = /(должен\w* составлять|не менее|не более|равен)\s*\d+/gi;
    if (!measurablePattern.test(text) && !text.match(/переход|отображение|настраивать|виджет|фильтр|группирован/i)) {
        issues.push(createIssue(
            'Корректность и проверяемость',
            'Рекомендуется добавить измеримые показатели для ключевых требований (числовые значения, временные рамки и т.д.).',
            0,
            text
        ));
    }

    // 7.3. Опечатки и грамматика
    const typoPatterns = [
        { pattern: /\bопечат\w*/gi, message: 'Возможная опечатка в тексте' },
        { pattern: /\b([а-яa-z]+)\s+\1\b/gi, message: 'Возможно дублирование слова' },
        { pattern: /(?<=[.!?])\s+[а-я]/g, message: 'После точки начинается предложение с маленькой буквы. Проверьте начало.' }
    ];

    typoPatterns.forEach(item => {
        while ((match = item.pattern.exec(text)) !== null) {
            const precedingText = text.substring(0, match.index);
            if (item.message.includes('маленькой буквы') && precedingText.match(/ТР-\d+$/)) {
                continue; // Пропускаем номера требований
            }
            issues.push(createIssue(
                'Корректность и проверяемость',
                item.message,
                match.index,
                text
            ));
        }
    });

    // 8. Дополнительные проверки =============================================
    // 8.1. Проверка на уровень детализации
    const detailLevel = analyzeDetailLevel(text);
    if (detailLevel === 'high') {
        issues.push(createIssue(
            'Корректность',
            'Возможен избыточный уровень детализации для данного типа требований.',
            0,
            text
        ));
    } else if (detailLevel === 'low') {
        issues.push(createIssue(
            'Корректность',
            'Недостаточный уровень детализации требований. Уточните технические детали.',
            0,
            text
        ));
    }

    // 8.2. Проверка структуры требований
    const structureIssues = checkRequirementStructure(text);
    issues.push(...structureIssues);

    // 9. Deepseek рекомендации ===============================================
    let deepseekRecommendations = null;
    if (data.useDeepseek) {
        deepseekRecommendations = {
            note: 'Deepseek: здесь будут рекомендации по улучшению качества требований.',
            suggestions: generateDeepseekSuggestions(issues)
        };
    }

    return {
        issues: issues.sort((a, b) => a.index - b.index),
        stats: generateStats(issues),
        deepseekRecommendations
    };
}

// Вспомогательные функции ===================================================

function createIssue(category, message, index, text) {
    const { fullRequirement, excerpt } = getFullRequirement(text, index);

    return {
        category,
        message,
        index,
        excerpt,
        fullRequirement,
        highlighted: highlightIssue(fullRequirement, index - getRequirementStart(text, index))
    };
}

function getFullRequirement(text, index) {
    const requirementRegex = /(ТР-\d+\..*?)(?=\s*ТР-\d+\.|$)/gs;

    let match;
    while ((match = requirementRegex.exec(text)) !== null) {
        const start = match.index;
        const end = requirementRegex.lastIndex;
        if (index >= start && index <= end) {
            const fullText = match[1]?.trim() || match[0].trim();
            return {
                fullRequirement: fullText,
                excerpt: fullText.length > 100 ? fullText.slice(0, 100) + '...' : fullText
            };
        }
    }

    return {
        fullRequirement: '',
        excerpt: ''
    };
}

function isRequirementBoundary(text, pos, type) {
    const char = text[pos];

    if (type === 'start') {
        if (pos === 0) return true;
        if (/(^|\n)\s*([A-ZА-Я]{0,4}-?\d+)\s*[:.)\]]/.test(text.substring(pos, pos + 10))) {
            return true;
        }
        if (char === '.' && (pos === 0 || text[pos - 1].match(/[a-zа-я]/i))) {
            return true;
        }
        return false;
    }

    if (pos === text.length - 1) return true;
    if (char === '\n') return true;
    if (char === '.') return true;
    if (/(^|\n)\s*([A-ZА-Я]{0,4}-?\d+)\s*[:.)\]]/.test(text.substring(pos, pos + 10))) {
        return true;
    }

    return false;
}

function highlightIssue(text, pos) {
    if (!text || pos < 0 || pos >= text.length) return text;
    return `${text.substring(0, pos)}<mark>${text[pos]}</mark>${text.substring(pos + 1)}`;
}

function getRequirementStart(text, index) {
    let start = index;
    while (start > 0 && !isRequirementBoundary(text, start, 'start')) {
        start--;
    }
    return start;
}

function extractTerms(text) {
    const termPattern = /([А-ЯA-Z][а-яa-z]+(?:\s[А-ЯA-Z][а-яa-z]+)*)/g;
    const terms = [];
    let match;

    while ((match = termPattern.exec(text)) !== null) {
        const term = match[0];
        if (term.split(' ').length > 1) {
            terms.push({
                term: term.toLowerCase(),
                original: term,
                index: match.index
            });
        }
    }

    return terms;
}

function checkTermConsistency(terms) {
    const termMap = {};
    const inconsistent = [];

    terms.forEach(item => {
        if (!termMap[item.term]) {
            termMap[item.term] = {
                term: item.original,
                variants: new Set([item.original]),
                index: item.index
            };
        } else {
            termMap[item.term].variants.add(item.original);
        }
    });

    for (const key in termMap) {
        if (termMap[key].variants.size > 1) {
            inconsistent.push({
                term: termMap[key].term,
                variants: Array.from(termMap[key].variants),
                index: termMap[key].index
            });
        }
    }

    return inconsistent;
}

function analyzeDetailLevel(text) {
    const techWords = ['алгоритм', 'протокол', 'интерфейс', 'API', 'метод', 'функция', 'POST', 'GET', 'PATCH', 'DELETE', 'PUT'];
    const businessWords = ['бизнес', 'процесс', 'пользователь', 'цель', 'результат'];

    const techCount = techWords.reduce((count, word) => {
        const pattern = new RegExp(`\\b${word}\\b`, 'gi');
        return count + (text.match(pattern) || []).length;
    }, 0);

    const businessCount = businessWords.reduce((count, word) => {
        const pattern = new RegExp(`\\b${word}\\b`, 'gi');
        return count + (text.match(pattern) || []).length;
    }, 0);

    if (techCount > businessWords.length * 2) return 'high';
    if (businessCount > techWords.length * 2) return 'low';
    return 'medium';
}

function checkRequirementStructure(text) {
    const issues = [];
    const requirementRegex = /(ТР-\d+\..*?)(?=\s*ТР-\d+\.|$)/gs;
    const allRequirements = [...text.matchAll(requirementRegex)];

    if (allRequirements.length === 0) {
        issues.push(createIssue(
            'Корректность',
            'Рекомендуется добавить уникальные идентификаторы требований (например, "ТР-001", "REQ-1")',
            0,
            text
        ));
        return issues;
    }

    const uniformPattern = /(система|приложение|модуль|окно|виджет|список|таблица)\s+(должен|должна|должно|обеспечивает|предоставляет|необходимо)/i;

    for (const match of allRequirements) {
        const reqText = match[1];
        if (!uniformPattern.test(reqText)) {
            issues.push(createIssue(
                'Корректность',
                `Рекомендуется унифицировать формулировку требования "${reqText.slice(0, 50)}..." (например, "Система должна..." или "Компонент должен...")`,
                match.index,
                text
            ));
        }
    }

    return issues;
}

function generateStats(issues) {
    const stats = {
        total: issues.length,
        byCategory: {}
    };

    issues.forEach(issue => {
        if (!stats.byCategory[issue.category]) {
            stats.byCategory[issue.category] = 0;
        }
        stats.byCategory[issue.category]++;
    });

    return stats;
}

function generateDeepseekSuggestions(issues) {
    const suggestions = [];

    if (issues.some(i => i.category === 'Недвусмысленность')) {
        suggestions.push('Рекомендуется заменить расплывчатые формулировки на конкретные метрики и параметры');
    }

    if (issues.some(i => i.category === 'Завершённость' && i.message.includes('CRUD'))) {
        suggestions.push('Для сложных сущностей рекомендуется явно указать все CRUD-операции');
    }

    if (issues.some(i => i.category === 'Выполнимость')) {
        suggestions.push('Проверьте техническую реализуемость сложных требований с архитектором системы');
    }

    if (issues.some(i => i.category === 'Атомарность')) {
        suggestions.push('Разбейте сложные требования на более простые и независимые для повышения читаемости');
    }

    return suggestions.length > 0 ? suggestions : ['Качество требований в целом соответствует стандартам'];
}
