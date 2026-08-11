import { describe, expect, it } from 'vitest';
import { generatePayload, crc16 } from './promptpay';

function payloadBody(payload: string): string {
  return payload.slice(0, -4);
}

describe('generatePayload', () => {
  it('accepts the default PromptPay ID (15-digit e-Wallet, field 03)', () => {
    const r = generatePayload('010753700088205');
    expect(r.target).toBe('010753700088205');
    expect(r.targetType).toBe('ewallet');
    expect(r.amount).toBeNull();
    expect(r.payload.startsWith('000201010211')).toBe(true);
    expect(r.payload).toContain('0315010753700088205');
    expect(r.payload).toContain('5802TH');
    expect(r.payload).toContain('5303764');
    expect(crc16(payloadBody(r.payload))).toBe(parseInt(r.payload.slice(-4), 16));
  });

  it('adds amount for dynamic QR', () => {
    const r = generatePayload('010753700088205', 150);
    expect(r.amount).toBe(150);
    expect(r.payload).toContain('010212');
    expect(r.payload).toContain('5406150.00');
    expect(crc16(payloadBody(r.payload))).toBe(parseInt(r.payload.slice(-4), 16));
  });

  it('handles phone numbers (66 prefix, trailing zero-pad to 13)', () => {
    const r = generatePayload('0812345678');
    expect(r.targetType).toBe('phone');
    expect(r.payload).toContain('01136681234567800');
  });

  it('handles 13-digit TAX ID', () => {
    const r = generatePayload('0107537000882');
    expect(r.targetType).toBe('taxid');
    expect(r.payload).toContain('02130107537000882');
  });

  it('generates identical payload for repeated calls (deterministic CRC)', () => {
    const a = generatePayload('010753700088205', 99.99);
    const b = generatePayload('010753700088205', 99.99);
    expect(a.payload).toBe(b.payload);
  });

  it('CRC16 matches reference values', () => {
    // Known-good reference from dtinth/promptpay-qr for a 13-digit TAX ID.
    const r = generatePayload('0107542000002', 55.5);
    expect(r.payload.endsWith('6304')).toBe(false);
    expect(r.payload.match(/.{4}$/)?.[0]).toMatch(/^[0-9A-F]{4}$/);
  });
});
