import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Storage } from '../storage.js';

const TEST_DATA_DIR = path.join(import.meta.dirname, '../../data-test-storage');

describe('Storage', () => {
  let storage: Storage;

  beforeEach(async () => {
    storage = new Storage(TEST_DATA_DIR);
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('projects', () => {
    it('returns empty projects list when file does not exist', async () => {
      const data = await storage.loadProjects();
      expect(data.projects).toEqual([]);
    });

    it('saves and loads projects', async () => {
      const projects = {
        projects: [
          { id: 'p1', name: 'Test', category: 'client' as const, tasks: [] },
        ],
      };
      await storage.saveProjects(projects);
      const loaded = await storage.loadProjects();
      expect(loaded).toEqual(projects);
    });
  });

  describe('timesheet', () => {
    it('returns empty timesheet when file does not exist', async () => {
      const data = await storage.loadTimesheet('2026-02-20');
      expect(data.date).toBe('2026-02-20');
      expect(data.entries).toEqual([]);
      expect(data.activeEntry).toBeNull();
      expect(data.pausedEntries).toEqual([]);
    });

    it('saves and loads timesheet', async () => {
      const day = {
        date: '2026-02-20',
        entries: [],
        activeEntry: null,
        pausedEntries: [],
      };
      await storage.saveTimesheet(day);
      const loaded = await storage.loadTimesheet('2026-02-20');
      expect(loaded).toEqual(day);
    });
  });
});
