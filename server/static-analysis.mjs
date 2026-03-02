import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from './config.json' assert { type: 'json' };
import { validateTestCase, getProjectSettings } from './validation-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function escapeHtml (value)
{
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const CATEGORY_NAMES = {
    required_fields: 'Обязательные поля',
    naming: 'Правила именования',
    expected_result: 'Ожидаемый результат',
    steps: 'Шаги тест-кейса',
    tags: 'Теги',
    custom_fields: 'Кастомные поля',
    parameters: 'Параметры',
    test_scope: 'Границы ответственности',
    other: 'Прочее'
};

/** Порядок кастомных полей для иерархии (от большего к меньшему) */
const HIERARCHY_FIELDS = ['Block', 'SubBlock', 'Feature', 'Story', 'Scenario', 'Code'];

function getCustomFieldValue (testCase, fieldName)
{
    const cf = testCase.customFields?.find(f =>
        String(f.name || '').toLowerCase() === String(fieldName).toLowerCase()
    );
    const val = cf?.value?.trim();
    return (val && val !== 'Нет значений') ? val : null;
}

const PLACEHOLDER_LABELS = ['(Без значения)', 'Без названия', 'Без значения'];

function isPlaceholderLabel (label)
{
    return PLACEHOLDER_LABELS.some(p => String(label || '').trim() === p);
}

function buildTree (tests, fieldNames = HIERARCHY_FIELDS, depth = 0)
{
    const field = fieldNames[depth];
    const groups = new Map();
    for (const t of tests) {
        const v = getCustomFieldValue(t, field) || '(Без значения)';
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(t);
    }
    const result = [];
    for (const [label, groupTests] of groups) {
        if (isPlaceholderLabel(label)) {
            if (depth < fieldNames.length - 1) {
                result.push(...buildTree(groupTests, fieldNames, depth + 1));
            } else {
                result.push({ _placeholderTests: groupTests });
            }
            continue;
        }
        if (depth < fieldNames.length - 1) {
            let subTree = buildTree(groupTests, fieldNames, depth + 1);
            const placeholderTests = subTree.filter(n => n._placeholderTests).flatMap(n => n._placeholderTests || []);
            subTree = subTree.filter(n => !n._placeholderTests);
            const count = countInTree(subTree) + placeholderTests.length;
            result.push({ label, count, children: subTree, tests: placeholderTests, fieldName: field });
        } else {
            result.push({ label, count: groupTests.length, children: [], tests: groupTests, fieldName: field });
        }
    }
    return result;
}

function countInTree (nodes)
{
    return nodes.reduce((sum, n) =>
        sum + (n.tests?.length || 0) + (n.children?.length ? countInTree(n.children) : 0), 0);
}

let _treeIdSeq = 0;
function renderTreeHtml (nodes, statusMaps, testCategoriesMap = null, depth = 0)
{
    if (!nodes || nodes.length === 0) return '';
    const getStatusClass = (test) =>
    {
        if (statusMaps?.failedIds?.has(test.id)) return 'failed-text';
        if (statusMaps?.warningIds?.has(test.id)) return 'warning-text';
        return 'success-text';
    };
    const getDataCategories = (test) =>
    {
        if (!testCategoriesMap) return '';
        const cats = testCategoriesMap.get(test.id) || [];
        return escapeHtml(cats.join(','));
    };
    let html = '';
    for (const node of nodes) {
        const hasChildren = (node.children?.length || 0) + (node.tests?.length || 0) > 0;
        const nodeId = `tree-${++_treeIdSeq}`;
        html += `<li class="tree-node" data-depth="${depth}">`;
        html += `<div class="tree-row">`;
        html += `<span class="tree-toggle" data-target="${nodeId}" >${hasChildren ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2l4 3-4 3"/></svg>' : '<span style="display:inline-block;width:10px"></span>'}</span>`;
        html += `<input type="checkbox" class="tree-checkbox" style="visibility: ${hasChildren ? 'hidden' : 'visible'}">`;
        const fieldPrefix = node.fieldName ? `<span class="tree-field-prefix">${escapeHtml(node.fieldName)}</span> ` : '';
        html += `<span class="tree-label">${fieldPrefix}${escapeHtml(node.label)}</span>`;
        if (node.count > 0) {
            html += `<span class="tree-count">${node.count}</span>`;
        }
        html += `</div>`;
        if (hasChildren) {
            html += `<ul class="tree-children" id="${nodeId}">`;
            if (node.children?.length) {
                html += node.children.map(child => renderTreeHtml([child], statusMaps, testCategoriesMap, depth + 1)).join('');
            }
            if (node.tests?.length) {
                for (const test of node.tests) {
                    const cls = getStatusClass(test);
                    const dataCat = getDataCategories(test);
                    html += `<li class="tree-leaf" data-categories="${dataCat}"><input type="checkbox" class="fix-checkbox" data-test-id="${test.id}"><a href="#test-${test.id}" class="${cls}">${escapeHtml(test.name)} #${test.id}</a></li>`;
                }
            }
            html += `</ul>`;
        }
        html += `</li>`;
    }
    return html;
}

export async function staticAnalysis (testCases, projectId, aiRecommendations = null)
{
    if (!Array.isArray(testCases) || testCases.length === 0) {
        throw new Error('Не найдено тест-кейсов для анализа. Проверьте, что к задаче прикреплены тест-кейсы и выбран корректный проект');
    }

    let output = '';
    const successfulTests = [];
    const failedTests = [];
    const warningTests = [];
    const testsByCategory = new Map();

    // Получение настроек проекта
    const projectSettings = getProjectSettings(projectId);

    // Статистика
    let totalErrors = 0;
    let totalWarnings = 0;


    for (let testCase of testCases) {
        console.log(`\nОбрабатываем тест-кейс ID: "${testCase.id}"`);
        const aiRecs = aiRecommendations && aiRecommendations[testCase.id] ? aiRecommendations[testCase.id] : [];
        const aiRecsArray = Array.isArray(aiRecs) ? aiRecs : (aiRecs && aiRecs.recommendation ? [aiRecs] : []);
        console.log(`AI-рекомендаций найдено: ${aiRecsArray.length}`);

        const { report, hasErrors, hasWarnings, errorCount, warningCount, issueCategories = [] } =
            await generateTestCaseReport(testCase, projectId, aiRecsArray);

        output += `<div id="test-${testCase.id}" class="test-case">${report}</div>`;

        totalErrors += errorCount;
        totalWarnings += warningCount;

        // Классифицируем тесты
        if (hasErrors) {
            failedTests.push(testCase);
        }
        if (hasWarnings) {
            warningTests.push(testCase);
        }
        if (!hasErrors && !hasWarnings) {
            successfulTests.push(testCase);
        }

        // Группируем по категориям замечаний
        for (const cat of issueCategories) {
            if (!testsByCategory.has(cat)) testsByCategory.set(cat, []);
            testsByCategory.get(cat).push(testCase);
        }
    }

    // Вычисление процентов
    const totalTestCases = testCases.length;
    const errorPercentage = ((failedTests.length / totalTestCases) * 100).toFixed(2);
    const warningPercentage = ((warningTests.length / totalTestCases) * 100).toFixed(2);
    const passedPercentage = ((successfulTests.length / totalTestCases) * 100).toFixed(2);

    // Проверка пороговых значений
    const passesErrorThreshold = parseFloat(errorPercentage) <= projectSettings.error_threshold;
    const passesWarningThreshold = parseFloat(warningPercentage) <= projectSettings.warning_threshold;
    const passesReview = passesErrorThreshold && passesWarningThreshold;

    // Определяем резолюцию
    let resolution;
    if (passesReview) {
        resolution = '<p class="resolution-success">Все тест-кейсы прошли статический анализ</p>';
    } else {
        const issues = [];
        if (!passesErrorThreshold) {
            issues.push(`ошибки превышают порог (${errorPercentage}% > ${projectSettings.error_threshold}%)`);
        }
        if (!passesWarningThreshold) {
            issues.push(`предупреждения превышают порог (${warningPercentage}% > ${projectSettings.warning_threshold}%)`);
        }
        resolution = `<p class="resolution-failed">Анализ не пройден: ${issues.join(', ')}</p>`;
    }

    // Статистика
    const statisticsHtml = `
        <div class="statistics-panel">
            <div class="stats-grid">
                <div class="stat-card stat-total">
                    <div class="stat-value">${totalTestCases}</div>
                    <div class="stat-label">Всего тест-кейсов</div>
                </div>
                <div class="stat-card stat-warnings" onclick="document.getElementById('test-lists')">
                    <div class="stat-value">${warningTests.length}</div>
                    <div class="stat-label">С предупреждениями</div>
                    <div class="stat-percentage">${warningPercentage}%</div>
                </div>
                <div class="stat-card stat-errors" onclick="document.getElementById('test-lists')">
                    <div class="stat-value">${failedTests.length}</div>
                    <div class="stat-label">С ошибками</div>
                    <div class="stat-percentage">${errorPercentage}%</div>
                </div>
            </div>

            <div class="thresholds-info">
                <h3>Настройки проекта: ${projectSettings.name}</h3>
                <p><strong>Порог ошибок:</strong> ${projectSettings.error_threshold}% (текущий: ${errorPercentage}%)
                   </p>
                <p><strong>Порог предупреждений:</strong> ${projectSettings.warning_threshold}% (текущий: ${warningPercentage}%)
                   </p>
            </div>
        </div>
    `;

    // Порядок категорий как в отчете по тест-кейсу
    const CATEGORY_ORDER = ['required_fields', 'tags', 'expected_result', 'steps', 'naming', 'parameters', 'custom_fields', 'other'];
    const failedIds = new Set(failedTests.map(t => t.id));
    const warningIds = new Set(warningTests.map(t => t.id));
    const statusMaps = { failedIds, warningIds };

    // Маппинг категорий для фильтра
    const testCategoriesMap = new Map();
    for (const tc of testCases) {
        if (successfulTests.some(t => t.id === tc.id)) {
            testCategoriesMap.set(tc.id, ['_none']);
        } else {
            const cats = [];
            for (const cat of CATEGORY_ORDER) {
                if ((testsByCategory.get(cat) || []).some(t => t.id === tc.id)) cats.push(cat);
            }
            testCategoriesMap.set(tc.id, cats.length ? cats : ['other']);
        }
    }

    const hierarchyFields = projectSettings.hierarchy_fields || HIERARCHY_FIELDS;
    const fullTree = buildTree(testCases, hierarchyFields);
    _treeIdSeq = 0;
    const treeHtml = renderTreeHtml(fullTree, statusMaps, testCategoriesMap);

    const selectOptions = [{
        value: '_all',
        label: `Все тест-кейсы (${testCases.length})`
    }];
    for (const cat of CATEGORY_ORDER) {
        const tests = testsByCategory.get(cat) || [];
        if (tests.length > 0) {
            selectOptions.push({ value: cat, label: `${getCategoryName(cat)} (${tests.length})` });
        }
    }
    if (successfulTests.length > 0) {
        selectOptions.push({ value: '_none', label: `Без замечаний (${successfulTests.length})` });
    }

    const selectHtml = selectOptions.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    const navHtml = `<div class="test-list-section">
        <div class="category-filter">
            <label for="category-select">Категория:</label>
            <select id="category-select">${selectHtml}</select>
        </div>
        <ul class="tree-root scrollable-list" id="nav-tree">${treeHtml}</ul>
    </div>`;

    // Метаданные для Jira-интеграции: первая строка — JSON в комментарии, не отображается, легко парсить
    const reviewMeta = { success: passesReview };
    const htmlReport = `<!--${JSON.stringify(reviewMeta)}-->
<!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Статический анализ тест-кейсов - ${testCases[0].issue}</title>
        <style>
            ${getStyles()}
        </style>
      </head>
      <body>
        <div class="header">
            <h1>Статический анализ тест-кейсов</h1>
            <h2>Задача: <a href="${config.jiraUrl}/${testCases[0].issue}" target="_blank">${testCases[0].issue}</a></h2>
        </div>

        ${resolution}
        ${statisticsHtml}

        <div class="test-lists" id="test-lists">
            ${navHtml}
        </div>

        <div class="test-cases-details">
            ${output}
        </div>
        <script>
(function(){
  var select = document.getElementById('category-select');
  var tree = document.getElementById('nav-tree');
  function applyFilter(){
    var val = select ? select.value : '_all';
    var leaves = tree ? tree.querySelectorAll('.tree-leaf') : [];
    leaves.forEach(function(li){
      var cats = (li.getAttribute('data-categories') || '').split(',').map(function(s){ return s.trim(); });
      var show = val === '_all' || cats.indexOf(val) >= 0;
      li.classList.toggle('filtered-out', !show);
    });
    var nodes = tree ? tree.querySelectorAll('.tree-node') : [];
    for(var i = nodes.length - 1; i >= 0; i--){
      var n = nodes[i];
      var childrenUl = n.querySelector(':scope > .tree-children');
      if(!childrenUl) continue;
      var hasVisible = Array.prototype.some.call(childrenUl.children, function(c){
        return !c.classList.contains('filtered-out');
      });
      n.classList.toggle('filtered-out', !hasVisible);
    }
  }
  if(select) select.addEventListener('change', applyFilter);
  applyFilter();
  var svgRight='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l4 3-4 3"/></svg>';
  var svgDown='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3l3 4 3-4"/></svg>';
  document.querySelectorAll('.tree-toggle').forEach(function(btn){
    var targetId = btn.getAttribute('data-target');
    if(!targetId) return;
    var ul = document.getElementById(targetId);
    if(!ul) return;
    var treeRow = btn.closest('.tree-row');
    if(!treeRow) return;
    function setIcon(exp){ btn.innerHTML=exp?svgDown:svgRight; }
    function toggleNode(e){ if(e) e.stopPropagation(); ul.classList.toggle('collapsed'); setIcon(!ul.classList.contains('collapsed')); }
    btn.addEventListener('click', toggleNode);
    treeRow.addEventListener('click', function(e){
      if(e.target.closest('.tree-checkbox') || e.target.closest('.fix-checkbox') || e.target.closest('a')) return;
      toggleNode();
    });
    if(btn.closest('[data-depth="0"]')){ ul.classList.remove('collapsed'); setIcon(true); }
    else { ul.classList.add('collapsed'); setIcon(false); }
  });
})();
        </script>
      </body>
    </html>
  `;

    // Сохраняем HTML-отчёт в файл
    const fileName = `./report/report_test_cases.${testCases[0].issue}.html`;
    mkdirSync(dirname(fileName), { recursive: true });
    writeFileSync(fileName, htmlReport, 'utf8');

    console.log(`Отчет сохранен в файл: ${fileName}`);
    return htmlReport;
}

async function generateTestCaseReport (testCase, projectId, aiRecommendations = [])
{
    console.log(`\ngenerateTestCaseReport для ID: "${testCase.id}"`);
    console.log(`AI-рекомендаций передано: ${aiRecommendations.length}`);
    if (aiRecommendations.length > 0) {
        console.log(`Детали AI-рекомендаций: ${JSON.stringify(aiRecommendations, null, 2)}`);
    }

    const validation = validateTestCase(testCase, projectId);
    let output = '';

    // Вывод ID и названия тест-кейса
    const statusClass = validation.hasErrors ? 'status-error' :
        validation.hasWarnings ? 'status-warning' : 'status-success';

    output += `<h1 class="${statusClass}">${testCase.name} (ID: ${testCase.id})</h1>`;
    output += `
    <p>
      <a href="${config.url}/project/${projectId}/test-cases/${testCase.id}" target="_blank" class="allure-link">
        <svg width="18" height="18" viewBox="0 0 36 36" style="vertical-align: middle; margin-right: 8px; display: inline-block;" xmlns="http://www.w3.org/2000/svg">
          <g>
            <path fill="#444CE7" d="m10 11.028-8 4.648 16 9.296 8-4.648z"></path>
            <path fill="#8098F9" d="M26 1.732 18 6.38l8 4.648 8-4.648zm-16 9.296-8 4.648V6.38l8-4.648z"></path>
            <path fill="#2D31A6" d="M18 24.972v9.296l-8-4.648v-9.296z"></path>
            <path fill="#8098F9" d="m18 24.972 8-4.648v9.296l-8 4.648z"></path>
            <path fill="#444CE7" d="m10 11.028 16 9.296 7.14-4.148c.532-.31.86-.88.86-1.499V6.38l-8 4.648-16-9.296z"></path>
          </g>
        </svg>
        Открыть в ТестОпсе
      </a>
    </p>`;

    output += `<details class="test-case-details"><summary>Информация о тест-кейсе</summary>`;
    output += `<div class="test-info">`;
    output += `<p><strong>Статус:</strong> ${testCase.status}</p>`;
    output += `<p><strong>Теги:</strong> ${testCase.tags.join(', ') || 'Нет значений'}</p>`;
    output += `<p><strong>Слой:</strong> ${testCase.layer}</p>`;

    const customFieldsOutput = testCase.customFields
        .filter(field => field.value !== 'Нет значений')
        .map(field => `${field.name}: ${field.value}`)
        .join(', ');
    output += `<p><strong>Кастомные поля:</strong> ${customFieldsOutput || 'Нет значений'}</p>`;

    const parameters = testCase.parameters || [];
    if (parameters.length > 0) {
        output += `<p><strong>Параметры:</strong></p>`;
        output += `<table class="parameters-table"><thead><tr><th>Параметр</th><th>Значения</th></tr></thead><tbody>`;
        for (const p of parameters) {
            const name = escapeHtml(p.name || '?');
            const vals = Array.isArray(p.values) ? p.values : (p.value != null ? [p.value] : []);
            const valuesCell = vals.map(v => escapeHtml(String(v))).join(', ');
            output += `<tr><td>${name}</td><td>${valuesCell}</td></tr>`;
        }
        output += `</tbody></table>`;
    }

    const precondition = (testCase.precondition || '').trim();
    if (precondition && precondition !== 'Нет предусловия') {
        output += `<p><strong>Предусловие:</strong> ${escapeHtml(precondition)}</p>`;
    }

    output += `</div>`;

    // Шаги
    if (testCase.steps && testCase.steps.length > 0) {
        output += `<h3>Шаги:</h3><ul class="steps-list">`;
        testCase.steps.forEach((step, index) =>
        {
            // Проверка наличия ошибок для шага
            const stepErrors = validation.errors
                .filter(e => e.stepErrors && e.stepErrors.some(se => se.stepIndex === index + 1))
                .flatMap(e => e.stepErrors.filter(se => se.stepIndex === index + 1));

            const stepWarnings = validation.warnings
                .filter(w => w.stepErrors && w.stepErrors.some(sw => sw.stepIndex === index + 1))
                .flatMap(w => w.stepErrors.filter(sw => sw.stepIndex === index + 1));

            const hasStepIssues = stepErrors.length > 0 || stepWarnings.length > 0;
            const stepClass = stepErrors.length > 0 ? 'step-error' :
                stepWarnings.length > 0 ? 'step-warning' : '';

            output += `<li class="${stepClass}">`;
            const stepDescription = escapeHtml(step.description || '—');

            // бейдж общего шага
            const sharedStepBadge = step.type === 'sharedStep'
                ? ' <span class="shared-step-badge">Общий шаг</span>'
                : '';

            output += `<div class="step-header"><strong>Шаг ${index + 1}:</strong> ${stepDescription}${sharedStepBadge}</div>`;

            // подшаги общего шага
            if (step.type === 'sharedStep' && step.childSteps && step.childSteps.length > 0) {
                output += `<div class="step-expected">`;
                output += `<ul class="shared-step-children">`;
                step.childSteps.forEach((childStep) =>
                {
                    const childDescription = escapeHtml(childStep.description || '—');
                    output += `<li class="shared-child-step">`;
                    output += `<div class="child-step-description">${childDescription}</div>`;

                    // ожидаемый результат подшага
                    if (childStep.expectedResult) {
                        const expectedHtml = escapeHtml(childStep.expectedResult).replace(/\n/g, '<br>');
                        output += `<div class="child-step-expected">`;
                        output += `<span class="child-expected-label">ОР:</span> ${expectedHtml}`;
                        output += `</div>`;
                    }

                    output += `</li>`;
                });
                output += `</ul>`;
                output += `</div>`;
            }

            if (step.expectedResult) {
                const expectedHtml = escapeHtml(step.expectedResult).replace(/\n/g, '<br>');
                output += `
                  <div class="step-expected">
                    <div class="step-expected-label">Ожидаемый результат:</div>
                    <div class="step-expected-text">${expectedHtml}</div>
                  </div>
                `;
            }

            if (hasStepIssues) {
                output += '<ul class="step-issues">';
                stepErrors.forEach(err =>
                {
                    output += `<li class="error-item">${err.message}</li>`;
                });
                stepWarnings.forEach(warn =>
                {
                    output += `<li class="warning-item">${warn.message}</li>`;
                });
                output += '</ul>';
            }
            output += `</li>`;
        });
        output += `</ul>`;
    }

    // Ожидаемый результат
    if (testCase.expectedResult) {
        output += `<h3>Ожидаемый результат:</h3>`;
        output += `<p class="test-info">${escapeHtml(testCase.expectedResult)}</p>`;
    }
    output += `</details>`;

    // Конвертация ответа AI в формат, совместимый со статанализом
    const aiErrors = aiRecommendations
        .filter(r => r && r.severity === 'error')
        .map(r => ({
            ruleName: r.title || CATEGORY_NAMES[r.category] || CATEGORY_NAMES.other,
            message: r.recommendation,
            category: r.category || 'other',
            isAI: true
        }));
    const aiWarnings = aiRecommendations
        .filter(r => r && r.severity === 'warning')
        .map(r => ({
            ruleName: r.title || CATEGORY_NAMES[r.category] || CATEGORY_NAMES.other,
            message: r.recommendation,
            category: r.category || 'other',
            isAI: true
        }));

    const allErrors = [...validation.errors, ...aiErrors];
    const allWarnings = [...validation.warnings, ...aiWarnings];

    const totalErrorItems = allErrors.reduce((sum, e) =>
        sum + (e.stepErrors ? e.stepErrors.length : 1), 0);
    if (allErrors.length > 0) {
        output += `<div class="issues-section errors-section">`;
        output += `<h2>Ошибки (${totalErrorItems}):</h2>`;
        output += `<ul class="issues-list">`;

        const errorsByCategory = groupByCategory(allErrors);

        for (const [category, errors] of Object.entries(errorsByCategory)) {
            const nonStepErrors = errors.filter(error => !error.stepErrors);
            const stepErrorsExpanded = errors
                .filter(error => error.stepErrors && error.stepErrors.length > 0)
                .flatMap(error => error.stepErrors.map(se =>
                {
                    const step = testCase.steps?.[se.stepIndex - 1];
                    const stepName = step?.description ? String(step.description).trim() : null;
                    return {
                        ruleName: error.ruleName,
                        message: se.message,
                        stepIndex: se.stepIndex,
                        stepName: stepName ? (stepName.length > 80 ? stepName.slice(0, 77) + '…' : stepName) : null
                    };
                }));

            if (nonStepErrors.length > 0 || stepErrorsExpanded.length > 0) {
                output += `<li class="category-group">`;
                output += `<strong>Категория: ${getCategoryName(category)}</strong>`;
                output += `<ul>`;
                nonStepErrors.forEach(error =>
                {
                    output += `<li class="error-item">`;
                    output += `<span class="rule-name">${escapeHtml(error.ruleName)}</span>: ${escapeHtml(error.message)}`;
                    output += `</li>`;
                });
                stepErrorsExpanded.forEach(err =>
                {
                    output += `<li class="error-item">`;
                    const stepLabel = err.stepName
                        ? `Шаг ${err.stepIndex}: «${escapeHtml(err.stepName)}»`
                        : `Шаг ${err.stepIndex}`;
                    output += `<span class="rule-name">${escapeHtml(err.ruleName)}</span> (${stepLabel}): ${escapeHtml(err.message)}`;
                    output += `</li>`;
                });
                output += `</ul></li>`;
            }
        }
        output += `</ul></div>`;
    }

    // Вывод предупреждений
    const totalWarningItems = allWarnings.reduce((sum, w) =>
        sum + (w.stepErrors ? w.stepErrors.length : 1), 0);
    if (allWarnings.length > 0) {
        output += `<div class="issues-section warnings-section">`;
        output += `<h2>Предупреждения (${totalWarningItems}):</h2>`;
        output += `<ul class="issues-list">`;

        const warningsByCategory = groupByCategory(allWarnings);

        for (const [category, warnings] of Object.entries(warningsByCategory)) {
            const nonStepWarnings = warnings.filter(warning => !warning.stepErrors);
            const stepWarningsExpanded = warnings
                .filter(warning => warning.stepErrors && warning.stepErrors.length > 0)
                .flatMap(warning => warning.stepErrors.map(sw =>
                {
                    const step = testCase.steps?.[sw.stepIndex - 1];
                    const stepName = step?.description ? String(step.description).trim() : null;
                    return {
                        ruleName: warning.ruleName,
                        message: sw.message,
                        stepIndex: sw.stepIndex,
                        stepName: stepName ? (stepName.length > 80 ? stepName.slice(0, 77) + '…' : stepName) : null
                    };
                }));

            if (nonStepWarnings.length > 0 || stepWarningsExpanded.length > 0) {
                output += `<li class="category-group">`;
                output += `<strong>Категория: ${getCategoryName(category)}</strong>`;
                output += `<ul>`;
                nonStepWarnings.forEach(warning =>
                {
                    output += `<li class="warning-item">`;
                    output += `<span class="rule-name">${escapeHtml(warning.ruleName)}</span>: ${escapeHtml(warning.message)}`;
                    output += `</li>`;
                });
                stepWarningsExpanded.forEach(warn =>
                {
                    output += `<li class="warning-item">`;
                    const stepLabel = warn.stepName
                        ? `Шаг ${warn.stepIndex}: «${escapeHtml(warn.stepName)}»`
                        : `Шаг ${warn.stepIndex}`;
                    output += `<span class="rule-name">${escapeHtml(warn.ruleName)}</span> (${stepLabel}): ${escapeHtml(warn.message)}`;
                    output += `</li>`;
                });
                output += `</ul></li>`;
            }
        }
        output += `</ul></div>`;
    }

    if (allErrors.length === 0 && allWarnings.length === 0) {
        output += `<h2 class="passed">Тест-кейс прошел статический анализ</h2>`;
    }

    // Запрос детального AI-анализа
    output += `<div class="ai-recommendations"><button class="ai-recommend-btn" data-test-id="${testCase.id}">Запросить рекомендации от AI</button><p id="ai-rec-text-${testCase.id}"></p></div>`;

    const allIssues = [...allErrors, ...allWarnings];
    const issueCategories = [...new Set(allIssues.map(i => i.category || 'other'))];

    return {
        report: output,
        hasErrors: allErrors.length > 0,
        hasWarnings: allWarnings.length > 0,
        errorCount: allErrors.length,
        warningCount: allWarnings.length,
        issueCategories
    };
}

// Утилиты
function groupByCategory (issues)
{
    const grouped = {};
    for (const issue of issues) {
        const category = issue.category || 'other';
        if (!grouped[category]) {
            grouped[category] = [];
        }
        grouped[category].push(issue);
    }
    return grouped;
}

function getCategoryName (category)
{
    return CATEGORY_NAMES[category] || category;
}

function getStyles ()
{
    const cssPath = join(__dirname, 'static-analysis.css');
    return readFileSync(cssPath, 'utf8');
}
