import { Router } from 'express';
import type { Storage } from '../storage.js';
import type { TimesheetEntry } from '../types.js';

export function createExportRouter(storage: Storage) {
  const router = Router();

  router.get('/:date', async (req, res) => {
    const projects = await storage.loadProjects();
    const day = await storage.loadTimesheet(req.params.date);
    const csv = buildCsv(day.entries, projects.projects, day.date);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${req.params.date}.csv`);
    res.send(csv);
  });

  router.get('/', async (req, res) => {
    const { from, to } = req.query as { from: string; to: string };
    const projects = await storage.loadProjects();
    let allRows: string[] = [];

    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const day = await storage.loadTimesheet(dateStr);
      if (day.entries.length > 0) {
        allRows.push(
          ...day.entries.map((e) => entryToCsvRow(e, projects.projects, dateStr)),
        );
      }
    }

    const csv = CSV_HEADER + '\n' + allRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${from}-to-${to}.csv`);
    res.send(csv);
  });

  return router;
}

const CSV_HEADER =
  'Date,Projet,Catégorie,Tâche,Description,Heure début,Heure fin,Durée réelle (min),Durée arrondie (min),Segments,Interruptions';

function buildCsv(
  entries: TimesheetEntry[],
  projects: { id: string; name: string; category: string; tasks: { id: string; name: string }[] }[],
  date: string,
): string {
  const rows = entries.map((e) => entryToCsvRow(e, projects, date));
  return CSV_HEADER + '\n' + rows.join('\n');
}

function entryToCsvRow(
  entry: TimesheetEntry,
  projects: { id: string; name: string; category: string; tasks: { id: string; name: string }[] }[],
  date: string,
): string {
  const project = projects.find((p) => p.id === entry.projectId);
  const task = project?.tasks.find((t) => t.id === entry.taskId);
  const firstStart = entry.segments[0]?.start ?? '';
  const lastEnd = entry.segments[entry.segments.length - 1]?.end ?? '';
  const interruptions = Math.max(0, entry.segments.length - 1);

  return [
    date,
    csvEscape(project?.name ?? entry.projectId),
    project?.category ?? '',
    csvEscape(task?.name ?? entry.taskId),
    csvEscape(entry.description),
    firstStart,
    lastEnd,
    entry.totalMinutes,
    entry.roundedMinutes,
    entry.segments.length,
    interruptions,
  ].join(',');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
