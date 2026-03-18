import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimesheetDay, TimesheetEntry, ActivitiesData, CustomersData } from '../types';
import * as api from '../api';
import { Play, Pause, CircleStop, Trash2, Plus, Timer, ChevronDown } from 'lucide-react';

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

function activityOptionLabel(activity: { name: string; customerId: string }, customersList: { id: string; name: string }[]): string {
  const customer = customersList.find(c => c.id === activity.customerId);
  return customer ? `${customer.name} - ${activity.name}` : activity.name;
}

function entryLabel(entry: TimesheetEntry, activities: ActivitiesData, customersList: { id: string; name: string }[]): string {
  const activity = activities.activities.find(a => a.id === entry.activityId);
  if (activity) return activityOptionLabel(activity, customersList);
  const startTime = entry.segments[0]?.start;
  if (startTime) {
    const d = parseTimestamp(startTime);
    return `Démarré à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return 'Timer';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NavTimerWidget() {
  const [day, setDay] = useState<TimesheetDay | null>(null);
  const [activities, setActivities] = useState<ActivitiesData>({ activities: [] });
  const [customers, setCustomers] = useState<CustomersData>({ customers: [] });
  const [elapsedMap, setElapsedMap] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentDate, setCurrentDate] = useState(todayStr);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const syncChannel = useRef(new BroadcastChannel('tempo-sync'));

  const refresh = useCallback(async (dateOrNotify?: string | boolean) => {
    const notify = typeof dateOrNotify === 'boolean' ? dateOrNotify : false;
    const d = typeof dateOrNotify === 'string' ? dateOrNotify : currentDate;
    try {
      const [t, a, c] = await Promise.all([
        api.getTimesheet(d),
        api.getActivities(),
        api.getCustomers(),
      ]);
      setDay(t);
      setActivities(a);
      setCustomers(c);
      if (notify) syncChannel.current.postMessage('refresh');
    } catch {
      // silently ignore errors (server might not be ready)
    }
  }, [currentDate]);

  // Sync with localStorage trackerDate
  useEffect(() => {
    function syncDate() {
      const stored = localStorage.getItem('trackerDate') || todayStr();
      setCurrentDate(stored);
    }
    syncDate();
    const id = setInterval(syncDate, 2000);
    return () => clearInterval(id);
  }, []);

  // Listen for cross-window sync + poll as fallback
  useEffect(() => {
    syncChannel.current.onmessage = () => refresh();
  }, [refresh]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // Elapsed ticker for active entries
  const activeEntries: TimesheetEntry[] =
    day?.activeEntries
      ?.map(id => day.entries.find(e => e.id === id))
      .filter((e): e is TimesheetEntry => !!e) ?? [];
  useEffect(() => {
    if (activeEntries.length === 0) { setElapsedMap({}); return; }
    function tick() {
      const map: Record<string, number> = {};
      for (const entry of activeEntries) {
        map[entry.id] = computeElapsedSeconds(entry);
      }
      setElapsedMap(map);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeEntries.length, activeEntries.map(e => e.id).join(',')]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const pausedEntries: TimesheetEntry[] =
    day?.pausedEntries
      .map(id => day.entries.find(e => e.id === id))
      .filter((e): e is TimesheetEntry => !!e) ?? [];

  async function handlePause(entry: TimesheetEntry) {
    if (!day) return;
    setLoading(true);
    try {
      await api.pauseEntry(currentDate, entry.id);
      await refresh(true);
    } finally { setLoading(false); }
  }

  async function handleFinish(entry: TimesheetEntry) {
    if (!day) return;
    setLoading(true);
    try {
      await api.updateEntry(currentDate, entry.id, { status: 'completed' });
      await refresh(true);
    } finally { setLoading(false); }
  }

  async function handleCancel(entry: TimesheetEntry) {
    if (!day) return;
    setLoading(true);
    try {
      await api.deleteEntry(currentDate, entry.id);
      await refresh(true);
    } finally { setLoading(false); }
  }

  async function handleResume(id: string) {
    setLoading(true);
    try {
      await api.resumeEntry(currentDate, id);
      await refresh(true);
    } finally { setLoading(false); }
  }

  async function handleQuickStart() {
    setLoading(true);
    try {
      await api.createEntry(currentDate, { activityId: '', description: '' });
      await refresh(true);
    } finally { setLoading(false); }
  }

  const hasActive = activeEntries.length > 0;
  const hasPaused = pausedEntries.length > 0;
  const hasAnything = hasActive || hasPaused;

  // If nothing running, just show a subtle "start" button
  if (!hasAnything && !open) {
    return (
      <button
        onClick={async () => { await handleQuickStart(); setOpen(true); }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150 border border-transparent hover:border-border"
        title="Lancer un timer"
      >
        <Timer className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Timer</span>
      </button>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      {/* ── Trigger button ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border ${
          hasActive
            ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
            : 'bg-warning/10 border-warning/30 text-warning-foreground hover:bg-warning/15'
        }`}
      >
        {/* Pulsing dot */}
        <span className="relative flex h-2 w-2">
          {hasActive && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${hasActive ? 'bg-primary' : 'bg-warning'}`} />
        </span>

        {/* Timer or paused label */}
        <span className="font-mono tabular-nums tracking-wide">
          {hasActive
            ? (activeEntries.length === 1
              ? formatTimer(elapsedMap[activeEntries[0].id] ?? 0)
              : `${activeEntries.length} actifs`)
            : `${pausedEntries.length} en pause`}
        </span>

        <ChevronDown
          className={`h-3.5 w-3.5 opacity-60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] w-80 rounded-2xl border border-border bg-popover shadow-2xl backdrop-blur-sm overflow-hidden z-[100]"
          style={{ animation: 'timerDropdownIn 0.18s cubic-bezier(0.16,1,0.3,1)' }}
        >
          {/* Active timers */}
          {activeEntries.length > 0 && (
            <div>
              {activeEntries.map(entry => (
                <div key={entry.id} className="p-4 border-b border-border">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
                      En cours
                    </p>
                  </div>

                  <p className="text-sm font-semibold truncate mb-3 text-foreground">
                    {entryLabel(entry, activities, customers.customers)}
                  </p>

                  <div className="text-center mb-4">
                    <span className="font-mono text-4xl font-bold tabular-nums tracking-tight text-foreground">
                      {formatTimer(elapsedMap[entry.id] ?? 0)}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePause(entry)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-border bg-card hover:bg-accent transition-all duration-150 disabled:opacity-50"
                    >
                      <Pause className="h-3.5 w-3.5" />
                      Pause
                    </button>
                    <button
                      onClick={() => handleFinish(entry)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-all duration-150 disabled:opacity-50"
                    >
                      <CircleStop className="h-3.5 w-3.5" />
                      Terminer
                    </button>
                    <button
                      onClick={() => handleCancel(entry)}
                      disabled={loading}
                      title="Annuler et supprimer"
                      className="flex items-center justify-center p-2 rounded-xl text-xs font-semibold border border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive/10 transition-all duration-150 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paused timers */}
          {hasPaused && (
            <div className={`${activeEntries.length > 0 ? '' : 'pt-1'}`}>
              <p className="px-4 pt-3 pb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                En pause
              </p>
              <div className="flex flex-col gap-0.5 px-2 pb-2">
                {pausedEntries.map(entry => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-2 px-2 py-2 rounded-xl hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
                      <span className="text-sm truncate">{entryLabel(entry, activities, customers.customers)}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDuration(entry.totalMinutes)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleResume(entry.id)}
                      disabled={loading}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-150 disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      Reprendre
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New timer button */}
          <div className="border-t border-border p-2">
            <button
              onClick={handleQuickStart}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Nouveau timer
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes timerDropdownIn {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
