import { Router } from 'express';
import type { Storage } from '../storage.js';
import type { ScreenSession, IdlePeriod } from '../types.js';
import { checkOllama } from '../ollama.js';

export function createTrackingRouter(storage: Storage) {
  const router = Router();

  // Config routes MUST come before /:date to avoid parameter collision
  router.get('/config/current', async (_req, res) => {
    const config = await storage.loadTrackingConfig();
    res.json(config);
  });

  router.put('/config/current', async (req, res) => {
    const config = await storage.loadTrackingConfig();
    if (req.body.screenEnabled !== undefined) config.screenEnabled = req.body.screenEnabled;
    await storage.saveTrackingConfig(config);
    res.json(config);
  });

  // Project mapping routes MUST come before /:date
  router.get('/project-map', async (_req, res) => {
    const config = await storage.loadTrackingConfig();
    res.json((config as any).projectMap || {});
  });

  router.put('/project-map', async (req, res) => {
    const config = await storage.loadTrackingConfig() as any;
    if (!config.projectMap) config.projectMap = {};
    Object.assign(config.projectMap, req.body);
    await storage.saveTrackingConfig(config);
    res.json(config.projectMap);
  });

  router.get('/project-map/:project', async (req, res) => {
    const config = await storage.loadTrackingConfig() as any;
    const map = config.projectMap || {};
    const mapping = map[req.params.project];
    if (mapping) {
      const activities = await storage.loadActivities();
      const customers = await storage.loadCustomers();
      const activity = activities.activities.find(a => a.id === mapping.activityId);
      const customer = activity ? customers.customers.find(c => c.id === activity.customerId) : null;
      res.json({
        mapped: true,
        activityId: mapping.activityId,
        activityName: activity?.name || '',
        customerName: customer?.name || '',
      });
    } else {
      const activities = await storage.loadActivities();
      const customers = await storage.loadCustomers();
      const options = activities.activities.map(a => {
        const c = customers.customers.find(c => c.id === a.customerId);
        return { id: a.id, label: c ? `${c.name} - ${a.name}` : a.name };
      }).sort((a, b) => a.label.localeCompare(b.label));
      res.json({ mapped: false, options });
    }
  });

  // Ollama status
  router.get('/ollama/status', async (_req, res) => {
    const status = await checkOllama();
    res.json(status);
  });

  // Get full tracking data for a day
  router.get('/:date', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    res.json(data);
  });

  // Append or update a screen session
  router.post('/:date/screen', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    const session: ScreenSession = req.body;

    // Normalize title for comparison: strip spinner chars (⠀-⣿✳⠐⠂⠈⠠⠄⠁·*•)
    const normalizeTitle = (t: string) => t.replace(/^[⠀-⣿✳⠐⠂⠈⠠⠄⠁·*•]\s*/, '').trim();

    // Deduplication: extend if same app+title+url AND gap < 30s (prevents sleep merging)
    const last = data.screenSessions[data.screenSessions.length - 1];
    const gap = last ? (new Date(session.from).getTime() - new Date(last.until).getTime()) / 1000 : Infinity;
    if (
      last &&
      gap < 30 &&
      last.app === session.app &&
      normalizeTitle(last.title) === normalizeTitle(session.title) &&
      (last.url ?? '') === (session.url ?? '')
    ) {
      last.until = session.until;
    } else {
      data.screenSessions.push(session);
    }

    await storage.saveTracking(data);
    res.json({ ok: true });
  });

  // Record a Claude Code prompt
  router.post('/:date/claude', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    const { timestamp, cwd, prompt, sessionId } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.json({ ok: true, stored: false });
    }

    if (!data.claudePrompts) (data as any).claudePrompts = [];
    const { gitBranch, gitLastCommit, gitDirtyFiles } = req.body;
    (data as any).claudePrompts.push({
      timestamp: timestamp || new Date().toISOString(),
      cwd: cwd || '',
      prompt: prompt.trim(),
      sessionId: sessionId || '',
      project: cwd ? cwd.split('/').pop() : '',
      gitBranch: gitBranch || '',
      gitLastCommit: gitLastCommit || '',
      gitDirtyFiles: gitDirtyFiles || 0,
    });

    await storage.saveTracking(data);
    res.json({ ok: true, stored: true });
  });

  // Record an idle period
  router.post('/:date/idle', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    const idle: IdlePeriod = req.body;

    // Extend last idle period if contiguous
    const last = data.idlePeriods[data.idlePeriods.length - 1];
    if (last && last.until === idle.from) {
      last.until = idle.until;
    } else {
      data.idlePeriods.push(idle);
    }

    await storage.saveTracking(data);
    res.json({ ok: true });
  });

  return router;
}
