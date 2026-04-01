import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';
import type { ScreenSession } from '../types.js';

export function createReportRouter(storage: Storage) {
  const router = Router();

  // Get report for a date
  router.get('/:date', async (req, res) => {
    const tracking = await storage.loadTracking(req.params.date);
    if (tracking.report) {
      return res.json(tracking.report);
    }
    return res.json(null);
  });

  // Generate report for a date (basic aggregation, no AI)
  router.post('/:date/generate', async (req, res) => {
    const tracking = await storage.loadTracking(req.params.date);
    const activities = await storage.loadActivities();
    const customers = await storage.loadCustomers();

    if (tracking.screenSessions.length === 0) {
      return res.status(404).json({ error: 'No tracking data for this date' });
    }

    // Aggregate sessions by app+title into time blocks
    const blocks = aggregateSessions(tracking.screenSessions);

    // Try to match blocks to activities/customers using URL patterns and title keywords
    const matchedBlocks = blocks.map(block => {
      const match = tryMatch(block, activities.activities, customers.customers);
      return { ...block, ...match };
    });

    // Group by matched activity to create suggested entries
    const suggestedEntries = buildSuggestedEntries(matchedBlocks);

    // Build unmatched list
    const unmatched = matchedBlocks
      .filter(b => !b.activityId)
      .map(b => ({
        from: b.from,
        to: b.to,
        app: b.app,
        title: b.title,
        url: b.url,
        totalMinutes: b.totalMinutes,
      }));

    const report = {
      date: req.params.date,
      generatedAt: new Date().toISOString(),
      status: 'pending' as const,
      blocks: matchedBlocks,
      suggestedEntries,
      unmatched,
      totalTrackedMinutes: blocks.reduce((s, b) => s + b.totalMinutes, 0),
    };

    tracking.report = report;
    await storage.saveTracking(tracking);
    res.json(report);
  });

  // List dates with available tracking data (for report page)
  router.get('/', async (req, res) => {
    const dates = await storage.listTrackingDates();
    const results: { date: string; hasReport: boolean; status: string | null }[] = [];

    for (const date of dates) {
      const tracking = await storage.loadTracking(date);
      results.push({
        date,
        hasReport: !!tracking.report,
        status: tracking.report?.status ?? null,
      });
    }

    res.json(results.reverse()); // Most recent first
  });

  // Validate report: create timesheet entries from suggested entries
  router.post('/:date/validate', async (req, res) => {
    const tracking = await storage.loadTracking(req.params.date);
    if (!tracking.report) {
      return res.status(404).json({ error: 'No report for this date' });
    }

    const { entries } = req.body; // Array of { activityId, description, roundedMinutes }

    // Create timesheet entries
    const timesheet = await storage.loadTimesheet(req.params.date);
    const now = new Date().toISOString();
    for (const entry of entries) {
      timesheet.entries.push({
        id: uuid(),
        activityId: entry.activityId || '',
        description: entry.description || '',
        segments: [{ start: now, end: now }],
        totalMinutes: entry.roundedMinutes || 0,
        roundedMinutes: entry.roundedMinutes || 0,
        status: 'completed',
      });
    }
    await storage.saveTimesheet(timesheet);

    // Mark report as validated
    tracking.report.status = 'validated';
    await storage.saveTracking(tracking);

    res.json({ ok: true, entriesCreated: entries.length });
  });

  return router;
}

// --- Helper functions ---

interface AggregatedBlock {
  from: string;
  to: string;
  app: string;
  title: string;
  url?: string;
  totalMinutes: number;
  totalSeconds: number;
}

function aggregateSessions(sessions: ScreenSession[]): AggregatedBlock[] {
  if (sessions.length === 0) return [];

  const blocks: AggregatedBlock[] = [];
  let current: AggregatedBlock | null = null;

  for (const s of sessions) {
    const key = `${s.app}|${s.title}|${s.url ?? ''}`;
    const from = new Date(s.from).getTime();
    const until = new Date(s.until).getTime();
    const secs = Math.max(5, (until - from) / 1000); // min 5s per session

    if (current && `${current.app}|${current.title}|${current.url ?? ''}` === key) {
      // Extend current block
      current.to = s.until;
      current.totalSeconds += secs;
      current.totalMinutes = Math.round(current.totalSeconds / 60);
    } else {
      // Start new block
      if (current) blocks.push(current);
      current = {
        from: s.from,
        to: s.until,
        app: s.app,
        title: s.title,
        url: s.url,
        totalSeconds: secs,
        totalMinutes: Math.round(secs / 60),
      };
    }
  }
  if (current) blocks.push(current);

  return blocks;
}

function tryMatch(
  block: AggregatedBlock,
  activities: { id: string; name: string; customerId: string }[],
  customers: { id: string; name: string; type: string }[],
): { activityId?: string; customerName?: string; confidence: number } {
  const url = (block.url ?? '').toLowerCase();
  const title = block.title.toLowerCase();

  // Try to match by URL domain to customer
  for (const customer of customers) {
    const custLower = customer.name.toLowerCase();
    // Check if customer name appears in URL or title
    if (url.includes(custLower) || title.includes(custLower)) {
      // Find an activity for this customer
      const activity = activities.find(a => a.customerId === customer.id);
      if (activity) {
        return { activityId: activity.id, customerName: customer.name, confidence: 0.7 };
      }
    }
  }

  // Try to match activity name in title
  for (const activity of activities) {
    const actLower = activity.name.toLowerCase();
    if (title.includes(actLower) || url.includes(actLower)) {
      const customer = customers.find(c => c.id === activity.customerId);
      return { activityId: activity.id, customerName: customer?.name, confidence: 0.6 };
    }
  }

  return { confidence: 0 };
}

interface SuggestedEntry {
  activityId: string;
  customerName?: string;
  description: string;
  totalMinutes: number;
  roundedMinutes: number;
  confidence: number;
  blockCount: number;
}

function buildSuggestedEntries(blocks: (AggregatedBlock & { activityId?: string; customerName?: string; confidence: number })[]): SuggestedEntry[] {
  const byActivity = new Map<string, { totalMin: number; titles: Set<string>; confidence: number; customerName?: string; count: number }>();

  for (const b of blocks) {
    if (!b.activityId) continue;
    const existing = byActivity.get(b.activityId) || { totalMin: 0, titles: new Set(), confidence: 0, customerName: b.customerName, count: 0 };
    existing.totalMin += b.totalMinutes;
    if (b.title) existing.titles.add(b.title);
    existing.confidence = Math.max(existing.confidence, b.confidence);
    existing.count++;
    byActivity.set(b.activityId, existing);
  }

  const entries: SuggestedEntry[] = [];
  for (const [activityId, data] of byActivity) {
    const titles = [...data.titles].slice(0, 3).join(', ');
    const roundedMinutes = data.totalMin === 0 ? 15 : Math.ceil(data.totalMin / 15) * 15;
    entries.push({
      activityId,
      customerName: data.customerName,
      description: titles,
      totalMinutes: data.totalMin,
      roundedMinutes,
      confidence: data.confidence,
      blockCount: data.count,
    });
  }

  return entries.sort((a, b) => b.totalMinutes - a.totalMinutes);
}
