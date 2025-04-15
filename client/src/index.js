// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import App from './App';
import TIAPage from './TIAPage';
import SolutionPage from './SolutionPage';

// Список проектов (можно вынести в отдельный файл, если он нужен в нескольких местах)
const projects = [
  { id: 1, name: 'Nocode' },
  { id: 2, name: 'Nopaper' },
  { id: 3, name: 'DBO-X' },
  { id: 4, name: 'Ингосстрах' },
  { id: 5, name: 'ККБ-ФЛ' },
  { id: 6, name: 'ККБ-ЮЛ' },
  { id: 7, name: 'РНКБ' },
  { id: 34, name: 'USB' },
  { id: 67, name: 'РНКБ ЛК' },
  { id: 199, name: 'Test' },
  { id: 302, name: 'Nopaper 2.0' },
  { id: 133, name: 'Дизайн система' },
  { id: 305, name: 'АФБ' },
  { id: 308, name: 'LKPFL' }
];

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <Router>
    <Routes>
      <Route path="/" element={<App projects={projects} />} />
      <Route path="/tia" element={<TIAPage projects={projects} />} />
      <Route path="/solution" element={<SolutionPage />} />
    </Routes>
  </Router>
);