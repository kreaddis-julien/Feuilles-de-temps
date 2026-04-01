import fs from 'fs/promises';
import { openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { CustomersData, ActivitiesData, TimesheetDay, TrackingDay, TrackingConfig } from './types.js';

export class Storage {
  private writeLocks = new Map<string, Promise<void>>();

  constructor(private dataDir: string) {}

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    // Serialize writes to the same file to prevent races
    const prev = this.writeLocks.get(filePath) ?? Promise.resolve();
    const current = prev.then(() => this.doAtomicWrite(filePath, data));
    this.writeLocks.set(filePath, current.catch(() => {}));
    await current;
  }

  private async doAtomicWrite(filePath: string, data: string): Promise<void> {
    const tmp = filePath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      // Sync write + fsync to ensure data hits disk before rename
      const fd = openSync(tmp, 'w');
      writeSync(fd, data);
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmp, filePath);
    } catch (err) {
      try { unlinkSync(tmp); } catch {}
      throw err;
    }
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
        return { date, entries: [], activeEntries: [], pausedEntries: [] };
      }
      throw err;
    }
    const data = JSON.parse(raw) as TimesheetDay;
    // Migration: activeEntry → activeEntries
    const rawData = data as any;
    if ('activeEntry' in rawData) {
      data.activeEntries = rawData.activeEntry ? [rawData.activeEntry] : [];
      delete rawData.activeEntry;
    }
    if (!data.activeEntries) {
      data.activeEntries = [];
    }
    // Migrate: rename projectId → activityId in existing entries
    for (const entry of data.entries) {
      if ('projectId' in entry && !('activityId' in entry)) {
        (entry as any).activityId = (entry as any).projectId;
        delete (entry as any).projectId;
      }
    }
    return data;
  }

  async listDates(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dataDir);
      return files
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .map(f => f.replace('.json', ''))
        .sort();
    } catch {
      return [];
    }
  }

  async saveTimesheet(data: TimesheetDay): Promise<void> {
    await this.ensureDir();
    await this.atomicWrite(
      path.join(this.dataDir, `${data.date}.json`),
      JSON.stringify(data, null, 2),
    );
  }

  async loadTracking(date: string): Promise<TrackingDay> {
    const filePath = path.join(this.dataDir, `activity-${date}.json`);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      return raw as TrackingDay;
    } catch {
      return { date, screenSessions: [], audioSegments: [], idlePeriods: [], report: null };
    }
  }

  async saveTracking(data: TrackingDay): Promise<void> {
    const filePath = path.join(this.dataDir, `activity-${data.date}.json`);
    await this.atomicWrite(filePath, JSON.stringify(data, null, 2));
  }

  async loadTrackingConfig(): Promise<TrackingConfig> {
    const filePath = path.join(this.dataDir, 'tracking-config.json');
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf-8')) as TrackingConfig;
    } catch {
      return { screenEnabled: true, micEnabled: false };
    }
  }

  async saveTrackingConfig(config: TrackingConfig): Promise<void> {
    const filePath = path.join(this.dataDir, 'tracking-config.json');
    await this.atomicWrite(filePath, JSON.stringify(config, null, 2));
  }

  async cleanupOldTracking(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let deleted = 0;

    try {
      const files = await fs.readdir(this.dataDir);
      for (const file of files) {
        const match = file.match(/^activity-(\d{4}-\d{2}-\d{2})\.json$/);
        if (match && match[1] < cutoffStr) {
          await fs.unlink(path.join(this.dataDir, file));
          deleted++;
        }
      }
    } catch {
      // directory might not exist yet
    }

    return deleted;
  }
}
