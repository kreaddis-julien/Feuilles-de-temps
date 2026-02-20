import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { createApp } from '../app.js';

const TEST_DATA_DIR = path.join(import.meta.dirname, '../../data-test-timesheet');
const DATE = '2026-02-20';

describe('Timesheet API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    app = createApp(TEST_DATA_DIR);
  });

  afterEach(async () => {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('GET /api/timesheet/:date returns empty day', async () => {
    const res = await request(app).get(`/api/timesheet/${DATE}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.activeEntry).toBeNull();
  });

  it('POST creates entry and starts timer', async () => {
    const res = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'Working' });
    expect(res.status).toBe(201);
    const entry = res.body.entries.find(
      (e: any) => e.projectId === 'p1',
    );
    expect(entry.status).toBe('active');
    expect(entry.segments).toHaveLength(1);
    expect(entry.segments[0].end).toBeNull();
    expect(res.body.activeEntry).toBe(entry.id);
  });

  it('POST /pause pauses active entry', async () => {
    const create = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'W' });
    const entryId = create.body.activeEntry;
    const res = await request(app)
      .post(`/api/timesheet/${DATE}/entries/${entryId}/pause`);
    expect(res.status).toBe(200);
    const entry = res.body.entries.find((e: any) => e.id === entryId);
    expect(entry.status).toBe('paused');
    expect(entry.segments[0].end).not.toBeNull();
    expect(res.body.activeEntry).toBeNull();
    expect(res.body.pausedEntries).toContain(entryId);
  });

  it('POST /resume resumes paused entry', async () => {
    const create = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'W' });
    const entryId = create.body.activeEntry;
    await request(app)
      .post(`/api/timesheet/${DATE}/entries/${entryId}/pause`);
    const res = await request(app)
      .post(`/api/timesheet/${DATE}/entries/${entryId}/resume`);
    expect(res.status).toBe(200);
    const entry = res.body.entries.find((e: any) => e.id === entryId);
    expect(entry.status).toBe('active');
    expect(entry.segments).toHaveLength(2);
    expect(entry.segments[1].end).toBeNull();
    expect(res.body.activeEntry).toBe(entryId);
    expect(res.body.pausedEntries).not.toContain(entryId);
  });

  it('interrupt workflow: new entry pauses current', async () => {
    const a = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'Task A' });
    const idA = a.body.activeEntry;
    const b = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p2', taskId: 't2', description: 'Interrupt B' });
    const idB = b.body.activeEntry;
    expect(idB).not.toBe(idA);
    const entryA = b.body.entries.find((e: any) => e.id === idA);
    expect(entryA.status).toBe('paused');
    expect(b.body.pausedEntries).toContain(idA);
  });

  it('PATCH updates entry description', async () => {
    const create = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'Old' });
    const entryId = create.body.activeEntry;
    const res = await request(app)
      .patch(`/api/timesheet/${DATE}/entries/${entryId}`)
      .send({ description: 'New' });
    const entry = res.body.entries.find((e: any) => e.id === entryId);
    expect(entry.description).toBe('New');
  });

  it('PATCH with status=completed stops timer and rounds', async () => {
    const create = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'W' });
    const entryId = create.body.activeEntry;
    const res = await request(app)
      .patch(`/api/timesheet/${DATE}/entries/${entryId}`)
      .send({ status: 'completed' });
    const entry = res.body.entries.find((e: any) => e.id === entryId);
    expect(entry.status).toBe('completed');
    expect(entry.segments[0].end).not.toBeNull();
    expect(entry.roundedMinutes % 15).toBe(0);
    expect(res.body.activeEntry).toBeNull();
  });

  it('DELETE removes entry', async () => {
    const create = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'W' });
    const entryId = create.body.activeEntry;
    const res = await request(app)
      .delete(`/api/timesheet/${DATE}/entries/${entryId}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.activeEntry).toBeNull();
  });
});
