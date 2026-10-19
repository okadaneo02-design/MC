/**
 * IndexedDB persistence.
 *
 * Writes are transactional (IndexedDB gives us all-or-nothing per transaction),
 * every record carries a schema version, and every read is validated before the
 * game is allowed to touch it.
 */

const DB_NAME = 'machinecraft';
const DB_VERSION = 1;
const STORE_WORLD = 'worlds';
const STORE_BP = 'blueprints';

export const SAVE_VERSION = 1;

export class SaveSystem {
  constructor() { this.db = null; this.available = true; }

  async open() {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') {
      this.available = false;
      console.warn('[save] IndexedDB unavailable; progress will not persist.');
      return null;
    }
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_WORLD)) db.createObjectStore(STORE_WORLD, { keyPath: 'slot' });
        if (!db.objectStoreNames.contains(STORE_BP)) {
          db.createObjectStore(STORE_BP, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => {
      console.error('[save] could not open database:', e);
      this.available = false;
      return null;
    });
    return this.db;
  }

  async _tx(store, mode, fn) {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let req;
      try { req = fn(os); } catch (e) { reject(e); return; }

      // An IDBRequest only carries its value once it has succeeded; a missing
      // key yields `undefined`, which must stay undefined rather than falling
      // back to the request object itself.
      let value;
      if (req && typeof req.onsuccess !== 'undefined') {
        req.onsuccess = () => { value = req.result; };
      } else {
        value = req;
      }
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  // ---- world saves -------------------------------------------------------

  async saveWorld(slot, payload) {
    const record = {
      slot,
      version: SAVE_VERSION,
      savedAt: Date.now(),
      data: payload,
    };
    try {
      await this._tx(STORE_WORLD, 'readwrite', (os) => os.put(record));
      return true;
    } catch (e) {
      console.error('[save] world save failed:', e);
      return false;
    }
  }

  async loadWorld(slot) {
    let rec;
    try {
      rec = await this._tx(STORE_WORLD, 'readonly', (os) => os.get(slot));
    } catch (e) {
      console.error('[save] world load failed:', e);
      return null;
    }
    if (!rec) return null;
    const errs = validateWorld(rec);
    if (errs.length) {
      console.error('[save] refusing to load corrupt save:', errs);
      return null;
    }
    return rec;
  }

  async hasWorld(slot) { return !!(await this.loadWorld(slot)); }

  async deleteWorld(slot) {
    try { await this._tx(STORE_WORLD, 'readwrite', (os) => os.delete(slot)); return true; }
    catch (e) { console.error('[save] delete failed:', e); return false; }
  }

  // ---- blueprints --------------------------------------------------------

  async saveBlueprint(name, blueprint, meta = {}) {
    const record = {
      name: String(name || 'Untitled').slice(0, 40),
      version: SAVE_VERSION,
      savedAt: Date.now(),
      blueprint,
      meta,
    };
    try {
      const id = await this._tx(STORE_BP, 'readwrite', (os) => os.add(record));
      return id;
    } catch (e) {
      console.error('[save] blueprint save failed:', e);
      return null;
    }
  }

  async listBlueprints() {
    try {
      const all = await this._tx(STORE_BP, 'readonly', (os) => os.getAll());
      if (!Array.isArray(all)) return [];
      return all
        .filter((r) => r && r.blueprint && Array.isArray(r.blueprint.blocks))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
      console.error('[save] blueprint list failed:', e);
      return [];
    }
  }

  async deleteBlueprint(id) {
    try { await this._tx(STORE_BP, 'readwrite', (os) => os.delete(id)); return true; }
    catch (e) { console.error('[save] blueprint delete failed:', e); return false; }
  }
}

/** Returns an array of problems; empty means the record is safe to use. */
export function validateWorld(rec) {
  const errs = [];
  if (!rec || typeof rec !== 'object') return ['record is not an object'];
  if (rec.version !== SAVE_VERSION) errs.push(`unsupported save version ${rec.version}`);
  const d = rec.data;
  if (!d || typeof d !== 'object') return [...errs, 'missing data block'];
  if (typeof d.seed !== 'number' || !Number.isFinite(d.seed)) errs.push('bad world seed');
  if (!d.blueprint || !Array.isArray(d.blueprint.blocks)) errs.push('missing vehicle blueprint');
  if (d.inventory && typeof d.inventory !== 'object') errs.push('bad inventory');
  if (d.playerPosition && (!Array.isArray(d.playerPosition) || d.playerPosition.length !== 3
      || d.playerPosition.some((n) => typeof n !== 'number' || !Number.isFinite(n)))) {
    errs.push('bad player position');
  }
  return errs;
}
