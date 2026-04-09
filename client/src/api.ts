import type { TimesheetDay, TimesheetEntry, ActivitiesData, CustomersData, Customer, TrackingDay, TrackingReport, ScreenSession, IdlePeriod, TrackingConfig } from './types';

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
export const BASE = isTauri ? 'http://localhost:3001/api' : '/api';

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

export const createEntry = (date: string, body: { activityId: string; description: string }) =>
  json<TimesheetDay>(`/timesheet/${date}/entries`, { method: 'POST', body: JSON.stringify(body) });

export const updateEntry = (date: string, id: string, body: Record<string, unknown>) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}`, { method: 'DELETE' });

export const pauseEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}/pause`, { method: 'POST' });

export const resumeEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}/resume`, { method: 'POST' });

// Customers
export const getCustomers = () =>
  json<CustomersData>('/customers');

export const createCustomer = (body: { name: string; type: string }) =>
  json<Customer>('/customers', { method: 'POST', body: JSON.stringify(body) });

export const updateCustomer = (id: string, body: Record<string, unknown>) =>
  json<Customer>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteCustomer = (id: string) =>
  fetch(`${BASE}/customers/${id}`, { method: 'DELETE' });

// Activities
export const getActivities = () =>
  json<ActivitiesData>('/activities');

export const createActivity = (body: { name: string; customerId: string }) =>
  json<unknown>('/activities', { method: 'POST', body: JSON.stringify(body) });

export const updateActivity = (id: string, body: Record<string, unknown>) =>
  json<unknown>(`/activities/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteActivity = (id: string) =>
  fetch(`${BASE}/activities/${id}`, { method: 'DELETE' });

// Export
export const getExportUrl = (date: string) =>
  `${BASE}/export/${date}?format=csv`;

export const getExportRangeUrl = (from: string, to: string) =>
  `${BASE}/export?from=${from}&to=${to}&format=csv`;

// Stats
export interface StatsData {
  period: { from: string; to: string };
  totalMinutes: number;
  totalRoundedMinutes: number;
  entryCount: number;
  byDay: { date: string; minutes: number }[];
  byCustomer: { id: string; name: string; type: string; minutes: number }[];
  byActivity: { id: string; name: string; customerName: string; minutes: number }[];
  byType: { type: string; minutes: number }[];
}

export const getStats = (from: string, to: string) =>
  json<StatsData>(`/stats?from=${from}&to=${to}`);

// Merge
export const mergeEntries = (date: string, body: {
  entryIds: string[];
  activityId: string;
  description: string;
  totalMinutes: number;
  roundedMinutes: number;
}) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/merge`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// Tracking
export const getTracking = (date: string) =>
  json<TrackingDay>(`/tracking/${date}`);

export const postScreenSession = (date: string, session: ScreenSession) =>
  json<{ ok: boolean }>(`/tracking/${date}/screen`, {
    method: 'POST',
    body: JSON.stringify(session),
  });

export const postIdlePeriod = (date: string, idle: IdlePeriod) =>
  json<{ ok: boolean }>(`/tracking/${date}/idle`, {
    method: 'POST',
    body: JSON.stringify(idle),
  });

export const getTrackingConfig = () =>
  json<TrackingConfig>('/tracking/config/current');

export const updateTrackingConfig = (config: Partial<TrackingConfig>) =>
  json<TrackingConfig>('/tracking/config/current', {
    method: 'PUT',
    body: JSON.stringify(config),
  });

// Reports
export const getReportDates = () =>
  json<{ date: string; hasReport: boolean; status: string | null }[]>('/report');

export const getReport = (date: string) =>
  json<TrackingReport | null>(`/report/${date}`);

export const generateReport = (date: string) =>
  json<TrackingReport>(`/report/${date}/generate`, { method: 'POST' });

export function generateReportSSE(
  date: string,
  onProgress: (step: number, total: number, label: string) => void,
): Promise<TrackingReport> {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/report/${date}/generate`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json' },
    }).then(async (resp) => {
      if (!resp.ok) return reject(new Error(`API error: ${resp.status}`));
      const reader = resp.body?.getReader();
      if (!reader) return reject(new Error('No response body'));
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done && data.report) {
              resolve(data.report);
            } else if (data.step !== undefined) {
              onProgress(data.step, data.total, data.label);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }).catch(reject);
  });
}

export const validateReport = (date: string, entries: { activityId: string; description: string; roundedMinutes: number }[]) =>
  json<{ ok: boolean; entriesCreated: number }>(`/report/${date}/validate`, {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });

export const unvalidateReport = (date: string) =>
  json<{ ok: boolean; entriesRemoved: number }>(`/report/${date}/unvalidate`, {
    method: 'POST',
  });

export const regenerateDescriptions = (date: string, entries: { activityId: string; totalMinutes: number }[]) =>
  json<{ descriptions: string[] }>(`/report/${date}/descriptions`, {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });

// Deferred
export const getDeferred = () =>
  json<{ date: string; entry: TimesheetEntry }[]>('/deferred');
