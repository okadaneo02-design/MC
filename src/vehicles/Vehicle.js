import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import BlockRegistry, { CELL } from './BlockRegistry.js';
import { VehicleGrid } from './VehicleGrid.js';
import { ORIENTATIONS } from './Orientation.js';
import { buildWheels, stepWheels } from './VehiclePhysics.js';
import { GROUPS } from '../core/PhysicsWorld.js';
import { MATERIALS } from '../models/ProceduralModels.js';

let _vehicleId = 1;

/**
 * A Vehicle owns:
 *   - a VehicleGrid (the design)
 *   - one rigid body per rigid assembly, each a compound of block colliders
 *   - one THREE.Group per assembly holding the block meshes
 *
 * Milestone 1 produces exactly one assembly; the plumbing is already plural so
 * that joints (Milestone 3) and battle-damage splits (Milestone 2) drop in.
 */
export class Vehicle {
  constructor(game, opts = {}) {
    this.game = game;
    this.id = _vehicleId++;
    this.name = opts.name || 'Machine';
    this.isPlayer = !!opts.isPlayer;
    this.grid = opts.grid || new VehicleGrid();
    this.detail = opts.detail ?? 1;

    this.spawn = new THREE.Vector3(...(opts.position || [0, 3, 0]));
    this.spawnYaw = opts.rotationY || 0;

    /** @type {Array<{uids:number[], body:any, group:THREE.Group, wheels:any[], colliders:any[]}>} */
    this.assemblies = [];
    this.root = new THREE.Group();
    this.root.name = `vehicle:${this.id}`;

    this.controls = { throttle: 0, steer: 0, brake: 0, handbrake: false };
    this.telemetry = { speed: 0, forwardSpeed: 0, grounded: 0, skidding: false };
    this.disabled = false;      // cab destroyed
    this.built = false;
    this.joints = [];
    this._mech = null;
    this._blockViews = new Map();   // uid -> {group, wheelMesh, assemblyIndex}
  }

  get cab() { return this.grid.cab(); }
  get stats() { return this.grid.stats(); }
  get mainAssembly() { return this.assemblies[0] || null; }

  /** Forward direction in vehicle-local space, taken from the cab's orientation. */
  get forwardLocal() {
    const cab = this.cab;
    if (!cab) return [0, 0, 1];
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(ORIENTATIONS[cab.orient]);
    return [Math.round(v.x), Math.round(v.y), Math.round(v.z)];
  }

  // =========================================================================
  // Construction
  // =========================================================================

  /**
   * (Re)build physics bodies and meshes from the current grid.
   * Preserves the main body's transform and velocity across rebuilds when asked.
   */
  build({ preserveMotion = false } = {}) {
    const prev = preserveMotion && this.mainAssembly?.body ? {
      t: this.mainAssembly.body.translation(),
      r: this.mainAssembly.body.rotation(),
      lv: this.mainAssembly.body.linvel(),
      av: this.mainAssembly.body.angvel(),
    } : null;

    this.destroyPhysics();

    const parts = this.grid.computeAssemblies();
    if (!parts.groups.length) { this.built = false; return this; }

    // Order groups so the cab's group is assemblies[0] (the main body).
    const order = [];
    if (parts.cabGroup >= 0) order.push(parts.cabGroup);
    parts.groups.forEach((_, i) => { if (i !== parts.cabGroup) order.push(i); });
    const assemblyIndexByGroup = new Map();
    order.forEach((groupIdx, assemblyIdx) => assemblyIndexByGroup.set(groupIdx, assemblyIdx));

    const physics = this.game.physics;
    const world = physics.world;

    order.forEach((groupIdx, index) => {
      const uids = parts.groups[groupIdx];
      const isMain = index === 0;
      const live = parts.live.has(groupIdx);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setLinearDamping(0.06)
        .setAngularDamping(0.35)
        .setCcdEnabled(isMain);
      const body = world.createRigidBody(desc);

      const group = new THREE.Group();
      group.name = `assembly:${this.id}:${index}`;
      this.root.add(group);

      const colliders = [];
      for (const uid of uids) {
        const b = this.grid.blocks.get(uid);
        if (!b) continue;
        const local = this.grid.blockLocalPosition(b);
        const q = ORIENTATIONS[b.orient];
        const cdef = b.def.collider;

        if (cdef && cdef.type !== 'none') {
          const half = cdef.half || [0.5, 0.5, 0.5];
          // Optional per-collider offset within the cell (e.g. a flat plate that
          // hugs its mount face). Offset is in local space and rotates with the block.
          let ox = local[0], oy = local[1], oz = local[2];
          if (cdef.offset) {
            _off.set(cdef.offset[0], cdef.offset[1], cdef.offset[2]).applyQuaternion(q);
            ox += _off.x; oy += _off.y; oz += _off.z;
          }
          // Wheels normally carry a mass-only collider; a detached wheel-only
          // chunk would fall through the world, so debris wheels get solid.
          const solidWheel = cdef.noCollide && !live;
          // Build the base shape: an exact convex hull (wedge) or a cuboid.
          let cd;
          if (cdef.type === 'convex' && cdef.points && cdef.points.length >= 4) {
            const pts = new Float32Array(cdef.points.length * 3);
            for (let i = 0; i < cdef.points.length; i++) {
              pts[i * 3] = cdef.points[i][0] * CELL;
              pts[i * 3 + 1] = cdef.points[i][1] * CELL;
              pts[i * 3 + 2] = cdef.points[i][2] * CELL;
            }
            cd = RAPIER.ColliderDesc.convexHull(pts);
            if (!cd) {
              console.error(`[vehicle] convex hull failed for "${b.id}"; using a cuboid`);
              cd = RAPIER.ColliderDesc.cuboid(half[0] * CELL, half[1] * CELL, half[2] * CELL);
            }
          } else {
            cd = RAPIER.ColliderDesc.cuboid(half[0] * CELL, half[1] * CELL, half[2] * CELL);
          }
          cd.setTranslation(ox, oy, oz)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setMass(b.def.mass)
            .setFriction(cdef.noCollide ? 0.4 : 0.72)
            .setRestitution(0.04)
            .setCollisionGroups(cdef.noCollide && !solidWheel ? GROUPS.wheel
              : (live ? GROUPS.vehicle : GROUPS.debris));
          if (!cdef.noCollide || solidWheel) {
            cd.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
            cd.setContactForceEventThreshold(2500);
          }
          const col = world.createCollider(cd, body);
          physics.registerCollider(col, {
            kind: 'block', vehicleId: this.id, vehicle: this, uid, assembly: index,
          });
          colliders.push(col);
          b._collider = col;
        }

        // --- visuals ---
        const view = BlockRegistry.createModel(b.id, this.detail);
        view.position.set(local[0], local[1], local[2]);
        view.quaternion.copy(q);
        view.userData.uid = uid;
        const tint = this.tintColor || (this.grid && this.grid.paint);
        if (tint) this._applyTint(view, tint);
        group.add(view);
        this._blockViews.set(uid, { view, assemblyIndex: index, isWheel: b.def.behavior === 'wheel' });
      }

      const wheels = live ? buildWheels(this.grid, uids, this.forwardLocal) : [];
      this.assemblies.push({
        uids, body, group, wheels, colliders, index, groupIdx, live,
        prevPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(),
        curPos: new THREE.Vector3(), curQuat: new THREE.Quaternion(),
      });
    });

    // place the main body; every live assembly shares the vehicle-local frame,
    // so they all start at the SAME world transform and their joints begin satisfied.
    const main = this.assemblies[0];
    let baseT, baseR;
    if (prev) {
      baseT = prev.t; baseR = prev.r;
    } else {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spawnYaw);
      baseT = { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z };
      baseR = { x: q.x, y: q.y, z: q.z, w: q.w };
    }
    for (const a of this.assemblies) {
      a.body.setTranslation(baseT, true);
      a.body.setRotation(baseR, true);
    }
    if (prev) { main.body.setLinvel(prev.lv, true); main.body.setAngvel(prev.av, true); }

    // --- create the mechanical joints between assemblies ---
    this._buildJoints(parts, assemblyIndexByGroup);

    for (const a of this.assemblies) this._snapshot(a, true);
    this.built = true;
    this._refreshFlags();
    return this;
  }

  /** Create Rapier impulse joints for every joint link in the grid. */
  _buildJoints(parts, assemblyIndexByGroup) {
    this.joints = [];
    const world = this.game.physics.world;
    for (const link of parts.links) {
      const pIdx = assemblyIndexByGroup.get(link.parentGroup);
      const cIdx = assemblyIndexByGroup.get(link.childGroup);
      if (pIdx == null || cIdx == null || pIdx === cIdx) continue;
      const parent = this.assemblies[pIdx];
      const child = this.assemblies[cIdx];
      const jb = link.jointBlock;
      const jdef = jb.def.joint;

      // Anchor at the boundary between the joint block and its child, in the
      // shared vehicle-local frame (identical for both bodies at build time).
      const centre = this.grid.blockLocalPosition(jb);
      const out = _v3.set(jdef.outputFace[0], jdef.outputFace[1], jdef.outputFace[2])
        .applyQuaternion(ORIENTATIONS[jb.orient]);
      const anchor = { x: centre[0] + out.x * 0.5, y: centre[1] + out.y * 0.5, z: centre[2] + out.z * 0.5 };
      const axis = _v4.set(jdef.axis[0], jdef.axis[1], jdef.axis[2])
        .applyQuaternion(ORIENTATIONS[jb.orient]).normalize();
      const axisObj = { x: axis.x, y: axis.y, z: axis.z };

      let params, kind;
      if (jdef.type === 'piston') {
        params = RAPIER.JointData.prismatic(anchor, anchor, axisObj);
        kind = 'prismatic';
        const ext = (jb.config?.extend ?? jdef.extend ?? 0.9);
        params.limitsEnabled = true;
        params.limits = [0, ext];
      } else {
        params = RAPIER.JointData.revolute(anchor, anchor, axisObj);
        kind = 'revolute';
        if (jdef.type === 'servo') {
          const cfg = jb.config || jb.def.config;
          params.limitsEnabled = true;
          params.limits = [cfg.minAngle, cfg.maxAngle];
        } else if (jdef.type === 'hinge' && jdef.limits) {
          params.limitsEnabled = true;
          params.limits = jdef.limits;
        }
      }

      const joint = world.createImpulseJoint(params, parent.body, child.body, true);
      const rec = {
        jointUid: jb.uid, block: jb, type: jdef.type, kind,
        parent: pIdx, child: cIdx, joint, axisLocal: [axis.x, axis.y, axis.z],
        target: 0, velocity: 0,
      };
      this._configureMotor(rec);
      this.joints.push(rec);
      jb._joint = rec;
    }
  }

  _configureMotor(rec) {
    const jb = rec.block;
    const cfg = jb.config || jb.def.config || {};
    try {
      // Acceleration-based motors are mass-independent, so a servo holds its
      // angle just as firmly whether it is moving a plate or a loaded arm.
      const AB = RAPIER.MotorModel.AccelerationBased;
      if (rec.type === 'servo') {
        rec.joint.configureMotorModel?.(AB);
        rec.joint.configureMotorPosition?.(0, 220, 26);
      } else if (rec.type === 'rotator') {
        rec.joint.configureMotorModel?.(AB);
        rec.joint.configureMotorVelocity?.(0, 3.0);
      } else if (rec.type === 'piston') {
        rec.joint.configureMotorModel?.(AB);
        rec.joint.configureMotorPosition?.(0, 320, 40);
      }
      // passive hinge: no motor
    } catch (e) {
      console.warn('[vehicle] motor config failed for', rec.type, e);
    }
    void cfg;
  }

  _refreshFlags() {
    const cab = this.cab;
    this.disabled = !cab || cab.health <= 0;
    const s = this.grid.stats();
    this.power = s.power;
    this.topSpeed = s.topSpeed || 20;
    this.mass = s.mass;
    // Gyros + energy/shield/repair/aero capacities (healthy blocks only).
    let gyro = 0, eCap = 0, solar = 0, repHps = 0, repCost = 1.2, shCap = 0, shReg = 0;
    this.wings = []; this.thrusters = [];
    for (const b of this.grid.list()) {
      if (b.health <= 0) continue;
      const d = b.def;
      if (d.thruster) this.thrusters.push(b);
      if (d.gyro) gyro += d.gyro.strength;
      if (d.energy?.capacity) eCap += d.energy.capacity;
      if (d.energy?.solar) solar += d.energy.solar;
      if (d.repair) { repHps += d.repair.hps; repCost = d.repair.costPerHp; }
      if (d.shield) { shCap += d.shield.capacity; shReg += d.shield.regen; }
      if (d.wing) this.wings.push(b);
    }
    this._gyroStrength = gyro;
    this.solarRate = solar; this.repairHps = repHps; this.repairCost = repCost; this.shieldRegen = shReg;
    // Carry current charge across rebuilds; adding a battery/shield adds its
    // capacity immediately, so a freshly built machine starts fully charged.
    this.energy = Math.max(0, Math.min((this.energy ?? 0) + (eCap - (this.energyMax || 0)), eCap));
    this.shield = Math.max(0, Math.min((this.shield ?? 0) + (shCap - (this.shieldMax || 0)), shCap));
    this.energyMax = eCap; this.shieldMax = shCap;
  }

  destroyPhysics() {
    // Rapier drops impulse joints automatically when a connected body is removed.
    this.joints = [];
    for (const a of this.assemblies) {
      if (a.body) this.game.physics.removeBody(a.body);
      if (a.group) {
        a.group.removeFromParent();
        a.group.traverse((o) => { if (o.isMesh && o.geometry && o.userData.owned) o.geometry.dispose(); });
      }
    }
    this.assemblies.length = 0;
    this._blockViews.clear();
    this.built = false;
  }

  dispose() {
    this.destroyPhysics();
    this.root.removeFromParent();
    if (this._tintMat) { this._tintMat.dispose(); this._tintMat = null; }
  }

  // =========================================================================
  // Simulation
  // =========================================================================

  setControls(c) { Object.assign(this.controls, c); }

  /** Mechanical control signals, keyed by binding action name (set each frame). */
  setMechControls(m) { this._mech = m; }

  /** Called once per fixed physics step, before world.step(). */
  fixedUpdate(dt) {
    if (!this.built) return;
    const main = this.assemblies[0];
    if (!main) return;

    // EMP: shorts out drive, weapons and powered systems for a few seconds.
    if (this.emp > 0) this.emp = Math.max(0, this.emp - dt);
    if (this.smoke > 0) this.smoke = Math.max(0, this.smoke - dt);   // smoke screen fades
    const empd = this.emp > 0;

    const ctl = (this.disabled || empd)
      ? { throttle: 0, steer: 0, brake: 0.35, handbrake: false }
      : this.controls;

    for (const a of this.assemblies) {
      if (!a.live || !a.wheels.length) continue;
      const res = stepWheels({
        physics: this.game.physics,
        body: a.body,
        vehicleId: this.id,
        forwardLocal: this.forwardLocal,
        power: (this.disabled || empd) ? 0 : (this.power || 0),
        topSpeed: this.topSpeed || 20,
        mass: Math.max(1, a.body.mass()),
      }, a.wheels, ctl, dt);
      if (a === main) Object.assign(this.telemetry, res);
    }

    if (this.joints && this.joints.length) this._driveMotors(dt);
    if (this._gyroStrength > 0 && !this.disabled && !empd) this._applyGyros(main, dt);
    if (!this.disabled && !empd) { this._powerSystems(dt); this._aero(main, dt); this._thrust(main, dt); }
  }

  /** Nitro: thrusters only fire while the boost key is held, shoving the machine
   *  along each thruster's facing for a burst of speed. No thrusters = no nitro. */
  _thrust(a, dt) {
    if (!this.thrusters || !this.thrusters.length) return;
    if (!this.controls.boost) return;
    const body = a.body;
    const r = body.rotation(); _gq.set(r.x, r.y, r.z, r.w);
    for (const t of this.thrusters) {
      if (t.health <= 0) continue;
      _gFwd.set(0, 0, 1).applyQuaternion(ORIENTATIONS[t.orient]).applyQuaternion(_gq);
      const f = t.def.thruster.force * dt;
      body.applyImpulse({ x: _gFwd.x * f, y: _gFwd.y * f, z: _gFwd.z * f }, true);
      // exhaust flame out the back of the nozzle (opposite the thrust vector)
      const view = this.blockView(t.uid);
      if (view) { view.getWorldPosition(_gExhaust); this.game.effects?.thrusterFlame?.(_gExhaust, _gFwd); }
    }
  }

  /** Solar charging, shield regen and energy-fed repair. */
  _powerSystems(dt) {
    const day = this.game.daylight ?? 1;
    if (this.solarRate > 0 && this.energyMax > 0) this.energy = Math.min(this.energyMax, this.energy + this.solarRate * day * dt);
    if (this.shieldMax > 0 && this.shield < this.shieldMax) this.shield = Math.min(this.shieldMax, this.shield + this.shieldRegen * dt);
    if (this.repairHps > 0 && this.energy > 0) {
      let worst = null;
      for (const b of this.grid.list()) if (b.health > 0 && b.health < b.maxHealth && (!worst || b.health < worst.health)) worst = b;
      if (worst) {
        const heal = Math.min(this.repairHps * dt, worst.maxHealth - worst.health, this.energy / this.repairCost);
        worst.health += heal; this.energy -= heal * this.repairCost;
      }
    }
  }

  /** Air resistance on everything + lift from wings proportional to airspeed². */
  _aero(a, dt) {
    const body = a.body;
    const lin = body.linvel();
    const k = 0.016 * this.grid.size;                       // quadratic-ish drag grows with size
    body.applyImpulse({ x: -lin.x * k * dt, y: -lin.y * k * dt, z: -lin.z * k * dt }, true);
    if (!this.wings || !this.wings.length) return;
    const r = body.rotation(); _gq.set(r.x, r.y, r.z, r.w);
    _gUp.set(0, 1, 0).applyQuaternion(_gq);
    _gFwd.set(this.forwardLocal[0], this.forwardLocal[1], this.forwardLocal[2]).applyQuaternion(_gq);
    const vFwd = lin.x * _gFwd.x + lin.y * _gFwd.y + lin.z * _gFwd.z;
    const q = vFwd * Math.abs(vFwd);                         // signed airspeed²
    let lift = 0;
    for (const w of this.wings) if (w.health > 0) lift += w.def.wing.lift;
    const f = lift * q * 0.006 * dt;
    body.applyImpulse({ x: _gUp.x * f, y: _gUp.y * f, z: _gUp.z * f }, true);
  }

  /** Gyroscopes: corrective torque that rights the hull and damps tumbling,
   *  while leaving yaw (steering) mostly free. */
  _applyGyros(a, dt) {
    const body = a.body;
    const r = body.rotation();
    _gq.set(r.x, r.y, r.z, r.w);
    _gUp.set(0, 1, 0).applyQuaternion(_gq);
    const upDot = Math.max(-1, Math.min(1, _gUp.dot(_WORLD_UP)));   // 1 upright, -1 inverted
    _gAxis.crossVectors(_gUp, _WORLD_UP);                           // sin(angle)*axis
    let axLen = _gAxis.length();
    if (axLen > 1e-4) _gAxis.multiplyScalar(1 / axLen);
    else { _gFwd.set(0, 0, 1).applyQuaternion(_gq); _gAxis.set(_gFwd.x, 0, _gFwd.z).normalize(); } // break symmetry when fully inverted
    // corrective magnitude grows with tilt but never stalls while flipped over
    let mag = Math.sin(Math.acos(upDot));
    if (upDot < 0.25) mag = Math.max(mag, 0.65);
    const mass = Math.max(1, body.mass());
    const k = this._gyroStrength * mass * 5.0;
    const damp = this._gyroStrength * mass * 1.1;
    const av = body.angvel();
    body.applyTorqueImpulse({
      x: (_gAxis.x * k * mag - av.x * damp) * dt,
      y: (-av.y * damp * 0.12) * dt,          // light yaw damping so it still turns
      z: (_gAxis.z * k * mag - av.z * damp) * dt,
    }, true);
  }

  /** Apply the current mechanical control signals to each powered joint. */
  _driveMotors(dt) {
    const mech = (this.disabled ? null : this._mech) || EMPTY_MECH;
    for (const rec of this.joints) {
      const jb = rec.block;
      if (jb.health <= 0) continue;
      const cfg = jb.config || jb.def.config || {};
      if (rec.type === 'servo') {
        const key = cfg.key || 'servo';
        let dir = 0;
        if (key === 'servo') dir = (mech.servoRight ? 1 : 0) - (mech.servoLeft ? 1 : 0);
        else dir = mech[key] ? 1 : 0;
        const rev = cfg.reverse ? -1 : 1;
        if (dir !== 0) {
          rec.target = clampNum(rec.target + dir * rev * (cfg.speed || 2) * dt, cfg.minAngle ?? -1.2, cfg.maxAngle ?? 1.2);
        } else if (cfg.returnCenter) {
          rec.target += (0 - rec.target) * Math.min(1, dt * 3);
        }
        try { rec.joint.configureMotorPosition(rec.target, 220, 26); } catch { /* */ }
      } else if (rec.type === 'rotator') {
        const key = cfg.key || 'rotatorRun';
        const on = cfg.hold ? !!mech[key] : (mech[key] || rec._latched);
        const rev = cfg.reverse ? -1 : 1;
        const vel = on ? (cfg.speed || 7) * rev : 0;
        try { rec.joint.configureMotorVelocity(vel, 3.0); } catch { /* */ }
      } else if (rec.type === 'piston') {
        const key = cfg.key || 'piston';
        let dir = 0;
        if (key === 'piston') dir = (mech.pistonOut ? 1 : 0) - (mech.pistonIn ? 1 : 0);
        else dir = mech[key] ? 1 : 0;
        const ext = cfg.extend ?? 0.9;
        rec.target = clampNum(rec.target + dir * (cfg.speed || 0.9) * dt, 0, ext);
        try { rec.joint.configureMotorPosition(rec.target, 320, 40); } catch { /* */ }
      }
    }
  }

  /** Called once per fixed physics step, after world.step(). */
  postStep() {
    for (const a of this.assemblies) this._snapshot(a, false);
  }

  _snapshot(a, reset) {
    const t = a.body.translation();
    const r = a.body.rotation();
    if (reset) {
      a.prevPos.set(t.x, t.y, t.z); a.curPos.set(t.x, t.y, t.z);
      a.prevQuat.set(r.x, r.y, r.z, r.w); a.curQuat.set(r.x, r.y, r.z, r.w);
    } else {
      a.prevPos.copy(a.curPos); a.prevQuat.copy(a.curQuat);
      a.curPos.set(t.x, t.y, t.z); a.curQuat.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Render-time interpolation; never advances physics. */
  syncRender(alpha) {
    if (!this.built) return;
    for (const a of this.assemblies) {
      a.group.position.lerpVectors(a.prevPos, a.curPos, alpha);
      a.group.quaternion.slerpQuaternions(a.prevQuat, a.curQuat, alpha);
      for (const w of a.wheels) this._syncWheel(w);
    }
    if (this.joints && this.joints.length) {
      for (const rec of this.joints) this._syncJointVisual(rec);
    }
  }

  /**
   * Drive the joint block's own moving sub-mesh (piston rod, servo/rotator plate)
   * to match the real relative motion between its parent and child bodies, so the
   * mechanism never looks detached from the thing it is moving.
   */
  _syncJointVisual(rec) {
    const view = this._blockViews.get(rec.jointUid)?.view;
    if (!view) return;
    if (rec.movingView === undefined) rec.movingView = view.getObjectByName(`${rec.type}.moving`) || null;
    const moving = rec.movingView;
    if (!moving) return;
    const parent = this.assemblies[rec.parent];
    const child = this.assemblies[rec.child];
    if (!parent || !child) return;

    // relative rotation of child in parent's local frame (= vehicle-local frame)
    const pr = parent.body.rotation(), cr = child.body.rotation();
    _qa.set(pr.x, pr.y, pr.z, pr.w).invert();
    _qb.set(cr.x, cr.y, cr.z, cr.w);
    _qrel.copy(_qa).multiply(_qb);

    const jdef = rec.block.def.joint;
    const m = jdef.axis;    // model-local axis
    const g = rec.axisLocal; // grid-local axis

    if (rec.kind === 'prismatic') {
      // extension along the axis, in parent-local frame
      const pt = parent.body.translation(), ct = child.body.translation();
      _v5.set(ct.x - pt.x, ct.y - pt.y, ct.z - pt.z).applyQuaternion(_qa);
      const d = _v5.x * g[0] + _v5.y * g[1] + _v5.z * g[2];
      moving.position.set(m[0] * d, m[1] * d, m[2] * d);
    } else {
      const ang = twistAngle(_qrel, g);
      moving.quaternion.setFromAxisAngle(_vAxis.set(m[0], m[1], m[2]), ang);
    }
  }

  _syncWheel(w) {
    if (w.primary === false) return;            // extra tread contacts share one visual
    const view = this._blockViews.get(w.uid);
    if (!view) return;
    const base = this.grid.blockLocalPosition(w.block);
    const v = view.view;
    // The hull plate stays bolted to the chassis at the cell; it only steers.
    v.position.set(base[0], base[1], base[2]);
    const q = v.quaternion;
    q.setFromAxisAngle(_UP, w.steerAngle);
    q.multiply(ORIENTATIONS[w.block.orient]);
    if (view.spin === undefined) {
      view.spin = v.getObjectByName('wheel.spin') || null;
      view.carrier = v.getObjectByName('wheel.carrier') || null;
    }
    if (view.spin) {
      // The tyre + hub-carrier drop/bob with the suspension (vehicle-up in local
      // frame); only the tyre also spins. The hull plate does NOT move.
      _off.set(0, 1, 0).applyQuaternion(_invQ.copy(q).invert()).multiplyScalar(w.suspensionOffset);
      view.spin.position.copy(_off);
      view.spin.quaternion.setFromAxisAngle(_X, w.spin);
      if (view.carrier) view.carrier.position.copy(_off);
    } else {
      v.position.set(base[0], base[1] + w.suspensionOffset, base[2]);  // old-model fallback
      // Tank treads are a static belt — they drive the vehicle but the model itself
      // must not spin like a wheel (that looked wrong). Round wheels still spin.
      const wd = w.block.def.wheel;
      if (!(wd && wd.tank)) q.multiply(_tmpQ.setFromAxisAngle(_X, w.spin));
    }
  }

  /** World transform of the main assembly (for camera, AI, salvage range). */
  get position() {
    const a = this.mainAssembly;
    if (!a) return this.spawn.clone();
    return a.group.position;
  }
  get quaternion() {
    const a = this.mainAssembly;
    return a ? a.group.quaternion : new THREE.Quaternion();
  }
  worldPosition(out = new THREE.Vector3()) {
    const a = this.mainAssembly;
    if (!a) return out.copy(this.spawn);
    const t = a.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  /** Flip the machine upright above the ground. Costs nothing but a little pride. */
  recover() {
    const a = this.mainAssembly;
    if (!a) return;
    const t = a.body.translation();
    const yaw = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(a.body.rotation().x, a.body.rotation().y, a.body.rotation().z, a.body.rotation().w),
      'YXZ',
    ).y;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    a.body.setTranslation({ x: t.x, y: t.y + 1.6, z: t.z }, true);
    a.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    a.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    a.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this._snapshot(a, true);
  }

  /** Freeze for build mode: kinematic-like hold without destroying the body. */
  setFrozen(frozen) {
    for (const a of this.assemblies) {
      if (!a.body) continue;
      if (frozen) {
        a.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        a.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        a.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      } else {
        a.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        a.body.wakeUp();
      }
    }
    this.frozen = frozen;
  }

  /** Lift the machine so its lowest block clears the ground at `y`. */
  settleAbove(y = 0) {
    const a = this.mainAssembly;
    if (!a) return;
    const b = this.grid.bounds();
    if (!b) return;
    const lowest = b.lo[1] * CELL - 0.6;
    const t = a.body.translation();
    // Prefer the live terrain height under the vehicle; fall back to the arg.
    const world = this.game.arena;
    const ground = (world && world.heightAt) ? world.heightAt(t.x, t.z) : y;
    a.body.setTranslation({ x: t.x, y: ground - lowest + 0.9, z: t.z }, true);
    a.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    a.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this._snapshot(a, true);
  }

  blockView(uid) { return this._blockViews.get(uid)?.view || null; }

  /** Tint an enemy's block body so factions read at a glance (shared-material safe). */
  _applyTint(view, color = this.tintColor) {
    if (!this._tintMat || this._tintColorUsed !== color) {
      this._tintMat = MATERIALS.block.clone();
      this._tintMat.color = new THREE.Color(color);
      this._tintColorUsed = color;
    }
    view.traverse((o) => {
      if (o.isMesh && o.name && o.name.endsWith('.body')) o.material = this._tintMat;
    });
  }
}

const _UP = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _tmpQ = new THREE.Quaternion();
const _off = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _gq = new THREE.Quaternion();
const _gUp = new THREE.Vector3();
const _gAxis = new THREE.Vector3();
const _gFwd = new THREE.Vector3();
const _gExhaust = new THREE.Vector3();
const _WORLD_UP = new THREE.Vector3(0, 1, 0);
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _vAxis = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qrel = new THREE.Quaternion();
const EMPTY_MECH = {};
function clampNum(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Signed rotation angle of quaternion q about unit axis a (swing–twist twist part). */
function twistAngle(q, a) {
  const d = q.x * a[0] + q.y * a[1] + q.z * a[2];
  const tx = a[0] * d, ty = a[1] * d, tz = a[2] * d, tw = q.w;
  const len = Math.hypot(tx, ty, tz, tw) || 1;
  let ang = 2 * Math.atan2(Math.hypot(tx, ty, tz) * Math.sign(d || 1), tw / len);
  if (ang > Math.PI) ang -= 2 * Math.PI;
  if (ang < -Math.PI) ang += 2 * Math.PI;
  return ang;
}

export default Vehicle;
