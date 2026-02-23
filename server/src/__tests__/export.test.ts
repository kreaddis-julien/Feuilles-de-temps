import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { createApp } from '../app.js';
import { Storage } from '../storage.js';

const TEST_DATA_DIR = path.join(import.meta.dirname, '../../data-test-export');

describe('Export API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    app = createApp(TEST_DATA_DIR);

    const storage = new Storage(TEST_DATA_DIR);
    await storage.saveActivities({
      activities: [
        { id: 'p1', name: 'Client ABC', customerId: '' },
      ],
    });
    await storage.saveTimesheet({
      date: '2026-02-20',
      entries: [
        {
          id: 'e1',
          activityId: 'p1',
          description: 'Worked on migration',
          segments: [
            { start: '2026-02-20T08:00:00.000Z', end: '2026-02-20T10:15:00.000Z' },
            { start: '2026-02-20T11:00:00.000Z', end: '2026-02-20T12:00:00.000Z' },
          ],
          totalMinutes: 195,
          roundedMinutes: 195,
          status: 'completed',
        },
      ],
      activeEntry: null,
      pausedEntries: [],
    });
  });

  afterEach(async () => {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('GET /api/export/:date returns CSV', async () => {
    const res = await request(app)
      .get('/api/export/2026-02-20')
      .query({ format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2); // header + 1 entry
    expect(lines[0]).toContain('Date');
    expect(lines[1]).toContain('Client ABC');
  });
});
