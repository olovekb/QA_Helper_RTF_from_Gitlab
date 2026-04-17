import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRequirementModelInput } from '../requirement-text-builder.mjs';

test('buildRequirementModelInput deduplicates identical requirement sources', () => {
    const requirement = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 1 | Login button | On Login screen the Login button is enabled when both fields are filled. |`;

    const result = buildRequirementModelInput({
        requirements: [requirement],
        baseRequirement: `${requirement}\r\n`,
        text: requirement
    });

    assert.equal(result, requirement);
});

test('buildRequirementModelInput keeps distinct sources in stable order', () => {
    const result = buildRequirementModelInput({
        requirements: ['Main requirement'],
        baseRequirement: 'Context requirement'
    });

    assert.equal(result, 'Main requirement\n\n---\n\nContext requirement');
});
