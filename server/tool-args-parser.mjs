import JSON5 from 'json5';

const ARRAY_ARGUMENT_BY_TOOL_NAME = {
    submit_test_model: 'model',
    submit_cases: 'cases',
    submit_fixed_codes: 'codes'
};

function parseJsonLike(candidate) {
    const text = String(candidate || '').trim();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return JSON5.parse(text);
    }
}

function unwrapInlineToolCall(parsed, preferredFnName = '') {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return parsed;
    }

    if (!parsed.name || parsed.arguments == null) {
        return parsed;
    }

    if (preferredFnName && parsed.name !== preferredFnName) {
        return parsed;
    }

    if (typeof parsed.arguments === 'string') {
        return parseJsonLike(parsed.arguments);
    }

    return parsed.arguments;
}

function wrapArrayForTool(parsed, preferredFnName = '') {
    if (!Array.isArray(parsed)) {
        return parsed;
    }

    const argumentName = ARRAY_ARGUMENT_BY_TOOL_NAME[preferredFnName];
    return argumentName ? { [argumentName]: parsed } : parsed;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBalancedJsonSlice(text, startIndex, openChar, closeChar) {
    let depth = 0;
    let quote = '';
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
        const char = text[i];

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === openChar) {
            depth++;
        } else if (char === closeChar) {
            depth--;
            if (depth === 0) {
                return text.slice(startIndex, i + 1);
            }
        }
    }

    return null;
}

function salvageArrayArgumentFromMalformedContent(rawContent, preferredFnName = '') {
    const argumentName = ARRAY_ARGUMENT_BY_TOOL_NAME[preferredFnName];
    if (!argumentName) {
        return null;
    }

    const text = String(rawContent || '');
    const propertyRegex = new RegExp(`["']${escapeRegExp(argumentName)}["']\\s*:\\s*\\[`, 'gi');
    let match;

    while ((match = propertyRegex.exec(text)) !== null) {
        const arrayStart = text.indexOf('[', match.index);
        if (arrayStart === -1) {
            continue;
        }

        const arrayCandidate = extractBalancedJsonSlice(text, arrayStart, '[', ']');
        if (!arrayCandidate) {
            continue;
        }

        try {
            const parsedArray = parseJsonLike(arrayCandidate);
            if (Array.isArray(parsedArray)) {
                return { [argumentName]: parsedArray };
            }
        } catch {
            // Keep scanning: another property with the same name may be valid.
        }
    }

    return null;
}

function collectJsonCandidates(rawContent) {
    const text = String(rawContent || '').trim();
    if (!text) {
        return [];
    }

    const candidates = [];
    const pushCandidate = (candidate) => {
        const trimmed = String(candidate || '').trim();
        if (trimmed && !candidates.includes(trimmed)) {
            candidates.push(trimmed);
        }
    };

    const toolBlockMatch = text.match(/<tool_call>\s*([\s\S]+?)\s*<\/tool_call>/i);
    if (toolBlockMatch?.[1]) {
        pushCandidate(toolBlockMatch[1]);
    }

    const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let fencedMatch;
    while ((fencedMatch = fencedRegex.exec(text)) !== null) {
        pushCandidate(fencedMatch[1]);
    }

    pushCandidate(text);

    const firstArrayBracket = text.indexOf('[');
    const lastArrayBracket = text.lastIndexOf(']');
    if (firstArrayBracket !== -1 && lastArrayBracket > firstArrayBracket) {
        pushCandidate(text.slice(firstArrayBracket, lastArrayBracket + 1));
    }

    const firstObjectBrace = text.indexOf('{');
    const lastObjectBrace = text.lastIndexOf('}');
    if (firstObjectBrace !== -1 && lastObjectBrace > firstObjectBrace) {
        pushCandidate(text.slice(firstObjectBrace, lastObjectBrace + 1));
    }

    return candidates;
}

export function parseToolArgsContent(rawContent, preferredFnName = '') {
    for (const candidate of collectJsonCandidates(rawContent)) {
        try {
            const parsed = parseJsonLike(candidate);
            const unwrapped = unwrapInlineToolCall(parsed, preferredFnName);
            return wrapArrayForTool(unwrapped, preferredFnName);
        } catch {
            // Try the next candidate. LLM responses often include prose around JSON.
        }
    }

    return salvageArrayArgumentFromMalformedContent(rawContent, preferredFnName);
}

export function coerceModelArrayFromToolArgs(args) {
    if (!args) return null;

    if (Array.isArray(args)) {
        return args;
    }

    let modelSource = args.model ?? args.features;

    if (!modelSource && args.id && args.text && Array.isArray(args.stories)) {
        modelSource = [args];
    }

    if (Array.isArray(modelSource)) {
        return modelSource;
    }

    if (typeof modelSource === 'object' && modelSource !== null) {
        if (Array.isArray(modelSource.items)) {
            return modelSource.items;
        }
        if (Array.isArray(modelSource.model)) {
            return modelSource.model;
        }
        if (Array.isArray(modelSource.features)) {
            return modelSource.features;
        }
    }

    if (typeof modelSource === 'string') {
        const parsed = JSON5.parse(modelSource);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.items)) return parsed.items;
        if (parsed && Array.isArray(parsed.model)) return parsed.model;
        if (parsed && Array.isArray(parsed.features)) return parsed.features;
    }

    return null;
}
