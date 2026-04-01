import express from 'express';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { Storage } from './storage.js';
import { createCustomersRouter } from './routes/customers.js';
import { createActivitiesRouter } from './routes/activities.js';
import { createTimesheetRouter } from './routes/timesheet.js';
import { createExportRouter } from './routes/export.js';
import { createStatsRouter } from './routes/stats.js';
import { createDeferredRouter } from './routes/deferred.js';
import { createTrackingRouter } from './routes/tracking.js';

function getLocalIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

export function createApp(dataDir: string, opts?: { staticDir?: string }) {
  const app = express();
  const storage = new Storage(dataDir);

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/network', (_req, res) => {
    res.json({ ip: getLocalIp(), port: 3001 });
  });

  app.use('/api/customers', createCustomersRouter(storage));
  app.use('/api/activities', createActivitiesRouter(storage));
  app.use('/api/timesheet', createTimesheetRouter(storage));
  app.use('/api/export', createExportRouter(storage));
  app.use('/api/stats', createStatsRouter(storage));
  app.use('/api/deferred', createDeferredRouter(storage));
  app.use('/api/tracking', createTrackingRouter(storage));

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
