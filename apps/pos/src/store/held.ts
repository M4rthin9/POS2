import type { CartItem } from '@cida/shared';

// Parked carts. Deliberately separate from the offline sale queue
// (`cida_pos_offline_queue`) — a held cart is not a sale and must never sync.

export interface HeldCart {
  id: string;
  label: string;
  event_id: number | null;
  items: CartItem[];
  discount: number;
  total: number;
  created_at: string;
}

const HELD_KEY = 'cida_pos_held_carts';
const MAX_HELD = 20;

export function getHeld(): HeldCart[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HELD_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(carts: HeldCart[]) {
  localStorage.setItem(HELD_KEY, JSON.stringify(carts.slice(0, MAX_HELD)));
}

export function holdCart(cart: Omit<HeldCart, 'id' | 'created_at'>): HeldCart {
  const entry: HeldCart = { ...cart, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  save([entry, ...getHeld()]);
  return entry;
}

export function releaseHeld(id: string) {
  save(getHeld().filter((c) => c.id !== id));
}
