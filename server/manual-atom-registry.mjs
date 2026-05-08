import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { extname, join, resolve } from 'path';

import XLSX from 'xlsx';

export const MANUAL_ATOM_REGISTRY_DIR = 'report/requirement-coverage-sources';
export const MANUAL_ATOM_COVERAGE_SOURCE = 'manual_atom_registry';
export const CANONICAL_CHUNKS_COVERAGE_SOURCE = 'canonical_chunks_approximation';

export const MANUAL_ATOM_COLUMNS = Object.freeze([
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
]);

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.tsv', '.xlsx']);
const TYPE_ENUMS = new Set(['UI_BEHAVIOR', 'API_CONTRACT', 'BUSINESS_RULE', 'REGRESSION_REFERENCE']);
const TARGET_LEVEL_ENUMS = new Set(['C1_E2E', 'C2_C3_FRONTEND', 'C2_C3_BACKEND']);
const EXPECTED_COLUMN_COUNT = MANUAL_ATOM_COLUMNS.length;
const FIXED_PREFIX_COLUMN_COUNT = 6;
const OPTIONAL_API_COLUMN_COUNT = 6;
const STABLE_TAIL_COLUMN_COUNT = 5;

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}/._:-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function contentHash(value) {
    return createHash('sha256').update(normalizeText(value)).digest('hex');
}

function coerceString(value) {
    if (value == null) {
        return '';
    }
    return String(value).trim();
}

function parseBoolean(value, defaultValue = true) {
    const text = normalizeText(value);
    if (!text) {
        return defaultValue;
    }
    if (['true', '1', 'yes', 'y', 'да', 'истина'].includes(text)) {
        return true;
    }
    if (['false', '0', 'no', 'n', 'нет', 'ложь'].includes(text)) {
        return false;
    }
    return defaultValue;
}

function normalizeRowKeys(row = {}) {
    const normalized = {};
    for (const [key, value] of Object.entries(row || {})) {
        normalized[normalizeText(key).replace(/\s+/g, '_')] = value;
    }
    return normalized;
}

function buildAtomText(atom) {
    return [
        atom.mode,
        atom.action,
        atom.condition,
        atom.expected_result,
        atom.method_name,
        atom.endpoint,
        atom.request_params,
        atom.response_params
    ].map(coerceString).filter(Boolean).join('\n');
}

function splitRefs(value) {
    return String(value || '')
        .split(/[,;\n]+/)
        .map((item) => normalizeText(item))
        .filter(Boolean);
}

function normalizeEndpoint(httpMethod, endpoint) {
    const endpointText = coerceString(endpoint);
    if (!endpointText) {
        return '';
    }
    const method = coerceString(httpMethod).toUpperCase();
    return method ? `${method} ${endpointText.toLowerCase()}` : endpointText.toLowerCase();
}

function toManualAtom(row, { documentId = 'unknown-document', sourceFile = null, rowIndex = 0 } = {}) {
    const normalized = normalizeRowKeys(row);
    const atom = {};
    for (const column of MANUAL_ATOM_COLUMNS) {
        atom[column] = coerceString(normalized[column]);
    }

    atom.documentId = coerceString(documentId) || 'unknown-document';
    atom.sourceFile = sourceFile;
    atom.sourceRowIndex = rowIndex;
    atom.atom_id = atom.atom_id || `row-${rowIndex + 1}`;
    atom.testable = parseBoolean(atom.testable, true);
    atom.include_in_coverage = parseBoolean(atom.include_in_coverage, true);
    atom.stableId = `${atom.documentId}:${atom.atom_id}`;
    atom.text = buildAtomText(atom);
    atom.normalizedText = normalizeText(atom.text);
    atom.contentHash = contentHash(atom.text);
    atom.coverageSource = MANUAL_ATOM_COVERAGE_SOURCE;
    return atom;
}

function readXlsxRows(filePath) {
    const workbook = XLSX.readFile(filePath, {
        raw: false,
        cellDates: false
    });
    const [sheetName] = workbook.SheetNames;
    if (!sheetName) {
        return [];
    }
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: '',
        raw: false
    });
}

function decodeDelimitedBuffer(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return { text: new TextDecoder('utf-8').decode(buffer.subarray(3)), encodingUsed: 'utf-8-bom' };
    }
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encodingUsed: 'utf-16le' };
    }
    if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
        return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encodingUsed: 'utf-16be' };
    }

    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encodingUsed: 'utf-8' };
    } catch (_error) {
        return { text: new TextDecoder('windows-1251').decode(buffer), encodingUsed: 'windows-1251' };
    }
}

function countDelimiterOutsideQuotes(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                index += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        if (!quoted && char === delimiter) {
            count += 1;
        }
    }
    return count;
}

function detectDelimiter(text, extension) {
    if (extension === '.tsv') {
        return '\t';
    }
    const headerLine = String(text || '').split(/\r?\n/, 1)[0] || '';
    const candidates = [';', ',', '\t'];
    return candidates
        .map((delimiter) => ({ delimiter, count: countDelimiterOutsideQuotes(headerLine, delimiter) }))
        .sort((left, right) => right.count - left.count)[0]?.delimiter || ',';
}

function parseDelimitedText(text, delimiter) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') {
                value += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }

        if (!quoted && char === delimiter) {
            row.push(value);
            value = '';
            continue;
        }

        if (!quoted && (char === '\n' || char === '\r')) {
            if (char === '\r' && text[index + 1] === '\n') {
                index += 1;
            }
            row.push(value);
            rows.push(row);
            row = [];
            value = '';
            continue;
        }

        value += char;
    }

    if (value.length > 0 || row.length > 0) {
        row.push(value);
        rows.push(row);
    }

    return rows.filter((cells) => cells.some((cell) => String(cell || '').trim()));
}

function isBooleanCell(value) {
    return ['true', 'false', '1', '0', 'yes', 'no', 'y', 'n', 'да', 'нет'].includes(normalizeText(value));
}

function isRecoverableTail(cells) {
    if (cells.length < FIXED_PREFIX_COLUMN_COUNT + STABLE_TAIL_COLUMN_COUNT) {
        return false;
    }
    const tail = cells.slice(-STABLE_TAIL_COLUMN_COUNT);
    return TYPE_ENUMS.has(String(tail[0] || '').trim()) &&
        TARGET_LEVEL_ENUMS.has(String(tail[1] || '').trim()) &&
        isBooleanCell(tail[2]) &&
        isBooleanCell(tail[3]);
}

function normalizeDelimitedCells(cells, rowNumber) {
    if (cells.length === EXPECTED_COLUMN_COUNT) {
        return {
            cells,
            repaired: null,
            invalid: null
        };
    }

    if (cells.length < EXPECTED_COLUMN_COUNT && isRecoverableTail(cells)) {
        const head = cells.slice(0, FIXED_PREFIX_COLUMN_COUNT);
        const middle = cells.slice(FIXED_PREFIX_COLUMN_COUNT, -STABLE_TAIL_COLUMN_COUNT);
        const tail = cells.slice(-STABLE_TAIL_COLUMN_COUNT);
        const missingOptionalCells = OPTIONAL_API_COLUMN_COUNT - middle.length;
        if (missingOptionalCells >= 0) {
            return {
                cells: [
                    ...head,
                    ...middle,
                    ...Array.from({ length: missingOptionalCells }, () => ''),
                    ...tail
                ],
                repaired: {
                    rowNumber,
                    reason: `Inserted ${missingOptionalCells} missing optional API cell(s) before type.`,
                    originalCellCount: cells.length,
                    expectedCellCount: EXPECTED_COLUMN_COUNT
                },
                invalid: null
            };
        }
    }

    return {
        cells,
        repaired: null,
        invalid: {
            rowNumber,
            atom_id: cells[0] || null,
            reason: `Unexpected column count ${cells.length}; expected ${EXPECTED_COLUMN_COUNT}.`,
            originalCellCount: cells.length,
            expectedCellCount: EXPECTED_COLUMN_COUNT
        }
    };
}

function rowsFromDelimitedFile(filePath, extension) {
    const buffer = readFileSync(filePath);
    const decoded = decodeDelimitedBuffer(buffer);
    const delimiter = detectDelimiter(decoded.text, extension);
    const rawRows = parseDelimitedText(decoded.text, delimiter);
    const diagnostics = {
        sourceFile: filePath,
        encodingUsed: decoded.encodingUsed,
        delimiterUsed: delimiter,
        totalRows: Math.max(0, rawRows.length - 1),
        parsedRows: 0,
        repairedRows: [],
        invalidRows: [],
        warnings: []
    };

    if (rawRows.length === 0) {
        return { rows: [], diagnostics };
    }

    const headers = rawRows[0].map((header) => normalizeText(header).replace(/\s+/g, '_'));
    const rows = [];
    for (const [rowIndex, rawCells] of rawRows.slice(1).entries()) {
        const rowNumber = rowIndex + 2;
        const normalized = normalizeDelimitedCells(rawCells, rowNumber);
        if (normalized.invalid) {
            diagnostics.invalidRows.push(normalized.invalid);
            continue;
        }
        if (normalized.repaired) {
            diagnostics.repairedRows.push(normalized.repaired);
        }
        const row = {};
        for (const [cellIndex, header] of headers.entries()) {
            row[header] = normalized.cells[cellIndex] ?? '';
        }
        rows.push(row);
        diagnostics.parsedRows += 1;
    }

    return { rows, diagnostics };
}

function readRowsWithDiagnostics(filePath, extension) {
    if (extension === '.xlsx') {
        const rows = readXlsxRows(filePath);
        return {
            rows,
            diagnostics: {
                sourceFile: filePath,
                encodingUsed: 'xlsx',
                delimiterUsed: null,
                totalRows: rows.length,
                parsedRows: rows.length,
                repairedRows: [],
                invalidRows: [],
                warnings: []
            }
        };
    }

    return rowsFromDelimitedFile(filePath, extension);
}

export async function parseManualAtomRegistryFile(filePath, { documentId = 'unknown-document' } = {}) {
    const absolutePath = resolve(filePath);
    const extension = extname(absolutePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported manual atom registry extension: ${extension}`);
    }

    const { rows } = readRowsWithDiagnostics(absolutePath, extension);
    return rows
        .map((row, rowIndex) => toManualAtom(row, {
            documentId,
            sourceFile: absolutePath,
            rowIndex
        }))
        .filter((atom) => atom.atom_id);
}

function nameContainsToken(filename, token) {
    const normalizedName = normalizeText(filename);
    const normalizedToken = normalizeText(token);
    return Boolean(normalizedToken && normalizedName.includes(normalizedToken));
}

function listRegistryFiles(searchDir) {
    if (!existsSync(searchDir)) {
        return [];
    }
    return readdirSync(searchDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase()))
        .map((entry) => join(searchDir, entry.name))
        .sort((left, right) => left.localeCompare(right));
}

export function resolveManualAtomRegistryFile({
    documentId = '',
    pageId = '',
    searchDir = MANUAL_ATOM_REGISTRY_DIR
} = {}) {
    const absoluteSearchDir = resolve(searchDir);
    const files = listRegistryFiles(absoluteSearchDir);
    const tokens = [documentId, pageId].map(coerceString).filter(Boolean);

    for (const token of tokens) {
        const matched = files.find((filePath) => nameContainsToken(filePath, token));
        if (matched) {
            return matched;
        }
    }

    for (const latest of ['latest.csv', 'latest.tsv', 'latest.xlsx']) {
        const matched = files.find((filePath) => filePath.toLowerCase().endsWith(latest));
        if (matched) {
            return matched;
        }
    }

    return null;
}

export function manualAtomsToCoverageUnits(atoms = []) {
    return (Array.isArray(atoms) ? atoms : [])
        .filter((atom) => atom?.testable === true && atom?.include_in_coverage === true)
        .map((atom) => {
            const endpoint = normalizeEndpoint(atom.http_method, atom.endpoint);
            const params = [
                ...splitRefs(atom.request_params),
                ...splitRefs(atom.response_params)
            ];
            const requiresApiEvidence = Boolean(
                atom.method_ref ||
                atom.method_name ||
                atom.http_method ||
                atom.endpoint ||
                atom.request_params ||
                atom.response_params
            );

            return {
                coverageSource: MANUAL_ATOM_COVERAGE_SOURCE,
                stableId: atom.stableId,
                documentId: atom.documentId,
                atom_id: atom.atom_id,
                sourceChunkId: null,
                sourceRowId: atom.atom_id,
                requirementId: atom.atom_id,
                atomicRuleIndex: null,
                source_section: atom.source_section,
                sectionPath: atom.source_section ? [atom.source_section] : [],
                sectionPathDisplay: atom.source_section,
                sectionPathText: normalizeText(atom.source_section),
                text: atom.text,
                normalizedText: atom.normalizedText,
                textHash: atom.contentHash,
                contentHash: atom.contentHash,
                chunkType: MANUAL_ATOM_COVERAGE_SOURCE,
                mode: atom.mode,
                action: atom.action,
                condition: atom.condition,
                expected_result: atom.expected_result,
                method_ref: atom.method_ref,
                method_name: atom.method_name,
                http_method: atom.http_method,
                endpoint: atom.endpoint,
                request_params: atom.request_params,
                response_params: atom.response_params,
                type: atom.type,
                target_level: atom.target_level,
                comment: atom.comment,
                testable: atom.testable,
                include_in_coverage: atom.include_in_coverage,
                endpoints: endpoint ? [endpoint] : [],
                params: [...new Set(params)],
                explicitRefs: [],
                requiresApiEvidence,
                requiresCodeLevelBehavior: requiresApiEvidence ||
                    atom.type === 'API_CONTRACT' ||
                    atom.type === 'BUSINESS_RULE' ||
                    atom.target_level === 'C2_C3_BACKEND' ||
                    atom.target_level === 'C2_C3_FRONTEND'
            };
        });
}

export async function loadManualAtomRegistryForDocument({
    documentId = '',
    pageId = '',
    searchDir = MANUAL_ATOM_REGISTRY_DIR
} = {}) {
    const filePath = resolveManualAtomRegistryFile({ documentId, pageId, searchDir });
    if (!filePath) {
        return null;
    }

    const resolvedDocumentId = coerceString(documentId || pageId) || 'unknown-document';
    const extension = extname(filePath).toLowerCase();
    const { rows, diagnostics } = readRowsWithDiagnostics(filePath, extension);
    const atoms = rows
        .map((row, rowIndex) => toManualAtom(row, {
            documentId: resolvedDocumentId,
            sourceFile: filePath,
            rowIndex
        }))
        .filter((atom) => atom.atom_id);
    return {
        coverageSource: MANUAL_ATOM_COVERAGE_SOURCE,
        filePath,
        documentId: resolvedDocumentId,
        diagnostics,
        manualRegistryDiagnostics: diagnostics,
        atoms,
        coverageUnits: manualAtomsToCoverageUnits(atoms),
        allAtomsCount: atoms.length,
        denominatorAtomsCount: atoms.filter((atom) => atom.testable === true && atom.include_in_coverage === true).length
    };
}
