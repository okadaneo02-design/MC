import * as THREE from 'three';

/**
 * Per-enemy behaviour: a small state machine that steers a modular vehicle with
 * the SAME control inputs the player uses (throttle / brake / steer / handbrake)
 * and aims its weapons. No pathfinding graph — reliable steering toward the
 * target with simple obstacle feelers.
 */

const STATES = ['idle', 'patrol', 'pursue', 'attack', 'retreat', 'disabled'];

const _self = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _to = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Two built machines are hostile when they belong to different combat factions.
 *  Wrecks and neutrals never fight. This is what lets AI factions fight each
 *  other (and the player) without any special-casing of "the player". */
export function areHostile(a, b) {
  const fa = a && a.faction, fb = b && b.faction;
  if (!fa || !fb || fa === fb) return false;
  if (fa === 'wreck' || fb === 'wreck' || fa === 'neutral' || fb === 'neutral') return false;
  return true;
}

export class EnemyAI {
  constructor(game, vehicle, spec) {
    this.game = game;
    this.vehicle = vehicle;
    this.spec = spec;             // archetype.ai
    this.state = 'patrol';
    this.aim = { firing: false, target: null, aimDir: null };
    this.detectRange = 85;
    this.loseRange = 120;
    this.patrolTarget = null;
    this._repath = 0;
    this._stuck = 0;
    this._lastPos = new THREE.Vector3();
    this.home = vehicle.worldPosition(new THREE.Vector3());
  }

  update(dt) {
    const v = this.vehicle;
    if (!v.built) return;
    if (v.disabled) {
      this.state = 'disabled';
      v.setControls({ throttle: 0, steer: 0, brake: 0.4, handbrake: true });
      this.aim.firing = false;
      return;
    }

    v.worldPosition(_self);
    // Target the nearest HOSTILE machine — that's the player OR a rival faction's
    // vehicle. This is what makes AI factions fight each other on their own.
    const foe = this._acquireHostile();
    let dist = Infinity;
    if (foe) { foe.worldPosition(_tgt); dist = _self.distanceTo(_tgt); }

    // state transitions
    if (foe && dist < this.detectRange) {
      this.state = dist <= this.spec.preferredRange * 1.3 ? 'attack' : 'pursue';
    } else if (this.state !== 'patrol') {
      this.state = 'patrol';
    }

    // stuck detection
    if (_self.distanceTo(this._lastPos) < 0.12) this._stuck += dt; else this._stuck = 0;
    this._lastPos.copy(_self);

    if (this.state === 'patrol') this._patrol(dt);
    else this._engage(dt, dist, foe);
  }

  /** Nearest hostile, built, active machine within lose-range (player or rival faction). */
  _acquireHostile() {
    let best = null, bd = this.loseRange * this.loseRange;
    for (const o of this.game.vehicles) {
      if (o === this.vehicle || !o.built || o.disabled) continue;
      if (!areHostile(this.vehicle, o)) continue;
      if (o.smoke > 0) continue;   // target is hidden in a smoke screen
      o.worldPosition(_t2);
      let d = _self.distanceToSquared(_t2);
      if (o.isDecoy) d *= 0.12;    // decoy drones look far more tempting than they are
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  _patrol(dt) {
    const v = this.vehicle;
    this._repath -= dt;
    if (!this.patrolTarget || this._repath <= 0 || _self.distanceTo(this.patrolTarget) < 6) {
      const a = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 40;
      this.patrolTarget = this.home.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      this._repath = 4 + Math.random() * 4;
    }
    this._driveToward(this.patrolTarget, 0.5, dt);
    this.aim.firing = false;
  }

  _engage(dt, dist, player) {
    const v = this.vehicle;
    const pref = this.spec.preferredRange;
    // aim at the player's cab (or centre)
    this.aim.target = _tgt.clone();
    this.aim.aimDir = null;

    let desired;
    if (this.spec.ram) {
      desired = _tgt;                       // close the distance and ram/drill
    } else if (dist < pref * 0.7) {
      // too close — back off a touch
      _to.copy(_self).sub(_tgt).normalize();
      desired = _self.clone().addScaledVector(_to, 8);
    } else if (dist > pref * 1.1) {
      desired = _tgt;
    } else {
      // strafe around at preferred range
      _to.copy(_tgt).sub(_self).normalize();
      _right.set(-_to.z, 0, _to.x);
      desired = _self.clone().addScaledVector(_right, (this._strafeDir ||= Math.random() < 0.5 ? 1 : -1) * 10);
    }
    this._driveToward(desired, this.spec.speed || 1, dt, dist);

    // fire when roughly facing the player and in range
    const facing = this._facingDot(_tgt);
    this.aim.firing = dist < this.detectRange && facing > 0.6;
  }

  _facingDot(point) {
    const v = this.vehicle;
    const fl = v.forwardLocal;
    _fwd.set(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion).normalize();
    _to.copy(point).sub(_self).setY(0).normalize();
    return _fwd.dot(_to);
  }

  _driveToward(point, speedScale, dt, dist = 999) {
    const v = this.vehicle;
    const fl = v.forwardLocal;
    _fwd.set(fl[0], fl[1], fl[2]).applyQuaternion(v.quaternion); _fwd.y = 0; _fwd.normalize();
    _right.set(_fwd.z, 0, -_fwd.x);
    _to.copy(point).sub(_self); _to.y = 0;
    const range = _to.length();
    _to.normalize();

    const forwardDot = _fwd.dot(_to);
    const rightDot = _right.dot(_to);
    let steer = THREE.MathUtils.clamp(rightDot * 2.2, -1, 1);

    // obstacle feelers: cast short rays ahead-left / ahead-right
    const avoid = this._avoid();
    if (avoid !== 0) steer = THREE.MathUtils.clamp(steer + avoid, -1, 1);

    let throttle = 0, brake = 0;
    if (forwardDot > 0.2) throttle = speedScale;
    else if (forwardDot < -0.3) { throttle = -0.5; }   // reverse to reorient
    else { throttle = 0.3; }

    // slow down as we arrive (unless ramming)
    if (!this.spec.ram && range < 5 && dist > 900) { throttle *= 0.3; brake = 0.3; }

    // unstick
    if (this._stuck > 1.2) {
      throttle = -0.6; steer = -steer; if (this._stuck > 2.5) this._stuck = 0;
    }

    v.setControls({ throttle, brake, steer, handbrake: false });
    // enemy mechanical parts (drills/rotators) always run; servos track aim
    v.setMechControls({ rotatorRun: true, toolToggle: true,
      servoLeft: false, servoRight: false, pistonOut: true, pistonIn: false });
  }

  _avoid() {
    const v = this.vehicle;
    const physics = this.game.physics;
    const origin = { x: _self.x, y: _self.y + 0.3, z: _self.z };
    const groups = AVOID_RAY;
    let steer = 0;
    for (const ang of [-0.4, 0.4]) {
      _q.setFromAxisAngle(UP, ang);
      _to.copy(_fwd).applyQuaternion(_q);
      const hit = physics.castRay(origin, { x: _to.x, y: 0, z: _to.z }, 7, groups,
        (meta) => meta && meta.vehicleId === v.id);
      if (hit && hit.toi < 6) {
        const strength = (6 - hit.toi) / 6;
        steer += (ang < 0 ? 1 : -1) * strength * 0.9;
      }
    }
    return steer;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
import { rayGroups, CG } from '../core/PhysicsWorld.js';
const AVOID_RAY = rayGroups(CG.GROUND | CG.OBSTACLE | CG.VEHICLE | CG.RESOURCE);
