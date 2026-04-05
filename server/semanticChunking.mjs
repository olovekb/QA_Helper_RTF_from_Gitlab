// semanticChunking.mjs
// Семантическая чанкизация требований из Confluence для RAG-системы

import { v4 as uuidv4 } from 'uuid';

// ============================================================
// ТИПЫ ЧАНКОВ
// ============================================================
export const CHUNK_TYPES = {
    BUSINESS_RULE: 'business_rule',           // Бизнес-правила
    UI_RULE: 'ui_rule',                       // UI-правила (кнопки, поля, модальные окна)
    API_CONTRACT: 'api_contract',             // API-контракты
    VALIDATION_RULE: 'validation_rule',        // Правила валидации
    ERROR_HANDLING: 'error_handling',          // Обработка ошибок
    SCENARIO_STEP: 'scenario_step',           // Шаги сценария
    REFERENCE_CONTEXT: 'reference_context',     // Справочный контекст
    NOISE_METADATA: 'noise_metadata',         // Метаданные/шум
    COMPOSITE: 'composite',                   // Составной чанк
    TABLE_ROW: 'table_row'                    // Строка таблицы требований
};

// ============================================================
// ОСНОВНАЯ ФУНКЦИЯ: CHUNKIFY
// ============================================================

/**
 * Основная функция чанкизации документа
 * @param {string} markdown - Markdown текст из Confluence
 * @param {Object} metadata - Метаданные документа
 * @returns {Promise<Array>} Массив чанков
 */
export async function chunkify(markdown, metadata = {}) {
    console.log(`[semanticChunking] Начинаю чанкизацию документа: ${metadata.title || 'unknown'}`);
    
    const docId = metadata.pageId || metadata.id || uuidv4();
    const docTitle = metadata.title || 'Untitled';
    
    // Этап 1: Парсинг структуры документа
    const sections = parseDocumentStructure(markdown);
    console.log(`[semanticChunking] Найдено секций: ${sections.length}`);
    
    // Этап 2: Семантическая чанкизация
    let chunks = [];
    let currentComposite = null;
    
    for (const section of sections) {
        // Классифицируем секцию
        const chunkType = classifySection(section);
        
        // Фильтруем шум
        if (chunkType === CHUNK_TYPES.NOISE_METADATA ||
            chunkType === CHUNK_TYPES.TABLE_ROW) {
            continue;
        }
        
        // Создаём atomic chunk
        const atomicChunk = createAtomicChunk(section, {
            doc_id: docId,
            doc_title: docTitle,
            chunk_type: chunkType,
            section_path: section.path
        });

        if (!atomicChunk) {
            continue;
        }
        
        // Определяем, нужно ли объединять с предыдущим (composite chunk)
        const shouldMerge = shouldMergeWithPrevious(atomicChunk, currentComposite);
        
        if (shouldMerge && currentComposite) {
            // Добавляем к существующему composite chunk
            currentComposite.atomic_chunks.push(atomicChunk.id);
            currentComposite.cleaned_text += '\n\n' + atomicChunk.cleaned_text;
            currentComposite.linked_chunk_ids.push(atomicChunk.id);
        } else {
            // Завершаем предыдущий composite
            if (currentComposite) {
                chunks.push(finalizeCompositeChunk(currentComposite));
            }
            
            // Начинаем новый composite, если это бизнес-правило или UI-правило
            if (chunkType === CHUNK_TYPES.BUSINESS_RULE || 
                chunkType === CHUNK_TYPES.UI_RULE ||
                chunkType === CHUNK_TYPES.API_CONTRACT) {
                currentComposite = createCompositeChunk(atomicChunk);
            } else {
                chunks.push(atomicChunk);
                currentComposite = null;
            }
        }
    }
    
    // Завершаем последний composite
    if (currentComposite) {
        chunks.push(finalizeCompositeChunk(currentComposite));
    }
    
    console.log(`[semanticChunking] Создано чанков: ${chunks.length} (atomic + composite)`);
    
    return chunks;
}

// ============================================================
// ЭТАП 1: PARSE DOCUMENT STRUCTURE
// ============================================================

/**
 * Парсит структуру документа Markdown
 * @param {string} markdown 
 * @returns {Array} Массив секций
 */
function parseDocumentStructure(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let currentSection = null;
    let currentHeading = [];
    let sectionContent = [];
    let lineNumber = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        lineNumber = i + 1;
        
        // Проверяем заголовок с нумерацией (например "3.1.2 Название" или "1. Требование")
        const headingWithNumberMatch = line.match(/^(#{1,6})\s+(\d+(?:[\.\)]\d+)*)\s+(.+)$/);
        if (headingWithNumberMatch) {
            // Сохраняем предыдущую секцию
            if (currentSection && sectionContent.length > 0) {
                currentSection.content = sectionContent.join('\n').trim();
                sections.push(currentSection);
            }
            
            // Начинаем новую секцию
            const level = headingWithNumberMatch[1].length;
            const sectionNumber = headingWithNumberMatch[2].trim();
            const text = headingWithNumberMatch[3].trim();
            
            // Обновляем путь заголовков
            currentHeading = currentHeading.slice(0, level - 1);
            currentHeading.push(text);
            
            currentSection = {
                type: 'heading',
                heading_level: level,
                section_number: sectionNumber,
                heading: text,
                path: [...currentHeading],
                content: '',
                line_start: lineNumber,
                line_end: lineNumber,
                elements: []
            };
            sectionContent = [];
            continue;
        }
        
        // Проверяем заголовок без номера
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            // Сохраняем предыдущую секцию
            if (currentSection && sectionContent.length > 0) {
                currentSection.content = sectionContent.join('\n').trim();
                sections.push(currentSection);
            }
            
            // Начинаем новую секцию
            const level = headingMatch[1].length;
            const text = headingMatch[2].trim();
            
            // Обновляем путь заголовков
            currentHeading = currentHeading.slice(0, level - 1);
            currentHeading.push(text);
            
            currentSection = {
                type: 'heading',
                heading_level: level,
                heading: text,
                path: [...currentHeading],
                content: '',
                line_start: lineNumber,
                line_end: lineNumber,
                elements: []
            };
            sectionContent = [];
            continue;
        }
        
        // Проверяем нумерованный список
        const numberedMatch = line.match(/^(\s*)(\d+[\.\)]\s+)(.+)$/);
        if (numberedMatch) {
            const indent = numberedMatch[1].length;
            const number = numberedMatch[2];
            const text = numberedMatch[3].trim();
            
            if (currentSection) {
                currentSection.elements.push({
                    type: 'numbered_item',
                    indent,
                    number,
                    text,
                    line_number: lineNumber
                });
            }
            sectionContent.push(line);
            if (currentSection) currentSection.line_end = lineNumber;
            continue;
        }
        
        // Проверяем маркированный список
        const bulletMatch = line.match(/^(\s*)([-*•]\s+)(.+)$/);
        if (bulletMatch) {
            const indent = bulletMatch[1].length;
            const marker = bulletMatch[2];
            const text = bulletMatch[3].trim();
            
            if (currentSection) {
                currentSection.elements.push({
                    type: 'bullet_item',
                    indent,
                    marker,
                    text,
                    line_number: lineNumber
                });
            }
            sectionContent.push(line);
            if (currentSection) currentSection.line_end = lineNumber;
            continue;
        }
        
        // Проверяем таблицу
        const tableMatch = line.match(/^\|.+\|$/);
        if (tableMatch) {
            if (currentSection) {
                currentSection.elements.push({
                    type: 'table_row',
                    text: line,
                    line_number: lineNumber
                });
            }
            sectionContent.push(line);
            if (currentSection) currentSection.line_end = lineNumber;
            continue;
        }
        
        // Проверяем блок кода
        const codeMatch = line.match(/^```/);
        if (codeMatch) {
            if (currentSection) {
                currentSection.elements.push({
                    type: 'code_block',
                    text: line,
                    line_number: lineNumber
                });
            }
            sectionContent.push(line);
            if (currentSection) currentSection.line_end = lineNumber;
            continue;
        }
        
        // Обычный текст
        if (line.trim()) {
            sectionContent.push(line);
            if (currentSection) currentSection.line_end = lineNumber;
        }
    }
    
    // Добавляем последнюю секцию
    if (currentSection && sectionContent.length > 0) {
        currentSection.content = sectionContent.join('\n').trim();
        sections.push(currentSection);
    }
    
    return sections;
}

// ============================================================
// ЭТАП 2: CLASSIFY SECTION
// ============================================================

/**
 * Классифицирует тип секции на основе ключевых слов
 * @param {Object} section 
 * @returns {string} Тип чанка
 */
function classifySection(section) {
    const chunkableContent = getChunkableSectionText(section);
    const text = `${section.heading || ''} ${chunkableContent}`.toLowerCase();
    
    // Проверяем на шум (changelog, история, метаданные)
    if (isNoise(text)) {
        return CHUNK_TYPES.NOISE_METADATA;
    }
    
    // Проверяем API-контракты
    if (containsApiContract(text)) {
        return CHUNK_TYPES.API_CONTRACT;
    }
    
    // Проверяем обработку ошибок
    if (containsErrorHandling(text)) {
        return CHUNK_TYPES.ERROR_HANDLING;
    }
    
    // Проверяем UI-правила
    if (containsUIRule(text)) {
        return CHUNK_TYPES.UI_RULE;
    }
    
    // Проверяем валидацию
    if (containsValidationRule(text)) {
        return CHUNK_TYPES.VALIDATION_RULE;
    }
    
    // Проверяем бизнес-правила
    if (containsBusinessRule(text)) {
        return CHUNK_TYPES.BUSINESS_RULE;
    }
    
    // Проверяем таблицы требований
    if (section.elements?.some(el => el.type === 'table_row') && !chunkableContent.trim()) {
        return CHUNK_TYPES.TABLE_ROW;
    }
    
    // Проверяем шаги сценария
    if (containsScenarioStep(text)) {
        return CHUNK_TYPES.SCENARIO_STEP;
    }
    
    // По умолчанию - справочный контекст
    return CHUNK_TYPES.REFERENCE_CONTEXT;
}

function isNoise(text) {
    const noisePatterns = [
        /changelog/i,
        /история изменений/i,
        /version history/i,
        /history of changes/i,
        /автор:\s*/i,
        /согласовано:\s*/i,
        /утверждено:\s*/i,
        /статус:\s*(draft|черновик|новый)/i,
        /last updated/i,
        /date created/i,
        /created by/i,
        /авторский комментарий/i,
        /meta:/i,
        /^={5,}$/m,
        /^-+$/m
    ];
    
    return noisePatterns.some(pattern => pattern.test(text));
}

function containsApiContract(text) {
    const patterns = [
        /api\s*[-/]/i,
        /endpoint/i,
        /\/rest\//i,
        /post\s+.*\/get\s+.*\/put\s+.*\/delete/i,
        /метод\s+(get|post|put|delete|patch)/i,
        /запрос\s+(get|post|put|delete|patch)/i,
        /http\s+(method|code|status)/i,
        /request\s+(body|params|headers)/i,
        /response\s+(body|code|status)/i,
        /swagger/i,
        /openapi/i,
        /json\s+schema/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsErrorHandling(text) {
    const patterns = [
        /ошибк[ауи]/i,
        /exception/i,
        /error/i,
        /код ошибки/i,
        /status\s*4\d\d/i,
        /status\s*5\d\d/i,
        /not found/i,
        /bad request/i,
        /unauthorized/i,
        /forbidden/i,
        /validation error/i,
        /invalid\s+(input|data|request)/i,
        /timeout/i,
        /timeout/i,
        /исключени[ея]/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsUIRule(text) {
    const patterns = [
        /кнопк[ауи]/i,
        /поле[ау]?\s+(ввод|выбор|пароль|текст)/i,
        /модальн/i,
        /диалог/i,
        /окно/i,
        /экран/i,
        /интерфейс/i,
        /ui\s*[-/]/i,
        /отобразить/i,
        /скрыть/i,
        /показать/i,
        /клик/i,
        /нажать/i,
        /ввод/i,
        /выбор/i,
        /выпадающий\s+список/i,
        /чекбокс/i,
        /радио-кнопка/i,
        /переключатель/i,
        /таб/i,
        /вкладка/i,
        /меню/i,
        /ссылк[ау]/i,
        /главн[ау]?\s+страниц/i,
        /страница/i,
        /component/i,
        /element/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsValidationRule(text) {
    const patterns = [
        /валидаци[яюи]/i,
        /проверк[ауи]/i,
        /ограничени[ея]/i,
        /constraint/i,
        /required/i,
        /обязательн/i,
        /максимум/i,
        /минимум/i,
        /диапазон/i,
        /длина/i,
        /формат/i,
        /шаблон/i,
        /pattern/i,
        /regex/i,
        /regular expression/i,
        /не может быть пустым/i,
        /не может быть null/i,
        /должен содержать/i,
        /должен быть/i,
        /должн[ау]\s+быть/i,
        /не допускается/i,
        /не разрешено/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsBusinessRule(text) {
    const patterns = [
        /бизнес-правило/i,
        /бизнес\s*правило/i,
        /бизнес-требование/i,
        /требование\s+[A-ZА-Я]+/i,
        /functional\s+requirement/i,
        /business\s+rule/i,
        /должен\s+обеспечивать/i,
        /должен\s+поддерживать/i,
        /должен\s+позволять/i,
        /должен\s+выполнять/i,
        /система\s+должна/i,
        /пользователь\s+может/i,
        /при\s+выполнении/i,
        /в\s+результате/i,
        /следует\s+выполнить/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsScenarioStep(text) {
    const patterns = [
        /шаг/i,
        /сценарий/i,
        /user\s+story/i,
        /use\s+case/i,
        /user\s+action/i,
        /пользователь\s+(открывает|вводит|нажимает|выбирает|удаляет|редактирует)/i,
        /действие\s+пользователя/i,
        /предусловие/i,
        /постусловие/i,
        /given\s+when\s+then/i,
        /gherkin/i,
        /behavior/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

// ============================================================
// ЭТАП 3: CREATE CHUNKS
// ============================================================

function extractExplicitRefs(text) {
    if (!text) return [];
    
    const refs = [];
    const textLower = text.toLowerCase();
    
    // Паттерны для явных ссылок
    const patterns = [
        // см. пункт 2.3, см. раздел 1.2.3, см. подраздел
        { type: 'section_ref', regex: /см\.?\s*(?:пункт|раздел|подраздел|секцию)\s*([\d\.]+)/gi },
        //see section 2.3, see пункт
        { type: 'section_ref', regex: /see\s+(?:section| пункт| раздел)\s*([\d\.]+)/gi },
        // ссылка на документ "Название"
        { type: 'doc_ref', regex: /документ\s*["'"]([^"'"']+)["'"']/gi },
        // pageId=123456
        { type: 'pageId', regex: /pageId[=\s]*(\d+)/gi },
        // (см. выше), (см. ниже)
        { type: 'context_ref', regex: /\(см\.\s*(выше|ниже|рис\.|табл\.\s*\d+)\)/gi }
    ];
    
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.regex.exec(text)) !== null) {
            refs.push({
                type: pattern.type,
                target: match[1]?.trim(),
                original: match[0],
                position: match.index
            });
        }
    }
    
    // Убираем дубликаты
    const uniqueRefs = [];
    const seen = new Set();
    for (const ref of refs) {
        const key = ref.type + '|' + ref.target;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueRefs.push(ref);
        }
    }
    
    return uniqueRefs;
}

function createAtomicChunk(section, metadata) {
    const rawText = getChunkableSectionText(section);
    if (!rawText.trim()) {
        return null;
    }

    const cleanedText = cleanText(rawText);
    const explicitRefs = extractExplicitRefs(rawText);
    
    return {
        id: uuidv4(),
        doc_id: metadata.doc_id,
        doc_title: metadata.doc_title,
        section_path: metadata.section_path || [],
        
        // Номер раздела (например "3.1.2")
        section_number: section.section_number || null,
        
        heading: section.heading,
        heading_level: section.heading_level,
        
        raw_text: rawText,
        cleaned_text: cleanedText,
        
        chunk_type: metadata.chunk_type,
        
        parent_chunk_id: null,
        linked_chunk_ids: [],
        
        requirement_id: extractRequirementId(rawText),
        feature_name: metadata.doc_title,
        
        source_location: {
            line_start: section.line_start,
            line_end: section.line_end
        },
        token_count: estimateTokens(cleanedText),
        
        explicit_refs: explicitRefs,
        
        is_atomic: true,
        is_composite: false
    };
}

function createCompositeChunk(firstAtomicChunk) {
    return {
        id: uuidv4(),
        doc_id: firstAtomicChunk.doc_id,
        doc_title: firstAtomicChunk.doc_title,
        section_path: firstAtomicChunk.section_path,
        
        heading: firstAtomicChunk.heading,
        heading_level: firstAtomicChunk.heading_level,
        
        raw_text: firstAtomicChunk.raw_text,
        cleaned_text: firstAtomicChunk.cleaned_text,
        
        chunk_type: CHUNK_TYPES.COMPOSITE,
        
        parent_chunk_id: null,
        linked_chunk_ids: [firstAtomicChunk.id],
        atomic_chunks: [firstAtomicChunk.id],
        
        requirement_id: firstAtomicChunk.requirement_id,
        feature_name: firstAtomicChunk.feature_name,
        
        source_location: firstAtomicChunk.source_location,
        token_count: firstAtomicChunk.token_count,
        
        explicit_refs: firstAtomicChunk.explicit_refs || [],
        
        is_atomic: false,
        is_composite: true
    };
}

function finalizeCompositeChunk(composite) {
    // Извлекаем feature_name из заголовка
    const featureName = extractFeatureName(composite.heading);
    if (featureName) {
        composite.feature_name = featureName;
    }
    
    // Создаём summary
    composite.summary = createSummary(composite.cleaned_text);
    
    return composite;
}

// ============================================================
// ЭТАП 4: MERGE LOGIC - CONDITIONAL BRANCHES
// ============================================================

/**
 * Проверяет, является ли текст условной конструкцией (если → то → иначе)
 * Такие конструкции должны объединяться в один чанк
 */
function isConditionalBranch(text) {
    if (!text) return false;
    
    const conditionalPatterns = [
        /если\s+.+\s+то/i,
        /если\s+.+\s+иначе/i,
        /если\s+.+\s+в\s+противном\s+случае/i,
        /в\s+случае\s+.+\s+выполняется/i,
        /при\s+.+\s+выполняется/i,
        /when\s+.+\s+then/i,
        /if\s+.+\s+then/i,
        /при\s+условии/i,
        /допустим\s+/i,
        /предположим\s+/i
    ];
    
    return conditionalPatterns.some(pattern => pattern.test(text));
}

/**
 * Проверяет, является ли текст продолжением условной конструкции
 * (т.е. содержит "то", "иначе", "в противном случае" без нового "если")
 */
function isConditionalContinuation(text) {
    if (!text) return false;
    
    const continuationPatterns = [
        /\bто\b/i,
        /\bиначе\b/i,
        /\bв\s+противном\s+случае\b/i,
        /\bв\s+противном\b/i,
        /\bиначе\s+если\b/i,
        /\bто\s+выполняется\b/i,
        /\bто\s+отображается\b/i,
        /\bто\s+происходит\b/i,
        /\botherwise\b/i,
        /\belse\b/i,
        /\bthen\b/i
    ];
    
    return continuationPatterns.some(pattern => pattern.test(text));
}

/**
 * Проверяет, является ли текущий элемент началом нового условия
 * (начинается с "если", "когда" и т.д.)
 */
function isNewCondition(text) {
    if (!text) return false;
    
    const newConditionPatterns = [
        /^(если|когда|при|в\s+случае)\s+/i,
        /^если\b/i,
        /^когда\b/i,
        /^(if|when)\s+/i
    ];
    
    return newConditionPatterns.some(pattern => pattern.test(text.trim()));
}

function shouldMergeWithPrevious(atomicChunk, currentComposite) {
    if (!currentComposite) return false;
    
    // 1. Если текущий чанк - начало условной конструкции, а предыдущий - нет условие
    // объединяем чтобы не разрывать "если → то"
    const currentText = atomicChunk.cleaned_text || '';
    const prevText = currentComposite.cleaned_text || '';
    
    // Если предыдущий содержит условную конструкцию (если/то/иначе), а текущий продолжает её - объединяем
    if (isConditionalBranch(prevText) && isConditionalContinuation(currentText)) {
        return true;
    }
    
    // Если оба содержат условные конструкции - объединяем
    if (isConditionalBranch(prevText) && isConditionalBranch(currentText)) {
        return true;
    }
    
    // 2. Если предыдущий - таблица требований, а текущий - её продолжение (не новый заголовок)
    if (currentComposite.chunk_type === CHUNK_TYPES.TABLE_ROW && 
        atomicChunk.chunk_type === CHUNK_TYPES.TABLE_ROW) {
        return true;
    }
    
    // 3. Объединяем если типы совпадают и предыдущий не слишком большой
    const mergeableTypes = [
        CHUNK_TYPES.BUSINESS_RULE,
        CHUNK_TYPES.UI_RULE,
        CHUNK_TYPES.API_CONTRACT,
        CHUNK_TYPES.VALIDATION_RULE
    ];
    
    if (!mergeableTypes.includes(atomicChunk.chunk_type)) {
        return false;
    }
    
    // Проверяем, не слишком ли большой уже composite
    if (currentComposite.token_count > 800) {
        return false;
    }
    
    return true;
}

// ============================================================
// УТИЛИТЫ
// ============================================================

function cleanText(text) {
    if (!text) return '';
    
    return text
        // Удаляем лишние пробелы
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        // Удаляем URL из текста (они в metadata)
        .replace(/https?:\/\/[^\s]+/g, '')
        // Удаляем спецсимволы markdown которые не несут смысла
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) -> text
        .replace(/[*_`#]/g, '')
        .trim();
}

function getChunkableSectionText(section) {
    return flattenMarkdownTables(section?.content || '');
}

function flattenMarkdownTables(text) {
    if (!text) return '';

    const lines = text.split('\n');
    const normalizedLines = [];
    let tableLines = [];

    const flushTable = () => {
        if (!tableLines.length) return;

        const flattenedTable = flattenMarkdownTableBlock(tableLines);
        if (flattenedTable) {
            normalizedLines.push(flattenedTable);
        }

        tableLines = [];
    };

    for (const line of lines) {
        if (isMarkdownTableLine(line)) {
            tableLines.push(line);
            continue;
        }

        flushTable();
        normalizedLines.push(line);
    }

    flushTable();

    return normalizedLines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function isMarkdownTableLine(line) {
    return /^\|.+\|$/.test((line || '').trim());
}

function flattenMarkdownTableBlock(lines) {
    const rows = lines
        .map(parseMarkdownTableRow)
        .filter(cells => cells.length > 0);

    if (!rows.length) {
        return '';
    }

    const hasHeader = rows.length >= 2 && isMarkdownTableSeparatorRow(rows[1]);
    if (hasHeader) {
        const headers = rows[0].map((cell, index) => normalizeTableCellText(cell) || `column ${index + 1}`);
        const dataRows = rows.slice(2);

        if (!dataRows.length) {
            return headers.join('; ');
        }

        return dataRows
            .map(row => formatMarkdownTableRow(row, headers))
            .filter(Boolean)
            .join('\n');
    }

    return rows
        .filter(row => !isMarkdownTableSeparatorRow(row))
        .map(row => formatMarkdownTableRow(row))
        .filter(Boolean)
        .join('\n');
}

function parseMarkdownTableRow(line) {
    const trimmed = (line || '').trim();
    if (!trimmed) {
        return [];
    }

    return trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map(cell => cell.trim());
}

function isMarkdownTableSeparatorRow(cells) {
    return Array.isArray(cells) &&
        cells.length > 0 &&
        cells.every(cell => /^:?-+:?$/.test((cell || '').trim()));
}

function formatMarkdownTableRow(cells, headers = null) {
    const normalizedCells = cells.map(cell => normalizeTableCellText(cell));
    const hasAnyValue = normalizedCells.some(Boolean);
    if (!hasAnyValue) {
        return '';
    }

    if (headers && headers.length) {
        return normalizedCells
            .map((value, index) => `${headers[index] || `column ${index + 1}`}: ${value}`)
            .join('; ');
    }

    return normalizedCells.join('; ');
}

function normalizeTableCellText(cell) {
    return String(cell || '')
        .replace(/\\\|/g, '|')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`#]/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function extractRequirementId(text) {
    if (!text) return null;
    
    const patterns = [
        /REQ[-_]?(\d+)/i,
        /Требование[-_]?(\d+)/i,
        /FR[-_]?(\d+)/i,
        /BR[-_]?(\d+)/i,
        /ID[:\s]+(\d{4,})/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[0];
        }
    }
    
    return null;
}

function extractFeatureName(heading) {
    if (!heading) return null;
    
    // Убираем нумерацию в начале
    const cleaned = heading.replace(/^\d+[\.\)]\s*/, '').trim();
    
    // Если слишком длинное - обрезаем
    if (cleaned.length > 100) {
        return cleaned.substring(0, 100) + '...';
    }
    
    return cleaned;
}

function createSummary(text) {
    if (!text) return '';
    
    // Берём первые 200 символов как summary
    const summary = text.substring(0, 200).trim();
    
    if (text.length > 200) {
        return summary + '...';
    }
    
    return summary;
}

function estimateTokens(text) {
    if (!text) return 0;
    
    // Грубая оценка: ~4 символа на токен
    return Math.ceil(text.length / 4);
}

// ============================================================
// ЭКСПОРТ ДОПОЛНИТЕЛЬНЫХ ФУНКЦИЙ
// ============================================================

/**
 * Создаёт связи между чанками на основе перекрёстных ссылок
 * @param {Array} chunks 
 * @returns {Array} Чанки с заполненными linked_chunk_ids
 */
export function linkChunks(chunks) {
    // Создаём индекс для быстрого поиска
    const chunksByHeading = new Map();
    const chunksByRequirement = new Map();
    
    chunks.forEach(chunk => {
        // Индексируем по заголовку
        if (chunk.heading) {
            const normalizedHeading = chunk.heading.toLowerCase().trim();
            if (!chunksByHeading.has(normalizedHeading)) {
                chunksByHeading.set(normalizedHeading, []);
            }
            chunksByHeading.get(normalizedHeading).push(chunk.id);
        }
        
        // Индексируем по requirement_id
        if (chunk.requirement_id) {
            if (!chunksByRequirement.has(chunk.requirement_id)) {
                chunksByRequirement.set(chunk.requirement_id, []);
            }
            chunksByRequirement.get(chunk.requirement_id).push(chunk.id);
        }
    });
    
    // Проходим по всем чанкам и создаём связи
    chunks.forEach(chunk => {
        // Ищем ссылки в тексте на другие заголовки
        if (chunk.cleaned_text) {
            chunksByHeading.forEach((ids, heading) => {
                if (chunk.id !== ids[0] && chunk.cleaned_text.toLowerCase().includes(heading)) {
                    // Добавляем связь если ещё не добавлена
                    ids.forEach(linkedId => {
                        if (linkedId !== chunk.id && !chunk.linked_chunk_ids.includes(linkedId)) {
                            chunk.linked_chunk_ids.push(linkedId);
                        }
                    });
                }
            });
        }
    });
    
    return chunks;
}

/**
 * Получает связанные чанки для данного chunk
 * @param {string} chunkId 
 * @param {Array} allChunks 
 * @returns {Array} Связанные чанки
 */
export function getRelatedChunks(chunkId, allChunks) {
    const chunk = allChunks.find(c => c.id === chunkId);
    if (!chunk) return [];
    
    return chunk.linked_chunk_ids
        .map(id => allChunks.find(c => c.id === id))
        .filter(Boolean);
}
