import * as THREE from 'three';
import BlockRegistry from '../vehicles/BlockRegistry.js';

/**
 * Per-block damage, destruction and the resulting structural splits.
 *
 * Destroying a block removes it from the grid and rebuilds the owning vehicle,
 * which lets the connectivity graph split it into independent assemblies. The
 * controller cab is never special-cased into deleting the wreck: when a cab dies
 * the machine is only *disabled*; every surviving block stays as salvage.
 */

const _p = new THREE.Vector3();

/** How many Cogs a destroyed block is worth (cab is the jackpot). */
export function cogValue(def) {
  if (def.behavior === 'cab') return 25;
  return Math.max(1, Math.round(def.health / 45 + def.mass / 140));
}

export class DamageSystem {
  constructor(game) {
    this.game = game;
    /** vehicles that lost blocks this frame and need one rebuild */
    this._dirty = new Set();
    this._justDisabled = [];
  }

  /** Armour softens a hit but never fully negates it. */
  static mitigate(amount, armor, type = 'kinetic') {
    const soft = armor / (armor + 16);
    let through = amount * (1 - soft);
    if (type === 'drill') through = amount * (1 - soft * 0.5);   // drills shrug off armour
    return Math.max(through, amount * 0.12);
  }

  /**
   * Apply `amount` raw damage to one block.
   * @param info {type, point:{x,y,z}, dir, source}
   */
  applyBlockDamage(vehicle, uid, amount, info = {}) {
    if (!vehicle || !vehicle.built) return 0;
    const block = vehicle.grid.blocks.get(uid);
    if (!block || block.health <= 0) return 0;
    if (vehicle.invuln > 0) return 0;          // spawn-protection shield absorbs everything
    // Tester Mode is a safe sandbox: your machine can never be damaged or die.
    if (this.game.testerMode && vehicle.faction === 'player') return 0;

    let dealt = DamageSystem.mitigate(amount, block.def.armor, info.type);
    // Shield buffer soaks damage first (drills bypass it, like armour).
    if (vehicle.shield > 0 && info.type !== 'drill') {
      const absorb = Math.min(vehicle.shield, dealt);
      vehicle.shield -= absorb; dealt -= absorb;
      if (info.point) this.game.effects?.impact(info.point, { x: 0, y: 1, z: 0 }, 0x39c2ff);
      if (dealt <= 0.05) return absorb;
    }
    // Reactive armour: a heavy hit detonates a charge and soaks most of it.
    const rx = block.def.reactive;
    if (rx && dealt > 14) {
      if (block._rxCharges === undefined) block._rxCharges = rx.charges;
      if (block._rxCharges > 0) {
        block._rxCharges--;
        dealt *= (1 - rx.absorb);
        if (info.point) this.game.effects?.explosion(info.point, 0.4);
      }
    }
    block.health -= dealt;

    const fx = this.game.effects;
    if (fx && info.point) {
      const n = info.dir ? { x: -info.dir.x, y: -info.dir.y, z: -info.dir.z } : { x: 0, y: 1, z: 0 };
      fx.impact(info.point, n, info.type === 'drill' ? 0xffce5a : 0xffb347);
      // Chips of the block's own colour spall off — bigger hits throw more. These
      // are physical-looking debris that spray out and tumble, adding crunch.
      const col = block.def.swatch ? parseInt(block.def.swatch.slice(1), 16) : 0x8a94a0;
      fx.debris(info.point, col, Math.min(6, 1 + Math.floor(dealt / 10)), 4.5);
    }
    // brief damage flash via emissive-ish tint bucket on the mesh
    this._flash(vehicle, uid);

    if (block.health <= 0) this.destroyBlock(vehicle, uid, info);
    return dealt;
  }

  _flash(vehicle, uid) {
    const view = vehicle.blockView ? vehicle.blockView(uid) : null;
    if (!view) return;
    view.traverse?.((o) => {
      if (o.isMesh && o.material && o.material.emissive !== undefined && !o._flashing) {
        o._flashing = true;
        const prev = o.material;
        // shared material — clone once for the flash then restore
        const m = prev.clone();
        m.emissive = new THREE.Color(0xff5a3c);
        m.emissiveIntensity = 0.9;
        o.material = m;
        setTimeout(() => { o.material = prev; m.dispose(); o._flashing = false; }, 90);
      }
    });
  }

  destroyBlock(vehicle, uid, info = {}) {
    const block = vehicle.grid.blocks.get(uid);
    if (!block) return;
    // FX at the block's world position
    const view = vehicle.blockView ? vehicle.blockView(uid) : null;
    if (view) view.getWorldPosition(_p); else _p.copy(vehicle.position);
    const fx = this.game.effects;
    if (fx) {
      fx.debris(_p, block.def.swatch ? parseInt(block.def.swatch.slice(1), 16) : 0x5c6773, 5, 5);
      fx.explosion(_p, block.def.behavior === 'cab' ? 1.3 : 0.6);
    }
    this.game.audio?.boom(_p, block.def.behavior === 'cab' ? 1 : 0.5);

    // Breaking an enemy block pays out Cogs — the shop currency.
    if (vehicle.faction && vehicle.faction !== 'player') {
      this.game.addCogs?.(cogValue(block.def), { x: _p.x, y: _p.y, z: _p.z });
    }

    const wasCab = block.def.behavior === 'cab';
    vehicle.grid.remove(uid);
    this._dirty.add(vehicle);

    if (wasCab && !vehicle.disabled) {
      vehicle.disabled = true;
      this._justDisabled.push(vehicle);
    }
  }

  /** Contact-force listener: ramming and collisions damage blocks. */
  onContact(a, b, mag) {
    // Touching the terrain or the world walls never hurts — you shouldn't lose
    // blocks just by driving, landing, or scraping along the ground.
    const ak = a && a.kind, bk = b && b.kind;
    if (ak === 'ground' || bk === 'ground' || ak === 'bounds' || bk === 'bounds') return;
    // mag is the summed contact force magnitude for the step. A high threshold
    // means only real crashes into obstacles/enemies register.
    const THRESH = 11000;
    if (mag < THRESH) return;
    // No friendly fire: two player-faction machines — or a player's own loose
    // parts — never damage each other on contact.
    const aP = a && a.kind === 'block' && a.vehicle && a.vehicle.faction === 'player';
    const bP = b && b.kind === 'block' && b.vehicle && b.vehicle.faction === 'player';
    if (aP && bP) return;
    const over = mag - THRESH;
    const base = Math.min(70, over * 0.0016);
    if (base < 1) return;
    for (const [meta, other] of [[a, b], [b, a]]) {
      if (!(meta && meta.kind === 'block' && meta.vehicle)) continue;
      const block = meta.vehicle.grid.blocks.get(meta.uid);
      if (!block) continue;
      if (block.def.behavior === 'drill') continue;   // drills never take collision damage
      let dmg = base;
      // A Ram Spike on the OTHER vehicle amplifies what we take...
      if (other && other.kind === 'block' && other.vehicle && other.vehicleId !== meta.vehicleId) {
        const ob = other.vehicle.grid.blocks.get(other.uid);
        if (ob && ob.def.melee) dmg *= ob.def.melee.bonus;
      }
      // ...while being a Ram Spike ourselves shrugs the impact off.
      if (block.def.melee) dmg *= block.def.melee.selfProtect;
      if (dmg < 1) continue;
      const v = meta.vehicle.blockView(meta.uid);
      if (v) v.getWorldPosition(_p); else _p.copy(meta.vehicle.position);
      this.applyBlockDamage(meta.vehicle, meta.uid, dmg,
        { type: 'impact', point: { x: _p.x, y: _p.y, z: _p.z } });
    }
  }

  /** Rebuild every vehicle that lost blocks, once, at end of frame. */
  flush() {
    if (this._dirty.size === 0 && this._justDisabled.length === 0) return;
    for (const v of this._dirty) {
      if (v.grid.size === 0) { this.game.removeVehicle?.(v); continue; }
      v.build({ preserveMotion: true });
      if (this.game.mode === 'build' && v === this.game.playerVehicle) v.setFrozen(true);
    }
    this._dirty.clear();

    for (const v of this._justDisabled) {
      this.game.onVehicleDisabled?.(v);
    }
    this._justDisabled.length = 0;
  }
}
