import BlockRegistry, { CELL } from './BlockRegistry.js';
import { FACES, rotateDir } from './Orientation.js';

/**
 * Pure grid/graph logic for a vehicle. Deliberately free of Three.js and Rapier
 * so the rules (snapping, overlap, connectivity, cab uniqueness, serialisation)
 * can be exercised directly by the test suite.
 */

export const keyOf = (x, y, z) => `${x},${y},${z}`;
export const parseKey = (k) => k.split(',').map(Number);

let _uid = 1;
export const nextBlockUid = () => _uid++;
export const _resetUidForTests = () => { _uid = 1; };

/** Cells a block covers, in local (unrotated) space, anchored at [0,0,0]. */
export function localCells(def) {
  const out = [];
  for (let x = 0; x < def.size[0]; x++) {
    for (let y = 0; y < def.size[1]; y++) {
      for (let z = 0; z < def.size[2]; z++) out.push([x, y, z]);
    }
  }
  return out;
}

/** Cells a block covers in grid space, given anchor position and orientation. */
export function worldCells(def, pos, orient) {
  const local = localCells(def);
  const rotated = local.map((c) => rotateDir(c, orient));
  let mx = Infinity, my = Infinity, mz = Infinity;
  for (const r of rotated) {
    if (r[0] < mx) mx = r[0];
    if (r[1] < my) my = r[1];
    if (r[2] < mz) mz = r[2];
  }
  return rotated.map((r) => [pos[0] + r[0] - mx, pos[1] + r[1] - my, pos[2] + r[2] - mz]);
}

/** World-space RIGID attachment faces for a block. Joint blocks list only their base here. */
export function worldAttachFaces(def, orient) {
  return def.attachFaces.map((fi) => rotateDir(FACES[fi], orient));
}

/** World direction of a joint block's output face, or null for non-joints. */
export function jointOutputDir(def, orient) {
  if (def.behavior !== 'joint' || def.jointOutput == null) return null;
  return rotateDir(FACES[def.jointOutput], orient);
}
export function jointOutputWorld(block) { return jointOutputDir(block.def, block.orient); }

function dirEq(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

/**
 * Classify the interface across face `f` (pointing from the query block toward
 * `other`) between a query block (its rigid faces + optional joint output) and
 * an existing `other` block.
 * @returns 'rigid' | 'joint' | null
 */
function classifyConnection(qRigid, qOut, f, other) {
  const back = [-f[0], -f[1], -f[2]];
  const oRigid = worldAttachFaces(other.def, other.orient);
  const oHasBack = oRigid.some((d) => dirEq(d, back));
  const qHasF = qRigid.some((d) => dirEq(d, f));
  if (qHasF && oHasBack) return 'rigid';
  const oOut = jointOutputWorld(other);
  if (qHasF && oOut && dirEq(oOut, back)) return 'joint';   // query is the child of other's joint
  if (qOut && dirEq(qOut, f) && oHasBack) return 'joint';   // query is a joint; other is its child
  return null;
}

export class VehicleGrid {
  constructor() {
    /** uid -> block instance */
    this.blocks = new Map();
    /** cell key -> uid */
    this.cells = new Map();
    this.version = 0;
    this._assemblyCache = null;
  }

  get size() { return this.blocks.size; }

  clear() {
    this.blocks.clear();
    this.cells.clear();
    this._dirty();
  }

  _dirty() { this.version++; this._assemblyCache = null; }

  blockAt(x, y, z) {
    const uid = this.cells.get(keyOf(x, y, z));
    return uid === undefined ? null : this.blocks.get(uid);
  }

  list() { return [...this.blocks.values()]; }

  cabs() { return this.list().filter((b) => b.def.behavior === 'cab'); }
  cab() { return this.cabs()[0] || null; }

  /**
   * Can `id` be placed at `pos` with `orient`?
   * @returns {{ok:boolean, reason?:string, cells?:number[][], connections?:object[]}}
   */
  canPlace(id, pos, orient, opts = {}) {
    const def = BlockRegistry.get(id);
    if (!def) return { ok: false, reason: 'Unknown block type' };

    const cells = worldCells(def, pos, orient);
    for (const c of cells) {
      if (this.cells.has(keyOf(c[0], c[1], c[2]))) {
        return { ok: false, reason: 'Cell already occupied', cells };
      }
    }

    if (def.unique && this.list().some((b) => b.def.id === id)) {
      return { ok: false, reason: `Only one ${def.name} allowed per vehicle`, cells };
    }

    const isFirst = this.blocks.size === 0;
    if (isFirst) {
      if (def.behavior !== 'cab') {
        return { ok: false, reason: 'The first block must be a Controller Cab', cells };
      }
      return { ok: true, cells, connections: [] };
    }

    const connections = this.findConnections(def, cells, orient);
    if (connections.length === 0) {
      return { ok: false, reason: 'No valid attachment face touching the vehicle', cells };
    }
    return { ok: true, cells, connections };
  }

  /** Connections a hypothetical block would make (rigid or via a joint interface). */
  findConnections(def, cells, orient) {
    const qRigid = worldAttachFaces(def, orient);
    const qOut = jointOutputDir(def, orient);
    // All candidate probe faces: the block's rigid faces plus its own joint output.
    const probe = [...qRigid];
    if (qOut) probe.push(qOut);
    const cellSet = new Set(cells.map((c) => keyOf(c[0], c[1], c[2])));
    const found = [];
    const seenPairs = new Set();
    for (const c of cells) {
      for (const f of probe) {
        const n = [c[0] + f[0], c[1] + f[1], c[2] + f[2]];
        const nk = keyOf(n[0], n[1], n[2]);
        if (cellSet.has(nk)) continue;              // internal face of a multi-cell block
        const uid = this.cells.get(nk);
        if (uid === undefined) continue;
        const other = this.blocks.get(uid);
        const kind = classifyConnection(qRigid, qOut, f, other);
        if (!kind) continue;
        const pk = `${uid}:${nk}`;
        if (seenPairs.has(pk)) continue;
        seenPairs.add(pk);
        found.push({ uid, face: f, cell: c, kind });
      }
    }
    return found;
  }

  /**
   * Place a block. Returns the new block instance, or null if invalid.
   * Validation is always run; callers cannot bypass it.
   */
  place(id, pos, orient, opts = {}) {
    const check = this.canPlace(id, pos, orient, opts);
    if (!check.ok) {
      if (opts.verbose !== false) console.warn(`[grid] placement rejected: ${check.reason}`, { id, pos, orient });
      return null;
    }
    const def = BlockRegistry.get(id);
    const block = {
      uid: opts.uid ?? nextBlockUid(),
      id,
      def,
      pos: [pos[0], pos[1], pos[2]],
      orient,
      cells: check.cells,
      health: opts.health ?? def.health,
      maxHealth: def.health,
      assembly: 0,
      connected: true,
      config: opts.config ? { ...opts.config } : null,
    };
    this.blocks.set(block.uid, block);
    for (const c of check.cells) this.cells.set(keyOf(c[0], c[1], c[2]), block.uid);
    this._dirty();
    return block;
  }

  remove(uid) {
    const b = this.blocks.get(uid);
    if (!b) return null;
    for (const c of b.cells) this.cells.delete(keyOf(c[0], c[1], c[2]));
    this.blocks.delete(uid);
    this._dirty();
    return b;
  }

  removeAt(x, y, z) {
    const b = this.blockAt(x, y, z);
    return b ? this.remove(b.uid) : null;
  }

  /** True if removing `uid` would orphan any other block from the cab. */
  wouldOrphan(uid) {
    if (!this.blocks.has(uid)) return false;
    const snapshot = { blocks: new Map(this.blocks), cells: new Map(this.cells) };
    const removed = this.remove(uid);
    const parts = this.computeAssemblies();
    const orphaned = parts.detached.length > 0;
    // restore
    this.blocks = snapshot.blocks;
    this.cells = snapshot.cells;
    this._dirty();
    void removed;
    return orphaned;
  }

  /** Adjacency used for RIGID assembly flood-fill (joints do not merge). */
  neighbours(block) {
    const qRigid = worldAttachFaces(block.def, block.orient);
    const qOut = jointOutputWorld(block);
    const own = new Set(block.cells.map((c) => keyOf(c[0], c[1], c[2])));
    const out = new Set();
    for (const c of block.cells) {
      for (const f of qRigid) {
        const nk = keyOf(c[0] + f[0], c[1] + f[1], c[2] + f[2]);
        if (own.has(nk)) continue;
        const uid = this.cells.get(nk);
        if (uid === undefined) continue;
        const other = this.blocks.get(uid);
        if (classifyConnection(qRigid, qOut, f, other) === 'rigid') out.add(uid);
      }
    }
    return [...out];
  }

  /** All joint links in the grid: {jointUid, parent:[uids...], child:[uids...], jointBlock}. */
  jointLinks(groupOf) {
    const links = [];
    for (const block of this.blocks.values()) {
      if (block.def.behavior !== 'joint') continue;
      const out = jointOutputWorld(block);
      if (!out) continue;
      // The output face touches exactly one cell beyond the joint.
      const base = block.cells[0];
      const nk = keyOf(base[0] + out[0], base[1] + out[1], base[2] + out[2]);
      const childUid = this.cells.get(nk);
      if (childUid === undefined) continue;
      const child = this.blocks.get(childUid);
      // child must present a rigid face back toward the joint
      const back = [-out[0], -out[1], -out[2]];
      if (!worldAttachFaces(child.def, child.orient).some((d) => dirEq(d, back))) continue;
      links.push({ jointUid: block.uid, childUid, jointBlock: block,
        parentGroup: groupOf.get(block.uid), childGroup: groupOf.get(childUid) });
    }
    return links;
  }

  /**
   * Partition blocks into rigid assemblies, then connect them through joints.
   * The "live vehicle" is every assembly reachable from the cab via rigid
   * membership or joint links; anything else is detached (debris / salvage).
   */
  computeAssemblies() {
    if (this._assemblyCache) return this._assemblyCache;
    const unvisited = new Set(this.blocks.keys());
    const groups = [];
    const groupOf = new Map();
    while (unvisited.size) {
      const start = unvisited.values().next().value;
      const group = [];
      const stack = [start];
      unvisited.delete(start);
      while (stack.length) {
        const uid = stack.pop();
        group.push(uid);
        groupOf.set(uid, groups.length);
        for (const n of this.neighbours(this.blocks.get(uid))) {
          if (unvisited.delete(n)) stack.push(n);
        }
      }
      groups.push(group);
    }

    const links = this.jointLinks(groupOf);
    // adjacency between groups via joints
    const groupAdj = groups.map(() => new Set());
    for (const l of links) {
      if (l.parentGroup == null || l.childGroup == null || l.parentGroup === l.childGroup) continue;
      groupAdj[l.parentGroup].add(l.childGroup);
      groupAdj[l.childGroup].add(l.parentGroup);
    }

    const cab = this.cab();
    const cabGroup = cab ? groupOf.get(cab.uid) : (groups.length ? 0 : -1);

    // flood over joint links to find every live group
    const live = new Set();
    if (cabGroup >= 0) {
      const q = [cabGroup];
      live.add(cabGroup);
      while (q.length) {
        const g = q.pop();
        for (const n of groupAdj[g]) if (!live.has(n)) { live.add(n); q.push(n); }
      }
    }

    const main = groups[cabGroup] || [];
    const detached = groups.filter((_, i) => i !== cabGroup && !live.has(i));
    const liveGroups = groups.filter((_, i) => live.has(i));

    const byUid = new Map();
    groups.forEach((g, i) => g.forEach((u) => byUid.set(u, i)));
    for (const [uid, b] of this.blocks) b.connected = live.has(byUid.get(uid));

    const result = { main, detached, groups, groupOf, links, live, cabGroup, liveGroups, byUid };
    this._assemblyCache = result;
    return result;
  }

  /** Validity report used by build mode and by blueprint loading. */
  validate() {
    const errors = [];
    const warnings = [];
    const cabs = this.cabs();
    if (cabs.length === 0) errors.push('No Controller Cab — the vehicle cannot be driven.');
    if (cabs.length > 1) errors.push(`${cabs.length} Controller Cabs — exactly one is allowed.`);
    const { detached } = this.computeAssemblies();
    if (detached.length) {
      errors.push(`${detached.reduce((a, g) => a + g.length, 0)} block(s) are not connected to the cab.`);
    }
    const wheels = this.list().filter((b) => b.def.behavior === 'wheel');
    const engines = this.list().filter((b) => b.def.behavior === 'engine');
    if (wheels.length === 0) warnings.push('No wheels — this machine cannot move.');
    else if (wheels.length < 3) warnings.push('Fewer than 3 wheels — expect it to tip over.');
    if (engines.length === 0 && wheels.length > 0) warnings.push('No engine — wheels will roll but nothing drives them.');
    return { ok: errors.length === 0, errors, warnings };
  }

  /** Aggregate stats, in SI-ish units. */
  stats() {
    let mass = 0, power = 0, topSpeed = 0, health = 0, maxHealth = 0;
    let wheels = 0, engines = 0;
    const com = [0, 0, 0];
    for (const b of this.blocks.values()) {
      mass += b.def.mass;
      health += b.health;
      maxHealth += b.maxHealth;
      const c = this.blockCenter(b);
      com[0] += c[0] * b.def.mass; com[1] += c[1] * b.def.mass; com[2] += c[2] * b.def.mass;
      if (b.def.behavior === 'wheel') wheels++;
      if (b.def.behavior === 'engine' && b.health > 0) {
        engines++;
        power += b.def.engine.power;
        topSpeed = Math.max(topSpeed, b.def.engine.topSpeed);
      }
    }
    if (mass > 0) { com[0] /= mass; com[1] /= mass; com[2] /= mass; }
    return {
      mass, power, topSpeed, wheels, engines, blocks: this.blocks.size,
      health, maxHealth,
      powerToWeight: mass > 0 ? power / mass : 0,
      com,
    };
  }

  /** Geometric centre of a block, in grid units. */
  blockCenter(b) {
    let x = 0, y = 0, z = 0;
    for (const c of b.cells) { x += c[0]; y += c[1]; z += c[2]; }
    const n = b.cells.length;
    return [x / n, y / n, z / n];
  }

  /** Local-space centre in metres. */
  blockLocalPosition(b) {
    const c = this.blockCenter(b);
    return [c[0] * CELL, c[1] * CELL, c[2] * CELL];
  }

  bounds() {
    if (!this.blocks.size) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const k of this.cells.keys()) {
      const [x, y, z] = parseKey(k);
      lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z);
      hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z);
    }
    return { lo, hi };
  }

  // ---- serialisation ------------------------------------------------------

  static SCHEMA_VERSION = 2;

  serialize() {
    return {
      v: VehicleGrid.SCHEMA_VERSION,
      ...(this.paint ? { paint: this.paint } : {}),
      blocks: this.list().map((b) => ({
        i: b.id,
        p: b.pos,
        o: b.orient,
        h: Math.round(b.health),
        ...(b.config ? { c: b.config } : {}),
      })),
    };
  }

  /** @returns {{grid:VehicleGrid, errors:string[]}} — never throws on bad data. */
  static deserialize(data) {
    const errors = [];
    const grid = new VehicleGrid();
    if (!data || typeof data !== 'object') {
      errors.push('Blueprint data is not an object');
      return { grid, errors };
    }
    if (typeof data.v !== 'number' || data.v > VehicleGrid.SCHEMA_VERSION) {
      errors.push(`Unsupported blueprint version ${data.v}`);
      return { grid, errors };
    }
    if (!Array.isArray(data.blocks)) {
      errors.push('Blueprint has no block list');
      return { grid, errors };
    }
    if (typeof data.paint === 'number' || typeof data.paint === 'string') grid.paint = data.paint;
    // Place the cab first, then everything else in distance order so that each
    // placement has something to attach to regardless of save ordering.
    const entries = data.blocks.filter((b) => b && typeof b.i === 'string' && Array.isArray(b.p));
    if (entries.length !== data.blocks.length) errors.push('Some block entries were malformed and skipped');

    const cabEntry = entries.find((b) => BlockRegistry.has(b.i) && BlockRegistry.get(b.i).behavior === 'cab');
    const ordered = [];
    if (cabEntry) ordered.push(cabEntry);
    const rest = entries.filter((b) => b !== cabEntry);
    const origin = cabEntry ? cabEntry.p : [0, 0, 0];
    rest.sort((a, b) => {
      const da = Math.abs(a.p[0] - origin[0]) + Math.abs(a.p[1] - origin[1]) + Math.abs(a.p[2] - origin[2]);
      const db = Math.abs(b.p[0] - origin[0]) + Math.abs(b.p[1] - origin[1]) + Math.abs(b.p[2] - origin[2]);
      return da - db;
    });
    ordered.push(...rest);

    // Multiple passes: a block whose support loads later still gets a chance.
    let pending = ordered;
    for (let pass = 0; pass < 4 && pending.length; pass++) {
      const failed = [];
      for (const e of pending) {
        if (!BlockRegistry.has(e.i)) {
          if (pass === 0) errors.push(`Unknown block "${e.i}" skipped`);
          continue;
        }
        const placed = grid.place(e.i, e.p, e.o | 0, {
          health: typeof e.h === 'number' ? e.h : undefined,
          config: e.c,
          verbose: false,
        });
        if (!placed) failed.push(e);
      }
      if (failed.length === pending.length) break;   // no progress
      pending = failed;
    }
    if (pending.length) errors.push(`${pending.length} block(s) could not be restored (invalid position or overlap)`);
    return { grid, errors };
  }

  clone() {
    const { grid } = VehicleGrid.deserialize(this.serialize());
    return grid;
  }
}
