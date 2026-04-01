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

  // Generate (or regenerate) report for a date (basic aggregation, no AI)
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

    // Build unmatched list (only blocks with at least 1 min)
    const unmatched = matchedBlocks
      .filter(b => !b.activityId && b.totalMinutes >= 1)
      .map(b => ({
        from: b.from,
        to: b.to,
        app: b.app,
        title: b.title,
        url: b.url,
        domain: b.domain,
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

function extractDomain(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface AggregatedBlock {
  from: string;
  to: string;
  app: string;
  title: string;
  url?: string;
  domain?: string;
  totalMinutes: number;
  totalSeconds: number;
}

function aggregateSessions(sessions: ScreenSession[]): AggregatedBlock[] {
  if (sessions.length === 0) return [];

  // Phase 1: aggregate by domain for browsers, by app+title for others
  const buckets = new Map<string, AggregatedBlock>();

  for (const s of sessions) {
    const from = new Date(s.from).getTime();
    const until = new Date(s.until).getTime();
    const secs = Math.max(5, (until - from) / 1000);
    const domain = extractDomain(s.url);

    // For browsers with URLs, group by domain
    // For terminals (cmux, Terminal, iTerm), strip spinner chars and group by base session name
    // For other apps, group by app name
    let key: string;
    if (domain) {
      key = `${s.app}|${domain}`;
    } else {
      // Normalize terminal titles: strip leading spinner chars (⠐⠂✳⠈⠠⠄⠁ etc.)
      const cleanTitle = s.title.replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁]\s*/, '').trim();
      key = cleanTitle ? `${s.app}|${cleanTitle}` : s.app;
    }

    // Use cleaned title for display
    const displayTitle = domain
      ? s.title
      : s.title.replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁]\s*/, '').trim();

    const existing = buckets.get(key);
    if (existing) {
      if (s.until > existing.to) existing.to = s.until;
      if (s.from < existing.from) existing.from = s.from;
      existing.totalSeconds += secs;
      existing.totalMinutes = Math.round(existing.totalSeconds / 60);
      // Keep the most descriptive title (longest)
      if (displayTitle.length > existing.title.length) {
        existing.title = displayTitle;
      }
    } else {
      buckets.set(key, {
        from: s.from,
        to: s.until,
        app: s.app,
        title: displayTitle || s.app,
        url: s.url,
        domain: domain || undefined,
        totalSeconds: secs,
        totalMinutes: Math.round(secs / 60),
      });
    }
  }

  // Sort by total time descending, filter out very short sessions (< 30s)
  return [...buckets.values()]
    .filter(b => b.totalSeconds >= 30)
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

function tryMatch(
  block: AggregatedBlock,
  activities: { id: string; name: string; customerId: string }[],
  customers: { id: string; name: string; type: string }[],
): { activityId?: string; customerName?: string; confidence: number } {
  const domain = (block.domain ?? '').toLowerCase();
  const url = (block.url ?? '').toLowerCase();
  const title = block.title.toLowerCase();
  const app = block.app.toLowerCase();

  // Try to match by domain or title to customer name
  for (const customer of customers) {
    const custLower = customer.name.toLowerCase();
    // Check domain first (most reliable)
    if (domain && domain.includes(custLower)) {
      const activity = activities.find(a => a.customerId === customer.id);
      if (activity) {
        return { activityId: activity.id, customerName: customer.name, confidence: 0.9 };
      }
    }
    // Check title
    if (title.includes(custLower)) {
      const activity = activities.find(a => a.customerId === customer.id);
      if (activity) {
        return { activityId: activity.id, customerName: customer.name, confidence: 0.7 };
      }
    }
  }

  // Try to match activity name in domain, title, or URL
  for (const activity of activities) {
    const actLower = activity.name.toLowerCase();
    if (domain.includes(actLower) || title.includes(actLower) || url.includes(actLower)) {
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
  const byActivity = new Map<string, { totalSecs: number; titles: Set<string>; confidence: number; customerName?: string; count: number }>();

  for (const b of blocks) {
    if (!b.activityId) continue;
    const existing = byActivity.get(b.activityId) || { totalSecs: 0, titles: new Set(), confidence: 0, customerName: b.customerName, count: 0 };
    existing.totalSecs += b.totalSeconds;
    if (b.title) existing.titles.add(b.title);
    existing.confidence = Math.max(existing.confidence, b.confidence);
    existing.count++;
    byActivity.set(b.activityId, existing);
  }

  const entries: SuggestedEntry[] = [];
  for (const [activityId, data] of byActivity) {
    const totalMinutes = Math.round(data.totalSecs / 60);
    // Skip activities with less than 2 minutes total (likely just quick glances)
    if (totalMinutes < 2) continue;
    const titles = [...data.titles].slice(0, 3).join(', ');
    const roundedMinutes = Math.max(15, Math.ceil(totalMinutes / 15) * 15);
    entries.push({
      activityId,
      customerName: data.customerName,
      description: titles,
      totalMinutes,
      roundedMinutes,
      confidence: data.confidence,
      blockCount: data.count,
    });
  }

  return entries.sort((a, b) => b.totalMinutes - a.totalMinutes);
}
