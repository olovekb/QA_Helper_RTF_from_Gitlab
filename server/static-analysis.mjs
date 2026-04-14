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
        html += `<span class="tree-label" title="${escapeHtml(node.label)}">${fieldPrefix}${escapeHtml(node.label)}</span>`;
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
                    html += `<li class="tree-leaf" data-categories="${dataCat}"><input type="checkbox" class="fix-checkbox" data-test-id="${test.id}"><a href="#test-${test.id}" class="${cls}" title="${escapeHtml(test.name)} #${test.id}">${escapeHtml(test.name)} #${test.id}</a></li>`;
                }
            }
            html += `</ul>`;
        }
        html += `</li>`;
    }
    return html;
}

export async function staticAnalysis (testCases, projectId, aiRecommendations = null, options = {})
{
    const persistCleanIds = Boolean(options.persistCleanIds);
    if (!Array.isArray(testCases) || testCases.length === 0) {
        throw new Error('Не найдено тест-кейсов для анализа. Проверьте, что к задаче прикреплены тест-кейсы и выбран корректный проект');
    }

    let output = '';
    const successfulTests = [];
    const failedTests = [];
    const warningTests = [];
    const testsByCategory = new Map();
    const testCasesWithIssues = [];
    const cleanTestCaseIds = [];

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
            await generateTestCaseReport(testCase, projectId, aiRecsArray, testCases[0].issue);

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

        const isErrorFallback = (msg) =>
            !msg || /^Произошла ошибка при AI-анализе|^Ошибка парсинга AI ответа/i.test(String(msg));
        const realIssues = aiRecsArray
            .filter(r => r && (r.recommendation || r.message) && !isErrorFallback(r.recommendation || r.message))
            .map(r => ({
                title: r.title || null,
                message: r.recommendation || r.message || '',
                severity: r.severity || 'warning',
                category: r.category || 'other'
            }));
        if (realIssues.length > 0) {
            testCasesWithIssues.push({ testCaseId: testCase.id, issues: realIssues });
        } else if (persistCleanIds) {
            cleanTestCaseIds.push(String(testCase.id));
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
        resolution = '<p class="resolution-failed">Анализ не пройден</p>';
    }

    // Статистика
    const errorOverThreshold = Number(errorPercentage) > projectSettings.error_threshold;
    const warningOverThreshold = Number(warningPercentage) > projectSettings.warning_threshold;

    const statisticsHtml = `
        <div class="stats-bar">
            <span class="stats-item stats-total"><strong>${totalTestCases}</strong> тест-кейсов</span>
            <span class="stats-divider"></span>
            <span class="stats-item stats-err ${errorOverThreshold ? 'over-threshold' : ''}">
                <strong>${failedTests.length}</strong> с ошибками
                <span class="stats-pct">${errorPercentage}%</span>
                <span class="stats-threshold">/ ${projectSettings.error_threshold}%</span>
            </span>
            <span class="stats-divider"></span>
            <span class="stats-item stats-warn ${warningOverThreshold ? 'over-threshold' : ''}">
                <strong>${warningTests.length}</strong> с предупреждениями
                <span class="stats-pct">${warningPercentage}%</span>
                <span class="stats-threshold">/ ${projectSettings.warning_threshold}%</span>
            </span>
            <span class="stats-project">${projectSettings.name}</span>
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
            <div class="header-left">
                <h2>Задача: <a href="${config.jiraUrl}/${testCases[0].issue}" target="_blank">${testCases[0].issue}</a></h2>
            </div>
            <div class="header-right">
                ${resolution}
                <button type="button" class="header-download-btn" onclick="window.dispatchEvent(new CustomEvent('downloadReport'))">Скачать отчет</button>
            </div>
        </div>

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
  document.querySelectorAll('.allure-iframe').forEach(function(iframe){
    var wrapper = iframe.closest('.allure-iframe-wrapper');
    var fallback = wrapper ? wrapper.querySelector('.allure-iframe-fallback') : null;
    iframe.addEventListener('load', function(){
      try { var doc = iframe.contentDocument || iframe.contentWindow.document; if(!doc || !doc.body || doc.body.innerHTML === '') throw 0; }
      catch(e){ iframe.style.display='none'; if(fallback) fallback.style.display='block'; }
    });
    iframe.addEventListener('error', function(){
      iframe.style.display='none'; if(fallback) fallback.style.display='block';
    });
    setTimeout(function(){
      try { var doc = iframe.contentDocument; if(!doc || !doc.body || doc.body.innerHTML === '') throw 0; }
      catch(e){ iframe.style.display='none'; if(fallback) fallback.style.display='block'; }
    }, 3000);
  });
  (function alignIssueCols(){
    var cats = document.querySelectorAll('.issue-category');
    var maxW = 0;
    cats.forEach(function(el){ var w = el.offsetWidth; if(w > maxW) maxW = w; });
    if(maxW > 0){
      document.querySelectorAll('.issues-body').forEach(function(grid){
        grid.style.setProperty('--issues-cat-width', maxW + 'px');
      });
    }
  })();
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
    return {
        html: htmlReport,
        metadata: {
            testCasesWithIssues,
            ...(persistCleanIds ? { cleanTestCaseIds } : {})
        }
    };
}

async function generateTestCaseReport (testCase, projectId, aiRecommendations = [], issueKey = '')
{
    console.log(`\ngenerateTestCaseReport для ID: "${testCase.id}"`);
    console.log(`AI-рекомендаций передано: ${aiRecommendations.length}`);
    if (aiRecommendations.length > 0) {
        console.log(`Детали AI-рекомендаций: ${JSON.stringify(aiRecommendations, null, 2)}`);
    }

    const validation = validateTestCase(testCase, projectId);
    let output = '';

    // Конвертация ответа AI в формат, совместимый со статанализом (нужно до statusClass)
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

    // Вывод ID и названия тест-кейса (статус — по всем замечаниям: статика + AI)
    const statusClass = allErrors.length > 0 ? 'status-error' :
        allWarnings.length > 0 ? 'status-warning' : 'status-success';

    output += `<h1 class="test-case-title ${statusClass}"><span class="test-case-id">#${testCase.id}</span> ${testCase.name}</h1>`;

    const allurePageUrl = `${config.url}/project/${projectId}/test-cases/${testCase.id}`;
    const allureIframeUrl = issueKey
        ? `${config.url}/iframe/issue-tracker-testcase/${testCase.id}?integrationId=${config.defaultJiraIntegrationId}&issueKey=${encodeURIComponent(issueKey)}`
        : allurePageUrl;
    output += `<details class="test-case-details" open><summary>Информация о тест-кейсе</summary>`;
    output += `<div class="allure-iframe-wrapper">`;
    output += `<iframe src="${allureIframeUrl}" class="allure-iframe" loading="lazy"></iframe>`;
    output += `<div class="allure-iframe-fallback">Не удалось загрузить. <a href="${allurePageUrl}" target="_blank">Открыть в новой вкладке</a></div>`;
    output += `</div>`;
    output += `</details>`;

    const flattenIssues = (issues) =>
    {
        const flat = [];
        const byCategory = groupByCategory(issues);
        for (const [category, items] of Object.entries(byCategory)) {
            const catName = getCategoryName(category);
            items.forEach(item =>
            {
                if (item.stepErrors && item.stepErrors.length > 0) {
                    item.stepErrors.forEach(se =>
                    {
                        const step = testCase.steps?.[se.stepIndex - 1];
                        const stepName = step?.description ? String(step.description).trim() : null;
                        const label = stepName
                            ? `Шаг ${se.stepIndex}: «${escapeHtml(stepName.length > 60 ? stepName.slice(0, 57) + '…' : stepName)}»`
                            : `Шаг ${se.stepIndex}`;
                        flat.push({ category: catName, rule: escapeHtml(item.ruleName), stepLabel: label, message: escapeHtml(se.message) });
                    });
                } else {
                    flat.push({ category: catName, rule: escapeHtml(item.ruleName), stepLabel: null, message: escapeHtml(item.message) });
                }
            });
        }
        return flat;
    };

    const renderIssuesList = (items, type) =>
    {
        let html = `<div class="issues-section ${type}-section">`;
        const titles = { errors: 'Ошибки', warnings: 'Предупреждения' /* , improvements: 'Улучшения' */ };
        const title = titles[type] || type;
        html += `<div class="issues-header"><span class="issues-title">${title}</span><span class="issues-count ${type}-count">${items.length}</span></div>`;
        html += `<div class="issues-body">`;
        items.forEach(item =>
        {
            const itemClass = type === 'errors' ? 'error-item' : 'warning-item'; /* type === 'improvements' ? 'improvement-item' */
            const stepPart = item.stepLabel ? ` <span class="issue-step">${item.stepLabel}</span>` : '';
            html += `<span class="issue-category" title="${item.category}">${item.category}</span>`;
            html += `<span class="issue-text ${itemClass}"><span class="rule-name">${item.rule}</span>${stepPart}: ${item.message}</span>`;
        });
        html += `</div>`;
        html += `</div>`;
        return html;
    };

    const flatErrors = flattenIssues(allErrors);
    const flatWarnings = flattenIssues(allWarnings);
    // const flatImprovements = flattenIssues(allImprovements);

    if (flatErrors.length > 0) output += renderIssuesList(flatErrors, 'errors');
    if (flatWarnings.length > 0) output += renderIssuesList(flatWarnings, 'warnings');
    // if (flatImprovements.length > 0) output += renderIssuesList(flatImprovements, 'improvements');

    if (flatErrors.length === 0 && flatWarnings.length === 0) {
        output += `<div class="passed">Тест-кейс прошёл статический анализ</div>`;
    }

    // Запрос детального AI-анализа
    output += `<div class="ai-recommendations"><button class="ai-recommend-btn" data-test-id="${testCase.id}">Запросить рекомендации от AI</button><p id="ai-rec-text-${testCase.id}"></p></div>`;

    const allIssues = [...allErrors, ...allWarnings /* , ...allImprovements */];
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
