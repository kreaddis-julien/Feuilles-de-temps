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
    if (req.body.micEnabled !== undefined) config.micEnabled = req.body.micEnabled;
    await storage.saveTrackingConfig(config);
    res.json(config);
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

    // Deduplication: if last session has same app+title+url, extend it
    const last = data.screenSessions[data.screenSessions.length - 1];
    if (
      last &&
      last.app === session.app &&
      last.title === session.title &&
      (last.url ?? '') === (session.url ?? '')
    ) {
      last.until = session.until;
    } else {
      data.screenSessions.push(session);
    }

    await storage.saveTracking(data);
    res.json({ ok: true });
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

  // Ollama status
  router.get('/ollama/status', async (_req, res) => {
    const status = await checkOllama();
    res.json(status);
  });

  return router;
}
