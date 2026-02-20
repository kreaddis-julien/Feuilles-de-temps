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
