import { useState, useEffect, useCallback } from 'react';
import type { TimesheetDay, TimesheetEntry, Project, ProjectsData, Category } from '../types';
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

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function currentTimeMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function resolveProjectName(projectId: string, projects: Project[]): string {
  return projects.find(p => p.id === projectId)?.name ?? projectId;
}

function resolveTaskName(projectId: string, taskId: string, projects: Project[]): string {
  const project = projects.find(p => p.id === projectId);
  return project?.tasks.find(t => t.id === taskId)?.name ?? taskId;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

/** Parse an HH:mm string into a Date object for today. */
function parseTimeToday(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
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
  const [projects, setProjects] = useState<ProjectsData>({ projects: [] });

  // New task form
  const [formOpen, setFormOpen] = useState(false);
  const [formProjectId, setFormProjectId] = useState('');
  const [formTaskId, setFormTaskId] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Live timer
  const [elapsed, setElapsed] = useState(0);

  // Inline editing
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [editingDescValue, setEditingDescValue] = useState('');
  const [editingMinId, setEditingMinId] = useState<string | null>(null);
  const [editingMinValue, setEditingMinValue] = useState('');

  // ---- Data loading ---------------------------------------------------------
  const refresh = useCallback(async () => {
    const [t, p] = await Promise.all([
      api.getTimesheet(currentDate),
      api.getProjects(),
    ]);
    setDay(t);
    setProjects(p);
  }, [currentDate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- Date navigation ------------------------------------------------------
  function shiftDate(offset: number) {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() + offset);
    setCurrentDate(d.toISOString().split('T')[0]);
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
      const openSegment = activeEntry.segments.find(s => s.end === null);
      if (!openSegment) return activeEntry.totalMinutes * 60;
      const startMs = parseTimeToday(openSegment.start).getTime();
      const nowMs = Date.now();
      const segmentSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      return activeEntry.totalMinutes * 60 + segmentSeconds;
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
  const TARGET = 480;
  const progressPct = Math.min(100, (totalMinutes / TARGET) * 100);

  // ---- Handlers -------------------------------------------------------------

  async function handlePauseAndInterrupt() {
    if (!day || !activeEntry) return;
    await api.pauseEntry(currentDate, activeEntry.id);
    await refresh();
    setFormOpen(true);
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

  async function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!formProjectId || !formTaskId) return;
    await api.createEntry(currentDate, {
      projectId: formProjectId,
      taskId: formTaskId,
      description: formDescription,
    });
    setFormProjectId('');
    setFormTaskId('');
    setFormDescription('');
    setFormOpen(false);
    await refresh();
  }

  async function handleAddProjectInline() {
    const name = window.prompt('Nom du nouveau projet :');
    if (!name?.trim()) return;
    const category = window.prompt('Catégorie (client, interne, support) :') as Category | null;
    if (!category?.trim() || !['client', 'interne', 'support'].includes(category)) return;
    const created = await api.createProject({ name: name.trim(), category: category.trim() });
    await refresh();
    setFormProjectId(created.id);
    setFormTaskId('');
  }

  async function handleAddTaskInline() {
    if (!formProjectId) {
      window.alert('Sélectionnez d\'abord un projet.');
      return;
    }
    const name = window.prompt('Nom de la nouvelle tâche :');
    if (!name?.trim()) return;
    await api.addTask(formProjectId, { name: name.trim() });
    await refresh();
  }

  // Save inline edits for description
  async function saveDescription(entry: TimesheetEntry) {
    if (editingDescValue !== entry.description) {
      await api.updateEntry(currentDate, entry.id, { description: editingDescValue });
      await refresh();
    }
    setEditingDescId(null);
  }

  // Save inline edits for rounded minutes
  async function saveRoundedMinutes(entry: TimesheetEntry) {
    const parsed = parseInt(editingMinValue, 10);
    if (!isNaN(parsed) && parsed !== entry.roundedMinutes) {
      await api.updateEntry(currentDate, entry.id, { roundedMinutes: parsed });
      await refresh();
    }
    setEditingMinId(null);
  }

  // ---- Derived: tasks for selected project ----------------------------------
  const selectedProject = projects.projects.find(p => p.id === formProjectId);
  const availableTasks = selectedProject?.tasks ?? [];

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
              <strong>{resolveProjectName(activeEntry.projectId, projects.projects)}</strong>
              {' — '}
              {resolveTaskName(activeEntry.projectId, activeEntry.taskId, projects.projects)}
              {activeEntry.description && (
                <div className="active-description">{activeEntry.description}</div>
              )}
            </div>
            <div className="timer">{formatTimer(elapsed)}</div>
            <div className="active-actions">
              <button onClick={handlePauseAndInterrupt}>Pause &amp; Interruption</button>
              <button onClick={handleFinish}>Terminer</button>
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
                <strong>{resolveProjectName(entry.projectId, projects.projects)}</strong>
                {' — '}
                {resolveTaskName(entry.projectId, entry.taskId, projects.projects)}
                {' '}
                ({formatDuration(entry.totalMinutes)})
              </span>
              <button onClick={() => handleResume(entry.id)}>Reprendre</button>
            </div>
          ))}
        </section>
      )}

      {/* ===== New Task Form ===== */}
      <section className="new-task-section">
        <button onClick={() => setFormOpen(o => !o)}>
          {formOpen ? '▼ Nouvelle tâche' : '▶ Nouvelle tâche'}
        </button>
        {formOpen && (
          <form onSubmit={handleCreateEntry} className="new-task-form">
            <div className="form-row">
              <label>Projet</label>
              <select
                value={formProjectId}
                onChange={e => {
                  setFormProjectId(e.target.value);
                  setFormTaskId('');
                }}
              >
                <option value="">-- Choisir --</option>
                {projects.projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button type="button" onClick={handleAddProjectInline} title="Créer un projet">+</button>
            </div>

            <div className="form-row">
              <label>Tâche</label>
              <select
                value={formTaskId}
                onChange={e => setFormTaskId(e.target.value)}
                disabled={!formProjectId}
              >
                <option value="">-- Choisir --</option>
                {availableTasks.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button type="button" onClick={handleAddTaskInline} title="Créer une tâche" disabled={!formProjectId}>+</button>
            </div>

            <div className="form-row">
              <label>Description</label>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                rows={2}
              />
            </div>

            <button type="submit" disabled={!formProjectId || !formTaskId}>
              Démarrer
            </button>
          </form>
        )}
      </section>

      {/* ===== Completed Entries ===== */}
      {completedEntries.length > 0 && (
        <section className="completed-section">
          <h2>Terminées</h2>
          <table className="completed-table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Tâche</th>
                <th>Description</th>
                <th>Durée</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {completedEntries.map(entry => (
                <tr key={entry.id}>
                  <td>{resolveProjectName(entry.projectId, projects.projects)}</td>
                  <td>{resolveTaskName(entry.projectId, entry.taskId, projects.projects)}</td>
                  <td>
                    {editingDescId === entry.id ? (
                      <input
                        type="text"
                        value={editingDescValue}
                        onChange={e => setEditingDescValue(e.target.value)}
                        onBlur={() => saveDescription(entry)}
                        onKeyDown={e => { if (e.key === 'Enter') saveDescription(entry); }}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="editable"
                        onClick={() => {
                          setEditingDescId(entry.id);
                          setEditingDescValue(entry.description);
                        }}
                      >
                        {entry.description || '—'}
                      </span>
                    )}
                  </td>
                  <td>
                    {editingMinId === entry.id ? (
                      <input
                        type="number"
                        value={editingMinValue}
                        onChange={e => setEditingMinValue(e.target.value)}
                        onBlur={() => saveRoundedMinutes(entry)}
                        onKeyDown={e => { if (e.key === 'Enter') saveRoundedMinutes(entry); }}
                        autoFocus
                        style={{ width: '5em' }}
                      />
                    ) : (
                      <span
                        className="editable"
                        onClick={() => {
                          setEditingMinId(entry.id);
                          setEditingMinValue(String(entry.roundedMinutes));
                        }}
                      >
                        {formatDuration(entry.roundedMinutes)}
                      </span>
                    )}
                  </td>
                  <td>
                    <button onClick={() => handleDeleteEntry(entry.id)} className="btn-danger">
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ===== Export ===== */}
      <section className="export-section">
        <button onClick={() => window.open(api.getExportUrl(currentDate), '_blank')}>
          Exporter CSV
        </button>
      </section>
    </div>
  );
}
