import * as THREE from 'three';
import BlockRegistry from '../vehicles/BlockRegistry.js';

/**
 * Salvaging a defeated machine. Drive within range of a disabled wreck and press
 * the interact key to open its parts list; take what you want into inventory.
 *
 * The surviving blocks ARE the reward — destroyed blocks are already gone, and a
 * block is only removed from the wreck once it has been transferred, so nothing
 * is ever duplicated or lost mid-transfer.
 */
const RANGE = 11;
const _p = new THREE.Vector3();
const _pp = new THREE.Vector3();

export class Salvage {
  constructor(game) {
    this.game = game;
    this.near = null;        // the wreck currently in range
    this.open = null;        // the wreck whose UI is open
  }

  /** Every disabled, non-player vehicle is a potential wreck. */
  wrecks() {
    return this.game.vehicles.filter((v) => v !== this.game.playerVehicle && v.disabled && v.grid.size > 0);
  }

  update() {
    const player = this.game.playerVehicle;
    if (!player || !player.built) { this.near = null; return; }
    player.worldPosition(_pp);
    let best = null, bestD = RANGE;
    for (const w of this.wrecks()) {
      const d = w.worldPosition(_p).distanceTo(_pp);
      if (d < bestD) { bestD = d; best = w; }
    }
    this.near = best;
  }

  /** Highlighting / HUD prompt handled by Game; this returns transfer logic. */

  /** Everything recoverable from a wreck, grouped by block id. */
  manifest(wreck) {
    const counts = new Map();
    for (const b of wreck.grid.list()) {
      if (b.health <= 0) continue;
      counts.set(b.id, (counts.get(b.id) || 0) + 1);
    }
    return [...counts.entries()]
      .filter(([id]) => BlockRegistry.has(id))
      .map(([id, n]) => ({ id, def: BlockRegistry.get(id), count: n }))
      .sort((a, b) => a.def.name.localeCompare(b.def.name));
  }

  /**
   * Take up to `n` of block id from the wreck into inventory.
   * Removes the actual surviving blocks (outer first) so the wreck visibly shrinks.
   * @returns number actually taken
   */
  take(wreck, id, n = Infinity) {
    const survivors = wreck.grid.list().filter((b) => b.id === id && b.health > 0);
    const take = Math.min(n, survivors.length);
    // remove from the outside in: furthest from the (former) cab first
    survivors.sort((a, b) => dist2(b.pos) - dist2(a.pos));
    let taken = 0;
    for (let i = 0; i < take; i++) {
      const b = survivors[i];
      if (wreck.grid.remove(b.uid)) { this.game.inventory.add(id, 1); taken++; }
    }
    if (taken > 0) {
      wreck.build({ preserveMotion: true });
      if (wreck.grid.size === 0) this.game.removeVehicle(wreck);
      this.game.audio?.pickup();
    }
    return taken;
  }

  takeAll(wreck) {
    let total = 0;
    for (const { id, count } of this.manifest(wreck)) total += this.take(wreck, id, count);
    return total;
  }
}

function dist2(p) { return p[0] * p[0] + p[1] * p[1] + p[2] * p[2]; }
