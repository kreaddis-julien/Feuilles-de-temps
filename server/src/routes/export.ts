import { Router } from 'express';
import type { Storage } from '../storage.js';
import type { TimesheetEntry } from '../types.js';
import { toHHmm } from '../time-utils.js';

export function createExportRouter(storage: Storage) {
  const router = Router();

  router.get('/:date', async (req, res) => {
    const activities = await storage.loadActivities();
    const customers = await storage.loadCustomers();
    const day = await storage.loadTimesheet(req.params.date);
    const csv = buildCsv(day.entries, activities.activities, customers.customers, day.date);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${req.params.date}.csv`);
    res.send(csv);
  });

  router.get('/', async (req, res) => {
    const { from, to } = req.query as { from: string; to: string };
    const activities = await storage.loadActivities();
    const customers = await storage.loadCustomers();
    let allRows: string[] = [];

    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const day = await storage.loadTimesheet(dateStr);
      if (day.entries.length > 0) {
        allRows.push(
          ...day.entries.map((e) => entryToCsvRow(e, activities.activities, customers.customers, dateStr)),
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
  'Date,Client,Type,Activité,Description,Heure début,Heure fin,Durée réelle (min),Durée arrondie (min),Segments,Interruptions';

interface ActivityRow { id: string; name: string; customerId: string }
interface CustomerRow { id: string; name: string; type: string }

function buildCsv(
  entries: TimesheetEntry[],
  activities: ActivityRow[],
  customers: CustomerRow[],
  date: string,
): string {
  const rows = entries.map((e) => entryToCsvRow(e, activities, customers, date));
  return CSV_HEADER + '\n' + rows.join('\n');
}

function entryToCsvRow(
  entry: TimesheetEntry,
  activities: ActivityRow[],
  customers: CustomerRow[],
  date: string,
): string {
  const activity = activities.find((a) => a.id === entry.activityId);
  const customer = activity ? customers.find((c) => c.id === activity.customerId) : undefined;
  const firstStart = entry.segments[0]?.start ? toHHmm(entry.segments[0].start) : '';
  const lastEnd = entry.segments[entry.segments.length - 1]?.end ? toHHmm(entry.segments[entry.segments.length - 1].end!) : '';
  const interruptions = Math.max(0, entry.segments.length - 1);

  return [
    date,
    csvEscape(customer?.name ?? ''),
    customer?.type ?? '',
    csvEscape(activity?.name ?? entry.activityId),
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
