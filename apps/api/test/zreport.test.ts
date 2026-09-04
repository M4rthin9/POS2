import { describe, expect, it } from 'vitest';
import { resolveRound } from '../src/lib/zreport';

describe('resolveRound', () => {
  it('resolves a same-day round', () => {
    expect(resolveRound('2026-09-03', '10:00', '14:00')).toEqual({
      from: '2026-09-03 10:00:00',
      to: '2026-09-03 14:00:00',
    });
  });

  it('treats an end at or before the start as the next day', () => {
    expect(resolveRound('2026-09-03', '22:00', '02:00')).toEqual({
      from: '2026-09-03 22:00:00',
      to: '2026-09-04 02:00:00',
    });
    // The whole-day round: 00:00 to the next midnight.
    expect(resolveRound('2026-09-03', '00:00', '00:00')).toEqual({
      from: '2026-09-03 00:00:00',
      to: '2026-09-04 00:00:00',
    });
  });

  it('rolls over month and year ends', () => {
    expect(resolveRound('2026-12-31', '20:00', '01:00')?.to).toBe('2027-01-01 01:00:00');
  });

  it('rejects malformed dates and times', () => {
    expect(resolveRound('03-09-2026', '10:00', '14:00')).toBeNull();
    expect(resolveRound('2026-09-03', '25:00', '14:00')).toBeNull();
    expect(resolveRound('2026-09-03', '10:00', '14:70')).toBeNull();
    expect(resolveRound('2026-09-03', '10', '14:00')).toBeNull();
  });

  it('covers a full day back to back without overlap', () => {
    const morning = resolveRound('2026-09-03', '00:00', '10:00')!;
    const afternoon = resolveRound('2026-09-03', '10:00', '14:00')!;
    // Bounds are half-open, so a sale rung up at exactly 10:00 belongs to the
    // afternoon round only.
    expect(morning.to).toBe(afternoon.from);
  });
});
