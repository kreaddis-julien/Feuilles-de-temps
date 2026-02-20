import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';

export function createProjectsRouter(storage: Storage) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const data = await storage.loadProjects();
    res.json(data);
  });

  router.post('/', async (req, res) => {
    const { name, category } = req.body;
    const data = await storage.loadProjects();
    const project = { id: uuid(), name, category, tasks: [] as { id: string; name: string }[] };
    data.projects.push(project);
    await storage.saveProjects(data);
    res.status(201).json(project);
  });

  router.patch('/:id', async (req, res) => {
    const data = await storage.loadProjects();
    const project = data.projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    Object.assign(project, req.body, { id: project.id });
    await storage.saveProjects(data);
    res.json(project);
  });

  router.delete('/:id', async (req, res) => {
    const data = await storage.loadProjects();
    data.projects = data.projects.filter((p) => p.id !== req.params.id);
    await storage.saveProjects(data);
    res.status(204).end();
  });

  router.post('/:id/tasks', async (req, res) => {
    const data = await storage.loadProjects();
    const project = data.projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    project.tasks.push({ id: uuid(), name: req.body.name });
    await storage.saveProjects(data);
    res.status(201).json(project);
  });

  router.delete('/:id/tasks/:taskId', async (req, res) => {
    const data = await storage.loadProjects();
    const project = data.projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    project.tasks = project.tasks.filter((t) => t.id !== req.params.taskId);
    await storage.saveProjects(data);
    res.json(project);
  });

  return router;
}
