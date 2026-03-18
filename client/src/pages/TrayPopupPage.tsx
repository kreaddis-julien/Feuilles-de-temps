import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TimesheetDay, TimesheetEntry, ActivitiesData, CustomersData } from '../types';
import * as api from '../api';
import { Play, Pause, Square, Trash2, Plus, X, Clock } from 'lucide-react';

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

async function updateTrayTitle(text: string) {
  if (!isTauri) return;
  try {
    await invoke('set_tray_title', { title: text });
  } catch { /* ignore outside Tauri */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function parseTimestamp(value: string): Date {
  if (value.includes('T')) return new Date(value);
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeElapsedSeconds(entry: TimesheetEntry): number {
  let totalSec = 0;
  for (const seg of entry.segments) {
    const startMs = parseTimestamp(seg.start).getTime();
    if (seg.end) {
      totalSec += Math.floor((parseTimestamp(seg.end).getTime() - startMs) / 1000);
    } else {
      totalSec += Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    }
  }
  return totalSec;
}

function resolveActivityName(activityId: string, activities: ActivitiesData): string {
  return activities.activities.find(a => a.id === activityId)?.name ?? '';
}

function entryLabel(entry: TimesheetEntry, activities: ActivitiesData): string {
  const name = resolveActivityName(entry.activityId, activities);
  if (name) return name;
  const startTime = entry.segments[0]?.start;
  if (startTime) {
    const d = parseTimestamp(startTime);
    return `Démarré à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return 'Timer';
}

function activityOptionLabel(activity: { name: string; customerId: string }, customersList: { id: string; name: string }[]): string {
  const customer = customersList.find(c => c.id === activity.customerId);
  return customer ? `${customer.name} - ${activity.name}` : activity.name;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrayPopupPage() {
  const [day, setDay] = useState<TimesheetDay | null>(null);
  const [activities, setActivities] = useState<ActivitiesData>({ activities: [] });
  const [customers, setCustomers] = useState<CustomersData>({ customers: [] });
  const [elapsedMap, setElapsedMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [currentDate] = useState(todayStr);
  const [showNewTimer, setShowNewTimer] = useState(false);
  const [newActivityId, setNewActivityId] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [t, a, c] = await Promise.all([api.getTimesheet(currentDate), api.getActivities(), api.getCustomers()]);
      setDay(t);
      setActivities(a);
      setCustomers(c);
    } catch { /* ignore */ }
  }, [currentDate]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const activeEntries: TimesheetEntry[] =
    day?.activeEntries
      ?.map(id => day.entries.find(e => e.id === id))
      .filter((e): e is TimesheetEntry => !!e) ?? [];
  const pausedEntries: TimesheetEntry[] =
    day?.pausedEntries
      .map(id => day.entries.find(e => e.id === id))
      .filter((e): e is TimesheetEntry => !!e) ?? [];

  // Elapsed ticker
  useEffect(() => {
    if (activeEntries.length === 0) {
      setElapsedMap({});
      if (pausedEntries.length > 0) {
        updateTrayTitle('⏸');
      } else {
        updateTrayTitle('');
      }
      return;
    }
    function tick() {
      const map: Record<string, number> = {};
      for (const entry of activeEntries) {
        map[entry.id] = computeElapsedSeconds(entry);
      }
      setElapsedMap(map);
      if (activeEntries.length === 1) {
        updateTrayTitle(formatTimer(map[activeEntries[0].id] ?? 0));
      } else {
        updateTrayTitle(`${activeEntries.length} actifs`);
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeEntries.length, activeEntries.map(e => e.id).join(','), pausedEntries.length]);

  // Close popup when window loses focus
  useEffect(() => {
    const handleBlur = () => {
      if (isTauri) {
        invoke('close_tray_popup').catch(() => {});
      }
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  async function close() {
    await invoke('close_tray_popup').catch(() => {});
  }

  async function handlePause(entry: TimesheetEntry) {
    setLoading(true);
    try {
      await api.pauseEntry(currentDate, entry.id);
      await refresh();
    } finally { setLoading(false); }
  }

  async function handleFinish(entry: TimesheetEntry) {
    setLoading(true);
    try {
      await api.updateEntry(currentDate, entry.id, { status: 'completed' });
      await refresh();
    } finally { setLoading(false); }
  }

  async function handleCancel(entry: TimesheetEntry) {
    setLoading(true);
    try {
      await api.deleteEntry(currentDate, entry.id);
      await refresh();
    } finally { setLoading(false); }
  }

  async function handleResume(id: string) {
    setLoading(true);
    try {
      await api.resumeEntry(currentDate, id);
      await refresh();
    }
    finally { setLoading(false); }
  }

  async function handleQuickStart() {
    setLoading(true);
    try {
      await api.createEntry(currentDate, { activityId: '', description: '' });
      await refresh();
    }
    finally { setLoading(false); }
  }

  async function handleCreateWithDetails() {
    setLoading(true);
    try {
      await api.createEntry(currentDate, { activityId: newActivityId, description: newDescription });
      setShowNewTimer(false);
      setNewActivityId('');
      setNewDescription('');
      await refresh();
    } finally { setLoading(false); }
  }

  const sortedActivities = [...activities.activities]
    .map(a => ({ ...a, label: activityOptionLabel(a, customers.customers) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div
      className="flex flex-col h-screen bg-popover text-foreground select-none overflow-hidden"
      style={{ borderRadius: '12px' }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Tempo</span>
        </div>
        <button
          onClick={close}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Active timer ────────────────────────────────────────────────── */}
        {activeEntries.length > 0 ? (
          <div>
            {activeEntries.map(entry => (
              <div key={entry.id} className="p-4 border-b border-border">
                <div className="flex items-center gap-2 mb-1">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">En cours</p>
                </div>
                <p className="text-sm font-semibold truncate mb-4 mt-1 text-foreground">
                  {entryLabel(entry, activities)}
                </p>

                <div className="flex justify-center mb-5">
                  <span
                    className="font-mono text-5xl font-bold tabular-nums tracking-tight text-foreground"
                    style={{ letterSpacing: '-0.02em' }}
                  >
                    {formatTimer(elapsedMap[entry.id] ?? 0)}
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handlePause(entry)}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border border-border bg-card hover:bg-accent transition-all duration-150 disabled:opacity-50"
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </button>
                  <button
                    onClick={() => handleFinish(entry)}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-all duration-150 disabled:opacity-50"
                  >
                    <Square className="h-4 w-4" />
                    Terminer
                  </button>
                  <button
                    onClick={() => handleCancel(entry)}
                    disabled={loading}
                    title="Annuler"
                    className="flex items-center justify-center p-2.5 rounded-xl border border-destructive/30 text-destructive hover:bg-destructive/10 transition-all duration-150 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center border-b border-border">
            <p className="text-sm text-muted-foreground mb-1">Aucun timer en cours</p>
          </div>
        )}

        {/* ── Paused timers ───────────────────────────────────────────────── */}
        {pausedEntries.length > 0 && (
          <div className="px-2 py-2">
            <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              En pause
            </p>
            {pausedEntries.map(entry => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 px-2 py-2.5 rounded-xl hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
                  <span className="text-sm truncate">{entryLabel(entry, activities)}</span>
                  <span className="text-xs text-muted-foreground shrink-0 font-mono">
                    {formatDuration(entry.totalMinutes)}
                  </span>
                </div>
                <button
                  onClick={() => handleResume(entry.id)}
                  disabled={loading}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-150 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" />
                  Reprendre
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer: new timer ───────────────────────────────────────────── */}
      <div className="border-t border-border p-2">
        <div className="flex gap-2">
          <button
            onClick={handleQuickStart}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150 disabled:opacity-50 group"
          >
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <Plus className="h-3 w-3 text-primary" />
            </div>
            Nouveau timer
          </button>
          <button
            onClick={() => setShowNewTimer(v => !v)}
            disabled={loading}
            title="Choisir activité & description"
            className="shrink-0 flex items-center justify-center px-3 py-3 rounded-xl text-sm font-semibold border border-border bg-card hover:bg-accent transition-all duration-150 disabled:opacity-50"
          >
            <span className="text-xs">Détails</span>
          </button>
        </div>
      </div>

      {showNewTimer && (
        <div
          className="absolute inset-0 bg-background/40 backdrop-blur-sm flex items-end"
          style={{ borderRadius: '12px' }}
        >
          <div className="w-full bg-popover border-t border-border p-3" style={{ borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Nouveau timer</p>
              <button
                onClick={() => setShowNewTimer(false)}
                className="flex items-center justify-center w-7 h-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Activité</label>
                <select
                  value={newActivityId}
                  onChange={e => setNewActivityId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm"
                >
                  <option value="">Aucune</option>
                  {sortedActivities.map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Description</label>
                <input
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="(optionnel)"
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm"
                />
              </div>
              <button
                onClick={handleCreateWithDetails}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-all duration-150 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                Démarrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
