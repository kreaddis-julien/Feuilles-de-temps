export type CustomerType = 'interne' | 'externe';

export interface Activity {
  id: string;
  name: string;
  customerId: string;
}

export interface ActivitiesData {
  activities: Activity[];
}

export interface Customer {
  id: string;
  name: string;
  type: CustomerType;
}

export interface CustomersData {
  customers: Customer[];
}

export interface Segment {
  start: string; // HH:mm
  end: string | null; // null = timer running
}

export type EntryStatus = 'active' | 'paused' | 'completed';

export interface TimesheetEntry {
  id: string;
  activityId: string;
  description: string;
  segments: Segment[];
  totalMinutes: number;
  roundedMinutes: number;
  status: EntryStatus;
  deferred?: boolean;
}

export interface TimesheetDay {
  date: string; // YYYY-MM-DD
  entries: TimesheetEntry[];
  activeEntries: string[];
  pausedEntries: string[];
}

// --- Activity Tracking ---

export interface ScreenSession {
  from: string;       // ISO timestamp
  until: string;      // ISO timestamp
  app: string;        // e.g. "Google Chrome"
  bundleId: string;   // e.g. "com.google.Chrome"
  title: string;      // Window title
  url?: string;       // Browser URL (Chrome/Safari only)
}

export interface IdlePeriod {
  from: string;
  until: string;
}

export interface TrackingDay {
  date: string;
  screenSessions: ScreenSession[];
  audioSegments: [];   // Placeholder for Phase 3
  idlePeriods: IdlePeriod[];
  report: null;        // Placeholder for Phase 2
}

export interface TrackingConfig {
  screenEnabled: boolean;
  micEnabled: boolean;
}
