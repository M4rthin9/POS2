import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, parseAmount, parseBankDate, parseBankTime, parseDelimited } from './csv';

describe('parseDelimited', () => {
  it('strips the BOM and handles CRLF', () => {
    const rows = parseDelimited('﻿a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields and unescapes doubled quotes', () => {
    const rows = parseDelimited('date,desc\n2025-01-05,"โอนเงิน, พร้อมเพย์ ""PP"""');
    expect(rows[1]).toEqual(['2025-01-05', 'โอนเงิน, พร้อมเพย์ "PP"']);
  });

  it('sniffs semicolon and tab delimiters', () => {
    expect(parseDelimited('a;b;c\n1;2;3')[1]).toEqual(['1', '2', '3']);
    expect(parseDelimited('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });

  it('drops blank lines', () => {
    expect(parseDelimited('a,b\n\n1,2\n\n')).toHaveLength(2);
  });
});

describe('parseAmount', () => {
  it('handles thousands separators, currency marks and blanks', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('฿ 900.00')).toBe(900);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('-')).toBe(0);
  });

  it('reads parenthesised amounts as negative', () => {
    expect(parseAmount('(120.00)')).toBe(-120);
  });
});

describe('parseBankDate', () => {
  it('converts Buddhist-era years to CE', () => {
    expect(parseBankDate('05/01/2568')).toBe('2025-01-05');
    expect(parseBankDate('05/01/68')).toBe('2025-01-05');
    expect(parseBankDate('5 ม.ค. 2568')).toBe('2025-01-05');
  });

  it('passes CE dates through', () => {
    expect(parseBankDate('2025-01-05 09:41')).toBe('2025-01-05');
    expect(parseBankDate('05/01/2025')).toBe('2025-01-05');
  });

  it('returns null for headers and totals rows', () => {
    expect(parseBankDate('วันที่')).toBeNull();
    expect(parseBankDate('')).toBeNull();
  });
});

describe('parseBankTime', () => {
  it('normalises to HH:MM:SS', () => {
    expect(parseBankTime('9:41')).toBe('09:41:00');
    expect(parseBankTime('09:41:22')).toBe('09:41:22');
    expect(parseBankTime('0941')).toBe('09:41:00');
    expect(parseBankTime('')).toBe('00:00:00');
  });
});

describe('guessMapping / applyMapping', () => {
  const csv = [
    'วันที่,เวลา,รายการ,ถอนเงิน,ฝากเงิน,ยอดคงเหลือ,เลขที่อ้างอิง',
    '05/01/2568,09:41,รับโอนพร้อมเพย์,,"1,250.00","12,300.00",PP250105A1',
    '05/01/2568,10:02,ค่าธรรมเนียม,15.00,,"12,285.00",FEE001',
    'รวม,,,15.00,"1,250.00",,',
  ].join('\n');

  it('guesses KTB Thai headers', () => {
    const rows = parseDelimited(csv);
    const m = guessMapping(rows[0]);
    expect(m).toEqual({ date: 0, time: 1, description: 2, debit: 3, credit: 4, balance: 5, ref: 6 });
  });

  it('maps rows and skips the header and totals lines', () => {
    const rows = parseDelimited(csv);
    const lines = applyMapping(rows, guessMapping(rows[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      posted_at: '2025-01-05 09:41:00',
      credit: 1250,
      debit: 0,
      balance: 12300,
      ref: 'PP250105A1',
    });
    expect(lines[1]).toMatchObject({ debit: 15, credit: 0 });
  });

  it('treats a negative value in a single signed amount column as a debit', () => {
    const lines = applyMapping([['05/01/2568', '-500.00']], {
      date: 0,
      time: -1,
      description: -1,
      debit: -1,
      credit: 1,
      balance: -1,
      ref: -1,
    });
    expect(lines[0]).toMatchObject({ debit: 500, credit: 0 });
  });
});
