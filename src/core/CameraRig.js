import * as THREE from 'three';
import { rayGroups, CG } from './PhysicsWorld.js';

const CAM_RAY_GROUPS = rayGroups(CG.GROUND | CG.OBSTACLE);

const _desired = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Third-person chase camera with mouse orbit, zoom and terrain collision
 * avoidance, plus a free orbit/pan rig used by Build Mode.
 */
export class CameraRig {
  constructor(camera, input, settings, physics) {
    this.camera = camera;
    this.input = input;
    this.settings = settings;
    this.physics = physics;

    this.mode = 'drive';
    this.yaw = 0;
    this.pitch = 0.26;
    this.distance = 11;
    this.minDistance = 3.5;
    this.maxDistance = 34;

    this.buildYaw = Math.PI * 0.25;
    this.buildPitch = 0.55;
    this.buildDistance = 12;
    this.buildTarget = new THREE.Vector3();

    this.position = new THREE.Vector3(0, 6, -12);
    this.lookAt = new THREE.Vector3();
    this.autoRecenter = true;
    this._recenterTimer = 0;
    this._shake = 0;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'build') {
      this.buildYaw = this.yaw;
      this.buildPitch = Math.max(0.35, this.pitch);
    }
  }

  addShake(amount) { this._shake = Math.min(1.2, this._shake + amount); }

  /** Frame the build camera on a vehicle's bounding box. */
  frameOn(center, radius) {
    this.buildTarget.copy(center);
    this.buildDistance = THREE.MathUtils.clamp(radius * 3.0 + 4, 6, 30);
  }

  update(dt, followVehicle) {
    this._shake = Math.max(0, this._shake - dt * 2.2);
    if (this.mode === 'build') this._updateBuild(dt);
    else this._updateDrive(dt, followVehicle);

    this.camera.position.copy(this.position);
    if (this._shake > 0.001) {
      const s = this._shake * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.lookAt);
  }

  // ---- drive -------------------------------------------------------------
  _updateDrive(dt, vehicle) {
    const sens = 0.0024 * this.settings.data.sensitivity;
    const inv = this.settings.data.invertY ? -1 : 1;
    const d = this.input.consumeMouseDelta();

    if (this.input.pointerLocked && (d.dx || d.dy)) {
      this.yaw -= d.dx * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch + d.dy * sens * inv, -0.42, 1.25);
      this._recenterTimer = 0;
    } else {
      this._recenterTimer += dt;
    }

    const wheel = this.input.consumeWheel();
    if (wheel) this.distance = THREE.MathUtils.clamp(this.distance + wheel * 1.4, this.minDistance, this.maxDistance);

    if (!vehicle || !vehicle.built) {
      this.lookAt.set(0, 1, 0);
      this._place(this.lookAt);
      return;
    }

    vehicle.worldPosition(_target);
    const stats = vehicle.grid.stats();
    const heightBias = 1.0 + Math.min(2.5, stats.blocks * 0.04);
    _target.y += heightBias;

    // Gently swing back behind the machine when the player isn't steering the camera.
    if (this.autoRecenter && this._recenterTimer > 1.4) {
      const fl = vehicle.forwardLocal;
      _dir.set(fl[0], fl[1], fl[2]).applyQuaternion(vehicle.quaternion);
      const desiredYaw = Math.atan2(-_dir.x, -_dir.z);
      const speedFactor = THREE.MathUtils.clamp(Math.abs(vehicle.telemetry.forwardSpeed) / 8, 0, 1);
      this.yaw = dampAngle(this.yaw, desiredYaw, dt * (0.6 + speedFactor * 2.4));
    }
    if (this.input.pressed('camReset')) {
      const fl = vehicle.forwardLocal;
      _dir.set(fl[0], fl[1], fl[2]).applyQuaternion(vehicle.quaternion);
      this.yaw = Math.atan2(-_dir.x, -_dir.z);
      this._recenterTimer = 2;
    }

    // Pull back a little at speed for a sense of velocity.
    const speedPull = THREE.MathUtils.clamp(Math.abs(vehicle.telemetry.forwardSpeed) * 0.09, 0, 3.0);
    this._place(_target, this.distance + speedPull);
  }

  /** Jump the boom directly behind a vehicle (used when a world starts). */
  snapBehind(vehicle) {
    if (!vehicle || !vehicle.built) return;
    const fl = vehicle.forwardLocal;
    _dir.set(fl[0], fl[1], fl[2]).applyQuaternion(vehicle.quaternion);
    this.yaw = Math.atan2(-_dir.x, -_dir.z);
    this.pitch = 0.26;
    vehicle.worldPosition(_target);
    _target.y += 1.4;
    _euler.set(-this.pitch, this.yaw, 0);
    this.position.set(0, 0, 1).applyEuler(_euler).multiplyScalar(this.distance).add(_target);
    this.position.y += 1.2;
    this.lookAt.copy(_target);
    this._recenterTimer = 0;
  }

  _place(target, dist = this.distance) {
    // Negated so a positive pitch lifts the boom above the target rather than
    // burying it in the ground.
    _euler.set(-this.pitch, this.yaw, 0);
    _desired.set(0, 0, 1).applyEuler(_euler).multiplyScalar(dist).add(target);
    _desired.y += 1.2;

    const safe = this._avoidGeometry(target, _desired);
    this.position.lerp(safe, 0.18);
    this.lookAt.lerp(target, 0.3);
  }

  /** Shorten the boom if world geometry would be between the camera and the target. */
  _avoidGeometry(target, desired) {
    _dir.copy(desired).sub(target);
    const len = _dir.length();
    if (len < 0.01) return desired;
    _dir.divideScalar(len);
    const hit = this.physics.castRay(
      { x: target.x, y: target.y, z: target.z },
      { x: _dir.x, y: _dir.y, z: _dir.z },
      len, CAM_RAY_GROUPS,
    );
    if (hit && hit.toi < len) {
      return _tmp.copy(target).addScaledVector(_dir, Math.max(1.6, hit.toi - 0.45));
    }
    return desired;
  }

  // ---- build -------------------------------------------------------------
  _updateBuild(dt) {
    const sens = 0.006 * this.settings.data.sensitivity;
    const m = this.input.mouse;
    const d = this.input.consumeMouseDelta();

    if (m.buttons.has(2) && !m.overUI) {            // RMB orbit
      this.buildYaw -= d.dx * sens;
      this.buildPitch = THREE.MathUtils.clamp(this.buildPitch + d.dy * sens, -0.4, 1.4);
    } else if (m.buttons.has(1) && !m.overUI) {      // MMB pan, in screen space
      _euler.set(0, this.buildYaw, 0);
      const right = _tmp.set(1, 0, 0).applyEuler(_euler);
      const scale = this.buildDistance * 0.0022;
      this.buildTarget.addScaledVector(right, -d.dx * scale);
      this.buildTarget.y += d.dy * scale;
    }

    const wheel = this.input.consumeWheel();
    if (wheel && !m.overUI) {
      this.buildDistance = THREE.MathUtils.clamp(this.buildDistance * (1 + wheel * 0.12), 3, 55);
    }

    _euler.set(-this.buildPitch, this.buildYaw, 0);
    _desired.set(0, 0, 1).applyEuler(_euler).multiplyScalar(this.buildDistance).add(this.buildTarget);
    this.position.lerp(_desired, 0.3);
    this.lookAt.lerp(this.buildTarget, 0.3);
  }
}

function dampAngle(current, target, t) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, t);
}
