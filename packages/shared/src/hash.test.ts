import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, canonicalSale, saleTxHash, sha256Hex, shortHash } from './hash';
import type { HashableSale } from './hash';

const sale: HashableSale = {
  id: 42,
  event_id: 1,
  cashier_user_id: 2,
  subtotal: 250,
  discount: 10,
  total: 240,
  payment_method: 'PromptPay',
  created_at: '2025-01-05 09:41:00',
  items: [
    { sku: 'B002', qty: 1, price: 150, line_total: 150 },
    { sku: 'A001', qty: 2, price: 50, line_total: 100 },
  ],
};

describe('canonicalSale', () => {
  it('normalises money to 2dp so 240 and 240.00 hash alike', () => {
    expect(canonicalSale(sale)).toBe(canonicalSale({ ...sale, total: 240.0, subtotal: 250.0 }));
    expect(canonicalSale(sale)).toContain('|240.00|');
  });

  it('is independent of item row order', () => {
    const reordered = { ...sale, items: [...sale.items].reverse() };
    expect(canonicalSale(reordered)).toBe(canonicalSale(sale));
  });

  it('changes when any amount changes', () => {
    expect(canonicalSale({ ...sale, total: 241 })).not.toBe(canonicalSale(sale));
    expect(canonicalSale({ ...sale, items: [{ sku: 'A001', qty: 3, price: 50, line_total: 150 }] })).not.toBe(
      canonicalSale(sale),
    );
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('saleTxHash', () => {
  it('is deterministic and 64 hex chars', async () => {
    const a = await saleTxHash(sale, GENESIS_HASH);
    const b = await saleTxHash(sale, GENESIS_HASH);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('depends on the previous hash, so re-parenting an entry breaks the chain', async () => {
    const first = await saleTxHash(sale, GENESIS_HASH);
    const other = await saleTxHash(sale, 'a'.repeat(64));
    expect(first).not.toBe(other);
  });

  it('treats an empty prev_hash as genesis', async () => {
    expect(await saleTxHash(sale, '')).toBe(await saleTxHash(sale, GENESIS_HASH));
  });
});

describe('shortHash', () => {
  it('falls back to an em dash', () => {
    expect(shortHash(null)).toBe('—');
    expect(shortHash('abcdef0123456789')).toBe('abcdef012345');
  });
});
