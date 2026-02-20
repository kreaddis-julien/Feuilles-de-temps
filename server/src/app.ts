import express from 'express';
import cors from 'cors';
import { Storage } from './storage.js';
import { createProjectsRouter } from './routes/projects.js';

export function createApp(dataDir: string) {
  const app = express();
  const storage = new Storage(dataDir);

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/projects', createProjectsRouter(storage));

  return app;
}
