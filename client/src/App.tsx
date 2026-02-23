import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import TrackerPage from './pages/TrackerPage';
import ActivitiesPage from './pages/ActivitiesPage';
import CustomersPage from './pages/CustomersPage';
import StatsPage from './pages/StatsPage';
import * as api from './api';

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  function handleExport() {
    const date = localStorage.getItem('trackerDate') || todayStr();
    window.open(api.getExportUrl(date), '_blank');
  }

  return (
    <BrowserRouter>
      <nav>
        <NavLink to="/">Feuilles de temps</NavLink>
        <NavLink to="/stats">Stats</NavLink>
        <NavLink to="/activities">Activités</NavLink>
        <NavLink to="/customers">Clients</NavLink>
        <button className="nav-btn" onClick={handleExport} title="Exporter CSV">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3" />
            <path d="M8 2v8" />
            <path d="M5 7l3 3 3-3" />
          </svg>
        </button>
        <button
          className="nav-btn"
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          title={theme === 'light' ? 'Mode sombre' : 'Mode clair'}
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<TrackerPage />} />
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
