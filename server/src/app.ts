import express from 'express';
import cors from 'cors';
import path from 'path';
import { Storage } from './storage.js';
import { createCustomersRouter } from './routes/customers.js';
import { createActivitiesRouter } from './routes/activities.js';
import { createTimesheetRouter } from './routes/timesheet.js';
import { createExportRouter } from './routes/export.js';
import { createStatsRouter } from './routes/stats.js';
import { createDeferredRouter } from './routes/deferred.js';

export function createApp(dataDir: string, opts?: { staticDir?: string }) {
  const app = express();
  const storage = new Storage(dataDir);

  app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'] }));
  app.use(express.json());

  // Validate date parameters to prevent path traversal
  app.param('date', (req, res, next, value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/customers', createCustomersRouter(storage));
  app.use('/api/activities', createActivitiesRouter(storage));
  app.use('/api/timesheet', createTimesheetRouter(storage));
  app.use('/api/export', createExportRouter(storage));
  app.use('/api/stats', createStatsRouter(storage));
  app.use('/api/deferred', createDeferredRouter(storage));

  // Serve frontend static files if --static-dir is provided
  if (opts?.staticDir) {
    app.use(express.static(opts.staticDir));
    // SPA fallback: serve index.html for non-API routes
    app.use((_req, res, next) => {
      if (_req.path.startsWith('/api')) return next();
      res.sendFile(path.join(opts.staticDir!, 'index.html'));
    });
  }

  return app;
}
