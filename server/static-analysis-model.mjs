import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getTestModelRuleDisplayName, getTestModelAIRules } from './test-model-rules.mjs';
import { getProjectSettings } from './validation-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function escapeHtml (value)
{
    if (!value) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function ruPluralAfterNumber (n, forms)
{
    const abs = Math.abs(Number(n)) % 100;
    const n1 = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
}

const CATEGORY_NAMES = {
    structure: 'Структура и слои C1–C4',
    scope_boundaries: 'Границы модели и TMS',
    naming: 'Именование узлов',
    decomposition: 'Декомпозиция (CRUD и др.)',
    duplication: 'Дубли и переиспользование',
    export_sync: 'Экспорт и синхронизация с TMS',
    flags: 'Флаги и обозначения XMind',
    quality: 'Критерии качества',
    test_scope: 'Границы тестирования',
    steps: 'Шаги',
    other: 'Прочее'
};

function getStyles ()
{
    const cssPath = join(__dirname, 'static-analysis.css');
    return readFileSync(cssPath, 'utf8');
}

const GROUP_STYLES = `
.group-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 0.78em;
    font-weight: 600;
    color: #fff;
    background-color: #0d9488;
    margin: 6px 0 2px 0;
    letter-spacing: 0.02em;
}
.group-container {
    border: 1.5px dashed #0d9488;
    border-radius: 6px;
    padding: 4px 8px 4px 8px;
    margin: 2px 0 4px 0;
}
.group-container .tree-node {
    margin-left: 0;
}
`;

let _treeIdSeq = 0;

function renderGroupBadge (label, childrenHtml)
{
    if (!label) return '';
    let html = `<div style="margin: 4px 0;">`;
    html += `<span class="group-badge">${escapeHtml(label)}</span>`;
    if (childrenHtml) {
        html += `<div class="group-container"><ul class="tree-root" style="padding:0;margin:0;">${childrenHtml}</ul></div>`;
    }
    html += `</div>`;
    return html;
}

function renderModelNodeHtml (label, childrenHtml, depth = 0, isLeaf = false, prefix = '')
{
    if (!label && !childrenHtml) return '';
    const nodeId = `model-tree-${++_treeIdSeq}`;
    const hasChildren = !!childrenHtml && !isLeaf;

    let html = `<li class="tree-node" data-depth="${depth}">`;
    html += `<div class="tree-row">`;
    html += `<span class="tree-toggle" data-target="${nodeId}" >${hasChildren ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2l4 3-4 3"/></svg>' : '<span style="display:inline-block;width:10px"></span>'}</span>`;

    // Checkbox is hidden but kept for alignment
    html += `<input type="checkbox" class="tree-checkbox" style="visibility: hidden">`;

    const fieldPrefix = prefix ? `<span class="tree-field-prefix">${escapeHtml(prefix)}</span> ` : '';
    html += `<span class="tree-label" title="${escapeHtml(label)}">${fieldPrefix}${escapeHtml(label)}</span>`;
    html += `</div>`;

    if (hasChildren) {
        // By default open up to depth 1
        const collapsedClass = depth > 0 ? 'collapsed' : '';
        html += `<ul class="tree-children ${collapsedClass}" id="${nodeId}">`;
        html += childrenHtml;
        html += `</ul>`;
    }

    html += `</li>`;
    return html;
}

function processModelTree (data, depth = 0)
{
    if (!data) return '';

    if (Array.isArray(data)) {
        return data.map(item => processModelTree(item, depth)).join('');
    }

    if (typeof data === 'object') {
        if (data.block && data.features) {
            const childrenHtml = processModelTree(data.features, depth + 1);
            return renderModelNodeHtml(data.block + ' / ' + data.subBlock, childrenHtml, depth, false, 'Блок');
        } else if (data.feature && data.stories) {
            const childrenHtml = processModelTree(data.stories, depth + 1);
            return renderModelNodeHtml(data.feature, childrenHtml, depth, false, 'Фича');
        } else if (data.story && (data.scenarios || data.e2eCases)) {
            let childrenHtml = processModelTree(data.scenarios || [], depth + 1);
            if (data.e2eCases && data.e2eCases.length > 0) {
                const e2eHtml = processModelTree(data.e2eCases, depth + 2);
                childrenHtml += renderGroupBadge('E2E Tests', e2eHtml);
            }
            return renderModelNodeHtml(data.story, childrenHtml, depth, false, 'Стори');
        } else if (data.scenario) {
            let childrenHtml = '';
            if (data.codeList && data.codeList.length > 0) {
                childrenHtml += processModelTree(data.codeList, depth + 1);
            }
            if (data.integrationCases && data.integrationCases.length > 0) {
                const casesHtml = processModelTree(data.integrationCases, depth + 1);
                childrenHtml += renderGroupBadge('Integration Tests', casesHtml);
            }
            if (data.steps && data.steps.length > 0) {
                childrenHtml += processModelTree(data.steps, depth + 1);
            }
            return renderModelNodeHtml(data.scenario, childrenHtml, depth, false, 'Сценарий');
        } else if (data.code) {
            if (data.tests && data.tests.length > 0) {
                const testsHtml = processModelTree(data.tests, depth + 1);
                return renderGroupBadge(data.code, testsHtml);
            }
            return renderModelNodeHtml(data.code, '', depth, true, 'Код');
        } else if (data.test) {
            return renderModelNodeHtml(data.test, '', depth, true, 'Проверка');
        } else if (data.step) {
            return renderModelNodeHtml(data.step, '', depth, true, 'Шаг');
        } else if (data.name && data.steps) {
            // e2e case
            const childrenHtml = processModelTree(data.steps, depth + 1);
            return renderModelNodeHtml(data.name, childrenHtml, depth, false, 'Кейс');
        }
    }
    return '';
}

export async function staticAnalysisModel (modelData, projectId, aiRecommendations = [], modelFileName = null, jiraIssue = null)
{
    const projectSettings = getProjectSettings(projectId);
    const headerTitleRaw = (modelFileName && String(modelFileName).trim())
        ? String(modelFileName).trim()
        : 'Результат анализа тестовой модели';
    const headerTitleHtml = escapeHtml(headerTitleRaw);
    const jiraKey = jiraIssue && String(jiraIssue).trim() ? String(jiraIssue).trim() : null;
    const headerLeftHtml = jiraKey
        ? `${headerTitleRaw !== jiraKey ? `<p class="header-model-file">${headerTitleHtml}</p>` : ''}`
        : `<h2>${headerTitleHtml}</h2>`;

    const errors = aiRecommendations.filter(r => r.severity === 'error');
    const warnings = aiRecommendations.filter(r => r.severity === 'warning');

    const totalErrors = errors.length;
    const totalWarnings = warnings.length;

    const totalRules = Math.max((getTestModelAIRules(projectId) || []).length, 1);
    const pctFromDistinctRuleIds = (items) =>
    {
        const ids = new Set(
            items.map(x => String(x.ruleId || '').trim()).filter(Boolean)
        );
        if (ids.size > 0) {
            return (ids.size / totalRules) * 100;
        }
        if (!items.length) return 0;
        return Math.min(100, (items.length / totalRules) * 100);
    };

    const modelWarnThresh =
        projectSettings.model_warning_threshold != null
            ? projectSettings.model_warning_threshold
            : projectSettings.warning_threshold;
    const errThresh =
        projectSettings.model_error_threshold != null
            ? projectSettings.model_error_threshold
            : projectSettings.error_threshold;

    const errorPercentageStr = pctFromDistinctRuleIds(errors).toFixed(2);
    const warningPercentageStr = pctFromDistinctRuleIds(warnings).toFixed(2);

    const passesErrorThreshold = Number(errorPercentageStr) <= errThresh;
    const passesWarningThreshold = Number(warningPercentageStr) <= modelWarnThresh;
    const passesReview = passesErrorThreshold && passesWarningThreshold;

    let resolution;
    if (passesReview) {
        resolution = '<p class="resolution-success">Тестовая модель прошла ревью</p>';
    } else {
        resolution = '<p class="resolution-failed">Ревью не пройдено</p>';
    }

    const errorOverThreshold = Number(errorPercentageStr) > errThresh;
    const warningOverThreshold = Number(warningPercentageStr) > modelWarnThresh;

    const errorsLabel = ruPluralAfterNumber(totalErrors, ['ошибка', 'ошибки', 'ошибок']);
    const warningsLabel = ruPluralAfterNumber(totalWarnings, ['предупреждение', 'предупреждения', 'предупреждений']);

    const statisticsHtml = `
        <div class="stats-bar">
            <span class="stats-item stats-err ${errorOverThreshold ? 'over-threshold' : ''}">
                <strong>${totalErrors}</strong> ${errorsLabel}
                <span class="stats-pct">${errorPercentageStr}%</span>
                <span class="stats-threshold">/ ${errThresh}%</span>
            </span>
            <span class="stats-divider"></span>
            <span class="stats-item stats-warn ${warningOverThreshold ? 'over-threshold' : ''}">
                <strong>${totalWarnings}</strong> ${warningsLabel}
                <span class="stats-pct">${warningPercentageStr}%</span>
                <span class="stats-threshold">/ ${modelWarnThresh}%</span>
            </span>
            <span class="stats-project">${escapeHtml(projectSettings.name || '')}</span>
        </div>
    `;

    // Tree View
    _treeIdSeq = 0;
    const treeHtml = processModelTree(modelData);

    const navHtml = `<div class="test-list-section">
        <ul class="tree-root scrollable-list" id="nav-tree">${treeHtml}</ul>
    </div>`;

    // Recommendations List
    const renderIssuesList = (items, type) =>
    {
        if (!items || items.length === 0) return '';
        let html = `<div class="issues-section ${type}-section">`;
        const title = type === 'errors' ? 'Ошибки' : 'Предупреждения';
        html += `<div class="issues-header"><span class="issues-title">${title}</span><span class="issues-count ${type}-count">${items.length}</span></div>`;
        html += `<div class="issues-body">`;

        items.forEach(item =>
        {
            const itemClass = type === 'errors' ? 'error-item' : 'warning-item';
            const nodePart = item.nodeName && item.nodeName !== 'Общее' ? ` <span class="issue-step">[Узел: ${escapeHtml(item.nodeName)}]</span>` : '';
            const rawRuleId = item.ruleId ? String(item.ruleId).trim() : '';
            const ruleRu = rawRuleId ? getTestModelRuleDisplayName(rawRuleId, projectId) : '';
            const rulePart = rawRuleId
                ? ` <span class="issue-step" title="ID: ${escapeHtml(rawRuleId)}">[${escapeHtml(ruleRu)}]</span>`
                : '';
            const catName = CATEGORY_NAMES[item.category] || item.category || 'Прочее';

            html += `<span class="issue-category" title="${escapeHtml(catName)}">${escapeHtml(catName)}</span>`;
            html += `<span class="issue-text ${itemClass}"><span class="rule-name">${escapeHtml(item.title)}</span>${rulePart}${nodePart}: ${escapeHtml(item.recommendation)}</span>`;
        });

        html += `</div></div>`;
        return html;
    };

    let issuesHtml = '';
    if (aiRecommendations.length > 0) {
        issuesHtml += `<div class="test-cases-details" style="margin-top: 20px;">`;
        issuesHtml += renderIssuesList(errors, 'errors');
        issuesHtml += renderIssuesList(warnings, 'warnings');
        issuesHtml += `</div>`;
    } else {
        issuesHtml = `<div class="passed">Замечаний по тестовой модели нет!</div>`;
    }

    const htmlReport = `
<!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${headerTitleHtml}</title>
        <style>
            ${getStyles()}
            ${GROUP_STYLES}
            /* Дополнительные стили для превью */
            #nav-tree {
                background: var(--bg-input);
                padding: 10px;
                border-radius: 8px;
                border: 1px solid var(--border-color);
            }
        </style>
      </head>
      <body>
        <div class="header">
            <div class="header-left">
                ${headerLeftHtml}
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

        ${issuesHtml}

        <script>
(function(){
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
      if(e.target.closest('a')) return;
      toggleNode();
    });
    // Инициализация правильной иконки в зависимости от начального класса
    if(!ul.classList.contains('collapsed')) { setIcon(true); }
    else { setIcon(false); }
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

    return { html: htmlReport, metadata: { aiRecommendations } };
}
