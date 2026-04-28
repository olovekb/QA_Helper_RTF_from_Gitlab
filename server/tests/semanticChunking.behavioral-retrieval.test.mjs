import test from 'node:test';
import assert from 'node:assert/strict';

import {
    chunkify,
    CHUNK_TYPES,
    RETRIEVAL_CLASSES,
    ELIGIBILITY_STATUSES
} from '../semanticChunking.mjs';
import { isBehavioralRetrievalCandidate } from '../behavioralRetrieval.mjs';
import { selectCanonicalMainChunks } from '../canonicalChunkSelection.mjs';
import { buildRequirementModelInput } from '../requirement-text-builder.mjs';
import {
    buildRequirementChunkDiagnostics,
    renderChunkMarkdownSection,
    serializeDebugChunk
} from '../chunkDebug.mjs';

async function chunkifyRequirement(markdown) {
    return chunkify(markdown, {
        pageId: 'test-page',
        title: 'Behavioral retrieval fixture'
    });
}

function byType(chunks, type) {
    return chunks.filter((chunk) => chunk.chunk_type === type);
}

function getChunkSectionNumber(chunk) {
    return String(chunk.section_number || chunk.metadata?.section_number || chunk.aux_metadata?.sectionNumber || '').trim();
}

function getChunkTopLevelSection(chunk) {
    return getChunkSectionNumber(chunk).split('.')[0] || '';
}

function getChunkRowNumber(chunk) {
    return String(
        chunk.row_number ||
        chunk.metadata?.row_number ||
        chunk.source_row_id ||
        chunk.metadata?.source_row_id ||
        chunk.aux_metadata?.rowNumber ||
        ''
    ).trim();
}

function getChunkParentRowId(chunk) {
    return String(
        chunk.parent_row_id ||
        chunk.metadata?.parent_row_id ||
        chunk.metadata?.parentRowId ||
        chunk.aux_metadata?.parentRowId ||
        ''
    ).trim();
}

function buildMainSectionRegressionMarkdown() {
    return `# 1. Document data

| Initiative | KCB-8358 |
| --- | --- |
| Status | Approved |

# 2. ChangeLog

| Version | Change |
| --- | --- |
| 1.0 | Initial delivery |

# 3. General information

Overview only. This section provides background and should stay out of main retrieval.

# 4. Requirement description

## 4.1 Registry list

| No | Element | Requirement | Method | Parameters |
| --- | --- | --- | --- | --- |
| 4.1.1 | Registry status | If status = decline, show decline reason. If status = end, show end badge. | GET /rest/registry/list | status, declineReason |
| 4.1.2 | Registry empty state | If result is empty, show empty state. Sort by createdAt desc. | GET /rest/registry/list | createdAt |

## 4.2 Registry details

| No | Element | Requirement | Method | Parameters |
| --- | --- | --- | --- | --- |
| 4.2.1 | Payroll alert | If payrollError exists, show payroll error alert. Otherwise hide payroll error alert. | GET /rest/registry/byid | payrollError |

## 4.3 Request list

| No | Element | Requirement | Method | Parameters |
| --- | --- | --- | --- | --- |
| 4.3.1 | Request badge | If request status = pending, show pending badge. If request status = rejected, show rejected badge. | GET /rest/request/list | requestStatus |

## 4.4 Request details

| No | Element | Requirement | Method | Parameters |
| --- | --- | --- | --- | --- |
| 4.4.1 | Employee status | If status = decline, show red cross icon. If status = end, show completed icon. If null, show empty state. If absent, hide status block. | GET /rest/request/byid | status, employeeId |
| 4.4.2 | Employee error | If employeeError exists, show employee error alert. Otherwise hide employee error alert. | GET /rest/request/byid | employeeError |

# 5. Layout

Reference mock is available in Figma and is background-only for retrieval.

# 6. Server interaction

## 6.1 Registry list API

GET /rest/registry/list

Input params
| Parameter | Type | Description |
| --- | --- | --- |
| status | string | Filter list by status |
| createdAt | string | Sorting field |

Response params
| Parameter | Type | Description |
| --- | --- | --- |
| items | array | Registry rows |

## 6.2 Registry details API

GET /rest/registry/byid

Input params
| Parameter | Type | Description |
| --- | --- | --- |
| id | uuid | Registry identifier |
| payrollError | string | Payroll error message |

## 6.3 Request list API

GET /rest/request/list

Input params
| Parameter | Type | Description |
| --- | --- | --- |
| requestStatus | string | Request status filter |

## 6.4 Request details API

GET /rest/request/byid

Input params
| Parameter | Type | Description |
| --- | --- | --- |
| employeeId | uuid | Employee identifier |
| status | string | Employee processing status |
| employeeError | string | Employee error message |
`;
}

function buildRussianSection4RegressionMarkdown() {
    return `# 1. Данные документа

| Поле | Значение |
| --- | --- |
| Инициатива | QA-HELPER-CHUNKING |
| Версия | 2.0 |

# 2. ChangeLog

| Версия | Изменение |
| --- | --- |
| 2.0 | Уточнение атомаризации |

# 3. Общая информация

Этот раздел нужен только как background context и не должен участвовать в retrieval.

# 4\\. Описание требований

## 4.1 Экран ведомости

| № | Элемент | Требование | Метод | Параметры |
| --- | --- | --- | --- | --- |
| 4.1.3 | Просмотр ведомости | При клике на кнопку «Подробнее» открывать просмотр ведомости. | GET /payroll/details | kubanZpPayroll.id |
| 4.1.4 | Ошибка ведомости | Если kubanZpPayroll.declineInfo заполнен, показывать alert с текстом ошибки и кнопку «Подробнее». Если kubanZpPayroll.declineInfo = null или \"\" , alert не показывать. Текст alert поддерживает HTML-разметку. При клике на кнопку «Подробнее» открывать просмотр ведомости. Не зависеть от kubanZpPayroll.status. См. п. 4.1.3. См. подраздел 6.1. См. выше. | GET /payroll/details | kubanZpPayroll.declineInfo, kubanZpPayroll.status |

## 4.2 Экран сотрудника

| № | Элемент | Требование | Метод | Параметры |
| --- | --- | --- | --- | --- |
| 4.2.2 | Статус сотрудника | Если status = decline, показывать иконку ошибки и текст причины. Если status = end, показывать иконку завершения. Если status = null, по умолчанию показывать состояние без иконки. Если status отсутствует, скрывать блок статуса. Если declineInfo отсутствует, alert не показывать. См. Рис. 1. См. ниже. | GET /employee/status | status, declineInfo |

# 5. Макет

Используется только для background/debug. См. Рис. 1.

# 6\\. Взаимодействие с сервером

## 6.1 Метод получения ведомости

GET /payroll/details

Response params
| Parameter | Type | Description |
| --- | --- | --- |
| kubanZpPayroll.declineInfo | string | Текст ошибки ведомости |
| kubanZpPayroll.status | string | Технический статус ведомости |

## 6.2 Метод статуса сотрудника

GET /employee/status

Response params
| Parameter | Type | Description |
| --- | --- | --- |
| status | string | Статус сотрудника |
| declineInfo | string | Причина отклонения |

# 7\\. Тест-кейсы

Этот раздел не должен конкурировать с atomic rules в retrieval.
`;
}

test('headingless inline requirements still produce chunks without breaking canonical selection', async () => {
    const markdown = buildRequirementModelInput({
        requirements: [
            'Feature: Invoice payment.',
            'The user opens the invoice payment screen and sees the invoice number, the amount to pay, and the Pay button.',
            'The user can choose the payment method: Bank card or Fast payment system.',
            'After the payment method is selected, the system displays the selected payment method.',
            'If the user presses the Pay button while the payment service is available, the system sends a payment request, shows a successful payment result, and changes the invoice status to Paid.',
            'If the payment service is temporarily unavailable when the user presses the Pay button, the system shows a payment error message and does not change the invoice status.'
        ]
    });

    const chunks = await chunkifyRequirement(markdown);
    const selection = selectCanonicalMainChunks(chunks);

    assert.ok(chunks.length > 0);
    assert.ok(Array.isArray(selection.indexableChunks));
    assert.ok(Array.isArray(selection.canonicalChunks));
});

test('row dual-write keeps summary+legacy debug chunks excluded and atomic rules retrievable', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 1 | Login button | On Login screen the Login button is enabled when both fields are filled. |
`;

    const chunks = await chunkifyRequirement(markdown);

    const summaries = byType(chunks, CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY);
    const legacyRows = byType(chunks, CHUNK_TYPES.REQUIREMENT_ROW);
    const atomicRules = byType(chunks, CHUNK_TYPES.ATOMIC_RULE);

    assert.equal(summaries.length, 1);
    assert.equal(legacyRows.length, 1);
    assert.equal(atomicRules.length, 1);

    const summary = summaries[0];
    const legacy = legacyRows[0];
    const atomic = atomicRules[0];

    assert.equal(summary.chunk_granularity, 'summary');
    assert.equal(summary.retrieval_class, RETRIEVAL_CLASSES.REFERENCE_CONTEXT);
    assert.equal(summary.eligibility_status, ELIGIBILITY_STATUSES.EXCLUDED);
    assert.equal(summary.exclude_from_retrieval, true);
    assert.equal(summary.exclude_from_graph, true);

    assert.equal(legacy.chunk_granularity, 'summary');
    assert.equal(legacy.retrieval_class, RETRIEVAL_CLASSES.REFERENCE_CONTEXT);
    assert.equal(legacy.eligibility_status, ELIGIBILITY_STATUSES.EXCLUDED);
    assert.equal(legacy.exclude_from_retrieval, true);
    assert.equal(legacy.exclude_from_graph, true);

    assert.equal(atomic.chunk_granularity, 'atomic');
    assert.equal(atomic.retrieval_class, RETRIEVAL_CLASSES.BEHAVIORAL);
    assert.equal(atomic.exclude_from_retrieval, false);
    assert.equal(atomic.parent_row_number, '1');
    assert.ok(atomic.atomic_rule_kind);

    assert.equal(atomic.lineage_parent_summary_id, summary.id);
    assert.ok(Array.isArray(summary.lineage_child_rule_ids));
    assert.ok(summary.lineage_child_rule_ids.includes(atomic.id));
});

test('dual-write does not produce dual-index candidates', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 1 | Status badge | If status = decline show decline reason. If status = end show end state. |
`;

    const chunks = await chunkifyRequirement(markdown);

    const indexCandidates = chunks.filter((chunk) =>
        !chunk.exclude_from_retrieval &&
        !chunk.metadata?.exclude_from_retrieval
    );

    assert.ok(indexCandidates.length >= 2);
    assert.ok(indexCandidates.every((chunk) => chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE));
    assert.ok(indexCandidates.every((chunk) => chunk.chunk_granularity === 'atomic'));
    assert.ok(indexCandidates.every((chunk) => chunk.eligibility_status !== ELIGIBILITY_STATUSES.EXCLUDED));
});

test('atomic embedding_text is cleaned from service wrappers', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 2 | Login button | On Login screen the Login button is enabled when both fields are filled. API dependency: POST /login. Relevant params: username, password. Reference: figma/login. |
`;

    const chunks = await chunkifyRequirement(markdown);
    const atomicRules = byType(chunks, CHUNK_TYPES.ATOMIC_RULE);

    assert.equal(atomicRules.length, 1);

    const atomic = atomicRules[0];
    assert.match(atomic.embedding_text, /enabled when both fields are filled/i);
    assert.match(atomic.embedding_text, /^Requirement 2\./i);
    assert.match(atomic.embedding_text, /API dependency:\s*POST \/login/i);
    assert.doesNotMatch(atomic.embedding_text, /Requirement row:|Behavior:|Relevant params:|Reference:/i);
    assert.equal(atomic.aux_metadata.endpoint, 'POST /login');
});

test('multi-rule row is split into multiple atomic rules with minimal v1 taxonomy', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 3 | Password field | If the password is invalid, an error message is shown. 1.1 If status = decline, show decline reason. 1.2 If status = end, show end badge. If null, show empty state. If absent, hide block. Sort by createdAt desc. |
`;

    const chunks = await chunkifyRequirement(markdown);
    const atomicRules = byType(chunks, CHUNK_TYPES.ATOMIC_RULE);

    assert.ok(atomicRules.length >= 5);

    const kinds = new Set(atomicRules.map((chunk) => chunk.atomic_rule_kind));
    assert.ok(kinds.has('error_rule'));
    assert.ok(kinds.has('status_rule'));
    assert.ok(kinds.has('absence_rule'));
    assert.ok(kinds.has('ordering_rule'));

    const declineRule = atomicRules.find((chunk) => /status\s*=\s*decline/i.test(chunk.embedding_text));
    const endRule = atomicRules.find((chunk) => /status\s*=\s*end/i.test(chunk.embedding_text));

    assert.ok(declineRule);
    assert.ok(endRule);
    assert.doesNotMatch(declineRule.embedding_text, /status\s*=\s*end/i);
    assert.doesNotMatch(endRule.embedding_text, /status\s*=\s*decline/i);
});

test('BUSINESS_CONTEXT and SCOPE_CONTEXT stay background-only and excluded', async () => {
    const markdown = `# Requirements

## Business context
В рамках данного раздела необходимо описать только общий обзор процесса.

## Scope
Область применения: только web-канал и мобильный канал.

## Functional behavior
Система отображает кнопку Continue для валидного клиента.
`;

    const chunks = await chunkifyRequirement(markdown);

    const backgroundChunks = chunks.filter((chunk) =>
        [CHUNK_TYPES.BUSINESS_CONTEXT, CHUNK_TYPES.SCOPE_CONTEXT].includes(chunk.chunk_type)
    );

    assert.ok(backgroundChunks.length >= 1);
    assert.ok(backgroundChunks.every((chunk) => chunk.exclude_from_retrieval === true));
    assert.ok(backgroundChunks.every((chunk) => chunk.eligibility_status === ELIGIBILITY_STATUSES.EXCLUDED));
});

test('legacy and summary row chunks are never behavioral candidates', async () => {
    const markdown = `# Requirements

| No | Element | Requirement |
| --- | --- | --- |
| 4 | Limit field | If value is null, show empty state. If status = decline, show decline reason. |
`;

    const chunks = await chunkifyRequirement(markdown);
    const behavioralCandidates = chunks.filter((chunk) => isBehavioralRetrievalCandidate(chunk));

    assert.ok(behavioralCandidates.length >= 1);
    assert.ok(behavioralCandidates.every((chunk) => chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE));
    assert.ok(chunks.some((chunk) => chunk.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW));
    assert.ok(chunks.some((chunk) => chunk.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY));
    assert.ok(chunks.filter((chunk) => isBehavioralRetrievalCandidate(chunk)).every((chunk) => chunk.chunk_granularity === 'atomic'));
});

test('section 4 requirement-driven subsections emit behavioral atomic rules and exclude background sections from main retrieval', async () => {
    const chunks = await chunkifyRequirement(buildMainSectionRegressionMarkdown());
    const retrievableChunks = chunks.filter((chunk) => !chunk.exclude_from_retrieval);
    const retrievableTopSections = new Set(
        retrievableChunks.map((chunk) => String(chunk.source_section || chunk.metadata?.source_section || chunk.section_number || chunk.metadata?.section_number || '').split('.')[0]).filter(Boolean)
    );
    const mainAtomicRules = chunks.filter((chunk) =>
        chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
        String(chunk.section_number || chunk.metadata?.section_number || '').startsWith('4.')
    );
    const section4ApiAggregates = chunks.filter((chunk) =>
        [
            CHUNK_TYPES.API_ENDPOINT_SUMMARY,
            CHUNK_TYPES.API_INPUT_PARAMS,
            CHUNK_TYPES.API_OUTPUT_PARAMS,
            CHUNK_TYPES.API_BEHAVIOR_NOTES
        ].includes(chunk.chunk_type) &&
        String(chunk.section_number || chunk.metadata?.section_number || '').startsWith('4.') &&
        !chunk.exclude_from_retrieval
    );

    assert.ok(mainAtomicRules.length > 4);
    assert.equal(section4ApiAggregates.length, 0);
    assert.deepEqual([...retrievableTopSections].sort(), ['4', '6']);
    assert.ok(retrievableChunks.every((chunk) => !['1', '2', '3', '5'].includes(String(chunk.section_number || chunk.metadata?.section_number || '').split('.')[0])));
});

test('section 4 atomic rules keep parent section metadata and clean embedding_text', async () => {
    const chunks = await chunkifyRequirement(buildMainSectionRegressionMarkdown());
    const rowChunk = chunks.find((chunk) =>
        chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
        (chunk.row_number === '4.4.1' ||
            chunk.metadata?.row_number === '4.4.1' ||
            chunk.source_row_id === '4.4.1' ||
            chunk.metadata?.source_row_id === '4.4.1')
    );

    assert.ok(rowChunk);
    assert.equal(rowChunk.section_number || rowChunk.metadata?.section_number, '4.4');
    assert.equal(rowChunk.row_number || rowChunk.metadata?.row_number || rowChunk.aux_metadata?.row_number, '4.4.1');
    assert.equal(rowChunk.source_requirement_section || rowChunk.metadata?.source_requirement_section, '4.4');
    assert.equal(rowChunk.source_row_id || rowChunk.metadata?.source_row_id, '4.4.1');

    assert.ok(rowChunk.embedding_text.length < 220);
    assert.doesNotMatch(rowChunk.embedding_text, /\b(No|Element|Requirement|Method|Parameters)\b\s*:/i);
    assert.doesNotMatch(rowChunk.embedding_text, /(Input params|Output params|Endpoint:|Context:)/i);
    assert.doesNotMatch(rowChunk.embedding_text, /4\.4\.1;|Registry status;|Employee status;/i);
});

test('section 6 API chunks are compact support-only and excluded from behavioral competition', async () => {
    const chunks = await chunkifyRequirement(buildMainSectionRegressionMarkdown());
    const supportApiChunks = chunks.filter((chunk) =>
        String(chunk.section_number || chunk.metadata?.section_number || '').startsWith('6.')
    );
    const behavioralCandidates = chunks.filter((chunk) => isBehavioralRetrievalCandidate(chunk));

    assert.ok(supportApiChunks.length >= 4);
    assert.ok(supportApiChunks.every((chunk) => chunk.retrieval_class === RETRIEVAL_CLASSES.API_CONTEXT));
    assert.ok(supportApiChunks.every((chunk) => (chunk.usage_policy || chunk.metadata?.usage_policy) === 'support_only'));
    assert.ok(supportApiChunks.every((chunk) => (chunk.source_section || chunk.metadata?.source_section) === '6'));
    assert.ok(supportApiChunks.every((chunk) => Boolean(chunk.supporting_api || chunk.metadata?.supporting_api)));
    assert.ok(supportApiChunks.every((chunk) => Boolean(chunk.exclude_from_behavioral || chunk.metadata?.exclude_from_behavioral)));
    assert.ok(supportApiChunks.every((chunk) => Boolean(chunk.survived_compaction || chunk.metadata?.survived_compaction)));
    assert.ok(supportApiChunks.every((chunk) => String(chunk.embedding_text || '').length < 520));
    assert.ok(behavioralCandidates.every((chunk) => String(chunk.section_number || chunk.metadata?.section_number || '').startsWith('4.')));
});

test('russian section 4 fixture produces traceable atomic behavioral rules without api summaries', async () => {
    const markdown = buildRussianSection4RegressionMarkdown();
    const chunks = await chunkifyRequirement(markdown);
    const retrievableChunks = chunks.filter((chunk) => !chunk.exclude_from_retrieval);
    const retrievableTopSections = new Set(retrievableChunks.map((chunk) => getChunkTopLevelSection(chunk)).filter(Boolean));
    const section4ApiSummaries = retrievableChunks.filter((chunk) =>
        getChunkTopLevelSection(chunk) === '4' &&
        chunk.chunk_type === CHUNK_TYPES.API_ENDPOINT_SUMMARY
    );
    const rowIds = ['4.1.3', '4.1.4', '4.2.2'];

    assert.deepEqual([...retrievableTopSections].sort(), ['4', '6']);
    assert.equal(section4ApiSummaries.length, 0);
    assert.ok(retrievableChunks.every((chunk) => !['1', '2', '3', '5', '7'].includes(getChunkTopLevelSection(chunk))));

    for (const rowId of rowIds) {
        const summaries = chunks.filter((chunk) =>
            chunk.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY &&
            getChunkRowNumber(chunk) === rowId
        );
        const atomicRules = chunks.filter((chunk) =>
            chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
            getChunkRowNumber(chunk) === rowId
        );

        assert.equal(summaries.length, 1, `expected one summary for ${rowId}`);
        assert.ok(atomicRules.length >= 1, `expected atomic rules for ${rowId}`);
        assert.equal(summaries[0].exclude_from_retrieval, true);
        assert.equal(summaries[0].exclude_from_entity_extraction, true);
        assert.equal(getChunkParentRowId(summaries[0]), `requirement-row:${rowId}`);
        assert.ok(Array.isArray(summaries[0].lineage_child_rule_ids));
        assert.ok(summaries[0].lineage_child_rule_ids.length >= atomicRules.length);

        for (const atomicRule of atomicRules) {
            assert.equal(atomicRule.exclude_from_retrieval, false);
            assert.equal(getChunkRowNumber(atomicRule), rowId);
            assert.equal(atomicRule.source_row_id || atomicRule.metadata?.source_row_id, rowId);
            assert.equal(getChunkParentRowId(atomicRule), `requirement-row:${rowId}`);
            assert.equal(atomicRule.lineage_parent_summary_id, summaries[0].id);
            assert.match(atomicRule.embedding_text, new RegExp(`Requirement\\s+${rowId.replace(/\./g, '\\.')}`, 'i'));
        }
    }
});

test('russian section 4 fixture splits distinct expected-result domains into separate atomic rules', async () => {
    const chunks = await chunkifyRequirement(buildRussianSection4RegressionMarkdown());
    const row414Rules = chunks.filter((chunk) =>
        chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
        getChunkRowNumber(chunk) === '4.1.4'
    );
    const row422Rules = chunks.filter((chunk) =>
        chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
        getChunkRowNumber(chunk) === '4.2.2'
    );

    assert.ok(row414Rules.some((chunk) => /declineinfo заполнен/i.test(chunk.embedding_text) && /alert/i.test(chunk.embedding_text)));
    assert.ok(row414Rules.some((chunk) => /declineinfo заполнен/i.test(chunk.embedding_text) && /подробнее/i.test(chunk.embedding_text)));
    assert.ok(row414Rules.some((chunk) => /declineinfo = null/i.test(chunk.embedding_text) && /не показывать/i.test(chunk.embedding_text)));
    assert.ok(row414Rules.some((chunk) => /declineinfo = \"\"/i.test(chunk.embedding_text) && /не показывать/i.test(chunk.embedding_text)));
    assert.ok(row414Rules.some((chunk) => /html/i.test(chunk.embedding_text)));
    assert.ok(row414Rules.some((chunk) => /при клике/i.test(chunk.embedding_text) && /открывать просмотр/i.test(chunk.embedding_text)));
    assert.ok(row414Rules.some((chunk) => /не зависеть/i.test(chunk.embedding_text) && /status/i.test(chunk.embedding_text)));

    const declineRules = row422Rules.filter((chunk) => /status = decline/i.test(chunk.embedding_text));
    assert.ok(declineRules.length >= 2);
    assert.ok(declineRules.some((chunk) => /иконк/i.test(chunk.embedding_text)));
    assert.ok(declineRules.some((chunk) => /текст причины/i.test(chunk.embedding_text)));
    assert.ok(row422Rules.some((chunk) => /status = end/i.test(chunk.embedding_text) && /иконк/i.test(chunk.embedding_text)));
    assert.ok(row422Rules.some((chunk) => /status = null/i.test(chunk.embedding_text) && /(по умолчанию|default)/i.test(chunk.embedding_text)));
    assert.ok(row422Rules.some((chunk) => /status отсутствует/i.test(chunk.embedding_text) && /скрывать блок статуса/i.test(chunk.embedding_text)));
    assert.ok(row422Rules.some((chunk) => /declineinfo отсутствует/i.test(chunk.embedding_text) && /alert не показывать/i.test(chunk.embedding_text)));
});

test('russian section 4 fixture exposes lineage and refs in json and markdown debug dumps', async () => {
    const chunks = await chunkifyRequirement(buildRussianSection4RegressionMarkdown());
    const serializedChunks = chunks.map((chunk, index) => serializeDebugChunk(chunk, index, { includeFullText: true }));
    const diagnostics = buildRequirementChunkDiagnostics(serializedChunks);
    const markdownDump = renderChunkMarkdownSection('Model Input', {
        title: 'Russian regression fixture',
        length: buildRussianSection4RegressionMarkdown().length,
        chunkCount: serializedChunks.length,
        chunks: serializedChunks
    });

    const row414Atomic = chunks.find((chunk) =>
        chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
        getChunkRowNumber(chunk) === '4.1.4'
    );
    const row414Summary = chunks.find((chunk) =>
        chunk.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY &&
        getChunkRowNumber(chunk) === '4.1.4'
    );
    const row414Serialized = serializedChunks.find((chunk) =>
        chunk.chunkType === CHUNK_TYPES.ATOMIC_RULE &&
        chunk.sourceRowId === '4.1.4'
    );
    const row414Refs = Array.isArray(row414Atomic?.explicit_refs) ? row414Atomic.explicit_refs : [];
    const row422Atomic = chunks.find((chunk) =>
        chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
        getChunkRowNumber(chunk) === '4.2.2'
    );
    const row422Refs = Array.isArray(row422Atomic?.explicit_refs) ? row422Atomic.explicit_refs : [];

    assert.ok(row414Atomic);
    assert.ok(row414Summary);
    assert.ok(row414Serialized);
    assert.equal(row414Serialized.sourceRowId, '4.1.4');
    assert.equal(row414Serialized.rowNumber, '4.1.4');
    assert.equal(row414Serialized.parentRowId, 'requirement-row:4.1.4');
    assert.equal(row414Serialized.lineageParentSummaryId, row414Summary.id);
    assert.ok(markdownDump.includes('rowNumber: 4.1.4'));
    assert.ok(markdownDump.includes('sourceRowId: 4.1.4'));
    assert.ok(markdownDump.includes('parentRowId: requirement-row:4.1.4'));

    assert.ok(row414Refs.some((ref) => ref.type === 'section_ref' && ref.target === '4.1.3'));
    assert.ok(row414Refs.some((ref) => ref.type === 'api_section_ref' && ref.target === '6.1'));
    assert.ok(row414Refs.some((ref) => ref.type === 'relative_ref'));
    assert.ok(row422Refs.some((ref) => ref.type === 'layout_ref'));
    assert.ok(row422Refs.some((ref) => ref.type === 'relative_ref'));

    assert.equal(diagnostics.stats.requirementRowCount, 3);
    assert.ok(diagnostics.stats.atomicRuleCount >= 8);
    assert.ok(diagnostics.stats.explicitRefCount >= 5);
    assert.ok(diagnostics.stats.apiDependencyCount >= 2);
    assert.equal(diagnostics.qualityGates.length, 0);
});

test('russian section 6 fixture stays api_context support-only and summaries stay out of entity extraction', async () => {
    const chunks = await chunkifyRequirement(buildRussianSection4RegressionMarkdown());
    const supportApiChunks = chunks.filter((chunk) => getChunkTopLevelSection(chunk) === '6');
    const rowSummaries = chunks.filter((chunk) => chunk.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY);
    const behavioralCandidates = chunks.filter((chunk) => isBehavioralRetrievalCandidate(chunk));

    assert.ok(supportApiChunks.length >= 2);
    assert.ok(supportApiChunks.every((chunk) => chunk.chunk_type === CHUNK_TYPES.API_CONTEXT));
    assert.ok(supportApiChunks.every((chunk) => chunk.retrieval_class === RETRIEVAL_CLASSES.API_CONTEXT));
    assert.ok(supportApiChunks.every((chunk) => (chunk.usage_policy || chunk.metadata?.usage_policy) === 'support_only'));
    assert.ok(supportApiChunks.every((chunk) => Boolean(chunk.supporting_api || chunk.metadata?.supporting_api)));
    assert.ok(supportApiChunks.every((chunk) => Boolean(chunk.exclude_from_behavioral || chunk.metadata?.exclude_from_behavioral)));
    assert.ok(supportApiChunks.every((chunk) => Boolean(chunk.survived_compaction || chunk.metadata?.survived_compaction)));
    assert.ok(supportApiChunks.every((chunk) => String(chunk.embedding_text || '').length < 520));

    assert.ok(rowSummaries.length >= 3);
    assert.ok(rowSummaries.every((chunk) => chunk.exclude_from_retrieval === true));
    assert.ok(rowSummaries.every((chunk) => chunk.exclude_from_entity_extraction === true));
    assert.ok(behavioralCandidates.every((chunk) => chunk.chunk_type === CHUNK_TYPES.ATOMIC_RULE));
    assert.ok(behavioralCandidates.every((chunk) => getChunkTopLevelSection(chunk) === '4'));
});
