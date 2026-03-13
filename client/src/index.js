// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import ThemeToggle from './components/ThemeToggle';
import App from './App';
import TIAPage from './TIAPage';
import SolutionPage from './SolutionPage';
import CodeErrorPage from './CodeErrorPage';
import HeatmapPage from './HeatmapPage';
import { suppressResizeObserverErrors } from './utils/errorHandler';
import './index.css';
import './theme.css';

// Подавляем ResizeObserver ошибки
suppressResizeObserverErrors();


const projects = [
  { id: 2, name: 'NPP' },
  { id: 3, name: 'DBO-X' },
  { id: 4, name: 'SBK' },
  { id: 5, name: 'KCBFL' },
  { id: 6, name: 'KCB' },
  { id: 34, name: 'USB' },
  { id: 166, name: 'Test - JMT' },
  { id: 305, name: 'АФБ' },
  { id: 308, name: 'LKPFL' },
  { id: 309, name: 'ККБ-ЮЛ 2.0' },
  { id: 307, name: 'NC' }
];

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ThemeProvider>
    <Router>
      <div className="app-layout">
        <main className="app-layout__main">
          <Routes>
            <Route path="/" element={<App projects={projects} />} />
            <Route path="/tia" element={<TIAPage projects={projects} />} />
            <Route path="/code-error" element={<CodeErrorPage projects={projects} />} />
            <Route path="/heatmap" element={<HeatmapPage projects={projects} />} />
            <Route
              path="/solution"
              element={<SolutionPage projects={projects} />} />
          </Routes>
        </main>
        <footer className="app-footer">
          <div className="app-footer__links">
            <a
              href="https://jira.abanking.ru/secure/CreateIssueDetails!init.jspa?pid=10201&issuetype=10103&components=21300&summary=QA-helper:"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-link app-footer__link"
            >
              Предложить улучшение
            </a>
            <span className="app-footer__separator">·</span>
            <a
              href="https://jira.abanking.ru/secure/CreateIssue.jspa?issuetype=13101&pid=10201&components=21300&summary=QA-helper:"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-link app-footer__link"
            >
              Сообщить о проблеме
            </a>
          </div>
          <ThemeToggle />
        </footer>
      </div>
    </Router>
  </ThemeProvider>
);