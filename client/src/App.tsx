import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, Moon, Sun, QrCode } from 'lucide-react';
import TrackerPage from './pages/TrackerPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import TrayPopupPage from './pages/TrayPopupPage';
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

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

// Inner component so we can use useLocation
function AppInner() {
  // Tauri loads the popup window with a hash: index.html#/tray-popup
  const isTrayPopup = typeof window !== 'undefined' && window.location.hash.includes('#/tray-popup');

  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [qrOpen, setQrOpen] = useState(false);
  const [mobileUrl, setMobileUrl] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!qrOpen || mobileUrl) return;
    fetch(`${api.BASE}/network`)
      .then(r => r.json())
      .then(({ ip, port }) => { if (ip) setMobileUrl(`http://${ip}:${port}`); })
      .catch(() => {});
  }, [qrOpen, mobileUrl]);

  async function handleExport() {
    const date = localStorage.getItem('trackerDate') || todayStr();
    const url = api.getExportUrl(date);
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `timesheet-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Tray popup: render just the popup page with the right theme, no navbar
  if (isTrayPopup) {
    return <TrayPopupPage />;
  }

  return (
    <>
      <nav className="relative flex items-center justify-center px-5 h-14 bg-card border-b border-border sticky top-0 z-50">
        <div className="flex gap-1.5">
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
            to="/settings"
            className={({ isActive }) =>
              `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? 'text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`
            }
          >
            Paramètres
          </NavLink>
        </div>
        <div className="absolute right-5 flex items-center gap-1.5">
          {isTauri && (
            <Button variant="outline" size="icon" onClick={() => setQrOpen(true)} title="Accès mobile">
              <QrCode className="h-4 w-4" />
            </Button>
          )}
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
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Accès mobile</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {mobileUrl ? (
              <>
                <QRCodeSVG value={mobileUrl} size={200} />
                <p className="text-sm text-muted-foreground text-center font-mono">{mobileUrl}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Recherche du réseau...</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
