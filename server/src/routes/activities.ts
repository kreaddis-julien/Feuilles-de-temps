import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';

export function createActivitiesRouter(storage: Storage) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const data = await storage.loadActivities();
    res.json(data);
  });

  router.post('/', async (req, res) => {
    const { name, customerId } = req.body;
    const data = await storage.loadActivities();
    const activity = { id: uuid(), name, customerId: customerId || '' };
    data.activities.push(activity);
    await storage.saveActivities(data);
    res.status(201).json(activity);
  });

  router.patch('/:id', async (req, res) => {
    const data = await storage.loadActivities();
    const activity = data.activities.find((a) => a.id === req.params.id);
    if (!activity) return res.status(404).json({ error: 'Not found' });
    Object.assign(activity, req.body, { id: activity.id });
    await storage.saveActivities(data);
    res.json(activity);
  });

  router.delete('/:id', async (req, res) => {
    const data = await storage.loadActivities();
    data.activities = data.activities.filter((a) => a.id !== req.params.id);
    await storage.saveActivities(data);
    res.status(204).end();
  });

  return router;
}
