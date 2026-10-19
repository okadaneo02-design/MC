import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS } from '../core/PhysicsWorld.js';
import { MATERIALS, PAL } from '../models/ProceduralModels.js';

/**
 * Deployable barricades: solid, temporary road-blocks a vehicle drops behind
 * itself to block routes, make cover, or slow a pursuer. Each is a real physics
 * obstacle (vehicles and rounds collide with it). They expire after a while and a
 * hard cap stops them cluttering the map forever.
 */
const WALL = { half: [0.9, 0.55, 0.28], life: 30, color: PAL.rust, stripe: true };   // upright road-block
const BRIDGE = { half: [1.4, 0.1, 2.2], life: 45, color: PAL.steel, stripe: false }; // flat drivable plank
const MAX = 16;                   // global cap — oldest is removed past this

const _geoCache = new Map();
function slabGeo(half) {
  const key = half.join(',');
  if (!_geoCache.has(key)) _geoCache.set(key, new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2));
  return _geoCache.get(key);
}

export class BarricadeSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.mines = [];
    this.group = new THREE.Group();
    this.group.name = 'barricades';
    game.scene.add(this.group);
  }

  /** Lay a proximity mine that detonates when a hostile machine gets close. */
  deployMine(x, y, z, faction) {
    if (this.mines.length >= 10) this._removeMine(this.mines[0]);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.2, 10), MATERIALS.block.clone());
    mesh.material.color.setHex(0x3a3a3a);
    mesh.position.set(x, y + 0.1, z);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), MATERIALS.emissive(0xff3030));
    led.position.y = 0.16; mesh.add(led);
    this.group.add(mesh);
    const mine = { mesh, led, x, y, z, faction, arm: 1.2, life: 45 };
    this.mines.push(mine);
    return mine;
  }

  /** Drop an upright barricade behind you (block routes / cover). */
  deploy(x, y, z, yaw = 0) { return this._place(x, y, z, yaw, WALL); }
  /** Lay a flat, drivable bridge plank ahead (span gaps/trenches). */
  deployBridge(x, y, z, yaw = 0) { return this._place(x, y, z, yaw, BRIDGE); }

  _place(x, y, z, yaw, kind) {
    if (this.list.length >= MAX) this._remove(this.list[0]);   // recycle the oldest
    const h = kind.half;

    const mat = MATERIALS.block.clone(); mat.color.setHex(kind.color);
    const mesh = new THREE.Mesh(slabGeo(h), mat);
    mesh.position.set(x, y + h[1], z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (kind.stripe) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(h[0] * 2 * 0.92, 0.04, h[2] * 2 * 0.92), MATERIALS.emissive(PAL.hazard));
      stripe.position.y = h[1]; mesh.add(stripe);
    }
    this.group.add(mesh);

    const world = this.game.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setRotation(
      { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(h[0], h[1], h[2])
        .setTranslation(x, y + h[1], z)
        .setCollisionGroups(GROUPS.obstacle), body);
    this.game.physics.registerCollider(col, { kind: 'obstacle' });

    const bar = { mesh, body, col, life: kind.life };
    this.list.push(bar);
    this.game.audio?.pickup?.();
    return bar;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.life -= dt;
      if (b.life <= 0) this._remove(b);
      else if (b.life < 2) b.mesh.scale.y = Math.max(0.05, b.life / 2);   // sink as it crumbles
    }
    this._updateMines(dt);
  }

  _updateMines(dt) {
    if (!this.mines.length) return;
    const vehicles = this.game.vehicles || [];
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt; m.arm -= dt;
      if (m.life <= 0) { this._removeMine(m); continue; }
      if (m.led) m.led.visible = m.arm > 0 ? (Math.floor(m.life * 6) % 2 === 0) : true;   // blink, then solid when armed
      if (m.arm > 0) continue;
      // detonate when a hostile machine comes within trigger range
      let trig = null;
      for (const v of vehicles) {
        if (!v.built || v.disabled || !v.faction || v.faction === m.faction || v.faction === 'neutral') continue;
        const d = (v.position.x - m.x) ** 2 + (v.position.z - m.z) ** 2;
        if (d < 6 * 6) { trig = v; break; }
      }
      if (trig) this._detonate(m, vehicles);
    }
  }

  _detonate(m, vehicles) {
    this.game.effects?.explosion({ x: m.x, y: m.y + 0.3, z: m.z }, 1.3);
    this.game.audio?.boom?.({ x: m.x, y: m.y, z: m.z }, 1);
    for (const v of vehicles) {
      if (!v.built || v.disabled || !v.faction || v.faction === m.faction || v.faction === 'neutral') continue;
      const dx = v.position.x - m.x, dz = v.position.z - m.z;
      if (dx * dx + dz * dz > 8 * 8) continue;
      const cab = v.grid.cab();
      const uid = cab ? cab.uid : v.grid.list()[0]?.uid;
      if (uid != null) this.game.damage?.applyBlockDamage(v, uid, 130, { type: 'kinetic', point: { x: m.x, y: m.y, z: m.z } });
    }
    this._removeMine(m);
  }

  _removeMine(m) {
    const i = this.mines.indexOf(m);
    if (i >= 0) this.mines.splice(i, 1);
    m.mesh?.removeFromParent();
  }

  _remove(bar) {
    const i = this.list.indexOf(bar);
    if (i >= 0) this.list.splice(i, 1);
    if (bar.col) this.game.physics.unregisterCollider(bar.col);
    if (bar.body) this.game.physics.removeBody(bar.body);
    bar.mesh?.removeFromParent();
  }

  dispose() {
    for (const b of [...this.list]) this._remove(b);
    for (const m of [...this.mines]) this._removeMine(m);
    this.list.length = 0; this.mines.length = 0;
    this.group.removeFromParent();
  }
}
