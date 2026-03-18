# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Local web app for tracking time with an interrupt-stack workflow, optimized for Odoo timesheet reporting. Tracks time in 15-minute increments with pause/resume support for task interruptions. Exports to CSV for Odoo import or AI-assisted description optimization.

## Architecture

```
[React + TS + Vite]  <--REST API-->  [Express + TS + Bun]  <--fs-->  [data/*.json]
     (client/)           :5173           (server/)           :3001
```

- **Monorepo** with `client/` and `server/`
- **Runtime:** Bun (not Node/npm) — `bun install`, `bun run`, `bun --watch`
- **Frontend:** React 19 + TypeScript + Vite. Proxy in vite.config.ts forwards `/api` to server.
- **Backend:** Express + TypeScript. App factory pattern (`createApp(dataDir)` in `server/src/app.ts`).
- **Storage:** JSON files in `data/` — one file per day (`YYYY-MM-DD.json`) + `projects.json` for the project/task registry.
- **Tests:** Vitest for both client and server. Backend tests use supertest with isolated data directories per suite to avoid parallel test conflicts.

## Commands

```bash
bun run dev          # Start both servers (concurrently)
bun run dev:server   # Server only (port 3001, --watch)
bun run dev:client   # Client only (port 5173)
bun run test         # Run all tests
bun run test:server  # Server tests only
bun run test:client  # Client tests only

# Run a single server test file:
cd server && bunx vitest run src/__tests__/timesheet.test.ts

# Watch mode:
cd server && bunx vitest src/__tests__/timesheet.test.ts
```

## Key Patterns

- **Router factories:** Each route file exports a `createXxxRouter(storage)` function. Mounted in `app.ts`.
- **Storage class:** `server/src/storage.ts` — handles all JSON file I/O. Injected into routers via constructor.
- **Time utils:** `server/src/time-utils.ts` — `roundUp15()`, `calcSegmentMinutes()`, `calcTotalMinutes()`, `nowHHmm()`.
- **Types duplicated:** `server/src/types.ts` and `client/src/types.ts` are identical copies (no shared package).
- **API client:** `client/src/api.ts` — typed fetch wrapper for all endpoints.
- **Timer logic:** Server stores segment start/end timestamps. Frontend computes elapsed time client-side via `setInterval(1000)` from last open segment's `start`.

## Data Model

- **Projects:** `{ id, name, category: 'client'|'interne'|'support', tasks: [{ id, name }] }`
- **Timesheet entries:** `{ id, projectId, taskId, description, segments: [{ start, end }], totalMinutes, roundedMinutes, status: 'active'|'paused'|'completed' }`
- **Day file:** `{ date, entries[], activeEntries: id[], pausedEntries: id[] }`

## Business Rules

- Time rounded up to nearest 15 minutes on completion
- Multiple timers can run simultaneously; manual pause/resume supported
- Paused entries form a LIFO stack (interruptions can nest)
- Timer survives browser refresh (computed from stored timestamps, not intervals)
