// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useShowScrollTop } from './hooks/useShowScrollTop';
import axios from 'axios';
import Select from 'react-select';
import './style.css';
import config from './config';
import { parseXmindFile } from './parce-xmind/parce.xmind.mjs';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked'; // Импорт библиотеки marked
import GlobalBackgroundProgress from './components/GlobalBackgroundProgress';
import ErrorBoundary from './components/ErrorBoundary';
import RulesModal from './components/RulesModal';
import ArrowUpIcon from './components/ArrowUpIcon';
import { trackEvent } from './analytics';

const App = ({ projects }) =>
{
  const [projectId, setProjectId] = useState(config.projectId || '');
  const [jiraIssue, setJiraIssue] = useState(config.jiraIssue || '');
  const [loading, setLoading] = useState(false);
  const [htmlReport, setHtmlReport] = useState('');
  const [fixStatus, setFixStatus] = useState(false);
  const [activeTab, setActiveTab] = useState('analysis');
  const [xmindFile, setXmindFile] = useState(null);
  const [exportMessage, setExportMessage] = useState('');
  const [exportResult, setExportResult] = useState(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);

  const navigate = useNavigate();
  const reportContainerRef = useRef(null);
  const showScrollTop = useShowScrollTop();

  // Функция для преобразования Markdown-текста в HTML
  const parseMarkdown = (markdownText) =>
  {
    return marked(markdownText);
  };

  useEffect(() =>
  {
    const savedFixStatus = sessionStorage.getItem('fixStatus');
    if (savedFixStatus) {
      setFixStatus(JSON.parse(savedFixStatus));
    }
    const savedReport = sessionStorage.getItem('htmlReport');
    if (savedReport) {
      setHtmlReport(savedReport);
    }
  }, []);

  const syncProjectFromJiraPrefix = (value) =>
  {
    const prefix = value.split('-')[0]?.trim().toUpperCase();
    if (!prefix) return;
    const matched = projects?.find(
      (p) => String(p?.name ?? '').trim().toUpperCase() === prefix
    );
    if (matched) {
      const id = matched.id;
      setProjectId((prev) => (prev === id ? prev : id));
    }
  };

  // Делегирование кликов внутри контейнера, обработка кнопок AI-рекомендаций
  useEffect(() =>
  {
    const container = reportContainerRef.current;
    if (!container) return;

    const handleButtonClick = async (event) =>
    {
      const btn = event.target.closest('.ai-recommend-btn');
      if (!btn) return;
      if (btn.disabled) return;

      const originalContent = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';

      const testId = btn.getAttribute('data-test-id');
      const testCaseData = btn.getAttribute('data-test-case');
      let testCase = {};
      if (testCaseData) {
        try {
          testCase = JSON.parse(testCaseData);
        } catch (e) {
          console.error('Ошибка парсинга testCaseData:', e);
        }
      }
      const payload = {
        id: testId,
        projectId,
        ...testCase
      };

      const recParagraph = container.querySelector(`#ai-rec-text-${testId}`);

      try {
        const response = await axios.post(`${config.serverUrl}/ai-recommendation`, payload);
        const recommendation = response.data.recommendation || 'Нет рекомендаций';

        if (recParagraph) {
          const htmlContent = parseMarkdown(recommendation);
          recParagraph.innerHTML = htmlContent;
        }
      } catch (error) {
        if (recParagraph) {
          recParagraph.innerText = 'Ошибка: ' + error.message;
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
      }
    };

    container.addEventListener('click', handleButtonClick);
    return () =>
    {
      container.removeEventListener('click', handleButtonClick);
    };
  }, [htmlReport, projectId]);

  // Фильтрация по категориям и дропдауны в структуре
  useEffect(() =>
  {
    const container = reportContainerRef.current;
    if (!container || !htmlReport) return;
    const select = container.querySelector('#category-select');
    const tree = container.querySelector('#nav-tree');
    if (!select || !tree) return;

    const applyFilter = () =>
    {
      const val = select.value;
      const leaves = tree.querySelectorAll('.tree-leaf');
      leaves.forEach((li) =>
      {
        const cats = (li.getAttribute('data-categories') || '').split(',').map((s) => s.trim());
        const show = val === '_all' || cats.indexOf(val) >= 0;
        li.classList.toggle('filtered-out', !show);
      });
      const nodes = tree.querySelectorAll('.tree-node');
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const childrenUl = n.querySelector(':scope > .tree-children');
        if (!childrenUl) continue;
        const hasVisible = Array.prototype.some.call(childrenUl.children, (c) => !c.classList.contains('filtered-out'));
        n.classList.toggle('filtered-out', !hasVisible);
      }
      const countVisibleLeaves = (node) =>
      {
        return node.querySelectorAll('.tree-leaf:not(.filtered-out)').length;
      };
      nodes.forEach((n) =>
      {
        const countSpan = n.querySelector(':scope > .tree-row .tree-count');
        if (countSpan) {
          const visibleCount = countVisibleLeaves(n);
          countSpan.textContent = visibleCount;
        }
      });
    };

    select.addEventListener('change', applyFilter);
    applyFilter();

    const svgChevronRight = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l4 3-4 3"/></svg>';
    const svgChevronDown = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3l3 4 3-4"/></svg>';
    const setToggleIcon = (el, expanded) =>
    {
      el.innerHTML = expanded ? svgChevronDown : svgChevronRight;
    };
    const toggleBtns = container.querySelectorAll('.tree-toggle');
    toggleBtns.forEach((btn) =>
    {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;
      const ul = document.getElementById(targetId);
      if (!ul) return;
      const treeRow = btn.closest('.tree-row');
      if (!treeRow) return;

      const toggleNode = () =>
      {
        ul.classList.toggle('collapsed');
        setToggleIcon(btn, !ul.classList.contains('collapsed'));
      };

      // Клик на иконку
      btn.addEventListener('click', (e) =>
      {
        e.stopPropagation();
        toggleNode();
      });

      // Клик на всю строку
      treeRow.addEventListener('click', (e) =>
      {
        if (e.target.closest('.tree-checkbox') || e.target.closest('.fix-checkbox') || e.target.closest('a')) return;
        toggleNode();
      });

      const isRoot = !!btn.closest('[data-depth="0"]');
      if (isRoot) {
        ul.classList.remove('collapsed');
        setToggleIcon(btn, true);
      } else {
        ul.classList.add('collapsed');
        setToggleIcon(btn, false);
      }
    });

    return () =>
    {
      select.removeEventListener('change', applyFilter);
    };
  }, [htmlReport]);

  useEffect(() =>
  {
    const container = reportContainerRef.current;
    if (!container || !htmlReport) return;

    const styleId = 'react-report-styles';
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      styleElement.textContent = `
        .test-lists {
          flex: 0 0 40% !important;
          min-width: 250px !important;
          max-width: 70% !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 20px !important;
          margin-bottom: 0 !important;
        }

        .test-cases-details {
          flex: 1 !important;
          min-height: 400px !important;
        }

        .test-lists .scrollable-list {
          max-height: none !important;
          overflow: visible !important;
        }

        .test-case {
          display: none !important;
          border-bottom: none !important;
        }

        .test-case.active {
          display: block !important;
        }

        .tree-leaf a.active-link {
          font-weight: 600 !important;
          background-color: var(--bg-input) !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          text-decoration: none !important;
        }
      `;
      document.head.appendChild(styleElement);
    }

    // Модифицируем структуру DOM
    const testLists = container.querySelector('.test-lists');
    const testDetails = container.querySelector('.test-cases-details');

    if (testLists && testDetails && !container.querySelector('.main-layout')) {
      // Создаем новую структуру
      const mainLayout = document.createElement('div');
      mainLayout.className = 'main-layout';
      mainLayout.id = 'main-layout';
      mainLayout.style.cssText = 'display: flex; gap: 0; margin-bottom: 30px; align-items: stretch;';

      const resizerElement = document.createElement('div');
      resizerElement.className = 'resizer';
      resizerElement.id = 'resizer';
      resizerElement.style.cssText = 'flex: 0 0 4px; background: var(--border-color); cursor: col-resize; position: relative; transition: background-color 0.2s; margin: 0 8px;';

      resizerElement.addEventListener('mouseenter', () =>
      {
        resizerElement.style.background = 'var(--border-focus)';
      });
      resizerElement.addEventListener('mouseleave', () =>
      {
        resizerElement.style.background = 'var(--border-color)';
      });

      const emptyStateElement = document.createElement('div');
      emptyStateElement.className = 'empty-state';
      emptyStateElement.style.cssText = 'display: flex; align-items: center; justify-content: center; min-height: 400px; color: #d1d5db; font-size: 1.1rem; text-align: center;';
      emptyStateElement.innerHTML = '<p>Выберите тест-кейс для просмотра деталей</p>';

      // перемещение элементов
      const parent = testLists.parentElement;
      parent.insertBefore(mainLayout, testLists);
      mainLayout.appendChild(testLists);
      mainLayout.appendChild(resizerElement);
      mainLayout.appendChild(testDetails);
      testDetails.insertBefore(emptyStateElement, testDetails.firstChild);
    }

    // обработка кликов по тест-кейсам в структуре для отображения превью
    const emptyState = container.querySelector('.empty-state');
    const testCases = container.querySelectorAll('.test-case');
    const treeLinks = container.querySelectorAll('.tree-leaf a');

    const showTestCase = (testId) =>
    {
      if (emptyState) emptyState.style.display = 'none';

      testCases.forEach((tc) =>
      {
        tc.classList.remove('active');
      });

      const targetCase = document.getElementById(testId);

      if (targetCase) {
        targetCase.classList.add('active');

        treeLinks.forEach((link) =>
        {
          link.classList.remove('active-link');
        });
        const activeLink = container.querySelector(`.tree-leaf a[href="#${testId}"]`);
        if (activeLink) {
          activeLink.classList.add('active-link');
        }
      }
    };

    treeLinks.forEach((link) =>
    {
      link.addEventListener('click', (e) =>
      {
        e.preventDefault();
        const href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
          showTestCase(href.substring(1));
        }
      });
    });

    // ресайз колонок
    const resizer = container.querySelector('#resizer');
    const leftPanel = container.querySelector('#test-lists');

    let cleanupResize = null;

    if (resizer && leftPanel) {
      let isResizing = false;

      const handleMouseDown = (e) =>
      {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
      };

      const handleMouseMove = (e) =>
      {
        if (!isResizing) return;

        const containerLeft = leftPanel.parentElement.getBoundingClientRect().left;
        const newWidth = e.clientX - containerLeft;

        if (newWidth >= 250 && newWidth <= 800) {
          leftPanel.style.setProperty('flex-basis', `${newWidth}px`, 'important');
          leftPanel.style.setProperty('width', `${newWidth}px`, 'important');
          leftPanel.style.setProperty('flex-grow', '0', 'important');
          leftPanel.style.setProperty('flex-shrink', '0', 'important');
        }
        e.preventDefault();
      };

      const handleMouseUp = (e) =>
      {
        if (isResizing) {
          isResizing = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        }
        e.preventDefault();
      };

      resizer.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      cleanupResize = () =>
      {
        resizer.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
    // TODO: убрать после завершения сбора ОС
    // Дропдаун с формой обратной связи (состояние в localStorage)
    const feedbackIframeId = 'feedback-form-iframe';
    const feedbackStorageKey = 'feedbackFormExpanded';
    if (!container.querySelector(`#${feedbackIframeId}`)) {
      const mainLayout = container.querySelector('#main-layout');
      if (mainLayout) {
        const saved = localStorage.getItem(feedbackStorageKey);
        const initialExpanded = saved === null ? true : saved === 'true';

        // iFrame с формой обратной связи по статическому анализу (Yandex Forms)
        if (!document.querySelector('script[src="https://forms.yandex.ru/_static/embed.js"]')) {
          const yaScript = document.createElement('script');
          yaScript.src = 'https://forms.yandex.ru/_static/embed.js';
          document.head.appendChild(yaScript);
        }
        const iframeWrapper = document.createElement('div');
        iframeWrapper.className = 'feedback-iframe-wrapper';
        iframeWrapper.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color);';
        const svgChevronDown = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3l3 4 3-4"/></svg>';
        const svgChevronRight = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2l4 3-4 3"/></svg>';
        iframeWrapper.innerHTML = `
          <div class="feedback-dropdown-header" data-expanded="${initialExpanded}" style="cursor: pointer; font-size: 14px; color: #9ca3af; user-select: none; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span class="feedback-dropdown-icon">${initialExpanded ? svgChevronDown : svgChevronRight}</span>
            Оставить обратную связь
          </div>
          <div class="feedback-dropdown-content" style="display: ${initialExpanded ? 'block' : 'none'}; margin-top: 12px;">
            <iframe
              id="${feedbackIframeId}"
              src="https://forms.yandex.ru/u/698dbc41eb6146267a790a39?iframe=1"
              frameborder="0"
              name="ya-form-698dbc41eb6146267a790a39"
              title="Форма обратной связи"
              style="width: 90vw; max-width: 657px; height: 800px;"
            >Загрузка…</iframe>
          </div>
        `;
        mainLayout.parentElement.appendChild(iframeWrapper);

        const header = iframeWrapper.querySelector('.feedback-dropdown-header');
        const content = iframeWrapper.querySelector('.feedback-dropdown-content');
        const iconEl = iframeWrapper.querySelector('.feedback-dropdown-icon');
        header.addEventListener('click', () =>
        {
          const expanded = header.getAttribute('data-expanded') === 'true';
          const newExpanded = !expanded;
          header.setAttribute('data-expanded', newExpanded);
          content.style.display = newExpanded ? 'block' : 'none';
          if (iconEl) iconEl.innerHTML = newExpanded ? svgChevronDown : svgChevronRight;
          localStorage.setItem(feedbackStorageKey, String(newExpanded));
        });
      }
    }

    // Общий cleanup
    return () =>
    {
      if (cleanupResize) cleanupResize();
      const iframeWrapper = container?.querySelector('.feedback-iframe-wrapper');
      if (iframeWrapper) iframeWrapper.remove();
    };
  }, [htmlReport]);

  // клавиатурные события
  useEffect(() =>
  {
    const handleKeyDown = (e) =>
    {
      // закрыть модальное окно правил
      if (e.key === 'Escape') {
        if (showRulesModal) {
          setShowRulesModal(false);
        }
        if (showCleanupModal) {
          setShowCleanupModal(false);
        }
      }

      // открыть модальное окно правил
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (projectId && !showRulesModal) {
          setShowRulesModal(true);
        }
      }

      // скачать репорт
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (htmlReport && !loading) {
          downloadHtml();
        }
      }

      // фокус на фильтр категорий
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeElement = document.activeElement;
        if (activeElement?.tagName !== 'INPUT' && activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          const categorySelect = document.getElementById('category-select');
          if (categorySelect) {
            categorySelect.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () =>
    {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showRulesModal, showCleanupModal, projectId, htmlReport, loading]);

  const downloadHtml = useCallback(() =>
  {
    let htmlContent = sessionStorage.getItem('htmlReport');
    const savedProjectId = sessionStorage.getItem('projectId');
    const savedJiraIssue = sessionStorage.getItem('jiraIssue');
    if (!htmlContent) {
      console.error('HTML отчет не найден в sessionStorage');
      return;
    }
    if (!savedProjectId || !savedJiraIssue) {
      console.error('Данные projectId или jiraIssue отсутствуют в sessionStorage');
      return;
    }
    // удаление кнопки AI-рекомендаций, замена iframe на ссылку
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    doc.querySelectorAll('.ai-recommendations').forEach(el => el.remove());
    doc.querySelectorAll('.allure-iframe-wrapper').forEach(wrapper => {
      const fallbackLink = wrapper.querySelector('.allure-iframe-fallback a[href]');
      const iframe = wrapper.querySelector('iframe');
      const href = fallbackLink?.getAttribute('href') || iframe?.getAttribute('src') || '#';
      const a = doc.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.textContent = 'Открыть в новой вкладке';
      wrapper.innerHTML = '';
      wrapper.appendChild(a);
    });
    htmlContent = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    const fileName = `Результат ревью тест-кейсов ${savedJiraIssue}.html`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
  }, []);

  useEffect(() =>
  {
    const handler = () => downloadHtml();
    window.addEventListener('downloadReport', handler);
    return () => window.removeEventListener('downloadReport', handler);
  }, [downloadHtml]);

  const toggleFixStatus = () =>
  {
    const newFixStatus = !fixStatus;
    setFixStatus(newFixStatus);
    sessionStorage.setItem('fixStatus', JSON.stringify(newFixStatus));
  };

  const handleSubmit = async (e) =>
  {
    e.preventDefault();
    trackEvent('static_analysis', { page: '/', projectId, taskId: jiraIssue });
    setLoading(true);
    setHtmlReport('');

    try {
      const response = await axios.post(`${config.serverUrl}/analyze`, {
        projectId,
        jiraIssue,
      });
      const newReport = response.data;
      setHtmlReport(newReport);
      sessionStorage.setItem('htmlReport', newReport);
      sessionStorage.setItem('projectId', projectId);
      sessionStorage.setItem('jiraIssue', jiraIssue);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleXmindFileChange = (e) =>
  {
    const file = e.target.files[0];
    if (file) {
      setXmindFile(file);
    }
  };

  const handleExportClick = async () =>
  {
    trackEvent('export_xmind_to_allure', { page: '/', projectId });
    setLoading(true);
    if (!xmindFile) {
      setExportMessage('Пожалуйста, загрузите файл XMind.');
      return;
    }
    if (!projectId) {
      setExportMessage('Пожалуйста, выберите проект.');
      return;
    }
    setExportMessage('Обработка файла и экспорт данных...');
    try {
      const allureData = await parseXmindFile(xmindFile, projectId);
      const response = await axios.post(`${config.serverUrl}/export`, {
        allureData,
        projectId,
      });
      if (response.status === 200) {
        const allureLink = `https://abanking.qatools.cloud/project/${projectId}/test-cases`;
        setExportMessage('Экспорт завершён! Посмотреть результат: ');
        setExportResult(allureLink);
      } else {
        setExportMessage('Ошибка при экспорте данных.');
      }
    } catch (error) {
      console.error('Ошибка экспорта:', error);
      setExportMessage('Ошибка при обработке и экспорте файла.');
    } finally {
      setLoading(false);
    }
  };

  // Обработчик для перехода на страницу "Test impact analysis"
  const handleTIAClick = () =>
  {
    navigate('/tia');
  };

  // Новый обработчик для перехода на страницу "Тестирование требований"
  const handleSolutionClick = () =>
  {
    navigate('/solution');
  };

  const handleTabChange = (tab) =>
  {
    setActiveTab(tab);
  };

  const handleCleanupDuplicates = async () =>
  {
    if (!projectId) {
      alert('Пожалуйста, выберите проект.');
      return;
    }
    trackEvent('cleanup_duplicates', { page: '/', projectId });

    setCleanupLoading(true);
    setCleanupResult(null);
    try {
      const response = await axios.post(`${config.serverUrl}/cleanup-duplicates`, {
        projectId,
      });
      setCleanupResult(response.data);
      if (response.data.success) {
        setExportMessage(`Очистка завершена. Удалено ${response.data.deleted} дублей из ${response.data.totalCases} тест-кейсов.`);
      }
    } catch (error) {
      console.error('Ошибка очистки дублей:', error);
      setCleanupResult({
        success: false,
        error: error.response?.data?.error || error.message || 'Неизвестная ошибка'
      });
    } finally {
      setCleanupLoading(false);
      // Не закрываем модалку - пользователь сам закроет после просмотра результатов
    }
  };

  return (
    <ErrorBoundary>
      <style>{ `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div className="App">
        {/* Глобальный фоновый прогресс-бар */ }
        <GlobalBackgroundProgress />

        <div className="header-wrapper">
          <h1>QA-helper</h1>
          <div className="header-buttons">
            <button onClick={ handleTIAClick } className="tia-button">
              Test impact analysis
            </button>
            <button onClick={ handleSolutionClick } className="tia-button">
              Тестирование требований
            </button>
            <button onClick={ () => navigate('/code-error') } className="tia-button">
              Завести набор ошибок кода на эпик
            </button>
          </div>
        </div>

        <div className="tabs">
          <button onClick={ () => handleTabChange('analysis') } className={ activeTab === 'analysis' ? 'active' : '' }>
            Анализ тестов
          </button>
          <button onClick={ () => handleTabChange('export') } className={ activeTab === 'export' ? 'active' : '' }>
            Экспорт Xmind в Allure
          </button>
        </div>
        { activeTab === 'analysis' && (
          <div style={ {
            maxWidth: '90vw',
            margin: '0 auto',
            padding: '40px 20px'
          } }>
            <form className="analysis-form" onSubmit={ handleSubmit } style={ {
              backgroundColor: 'var(--bg-content)',
              padding: '32px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              marginBottom: '32px',
              boxShadow: 'none'
            } }>
              <div style={ { display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' } }>
                <div style={ { flex: '1', minWidth: '200px' } }>
                  <label style={ {
                    display: 'block',
                    marginBottom: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--text-secondary)'
                  } }>
                    Выберите проект:
                  </label>
                  <Select
                    classNamePrefix="select"
                    placeholder="Выберите проект"
                    options={ projects.map(p => ({ value: p.id, label: p.name })) }
                    value={ (() => { const p = projects.find(pr => pr.id === projectId); return p ? { value: p.id, label: p.name } : null; })() }
                    onChange={ opt => setProjectId(opt?.value ?? '') }
                    menuPortalTarget={ document.body }
                    menuPosition="fixed"
                    menuPlacement="auto"
                    styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                  />
                </div>
                <div style={ { flex: '1', minWidth: '200px' } }>
                  <label style={ {
                    display: 'block',
                    marginBottom: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--text-secondary)'
                  } }>
                    Номер задачи из Jira:
                  </label>
                  <input
                    type="text"
                    value={ jiraIssue }
                    onChange={ (e) =>
                    {
                      const v = e.target.value;
                      setJiraIssue(v);
                      syncProjectFromJiraPrefix(v);
                    } }
                    style={ {
                      width: '100%',
                      padding: '12px 16px',
                      fontSize: '15px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      transition: 'all 0.2s',
                      boxSizing: 'border-box'
                    } }
                    onFocus={ (e) => e.target.style.borderColor = 'var(--border-focus)' }
                    onBlur={ (e) => e.target.style.borderColor = 'var(--border-color)' }
                  />
                </div>
              </div>
              {/* Кнопка просмотра правил */ }
              { projectId && (
                <button
                  type="button"
                  onClick={ () => setShowRulesModal(true) }
                  style={ {
                    width: '100%',
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--primary-accent)',
                    backgroundColor: 'transparent',
                    border: '2px solid var(--primary-accent)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    margin: '0px'
                  } }
                >
                  Правила статанализа
                </button>
              ) }

              <button
                type="submit"
                disabled={ loading || !projectId || !jiraIssue.trim() }
                style={ {
                  width: '100%',
                  padding: '14px 24px',

                  fontSize: '16px',
                  fontWeight: '600',
                  color: 'white',
                  backgroundColor: (loading || !projectId || !jiraIssue.trim()) ? 'var(--border-color)' : 'var(--primary-accent)',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: (loading || !projectId || !jiraIssue.trim()) ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                } }
                onMouseEnter={ (e) =>
                {
                  if (!loading && projectId && jiraIssue.trim()) {
                    e.target.style.backgroundColor = 'var(--primary-hover)';
                  }
                } }
                onMouseLeave={ (e) =>
                {
                  if (!loading && projectId && jiraIssue.trim()) {
                    e.target.style.backgroundColor = 'var(--primary-accent)';
                  }
                } }
              >
                { loading ? 'Анализ запущен...' : !projectId ? 'Выберите проект' : !jiraIssue.trim() ? 'Введите номер задачи' : 'Запустить анализ' }
              </button>
            </form>
            { htmlReport && !loading && showScrollTop && (
              <div className="floating-buttons analysis-floating">
                <span />
                <button
                  type="button"
                  className="btn btn-secondary btn-top"
                  onClick={ () => window.scrollTo({ top: 0, behavior: 'smooth' }) }
                >
                  <ArrowUpIcon />
                </button>
              </div>
            ) }
            <div ref={ reportContainerRef } style={ {
              backgroundColor: 'var(--bg-content)',
              padding: '32px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              minHeight: '200px'
            } }>
              { loading ? (
                <div style={ {
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '60px 20px'
                } }>
                  <div className="spinner"></div>
                </div>
              ) : htmlReport ? (
                <div dangerouslySetInnerHTML={ { __html: htmlReport } } />
              ) : (
                <p style={ {
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '16px',
                  padding: '40px 20px'
                } }>
                  Не найдено тест-кейсов для анализа
                </p>
              ) }
            </div>
          </div>
        ) }
        { activeTab === 'export' && (
          <div style={ {
            maxWidth: '800px',
            margin: '0 auto',
            padding: '40px 20px'
          } }>
            <h2 style={ {
              fontSize: '28px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '32px',
              textAlign: 'center'
            } }>
              Экспорт XMind в Allure
            </h2>
            <div style={ {
              backgroundColor: 'var(--bg-content)',
              padding: '32px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.2), 0 2px 4px -2px rgb(0 0 0 / 0.2)',
              marginBottom: '24px'
            } }>
              <div style={ { marginBottom: '24px' } }>
                <label style={ {
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: 'var(--text-secondary)'
                } }>
                  Выберите проект:
                </label>
                <Select
                  classNamePrefix="select"
                  placeholder="Выберите проект"
                  options={ projects.map(p => ({ value: p.id, label: p.name })) }
                  value={ (() => { const p = projects.find(pr => pr.id === projectId); return p ? { value: p.id, label: p.name } : null; })() }
                  onChange={ opt => setProjectId(opt?.value ?? '') }
                  menuPortalTarget={ document.body }
                  menuPosition="fixed"
                  menuPlacement="auto"
                  styles={ { menuPortal: base => ({ ...base, zIndex: 9999 }) } }
                />
              </div>
              <div style={ { marginBottom: '32px' } }>
                <label style={ {
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: 'var(--text-secondary)'
                } }>
                  Загрузить XMind файл:
                </label>
                <div style={ {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap'
                } }>
                  <label style={ {
                    padding: '12px 24px',
                    fontSize: '15px',
                    fontWeight: '500',
                    color: 'white',
                    backgroundColor: 'var(--primary-accent)',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'inline-block'
                  } }
                    onMouseEnter={ (e) =>
                    {
                      e.target.style.backgroundColor = 'var(--primary-hover)';
                    } }
                    onMouseLeave={ (e) =>
                    {
                      e.target.style.backgroundColor = 'var(--primary-accent)';
                    } }
                  >
                    Выберите файл
                    <input
                      type="file"
                      accept=".xmind"
                      onChange={ handleXmindFileChange }
                      style={ { display: 'none' } }
                    />
                  </label>
                  <span style={ {
                    fontSize: '14px',
                    color: xmindFile ? 'var(--success)' : 'var(--error)',
                    fontWeight: xmindFile ? '500' : '400'
                  } }>
                    { xmindFile ? xmindFile.name : 'Файл не выбран' }
                  </span>
                </div>
              </div>
              <button
                onClick={ handleExportClick }
                disabled={ loading || !xmindFile }
                style={ {
                  width: '100%',
                  padding: '14px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  backgroundColor: (loading || !xmindFile) ? 'var(--border-color)' : 'var(--success)',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: (loading || !xmindFile) ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                } }
              >
                { loading ? (
                  <>
                    <div className="spinner" style={ {
                      width: '18px',
                      height: '18px',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTop: '2px solid white',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite'
                    } }></div>
                    Экспорт...
                  </>
                ) : (
                  'Экспорт'
                ) }
              </button>
            </div>

            { exportMessage && (
              <div style={ {
                backgroundColor: 'var(--success-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '16px 20px',
                marginBottom: '24px'
              } }>
                <p style={ {
                  margin: 0,
                  fontSize: '15px',
                  color: 'var(--primary-accent)',
                  lineHeight: '1.5'
                } }>
                  { exportMessage }
                </p>
              </div>
            ) }

            { exportResult && (
              <div style={ {
                textAlign: 'center',
                marginBottom: '24px'
              } }>
                <a
                  href={ exportResult }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={ {
                    display: 'inline-block',
                    padding: '12px 24px',
                    fontSize: '15px',
                    fontWeight: '500',
                    color: 'var(--text-primary)',
                    backgroundColor: 'var(--success)',
                    textDecoration: 'none',
                    borderRadius: '8px',
                    transition: 'all 0.2s',
                    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)'
                  } }
                  onMouseEnter={ (e) =>
                  {
                    e.target.style.backgroundColor = '#059669'; /* success hover */
                  } }
                  onMouseLeave={ (e) =>
                  {
                    e.target.style.backgroundColor = 'var(--success)';
                  } }
                >
                  Открыть проект в Allure
                </a>
              </div>
            ) }

            <div style={ {
              textAlign: 'center',
              marginTop: '32px'
            } }>
              <button
                onClick={ () => setShowCleanupModal(true) }
                disabled={ loading || !projectId }
                style={ {
                  padding: '12px 24px',
                  fontSize: '15px',
                  fontWeight: '500',
                  color: 'white',
                  backgroundColor: (loading || !projectId) ? 'var(--border-color)' : 'var(--error)',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: (loading || !projectId) ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                } }
                onMouseEnter={ (e) =>
                {
                  if (!loading && projectId) {
                    e.target.style.backgroundColor = '#c82333';
                  }
                } }
                onMouseLeave={ (e) =>
                {
                  if (!loading && projectId) {
                    e.target.style.backgroundColor = '#dc3545';
                  }
                } }
              >
                Очистить дубли тест-кейсов
              </button>
            </div>
          </div>
        ) }
        { showCleanupModal && (
          <div style={ {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(2px)'
          } }>
            <div style={ {
              backgroundColor: 'var(--bg-content)',
              padding: '40px',
              borderRadius: '16px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.2), 0 2px 4px -2px rgb(0 0 0 / 0.2)',
              position: 'relative'
            } }>
              <h2 style={ {
                marginTop: 0,
                marginBottom: '28px',
                fontSize: '26px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                letterSpacing: '-0.5px'
              } }>
                Подтверждение очистки дублей
              </h2>

              { !cleanupResult && (
                <>
                  <p style={ {
                    marginBottom: '16px',
                    fontSize: '15px',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.5'
                  } }>
                    Вы уверены, что хотите удалить дубли тест-кейсов в проекте <strong style={ { color: 'var(--text-primary)' } }>
                      { projects.find(p => String(p.id) === String(projectId))?.name || projectId }
                    </strong>?
                  </p>
                  <div style={ {
                    marginBottom: '24px',
                    padding: '18px',
                    color: 'var(--error)',
                    fontWeight: '500',
                    backgroundColor: 'var(--error-bg)',
                    border: '1px solid var(--error)',
                    borderRadius: '8px'
                  } }>
                    <p style={ {
                      margin: 0,
                      fontSize: '14px',
                      lineHeight: '1.6'
                    } }>
                      Тест-кейсы с одинаковыми названиями и тегами будут удалены, останутся только самые полные по содержанию.
                    </p>
                    <p style={ {
                      margin: 0,
                      fontSize: '18px',
                      lineHeight: '1.6'
                    } }>Это действие нельзя отменить</p>
                  </div>
                </>
              ) }

              { cleanupLoading && (
                <div style={ {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  gap: '16px'
                } }>
                  <div className="spinner" style={ {
                    width: '48px',
                    height: '48px',
                    border: '4px solid #f3f3f3',
                    borderTop: '4px solid #dc3545',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  } }></div>
                  <p style={ {
                    margin: 0,
                    color: '#666',
                    fontSize: '15px',
                    fontWeight: '500'
                  } }>
                    Выполняется очистка дублей...
                  </p>
                  <p style={ {
                    margin: 0,
                    color: '#999',
                    fontSize: '13px'
                  } }>
                    Пожалуйста, подождите
                  </p>
                </div>
              ) }

              { cleanupResult && !cleanupLoading && (
                <div style={ {
                  marginBottom: '24px'
                } }>
                  { cleanupResult.success ? (
                    <div>
                      <div style={ {
                        marginBottom: '20px',
                        paddingBottom: '16px',
                        borderBottom: '1px solid #e0e0e0'
                      } }>
                        <h3 style={ {
                          margin: 0,
                          fontSize: '18px',
                          fontWeight: '600',
                          color: 'var(--text-primary)'
                        } }>
                          Очистка завершена
                        </h3>
                      </div>
                      <div style={ {
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '16px'
                      } }>
                        <div style={ {
                          padding: '16px',
                          backgroundColor: '#f8f9fa',
                          borderRadius: '8px',
                          border: '1px solid #e9ecef'
                        } }>
                          <div style={ {
                            fontSize: '13px',
                            color: '#6c757d',
                            marginBottom: '8px',
                            fontWeight: '500'
                          } }>
                            Всего тест-кейсов
                          </div>
                          <div style={ {
                            fontSize: '28px',
                            fontWeight: '700',
                            color: '#212529',
                            lineHeight: '1.2'
                          } }>
                            { cleanupResult.totalCases }
                          </div>
                        </div>
                        <div style={ {
                          padding: '16px',
                          backgroundColor: '#f8f9fa',
                          borderRadius: '8px',
                          border: '1px solid #e9ecef'
                        } }>
                          <div style={ {
                            fontSize: '13px',
                            color: '#6c757d',
                            marginBottom: '8px',
                            fontWeight: '500'
                          } }>
                            Групп дублей
                          </div>
                          <div style={ {
                            fontSize: '28px',
                            fontWeight: '700',
                            color: '#212529',
                            lineHeight: '1.2'
                          } }>
                            { cleanupResult.duplicatesFound }
                          </div>
                        </div>
                        <div style={ {
                          padding: '16px',
                          backgroundColor: '#fff5f5',
                          borderRadius: '8px',
                          border: '1px solid #fed7d7'
                        } }>
                          <div style={ {
                            fontSize: '13px',
                            color: '#6c757d',
                            marginBottom: '8px',
                            fontWeight: '500'
                          } }>
                            Удалено дублей
                          </div>
                          <div style={ {
                            fontSize: '28px',
                            fontWeight: '700',
                            color: '#c53030',
                            lineHeight: '1.2'
                          } }>
                            { cleanupResult.deleted }
                          </div>
                        </div>
                        <div style={ {
                          padding: '16px',
                          backgroundColor: '#f0fff4',
                          borderRadius: '8px',
                          border: '1px solid #c6f6d5'
                        } }>
                          <div style={ {
                            fontSize: '13px',
                            color: '#6c757d',
                            marginBottom: '8px',
                            fontWeight: '500'
                          } }>
                            Оставлено
                          </div>
                          <div style={ {
                            fontSize: '28px',
                            fontWeight: '700',
                            color: '#22543d',
                            lineHeight: '1.2'
                          } }>
                            { cleanupResult.kept }
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={ {
                      padding: '20px',
                      backgroundColor: 'var(--error-bg)',
                      border: '1px solid var(--error)',
                      borderRadius: '8px'
                    } }>
                      <h3 style={ {
                        margin: '0 0 12px 0',
                        fontSize: '18px',
                        fontWeight: '600',
                        color: 'var(--error)'
                      } }>
                        Ошибка
                      </h3>
                      <p style={ {
                        margin: 0,
                        fontSize: '14px',
                        color: 'var(--text-primary)',
                        lineHeight: '1.5'
                      } }>
                        { cleanupResult.error || 'Неизвестная ошибка' }
                      </p>
                    </div>
                  ) }
                </div>
              ) }

              <div style={ {
                display: 'flex',
                gap: '12px',
                justifyContent: 'flex-end',
                marginTop: '32px',
                paddingTop: '24px',
                borderTop: '1px solid #e9ecef'
              } }>
                <button
                  onClick={ () =>
                  {
                    setShowCleanupModal(false);
                    setCleanupResult(null);
                  } }
                  disabled={ cleanupLoading }
                  style={ {
                    minWidth: '120px',
                    padding: '12px 24px',
                    backgroundColor: cleanupLoading ? '#e9ecef' : '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: cleanupLoading ? 'default' : 'pointer',
                    fontSize: '15px',
                    fontWeight: '500',
                    transition: 'all 0.2s ease',
                    opacity: cleanupLoading ? 0.6 : 1,
                    boxShadow: cleanupLoading ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
                  } }
                  onMouseEnter={ (e) =>
                  {
                    if (!cleanupLoading && !cleanupResult) {
                      e.target.style.backgroundColor = '#5a6268';
                    }
                  } }
                  onMouseLeave={ (e) =>
                  {
                    if (!cleanupLoading) {
                      e.target.style.backgroundColor = cleanupResult ? '#6c757d' : '#6c757d';
                    }
                  } }
                >
                  { cleanupResult ? 'Закрыть' : 'Отмена' }
                </button>
                { !cleanupResult && (
                  <button
                    onClick={ handleCleanupDuplicates }
                    disabled={ cleanupLoading }
                    style={ {
                      minWidth: '180px',
                      padding: '12px 24px',
                      backgroundColor: cleanupLoading ? '#c82333' : '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: cleanupLoading ? 'not-allowed' : 'pointer',
                      fontSize: '15px',
                      fontWeight: '500',
                      transition: 'all 0.2s ease',
                      opacity: cleanupLoading ? 0.7 : 1,
                      boxShadow: cleanupLoading ? 'none' : '0 2px 4px rgba(220,53,69,0.3)'
                    } }
                    onMouseEnter={ (e) =>
                    {
                      if (!cleanupLoading) {
                        e.target.style.backgroundColor = '#c82333';
                      }
                    } }
                    onMouseLeave={ (e) =>
                    {
                      if (!cleanupLoading) {
                        e.target.style.backgroundColor = '#dc3545';
                      }
                    } }
                  >
                    { cleanupLoading ? 'Очистка...' : 'Подтвердить удаление' }
                  </button>
                ) }
              </div>
            </div>
          </div>
        ) }
      </div>

      {/* Модалка с правилами валидации */ }
      <RulesModal
        isOpen={ showRulesModal }
        onClose={ () => setShowRulesModal(false) }
        projectId={ projectId }
        projects={ projects }
      />
    </ErrorBoundary>
  );
};

export default App;
