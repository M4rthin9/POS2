import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '@cida/shared';

interface CartState {
  items: CartItem[];
  discount: number;
  eventId: number | null;
  /** Whose cart this is. Booth devices are shared, so the cart and the chosen
   *  event must not carry over to the next cashier who signs in. */
  userId: number | null;
  bindUser: (userId: number | null) => void;
  add: (product: Product, qty?: number) => void;
  setQty: (productId: number, qty: number) => void;
  remove: (productId: number) => void;
  setDiscount: (v: number) => void;
  setEvent: (eventId: number | null) => void;
  /** Replace the cart wholesale — used when retrieving a held cart. */
  load: (items: CartItem[], discount: number, eventId: number | null) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      discount: 0,
      eventId: null,
      userId: null,
      bindUser: (userId) =>
        set((s) => (s.userId === userId ? { userId } : { userId, items: [], discount: 0, eventId: null })),
      add: (product, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.product_id === product.id);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.product_id === product.id ? { ...i, qty: Math.min(i.qty + qty, product.stock ?? 9999) } : i,
              ),
            };
          }
          return { items: [...s.items, { product_id: product.id, sku: product.sku, name: product.name, price: product.price, qty }] };
        }),
      setQty: (productId, qty) =>
        set((s) => ({
          items: qty <= 0 ? s.items.filter((i) => i.product_id !== productId) : s.items.map((i) => (i.product_id === productId ? { ...i, qty } : i)),
        })),
      remove: (productId) => set((s) => ({ items: s.items.filter((i) => i.product_id !== productId) })),
      setDiscount: (discount) => set({ discount: Math.max(0, discount) }),
      setEvent: (eventId) => set({ eventId }),
      load: (items, discount, eventId) => set((s) => ({ items, discount, eventId: eventId ?? s.eventId })),
      clear: () => set({ items: [], discount: 0 }),
    }),
    { name: 'cida_pos_cart' },
  ),
);

export function cartTotals(items: CartItem[], discount: number) {
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const total = Math.max(0, subtotal - discount);
  return { subtotal, total };
}
