import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { createApp } from '../app.js';

const TEST_DATA_DIR = path.join(import.meta.dirname, '../../data-test');

describe('Projects API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    app = createApp(TEST_DATA_DIR);
  });

  afterEach(async () => {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('GET /api/projects returns empty list initially', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
  });

  it('POST /api/projects creates a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Client ABC', category: 'client' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Client ABC');
    expect(res.body.id).toBeDefined();
    expect(res.body.tasks).toEqual([]);
  });

  it('PATCH /api/projects/:id updates a project', async () => {
    const create = await request(app)
      .post('/api/projects')
      .send({ name: 'Old', category: 'client' });
    const res = await request(app)
      .patch(`/api/projects/${create.body.id}`)
      .send({ name: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
  });

  it('DELETE /api/projects/:id removes a project', async () => {
    const create = await request(app)
      .post('/api/projects')
      .send({ name: 'ToDelete', category: 'interne' });
    await request(app).delete(`/api/projects/${create.body.id}`).expect(204);
    const list = await request(app).get('/api/projects');
    expect(list.body.projects).toHaveLength(0);
  });

  it('POST /api/projects/:id/tasks adds a task', async () => {
    const proj = await request(app)
      .post('/api/projects')
      .send({ name: 'P1', category: 'client' });
    const res = await request(app)
      .post(`/api/projects/${proj.body.id}/tasks`)
      .send({ name: 'Task A' });
    expect(res.status).toBe(201);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].name).toBe('Task A');
  });

  it('DELETE /api/projects/:id/tasks/:taskId removes a task', async () => {
    const proj = await request(app)
      .post('/api/projects')
      .send({ name: 'P1', category: 'client' });
    const withTask = await request(app)
      .post(`/api/projects/${proj.body.id}/tasks`)
      .send({ name: 'Task A' });
    const taskId = withTask.body.tasks[0].id;
    const res = await request(app)
      .delete(`/api/projects/${proj.body.id}/tasks/${taskId}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(0);
  });
});
