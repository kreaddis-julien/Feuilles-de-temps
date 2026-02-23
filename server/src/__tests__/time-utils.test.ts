import { describe, it, expect } from 'vitest';
import { roundUp15, calcSegmentMinutes, calcTotalMinutes, nowTimestamp, toHHmm } from '../time-utils.js';

describe('roundUp15', () => {
  it('rounds 0 to 0', () => expect(roundUp15(0)).toBe(0));
  it('rounds 1 to 15', () => expect(roundUp15(1)).toBe(15));
  it('rounds 15 to 15', () => expect(roundUp15(15)).toBe(15));
  it('rounds 16 to 30', () => expect(roundUp15(16)).toBe(30));
  it('rounds 37 to 45', () => expect(roundUp15(37)).toBe(45));
  it('rounds 60 to 60', () => expect(roundUp15(60)).toBe(60));
  it('rounds 61 to 75', () => expect(roundUp15(61)).toBe(75));
});

describe('calcSegmentMinutes', () => {
  it('calculates minutes between two ISO timestamps', () => {
    expect(calcSegmentMinutes({
      start: '2026-02-20T08:00:00.000Z',
      end: '2026-02-20T10:15:00.000Z',
    })).toBe(135);
  });
  it('returns 0 for null end', () => {
    expect(calcSegmentMinutes({ start: '2026-02-20T08:00:00.000Z', end: null })).toBe(0);
  });
});

describe('calcTotalMinutes', () => {
  it('sums all closed segments', () => {
    const segments = [
      { start: '2026-02-20T08:00:00.000Z', end: '2026-02-20T10:00:00.000Z' },
      { start: '2026-02-20T11:00:00.000Z', end: '2026-02-20T12:00:00.000Z' },
    ];
    expect(calcTotalMinutes(segments)).toBe(180);
  });
});

describe('nowTimestamp', () => {
  it('returns an ISO string', () => {
    const ts = nowTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('toHHmm', () => {
  it('extracts HH:mm from ISO timestamp', () => {
    const d = new Date('2026-02-20T14:35:00');
    expect(toHHmm(d.toISOString())).toBe('14:35');
  });
  it('passes through HH:mm strings unchanged', () => {
    expect(toHHmm('09:30')).toBe('09:30');
  });
});
