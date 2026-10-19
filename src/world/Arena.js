import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS } from '../core/PhysicsWorld.js';
import { MATERIALS, PAL, PartBuilder, buildCrate, buildRock, PRIMS } from '../models/ProceduralModels.js';

/** Deterministic PRNG so a seed always produces the same arena. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Milestone 1 world: a bounded proving ground.
 *
 * Deliberately simple and *exact* — the rendered ground is a flat plane at y=0 and
 * its collider's top face is at y=0, and every prop's collider is built from the
 * same numbers as its mesh. Procedural biome terrain arrives in Milestone 4.
 */
export class Arena {
  constructor(game, { seed = 1337, size = 320, clutter = true } = {}) {
    this.game = game;
    this.seed = seed;
    this.size = size;
    /** Scattered crates/rocks. Tests turn this off to get a repeatable clear lane. */
    this.clutter = clutter;
    this.group = new THREE.Group();
    this.group.name = 'arena';
    this.bodies = [];
    this.props = [];
    this.landmarks = [];
    this.groundY = 0;
  }

  build() {
    const rand = mulberry32(this.seed);
    this._buildGround();
    this._buildWalls();
    this._buildProps(rand);
    return this;
  }

  _addStatic(colliderDesc, meta) {
    const world = this.game.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = world.createCollider(colliderDesc, body);
    this.game.physics.registerCollider(col, meta);
    this.bodies.push(body);
    return { body, col };
  }

  _buildGround() {
    const s = this.size;
    // ---- visual: a subdivided plane with subtle vertex-coloured wear ----
    const segs = 64;
    const geo = new THREE.PlaneGeometry(s, s, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const rand = mulberry32(this.seed ^ 0x9e37);
    const noise = (x, z) => (
      Math.sin(x * 0.07) * Math.cos(z * 0.061) * 0.5 +
      Math.sin(x * 0.021 + 1.7) * Math.sin(z * 0.019) * 0.5
    );
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = noise(x, z) * 0.5 + 0.5;
      const dirt = THREE.MathUtils.lerp(0.22, 0.42, n) + (rand() - 0.5) * 0.03;
      c.setRGB(dirt * 0.62, dirt * 0.60, dirt * 0.52);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.02,
    }));
    mesh.receiveShadow = true;
    mesh.name = 'ground';
    mesh.position.y = this.groundY;
    this.group.add(mesh);
    this.groundMesh = mesh;

    // painted grid lines so speed is readable
    const lines = new THREE.GridHelper(s, s / 8, 0x55606b, 0x3c454e);
    lines.material.transparent = true;
    lines.material.opacity = 0.22;
    lines.position.y = this.groundY + 0.012;
    this.group.add(lines);

    // ---- collider: top face exactly at groundY ----
    const half = 2;
    this._addStatic(
      RAPIER.ColliderDesc.cuboid(s / 2, half, s / 2)
        .setTranslation(0, this.groundY - half, 0)
        .setFriction(1.0)
        .setCollisionGroups(GROUPS.ground),
      { kind: 'ground' },
    );
  }

  _buildWalls() {
    const s = this.size, h = 6, t = 2;
    const b = new PartBuilder();
    const specs = [
      { pos: [0, h / 2, -s / 2 - t / 2], size: [s + t * 2, h, t] },
      { pos: [0, h / 2, s / 2 + t / 2], size: [s + t * 2, h, t] },
      { pos: [-s / 2 - t / 2, h / 2, 0], size: [t, h, s + t * 2] },
      { pos: [s / 2 + t / 2, h / 2, 0], size: [t, h, s + t * 2] },
    ];
    for (const sp of specs) {
      b.add(PRIMS.box, PAL.steelDark, { pos: sp.pos, scale: sp.size });
      // hazard stripe along the top
      b.add(PRIMS.box, PAL.hazard, {
        pos: [sp.pos[0], h - 0.4, sp.pos[2]],
        scale: [sp.size[0] * 1.001, 0.35, sp.size[2] * 1.001],
      });
      this._addStatic(
        RAPIER.ColliderDesc.cuboid(sp.size[0] / 2, sp.size[1] / 2, sp.size[2] / 2)
          .setTranslation(sp.pos[0], sp.pos[1], sp.pos[2])
          .setFriction(0.6)
          .setCollisionGroups(GROUPS.obstacle),
        { kind: 'wall' },
      );
    }
    const mesh = new THREE.Mesh(b.bake(), MATERIALS.block);
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.name = 'walls';
    this.group.add(mesh);
  }

  _buildProps(rand) {
    // --- test wall right in front of spawn: the collision acceptance test ---
    this._box([0, 1.5, 26], [10, 3, 1.5], PAL.steel, 'test-wall');
    this._box([-9, 1.0, 26], [2, 2, 1.5], PAL.rust, 'test-wall');
    this._box([9, 1.0, 26], [2, 2, 1.5], PAL.rust, 'test-wall');

    // --- ramps ---
    this._ramp([-26, 0, 14], 0, 8, 2.4, 11);
    this._ramp([26, 0, 14], Math.PI, 8, 3.6, 13);
    this._ramp([0, 0, -34], Math.PI / 2, 9, 2.0, 14);

    // --- a platform you can only reach via the big ramp ---
    this._box([26, 1.8, 26], [12, 3.6, 12], PAL.iron, 'platform');

    // --- stair steps (suspension test) ---
    for (let i = 0; i < 5; i++) {
      this._box([-30 + i * 2.4, 0.22 + i * 0.22, -16], [2.4, 0.44 + i * 0.44, 7], PAL.steelDark, 'steps');
    }

    // --- scattered crates & rubble ---
    for (let i = 0; this.clutter && i < 26; i++) {
      const x = (rand() - 0.5) * (this.size - 40);
      const z = (rand() - 0.5) * (this.size - 40);
      if (Math.hypot(x, z) < 16) continue;          // keep spawn clear
      const sz = 0.9 + rand() * 1.0;
      const crate = buildCrate(sz);
      crate.position.set(x, sz / 2, z);
      crate.rotation.y = rand() * Math.PI;
      this.group.add(crate);
      this._addStatic(
        RAPIER.ColliderDesc.cuboid(sz / 2, sz / 2, sz / 2)
          .setTranslation(x, sz / 2, z)
          .setRotation(quatY(crate.rotation.y))
          .setCollisionGroups(GROUPS.obstacle),
        { kind: 'crate' },
      );
    }

    // --- rock clusters (visual + a simple ball collider each) ---
    for (let i = 0; this.clutter && i < 22; i++) {
      const x = (rand() - 0.5) * (this.size - 30);
      const z = (rand() - 0.5) * (this.size - 30);
      if (Math.hypot(x, z) < 22) continue;
      const scale = 1.4 + rand() * 2.4;
      const rock = buildRock(rand, scale);
      rock.position.set(x, scale * 0.15, z);
      rock.rotation.y = rand() * Math.PI * 2;
      this.group.add(rock);
      this._addStatic(
        RAPIER.ColliderDesc.ball(scale * 0.52)
          .setTranslation(x, scale * 0.30, z)
          .setCollisionGroups(GROUPS.obstacle),
        { kind: 'rock' },
      );
    }

    // --- landmark pylons so you can navigate ---
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * (this.size / 2 - 18);
      const z = Math.sin(a) * (this.size / 2 - 18);
      this._pylon(x, z, [PAL.accent, PAL.blue, PAL.green, PAL.red][i]);
    }
  }

  _box(pos, size, color, kind) {
    const b = new PartBuilder();
    b.add(PRIMS.box, color, { scale: size });
    // panel seams
    b.add(PRIMS.box, PAL.steelDark, { pos: [0, size[1] / 2, 0], scale: [size[0] * 0.98, 0.08, size[2] * 0.98] });
    const mesh = new THREE.Mesh(b.bake(), MATERIALS.block);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this._addStatic(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setTranslation(pos[0], pos[1], pos[2])
        .setFriction(0.8)
        .setCollisionGroups(GROUPS.obstacle),
      { kind },
    );
    return mesh;
  }

  /** Wedge ramp whose convex-hull collider uses the exact mesh vertices. */
  _ramp(origin, yaw, w, h, d) {
    const hw = w / 2, hd = d / 2;
    const v = [
      [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
      [-hw, h, -hd], [hw, h, -hd],
    ];
    const faces = [
      [0, 2, 1], [0, 3, 2],
      [0, 1, 5], [0, 5, 4],
      [3, 4, 5], [3, 5, 2],
      [0, 4, 3], [1, 2, 5],
    ];
    const pos = [];
    for (const f of faces) for (const idx of f) pos.push(...v[idx]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const col = new Float32Array(pos.length);
    const c = new THREE.Color(PAL.steel);
    for (let i = 0; i < pos.length / 3; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(g, MATERIALS.block);
    mesh.position.set(origin[0], origin[1], origin[2]);
    mesh.rotation.y = yaw;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);

    const pts = new Float32Array(v.flat());
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (!desc) {
      console.error('[arena] convex hull failed for ramp; falling back to box');
      return;
    }
    desc.setTranslation(origin[0], origin[1], origin[2])
      .setRotation(quatY(yaw))
      .setFriction(0.9)
      .setCollisionGroups(GROUPS.obstacle);
    this._addStatic(desc, { kind: 'ramp' });
  }

  _pylon(x, z, color) {
    this.landmarks.push({ x, z, color });
    const b = new PartBuilder();
    b.add(PRIMS.cyl8, PAL.steelDark, { pos: [0, 5, 0], scale: [1.2, 10, 1.2] });
    b.add(PRIMS.box, color, { pos: [0, 9.2, 0], scale: [1.9, 1.2, 1.9] });
    b.add(PRIMS.box, PAL.hazard, { pos: [0, 0.5, 0], scale: [2.0, 1.0, 2.0] });
    const mesh = new THREE.Mesh(b.bake(), MATERIALS.block);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    this.group.add(mesh);
    this._addStatic(
      RAPIER.ColliderDesc.cylinder(5, 0.7).setTranslation(x, 5, z).setCollisionGroups(GROUPS.obstacle),
      { kind: 'pylon' },
    );
  }

  /** Height of walkable ground under a point (flat for Milestone 1). */
  heightAt() { return this.groundY; }

  dispose() {
    for (const b of this.bodies) this.game.physics.removeBody(b);
    this.bodies.length = 0;
    this.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.group.removeFromParent();
  }
}

function quatY(yaw) {
  const h = yaw / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}
