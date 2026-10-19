import * as THREE from 'three';
import { projectileMesh } from '../models/ProceduralModels.js';
import { rayGroups, CG } from '../core/PhysicsWorld.js';

/**
 * Weapons, projectiles, turret aiming and drill tooling.
 *
 * Projectiles are pooled, kinematic and swept: each step we ray-cast along the
 * travel segment, so fast rounds never tunnel through thin armour. They collide
 * with the solid world and with any vehicle block except the shooter's own.
 */

const PROJ_RAY = rayGroups(CG.GROUND | CG.OBSTACLE | CG.VEHICLE | CG.DEBRIS | CG.RESOURCE);

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hitP = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _tgtBest = new THREE.Vector3();
const _aimPt = new THREE.Vector3();
const _lend = new THREE.Vector3();

export class Weapons {
  constructor(game, maxProjectiles = 120) {
    this.game = game;
    this.max = maxProjectiles;
    this.pool = [];
    this.group = new THREE.Group();
    this.group.name = 'projectiles';
    game.scene.add(this.group);
    for (let i = 0; i < this.max; i++) {
      const mesh = projectileMesh();
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ active: false, mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, dmg: 0, owner: -1 });
    }
    this.cursor = 0;
  }

  fire(origin, dir, { speed = 85, damage = 30, owner = -1, range = 90, hex = 0xffd36a, scale = 1, quiet = false, ball = false, emp = 0, leech = 0, homing = false, ownerFaction = null } = {}) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.active = true;
    p.pos.copy(origin);
    p.vel.copy(dir).normalize().multiplyScalar(speed);
    p.life = range / speed;
    p.dmg = damage;
    p.owner = owner;
    p.hex = hex;
    p.ball = ball;
    p.emp = emp;
    p.leech = leech;
    p.bounces = p.bounces || 0; p.bounces = 0;
    p.mesh.visible = true;
    // The shared projectile geometry is stretched 2.2× along Z to read as a
    // tracer round. Cannonballs undo that stretch (so they're spherical) and run
    // a bit larger so the "ball" reads clearly.
    if (ball) { const k = scale * 1.9; p.mesh.scale.set(k, k, k / 2.2); }
    else p.mesh.scale.setScalar(scale);
    p.mesh.position.copy(origin);
    p.mesh.quaternion.setFromUnitVectors(FORWARD, _d.copy(dir).normalize());
    if (!quiet) {
      _d.copy(dir).normalize();
      if (ball) this.game.effects?.cannonBlast(origin, _d, hex);
      else this.game.effects?.muzzle(origin, _d, hex);
      this.game.audio?.shot(origin);
    }
  }

  update(dt) {
    const physics = this.game.physics;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; p.mesh.visible = false; continue; }
      p.vel.y -= PROJ_GRAVITY * dt;           // mild drop so arcs read
      _a.copy(p.pos);
      _b.copy(p.vel).multiplyScalar(dt);
      const dist = _b.length();
      _d.copy(_b).normalize();
      const hit = physics.castRay({ x: _a.x, y: _a.y, z: _a.z }, { x: _d.x, y: _d.y, z: _d.z },
        dist, PROJ_RAY, (meta) => meta && meta.vehicleId === p.owner);
      if (hit && hit.toi <= dist) {
        _hitP.set(hit.point.x, hit.point.y, hit.point.z);
        const deflected = this._impact(p, hit, _d);
        if (!p.ball) this.game.effects?.tracer(_a, _hitP, p.hex);
        if (deflected && p.bounces < 2) {
          // ricochet: reflect velocity off the surface and keep flying
          p.bounces++;
          const n = hit.normal; const vn = p.vel.x * n.x + p.vel.y * n.y + p.vel.z * n.z;
          p.vel.x -= 2 * vn * n.x; p.vel.y -= 2 * vn * n.y; p.vel.z -= 2 * vn * n.z;
          p.vel.multiplyScalar(0.8);
          p.pos.set(hit.point.x + n.x * 0.1, hit.point.y + n.y * 0.1, hit.point.z + n.z * 0.1);
          this.game.effects?.impact(hit.point, hit.normal, 0xfff0b0);
          continue;
        }
        p.active = false; p.mesh.visible = false;
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      if (!p.ball) this.game.effects?.tracer(_a, p.pos, p.hex);
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.setFromUnitVectors(FORWARD, _d.copy(p.vel).normalize());
    }
  }

  _impact(p, hit, dir) {
    const meta = hit.meta;
    if (meta && meta.kind === 'block' && meta.vehicle) {
      // No friendly fire: a round never damages a machine of the SAME faction
      // (so allied convoys don't shred each other), but rival factions do.
      const owner = this.game.vehicles.find((v) => v.id === p.owner);
      if (owner && owner.faction && owner.faction === meta.vehicle.faction) {
        this.game.effects?.impact(hit.point, hit.normal, 0xbfcad6);
        return false;
      }
      // Ricochet armour: a glancing hit on an angled plate deflects the round.
      const block = meta.vehicle.grid.blocks.get(meta.uid);
      if (block && block.def.ricochet && hit.normal && !p.emp) {
        const glance = 1 - Math.abs(dir.x * hit.normal.x + dir.y * hit.normal.y + dir.z * hit.normal.z);
        if (glance > 0.45 && Math.random() < block.def.ricochet.chance) return true;   // deflect, no damage
      }
      // EMP rounds short out the whole machine instead of doing real damage.
      if (p.emp) {
        meta.vehicle.emp = Math.max(meta.vehicle.emp || 0, p.emp);
        this.game.effects?.impact(hit.point, hit.normal, 0x5fd0ff);
      }
      // Energy leech: siphon the target's stored energy into the shooter's batteries.
      if (p.leech) {
        const drained = Math.min(meta.vehicle.energy || 0, p.leech);
        meta.vehicle.energy = (meta.vehicle.energy || 0) - drained;
        meta.vehicle.shield = Math.max(0, (meta.vehicle.shield || 0) - p.leech * 0.5);
        const owner2 = this.game.vehicles.find((v) => v.id === p.owner);
        if (owner2) owner2.energy = Math.min(owner2.energyMax || Infinity, (owner2.energy || 0) + drained * 0.6);
        this.game.effects?.impact(hit.point, hit.normal, 0xb060ff);
      }
      this.game.damage.applyBlockDamage(meta.vehicle, meta.uid, p.dmg,
        { type: 'kinetic', point: hit.point, dir: { x: dir.x, y: dir.y, z: dir.z }, source: p.owner });
      return false;
    } else if (meta && meta.kind === 'resource' && this.game.resources) {
      this.game.resources.hit(meta, p.dmg * 0.4, hit.point);
    } else {
      this.game.effects?.impact(hit.point, hit.normal, 0xbfcad6);
    }
    return false;
  }

  dispose() {
    this.group.removeFromParent();
    for (const p of this.pool) p.mesh.geometry && p.mesh.material.dispose?.();
  }
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/** Player weapons reach this much further than the enemy's. */
/** Downward accel applied to projectiles (m/s²). Auto-aim compensates for it. */
const PROJ_GRAVITY = 7;

// ---------------------------------------------------------------------------
// Per-vehicle weapon controller: resolves each weapon/turret/drill block's
// world muzzle, aims turrets, enforces cooldowns and pulls the trigger.
// ---------------------------------------------------------------------------

export class VehicleWeapons {
  constructor(game, vehicle) {
    this.game = game;
    this.vehicle = vehicle;
    this.cooldowns = new Map();   // uid -> seconds remaining
    this.turretAim = new Map();   // uid -> {yaw, pitch}
    this.recoil = new Map();      // uid -> current backward kick offset (m)
  }

  /** @param aim {firing:bool, target:THREE.Vector3|null, aimDir:THREE.Vector3|null} */
  update(dt, aim) {
    const v = this.vehicle;
    if (!v.built || v.disabled || v.emp > 0) { this._decayRecoil(dt); return; }   // EMP silences weapons
    for (const [uid, cd] of this.cooldowns) if (cd > 0) this.cooldowns.set(uid, cd - dt);
    this._decayRecoil(dt);

    for (const block of v.grid.list()) {
      if (block.health <= 0) continue;
      const beh = block.def.behavior;
      if (beh === 'turret') this._turret(dt, block, aim);
      else if (beh === 'weapon') this._cannon(dt, block, aim);
      else if (beh === 'drill') this._drill(dt, block, aim);
      else if (beh === 'laser') this._laser(dt, block, aim);
      else if (beh === 'smoke') this._smoke(dt, block, aim);
      else if (beh === 'barricade') this._barricade(dt, block, aim);
      else if (beh === 'bridge') this._bridge(dt, block, aim);
      else if (beh === 'decoy') this._decoy(dt, block, aim);
      else if (beh === 'mine') this._mine(dt, block, aim);
    }
  }

  /** Drop a proximity mine on the ground behind the machine. */
  _mine(dt, block, aim) {
    if (!aim.firing || !this.game.barricades) return;
    const cd = this.cooldowns.get(block.uid) || 0;
    if (cd > 0) return;
    this.cooldowns.set(block.uid, block.def.mine.cooldown);
    const v = this.vehicle;
    v.worldPosition(_o);
    const fl = v.forwardLocal;
    _fwd.set(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion); _fwd.y = 0; _fwd.normalize();
    const bx = _o.x - _fwd.x * 3.5, bz = _o.z - _fwd.z * 3.5;
    const gy = this.game.arena?.heightAt ? this.game.arena.heightAt(bx, bz) : _o.y - 0.5;
    this.game.barricades.deployMine(bx, gy, bz, v.faction);
  }

  /** Launch a decoy drone (player-controlled machines only). */
  _decoy(dt, block, aim) {
    if (!aim.firing || !this.game.spawnDecoy || !this.vehicle.isPlayer) return;
    const cd = this.cooldowns.get(block.uid) || 0;
    if (cd > 0) return;
    this.cooldowns.set(block.uid, block.def.decoy.cooldown);
    const v = this.vehicle;
    v.worldPosition(_o);
    const fl = v.forwardLocal;
    _fwd.set(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion); _fwd.y = 0; _fwd.normalize();
    this.game.spawnDecoy(_o.x + _fwd.x * 6, _o.z + _fwd.z * 6, Math.atan2(_fwd.x, _fwd.z));
  }

  /** Lay a flat drivable bridge plank just ahead of the machine. */
  _bridge(dt, block, aim) {
    if (!aim.firing || !this.game.barricades) return;
    const cd = this.cooldowns.get(block.uid) || 0;
    if (cd > 0) return;
    this.cooldowns.set(block.uid, block.def.bridge.cooldown);
    const v = this.vehicle;
    v.worldPosition(_o);
    const fl = v.forwardLocal;
    _fwd.set(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion); _fwd.y = 0; _fwd.normalize();
    const bx = _o.x + _fwd.x * 4.5, bz = _o.z + _fwd.z * 4.5;   // ahead of the nose
    const gy = this.game.arena?.heightAt ? this.game.arena.heightAt(bx, bz) : _o.y - 0.5;
    this.game.barricades.deployBridge(bx, gy, bz, Math.atan2(_fwd.x, _fwd.z));
  }

  /** Drop a temporary barricade on the ground behind the machine. */
  _barricade(dt, block, aim) {
    if (!aim.firing || !this.game.barricades) return;
    const cd = this.cooldowns.get(block.uid) || 0;
    if (cd > 0) return;
    this.cooldowns.set(block.uid, block.def.barricade.cooldown);
    const v = this.vehicle;
    v.worldPosition(_o);
    const fl = v.forwardLocal;
    _fwd.set(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion); _fwd.y = 0; _fwd.normalize();
    const bx = _o.x - _fwd.x * 4, bz = _o.z - _fwd.z * 4;
    const gy = this.game.arena?.heightAt ? this.game.arena.heightAt(bx, bz) : _o.y - 0.5;
    this.game.barricades.deploy(bx, gy, bz, Math.atan2(_fwd.x, _fwd.z));
  }

  /** Continuous short-range cutting beam: melts whatever it touches, overheats. */
  _laser(dt, block, aim) {
    const view = this._worldOf(block); if (!view) return;
    const L = block.def.laser;
    view.getWorldPosition(_o); view.getWorldQuaternion(_q);
    _fwd.copy(FORWARD).applyQuaternion(_q).normalize();
    let fire = aim.firing;
    if (!fire && (this.vehicle.isPlayer || this.vehicle.mpControlled)) {
      const foe = this._acquireTarget(_o, L.range);
      if (foe) { _m.copy(foe).sub(_o); const d = _m.length(); _m.normalize(); if (d <= L.range && _m.dot(_fwd) > 0.9) fire = true; }
    }
    if (!fire) { block._heat = Math.max(0, (block._heat || 0) - dt * 0.7); return; }
    block._heat = (block._heat || 0) + dt;
    if (block._heat > 3) { if (block._heat > 4.5) block._heat = 0; return; }   // overheated: forced cooldown
    _o.set(block.def.muzzle[0], block.def.muzzle[1], block.def.muzzle[2]).applyMatrix4(view.matrixWorld);
    const hit = this.game.physics.castRay({ x: _o.x, y: _o.y, z: _o.z }, { x: _fwd.x, y: _fwd.y, z: _fwd.z },
      L.range, PROJ_RAY, (meta) => meta && meta.vehicleId === this.vehicle.id);
    _lend.copy(_o).addScaledVector(_fwd, hit ? hit.toi : L.range);
    this.game.effects?.tracer(_o, _lend, L.hex);
    if (hit && hit.meta) {
      if (hit.meta.kind === 'block' && hit.meta.vehicle && hit.meta.vehicle.faction !== this.vehicle.faction) {
        this.game.damage.applyBlockDamage(hit.meta.vehicle, hit.meta.uid, L.dps * dt, { type: 'kinetic', point: hit.point });
      } else if (hit.meta.kind === 'resource' && this.game.resources) {
        this.game.resources.hit(hit.meta, L.dps * dt * 0.6, hit.point);
      }
      this.game.effects?.drillSparks?.(hit.point);
    }
  }

  /** Pop a smoke screen that blinds enemy targeting for a while. */
  _smoke(dt, block, aim) {
    const cd = this.cooldowns.get(block.uid) || 0;
    if (cd > 0) return;
    const fire = aim.firing || (!this.vehicle.isPlayer && this.vehicle.disabled === false && (this.vehicle._wantSmoke));
    if (!fire) return;
    const S = block.def.smoke;
    this.cooldowns.set(block.uid, S.cooldown);
    this.vehicle.smoke = Math.max(this.vehicle.smoke || 0, S.duration);   // blinds enemies that target us
    const view = this._worldOf(block); if (view) view.getWorldPosition(_o);
    this.game.effects?.smokeScreen?.(_o, S.radius);
  }

  _worldOf(block) {
    const view = this.vehicle.blockView(block.uid);
    if (view) { view.updateWorldMatrix(true, false); return view; }
    return null;
  }

  /** Player/co-op weapon range multiplier, scaled by level; enemies stay at 1. */
  _rangeMul() {
    const v = this.vehicle;
    if ((v.isPlayer || v.mpControlled) && this.game.playerRangeMul) return this.game.playerRangeMul();
    return 1;
  }

  _turret(dt, block, aim) {
    const view = this._worldOf(block);
    if (!view) return;
    const head = view.getObjectByName('turret.head');
    if (!head) return;

    const cfg = block.def.turret;
    const weapon = block.def.weapon;
    // Player weapon reach scales with level (short early, long once you rank up).
    const range = (weapon.range ?? 80) * this._rangeMul();
    view.getWorldPosition(_o);                 // turret world position

    // Pick a target. Player turrets autonomously lock the nearest live hostile
    // and open fire on their own; if none is in range they fall back to the
    // crosshair and fire only while you hold Fire. Enemy turrets keep obeying
    // their AI's aim, exactly as before.
    let targetPt = null, autoFire = false;
    if (this.vehicle.isPlayer) {
      const foe = this._acquireTarget(_o, range);
      if (foe) { targetPt = _tgt.copy(foe); autoFire = true; }
    }
    if (!targetPt && aim.target) targetPt = _tgt.copy(aim.target);
    else if (!targetPt && aim.aimDir) targetPt = _tgt.copy(_o).addScaledVector(aim.aimDir, range);
    if (!targetPt) return;

    const dir = _m.copy(targetPt).sub(_o);
    const dist = dir.length();
    dir.normalize();

    // convert into the turret base's local frame to get yaw/pitch
    view.getWorldQuaternion(_q).invert();
    _fwd.copy(dir).applyQuaternion(_q);
    const yaw = Math.atan2(_fwd.x, _fwd.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1));
    const pitchC = THREE.MathUtils.clamp(pitch, cfg.minPitch, cfg.maxPitch);
    let st = this.turretAim.get(block.uid);
    if (!st) { st = { yaw: 0, pitch: 0 }; this.turretAim.set(block.uid, st); }
    st.yaw = approach(st.yaw, yaw, cfg.yawRate * dt);
    st.pitch = approach(st.pitch, pitchC, cfg.pitchRate * dt);
    head.rotation.set(0, 0, 0);
    head.rotateY(st.yaw);
    head.rotateX(-st.pitch);
    head.updateWorldMatrix(true, true);

    // fire when roughly on target, in range, and either auto-locked or triggered
    // Tight cone so the barrel you SEE is the barrel that shoots — the visible
    // rotation and the line of fire stay matched.
    const onTarget = Math.abs(angleDelta(st.yaw, yaw)) < 0.09 && Math.abs(angleDelta(st.pitch, pitchC)) < 0.12;
    if (onTarget && dist <= range && (autoFire || aim.firing)) {
      this._tryFire(block, head, block.def.muzzle, weapon, autoFire ? _tgt : null);
    }
  }

  /**
   * Nearest live, hostile, built vehicle within range — returns the world
   * position to shoot at. We aim at the enemy's CAB first (kill the brain and
   * the whole machine goes down); only if the cab is gone do we aim at the hull.
   */
  _acquireTarget(fromPos, range) {
    const self = this.vehicle;
    let best = null, bd = range * range;
    for (const other of this.game.vehicles) {
      if (other === self || !other.built || other.disabled) continue;
      if (other.faction === self.faction) continue;
      if (other.smoke > 0) continue;   // hidden by a smoke screen
      // prefer the cab's live world position
      const cab = other.grid.cab();
      let px, py, pz;
      const bv = cab ? other.blockView(cab.uid) : null;
      if (bv) { bv.getWorldPosition(_tp); px = _tp.x; py = _tp.y; pz = _tp.z; }
      else { other.worldPosition(_tp); px = _tp.x; py = _tp.y; pz = _tp.z; }
      const dx = px - fromPos.x, dy = py - fromPos.y, dz = pz - fromPos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = _tgtBest.set(px, py, pz); }
    }
    return best;
  }

  _cannon(dt, block, aim) {
    const view = this._worldOf(block);
    if (!view) return;
    const weapon = block.def.weapon;
    const range = (weapon.range ?? 90) * this._rangeMul();
    let fire = aim.firing;                      // manual trigger always works
    let aimPt = null;

    // Player cannons auto-fire when a hostile is in range and in the forward arc.
    if (!fire && (this.vehicle.isPlayer || this.vehicle.mpControlled)) {
      view.getWorldPosition(_o);
      const foe = this._acquireTarget(_o, range);
      if (foe) {
        view.getWorldQuaternion(_q);
        _fwd.copy(FORWARD).applyQuaternion(_q).normalize();
        _m.copy(foe).sub(_o);
        const dist = _m.length();
        _m.normalize();
        if (dist <= range && _m.dot(_fwd) > 0.8) { fire = true; aimPt = _aimPt.copy(foe); }
      }
    }
    if (fire) this._tryFire(block, view, block.def.muzzle, weapon, aimPt);
  }

  _tryFire(block, pivot, muzzleLocal, weapon, targetPoint = null) {
    const cd = this.cooldowns.get(block.uid) || 0;
    if (cd > 0) return;
    this.cooldowns.set(block.uid, 1 / weapon.fireRate);
    // muzzle world pos & forward
    pivot.updateWorldMatrix(true, false);
    _o.set(muzzleLocal[0], muzzleLocal[1], muzzleLocal[2]).applyMatrix4(pivot.matrixWorld);
    // When auto-engaging a locked target, converge the round on it — with a
    // ballistic lift so gravity drop doesn't make long shots fall short. Manual
    // fire just goes straight out of the muzzle ("point the machine" aiming).
    let base;
    if (targetPoint) {
      base = _fwd.copy(targetPoint).sub(_o);
      const dist = base.length();
      const flight = dist / (weapon.speed || 85);
      base.y += 0.5 * PROJ_GRAVITY * flight * flight;   // aim high to cancel the drop
      base.normalize();
    } else {
      pivot.getWorldQuaternion(_q);
      base = _fwd.copy(FORWARD).applyQuaternion(_q).normalize();
    }
    const hex = weapon.hex || (this.vehicle.isPlayer ? 0xffd36a : 0xff6a4a);
    const pellets = weapon.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      _d.copy(base);
      if (weapon.spread) {
        _d.x += (Math.random() - 0.5) * weapon.spread * 2;
        _d.y += (Math.random() - 0.5) * weapon.spread * 2;
        _d.z += (Math.random() - 0.5) * weapon.spread * 2;
        _d.normalize();
      }
      this.game.weapons.fire(_o, _d, {
        speed: weapon.speed, damage: weapon.damage, owner: this.vehicle.id,
        range: (weapon.range ?? 90) * this._rangeMul(),
        hex, scale: weapon.projScale || 1, ball: !!weapon.ball, emp: weapon.emp || 0, leech: weapon.leech || 0,
        quiet: i > 0,   // one muzzle flash/report per trigger pull, not per pellet
      });
    }
    // Recoil: kick the gun backward (springs back in _decayRecoil), scaled by punch.
    const kick = Math.min(0.42, 0.05 + (weapon.damage * (weapon.pellets || 1)) / 420);
    this.recoil.set(block.uid, kick);
    // The player feels big guns through the camera.
    if (this.vehicle.isPlayer) this.game.cameraRig?.addShake?.(Math.min(0.6, kick * 1.4));
  }

  /** Spring every recoiling gun's model back to rest along its local -Z. */
  _decayRecoil(dt) {
    if (!this.recoil.size) return;
    for (const [uid, amt] of this.recoil) {
      const view = this.vehicle.blockView(uid);
      const model = view && view.children[0];
      const next = amt * Math.max(0, 1 - 16 * dt) - 0.01 * dt;
      if (next <= 0.002) { if (model) model.position.z = 0; this.recoil.delete(uid); }
      else { if (model) model.position.z = -next; this.recoil.set(uid, next); }
    }
  }

  _drill(dt, block, aim) {
    // Drill damages whatever its tip actually touches while powered.
    const powered = this.vehicle.isPlayer
      ? (this.game._mechSignals && this.game._mechSignals.toolToggle)
      : true;   // enemy miners always run their drill
    const view = this._worldOf(block);
    if (!view) return;
    const moving = view.getObjectByName('drill.moving');
    const tool = block.def.tool;
    if (powered && moving) {
      // spin visual about the tool's configured axis (buzzsaw spins about X so it
      // reads as a forward-facing blade, augers spin about their long +Y axis)
      const spin = tool.spin * dt;
      if (tool.spinAxis === 'x') moving.rotateX(spin);
      else if (tool.spinAxis === 'z') moving.rotateZ(spin);
      else moving.rotateY(spin);
      // tip world position (cone tip ~ y=1.08 in model local)
      _o.set(0, 1.08, 0); view.updateWorldMatrix(true, true);
      const tip = view.localToWorld(_o.clone());
      view.getWorldQuaternion(_q);
      _d.set(0, 1, 0).applyQuaternion(_q).normalize();   // drill points along +Y of the block
      const hit = this.game.physics.castRay(
        { x: tip.x - _d.x * tool.reach, y: tip.y - _d.y * tool.reach, z: tip.z - _d.z * tool.reach },
        { x: _d.x, y: _d.y, z: _d.z }, tool.reach * 1.4, PROJ_RAY,
        (meta) => meta && meta.vehicleId === this.vehicle.id);
      if (hit && hit.meta) {
        if (hit.meta.kind === 'block' && hit.meta.vehicle) {
          this.game.damage.applyBlockDamage(hit.meta.vehicle, hit.meta.uid, tool.dps * dt, { type: 'drill', point: hit.point });
        } else if (hit.meta.kind === 'resource' && this.game.resources) {
          this.game.resources.hit(hit.meta, tool.dps * (tool.resourceFactor ?? 1) * dt, hit.point);
        }
        this.game.effects?.drillSparks(hit.point);
      }
    }
  }
}

function approach(cur, target, maxStep) {
  const d = angleDelta(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
