// semanticChunking.mjs
// Семантическая чанкизация требований из Confluence для RAG-системы

import { v4 as uuidv4 } from 'uuid';

function containsReferenceLinks(text) {
    const patterns = [
        /https?:\/\//i,
        /pageid=\d{4,}/i,
        /viewpage\.action\?pageId=\d{4,}/i,
        /figma\.com/i,
        /confluence/i,
        /jira/i,
        /см\.\s*(пункт|раздел|подраздел|section)/i,
        /see\s+(section|page)/i
    ];

    return patterns.some(pattern => pattern.test(text));
}

// ============================================================
// ТИПЫ ЧАНКОВ
// ============================================================
export const CHUNK_TYPES = {
    REQUIREMENT_ROW: 'requirement_row',
    SCENARIO_BRANCH: 'scenario_branch',
    API_ENDPOINT_SUMMARY: 'api_endpoint_summary',
    API_INPUT_PARAMS: 'api_input_params',
    API_OUTPUT_PARAMS: 'api_output_params',
    API_BEHAVIOR_NOTES: 'api_behavior_notes',
    UI_CURRENT_BEHAVIOR: 'ui_current_behavior',
    REFERENCE_LINK: 'reference_link',
    NOISE_SKIPPED: 'noise_skipped',
    DOCUMENT_META: 'document_meta',
    CHANGE_LOG: 'change_log',
    BUSINESS_CONTEXT: 'business_context',
    SCOPE_CONTEXT: 'scope_context',
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

const RETRIEVAL_EXCLUDED_CHUNK_TYPES = new Set([
    CHUNK_TYPES.DOCUMENT_META,
    CHUNK_TYPES.CHANGE_LOG,
    CHUNK_TYPES.NOISE_METADATA,
    CHUNK_TYPES.NOISE_SKIPPED,
    CHUNK_TYPES.REFERENCE_LINK
]);

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
    const sections = expandSectionsForChunking(parseDocumentStructure(markdown));
    console.log(`[semanticChunking] Найдено секций: ${sections.length}`);
    
    // Этап 2: Семантическая чанкизация
    let chunks = [];
    let currentComposite = null;
    
    for (const section of sections) {
        // Классифицируем секцию
        const chunkType = classifySection(section);
        
        // Фильтруем шум
        if (chunkType === CHUNK_TYPES.NOISE_METADATA ||
            chunkType === CHUNK_TYPES.NOISE_SKIPPED ||
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
                chunkType === CHUNK_TYPES.UI_CURRENT_BEHAVIOR ||
                chunkType === CHUNK_TYPES.API_CONTRACT ||
                chunkType === CHUNK_TYPES.API_ENDPOINT_SUMMARY) {
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
    if (section?.chunk_type_hint) {
        return section.chunk_type_hint;
    }

    const specialType = detectSpecialContextType(section);
    if (specialType) {
        return specialType;
    }

    const chunkableContent = getChunkableSectionText(section);
    const text = `${section.heading || ''} ${chunkableContent}`.toLowerCase();
    
    // Проверяем на шум (changelog, история, метаданные)
    if (isNoise(text)) {
        return CHUNK_TYPES.NOISE_METADATA;
    }

    if (containsReferenceLinks(text) && !containsApiContract(text)) {
        return CHUNK_TYPES.REFERENCE_LINK;
    }
    
    // Проверяем API-контракты
    if (containsApiContract(text)) {
        return CHUNK_TYPES.API_ENDPOINT_SUMMARY;
    }
    
    // Проверяем обработку ошибок
    if (containsErrorHandling(text)) {
        return CHUNK_TYPES.ERROR_HANDLING;
    }
    
    // Проверяем UI-правила
    if (containsUIRule(text)) {
        return CHUNK_TYPES.UI_CURRENT_BEHAVIOR;
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
    const additionalPatterns = [
        { type: 'section_ref', regex: /(?:см\.?\s*(?:пункт|раздел|подраздел|секц(?:ия|ию))|see\s+(?:section|subsection|paragraph))\s*([\d.]+)/gi },
        { type: 'doc_ref', regex: /документ\s*["'«]([^"'»]+)["'»]/gi },
        { type: 'doc_ref', regex: /\[([^\]]+)\]\((?:https?:\/\/[^\s)]*?)?(?:viewpage\.action\?pageId=\d+|\/pages\/\d+)[^)]+\)/gi },
        { type: 'pageId', regex: /pageId[=\s:]*(\d{4,})/gi },
        { type: 'pageId', regex: /viewpage\.action\?pageId=(\d{4,})/gi },
        { type: 'pageId', regex: /\/pages\/(\d{4,})/gi },
        { type: 'context_ref', regex: /\((?:см\.?\s*)?(выше|ниже|рис\.?\s*\d+|табл\.?\s*\d+)\)/gi }
    ];

    for (const pattern of additionalPatterns) {
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
    if (!isMeaningfulChunkText(cleanedText)) {
        return null;
    }
    const mergedMetadata = {
        ...(section.metadata || {}),
        split_source: metadata.split_source || section.split_source || null
    };
    const explicitRefSource = [rawText, mergedMetadata.source_ref_text]
        .filter(Boolean)
        .join('\n');
    const explicitRefs = extractExplicitRefs(explicitRefSource);
    const excludeFromRetrieval =
        Boolean(mergedMetadata.exclude_from_retrieval) ||
        shouldExcludeChunkTypeFromRetrieval(metadata.chunk_type);
    
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
        split_source: metadata.split_source || section.split_source || null,
        
        parent_chunk_id: null,
        linked_chunk_ids: [],
        
        requirement_id: section?.metadata?.row_number || extractRequirementId(rawText),
        feature_name: metadata.doc_title,
        metadata: {
            ...mergedMetadata,
            exclude_from_retrieval: excludeFromRetrieval
        },
        exclude_from_retrieval: excludeFromRetrieval,
        
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
        split_source: firstAtomicChunk.split_source || null,
        
        parent_chunk_id: null,
        linked_chunk_ids: [firstAtomicChunk.id],
        atomic_chunks: [firstAtomicChunk.id],
        
        requirement_id: firstAtomicChunk.requirement_id,
        feature_name: firstAtomicChunk.feature_name,
        metadata: { ...(firstAtomicChunk.metadata || {}) },
        exclude_from_retrieval: Boolean(firstAtomicChunk.exclude_from_retrieval),
        
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

    if (atomicChunk.split_source === 'table_row' || currentComposite.split_source === 'table_row') {
        return false;
    }

    const currentPath = JSON.stringify(atomicChunk.section_path || []);
    const prevPath = JSON.stringify(currentComposite.section_path || []);
    if (atomicChunk.heading !== currentComposite.heading || currentPath !== prevPath) {
        return false;
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
        CHUNK_TYPES.UI_CURRENT_BEHAVIOR,
        CHUNK_TYPES.API_CONTRACT,
        CHUNK_TYPES.API_ENDPOINT_SUMMARY,
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
        .replace(/(?<!\]\()https?:\/\/[^\s]+/g, '')
        // Удаляем спецсимволы markdown которые не несут смысла
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) -> text
        .replace(/[*_`#]/g, '')
        .trim();
}

function isMeaningfulChunkText(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) {
        return false;
    }

    if (/^[-–—\\/|.,:;()[\]{}*_`~]+$/.test(cleaned)) {
        return false;
    }

    const alnum = cleaned.replace(/[^a-zA-Zа-яА-Я0-9]+/g, '');
    if (!alnum) {
        return false;
    }

    if (alnum.length < 3 && cleaned.length < 5) {
        return false;
    }

    return true;
}

function getChunkableSectionText(section) {
    return flattenMarkdownTables(section?.content || '');
}

function expandSectionsForChunking(sections) {
    const expanded = [];

    for (const section of sections || []) {
        expanded.push(...expandSectionIntoSemanticUnits(section));
    }

    return expanded;
}

function explodeTableHeavySection(section) {
    if (!section?.content || !section?.elements?.some(el => el.type === 'table_row')) {
        return [section];
    }

    const flattened = getChunkableSectionText(section);
    const rows = String(flattened || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (rows.length <= 1) {
        return [section];
    }

    return rows.map((rowText, index) => ({
        ...section,
        content: rowText,
        split_source: 'table_row',
        heading: buildRowHeading(section.heading, rowText, index),
        line_end: section.line_start
    }));
}

function buildRowHeading(baseHeading, rowText, index) {
    const raw = String(rowText || '').trim();
    const numberMatch = raw.match(/^(?:№\s*:\s*|№\s*)([\d.]+)/i) || raw.match(/^([\d.]{3,})\s*[;:]/);
    if (numberMatch?.[1]) {
        return `${baseHeading || 'Table row'} / ${numberMatch[1]}`;
    }

    const compact = cleanText(raw).replace(/\s+/g, ' ').trim();
    if (compact && compact.length <= 80) {
        return `${baseHeading || 'Table row'} / ${compact}`;
    }

    return `${baseHeading || 'Table row'} / row ${index + 1}`;
}

function expandSectionIntoSemanticUnits(section, depth = 0) {
    if (!section) {
        return [];
    }

    if (section.generated_semantic_unit || depth > 2) {
        return [section];
    }

    const requirementSections = buildRequirementRowSections(section);
    if (requirementSections.length) {
        return requirementSections;
    }

    const specialContextSection = buildSpecialContextSection(section);
    if (specialContextSection) {
        return [specialContextSection];
    }

    const listSections = buildTopLevelListSections(section);
    if (listSections.length) {
        return listSections.flatMap(item => expandSectionIntoSemanticUnits(item, depth + 1));
    }

    const apiSections = buildApiSemanticSections(section);
    if (apiSections.length) {
        return apiSections;
    }

    const referenceSection = buildReferenceLinkSection(section);
    if (referenceSection) {
        return [referenceSection];
    }

    return [section];
}

function buildRequirementRowSections(section) {
    const semanticSections = [];

    for (const block of extractTableBlocksWithLines(section)) {
        const parsedBlock = parseStructuredTableBlock(block);
        if (!parsedBlock || !isRequirementTable(parsedBlock.headers)) {
            continue;
        }

        for (const row of parsedBlock.rows) {
            const mappedRow = mapTableRowToCanonical(parsedBlock.headers, row.cells);
            if (!isMeaningfulRequirementRow(mappedRow)) {
                continue;
            }

            const branchSplit = splitRequirementIntoScenarioBranches(mappedRow.requirement || '');
            const rowHeading = buildRequirementRowHeading(section.heading, mappedRow.row_number, mappedRow.element);
            const sectionPath = buildSectionPathForRow(section.path, mappedRow.row_number || mappedRow.element);
            const rowMetadata = buildRequirementChunkMetadata(mappedRow, branchSplit.sharedIntro);

            if (branchSplit.branches.length > 1) {
                branchSplit.branches.forEach((branch, index) => {
                    semanticSections.push(createFinalSemanticSection(section, {
                        heading: `${rowHeading} / branch ${branch.label || index + 1}`,
                        path: sectionPath,
                        section_number: mappedRow.row_number || section.section_number || null,
                        line_start: row.line_start,
                        line_end: row.line_end,
                        split_source: 'scenario_branch',
                        chunk_type_hint: CHUNK_TYPES.SCENARIO_BRANCH,
                        metadata: {
                            ...rowMetadata,
                            semantic_role: CHUNK_TYPES.SCENARIO_BRANCH,
                            row_number: mappedRow.row_number || null,
                            element: mappedRow.element || null,
                            branch_index: index + 1,
                            branch_label: branch.label || null,
                            branch_source_number: branch.sourceNumber || null,
                            scenario_seed_text: branch.text || null
                        },
                        content: buildRequirementBranchContent(mappedRow, branchSplit.sharedIntro, branch)
                    }));
                });
                continue;
            }

            semanticSections.push(createFinalSemanticSection(section, {
                heading: rowHeading,
                path: sectionPath,
                section_number: mappedRow.row_number || section.section_number || null,
                line_start: row.line_start,
                line_end: row.line_end,
                split_source: 'requirement_row',
                chunk_type_hint: CHUNK_TYPES.REQUIREMENT_ROW,
                metadata: {
                    ...rowMetadata,
                    semantic_role: CHUNK_TYPES.REQUIREMENT_ROW,
                    row_number: mappedRow.row_number || null,
                    element: mappedRow.element || null
                },
                content: buildRequirementRowContent(mappedRow)
            }));
        }
    }

    if (!semanticSections.length) {
        semanticSections.push(...buildRequirementRowSectionsFromFlattenedTable(section));
    }

    return semanticSections;
}

function buildRequirementRowSectionsFromFlattenedTable(section) {
    const semanticSections = [];
    const flattened = flattenMarkdownTables(section?.content || '');
    const lines = String(flattened || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        if (!looksLikeFlattenedRequirementRow(line)) {
            continue;
        }

        const mappedRow = parseFlattenedRequirementRow(line);
        if (!isMeaningfulRequirementRow(mappedRow)) {
            continue;
        }

        const branchSplit = splitRequirementIntoScenarioBranches(mappedRow.requirement || '');
        const rowHeading = buildRequirementRowHeading(section.heading, mappedRow.row_number, mappedRow.element);
        const sectionPath = buildSectionPathForRow(section.path, mappedRow.row_number || mappedRow.element);
        const rowMetadata = buildRequirementChunkMetadata(mappedRow, branchSplit.sharedIntro);

        if (branchSplit.branches.length > 1) {
            branchSplit.branches.forEach((branch, index) => {
                semanticSections.push(createFinalSemanticSection(section, {
                    heading: `${rowHeading} / branch ${branch.label || index + 1}`,
                    path: sectionPath,
                    section_number: mappedRow.row_number || section.section_number || null,
                    line_start: section.line_start,
                    line_end: section.line_end,
                    split_source: 'scenario_branch',
                    chunk_type_hint: CHUNK_TYPES.SCENARIO_BRANCH,
                    metadata: {
                        ...rowMetadata,
                        semantic_role: CHUNK_TYPES.SCENARIO_BRANCH,
                        row_number: mappedRow.row_number || null,
                        element: mappedRow.element || null,
                        branch_index: index + 1,
                        branch_label: branch.label || null,
                        branch_source_number: branch.sourceNumber || null,
                        scenario_seed_text: branch.text || null
                    },
                    content: buildRequirementBranchContent(mappedRow, branchSplit.sharedIntro, branch)
                }));
            });
            continue;
        }

        semanticSections.push(createFinalSemanticSection(section, {
            heading: rowHeading,
            path: sectionPath,
            section_number: mappedRow.row_number || section.section_number || null,
            line_start: section.line_start,
            line_end: section.line_end,
            split_source: 'requirement_row',
            chunk_type_hint: CHUNK_TYPES.REQUIREMENT_ROW,
            metadata: {
                ...rowMetadata,
                semantic_role: CHUNK_TYPES.REQUIREMENT_ROW,
                row_number: mappedRow.row_number || null,
                element: mappedRow.element || null
            },
            content: buildRequirementRowContent(mappedRow)
        }));
    }

    return semanticSections;
}

function looksLikeFlattenedRequirementRow(line) {
    return /(^|;\s*)(No|№|Номер|Element|Элемент|Requirement|Требование)\s*:/i.test(line);
}

function parseFlattenedRequirementRow(line) {
    const fieldRegex = /(^|;\s*)(No|№|Номер|Element|Элемент(?:\/блок\/логика)?|Requirement|Требование|Method|Метод|Parameters|Параметры|Layout|Макет)\s*:\s*/gi;
    const matches = Array.from(line.matchAll(fieldRegex));
    const row = {};

    for (let index = 0; index < matches.length; index++) {
        const match = matches[index];
        const valueStart = (match.index || 0) + match[0].length;
        const valueEnd = matches[index + 1]?.index ?? line.length;
        const rawValue = line.slice(valueStart, valueEnd).replace(/;\s*$/, '').trim();
        row[normalizeFlattenedRequirementField(match[2])] = rawValue;
    }

    return row;
}

function normalizeFlattenedRequirementField(field) {
    const normalized = normalizeForComparison(field);
    if (normalized === 'no' || normalized.includes('номер')) {
        return 'row_number';
    }
    if (normalized.includes('element') || normalized.includes('элемент') || normalized.includes('блок') || normalized.includes('логик')) {
        return 'element';
    }
    if (normalized.includes('requirement') || normalized.includes('требован')) {
        return 'requirement';
    }
    if (normalized.includes('method') || normalized.includes('метод')) {
        return 'method';
    }
    if (normalized.includes('parameter') || normalized.includes('параметр')) {
        return 'params';
    }
    if (normalized.includes('layout') || normalized.includes('макет')) {
        return 'layout';
    }

    return field;
}

function buildTopLevelListSections(section) {
    if (!section?.content || section?.elements?.some(el => el.type === 'table_row')) {
        return [];
    }

    const lines = String(section.content || '').split('\n');
    const sections = [];
    let currentItem = null;

    const flushCurrentItem = () => {
        if (!currentItem) return;

        const content = currentItem.lines.join('\n').trim();
        if (isMeaningfulChunkText(cleanText(content))) {
            sections.push({
                ...section,
                content,
                heading: buildNestedHeading(section.heading, currentItem.number, currentItem.title),
                path: buildSectionPathForRow(section.path, currentItem.title || currentItem.number),
                line_start: currentItem.line_start,
                line_end: currentItem.line_end,
                split_source: 'numbered_item',
                metadata: {
                    ...(section.metadata || {}),
                    semantic_role: 'numbered_item',
                    item_number: currentItem.number
                }
            });
        }

        currentItem = null;
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const match = line.match(/^(\d+[\.\)])\s+(.+)$/);
        if (match) {
            flushCurrentItem();
            currentItem = {
                number: match[1],
                title: match[2].trim(),
                lines: [line],
                line_start: (section.line_start || 0) + index,
                line_end: (section.line_start || 0) + index
            };
            continue;
        }

        if (currentItem) {
            currentItem.lines.push(line);
            currentItem.line_end = (section.line_start || 0) + index;
        }
    }

    flushCurrentItem();
    return sections.length >= 2 ? sections : [];
}

function buildApiSemanticSections(section) {
    const source = String(section?.content || '').trim();
    if (!source) {
        return [];
    }

    const endpoint = extractEndpointSignature(`${section.heading || ''}\n${source}`);
    const apiBlocks = partitionApiContent(source, section);
    const normalizedHeading = normalizeForComparison(section.heading || '');
    const looksLikeApi = Boolean(
        endpoint ||
        apiBlocks.hasMarkers ||
        normalizedHeading.includes('rest') ||
        normalizedHeading.includes('api') ||
        normalizeForComparison(source).includes('/rest/') ||
        normalizeForComparison(source).includes('/api/')
    );

    if (!looksLikeApi) {
        return [];
    }

    const units = [];
    const baseHeading = endpoint || section.heading || 'API';
    const basePath = buildSectionPathForRow(section.path, endpoint || section.heading || 'API');

    const summaryText = buildApiSummaryText(section, endpoint, apiBlocks.summary, apiBlocks);
    if (summaryText) {
        units.push(createFinalSemanticSection(section, {
            heading: `${baseHeading} / summary`,
            path: basePath,
            split_source: 'api_summary',
            chunk_type_hint: CHUNK_TYPES.API_ENDPOINT_SUMMARY,
            metadata: {
                semantic_role: CHUNK_TYPES.API_ENDPOINT_SUMMARY,
                endpoint: endpoint || null
            },
            content: summaryText
        }));
    }

    const inputText = buildApiBlockText(section, endpoint, apiBlocks.input, 'Input params');
    if (inputText) {
        units.push(createFinalSemanticSection(section, {
            heading: `${baseHeading} / input params`,
            path: basePath,
            split_source: 'api_input',
            chunk_type_hint: CHUNK_TYPES.API_INPUT_PARAMS,
            metadata: {
                semantic_role: CHUNK_TYPES.API_INPUT_PARAMS,
                endpoint: endpoint || null
            },
            content: inputText
        }));
    }

    const outputText = buildApiBlockText(section, endpoint, apiBlocks.output, 'Output params');
    if (outputText) {
        units.push(createFinalSemanticSection(section, {
            heading: `${baseHeading} / output params`,
            path: basePath,
            split_source: 'api_output',
            chunk_type_hint: CHUNK_TYPES.API_OUTPUT_PARAMS,
            metadata: {
                semantic_role: CHUNK_TYPES.API_OUTPUT_PARAMS,
                endpoint: endpoint || null
            },
            content: outputText
        }));
    }

    const behaviorText = buildApiBlockText(section, endpoint, apiBlocks.behavior, 'Behavior notes');
    if (behaviorText) {
        units.push(createFinalSemanticSection(section, {
            heading: `${baseHeading} / behavior notes`,
            path: basePath,
            split_source: 'api_behavior',
            chunk_type_hint: CHUNK_TYPES.API_BEHAVIOR_NOTES,
            metadata: {
                semantic_role: CHUNK_TYPES.API_BEHAVIOR_NOTES,
                endpoint: endpoint || null
            },
            content: behaviorText
        }));
    }

    const errorText = buildApiBlockText(section, endpoint, apiBlocks.error, 'Error handling');
    if (errorText) {
        units.push(createFinalSemanticSection(section, {
            heading: `${baseHeading} / errors`,
            path: basePath,
            split_source: 'api_errors',
            chunk_type_hint: CHUNK_TYPES.ERROR_HANDLING,
            metadata: {
                semantic_role: CHUNK_TYPES.ERROR_HANDLING,
                endpoint: endpoint || null
            },
            content: errorText
        }));
    }

    return units;
}

function buildReferenceLinkSection(section) {
    const content = String(section?.content || '').trim();
    if (!content || !containsReferenceLinks(`${section.heading || ''}\n${content}`)) {
        return null;
    }

    if (containsApiContract(content) || containsUIRule(content) || containsBusinessRule(content)) {
        return null;
    }

    const cleaned = flattenMarkdownTables(content);
    if (!isMeaningfulChunkText(cleanText(cleaned))) {
        return null;
    }

    return createFinalSemanticSection(section, {
        heading: section.heading || 'Reference link',
        split_source: 'reference_link',
        chunk_type_hint: CHUNK_TYPES.REFERENCE_LINK,
        metadata: {
            semantic_role: CHUNK_TYPES.REFERENCE_LINK
        },
        content: cleaned
    });
}

function buildSpecialContextSection(section) {
    const chunkType = detectSpecialContextType(section);
    if (!chunkType) {
        return null;
    }

    const content = trimSemanticBlock(flattenMarkdownTables(section?.content || ''));
    if (!isMeaningfulChunkText(cleanText(content))) {
        return null;
    }

    return createFinalSemanticSection(section, {
        heading: section.heading || 'Context section',
        split_source: 'special_context',
        chunk_type_hint: chunkType,
        metadata: {
            semantic_role: chunkType,
            exclude_from_retrieval: shouldExcludeChunkTypeFromRetrieval(chunkType)
        },
        content
    });
}

function detectSpecialContextType(section) {
    const headingText = `${section?.heading || ''}\n${(section?.path || []).join(' > ')}`;
    if (!headingText.trim()) {
        return null;
    }

    if (/контекст по ссылке из основной статьи|упоминание в основной статье|linked context/i.test(headingText)) {
        return CHUNK_TYPES.NOISE_SKIPPED;
    }

    if (/вложения|attachments|приложения|test data|тестовые данные/i.test(headingText)) {
        return CHUNK_TYPES.NOISE_METADATA;
    }

    if (/данные документа|document meta|document data/i.test(headingText)) {
        return CHUNK_TYPES.DOCUMENT_META;
    }

    if (/change\s*log|changelog|история изменений/i.test(headingText)) {
        return CHUNK_TYPES.CHANGE_LOG;
    }

    if (/общая информация|business context|контекст системы/i.test(headingText)) {
        return CHUNK_TYPES.BUSINESS_CONTEXT;
    }

    if (/область применения|scope|границы процесса/i.test(headingText)) {
        return CHUNK_TYPES.SCOPE_CONTEXT;
    }

    return null;
}

function shouldExcludeChunkTypeFromRetrieval(chunkType) {
    return RETRIEVAL_EXCLUDED_CHUNK_TYPES.has(chunkType);
}

function createFinalSemanticSection(section, overrides = {}) {
    return {
        ...section,
        ...overrides,
        content: String(overrides.content || '').trim(),
        path: Array.isArray(overrides.path) ? overrides.path : (Array.isArray(section.path) ? [...section.path] : []),
        metadata: {
            ...(section.metadata || {}),
            ...(overrides.metadata || {})
        },
        generated_semantic_unit: true
    };
}

function extractTableBlocksWithLines(section) {
    const lines = String(section?.content || '').split('\n');
    const blocks = [];
    let currentRows = [];

    const flushCurrentBlock = () => {
        if (!currentRows.length) return;
        blocks.push({ rows: currentRows });
        currentRows = [];
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (isMarkdownTableLine(line)) {
            currentRows.push({
                line,
                line_number: (section.line_start || 0) + index
            });
            continue;
        }

        flushCurrentBlock();
    }

    flushCurrentBlock();
    return blocks;
}

function parseStructuredTableBlock(block) {
    const parsedRows = (block?.rows || [])
        .map(row => ({
            cells: parseMarkdownTableRow(row.line),
            line_number: row.line_number
        }))
        .filter(row => row.cells.length > 0);

    if (parsedRows.length < 2) {
        return null;
    }

    const hasHeader = parsedRows.length >= 2 && isMarkdownTableSeparatorRow(parsedRows[1].cells);
    if (!hasHeader) {
        return null;
    }

    return {
        headers: parsedRows[0].cells.map(normalizeTableCellText),
        rows: parsedRows.slice(2).map(row => ({
            cells: row.cells,
            line_start: row.line_number,
            line_end: row.line_number
        }))
    };
}

function isRequirementTable(headers = []) {
    const normalizedHeaders = headers.map(header => normalizeForComparison(header));
    const rawHeaders = headers.map(header => String(header || '').trim());
    const hasRowNumber = normalizedHeaders.some(header =>
        header === 'no' || header.includes('номер')
    ) || rawHeaders.includes('№');
    const hasRequirement = normalizedHeaders.some(header =>
        header.includes('требован') || header.includes('requirement')
    );
    const hasElement = normalizedHeaders.some(header =>
        header.includes('элемент') || header.includes('блок') || header.includes('логик') || header.includes('element')
    );

    return hasRowNumber && hasRequirement && hasElement;
}

function mapTableRowToCanonical(headers, cells) {
    return headers.reduce((acc, header, index) => {
        acc[normalizeHeaderKey(header, index)] = normalizeTableCellText(cells[index] || '');
        return acc;
    }, {});
}

function normalizeHeaderKey(header, index = 0) {
    const raw = String(header || '').trim();
    if (raw === '№') {
        return 'row_number';
    }

    const normalized = normalizeForComparison(header);

    if (!normalized) {
        return `column_${index + 1}`;
    }

    if (normalized === '№' || normalized === 'no' || normalized.includes('номер')) {
        return 'row_number';
    }
    if (normalized.includes('элемент') || normalized.includes('блок') || normalized.includes('логик')) {
        return 'element';
    }
    if (normalized.includes('требован')) {
        return 'requirement';
    }
    if (normalized.includes('метод')) {
        return 'method';
    }
    if (normalized.includes('параметр')) {
        return 'params';
    }
    if (normalized.includes('макет') || normalized.includes('figma')) {
        return 'layout';
    }

    return `column_${index + 1}`;
}

function isMeaningfulRequirementRow(row) {
    const values = [
        row?.row_number,
        row?.element,
        row?.requirement,
        row?.method,
        row?.params,
        row?.layout
    ].filter(value => !isPlaceholderValue(value));

    return values.length >= 2 && !isPlaceholderValue(row?.requirement || row?.element);
}

function buildRequirementRowHeading(baseHeading, rowNumber, element) {
    const parts = [baseHeading, rowNumber, truncateHeading(element)];
    return parts.filter(part => part && !isPlaceholderValue(part)).join(' / ') || 'Requirement row';
}

function buildRequirementRowContent(row) {
    const lines = [];
    const behavior = trimSemanticBlock(String(row.requirement || '').trim());
    const methodSummary = buildMethodContextSummary(row.method);
    const paramsSummary = buildRelevantParamsSummary(row.params, row.requirement);
    const layoutSummary = buildReferenceSummary(row.layout);

    if (!isPlaceholderValue(row.row_number)) {
        lines.push(`Requirement row: ${row.row_number}`);
    }
    if (!isPlaceholderValue(row.element)) {
        lines.push(`Element: ${row.element}`);
    }
    if (!isPlaceholderValue(behavior)) {
        lines.push(`Behavior: ${behavior}`);
    }
    if (!isPlaceholderValue(methodSummary)) {
        lines.push(`API dependency: ${methodSummary}`);
    }
    if (!isPlaceholderValue(paramsSummary)) {
        lines.push(`Relevant params: ${paramsSummary}`);
    }
    if (!isPlaceholderValue(layoutSummary)) {
        lines.push(`Reference: ${layoutSummary}`);
    }

    return lines.join('\n');
}

function buildRequirementBranchContent(row, sharedIntro, branch) {
    const lines = [];
    const minimalSharedContext = summarizeSharedContext(sharedIntro, row.element || '');
    const methodSummary = buildMethodContextSummary(row.method);
    const paramsSummary = buildRelevantParamsSummary(row.params, branch?.text || row.requirement);

    if (!isPlaceholderValue(row.row_number)) {
        lines.push(`Requirement row: ${row.row_number}`);
    }
    if (!isPlaceholderValue(row.element)) {
        lines.push(`Element: ${row.element}`);
    }
    if (!isPlaceholderValue(minimalSharedContext)) {
        lines.push(`Context: ${minimalSharedContext}`);
    }
    if (!isPlaceholderValue(branch?.label)) {
        lines.push(`Branch label: ${branch.label}`);
    }
    lines.push(`Behavior: ${branch.text}`);

    if (!isPlaceholderValue(methodSummary)) {
        lines.push(`API dependency: ${methodSummary}`);
    }
    if (!isPlaceholderValue(paramsSummary)) {
        lines.push(`Relevant params: ${paramsSummary}`);
    }

    return lines.join('\n');
}

function splitRequirementIntoScenarioBranches(text) {
    const normalized = cleanInlineText(text);
    if (!normalized) {
        return { sharedIntro: '', branches: [] };
    }

    const numberedSplit = splitRequirementIntoStructuredScenarioBranches(normalized);
    if (numberedSplit.branches.length >= 2) {
        return numberedSplit;
    }

    const conditionalSplit = splitTextByMarkers(
        normalized,
        /(^|[\n;])\s*(если|иначе если|иначе|в случае|при условии|когда|пока|if|when|else)\b/gi,
        match => match[2]
    );
    if (conditionalSplit.branches.length >= 2) {
        return conditionalSplit;
    }

    return {
        sharedIntro: '',
        branches: [{ label: null, text: normalized }]
    };
}

function buildRequirementChunkMetadata(row, sharedIntro = '') {
    return {
        shared_context: summarizeSharedContext(sharedIntro, row.element || ''),
        method_summary: buildMethodContextSummary(row.method),
        related_params: buildRelevantParamsSummary(row.params, row.requirement),
        layout_ref: buildReferenceSummary(row.layout),
        source_ref_text: buildRequirementReferenceContext(row)
    };
}

function buildRequirementReferenceContext(row) {
    return [
        row?.row_number ? `Requirement row: ${row.row_number}` : '',
        row?.element ? `Element: ${row.element}` : '',
        row?.requirement ? `Behavior: ${row.requirement}` : '',
        row?.method ? `Method/API context: ${row.method}` : '',
        row?.params ? `Service params/context: ${row.params}` : '',
        row?.layout ? `Reference/mock: ${row.layout}` : ''
    ].filter(Boolean).join('\n');
}

function summarizeSharedContext(sharedIntro, element = '') {
    const compact = cleanInlineText(sharedIntro);
    if (!compact || isPlaceholderValue(compact)) {
        return '';
    }

    const normalizedCompact = normalizeForComparison(compact);
    const normalizedElement = normalizeForComparison(element);
    if (normalizedElement && normalizedCompact === normalizedElement) {
        return '';
    }

    return compact.length > 220
        ? `${compact.slice(0, 217).trim()}...`
        : compact;
}

function buildMethodContextSummary(methodText) {
    if (isPlaceholderValue(methodText)) {
        return '';
    }

    const endpoint = extractEndpointSignature(String(methodText || ''));
    if (endpoint) {
        return endpoint;
    }

    return truncateHeading(cleanInlineText(methodText), 160);
}

function buildRelevantParamsSummary(paramsText, branchText = '') {
    const candidates = new Set();
    const paramsSource = String(paramsText || '');
    const branchSource = String(branchText || '');

    for (const regex of [/\b([A-Za-z][A-Za-z0-9_]{2,})\b(?=\s*[-:])/g, /"([A-Za-z][A-Za-z0-9_]{2,})"/g]) {
        let match;
        while ((match = regex.exec(paramsSource)) !== null) {
            if (match[1]) {
                candidates.add(match[1]);
            }
        }
    }

    if (!candidates.size) {
        for (const regex of [/<значение параметра\s+"([^"]+)">/gi, /"([a-z][A-Za-z0-9_]{2,})"/g]) {
            let match;
            while ((match = regex.exec(branchSource)) !== null) {
                if (match[1]) {
                    candidates.add(match[1]);
                }
            }
        }
    }

    const values = Array.from(candidates).filter(Boolean);
    if (!values.length) {
        return '';
    }

    return values.slice(0, 8).join(', ');
}

function buildReferenceSummary(layoutText) {
    if (isPlaceholderValue(layoutText)) {
        return '';
    }

    return truncateHeading(cleanInlineText(layoutText), 140);
}

function splitRequirementIntoStructuredScenarioBranches(text) {
    const parsed = parseNumberedRequirementClauses(text);
    if (!parsed.roots.length) {
        return { sharedIntro: '', branches: [] };
    }

    const branches = [];
    for (const root of parsed.roots) {
        if (shouldSplitNodeChildrenIntoScenarios(root)) {
            for (const child of root.children) {
                branches.push(buildScenarioBranchFromHierarchy(root, child));
            }
            continue;
        }

        branches.push(buildScenarioBranchFromHierarchy(null, root));
    }

    const normalizedBranches = normalizeStructuredScenarioBranches(branches);
    const meaningfulBranches = normalizedBranches.filter(branch => isMeaningfulChunkText(cleanText(branch.text)));
    if (meaningfulBranches.length < 2) {
        return {
            sharedIntro: '',
            branches: [{ label: null, text }]
        };
    }

    return {
        sharedIntro: parsed.sharedIntro,
        branches: meaningfulBranches
    };
}

function normalizeStructuredScenarioBranches(branches = []) {
    const expandedFallbacks = branches.flatMap(expandFallbackScenarioBranch);
    const mergedBranches = mergeOvergranularScenarioBranches(expandedFallbacks);
    return normalizeImplicitFirstScenarioBranches(mergedBranches);
}

function expandFallbackScenarioBranch(branch) {
    const label = String(branch?.label || '').trim();
    if (!label || label.includes('-fallback')) {
        return [branch];
    }

    const { behavior, clauses } = parseStructuredBranchText(branch.text);
    if (!clauses.length) {
        return [branch];
    }

    const fallbackClauses = clauses.filter(isFallbackClauseText);
    const primaryClauses = clauses.filter(clause => !isFallbackClauseText(clause));

    if (!fallbackClauses.length || !primaryClauses.length) {
        return [branch];
    }

    const fallbackBehavior = fallbackClauses[0] || behavior;
    const fallbackText = buildStructuredBranchText(fallbackBehavior, fallbackClauses.slice(1));
    const primaryText = buildStructuredBranchText(behavior, primaryClauses);
    const nextBranches = [];

    if (isMeaningfulChunkText(cleanText(primaryText))) {
        nextBranches.push({
            ...branch,
            text: primaryText
        });
    }

    if (isMeaningfulChunkText(cleanText(fallbackText))) {
        nextBranches.push({
            ...branch,
            label: `${label}-fallback`,
            text: fallbackText
        });
    }

    return nextBranches.length ? nextBranches : [branch];
}

function mergeOvergranularScenarioBranches(branches = []) {
    const broadBranchByPrefix = new Map();
    const granularBranchGroups = new Map();
    for (const branch of branches) {
        const prefix = getScenarioLabelPrefix(branch?.label, 2);
        const depth = getScenarioLabelDepth(branch?.label);
        if (!prefix) {
            continue;
        }
        if (depth === 2) {
            broadBranchByPrefix.set(prefix, branch);
            continue;
        }
        if (depth > 2) {
            if (!granularBranchGroups.has(prefix)) {
                granularBranchGroups.set(prefix, []);
            }
            granularBranchGroups.get(prefix).push(branch);
        }
    }

    const synthesizedBranchByPrefix = new Map();
    for (const [prefix, groupedBranches] of granularBranchGroups.entries()) {
        if (!broadBranchByPrefix.has(prefix) && groupedBranches.length >= 2) {
            synthesizedBranchByPrefix.set(prefix, synthesizeScenarioBranchFromGroup(prefix, groupedBranches));
        }
    }

    const result = [];
    const emittedSynthesizedPrefixes = new Set();
    for (const branch of branches) {
        const prefix = getScenarioLabelPrefix(branch?.label, 2);
        const depth = getScenarioLabelDepth(branch?.label);
        const target = prefix ? broadBranchByPrefix.get(prefix) : null;
        if (
            target &&
            target !== branch &&
            !String(branch?.label || '').includes('-fallback') &&
            depth > 2
        ) {
            target.text = mergeStructuredBranchTexts(target.text, branch.text);
            continue;
        }

        if (
            depth > 2 &&
            prefix &&
            synthesizedBranchByPrefix.has(prefix)
        ) {
            if (!emittedSynthesizedPrefixes.has(prefix)) {
                result.push(synthesizedBranchByPrefix.get(prefix));
                emittedSynthesizedPrefixes.add(prefix);
            }
            continue;
        }

        result.push(branch);
    }

    return result;
}

function normalizeImplicitFirstScenarioBranches(branches = []) {
    const branchFamilies = new Map();

    for (const branch of branches) {
        const normalizedLabel = normalizeScenarioBranchLabel(branch?.label);
        if (!normalizedLabel) {
            continue;
        }

        const topLevel = normalizedLabel.split('.')[0];
        if (!branchFamilies.has(topLevel)) {
            branchFamilies.set(topLevel, {
                hasTopLevel: false,
                hasFirstChild: false,
                hasSecondChild: false
            });
        }

        const family = branchFamilies.get(topLevel);
        if (normalizedLabel === topLevel) {
            family.hasTopLevel = true;
        }
        if (normalizedLabel === `${topLevel}.1`) {
            family.hasFirstChild = true;
        }
        if (normalizedLabel === `${topLevel}.2`) {
            family.hasSecondChild = true;
        }
    }

    return branches.map((branch) => {
        const rawLabel = String(branch?.label || '').trim();
        const normalizedLabel = normalizeScenarioBranchLabel(rawLabel);
        if (!rawLabel || !normalizedLabel) {
            return branch;
        }

        const topLevel = normalizedLabel.split('.')[0];
        const family = branchFamilies.get(topLevel);
        if (!family?.hasTopLevel || family.hasFirstChild || !family.hasSecondChild || normalizedLabel !== topLevel) {
            return branch;
        }

        const fallbackSuffix = rawLabel.includes('-fallback') ? '-fallback' : '';
        return {
            ...branch,
            label: `${topLevel}.1${fallbackSuffix}`,
            sourceNumber: `${topLevel}.1`
        };
    });
}

function synthesizeScenarioBranchFromGroup(prefix, branches = []) {
    const [firstBranch, ...restBranches] = branches;
    let mergedText = firstBranch?.text || '';

    for (const branch of restBranches) {
        mergedText = mergeStructuredBranchTexts(mergedText, branch.text);
    }

    return {
        ...firstBranch,
        label: prefix,
        sourceNumber: prefix,
        text: mergedText
    };
}

function parseStructuredBranchText(text) {
    const source = String(text || '');
    const [behaviorPart, clausesPart = ''] = source.split(/\nClauses:\n/i);
    const behavior = trimSemanticBlock(behaviorPart);
    const clauses = clausesPart
        .split('\n')
        .map(line => line.replace(/^\-\s+/, '').trim())
        .filter(Boolean);

    return { behavior, clauses };
}

function buildStructuredBranchText(behavior, clauses = []) {
    const lines = [];
    const cleanBehavior = trimSemanticBlock(behavior);
    if (cleanBehavior) {
        lines.push(cleanBehavior);
    }

    const uniqueClauses = [];
    const seen = new Set();
    for (const clause of clauses) {
        const cleanedClause = trimSemanticBlock(clause);
        const normalizedClause = normalizeForComparison(cleanedClause);
        if (!cleanedClause || !normalizedClause || seen.has(normalizedClause)) {
            continue;
        }
        seen.add(normalizedClause);
        uniqueClauses.push(cleanedClause);
    }

    if (uniqueClauses.length) {
        lines.push('Clauses:');
        for (const clause of uniqueClauses) {
            lines.push(`- ${clause}`);
        }
    }

    return trimSemanticBlock(lines.join('\n'));
}

function mergeStructuredBranchTexts(baseText, extraText) {
    const base = parseStructuredBranchText(baseText);
    const extra = parseStructuredBranchText(extraText);
    const mergedClauses = [...base.clauses];

    if (extra.behavior && normalizeForComparison(extra.behavior) !== normalizeForComparison(base.behavior)) {
        mergedClauses.push(extra.behavior);
    }

    mergedClauses.push(...extra.clauses);
    return buildStructuredBranchText(base.behavior, mergedClauses);
}

function getScenarioLabelDepth(label) {
    const numericLabel = normalizeScenarioBranchLabel(label);
    if (!numericLabel || !/^\d+(?:\.\d+)*$/.test(numericLabel)) {
        return 0;
    }
    return numericLabel.split('.').length;
}

function getScenarioLabelPrefix(label, depth = 2) {
    const numericLabel = normalizeScenarioBranchLabel(label);
    if (!numericLabel || !/^\d+(?:\.\d+)*$/.test(numericLabel)) {
        return '';
    }
    return numericLabel.split('.').slice(0, depth).join('.');
}

function normalizeScenarioBranchLabel(label) {
    return String(label || '').split('-')[0].trim();
}

function isFallbackClauseText(text) {
    const normalized = normalizeForComparison(text);
    if (!normalized) {
        return false;
    }

    return (
        normalized.includes('fallback') ||
        normalized.includes('null') ||
        normalized.includes('если какого то параметра') ||
        normalized.includes('если всех параметров') ||
        normalized.includes('не отображается') && normalized.includes('сдвигаются вверх') ||
        normalized.includes('отображается текст из')
    );
}

function parseNumberedRequirementClauses(text) {
    const markerRegex = /(^|[\s:;\/.(])(\d+(?:\.\d+)*)(?:\.|\))\s+/gm;
    const matches = Array.from(text.matchAll(markerRegex));
    if (!matches.length) {
        return { sharedIntro: '', roots: [] };
    }

    const items = matches.map((match, index) => {
        const start = (match.index || 0) + (match[1] ? match[1].length : 0);
        const nextStart = matches[index + 1]
            ? (matches[index + 1].index || 0) + (matches[index + 1][1] ? matches[index + 1][1].length : 0)
            : text.length;
        const raw = text
            .slice(start, nextStart)
            .replace(/^[:;\s]+/, '')
            .trim();
        const number = match[2];
        const cleaned = raw.replace(new RegExp(`^${escapeRegExp(number)}(?:\\.|\\))\\s+`), '').trim();

        return {
            number,
            depth: number.split('.').length,
            text: cleaned || raw,
            children: []
        };
    });

    const sharedIntro = text
        .slice(0, (matches[0].index || 0) + (matches[0][1] ? matches[0][1].length : 0))
        .replace(/^[:;\s]+/, '')
        .trim();

    const roots = [];
    for (const item of items) {
        const parent = findParentNumberedClause(item, items);
        if (parent) {
            parent.children.push(item);
        } else {
            roots.push(item);
        }
    }

    return { sharedIntro, roots };
}

function findParentNumberedClause(item, allItems) {
    if (item.depth <= 1) {
        return null;
    }

    const parentPrefix = item.number.split('.').slice(0, -1).join('.');
    for (let index = allItems.indexOf(item) - 1; index >= 0; index--) {
        if (allItems[index].number === parentPrefix) {
            return allItems[index];
        }
    }

    return null;
}

function shouldSplitNodeChildrenIntoScenarios(node) {
    return (node?.children || []).length >= 2 &&
        node.children.some(child => looksLikeScenarioSeed(child.text) || child.children.length > 0);
}

function looksLikeScenarioSeed(text) {
    return /^(если|иначе|когда|при|для пользователя|на странице|в модальном окне|в окне|при ответе|if|when|for user)\b/i
        .test(cleanInlineText(text));
}

function buildScenarioBranchFromHierarchy(parentNode, node) {
    const lines = [];
    if (parentNode?.text) {
        lines.push(trimTrailingPunctuation(parentNode.text));
    }

    lines.push(trimTrailingPunctuation(node.text));

    const clauses = collectNestedScenarioClauses(node.children || []);
    if (clauses.length) {
        lines.push('Clauses:');
        for (const clause of clauses) {
            lines.push(`- ${clause}`);
        }
    }

    return {
        label: node.number || null,
        sourceNumber: node.number || null,
        text: trimSemanticBlock(lines.join('\n'))
    };
}

function collectNestedScenarioClauses(nodes = [], acc = []) {
    for (const node of nodes) {
        const text = trimTrailingPunctuation(node.text);
        if (text) {
            acc.push(text);
        }
        if (node.children?.length) {
            collectNestedScenarioClauses(node.children, acc);
        }
    }

    return acc;
}

function trimTrailingPunctuation(text) {
    return cleanInlineText(text).replace(/[:;,\s]+$/, '').trim();
}

function splitTextByMarkers(text, regex, getLabel) {
    const matches = Array.from(text.matchAll(regex));
    if (matches.length < 2) {
        return {
            sharedIntro: '',
            branches: [{ label: null, text }]
        };
    }

    const starts = matches.map(match => ({
        start: (match.index || 0) + (match[1] ? match[1].length : 0),
        label: getLabel(match)
    }));

    const sharedIntro = text
        .slice(0, starts[0].start)
        .replace(/^[:;\s]+/, '')
        .trim();

    const branches = starts
        .map((item, index) => {
            const nextStart = starts[index + 1]?.start ?? text.length;
            const rawBranch = text
                .slice(item.start, nextStart)
                .replace(/^[:;\s]+/, '')
                .trim();
            const cleanedBranch = rawBranch
                .replace(/^\d+(?!\.\d)[\.\)]\s+/, '')
                .trim();

            return {
                label: item.label || null,
                text: cleanedBranch || rawBranch
            };
        })
        .filter(branch => isMeaningfulChunkText(cleanText(branch.text)));

    if (branches.length < 2) {
        return {
            sharedIntro: '',
            branches: [{ label: null, text }]
        };
    }

    return { sharedIntro, branches };
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildApiBlockText(section, endpoint, lines, label) {
    const body = trimSemanticBlock(flattenMarkdownTables((lines || []).join('\n')));
    if (!isMeaningfulApiBlock(body)) {
        return '';
    }

    const parts = [];
    if (endpoint) {
        parts.push(`Endpoint: ${endpoint}`);
    }
    if (section.heading && section.heading !== endpoint) {
        parts.push(`Context: ${section.heading}`);
    }
    parts.push(`${label}:`);
    parts.push(body);

    return parts.join('\n');
}

function buildApiSummaryText(section, endpoint, lines, apiBlocks = {}) {
    const body = trimSemanticBlock(flattenMarkdownTables((lines || []).join('\n')));
    const purpose = body
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !isApiHeadingNoise(line) && !isMarkdownTableLine(line))
        .slice(0, 3)
        .join(' ');
    const requestMode = detectApiRequestMode(`${section?.heading || ''}\n${section?.content || ''}`);

    const parts = [];
    if (endpoint) {
        parts.push(`Endpoint: ${endpoint}`);
    }
    if (section.heading && section.heading !== endpoint) {
        parts.push(`Context: ${section.heading}`);
    }
    if (purpose) {
        parts.push(`Purpose: ${purpose}`);
    }
    if (requestMode) {
        parts.push(`Request mode: ${requestMode}`);
    }
    if (apiBlocks.output?.length) {
        parts.push('Response: structured output params');
    } else if (apiBlocks.input?.length) {
        parts.push('Request: structured input params');
    }

    return trimSemanticBlock(parts.join('\n'));
}

function isApiInputSectionMarker(normalizedLine) {
    return /^(входные параметры|параметры запроса|request body|request params|input params)$/i.test(normalizedLine);
}

function isApiOutputSectionMarker(normalizedLine) {
    return /^(выходные параметры|параметры ответа|response body|response params|output params|выходные данные)$/i.test(normalizedLine);
}

function isApiErrorSectionMarker(normalizedLine) {
    return /^(возможные ошибки|ошибки|error handling|errors)$/i.test(normalizedLine);
}

function partitionApiContent(content, section = {}) {
    const lines = String(content || '').split('\n');
    const groups = { summary: [], input: [], output: [], behavior: [], error: [], hasMarkers: false };
    let currentGroup = 'summary';

    for (const line of lines) {
        const normalizedLine = normalizeForComparison(line);
        if (isApiInputSectionMarker(normalizedLine)) {
            currentGroup = 'input';
            groups.hasMarkers = true;
            continue;
        }
        if (isApiOutputSectionMarker(normalizedLine)) {
            currentGroup = 'output';
            groups.hasMarkers = true;
            continue;
        }
        if (isApiErrorSectionMarker(normalizedLine)) {
            currentGroup = 'error';
            groups.hasMarkers = true;
            continue;
        }
        if (isApiBehaviorMarker(normalizedLine)) {
            currentGroup = 'behavior';
            groups.hasMarkers = true;
            continue;
        }

        groups[currentGroup].push(line);
    }

    if (!groups.hasMarkers) {
        const fallbackGroups = partitionApiContentByTableOrder(lines, section);
        if (fallbackGroups.hasMarkers) {
            return fallbackGroups;
        }
    }

    return groups;
}

function partitionApiContentByTableOrder(lines, section = {}) {
    const groups = { summary: [], input: [], output: [], behavior: [], error: [], hasMarkers: false };
    const tableBlocks = [];
    let currentBlock = [];

    const flushTableBlock = () => {
        if (!currentBlock.length) return;
        tableBlocks.push(currentBlock);
        currentBlock = [];
    };

    for (const line of lines) {
        if (isMarkdownTableLine(line)) {
            currentBlock.push(line);
            continue;
        }

        flushTableBlock();
    }

    flushTableBlock();

    if (!tableBlocks.length) {
        return groups;
    }

    groups.hasMarkers = true;
    groups.summary = collectLinesBeforeFirstTable(lines).filter(line => !isApiHeadingNoise(line));

    const requestMode = detectApiRequestMode(`${section?.heading || ''}\n${lines.join('\n')}`);
    const requestLooksEmpty = requestMode === 'empty body' || requestMode === 'no request params';

    if (tableBlocks.length === 1) {
        if (requestLooksEmpty || tableLooksLikeOutputParams(tableBlocks[0], section)) {
            groups.output = tableBlocks[0];
        } else {
            groups.input = tableBlocks[0];
        }
    } else if (requestLooksEmpty) {
        groups.output = tableBlocks[0] || [];
        groups.behavior = tableBlocks.slice(1).flat();
    } else {
        groups.input = tableBlocks[0] || [];
        groups.output = tableBlocks[1] || [];
        if (tableBlocks.length > 2) {
            groups.behavior = tableBlocks.slice(2).flat();
        }
    }

    const trailingLines = collectTrailingLinesAfterLastTable(lines);
    if (trailingLines.some(line => /\berror|ошиб/i.test(line))) {
        groups.error = trailingLines;
    } else if (containsApiBehaviorNotes(trailingLines.join('\n'))) {
        groups.behavior = [...groups.behavior, ...trailingLines];
    } else if (!groups.output.length && trailingLines.length) {
        groups.output = trailingLines;
    }

    return groups;
}

function collectLinesBeforeFirstTable(lines) {
    const collected = [];
    for (const line of lines) {
        if (isMarkdownTableLine(line)) break;
        collected.push(line);
    }
    return collected;
}

function collectTrailingLinesAfterLastTable(lines) {
    let lastTableLineIndex = -1;
    for (let index = lines.length - 1; index >= 0; index--) {
        if (isMarkdownTableLine(lines[index])) {
            lastTableLineIndex = index;
            break;
        }
    }

    if (lastTableLineIndex === -1) {
        return [];
    }

    return lines
        .slice(lastTableLineIndex + 1)
        .filter(line => line.trim());
}

function isApiInputMarker(normalizedLine) {
    return /\b(входные параметры|параметры запроса|request body|request params|input params)\b/i.test(normalizedLine);
}

function isApiOutputMarker(normalizedLine) {
    return /\b(выходные параметры|параметры ответа|response body|response params|output params)\b/i.test(normalizedLine);
}

function isApiErrorMarker(normalizedLine) {
    return /\b(возможные ошибки|ошибки|error handling|errors)\b/i.test(normalizedLine);
}

function isApiBehaviorMarker(normalizedLine) {
    return /\b(примечани|особенност|поведени|только в случае|если параметр|если ответ|behavior notes)\b/i.test(normalizedLine);
}

function containsApiBehaviorNotes(text) {
    return /(только в случае|если параметр|если ответ|не отображается|отображается только|behavior)/i.test(text || '');
}

function detectApiRequestMode(text) {
    if (/пустым телом запроса|empty request body|empty body|request body отсутств/i.test(text || '')) {
        return 'empty body';
    }

    if (/без параметров запроса|no request params|request params отсутств/i.test(text || '')) {
        return 'no request params';
    }

    return '';
}

function tableLooksLikeOutputParams(tableLines, section = {}) {
    const flattened = flattenMarkdownTables((tableLines || []).join('\n'));
    const joined = `${section?.heading || ''}\n${flattened}`;
    if (/passwordMinLength|needSimplePassCheck|usePassword/i.test(joined)) {
        return true;
    }

    return /выходн|response|параметры ответа/i.test(joined);
}

function isApiHeadingNoise(line) {
    return /^(запрос|выходные данные|входные параметры|выходные параметры|параметры ответа|описание)\s*:?\s*$/i
        .test(String(line || '').trim());
}

function isMeaningfulApiBlock(text) {
    const normalized = normalizeForComparison(text);
    if (!normalized) {
        return false;
    }

    if (['входные параметры', 'выходные параметры', 'параметры ответа', 'ошибки', 'описание'].includes(normalized)) {
        return false;
    }

    return isMeaningfulChunkText(cleanText(text)) && !isPlaceholderValue(text);
}

function extractEndpointSignature(text) {
    const normalizedText = cleanText(text);
    const directMatch = normalizedText.match(/\b(GET|POST|PUT|DELETE|PATCH)\b\s*([/A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/i);
    if (directMatch) {
        const endpointPath = sanitizeExtractedEndpointPath(directMatch[2]);
        return endpointPath ? `${directMatch[1].toUpperCase()} ${endpointPath}` : '';
    }

    const quotedRestMatch = normalizedText.match(/\b(GET|POST|PUT|DELETE|PATCH)\b[^"\n]*"([^"\n]*(?:\/?rest|\/api)[^"\n]+)"/i);
    if (quotedRestMatch) {
        const endpointPath = sanitizeExtractedEndpointPath(quotedRestMatch[2]);
        return endpointPath ? `${quotedRestMatch[1].toUpperCase()} ${endpointPath}` : '';
    }

    const pathOnlyMatch = normalizedText.match(/((?:\/?rest|\/api)[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/i);
    return sanitizeExtractedEndpointPath(pathOnlyMatch?.[1] || '');
}

function sanitizeExtractedEndpointPath(path) {
    let cleaned = cleanInlineText(path)
        .replace(/[)"'`,.;:]+$/g, '')
        .replace(/\\/g, '/');

    if (!cleaned) {
        return '';
    }

    const stackedVerbMatch = cleaned.match(/^(.*?)(GET|POST|PUT|DELETE|PATCH)(?=\/|$)/i);
    if (stackedVerbMatch?.[1]) {
        cleaned = stackedVerbMatch[1].trim();
    }

    cleaned = cleaned.replace(/\/{2,}/g, '/');

    if (/^(GET|POST|PUT|DELETE|PATCH)$/i.test(cleaned)) {
        return '';
    }

    return cleaned;
}

function buildSectionPathForRow(path, suffix) {
    const basePath = Array.isArray(path) ? [...path] : [];
    const cleanSuffix = truncateHeading(suffix);
    if (cleanSuffix) {
        basePath.push(cleanSuffix);
    }
    return basePath;
}

function buildNestedHeading(baseHeading, itemNumber, itemTitle) {
    const parts = [baseHeading, itemNumber, truncateHeading(itemTitle)];
    return parts.filter(Boolean).join(' / ') || 'Semantic section';
}

function truncateHeading(text, maxLength = 120) {
    const cleaned = cleanInlineText(text);
    if (!cleaned) {
        return '';
    }

    return cleaned.length > maxLength
        ? `${cleaned.slice(0, maxLength).trim()}...`
        : cleaned;
}

function cleanInlineText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function trimSemanticBlock(text) {
    return String(text || '')
        .split('\n')
        .map(line => line.trimEnd())
        .filter((line, index, arr) => {
            if (!line.trim()) {
                const prev = arr[index - 1] || '';
                const next = arr[index + 1] || '';
                return Boolean(prev.trim()) && Boolean(next.trim());
            }
            return !/^[-–—=_]{2,}$/.test(line.trim());
        })
        .join('\n')
        .trim();
}

function isPlaceholderValue(value) {
    const normalized = normalizeForComparison(value);
    return !normalized ||
        ['-', '—', '/', 'нет', 'none', 'n a', 'na'].includes(normalized) ||
        /^[-–—/\\|]+$/.test(String(value || '').trim());
}

function normalizeForComparison(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
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
