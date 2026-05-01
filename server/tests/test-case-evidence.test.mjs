import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildEvidenceRetrievalQueries,
    buildKeywordEvidenceItems,
    collectScenarioBranches,
    combineEvidencePacks,
    createEvidencePack,
    formatEvidencePackForPrompt,
    formatScenarioEvidenceMapForPrompt,
    normalizeEvidenceRefs
} from '../test-case-evidence.mjs';

const modelChunk = [{
    text: 'Платежи',
    stories: [{
        text: 'Подтверждение платежа',
        scenarios: [{
            text: 'Нажать кнопку Подтвердить',
            codes: [{ text: 'Отправить запрос подтверждения' }]
        }]
    }]
}];

test('buildEvidenceRetrievalQueries creates layer-specific queries', () => {
    const queries = buildEvidenceRetrievalQueries(modelChunk, { includeBackendTests: true });

    assert.equal(queries.length, 3);
    assert.match(queries[0].query, /Подтверждение платежа/);
    assert.match(queries.find(q => q.layer === 'frontend').query, /UI rules/);
    assert.match(queries.find(q => q.layer === 'backend').query, /API contract/);
});

test('createEvidencePack assigns stable EV refs and formats prompt', () => {
    const keywordItems = buildKeywordEvidenceItems([
        'POST /payments/{id}/confirm возвращает 200 OK при успешном подтверждении.',
        'Если у пользователя нет прав, возвращается 403.'
    ]);
    const pack = createEvidencePack({ chunk: modelChunk, keywordItems });

    assert.deepEqual(pack.evidenceRefs, ['EV-1', 'EV-2']);
    assert.equal(pack.items[0].originalId, 'REQ-KW-1');

    const prompt = formatEvidencePackForPrompt(pack);
    assert.match(prompt, /\[EV-1\]/);
    assert.match(prompt, /evidenceRefs/);
});

test('scenario evidence packs use scenario-specific refs', () => {
    const branches = collectScenarioBranches(modelChunk);
    assert.equal(branches.length, 1);
    assert.equal(branches[0].refPrefix, 'S1-EV');

    const pack = createEvidencePack({
        chunk: branches[0].chunk,
        refPrefix: branches[0].refPrefix,
        keywordItems: buildKeywordEvidenceItems(['Кнопка Подтвердить отображается для draft платежа.'])
    });
    const combined = combineEvidencePacks([pack]);
    const prompt = formatScenarioEvidenceMapForPrompt([{ branch: branches[0], pack }]);

    assert.deepEqual(pack.evidenceRefs, ['S1-EV-1']);
    assert.deepEqual(combined.evidenceRefs, ['S1-EV-1']);
    assert.match(prompt, /Scenario 1:/);
    assert.match(prompt, /\[S1-EV-1\]/);
});

test('normalizeEvidenceRefs keeps only refs from current evidence pack', () => {
    const pack = createEvidencePack({
        chunk: modelChunk,
        keywordItems: buildKeywordEvidenceItems(['Кнопка Подтвердить отображается для draft платежа.'])
    });

    assert.deepEqual(normalizeEvidenceRefs(['EV-1', 'REQ-KW-1', 'EV-999'], pack), ['EV-1']);
});
