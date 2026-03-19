import type { Segment } from './types.js';

export function roundUp15(minutes: number): number {
  if (minutes === 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

export function calcSegmentMinutes(segment: Segment): number {
  if (!segment.end) return 0;
  const ms = new Date(segment.end).getTime() - new Date(segment.start).getTime();
  return ms > 0 ? Math.max(1, Math.floor(ms / 60000)) : 0;
}

export function calcTotalMinutes(segments: Segment[]): number {
  return segments.reduce((sum, seg) => sum + calcSegmentMinutes(seg), 0);
}

export function nowTimestamp(): string {
  return new Date().toISOString();
}

/** Extract HH:mm from an ISO timestamp for display/CSV. */
export function toHHmm(isoOrHhmm: string): string {
  if (isoOrHhmm.includes('T')) {
    const d = new Date(isoOrHhmm);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return isoOrHhmm;
}
