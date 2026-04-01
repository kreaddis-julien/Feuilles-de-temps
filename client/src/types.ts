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

export interface AudioSegment {
  timestamp: string;
  duration: number;
  transcript: string;
  hasSpeech: boolean;
}

export interface IdlePeriod {
  from: string;
  until: string;
}

export interface TrackingDay {
  date: string;
  screenSessions: ScreenSession[];
  audioSegments: AudioSegment[];
  idlePeriods: IdlePeriod[];
  report: TrackingReport | null;
}

export interface TrackingReport {
  date: string;
  generatedAt: string;
  status: 'pending' | 'validated';
  summary?: string;
  blocks: ReportBlock[];
  suggestedEntries: SuggestedEntry[];
  unmatched: UnmatchedBlock[];
  totalTrackedMinutes: number;
  aiEnhanced?: boolean;
}

export interface ReportBlock {
  from: string;
  to: string;
  app: string;
  title: string;
  url?: string;
  totalMinutes: number;
  totalSeconds: number;
  activityId?: string;
  customerName?: string;
  confidence: number;
}

export interface SuggestedEntry {
  activityId: string;
  customerName?: string;
  description: string;
  totalMinutes: number;
  roundedMinutes: number;
  confidence: number;
  blockCount: number;
}

export interface UnmatchedBlock {
  from: string;
  to: string;
  app: string;
  title: string;
  url?: string;
  totalMinutes: number;
}

export interface TrackingConfig {
  screenEnabled: boolean;
  micEnabled: boolean;
}
