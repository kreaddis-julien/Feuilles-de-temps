import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Download, Moon, Sun, QrCode, Clock, X } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import type { TimesheetEntry } from './types';
import TrackerPage from './pages/TrackerPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import ReportPage from './pages/ReportPage';
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

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

// Inner component so we can use useLocation
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function AppInner() {
  // Tauri loads the popup window with a hash: index.html#/tray-popup
  const isTrayPopup = typeof window !== 'undefined' && window.location.hash.includes('#/tray-popup');

  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [qrOpen, setQrOpen] = useState(false);
  const [mobileUrl, setMobileUrl] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportMode, setExportMode] = useState<'day' | 'week' | 'month' | 'custom' | 'all'>('week');
  const [deferredEntries, setDeferredEntries] = useState<{ date: string; entry: TimesheetEntry }[]>([]);
  const [deferredOpen, setDeferredOpen] = useState(false);
  const navigate = useNavigate();

  const syncChannel = useRef(new BroadcastChannel('tempo-sync'));
  useEffect(() => () => syncChannel.current.close(), []);

  const refreshDeferred = useCallback(async () => {
    try {
      const data = await api.getDeferred();
      setDeferredEntries(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshDeferred(); }, [refreshDeferred]);
  useEffect(() => {
    syncChannel.current.onmessage = () => refreshDeferred();
  }, [refreshDeferred]);

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

  function openExportDialog() {
    setExportMode('week');
    setExportOpen(true);
  }

  function getExportRange(): { from: string; to: string } {
    const today = todayStr();
    switch (exportMode) {
      case 'day': return { from: today, to: today };
      case 'week': { const m = mondayOf(today); return { from: m, to: addDays(m, 6) }; }
      case 'month': {
        const [y, m] = today.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${lastDay}` };
      }
      case 'all': return { from: '2020-01-01', to: today };
      case 'custom': return { from: exportFrom, to: exportTo };
    }
  }

  async function handleExport() {
    const { from, to } = getExportRange();
    const url = from === to
      ? api.getExportUrl(from)
      : api.getExportRangeUrl(from, to);
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = from === to
      ? `timesheet-${from}.csv`
      : `timesheet-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setExportOpen(false);
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
            Tempo
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
            to="/report"
            className={({ isActive }) =>
              `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? 'text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`
            }
          >
            Rapport
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
          {deferredEntries.length > 0 && (
            <Popover open={deferredOpen} onOpenChange={setDeferredOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="relative gap-1.5 text-warning-foreground border-warning/30 bg-warning/10 hover:bg-warning/15">
                  <Clock className="h-3.5 w-3.5" />
                  À reporter
                  <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-warning text-warning-foreground text-xs font-bold">
                    {deferredEntries.length}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold">À reporter dans Odoo</p>
                  <button onClick={() => setDeferredOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {deferredEntries.map(({ date, entry }) => (
                    <div
                      key={`${date}-${entry.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-accent transition-colors cursor-pointer border-b border-border last:border-0"
                      onClick={() => {
                        localStorage.setItem('trackerDate', date);
                        setDeferredOpen(false);
                        navigate('/');
                        window.dispatchEvent(new Event('storage'));
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{entry.description || '(sans description)'}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {date} · {formatDuration(entry.roundedMinutes)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {isTauri && (
            <Button variant="outline" size="icon" onClick={() => setQrOpen(true)} title="Accès mobile">
              <QrCode className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={openExportDialog} title="Exporter CSV">
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
          <Route path="/report" element={<ReportPage />} />
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
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Exporter CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'day', label: "Aujourd'hui" },
                { key: 'week', label: 'Cette semaine' },
                { key: 'month', label: 'Ce mois' },
                { key: 'all', label: 'Tout' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setExportMode(key)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    exportMode === key
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setExportMode('custom');
                const today = todayStr();
                if (!exportFrom) setExportFrom(mondayOf(today));
                if (!exportTo) setExportTo(today);
              }}
              className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                exportMode === 'custom'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              Période personnalisée
            </button>
            {exportMode === 'custom' && (
              <div className="flex items-center gap-2">
                <DatePicker value={exportFrom} onChange={setExportFrom} className="w-auto flex-1" />
                <span className="text-muted-foreground shrink-0">—</span>
                <DatePicker value={exportTo} onChange={setExportTo} className="w-auto flex-1" align="end" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExportOpen(false)}>Annuler</Button>
            <Button onClick={handleExport}>
              <Download className="h-4 w-4" />
              Exporter
            </Button>
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
