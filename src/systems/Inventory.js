import BlockRegistry from '../vehicles/BlockRegistry.js';

/** Starting kit: enough to build a real four-wheeler immediately, no grinding. */
export const STARTER_INVENTORY = {
  cab: 1,
  structural: 22,
  light_frame: 8,
  armor: 8,
  armor_plate: 8,
  wedge: 6,
  engine: 2,
  engine_light: 1,
  wheel: 6,
  wheel_heavy: 2,
  wheel_light: 2,
  wheel_front: 2,
  tread: 2,
  cannon: 2,
  autocannon: 1,
  gyroscope: 2,
  thruster: 2,
  battery: 2,
  solar: 3,
  repair: 1,
  shield: 1,
};

export class Inventory {
  constructor(items = {}, creative = false) {
    this.items = new Map();
    this.creative = creative;
    for (const [k, v] of Object.entries(items)) this.items.set(k, v | 0);
    this._listeners = new Set();
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { for (const fn of this._listeners) fn(this); }

  setCreative(on) { this.creative = on; this._emit(); }

  count(id) { return this.creative ? Infinity : (this.items.get(id) || 0); }
  has(id, n = 1) { return this.creative || this.count(id) >= n; }

  /** Consume n of id. Returns false (and changes nothing) if there aren't enough. */
  take(id, n = 1) {
    if (this.creative) return true;
    const have = this.count(id);
    if (have < n) return false;
    this.items.set(id, have - n);
    this._emit();
    return true;
  }

  add(id, n = 1) {
    if (n <= 0) return;
    if (!BlockRegistry.has(id)) {
      console.warn(`[inventory] refusing to add unknown block "${id}"`);
      return;
    }
    this.items.set(id, (this.items.get(id) || 0) + n);
    this._emit();
  }

  /** Total of everything, for HUD/debug. */
  total() {
    let t = 0;
    for (const v of this.items.values()) t += v;
    return t;
  }

  nonEmpty() {
    return [...this.items.entries()]
      .filter(([id, n]) => n > 0 && BlockRegistry.has(id))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  toJSON() { return Object.fromEntries(this.items); }

  static fromJSON(obj, creative = false) {
    const inv = new Inventory({}, creative);
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number' && v >= 0 && BlockRegistry.has(k)) inv.items.set(k, Math.floor(v));
      }
    }
    return inv;
  }
}
