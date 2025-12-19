// post-processors/aggregate-to-parametrized.js
import { v4 as uuidv4 } from 'uuid';

/**
 * Объединяет дублирующиеся тесты в параметризованные
 */
export function aggregateToParametrized(testCases) {
    // E2E не трогаем
    const e2e = testCases.filter(tc => tc.layer === 'E2E Tests');
    const integration = testCases.filter(tc => tc.layer !== 'E2E Tests');
    
    const groups = new Map();
    
    for (const tc of integration) {
        const signature = computeSignature(tc);
        if (!groups.has(signature)) {
            groups.set(signature, []);
        }
        groups.get(signature).push(tc);
    }
    
    const aggregated = [];
    
    for (const [sig, group] of groups) {
        if (group.length >= 2 && canMerge(group)) {
            console.log(`[aggregator] Объединяю ${group.length} тестов: ${group.map(t => t.title).join(', ')}`);
            aggregated.push(mergeToParametrized(group));
        } else {
            aggregated.push(...group);
        }
    }
    
    return [...e2e, ...aggregated];
}

function computeSignature(tc) {
    const normalizedSteps = (tc.steps || []).map(s => {
        const text = typeof s === 'string' ? s : (s.text || '');
        return text
            .replace(/\d+/g, '{{NUM}}')
            .replace(/"[^"]*"/g, '{{STR}}')
            .replace(/'[^']*'/g, '{{STR}}')
            .replace(/\{\{[^}]+\}\}/g, '{{PARAM}}')
            .toLowerCase()
            .trim();
    }).join('||');
    
    return `${tc.layer}::${tc.feature}::${tc.story}::${tc.scenario || ''}::${normalizedSteps}`;
}

function canMerge(group) {
    const first = group[0];
    return group.every(tc => 
        tc.steps?.length === first.steps?.length &&
        tc.layer === first.layer
    );
}

function mergeToParametrized(group) {
    const base = JSON.parse(JSON.stringify(group[0]));
    
    // Находим различия
    const differences = findDifferences(group);
    
    if (differences.length === 0) {
        // Нет различий - просто возвращаем первый
        return base;
    }
    
    // Обобщаем title
    base.title = generalizeTitle(group.map(tc => tc.title));
    base.id = uuidv4();
    
    // Создаём parameters
    base.parameters = differences.map(diff => ({
        name: diff.name,
        values: diff.values
    }));
    
    // Создаём examples
    base.examples = group.map((tc, idx) => ({
        parameters: differences.map(diff => ({
            name: diff.name,
            value: diff.values[idx]
        }))
    }));
    
    // Обновляем steps с плейсхолдерами
    base.steps = base.steps.map((step, stepIdx) => {
        let text = typeof step === 'string' ? step : step.text;
        for (const diff of differences) {
            if (diff.stepIndex === stepIdx) {
                // Заменяем первое значение на плейсхолдер
                text = text.replace(diff.values[0], `{{${diff.name}}}`);
            }
        }
        return typeof step === 'string' ? text : { ...step, text };
    });
    
    return base;
}

function findDifferences(group) {
    const differences = [];
    const first = group[0];
    
    // Ищем различия в steps
    for (let stepIdx = 0; stepIdx < (first.steps?.length || 0); stepIdx++) {
        const stepValues = group.map(tc => {
            const step = tc.steps?.[stepIdx];
            return typeof step === 'string' ? step : step?.text || '';
        });
        
        // Если значения разные
        if (new Set(stepValues).size > 1) {
            // Пытаемся найти отличающуюся часть
            const diff = extractDifferingPart(stepValues);
            if (diff) {
                differences.push({
                    name: diff.name || `Параметр ${differences.length + 1}`,
                    values: diff.values,
                    stepIndex: stepIdx
                });
            }
        }
    }
    
    return differences;
}

function extractDifferingPart(values) {
    // Простая эвристика: ищем числа или строки в кавычках
    const patterns = [
        /(\d+)/,           // числа
        /"([^"]+)"/,       // строки в двойных кавычках
        /'([^']+)'/,       // строки в одинарных кавычках
    ];
    
    for (const pattern of patterns) {
        const extracted = values.map(v => {
            const match = v.match(pattern);
            return match ? match[1] : null;
        });
        
        if (extracted.every(e => e !== null) && new Set(extracted).size > 1) {
            return {
                name: guessParameterName(values[0]),
                values: extracted
            };
        }
    }
    
    return null;
}

function guessParameterName(text) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('сумм')) return 'Сумма';
    if (lowerText.includes('email')) return 'Email';
    if (lowerText.includes('телефон') || lowerText.includes('phone')) return 'Телефон';
    if (lowerText.includes('дат')) return 'Дата';
    return 'Значение';
}

function generalizeTitle(titles) {
    // Берём общую часть из всех заголовков
    const words = titles[0].split(' ');
    const common = words.filter(word => 
        titles.every(t => t.toLowerCase().includes(word.toLowerCase()))
    );
    
    if (common.length > 2) {
        return common.join(' ') + ' (параметризованный)';
    }
    
    return titles[0].replace(/\d+|"[^"]+"|'[^']+'/g, '...') + ' (параметризованный)';
}



