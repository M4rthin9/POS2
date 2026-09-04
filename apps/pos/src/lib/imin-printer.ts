// Built-in printer on iMin POS terminals (D1/D4/M2/Swift…).
//
// iMin ships a JS Printer SDK that the device exposes to the page as a global
// print instance, so a web POS can drive the built-in printer and the cash
// drawer directly. That path is what makes a receipt come out on one tap: the
// Web Bluetooth fallback in bluetooth-printer.ts has to own a GATT connection,
// which costs a chooser prompt on the first print of every session and a
// reconnect on later ones.
//
// Nothing here is required for the app to work — every call is guarded, and
// escpos.ts falls back to Bluetooth whenever the bridge is absent (a laptop, a
// phone, any non-iMin terminal).

interface IminBridge {
  initPrinter?: (type?: unknown) => unknown;
  printSingleBitmap: (data: string, alignment?: unknown) => unknown;
  printAndLineFeed?: () => unknown;
  printAndFeedPaper?: (n: number) => unknown;
  partialCut?: () => unknown;
  openCashBox?: () => unknown;
  PrintConnectType?: Record<string, unknown>;
}

// Vendor builds differ in what they name the injected instance, and some
// expose the class instead so the page constructs it.
const GLOBALS = ['IminPrintInstance', 'iminPrintInstance', 'imin', 'iminPrinter', 'IminPrinter'];

let cached: IminBridge | null = null;
let initialized = false;

function resolve(): IminBridge | null {
  if (cached) return cached;
  const w = window as unknown as Record<string, unknown>;
  for (const name of GLOBALS) {
    const candidate = w[name];
    if (!candidate) continue;
    if (typeof (candidate as IminBridge).printSingleBitmap === 'function') {
      cached = candidate as IminBridge;
      return cached;
    }
    // A constructor was injected rather than a live instance.
    if (typeof candidate === 'function') {
      const proto = (candidate as { prototype?: Record<string, unknown> }).prototype;
      if (proto && typeof proto.printSingleBitmap === 'function') {
        try {
          cached = new (candidate as new () => IminBridge)();
          return cached;
        } catch {
          /* not constructible without arguments — keep looking */
        }
      }
    }
  }
  return null;
}

/** True when this device can print without pairing anything. */
export function iminAvailable(): boolean {
  return resolve() !== null;
}

/**
 * initPrinter() only resets the printer's layout state, so calling it once per
 * session is enough; a failure is not fatal because most builds auto-connect.
 */
async function ensureInit(bridge: IminBridge): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    await Promise.resolve(bridge.initPrinter?.());
  } catch {
    /* the SDK connects lazily on the first print anyway */
  }
}

/** Print a rendered receipt bitmap. `image` is a PNG data URL. */
export async function iminPrintBitmap(image: string): Promise<void> {
  const bridge = resolve();
  if (!bridge) throw new Error('iMin printer unavailable');
  await ensureInit(bridge);
  await Promise.resolve(bridge.printSingleBitmap(image));
  // Feed the print past the tear bar. Cutting is opt-in per model, so this
  // never asks for a cut the hardware may not have.
  try {
    if (bridge.printAndFeedPaper) await Promise.resolve(bridge.printAndFeedPaper(80));
    else await Promise.resolve(bridge.printAndLineFeed?.());
  } catch {
    /* feed is cosmetic — the receipt already printed */
  }
}

/**
 * Kick the cash drawer. Fire-and-forget on purpose: the drawer should pop as
 * the receipt prints, and awaiting the bridge round-trip is exactly the delay
 * cashiers feel at the counter.
 */
export function iminOpenCashBox(): void {
  const bridge = resolve();
  if (!bridge?.openCashBox) return;
  try {
    void Promise.resolve(bridge.openCashBox()).catch(() => {});
  } catch {
    /* no drawer wired to this terminal */
  }
}
