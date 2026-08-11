import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin, randomSalt, isValidPin } from '../src/lib/password';

describe('password', () => {
  it('verifies a hash produced from the same pin', async () => {
    const salt = randomSalt();
    const hash = await hashPin('1234', salt);
    expect(hash).toHaveLength(64);
    expect(await verifyPin('1234', salt, hash)).toBe(true);
    expect(await verifyPin('4321', salt, hash)).toBe(false);
  });

  it('is deterministic for the same pin and salt', async () => {
    const salt = randomSalt();
    const a = await hashPin('0000', salt);
    const b = await hashPin('0000', salt);
    expect(a).toBe(b);
  });

  it('matches the seeded migration hash for admin/1234', async () => {
    const saltHex = '736565642d73616c742d61646d696e2d30303031';
    const seededHash = '4eb6908b5a7c22a83d7d1329d3e91147e83a0d4d894d616576d60a34b3a8ef48';
    expect(await hashPin('1234', saltHex)).toBe(seededHash);
  });

  it('validates pin format', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
});
