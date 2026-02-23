import { useState, useEffect, useCallback } from 'react';
import type { TimesheetDay, TimesheetEntry, ActivitiesData, CustomersData } from '../types';
import * as api from '../api';

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

function resolveActivityName(activityId: string, activities: { id: string; name: string }[]): string {
  return activities.find(a => a.id === activityId)?.name ?? '';
}

/** Human-readable label for an entry: activity name or start time fallback. */
function entryLabel(entry: TimesheetEntry, activities: { id: string; name: string }[]): string {
  const name = resolveActivityName(entry.activityId, activities);
  if (name) return name;
  const startTime = entry.segments[0]?.start;
  if (startTime) {
    const d = parseTimestamp(startTime);
    return `Timer démarré à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return 'Timer';
}

function activityOptionLabel(activity: { name: string; customerId: string }, customersList: { id: string; name: string }[]): string {
  const customer = customersList.find(c => c.id === activity.customerId);
  return customer ? `${activity.name} (${customer.name})` : activity.name;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse an ISO timestamp (or legacy HH:mm) into a Date. */
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
  // ---- State ----------------------------------------------------------------
  const [currentDate, setCurrentDate] = useState(todayStr);
  const [day, setDay] = useState<TimesheetDay | null>(null);
  const [activities, setActivities] = useState<ActivitiesData>({ activities: [] });
  const [customers, setCustomers] = useState<CustomersData>({ customers: [] });

  // Live timer
  const [elapsed, setElapsed] = useState(0);

  // Edit modal
  const [editingEntry, setEditingEntry] = useState<TimesheetEntry | null>(null);
  const [editActivityId, setEditActivityId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMinutes, setEditMinutes] = useState('');

  // ---- Data loading ---------------------------------------------------------
  const refresh = useCallback(async () => {
    const [t, a, c] = await Promise.all([
      api.getTimesheet(currentDate),
      api.getActivities(),
      api.getCustomers(),
    ]);
    setDay(t);
    setActivities(a);
    setCustomers(c);
  }, [currentDate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem('trackerDate', currentDate);
  }, [currentDate]);

  // ---- Date navigation ------------------------------------------------------
  function shiftDate(offset: number) {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(y, m - 1, d + offset);
    setCurrentDate(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    );
  }

  // ---- Active entry helpers ------------------------------------------------
  const activeEntry: TimesheetEntry | undefined =
    day?.entries.find(e => e.id === day.activeEntry);

  // Live timer effect
  useEffect(() => {
    if (!activeEntry) {
      setElapsed(0);
      return;
    }

    function computeElapsed() {
      if (!activeEntry) return 0;
      let totalSec = 0;
      for (const seg of activeEntry.segments) {
        const startMs = parseTimestamp(seg.start).getTime();
        if (seg.end) {
          totalSec += Math.floor((parseTimestamp(seg.end).getTime() - startMs) / 1000);
        } else {
          totalSec += Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        }
      }
      return totalSec;
    }

    setElapsed(computeElapsed());
    const id = setInterval(() => {
      setElapsed(computeElapsed());
    }, 1000);
    return () => clearInterval(id);
  }, [activeEntry]);

  // ---- Paused entries -------------------------------------------------------
  const pausedEntries: TimesheetEntry[] =
    day?.pausedEntries
      .map(id => day.entries.find(e => e.id === id))
      .filter((e): e is TimesheetEntry => !!e) ?? [];

  // ---- Completed entries ----------------------------------------------------
  const completedEntries: TimesheetEntry[] =
    day?.entries.filter(e => e.status === 'completed') ?? [];

  // ---- Progress bar ---------------------------------------------------------
  const completedMinutes = completedEntries.reduce((s, e) => s + e.roundedMinutes, 0);
  const activeMinutes = activeEntry ? Math.round(elapsed / 60) : 0;
  const totalMinutes = completedMinutes + activeMinutes;
  const TARGET = 420;
  const progressPct = Math.min(100, (totalMinutes / TARGET) * 100);

  // ---- Handlers -------------------------------------------------------------

  async function handlePause() {
    if (!day || !activeEntry) return;
    await api.pauseEntry(currentDate, activeEntry.id);
    await refresh();
  }

  async function handleFinish() {
    if (!day || !activeEntry) return;
    await api.updateEntry(currentDate, activeEntry.id, { status: 'completed' });
    await refresh();
  }

  async function handleResume(id: string) {
    await api.resumeEntry(currentDate, id);
    await refresh();
  }

  async function handleDeleteEntry(id: string) {
    await api.deleteEntry(currentDate, id);
    await refresh();
  }

  async function handleQuickStart() {
    await api.createEntry(currentDate, {
      activityId: '',
      description: '',
    });
    await refresh();
  }

  // Edit modal helpers
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
      await refresh();
    }
    setEditingEntry(null);
  }

  // ---- Render ---------------------------------------------------------------

  if (!day) return <div>Chargement...</div>;

  return (
    <div className="tracker-page">
      {/* ===== Date Navigation ===== */}
      <div className="date-nav">
        <button onClick={() => shiftDate(-1)}>&larr;</button>
        <span className="current-date">{currentDate}</span>
        <button onClick={() => shiftDate(1)}>&rarr;</button>
      </div>

      {/* ===== Progress Bar ===== */}
      <div className="progress-section">
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="progress-text">
          {formatDuration(totalMinutes)} / {formatDuration(TARGET)}
        </div>
      </div>

      {/* ===== Active Task ===== */}
      {activeEntry && (
        <section className="active-section">
          <h2>En cours</h2>
          <div className="active-card">
            <div className="active-info">
              <select
                value={activeEntry.activityId}
                onChange={async (e) => {
                  await api.updateEntry(currentDate, activeEntry.id, { activityId: e.target.value });
                  await refresh();
                }}
              >
                <option value="">-- Activité --</option>
                {activities.activities.map(a => (
                  <option key={a.id} value={a.id}>{activityOptionLabel(a, customers.customers)}</option>
                ))}
              </select>
              <input
                type="text"
                className="active-desc-input"
                placeholder="Description..."
                value={activeEntry.description}
                onChange={async (e) => {
                  setDay(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      entries: prev.entries.map(entry =>
                        entry.id === activeEntry.id ? { ...entry, description: e.target.value } : entry
                      ),
                    };
                  });
                }}
                onBlur={async (e) => {
                  await api.updateEntry(currentDate, activeEntry.id, { description: e.target.value });
                }}
              />
            </div>
            <div className="timer">{formatTimer(elapsed)}</div>
            <div className="active-actions">
              <button onClick={handlePause}>Pause</button>
              <button onClick={handleFinish}>Terminer</button>
              <button className="btn-danger" onClick={() => handleDeleteEntry(activeEntry.id)}>Annuler</button>
            </div>
          </div>
        </section>
      )}

      {/* ===== Paused Tasks ===== */}
      {pausedEntries.length > 0 && (
        <section className="paused-section">
          <h2>En pause</h2>
          {pausedEntries.map(entry => (
            <div key={entry.id} className="paused-card">
              <span>
                <strong>{entryLabel(entry, activities.activities)}</strong>
                {' '}
                ({formatDuration(entry.totalMinutes)})
              </span>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <button onClick={() => handleResume(entry.id)}>Reprendre</button>
                <button className="btn-danger" onClick={() => handleDeleteEntry(entry.id)}>Annuler</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ===== New Entry ===== */}
      <section className="quick-start-section">
        <button className="quick-start-btn" onClick={handleQuickStart}>
          Lancer une nouvelle feuille de temps
        </button>
      </section>

      {/* ===== Completed Entries ===== */}
      {completedEntries.length > 0 && (
        <section className="completed-section">
          <h2>Terminées</h2>
          <table className="completed-table">
            <thead>
              <tr>
                <th>Activité</th>
                <th>Description</th>
                <th>Durée</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {completedEntries.map(entry => (
                <tr key={entry.id}>
                  <td>
                    <span className="editable" onClick={() => openEditModal(entry)}>
                      {entryLabel(entry, activities.activities) || '—'}
                    </span>
                  </td>
                  <td>
                    <span className="editable" onClick={() => openEditModal(entry)}>
                      {entry.description || '—'}
                    </span>
                  </td>
                  <td>
                    <span className="editable" onClick={() => openEditModal(entry)}>
                      {formatDuration(entry.roundedMinutes)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.375rem' }}>
                      <button onClick={() => handleResume(entry.id)}>Relancer</button>
                      <button onClick={() => handleDeleteEntry(entry.id)} className="btn-danger">
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ===== Edit Modal ===== */}
      {editingEntry && (
        <div className="modal-overlay" onClick={() => setEditingEntry(null)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <h2>Modifier l'entrée</h2>
            <div className="modal-field">
              <label>Activité</label>
              <select
                value={editActivityId}
                onChange={e => setEditActivityId(e.target.value)}
              >
                <option value="">-- Activité --</option>
                {activities.activities.map(a => (
                  <option key={a.id} value={a.id}>{activityOptionLabel(a, customers.customers)}</option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label>Description</label>
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="modal-field">
              <label>Durée (minutes)</label>
              <input
                type="number"
                value={editMinutes}
                onChange={e => setEditMinutes(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setEditingEntry(null)}>Annuler</button>
              <button className="btn-primary" onClick={saveEditModal}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
