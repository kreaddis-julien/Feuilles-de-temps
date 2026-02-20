import type { Segment } from './types.js';

export function roundUp15(minutes: number): number {
  if (minutes === 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

export function calcSegmentMinutes(segment: Segment): number {
  if (!segment.end) return 0;
  return timeToMinutes(segment.end) - timeToMinutes(segment.start);
}

export function calcTotalMinutes(segments: Segment[]): number {
  return segments.reduce((sum, seg) => sum + calcSegmentMinutes(seg), 0);
}

export function nowHHmm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
