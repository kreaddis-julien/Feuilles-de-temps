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
    const filePath = path.join(this.dataDir, 'activities.json');
    let raw: string | null = null;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (raw !== null) {
      const data = JSON.parse(raw) as ActivitiesData;
      for (const a of data.activities) {
        if (!('customerId' in a)) (a as any).customerId = '';
        delete (a as any).category;
        delete (a as any).tasks;
      }
      return data;
    }
    // Migration: try loading from legacy projects.json
    try {
      const legacyRaw = await fs.readFile(
        path.join(this.dataDir, 'projects.json'),
        'utf-8',
      );
      const legacy = JSON.parse(legacyRaw);
      const activities = (legacy.projects || []).map((p: any) => {
        if (!('customerId' in p)) p.customerId = '';
        delete p.category;
        delete p.tasks;
        return p;
      });
      const data: ActivitiesData = { activities };
      await this.saveActivities(data);
      return data;
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      return { activities: [] };
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
    const filePath = path.join(this.dataDir, 'customers.json');
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') return { customers: [] };
      throw err;
    }
    const data = JSON.parse(raw) as CustomersData;
    for (const c of data.customers) {
      if (!c.type) c.type = 'externe';
    }
    return data;
  }

  async saveCustomers(data: CustomersData): Promise<void> {
    await this.ensureDir();
    await this.atomicWrite(
      path.join(this.dataDir, 'customers.json'),
      JSON.stringify(data, null, 2),
    );
  }

  async loadTimesheet(date: string): Promise<TimesheetDay> {
    const filePath = path.join(this.dataDir, `${date}.json`);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { date, entries: [], activeEntry: null, pausedEntries: [] };
      }
      throw err;
    }
    const data = JSON.parse(raw) as TimesheetDay;
    // Migrate: rename projectId → activityId in existing entries
    for (const entry of data.entries) {
      if ('projectId' in entry && !('activityId' in entry)) {
        (entry as any).activityId = (entry as any).projectId;
        delete (entry as any).projectId;
      }
    }
    return data;
  }

  async saveTimesheet(data: TimesheetDay): Promise<void> {
    await this.ensureDir();
    await this.atomicWrite(
      path.join(this.dataDir, `${data.date}.json`),
      JSON.stringify(data, null, 2),
    );
  }
}
