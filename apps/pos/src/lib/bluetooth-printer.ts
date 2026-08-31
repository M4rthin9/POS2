// Web Bluetooth GATT link to the POS terminal's built-in thermal printer
// (e.g. the "InnerPrinter" exposed by POS2U-class Android terminals).
//
// Web Bluetooth cannot filter devices by MAC address and only speaks BLE
// (GATT) — never classic SPP. So the first connection is made from the
// browser chooser (user picks "InnerPrinter"); we then remember the device id
// in localStorage and reconnect silently on later sessions/prints.

type BTCharacteristic = {
  uuid: string;
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
};

type BTService = {
  uuid: string;
  getCharacteristics(): Promise<BTCharacteristic[]>;
};

type BTServer = {
  connected: boolean;
  connect(): Promise<BTServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BTService[]>;
};

type BTDevice = {
  id: string;
  name?: string;
  gatt?: BTServer;
  forget?(): Promise<void>;
};

// Services commonly exposed by thermal printers (18f0/ffe0 are the usual
// ones on Chinese POS modules; the others cover known vendor variants).
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

const STORAGE_KEY = 'pos.bt.printer';

interface Remembered {
  id: string;
  name: string;
}

let server: BTServer | null = null;
let writeChar: BTCharacteristic | null = null;
let attached: BTDevice | null = null;

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function rememberedPrinter(): Remembered | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Remembered) : null;
  } catch {
    return null;
  }
}

export function isConnected(): boolean {
  return server?.connected === true && writeChar !== null;
}

async function findWriteChar(): Promise<BTCharacteristic> {
  if (!server) throw new Error('not connected');
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
    }
  }
  throw new Error('printer has no writable characteristic');
}

async function attach(device: BTDevice): Promise<void> {
  if (!device.gatt) throw new Error('device has no GATT server');
  // Reuse the live connection only when it belongs to *this* device. Keeping a
  // stale server would silently keep printing to the previously paired printer
  // after the cashier picked a different one.
  const sameDevice = attached?.id === device.id;
  if (!sameDevice || !server?.connected) {
    if (!sameDevice) await disconnectPrinter();
    server = await device.gatt.connect();
  }
  attached = device;
  writeChar = await findWriteChar();
}

/** Open the chooser (needs a user gesture) and remember the picked printer. */
export async function pickPrinter(): Promise<Remembered> {
  if (!bluetoothAvailable()) throw new Error('Web Bluetooth unavailable');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bt = (navigator as any).bluetooth;
  // Prefer the built-in printer by name so the chooser shows only it; widen
  // to every device only when the firmware names it differently.
  const attempts = [
    { filters: [{ name: 'InnerPrinter' }, { namePrefix: 'Inner' }], optionalServices: PRINTER_SERVICES },
    { acceptAllDevices: true, optionalServices: PRINTER_SERVICES },
  ];
  let device: BTDevice | null = null;
  let lastErr: unknown = null;
  for (const options of attempts) {
    try {
      device = await bt.requestDevice(options);
      break;
    } catch (e) {
      // Chrome throws NotAllowedError when the page lacks a user gesture and
      // NotFoundError both when the user dismissed the chooser and when no
      // device matched. Only the latter is worth widening the filter for, and
      // the message text is localised, so never match on it.
      if (e instanceof DOMException && e.name !== 'NotFoundError') throw e;
      lastErr = e;
    }
  }
  if (!device) {
    if (lastErr instanceof Error) throw lastErr;
    throw new Error('no printer selected');
  }
  await attach(device);
  const rec = { id: device.id, name: device.name || 'InnerPrinter' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  return rec;
}

/** Silent reconnect to the remembered printer, if the browser still grants it. */
export async function autoConnect(): Promise<boolean> {
  const rec = rememberedPrinter();
  if (!rec || isConnected() || !bluetoothAvailable()) return isConnected();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bt = (navigator as any).bluetooth;
  // getDevices() lists devices already granted permission — no chooser needed.
  if (typeof bt.getDevices !== 'function') return false;
  const devices: BTDevice[] = await bt.getDevices.call(bt);
  const device = devices.find((d) => d.id === rec.id);
  if (!device) return false;
  try {
    await attach(device);
    return true;
  } catch {
    server = null;
    writeChar = null;
    return false;
  }
}

export async function disconnectPrinter(): Promise<void> {
  try {
    server?.disconnect();
  } finally {
    server = null;
    writeChar = null;
    attached = null;
  }
}

export async function forgetPrinter(): Promise<void> {
  const device = attached;
  await disconnectPrinter();
  // Revoke the browser-level grant too, otherwise autoConnect() would silently
  // re-pair the printer the cashier just asked to forget.
  try {
    await device?.forget?.();
  } catch {
    /* not supported everywhere — clearing our own record is enough */
  }
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Opens the chooser if needed. Call this *first* inside a click handler:
 * requestDevice() requires transient user activation, which any preceding
 * `await` (font loading, canvas rendering) consumes.
 */
export async function ensureConnected(): Promise<void> {
  if (isConnected()) return;
  const ok = await autoConnect().catch(() => false);
  if (!ok) await pickPrinter();
}

/** Send raw ESC/POS bytes to the printer, connecting first when needed. */
export async function send(data: Uint8Array): Promise<void> {
  await ensureConnected();
  const ch = writeChar!;
  // Printers choke on large writes — chunk below the typical MTU.
  const CHUNK = 180;
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, i + CHUNK);
    // Copy into a fresh ArrayBuffer: writeValue() detaches its buffer on some
    // engines, which would corrupt later chunks if we reused `data.buffer`.
    const buf = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
    if (ch.properties.write || !ch.writeValueWithoutResponse) {
      await ch.writeValue(buf);
    } else {
      await ch.writeValueWithoutResponse(buf);
    }
    // Small pacing gap keeps cheap printer buffers from dropping bytes.
    await new Promise((r) => setTimeout(r, 15));
  }
}
