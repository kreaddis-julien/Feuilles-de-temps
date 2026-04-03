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

    // Enrich with Claude Code prompt time — estimate 3 min per prompt as active work
    const claudeTimeByProject: Record<string, number> = {};
    for (const p of (tracking.claudePrompts || []) as any[]) {
      if (p.project) {
        claudeTimeByProject[p.project] = (claudeTimeByProject[p.project] || 0) + 3;
      }
    }
    // Add Claude time as virtual blocks if the project has a mapping
    const config2 = await storage.loadTrackingConfig() as any;
    const projMap = config2.projectMap || {};
    for (const [project, minutes] of Object.entries(claudeTimeByProject)) {
      if (projMap[project]) {
        // Check if this project already has screen time
        const hasScreenTime = blocks.some(b => {
          const bracket = b.title.match(/\[([^\]]+)\]/);
          return bracket && bracket[1].trim() === project;
        });
        if (!hasScreenTime) {
          // Add virtual block for Claude Code time on this project
          blocks.push({
            from: '', to: '', app: 'Claude Code', title: `[${project}]`,
            totalSeconds: minutes * 60, totalMinutes: minutes,
          });
        }
      }
    }

    // Add audio conversation time as virtual blocks
    // Each audio segment represents 30s of active conversation
    // Try to attribute to the screen session that was active at the same time
    for (const seg of (tracking.audioSegments || []) as any[]) {
      if (!seg.hasSpeech || !seg.transcript) continue;
      const segTime = new Date(seg.timestamp).getTime();

      // Find what was on screen at this time
      let matchedScreen = false;
      for (const s of tracking.screenSessions) {
        const sFrom = new Date(s.from).getTime();
        const sUntil = new Date(s.until).getTime();
        if (segTime >= sFrom - 30000 && segTime <= sUntil + 30000) {
          // Audio happened during this screen session — already counted
          matchedScreen = true;
          break;
        }
      }

      if (!matchedScreen) {
        // Audio during idle/no screen activity — add as "conversation" block
        blocks.push({
          from: seg.timestamp, to: seg.timestamp,
          app: 'Conversation', title: seg.transcript.slice(0, 60),
          totalSeconds: 30, totalMinutes: 1,
        });
      }
    }

    const totalTrackedMinutes = blocks.reduce((s, b) => s + b.totalMinutes, 0);

    const activitiesWithCustomer = activities.activities.map(a => {
      const c = customers.customers.find(c => c.id === a.customerId);
      return { id: a.id, name: a.name, customerName: c?.name ?? '' };
    });

    // Pre-match blocks using project mapping (crochets → activityId)
    const config = await storage.loadTrackingConfig() as any;
    const projectMap: Record<string, { activityId: string }> = config.projectMap || {};

    const preMatched: SuggestedEntry[] = [];
    const preUnmatched: typeof blocks = [];

    // Group blocks by matched activityId from project mapping
    const byMappedActivity = new Map<string, { totalSecs: number; titles: Set<string>; customerName?: string }>();

    for (const b of blocks) {
      // Extract project from brackets [project]
      const bracketMatch = b.title.match(/\[([^\]]+)\]/);
      const project = bracketMatch ? bracketMatch[1].trim() : null;
      const mapping = project ? projectMap[project] : null;

      if (mapping) {
        const act = activitiesWithCustomer.find(a => a.id === mapping.activityId);
        const existing = byMappedActivity.get(mapping.activityId) || { totalSecs: 0, titles: new Set(), customerName: act?.customerName };
        existing.totalSecs += b.totalSeconds;
        const cleanTitle = b.title.replace(/\s*\[[^\]]*\]\s*/g, '').replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁]\s*/, '').trim();
        if (cleanTitle && cleanTitle.length > 3) existing.titles.add(cleanTitle);
        byMappedActivity.set(mapping.activityId, existing);
      } else {
        // Also try matching by domain/title to customer name (for Chrome etc.)
        const match = tryMatch(b, activities.activities, customers.customers);
        if (match.activityId) {
          const existing = byMappedActivity.get(match.activityId) || { totalSecs: 0, titles: new Set(), customerName: match.customerName };
          existing.totalSecs += b.totalSeconds;
          const cleanTitle = b.title.replace(/\s*\[[^\]]*\]\s*/g, '').replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁]\s*/, '').trim();
          if (cleanTitle && cleanTitle.length > 3) existing.titles.add(cleanTitle);
          byMappedActivity.set(match.activityId, existing);
        } else {
          preUnmatched.push(b);
        }
      }
    }

    for (const [activityId, data] of byMappedActivity) {
      const totalMinutes = Math.round(data.totalSecs / 60);
      if (totalMinutes < 2) continue;

      // Build description: empty for now, LLM or summary will fill it
      const description = '';

      preMatched.push({
        activityId,
        customerName: data.customerName,
        description,
        totalMinutes,
        roundedMinutes: Math.max(15, Math.ceil(totalMinutes / 15) * 15),
        confidence: 0.9,
        blockCount: 1,
      });
    }

    let summary = '';
    let suggestedEntries: SuggestedEntry[] = [...preMatched];
    let unmatched: typeof blocks = [...preUnmatched];
    let aiEnhanced = false;

    // Try LLM to enhance descriptions and match remaining unmatched blocks
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

        // Load project mappings so the LLM knows which directories map to which clients
        const config = await storage.loadTrackingConfig() as any;
        const projectMap = config.projectMap || {};
        const projectMappings: { project: string; activityId: string; label: string }[] = [];
        for (const [project, mapping] of Object.entries(projectMap)) {
          const act = activitiesWithCustomer.find(a => a.id === (mapping as any).activityId);
          if (act) {
            projectMappings.push({ project, activityId: act.id, label: `${act.customerName} - ${act.name}` });
          }
        }

        // Use short aliases for activityIds so the LLM copies them correctly
        const aliasToId: Record<string, string> = {};
        const idToAlias: Record<string, string> = {};
        suggestedEntries.forEach((e, i) => {
          const alias = `A${i + 1}`;
          aliasToId[alias] = e.activityId;
          idToAlias[e.activityId] = alias;
        });

        const llmResult = await analyzeReport({
          date: req.params.date,
          blocks: suggestedEntries.map((e, i) => {
            const act = activitiesWithCustomer.find(a => a.id === e.activityId);
            return { app: act ? `${act.customerName} - ${act.name}` : '', title: e.description, totalMinutes: e.totalMinutes, activityId: `A${i + 1}` };
          }),
          unmatched: unmatched.filter(b => b.totalMinutes >= 1).map(b => ({ app: b.app, title: b.title, domain: b.domain, totalMinutes: b.totalMinutes })),
          audioTranscripts,
          claudePrompts: (tracking.claudePrompts || []).map((c: any) => ({
            time: c.timestamp?.slice(11, 16) || '',
            project: c.project || '',
            prompt: c.prompt || '',
          })),
          activities: activitiesWithCustomer.map(a => ({
            ...a,
            id: idToAlias[a.id] || a.id, // Use short alias if this activity is in the suggested entries
          })),
          projectMappings: projectMappings.map(m => ({
            ...m,
            activityId: idToAlias[m.activityId] || m.activityId,
          })),
          recentTimesheets: recentExamples.slice(-20),
        });

        summary = llmResult.summary;
        aiEnhanced = true;

        // Merge LLM suggestions — remap aliases back to real IDs
        const validActivityIds = new Set(activities.activities.map(a => a.id));
        for (const s of llmResult.suggestions) {
          const realId = aliasToId[s.activityId] || s.activityId;
          if (realId && (validActivityIds.has(realId) || aliasToId[s.activityId])) {
            s.activityId = realId;
            const existing = suggestedEntries.find(e => e.activityId === s.activityId);
            if (existing) {
              // LLM might provide better description
              if (s.description && s.description.length > 5) {
                existing.description = s.description;
              }
            } else {
              const act = activitiesWithCustomer.find(a => a.id === s.activityId);
              suggestedEntries.push({
                activityId: s.activityId,
                customerName: act?.customerName,
                description: s.description,
                totalMinutes: s.totalMinutes,
                roundedMinutes: Math.max(15, Math.ceil(s.totalMinutes / 15) * 15),
                confidence: 0.7,
                blockCount: 1,
              });
            }
          }
        }
      } catch (err) {
        console.error('[report] LLM analysis failed:', err);
        // Fallback to basic matching
      }
    }

    // Generate descriptions via a simple dedicated LLM call
    if (aiEnhanced) {
      try {
        const { generateWithLLM } = await import('../ollama.js');

        // Build context per activity
        const claudePromptsByProject: Record<string, string[]> = {};
        for (const p of (tracking.claudePrompts || []) as any[]) {
          if (p.project && p.prompt && p.prompt.length > 10) {
            if (!claudePromptsByProject[p.project]) claudePromptsByProject[p.project] = [];
            claudePromptsByProject[p.project].push(p.prompt);
          }
        }

        const lines: string[] = [];
        for (let i = 0; i < suggestedEntries.length; i++) {
          const entry = suggestedEntries[i];
          const act = activitiesWithCustomer.find(a => a.id === entry.activityId);
          const label = act ? `${act.customerName} - ${act.name}` : 'Inconnu';

          // Find prompts for this activity
          let prompts: string[] = [];
          for (const [project, mapping] of Object.entries(projectMap)) {
            if ((mapping as any).activityId === entry.activityId && claudePromptsByProject[project]) {
              prompts = claudePromptsByProject[project]
                .filter(p => p.length > 15 && !/^(ok|oui|non|je|on |c'est)/i.test(p.trim()))
                .slice(0, 5)
                .map(p => p.slice(0, 60));
              break;
            }
          }

          // Find screen titles for this activity
          const screenTitles = blocks
            .filter(b => {
              const bracket = b.title.match(/\[([^\]]+)\]/);
              if (!bracket) return false;
              const proj = bracket[1].trim();
              return projectMap[proj] && (projectMap[proj] as any).activityId === entry.activityId;
            })
            .map(b => b.title.replace(/\s*\[[^\]]*\]/, '').replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁·*•]\s*/, '').trim())
            .filter(t => t.length > 3)
            .slice(0, 3);

          const context = [
            ...prompts.map(p => `prompt: "${p}"`),
            ...screenTitles.map(t => `écran: "${t}"`),
          ].join(', ') || `${entry.totalMinutes}min de travail`;

          lines.push(`${i + 1}. ${label} (${entry.totalMinutes}min) : ${context}`);
        }

        if (lines.length > 0) {
          const descPrompt = `Pour chaque ligne, écris UNE description courte et professionnelle pour une feuille de temps. Pas de numérotation, juste la description sur chaque ligne.\n\n${lines.join('\n')}\n\nRéponds avec une description par ligne, rien d'autre :`;
          const descResult = await generateWithLLM(descPrompt);
          const descLines = descResult.trim().split('\n').map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(l => l.length > 3);

          for (let i = 0; i < Math.min(suggestedEntries.length, descLines.length); i++) {
            suggestedEntries[i].description = descLines[i];
          }
        }
      } catch (err) {
        console.error('[report] Description generation failed:', err);
      }
    }

    // Fallback for entries still without description
    for (const entry of suggestedEntries) {
      if (!entry.description) {
        const act = activitiesWithCustomer.find(a => a.id === entry.activityId);
        entry.description = act ? `${act.customerName} - ${act.name}` : '';
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

    // Create timesheet entries and track their IDs
    const timesheet = await storage.loadTimesheet(req.params.date);
    const now = new Date().toISOString();
    const createdIds: string[] = [];
    for (const entry of entries) {
      const id = uuid();
      createdIds.push(id);
      timesheet.entries.push({
        id,
        activityId: entry.activityId || '',
        description: entry.description || '',
        segments: [{ start: now, end: now }],
        totalMinutes: entry.roundedMinutes || 0,
        roundedMinutes: entry.roundedMinutes || 0,
        status: 'completed',
      });
    }
    await storage.saveTimesheet(timesheet);

    // Mark report as validated and store created entry IDs for undo
    tracking.report.status = 'validated';
    (tracking.report as any).validatedEntryIds = createdIds;
    await storage.saveTracking(tracking);

    res.json({ ok: true, entriesCreated: entries.length });
  });

  // Undo validation: remove created timesheet entries and reset report status
  router.post('/:date/unvalidate', async (req, res) => {
    const tracking = await storage.loadTracking(req.params.date);
    if (!tracking.report || tracking.report.status !== 'validated') {
      return res.status(404).json({ error: 'No validated report for this date' });
    }

    const entryIds: string[] = (tracking.report as any).validatedEntryIds || [];

    if (entryIds.length > 0) {
      const timesheet = await storage.loadTimesheet(req.params.date);
      const idsToRemove = new Set(entryIds);
      timesheet.entries = timesheet.entries.filter(e => !idsToRemove.has(e.id));
      timesheet.activeEntries = timesheet.activeEntries.filter(id => !idsToRemove.has(id));
      timesheet.pausedEntries = timesheet.pausedEntries.filter(id => !idsToRemove.has(id));
      await storage.saveTimesheet(timesheet);
    }

    // Reset report to pending
    tracking.report.status = 'pending';
    delete (tracking.report as any).validatedEntryIds;
    await storage.saveTracking(tracking);

    res.json({ ok: true, entriesRemoved: entryIds.length });
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

  // Priority 2: Match by client-specific domains (e.g. gemaddis-erp.odoo.com, baouw.odoo.com)
  if (domain && !domain.includes('kreaddis.com') && !domain.includes('google.com') && !domain.includes('microsoft.com') && !domain.includes('github.com')) {
    for (const customer of customers) {
      const custLower = customer.name.toLowerCase();
      if (domain.includes(custLower)) {
        const activity = activities.find(a => a.customerId === customer.id);
        if (activity) {
          return { activityId: activity.id, customerName: customer.name, confidence: 0.85 };
        }
      }
    }
  }

  // Priority 3: Match tab/window title to customer — for Meet/Teams (meeting titles) and non-ERP
  const isInternalERP = domain.includes('kreaddis.com');
  const isMeeting = domain.includes('meet.google.com') || domain.includes('teams.microsoft.com');
  if (isMeeting || (block.totalMinutes >= 5 && !isInternalERP)) {
    for (const customer of customers) {
      const custLower = customer.name.toLowerCase();
      if (titleClean.includes(custLower)) {
        const activity = activities.find(a => a.customerId === customer.id);
        if (activity) {
          return { activityId: activity.id, customerName: customer.name, confidence: 0.7 };
        }
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
