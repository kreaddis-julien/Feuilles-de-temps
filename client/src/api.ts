import type { TimesheetDay, TimesheetEntry, ActivitiesData, CustomersData, Customer } from './types';

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

// Deferred
export const getDeferred = () =>
  json<{ date: string; entry: TimesheetEntry }[]>('/deferred');
