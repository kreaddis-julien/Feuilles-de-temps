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
