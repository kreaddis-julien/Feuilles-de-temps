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

    if (audioBuffer.length < 1000) {
      return res.json({ ok: true, hasSpeech: false });
    }

    // Write to temp file
    const tmpDir = os.tmpdir();
    const wavPath = path.join(tmpDir, `tempo-audio-${Date.now()}.wav`);
    await fs.writeFile(wavPath, audioBuffer);

    try {
      // Check if audio has actual speech (simple size heuristic: 30s of silence at 16kHz mono = ~960KB)
      // Real speech typically produces larger files due to higher amplitude
      const whisperModel = path.join(os.homedir(), '.local/share/whisper-models/ggml-small.bin');

      // Check model exists
      try {
        await fs.access(whisperModel);
      } catch {
        await fs.unlink(wavPath).catch(() => {});
        return res.status(503).json({ error: 'Whisper model not found' });
      }

      const { stdout } = await execFileAsync('/opt/homebrew/bin/whisper-cli', [
        '-m', whisperModel,
        '-f', wavPath,
        '-l', 'fr',
        '--no-timestamps',
        '-t', '4',
      ], { timeout: 30000 });

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
      ];
      // Filter transcripts that are only sound effects: *Bruit*, *Toc*, *cough*, etc.
      const cleaned = transcript
        .replace(/\*[^*]+\*/g, '')  // Remove *sound effects*
        .replace(/\s+/g, ' ')
        .trim();
      const hasSpeech = cleaned.length > 15 &&
        !transcript.match(/^\[.*\]$/) &&
        !transcript.match(/^\(.*\)$/) &&
        !noisePatterns.some(p => transcript.includes(p)) &&
        !transcript.match(/^[\s*\w\s]*\*[^*]+\*[\s*\w\s]*$/);  // Only sound effects

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

  // Ollama status
  router.get('/ollama/status', async (_req, res) => {
    const status = await checkOllama();
    res.json(status);
  });

  return router;
}
