import express from 'express';
import cors from 'cors';
import { Storage } from './storage.js';
import { createCustomersRouter } from './routes/customers.js';
import { createActivitiesRouter } from './routes/activities.js';
import { createTimesheetRouter } from './routes/timesheet.js';
import { createExportRouter } from './routes/export.js';
import { createStatsRouter } from './routes/stats.js';

export function createApp(dataDir: string) {
  const app = express();
  const storage = new Storage(dataDir);

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/customers', createCustomersRouter(storage));
  app.use('/api/activities', createActivitiesRouter(storage));
  app.use('/api/timesheet', createTimesheetRouter(storage));
  app.use('/api/export', createExportRouter(storage));
  app.use('/api/stats', createStatsRouter(storage));

  return app;
}
