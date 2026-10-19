import * as THREE from 'three';
import BlockRegistry from '../vehicles/BlockRegistry.js';
import { VehicleGrid } from '../vehicles/VehicleGrid.js';
import { ORIENTATIONS } from '../vehicles/Orientation.js';
import { MATERIALS } from '../models/ProceduralModels.js';

/**
 * A render-only "ghost" of a vehicle that lives on another machine. It carries no
 * physics body: the host simulates everything and streams each vehicle's pose, and
 * this just rebuilds block meshes from the streamed blueprint and smoothly chases
 * the streamed transform. It exposes just enough of the Vehicle interface
 * (built / worldPosition / quaternion / forwardLocal / telemetry / grid) that the
 * camera and HUD can treat it like a real vehicle.
 */
export class RemoteVehicle {
  constructor(scene, id, { detail = 1, isSelf = false, faction = 'enemy', tint = null, name = 'Machine' } = {}) {
    this.scene = scene;
    this.id = id;
    this.detail = detail;
    this.isSelf = isSelf;
    this.isPlayer = isSelf;
    this.faction = faction;
    this.tintColor = tint;
    this.name = name;
    this.built = false;
    this.disabled = false;
    this.forwardLocal = [0, 0, 1];
    this.telemetry = { forwardSpeed: 0, grounded: 0 };

    this.root = new THREE.Group();
    this.root.name = 'remote.' + id;
    scene.add(this.root);
    this.grid = new VehicleGrid();

    this.quaternion = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._targetQuat = new THREE.Quaternion();
    this._prevTargetPos = new THREE.Vector3();
    this._lastT = 0;
    this._bpHash = null;
    this._tintMat = null;
  }

  get position() { return this._pos; }
  worldPosition(v) { return v.copy(this._pos); }

  /** Rebuild meshes only when the blueprint actually changed (damage, building). */
  setBlueprint(bp, hash) {
    if (hash != null && hash === this._bpHash) return;
    this._bpHash = hash;
    // tear down old meshes
    for (let i = this.root.children.length - 1; i >= 0; i--) {
      const c = this.root.children[i];
      this.root.remove(c);
    }
    const { grid } = VehicleGrid.deserialize(bp);
    this.grid = grid;
    for (const b of grid.list()) {
      const m = BlockRegistry.createModel(b.id, this.detail);
      const lp = grid.blockLocalPosition(b);
      m.position.set(lp[0], lp[1], lp[2]);
      m.quaternion.copy(ORIENTATIONS[b.orient]);
      if (this.tintColor) this._applyTint(m);
      this.root.add(m);
    }
    this.built = grid.size > 0;
  }

  _applyTint(view) {
    if (!this._tintMat) {
      this._tintMat = MATERIALS.block.clone();
      this._tintMat.color = new THREE.Color(this.tintColor);
    }
    view.traverse((o) => { if (o.isMesh && o.name && o.name.endsWith('.body')) o.material = this._tintMat; });
  }

  /** Receive an authoritative pose for this tick. */
  setPose(p, q, speed = 0, grounded = 0, disabled = false) {
    this._prevTargetPos.copy(this._targetPos);
    this._targetPos.set(p[0], p[1], p[2]);
    this._targetQuat.set(q[0], q[1], q[2], q[3]);
    this.telemetry.forwardSpeed = speed;
    this.telemetry.grounded = grounded;
    this.disabled = disabled;
    if (!this._seeded) { this._pos.copy(this._targetPos); this.quaternion.copy(this._targetQuat); this._seeded = true; }
  }

  /** Smoothly chase the latest pose each rendered frame. */
  render() {
    this._pos.lerp(this._targetPos, 0.35);
    this.quaternion.slerp(this._targetQuat, 0.4);
    this.root.position.copy(this._pos);
    this.root.quaternion.copy(this.quaternion);
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    if (this._tintMat) this._tintMat.dispose();
  }
}
