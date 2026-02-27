import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Download, Moon, Sun } from 'lucide-react';
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
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  function handleExport() {
    const date = localStorage.getItem('trackerDate') || todayStr();
    window.open(api.getExportUrl(date), '_blank');
  }

  return (
    <BrowserRouter>
      <nav className="flex items-center gap-1.5 px-5 h-14 bg-card border-b border-border sticky top-0 z-50">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              isActive
                ? 'text-primary bg-primary/10 font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`
          }
        >
          Feuilles de temps
        </NavLink>
        <NavLink
          to="/stats"
          className={({ isActive }) =>
            `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              isActive
                ? 'text-primary bg-primary/10 font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`
          }
        >
          Stats
        </NavLink>
        <NavLink
          to="/activities"
          className={({ isActive }) =>
            `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              isActive
                ? 'text-primary bg-primary/10 font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`
          }
        >
          Activités
        </NavLink>
        <NavLink
          to="/customers"
          className={({ isActive }) =>
            `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              isActive
                ? 'text-primary bg-primary/10 font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`
          }
        >
          Clients
        </NavLink>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="icon" onClick={handleExport} title="Exporter CSV">
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Mode sombre' : 'Mode clair'}
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </div>
      </nav>
      <main className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12">
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
