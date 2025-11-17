import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from 'react-modal';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import config from '../../config.json';
import axios from 'axios';
import AsyncSelect from 'react-select/async';
import { StyleInjector, LoaderOverlay } from './TestModelGeneratorModal';
import JSZip from 'jszip';

// --- Иконки (простые SVG для независимости от библиотек) ---
const ChevronDown = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);
const ChevronRight = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);
const FolderIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
);
const StoryIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
);
const ScenarioIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 18v-6m0 0V6m0 6H6m12 0h6" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="6" r="3" />
    </svg>
);
const CaseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
    </svg>
);

const CodeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
        viewBox="0 0 24 24" fill="none" stroke="#d29922"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* < /> */}
        <polyline points="10 6 6 12 10 18" />
        <polyline points="14 6 18 12 14 18" />
    </svg>
);
// Иконка перетаскивания (шесть точек)
const DragHandleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        {[2, 6, 10].map(y =>
            [4, 8].map(x => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />
            ))
        )}
    </svg>
);

const debouncePromise = (fn, delay = 300) => {
    let t;
    return (...args) =>
        new Promise((resolve) => {
            clearTimeout(t);
            t = setTimeout(async () => resolve(await fn(...args)), delay);
        });
};


// --- UTILITY FUNCTIONS ---
const generateId = () => `case_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Компонент для редактируемого тега значения параметра
const EditableValueTag = ({ value, onSave, onDelete, autoEdit = false }) => {
    const [isEditing, setIsEditing] = React.useState(autoEdit || !value);
    const [editValue, setEditValue] = React.useState(value);
    
    React.useEffect(() => {
        setEditValue(value);
        if (!value) {
            setIsEditing(true);
        }
    }, [value]);
    
    if (isEditing) {
        return (
            <div style={{ 
                display: 'flex',
                alignItems: 'center',
                margin: '4px 4px 4px 0',
                gap: '4px'
            }}>
                <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => {
                        onSave(editValue);
                        setIsEditing(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            onSave(editValue);
                            setIsEditing(false);
                        }
                        if (e.key === 'Escape') {
                            setEditValue(value);
                            setIsEditing(false);
                        }
                    }}
                    autoFocus
                    style={{ 
                        flex: 1,
                        padding: '4px 8px',
                        backgroundColor: '#161b22',
                        border: '1px solid #58a6ff',
                        borderRadius: '4px',
                        color: '#c9d1d9',
                        fontSize: '12px'
                    }}
                />
            </div>
        );
    }
    
    return (
        <div style={{ 
            display: 'inline-flex',
            alignItems: 'center',
            margin: '4px 4px 4px 0',
            padding: '4px 8px',
            backgroundColor: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer'
        }}
        onClick={() => {
            setEditValue(value);
            setIsEditing(true);
        }}
        >
            <span style={{ color: '#c9d1d9', marginRight: '6px' }}>
                {value || 'Пустое значение'}
            </span>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                style={{ 
                    background: 'none',
                    border: 'none',
                    color: '#8b949e',
                    cursor: 'pointer',
                    padding: '0',
                    marginLeft: '4px',
                    fontSize: '14px',
                    lineHeight: '1'
                }}
            >
                ×
            </button>
        </div>
    );
};

// Функция для генерации всех комбинаций (полный перебор)
const generateAllCombinations = (parameters) => {
    if (!parameters || parameters.length === 0) return [];
    
    // Фильтруем только валидные параметры, но сохраняем исходный порядок
    const validParams = parameters.filter(p => 
        p.name && p.name.trim() && 
        p.values && Array.isArray(p.values) && 
        p.values.length > 0 && 
        p.values.some(v => v && v.trim())
    );
    
    if (validParams.length === 0) return [];
    
    // Сохраняем исходные имена и значения для правильного сопоставления
    const paramMap = new Map();
    validParams.forEach(p => {
        paramMap.set(p.name.trim(), p.values.filter(v => v && v.trim()).map(v => v.trim()));
    });
    
    const paramNames = Array.from(paramMap.keys());
    const paramValues = Array.from(paramMap.values());
    
    const maxCombinations = 50;
    const combinations = [];
    
    const generate = (paramIndex, currentCombo) => {
        if (combinations.length >= maxCombinations) return;
        
        if (paramIndex >= paramNames.length) {
            // Создаем комбинацию с ВСЕМИ параметрами (включая те, у которых нет значений)
            const exampleParams = parameters.map(p => {
                const paramName = p.name?.trim();
                if (!paramName) return { name: '', value: '' };
                
                // Если это валидный параметр, берем значение из комбинации
                const validIdx = paramNames.indexOf(paramName);
                if (validIdx >= 0 && currentCombo[validIdx] !== undefined) {
                    return { name: paramName, value: currentCombo[validIdx] };
                }
                // Если параметр не валиден (нет значений), ставим пустое значение
                return { name: paramName, value: '' };
            }).filter(p => p.name); // Убираем пустые имена
            
            combinations.push({ parameters: exampleParams });
            return;
        }
        
        for (const value of paramValues[paramIndex]) {
            if (combinations.length >= maxCombinations) break;
            generate(paramIndex + 1, [...currentCombo, value]);
        }
    };
    
    generate(0, []);
    return combinations;
};

// Функция для генерации pairwise комбинаций (n=2 для pairwise)
// Покрывает все пары значений между всеми параметрами минимальным набором комбинаций
const generatePairwiseCombinations = (parameters) => {
    if (!parameters || parameters.length === 0) return [];
    
    // Фильтруем параметры с валидными именами и значениями, но сохраняем исходный порядок
    const validParams = parameters.filter(p => 
        p.name && p.name.trim() && 
        p.values && Array.isArray(p.values) && 
        p.values.length > 0 && 
        p.values.some(v => v && v.trim())
    );
    
    if (validParams.length === 0) return [];
    
    // Сохраняем исходные имена и значения для правильного сопоставления
    const paramMap = new Map();
    validParams.forEach(p => {
        paramMap.set(p.name.trim(), p.values.filter(v => v && v.trim()).map(v => v.trim()));
    });
    
    const paramNames = Array.from(paramMap.keys());
    const paramValues = Array.from(paramMap.values());
    
    const maxCombinations = 50; // Лимит как в TestOps
    
    // Если один параметр - просто все значения
    if (validParams.length === 1) {
        const paramName = paramNames[0];
        return paramValues[0].slice(0, maxCombinations).map(value => {
            // Создаем комбинацию с ВСЕМИ параметрами
            const exampleParams = parameters.map(p => {
                const pName = p.name?.trim();
                if (!pName) return { name: '', value: '' };
                if (pName === paramName) {
                    return { name: pName, value };
                }
                return { name: pName, value: '' };
            }).filter(p => p.name);
            return { parameters: exampleParams };
        });
    }
    
    // Если два параметра - для pairwise это все пары (минимальное покрытие = все комбинации)
    if (validParams.length === 2) {
        const combinations = [];
        const param1Name = paramNames[0];
        const param2Name = paramNames[1];
        
        for (const val1 of paramValues[0]) {
            for (const val2 of paramValues[1]) {
                if (combinations.length >= maxCombinations) break;
                
                // Создаем комбинацию с ВСЕМИ параметрами
                const exampleParams = parameters.map(p => {
                    const pName = p.name?.trim();
                    if (!pName) return { name: '', value: '' };
                    if (pName === param1Name) {
                        return { name: pName, value: val1 };
                    }
                    if (pName === param2Name) {
                        return { name: pName, value: val2 };
                    }
                    return { name: pName, value: '' };
                }).filter(p => p.name);
                
                combinations.push({ parameters: exampleParams });
            }
            if (combinations.length >= maxCombinations) break;
        }
        return combinations;
    }
    
    // Для 3+ параметров используем оптимизированный pairwise алгоритм
    // Цель: покрыть все пары значений минимальным количеством комбинаций
    
    // Шаг 1: Генерируем все возможные пары, которые нужно покрыть
    const allPairsToCover = [];
    for (let i = 0; i < paramNames.length; i++) {
        for (let j = i + 1; j < paramNames.length; j++) {
            for (const val1 of paramValues[i]) {
                for (const val2 of paramValues[j]) {
                    allPairsToCover.push({
                        param1Idx: i,
                        param2Idx: j,
                        param1Name: paramNames[i],
                        param2Name: paramNames[j],
                        val1,
                        val2,
                        key: `${i}-${val1}|${j}-${val2}`
                    });
                }
            }
        }
    }
    
    const combinations = [];
    const coveredPairs = new Set(); // Множество покрытых пар
    
    // Шаг 2: Жадный алгоритм - пытаемся покрыть максимальное количество пар в одной комбинации
    while (coveredPairs.size < allPairsToCover.length && combinations.length < maxCombinations) {
        let bestCombo = null;
        let bestCoverage = 0;
        let bestComboValues = null;
        
        // Пробуем разные комбинации значений для всех параметров
        // Используем ограниченный перебор для оптимизации
        const maxAttempts = 100; // Ограничиваем количество попыток
        let attempts = 0;
        
        for (const pair of allPairsToCover) {
            if (coveredPairs.has(pair.key)) continue; // Пара уже покрыта
            if (attempts >= maxAttempts) break;
            attempts++;
            
            // Создаем комбинацию, начиная с этой пары (используем массив вместо Map)
            const comboValues = new Array(paramNames.length).fill(null);
            comboValues[pair.param1Idx] = pair.val1;
            comboValues[pair.param2Idx] = pair.val2;
            
            // Для остальных параметров выбираем значения, которые максимизируют покрытие
            for (let idx = 0; idx < paramNames.length; idx++) {
                if (comboValues[idx] !== null) continue; // Уже установлено
                
                // Пробуем найти значение, которое покрывает больше непокрытых пар
                let bestValue = paramValues[idx][0];
                let bestValueCoverage = 0;
                
                for (const val of paramValues[idx]) {
                    comboValues[idx] = val;
                    
                    // Подсчитываем, сколько новых непокрытых пар покроет эта комбинация
                    let newCoverage = 0;
                    for (let i = 0; i < paramNames.length; i++) {
                        for (let j = i + 1; j < paramNames.length; j++) {
                            if (comboValues[i] === null || comboValues[j] === null) continue;
                            const pairKey = `${i}-${comboValues[i]}|${j}-${comboValues[j]}`;
                            if (!coveredPairs.has(pairKey)) {
                                const exists = allPairsToCover.some(p => 
                                    p.param1Idx === i && p.param2Idx === j && 
                                    p.val1 === comboValues[i] && p.val2 === comboValues[j]
                                );
                                if (exists) newCoverage++;
                            }
                        }
                    }
                    
                    if (newCoverage > bestValueCoverage) {
                        bestValueCoverage = newCoverage;
                        bestValue = val;
                    }
                }
                
                comboValues[idx] = bestValue;
            }
            
            // Подсчитываем покрытие этой комбинации
            let coverage = 0;
            for (let i = 0; i < paramNames.length; i++) {
                for (let j = i + 1; j < paramNames.length; j++) {
                    if (comboValues[i] === null || comboValues[j] === null) continue;
                    const pairKey = `${i}-${comboValues[i]}|${j}-${comboValues[j]}`;
                    if (!coveredPairs.has(pairKey)) {
                        const exists = allPairsToCover.some(p => 
                            p.param1Idx === i && p.param2Idx === j && 
                            p.val1 === comboValues[i] && p.val2 === comboValues[j]
                        );
                        if (exists) coverage++;
                    }
                }
            }
            
            if (coverage > bestCoverage) {
                bestCoverage = coverage;
                bestComboValues = [...comboValues];
            }
        }
        
        // Если нашли хорошую комбинацию, добавляем её
        if (bestComboValues && bestCoverage > 0) {
            // Создаем комбинацию с ВСЕМИ параметрами
            const exampleParams = parameters.map(p => {
                const pName = p.name?.trim();
                if (!pName) return { name: '', value: '' };
                const paramIdx = paramNames.indexOf(pName);
                if (paramIdx >= 0 && bestComboValues[paramIdx] !== null) {
                    return { name: pName, value: bestComboValues[paramIdx] };
                }
                return { name: pName, value: '' };
            }).filter(p => p.name);
            
            bestCombo = { parameters: exampleParams };
            combinations.push(bestCombo);
            
            // Отмечаем все покрытые пары
            for (let i = 0; i < paramNames.length; i++) {
                for (let j = i + 1; j < paramNames.length; j++) {
                    if (bestComboValues[i] === null || bestComboValues[j] === null) continue;
                    const pairKey = `${i}-${bestComboValues[i]}|${j}-${bestComboValues[j]}`;
                    const exists = allPairsToCover.some(p => 
                        p.param1Idx === i && p.param2Idx === j && 
                        p.val1 === bestComboValues[i] && p.val2 === bestComboValues[j]
                    );
                    if (exists) {
                        coveredPairs.add(pairKey);
                    }
                }
            }
        } else {
            // Если не нашли комбинацию, которая покрывает новые пары, выходим
            break;
        }
    }
    
    return combinations.slice(0, maxCombinations);
};

const createNewTestCase = (feature, story, scenario = '', code = '') => ({
    id: generateId(),
    title: 'Новый тест-кейс',
    feature,
    story,
    scenario,
    code,
    precondition: '',
    sharedSteps: [],
    steps: [''],
    expected: '',
    tags: [],
    layer: 'E2E Tests',
    links: [],
    jiraIssue: '',
    priority: 'Medium',
    version: 'stable',
    parameters: [],
    examples: [],
    attachments: [],
});

// --- STATE MANAGEMENT HELPERS ---
const buildTreeFromCases = (cases) => {
    console.log('buildTreeFromCases: input cases:', cases);
    console.log('buildTreeFromCases: cases length:', cases?.length);
    
    const tree = {};
    (cases || []).forEach((c, index) => {
        console.log(`buildTreeFromCases: processing case ${index}:`, c);
        
        const testCase = {
            ...c,
            id: c.id || generateId(),
            priority: c.priority ?? 'Medium',
            version: c.version ?? undefined,
        };
        const { feature, story, scenario = '', code = '' } = testCase;
        
        console.log(`buildTreeFromCases: extracted fields - feature: "${feature}", story: "${story}", scenario: "${scenario}", code: "${code}"`);
        
        if (!feature || !story) {
            console.warn(`buildTreeFromCases: skipping case ${index} - missing feature or story:`, testCase);
            return;
        }
        
        if (!tree[feature]) tree[feature] = { stories: {}, isExpanded: true };
        if (!tree[feature].stories[story])
            tree[feature].stories[story] = { scenarios: {}, cases: [], isExpanded: true };
        if (scenario && !tree[feature].stories[story].scenarios[scenario]) {
            tree[feature].stories[story].scenarios[scenario] = { codes: {}, cases: [], isExpanded: true };
        }
        if (scenario) {
            if (code) {
                if (!tree[feature].stories[story].scenarios[scenario].codes[code]) {
                    tree[feature].stories[story].scenarios[scenario].codes[code] = { cases: [], isExpanded: true };
                }
                tree[feature].stories[story].scenarios[scenario].codes[code].cases.push(testCase);
            } else {
                tree[feature].stories[story].scenarios[scenario].cases.push(testCase);
            }
        } else {
            tree[feature].stories[story].cases.push(testCase);
        }
    });
    
    console.log('buildTreeFromCases: final tree:', tree);
    console.log('buildTreeFromCases: tree keys:', Object.keys(tree));
    
    return tree;
};

const flattenTreeToCases = (tree) => {
    const flat = [];

    Object.entries(tree).forEach(([feature, fData]) => {
        Object.entries(fData.stories).forEach(([story, sData]) => {

            // кейсы без сценариев
            (sData.cases || []).forEach(c => {
                const base = {
                    ...c,
                    feature,
                    story,
                    scenario: '',
                    code: c.code || '',
                    priority: c.priority,
                    version: c.version,
                };
                flat.push(base);
            });

            // кейсы со сценариями
            Object.entries(sData.scenarios).forEach(([scenario, scData]) => {
                // кейсы прямо под сценарием
                (scData.cases || []).forEach(c => {
                    const base = { ...c, feature, story, scenario, code: c.code || '', priority: c.priority, version: c.version };
                    flat.push(base);
                });

                // кейсы под конкретными code-узлами (unit)
                Object.entries(scData.codes || {}).forEach(([code, codeData]) => {
                    (codeData.cases || []).forEach(c => {
                        const base = { ...c, feature, story, scenario, code, priority: c.priority, version: c.version };
                        flat.push(base);
                    });
                });
            });

        });
    });

    return flat;
};

// --- UI COMPONENTS ---
// Компонент для отображения diff изменений (как в git)
const TestCaseDiffView = ({ diff, caseId, onApprove, onReject, hasPendingChanges }) => {
    if (!diff || !hasPendingChanges) return null;
    
    const fieldLabels = {
        title: 'Название',
        precondition: 'Предварительное условие',
        steps: 'Шаги',
        expected: 'Ожидаемый результат',
        layer: 'Тестовый слой',
        scenario: 'Сценарий',
        code: 'Code',
        feature: 'Feature',
        story: 'Story',
        tags: 'Теги',
        priority: 'Приоритет',
        version: 'Версия'
    };
    
    const formatValue = (value) => {
        if (value === null || value === undefined) return '(пусто)';
        if (Array.isArray(value)) {
            if (value.length === 0) return '(пусто)';
            return value.map((item, idx) => {
                if (typeof item === 'string') return `${idx + 1}. ${item}`;
                if (item?.text) return `${idx + 1}. [Общий шаг] ${item.text}`;
                return `${idx + 1}. ${JSON.stringify(item)}`;
            }).join('\n');
        }
        return String(value);
    };
    
    return (
        <div style={{
            marginBottom: '16px',
            padding: '12px',
            backgroundColor: 'rgba(255, 193, 7, 0.1)',
            border: '1px solid #ffc107',
            borderRadius: '4px'
        }}>
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '12px'
            }}>
                <h4 style={{ margin: 0, color: '#ffc107', fontSize: '14px', fontWeight: 'bold' }}>
                    ✏️ Непринятые изменения ({Object.keys(diff).length} поле(й))
                </h4>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => onApprove(caseId)}
                        style={{
                            padding: '6px 12px',
                            backgroundColor: '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '500'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#218838'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#28a745'}
                    >
                        ✓ Принять
                    </button>
                    <button
                        onClick={() => onReject(caseId)}
                        style={{
                            padding: '6px 12px',
                            backgroundColor: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '500'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#c82333'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#dc3545'}
                    >
                        ✗ Отклонить
                    </button>
                </div>
            </div>
            
            {Object.entries(diff).map(([field, changes]) => (
                <div key={field} style={{ marginBottom: '12px' }}>
                    <div style={{ 
                        fontSize: '12px', 
                        fontWeight: 'bold', 
                        color: '#ffc107',
                        marginBottom: '4px'
                    }}>
                        {fieldLabels[field] || field}
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px',
                        fontSize: '11px'
                    }}>
                        <div style={{
                            padding: '8px',
                            backgroundColor: 'rgba(220, 53, 69, 0.1)',
                            border: '1px solid #dc3545',
                            borderRadius: '4px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: '200px',
                            overflow: 'auto'
                        }}>
                            <div style={{ 
                                color: '#dc3545', 
                                fontWeight: 'bold', 
                                marginBottom: '4px',
                                fontSize: '10px'
                            }}>
                                − Было:
                            </div>
                            <div style={{ color: '#c9d1d9' }}>
                                {formatValue(changes.old)}
                            </div>
                        </div>
                        <div style={{
                            padding: '8px',
                            backgroundColor: 'rgba(40, 167, 69, 0.1)',
                            border: '1px solid #28a745',
                            borderRadius: '4px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: '200px',
                            overflow: 'auto'
                        }}>
                            <div style={{ 
                                color: '#28a745', 
                                fontWeight: 'bold', 
                                marginBottom: '4px',
                                fontSize: '10px'
                            }}>
                                + Стало:
                            </div>
                            <div style={{ color: '#c9d1d9' }}>
                                {formatValue(changes.new)}
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export function TestCaseCard({
    testCase,
    index,
    onUpdate,
    onDelete,
    projectId,
    jiraProject,
    jiraPat,
    testCaseDiffs = new Map(),
    pendingApprovals = new Set(),
    onApproveCase,
    onRejectCase,
}) {
    const [sharedOptions, setSharedOptions] = useState([]);

    const PAGE_SIZE = 20;

    const loadSharedStepOptions = React.useMemo(
        () =>
            debouncePromise(async (inputValue) => {
                if (!projectId) return [];
                const { data } = await axios.get(`${config.serverUrl}/shared-steps`, {
                    params: {
                        projectId,
                        page: 0,
                        size: PAGE_SIZE,
                        archived: false,
                        search: String(inputValue || '').trim(),
                    },
                });
                const items = data?.content || [];
                return items.map((s) => ({ value: s.id, label: s.name }));
            }, 300),
        [projectId]
    );


    const handleFieldChange = (field, value) =>
        onUpdate(testCase.id, { ...testCase, [field]: value });

    const addArrayItem = (field, newItem) =>
        handleFieldChange(field, [...(testCase[field] || []), newItem]);

    const removeArrayItem = (field, idx) =>
        handleFieldChange(field, (testCase[field] || []).filter((_, i) => i !== idx));

    const handleLinkChange = (linkIndex, linkField, value) => {
        const newLinks = [...(testCase.links || [])];
        newLinks[linkIndex] = { ...newLinks[linkIndex], [linkField]: value };
        handleFieldChange('links', newLinks);
    };

    const loadIssueOptions = async (input) => {
        if (!jiraProject || !jiraPat) return [];
        const q = input.trim();
        let jql;
        if (/^\d+$/.test(q)) {
            jql = `project = ${jiraProject} AND key = ${jiraProject}-${q}`;
        } else if (/^[A-Z]+-\d+$/.test(q)) {
            jql = `project = ${jiraProject} AND key = "${q}"`;
        } else {
            jql = `project = ${jiraProject} AND summary ~ "${q}*"`;
        }
        jql += ' ORDER BY created DESC';
        const url = new URL(`${config.serverUrl}/jira/search`);
        url.searchParams.set('pat', jiraPat);
        url.searchParams.set('jql', jql);
        url.searchParams.set('maxResults', 50);
        const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
        if (!resp.ok) return [];
        const { issues } = await resp.json();
        return issues.map((issue) => ({
            value: issue.key,
            label: `${issue.key} — ${issue.fields.summary}`,
        }));
    };

    const diff = testCaseDiffs.get(testCase.id);
    const hasPendingChanges = pendingApprovals.has(testCase.id);
    
    return (
        <div className="case-card">
            <TestCaseDiffView 
                diff={diff}
                caseId={testCase.id}
                onApprove={onApproveCase || (() => {})}
                onReject={onRejectCase || (() => {})}
                hasPendingChanges={hasPendingChanges}
            />
            <div className="case-card-header">
                <CaseIcon />
                <span className="node-title" style={{ flex: 1, cursor: 'default' }}>
                    {testCase.title || 'Тест-кейс без названия'}
                </span>
                <button
                    className="delete-btn"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(testCase.id);
                    }}
                >
                    ×
                </button>
            </div>

            <div className="case-card-details">
                            <div className="case-field">
                                <label>Название*</label>
                                <input
                                    type="text"
                                    value={testCase.title}
                                    onChange={(e) => handleFieldChange('title', e.target.value)}
                                />
                            </div>
                            <div className="case-field">
                                <label>Предварительное условие</label>
                                <textarea
                                    value={testCase.precondition}
                                    onChange={(e) => handleFieldChange('precondition', e.target.value)}
                                />
                            </div>
                            <div className="case-field">
                                <label>Шаги (Сценарий)*</label>
                                <DragDropContext
                                    onDragEnd={({ source, destination }) => {
                                        if (!destination) return;
                                        const arr = Array.from(testCase.steps);
                                        const [moved] = arr.splice(source.index, 1);
                                        arr.splice(destination.index, 0, moved);
                                        handleFieldChange('steps', arr);
                                    }}
                                >
                                    <Droppable droppableId={`steps-${testCase.id}`} type="STEP">
                                        {(dropProv) => (
                                            <div ref={dropProv.innerRef} {...dropProv.droppableProps}>
                                                {testCase.steps.map((step, idx) => (
                                                    <Draggable
                                                        key={idx}
                                                        draggableId={`step-${testCase.id}-${idx}`}
                                                        index={idx}
                                                    >
                                                        {(dragProv) => (
                                                            <div
                                                                ref={dragProv.innerRef}
                                                                {...dragProv.draggableProps}
                                                                {...dragProv.dragHandleProps}
                                                                className={`array-item ${typeof step === 'string' ? '' : 'shared-step-item'
                                                                    }`}
                                                            >
                                                                {typeof step === 'string' ? (
                                                                    <textarea
                                                                        value={step}
                                                                        placeholder={`Шаг ${idx + 1}`}
                                                                        onChange={(e) => {
                                                                            const arr = [...testCase.steps];
                                                                            arr[idx] = e.target.value;
                                                                            handleFieldChange('steps', arr);
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <div className="shared-step-label">{step.text}</div>
                                                                )}
                                                                <button
                                                                    className="remove-item-btn"
                                                                    onClick={() => removeArrayItem('steps', idx)}
                                                                >
                                                                    −
                                                                </button>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {dropProv.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
                                <button
                                    className="add-item-btn"
                                    onClick={() => addArrayItem('steps', '')}
                                >
                                    + Добавить шаг
                                </button>
                                <div style={{ marginTop: 8 }}>
                                    <AsyncSelect
                                        classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={loadSharedStepOptions}
                                        placeholder="+ Добавить общий шаг…"
                                        onChange={(opt) =>
                                            opt &&
                                            addArrayItem('steps', {
                                                sharedStepId: opt.value,
                                                text: opt.label,
                                            })
                                        }
                                        noOptionsMessage={() => 'Ничего не найдено'}
                                        styles={{
                                            container: (base) => ({ ...base, marginTop: 4 }),
                                            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                                        }}
                                        menuPortalTarget={document.body}
                                    />
                                </div>
                            </div>
                            <div className="case-field">
                                <label>Ожидаемый результат*</label>
                                <textarea
                                    value={testCase.expected}
                                    onChange={(e) => handleFieldChange('expected', e.target.value)}
                                />
                            </div>
                            <div className="field-grid">
                                <div className="case-field">
                                    <label>Теги (через запятую)*</label>
                                    <input
                                        type="text"
                                        value={(testCase.tags || []).join(', ')}
                                        onChange={(e) =>
                                            handleFieldChange(
                                                'tags',
                                                e.target.value.split(',').map((t) => t.trim())
                                            )
                                        }
                                    />
                                </div>
                            </div>
                            
                            <div className="case-field">
                                <label>Тестовый слой*</label>
                                <select
                                    value={testCase.layer}
                                    onChange={(e) => handleFieldChange('layer', e.target.value)}
                                >
                                    <option value="E2E Tests">E2E Tests</option>
                                    <option value="Integration frontend Tests">
                                        Integration frontend Tests
                                    </option>
                                    <option value="Integration backend Tests">
                                        Integration backend Tests
                                    </option>
                                    <option value="Unit frontend Tests">Unit frontend Tests</option>
                                    <option value="Unit backend Tests">Unit backend Tests</option>
                                </select>
                            </div>
                            <div className="case-field">
                                <label>Связанные задачи (Jira)*</label>
                                <AsyncSelect
                                    classNamePrefix="select"
                                        cacheOptions
                                        defaultOptions
                                        loadOptions={loadIssueOptions}
                                        placeholder="Начните вводить..."
                                        value={testCase.jiraIssueOption || null}
                                        onChange={(opt) => handleFieldChange('jiraIssueOption', opt)}
                                        noOptionsMessage={() =>
                                            !jiraProject || !jiraPat
                                                ? 'Укажите проект и PAT'
                                                : 'Ничего не найдено'
                                        }
                                    styles={{
                                        container: (base) => ({ ...base, marginTop: 4 }),
                                        menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                                    }}
                                    menuPortalTarget={document.body}
                                />
                            </div>
                            <div className="case-field">
                                <label>Приоритет*</label>
                                <select
                                    value={testCase.priority}
                                    onChange={(e) => handleFieldChange('priority', e.target.value)}
                                >
                                    <option value="Medium">Medium</option>
                                    <option value="Critical">Critical</option>
                                    <option value="High">High</option>
                                    <option value="Low">Low</option>
                                </select>
                            </div>
                            <div className="case-field">
                                <label>Ссылки (Confluence, Figma)</label>
                                {(testCase.links || []).map((link, i) => (
                                    <div key={i} className="array-item link-item">
                                        <input
                                            type="text"
                                            placeholder="Текст ссылки"
                                            value={link.text}
                                            onChange={(e) => handleLinkChange(i, 'text', e.target.value)}
                                        />
                                        <input
                                            type="text"
                                            placeholder="URL"
                                            value={link.url}
                                            onChange={(e) => handleLinkChange(i, 'url', e.target.value)}
                                        />
                                        <button
                                            className="remove-item-btn"
                                            onClick={() => removeArrayItem('links', i)}
                                        >
                                            −
                                        </button>
                                    </div>
                                ))}
                                <button
                                    className="add-item-btn"
                                    onClick={() => addArrayItem('links', { text: '', url: '' })}
                                >
                                    + Добавить ссылку
                                </button>
                            </div>
                            
                            {/* Параметры для параметризации */}
                            <div className="case-field">
                                <label>Параметры (для параметризации теста)</label>
                                <div style={{ marginBottom: '12px', fontSize: '12px', color: '#8b949e' }}>
                                    Используйте параметры, когда логика теста идентична, но меняются только входные данные
                                </div>
                                
                                {/* Двухколоночный layout: параметры слева, таблица комбинаций справа */}
                                <div style={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: testCase.parameters && testCase.parameters.length > 0 ? '1fr 1fr' : '1fr',
                                    gap: '20px',
                                    marginBottom: '16px',
                                    alignItems: 'start'
                                }}>
                                    {/* Левая колонка: Определение параметров */}
                                    <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
                                        <div style={{ 
                                            display: 'grid',
                                            gridTemplateColumns: `repeat(${Math.min((testCase.parameters || []).length || 1, 5)}, 1fr)`,
                                            gap: '16px',
                                            marginBottom: '16px'
                                        }}>
                                            {(testCase.parameters || []).map((param, paramIdx) => (
                                                <div key={paramIdx} style={{ 
                                                    padding: '16px', 
                                                    border: '1px solid var(--on-border-light, #bdd4ff36)', 
                                                    borderRadius: '8px',
                                                    backgroundColor: 'var(--bg-base-secondary, #2c343f)',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '12px',
                                                    minWidth: '200px'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="Название параметра"
                                                            value={param.name || ''}
                                                            onChange={(e) => {
                                                                const newParams = [...(testCase.parameters || [])];
                                                                newParams[paramIdx] = { ...newParams[paramIdx], name: e.target.value };
                                                                handleFieldChange('parameters', newParams);
                                                            }}
                                                            style={{ 
                                                                flex: 1, 
                                                                padding: '10px 12px',
                                                                backgroundColor: 'var(--bg-base-primary, #1b2129)',
                                                                border: '1px solid var(--on-border-light, #bdd4ff36)',
                                                                borderRadius: '6px',
                                                                color: 'var(--on-text-primary, #f6fafef5)',
                                                                fontSize: '13px',
                                                                boxSizing: 'border-box'
                                                            }}
                                                        />
                                                        <button
                                                            className="remove-item-btn"
                                                            onClick={() => {
                                                                const newParams = (testCase.parameters || []).filter((_, i) => i !== paramIdx);
                                                                handleFieldChange('parameters', newParams);
                                                            }}
                                                            style={{ 
                                                                padding: '10px 12px',
                                                                minWidth: '40px',
                                                                height: '40px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontSize: '16px'
                                                            }}
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                    
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {(param.values || []).map((value, valueIdx) => (
                                                            <EditableValueTag
                                                                key={valueIdx}
                                                                value={value}
                                                                autoEdit={!value}
                                                                onSave={(newValue) => {
                                                                    const newParams = [...(testCase.parameters || [])];
                                                                    const newValues = [...(newParams[paramIdx].values || [])];
                                                                    // Если значение пустое, удаляем его
                                                                    if (!newValue || !newValue.trim()) {
                                                                        const filteredValues = newValues.filter((_, i) => i !== valueIdx);
                                                                        newParams[paramIdx] = { ...newParams[paramIdx], values: filteredValues };
                                                                    } else {
                                                                        newValues[valueIdx] = newValue.trim();
                                                                        newParams[paramIdx] = { ...newParams[paramIdx], values: newValues };
                                                                    }
                                                                    handleFieldChange('parameters', newParams);
                                                                }}
                                                                onDelete={() => {
                                                                    const newParams = [...(testCase.parameters || [])];
                                                                    const newValues = (newParams[paramIdx].values || []).filter((_, i) => i !== valueIdx);
                                                                    newParams[paramIdx] = { ...newParams[paramIdx], values: newValues };
                                                                    handleFieldChange('parameters', newParams);
                                                                }}
                                                            />
                                                        ))}
                                                        <button
                                                            className="add-item-btn"
                                                            onClick={() => {
                                                                const newParams = [...(testCase.parameters || [])];
                                                                const newValues = [...(newParams[paramIdx].values || []), ''];
                                                                newParams[paramIdx] = { ...newParams[paramIdx], values: newValues };
                                                                handleFieldChange('parameters', newParams);
                                                            }}
                                                            style={{ 
                                                                marginTop: '4px', 
                                                                fontSize: '12px', 
                                                                padding: '8px 12px',
                                                                width: '100%',
                                                                height: '36px'
                                                            }}
                                                        >
                                                            + Добавить значение
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        
                                        <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
                                            <button
                                                className="add-item-btn"
                                                onClick={() => {
                                                    if ((testCase.parameters || []).length >= 5) {
                                                        alert('Максимальное количество параметров: 5');
                                                        return;
                                                    }
                                                    addArrayItem('parameters', { name: '', values: [''] });
                                                }}
                                                disabled={(testCase.parameters || []).length >= 5}
                                                style={{ 
                                                    width: '100%',
                                                    padding: '10px 12px',
                                                    height: '40px',
                                                    fontSize: '13px',
                                                    opacity: (testCase.parameters || []).length >= 5 ? 0.5 : 1,
                                                    cursor: (testCase.parameters || []).length >= 5 ? 'not-allowed' : 'pointer'
                                                }}
                                            >
                                                + Добавить параметр {(testCase.parameters || []).length >= 5 ? '(максимум 5)' : ''}
                                            </button>
                                            {testCase.parameters && testCase.parameters.length > 0 && (
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                                    <select
                                                        id={`combo-mode-${testCase.id}`}
                                                        defaultValue="pairwise"
                                                        style={{
                                                            flex: 1,
                                                            padding: '10px 12px',
                                                            backgroundColor: 'var(--bg-base-primary, #1b2129)',
                                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                                            borderRadius: '6px',
                                                            color: 'var(--on-text-primary, #f6fafef5)',
                                                            fontSize: '13px',
                                                            cursor: 'pointer',
                                                            height: '40px',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    >
                                                        <option value="all">Все значения</option>
                                                        <option value="pairwise">Pairwise</option>
                                                    </select>
                                                    <button
                                                        className="add-item-btn"
                                                        onClick={() => {
                                                            const mode = document.getElementById(`combo-mode-${testCase.id}`)?.value || 'all';
                                                            
                                                            // Проверяем валидность параметров перед генерацией
                                                            const validParams = (testCase.parameters || []).filter(p => 
                                                                p.name && p.name.trim() && 
                                                                p.values && Array.isArray(p.values) && 
                                                                p.values.length > 0 && 
                                                                p.values.some(v => v && v.trim())
                                                            );
                                                            
                                                            if (validParams.length === 0) {
                                                                alert('Невозможно сгенерировать комбинации. Убедитесь, что все параметры имеют имена и хотя бы одно значение.');
                                                                return;
                                                            }
                                                            
                                                            // Генерируем комбинации в зависимости от выбранного режима
                                                            const combinations = mode === 'pairwise' 
                                                                ? generatePairwiseCombinations(testCase.parameters || [])
                                                                : generateAllCombinations(testCase.parameters || []);
                                                            
                                                            if (combinations.length === 0) {
                                                                alert('Невозможно сгенерировать комбинации. Убедитесь, что все параметры имеют имена и хотя бы одно значение.');
                                                                return;
                                                            }
                                                            
                                                            // Заменяем существующие примеры на сгенерированные
                                                            handleFieldChange('examples', combinations);
                                                        }}
                                                        style={{ 
                                                            flex: 1,
                                                            backgroundColor: 'var(--on-support-castor, #45e57b)',
                                                            borderColor: 'var(--on-support-castor, #45e57b)',
                                                            color: '#000',
                                                            padding: '10px 12px',
                                                            height: '40px',
                                                            fontSize: '13px',
                                                            fontWeight: '500'
                                                        }}
                                                    >
                                                        Комбинировать
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Правая колонка: Таблица комбинаций */}
                                    {testCase.parameters && testCase.parameters.length > 0 && (
                                        <div style={{
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            borderRadius: '8px',
                                            backgroundColor: 'var(--bg-base-secondary, #2c343f)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            height: '100%',
                                            minHeight: '400px'
                                        }}>
                                            <div style={{ 
                                                padding: '12px 16px',
                                                borderBottom: '1px solid var(--on-border-light, #bdd4ff36)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                backgroundColor: 'var(--bg-base-primary, #1b2129)',
                                                borderRadius: '8px 8px 0 0',
                                                flexShrink: 0
                                            }}>
                                                <span style={{ fontSize: '13px', color: 'var(--on-text-hint, #d2e4fe80)', fontWeight: '500' }}>
                                                    Максимальное количество комбинаций: 50
                                                </span>
                                            </div>
                                            
                                            <div style={{ overflow: 'auto', flex: 1, minHeight: 0, paddingBottom: '8px' }}>
                                                {testCase.examples && testCase.examples.length > 0 ? (
                                                    <table style={{ 
                                                        width: '100%',
                                                        borderCollapse: 'collapse',
                                                        fontSize: '13px'
                                                    }}>
                                                        <thead>
                                                            <tr style={{ 
                                                                backgroundColor: 'var(--bg-base-primary, #1b2129)',
                                                                borderBottom: '1px solid var(--on-border-light, #bdd4ff36)',
                                                                height: '44px'
                                                            }}>
                                                                {(testCase.parameters || []).map((param, idx) => (
                                                                    <th key={idx} style={{ 
                                                                        padding: '0 16px',
                                                                        textAlign: 'left',
                                                                        color: 'var(--on-text-primary, #f6fafef5)',
                                                                        fontWeight: '500',
                                                                        borderRight: idx < (testCase.parameters || []).length - 1 ? '1px solid var(--on-border-light, #bdd4ff36)' : 'none',
                                                                        height: '44px',
                                                                        verticalAlign: 'middle'
                                                                    }}>
                                                                        {param.name || `Параметр ${idx + 1}`}
                                                                    </th>
                                                                ))}
                                                                <th style={{ 
                                                                    padding: '0',
                                                                    width: '50px',
                                                                    textAlign: 'center',
                                                                    height: '44px',
                                                                    verticalAlign: 'middle'
                                                                }}></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {testCase.examples.map((example, exampleIdx) => (
                                                                <tr key={exampleIdx} style={{
                                                                    borderBottom: '1px solid var(--on-border-light, #bdd4ff36)',
                                                                    backgroundColor: exampleIdx % 2 === 0 ? 'var(--bg-base-secondary, #2c343f)' : 'transparent',
                                                                    height: '44px'
                                                                }}>
                                                                    {(testCase.parameters || []).map((param, paramIdx) => {
                                                                        const exParam = (example.parameters || []).find(p => p.name === param.name);
                                                                        return (
                                                                            <td key={paramIdx} style={{ 
                                                                        padding: '0',
                                                                        color: 'var(--on-text-primary, #f6fafef5)',
                                                                        borderRight: paramIdx < (testCase.parameters || []).length - 1 ? '1px solid var(--on-border-light, #bdd4ff36)' : 'none',
                                                                        verticalAlign: 'middle',
                                                                        height: '44px'
                                                                    }}>
                                                                                <select
                                                                                    value={exParam?.value || ''}
                                                                                    onChange={(e) => {
                                                                                        const newExamples = [...(testCase.examples || [])];
                                                                                        const newExParams = [...(newExamples[exampleIdx].parameters || [])];
                                                                                        const paramIdxInExample = newExParams.findIndex(p => p.name === param.name);
                                                                                        if (paramIdxInExample >= 0) {
                                                                                            newExParams[paramIdxInExample] = { ...newExParams[paramIdxInExample], value: e.target.value };
                                                                                        } else {
                                                                                            newExParams.push({ name: param.name, value: e.target.value });
                                                                                        }
                                                                                        newExamples[exampleIdx] = { ...newExamples[exampleIdx], parameters: newExParams };
                                                                                        handleFieldChange('examples', newExamples);
                                                                                    }}
                                                                                    style={{ 
                                                                                        width: '100%',
                                                                                        height: '44px',
                                                                                        padding: '0 16px',
                                                                                        backgroundColor: 'var(--bg-base-primary, #1b2129)',
                                                                                        border: 'none',
                                                                                        borderRadius: '0',
                                                                                        color: 'var(--on-text-primary, #f6fafef5)',
                                                                                        fontSize: '13px',
                                                                                        cursor: 'pointer',
                                                                                        boxSizing: 'border-box',
                                                                                        outline: 'none',
                                                                                        display: 'block',
                                                                                        margin: '0',
                                                                                        appearance: 'none',
                                                                                        WebkitAppearance: 'none',
                                                                                        MozAppearance: 'none'
                                                                                    }}
                                                                                >
                                                                                    <option value="">-</option>
                                                                                    {param.values && param.values.filter(v => v && v.trim()).map((val, valIdx) => (
                                                                                        <option key={valIdx} value={val.trim()}>
                                                                                            {val.trim()}
                                                                                        </option>
                                                                                    ))}
                                                                                </select>
                                                                            </td>
                                                                        );
                                                                    })}
                                                                    <td style={{ 
                                                                        padding: '6px',
                                                                        textAlign: 'center',
                                                                        verticalAlign: 'middle',
                                                                        height: '44px',
                                                                        width: '50px'
                                                                    }}>
                                                                        <button
                                                                            onClick={() => {
                                                                                const newExamples = (testCase.examples || []).filter((_, i) => i !== exampleIdx);
                                                                                handleFieldChange('examples', newExamples);
                                                                            }}
                                                                            style={{ 
                                                                                background: 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))',
                                                                                border: '1px solid var(--on-support-capella, #ff584d)',
                                                                                color: 'var(--on-support-capella, #ff584d)',
                                                                                cursor: 'pointer',
                                                                                padding: '0',
                                                                                width: '32px',
                                                                                height: '32px',
                                                                                borderRadius: '4px',
                                                                                fontSize: '16px',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'center',
                                                                                margin: '0 auto'
                                                                            }}
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                ) : (
                                                    <div style={{ 
                                                        padding: '24px',
                                                        textAlign: 'center',
                                                        color: '#8b949e',
                                                        fontSize: '12px'
                                                    }}>
                                                        Нет комбинаций. Нажмите "→ Комбинировать" для генерации.
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {testCase.examples && testCase.examples.length > 0 && (
                                                <div style={{ 
                                                    padding: '12px 16px',
                                                    borderTop: '1px solid var(--on-border-light, #bdd4ff36)',
                                                    display: 'flex',
                                                    justifyContent: 'flex-end',
                                                    backgroundColor: 'var(--bg-base-primary, #1b2129)',
                                                    borderRadius: '0 0 8px 8px'
                                                }}>
                                                    <button
                                                        className="add-item-btn"
                                                        onClick={() => {
                                                            const newExample = {
                                                                parameters: (testCase.parameters || []).map(p => ({
                                                                    name: p.name || '',
                                                                    value: ''
                                                                }))
                                                            };
                                                            addArrayItem('examples', newExample);
                                                        }}
                                                        style={{ 
                                                            fontSize: '13px', 
                                                            padding: '10px 16px',
                                                            height: '40px',
                                                            minWidth: '140px'
                                                        }}
                                                    >
                                                        + Добавить строку
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
            </div>
        </div>
    );
}

const Node = ({ droppableId, children }) => (
    <Droppable droppableId={droppableId} type="CASE">
        {(provided, snapshot) => (
            <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`node-children ${snapshot.isDraggingOver ? 'is-over' : ''}`}
            >
                {children}
                {provided.placeholder}
            </div>
        )}
    </Droppable>
);

const CodeNode = ({
    name,
    cases,
    path,
    onUpdate,
    onDelete,
    onToggleExpandSelf, // <— новое имя
    isExpanded,
    onAddTestCase,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => {
    const hasFE = Array.isArray(cases) && cases.some(c => String(c.layer || '').toLowerCase().includes('frontend'));
    const hasBE = Array.isArray(cases) && cases.some(c => String(c.layer || '').toLowerCase().includes('backend'));

    return (
        <div className="tree-node code-node">
            <div
                className="node-header code-header"
                onClick={(e) => { e.stopPropagation(); onToggleExpandSelf(); }} // <— стопим всплытие
            >
                <div className="node-icon">{isExpanded ? <ChevronDown /> : <ChevronRight />}</div>
                <div className="node-icon"><CodeIcon /></div>
                <span className="node-title">{name}</span>

                <div className="node-badges" onClick={(e) => e.stopPropagation()}>
                    {hasFE && <span className="badge badge-fe" title="Фронтенд-поведение">FE</span>}
                    {hasBE && <span className="badge badge-be" title="Бэкенд-поведение">BE</span>}
                </div>

                <button
                    className="delete-btn"
                    onClick={e => {
                        e.stopPropagation();
                        if (window.confirm('Удалить code-узел и все кейсы в нём?')) {
                            onDeleteNode(path, 'code');
                        }
                    }}
                >
                    ×
                </button>
            </div>

            {isExpanded && (
                <>
                    <Node droppableId={JSON.stringify(path)}>
                        {cases.map((c, i) => (
                            <Draggable key={c.id} draggableId={`case-${c.id}`} index={i}>
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        style={{
                                            ...provided.draggableProps.style,
                                            opacity: snapshot.isDragging ? 0.8 : 1
                                        }}
                                    >
                                        <div {...provided.dragHandleProps} style={{ cursor: 'grab' }}>
                                            <TestCaseCard
                                                testCase={c}
                                                index={i}
                                                onUpdate={onUpdate}
                                                onDelete={onDelete}
                                                projectId={projectId}
                                                jiraProject={jiraProject}
                                                jiraPat={jiraPat}
                                            />
                                        </div>
                                    </div>
                                )}
                            </Draggable>
                        ))}
                    </Node>
                    <div className="add-buttons">
                        <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                            + Тест-кейс code
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};



const ScenarioNode = ({
    name,
    cases,
    scenarioData,
    path,
    onUpdate,
    onDelete,
    onToggleExpand,
    isExpanded,
    onAddTestCase,
    onAddCode,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => (
    <div className="tree-node scenario-node">
        <div className="node-header" onClick={() => onToggleExpand(path)}>
            <div className="node-icon">{isExpanded ? <ChevronDown /> : <ChevronRight />}</div>
            <div className="node-icon">
                <ScenarioIcon />
            </div>
            <span className="node-title">{name}</span>
            <button
                className="delete-btn"
                onClick={e => {
                    e.stopPropagation();
                    if (window.confirm('Удалить сценарий и все кейсы в нём?')) {
                        onDeleteNode(path, 'scenario');
                    }
                }}
            >
                ×
            </button>
        </div>
        {isExpanded && (
            <>
                <Node droppableId={JSON.stringify(path)}>
                    {cases.map((c, i) => (
                        <Draggable key={c.id} draggableId={`case-${c.id}`} index={i}>
                            {(provided, snapshot) => (
                                <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    style={{
                                        ...provided.draggableProps.style,
                                        opacity: snapshot.isDragging ? 0.8 : 1
                                    }}
                                >
                                    <div {...provided.dragHandleProps} style={{ cursor: 'grab' }}>
                                        <TestCaseCard
                                            testCase={c}
                                            index={i}
                                            onUpdate={onUpdate}
                                            onDelete={onDelete}
                                            projectId={projectId}
                                            jiraProject={jiraProject}
                                            jiraPat={jiraPat}
                                        />
                                    </div>
                                </div>
                            )}
                        </Draggable>
                    ))}
                </Node>

                {/* Code-узлы (юниты живут здесь) */}
                {Object.entries(scenarioData?.codes || {}).map(([codeName, codeData]) => (
                    <CodeNode
                        key={codeName}
                        name={codeName}
                        cases={codeData.cases}
                        path={[...path, codeName]}           // [feature, story, scenario, code]
                        isExpanded={codeData.isExpanded}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onToggleExpandSelf={() => onToggleExpand([...path, codeName])}
                        onAddTestCase={onAddTestCase}
                        projectId={projectId}
                        jiraProject={jiraProject}
                        jiraPat={jiraPat}
                        onDeleteNode={onDeleteNode}
                    />
                ))}

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                        + Тест-кейс scenario
                    </button>
                    <button className="add-node-btn" onClick={() => onAddCode(path)}>
                        + Код (unit-узел)
                    </button>
                </div>
            </>
        )}
    </div>
);

const StoryNode = ({
    name,
    storyData,
    path,
    onUpdate,
    onDelete,
    onAddScenario,
    onToggleExpand,
    onAddTestCase,
    onAddCode,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => (
    <div className="tree-node story-node">
        <div className="node-header" onClick={() => onToggleExpand(path)}>
            <div className="node-icon">
                {storyData.isExpanded ? <ChevronDown /> : <ChevronRight />}
            </div>
            <div className="node-icon">
                <StoryIcon />
            </div>
            <span className="node-title">{name}</span>
            <button
                className="delete-btn"
                onClick={e => {
                    e.stopPropagation();
                    if (window.confirm('Удалить историю и всё внутри?')) {
                        onDeleteNode(path, 'story');
                    }
                }}
            >
                ×
            </button>
        </div>
        {storyData.isExpanded && (
            <div className="pl-4">
                <Node droppableId={JSON.stringify(path)}>
                    {storyData.cases.map((c, i) => (
                        <Draggable key={c.id} draggableId={`case-${c.id}`} index={i}>
                            {(provided, snapshot) => (
                                <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    style={{
                                        ...provided.draggableProps.style,
                                        opacity: snapshot.isDragging ? 0.8 : 1
                                    }}
                                >
                                    <div {...provided.dragHandleProps} style={{ cursor: 'grab' }}>
                                        <TestCaseCard
                                            testCase={c}
                                            index={i}
                                            onUpdate={onUpdate}
                                            onDelete={onDelete}
                                            projectId={projectId}
                                            jiraProject={jiraProject}
                                            jiraPat={jiraPat}
                                        />
                                    </div>
                                </div>
                            )}
                        </Draggable>
                    ))}
                </Node>

                {Object.entries(storyData.scenarios).map(([scenarioName, scenarioData]) => (
                    <ScenarioNode
                        key={scenarioName}
                        name={scenarioName}
                        cases={scenarioData.cases}
                        scenarioData={scenarioData}
                        path={[...path, scenarioName]}
                        isExpanded={scenarioData.isExpanded}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onToggleExpand={onToggleExpand}
                        onAddTestCase={onAddTestCase}
                        onAddCode={onAddCode}
                        projectId={projectId}
                        jiraProject={jiraProject}
                        jiraPat={jiraPat}
                        onDeleteNode={onDeleteNode}
                    />
                ))}

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddTestCase(path)}>
                        + Тест-кейс story
                    </button>
                    <button className="add-node-btn" onClick={() => onAddScenario(path)}>
                        + Сценарий
                    </button>
                </div>
            </div>
        )}
    </div>
);

const FeatureNode = ({
    name,
    featureData,
    path,
    onUpdate,
    onDelete,
    onAddStory,
    onAddScenario,
    onToggleExpand,
    onAddTestCase,
    onAddCode,
    projectId,
    jiraProject,
    jiraPat,
    onDeleteNode
}) => (
    <div className="tree-node feature-node">
        <div className="node-header" onClick={() => onToggleExpand(path)}>
            <div className="node-icon">
                {featureData.isExpanded ? <ChevronDown /> : <ChevronRight />}
            </div>
            <div className="node-icon">
                <FolderIcon />
            </div>
            <span className="node-title feature-title">{name}</span>
            <button
                className="delete-btn"
                onClick={e => {
                    e.stopPropagation();
                    if (window.confirm('Удалить фичу и всё внутри?')) {
                        onDeleteNode(path, 'feature');
                    }
                }}
            >
                ×
            </button>
        </div>
        {featureData.isExpanded && (
            <div className="pl-4">
                {Object.entries(featureData.stories).map(([storyName, storyData]) => (
                    <StoryNode
                        key={storyName}
                        name={storyName}
                        storyData={storyData}
                        path={[...path, storyName]}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onAddScenario={onAddScenario}
                        onAddTestCase={onAddTestCase}
                        onAddCode={onAddCode}
                        onToggleExpand={onToggleExpand}
                        projectId={projectId}
                        jiraProject={jiraProject}
                        jiraPat={jiraPat}
                        onDeleteNode={onDeleteNode}
                    />
                ))}

                <div className="add-buttons">
                    <button className="add-node-btn" onClick={() => onAddStory(path)}>
                        + История
                    </button>
                </div>
            </div>
        )}
    </div>
);

// Компонент для resizable панели
const ResizablePanel = ({ children, initialWidth, minWidth, maxWidth, side, onWidthChange }) => {
    const [width, setWidth] = useState(initialWidth);
    const [isResizing, setIsResizing] = useState(false);

    const handleMouseDown = (e) => {
        e.preventDefault();
        setIsResizing(true);
    };

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e) => {
            const newWidth = side === 'left' 
                ? e.clientX 
                : window.innerWidth - e.clientX;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                setWidth(newWidth);
                if (onWidthChange) {
                    onWidthChange(newWidth);
                }
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, minWidth, maxWidth, side, onWidthChange]);

    return (
        <div style={{ position: 'relative', width: `${width}px`, flexShrink: 0 }}>
            {children}
            <div 
                className="resizer"
                onMouseDown={handleMouseDown}
                style={{ 
                    cursor: isResizing ? 'col-resize' : 'col-resize',
                    userSelect: 'none'
                }}
            />
        </div>
    );
};

// Иконка зеленого круга для тест-кейсов
const GreenCircleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="#3fb950">
        <circle cx="8" cy="8" r="6" />
    </svg>
);

// Упрощенное дерево для левой панели (только названия, кликабельные)
const SimpleTreeView = ({ 
    treeData, 
    selectedCaseId, 
    onSelectCase, 
    onToggleExpand,
    onAddNode,
    onDeleteNode,
    onRenameNode,
    onDeleteCase,
    testCaseDiffs = new Map(),
    pendingApprovals = new Set()
}) => {
    const [editingNode, setEditingNode] = useState(null);
    const [editValue, setEditValue] = useState('');
    // Функция для подсчета количества элементов в узле
    const countItems = (nodeData, nodeType) => {
        if (nodeType === 'feature') {
            let count = 0;
            Object.values(nodeData.stories || {}).forEach(story => {
                count += (story.cases || []).length;
                Object.values(story.scenarios || {}).forEach(scenario => {
                    count += (scenario.cases || []).length;
                    Object.values(scenario.codes || {}).forEach(code => {
                        count += (code.cases || []).length;
                    });
                });
            });
            return count;
        } else if (nodeType === 'story') {
            let count = (nodeData.cases || []).length;
            Object.values(nodeData.scenarios || {}).forEach(scenario => {
                count += (scenario.cases || []).length;
                Object.values(scenario.codes || {}).forEach(code => {
                    count += (code.cases || []).length;
                });
            });
            return count;
        } else if (nodeType === 'scenario') {
            let count = (nodeData.cases || []).length;
            Object.values(nodeData.codes || {}).forEach(code => {
                count += (code.cases || []).length;
            });
            return count;
        } else if (nodeType === 'code') {
            return (nodeData.cases || []).length;
        }
        return 0;
    };

    const renderTestCaseItem = (testCase, level, path, index) => {
        const isSelected = selectedCaseId === testCase.id;
        const displayTitle = testCase.title || 'Без названия';
        
        // Проверяем, есть ли непринятые изменения для этого ТК
        const hasPendingChanges = pendingApprovals.has(testCase.id);
        const diff = testCaseDiffs.get(testCase.id);
        
        return (
            <Draggable key={testCase.id} draggableId={`case-${testCase.id}`} index={index}>
                {(provided, snapshot) => (
                    <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`test-tree-row ${isSelected ? 'selected' : ''} ${snapshot.isDragging ? 'is-dragging' : ''}`}
                        onClick={() => onSelectCase(testCase)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px 8px',
                            paddingLeft: `${8 + level * 20}px`,
                            cursor: snapshot.isDragging ? 'grabbing' : 'grab',
                            backgroundColor: hasPendingChanges 
                                ? 'rgba(255, 193, 7, 0.2)' // Жёлтый фон для непринятых изменений
                                : isSelected 
                                    ? 'rgba(88, 166, 255, 0.15)' 
                                    : 'transparent',
                            borderLeft: hasPendingChanges ? '3px solid #ffc107' : '3px solid transparent',
                            opacity: snapshot.isDragging ? 0.8 : 1,
                            ...provided.draggableProps.style
                        }}
                    >
                        <div {...provided.dragHandleProps} style={{ marginRight: '8px', display: 'flex', alignItems: 'center', cursor: 'grab' }}>
                            <GreenCircleIcon />
                        </div>
                        {hasPendingChanges && (
                            <span 
                                style={{ 
                                    marginRight: '6px',
                                    fontSize: '12px',
                                    color: '#ffc107',
                                    fontWeight: 'bold'
                                }}
                                title={`Непринятые изменения: ${Object.keys(diff || {}).length} поле(й)`}
                            >
                                ✏️
                            </span>
                        )}
                        <span 
                            className="test-tree-node-title" 
                            title={displayTitle}
                            style={{ 
                                flex: 1,
                                fontSize: '13px',
                                color: hasPendingChanges ? '#ffc107' : '#c9d1d9',
                                fontWeight: hasPendingChanges ? '500' : 'normal'
                            }}
                        >
                            {displayTitle}
                        </span>
                        <div 
                            className="test-tree-node-controls"
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center' }}
                        >
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm('Удалить тест-кейс?')) {
                                        if (onDeleteCase) {
                                            onDeleteCase(testCase.id, path);
                                        }
                                    }
                                }}
                                style={{
                                    background: 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))',
                                    border: '1px solid var(--on-support-capella, #ff584d)',
                                    color: 'var(--on-support-capella, #ff584d)',
                                    cursor: 'pointer',
                                    padding: '6px 10px',
                                    fontSize: '16px',
                                    borderRadius: '4px',
                                    minWidth: '32px',
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.2))'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))'}
                                title="Удалить тест-кейс"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                )}
            </Draggable>
        );
    };
    
    const renderNode = (nodeData, path, level = 0) => {
        let nodeName, nodeType;
        if (path.length === 1) {
            nodeName = path[0];
            nodeType = 'feature';
        } else if (path.length === 2) {
            nodeName = path[1];
            nodeType = 'story';
        } else if (path.length === 3) {
            nodeName = path[2];
            nodeType = 'scenario';
        } else if (path.length === 4) {
            nodeName = path[3];
            nodeType = 'code';
        } else {
            return null;
        }
        
        const isExpanded = nodeData.isExpanded !== false;
        const hasChildren = 
            (nodeType === 'feature' && Object.keys(nodeData.stories || {}).length > 0) ||
            (nodeType === 'story' && (
                (nodeData.cases || []).length > 0 ||
                Object.keys(nodeData.scenarios || {}).length > 0
            )) ||
            (nodeType === 'scenario' && (
                (nodeData.cases || []).length > 0 ||
                Object.keys(nodeData.codes || {}).length > 0
            )) ||
            (nodeType === 'code' && (nodeData.cases || []).length > 0);
        
        return (
            <div key={path.join('/')}>
                {nodeType === 'feature' && (
                    <div
                        className="test-tree-row"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px 8px',
                            paddingLeft: `${8 + level * 20}px`,
                            cursor: 'pointer'
                        }}
                    >
                        <div className="test-tree-node-icon" style={{ cursor: hasChildren ? 'pointer' : 'default', marginRight: '8px', display: 'flex', alignItems: 'center' }} onClick={() => hasChildren && onToggleExpand(path)}>
                            <span style={{ fontSize: '11px', minWidth: '12px', marginRight: '4px' }}>
                                {hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
                            </span>
                            <FolderIcon />
                        </div>
                        {editingNode === path.join('/') ? (
                            <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => {
                                    if (editValue.trim() && editValue !== nodeName) {
                                        onRenameNode(path, editValue.trim());
                                    }
                                    setEditingNode(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        if (editValue.trim() && editValue !== nodeName) {
                                            onRenameNode(path, editValue.trim());
                                        }
                                        setEditingNode(null);
                                    } else if (e.key === 'Escape') {
                                        setEditingNode(null);
                                    }
                                }}
                                autoFocus
                                style={{
                                    flex: 1,
                                    padding: '2px 6px',
                                    backgroundColor: '#161b22',
                                    border: '1px solid #58a6ff',
                                    borderRadius: '4px',
                                    color: '#c9d1d9',
                                    fontSize: '13px'
                                }}
                            />
                        ) : (
                            <>
                                <span 
                                    className="test-tree-node-title"
                                    style={{ 
                                        fontWeight: '600', 
                                        color: 'var(--on-support-aldebaran, #7aa8ff)',
                                        flex: 1,
                                        fontSize: '13px'
                                    }}
                                    onClick={() => hasChildren && onToggleExpand(path)}
                                    onDoubleClick={() => {
                                        setEditingNode(path.join('/'));
                                        setEditValue(nodeName);
                                    }}
                                    title={nodeName}
                                >
                                    {nodeName}
                                </span>
                                <span style={{ 
                                    fontSize: '12px', 
                                    color: '#8b949e',
                                    marginLeft: '8px',
                                    marginRight: '8px'
                                }}>
                                    {countItems(nodeData, nodeType)}
                                </span>
                                <div className="test-tree-node-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddNode(path, 'story');
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '40px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Добавить Story"
                                    >
                                        Story
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingNode(path.join('/'));
                                            setEditValue(nodeName);
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '32px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Редактировать название"
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm('Удалить фичу и всё внутри?')) {
                                                onDeleteNode(path, 'feature');
                                            }
                                        }}
                                        style={{
                                            background: 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))',
                                            border: '1px solid var(--on-support-capella, #ff584d)',
                                            color: 'var(--on-support-capella, #ff584d)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '32px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))'}
                                        title="Удалить"
                                    >
                                        ×
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {nodeType === 'story' && (
                    <div
                        className="test-tree-row"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px 8px',
                            paddingLeft: `${8 + level * 20}px`,
                            cursor: 'pointer'
                        }}
                    >
                        <div className="test-tree-node-icon" style={{ cursor: hasChildren ? 'pointer' : 'default', marginRight: '8px', display: 'flex', alignItems: 'center' }} onClick={() => hasChildren && onToggleExpand(path)}>
                            <span style={{ fontSize: '11px', minWidth: '12px', marginRight: '4px' }}>
                                {hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
                            </span>
                            <FolderIcon />
                        </div>
                        {editingNode === path.join('/') ? (
                            <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => {
                                    if (editValue.trim() && editValue !== nodeName) {
                                        onRenameNode(path, editValue.trim());
                                    }
                                    setEditingNode(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        if (editValue.trim() && editValue !== nodeName) {
                                            onRenameNode(path, editValue.trim());
                                        }
                                        setEditingNode(null);
                                    } else if (e.key === 'Escape') {
                                        setEditingNode(null);
                                    }
                                }}
                                autoFocus
                                style={{
                                    flex: 1,
                                    padding: '2px 6px',
                                    backgroundColor: '#161b22',
                                    border: '1px solid #3fb950',
                                    borderRadius: '4px',
                                    color: '#c9d1d9',
                                    fontSize: '13px'
                                }}
                            />
                        ) : (
                            <>
                                <span 
                                    className="test-tree-node-title"
                                    style={{ 
                                        color: 'var(--on-support-castor, #45e57b)',
                                        flex: 1,
                                        fontSize: '13px'
                                    }}
                                    onClick={() => hasChildren && onToggleExpand(path)}
                                    onDoubleClick={() => {
                                        setEditingNode(path.join('/'));
                                        setEditValue(nodeName);
                                    }}
                                    title={nodeName}
                                >
                                    {nodeName}
                                </span>
                                <span style={{ 
                                    fontSize: '12px', 
                                    color: '#8b949e',
                                    marginLeft: '8px',
                                    marginRight: '8px'
                                }}>
                                    {countItems(nodeData, nodeType)}
                                </span>
                                <div className="test-tree-node-controls">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddNode(path, 'scenario');
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '40px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Добавить Scenario"
                                    >
                                        +Sc
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddNode(path, 'case');
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '40px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Добавить Test Case"
                                    >
                                        +TC
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingNode(path.join('/'));
                                            setEditValue(nodeName);
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '32px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Редактировать название"
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm('Удалить историю и всё внутри?')) {
                                                onDeleteNode(path, 'story');
                                            }
                                        }}
                                        style={{
                                            background: 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))',
                                            border: '1px solid var(--on-support-capella, #ff584d)',
                                            color: 'var(--on-support-capella, #ff584d)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '32px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))'}
                                        title="Удалить"
                                    >
                                        ×
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {nodeType === 'scenario' && (
                    <div
                        className="test-tree-row"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px 8px',
                            paddingLeft: `${8 + level * 20}px`,
                            cursor: 'pointer'
                        }}
                    >
                        <div className="test-tree-node-icon" style={{ cursor: hasChildren ? 'pointer' : 'default', marginRight: '8px', display: 'flex', alignItems: 'center' }} onClick={() => hasChildren && onToggleExpand(path)}>
                            <span style={{ fontSize: '11px', minWidth: '12px', marginRight: '4px' }}>
                                {hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
                            </span>
                            <FolderIcon />
                        </div>
                        {editingNode === path.join('/') ? (
                            <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => {
                                    if (editValue.trim() && editValue !== nodeName) {
                                        onRenameNode(path, editValue.trim());
                                    }
                                    setEditingNode(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        if (editValue.trim() && editValue !== nodeName) {
                                            onRenameNode(path, editValue.trim());
                                        }
                                        setEditingNode(null);
                                    } else if (e.key === 'Escape') {
                                        setEditingNode(null);
                                    }
                                }}
                                autoFocus
                                style={{
                                    flex: 1,
                                    padding: '2px 6px',
                                    backgroundColor: '#161b22',
                                    border: '1px solid #a371f7',
                                    borderRadius: '4px',
                                    color: '#c9d1d9',
                                    fontSize: '13px'
                                }}
                            />
                        ) : (
                            <>
                                <span 
                                    className="test-tree-node-title"
                                    style={{ 
                                        color: 'var(--on-support-betelgeuse, #b17aff)',
                                        flex: 1,
                                        fontSize: '13px'
                                    }}
                                    onClick={() => hasChildren && onToggleExpand(path)}
                                    onDoubleClick={() => {
                                        setEditingNode(path.join('/'));
                                        setEditValue(nodeName);
                                    }}
                                    title={nodeName}
                                >
                                    {nodeName}
                                </span>
                                <span style={{ 
                                    fontSize: '12px', 
                                    color: '#8b949e',
                                    marginLeft: '8px',
                                    marginRight: '8px'
                                }}>
                                    {countItems(nodeData, nodeType)}
                                </span>
                                <div className="test-tree-node-controls">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddNode(path, 'code');
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '40px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Добавить Code"
                                    >
                                        +C
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddNode(path, 'case');
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '40px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Добавить Test Case"
                                    >
                                        +TC
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm('Удалить сценарий и всё внутри?')) {
                                                onDeleteNode(path, 'scenario');
                                            }
                                        }}
                                        style={{
                                            background: 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))',
                                            border: '1px solid var(--on-support-capella, #ff584d)',
                                            color: 'var(--on-support-capella, #ff584d)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '32px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))'}
                                        title="Удалить"
                                    >
                                        ×
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {nodeType === 'code' && (
                    <div
                        className="test-tree-row"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px 8px',
                            paddingLeft: `${8 + level * 20}px`,
                            cursor: 'pointer'
                        }}
                    >
                        <div className="test-tree-node-icon" style={{ cursor: hasChildren ? 'pointer' : 'default', marginRight: '8px', display: 'flex', alignItems: 'center' }} onClick={() => hasChildren && onToggleExpand(path)}>
                            <span style={{ fontSize: '11px', minWidth: '12px', marginRight: '4px' }}>
                                {hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
                            </span>
                            <FolderIcon />
                        </div>
                        {editingNode === path.join('/') ? (
                            <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => {
                                    if (editValue.trim() && editValue !== nodeName) {
                                        onRenameNode(path, editValue.trim());
                                    }
                                    setEditingNode(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        if (editValue.trim() && editValue !== nodeName) {
                                            onRenameNode(path, editValue.trim());
                                        }
                                        setEditingNode(null);
                                    } else if (e.key === 'Escape') {
                                        setEditingNode(null);
                                    }
                                }}
                                autoFocus
                                style={{
                                    flex: 1,
                                    padding: '2px 6px',
                                    backgroundColor: '#161b22',
                                    border: '1px solid #f85149',
                                    borderRadius: '4px',
                                    color: '#c9d1d9',
                                    fontSize: '13px'
                                }}
                            />
                        ) : (
                            <>
                                <span 
                                    className="test-tree-node-title"
                                    style={{ 
                                        color: 'var(--on-support-atlas, #ffa94d)',
                                        flex: 1,
                                        fontSize: '13px'
                                    }}
                                    onClick={() => hasChildren && onToggleExpand(path)}
                                    onDoubleClick={() => {
                                        setEditingNode(path.join('/'));
                                        setEditValue(nodeName);
                                    }}
                                    title={nodeName}
                                >
                                    {nodeName}
                                </span>
                                <span style={{ 
                                    fontSize: '12px', 
                                    color: '#8b949e',
                                    marginLeft: '8px',
                                    marginRight: '8px'
                                }}>
                                    {countItems(nodeData, nodeType)}
                                </span>
                                <div className="test-tree-node-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddNode(path, 'case');
                                        }}
                                        style={{
                                            background: 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))',
                                            border: '1px solid var(--on-border-light, #bdd4ff36)',
                                            color: 'var(--on-text-primary, #f6fafef5)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '13px',
                                            borderRadius: '4px',
                                            minWidth: '40px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.1))'}
                                        title="Добавить Test Case"
                                    >
                                        +TC
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm('Удалить код и всё внутри?')) {
                                                onDeleteNode(path, 'code');
                                            }
                                        }}
                                        style={{
                                            background: 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))',
                                            border: '1px solid var(--on-support-capella, #ff584d)',
                                            color: 'var(--on-support-capella, #ff584d)',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            fontSize: '16px',
                                            borderRadius: '4px',
                                            minWidth: '32px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.2))'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-alpha-capella, rgba(232, 57, 44, 0.12))'}
                                        title="Удалить"
                                    >
                                        ×
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                
                {isExpanded && (
                    <div>
                        {/* Кейсы на уровне story */}
                        {nodeType === 'story' && (
                            <Droppable droppableId={JSON.stringify(path)} type="CASE">
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        style={{
                                            minHeight: '10px',
                                            backgroundColor: snapshot.isDraggingOver ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                                            borderRadius: snapshot.isDraggingOver ? '4px' : '0'
                                        }}
                                    >
                                        {(nodeData.cases || []).map((c, i) => renderTestCaseItem(c, level + 1, path, i))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        )}
                        
                        {/* Кейсы на уровне scenario */}
                        {nodeType === 'scenario' && (
                            <Droppable droppableId={JSON.stringify(path)} type="CASE">
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        style={{
                                            minHeight: '10px',
                                            backgroundColor: snapshot.isDraggingOver ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                                            borderRadius: snapshot.isDraggingOver ? '4px' : '0'
                                        }}
                                    >
                                        {(nodeData.cases || []).map((c, i) => renderTestCaseItem(c, level + 1, path, i))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        )}
                        
                        {/* Кейсы на уровне code */}
                        {nodeType === 'code' && (
                            <Droppable droppableId={JSON.stringify(path)} type="CASE">
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        style={{
                                            minHeight: '10px',
                                            backgroundColor: snapshot.isDraggingOver ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                                            borderRadius: snapshot.isDraggingOver ? '4px' : '0'
                                        }}
                                    >
                                        {(nodeData.cases || []).map((c, i) => renderTestCaseItem(c, level + 1, path, i))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        )}
                        
                        {/* Вложенные узлы */}
                        {nodeType === 'feature' && Object.entries(nodeData.stories || {}).map(([storyName, storyData]) =>
                            renderNode(storyData, [path[0], storyName], level + 1)
                        )}
                        {nodeType === 'story' && Object.entries(nodeData.scenarios || {}).map(([scenarioName, scenarioData]) =>
                            renderNode(scenarioData, [...path, scenarioName], level + 1)
                        )}
                        {nodeType === 'scenario' && Object.entries(nodeData.codes || {}).map(([codeName, codeData]) =>
                            renderNode(codeData, [...path, codeName], level + 1)
                        )}
                    </div>
                )}
            </div>
        );
    };
    
    return (
        <div className="test-tree-container">
            {Object.entries(treeData).map(([featureName, featureData]) =>
                renderNode(featureData, [featureName], 0)
            )}
            <div style={{ padding: '8px', borderTop: '1px solid var(--on-border-light, #bdd4ff36)', marginTop: '8px' }}>
                <button
                    onClick={() => onAddNode([], 'feature')}
                    style={{
                        width: '100%',
                        padding: '6px',
                        background: 'none',
                        border: '1px dashed var(--on-border-light, #bdd4ff36)',
                        borderRadius: '4px',
                        color: 'var(--on-text-hint, #d2e4fe80)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-control-flat-medium, rgba(174, 202, 244, 0.05))';
                        e.currentTarget.style.borderColor = 'var(--on-support-aldebaran, #7aa8ff)';
                        e.currentTarget.style.color = 'var(--on-support-aldebaran, #7aa8ff)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.borderColor = 'var(--on-border-light, #bdd4ff36)';
                        e.currentTarget.style.color = 'var(--on-text-hint, #d2e4fe80)';
                    }}
                >
                    + Добавить Feature
                </button>
            </div>
        </div>
    );
};

export default function TestModelReviewModal({
    isOpen,
    onClose,
    initialCases = [],
    onConfirmSend,
    projectId,
    jiraProject,
    jiraPat,
    onCasesCountChange,
}) {
    const [treeData, setTreeData] = useState({});
    const [selectedCase, setSelectedCase] = useState(null);
    
    // Логирование изменений treeData
    useEffect(() => {
        console.log('TestModelReviewModal: treeData state changed:', treeData);
        console.log('TestModelReviewModal: treeData keys:', Object.keys(treeData));
    }, [treeData]);
    const [sharedStepsOptions, setSharedStepsOptions] = useState([]);
    const [isSending, setIsSending] = useState(false);
    const [allureLink, setAllureLink] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const [fixPrompt, setFixPrompt] = useState('');
    const [showFixPanel, setShowFixPanel] = useState(false);
    const [history, setHistory] = useState([]);
    const MAX_HISTORY = 10;
    
    // Состояние для хранения diff'ов изменений: Map<caseId, diffObject>
    // diffObject = { field: { old: value, new: value }, ... }
    const [testCaseDiffs, setTestCaseDiffs] = useState(new Map());
    
    // Состояние для непринятых изменений: Set<caseId>
    const [pendingApprovals, setPendingApprovals] = useState(new Set());

    // Функция для копирования ссылки в буфер обмена
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            alert('Ссылка скопирована в буфер обмена!');
        }).catch(err => {
            console.error('Ошибка при копировании:', err);
            // Fallback для старых браузеров
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                alert('Ссылка скопирована в буфер обмена!');
            } catch (err) {
                console.error('Ошибка при копировании (fallback):', err);
            }
            document.body.removeChild(textArea);
        });
    };

    // Функция для получения ключа localStorage
    const getStorageKey = () => {
        if (!projectId) return null;
        // Создаем хеш от initialCases для уникальности
        // Используем простую хеш-функцию вместо btoa (который не поддерживает Unicode)
        let casesHash = 'default';
        if (initialCases && initialCases.length > 0) {
            try {
                const str = JSON.stringify(initialCases);
                // Простая хеш-функция для строки
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    const char = str.charCodeAt(i);
                    hash = ((hash << 5) - hash) + char;
                    hash = hash & hash; // Convert to 32bit integer
                }
                // Преобразуем в положительное число и берем первые 8 символов
                casesHash = Math.abs(hash).toString(36).substring(0, 8);
            } catch (err) {
                console.warn('TestModelReviewModal: Ошибка при создании хеша:', err);
                casesHash = 'default';
            }
        }
        return `testCasesReview_${projectId}_${casesHash}`;
    };

    // Подсчет количества тест-кейсов из treeData
    const countTestCases = useCallback((tree) => {
        if (!tree || Object.keys(tree).length === 0) return 0;
        let count = 0;
        Object.values(tree).forEach(feature => {
            if (feature.cases && Array.isArray(feature.cases)) {
                count += feature.cases.length;
            }
            if (feature.stories) {
                Object.values(feature.stories).forEach(story => {
                    if (story.cases && Array.isArray(story.cases)) {
                        count += story.cases.length;
                    }
                    if (story.scenarios) {
                        Object.values(story.scenarios).forEach(scenario => {
                            if (scenario.cases && Array.isArray(scenario.cases)) {
                                count += scenario.cases.length;
                            }
                            if (scenario.codes) {
                                Object.values(scenario.codes).forEach(code => {
                                    if (code.cases && Array.isArray(code.cases)) {
                                        count += code.cases.length;
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
        return count;
    }, []);

    // Сохранение состояния в localStorage при изменении treeData и обновление счетчика
    useEffect(() => {
        if (!isOpen || !treeData || Object.keys(treeData).length === 0) return;
        
        const storageKey = getStorageKey();
        if (!storageKey) return;
        
        try {
            const dataToSave = {
                treeData,
                selectedCaseId: selectedCase?.id || null,
                timestamp: Date.now()
            };
            localStorage.setItem(storageKey, JSON.stringify(dataToSave));
            console.log('TestModelReviewModal: Сохранено состояние в localStorage:', storageKey);
            
            // Обновляем счетчик в родительском компоненте
            const count = countTestCases(treeData);
            if (onCasesCountChange) {
                onCasesCountChange(count);
            }
        } catch (err) {
            console.warn('TestModelReviewModal: Ошибка при сохранении в localStorage:', err);
        }
    }, [treeData, selectedCase, isOpen, projectId, initialCases, countTestCases, onCasesCountChange]);

    useEffect(() => {
        if (!isOpen) {
            // При закрытии не очищаем состояние сразу - оно уже сохранено в localStorage
            return;
        }
        
        // Если initialCases пустой массив, очищаем все состояние
        if (initialCases && Array.isArray(initialCases) && initialCases.length === 0) {
            console.log('TestModelReviewModal: initialCases пустой, очищаем состояние');
            const storageKey = getStorageKey();
            if (storageKey) {
                try {
                    localStorage.removeItem(storageKey);
                    console.log('TestModelReviewModal: Состояние очищено из localStorage');
                } catch (err) {
                    console.warn('TestModelReviewModal: Ошибка при очистке localStorage:', err);
                }
            }
            setTreeData({});
            setSelectedCase(null);
            return;
        }
        
        const storageKey = getStorageKey();
        let savedState = null;
        
        // Пытаемся загрузить сохраненное состояние
        if (storageKey) {
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    savedState = JSON.parse(saved);
                    // Проверяем, что сохраненное состояние не слишком старое (например, не старше 7 дней)
                    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней
                    if (savedState.timestamp && (Date.now() - savedState.timestamp) < maxAge) {
                        console.log('TestModelReviewModal: Загружено сохраненное состояние из localStorage');
                    } else {
                        console.log('TestModelReviewModal: Сохраненное состояние устарело, используем initialCases');
                        savedState = null;
                    }
                }
            } catch (err) {
                console.warn('TestModelReviewModal: Ошибка при загрузке из localStorage:', err);
                savedState = null;
            }
        }
        
        // Используем сохраненное состояние или строим из initialCases
        let treeDataToUse;
        let selectedCaseToUse = null;
        
        if (savedState && savedState.treeData && Object.keys(savedState.treeData).length > 0) {
            treeDataToUse = savedState.treeData;
            console.log('TestModelReviewModal: Используем сохраненное treeData');
            
            // Восстанавливаем выбранный кейс
            if (savedState.selectedCaseId) {
                const allCases = flattenTreeToCases(treeDataToUse);
                selectedCaseToUse = allCases.find(c => c.id === savedState.selectedCaseId) || allCases[0] || null;
            } else {
                const allCases = flattenTreeToCases(treeDataToUse);
                selectedCaseToUse = allCases[0] || null;
            }
        } else {
            console.log('TestModelReviewModal: initialCases received:', initialCases);
            console.log('TestModelReviewModal: initialCases length:', initialCases?.length);
            treeDataToUse = buildTreeFromCases(initialCases);
            console.log('TestModelReviewModal: built tree data:', treeDataToUse);
            
            // Автоматически выбираем первый тест-кейс, если есть
            const allCases = flattenTreeToCases(treeDataToUse);
            selectedCaseToUse = allCases[0] || null;
        }
        
        console.log('TestModelReviewModal: setting treeData state...');
        setTreeData(treeDataToUse);
        setSelectedCase(selectedCaseToUse);
        console.log('TestModelReviewModal: treeData state set');
        
        if (projectId) {
            axios
                .get(`${config.serverUrl}/shared-steps`, { params: { projectId } })
                .then((resp) => {
                    // Проверяем, что resp.data - массив
                    if (Array.isArray(resp.data)) {
                        setSharedStepsOptions(resp.data.map((s) => ({ value: s.id, label: s.body })));
                    } else {
                        console.warn('TestModelReviewModal: shared-steps вернул не массив:', resp.data);
                        setSharedStepsOptions([]);
                    }
                })
                .catch(console.warn);
        }
    }, [isOpen, projectId, initialCases]);
    
    // Функция для поиска тест-кейса в дереве по ID
    const findCaseInTree = (tree, caseId) => {
        for (const f in tree) {
            for (const s in tree[f].stories) {
                const storyNode = tree[f].stories[s];
                // Кейсы на уровне story
                const caseInStory = (storyNode.cases || []).find(c => c.id === caseId);
                if (caseInStory) return caseInStory;
                
                // Кейсы в сценариях
                for (const sc in storyNode.scenarios || {}) {
                    const scenarioNode = storyNode.scenarios[sc];
                    const caseInScenario = (scenarioNode.cases || []).find(c => c.id === caseId);
                    if (caseInScenario) return caseInScenario;
                    
                    // Кейсы в code-узлах
                    for (const code in scenarioNode.codes || {}) {
                        const codeNode = scenarioNode.codes[code];
                        const caseInCode = (codeNode.cases || []).find(c => c.id === caseId);
                        if (caseInCode) return caseInCode;
                    }
                }
            }
        }
        return null;
    };
    
    const handleSelectCase = (testCase) => {
        // Обновляем тест-кейс из дерева, чтобы получить актуальные данные
        const updatedCase = findCaseInTree(treeData, testCase.id) || testCase;
        setSelectedCase(updatedCase);
    };
    const handleCloseWithConfirm = useCallback(() => {
        if (isGenerating || isSending) return; // не даём закрыть во время процессов
        
        // Состояние уже сохраняется автоматически при изменении treeData
        // Просто закрываем модалку
        setAllureLink(null); // на всякий случай очищаем состояние успеха
        onClose();
    }, [isGenerating, isSending, onClose]);
    const handleUpdateCase = useCallback((caseId, updatedCase) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            for (const f in newTree)
                for (const s in newTree[f].stories) {
                    const storyNode = newTree[f].stories[s];
                    let idx = (storyNode.cases || []).findIndex((c) => c.id === caseId);
                    if (idx !== -1) {
                        storyNode.cases[idx] = updatedCase;
                        return newTree;
                    }
                    for (const sc in storyNode.scenarios) {
                        // сценарный уровень
                        idx = (storyNode.scenarios[sc].cases || []).findIndex((c) => c.id === caseId);
                        if (idx !== -1) {
                            storyNode.scenarios[sc].cases[idx] = updatedCase;
                            return newTree;
                        }
                        // code-уровень
                        for (const code in (storyNode.scenarios[sc].codes || {})) {
                            idx = (storyNode.scenarios[sc].codes[code].cases || []).findIndex((c) => c.id === caseId);
                            if (idx !== -1) {
                                storyNode.scenarios[sc].codes[code].cases[idx] = updatedCase;
                                return newTree;
                            }
                        }
                    }
                }
            return prevTree;
        });
    }, []);

    const handleGenerateXmind = async () => {
        setIsGenerating(true);

        const STYLE_IDS = {
            e2e: 'b-e2e',
            integration: 'b-int',
            unit: 'b-unit',
        };

        const SHEET_BOUNDARY_STYLES = [
            {
                id: 'b-e2e', class: 'org.xmind.ui.boundary',
                properties: { 'svg:stroke': '#22c55e', 'svg:fill': '#dcfce7' }
            },
            {
                id: 'b-int', class: 'org.xmind.ui.boundary',
                properties: { 'svg:stroke': '#38bdf8', 'svg:fill': '#e0f2fe' }
            },
            {
                id: 'b-unit', class: 'org.xmind.ui.boundary',
                properties: { 'svg:stroke': '#a78bfa', 'svg:fill': '#ede9fe' }
            },
        ];

        const BOUNDARY_STYLE = {
            e2e: { 'svg:fill': '#DCFCE7', 'svg:stroke': '#22C55E' }, // зелёный
            integration: { 'svg:fill': '#E0F2FE', 'svg:stroke': '#38BDF8' }, // голубой
            unit: { 'svg:fill': '#EDE9FE', 'svg:stroke': '#A78BFA' }, // фиолетовый
        };

        const TYPE_MARKERS = {
            feature: "tag-blue",
            story: "tag-orange",
            scenario: "tag-purple",
            code: "tag-yellow",
        };

        const BOUNDARY_STYLES = {
            e2e: { lineColor: "#22c55e", fillColor: "#dcfce7" },          // зелёный
            integration: { lineColor: "#38bdf8", fillColor: "#e0f2fe" },  // голубой
            unit: { lineColor: "#a78bfa", fillColor: "#ede9fe" },         // фиолетовый
        };

        const withTypeMeta = (topic, type) => ({
            ...topic,
            labels: [...(topic.labels || []), type.toUpperCase()],
            markers: [...(topic.markers || []), { markerId: TYPE_MARKERS[type] }],
        });

        const generateIdLocal = () => Math.random().toString(36).substr(2, 9);

        try {
            // 1) Строим иерархию
            const featureTopics = Object.entries(treeData).map(([featureName, featureData]) => {
                const storyTopics = Object.entries(featureData.stories).map(([storyName, storyData]) => {
                    // кейсы прямо под story
                    const directStoryCases = (storyData.cases || []).map((caseItem) => {
                        const markers = [];
                        if ((caseItem.layer || "").toLowerCase().includes("frontend")) markers.push({ markerId: "flag-green" });
                        if ((caseItem.layer || "").toLowerCase().includes("backend")) markers.push({ markerId: "flag-purple" });
                        const layer = caseItem.layer || "";
                        let testType = null;
                        if (layer === "E2E Tests") testType = "e2e";
                        else if (layer.startsWith("Integration")) testType = "integration";
                        else if (layer.startsWith("Unit")) testType = "unit";
                        return {
                            id: caseItem.id || generateIdLocal(),
                            class: "topic",
                            title: caseItem.title,
                            testType,
                            markers: markers.length ? markers : undefined,
                        };
                    });

                    const scenarioTopics = Object.entries(storyData.scenarios || {}).map(([scenarioName, scenarioData]) => {
                        const scenarioChildren = (scenarioData.cases || []).map((caseItem) => {
                            const markers = [];
                            if ((caseItem.layer || "").toLowerCase().includes("frontend")) markers.push({ markerId: "flag-green" });
                            if ((caseItem.layer || "").toLowerCase().includes("backend")) markers.push({ markerId: "flag-purple" });
                            const layer = caseItem.layer || "";
                            let testType = null;
                            if (layer === "E2E Tests") testType = "e2e";
                            else if (layer.startsWith("Integration")) testType = "integration";
                            else if (layer.startsWith("Unit")) testType = "unit";
                            return {
                                id: caseItem.id || generateIdLocal(),
                                class: "topic",
                                title: caseItem.title,
                                testType,
                                markers: markers.length ? markers : undefined,
                            };
                        });

                        // code-узлы (unit)
                        const codeTopics = Object.entries(scenarioData.codes || {}).map(([codeName, codeData]) => {
                            const unitChildren = (codeData.cases || []).map((caseItem) => {
                                const markers = [];
                                if ((caseItem.layer || "").toLowerCase().includes("frontend")) markers.push({ markerId: "flag-green" });
                                if ((caseItem.layer || "").toLowerCase().includes("backend")) markers.push({ markerId: "flag-purple" });
                                return {
                                    id: caseItem.id || generateIdLocal(),
                                    class: "topic",
                                    title: caseItem.title,
                                    testType: "unit",
                                    markers: markers.length ? markers : undefined,
                                };
                            });

                            // ✅ Используем поле type из Code (если есть), иначе определяем по cases
                            const codeType = codeData.type || 'integration';
                            const hasFE = codeType === 'frontend' || (codeData.cases || []).some((c) => (c.layer || "").toLowerCase().includes("frontend"));
                            const hasBE = codeType === 'backend' || (codeData.cases || []).some((c) => (c.layer || "").toLowerCase().includes("backend"));
                            const codeMarkers = [];
                            if (hasFE) codeMarkers.push({ markerId: "flag-green" });
                            if (hasBE) codeMarkers.push({ markerId: "flag-purple" });

                            const unitIdxs = unitChildren.map((_, idx) => idx);
                            const boundaries = unitIdxs.length
                                ? [{
                                    id: generateIdLocal(),
                                    range: `(${unitIdxs[0]},${unitIdxs[unitIdxs.length - 1]})`,
                                    title: "Unit тесты",
                                    styleId: 'b-unit'
                                }]
                                : undefined;

                            const codeTopic = {
                                id: generateIdLocal(),
                                class: "topic",
                                title: codeName,
                                branch: "folded",
                                children: { attached: unitChildren },
                                boundaries,
                                markers: codeMarkers.length ? codeMarkers : undefined,
                            };

                            return withTypeMeta(codeTopic, "code");
                        });

                        const childrenArray = [...scenarioChildren, ...codeTopics];

                        // границы внутри сценария
                        const intIdxs = [];
                        const e2eIdxs = [];
                        childrenArray.forEach((it, idx) => {
                            if (it.testType === "integration") intIdxs.push(idx);
                            if (it.testType === "e2e") e2eIdxs.push(idx);
                        });

                        const boundaries = [];
                        if (intIdxs.length)
                            boundaries.push({
                                id: generateIdLocal(),
                                range: `(${intIdxs[0]},${intIdxs[intIdxs.length - 1]})`,
                                title: "Интеграционные тесты",
                                styleId: 'b-int'
                            });
                        if (e2eIdxs.length)
                            boundaries.push({
                                id: generateIdLocal(),
                                range: `(${e2eIdxs[0]},${e2eIdxs[e2eIdxs.length - 1]})`,
                                title: "E2E тесты",
                                style: BOUNDARY_STYLE.e2e,
                            });

                        const scenarioTopic = {
                            id: generateIdLocal(),
                            class: "topic",
                            title: scenarioName,
                            branch: "folded",
                            markers: [{ markerId: "people-blue" }],
                            children: { attached: childrenArray },
                            boundaries: boundaries.length ? boundaries : undefined,
                        };

                        return withTypeMeta(scenarioTopic, "scenario");
                    });

                    const casesAndScenarios = [...directStoryCases, ...scenarioTopics];

                    // story-level границы
                    const intAll = [];
                    const e2eAll = [];
                    casesAndScenarios.forEach((item, idx) => {
                        if (item.testType === "integration") intAll.push(idx);
                        if (item.testType === "e2e") e2eAll.push(idx);
                    });

                    const storyBoundaries = [];
                    if (intAll.length)
                        storyBoundaries.push({
                            id: generateIdLocal(),
                            range: `(${intAll[0]},${intAll[intAll.length - 1]})`,
                            title: "Интеграционные тесты",
                            styleId: 'b-int'
                        });
                    if (e2eAll.length)
                        storyBoundaries.push({
                            id: generateIdLocal(),
                            range: `(${e2eAll[0]},${e2eAll[e2eAll.length - 1]})`,
                            title: "E2E тесты",
                            style: BOUNDARY_STYLE.e2e,
                        });

                    const storyTopic = {
                        id: generateIdLocal(),
                        class: "topic",
                        title: storyName,
                        branch: "folded",
                        children: { attached: casesAndScenarios },
                        boundaries: storyBoundaries.length ? storyBoundaries : undefined,
                    };

                    return withTypeMeta(storyTopic, "story");
                });

                const featureTopic = {
                    id: generateIdLocal(),
                    class: "topic",
                    title: featureName,
                    branch: "folded",
                    children: { attached: storyTopics },
                };

                return withTypeMeta(featureTopic, "feature");
            });

            // 2) content.json
            const contentJson = [
                {
                    id: generateIdLocal(),
                    class: "sheet",
                    title: "Тест-модель",
                    rootTopic: {
                        id: generateIdLocal(),
                        class: "topic",
                        title: jiraProject,
                        structureClass: "org.xmind.ui.timeline.horizontal",
                        children: { attached: featureTopics },
                    },
                    theme: {
                        map: { id: "423cea10-5cf2-4b9c-a86a-10cba3fa1981", properties: { "svg:fill": "#ffffff" } },
                        centralTopic: { id: "c8f9a13b-cef1-4f3b-96aa-09472b8358f0", properties: { "svg:fill": "#3949AB" } },
                        mainTopic: { id: "50792793-7789-468b-9722-4e2ec235f632", properties: { "svg:fill": "#EEEEEE" } },
                        subTopic: { id: "a36e6db3-7a1f-4996-8f4b-f6bcffceeb5f", properties: { "svg:fill": "#EEEEEE" } },
                    },
                    styles: SHEET_BOUNDARY_STYLES,
                },
            ];

            // 3) metadata.json
            const metadataJson = {
                dataStructureVersion: "2",
                creator: { name: "YourAppName", version: "1.0.0" },
                layoutEngineVersion: "3",
            };

            // 4) manifest.json
            const manifestJson = {
                "file-entries": { "content.json": {}, "metadata.json": {} },
            };

            // 5) упаковка
            const zip = new JSZip();
            zip.file("content.json", JSON.stringify(contentJson, null, 2));
            zip.file("metadata.json", JSON.stringify(metadataJson, null, 2));
            zip.file("manifest.json", JSON.stringify(manifestJson, null, 2));

            const blob = await zip.generateAsync({
                type: "blob",
                mimeType: "application/vnd.xmind.xmind",
            });

            // 6) скачивание
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${jiraProject}-test-model-${Date.now()}.xmind`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            a.remove();
        } catch (err) {
            console.error("Ошибка при генерации XMind файла:", err);
        } finally {
            setIsGenerating(false);
        }
    };


    const handleDeleteCase = useCallback((caseId) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            for (const f in newTree)
                for (const s in newTree[f].stories) {
                    const storyNode = newTree[f].stories[s];
                    storyNode.cases = (storyNode.cases || []).filter((c) => c.id !== caseId);
                    for (const sc in storyNode.scenarios) {
                        storyNode.scenarios[sc].cases = (
                            storyNode.scenarios[sc].cases || []
                        ).filter((c) => c.id !== caseId);
                        for (const code in (storyNode.scenarios[sc].codes || {})) {
                            storyNode.scenarios[sc].codes[code].cases = (
                                storyNode.scenarios[sc].codes[code].cases || []
                            ).filter((c) => c.id !== caseId);
                        }
                    }
                }
            
            // Если удалили выбранный кейс, очищаем выбор или выбираем первый доступный
            setSelectedCase((prevSelected) => {
                if (prevSelected?.id === caseId) {
                    const allCases = flattenTreeToCases(newTree);
                    const remainingCases = allCases.filter(c => c.id !== caseId);
                    return remainingCases.length > 0 ? remainingCases[0] : null;
                }
                return prevSelected;
            });
            
            return newTree;
        });
    }, []);

    const onDragEnd = (result) => {
        const { source, destination, type } = result;
        console.log('[onDragEnd] Событие drag end:', { source, destination, type });
        
        if (!destination) {
            console.log('[onDragEnd] Нет destination, отмена');
            return;
        }
        
        if (type === 'STRUCTURE') {
            setTreeData((prev) => {
                const keys = Object.keys(prev);
                const order = Array.from(keys);
                const [moved] = order.splice(source.index, 1);
                order.splice(destination.index, 0, moved);
                const np = {};
                order.forEach((k) => (np[k] = prev[k]));
                return np;
            });
            return;
        }

        // Если тип не указан или это CASE, обрабатываем как перемещение тест-кейса
        // В react-beautiful-dnd тип может быть undefined, если не указан явно в Draggable
        if (type && type !== 'CASE') {
            console.log('[onDragEnd] Неизвестный тип:', type);
            return;
        }

        let srcPath, dstPath;
        try {
            srcPath = JSON.parse(source.droppableId);      // [f,s], [f,s,sc], [f,s,sc,code]
            dstPath = JSON.parse(destination.droppableId);
        } catch (e) {
            console.error('[onDragEnd] Ошибка парсинга пути:', e);
            return;
        }

        const getCasesArrayByPath = (tree, path, createIfMissing = false) => {
            const [f, s, sc, code] = path;
            if (!tree[f]) {
                throw new Error(`Feature "${f}" не найдена`);
            }
            if (path.length === 2) {
                if (!tree[f].stories[s]) {
                    throw new Error(`Story "${s}" не найдена в feature "${f}"`);
                }
                if (!tree[f].stories[s].cases) {
                    if (createIfMissing) {
                        tree[f].stories[s].cases = [];
                    } else {
                        throw new Error(`Cases не найдены в story "${s}"`);
                    }
                }
                return tree[f].stories[s].cases;
            }
            if (path.length === 3) {
                if (!tree[f].stories[s]?.scenarios[sc]) {
                    throw new Error(`Scenario "${sc}" не найден`);
                }
                if (!tree[f].stories[s].scenarios[sc].cases) {
                    if (createIfMissing) {
                        tree[f].stories[s].scenarios[sc].cases = [];
                    } else {
                        throw new Error(`Cases не найдены в scenario "${sc}"`);
                    }
                }
                return tree[f].stories[s].scenarios[sc].cases;
            }
            if (path.length === 4) {
                if (!tree[f].stories[s]?.scenarios[sc]?.codes[code]) {
                    throw new Error(`Code "${code}" не найден`);
                }
                if (!tree[f].stories[s].scenarios[sc].codes[code].cases) {
                    if (createIfMissing) {
                        tree[f].stories[s].scenarios[sc].codes[code].cases = [];
                    } else {
                        throw new Error(`Cases не найдены в code "${code}"`);
                    }
                }
                return tree[f].stories[s].scenarios[sc].codes[code].cases;
            }
            throw new Error('Unsupported path length: ' + path.length + ', path: ' + JSON.stringify(path));
        };

        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            
            try {
                // Получаем исходный массив
                const srcArr = getCasesArrayByPath(newTree, srcPath, false);
                if (!srcArr || srcArr.length === 0 || source.index >= srcArr.length) {
                    console.error('[onDragEnd] Индекс вне границ или массив пуст:', source.index, srcArr?.length);
                    return prevTree;
                }
                
                // Удаляем элемент из исходного массива
                const [moved] = srcArr.splice(source.index, 1);
                if (!moved) {
                    console.error('[onDragEnd] Не удалось извлечь элемент по индексу:', source.index);
                    return prevTree;
                }

                // Обновляем поля в перемещённом тест-кейсе
                moved.feature = dstPath[0];
                moved.story = dstPath[1];
                moved.scenario = dstPath[2] || '';
                moved.code = dstPath[3] || '';

                // Получаем целевой массив (создаём если нужно)
                const dstArr = getCasesArrayByPath(newTree, dstPath, true);
                
                // Вставляем элемент в целевой массив
                const insertIndex = Math.min(destination.index, dstArr.length);
                dstArr.splice(insertIndex, 0, moved);
                
                console.log('[onDragEnd] Перемещён тест-кейс:', moved.id, 'из', srcPath, 'в', dstPath);
                return newTree;
            } catch (error) {
                console.error('[onDragEnd] Ошибка при перемещении:', error.message, { srcPath, dstPath });
                return prevTree;
            }
        });
    };

    const handleAdd = (path, type) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s, sc, code] = path;
            if (type === 'case') {
                const nc = createNewTestCase(f, s, path[2] || '', path[3] || '');
                if (path.length === 4) {
                    newTree[f].stories[s].scenarios[sc].codes[code].cases.push(nc);
                } else if (path.length === 3) {
                    newTree[f].stories[s].scenarios[sc].cases.push(nc);
                } else {
                    newTree[f].stories[s].cases.push(nc);
                }
            } else {
                const name = prompt(`Введите название (${type}):`);
                if (!name) return prevTree;
                if (type === 'feature' && !newTree[name]) newTree[name] = { stories: {}, isExpanded: true };
                if (type === 'story' && !newTree[f].stories[name])
                    newTree[f].stories[name] = { scenarios: {}, cases: [], isExpanded: true };
                if (type === 'scenario' && !newTree[f].stories[s].scenarios[name])
                    newTree[f].stories[s].scenarios[name] = { codes: {}, cases: [], isExpanded: true };
                if (type === 'code' && !newTree[f].stories[s].scenarios[sc].codes[name])
                    newTree[f].stories[s].scenarios[sc].codes[name] = { cases: [], isExpanded: true };
            }
            return newTree;
        });
    };
    
    const handleRenameNode = (path, newName) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s, sc, code] = path;
            if (path.length === 1) {
                // Переименование feature
                if (newTree[f] && newName !== f) {
                    newTree[newName] = newTree[f];
                    delete newTree[f];
                    // Обновляем feature во всех кейсах внутри этой фичи
                    Object.values(newTree[newName].stories || {}).forEach(storyData => {
                        // Кейсы на уровне story
                        Object.values(storyData.cases || []).forEach(c => {
                            c.feature = newName;
                        });
                        // Кейсы в scenarios
                        Object.values(storyData.scenarios || {}).forEach(scData => {
                            Object.values(scData.cases || []).forEach(c => {
                                c.feature = newName;
                            });
                            // Кейсы в codes
                            Object.values(scData.codes || {}).forEach(codeData => {
                                Object.values(codeData.cases || []).forEach(c => {
                                    c.feature = newName;
                                });
                            });
                        });
                    });
                }
            } else if (path.length === 2) {
                // Переименование story
                if (newTree[f]?.stories[s] && newName !== s) {
                    newTree[f].stories[newName] = newTree[f].stories[s];
                    delete newTree[f].stories[s];
                    // Обновляем feature и story в кейсах
                    Object.values(newTree[f].stories[newName].cases || []).forEach(c => {
                        c.feature = f;
                        c.story = newName;
                    });
                    Object.values(newTree[f].stories[newName].scenarios || {}).forEach(scData => {
                        Object.values(scData.cases || []).forEach(c => {
                            c.feature = f;
                            c.story = newName;
                        });
                        Object.values(scData.codes || {}).forEach(codeData => {
                            Object.values(codeData.cases || []).forEach(c => {
                                c.feature = f;
                                c.story = newName;
                            });
                        });
                    });
                }
            } else if (path.length === 3) {
                // Переименование scenario
                if (newTree[f]?.stories[s]?.scenarios[sc] && newName !== sc) {
                    newTree[f].stories[s].scenarios[newName] = newTree[f].stories[s].scenarios[sc];
                    delete newTree[f].stories[s].scenarios[sc];
                    // Обновляем scenario в кейсах
                    Object.values(newTree[f].stories[s].scenarios[newName].cases || []).forEach(c => {
                        c.scenario = newName;
                    });
                    Object.values(newTree[f].stories[s].scenarios[newName].codes || {}).forEach(codeData => {
                        Object.values(codeData.cases || []).forEach(c => {
                            c.scenario = newName;
                        });
                    });
                }
            } else if (path.length === 4) {
                // Переименование code
                if (newTree[f]?.stories[s]?.scenarios[sc]?.codes[code] && newName !== code) {
                    newTree[f].stories[s].scenarios[sc].codes[newName] = newTree[f].stories[s].scenarios[sc].codes[code];
                    delete newTree[f].stories[s].scenarios[sc].codes[code];
                    // Обновляем code в кейсах
                    Object.values(newTree[f].stories[s].scenarios[sc].codes[newName].cases || []).forEach(c => {
                        c.code = newName;
                    });
                }
            }
            return newTree;
        });
    };

    const handleToggleExpand = (path) => {
        setTreeData((prevTree) => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const [f, s, sc, code] = path;
            let node = newTree[f];
            if (s && !sc) node = node.stories[s];
            if (sc && !code) node = node.stories[s].scenarios[sc];
            if (code) node = node.stories[s].scenarios[sc].codes[code];
            node.isExpanded = !node.isExpanded;
            return newTree;
        });
    };

    // Удаление фичи/истории/сценария/кода по пути и типу
    const handleDeleteNode = useCallback((path, type) => {
        setTreeData(prev => {
            const newTree = JSON.parse(JSON.stringify(prev));
            const [f, s, sc, code] = path;
            if (type === 'feature') {
                delete newTree[f];
            } else if (type === 'story') {
                delete newTree[f].stories[s];
            } else if (type === 'scenario') {
                delete newTree[f].stories[s].scenarios[sc];
            } else if (type === 'code') {
                delete newTree[f].stories[s].scenarios[sc].codes[code];
            }
            return newTree;
        });
    }, []);


    // Функция для вычисления diff между старыми и новыми тест-кейсами
    const calculateDiff = (oldCase, newCase) => {
        const diff = {};
        const fieldsToCompare = [
            'title', 'precondition', 'steps', 'expected', 'layer', 
            'scenario', 'code', 'feature', 'story', 'tags', 'priority', 'version'
        ];
        
        fieldsToCompare.forEach(field => {
            const oldValue = oldCase[field];
            const newValue = newCase[field];
            
            // Нормализация для сравнения
            const normalize = (val) => {
                if (val === null || val === undefined) return '';
                if (Array.isArray(val)) return JSON.stringify(val);
                return String(val).trim();
            };
            
            const oldNormalized = normalize(oldValue);
            const newNormalized = normalize(newValue);
            
            if (oldNormalized !== newNormalized) {
                diff[field] = {
                    old: oldValue,
                    new: newValue
                };
            }
        });
        
        return Object.keys(diff).length > 0 ? diff : null;
    };

    const handleFixTestCases = async () => {
        if (!fixPrompt.trim()) {
            alert('Введите описание доработок');
            return;
        }

        setIsFixing(true);
        try {
            const rawCases = flattenTreeToCases(treeData);
            
            // Создаём Map для быстрого доступа к старым ТК по ID
            const oldCasesMap = new Map(rawCases.map(c => [c.id, { ...c }]));
            
            const snapshot = {
                id: `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                timestamp: new Date().toISOString(),
                prompt: fixPrompt.trim(),
                cases: rawCases
            };

            const resp = await axios.post(
                `${config.serverUrl}/fix-test-cases`,
                { 
                    testCases: rawCases,
                    fixPrompt: fixPrompt.trim(),
                    projectId 
                },
                { headers: { 'Content-Type': 'application/json' } }
            );

            if (resp.data && resp.data.fixedTestCases && Array.isArray(resp.data.fixedTestCases)) {
                // Вычисляем diff'ы для всех изменённых ТК
                const newDiffsMap = new Map();
                const newPendingApprovals = new Set();
                
                resp.data.fixedTestCases.forEach(newCase => {
                    const oldCase = oldCasesMap.get(newCase.id);
                    if (oldCase) {
                        const diff = calculateDiff(oldCase, newCase);
                        if (diff) {
                            newDiffsMap.set(newCase.id, diff);
                            newPendingApprovals.add(newCase.id);
                        }
                    }
                });
                
                // Обновляем состояния diff'ов и непринятых изменений
                setTestCaseDiffs(newDiffsMap);
                setPendingApprovals(newPendingApprovals);
                
                setHistory(prev => {
                    const next = [...prev, snapshot];
                    return next.slice(-MAX_HISTORY);
                });
                
                // Обновляем treeData с исправленными ТК
                const newTreeData = buildTreeFromCases(resp.data.fixedTestCases);
                setTreeData(newTreeData);
                
                // Обновляем выбранный кейс если он был изменен
                if (selectedCase) {
                    const updatedCase = resp.data.fixedTestCases.find(c => c.id === selectedCase.id);
                    if (updatedCase) {
                        setSelectedCase(updatedCase);
                    }
                }
                
                // Очищаем промпт и закрываем панель
                setFixPrompt('');
                setShowFixPanel(false);
                
                const changedCount = newDiffsMap.size;
                if (changedCount > 0) {
                    alert(`✅ Исправлено ${changedCount} тест-кейсов. Проверьте изменения и подтвердите их.`);
                } else {
                    alert(`✅ Обработано ${resp.data.fixedTestCases.length} тест-кейсов. Изменений не обнаружено.`);
                }
            } else {
                throw new Error('Сервер вернул некорректный ответ');
            }
        } catch (err) {
            console.error('Ошибка при правке тест-кейсов:', err);
            alert('Ошибка при правке: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsFixing(false);
        }
    };

    const handleUndoLastFix = () => {
        if (history.length === 0) {
            alert('Нет сохраненных версий для отката');
            return;
        }
        if (isFixing || isSending) {
            alert('Дождитесь завершения текущей операции');
            return;
        }

        const lastSnapshot = history[history.length - 1];
        if (!lastSnapshot?.cases) {
            console.warn('[handleUndoLastFix] Snapshot без cases');
            setHistory(prev => prev.slice(0, -1));
            return;
        }

        if (!window.confirm('Откатить тест-кейсы к предыдущей сохраненной версии?')) {
            return;
        }

        const restoredTree = buildTreeFromCases(lastSnapshot.cases);
        setTreeData(restoredTree);
        setSelectedCase(null);
        setHistory(prev => prev.slice(0, -1));
        
        // Очищаем diff'ы и непринятые изменения при откате
        setTestCaseDiffs(new Map());
        setPendingApprovals(new Set());
        
        alert(`✅ Откат выполнен. Версия от ${new Date(lastSnapshot.timestamp).toLocaleString()} восстановлена.`);
    };
    
    // Функция для принятия изменений для одного ТК
    const handleApproveCase = (caseId) => {
        setPendingApprovals(prev => {
            const newSet = new Set(prev);
            newSet.delete(caseId);
            return newSet;
        });
        
        // Не удаляем diff, чтобы можно было посмотреть историю изменений
        // Можно оставить или удалить в зависимости от требований
    };
    
    // Функция для отклонения изменений для одного ТК (откатить к старому значению)
    const handleRejectCase = (caseId) => {
        if (!window.confirm('Отклонить изменения и вернуть предыдущее значение?')) {
            return;
        }
        
        const diff = testCaseDiffs.get(caseId);
        if (!diff || history.length === 0) {
            alert('Нет данных для отката');
            return;
        }
        
        // Находим старую версию ТК из истории
        const lastSnapshot = history[history.length - 1];
        const oldCase = lastSnapshot.cases.find(c => c.id === caseId);
        if (!oldCase) {
            alert('Не найдена старая версия тест-кейса');
            return;
        }
        
        // Восстанавливаем старую версию в treeData
        setTreeData(prevTree => {
            const newTree = JSON.parse(JSON.stringify(prevTree));
            const allCases = flattenTreeToCases(newTree);
            const caseIndex = allCases.findIndex(c => c.id === caseId);
            if (caseIndex !== -1) {
                allCases[caseIndex] = { ...oldCase };
                const restoredTree = buildTreeFromCases(allCases);
                
                // Обновляем selectedCase если он был изменён
                if (selectedCase?.id === caseId) {
                    setSelectedCase(oldCase);
                }
                
                return restoredTree;
            }
            return prevTree;
        });
        
        // Удаляем diff и убираем из непринятых
        setTestCaseDiffs(prev => {
            const newMap = new Map(prev);
            newMap.delete(caseId);
            return newMap;
        });
        setPendingApprovals(prev => {
            const newSet = new Set(prev);
            newSet.delete(caseId);
            return newSet;
        });
        
        alert('✅ Изменения отклонены, предыдущая версия восстановлена.');
    };
    
    // Функция для принятия всех изменений
    const handleApproveAll = () => {
        if (pendingApprovals.size === 0) {
            alert('Нет непринятых изменений');
            return;
        }
        
        const count = pendingApprovals.size;
        if (!window.confirm(`Принять все изменения для ${count} тест-кейсов?`)) {
            return;
        }
        
        setPendingApprovals(new Set());
        alert(`✅ Все изменения приняты для ${count} тест-кейсов.`);
    };

    // Функция для сохранения тест-кейсов как идеальных примеров
    const handleSavePerfectExamples = async () => {
        const rawCases = flattenTreeToCases(treeData);
        
        if (rawCases.length === 0) {
            alert('Нет тест-кейсов для сохранения');
            return;
        }

        if (!window.confirm(`Хотите добавить ${rawCases.length} тест-кейс(ов) в идеальный пример?\n\nДанное действие улучшит следующую генерацию тест-кейсов.`)) {
            return;
        }

        try {
            const resp = await axios.post(
                `${config.serverUrl}/perfect-examples`,
                {
                    testCases: rawCases,
                    projectId: projectId
                },
                { headers: { 'Content-Type': 'application/json' } }
            );

            if (resp.data && resp.data.success) {
                alert(`✅ Сохранено ${resp.data.saved} идеальных примеров для улучшения генерации!`);
            } else {
                throw new Error('Сервер вернул некорректный ответ');
            }
        } catch (err) {
            console.error('Ошибка при сохранении идеальных примеров:', err);
            alert('Ошибка при сохранении: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleConfirm = async () => {
        const rawCases = flattenTreeToCases(treeData);
        const cases = rawCases.map(c => ({
            feature: c.feature,
            story: c.story,
            scenario: c.scenario || undefined,
            codeNode: c.code || undefined,              // <— не «code», чтобы не конфликтовало
            title: (c.title || '').trim(),
            precondition: (c.precondition || '').trim(),
            steps: (c.steps || []).map(s => typeof s === 'string' ? s : { sharedStepId: s.sharedStepId }),
            expected: (c.expected || '').trim(),
            tags: (c.tags || []).filter(Boolean),
            layer: c.layer,
            priority: c.priority || 'Medium',
            version: c.version || 'stable',
            links: (c.links || []).filter(l => l?.text || l?.url),
            jiraIssue: c.jiraIssueOption?.value || c.jiraIssue || undefined,
            // Параметры и примеры для параметризации
            parameters: (c.parameters || []).map(p => ({
                name: (p.name || '').trim(),
                values: (p.values || []).filter(v => v && v.trim()).map(v => v.trim())
            })).filter(p => p.name && p.values.length > 0),
            examples: (c.examples || []).map(ex => ({
                parameters: (ex.parameters || []).map(ep => ({
                    name: (ep.name || '').trim(),
                    value: (ep.value || '').trim()
                })).filter(ep => ep.name && ep.value)
            })).filter(ex => ex.parameters.length > 0),
            // Если хочешь передавать уже в формате кастомок:
            customFields: [
                { name: 'Scenario', value: c.scenario || '' },
                { name: 'Code', value: c.code || '' },
                { name: 'Version', value: c.version || 'stable' },
                { name: 'Priority', value: c.priority || 'Medium' },
            ]
        }));
        setIsSending(true);

        try {
            console.log('TestModelReviewModal: отправляем в create-test-cases:', { projectId, casesCount: cases.length });
            const resp = await axios.post(
                `${config.serverUrl}/create-test-cases`,
                { projectId, cases },
                { headers: { 'Content-Type': 'application/json' } }
            );

            // resp.data.created = [{ id: 123501 }, { id: 123502 }, ...]
            const firstCreated = resp.data.created?.[0]?.id;
            if (!firstCreated) {
                throw new Error('Сервер вернул пустой список созданных кейсов');
            }

            // Собираем ссылку на Allure
            const link = `${config.url}/project/${projectId}/test-cases/${firstCreated}`;
            setAllureLink(link);
        } catch (err) {
            console.error(err);
            alert('Ошибка при отправке: ' + err.message);
        } finally {
            setIsSending(false);
        }
    };



    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={handleCloseWithConfirm}
            overlayClassName="modal-overlay"
            className="modal-content"
            appElement={typeof window !== 'undefined' ? document.getElementById('root') : undefined}
        >
            <style>{`
      .modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:1000;}
      .modal-content{background:var(--bg-base-primary, #1b2129);color:var(--on-text-primary, #f6fafef5);border-radius:8px;width:98%;max-width:1800px;height:95vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--on-border-light, #bdd4ff36);}
      .modal-layout{display:flex;flex:1;overflow:hidden;min-height:0;}
      .modal-left-panel{width:100%;min-width:320px;border-right:1px solid var(--on-border-light, #bdd4ff36);display:flex;flex-direction:column;background:var(--bg-base-theme-1, #242a34);overflow:hidden;position:relative;box-sizing:border-box;height:100%;}
      .modal-right-panel{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg-base-primary, #1b2129);min-width:0;position:relative;}
      .resizer{width:4px;background:var(--on-border-light, #bdd4ff36);cursor:col-resize;position:absolute;right:0;top:0;bottom:0;z-index:10;transition:background 0.2s;}
      .resizer:hover{background:var(--on-border-primary, #58a6ff);}
      .resizer:active{background:var(--on-border-primary, #58a6ff);}
      .modal-left-header{padding:14px 16px;border-bottom:1px solid var(--on-border-light, #bdd4ff36);font-weight:600;font-size:13px;color:var(--on-text-primary, #f6fafef5);background:var(--bg-base-primary, #1b2129);flex-shrink:0;}
      .modal-left-content{flex:1;overflow-y:auto;overflow-x:hidden;padding:0;position:relative;min-height:0;max-height:100%;}
      .modal-right-content{flex:1;overflow-y:auto;overflow-x:hidden;padding:20px 32px;max-width:1400px;margin:0 auto;width:100%;box-sizing:border-box;}
      .test-tree-container{width:100%;padding:0 8px;position:relative;}
      .test-tree-row{position:relative;width:100%;min-height:32px;display:flex;align-items:center;box-sizing:border-box;}
      .test-tree-row:hover{background:var(--bg-control-flat-medium, rgba(174, 202, 244, 0.05));}
      .test-tree-row.selected{background:var(--bg-alpha-aldebaran, rgba(44, 109, 232, 0.12));}
      .test-tree-node-icon{margin-right:8px;display:flex;align-items:center;flex-shrink:0;color:var(--on-icon-secondary, #e2effda6);}
      .test-tree-node-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:var(--on-text-primary, #f6fafef5);cursor:pointer;}
      .test-tree-node-controls{display:flex;gap:4px;align-items:center;flex-shrink:0;opacity:0;transition:opacity 0.15s;}
      .test-tree-row:hover .test-tree-node-controls{opacity:1;}
      .case-card{background:var(--bg-base-secondary, #2c343f);border:1px solid var(--on-border-light, #bdd4ff36);border-radius:8px;margin-bottom:0;box-sizing:border-box;}
      .case-card-header{padding:16px 20px;border-bottom:1px solid var(--on-border-light, #bdd4ff36);display:flex;align-items:center;gap:12px;background:var(--bg-base-primary, #1b2129);border-radius:8px 8px 0 0;flex-shrink:0;}
      .case-card-details{padding:20px;background:var(--bg-base-secondary, #2c343f);border-radius:0 0 8px 8px;box-sizing:border-box;}
      .case-field{margin-bottom:20px;box-sizing:border-box;}
      .case-field label{display:block;margin-bottom:8px;font-size:13px;font-weight:500;color:var(--on-text-primary, #f6fafef5);}
      .case-field input,.case-field textarea,.case-field select{width:-webkit-fill-available;padding:8px 12px;background:var(--bg-base-primary, #1b2129);border:1px solid var(--on-border-light, #bdd4ff36);border-radius:6px;color:var(--on-text-primary, #f6fafef5);font-size:13px;font-family:inherit;transition:border-color 0.2s;box-sizing:border-box;}
      .case-field input:focus,.case-field textarea:focus,.case-field select:focus{outline:none;border-color:var(--on-support-aldebaran, #7aa8ff);}
      .case-field textarea{min-height:80px;resize:vertical;box-sizing:border-box;}
      .add-item-btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.15s;font-weight:500;}
      .add-item-btn:hover{background:#30363d;border-color:#58a6ff;color:#58a6ff;}
      .remove-item-btn{background:none;border:none;color:#f85149;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:14px;transition:background-color 0.15s;}
      .remove-item-btn:hover{background:rgba(248,81,73,0.2);}
      .delete-btn{background:none;border:none;color:#f85149;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:18px;transition:background-color 0.15s;line-height:1;}
      .delete-btn:hover{background:rgba(248,81,73,0.2);}
      .modal-header{padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #30363d;}
      .modal-header h2{margin:0;font-size:1.25rem;}
      .close-btn{background:none;border:none;color:#8b949e;font-size:24px;cursor:pointer;}
      .modal-body{flex:1 1 auto;overflow-y:auto;padding:16px 24px;}
      .modal-footer{padding:12px 24px;display:flex;justify-content:flex-end;gap:12px;border-top:1px solid #30363d;}
      .button-primary{background:#238636;color:#fff;border:1px solid #2ea043;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:500;}
      .button-secondary{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:500;}
      .tree-node{margin-bottom:4px;}
      .node-header{display:flex;align-items:center;padding:4px 8px;border-radius:6px;cursor:pointer;transition:background-color .2s;}
      .node-header:hover{background:rgba(139,148,158,0.1);}
      .node-icon{margin-right:8px;color:#8b949e;display:flex;align-items:center;}
      .node-title{flex:1;}
      .feature-title{font-size:1.1rem;font-weight:bold;color:#58a6ff;}
      .pl-4{padding-left:1rem;}
      .node-children{padding-top:4px;padding-left:16px;border-left:1px solid #30363d;min-height:10px;}
      .node-children.is-over{background:rgba(88,166,255,0.1);border-left-color:#58a6ff;}
      .add-buttons{padding-left:24px;padding-top:8px;}
      .add-node-btn{background:none;border:1px dashed #30363d;color:#8b949e;padding:4px 10px;border-radius:6px;font-size:.8rem;cursor:pointer;margin-right:8px;}
      .add-node-btn:hover{background:#30363d;color:#c9d1d9;}
      .case-card{background:#21262d;border:1px solid #30363d;border-radius:6px;margin:8px 0;}
      .case-card.is-dragging{box-shadow:0 0 15px rgba(88,166,255,0.5);border-color:#58a6ff;}
      .case-card-header{display:flex;align-items:center;padding:10px 12px;}
      .drag-handle{cursor:grab;margin-right:8px;}
      .case-card-header .node-title{cursor:pointer;flex:1;}
      .delete-btn{background:none;border:none;color:#f85149;font-size:20px;cursor:pointer;line-height:1;opacity:.6;}
      .delete-btn:hover{opacity:1;}
      .case-card-details{padding:12px;border-top:1px solid #30363d;margin-top:8px;}
      .case-field{margin-bottom:14px;}
      .case-field label{display:block;margin-bottom:6px;font-size:.85rem;color:#8b949e;}
      .case-field input,.case-field textarea,.case-field select{width:-webkit-fill-available;background:#161b22;border:1px solid #30363d;border-radius:4px;padding:8px 10px;color:#c9d1d9;box-sizing:border-box;}
      .case-field input:focus,.case-field textarea:focus,.case-field select:focus{outline:none;border-color:#58a6ff;}
      .field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;}
      .array-item{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;}
      .array-item>*{flex:1;}
      .link-item input{width:50%;}
      .remove-item-btn{background:#373e47;border:1px solid #484f58;color:#c9d1d9;border-radius:4px;width:38px;height:38px;font-size:1.2rem;cursor:pointer;flex:0 0 auto;}
      .remove-item-btn:hover{background:#f85149;border-color:#f85149;color:#fff;}
      .add-item-btn{background:none;border:1px solid #30363d;color:#8b949e;padding:6px 10px;border-radius:4px;font-size:.85rem;cursor:pointer;margin-top:4px;}
      .add-item-btn:hover{background:#30363d;color:#c9d1d9;}
       .loader-overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(13, 17, 23, 0.8);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
      }
      .spinner {
        width: 50px;
        height: 50px;
        border: 4px solid #30363d;
        border-top-color: #58a6ff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 20px;
      }
      .loader-text {
        font-size: 1.1rem;
        font-weight: 500;
        color: #c9d1d9;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
       .success-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
      }
      .success-body p {
        font-size: 1.25rem;
        margin-bottom: 16px;
        color: #c9d1d9;
      }
      .success-body a {
        font-size: 1.15rem;
        color: #58a6ff;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: border-color .2s;
      }
      .success-body a:hover {
        border-color: #58a6ff;
      }
        /* Стили для shared-step-item */
.array-item.shared-step-item {
  background: #1f242b;           /* чуть более светлый фон, чем у контейнера */
  border: 1px dashed #484f58;    /* пунктирная граница */
  border-radius: 4px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.array-item.shared-step-item .shared-step-label {
  flex: 1;
  font-style: italic;
  color: #8b949e;
}

/* Убираем кнопку перетаскивания у общих шагов */
.array-item.shared-step-item .drag-handle {
  visibility: hidden;
}

/* Скрываем textarea и заменяем её на просто лейбл */
.array-item.shared-step-item textarea {
  display: none;
}

/* Чуть сильнее смещаем code-узел вправо, чтобы визуально отличался от сценария */
.code-node{ margin-left: 12px; }

/* Цвет заголовка code-узла (у тебя уже был, на всякий случай оставляю) */
.code-node .node-title{ color:#d29922; }

/* Бейджи FE/BE (если ещё не добавлял из прошлой правки) */
.node-badges{ display:flex; gap:6px; margin-left:8px; }
.badge{ font-size:10px; padding:2px 6px; border-radius:999px; line-height:1; border:1px solid transparent; }
.badge-fe{ background:#3fb950; color:#0b1117; border-color:#2ea043; }
.badge-be{ background:#a371f7; color:#0b1117; border-color:#8957e5; }
/* Чтобы хедер кода не перекрывался ничем и клик не «залипал» */
.code-header { position: relative; z-index: 2; }
.scenario-node > .node-header { position: relative; z-index: 1; }

/* Чуть правее code-узел, чтобы визуально отличался */
.code-node { margin-left: 12px; }
    `}</style>

            {/* Loader поверх всего */}
            {(isSending || isGenerating || isFixing) && (
                <div className="loader-overlay">
                    <div className="spinner" />
                    <div className="loader-text">
                        {isGenerating
                            ? 'Генерация XMind…'
                            : isFixing
                            ? 'Применение правок к тест-кейсам…'
                            : 'Отправка тест-кейсов в Allure…'}
                    </div>
                </div>
            )}

            {allureLink ? (
                // --- экран успешной загрузки ---
                <>
                    <div className="modal-header">
                        <h2>Allure успешно загрузил тест-кейсы!</h2>
                        <button className="close-btn" onClick={() => {
                            setAllureLink(null);
                            handleCloseWithConfirm();
                        }}>×</button>
                    </div>
                    
                    <div className="modal-body">
                        <div className="case-field">
                            <label>Ссылка:</label>
                            <div style={{
                                display: 'flex',
                                gap: '8px',
                                alignItems: 'center',
                                width: '100%'
                            }}>
                                <input
                                    type="text"
                                    value={allureLink}
                                    readOnly
                                    onClick={(e) => e.target.select()}
                                    style={{
                                        flex: 1,
                                        fontFamily: 'monospace',
                                        cursor: 'text',
                                        minWidth: 0
                                    }}
                                />
                                <button
                                    onClick={() => copyToClipboard(allureLink)}
                                    className="button-primary"
                                    style={{
                                        whiteSpace: 'nowrap',
                                        minWidth: '120px',
                                        flexShrink: 0
                                    }}
                                >
                                    Копировать
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <footer className="modal-footer">
                        <a
                            href={allureLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="button-secondary"
                            style={{
                                textDecoration: 'none',
                                display: 'inline-block',
                                minWidth: '160px',
                                textAlign: 'center'
                            }}
                        >
                            Открыть в Allure
                        </a>
                        <button
                            className="button-secondary"
                            onClick={() => {
                                setAllureLink(null);
                                handleCloseWithConfirm();
                            }}
                            style={{
                                minWidth: '160px'
                            }}
                        >
                            Закрыть
                        </button>
                    </footer>
                </>
            ) : (
                // --- экран ревью/редактирования ---
                <>
                    <div className="modal-header">
                        <h2>Ревью и редактирование тест-кейсов</h2>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <button
                                className="button-secondary"
                                onClick={() => setShowFixPanel(!showFixPanel)}
                                disabled={isFixing || isSending}
                                style={{
                                    fontSize: '13px',
                                    padding: '6px 12px',
                                    minWidth: 'auto'
                                }}
                            >
                                {showFixPanel ? '✕ Скрыть' : '🔄 Быстрая правка'}
                            </button>
                            <button className="close-btn" onClick={handleCloseWithConfirm} disabled={isSending || isFixing}>×</button>
                        </div>
                    </div>
                    
                    {/* Панель быстрой правки */}
                    {showFixPanel && (
                        <div style={{
                            padding: '16px 24px',
                            borderBottom: '1px solid var(--on-border-light, #bdd4ff36)',
                            background: 'var(--bg-base-secondary, #2c343f)'
                        }}>
                            <div style={{ marginBottom: '12px' }}>
                                <label style={{
                                    display: 'block',
                                    marginBottom: '8px',
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    color: 'var(--on-text-primary, #f6fafef5)'
                                }}>
                                    Описание доработок для тест-кейсов:
                                </label>
                                <textarea
                                    value={fixPrompt}
                                    onChange={(e) => setFixPrompt(e.target.value)}
                                    placeholder="Например: 'Поправь слои для E2E тестов чтобы не было в сценариях а были в сторис только' или 'Неверные параметры в тесте &quot;Создание документа&quot; - должны быть указаны то-то и то-то'"
                                    disabled={isFixing}
                                    style={{
                                        width: '100%',
                                        minHeight: '80px',
                                        padding: '10px 12px',
                                        backgroundColor: 'var(--bg-base-primary, #1b2129)',
                                        border: '1px solid var(--on-border-light, #bdd4ff36)',
                                        borderRadius: '6px',
                                        color: 'var(--on-text-primary, #f6fafef5)',
                                        fontSize: '13px',
                                        fontFamily: 'inherit',
                                        resize: 'vertical',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                <button
                                    className="button-secondary"
                                    onClick={() => {
                                        setFixPrompt('');
                                        setShowFixPanel(false);
                                    }}
                                    disabled={isFixing}
                                    style={{ fontSize: '13px', padding: '8px 16px' }}
                                >
                                    Отмена
                                </button>
                                <button
                                    className="button-primary"
                                    onClick={handleFixTestCases}
                                    disabled={isFixing || !fixPrompt.trim()}
                                    style={{ fontSize: '13px', padding: '8px 16px' }}
                                >
                                    {isFixing ? 'Применяю правки...' : 'Применить правки'}
                                </button>
                            </div>
                            {isFixing && (
                                <div style={{
                                    marginTop: '12px',
                                    padding: '8px 12px',
                                    background: 'rgba(88, 166, 255, 0.1)',
                                    border: '1px solid rgba(88, 166, 255, 0.3)',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    color: 'var(--on-text-primary, #f6fafef5)'
                                }}>
                                    ⏳ Модель анализирует тест-кейсы и применяет правки...
                                </div>
                            )}
                        </div>
                    )}

                    {history.length > 0 && (
                        <div style={{
                            padding: '12px 24px',
                            borderBottom: '1px solid var(--on-border-light, #bdd4ff36)',
                            background: 'var(--bg-base-primary, #1f252f)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px'
                        }}>
                            <div style={{ fontSize: '12px', color: '#9fb3d1', display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight: 600, color: '#c9d1d9' }}>Сохранено версий: {history.length}</span>
                                <span>Последняя: {new Date(history[history.length - 1].timestamp).toLocaleString()}</span>
                                {history[history.length - 1].prompt && (
                                    <span style={{ opacity: 0.8 }}>Промпт: {history[history.length - 1].prompt}</span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {pendingApprovals.size > 0 && (
                                    <button
                                        className="button-primary"
                                        onClick={handleApproveAll}
                                        disabled={isFixing || isSending}
                                        style={{ 
                                            minWidth: '180px',
                                            backgroundColor: '#28a745',
                                            borderColor: '#28a745'
                                        }}
                                    >
                                        ✓ Принять все ({pendingApprovals.size})
                                    </button>
                                )}
                                <button
                                    className="button-secondary"
                                    onClick={handleUndoLastFix}
                                    disabled={isFixing || isSending}
                                    style={{ minWidth: '200px' }}
                                >
                                    ↩️ Откатить последнюю правку
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {pendingApprovals.size > 0 && !history.length && (
                        <div style={{
                            padding: '12px 24px',
                            borderBottom: '1px solid var(--on-border-light, #bdd4ff36)',
                            background: 'rgba(255, 193, 7, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px'
                        }}>
                            <div style={{ fontSize: '12px', color: '#ffc107' }}>
                                <span style={{ fontWeight: 600 }}>⚠️ Непринятые изменения: {pendingApprovals.size} тест-кейс(ов)</span>
                            </div>
                            <button
                                className="button-primary"
                                onClick={handleApproveAll}
                                disabled={isFixing || isSending}
                                style={{ 
                                    minWidth: '180px',
                                    backgroundColor: '#28a745',
                                    borderColor: '#28a745'
                                }}
                            >
                                ✓ Принять все ({pendingApprovals.size})
                            </button>
                        </div>
                    )}

                    <div className="modal-layout">
                        {/* Левая панель - упрощенное дерево структуры */}
                        <ResizablePanel
                            initialWidth={380}
                            minWidth={320}
                            maxWidth={500}
                            side="left"
                        >
                            <div className="modal-left-panel">
                                <div className="modal-left-header">
                                    Структура тестов
                                </div>
                                <div className="modal-left-content">
                                    <DragDropContext onDragEnd={onDragEnd}>
                                        <SimpleTreeView
                                            treeData={treeData}
                                            selectedCaseId={selectedCase?.id}
                                            onSelectCase={handleSelectCase}
                                            onToggleExpand={handleToggleExpand}
                                            onAddNode={handleAdd}
                                            onDeleteNode={handleDeleteNode}
                                            onRenameNode={handleRenameNode}
                                            onDeleteCase={handleDeleteCase}
                                            testCaseDiffs={testCaseDiffs}
                                            pendingApprovals={pendingApprovals}
                                        />
                                    </DragDropContext>
                                </div>
                            </div>
                        </ResizablePanel>

                        {/* Правая панель - детальная информация о выбранном тест-кейсе */}
                        <div className="modal-right-panel">
                            <div className="modal-right-content">
                                {selectedCase ? (
                                    <TestCaseCard
                                        testCase={selectedCase}
                                        index={0}
                                        onUpdate={(caseId, updatedCase) => {
                                            handleUpdateCase(caseId, updatedCase);
                                            // Обновляем выбранный кейс, если это он
                                            if (selectedCase && caseId === selectedCase.id) {
                                                setSelectedCase(updatedCase);
                                            }
                                        }}
                                        onDelete={handleDeleteCase}
                                        projectId={projectId}
                                        jiraProject={jiraProject}
                                        jiraPat={jiraPat}
                                        testCaseDiffs={testCaseDiffs}
                                        pendingApprovals={pendingApprovals}
                                        onApproveCase={handleApproveCase}
                                        onRejectCase={handleRejectCase}
                                    />
                                ) : (
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center', 
                                        height: '100%',
                                        color: '#8b949e',
                                        fontSize: '14px'
                                    }}>
                                        Выберите тест-кейс из структуры слева
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <footer className="modal-footer">
                        <button className="button-secondary" onClick={handleCloseWithConfirm} disabled={isSending || isFixing}>
                            Отмена
                        </button>
                        <button
                            className="button-primary"
                            onClick={handleGenerateXmind}
                            disabled={isSending || isFixing || !Object.keys(treeData).length}
                            style={{ marginRight: '8px' }}
                        >
                            Сгенерировать Xmind
                        </button>
                        <button
                            className="button-secondary"
                            onClick={handleSavePerfectExamples}
                            disabled={isSending || isFixing || !Object.keys(treeData).length}
                            style={{ 
                                marginRight: '8px',
                                backgroundColor: '#6c757d',
                                borderColor: '#6c757d',
                                color: 'white'
                            }}
                            title="Сохранить тест-кейсы как идеальные примеры для улучшения следующей генерации"
                        >
                        Добавить в идеальный пример
                        </button>
                        <button className="button-primary" onClick={handleConfirm} disabled={isSending || isFixing}>
                            Отправить в Allure
                        </button>
                    </footer>
                </>
            )}
        </Modal>
    );


}
