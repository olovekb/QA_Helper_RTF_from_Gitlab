const DEFAULT_MAX_TEXT = 1200;

function compactText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncateText(value, max = DEFAULT_MAX_TEXT) {
    const text = compactText(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trim()}...`;
}

function uniqueStrings(values) {
    return Array.from(new Set(
        (values || [])
            .map(value => compactText(value))
            .filter(Boolean)
    ));
}

export function collectModelChunkTerms(chunk) {
    const features = [];
    const stories = [];
    const scenarios = [];
    const codes = [];

    for (const feature of Array.isArray(chunk) ? chunk : []) {
        if (feature?.text) features.push(feature.text);
        for (const story of feature?.stories || []) {
            if (story?.text) stories.push(story.text);
            for (const scenario of story?.scenarios || []) {
                if (scenario?.text) scenarios.push(scenario.text);
                for (const code of scenario?.codes || []) {
                    if (code?.text) codes.push(code.text);
                }
            }
        }
    }

    return {
        features: uniqueStrings(features),
        stories: uniqueStrings(stories),
        scenarios: uniqueStrings(scenarios),
        codes: uniqueStrings(codes)
    };
}

export function collectScenarioBranches(chunk) {
    const branches = [];

    for (const feature of Array.isArray(chunk) ? chunk : []) {
        for (const story of feature?.stories || []) {
            for (const scenario of story?.scenarios || []) {
                const branchChunk = [{
                    text: feature?.text || '',
                    stories: [{
                        text: story?.text || '',
                        scenarios: [{
                            ...scenario,
                            codes: Array.isArray(scenario?.codes) ? scenario.codes : []
                        }]
                    }]
                }];

                branches.push({
                    index: branches.length + 1,
                    refPrefix: `S${branches.length + 1}-EV`,
                    feature: compactText(feature?.text),
                    story: compactText(story?.text),
                    scenario: compactText(scenario?.text),
                    codes: uniqueStrings((scenario?.codes || []).map(code => code?.text)),
                    chunk: branchChunk
                });
            }
        }
    }

    return branches;
}

export function buildEvidenceRetrievalQueries(chunk, options = {}) {
    const {
        includeBackendTests = true,
        maxScenarios = 8,
        maxCodes = 12
    } = options;
    const terms = collectModelChunkTerms(chunk);
    const baseParts = [
        terms.features.length ? `Feature: ${terms.features.join('; ')}` : '',
        terms.stories.length ? `Story: ${terms.stories.join('; ')}` : '',
        terms.scenarios.length ? `Scenarios: ${terms.scenarios.slice(0, maxScenarios).join('; ')}` : '',
        terms.codes.length ? `Code actions: ${terms.codes.slice(0, maxCodes).join('; ')}` : ''
    ].filter(Boolean);

    const base = baseParts.join('\n');
    const queries = [
        {
            layer: 'common',
            query: `${base}\nBusiness rules, validations, edge cases, user-visible behavior, expected result`.trim()
        },
        {
            layer: 'frontend',
            query: `${base}\nUI rules, fields, buttons, messages, validation errors, visibility, mocks for API responses`.trim()
        }
    ];

    if (includeBackendTests) {
        queries.push({
            layer: 'backend',
            query: `${base}\nAPI contract, endpoint, request body, response body, status codes, JSON, backend errors`.trim()
        });
    }

    return queries.filter(item => item.query);
}

export function classifyEvidenceType(raw = {}) {
    const chunkType = String(raw.chunk_type || raw.chunkType || raw.type || '').toLowerCase();
    const retrievalClass = String(raw.retrieval_class || raw.retrievalClass || '').toLowerCase();
    const text = String(raw.content || raw.text || raw.embedding_text || '').toLowerCase();
    const combined = `${chunkType} ${retrievalClass} ${text}`;

    if (/api|endpoint|request|response|json|http|rest|post|get|put|delete|patch|status\s*code|\/api|\/rest/.test(combined)) {
        return 'api_contract';
    }
    if (/error|exception|ошиб|400|401|403|404|409|422|500|timeout|таймаут/.test(combined)) {
        return 'error_rule';
    }
    if (/valid|validation|boundary|min|max|required|обязател|валидац|границ|миним|максим/.test(combined)) {
        return 'validation_rule';
    }
    if (/ui|button|field|modal|screen|form|display|visible|hidden|кнопк|поле|модал|экран|форма|отображ|скрыв/.test(combined)) {
        return 'ui_rule';
    }
    return 'business_rule';
}

export function makeEvidenceItem(raw, options = {}) {
    const {
        fallbackId,
        source = 'unknown',
        sourceTitle = '',
        maxText = DEFAULT_MAX_TEXT
    } = options;
    const text = raw?.content || raw?.text || raw?.embedding_text || raw?.cleaned_text || '';
    const id = compactText(raw?.id || raw?.chunkId || fallbackId);

    return {
        id,
        type: classifyEvidenceType(raw),
        source,
        sourceTitle: compactText(raw?.doc_title || raw?.sourceTitle || sourceTitle),
        heading: compactText(raw?.heading || raw?.metadata?.heading || ''),
        score: Number.isFinite(Number(raw?.score)) ? Number(raw.score) : null,
        text: truncateText(text, maxText)
    };
}

function evidenceKey(item) {
    const source = compactText(item?.source).toLowerCase();
    const id = compactText(item?.id).toLowerCase();
    if (source && id) return `${source}:${id}`;
    return compactText(item?.text).toLowerCase().slice(0, 220);
}

export function mergeEvidenceItems(items, options = {}) {
    const { maxItems = 12 } = options;
    const byKey = new Map();

    for (const item of items || []) {
        if (!item?.text) continue;
        const key = evidenceKey(item);
        if (!key) continue;
        const existing = byKey.get(key);
        if (!existing || Number(item.score || 0) > Number(existing.score || 0)) {
            byKey.set(key, item);
        }
    }

    return Array.from(byKey.values())
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, maxItems);
}

export function buildKeywordEvidenceItems(relevantRequirements, options = {}) {
    const {
        source = 'keyword-requirements',
        sourceTitle = 'Relevant requirements',
        maxItems = 8,
        maxText = DEFAULT_MAX_TEXT
    } = options;

    return (relevantRequirements || [])
        .filter(Boolean)
        .slice(0, maxItems)
        .map((text, index) => makeEvidenceItem(
            { id: `REQ-KW-${index + 1}`, text, type: 'requirement' },
            { source, sourceTitle, maxText }
        ));
}

export function createEvidencePack({ chunk, semanticItems = [], keywordItems = [], includeBackendTests = true, refPrefix = 'EV', maxItems = 14 } = {}) {
    const terms = collectModelChunkTerms(chunk);
    const normalizedPrefix = compactText(refPrefix) || 'EV';
    const items = mergeEvidenceItems([...semanticItems, ...keywordItems], { maxItems })
        .map((item, index) => ({
            ...item,
            originalId: item.id,
            id: `${normalizedPrefix}-${index + 1}`
        }));
    return {
        terms,
        includeBackendTests,
        items,
        evidenceRefs: items.map(item => item.id).filter(Boolean)
    };
}

export function combineEvidencePacks(packs = []) {
    const items = packs.flatMap(pack => Array.isArray(pack?.items) ? pack.items : []);
    return {
        terms: {},
        includeBackendTests: packs.some(pack => pack?.includeBackendTests),
        items,
        evidenceRefs: uniqueStrings(items.map(item => item?.id))
    };
}

export function normalizeEvidenceRefs(refs, evidencePack) {
    const allowed = new Set((evidencePack?.evidenceRefs || []).map(String));
    if (!allowed.size) return [];
    return uniqueStrings(refs).filter(ref => allowed.has(ref));
}

export function formatEvidencePackForPrompt(evidencePack) {
    const items = evidencePack?.items || [];
    if (!items.length) {
        return [
            'EVIDENCE PACK:',
            'No specific evidence snippets were retrieved. Use the relevant requirements below and do not invent APIs, statuses, UI elements, or data shapes.'
        ].join('\n');
    }

    const lines = [
        'EVIDENCE PACK:',
        'Use these snippets as the source of truth for steps, expected results, API details, validations, and error cases.',
        'Every generated test case should include evidenceRefs with one or more IDs from this list.',
        'If an API contract is absent from the evidence, do not invent backend endpoint details.',
        ''
    ];

    for (const item of items) {
        const score = Number.isFinite(item.score) ? ` score=${item.score.toFixed(3)}` : '';
        const heading = item.heading ? ` | ${item.heading}` : '';
        const source = item.sourceTitle || item.source || 'source';
        lines.push(`[${item.id}] type=${item.type}${score} | ${source}${heading}`);
        lines.push(item.text);
        lines.push('');
    }

    return lines.join('\n').trim();
}

export function formatScenarioEvidenceMapForPrompt(scenarioEvidencePacks = []) {
    const entries = scenarioEvidencePacks.filter(entry => entry?.branch?.scenario);
    if (!entries.length) {
        return formatEvidencePackForPrompt({ items: [] });
    }

    const lines = [
        'SCENARIO EVIDENCE MAP:',
        'Before generating a test case, match it to the exact Scenario below and use that Scenario evidence as the source of truth.',
        'Each generated test case must include evidenceRefs from the same Scenario block.',
        'If a Scenario block has no API contract evidence, do not create Integration backend test details for that Scenario.',
        'If a Scenario block has no UI rule evidence, do not invent buttons, fields, messages, or screens.',
        ''
    ];

    for (const entry of entries) {
        const { branch, pack } = entry;
        const items = pack?.items || [];
        lines.push(`Scenario ${branch.index}: ${branch.scenario}`);
        lines.push(`Feature: ${branch.feature || '-'}`);
        lines.push(`Story: ${branch.story || '-'}`);
        if (branch.codes?.length) {
            lines.push(`Code actions: ${branch.codes.join('; ')}`);
        }

        if (!items.length) {
            lines.push('Evidence: not found. Use only model wording and relevant requirements below; do not invent concrete API/UI details.');
            lines.push('');
            continue;
        }

        for (const item of items) {
            const score = Number.isFinite(item.score) ? ` score=${item.score.toFixed(3)}` : '';
            const heading = item.heading ? ` | ${item.heading}` : '';
            const source = item.sourceTitle || item.source || 'source';
            lines.push(`[${item.id}] type=${item.type}${score} | ${source}${heading}`);
            lines.push(item.text);
        }
        lines.push('');
    }

    return lines.join('\n').trim();
}
