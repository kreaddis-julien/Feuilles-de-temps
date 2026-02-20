# Timesheet Tracker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local web app for tracking time with interrupt-stack workflow, exporting to CSV for Odoo reporting.

**Architecture:** React+TS frontend (Vite) communicates via REST with an Express+TS backend that persists data as JSON files (one per day + a project registry). Timer-first UX with pause/resume stack for interruptions.

**Tech Stack:** React 19, TypeScript, Vite, Express, Vitest, React Testing Library, uuid

---

## Task 1: Scaffold Monorepo

**Files:**
- Create: `package.json` (root)
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `.gitignore`

**Step 1: Create root package.json**

```json
{
  "name": "timesheet-tracker",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "cd server && npm run dev",
    "dev:client": "cd client && npm run dev",
    "test": "concurrently \"npm run test:server\" \"npm run test:client\"",
    "test:server": "cd server && npm test",
    "test:client": "cd client && npm test"
  },
  "devDependencies": {
    "concurrently": "^9.1.2"
  }
}
```

**Step 2: Scaffold server**

```bash
cd server && npm init -y
```

Install dependencies:
```bash
npm i express cors uuid
npm i -D typescript @types/express @types/cors @types/uuid @types/node tsx vitest
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"]
}
```

Add to `server/package.json` scripts:
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Create `server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

Create minimal `server/src/index.ts`:
```ts
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
```

**Step 3: Scaffold client**

```bash
cd client && npm create vite@latest . -- --template react-ts
npm install
npm i react-router-dom
npm i -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Add to `client/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

Add test config to `client/vitest.config.ts` (or merge into vite.config.ts):
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
});
```

Create `client/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom';
```

Add to `client/package.json` scripts:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
data/
exports/
.env
```

**Step 5: Install root deps and verify**

```bash
cd /path/to/timesheet && npm install
```

Run: `cd server && npm run dev` — verify "Server running on http://localhost:3001"
Run: `cd client && npm run dev` — verify Vite dev server starts on 5173

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with client (React+Vite) and server (Express+TS)"
```

---

## Task 2: Shared Types

**Files:**
- Create: `server/src/types.ts`

These types define the entire data model. The frontend will duplicate them (or we keep them in server and the frontend uses its own copy — simpler than shared packages for a local app).

**Step 1: Write types**

`server/src/types.ts`:
```ts
export type Category = 'client' | 'interne' | 'support';

export interface Task {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  category: Category;
  tasks: Task[];
}

export interface ProjectsData {
  projects: Project[];
}

export interface Segment {
  start: string; // HH:mm
  end: string | null; // null = timer running
}

export type EntryStatus = 'active' | 'paused' | 'completed';

export interface TimesheetEntry {
  id: string;
  projectId: string;
  taskId: string;
  description: string;
  segments: Segment[];
  totalMinutes: number;
  roundedMinutes: number;
  status: EntryStatus;
}

export interface TimesheetDay {
  date: string; // YYYY-MM-DD
  entries: TimesheetEntry[];
  activeEntry: string | null;
  pausedEntries: string[];
}
```

**Step 2: Copy types for client**

Create `client/src/types.ts` with the same content.

**Step 3: Commit**

```bash
git add server/src/types.ts client/src/types.ts
git commit -m "feat: add shared data model types"
```

---

## Task 3: Backend — File Storage Layer

**Files:**
- Create: `server/src/storage.ts`
- Create: `server/src/__tests__/storage.test.ts`

This module handles reading/writing JSON files in `data/`.

**Step 1: Write failing tests**

`server/src/__tests__/storage.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Storage } from '../storage.js';

const TEST_DATA_DIR = path.join(import.meta.dirname, '../../data-test');

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
```

**Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/__tests__/storage.test.ts
```
Expected: FAIL — `Storage` not found

**Step 3: Implement storage**

`server/src/storage.ts`:
```ts
import fs from 'fs/promises';
import path from 'path';
import type { ProjectsData, TimesheetDay } from './types.js';

export class Storage {
  constructor(private dataDir: string) {}

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async loadProjects(): Promise<ProjectsData> {
    try {
      const raw = await fs.readFile(
        path.join(this.dataDir, 'projects.json'),
        'utf-8',
      );
      return JSON.parse(raw);
    } catch {
      return { projects: [] };
    }
  }

  async saveProjects(data: ProjectsData): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(
      path.join(this.dataDir, 'projects.json'),
      JSON.stringify(data, null, 2),
    );
  }

  async loadTimesheet(date: string): Promise<TimesheetDay> {
    try {
      const raw = await fs.readFile(
        path.join(this.dataDir, `${date}.json`),
        'utf-8',
      );
      return JSON.parse(raw);
    } catch {
      return { date, entries: [], activeEntry: null, pausedEntries: [] };
    }
  }

  async saveTimesheet(data: TimesheetDay): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(
      path.join(this.dataDir, `${data.date}.json`),
      JSON.stringify(data, null, 2),
    );
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run src/__tests__/storage.test.ts
```
Expected: all PASS

**Step 5: Commit**

```bash
git add server/src/storage.ts server/src/__tests__/storage.test.ts
git commit -m "feat: add file storage layer for projects and timesheets"
```

---

## Task 4: Backend — Time Utilities

**Files:**
- Create: `server/src/time-utils.ts`
- Create: `server/src/__tests__/time-utils.test.ts`

**Step 1: Write failing tests**

`server/src/__tests__/time-utils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { roundUp15, calcSegmentMinutes, calcTotalMinutes, nowHHmm } from '../time-utils.js';

describe('roundUp15', () => {
  it('rounds 0 to 0', () => expect(roundUp15(0)).toBe(0));
  it('rounds 1 to 15', () => expect(roundUp15(1)).toBe(15));
  it('rounds 15 to 15', () => expect(roundUp15(15)).toBe(15));
  it('rounds 16 to 30', () => expect(roundUp15(16)).toBe(30));
  it('rounds 37 to 45', () => expect(roundUp15(37)).toBe(45));
  it('rounds 60 to 60', () => expect(roundUp15(60)).toBe(60));
  it('rounds 61 to 75', () => expect(roundUp15(61)).toBe(75));
});

describe('calcSegmentMinutes', () => {
  it('calculates minutes between two times', () => {
    expect(calcSegmentMinutes({ start: '08:00', end: '10:15' })).toBe(135);
  });
  it('returns 0 for null end', () => {
    expect(calcSegmentMinutes({ start: '08:00', end: null })).toBe(0);
  });
});

describe('calcTotalMinutes', () => {
  it('sums all closed segments', () => {
    const segments = [
      { start: '08:00', end: '10:00' },
      { start: '11:00', end: '12:00' },
    ];
    expect(calcTotalMinutes(segments)).toBe(180);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/__tests__/time-utils.test.ts
```

**Step 3: Implement**

`server/src/time-utils.ts`:
```ts
import type { Segment } from './types.js';

export function roundUp15(minutes: number): number {
  if (minutes === 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

export function calcSegmentMinutes(segment: Segment): number {
  if (!segment.end) return 0;
  return timeToMinutes(segment.end) - timeToMinutes(segment.start);
}

export function calcTotalMinutes(segments: Segment[]): number {
  return segments.reduce((sum, seg) => sum + calcSegmentMinutes(seg), 0);
}

export function nowHHmm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
```

**Step 4: Run tests — all PASS**

**Step 5: Commit**

```bash
git add server/src/time-utils.ts server/src/__tests__/time-utils.test.ts
git commit -m "feat: add time utility functions (rounding, segment calculation)"
```

---

## Task 5: Backend — Projects API

**Files:**
- Create: `server/src/routes/projects.ts`
- Create: `server/src/__tests__/projects.test.ts`
- Modify: `server/src/index.ts` (mount routes)

**Step 1: Write failing tests**

`server/src/__tests__/projects.test.ts` — use `supertest` to test Express routes:

```bash
cd server && npm i -D supertest @types/supertest
```

```ts
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
```

**Step 2: Refactor app creation**

Extract Express app factory from `server/src/index.ts` into `server/src/app.ts` so tests can create isolated instances:

`server/src/app.ts`:
```ts
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
```

Update `server/src/index.ts`:
```ts
import path from 'path';
import { createApp } from './app.js';

const DATA_DIR = path.join(import.meta.dirname, '../../data');
const app = createApp(DATA_DIR);

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

**Step 3: Implement projects router**

`server/src/routes/projects.ts`:
```ts
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
    const project = { id: uuid(), name, category, tasks: [] };
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
```

**Step 4: Run tests — all PASS**

```bash
cd server && npx vitest run src/__tests__/projects.test.ts
```

**Step 5: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/src/routes/projects.ts server/src/__tests__/projects.test.ts
git commit -m "feat: add projects CRUD API with tests"
```

---

## Task 6: Backend — Timesheet API

**Files:**
- Create: `server/src/routes/timesheet.ts`
- Create: `server/src/__tests__/timesheet.test.ts`
- Modify: `server/src/app.ts` (mount routes)

**Step 1: Write failing tests**

`server/src/__tests__/timesheet.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { createApp } from '../app.js';

const TEST_DATA_DIR = path.join(import.meta.dirname, '../../data-test');
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
    // Create and pause
    const create = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'W' });
    const entryId = create.body.activeEntry;
    await request(app)
      .post(`/api/timesheet/${DATE}/entries/${entryId}/pause`);
    // Resume
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
    // Start task A
    const a = await request(app)
      .post(`/api/timesheet/${DATE}/entries`)
      .send({ projectId: 'p1', taskId: 't1', description: 'Task A' });
    const idA = a.body.activeEntry;

    // Start task B (interruption) — A should auto-pause
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
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement timesheet router**

`server/src/routes/timesheet.ts`:
```ts
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';
import type { TimesheetEntry } from '../types.js';
import { nowHHmm, calcTotalMinutes, roundUp15 } from '../time-utils.js';

export function createTimesheetRouter(storage: Storage) {
  const router = Router();

  router.get('/:date', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    res.json(data);
  });

  router.post('/:date/entries', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const { projectId, taskId, description } = req.body;

    // Auto-pause current active entry
    if (data.activeEntry) {
      const active = data.entries.find((e) => e.id === data.activeEntry);
      if (active) {
        const openSeg = active.segments.find((s) => s.end === null);
        if (openSeg) openSeg.end = nowHHmm();
        active.totalMinutes = calcTotalMinutes(active.segments);
        active.status = 'paused';
        data.pausedEntries.push(active.id);
      }
    }

    const entry: TimesheetEntry = {
      id: uuid(),
      projectId,
      taskId,
      description,
      segments: [{ start: nowHHmm(), end: null }],
      totalMinutes: 0,
      roundedMinutes: 0,
      status: 'active',
    };

    data.entries.push(entry);
    data.activeEntry = entry.id;
    await storage.saveTimesheet(data);
    res.status(201).json(data);
  });

  router.patch('/:date/entries/:id', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const entry = data.entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });

    // Handle completion
    if (req.body.status === 'completed') {
      const openSeg = entry.segments.find((s) => s.end === null);
      if (openSeg) openSeg.end = nowHHmm();
      entry.totalMinutes = calcTotalMinutes(entry.segments);
      entry.roundedMinutes = roundUp15(entry.totalMinutes);
      entry.status = 'completed';
      if (data.activeEntry === entry.id) data.activeEntry = null;
      data.pausedEntries = data.pausedEntries.filter((id) => id !== entry.id);
    } else {
      // Update fields (description, roundedMinutes override, etc.)
      if (req.body.description !== undefined) entry.description = req.body.description;
      if (req.body.roundedMinutes !== undefined) entry.roundedMinutes = req.body.roundedMinutes;
      if (req.body.projectId !== undefined) entry.projectId = req.body.projectId;
      if (req.body.taskId !== undefined) entry.taskId = req.body.taskId;
    }

    await storage.saveTimesheet(data);
    res.json(data);
  });

  router.delete('/:date/entries/:id', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    data.entries = data.entries.filter((e) => e.id !== req.params.id);
    if (data.activeEntry === req.params.id) data.activeEntry = null;
    data.pausedEntries = data.pausedEntries.filter((id) => id !== req.params.id);
    await storage.saveTimesheet(data);
    res.json(data);
  });

  router.post('/:date/entries/:id/pause', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const entry = data.entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });

    const openSeg = entry.segments.find((s) => s.end === null);
    if (openSeg) openSeg.end = nowHHmm();
    entry.totalMinutes = calcTotalMinutes(entry.segments);
    entry.status = 'paused';

    if (data.activeEntry === entry.id) data.activeEntry = null;
    if (!data.pausedEntries.includes(entry.id)) {
      data.pausedEntries.push(entry.id);
    }

    await storage.saveTimesheet(data);
    res.json(data);
  });

  router.post('/:date/entries/:id/resume', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const entry = data.entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });

    // Pause current active if any
    if (data.activeEntry && data.activeEntry !== entry.id) {
      const active = data.entries.find((e) => e.id === data.activeEntry);
      if (active) {
        const openSeg = active.segments.find((s) => s.end === null);
        if (openSeg) openSeg.end = nowHHmm();
        active.totalMinutes = calcTotalMinutes(active.segments);
        active.status = 'paused';
        if (!data.pausedEntries.includes(active.id)) {
          data.pausedEntries.push(active.id);
        }
      }
    }

    // Resume this entry with a new segment
    entry.segments.push({ start: nowHHmm(), end: null });
    entry.status = 'active';
    data.activeEntry = entry.id;
    data.pausedEntries = data.pausedEntries.filter((id) => id !== entry.id);

    await storage.saveTimesheet(data);
    res.json(data);
  });

  return router;
}
```

Mount in `server/src/app.ts`:
```ts
import { createTimesheetRouter } from './routes/timesheet.js';
// ... inside createApp:
app.use('/api/timesheet', createTimesheetRouter(storage));
```

**Step 4: Run tests — all PASS**

```bash
cd server && npx vitest run
```

**Step 5: Commit**

```bash
git add server/src/routes/timesheet.ts server/src/__tests__/timesheet.test.ts server/src/app.ts
git commit -m "feat: add timesheet API with timer, pause/resume, interrupt workflow"
```

---

## Task 7: Backend — CSV Export

**Files:**
- Create: `server/src/routes/export.ts`
- Create: `server/src/__tests__/export.test.ts`
- Modify: `server/src/app.ts`

**Step 1: Write failing tests**

`server/src/__tests__/export.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { createApp } from '../app.js';
import { Storage } from '../storage.js';

const TEST_DATA_DIR = path.join(import.meta.dirname, '../../data-test');

describe('Export API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    app = createApp(TEST_DATA_DIR);

    // Seed project data
    const storage = new Storage(TEST_DATA_DIR);
    await storage.saveProjects({
      projects: [
        { id: 'p1', name: 'Client ABC', category: 'client', tasks: [{ id: 't1', name: 'Migration' }] },
      ],
    });
    await storage.saveTimesheet({
      date: '2026-02-20',
      entries: [
        {
          id: 'e1',
          projectId: 'p1',
          taskId: 't1',
          description: 'Worked on migration',
          segments: [
            { start: '08:00', end: '10:15' },
            { start: '11:00', end: '12:00' },
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
    expect(lines[1]).toContain('Migration');
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement export router**

`server/src/routes/export.ts`:
```ts
import { Router } from 'express';
import type { Storage } from '../storage.js';
import type { TimesheetEntry } from '../types.js';

export function createExportRouter(storage: Storage) {
  const router = Router();

  router.get('/:date', async (req, res) => {
    const projects = await storage.loadProjects();
    const day = await storage.loadTimesheet(req.params.date);
    const csv = buildCsv(day.entries, projects.projects, day.date);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${req.params.date}.csv`);
    res.send(csv);
  });

  router.get('/', async (req, res) => {
    const { from, to } = req.query as { from: string; to: string };
    const projects = await storage.loadProjects();
    let allRows: string[] = [];

    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const day = await storage.loadTimesheet(dateStr);
      if (day.entries.length > 0) {
        allRows.push(
          ...day.entries.map((e) => entryToCsvRow(e, projects.projects, dateStr)),
        );
      }
    }

    const csv = CSV_HEADER + '\n' + allRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${from}-to-${to}.csv`);
    res.send(csv);
  });

  return router;
}

const CSV_HEADER =
  'Date,Projet,Catégorie,Tâche,Description,Heure début,Heure fin,Durée réelle (min),Durée arrondie (min),Segments,Interruptions';

function buildCsv(
  entries: TimesheetEntry[],
  projects: { id: string; name: string; category: string; tasks: { id: string; name: string }[] }[],
  date: string,
): string {
  const rows = entries.map((e) => entryToCsvRow(e, projects, date));
  return CSV_HEADER + '\n' + rows.join('\n');
}

function entryToCsvRow(
  entry: TimesheetEntry,
  projects: { id: string; name: string; category: string; tasks: { id: string; name: string }[] }[],
  date: string,
): string {
  const project = projects.find((p) => p.id === entry.projectId);
  const task = project?.tasks.find((t) => t.id === entry.taskId);
  const firstStart = entry.segments[0]?.start ?? '';
  const lastEnd = entry.segments[entry.segments.length - 1]?.end ?? '';
  const interruptions = Math.max(0, entry.segments.length - 1);

  return [
    date,
    csvEscape(project?.name ?? entry.projectId),
    project?.category ?? '',
    csvEscape(task?.name ?? entry.taskId),
    csvEscape(entry.description),
    firstStart,
    lastEnd,
    entry.totalMinutes,
    entry.roundedMinutes,
    entry.segments.length,
    interruptions,
  ].join(',');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

Mount in `server/src/app.ts`:
```ts
import { createExportRouter } from './routes/export.js';
// ... inside createApp:
app.use('/api/export', createExportRouter(storage));
```

**Step 4: Run tests — all PASS**

```bash
cd server && npx vitest run
```

**Step 5: Commit**

```bash
git add server/src/routes/export.ts server/src/__tests__/export.test.ts server/src/app.ts
git commit -m "feat: add CSV export API (single day and date range)"
```

---

## Task 8: Frontend — API Client & Routing

**Files:**
- Create: `client/src/api.ts`
- Create: `client/src/App.tsx`
- Modify: `client/src/main.tsx`

**Step 1: Create API client**

`client/src/api.ts`:
```ts
import type { TimesheetDay, ProjectsData, Project } from './types';

const BASE = '/api';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Timesheet
export const getTimesheet = (date: string) =>
  json<TimesheetDay>(`/timesheet/${date}`);

export const createEntry = (date: string, body: { projectId: string; taskId: string; description: string }) =>
  json<TimesheetDay>(`/timesheet/${date}/entries`, { method: 'POST', body: JSON.stringify(body) });

export const updateEntry = (date: string, id: string, body: Record<string, unknown>) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}`, { method: 'DELETE' });

export const pauseEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}/pause`, { method: 'POST' });

export const resumeEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}/resume`, { method: 'POST' });

// Projects
export const getProjects = () =>
  json<ProjectsData>('/projects');

export const createProject = (body: { name: string; category: string }) =>
  json<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });

export const updateProject = (id: string, body: Partial<Project>) =>
  json<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteProject = (id: string) =>
  fetch(`${BASE}/projects/${id}`, { method: 'DELETE' });

export const addTask = (projectId: string, body: { name: string }) =>
  json<Project>(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(body) });

export const deleteTask = (projectId: string, taskId: string) =>
  json<Project>(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });

// Export
export const getExportUrl = (date: string) =>
  `${BASE}/export/${date}?format=csv`;

export const getExportRangeUrl = (from: string, to: string) =>
  `${BASE}/export?from=${from}&to=${to}&format=csv`;
```

**Step 2: Setup routing**

`client/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import TrackerPage from './pages/TrackerPage';
import ProjectsPage from './pages/ProjectsPage';

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <NavLink to="/">Tracker</NavLink>
        <NavLink to="/projects">Projets</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<TrackerPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

Create placeholder pages:

`client/src/pages/TrackerPage.tsx`:
```tsx
export default function TrackerPage() {
  return <div>Tracker — à implémenter</div>;
}
```

`client/src/pages/ProjectsPage.tsx`:
```tsx
export default function ProjectsPage() {
  return <div>Projets — à implémenter</div>;
}
```

Update `client/src/main.tsx` to render `<App />`.

**Step 3: Verify dev server runs**

```bash
cd client && npm run dev
```
Open http://localhost:5173, verify navigation works.

**Step 4: Commit**

```bash
git add client/src/api.ts client/src/App.tsx client/src/pages/ client/src/main.tsx client/src/types.ts
git commit -m "feat: add API client, routing, and page stubs"
```

---

## Task 9: Frontend — Projects Management Page

**Files:**
- Create: `client/src/pages/ProjectsPage.tsx`

**Step 1: Implement ProjectsPage**

Full CRUD interface:
- List projects grouped by category
- Inline "add project" form (name + category dropdown)
- Each project expandable to show its tasks
- "Add task" input inside each project
- Delete buttons on projects and tasks

Use `useEffect` + `useState` to fetch/refresh from API. No state management library needed — keep it simple with local state and refetch after mutations.

Key behaviors:
- `getProjects()` on mount
- `createProject({ name, category })` on form submit → refetch
- `addTask(projectId, { name })` on task form submit → refetch
- `deleteProject(id)` on click → refetch
- `deleteTask(projectId, taskId)` on click → refetch

**Step 2: Verify in browser**

Start both servers (`npm run dev` at root), create a project, add tasks, delete them.

**Step 3: Commit**

```bash
git add client/src/pages/ProjectsPage.tsx
git commit -m "feat: add projects management page with CRUD"
```

---

## Task 10: Frontend — Tracker Page (Core)

**Files:**
- Modify: `client/src/pages/TrackerPage.tsx`

This is the main page. Implement in sub-steps:

**Step 1: Date navigation + data loading**

- State: `currentDate` (string YYYY-MM-DD, defaults to today)
- State: `day` (TimesheetDay from API)
- State: `projects` (ProjectsData from API for resolving names)
- Prev/next date buttons
- `useEffect` to fetch timesheet + projects when date changes

**Step 2: Active task display**

- Find entry matching `day.activeEntry`
- Show project name, task name, description
- Live timer: `useEffect` with `setInterval(1000)` computing elapsed from last segment's `start`
- Buttons: [Pause & Interruption], [Terminer]

**Step 3: Paused tasks list**

- Map `day.pausedEntries` to entries
- Each shows project/task name, accumulated time
- Button [Reprendre] calls `resumeEntry(date, id)` → refetch

**Step 4: Completed entries list**

- Filter entries with `status === 'completed'`
- Show project, task, description, rounded duration
- Editable description (click to edit, blur to save via `updateEntry`)
- Editable rounded minutes (click to adjust)
- Delete button

**Step 5: New task form**

- Project combobox (searchable dropdown from `projects.projects`)
- Task combobox (filtered by selected project)
- "+" button next to each to create new project/task inline
- Description textarea
- Submit calls `createEntry(date, { projectId, taskId, description })` → refetch

**Step 6: Progress bar**

- Sum of `roundedMinutes` for all entries of the day
- Bar showing total vs 480 min (8h)
- Text: "4h30 / 8h00"

**Step 7: Export button**

- Button that opens `getExportUrl(currentDate)` in a new tab (triggers CSV download)

**Step 8: Verify full workflow in browser**

1. Create a project + task in /projects
2. Go to Tracker, start a task
3. Let timer run, interrupt with new task
4. Finish interrupt, resume original
5. Complete both tasks
6. Export CSV

**Step 9: Commit**

```bash
git add client/src/pages/TrackerPage.tsx
git commit -m "feat: add tracker page with timer, interrupts, progress, and export"
```

---

## Task 11: Frontend — Styling

**Files:**
- Create: `client/src/index.css`

**Step 1: Add clean, functional CSS**

Keep it minimal and readable. No CSS framework — plain CSS with CSS custom properties for colors. The app should look clean and professional without being overdesigned.

Key elements to style:
- Navigation bar
- Active task card (prominent, with large timer)
- Paused tasks (visually distinct, muted)
- Completed entries (compact list)
- Progress bar
- Forms and comboboxes
- Buttons with clear visual hierarchy (primary action vs secondary)

**Step 2: Verify responsive layout**

Should work at typical desktop widths (1024px+). No need for mobile responsiveness.

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "style: add clean CSS for tracker interface"
```

---

## Task 12: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update with actual project info**

Now that the project exists, update CLAUDE.md with:
- Actual commands: `npm run dev`, `npm run test`, `npm run test:server`, etc.
- Architecture description
- File structure overview
- Key patterns (Storage class, router factories, API client)

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with project architecture and commands"
```

---

## Summary

| Task | Description | Commits |
|------|------------|---------|
| 1 | Scaffold monorepo | 1 |
| 2 | Shared types | 1 |
| 3 | File storage layer | 1 |
| 4 | Time utilities | 1 |
| 5 | Projects API | 1 |
| 6 | Timesheet API | 1 |
| 7 | CSV export | 1 |
| 8 | Frontend routing + API client | 1 |
| 9 | Projects management page | 1 |
| 10 | Tracker page (core) | 1 |
| 11 | Styling | 1 |
| 12 | Update CLAUDE.md | 1 |

**Total: 12 tasks, ~12 commits**

Backend tasks (3-7) are fully TDD with Vitest + Supertest. Frontend tasks (8-11) are verified manually in browser.
