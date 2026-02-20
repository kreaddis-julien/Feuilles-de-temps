import { describe, it, expect } from 'vitest';
import { roundUp15, calcSegmentMinutes, calcTotalMinutes, nowHHmm } from '../time-utils.js';

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
  it('calculates minutes between two times', () => {
    expect(calcSegmentMinutes({ start: '08:00', end: '10:15' })).toBe(135);
  });
  it('returns 0 for null end', () => {
    expect(calcSegmentMinutes({ start: '08:00', end: null })).toBe(0);
  });
});

describe('calcTotalMinutes', () => {
  it('sums all closed segments', () => {
    const segments = [
      { start: '08:00', end: '10:00' },
      { start: '11:00', end: '12:00' },
    ];
    expect(calcTotalMinutes(segments)).toBe(180);
  });
});
