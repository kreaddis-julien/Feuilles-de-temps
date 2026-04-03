import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';
import type { ScreenSession, SuggestedEntry } from '../types.js';
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

    // Detect gaps (sleep/lock periods)
    const gaps: { from: string; to: string; durationMinutes: number }[] = [];
    const sortedSessions = [...tracking.screenSessions].sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < sortedSessions.length; i++) {
      const prevEnd = new Date(sortedSessions[i-1].until).getTime();
      const nextStart = new Date(sortedSessions[i].from).getTime();
      const gapMs = nextStart - prevEnd;
      if (gapMs > 5 * 60 * 1000) { // > 5 minutes
        gaps.push({
          from: sortedSessions[i-1].until,
          to: sortedSessions[i].from,
          durationMinutes: Math.round(gapMs / 60000),
        });
      }
    }

    // ── COUCHE 1: Sources directes ──────────────────────────────

    const config = await storage.loadTrackingConfig() as any;
    const projectMap: Record<string, { activityId: string }> = config.projectMap || {};

    const activitiesWithCustomer = activities.activities.map(a => {
      const c = customers.customers.find(c => c.id === a.customerId);
      return { id: a.id, name: a.name, customerName: c?.name ?? '' };
    });

    // Accumulate time per activityId with confidence tracking
    const matched = new Map<string, {
      totalSecs: number;
      confidence: 'high' | 'medium' | 'low';
      source: 'cmux' | 'claude' | 'domain' | 'calendar' | 'llm' | 'default';
      titles: Set<string>;
      customerName?: string;
    }>();
    const unmatchedBlocks: typeof blocks = [];

    function addMatch(activityId: string, secs: number, confidence: 'high' | 'medium' | 'low', source: string, title?: string) {
      const existing = matched.get(activityId) || {
        totalSecs: 0,
        confidence,
        source: source as any,
        titles: new Set<string>(),
        customerName: activitiesWithCustomer.find(a => a.id === activityId)?.customerName,
      };
      existing.totalSecs += secs;
      // Keep highest confidence
      const confOrder = { high: 3, medium: 2, low: 1 };
      if (confOrder[confidence] > confOrder[existing.confidence]) {
        existing.confidence = confidence;
        existing.source = source as any;
      }
      if (title) existing.titles.add(title);
      matched.set(activityId, existing);
    }

    // 1.1 Match screen sessions
    for (const b of blocks) {
      let wasMatched = false;

      // Extract project from brackets [project]
      const bracketMatch = b.title.match(/\[([^\]]+)\]/);
      const project = bracketMatch ? bracketMatch[1].trim() : null;

      // Priority 1: Project mapping from brackets (cmux)
      if (project && projectMap[project]) {
        addMatch(projectMap[project].activityId, b.totalSeconds, 'high', 'cmux', b.title);
        wasMatched = true;
      }

      // Priority 2: Client-specific domains (not internal ERP)
      if (!wasMatched && b.domain) {
        const domain = b.domain.toLowerCase();
        const isInternal = domain.includes('kreaddis.com');
        const isGeneric = domain.includes('google.com') || domain.includes('microsoft.com') || domain.includes('github.com');

        if (!isInternal && !isGeneric) {
          for (const customer of customers.customers) {
            if (domain.includes(customer.name.toLowerCase())) {
              const activity = activities.activities.find(a => a.customerId === customer.id);
              if (activity) {
                addMatch(activity.id, b.totalSeconds, 'high', 'domain', b.title);
                wasMatched = true;
                break;
              }
            }
          }
        }

        // Internal ERP → default to Interne
        if (!wasMatched && isInternal) {
          const interneCustomer = customers.customers.find(c => c.name.toLowerCase() === 'interne');
          if (interneCustomer) {
            const interneActivity = activities.activities.find(a => a.customerId === interneCustomer.id);
            if (interneActivity) {
              addMatch(interneActivity.id, b.totalSeconds, 'low', 'default', b.title);
              wasMatched = true;
            }
          }
        }
      }

      // Priority 3: Meet/Teams — match by title
      if (!wasMatched && b.domain && (b.domain.includes('meet.google.com') || b.domain.includes('teams.microsoft.com'))) {
        const titleLower = b.title.toLowerCase();
        for (const customer of customers.customers) {
          if (titleLower.includes(customer.name.toLowerCase())) {
            const activity = activities.activities.find(a => a.customerId === customer.id);
            if (activity) {
              addMatch(activity.id, b.totalSeconds, 'medium', 'calendar', b.title);
              wasMatched = true;
              break;
            }
          }
        }
      }

      if (!wasMatched && b.totalMinutes >= 1) {
        unmatchedBlocks.push(b);
      }
    }

    // 1.2 Claude Code prompts — used as context for matching, NOT as additional time
    // If a project has Claude prompts but NO screen time, attribute a minimal presence
    const claudePromptsByProject: Record<string, number> = {};
    for (const p of (tracking.claudePrompts || []) as any[]) {
      if (p.project) {
        claudePromptsByProject[p.project] = (claudePromptsByProject[p.project] || 0) + 1;
      }
    }
    for (const [project, count] of Object.entries(claudePromptsByProject)) {
      if (projectMap[project] && !matched.has(projectMap[project].activityId)) {
        // No screen time for this project — add minimal presence (15 min)
        addMatch(projectMap[project].activityId, 15 * 60, 'medium', 'claude');
      }
    }

    // Build suggested entries from matches
    let suggestedEntries: SuggestedEntry[] = [];
    for (const [activityId, data] of matched) {
      const totalMinutes = Math.round(data.totalSecs / 60);
      if (totalMinutes < 2) continue;
      suggestedEntries.push({
        activityId,
        customerName: data.customerName,
        description: '',
        totalMinutes,
        roundedMinutes: Math.max(15, Math.ceil(totalMinutes / 15) * 15),
        confidence: data.confidence,
        source: data.source,
        blockCount: data.titles.size,
      });
    }

    let unmatched = unmatchedBlocks;

    let summary = '';
    let aiEnhanced = false;

    // Try LLM to enhance descriptions and match remaining unmatched blocks
    const ollama = await checkOllama();
    const hasLLM = ollama.available && ollama.models.some(m => m.startsWith('qwen') || m.startsWith('llama') || m.startsWith('mistral'));

    if (hasLLM) {
      try {
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

        // Build project mappings for LLM context
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
          claudePrompts: (tracking.claudePrompts || []).slice(-15).map((c: any) => ({
            time: c.timestamp?.slice(11, 16) || '',
            project: c.project || '',
            prompt: c.prompt || '',
          })),
          activities: activitiesWithCustomer.map(a => ({
            ...a,
            id: idToAlias[a.id] || a.id,
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
                confidence: 'medium',
                source: 'llm',
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
      gaps,
    };

    tracking.report = report;
    await storage.saveTracking(tracking);
    res.json(report);
  });

  // Regenerate descriptions for given entries (after manual assignment)
  router.post('/:date/descriptions', async (req, res) => {
    const { entries } = req.body as { entries: { activityId: string; totalMinutes: number }[] };
    if (!entries?.length) return res.json({ descriptions: [] });

    const tracking = await storage.loadTracking(req.params.date);
    const activities = await storage.loadActivities();
    const customers = await storage.loadCustomers();
    const config = await storage.loadTrackingConfig() as any;
    const projectMap = config.projectMap || {};

    const activitiesWithCustomer = activities.activities.map(a => {
      const c = customers.customers.find(c => c.id === a.customerId);
      return { id: a.id, name: a.name, customerName: c?.name ?? '' };
    });

    // Build context per activity
    const claudePromptsByProject: Record<string, string[]> = {};
    for (const p of (tracking.claudePrompts || []) as any[]) {
      if (p.project && p.prompt && p.prompt.length > 10) {
        if (!claudePromptsByProject[p.project]) claudePromptsByProject[p.project] = [];
        claudePromptsByProject[p.project].push(p.prompt);
      }
    }

    const blocks = aggregateSessions(tracking.screenSessions);

    try {
      const { generateWithLLM } = await import('../ollama.js');
      const lines: string[] = [];

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const act = activitiesWithCustomer.find(a => a.id === entry.activityId);
        const label = act ? `${act.customerName} - ${act.name}` : 'Inconnu';

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

      const descPrompt = `Pour chaque ligne, écris UNE description courte et professionnelle pour une feuille de temps. Pas de numérotation, juste la description sur chaque ligne.\n\n${lines.join('\n')}\n\nRéponds avec une description par ligne, rien d'autre :`;
      const descResult = await generateWithLLM(descPrompt);
      const descriptions = descResult.trim().split('\n').map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(l => l.length > 3);

      res.json({ descriptions });
    } catch (err) {
      console.error('[report] Description regeneration failed:', err);
      res.json({ descriptions: [] });
    }
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

