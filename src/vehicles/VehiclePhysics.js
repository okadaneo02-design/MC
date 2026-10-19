import * as THREE from 'three';
import { CG, rayGroups } from '../core/PhysicsWorld.js';
import { ORIENTATIONS } from './Orientation.js';

/**
 * Raycast suspension + tyre model.
 *
 * Each wheel casts a ray down through its own suspension travel, computes a
 * spring/damper load, then turns that load into longitudinal (drive/brake) and
 * lateral (grip) impulses applied to the owning assembly's rigid body at the
 * contact point. Nothing is teleported: everything the vehicle does, it does by
 * pushing on its own rigid body through the solver.
 */

// Ray filter: wheels probe the world and other vehicles, never their own machine.
const WHEEL_RAY_GROUPS = rayGroups(CG.GROUND | CG.OBSTACLE | CG.VEHICLE | CG.RESOURCE | CG.DEBRIS);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _steerQ = new THREE.Quaternion();

/** Runtime state for one wheel block. */
export class WheelSim {
  constructor(block, localPos, params) {
    this.block = block;
    this.uid = block.uid;
    this.params = params;
    /** suspension hardpoint, in assembly-local metres */
    this.hardpoint = new THREE.Vector3(localPos[0], localPos[1], localPos[2]);
    /** axle direction in assembly-local space */
    this.axleLocal = new THREE.Vector3(1, 0, 0);
    this.steerSign = 0;
    this.tank = !!params.tank;        // differential-steered track
    this.side = 0;                    // +1 right, -1 left (set by buildWheels)
    this.powered = true;
    this.grounded = false;
    this.compression = 0;
    this.prevCompression = 0;
    this.suspensionOffset = 0;     // visual drop of the wheel from the hardpoint
    this.spin = 0;
    this.spinRate = 0;
    this.steerAngle = 0;
    this.load = 0;
    this.slipRatio = 0;
    this.lateralSlip = 0;
    this.contactPoint = new THREE.Vector3();
    this.contactNormal = new THREE.Vector3(0, 1, 0);
    this.destroyed = false;
    this.skidding = false;
  }
}

/**
 * Build wheel runtime objects for an assembly.
 * @param grid VehicleGrid
 * @param uids block uids belonging to this assembly
 * @param forwardLocal vehicle forward in local space (from the cab)
 */
export function buildWheels(grid, uids, forwardLocal) {
  const wheels = [];
  const CELL = 1.0;
  for (const uid of uids) {
    const b = grid.blocks.get(uid);
    if (!b || b.def.behavior !== 'wheel') continue;
    const center = grid.blockLocalPosition(b);
    const m = ORIENTATIONS[b.orient];
    const contacts = Math.max(1, b.def.wheel.contacts || 1);
    // A long tread gets several suspension contacts spread down its length so it
    // sits flat and stable instead of balancing on one point.
    const lenDir = new THREE.Vector3(0, 0, 1).applyQuaternion(m);
    const span = (Math.max(...b.def.size) - 1) * CELL;
    // Share one wheel's suspension stiffness across its contacts.
    const params = contacts > 1
      ? { ...b.def.wheel, stiffness: b.def.wheel.stiffness / contacts, damping: b.def.wheel.damping / contacts, maxBrake: b.def.wheel.maxBrake / contacts }
      : b.def.wheel;
    for (let i = 0; i < contacts; i++) {
      const t = contacts > 1 ? (i / (contacts - 1) - 0.5) : 0;
      const hp = [center[0] + lenDir.x * t * span, center[1] + lenDir.y * t * span, center[2] + lenDir.z * t * span];
      const w = new WheelSim(b, hp, params);
      w.axleLocal.set(1, 0, 0).applyQuaternion(m).normalize();
      w.primary = (i === 0);               // only the first contact drives the visual
      if (w.tank) w.side = Math.sign(center[0]) || 1;   // which side of the hull the track is on
      wheels.push(w);
    }
  }
  assignSteering(wheels, forwardLocal);
  return wheels;
}

/** Front wheels steer; rear wheels stay fixed. Two-wheelers steer everything. */
export function assignSteering(wheels, forwardLocal) {
  if (!wheels.length) return;
  const f = new THREE.Vector3(forwardLocal[0], forwardLocal[1], forwardLocal[2]).normalize();
  const proj = wheels.map((w) => w.hardpoint.dot(f));
  const min = Math.min(...proj), max = Math.max(...proj);
  const spread = max - min;
  const mid = (min + max) / 2;
  for (let i = 0; i < wheels.length; i++) {
    if (spread < 0.6) wheels[i].steerSign = 1;            // single axle: steer all
    else wheels[i].steerSign = proj[i] > mid + 0.05 ? 1 : (proj[i] < mid - 0.05 ? 0 : 0.35);
  }
}

/**
 * Advance all wheels of one assembly by a fixed physics step.
 * @param ctx {physics, body, grid}
 * @param controls {throttle:-1..1, steer:-1..1, brake:0..1, handbrake:bool}
 */
export function stepWheels(ctx, wheels, controls, dt, out = {}) {
  const { physics, body } = ctx;
  if (!body || !wheels.length) return out;

  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const com = body.worldCom();
  const lin = body.linvel();
  const ang = body.angvel();

  _up.set(0, 1, 0).applyQuaternion(_q);
  const vehFwd = _v3.set(ctx.forwardLocal[0], ctx.forwardLocal[1], ctx.forwardLocal[2])
    .applyQuaternion(_q).normalize();

  const speed = Math.hypot(lin.x, lin.y, lin.z);
  const fwdSpeed = lin.x * vehFwd.x + lin.y * vehFwd.y + lin.z * vehFwd.z;

  // Steering authority tapers off with speed so fast vehicles stay drivable.
  const steerScale = 1 / (1 + Math.max(0, Math.abs(fwdSpeed)) * 0.055);

  const grounded = [];
  let groundedCount = 0;

  // ---- pass 1: suspension ------------------------------------------------
  for (const w of wheels) {
    if (w.destroyed) { w.grounded = false; w.load = 0; continue; }
    const p = w.params;

    // hardpoint in world space
    const hp = _v1.copy(w.hardpoint).applyQuaternion(_q).add(_v2.set(t.x, t.y, t.z));
    const travel = p.suspensionTravel;
    // restDrop is how far below its own grid cell the wheel hangs when unloaded;
    // it is what gives the hull ground clearance.
    const drop = p.restDrop || 0;
    const restDist = travel + drop + p.radius;
    const rayStart = { x: hp.x + _up.x * travel, y: hp.y + _up.y * travel, z: hp.z + _up.z * travel };
    const rayDir = { x: -_up.x, y: -_up.y, z: -_up.z };
    const maxDist = travel * 2 + drop + p.radius;

    const hit = physics.castRay(rayStart, rayDir, maxDist, WHEEL_RAY_GROUPS,
      (meta) => !!meta && meta.vehicleId === ctx.vehicleId);

    w.prevCompression = w.compression;
    if (!hit) {
      w.grounded = false;
      w.load = 0;
      w.compression = -travel;
      w.suspensionOffset = -(travel + drop);   // fully drooped
      w.spinRate *= 0.985;
      continue;
    }

    const d = hit.toi;
    const compression = THREE.MathUtils.clamp(restDist - d, -travel, travel);
    w.compression = compression;
    w.suspensionOffset = travel - (d - p.radius);   // + = up toward hardpoint
    w.grounded = true;
    w.contactPoint.set(hit.point.x, hit.point.y, hit.point.z);
    w.contactNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (w.contactNormal.dot(_up) < 0) w.contactNormal.negate();

    // velocity of the body at the contact point
    const rx = w.contactPoint.x - com.x, ry = w.contactPoint.y - com.y, rz = w.contactPoint.z - com.z;
    const vx = lin.x + (ang.y * rz - ang.z * ry);
    const vy = lin.y + (ang.z * rx - ang.x * rz);
    const vz = lin.z + (ang.x * ry - ang.y * rx);
    const vUp = vx * _up.x + vy * _up.y + vz * _up.z;

    let force = p.stiffness * compression - p.damping * vUp;
    if (force < 0) force = 0;                               // suspension cannot pull
    const maxForce = p.stiffness * travel * 2.2;
    if (force > maxForce) force = maxForce;
    w.load = force;

    body.applyImpulseAtPoint(
      { x: _up.x * force * dt, y: _up.y * force * dt, z: _up.z * force * dt },
      { x: w.contactPoint.x, y: w.contactPoint.y, z: w.contactPoint.z },
      true,
    );
    grounded.push({ w, vx, vy, vz });
    groundedCount++;
  }

  // ---- pass 2: tyre forces ----------------------------------------------
  const poweredGrounded = grounded.filter(({ w }) => w.powered).length;
  // Reverse is geared much lower than forward, so it tops out far sooner.
  const topSpeed = Math.max(4, ctx.topSpeed) * (controls.throttle < 0 ? 0.3 : 1);
  // Drive force falls off as we approach top speed instead of hard-clamping velocity.
  const speedFalloff = THREE.MathUtils.clamp(1 - Math.abs(fwdSpeed) / topSpeed, 0, 1);
  const driveBudget = ctx.power * speedFalloff;

  let anySkid = false;

  for (const { w, vx, vy, vz } of grounded) {
    const p = w.params;

    // Steering: rotate the wheel's forward around the body up axis.
    const targetSteer = controls.steer * p.steerAngle * w.steerSign * steerScale;
    w.steerAngle += (targetSteer - w.steerAngle) * Math.min(1, dt * 12);

    _right.copy(w.axleLocal).applyQuaternion(_q).normalize();
    // Forward is the vehicle heading flattened against the axle, then steered.
    _fwd.copy(vehFwd).addScaledVector(_right, -vehFwd.dot(_right));
    if (_fwd.lengthSq() < 1e-6) _fwd.copy(vehFwd);
    _fwd.normalize();
    _steerQ.setFromAxisAngle(_up, w.steerAngle);
    _fwd.applyQuaternion(_steerQ);
    _right.crossVectors(_up, _fwd).normalize();            // right-hand frame: right = up x fwd

    // project onto the contact plane
    const n = w.contactNormal;
    _fwd.addScaledVector(n, -_fwd.dot(n)).normalize();
    _right.addScaledVector(n, -_right.dot(n)).normalize();

    const vF = vx * _fwd.x + vy * _fwd.y + vz * _fwd.z;
    const vR = vx * _right.x + vy * _right.y + vz * _right.z;

    const load = w.load;
    const muLat = p.gripLateral;
    const muLong = p.gripLongitudinal;
    const maxLat = muLat * load * dt;
    const maxLong = muLong * load * dt;

    // --- lateral: kill sideways velocity, limited by grip ---
    const latMassShare = ctx.mass / Math.max(1, groundedCount);
    let jLat = -vR * latMassShare * 0.62;
    if (jLat > maxLat) jLat = maxLat;
    else if (jLat < -maxLat) jLat = -maxLat;
    w.lateralSlip = Math.abs(vR);

    // --- longitudinal: drive, brake, rolling resistance ---
    let jLong = 0;
    // Tank tracks steer differentially: one side drives forward, the other back,
    // so the machine pivots. Steering is baked into each track's throttle.
    const thr = w.tank
      ? Math.max(-1, Math.min(1, controls.throttle - controls.steer * w.side))
      : controls.throttle;
    const driving = Math.abs(thr) > 0.01;
    if (driving && w.powered && poweredGrounded > 0) {
      jLong += (driveBudget / poweredGrounded) * thr * dt;
    }
    const braking = controls.brake > 0.01 || controls.handbrake;
    if (braking) {
      const bForce = (controls.handbrake ? p.maxBrake : p.maxBrake * controls.brake);
      const stop = -Math.sign(vF) * Math.min(bForce * dt, Math.abs(vF) * latMassShare);
      jLong += stop;
    } else if (!driving) {
      // rolling resistance + creep damping so a parked machine stays parked
      const roll = -Math.sign(vF) * Math.min(Math.abs(vF) * latMassShare * 0.30, load * 0.04 * dt + 40 * dt);
      jLong += roll;
    }
    if (jLong > maxLong) jLong = maxLong;
    else if (jLong < -maxLong) jLong = -maxLong;

    // --- friction circle ---
    const mag = Math.hypot(jLong, jLat);
    const maxCombined = Math.max(maxLat, maxLong);
    if (mag > maxCombined && mag > 1e-6) {
      const s = maxCombined / mag;
      jLong *= s; jLat *= s;
      w.skidding = load > 1 && Math.abs(vR) > 2.0;
      if (w.skidding) anySkid = true;
    } else {
      w.skidding = false;
    }
    w.slipRatio = Math.abs(vF) > 0.2 ? jLong / Math.max(1, maxLong) : 0;

    body.applyImpulseAtPoint(
      {
        x: _fwd.x * jLong + _right.x * jLat,
        y: _fwd.y * jLong + _right.y * jLat,
        z: _fwd.z * jLong + _right.z * jLat,
      },
      { x: w.contactPoint.x, y: w.contactPoint.y, z: w.contactPoint.z },
      true,
    );

    // wheel spin for the visual + dust rate
    w.spinRate = vF / p.radius;
    w.spin += w.spinRate * dt;
  }

  // Airborne wheels still steer visually and coast.
  for (const w of wheels) {
    if (w.grounded || w.destroyed) continue;
    const targetSteer = controls.steer * w.params.steerAngle * w.steerSign * steerScale;
    w.steerAngle += (targetSteer - w.steerAngle) * Math.min(1, dt * 12);
    w.spin += w.spinRate * dt;
  }

  out.speed = speed;
  out.forwardSpeed = fwdSpeed;
  out.grounded = groundedCount;
  out.skidding = anySkid;
  return out;
}

export { WHEEL_RAY_GROUPS };
