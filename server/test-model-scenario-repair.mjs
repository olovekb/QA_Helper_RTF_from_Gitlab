const GENERIC_FALLBACK_SCENARIO_TEXT = 'Открыть проверяемый раздел интерфейса';

function cleanText(value = '') {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/[.;:]+$/g, '')
        .trim();
}

function lowerFirst(value = '') {
    const text = cleanText(value);
    if (!text) return '';
    return text.charAt(0).toLowerCase() + text.slice(1);
}

function stripScenarioNoise(value = '') {
    return cleanText(value)
        .replace(/^проверка\s+/i, '')
        .replace(/^отображение\s+/i, 'отображения ')
        .replace(/^отображать\s+/i, 'отображения ')
        .replace(/^наличие\s+/i, 'наличия ')
        .replace(/^отсутствие\s+/i, 'отсутствия ')
        .replace(/^раскрытие\s+/i, 'раскрытия ');
}

function pickScenarioSubject(story = {}, codes = []) {
    const storyText = cleanText(story?.text || story?.name || story?.requirement);
    if (storyText) return storyText;

    const codeText = (Array.isArray(codes) ? codes : [])
        .map((code) => cleanText(code?.text || code?.name))
        .find(Boolean);

    return codeText || '';
}

function deriveActionFromExplicitButton(subject = '') {
    const buttonMatch = subject.match(/кнопк[ауеи]\s+['"«“]?([^'"»”]+)['"»”]?/i);
    if (buttonMatch?.[1]) {
        return `Нажать кнопку "${cleanText(buttonMatch[1])}"`;
    }

    const clickMatch = subject.match(/(?:при\s+клике|клик(?:нуть)?|нажать)\s+(?:на\s+)?(.+)/i);
    if (clickMatch?.[1]) {
        const target = cleanText(clickMatch[1])
            .replace(/^идентичн[а-яё]*\s+/i, '')
            .replace(/^кнопк[ауеи]\s+/i, 'кнопку ');
        return target ? `Нажать ${lowerFirst(target)}` : '';
    }

    return '';
}

export function deriveFallbackScenarioText({ story = {}, codes = [] } = {}) {
    const subject = pickScenarioSubject(story, codes);
    const explicitAction = deriveActionFromExplicitButton(subject);
    if (explicitAction) return explicitAction;

    const normalizedSubject = lowerFirst(stripScenarioNoise(subject));
    if (!normalizedSubject) {
        return GENERIC_FALLBACK_SCENARIO_TEXT;
    }

    if (/списк[а-яё]*\s+ведомост/i.test(subject)) {
        return `Открыть список ведомостей для проверки ${normalizedSubject}`;
    }

    if (/просмотр[а-яё]*\s+ведомост/i.test(subject)) {
        return `Открыть страницу просмотра ведомости для проверки ${normalizedSubject}`;
    }

    if (/детальн[а-яё]+\s+информац/i.test(subject)) {
        return `Открыть детальную информацию ведомости для проверки ${normalizedSubject}`;
    }

    return `Открыть экран для проверки ${normalizedSubject}`;
}

export { GENERIC_FALLBACK_SCENARIO_TEXT };
