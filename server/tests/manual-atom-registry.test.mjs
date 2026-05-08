import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';

import XLSX from 'xlsx';

import {
    loadManualAtomRegistryForDocument,
    manualAtomsToCoverageUnits,
    parseManualAtomRegistryFile,
    resolveManualAtomRegistryFile
} from '../manual-atom-registry.mjs';

function tempDir() {
    const root = join(process.cwd(), '.tmp-tests');
    mkdirSync(root, { recursive: true });
    return mkdtempSync(join(root, 'manual-atoms-'));
}

function writeCsv(filePath, rows) {
    const headers = [
        'atom_id',
        'source_section',
        'mode',
        'action',
        'condition',
        'expected_result',
        'method_ref',
        'method_name',
        'http_method',
        'endpoint',
        'request_params',
        'response_params',
        'type',
        'target_level',
        'testable',
        'include_in_coverage',
        'comment'
    ];
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    writeFileSync(
        filePath,
        [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n'),
        'utf8'
    );
}

function writeDelimited(filePath, lines, encoding = 'utf8') {
    writeFileSync(filePath, lines.join('\n'), encoding);
}

test('manual atom registry parses CSV and preserves type and target_level enum values', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'latest.csv');
    writeCsv(filePath, [
        {
            atom_id: 'REQ-001',
            source_section: '2.1 Registry',
            mode: 'list',
            action: 'open registry list',
            condition: 'authorized user',
            expected_result: 'rows are displayed',
            type: 'UI_BEHAVIOR',
            target_level: 'C1_E2E',
            testable: 'true',
            include_in_coverage: 'true',
            comment: 'baseline atom'
        },
        {
            atom_id: 'REQ-002',
            source_section: '2.2 Import',
            action: 'import invalid file',
            expected_result: 'validation error is shown',
            type: 'BUSINESS_RULE',
            target_level: 'C2_C3_FRONTEND',
            testable: 'true',
            include_in_coverage: 'false'
        }
    ]);

    const atoms = await parseManualAtomRegistryFile(filePath, { documentId: 'doc-42' });
    const units = manualAtomsToCoverageUnits(atoms);

    assert.equal(atoms.length, 2);
    assert.equal(atoms[0].type, 'UI_BEHAVIOR');
    assert.equal(atoms[0].target_level, 'C1_E2E');
    assert.equal(units.length, 1);
    assert.equal(units[0].coverageSource, 'manual_atom_registry');
    assert.equal(units[0].stableId, 'doc-42:REQ-001');
});

test('manual stableId remains stable when atom text changes while contentHash changes', async () => {
    const dir = tempDir();
    const firstPath = join(dir, 'first.csv');
    const secondPath = join(dir, 'second.csv');
    const base = {
        atom_id: 'REQ-101',
        source_section: '3. API',
        mode: 'repeat',
        action: 'repeat request',
        condition: 'service returns business error',
        expected_result: 'errorCode is shown',
        method_ref: 'Method 2',
        method_name: 'Repeat registry',
        http_method: 'POST',
        endpoint: '/api/registries/{id}/repeat',
        request_params: 'id',
        response_params: 'errorCode',
        type: 'API_CONTRACT',
        target_level: 'C2_C3_BACKEND',
        testable: 'true',
        include_in_coverage: 'true'
    };
    writeCsv(firstPath, [base]);
    writeCsv(secondPath, [{ ...base, expected_result: 'errorCode and message are shown' }]);

    const [first] = manualAtomsToCoverageUnits(await parseManualAtomRegistryFile(firstPath, { documentId: 'doc-42' }));
    const [second] = manualAtomsToCoverageUnits(await parseManualAtomRegistryFile(secondPath, { documentId: 'doc-42' }));

    assert.equal(first.stableId, second.stableId);
    assert.notEqual(first.contentHash, second.contentHash);
});

test('manual registry selection prefers documentId or pageId file before latest file', async () => {
    const dir = tempDir();
    const docFile = join(dir, 'doc-42-atoms.csv');
    const latestFile = join(dir, 'latest.csv');
    writeCsv(docFile, [{ atom_id: 'REQ-DOC', type: 'UI_BEHAVIOR', target_level: 'C1_E2E' }]);
    writeCsv(latestFile, [{ atom_id: 'REQ-LATEST', type: 'UI_BEHAVIOR', target_level: 'C1_E2E' }]);

    assert.equal(resolveManualAtomRegistryFile({ documentId: 'doc-42', searchDir: dir }), docFile);
    assert.equal(resolveManualAtomRegistryFile({ documentId: 'missing', pageId: 'none', searchDir: dir }), latestFile);
});

test('manual atom registry supports XLSX files', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'latest.xlsx');
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet([
        {
            atom_id: 'REQ-XLSX',
            source_section: '4. UI',
            action: 'open details',
            expected_result: 'details are visible',
            type: 'REGRESSION_REFERENCE',
            target_level: 'C2_C3_FRONTEND',
            testable: true,
            include_in_coverage: true
        }
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'atoms');
    XLSX.writeFile(workbook, filePath);

    const registry = await loadManualAtomRegistryForDocument({ documentId: 'unknown', searchDir: dir });

    assert.equal(registry.coverageSource, 'manual_atom_registry');
    assert.equal(registry.atoms.length, 1);
    assert.equal(registry.coverageUnits[0].atom_id, 'REQ-XLSX');
});

test('manual atom registry preserves UTF-8 Cyrillic in semicolon CSV and repairs shifted optional API columns', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'latest.csv');
    const header = 'atom_id;source_section;mode;action;condition;expected_result;method_ref;method_name;http_method;endpoint;request_params;response_params;type;target_level;testable;include_in_coverage;comment';
    writeDelimited(filePath, [
        header,
        'REQ-OK;4.1.1;Список ведомостей;Отображение названия;"Открыта страница";"Название отображается";Метод 1;Список реестров;GET;"/api/list?filter={date}";"doc_type=payroll, limit=1000";"registry.description";UI_BEHAVIOR;C2_C3_FRONTEND;true;true;api-backed row',
        'REQ-REPAIR;4.1.2;Список ведомостей D;Клик по ведомости;"Пользователь на странице";"Раскрывается детальная информация";;;;;;UI_BEHAVIOR;C2_C3_FRONTEND;true;true;pure ui row'
    ]);

    const registry = await loadManualAtomRegistryForDocument({ documentId: 'doc-utf8', searchDir: dir });

    assert.equal(registry.diagnostics.encodingUsed, 'utf-8');
    assert.equal(registry.diagnostics.delimiterUsed, ';');
    assert.equal(registry.diagnostics.repairedRows.length, 1);
    assert.equal(registry.diagnostics.invalidRows.length, 0);
    assert.equal(registry.atoms[0].mode, 'Список ведомостей');
    assert.equal(registry.atoms[0].type, 'UI_BEHAVIOR');
    assert.equal(registry.atoms[0].target_level, 'C2_C3_FRONTEND');
    assert.equal(registry.atoms[1].type, 'UI_BEHAVIOR');
    assert.equal(registry.atoms[1].target_level, 'C2_C3_FRONTEND');
    assert.equal(registry.atoms[1].testable, true);
    assert.equal(registry.atoms[1].include_in_coverage, true);
    assert.equal(registry.coverageUnits.length, 2);
    assert.doesNotMatch(registry.atoms[0].mode, /Ð|РЎ/);
});

test('manual atom registry decodes Windows-1251 CSV fallback', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'latest.csv');
    const header = Buffer.from('atom_id;source_section;mode;action;condition;expected_result;method_ref;method_name;http_method;endpoint;request_params;response_params;type;target_level;testable;include_in_coverage;comment\n', 'ascii');
    const prefix = Buffer.from('REQ-CP;4.1;', 'ascii');
    const cp1251Word = Buffer.from([0xD1, 0xEF, 0xE8, 0xF1, 0xEE, 0xEA]);
    const suffix = Buffer.from(';Open;Cond;Result;;;;;;;UI_BEHAVIOR;C1_E2E;true;true;cp1251 row', 'ascii');
    writeFileSync(filePath, Buffer.concat([header, prefix, cp1251Word, suffix]));

    const registry = await loadManualAtomRegistryForDocument({ documentId: 'doc-cp1251', searchDir: dir });

    assert.equal(registry.diagnostics.encodingUsed, 'windows-1251');
    assert.equal(registry.atoms[0].mode, 'Список');
    assert.equal(registry.atoms[0].type, 'UI_BEHAVIOR');
    assert.equal(registry.atoms[0].target_level, 'C1_E2E');
});

test('manual atom registry reports unrecoverable rows and excludes them from denominator', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'latest.csv');
    const header = 'atom_id;source_section;mode;action;condition;expected_result;method_ref;method_name;http_method;endpoint;request_params;response_params;type;target_level;testable;include_in_coverage;comment';
    writeDelimited(filePath, [
        header,
        'REQ-BAD;4.1;too;few;columns'
    ]);

    const registry = await loadManualAtomRegistryForDocument({ documentId: 'doc-bad', searchDir: dir });

    assert.equal(registry.atoms.length, 0);
    assert.equal(registry.coverageUnits.length, 0);
    assert.equal(registry.diagnostics.invalidRows.length, 1);
    assert.equal(registry.diagnostics.invalidRows[0].atom_id, 'REQ-BAD');
});
