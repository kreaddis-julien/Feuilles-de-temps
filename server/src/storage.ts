import fs from 'fs/promises';
import path from 'path';
import type { CustomersData, ActivitiesData, TimesheetDay } from './types.js';

export class Storage {
  constructor(private dataDir: string) {}

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const tmp = filePath + '.tmp';
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  }

  async loadActivities(): Promise<ActivitiesData> {
    try {
      const raw = await fs.readFile(
        path.join(this.dataDir, 'activities.json'),
        'utf-8',
      );
      const data = JSON.parse(raw) as ActivitiesData;
      for (const a of data.activities) {
        if (!('customerId' in a)) (a as any).customerId = '';
        delete (a as any).category;
        delete (a as any).tasks;
      }
      return data;
    } catch {
      // Migration: try loading from legacy projects.json
      try {
        const raw = await fs.readFile(
          path.join(this.dataDir, 'projects.json'),
          'utf-8',
        );
        const legacy = JSON.parse(raw);
        const activities = (legacy.projects || []).map((p: any) => {
          if (!('customerId' in p)) p.customerId = '';
          delete p.category;
          delete p.tasks;
          return p;
        });
        const data: ActivitiesData = { activities };
        await this.saveActivities(data);
        return data;
      } catch {
        return { activities: [] };
      }
    }
  }

  async saveActivities(data: ActivitiesData): Promise<void> {
    await this.ensureDir();
    await this.atomicWrite(
      path.join(this.dataDir, 'activities.json'),
      JSON.stringify(data, null, 2),
    );
  }

  async loadCustomers(): Promise<CustomersData> {
    try {
      const raw = await fs.readFile(
        path.join(this.dataDir, 'customers.json'),
        'utf-8',
      );
      const data = JSON.parse(raw) as CustomersData;
      for (const c of data.customers) {
        if (!c.type) c.type = 'externe';
      }
      return data;
    } catch {
      return { customers: [] };
    }
  }

  async saveCustomers(data: CustomersData): Promise<void> {
    await this.ensureDir();
    await this.atomicWrite(
      path.join(this.dataDir, 'customers.json'),
      JSON.stringify(data, null, 2),
    );
  }

  async loadTimesheet(date: string): Promise<TimesheetDay> {
    try {
      const raw = await fs.readFile(
        path.join(this.dataDir, `${date}.json`),
        'utf-8',
      );
      const data = JSON.parse(raw) as TimesheetDay;
      // Migrate: rename projectId → activityId in existing entries
      for (const entry of data.entries) {
        if ('projectId' in entry && !('activityId' in entry)) {
          (entry as any).activityId = (entry as any).projectId;
          delete (entry as any).projectId;
        }
      }
      return data;
    } catch {
      return { date, entries: [], activeEntry: null, pausedEntries: [] };
    }
  }

  async saveTimesheet(data: TimesheetDay): Promise<void> {
    await this.ensureDir();
    await this.atomicWrite(
      path.join(this.dataDir, `${data.date}.json`),
      JSON.stringify(data, null, 2),
    );
  }
}
