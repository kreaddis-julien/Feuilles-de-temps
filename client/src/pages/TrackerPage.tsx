import { useState, useEffect, useCallback, useRef } from 'react';
import type { TimesheetDay, TimesheetEntry, ActivitiesData, CustomersData } from '../types';
import * as api from '../api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Play, Pause, CircleStop, Trash2, RotateCcw, CalendarDays } from 'lucide-react';

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

async function updateTrayTitle(text: string) {
  if (!isTauri) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_tray_title', { title: text });
  } catch { /* ignore outside Tauri */ }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function entryLabel(entry: TimesheetEntry, activities: { id: string; name: string; customerId: string }[], customersList: { id: string; name: string }[]): string {
  const activity = activities.find(a => a.id === entry.activityId);
  if (activity) return activityOptionLabel(activity, customersList);
  const startTime = entry.segments[0]?.start;
  if (startTime) {
    const d = parseTimestamp(startTime);
    return `Timer démarré à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return 'Timer';
}

function activityOptionLabel(activity: { name: string; customerId: string }, customersList: { id: string; name: string }[]): string {
  const customer = customersList.find(c => c.id === activity.customerId);
  return customer ? `${customer.name} - ${activity.name}` : activity.name;
}

function resolveCustomerName(activityId: string, activitiesList: { id: string; customerId: string }[], customersList: { id: string; name: string }[]): string {
  const activity = activitiesList.find(a => a.id === activityId);
  if (!activity) return '';
  return customersList.find(c => c.id === activity.customerId)?.name ?? '';
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateFR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  return `${days[date.getDay()]}. ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function parseTimestamp(value: string): Date {
  if (value.includes('T')) return new Date(value);
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrackerPage() {
  const [currentDate, setCurrentDate] = useState(todayStr);
  const [day, setDay] = useState<TimesheetDay | null>(null);
  const [activities, setActivities] = useState<ActivitiesData>({ activities: [] });
  const [customers, setCustomers] = useState<CustomersData>({ customers: [] });
  const [elapsedMap, setElapsedMap] = useState<Record<string, number>>({});
  const [editingEntry, setEditingEntry] = useState<TimesheetEntry | null>(null);
  const [editActivityId, setEditActivityId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMinutes, setEditMinutes] = useState('');

  const syncChannel = useRef(new BroadcastChannel('tempo-sync'));

  const refresh = useCallback(async (notify = false) => {
    const [t, a, c] = await Promise.all([
      api.getTimesheet(currentDate),
      api.getActivities(),
      api.getCustomers(),
    ]);
    setDay(t);
    setActivities(a);
    setCustomers(c);
    if (notify) syncChannel.current.postMessage('refresh');
  }, [currentDate]);

  useEffect(() => { refresh(); }, [refresh]);
  // Listen for cross-window sync events (from popup/navbar)
  useEffect(() => {
    syncChannel.current.onmessage = () => refresh();
  }, [refresh]);
  useEffect(() => { localStorage.setItem('trackerDate', currentDate); }, [currentDate]);

  function shiftDate(offset: number) {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(y, m - 1, d + offset);
    setCurrentDate(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    );
  }

  const activeEntries: TimesheetEntry[] =
    day?.activeEntries
      ?.map(id => day.entries.find(e => e.id === id))
      .filter((e): e is TimesheetEntry => !!e) ?? [];

  const pausedEntries: TimesheetEntry[] =
    day?.pausedEntries
      .map(id => day.entries.find(e => e.id === id))
      .filter((e): e is TimesheetEntry => !!e) ?? [];

  useEffect(() => {
    if (activeEntries.length === 0) {
      setElapsedMap({});
      updateTrayTitle(pausedEntries.length > 0 ? '⏸' : '');
      return;
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

  const completedEntries: TimesheetEntry[] =
    day?.entries.filter(e => e.status === 'completed') ?? [];

  const completedMinutes = completedEntries.reduce((s, e) => s + e.roundedMinutes, 0);
  const activeMinutes = activeEntries.reduce((sum, e) => sum + Math.round((elapsedMap[e.id] ?? 0) / 60), 0);
  const totalMinutes = completedMinutes + activeMinutes;
  const TARGET = 420;
  const progressPct = Math.min(100, (totalMinutes / TARGET) * 100);

  async function handlePause(entry: TimesheetEntry) {
    if (!day) return;
    await api.updateEntry(currentDate, entry.id, {
      description: entry.description,
      activityId: entry.activityId,
    });
    await api.pauseEntry(currentDate, entry.id);
    await refresh(true);
  }

  async function handleFinish(entry: TimesheetEntry) {
    if (!day) return;
    await api.updateEntry(currentDate, entry.id, {
      description: entry.description,
      activityId: entry.activityId,
    });
    await api.updateEntry(currentDate, entry.id, { status: 'completed' });
    await refresh(true);
  }

  async function handleResume(id: string) {
    await api.resumeEntry(currentDate, id);
    await refresh(true);
  }

  async function handleDuplicate(entry: TimesheetEntry) {
    await api.createEntry(currentDate, {
      activityId: entry.activityId,
      description: entry.description,
    });
    await refresh(true);
  }

  async function handleDeleteEntry(id: string) {
    await api.deleteEntry(currentDate, id);
    await refresh(true);
  }

  async function handleQuickStart() {
    await api.createEntry(currentDate, { activityId: '', description: '' });
    await refresh(true);
  }

  function openEditModal(entry: TimesheetEntry) {
    setEditingEntry(entry);
    setEditActivityId(entry.activityId);
    setEditDescription(entry.description);
    setEditMinutes(String(entry.roundedMinutes));
  }

  async function saveEditModal() {
    if (!editingEntry) return;
    const updates: Record<string, unknown> = {};
    if (editActivityId !== editingEntry.activityId) updates.activityId = editActivityId;
    if (editDescription !== editingEntry.description) updates.description = editDescription;
    const parsedMin = parseInt(editMinutes, 10);
    if (!isNaN(parsedMin) && parsedMin !== editingEntry.roundedMinutes) updates.roundedMinutes = parsedMin;
    if (Object.keys(updates).length > 0) {
      await api.updateEntry(currentDate, editingEntry.id, updates);
      await refresh(true);
    }
    setEditingEntry(null);
  }

  const sortedActivities = [...activities.activities]
    .map(a => ({ ...a, label: activityOptionLabel(a, customers.customers) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!day) return <div className="text-center text-muted-foreground py-12">Chargement...</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ===== Date Navigation ===== */}
      <div className="relative flex items-center justify-center gap-4">
        <Button variant="outline" size="icon" onClick={() => shiftDate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-base font-semibold tabular-nums min-w-[12em] text-center">
          {formatDateFR(currentDate)}
        </span>
        <Button variant="outline" size="icon" onClick={() => shiftDate(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {currentDate !== todayStr() && (
          <Button variant="outline" size="sm" className="absolute right-0" onClick={() => setCurrentDate(todayStr())}>
            <CalendarDays className="h-3.5 w-3.5" />
            Aujourd'hui
          </Button>
        )}
      </div>

      {/* ===== Progress Bar ===== */}
      <div>
        <Progress value={progressPct} />
        <p className="text-center mt-1.5 text-sm font-medium tabular-nums text-muted-foreground">
          {formatDuration(totalMinutes)} / {formatDuration(TARGET)}
        </p>
      </div>

      {/* ===== Active Tasks ===== */}
      {activeEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">En cours</h2>
          {activeEntries.map(entry => (
            <Card key={entry.id} className="border-primary bg-primary/5 gap-4 py-5">
              <CardContent className="space-y-3">
                <select
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  value={entry.activityId}
                  onChange={async (e) => {
                    await api.updateEntry(currentDate, entry.id, { activityId: e.target.value });
                    await refresh(true);
                  }}
                >
                  <option value="">-- Activité --</option>
                  {sortedActivities.map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
                <Input
                  placeholder="Description..."
                  value={entry.description}
                  onChange={async (e) => {
                    setDay(prev => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        entries: prev.entries.map(ent =>
                          ent.id === entry.id ? { ...ent, description: e.target.value } : ent
                        ),
                      };
                    });
                  }}
                  onBlur={async (e) => {
                    await api.updateEntry(currentDate, entry.id, { description: e.target.value });
                  }}
                />
                <div className="font-mono text-4xl font-semibold text-primary text-center tabular-nums tracking-wide py-1">
                  {formatTimer(elapsedMap[entry.id] ?? 0)}
                </div>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={() => handlePause(entry)}>
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                  <Button onClick={() => handleFinish(entry)}>
                    <CircleStop className="h-4 w-4" />
                    Terminer
                  </Button>
                  <Button variant="destructive" onClick={() => handleDeleteEntry(entry.id)}>
                    <Trash2 className="h-4 w-4" />
                    Annuler
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* ===== Paused Tasks ===== */}
      {pausedEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">En pause</h2>
          <div className="space-y-2">
            {pausedEntries.map(entry => (
              <Card key={entry.id} className="border-warning bg-warning/5 py-3 gap-0">
                <CardContent className="flex items-center justify-between">
                  <span className="text-sm">
                    <strong className="font-semibold">{entryLabel(entry, activities.activities, customers.customers)}</strong>
                    {' '}({formatDuration(entry.totalMinutes)})
                  </span>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => handleResume(entry.id)}>
                      <Play className="h-3.5 w-3.5" />
                      Reprendre
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteEntry(entry.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Annuler
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ===== Quick Start ===== */}
      <div className="text-center">
        <Button size="lg" onClick={handleQuickStart} className="text-base font-semibold px-8">
          <Play className="h-5 w-5" />
          Lancer une nouvelle feuille de temps
        </Button>
      </div>

      {/* ===== Completed Entries ===== */}
      {completedEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Terminées</h2>
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[15%]">Client</TableHead>
                <TableHead className="w-[18%]">Activité</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[4.5rem]">Durée</TableHead>
                <TableHead className="w-[5.5rem]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completedEntries.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="truncate">
                    {resolveCustomerName(entry.activityId, activities.activities, customers.customers) || '—'}
                  </TableCell>
                  <TableCell className="truncate">
                    <span
                      className="cursor-pointer border-b border-dashed border-border hover:bg-accent px-1 py-0.5 rounded-sm transition-colors"
                      onClick={() => openEditModal(entry)}
                    >
                      {entryLabel(entry, activities.activities, customers.customers) || '—'}
                    </span>
                  </TableCell>
                  <TableCell className="truncate">
                    <span
                      className="cursor-pointer border-b border-dashed border-border hover:bg-accent px-1 py-0.5 rounded-sm transition-colors"
                      onClick={() => openEditModal(entry)}
                    >
                      {entry.description || '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="cursor-pointer border-b border-dashed border-border hover:bg-accent px-1 py-0.5 rounded-sm transition-colors"
                      onClick={() => openEditModal(entry)}
                    >
                      {formatDuration(entry.roundedMinutes)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="outline" size="icon-xs" onClick={() => handleDuplicate(entry)} title="Relancer">
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      <Button variant="destructive" size="icon-xs" onClick={() => handleDeleteEntry(entry.id)} title="Supprimer">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {/* ===== Edit Modal ===== */}
      <Dialog open={!!editingEntry} onOpenChange={(open) => { if (!open) setEditingEntry(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'entrée</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Activité</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={editActivityId}
                onChange={e => setEditActivityId(e.target.value)}
              >
                <option value="">-- Activité --</option>
                {sortedActivities.map(a => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <Textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Durée (minutes)</label>
              <Input
                type="number"
                value={editMinutes}
                onChange={e => setEditMinutes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>Annuler</Button>
            <Button onClick={saveEditModal}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
