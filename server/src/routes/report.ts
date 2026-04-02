import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';
import type { ScreenSession } from '../types.js';
import { checkOllama, analyzeReport } from '../ollama.js';

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
    const totalTrackedMinutes = blocks.reduce((s, b) => s + b.totalMinutes, 0);

    const activitiesWithCustomer = activities.activities.map(a => {
      const c = customers.customers.find(c => c.id === a.customerId);
      return { id: a.id, name: a.name, customerName: c?.name ?? '' };
    });

    let summary = '';
    let suggestedEntries: SuggestedEntry[] = [];
    let unmatched: typeof blocks = [];
    let aiEnhanced = false;

    // Try LLM-first approach
    const ollama = await checkOllama();
    const hasLLM = ollama.available && ollama.models.some(m => m.startsWith('qwen') || m.startsWith('llama') || m.startsWith('mistral'));

    if (hasLLM) {
      try {
        const audioTranscripts = (tracking.audioSegments || [])
          .filter((s: any) => s.hasSpeech && s.transcript)
          .map((s: any) => ({ time: s.timestamp.slice(11, 16), text: s.transcript }));

        // Load recent timesheets as examples
        const recentExamples: { date: string; activityId: string; activityLabel: string; description: string; minutes: number }[] = [];
        const allDates = await storage.listDates();
        for (const d of allDates.slice(-7)) {
          if (d === req.params.date) continue;
          const day = await storage.loadTimesheet(d);
          for (const e of day.entries.filter(e => e.status === 'completed' && e.activityId)) {
            const act = activitiesWithCustomer.find(a => a.id === e.activityId);
            if (act) {
              recentExamples.push({
                date: d, activityId: e.activityId,
                activityLabel: `${act.customerName} - ${act.name}`,
                description: e.description, minutes: e.roundedMinutes,
              });
            }
          }
        }

        // Send ALL blocks to LLM (no pre-matching)
        const llmResult = await analyzeReport({
          date: req.params.date,
          blocks: [], // No pre-matched blocks
          unmatched: blocks.map(b => ({ app: b.app, title: b.title, domain: b.domain, totalMinutes: b.totalMinutes })),
          audioTranscripts,
          activities: activitiesWithCustomer,
          recentTimesheets: recentExamples.slice(-20),
        });

        summary = llmResult.summary;
        aiEnhanced = true;

        // Build suggested entries from LLM suggestions (only valid activityIds)
        const validActivityIds = new Set(activities.activities.map(a => a.id));
        const byActivity = new Map<string, { totalMin: number; description: string; customerName?: string }>();

        for (const s of llmResult.suggestions) {
          if (s.activityId && validActivityIds.has(s.activityId)) {
            const existing = byActivity.get(s.activityId);
            if (existing) {
              existing.totalMin += s.totalMinutes;
              if (s.description && !existing.description.includes(s.description)) {
                existing.description += ', ' + s.description;
              }
            } else {
              const act = activitiesWithCustomer.find(a => a.id === s.activityId);
              byActivity.set(s.activityId, {
                totalMin: s.totalMinutes,
                description: s.description,
                customerName: act?.customerName,
              });
            }
          }
        }

        for (const [activityId, data] of byActivity) {
          const roundedMinutes = Math.max(15, Math.ceil(data.totalMin / 15) * 15);
          suggestedEntries.push({
            activityId,
            customerName: data.customerName,
            description: data.description,
            totalMinutes: data.totalMin,
            roundedMinutes,
            confidence: 0.8,
            blockCount: 1,
          });
        }

        // Unmatched = blocks not covered by LLM suggestions
        const matchedMinutes = suggestedEntries.reduce((s, e) => s + e.totalMinutes, 0);
        if (matchedMinutes < totalTrackedMinutes) {
          // Find blocks that weren't matched by the LLM
          const suggestedApps = new Set(llmResult.suggestions.map(s => s.description?.toLowerCase()));
          for (const b of blocks) {
            const isMatched = llmResult.suggestions.some(s =>
              s.activityId && validActivityIds.has(s.activityId) &&
              (b.title.toLowerCase().includes(s.description?.toLowerCase() || '___') ||
               s.description?.toLowerCase().includes(b.app.toLowerCase()))
            );
            if (!isMatched && b.totalMinutes >= 1) {
              // Check if it's already covered by a matched entry (by app/domain)
              const coveredByMatch = suggestedEntries.some(e => {
                const act = activitiesWithCustomer.find(a => a.id === e.activityId);
                return act && (b.title.toLowerCase().includes(act.customerName.toLowerCase()) ||
                               (b.domain && b.domain.includes(act.customerName.toLowerCase())));
              });
              if (!coveredByMatch) {
                unmatched.push(b);
              }
            }
          }
        }
      } catch (err) {
        console.error('[report] LLM analysis failed:', err);
        // Fallback to basic matching
      }
    }

    // Fallback: basic matching if LLM failed or unavailable
    if (suggestedEntries.length === 0) {
      const matchedBlocks = blocks.map(block => {
        const match = tryMatch(block, activities.activities, customers.customers);
        return { ...block, ...match };
      });
      suggestedEntries = buildSuggestedEntries(matchedBlocks);
      unmatched = matchedBlocks
        .filter(b => !b.activityId && b.totalMinutes >= 1);
    }

    suggestedEntries.sort((a, b) => b.totalMinutes - a.totalMinutes);

    const report = {
      date: req.params.date,
      generatedAt: new Date().toISOString(),
      status: 'pending' as const,
      summary,
      blocks,
      suggestedEntries,
      unmatched: unmatched.map(b => ({
        from: b.from, to: b.to, app: b.app, title: b.title,
        url: b.url, domain: b.domain, totalMinutes: b.totalMinutes,
      })),
      totalTrackedMinutes,
      aiEnhanced,
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
      // Normalize terminal titles: strip spinner chars AND project brackets
      // "✳ feuille-de-temps #0 [Feuilles-de-temps,baouw]" → "feuille-de-temps #0"
      const cleanTitle = s.title
        .replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁]\s*/, '')  // Remove spinner chars
        .replace(/\s*\[[^\]]*\]\s*$/, '')         // Remove trailing [project,names]
        .trim();
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
  const fullTitle = block.title.toLowerCase();
  // Title without brackets (for primary matching)
  const titleClean = block.title.replace(/\s*\[[^\]]*\]\s*/g, '').toLowerCase();
  // Project names from brackets (for fallback matching)
  const bracketMatch = block.title.match(/\[([^\]]+)\]/);
  const projectNames = bracketMatch
    ? bracketMatch[1].split(',').map(p => p.trim().toLowerCase())
    : [];

  // Priority 1: Match by domain (most reliable)
  for (const customer of customers) {
    const custLower = customer.name.toLowerCase();
    if (domain && domain.includes(custLower)) {
      const activity = activities.find(a => a.customerId === customer.id);
      if (activity) {
        return { activityId: activity.id, customerName: customer.name, confidence: 0.9 };
      }
    }
  }

  // Priority 2: Match tab/window title (without brackets) to customer
  for (const customer of customers) {
    const custLower = customer.name.toLowerCase();
    if (titleClean.includes(custLower)) {
      const activity = activities.find(a => a.customerId === customer.id);
      if (activity) {
        return { activityId: activity.id, customerName: customer.name, confidence: 0.8 };
      }
    }
  }

  // Priority 3: Match project names from brackets to customer (fallback)
  // Only match if there's exactly ONE customer match (avoid ambiguity)
  if (projectNames.length > 0) {
    const matches: { activityId: string; customerName: string }[] = [];
    for (const customer of customers) {
      const custLower = customer.name.toLowerCase();
      for (const proj of projectNames) {
        if (proj.includes(custLower) || custLower.includes(proj)) {
          const activity = activities.find(a => a.customerId === customer.id);
          if (activity) {
            matches.push({ activityId: activity.id, customerName: customer.name });
            break;
          }
        }
      }
    }
    if (matches.length === 1) {
      return { ...matches[0], confidence: 0.6 };
    }
  }

  // Priority 4: Match activity name in domain, title, or URL
  for (const activity of activities) {
    const actLower = activity.name.toLowerCase();
    if (domain.includes(actLower) || fullTitle.includes(actLower) || url.includes(actLower)) {
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
    // Clean title for description: remove bracket content, keep meaningful part
    const cleanTitle = b.title
      .replace(/\s*\[[^\]]*\]\s*/g, '')  // Remove [project,names]
      .replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁]\s*/, '') // Remove spinner chars
      .trim();
    if (cleanTitle && cleanTitle.length > 3) existing.titles.add(cleanTitle);
    existing.confidence = Math.max(existing.confidence, b.confidence);
    existing.count++;
    byActivity.set(b.activityId, existing);
  }

  const entries: SuggestedEntry[] = [];
  for (const [activityId, data] of byActivity) {
    const totalMinutes = Math.round(data.totalSecs / 60);
    // Skip activities with less than 2 minutes total (likely just quick glances)
    if (totalMinutes < 2) continue;
    // Keep raw titles as context for LLM, but use a clean default description
    const rawTitles = [...data.titles].slice(0, 5);
    const titles = rawTitles.join(', ');
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
