import { TH, fmtDateOnly, toISODate } from '@cida/shared';

export type Period = 'today' | '7d' | '30d' | 'all' | 'custom';

export const PRESETS: { id: Period; label: string }[] = [
  { id: 'today', label: TH.periodToday },
  { id: '7d', label: TH.period7d },
  { id: '30d', label: TH.period30d },
  { id: 'all', label: TH.periodAll },
];

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function periodRange(period: Period, customFrom = '', customTo = ''): { from?: string; to?: string } {
  if (period === 'custom') return { from: customFrom || undefined, to: customTo || undefined };
  const today = new Date();
  if (period === 'today') return { from: toISODate(today), to: toISODate(today) };
  if (period === '7d') return { from: toISODate(addDays(today, -6)), to: toISODate(today) };
  if (period === '30d') return { from: toISODate(addDays(today, -29)), to: toISODate(today) };
  return {};
}

export function periodLabel(period: Period, customFrom = '', customTo = ''): string {
  if (period === 'all') return TH.periodAllLabel;
  if (period === 'custom') {
    if (customFrom && customTo) return `${fmtDateOnly(customFrom)} – ${fmtDateOnly(customTo)}`;
    return customFrom || customTo || TH.periodLabel;
  }
  const r = periodRange(period);
  if (period === 'today') return fmtDateOnly(r.from!);
  return `${fmtDateOnly(r.from!)} – ${fmtDateOnly(r.to!)}`;
}
