function normalizeRequirementText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function dedupeNormalizedTexts(values) {
    const seen = new Set();
    const result = [];

    for (const value of values) {
        const normalized = normalizeRequirementText(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

export function buildRequirementModelInput({
    requirements,
    baseRequirement,
    text,
    separator = '\n\n---\n\n'
} = {}) {
    const sources = [];

    if (Array.isArray(requirements) && requirements.length) {
        const requirementItems = dedupeNormalizedTexts(requirements);
        if (requirementItems.length) {
            sources.push(requirementItems.join(separator));
        }
    } else {
        const normalizedRequirements = normalizeRequirementText(requirements);
        if (normalizedRequirements) {
            sources.push(normalizedRequirements);
        }
    }

    const primarySource = normalizeRequirementText(baseRequirement) || normalizeRequirementText(text);
    if (primarySource) {
        sources.push(primarySource);
    }

    return dedupeNormalizedTexts(sources).join(separator);
}
