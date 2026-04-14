/**
 * Logic Extractor - Извлечение тестовых условий и ограничений из требований
 * 
 * Цель: Найти все условия, ограничения и ветвления логики в тексте требований
 * для последующего применения техник тест-дизайна
 */

import { callWithCloudRuFallback } from './cloudruClient.mjs';
import config from './config.json' assert { type: 'json' };

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Промпт для извлечения логики и ограничений
 */
const LOGIC_EXTRACTION_PROMPT = `
Твоя цель — найти все условия, ограничения и ветвления логики в тексте требований.

🚨 КРИТИЧЕСКИ ВАЖНО: Извлекай ТОЛЬКО факты, которые ЯВНО написаны в тексте требований. НЕ придумывай ничего от себя!

Не генерируй тесты, только выпиши факты.

Ищи:

1. **Валидация полей:** Мин/макс длина, запрещенные символы, форматы, обязательность (только если явно указано в требованиях).

2. **Числовые границы:** Мин/макс суммы, диапазоны дат, лимиты (только если явно указано в требованиях).

3. **Условная логика UI:** "Если пришло X, то отобразить Y, иначе Z" (только если явно описано в требованиях).

4. **Состояния ошибок:** Что происходит при ошибках, таймаутах или пустом ответе (ТОЛЬКО если это явно описано в требованиях). НЕ добавляй стандартные HTTP-коды (400, 500) по умолчанию, если их нет в тексте!

5. **Зависимости полей:** Если выбран чекбокс А, то поле Б становится обязательным (только если явно указано).

6. **Автозаполнение:** Когда поля заполняются автоматически (только если явно указано).

7. **Очистка полей:** Когда поля очищаются при изменении состояния (только если явно указано).

⚠️ ДЛЯ НЕГАТИВНЫХ СЦЕНАРИЕВ: Включай в negative_scenarios ТОЛЬКО те сценарии, которые явно описаны в требованиях (например, "при ошибке сервера отображается сообщение X"). НЕ добавляй стандартные негативные сценарии (timeout, пустой ответ, 500 ошибка) по шаблонам, если их нет в тексте!

ФОРМАТ ОТВЕТА (строгий JSON):
{
  "validations": [
    {
      "field": "Название поля",
      "rule": "Описание правила (например: '0.01 <= x <= 1,000,000')",
      "error": "Текст ошибки валидации (если указан)"
    }
  ],
  "negative_scenarios": [
    "Краткое описание негативного сценария 1",
    "Краткое описание негативного сценария 2"
  ],
  "ui_logic": [
    {
      "condition": "Условие (например: 'Если в ответе API 1 точка')",
      "action": "Действие (например: 'автозаполнение поля')"
    }
  ],
  "boundary_values": [
    {
      "field": "Название поля",
      "min": "Минимальное значение",
      "max": "Максимальное значение",
      "type": "number|length|date|other"
    }
  ],
  "dependencies": [
    {
      "trigger": "Что триггерит зависимость (например: 'Чекбокс выбран')",
      "target": "На что влияет (например: 'Поле становится обязательным')"
    }
  ]
}
`;

/**
 * Извлекает логику и ограничения из требований
 * @param {string} requirementsText - Текст требований
 * @returns {Promise<Object>} Объект с извлеченной логикой
 */
export async function extractLogicAndConstraints(requirementsText) {
    if (!requirementsText || typeof requirementsText !== 'string' || !requirementsText.trim()) {
        console.warn('[logic-extractor] Пустые требования, возвращаю пустой результат');
        return {
            validations: [],
            negative_scenarios: [],
            ui_logic: [],
            boundary_values: [],
            dependencies: []
        };
    }

    try {
        console.log('[logic-extractor] Начинаю извлечение логики из требований...');
        
        const messages = [
            {
                role: 'system',
                content: 'Ты — эксперт по анализу требований. Извлекай ТОЛЬКО факты из текста. Отвечай строго в формате JSON без дополнительных пояснений.'
            },
            {
                role: 'user',
                content: `${LOGIC_EXTRACTION_PROMPT}

═══════════════════════════════════════════════════════════════
ТРЕБОВАНИЯ:
═══════════════════════════════════════════════════════════════

${requirementsText.substring(0, 50000)}${requirementsText.length > 50000 ? '\n\n... (текст обрезан для оптимизации)' : ''}

═══════════════════════════════════════════════════════════════
Верни ТОЛЬКО JSON без markdown и пояснений.
═══════════════════════════════════════════════════════════════`
            }
        ];

        const response = await callWithCloudRuFallback(
            OPENROUTER_URL,
            messages,
            config.openRouterAiKey,
            {
                temperature: 0.0,
                max_tokens: 4000,
                response_format: {
                    type: 'json_object'
                }
            }
        );

        const content = response.choices?.[0]?.message?.content || '';
        
        if (!content) {
            console.warn('[logic-extractor] Пустой ответ от модели');
            return getEmptyResult();
        }

        // Парсим JSON из ответа
        let extracted;
        try {
            // Убираем markdown обёртки если есть
            const cleaned = content
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();
            
            extracted = JSON.parse(cleaned);
        } catch (parseError) {
            console.warn('[logic-extractor] Ошибка парсинга JSON:', parseError.message);
            console.warn('[logic-extractor] Содержимое ответа:', content.substring(0, 500));
            return getEmptyResult();
        }

        // Валидируем структуру
        const result = {
            validations: Array.isArray(extracted.validations) ? extracted.validations : [],
            negative_scenarios: Array.isArray(extracted.negative_scenarios) ? extracted.negative_scenarios : [],
            ui_logic: Array.isArray(extracted.ui_logic) ? extracted.ui_logic : [],
            boundary_values: Array.isArray(extracted.boundary_values) ? extracted.boundary_values : [],
            dependencies: Array.isArray(extracted.dependencies) ? extracted.dependencies : []
        };

        console.log(`[logic-extractor] ✅ Извлечено: ${result.validations.length} валидаций, ${result.negative_scenarios.length} негативных сценариев, ${result.ui_logic.length} UI логик, ${result.boundary_values.length} граничных значений, ${result.dependencies.length} зависимостей`);

        return result;

    } catch (error) {
        console.error('[logic-extractor] Ошибка при извлечении логики:', error.message);
        return getEmptyResult();
    }
}

/**
 * Форматирует извлеченную логику для промпта генерации тестов
 * @param {Object} logicConstraints - Результат extractLogicAndConstraints
 * @returns {string} Форматированный текст для промпта
 */
export function formatLogicConstraintsForPrompt(logicConstraints) {
    if (!logicConstraints) {
        return '';
    }

    const parts = [];

    if (logicConstraints.validations && logicConstraints.validations.length > 0) {
        parts.push(`
═══════════════════════════════════════════════════════════════
✅ ВАЛИДАЦИИ ПОЛЕЙ (ОБЯЗАТЕЛЬНО ПРОТЕСТИРОВАТЬ!)
═══════════════════════════════════════════════════════════════
${logicConstraints.validations.map((v, i) => 
    `${i + 1}. **${v.field}**: ${v.rule}${v.error ? ` (Ошибка: "${v.error}")` : ''}`
).join('\n')}
`);
    }

    if (logicConstraints.boundary_values && logicConstraints.boundary_values.length > 0) {
        parts.push(`
═══════════════════════════════════════════════════════════════
🎯 ГРАНИЧНЫЕ ЗНАЧЕНИЯ (ОБЯЗАТЕЛЬНО ПРОТЕСТИРОВАТЬ!)
═══════════════════════════════════════════════════════════════
${logicConstraints.boundary_values.map((bv, i) => 
    `${i + 1}. **${bv.field}**: ${bv.min !== undefined ? `Min: ${bv.min}` : ''} ${bv.max !== undefined ? `Max: ${bv.max}` : ''} (${bv.type || 'other'})`
).join('\n')}

🚨 КРИТИЧНО: Для каждого граничного значения создай тесты:
   - Min-1 (если возможно)
   - Min
   - Max
   - Max+1 (если возможно)
`);
    }

    if (logicConstraints.ui_logic && logicConstraints.ui_logic.length > 0) {
        parts.push(`
═══════════════════════════════════════════════════════════════
🖥️ UI ЛОГИКА (ОБЯЗАТЕЛЬНО ПРОТЕСТИРОВАТЬ!)
═══════════════════════════════════════════════════════════════
${logicConstraints.ui_logic.map((ul, i) => 
    `${i + 1}. **Если** ${ul.condition}, **то** ${ul.action}`
).join('\n')}
`);
    }

    if (logicConstraints.dependencies && logicConstraints.dependencies.length > 0) {
        parts.push(`
═══════════════════════════════════════════════════════════════
🔗 ЗАВИСИМОСТИ ПОЛЕЙ (ОБЯЗАТЕЛЬНО ПРОТЕСТИРОВАТЬ!)
═══════════════════════════════════════════════════════════════
${logicConstraints.dependencies.map((d, i) => 
    `${i + 1}. **${d.trigger}** → **${d.target}**`
).join('\n')}
`);
    }

    if (logicConstraints.negative_scenarios && logicConstraints.negative_scenarios.length > 0) {
        parts.push(`
═══════════════════════════════════════════════════════════════
❌ НЕГАТИВНЫЕ СЦЕНАРИИ (ВКЛЮЧАЙ В МОДЕЛЬ ТОЛЬКО ЕСЛИ ЯВНО ОПИСАНЫ В ТРЕБОВАНИЯХ!)
═══════════════════════════════════════════════════════════════
${logicConstraints.negative_scenarios.map((ns, i) => 
    `${i + 1}. ${ns}`
).join('\n')}

⚠️ ВАЖНО: Эти негативные сценарии извлечены из требований. Включай их в тестовую модель ТОЛЬКО если они явно описаны в тексте требований. НЕ добавляй стандартные негативные сценарии (timeout, 500 ошибка, пустой ответ) по шаблонам, если их нет в требованиях!
`);
    }

    if (parts.length === 0) {
        return '';
    }

    return parts.join('\n') + `

🚨 КРИТИЧЕСКИ ВАЖНО: Все перечисленные выше условия, ограничения и логика ДОЛЖНЫ быть покрыты тест-кейсами!
   - Для валидаций → Integration frontend тесты на нарушение правил
   - Для граничных значений → Boundary Tests (Min-1, Min, Max, Max+1)
   - Для UI логики → Integration frontend тесты на проверку поведения
   - Для зависимостей → Integration frontend тесты на переключение состояний
   - Для негативных сценариев → Integration тесты (frontend или backend в зависимости от типа)
`;
}

/**
 * Возвращает пустой результат
 */
function getEmptyResult() {
    return {
        validations: [],
        negative_scenarios: [],
        ui_logic: [],
        boundary_values: [],
        dependencies: []
    };
}

