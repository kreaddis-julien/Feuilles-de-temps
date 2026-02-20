import type { TimesheetDay, ProjectsData, Project } from './types';

const BASE = '/api';

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

export const createEntry = (date: string, body: { projectId: string; taskId: string; description: string }) =>
  json<TimesheetDay>(`/timesheet/${date}/entries`, { method: 'POST', body: JSON.stringify(body) });

export const updateEntry = (date: string, id: string, body: Record<string, unknown>) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}`, { method: 'DELETE' });

export const pauseEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}/pause`, { method: 'POST' });

export const resumeEntry = (date: string, id: string) =>
  json<TimesheetDay>(`/timesheet/${date}/entries/${id}/resume`, { method: 'POST' });

// Projects
export const getProjects = () =>
  json<ProjectsData>('/projects');

export const createProject = (body: { name: string; category: string }) =>
  json<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });

export const updateProject = (id: string, body: Partial<Project>) =>
  json<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteProject = (id: string) =>
  fetch(`${BASE}/projects/${id}`, { method: 'DELETE' });

export const addTask = (projectId: string, body: { name: string }) =>
  json<Project>(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(body) });

export const deleteTask = (projectId: string, taskId: string) =>
  json<Project>(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });

// Export
export const getExportUrl = (date: string) =>
  `${BASE}/export/${date}?format=csv`;

export const getExportRangeUrl = (from: string, to: string) =>
  `${BASE}/export?from=${from}&to=${to}&format=csv`;
