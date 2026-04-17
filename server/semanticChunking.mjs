// semanticChunking.mjs
// РЎРµРјР°РЅС‚РёС‡РµСЃРєР°СЏ С‡Р°РЅРєРёР·Р°С†РёСЏ С‚СЂРµР±РѕРІР°РЅРёР№ РёР· Confluence РґР»СЏ RAG-СЃРёСЃС‚РµРјС‹

import { v4 as uuidv4 } from 'uuid';

function containsReferenceLinks(text) {
    const patterns = [
        /https?:\/\//i,
        /pageid=\d{4,}/i,
        /viewpage\.action\?pageId=\d{4,}/i,
        /figma\.com/i,
        /confluence/i,
        /jira/i,
        /СЃРј\.\s*(РїСѓРЅРєС‚|СЂР°Р·РґРµР»|РїРѕРґСЂР°Р·РґРµР»|section)/i,
        /see\s+(section|page)/i
    ];

    return patterns.some(pattern => pattern.test(text));
}

// ============================================================
// РўРРџР« Р§РђРќРљРћР’
// ============================================================
export const CHUNK_TYPES = {
    REQUIREMENT_ROW: 'requirement_row',
    REQUIREMENT_ROW_SUMMARY: 'requirement_row_summary',
    ATOMIC_RULE: 'atomic_rule',
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
    BUSINESS_RULE: 'business_rule',           // Р‘РёР·РЅРµСЃ-РїСЂР°РІРёР»Р°
    UI_RULE: 'ui_rule',                       // UI-РїСЂР°РІРёР»Р° (РєРЅРѕРїРєРё, РїРѕР»СЏ, РјРѕРґР°Р»СЊРЅС‹Рµ РѕРєРЅР°)
    API_CONTRACT: 'api_contract',             // API-РєРѕРЅС‚СЂР°РєС‚С‹
    VALIDATION_RULE: 'validation_rule',        // РџСЂР°РІРёР»Р° РІР°Р»РёРґР°С†РёРё
    ERROR_HANDLING: 'error_handling',          // РћР±СЂР°Р±РѕС‚РєР° РѕС€РёР±РѕРє
    SCENARIO_STEP: 'scenario_step',           // РЁР°РіРё СЃС†РµРЅР°СЂРёСЏ
    REFERENCE_CONTEXT: 'reference_context',     // РЎРїСЂР°РІРѕС‡РЅС‹Р№ РєРѕРЅС‚РµРєСЃС‚
    NOISE_METADATA: 'noise_metadata',         // РњРµС‚Р°РґР°РЅРЅС‹Рµ/С€СѓРј
    COMPOSITE: 'composite',                   // РЎРѕСЃС‚Р°РІРЅРѕР№ С‡Р°РЅРє
    TABLE_ROW: 'table_row'                    // РЎС‚СЂРѕРєР° С‚Р°Р±Р»РёС†С‹ С‚СЂРµР±РѕРІР°РЅРёР№
};

export const RETRIEVAL_CLASSES = {
    BEHAVIORAL: 'behavioral',
    API_CONTEXT: 'api_context',
    REFERENCE_CONTEXT: 'reference_context'
};

export const ELIGIBILITY_STATUSES = {
    ELIGIBLE: 'eligible',
    PENALIZED: 'penalized',
    EXCLUDED: 'excluded'
};

const RETRIEVAL_EXCLUDED_CHUNK_TYPES = new Set([
    CHUNK_TYPES.DOCUMENT_META,
    CHUNK_TYPES.CHANGE_LOG,
    CHUNK_TYPES.NOISE_METADATA,
    CHUNK_TYPES.NOISE_SKIPPED,
    CHUNK_TYPES.REFERENCE_LINK,
    CHUNK_TYPES.BUSINESS_CONTEXT,
    CHUNK_TYPES.SCOPE_CONTEXT,
    CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY,
    CHUNK_TYPES.REQUIREMENT_ROW
]);

// ============================================================
// РћРЎРќРћР’РќРђРЇ Р¤РЈРќРљР¦РРЇ: CHUNKIFY
// ============================================================

/**
 * РћСЃРЅРѕРІРЅР°СЏ С„СѓРЅРєС†РёСЏ С‡Р°РЅРєРёР·Р°С†РёРё РґРѕРєСѓРјРµРЅС‚Р°
 * @param {string} markdown - Markdown С‚РµРєСЃС‚ РёР· Confluence
 * @param {Object} metadata - РњРµС‚Р°РґР°РЅРЅС‹Рµ РґРѕРєСѓРјРµРЅС‚Р°
 * @returns {Promise<Array>} РњР°СЃСЃРёРІ С‡Р°РЅРєРѕРІ
 */
export async function chunkify(markdown, metadata = {}) {
    console.log(`[semanticChunking] РќР°С‡РёРЅР°СЋ С‡Р°РЅРєРёР·Р°С†РёСЋ РґРѕРєСѓРјРµРЅС‚Р°: ${metadata.title || 'unknown'}`);
    
    const docId = metadata.pageId || metadata.id || uuidv4();
    const docTitle = metadata.title || 'Untitled';
    
    // Р­С‚Р°Рї 1: РџР°СЂСЃРёРЅРі СЃС‚СЂСѓРєС‚СѓСЂС‹ РґРѕРєСѓРјРµРЅС‚Р°
    const sections = expandSectionsForChunking(parseDocumentStructure(markdown));
    console.log(`[semanticChunking] РќР°Р№РґРµРЅРѕ СЃРµРєС†РёР№: ${sections.length}`);
    
    // Р­С‚Р°Рї 2: РЎРµРјР°РЅС‚РёС‡РµСЃРєР°СЏ С‡Р°РЅРєРёР·Р°С†РёСЏ
    let chunks = [];
    
    for (const section of sections) {
        // РљР»Р°СЃСЃРёС„РёС†РёСЂСѓРµРј СЃРµРєС†РёСЋ
        const chunkType = classifySection(section);
        
        // Р¤РёР»СЊС‚СЂСѓРµРј С€СѓРј
        if (chunkType === CHUNK_TYPES.NOISE_METADATA ||
            chunkType === CHUNK_TYPES.NOISE_SKIPPED ||
            chunkType === CHUNK_TYPES.TABLE_ROW) {
            continue;
        }
        
        // РЎРѕР·РґР°С‘Рј atomic chunk
        const retrievalProfile = assignRetrievalProfile(section, chunkType);
        const atomicChunk = createAtomicChunk({
            ...section,
            retrieval_profile: retrievalProfile
        }, {
            doc_id: docId,
            doc_title: docTitle,
            chunk_type: chunkType,
            section_path: section.path
        });

        if (!atomicChunk) {
            continue;
        }
        
        chunks.push(atomicChunk);
    }

    chunks = applyRequirementLineage(chunks);
    
    console.log(`[semanticChunking] РЎРѕР·РґР°РЅРѕ С‡Р°РЅРєРѕРІ: ${chunks.length} (atomic)`);
    
    return chunks;
}

// ============================================================
// Р­РўРђРџ 1: PARSE DOCUMENT STRUCTURE
// ============================================================

/**
 * РџР°СЂСЃРёС‚ СЃС‚СЂСѓРєС‚СѓСЂСѓ РґРѕРєСѓРјРµРЅС‚Р° Markdown
 * @param {string} markdown 
 * @returns {Array} РњР°СЃСЃРёРІ СЃРµРєС†РёР№
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
        
        // РџСЂРѕРІРµСЂСЏРµРј Р·Р°РіРѕР»РѕРІРѕРє СЃ РЅСѓРјРµСЂР°С†РёРµР№ (РЅР°РїСЂРёРјРµСЂ "3.1.2 РќР°Р·РІР°РЅРёРµ" РёР»Рё "1. РўСЂРµР±РѕРІР°РЅРёРµ")
        const headingWithNumberMatch = line.match(/^(#{1,6})\s+(\d+(?:[\.\)]\d+)*)\s+(.+)$/);
        if (headingWithNumberMatch) {
            // РЎРѕС…СЂР°РЅСЏРµРј РїСЂРµРґС‹РґСѓС‰СѓСЋ СЃРµРєС†РёСЋ
            if (currentSection && sectionContent.length > 0) {
                currentSection.content = sectionContent.join('\n').trim();
                sections.push(currentSection);
            }
            
            // РќР°С‡РёРЅР°РµРј РЅРѕРІСѓСЋ СЃРµРєС†РёСЋ
            const level = headingWithNumberMatch[1].length;
            const sectionNumber = headingWithNumberMatch[2].trim();
            const text = headingWithNumberMatch[3].trim();
            
            // РћР±РЅРѕРІР»СЏРµРј РїСѓС‚СЊ Р·Р°РіРѕР»РѕРІРєРѕРІ
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
        
        // РџСЂРѕРІРµСЂСЏРµРј Р·Р°РіРѕР»РѕРІРѕРє Р±РµР· РЅРѕРјРµСЂР°
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            // РЎРѕС…СЂР°РЅСЏРµРј РїСЂРµРґС‹РґСѓС‰СѓСЋ СЃРµРєС†РёСЋ
            if (currentSection && sectionContent.length > 0) {
                currentSection.content = sectionContent.join('\n').trim();
                sections.push(currentSection);
            }
            
            // РќР°С‡РёРЅР°РµРј РЅРѕРІСѓСЋ СЃРµРєС†РёСЋ
            const level = headingMatch[1].length;
            const text = headingMatch[2].trim();
            
            // РћР±РЅРѕРІР»СЏРµРј РїСѓС‚СЊ Р·Р°РіРѕР»РѕРІРєРѕРІ
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
        
        // РџСЂРѕРІРµСЂСЏРµРј РЅСѓРјРµСЂРѕРІР°РЅРЅС‹Р№ СЃРїРёСЃРѕРє
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
        
        // РџСЂРѕРІРµСЂСЏРµРј РјР°СЂРєРёСЂРѕРІР°РЅРЅС‹Р№ СЃРїРёСЃРѕРє
        const bulletMatch = line.match(/^(\s*)([-*вЂў]\s+)(.+)$/);
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
        
        // РџСЂРѕРІРµСЂСЏРµРј С‚Р°Р±Р»РёС†Сѓ
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
        
        // РџСЂРѕРІРµСЂСЏРµРј Р±Р»РѕРє РєРѕРґР°
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
        
        // РћР±С‹С‡РЅС‹Р№ С‚РµРєСЃС‚
        if (line.trim()) {
            sectionContent.push(line);
            if (currentSection) currentSection.line_end = lineNumber;
        }
    }
    
    // Р”РѕР±Р°РІР»СЏРµРј РїРѕСЃР»РµРґРЅСЋСЋ СЃРµРєС†РёСЋ
    if (currentSection && sectionContent.length > 0) {
        currentSection.content = sectionContent.join('\n').trim();
        sections.push(currentSection);
    }
    
    return sections;
}

// ============================================================
// Р­РўРђРџ 2: CLASSIFY SECTION
// ============================================================

/**
 * РљР»Р°СЃСЃРёС„РёС†РёСЂСѓРµС‚ С‚РёРї СЃРµРєС†РёРё РЅР° РѕСЃРЅРѕРІРµ РєР»СЋС‡РµРІС‹С… СЃР»РѕРІ
 * @param {Object} section 
 * @returns {string} РўРёРї С‡Р°РЅРєР°
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
    
    // РџСЂРѕРІРµСЂСЏРµРј РЅР° С€СѓРј (changelog, РёСЃС‚РѕСЂРёСЏ, РјРµС‚Р°РґР°РЅРЅС‹Рµ)
    if (isNoise(text)) {
        return CHUNK_TYPES.NOISE_METADATA;
    }

    if (containsReferenceLinks(text) && !containsApiContract(text)) {
        return CHUNK_TYPES.REFERENCE_LINK;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј API-РєРѕРЅС‚СЂР°РєС‚С‹
    if (containsApiContract(text)) {
        return CHUNK_TYPES.API_ENDPOINT_SUMMARY;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј РѕР±СЂР°Р±РѕС‚РєСѓ РѕС€РёР±РѕРє
    if (containsErrorHandling(text)) {
        return CHUNK_TYPES.ERROR_HANDLING;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј UI-РїСЂР°РІРёР»Р°
    if (containsUIRule(text)) {
        return CHUNK_TYPES.UI_CURRENT_BEHAVIOR;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј РІР°Р»РёРґР°С†РёСЋ
    if (containsValidationRule(text)) {
        return CHUNK_TYPES.VALIDATION_RULE;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј Р±РёР·РЅРµСЃ-РїСЂР°РІРёР»Р°
    if (containsBusinessRule(text)) {
        return CHUNK_TYPES.BUSINESS_RULE;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј С‚Р°Р±Р»РёС†С‹ С‚СЂРµР±РѕРІР°РЅРёР№
    if (section.elements?.some(el => el.type === 'table_row') && !chunkableContent.trim()) {
        return CHUNK_TYPES.TABLE_ROW;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј С€Р°РіРё СЃС†РµРЅР°СЂРёСЏ
    if (containsScenarioStep(text)) {
        return CHUNK_TYPES.SCENARIO_STEP;
    }
    
    // РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ - СЃРїСЂР°РІРѕС‡РЅС‹Р№ РєРѕРЅС‚РµРєСЃС‚
    return CHUNK_TYPES.REFERENCE_CONTEXT;
}

function isNoise(text) {
    const noisePatterns = [
        /changelog/i,
        /РёСЃС‚РѕСЂРёСЏ РёР·РјРµРЅРµРЅРёР№/i,
        /version history/i,
        /history of changes/i,
        /Р°РІС‚РѕСЂ:\s*/i,
        /СЃРѕРіР»Р°СЃРѕРІР°РЅРѕ:\s*/i,
        /СѓС‚РІРµСЂР¶РґРµРЅРѕ:\s*/i,
        /СЃС‚Р°С‚СѓСЃ:\s*(draft|С‡РµСЂРЅРѕРІРёРє|РЅРѕРІС‹Р№)/i,
        /last updated/i,
        /date created/i,
        /created by/i,
        /Р°РІС‚РѕСЂСЃРєРёР№ РєРѕРјРјРµРЅС‚Р°СЂРёР№/i,
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
        /РјРµС‚РѕРґ\s+(get|post|put|delete|patch)/i,
        /Р·Р°РїСЂРѕСЃ\s+(get|post|put|delete|patch)/i,
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
        /РѕС€РёР±Рє[Р°СѓРё]/i,
        /exception/i,
        /error/i,
        /РєРѕРґ РѕС€РёР±РєРё/i,
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
        /РёСЃРєР»СЋС‡РµРЅРё[РµСЏ]/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsUIRule(text) {
    const patterns = [
        /РєРЅРѕРїРє[Р°СѓРё]/i,
        /РїРѕР»Рµ[Р°Сѓ]?\s+(РІРІРѕРґ|РІС‹Р±РѕСЂ|РїР°СЂРѕР»СЊ|С‚РµРєСЃС‚)/i,
        /РјРѕРґР°Р»СЊРЅ/i,
        /РґРёР°Р»РѕРі/i,
        /РѕРєРЅРѕ/i,
        /СЌРєСЂР°РЅ/i,
        /РёРЅС‚РµСЂС„РµР№СЃ/i,
        /ui\s*[-/]/i,
        /РѕС‚РѕР±СЂР°Р·РёС‚СЊ/i,
        /СЃРєСЂС‹С‚СЊ/i,
        /РїРѕРєР°Р·Р°С‚СЊ/i,
        /РєР»РёРє/i,
        /РЅР°Р¶Р°С‚СЊ/i,
        /РІРІРѕРґ/i,
        /РІС‹Р±РѕСЂ/i,
        /РІС‹РїР°РґР°СЋС‰РёР№\s+СЃРїРёСЃРѕРє/i,
        /С‡РµРєР±РѕРєСЃ/i,
        /СЂР°РґРёРѕ-РєРЅРѕРїРєР°/i,
        /РїРµСЂРµРєР»СЋС‡Р°С‚РµР»СЊ/i,
        /С‚Р°Р±/i,
        /РІРєР»Р°РґРєР°/i,
        /РјРµРЅСЋ/i,
        /СЃСЃС‹Р»Рє[Р°Сѓ]/i,
        /РіР»Р°РІРЅ[Р°Сѓ]?\s+СЃС‚СЂР°РЅРёС†/i,
        /СЃС‚СЂР°РЅРёС†Р°/i,
        /component/i,
        /element/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsValidationRule(text) {
    const patterns = [
        /РІР°Р»РёРґР°С†Рё[СЏСЋРё]/i,
        /РїСЂРѕРІРµСЂРє[Р°СѓРё]/i,
        /РѕРіСЂР°РЅРёС‡РµРЅРё[РµСЏ]/i,
        /constraint/i,
        /required/i,
        /РѕР±СЏР·Р°С‚РµР»СЊРЅ/i,
        /РјР°РєСЃРёРјСѓРј/i,
        /РјРёРЅРёРјСѓРј/i,
        /РґРёР°РїР°Р·РѕРЅ/i,
        /РґР»РёРЅР°/i,
        /С„РѕСЂРјР°С‚/i,
        /С€Р°Р±Р»РѕРЅ/i,
        /pattern/i,
        /regex/i,
        /regular expression/i,
        /РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј/i,
        /РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ null/i,
        /РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ/i,
        /РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ/i,
        /РґРѕР»Р¶РЅ[Р°Сѓ]\s+Р±С‹С‚СЊ/i,
        /РЅРµ РґРѕРїСѓСЃРєР°РµС‚СЃСЏ/i,
        /РЅРµ СЂР°Р·СЂРµС€РµРЅРѕ/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsBusinessRule(text) {
    const patterns = [
        /Р±РёР·РЅРµСЃ-РїСЂР°РІРёР»Рѕ/i,
        /Р±РёР·РЅРµСЃ\s*РїСЂР°РІРёР»Рѕ/i,
        /Р±РёР·РЅРµСЃ-С‚СЂРµР±РѕРІР°РЅРёРµ/i,
        /requirement\s+[A-Z]+/i,
        /functional\s+requirement/i,
        /business\s+rule/i,
        /РґРѕР»Р¶РµРЅ\s+РѕР±РµСЃРїРµС‡РёРІР°С‚СЊ/i,
        /РґРѕР»Р¶РµРЅ\s+РїРѕРґРґРµСЂР¶РёРІР°С‚СЊ/i,
        /РґРѕР»Р¶РµРЅ\s+РїРѕР·РІРѕР»СЏС‚СЊ/i,
        /РґРѕР»Р¶РµРЅ\s+РІС‹РїРѕР»РЅСЏС‚СЊ/i,
        /СЃРёСЃС‚РµРјР°\s+РґРѕР»Р¶РЅР°/i,
        /РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ\s+РјРѕР¶РµС‚/i,
        /РїСЂРё\s+РІС‹РїРѕР»РЅРµРЅРёРё/i,
        /РІ\s+СЂРµР·СѓР»СЊС‚Р°С‚Рµ/i,
        /СЃР»РµРґСѓРµС‚\s+РІС‹РїРѕР»РЅРёС‚СЊ/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

function containsScenarioStep(text) {
    const patterns = [
        /С€Р°Рі/i,
        /СЃС†РµРЅР°СЂРёР№/i,
        /user\s+story/i,
        /use\s+case/i,
        /user\s+action/i,
        /РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ\s+(РѕС‚РєСЂС‹РІР°РµС‚|РІРІРѕРґРёС‚|РЅР°Р¶РёРјР°РµС‚|РІС‹Р±РёСЂР°РµС‚|СѓРґР°Р»СЏРµС‚|СЂРµРґР°РєС‚РёСЂСѓРµС‚)/i,
        /РґРµР№СЃС‚РІРёРµ\s+РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ/i,
        /РїСЂРµРґСѓСЃР»РѕРІРёРµ/i,
        /РїРѕСЃС‚СѓСЃР»РѕРІРёРµ/i,
        /given\s+when\s+then/i,
        /gherkin/i,
        /behavior/i
    ];
    
    return patterns.some(pattern => pattern.test(text));
}

// ============================================================
// Р­РўРђРџ 3: CREATE CHUNKS
// ============================================================

function extractExplicitRefs(text) {
    if (!text) return [];
    
    const refs = [];
    const textLower = text.toLowerCase();
    
    // РџР°С‚С‚РµСЂРЅС‹ РґР»СЏ СЏРІРЅС‹С… СЃСЃС‹Р»РѕРє
    const patterns = [
        // СЃРј. РїСѓРЅРєС‚ 2.3, СЃРј. СЂР°Р·РґРµР» 1.2.3, СЃРј. РїРѕРґСЂР°Р·РґРµР»
        { type: 'section_ref', regex: /СЃРј\.?\s*(?:РїСѓРЅРєС‚|СЂР°Р·РґРµР»|РїРѕРґСЂР°Р·РґРµР»|СЃРµРєС†РёСЋ)\s*([\d\.]+)/gi },
        //see section 2.3, see РїСѓРЅРєС‚
        { type: 'section_ref', regex: /see\s+(?:section| РїСѓРЅРєС‚| СЂР°Р·РґРµР»)\s*([\d\.]+)/gi },
        // СЃСЃС‹Р»РєР° РЅР° РґРѕРєСѓРјРµРЅС‚ "РќР°Р·РІР°РЅРёРµ"
        { type: 'doc_ref', regex: /РґРѕРєСѓРјРµРЅС‚\s*["'"]([^"'"']+)["'"']/gi },
        // pageId=123456
        { type: 'pageId', regex: /pageId[=\s]*(\d+)/gi },
        // (СЃРј. РІС‹С€Рµ), (СЃРј. РЅРёР¶Рµ)
        { type: 'context_ref', regex: /\(СЃРј\.\s*(РІС‹С€Рµ|РЅРёР¶Рµ|СЂРёСЃ\.|С‚Р°Р±Р»\.\s*\d+)\)/gi }
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
    
    // РЈР±РёСЂР°РµРј РґСѓР±Р»РёРєР°С‚С‹
    const additionalPatterns = [
        { type: 'section_ref', regex: /(?:СЃРј\.?\s*(?:РїСѓРЅРєС‚|СЂР°Р·РґРµР»|РїРѕРґСЂР°Р·РґРµР»|СЃРµРєС†(?:РёСЏ|РёСЋ))|see\s+(?:section|subsection|paragraph))\s*([\d.]+)/gi },
        { type: 'doc_ref', regex: /РґРѕРєСѓРјРµРЅС‚\s*["'В«]([^"'В»]+)["'В»]/gi },
        { type: 'doc_ref', regex: /\[([^\]]+)\]\((?:https?:\/\/[^\s)]*?)?(?:viewpage\.action\?pageId=\d+|\/pages\/\d+)[^)]+\)/gi },
        { type: 'pageId', regex: /pageId[=\s:]*(\d{4,})/gi },
        { type: 'pageId', regex: /viewpage\.action\?pageId=(\d{4,})/gi },
        { type: 'pageId', regex: /\/pages\/(\d{4,})/gi },
        { type: 'context_ref', regex: /\((?:СЃРј\.?\s*)?(РІС‹С€Рµ|РЅРёР¶Рµ|СЂРёСЃ\.?\s*\d+|С‚Р°Р±Р»\.?\s*\d+)\)/gi }
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
    const retrievalProfile = normalizeRetrievalProfile(
        section?.retrieval_profile,
        cleanedText
    );
    const mergedMetadata = {
        ...(section.metadata || {}),
        split_source: metadata.split_source || section.split_source || null
    };
    const chunkGranularity = mergedMetadata.chunk_granularity ||
        retrievalProfile.chunk_granularity ||
        'atomic';
    const explicitRefSource = [rawText, mergedMetadata.source_ref_text]
        .filter(Boolean)
        .join('\n');
    const explicitRefs = extractExplicitRefs(explicitRefSource);
    const excludeFromRetrieval =
        Boolean(mergedMetadata.exclude_from_retrieval) ||
        Boolean(retrievalProfile.exclude_from_retrieval) ||
        shouldExcludeChunkTypeFromRetrieval(metadata.chunk_type);
    const excludeFromGraph =
        Boolean(mergedMetadata.exclude_from_graph) ||
        excludeFromRetrieval;
    const auxMetadata = {
        ...(retrievalProfile.aux_metadata || {}),
        section_number: retrievalProfile?.aux_metadata?.section_number || section.section_number || null,
        row_number: retrievalProfile?.aux_metadata?.row_number || mergedMetadata.row_number || null,
        parent_row_number: retrievalProfile?.aux_metadata?.parent_row_number || mergedMetadata.parent_row_number || null,
        atomic_rule_kind: retrievalProfile?.aux_metadata?.atomic_rule_kind || mergedMetadata.atomic_rule_kind || null
    };
    
    return {
        id: uuidv4(),
        doc_id: metadata.doc_id,
        doc_title: metadata.doc_title,
        section_path: metadata.section_path || [],
        
        // РќРѕРјРµСЂ СЂР°Р·РґРµР»Р° (РЅР°РїСЂРёРјРµСЂ "3.1.2")
        section_number: section.section_number || null,
        
        heading: section.heading,
        heading_level: section.heading_level,
        
        raw_text: rawText,
        cleaned_text: cleanedText,
        content: cleanedText,
        core_text: retrievalProfile.core_text || '',
        embedding_text: retrievalProfile.embedding_text || cleanedText,
        aux_metadata: auxMetadata,
        
        chunk_type: metadata.chunk_type,
        chunk_granularity: chunkGranularity,
        retrieval_class: retrievalProfile.retrieval_class,
        eligibility_status: retrievalProfile.eligibility_status,
        retrieval_penalty: retrievalProfile.retrieval_penalty,
        content_ratio: retrievalProfile.content_ratio,
        split_source: metadata.split_source || section.split_source || null,
        
        parent_chunk_id: null,
        linked_chunk_ids: [],
        
        requirement_id: section?.metadata?.row_number || extractRequirementId(rawText),
        feature_name: metadata.doc_title,
        metadata: {
            ...mergedMetadata,
            aux_metadata: auxMetadata,
            core_text: retrievalProfile.core_text || '',
            embedding_text: retrievalProfile.embedding_text || cleanedText,
            retrieval_class: retrievalProfile.retrieval_class,
            eligibility_status: retrievalProfile.eligibility_status,
            retrieval_penalty: retrievalProfile.retrieval_penalty,
            content_ratio: retrievalProfile.content_ratio,
            has_behavioral_predicate: retrievalProfile.has_behavioral_predicate,
            has_expected_result: retrievalProfile.has_expected_result,
            metadata_only: retrievalProfile.metadata_only,
            screen_scope: auxMetadata.screen_scope || null,
            channel_scope: auxMetadata.channel_scope || null,
            entity_scope: auxMetadata.entity_scope || null,
            endpoint: auxMetadata.endpoint || null,
            method: auxMetadata.method || null,
            row_number: auxMetadata.row_number || null,
            parent_row_number: auxMetadata.parent_row_number || auxMetadata.row_number || null,
            atomic_rule_kind: auxMetadata.atomic_rule_kind || null,
            chunk_granularity: chunkGranularity,
            section_number: auxMetadata.section_number || section.section_number || null,
            exclude_from_retrieval: excludeFromRetrieval,
            exclude_from_graph: excludeFromGraph,
            source_scope: mergedMetadata.source_scope || metadata.source_scope || 'main',
            lineage_group_key: mergedMetadata.lineage_group_key || null,
            lineage_parent_summary_id: mergedMetadata.lineage_parent_summary_id || null,
            lineage_child_rule_ids: Array.isArray(mergedMetadata.lineage_child_rule_ids) ? mergedMetadata.lineage_child_rule_ids : [],
            retrievable: !excludeFromRetrieval,
            graph_eligible: mergedMetadata.graph_eligible,
            relevance_score: mergedMetadata.relevance_score,
            canonical_key: mergedMetadata.canonical_key || null,
            drop_reason: retrievalProfile.drop_reason || mergedMetadata.drop_reason || null
        },
        exclude_from_retrieval: excludeFromRetrieval,
        exclude_from_graph: excludeFromGraph,
        drop_reason: retrievalProfile.drop_reason || mergedMetadata.drop_reason || null,
        
        source_location: {
            line_start: section.line_start,
            line_end: section.line_end
        },
        token_count: estimateTokens(cleanedText),
        
        explicit_refs: explicitRefs,
        lineage_group_key: mergedMetadata.lineage_group_key || null,
        lineage_parent_summary_id: mergedMetadata.lineage_parent_summary_id || null,
        lineage_child_rule_ids: Array.isArray(mergedMetadata.lineage_child_rule_ids) ? mergedMetadata.lineage_child_rule_ids : [],
        parent_row_number: auxMetadata.parent_row_number || auxMetadata.row_number || null,
        atomic_rule_kind: auxMetadata.atomic_rule_kind || null,
        retrievable: !excludeFromRetrieval,
        
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
        content: firstAtomicChunk.cleaned_text,
        core_text: firstAtomicChunk.core_text || '',
        embedding_text: firstAtomicChunk.embedding_text || firstAtomicChunk.cleaned_text,
        aux_metadata: { ...(firstAtomicChunk.aux_metadata || {}) },
        
        chunk_type: CHUNK_TYPES.COMPOSITE,
        retrieval_class: firstAtomicChunk.retrieval_class,
        eligibility_status: firstAtomicChunk.eligibility_status,
        retrieval_penalty: firstAtomicChunk.retrieval_penalty,
        content_ratio: firstAtomicChunk.content_ratio,
        split_source: firstAtomicChunk.split_source || null,
        
        parent_chunk_id: null,
        linked_chunk_ids: [firstAtomicChunk.id],
        atomic_chunks: [firstAtomicChunk.id],
        
        requirement_id: firstAtomicChunk.requirement_id,
        feature_name: firstAtomicChunk.feature_name,
        metadata: { ...(firstAtomicChunk.metadata || {}) },
        exclude_from_retrieval: Boolean(firstAtomicChunk.exclude_from_retrieval),
        exclude_from_graph: Boolean(firstAtomicChunk.exclude_from_graph),
        drop_reason: firstAtomicChunk.drop_reason || null,
        
        source_location: firstAtomicChunk.source_location,
        token_count: firstAtomicChunk.token_count,
        
        explicit_refs: firstAtomicChunk.explicit_refs || [],
        
        is_atomic: false,
        is_composite: true
    };
}

function finalizeCompositeChunk(composite) {
    // РР·РІР»РµРєР°РµРј feature_name РёР· Р·Р°РіРѕР»РѕРІРєР°
    const featureName = extractFeatureName(composite.heading);
    if (featureName) {
        composite.feature_name = featureName;
    }
    
    // РЎРѕР·РґР°С‘Рј summary
    composite.summary = createSummary(composite.cleaned_text);
    
    return composite;
}

// ============================================================
// Р­РўРђРџ 4: MERGE LOGIC - CONDITIONAL BRANCHES
// ============================================================

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, СЏРІР»СЏРµС‚СЃСЏ Р»Рё С‚РµРєСЃС‚ СѓСЃР»РѕРІРЅРѕР№ РєРѕРЅСЃС‚СЂСѓРєС†РёРµР№ (РµСЃР»Рё в†’ С‚Рѕ в†’ РёРЅР°С‡Рµ)
 * РўР°РєРёРµ РєРѕРЅСЃС‚СЂСѓРєС†РёРё РґРѕР»Р¶РЅС‹ РѕР±СЉРµРґРёРЅСЏС‚СЊСЃСЏ РІ РѕРґРёРЅ С‡Р°РЅРє
 */
function isConditionalBranch(text) {
    if (!text) return false;
    
    const conditionalPatterns = [
        /РµСЃР»Рё\s+.+\s+С‚Рѕ/i,
        /РµСЃР»Рё\s+.+\s+РёРЅР°С‡Рµ/i,
        /РµСЃР»Рё\s+.+\s+РІ\s+РїСЂРѕС‚РёРІРЅРѕРј\s+СЃР»СѓС‡Р°Рµ/i,
        /РІ\s+СЃР»СѓС‡Р°Рµ\s+.+\s+РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ/i,
        /РїСЂРё\s+.+\s+РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ/i,
        /when\s+.+\s+then/i,
        /if\s+.+\s+then/i,
        /РїСЂРё\s+СѓСЃР»РѕРІРёРё/i,
        /РґРѕРїСѓСЃС‚РёРј\s+/i,
        /РїСЂРµРґРїРѕР»РѕР¶РёРј\s+/i
    ];
    
    return conditionalPatterns.some(pattern => pattern.test(text));
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, СЏРІР»СЏРµС‚СЃСЏ Р»Рё С‚РµРєСЃС‚ РїСЂРѕРґРѕР»Р¶РµРЅРёРµРј СѓСЃР»РѕРІРЅРѕР№ РєРѕРЅСЃС‚СЂСѓРєС†РёРё
 * (С‚.Рµ. СЃРѕРґРµСЂР¶РёС‚ "С‚Рѕ", "РёРЅР°С‡Рµ", "РІ РїСЂРѕС‚РёРІРЅРѕРј СЃР»СѓС‡Р°Рµ" Р±РµР· РЅРѕРІРѕРіРѕ "РµСЃР»Рё")
 */
function isConditionalContinuation(text) {
    if (!text) return false;
    
    const continuationPatterns = [
        /\bС‚Рѕ\b/i,
        /\bРёРЅР°С‡Рµ\b/i,
        /\bРІ\s+РїСЂРѕС‚РёРІРЅРѕРј\s+СЃР»СѓС‡Р°Рµ\b/i,
        /\bРІ\s+РїСЂРѕС‚РёРІРЅРѕРј\b/i,
        /\bРёРЅР°С‡Рµ\s+РµСЃР»Рё\b/i,
        /\bС‚Рѕ\s+РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ\b/i,
        /\bС‚Рѕ\s+РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ\b/i,
        /\bС‚Рѕ\s+РїСЂРѕРёСЃС…РѕРґРёС‚\b/i,
        /\botherwise\b/i,
        /\belse\b/i,
        /\bthen\b/i
    ];
    
    return continuationPatterns.some(pattern => pattern.test(text));
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, СЏРІР»СЏРµС‚СЃСЏ Р»Рё С‚РµРєСѓС‰РёР№ СЌР»РµРјРµРЅС‚ РЅР°С‡Р°Р»РѕРј РЅРѕРІРѕРіРѕ СѓСЃР»РѕРІРёСЏ
 * (РЅР°С‡РёРЅР°РµС‚СЃСЏ СЃ "РµСЃР»Рё", "РєРѕРіРґР°" Рё С‚.Рґ.)
 */
function isNewCondition(text) {
    if (!text) return false;
    
    const newConditionPatterns = [
        /^(РµСЃР»Рё|РєРѕРіРґР°|РїСЂРё|РІ\s+СЃР»СѓС‡Р°Рµ)\s+/i,
        /^РµСЃР»Рё\b/i,
        /^РєРѕРіРґР°\b/i,
        /^(if|when)\s+/i
    ];
    
    return newConditionPatterns.some(pattern => pattern.test(text.trim()));
}

function shouldMergeWithPrevious(atomicChunk, currentComposite) {
    if (!currentComposite) return false;
    
    // 1. Р•СЃР»Рё С‚РµРєСѓС‰РёР№ С‡Р°РЅРє - РЅР°С‡Р°Р»Рѕ СѓСЃР»РѕРІРЅРѕР№ РєРѕРЅСЃС‚СЂСѓРєС†РёРё, Р° РїСЂРµРґС‹РґСѓС‰РёР№ - РЅРµС‚ СѓСЃР»РѕРІРёРµ
    // РѕР±СЉРµРґРёРЅСЏРµРј С‡С‚РѕР±С‹ РЅРµ СЂР°Р·СЂС‹РІР°С‚СЊ "РµСЃР»Рё в†’ С‚Рѕ"
    const currentText = atomicChunk.core_text || atomicChunk.cleaned_text || '';
    const prevText = currentComposite.core_text || currentComposite.cleaned_text || '';
    
    // Р•СЃР»Рё РїСЂРµРґС‹РґСѓС‰РёР№ СЃРѕРґРµСЂР¶РёС‚ СѓСЃР»РѕРІРЅСѓСЋ РєРѕРЅСЃС‚СЂСѓРєС†РёСЋ (РµСЃР»Рё/С‚Рѕ/РёРЅР°С‡Рµ), Р° С‚РµРєСѓС‰РёР№ РїСЂРѕРґРѕР»Р¶Р°РµС‚ РµС‘ - РѕР±СЉРµРґРёРЅСЏРµРј
    if (isConditionalBranch(prevText) && isConditionalContinuation(currentText)) {
        return true;
    }
    
    // Р•СЃР»Рё РѕР±Р° СЃРѕРґРµСЂР¶Р°С‚ СѓСЃР»РѕРІРЅС‹Рµ РєРѕРЅСЃС‚СЂСѓРєС†РёРё - РѕР±СЉРµРґРёРЅСЏРµРј
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
    const currentAux = atomicChunk.aux_metadata || atomicChunk.metadata?.aux_metadata || {};
    const previousAux = currentComposite.aux_metadata || currentComposite.metadata?.aux_metadata || {};
    if (!sharesFunctionalUnit(previousAux, currentAux)) {
        return false;
    }
    if (introducesNewOutcomeOrErrorFlow(prevText, currentText)) {
        return false;
    }
    
    // 2. Р•СЃР»Рё РїСЂРµРґС‹РґСѓС‰РёР№ - С‚Р°Р±Р»РёС†Р° С‚СЂРµР±РѕРІР°РЅРёР№, Р° С‚РµРєСѓС‰РёР№ - РµС‘ РїСЂРѕРґРѕР»Р¶РµРЅРёРµ (РЅРµ РЅРѕРІС‹Р№ Р·Р°РіРѕР»РѕРІРѕРє)
    if (currentComposite.chunk_type === CHUNK_TYPES.TABLE_ROW && 
        atomicChunk.chunk_type === CHUNK_TYPES.TABLE_ROW) {
        return true;
    }
    
    // 3. РћР±СЉРµРґРёРЅСЏРµРј РµСЃР»Рё С‚РёРїС‹ СЃРѕРІРїР°РґР°СЋС‚ Рё РїСЂРµРґС‹РґСѓС‰РёР№ РЅРµ СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№
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
    
    // РџСЂРѕРІРµСЂСЏРµРј, РЅРµ СЃР»РёС€РєРѕРј Р»Рё Р±РѕР»СЊС€РѕР№ СѓР¶Рµ composite
    if (currentComposite.token_count > 800) {
        return false;
    }
    
    return classifyBehaviorDetailClause(currentText) !== null ||
        classifyBehaviorDetailClause(atomicChunk.cleaned_text || '') !== null ||
        (isConditionalBranch(prevText) && isConditionalContinuation(currentText));
}

function sharesFunctionalUnit(previousAux = {}, currentAux = {}) {
    return sameOrMissing(previousAux.entity_scope, currentAux.entity_scope) &&
        sameOrMissing(previousAux.screen_scope, currentAux.screen_scope) &&
        sameOrMissing(previousAux.endpoint, currentAux.endpoint) &&
        sameOrMissing(previousAux.method, currentAux.method);
}

function introducesNewOutcomeOrErrorFlow(previousText, currentText) {
    const previousOutcome = extractOutcomeSignature(previousText);
    const currentOutcome = extractOutcomeSignature(currentText);
    const previousErrorFlow = isErrorFlowText(previousText);
    const currentErrorFlow = isErrorFlowText(currentText);

    if (previousErrorFlow !== currentErrorFlow) {
        return true;
    }
    if (previousOutcome && currentOutcome && previousOutcome !== currentOutcome) {
        return true;
    }
    return false;
}

function isErrorFlowText(text) {
    return /(РѕС€РёР±Рє|error|exception|timeout|forbidden|unauthorized|not found|bad request)/i.test(String(text || ''));
}

function sameOrMissing(left, right) {
    const normalizedLeft = normalizeForComparison(left);
    const normalizedRight = normalizeForComparison(right);
    if (!normalizedLeft || !normalizedRight) {
        return true;
    }
    return normalizedLeft === normalizedRight;
}

// ============================================================
// РЈРўРР›РРўР«
// ============================================================

function cleanText(text) {
    if (!text) return '';
    
    return text
        // РЈРґР°Р»СЏРµРј Р»РёС€РЅРёРµ РїСЂРѕР±РµР»С‹
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        // РЈРґР°Р»СЏРµРј URL РёР· С‚РµРєСЃС‚Р° (РѕРЅРё РІ metadata)
        .replace(/(?<!\]\()https?:\/\/[^\s]+/g, '')
        // РЈРґР°Р»СЏРµРј СЃРїРµС†СЃРёРјРІРѕР»С‹ markdown РєРѕС‚РѕСЂС‹Рµ РЅРµ РЅРµСЃСѓС‚ СЃРјС‹СЃР»Р°
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) -> text
        .replace(/[*_`#]/g, '')
        .trim();
}

function isMeaningfulChunkText(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) {
        return false;
    }

    if (/^[-вЂ“вЂ”\\/|.,:;()[\]{}*_`~]+$/.test(cleaned)) {
        return false;
    }

    const alnum = cleaned.replace(/[^\p{L}\p{N}]+/gu, '');
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
    const numberMatch = raw.match(/^(?:в„–\s*:\s*|в„–\s*)([\d.]+)/i) || raw.match(/^([\d.]{3,})\s*[;:]/);
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
            semanticSections.push(...buildRequirementRowSemanticSections(section, mappedRow, {
                line_start: row.line_start,
                line_end: row.line_end
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
        semanticSections.push(...buildRequirementRowSemanticSections(section, mappedRow, {
            line_start: section.line_start,
            line_end: section.line_end
        }));
    }

    return semanticSections;
}

function buildRequirementRowSemanticSections(section, mappedRow, lineRange = {}) {
    const branchSplit = splitRequirementIntoScenarioBranches(mappedRow.requirement || '');
    const rowHeading = buildRequirementRowHeading(section.heading, mappedRow.row_number, mappedRow.element);
    const sectionPath = buildSectionPathForRow(section.path, mappedRow.row_number || mappedRow.element);
    const rowPayload = buildRequirementRowPayload(mappedRow, branchSplit.sharedIntro);
    const rowMetadata = buildRequirementChunkMetadata(mappedRow, branchSplit.sharedIntro, rowPayload.aux_metadata);
    const sectionNumber = mappedRow.row_number || section.section_number || null;
    const lineStart = lineRange?.line_start ?? section.line_start;
    const lineEnd = lineRange?.line_end ?? section.line_end;
    const lineageGroupKey = buildRequirementLineageKey(section, mappedRow, lineStart);
    const summaryPayload = buildRequirementSummaryPayload(mappedRow, branchSplit.sharedIntro, rowPayload);
    const legacyDebugPayload = buildRequirementLegacyDebugPayload(rowPayload);

    const semanticSections = [
        createFinalSemanticSection(section, {
            heading: `${rowHeading} / summary`,
            path: sectionPath,
            section_number: sectionNumber,
            line_start: lineStart,
            line_end: lineEnd,
            split_source: 'requirement_row_summary',
            chunk_type_hint: CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY,
            metadata: {
                ...rowMetadata,
                semantic_role: CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY,
                row_number: mappedRow.row_number || null,
                element: mappedRow.element || null,
                chunk_granularity: 'summary',
                parent_row_number: mappedRow.row_number || null,
                atomic_rule_kind: null,
                lineage_group_key: lineageGroupKey,
                trace_only: true,
                source_scope: 'main',
                exclude_from_retrieval: true,
                exclude_from_graph: true
            },
            retrieval_profile: summaryPayload,
            content: summaryPayload.legacy_text
        }),
        createFinalSemanticSection(section, {
            heading: `${rowHeading} / legacy debug`,
            path: sectionPath,
            section_number: sectionNumber,
            line_start: lineStart,
            line_end: lineEnd,
            split_source: 'requirement_row_legacy_debug',
            chunk_type_hint: CHUNK_TYPES.REQUIREMENT_ROW,
            metadata: {
                ...rowMetadata,
                semantic_role: CHUNK_TYPES.REQUIREMENT_ROW,
                row_number: mappedRow.row_number || null,
                element: mappedRow.element || null,
                chunk_granularity: 'summary',
                parent_row_number: mappedRow.row_number || null,
                atomic_rule_kind: null,
                lineage_group_key: lineageGroupKey,
                trace_only: true,
                source_scope: 'main',
                exclude_from_retrieval: true,
                exclude_from_graph: true
            },
            retrieval_profile: legacyDebugPayload,
            content: buildRequirementRowContent(mappedRow, rowPayload)
        })
    ];

    const atomicRules = collectRequirementAtomicRules(mappedRow, branchSplit, rowPayload);
    atomicRules.forEach((rule, index) => {
        const atomicPayload = buildRequirementAtomicRulePayload(mappedRow, branchSplit.sharedIntro, rule, rowPayload);
        semanticSections.push(createFinalSemanticSection(section, {
            heading: `${rowHeading} / atomic ${index + 1}`,
            path: sectionPath,
            section_number: sectionNumber,
            line_start: lineStart,
            line_end: lineEnd,
            split_source: 'atomic_rule',
            chunk_type_hint: CHUNK_TYPES.ATOMIC_RULE,
            metadata: {
                ...rowMetadata,
                semantic_role: CHUNK_TYPES.ATOMIC_RULE,
                row_number: mappedRow.row_number || null,
                element: mappedRow.element || null,
                branch_label: rule.branch_label || null,
                branch_source_number: rule.branch_source_number || null,
                atomic_rule_index: index + 1,
                atomic_rule_kind: rule.kind,
                chunk_granularity: 'atomic',
                parent_row_number: mappedRow.row_number || null,
                lineage_group_key: lineageGroupKey,
                source_scope: 'main',
                screen_scope: atomicPayload.aux_metadata.screen_scope || rowPayload.aux_metadata.screen_scope || null,
                channel_scope: atomicPayload.aux_metadata.channel_scope || rowPayload.aux_metadata.channel_scope || null,
                entity_scope: atomicPayload.aux_metadata.entity_scope || rowPayload.aux_metadata.entity_scope || null,
                endpoint: atomicPayload.aux_metadata.endpoint || null,
                method: atomicPayload.aux_metadata.method || null
            },
            retrieval_profile: atomicPayload,
            content: atomicPayload.legacy_text
        }));
    });

    return semanticSections;
}

function looksLikeFlattenedRequirementRow(line) {
    return /(^|;\s*)(No|в„–|РќРѕРјРµСЂ|Element|Р­Р»РµРјРµРЅС‚|Requirement|РўСЂРµР±РѕРІР°РЅРёРµ)\s*:/i.test(line);
}

function parseFlattenedRequirementRow(line) {
    const fieldRegex = /(^|;\s*)(No|в„–|РќРѕРјРµСЂ|Element|Р­Р»РµРјРµРЅС‚(?:\/Р±Р»РѕРє\/Р»РѕРіРёРєР°)?|Requirement|РўСЂРµР±РѕРІР°РЅРёРµ|Method|РњРµС‚РѕРґ|Parameters|РџР°СЂР°РјРµС‚СЂС‹|Layout|РњР°РєРµС‚)\s*:\s*/gi;
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
    if (normalized === 'no' || normalized.includes('РЅРѕРјРµСЂ')) {
        return 'row_number';
    }
    if (normalized.includes('element') || normalized.includes('СЌР»РµРјРµРЅС‚') || normalized.includes('Р±Р»РѕРє') || normalized.includes('Р»РѕРіРёРє')) {
        return 'element';
    }
    if (normalized.includes('requirement') || normalized.includes('С‚СЂРµР±РѕРІР°РЅ')) {
        return 'requirement';
    }
    if (normalized.includes('method') || normalized.includes('РјРµС‚РѕРґ')) {
        return 'method';
    }
    if (normalized.includes('parameter') || normalized.includes('РїР°СЂР°РјРµС‚СЂ')) {
        return 'params';
    }
    if (normalized.includes('layout') || normalized.includes('РјР°РєРµС‚')) {
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

    if (/РєРѕРЅС‚РµРєСЃС‚ РїРѕ СЃСЃС‹Р»РєРµ РёР· РѕСЃРЅРѕРІРЅРѕР№ СЃС‚Р°С‚СЊРё|СѓРїРѕРјРёРЅР°РЅРёРµ РІ РѕСЃРЅРѕРІРЅРѕР№ СЃС‚Р°С‚СЊРµ|linked context/i.test(headingText)) {
        return CHUNK_TYPES.NOISE_SKIPPED;
    }

    if (/РІР»РѕР¶РµРЅРёСЏ|attachments|РїСЂРёР»РѕР¶РµРЅРёСЏ|test data|С‚РµСЃС‚РѕРІС‹Рµ РґР°РЅРЅС‹Рµ/i.test(headingText)) {
        return CHUNK_TYPES.NOISE_METADATA;
    }

    if (/РґР°РЅРЅС‹Рµ РґРѕРєСѓРјРµРЅС‚Р°|document meta|document data/i.test(headingText)) {
        return CHUNK_TYPES.DOCUMENT_META;
    }

    if (/change\s*log|changelog|РёСЃС‚РѕСЂРёСЏ РёР·РјРµРЅРµРЅРёР№/i.test(headingText)) {
        return CHUNK_TYPES.CHANGE_LOG;
    }

    if (/РѕР±С‰Р°СЏ РёРЅС„РѕСЂРјР°С†РёСЏ|business context|РєРѕРЅС‚РµРєСЃС‚ СЃРёСЃС‚РµРјС‹/i.test(headingText)) {
        return CHUNK_TYPES.BUSINESS_CONTEXT;
    }

    if (/РѕР±Р»Р°СЃС‚СЊ РїСЂРёРјРµРЅРµРЅРёСЏ|scope|РіСЂР°РЅРёС†С‹ РїСЂРѕС†РµСЃСЃР°/i.test(headingText)) {
        return CHUNK_TYPES.SCOPE_CONTEXT;
    }

    return null;
}

function shouldExcludeChunkTypeFromRetrieval(chunkType) {
    return RETRIEVAL_EXCLUDED_CHUNK_TYPES.has(chunkType);
}

function normalizeRetrievalProfile(profile, cleanedText = '') {
    const contentRatio = profile?.content_ratio && typeof profile.content_ratio === 'object'
        ? profile.content_ratio
        : {
            behavioral_ratio: null,
            service_ratio: null
        };

    return {
        core_text: trimSemanticBlock(profile?.core_text || ''),
        embedding_text: trimSemanticBlock(profile?.embedding_text || profile?.core_text || cleanedText),
        aux_metadata: { ...(profile?.aux_metadata || {}) },
        retrieval_class: profile?.retrieval_class || null,
        eligibility_status: profile?.eligibility_status || null,
        retrieval_penalty: Number.isFinite(profile?.retrieval_penalty) ? Number(profile.retrieval_penalty) : 0,
        content_ratio: contentRatio,
        chunk_granularity: profile?.chunk_granularity || profile?.aux_metadata?.chunk_granularity || 'atomic',
        drop_reason: profile?.drop_reason || null,
        exclude_from_retrieval: Boolean(profile?.exclude_from_retrieval),
        has_behavioral_predicate: Boolean(profile?.has_behavioral_predicate),
        has_expected_result: Boolean(profile?.has_expected_result),
        metadata_only: Boolean(profile?.metadata_only)
    };
}

function assignRetrievalProfile(section, chunkType) {
    const legacyText = cleanText(getChunkableSectionText(section));
    const normalized = normalizeRetrievalProfile(section?.retrieval_profile, legacyText);
    const retrievalClass = normalized.retrieval_class || determineRetrievalClass(section, chunkType, normalized, legacyText);
    const auxMetadata = {
        ...(section?.metadata?.aux_metadata || {}),
        ...(section?.metadata || {}),
        ...(normalized.aux_metadata || {})
    };
    delete auxMetadata.source_ref_text;
    delete auxMetadata.exclude_from_retrieval;
    delete auxMetadata.exclude_from_graph;
    delete auxMetadata.semantic_role;
    delete auxMetadata.graph_eligible;
    delete auxMetadata.relevance_score;
    delete auxMetadata.canonical_key;
    delete auxMetadata.drop_reason;

    if (!auxMetadata.section_number && section?.section_number) {
        auxMetadata.section_number = section.section_number;
    }

    const baseProfile = {
        ...normalized,
        core_text: normalized.core_text || (retrievalClass === RETRIEVAL_CLASSES.BEHAVIORAL ? legacyText : ''),
        embedding_text: normalized.embedding_text || (retrievalClass === RETRIEVAL_CLASSES.BEHAVIORAL ? normalized.core_text || legacyText : legacyText),
        aux_metadata: auxMetadata,
        retrieval_class: retrievalClass,
        chunk_granularity: normalized.chunk_granularity || auxMetadata.chunk_granularity || section?.metadata?.chunk_granularity || 'atomic'
    };
    const evaluation = retrievalClass === RETRIEVAL_CLASSES.BEHAVIORAL
        ? evaluateBehavioralEligibility(baseProfile, legacyText, chunkType)
        : evaluateContextEligibility(baseProfile, legacyText, chunkType);
    const excludeFromRetrieval = Boolean(
        normalized.exclude_from_retrieval ||
        evaluation.exclude_from_retrieval ||
        shouldExcludeChunkTypeFromRetrieval(chunkType)
    );
    const forcedExcluded = excludeFromRetrieval || RETRIEVAL_EXCLUDED_CHUNK_TYPES.has(chunkType);
    const resolvedEligibilityStatus = forcedExcluded
        ? ELIGIBILITY_STATUSES.EXCLUDED
        : evaluation.eligibility_status;
    const resolvedRetrievalPenalty = forcedExcluded
        ? Math.max(1.0, Number(evaluation.retrieval_penalty || normalized.retrieval_penalty || 0))
        : evaluation.retrieval_penalty;
    const resolvedDropReason = forcedExcluded
        ? (evaluation.drop_reason || normalized.drop_reason || 'excluded_by_policy')
        : evaluation.drop_reason;

    return {
        ...baseProfile,
        ...evaluation,
        eligibility_status: resolvedEligibilityStatus,
        retrieval_penalty: resolvedRetrievalPenalty,
        drop_reason: resolvedDropReason,
        exclude_from_retrieval: excludeFromRetrieval
    };
}

function determineRetrievalClass(section, chunkType, normalizedProfile, legacyText = '') {
    if ([
        CHUNK_TYPES.API_ENDPOINT_SUMMARY,
        CHUNK_TYPES.API_INPUT_PARAMS,
        CHUNK_TYPES.API_OUTPUT_PARAMS,
        CHUNK_TYPES.API_BEHAVIOR_NOTES,
        CHUNK_TYPES.API_CONTRACT
    ].includes(chunkType)) {
        return RETRIEVAL_CLASSES.API_CONTEXT;
    }

    if ([
        CHUNK_TYPES.REFERENCE_CONTEXT,
        CHUNK_TYPES.REFERENCE_LINK,
        CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY,
        CHUNK_TYPES.REQUIREMENT_ROW,
        CHUNK_TYPES.DOCUMENT_META,
        CHUNK_TYPES.CHANGE_LOG,
        CHUNK_TYPES.BUSINESS_CONTEXT,
        CHUNK_TYPES.SCOPE_CONTEXT,
        CHUNK_TYPES.NOISE_METADATA,
        CHUNK_TYPES.NOISE_SKIPPED
    ].includes(chunkType)) {
        return RETRIEVAL_CLASSES.REFERENCE_CONTEXT;
    }

    if ([CHUNK_TYPES.ATOMIC_RULE, CHUNK_TYPES.SCENARIO_BRANCH].includes(chunkType)) {
        return RETRIEVAL_CLASSES.BEHAVIORAL;
    }

    if ([CHUNK_TYPES.VALIDATION_RULE, CHUNK_TYPES.ERROR_HANDLING].includes(chunkType)) {
        const text = normalizedProfile.core_text || legacyText;
        return hasExpectedResultSignal(text) || hasBehavioralPredicateSignal(text)
            ? RETRIEVAL_CLASSES.BEHAVIORAL
            : RETRIEVAL_CLASSES.REFERENCE_CONTEXT;
    }

    if ([CHUNK_TYPES.BUSINESS_RULE, CHUNK_TYPES.UI_RULE, CHUNK_TYPES.UI_CURRENT_BEHAVIOR, CHUNK_TYPES.SCENARIO_STEP].includes(chunkType)) {
        return RETRIEVAL_CLASSES.BEHAVIORAL;
    }

    return containsApiContract(`${section?.heading || ''}\n${legacyText}`)
        ? RETRIEVAL_CLASSES.API_CONTEXT
        : RETRIEVAL_CLASSES.REFERENCE_CONTEXT;
}

function evaluateBehavioralEligibility(profile, legacyText, chunkType) {
    const coreText = trimSemanticBlock(profile.core_text || '');
    const hasBehavioralPredicate = hasBehavioralPredicateSignal(coreText || legacyText);
    const hasExpectedResult = hasExpectedResultSignal(coreText || legacyText);
    const metadataOnly = !isMeaningfulChunkText(cleanText(coreText));
    const serviceRatio = calculateServiceRatio(legacyText || coreText);
    const dropReason = determineBehavioralDropReason({
        chunkType,
        metadataOnly,
        hasBehavioralPredicate,
        hasExpectedResult,
        serviceRatio,
        auxMetadata: profile.aux_metadata
    });

    let eligibilityStatus = ELIGIBILITY_STATUSES.ELIGIBLE;
    if (metadataOnly || (!hasBehavioralPredicate && !hasExpectedResult) || serviceRatio >= 0.65) {
        eligibilityStatus = ELIGIBILITY_STATUSES.EXCLUDED;
    } else if (!hasBehavioralPredicate || !hasExpectedResult || serviceRatio >= 0.35) {
        eligibilityStatus = ELIGIBILITY_STATUSES.PENALIZED;
    }

    return {
        eligibility_status: eligibilityStatus,
        retrieval_penalty: eligibilityStatus === ELIGIBILITY_STATUSES.ELIGIBLE
            ? 0
            : (eligibilityStatus === ELIGIBILITY_STATUSES.PENALIZED ? 0.2 : 1.0),
        content_ratio: {
            behavioral_ratio: Number((1 - serviceRatio).toFixed(4)),
            service_ratio: Number(serviceRatio.toFixed(4))
        },
        drop_reason: dropReason,
        has_behavioral_predicate: hasBehavioralPredicate,
        has_expected_result: hasExpectedResult,
        metadata_only: metadataOnly,
        exclude_from_retrieval: eligibilityStatus === ELIGIBILITY_STATUSES.EXCLUDED
    };
}

function evaluateContextEligibility(profile, legacyText, chunkType) {
    const meaningful = isMeaningfulChunkText(cleanText(profile.embedding_text || legacyText));
    const serviceRatio = calculateServiceRatio(legacyText || profile.embedding_text || '');
    const eligibilityStatus = meaningful
        ? ELIGIBILITY_STATUSES.ELIGIBLE
        : ELIGIBILITY_STATUSES.EXCLUDED;
    const dropReason = meaningful
        ? null
        : (chunkType === CHUNK_TYPES.REFERENCE_LINK ? 'reference_heavy' : 'metadata_only');

    return {
        eligibility_status: eligibilityStatus,
        retrieval_penalty: eligibilityStatus === ELIGIBILITY_STATUSES.ELIGIBLE ? 0 : 1.0,
        content_ratio: {
            behavioral_ratio: Number((1 - serviceRatio).toFixed(4)),
            service_ratio: Number(serviceRatio.toFixed(4))
        },
        drop_reason: dropReason,
        has_behavioral_predicate: false,
        has_expected_result: false,
        metadata_only: !meaningful,
        exclude_from_retrieval: eligibilityStatus === ELIGIBILITY_STATUSES.EXCLUDED
    };
}

function determineBehavioralDropReason({
    chunkType,
    metadataOnly,
    hasBehavioralPredicate,
    hasExpectedResult,
    serviceRatio,
    auxMetadata = {}
}) {
    const hasConstraintDetails = [
        ...(auxMetadata.constraints || []),
        ...(auxMetadata.display_rules || []),
        ...(auxMetadata.validation_rules || []),
        ...(auxMetadata.fallbacks || [])
    ].length > 0;

    if (metadataOnly && hasConstraintDetails) {
        return 'constraint_only';
    }
    if (metadataOnly) {
        return 'metadata_only';
    }
    if (!hasBehavioralPredicate && !hasExpectedResult) {
        return 'metadata_only';
    }
    if (!hasBehavioralPredicate) {
        return 'missing_behavioral_predicate';
    }
    if (!hasExpectedResult) {
        return 'missing_expected_result';
    }
    if (serviceRatio >= 0.65 || serviceRatio >= 0.35) {
        if ((auxMetadata.layout_hints || []).length > 0 && !(auxMetadata.related_params || []).length) {
            return 'layout_only';
        }
        if ((auxMetadata.references || []).length > 0 && !(auxMetadata.related_params || []).length) {
            return 'reference_heavy';
        }
        return 'params_heavy';
    }
    if ([CHUNK_TYPES.VALIDATION_RULE].includes(chunkType) && hasConstraintDetails) {
        return 'constraint_only';
    }
    return null;
}

function calculateServiceRatio(text = '') {
    const normalizedTokens = normalizeForComparison(text)
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);
    if (normalizedTokens.length === 0) {
        return 1;
    }

    const serviceTokenPatterns = [
        'api',
        'endpoint',
        'method',
        'request',
        'response',
        'status',
        'header',
        'param',
        'reference',
        'layout',
        'figma',
        'РјР°РєРµС‚',
        'РїР°СЂР°РјРµС‚СЂ',
        'РјРµС‚РѕРґ',
        'СЃСЃС‹Р»Рє',
        'layout',
        'channel',
        'screen',
        'page',
        'row',
        'section',
        'С‚Р°Р±Р»'
    ];
    const serviceTokenCount = normalizedTokens.filter(token =>
        serviceTokenPatterns.some(pattern => token.includes(pattern))
    ).length;

    return serviceTokenCount / normalizedTokens.length;
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

function applyRequirementLineage(chunks = []) {
    const list = Array.isArray(chunks) ? chunks : [];
    const groups = new Map();

    for (const chunk of list) {
        const lineageGroupKey = chunk?.metadata?.lineage_group_key || chunk?.lineage_group_key || null;
        if (!lineageGroupKey) {
            continue;
        }
        if (!groups.has(lineageGroupKey)) {
            groups.set(lineageGroupKey, []);
        }
        groups.get(lineageGroupKey).push(chunk);
    }

    for (const groupChunks of groups.values()) {
        const summaryChunk = groupChunks.find((chunk) =>
            chunk?.chunk_type === CHUNK_TYPES.REQUIREMENT_ROW_SUMMARY
        ) || null;
        const atomicRules = groupChunks.filter((chunk) =>
            chunk?.chunk_type === CHUNK_TYPES.ATOMIC_RULE &&
            (chunk?.chunk_granularity || chunk?.metadata?.chunk_granularity || 'atomic') === 'atomic'
        );
        const childIds = atomicRules.map((chunk) => chunk.id).filter(Boolean);

        if (summaryChunk) {
            summaryChunk.lineage_child_rule_ids = childIds;
            summaryChunk.metadata = {
                ...(summaryChunk.metadata || {}),
                lineage_child_rule_ids: childIds
            };
        }

        for (const atomicChunk of atomicRules) {
            atomicChunk.lineage_parent_summary_id = summaryChunk?.id || null;
            atomicChunk.metadata = {
                ...(atomicChunk.metadata || {}),
                lineage_parent_summary_id: summaryChunk?.id || null
            };
        }
    }

    return list;
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
        header === 'no' || header.includes('РЅРѕРјРµСЂ')
    ) || rawHeaders.includes('в„–');
    const hasRequirement = normalizedHeaders.some(header =>
        header.includes('С‚СЂРµР±РѕРІР°РЅ') || header.includes('requirement')
    );
    const hasElement = normalizedHeaders.some(header =>
        header.includes('СЌР»РµРјРµРЅС‚') || header.includes('Р±Р»РѕРє') || header.includes('Р»РѕРіРёРє') || header.includes('element')
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
    if (raw === 'в„–') {
        return 'row_number';
    }

    const normalized = normalizeForComparison(header);

    if (!normalized) {
        return `column_${index + 1}`;
    }

    if (normalized === 'в„–' || normalized === 'no' || normalized.includes('РЅРѕРјРµСЂ')) {
        return 'row_number';
    }
    if (normalized.includes('СЌР»РµРјРµРЅС‚') || normalized.includes('Р±Р»РѕРє') || normalized.includes('Р»РѕРіРёРє')) {
        return 'element';
    }
    if (normalized.includes('С‚СЂРµР±РѕРІР°РЅ')) {
        return 'requirement';
    }
    if (normalized.includes('РјРµС‚РѕРґ')) {
        return 'method';
    }
    if (normalized.includes('РїР°СЂР°РјРµС‚СЂ')) {
        return 'params';
    }
    if (normalized.includes('РјР°РєРµС‚') || normalized.includes('figma')) {
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

function buildRequirementRowPayload(row, sharedIntro = '') {
    const rawBehaviorText = trimSemanticBlock(String(row.requirement || '').trim());
    const behaviorText = stripServiceContextFragments(rawBehaviorText);
    const sharedContext = summarizeSharedContext(sharedIntro, row.element || '');
    const detailBuckets = extractBehaviorDetailBuckets(behaviorText);
    const methodSummary = buildMethodContextSummary(row.method);
    const paramsSummary = buildRelevantParamsSummary(row.params, row.requirement);
    const layoutSummary = buildReferenceSummary(row.layout);
    const coreText = buildBehavioralCoreText({
        subject: row.element,
        sharedContext,
        behavior: detailBuckets.behavior
    });
    const auxMetadata = buildRequirementAuxMetadata({
        row,
        sharedContext,
        behaviorText: rawBehaviorText,
        detailBuckets
    });

    return {
        core_text: coreText,
        embedding_text: coreText,
        chunk_granularity: 'atomic',
        aux_metadata: auxMetadata,
        legacy_text: renderRequirementLegacyText({
            rowNumber: row.row_number,
            element: row.element,
            context: sharedContext,
            branchLabel: null,
            behavior: detailBuckets.behavior || behaviorText,
            methodSummary,
            paramsSummary,
            layoutSummary
        })
    };
}

function buildRequirementRowContent(row, payload = null) {
    return (payload || buildRequirementRowPayload(row)).legacy_text;
}

function buildRequirementBranchPayload(row, sharedIntro, branch) {
    const sharedContext = summarizeSharedContext(sharedIntro, row.element || '');
    const rawBranchText = trimSemanticBlock(String(branch?.text || '').trim());
    const branchText = stripServiceContextFragments(rawBranchText);
    const detailBuckets = extractBehaviorDetailBuckets(branchText);
    const methodSummary = buildMethodContextSummary(row.method);
    const paramsSummary = buildRelevantParamsSummary(row.params, branch?.text || row.requirement);
    const coreText = buildBehavioralCoreText({
        subject: row.element,
        sharedContext,
        behavior: detailBuckets.behavior
    });
    const auxMetadata = buildRequirementAuxMetadata({
        row,
        sharedContext,
        behaviorText: rawBranchText,
        detailBuckets,
        branchLabel: branch?.label || null
    });

    return {
        core_text: coreText,
        embedding_text: coreText,
        chunk_granularity: 'atomic',
        aux_metadata: auxMetadata,
        legacy_text: renderRequirementLegacyText({
            rowNumber: row.row_number,
            element: row.element,
            context: sharedContext,
            branchLabel: branch?.label || null,
            behavior: detailBuckets.behavior || branchText,
            methodSummary,
            paramsSummary,
            layoutSummary: ''
        })
    };
}

function buildRequirementBranchContent(row, sharedIntro, branch, payload = null) {
    return (payload || buildRequirementBranchPayload(row, sharedIntro, branch)).legacy_text;
}

function buildRequirementSummaryPayload(row, sharedIntro = '', rowPayload = null) {
    const payload = rowPayload || buildRequirementRowPayload(row, sharedIntro);
    const sharedContext = summarizeSharedContext(sharedIntro, row.element || '');
    const summaryText = trimSemanticBlock([
        cleanInlineText(row.element || ''),
        sharedContext ? `Scope: ${sharedContext}` : '',
        row.row_number ? `Row ${row.row_number}` : ''
    ].filter(Boolean).join('\n'));
    const auxMetadata = {
        ...(payload.aux_metadata || {}),
        atomic_rule_kind: null,
        parent_row_number: row.row_number || null
    };

    return {
        core_text: summaryText,
        embedding_text: summaryText,
        chunk_granularity: 'summary',
        retrieval_class: RETRIEVAL_CLASSES.REFERENCE_CONTEXT,
        eligibility_status: ELIGIBILITY_STATUSES.EXCLUDED,
        retrieval_penalty: 1.0,
        exclude_from_retrieval: true,
        drop_reason: 'summary_debug_only',
        aux_metadata: auxMetadata,
        legacy_text: summaryText
    };
}

function buildRequirementLegacyDebugPayload(payload = {}) {
    return {
        ...(payload || {}),
        chunk_granularity: 'summary',
        retrieval_class: RETRIEVAL_CLASSES.REFERENCE_CONTEXT,
        eligibility_status: ELIGIBILITY_STATUSES.EXCLUDED,
        retrieval_penalty: 1.0,
        exclude_from_retrieval: true,
        drop_reason: 'legacy_debug_only'
    };
}

function buildRequirementLineageKey(section, row, lineStart) {
    const sectionKey = [
        ...(Array.isArray(section?.path) ? section.path : []),
        section?.heading || '',
        section?.section_number || '',
        lineStart || ''
    ].filter(Boolean).join('|');
    const rowKey = row?.row_number || row?.element || row?.requirement || 'row';
    return `${sectionKey}::${cleanInlineText(String(rowKey || 'row'))}`;
}

function collectRequirementAtomicRules(row, branchSplit, rowPayload) {
    const atomicRules = [];
    const normalizedBranches = Array.isArray(branchSplit?.branches) && branchSplit.branches.length
        ? branchSplit.branches
        : [{ label: null, sourceNumber: null, text: row?.requirement || '' }];

    for (const branch of normalizedBranches) {
        const payload = buildRequirementBranchPayload(row, branchSplit?.sharedIntro || '', branch);
        const sourceText = trimSemanticBlock(String(branch?.text || row?.requirement || ''));
        const entries = collectAtomicRuleEntriesFromSourceText(sourceText, payload);
        for (const entry of entries) {
            atomicRules.push({
                text: entry.text,
                kind: entry.kind,
                branch_label: branch?.label || null,
                branch_source_number: branch?.sourceNumber || null
            });
        }
    }

    if (atomicRules.length === 0) {
        const fallbackText = trimSemanticBlock(rowPayload?.core_text || row?.requirement || '');
        if (fallbackText) {
            atomicRules.push({
                text: fallbackText,
                kind: classifyAtomicRuleKind(fallbackText),
                branch_label: null,
                branch_source_number: null
            });
        }
    }

    const deduped = [];
    const seen = new Set();
    for (const rule of atomicRules) {
        const text = trimSemanticBlock(rule?.text || '');
        const normalized = normalizeForComparison(text);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        deduped.push({
            ...rule,
            text
        });
    }

    return deduped;
}

function collectAtomicRuleEntriesFromSourceText(sourceText, payload = {}) {
    const entries = [];
    const parsed = parseStructuredBranchText(sourceText);
    const aux = payload?.aux_metadata || {};
    const candidateTexts = [
        parsed.behavior,
        ...parsed.clauses,
        ...(aux.fallbacks || []),
        ...(aux.validation_rules || []),
        ...(aux.display_rules || []),
        ...(aux.constraints || [])
    ]
        .map(text => trimSemanticBlock(text))
        .filter(Boolean);

    for (const text of candidateTexts) {
        const splitEntries = splitInlineConditionalClauses(text);
        for (const entryText of splitEntries) {
            const cleanedEntry = trimSemanticBlock(entryText);
            const semanticEntry = stripServiceContextFragments(cleanedEntry);
            if (!semanticEntry || !isMeaningfulChunkText(cleanText(semanticEntry))) {
                continue;
            }
            entries.push({
                text: semanticEntry,
                kind: classifyAtomicRuleKind(semanticEntry)
            });
        }
    }

    return entries;
}

function classifyAtomicRuleKind(text) {
    const cleaned = trimSemanticBlock(text);
    const normalized = normalizeForComparison(cleaned);
    if (!cleaned || !normalized) {
        return 'behavior_rule';
    }
    if (/(^|\s)(status|СЃС‚Р°С‚СѓСЃ)\b|=\s*(decline|end|approved|rejected|success|failed)/i.test(cleaned)) {
        return 'status_rule';
    }
    if (containsErrorHandling(cleaned) || /(error|exception|timeout|forbidden|unauthorized|not found|bad request)/i.test(cleaned)) {
        return 'error_rule';
    }
    if (containsValidationRule(cleaned) || /(РІР°Р»РёРґ|must|should|required|РѕР±СЏР·Р°С‚РµР»СЊ|format|РґРѕРїСѓСЃС‚РёРј)/i.test(cleaned)) {
        return 'validation_rule';
    }
    if (/(sort|sorting|СЃРѕСЂС‚РёСЂРѕРІ|РїРѕСЂСЏРґРѕРє|ascending|descending|РїРѕ РІРѕР·СЂР°СЃС‚Р°РЅРёСЋ|РїРѕ СѓР±С‹РІР°РЅРёСЋ)/i.test(cleaned)) {
        return 'ordering_rule';
    }
    if (/(РЅРµС‚ РґР°РЅРЅС‹С…|РѕС‚СЃСѓС‚СЃС‚РІ|РЅРµ РЅР°Р№РґРµРЅ|empty|null|absent|РЅРµ РѕС‚РѕР±СЂР°Р¶)/i.test(cleaned)) {
        return 'absence_rule';
    }
    if (isFallbackClauseText(cleaned)) {
        return 'fallback_rule';
    }
    return 'behavior_rule';
}

function buildRequirementAtomicRulePayload(row, sharedIntro, rule, rowPayload = null) {
    const sharedContext = summarizeSharedContext(sharedIntro, row.element || '');
    const behaviorText = stripServiceContextFragments(trimSemanticBlock(rule?.text || ''));
    const coreText = buildBehavioralCoreText({
        subject: row.element,
        sharedContext,
        behavior: behaviorText
    });
    const fallbackPayload = rowPayload || buildRequirementRowPayload(row, sharedIntro);
    const baseAux = {
        ...(fallbackPayload?.aux_metadata || {})
    };
    const auxMetadata = {
        ...baseAux,
        branch_label: rule?.branch_label || null,
        atomic_rule_kind: rule?.kind || 'behavior_rule',
        parent_row_number: row.row_number || null,
        row_number: row.row_number || null
    };

    return {
        core_text: coreText,
        embedding_text: coreText,
        chunk_granularity: 'atomic',
        retrieval_class: RETRIEVAL_CLASSES.BEHAVIORAL,
        aux_metadata: auxMetadata,
        legacy_text: coreText
    };
}

function renderRequirementLegacyText({
    rowNumber,
    element,
    context,
    branchLabel,
    behavior,
    methodSummary,
    paramsSummary,
    layoutSummary
}) {
    const lines = [];

    if (!isPlaceholderValue(rowNumber)) {
        lines.push(`Requirement row: ${rowNumber}`);
    }
    if (!isPlaceholderValue(element)) {
        lines.push(`Element: ${element}`);
    }
    if (!isPlaceholderValue(context)) {
        lines.push(`Context: ${context}`);
    }
    if (!isPlaceholderValue(branchLabel)) {
        lines.push(`Branch label: ${branchLabel}`);
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

function buildBehavioralCoreText({ subject, sharedContext, behavior }) {
    const lines = [];
    const normalizedBehavior = normalizeForComparison(behavior);
    const cleanedSubject = cleanInlineText(subject);
    const cleanedContext = cleanInlineText(sharedContext);

    if (cleanedSubject && (!normalizedBehavior || !normalizedBehavior.includes(normalizeForComparison(cleanedSubject)))) {
        lines.push(cleanedSubject);
    }
    if (cleanedContext && shouldIncludeSharedContextInCoreText(cleanedContext)) {
        lines.push(cleanedContext);
    }
    if (!isPlaceholderValue(behavior)) {
        lines.push(trimSemanticBlock(behavior));
    }

    return trimSemanticBlock(lines.join('\n'));
}

function stripServiceContextFragments(text) {
    return trimSemanticBlock(
        String(text || '')
            .replace(/(?:^|[\s;,.():\n])(?:Requirement row|Behavior)\s*:\s*[^.;\n]+(?=[.;\n]|$)/gi, ' ')
            .replace(/(?:^|[\s;,.():\n])(?:API dependency|Method\/API context)\s*:\s*[^.;\n]+(?=[.;\n]|$)/gi, ' ')
            .replace(/(?:^|[\s;,.():\n])(?:Relevant params?|Service params\/context)\s*:\s*[^.;\n]+(?=[.;\n]|$)/gi, ' ')
            .replace(/(?:^|[\s;,.():\n])(?:Reference(?:\/mock)?|Layout)\s*:\s*[^.;\n]+(?=[.;\n]|$)/gi, ' ')
            .replace(/\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u043c\u044b\u0435 \u043c\u0435\u0442\u043e\u0434\u044b \u043d\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u0435\s*:?\s*-\s*/gi, ' ')
            .replace(/\u041d\u043e\u0432\u044b\u0435 \u043c\u0435\u0442\u043e\u0434\u044b \u043d\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u0435\s*:?\s*-\s*/gi, ' ')
            .replace(/(?:\s*[.;]){2,}/g, '. ')
            .replace(/\s{2,}/g, ' ')
    );
}

function shouldIncludeSharedContextInCoreText(text) {
    return Boolean(text) &&
        hasConditionSignal(text) &&
        !looksLikePureScopeContext(text);
}

function looksLikePureScopeContext(text) {
    return /^(?:РЅР°|РІ)\s+(?:СЃС‚СЂР°РЅРёС†Рµ|СЌРєСЂР°РЅРµ|РІРєР»Р°РґРєРµ|С‚Р°Р±Рµ|tab|page|screen|РєР°РЅР°Р»Рµ|channel)\b/i.test(cleanInlineText(text));
}

function extractBehaviorDetailBuckets(text) {
    const { behavior, clauses } = parseStructuredBranchText(text);
    const buckets = {
        behavior: trimSemanticBlock(behavior || text),
        constraints: [],
        fallbacks: [],
        display_rules: [],
        validation_rules: []
    };
    const retainedBehaviorClauses = [];

    for (const clause of clauses) {
        const cleanedClause = trimSemanticBlock(clause);
        const bucket = classifyBehaviorDetailClause(cleanedClause);
        if (!bucket) {
            retainedBehaviorClauses.push(cleanedClause);
            continue;
        }
        buckets[bucket].push(cleanedClause);
    }

    if (retainedBehaviorClauses.length > 0) {
        buckets.behavior = trimSemanticBlock([
            buckets.behavior,
            ...retainedBehaviorClauses
        ].filter(Boolean).join('\n'));
    }

    return buckets;
}

function classifyBehaviorDetailClause(text) {
    if (!text) {
        return null;
    }
    if (isFallbackClauseText(text)) {
        return 'fallbacks';
    }
    if (containsValidationRule(text)) {
        return 'validation_rules';
    }
    if (looksLikeDisplayDetailClause(text)) {
        return 'display_rules';
    }
    if (looksLikeConstraintClause(text)) {
        return 'constraints';
    }
    return null;
}

function looksLikeDisplayDetailClause(text) {
    const normalized = normalizeForComparison(text);
    if (!normalized) {
        return false;
    }
    return !hasScenarioBranchSeed(text) && (
        /РѕС‚РѕР±СЂР°Р¶|РїРѕРєР°Р·|СЃРєСЂС‹С‚|РІРёРґРёРј|С„РѕСЂРјР°С‚|СЃРѕСЂС‚РёСЂРѕРІ|layout|РјР°РєРµС‚|placeholder|tooltip|РёРєРѕРЅРє|РїРѕРґСЃРєР°Р·/i.test(text) ||
        normalized.includes('display') ||
        normalized.includes('visible') ||
        normalized.includes('hidden') ||
        normalized.includes('color') ||
        normalized.includes('red') ||
        normalized.includes('green') ||
        normalized.includes('font') ||
        normalized.includes('icon')
    );
}

function looksLikeConstraintClause(text) {
    const normalized = normalizeForComparison(text);
    if (!normalized) {
        return false;
    }
    return !hasScenarioBranchSeed(text) && (
        normalized.includes('С‚РѕР»СЊРєРѕ') ||
        normalized.includes('only') ||
        normalized.includes('РЅРµРґРѕСЃС‚СѓРї') ||
        normalized.includes('РґРѕСЃС‚СѓРї') ||
        normalized.includes('РѕРіСЂР°РЅРёС‡') ||
        normalized.includes('РѕР±СЏР·Р°С‚РµР»') ||
        normalized.includes('РЅРµ РґРѕРїСѓСЃРєР°') ||
        normalized.includes('not allowed') ||
        normalized.includes('must not')
    );
}

function buildRequirementAuxMetadata({
    row,
    sharedContext,
    behaviorText,
    detailBuckets,
    branchLabel = null
}) {
    const methodSummary = buildMethodContextSummary(row.method);
    const endpoint = extractEndpointSignature(`${row.method || ''}\n${behaviorText || ''}`);
    return {
        element: cleanInlineText(row.element || ''),
        shared_context: sharedContext || '',
        screen_scope: extractScreenScope(sharedContext, behaviorText, row.element),
        channel_scope: extractChannelScope(sharedContext, behaviorText),
        entity_scope: truncateHeading(row.element || deriveEntityScopeFromBehavior(behaviorText), 160),
        row_number: row.row_number || null,
        section_number: row.section_number || null,
        method: extractHttpMethod(row.method),
        endpoint: endpoint || null,
        method_summary: methodSummary || '',
        related_params: buildRelevantParamsList(row.params, behaviorText),
        references: buildRequirementReferences(row.layout, behaviorText),
        layout_hints: buildLayoutHints(row.layout),
        branch_label: branchLabel,
        constraints: detailBuckets.constraints,
        fallbacks: detailBuckets.fallbacks,
        display_rules: detailBuckets.display_rules,
        validation_rules: detailBuckets.validation_rules
    };
}

function deriveEntityScopeFromBehavior(text) {
    const cleaned = cleanInlineText(text);
    if (!cleaned) {
        return '';
    }
    const match = cleaned.match(/^([^:.;]{3,120})/);
    return match?.[1] || cleaned;
}

function extractScreenScope(...sources) {
    return extractScopeByPatterns(sources, [
        /((?:СЃС‚СЂР°РЅРёС†[Р°РµС‹]|СЌРєСЂР°РЅ[РµР°Сѓ]|РІРєР»Р°РґРє[Р°РµСѓ]|С‚Р°Р±[РµР°Сѓ]?|screen|page|tab|С„РѕСЂРј[Р°РµСѓ]|СЂР°Р·РґРµР»[РµР°Сѓ])\s+[^,.;:\n]{1,120})/i,
        /((?:РЅР°|РІ)\s+(?:СЃС‚СЂР°РЅРёС†[Р°Рµ]|СЌРєСЂР°РЅРµ|РІРєР»Р°РґРєРµ|С‚Р°Р±Рµ|screen|page|tab)\s+[^,.;:\n]{1,120})/i
    ]);
}

function extractChannelScope(...sources) {
    return extractScopeByPatterns(sources, [
        /((?:РєР°РЅР°Р»[Р°РµСѓ]?|channel)\s+[^,.;:\n]{1,120})/i
    ]);
}

function extractScopeByPatterns(sources = [], patterns = []) {
    for (const source of sources) {
        const text = cleanInlineText(source);
        if (!text) {
            continue;
        }
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match?.[1]) {
                return truncateHeading(match[1], 160);
            }
        }
    }
    return '';
}

function extractHttpMethod(text) {
    const match = String(text || '').match(/\b(GET|POST|PUT|DELETE|PATCH)\b/i);
    return match?.[1]?.toUpperCase() || null;
}

function buildRelevantParamsList(paramsText, branchText = '') {
    const summary = buildRelevantParamsSummary(paramsText, branchText);
    return summary
        ? summary.split(',').map(item => item.trim()).filter(Boolean)
        : [];
}

function buildRequirementReferences(layoutText, behaviorText = '') {
    const references = [];
    const layoutSummary = buildReferenceSummary(layoutText);
    if (layoutSummary) {
        references.push(layoutSummary);
    }
    for (const ref of extractExplicitRefs([layoutText, behaviorText].filter(Boolean).join('\n'))) {
        if (ref?.original) {
            references.push(ref.original);
        }
    }
    return Array.from(new Set(references));
}

function buildLayoutHints(layoutText) {
    const layoutSummary = buildReferenceSummary(layoutText);
    return layoutSummary ? [layoutSummary] : [];
}

function splitRequirementIntoScenarioBranches(text) {
    const normalized = cleanInlineText(text);
    if (!normalized) {
        return { sharedIntro: '', branches: [], forceBranches: false };
    }

    const numberedSplit = splitRequirementIntoStructuredScenarioBranches(normalized);
    if (numberedSplit.forceBranches || numberedSplit.branches.length >= 2) {
        return numberedSplit;
    }

    const conditionalSplit = splitTextByMarkers(
        normalized,
        /(^|[\n;])\s*(РµСЃР»Рё|РёРЅР°С‡Рµ РµСЃР»Рё|РёРЅР°С‡Рµ|РІ СЃР»СѓС‡Р°Рµ|РїСЂРё СѓСЃР»РѕРІРёРё|РєРѕРіРґР°|РїРѕРєР°|if|when|else)\b/gi,
        match => match[2]
    );
    if (conditionalSplit.branches.length >= 2) {
        return conditionalSplit;
    }

    return {
        sharedIntro: '',
        branches: [{ label: null, text: normalized }],
        forceBranches: false
    };
}

function buildRequirementChunkMetadata(row, sharedIntro = '', auxMetadata = {}) {
    return {
        shared_context: summarizeSharedContext(sharedIntro, row.element || ''),
        method_summary: buildMethodContextSummary(row.method),
        related_params: buildRelevantParamsSummary(row.params, row.requirement),
        layout_ref: buildReferenceSummary(row.layout),
        screen_scope: auxMetadata.screen_scope || null,
        channel_scope: auxMetadata.channel_scope || null,
        entity_scope: auxMetadata.entity_scope || null,
        endpoint: auxMetadata.endpoint || null,
        method: auxMetadata.method || null,
        references: auxMetadata.references || [],
        layout_hints: auxMetadata.layout_hints || [],
        constraints: auxMetadata.constraints || [],
        fallbacks: auxMetadata.fallbacks || [],
        display_rules: auxMetadata.display_rules || [],
        validation_rules: auxMetadata.validation_rules || [],
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
        for (const regex of [/<Р·РЅР°С‡РµРЅРёРµ РїР°СЂР°РјРµС‚СЂР°\s+"([^"]+)">/gi, /"([a-z][A-Za-z0-9_]{2,})"/g]) {
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
        return { sharedIntro: '', branches: [], forceBranches: false };
    }

    const branches = [];
    const deferredDetailClauses = [];
    let forceBranches = false;
    let sawSeededRoot = false;
    for (const root of parsed.roots) {
        const splitResult = splitScenarioNodeIntoBranches(root);
        if (splitResult.forceBranches) {
            forceBranches = true;
        }
        if (splitResult.branches.length > 0) {
            const preparedBranches = splitResult.branches.map((branch, index) =>
                index === 0 && deferredDetailClauses.length > 0
                    ? appendDetailClausesToBranch(branch, deferredDetailClauses)
                    : branch
            );
            deferredDetailClauses.length = 0;
            branches.push(...preparedBranches);
            continue;
        }

        const rootBranch = buildScenarioBranchFromHierarchy(null, root);
        if (hasScenarioBranchSeed(root.text) || hasScenarioBranchSeed(rootBranch.text)) {
            sawSeededRoot = true;
            forceBranches = true;
            const preparedBranch = deferredDetailClauses.length > 0
                ? appendDetailClausesToBranch(rootBranch, deferredDetailClauses)
                : rootBranch;
            deferredDetailClauses.length = 0;
            branches.push(preparedBranch);
            continue;
        }

        deferredDetailClauses.push(trimTrailingPunctuation(root.text));
    }

    if (branches.length > 0 && deferredDetailClauses.length > 0) {
        branches[branches.length - 1] = appendDetailClausesToBranch(
            branches[branches.length - 1],
            deferredDetailClauses
        );
    }

    const normalizedBranches = normalizeStructuredScenarioBranches(branches);
    const meaningfulBranches = normalizedBranches.filter(branch => isMeaningfulChunkText(cleanText(branch.text)));
    if (meaningfulBranches.length < 2) {
        return {
            sharedIntro: '',
            branches: (forceBranches || sawSeededRoot) ? meaningfulBranches : [{ label: null, text }],
            forceBranches: Boolean((forceBranches || sawSeededRoot) && meaningfulBranches.length > 0)
        };
    }

    return {
        sharedIntro: parsed.sharedIntro,
        branches: meaningfulBranches,
        forceBranches
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
    const result = [];
    for (const branch of branches) {
        const previous = result[result.length - 1];
        if (previous && shouldMergeScenarioBranches(previous, branch)) {
            previous.text = mergeStructuredBranchTexts(previous.text, branch.text);
            previous.sourceNumber = previous.sourceNumber || branch.sourceNumber || previous.label || branch.label || null;
            continue;
        }
        result.push({ ...branch });
    }
    return result;
}

function appendDetailClausesToBranch(branch, clauses = []) {
    const parsed = parseStructuredBranchText(branch?.text || '');
    return {
        ...branch,
        text: buildStructuredBranchText(parsed.behavior, [
            ...parsed.clauses,
            ...clauses
        ])
    };
}

function shouldMergeScenarioBranches(left, right) {
    if (!left || !right) {
        return false;
    }

    const leftFallback = String(left?.label || '').includes('-fallback');
    const rightFallback = String(right?.label || '').includes('-fallback');
    if (leftFallback !== rightFallback) {
        return false;
    }

    const leftParsed = parseStructuredBranchText(left.text);
    const rightParsed = parseStructuredBranchText(right.text);
    const leftBehavior = normalizeForComparison(leftParsed.behavior || left.text);
    const rightBehavior = normalizeForComparison(rightParsed.behavior || right.text);
    const leftEntity = normalizeForComparison(deriveEntityScopeFromBehavior(leftParsed.behavior || left.text));
    const rightEntity = normalizeForComparison(deriveEntityScopeFromBehavior(rightParsed.behavior || right.text));
    const leftScreen = normalizeForComparison(extractScreenScope(left.text));
    const rightScreen = normalizeForComparison(extractScreenScope(right.text));
    const sameBehavior = Boolean(
        leftBehavior &&
        rightBehavior &&
        (leftBehavior === rightBehavior || leftBehavior.includes(rightBehavior) || rightBehavior.includes(leftBehavior))
    );
    const sameEntity = Boolean(leftEntity && rightEntity && leftEntity === rightEntity);
    const sameScreen = !leftScreen || !rightScreen || leftScreen === rightScreen;
    const sameOutcome = extractOutcomeSignature(leftParsed.behavior || left.text) === extractOutcomeSignature(rightParsed.behavior || right.text);
    const rightOnlyDetails = [rightParsed.behavior, ...rightParsed.clauses]
        .filter(Boolean)
        .every(part => classifyBehaviorDetailClause(part));

    return sameOutcome && sameScreen && rightOnlyDetails && (sameBehavior || sameEntity);
}

function extractOutcomeSignature(text) {
    const matches = Array.from(String(text || '').matchAll(/(РѕС‚РѕР±СЂР°Р¶|РїРѕРєР°Р·С‹РІ|СЃРєСЂС‹РІР°|РѕС€РёР±Рє|СЃРѕРѕР±С‰РµРЅРё|РІРѕР·РІСЂР°С‰Р°|СЃРѕС…СЂР°РЅСЏ|СЃРѕР·РґР°|РґРѕСЃС‚СѓРї|РЅРµРґРѕСЃС‚СѓРї|show|hide|error|message|return|save|create|enabled|disabled)/gi))
        .map(match => String(match[1] || '').toLowerCase());
    return matches.slice(0, 4).join('|');
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
    const source = trimSemanticBlock(String(text || ''));
    if (!source) {
        return { behavior: '', clauses: [] };
    }

    const clausesSeparatorMatch = source.match(/\nClauses:\n/i);
    if (clausesSeparatorMatch) {
        const [behaviorPart, clausesPart = ''] = source.split(/\nClauses:\n/i);
        const behavior = trimSemanticBlock(behaviorPart);
        const clauses = clausesPart
            .split('\n')
            .map(line => line.replace(/^\-\s+/, '').trim())
            .filter(Boolean);
        return { behavior, clauses };
    }

    const numberedParts = splitInlineNumberedClauses(source);
    if (numberedParts.length >= 2) {
        return {
            behavior: numberedParts[0],
            clauses: numberedParts.slice(1)
        };
    }

    const conditionalParts = splitInlineConditionalClauses(source);
    if (conditionalParts.length >= 2) {
        return {
            behavior: conditionalParts[0],
            clauses: conditionalParts.slice(1)
        };
    }

    return { behavior: source, clauses: [] };
}

function splitInlineNumberedClauses(text) {
    const source = trimSemanticBlock(text);
    if (!source) {
        return [];
    }

    const markerRegex = /(^|[\s:;\/.(])(\d+(?:\.\d+)*)(?:[.)])?\s+/gm;
    const rawMatches = Array.from(source.matchAll(markerRegex));
    const matches = rawMatches.filter((match) => {
        const label = String(match?.[2] || '');
        if (!label) return false;
        const depth = label.split('.').length;
        if (depth >= 2) return true;
        const numeric = Number(label);
        return Number.isFinite(numeric) && numeric > 0 && numeric <= 20;
    });
    if (matches.length < 2) {
        return [];
    }

    const starts = matches.map((match) => (match.index || 0) + (match[1] ? match[1].length : 0));
    const intro = trimSemanticBlock(source.slice(0, starts[0]).replace(/^[:;\s]+/, ''));
    const clauses = starts
        .map((start, index) => {
            const nextStart = starts[index + 1] ?? source.length;
            const rawClause = source
                .slice(start, nextStart)
                .replace(/^[:;\s]+/, '')
                .trim();
            return trimSemanticBlock(rawClause.replace(/^\d+(?:\.\d+)*(?:[.)])?\s+/, ''));
        })
        .filter(Boolean);

    const parts = [
        intro,
        ...clauses
    ].filter(Boolean);

    return parts.length >= 2 ? parts : [];
}

function splitInlineConditionalClauses(text) {
    const source = trimSemanticBlock(text);
    if (!source) {
        return [];
    }

    const markerSplit = splitTextByMarkers(
        source,
        /(^|[.;]\s*|\s+)(\u0435\u0441\u043b\u0438|\u0438\u043d\u0430\u0447\u0435\s+\u0435\u0441\u043b\u0438|\u0438\u043d\u0430\u0447\u0435|\u043f\u0440\u0438\s+\u0443\u0441\u043b\u043e\u0432\u0438\u0438|\u0432\s+\u0441\u043b\u0443\u0447\u0430\u0435|if|when|else if|else|status\s*=|\u0441\u0442\u0430\u0442\u0443\u0441\s*=|if null|\u0435\u0441\u043b\u0438 null|if absent|\u0435\u0441\u043b\u0438\s+\u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442|sort by|sorting|\u0441\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430)/gi,
        match => match[2]
    );

    if (markerSplit.branches.length >= 2) {
        return [
            markerSplit.sharedIntro,
            ...markerSplit.branches.map((branch) => branch?.text || '')
        ]
            .map((part) => trimSemanticBlock(part))
            .filter(Boolean);
    }

    const sentenceParts = source
        .split(/(?<=[.!?;])\s+/)
        .map((part) => trimSemanticBlock(part))
        .filter(Boolean);

    return sentenceParts.length >= 2 ? sentenceParts : [source];
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
        normalized.includes('РµСЃР»Рё РєР°РєРѕРіРѕ С‚Рѕ РїР°СЂР°РјРµС‚СЂР°') ||
        normalized.includes('РµСЃР»Рё РІСЃРµС… РїР°СЂР°РјРµС‚СЂРѕРІ') ||
        normalized.includes('РЅРµ РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ') && normalized.includes('СЃРґРІРёРіР°СЋС‚СЃСЏ РІРІРµСЂС…') ||
        normalized.includes('РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ С‚РµРєСЃС‚ РёР·')
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

function splitScenarioNodeIntoBranches(node) {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
        return { branches: [], forceBranches: false };
    }

    const seedChildren = children.filter(child =>
        hasScenarioBranchSeed(child.text) ||
        hasScenarioBranchSeed(trimSemanticBlock([child.text, ...collectNestedScenarioClauses(child.children || [])].join('\n')))
    );
    if (seedChildren.length === 0) {
        return { branches: [], forceBranches: false };
    }

    const siblingDetails = children
        .filter(child => !seedChildren.includes(child))
        .map(child => trimTrailingPunctuation(child.text))
        .filter(Boolean);

    return {
        branches: seedChildren.map(child => buildScenarioBranchFromHierarchy(node, child, siblingDetails)),
        forceBranches: true
    };
}

function shouldSplitNodeChildrenIntoScenarios(node) {
    return splitScenarioNodeIntoBranches(node).forceBranches;
}

function hasScenarioBranchSeed(text) {
    const cleaned = cleanInlineText(text);
    if (!cleaned) {
        return false;
    }

    return hasConditionSignal(cleaned) &&
        (hasBehavioralPredicateSignal(cleaned) || hasExpectedResultSignal(cleaned));
}

function hasConditionSignal(text) {
    return /^(РµСЃР»Рё|РёРЅР°С‡Рµ РµСЃР»Рё|РёРЅР°С‡Рµ|РєРѕРіРґР°|РїСЂРё|РІ СЃР»СѓС‡Р°Рµ|if|when|otherwise|else)\b/i.test(cleanInlineText(text));
}

function hasBehavioralPredicateSignal(text) {
    return /(РЅР°Р¶РёРј|РєР»РёРєР°|РІС‹Р±РёСЂР°|РІРІРѕРґ|РѕС‚РєСЂС‹РІР°|Р·Р°РєСЂС‹РІР°|РѕС‚РїСЂР°РІР»СЏ|СЃРѕР·РґР°|СЃРѕС…СЂР°РЅСЏ|СѓРґР°Р»СЏ|СЂРµРґР°РєС‚РёСЂСѓ|РѕС‚РѕР±СЂР°Р¶Р°|РїРѕРєР°Р·С‹РІР°|СЃРєСЂС‹РІР°|Р±Р»РѕРєРёСЂ|СЂР°Р·СЂРµС€Р°|Р·Р°РїСЂРµС‰Р°|РІРѕР·РІСЂР°С‰Р°|РїРѕР»СѓС‡Р°|Р°РєС‚РёРІРЅ|РЅРµР°РєС‚РёРІРЅ|РґРѕСЃС‚СѓРїРЅ|РЅРµРґРѕСЃС‚СѓРїРЅ|РІС‹Р±СЂР°РЅ|enabled|disabled|active|inactive|available|unavailable|selected|select|click|enter|open|close|submit|display|show|hide|save|create|delete|return)/i
        .test(String(text || ''));
}

function hasExpectedResultSignal(text) {
    return /(РѕС‚РѕР±СЂР°Р¶Р°|РїРѕРєР°Р·С‹РІР°|СЃРєСЂС‹РІР°|СЃС‚Р°РЅРѕРІ|РґРѕСЃС‚СѓРї|РЅРµРґРѕСЃС‚СѓРї|РѕС€РёР±Рє|СЃРѕРѕР±С‰РµРЅРё|РѕС‚РєСЂС‹РІР°|Р·Р°РєСЂС‹РІР°|СЃРѕС…СЂР°РЅСЏ|СЃРѕР·РґР°|РІРѕР·РІСЂР°С‰Р°|РїРѕСЏРІР»СЏ|РѕС‡РёС‰Р°|selected|shown|hidden|visible|enabled|disabled|error|message|opened|saved|created|returned|must|should)/i
        .test(String(text || ''));
}

function looksLikeScenarioSeed(text) {
    return /^(РµСЃР»Рё|РёРЅР°С‡Рµ|РєРѕРіРґР°|РїСЂРё|РґР»СЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ|РЅР° СЃС‚СЂР°РЅРёС†Рµ|РІ РјРѕРґР°Р»СЊРЅРѕРј РѕРєРЅРµ|РІ РѕРєРЅРµ|РїСЂРё РѕС‚РІРµС‚Рµ|if|when|for user)\b/i
        .test(cleanInlineText(text));
}

function buildScenarioBranchFromHierarchy(parentNode, node, inheritedClauses = []) {
    const lines = [];
    if (parentNode?.text) {
        lines.push(trimTrailingPunctuation(parentNode.text));
    }

    lines.push(trimTrailingPunctuation(node.text));

    const clauses = [
        ...inheritedClauses,
        ...collectNestedScenarioClauses(node.children || [])
    ];
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
            branches: [{ label: null, text }],
            forceBranches: false
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
            branches: [{ label: null, text }],
            forceBranches: false
        };
    }

    return { sharedIntro, branches, forceBranches: false };
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
    return /^(РІС…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹|РїР°СЂР°РјРµС‚СЂС‹ Р·Р°РїСЂРѕСЃР°|request body|request params|input params)$/i.test(normalizedLine);
}

function isApiOutputSectionMarker(normalizedLine) {
    return /^(РІС‹С…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹|РїР°СЂР°РјРµС‚СЂС‹ РѕС‚РІРµС‚Р°|response body|response params|output params|РІС‹С…РѕРґРЅС‹Рµ РґР°РЅРЅС‹Рµ)$/i.test(normalizedLine);
}

function isApiErrorSectionMarker(normalizedLine) {
    return /^(РІРѕР·РјРѕР¶РЅС‹Рµ РѕС€РёР±РєРё|РѕС€РёР±РєРё|error handling|errors)$/i.test(normalizedLine);
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
    if (trailingLines.some(line => /\berror|РѕС€РёР±/i.test(line))) {
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
    return /\b(РІС…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹|РїР°СЂР°РјРµС‚СЂС‹ Р·Р°РїСЂРѕСЃР°|request body|request params|input params)\b/i.test(normalizedLine);
}

function isApiOutputMarker(normalizedLine) {
    return /\b(РІС‹С…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹|РїР°СЂР°РјРµС‚СЂС‹ РѕС‚РІРµС‚Р°|response body|response params|output params)\b/i.test(normalizedLine);
}

function isApiErrorMarker(normalizedLine) {
    return /\b(РІРѕР·РјРѕР¶РЅС‹Рµ РѕС€РёР±РєРё|РѕС€РёР±РєРё|error handling|errors)\b/i.test(normalizedLine);
}

function isApiBehaviorMarker(normalizedLine) {
    return /\b(РїСЂРёРјРµС‡Р°РЅРё|РѕСЃРѕР±РµРЅРЅРѕСЃС‚|РїРѕРІРµРґРµРЅРё|С‚РѕР»СЊРєРѕ РІ СЃР»СѓС‡Р°Рµ|РµСЃР»Рё РїР°СЂР°РјРµС‚СЂ|РµСЃР»Рё РѕС‚РІРµС‚|behavior notes)\b/i.test(normalizedLine);
}

function containsApiBehaviorNotes(text) {
    return /(С‚РѕР»СЊРєРѕ РІ СЃР»СѓС‡Р°Рµ|РµСЃР»Рё РїР°СЂР°РјРµС‚СЂ|РµСЃР»Рё РѕС‚РІРµС‚|РЅРµ РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ|РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ|behavior)/i.test(text || '');
}

function detectApiRequestMode(text) {
    if (/РїСѓСЃС‚С‹Рј С‚РµР»РѕРј Р·Р°РїСЂРѕСЃР°|empty request body|empty body|request body РѕС‚СЃСѓС‚СЃС‚РІ/i.test(text || '')) {
        return 'empty body';
    }

    if (/Р±РµР· РїР°СЂР°РјРµС‚СЂРѕРІ Р·Р°РїСЂРѕСЃР°|no request params|request params РѕС‚СЃСѓС‚СЃС‚РІ/i.test(text || '')) {
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

    return /РІС‹С…РѕРґРЅ|response|РїР°СЂР°РјРµС‚СЂС‹ РѕС‚РІРµС‚Р°/i.test(joined);
}

function isApiHeadingNoise(line) {
    return /^(Р·Р°РїСЂРѕСЃ|РІС‹С…РѕРґРЅС‹Рµ РґР°РЅРЅС‹Рµ|РІС…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹|РІС‹С…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹|РїР°СЂР°РјРµС‚СЂС‹ РѕС‚РІРµС‚Р°|РѕРїРёСЃР°РЅРёРµ)\s*:?\s*$/i
        .test(String(line || '').trim());
}

function isMeaningfulApiBlock(text) {
    const normalized = normalizeForComparison(text);
    if (!normalized) {
        return false;
    }

    if (['РІС…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹', 'РІС‹С…РѕРґРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹', 'РїР°СЂР°РјРµС‚СЂС‹ РѕС‚РІРµС‚Р°', 'РѕС€РёР±РєРё', 'РѕРїРёСЃР°РЅРёРµ'].includes(normalized)) {
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
            return !/^[-вЂ“вЂ”=_]{2,}$/.test(line.trim());
        })
        .join('\n')
        .trim();
}

function isPlaceholderValue(value) {
    const normalized = normalizeForComparison(value);
    const rawLower = String(value || '').toLowerCase();
    return !normalized ||
        ['-', 'пїЅ', '/', 'пїЅпїЅпїЅ', 'none', 'n a', 'na'].includes(normalized) ||
        /пїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅ пїЅпїЅпїЅпїЅпїЅпїЅ пїЅпїЅ пїЅпїЅпїЅпїЅпїЅпїЅпїЅ\s*:?\s*-/.test(rawLower) ||
        /пїЅпїЅпїЅпїЅпїЅ пїЅпїЅпїЅпїЅпїЅпїЅ пїЅпїЅ пїЅпїЅпїЅпїЅпїЅпїЅпїЅ\s*:?\s*-/.test(rawLower) ||
        /^[-пїЅпїЅ\/\\|]+$/.test(String(value || '').trim());
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
        /РўСЂРµР±РѕРІР°РЅРёРµ[-_]?(\d+)/i,
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
    
    // РЈР±РёСЂР°РµРј РЅСѓРјРµСЂР°С†РёСЋ РІ РЅР°С‡Р°Р»Рµ
    const cleaned = heading.replace(/^\d+[\.\)]\s*/, '').trim();
    
    // Р•СЃР»Рё СЃР»РёС€РєРѕРј РґР»РёРЅРЅРѕРµ - РѕР±СЂРµР·Р°РµРј
    if (cleaned.length > 100) {
        return cleaned.substring(0, 100) + '...';
    }
    
    return cleaned;
}

function createSummary(text) {
    if (!text) return '';
    
    // Р‘РµСЂС‘Рј РїРµСЂРІС‹Рµ 200 СЃРёРјРІРѕР»РѕРІ РєР°Рє summary
    const summary = text.substring(0, 200).trim();
    
    if (text.length > 200) {
        return summary + '...';
    }
    
    return summary;
}

function estimateTokens(text) {
    if (!text) return 0;
    
    // Р“СЂСѓР±Р°СЏ РѕС†РµРЅРєР°: ~4 СЃРёРјРІРѕР»Р° РЅР° С‚РѕРєРµРЅ
    return Math.ceil(text.length / 4);
}

// ============================================================
// Р­РљРЎРџРћР Рў Р”РћРџРћР›РќРРўР•Р›Р¬РќР«РҐ Р¤РЈРќРљР¦РР™
// ============================================================

/**
 * РЎРѕР·РґР°С‘С‚ СЃРІСЏР·Рё РјРµР¶РґСѓ С‡Р°РЅРєР°РјРё РЅР° РѕСЃРЅРѕРІРµ РїРµСЂРµРєСЂС‘СЃС‚РЅС‹С… СЃСЃС‹Р»РѕРє
 * @param {Array} chunks 
 * @returns {Array} Р§Р°РЅРєРё СЃ Р·Р°РїРѕР»РЅРµРЅРЅС‹РјРё linked_chunk_ids
 */
export function linkChunks(chunks) {
    // РЎРѕР·РґР°С‘Рј РёРЅРґРµРєСЃ РґР»СЏ Р±С‹СЃС‚СЂРѕРіРѕ РїРѕРёСЃРєР°
    const chunksByHeading = new Map();
    const chunksByRequirement = new Map();
    
    chunks.forEach(chunk => {
        // РРЅРґРµРєСЃРёСЂСѓРµРј РїРѕ Р·Р°РіРѕР»РѕРІРєСѓ
        if (chunk.heading) {
            const normalizedHeading = chunk.heading.toLowerCase().trim();
            if (!chunksByHeading.has(normalizedHeading)) {
                chunksByHeading.set(normalizedHeading, []);
            }
            chunksByHeading.get(normalizedHeading).push(chunk.id);
        }
        
        // РРЅРґРµРєСЃРёСЂСѓРµРј РїРѕ requirement_id
        if (chunk.requirement_id) {
            if (!chunksByRequirement.has(chunk.requirement_id)) {
                chunksByRequirement.set(chunk.requirement_id, []);
            }
            chunksByRequirement.get(chunk.requirement_id).push(chunk.id);
        }
    });
    
    // РџСЂРѕС…РѕРґРёРј РїРѕ РІСЃРµРј С‡Р°РЅРєР°Рј Рё СЃРѕР·РґР°С‘Рј СЃРІСЏР·Рё
    chunks.forEach(chunk => {
        // РС‰РµРј СЃСЃС‹Р»РєРё РІ С‚РµРєСЃС‚Рµ РЅР° РґСЂСѓРіРёРµ Р·Р°РіРѕР»РѕРІРєРё
        if (chunk.cleaned_text) {
            chunksByHeading.forEach((ids, heading) => {
                if (chunk.id !== ids[0] && chunk.cleaned_text.toLowerCase().includes(heading)) {
                    // Р”РѕР±Р°РІР»СЏРµРј СЃРІСЏР·СЊ РµСЃР»Рё РµС‰С‘ РЅРµ РґРѕР±Р°РІР»РµРЅР°
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
 * РџРѕР»СѓС‡Р°РµС‚ СЃРІСЏР·Р°РЅРЅС‹Рµ С‡Р°РЅРєРё РґР»СЏ РґР°РЅРЅРѕРіРѕ chunk
 * @param {string} chunkId 
 * @param {Array} allChunks 
 * @returns {Array} РЎРІСЏР·Р°РЅРЅС‹Рµ С‡Р°РЅРєРё
 */
export function getRelatedChunks(chunkId, allChunks) {
    const chunk = allChunks.find(c => c.id === chunkId);
    if (!chunk) return [];
    
    return chunk.linked_chunk_ids
        .map(id => allChunks.find(c => c.id === id))
        .filter(Boolean);
}


