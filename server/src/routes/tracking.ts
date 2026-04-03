import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { Storage } from '../storage.js';
import type { ScreenSession, IdlePeriod } from '../types.js';
import { checkOllama } from '../ollama.js';

const execFileAsync = promisify(execFile);

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
    if (req.body.micEnabled !== undefined) {
      config.micEnabled = req.body.micEnabled;
      // Kill any running sox process immediately when mic is disabled
      if (!config.micEnabled) {
        try {
          await execFileAsync('pkill', ['-f', 'sox.*tempo-mic']);
        } catch { /* no sox running, that's fine */ }
      }
    }
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
    (data as any).claudePrompts.push({
      timestamp: timestamp || new Date().toISOString(),
      cwd: cwd || '',
      prompt: prompt.trim(),
      sessionId: sessionId || '',
      project: cwd ? cwd.split('/').pop() : '',
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

  // Receive audio chunk, transcribe with whisper-cli, store transcript
  router.post('/:date/audio', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    const now = new Date().toISOString();

    // Expect raw WAV data in body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);

    // Limit audio to 10MB
    if (audioBuffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Audio too large' });
    }

    if (audioBuffer.length < 1000) {
      return res.json({ ok: true, hasSpeech: false });
    }

    // Check audio energy level before transcribing (skip silence/low noise)
    // WAV header is 44 bytes, then 16-bit PCM samples
    const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset + 44, Math.floor((audioBuffer.length - 44) / 2));
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    // RMS < 500 = essentially silence/background noise (16-bit range is -32768 to 32767)
    if (rms < 500) {
      return res.json({ ok: true, hasSpeech: false, rms: Math.round(rms) });
    }

    // Write to temp file
    const tmpDir = os.tmpdir();
    const wavPath = path.join(tmpDir, `tempo-audio-${Date.now()}.wav`);
    await fs.writeFile(wavPath, audioBuffer);

    try {
      // Use the best available whisper model (prefer large-v3-turbo > large-v3 > medium > small)
      const modelsDir = path.join(os.homedir(), '.local/share/whisper-models');
      let whisperModel = '';
      for (const m of ['ggml-large-v3-turbo.bin', 'ggml-large-v3.bin', 'ggml-medium.bin', 'ggml-small.bin']) {
        const p = path.join(modelsDir, m);
        try { await fs.access(p); whisperModel = p; break; } catch { /* try next */ }
      }

      if (!whisperModel) {
        await fs.unlink(wavPath).catch(() => {});
        return res.status(503).json({ error: 'Whisper model not found' });
      }

      const { stdout } = await execFileAsync('/opt/homebrew/bin/whisper-cli', [
        '-m', whisperModel,
        '-f', wavPath,
        '-l', 'fr',
        '--no-timestamps',
        '-t', '4',
      ], { timeout: 60000 });

      const transcript = stdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('[') && l !== '(Sous-titres')
        .join(' ')
        .trim();

      // Only store if there's actual speech content (filter out whisper noise artifacts)
      const noisePatterns = [
        '(Propos inaudibles)', '(Sous-titres', '[BLANK_AUDIO]', '(Musique)',
        '(Bruit)', '( )', '[Musique]', 'Propos inaudibles',
        'Sous-titrage', 'Sous-titres', 'sous-titrage', 'sous-titres',
        'Merci d\'avoir regardé', 'Merci d\'avoir', 'Merci de votre',
        'Abonnez-vous', 'N\'oubliez pas', 'Like et abonnez',
        'ST\'', 'STP', 'cette vidéo',
        'tipeurs', 'souscripteurs', 'Salut mon gars',
        'Merci à mes', 'Merci à tous',
      ];
      // Filter transcripts that are only sound effects: *Bruit*, *Toc*, *cough*, etc.
      const cleaned = transcript
        .replace(/\*[^*]+\*/g, '')  // Remove *sound effects*
        .replace(/\s+/g, ' ')
        .trim();
      // Detect repeated phrases (hallucination pattern: "Salut mon gars. Salut mon gars.")
      const sentences = cleaned.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 3);
      const uniqueSentences = new Set(sentences);
      const isRepetitive = sentences.length >= 2 && uniqueSentences.size === 1;

      const hasSpeech = cleaned.length > 15 &&
        !transcript.match(/^\[.*\]$/) &&
        !transcript.match(/^\(.*\)$/) &&
        !noisePatterns.some(p => transcript.includes(p)) &&
        !transcript.match(/^[\s*\w\s]*\*[^*]+\*[\s*\w\s]*$/) &&
        !isRepetitive;

      if (hasSpeech) {
        (data as any).audioSegments.push({
          timestamp: now,
          duration: 30,
          transcript: cleaned,
          hasSpeech: true,
        });
        await storage.saveTracking(data);
      }

      res.json({ ok: true, hasSpeech, transcript: hasSpeech ? transcript : '' });
    } catch (err: any) {
      console.error('[tracking] whisper error:', err.message);
      res.json({ ok: true, hasSpeech: false, error: err.message });
    } finally {
      // Always cleanup temp file
      await fs.unlink(wavPath).catch(() => {});
    }
  });

  return router;
}
