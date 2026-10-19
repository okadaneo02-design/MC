import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS } from '../core/PhysicsWorld.js';
import { MATERIALS, PAL, PartBuilder, buildRock, buildTree, buildMonument, PRIMS } from '../models/ProceduralModels.js';
import { mulberry32, fbm, ridged, smoothstep } from './Noise.js';

/**
 * Milestone 4 world: seeded procedural heightmap terrain.
 *
 * A single Rapier *heightfield* collider is generated from the exact same height
 * grid that the visual mesh is built from, so collision matches what you see to
 * the vertex. The visual is split into tiles purely so the renderer can frustum-
 * cull them; the physics is one efficient static body.
 *
 * Interface mirrors the Milestone-1 Arena (build / heightAt / landmarks / group /
 * dispose / size) so the rest of the game treats either world identically.
 */

const BIOME = {
  grassland: { name: 'Emerald Plains', lo: 0x4fae38, hi: 0x86d85c, flat: 0x63c244 },
  hills:     { name: 'Rolling Hills', lo: 0x6fc045, hi: 0xa6dd72, flat: 0x83cc52 },
  desert:    { name: 'Sunshine Desert', lo: 0xe6c662, hi: 0xf4df94, flat: 0xdcb94e },
  rocky:     { name: 'Rocky Badlands', lo: 0x9aa0a8, hi: 0xc2c7cd, flat: 0xaab0b8 },
  mountains: { name: 'Snowcap Peaks', lo: 0x97a0ab, hi: PAL.snow, flat: 0xaeb8c2 },
  savanna:   { name: 'Golden Savannah', lo: 0xc2a747, hi: 0xe8d789, flat: 0xd4b95a },
  forest:    { name: 'Mushroom Forest', lo: 0x2f9a6e, hi: 0x79e0ac, flat: 0x49b586 },
  tundra:    { name: 'Frozen Highlands', lo: 0xb8cdda, hi: 0xeef5fa, flat: 0xd0e2ec },
  volcanic:  { name: 'Volcanic Badlands', lo: 0x4a3330, hi: 0x9c4a36, flat: 0x5e3a33 },
  canyon:    { name: 'Copper Canyon', lo: 0xad683a, hi: 0xdd9d5c, flat: 0xc27e45 },
  crystal_desert: { name: 'Crystal Desert', lo: 0xbfe3e0, hi: 0xeaf8f5, flat: 0xd4edee },
  coast:     { name: 'Sapphire Coast', lo: 0x3f8fd0, hi: 0x9fd6f2, flat: 0x5fb4e4 },
  wasteland: { name: 'Mechanical Wasteland', lo: 0x6a665e, hi: 0x9a948a, flat: 0x817b71 },
  neon:      { name: 'Neon Crystal Valley', lo: 0x7a2fd0, hi: 0xd06aff, flat: 0xa050f0 },
};

export class Terrain {
  constructor(game, { seed = 1337, size = 760, cells = 304, tiles = 8 } = {}) {
    this.game = game;
    this.seed = seed >>> 0;
    this.size = size;
    this.N = cells;             // grid cells per side (vertices = N+1)
    this.tiles = tiles;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.bodies = [];
    this.landmarks = [];
    this.groundY = 0;
    this.heights = null;        // Float32Array (N+1)^2, metres
    this.spawnHeight = 0;
  }

  // ---- height model -------------------------------------------------------

  /** Raw procedural elevation in metres at world (x,z) before spawn-flattening. */
  _elevation(x, z) {
    const s = this.seed;
    const continent = fbm(x * 0.0016, z * 0.0016, s, 4);
    const hills = fbm(x * 0.012, z * 0.012, s + 77, 3);
    const mnt = ridged(x * 0.0045, z * 0.0045, s + 131, 4);
    const mask = smoothstep(0.52, 0.82, continent);
    let h = continent * 7 + hills * 5.5 + mask * mnt * 46 - 3;

    // mountain rim so the bounded world feels like a natural basin, not a cliff
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (this.size * 0.5);
    h += smoothstep(0.72, 1.0, edge) * 70;
    return h;
  }

  /** Spawn-flattened elevation actually used for mesh + collider. */
  _height(x, z) {
    const raw = this._elevation(x, z);
    const r = Math.hypot(x, z);
    const flat = 1 - smoothstep(16, 34, r);     // 1 at origin, 0 past 34m
    return THREE.MathUtils.lerp(raw, this.spawnHeight, flat);
  }

  biomeAt(x, z) {
    const h = this._height(x, z);
    const moist = fbm(x * 0.003 + 100, z * 0.003 - 50, this.seed + 909, 3);
    const temp = fbm(x * 0.0025 - 40, z * 0.0025 + 70, this.seed + 1234, 3);
    // highlands: snow, volcanic (hot+dry), or copper canyon (hot) vs rocky
    if (h > 30) return temp > 0.62 ? 'volcanic' : 'mountains';
    if (h > 15) return (temp > 0.6 && moist < 0.5) ? 'canyon' : 'rocky';
    // lowlands split by temperature + moisture into colourful zones
    if (h < 1.5) return 'coast';                            // lowest ground → sapphire coast
    if (temp < 0.33) return 'tundra';                       // cold → frozen highlands
    if (moist > 0.8) return 'neon';                         // very wet, rare → neon crystal valley
    if (moist < 0.26 && temp > 0.72) return 'crystal_desert'; // scorching + bone dry → crystal desert
    if (moist < 0.4 && temp > 0.5) return 'desert';         // hot + dry → desert
    if (moist < 0.45 && temp > 0.36 && temp < 0.52) return 'wasteland'; // dry temperate → mechanical wasteland
    if (moist < 0.5 && temp > 0.42) return 'savanna';       // warm + semi-dry → golden savanna
    if (moist > 0.62 && temp < 0.55) return 'forest';       // wet + mild → mushroom forest
    if (h < 7 && moist > 0.52) return 'grassland';
    return 'hills';
  }

  // ---- build --------------------------------------------------------------

  build() {
    this.spawnHeight = this._elevation(0, 0);   // sample before flattening uses it
    this._sampleHeights();
    this._buildCollider();
    this._buildVisualTiles();
    this._scatterProps();
    this._placeLandmarks();
    return this;
  }

  _sampleHeights() {
    const N = this.N, size = this.size;
    const H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      const z = (j / N - 0.5) * size;
      for (let i = 0; i <= N; i++) {
        const x = (i / N - 0.5) * size;
        H[j * (N + 1) + i] = this._height(x, z);
      }
    }
    this.heights = H;
  }

  _buildCollider() {
    // The hitbox IS the model: a trimesh built from the exact same vertex grid
    // and triangulation as the rendered terrain, so collision matches what you
    // see 1:1 — no transposed-heightfield gaps to fall through.
    const N = this.N, size = this.size, H = this.heights;
    const idx = (i, j) => j * (N + 1) + i;

    const verts = new Float32Array((N + 1) * (N + 1) * 3);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const o = idx(i, j) * 3;
        verts[o] = (i / N - 0.5) * size;
        verts[o + 1] = H[idx(i, j)];
        verts[o + 2] = (j / N - 0.5) * size;
      }
    }
    const indices = new Uint32Array(N * N * 6);
    let p = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
        indices[p++] = a; indices[p++] = c; indices[p++] = b;   // same winding as the visual
        indices[p++] = b; indices[p++] = c; indices[p++] = d;
      }
    }

    const world = this.game.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(verts, indices)
      .setFriction(1.0)
      .setCollisionGroups(GROUPS.ground);
    const col = world.createCollider(desc, body);
    this.game.physics.registerCollider(col, { kind: 'ground' });
    this.bodies.push(body);

    this._buildBounds();
  }

  /** Invisible walls around the world edge so nothing can drive off the map. */
  _buildBounds() {
    const world = this.game.physics.world;
    const half = this.size / 2;
    const t = 4, h = 400;                 // thick, very tall
    const specs = [
      { x: 0, z: half + t, sx: this.size + t * 2, sz: t },
      { x: 0, z: -half - t, sx: this.size + t * 2, sz: t },
      { x: half + t, z: 0, sx: t, sz: this.size + t * 2 },
      { x: -half - t, z: 0, sx: t, sz: this.size + t * 2 },
    ];
    for (const s of specs) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(s.sx / 2, h / 2, s.sz / 2)
          .setTranslation(s.x, 0, s.z)
          .setCollisionGroups(GROUPS.obstacle),
        body,
      );
      this.game.physics.registerCollider(col, { kind: 'bounds' });
      this.bodies.push(body);
    }
  }

  _colorFor(x, z, h, slope) {
    const biome = BIOME[this.biomeAt(x, z)];
    const c = new THREE.Color();
    // base biome gradient by local height
    const t = smoothstep(0, 24, h);
    c.setHex(biome.flat).lerp(new THREE.Color(biome.hi), t * 0.6);
    // steep faces turn to rock
    const rockT = smoothstep(0.55, 0.95, slope);
    if (rockT > 0) c.lerp(new THREE.Color(PAL.rock), rockT * 0.8);
    // snow caps on the highest, flattish ground
    if (h > 34 && slope < 0.6) c.lerp(new THREE.Color(PAL.snow), smoothstep(34, 46, h) * 0.9);
    // subtle per-vertex grain
    const n = fbm(x * 0.1, z * 0.1, this.seed + 55, 2);
    c.offsetHSL(0, 0, (n - 0.5) * 0.05);
    return c;
  }

  _buildVisualTiles() {
    const N = this.N, size = this.size, tiles = this.tiles;
    const per = N / tiles;                 // cells per tile side
    const H = this.heights;
    const idx = (i, j) => j * (N + 1) + i;
    const worldX = (i) => (i / N - 0.5) * size;
    const worldZ = (j) => (j / N - 0.5) * size;

    // Flat shading gives the crisp low-poly faceted look.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.02, flatShading: true });
    this._groundMat = mat;

    for (let tj = 0; tj < tiles; tj++) {
      for (let ti = 0; ti < tiles; ti++) {
        const i0 = ti * per, j0 = tj * per;
        const i1 = i0 + per, j1 = j0 + per;
        const vcols = per + 1, vrows = per + 1;
        const positions = new Float32Array(vcols * vrows * 3);
        const colors = new Float32Array(vcols * vrows * 3);
        let p = 0;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x = worldX(i), z = worldZ(j), y = H[idx(i, j)];
            // central-difference slope
            const hl = H[idx(Math.max(0, i - 1), j)], hr = H[idx(Math.min(N, i + 1), j)];
            const hd = H[idx(i, Math.max(0, j - 1))], hu = H[idx(i, Math.min(N, j + 1))];
            const cellM = size / N;
            const slope = Math.min(1, (Math.abs(hr - hl) + Math.abs(hu - hd)) / (4 * cellM));
            positions[p * 3] = x; positions[p * 3 + 1] = y; positions[p * 3 + 2] = z;
            const col = this._colorFor(x, z, y, slope);
            colors[p * 3] = col.r; colors[p * 3 + 1] = col.g; colors[p * 3 + 2] = col.b;
            p++;
          }
        }
        const indices = [];
        for (let j = 0; j < per; j++) {
          for (let i = 0; i < per; i++) {
            const a = j * vcols + i, b = a + 1, c = a + vcols, d = c + 1;
            indices.push(a, c, b, b, c, d);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.name = `terrain.tile.${ti}.${tj}`;
        this.group.add(mesh);
      }
    }
  }

  // ---- props --------------------------------------------------------------

  _addStatic(desc, meta) {
    const world = this.game.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = world.createCollider(desc, body);
    this.game.physics.registerCollider(col, meta);
    this.bodies.push(body);
    return body;
  }

  /**
   * Pre-build a handful of prop templates once; scattering then clones them.
   * Clones share the template's (merged, flat-shaded) geometry, so hundreds of
   * trees and rocks cost only a dozen geometries.
   */
  _buildPropTemplates() {
    const tr = mulberry32(this.seed ^ 0x7ee5);
    this._tpl = { pine: [], leafy: [], dead: [], rock: [] };
    for (let i = 0; i < 4; i++) this._tpl.pine.push(buildTree(mulberry32(this.seed + i * 11 + 1), 1, 'pine'));
    for (let i = 0; i < 4; i++) this._tpl.leafy.push(buildTree(mulberry32(this.seed + i * 17 + 2), 1, 'leafy'));
    for (let i = 0; i < 3; i++) this._tpl.dead.push(buildTree(mulberry32(this.seed + i * 23 + 3), 1, 'dead'));
    for (let i = 0; i < 8; i++) this._tpl.rock.push(buildRock(mulberry32(this.seed + i * 29 + 4), 1));
    void tr;
  }

  _cloneTpl(list, rand) { return list[(rand() * list.length) | 0].clone(true); }

  _scatterProps() {
    this._buildPropTemplates();
    const rand = mulberry32(this.seed ^ 0x51ed);
    const halfEdge = this.size * 0.47;

    // --- rock formations (cloned templates, planted into the ground) ---
    for (let i = 0; i < 130; i++) {
      const x = (rand() - 0.5) * (this.size - 50);
      const z = (rand() - 0.5) * (this.size - 50);
      if (Math.hypot(x, z) < 22) continue;             // keep spawn clear
      if (Math.max(Math.abs(x), Math.abs(z)) > halfEdge) continue;
      const biome = this.biomeAt(x, z);
      if (biome === 'grassland' && rand() > 0.3) continue;
      const formation = (biome === 'rocky' || biome === 'mountains') && rand() > 0.6;
      const scale = (formation ? 2.6 : 1.2) + rand() * (formation ? 2.2 : 2.0);
      const y = this.heightAt(x, z);
      const rock = this._cloneTpl(this._tpl.rock, rand);
      rock.scale.setScalar(scale);
      rock.position.set(x, y - scale * 0.32, z);       // base sunk into the terrain
      rock.rotation.y = rand() * Math.PI * 2;
      this.group.add(rock);
      this._addStatic(
        RAPIER.ColliderDesc.ball(scale * 0.55).setTranslation(x, y + scale * 0.18, z)
          .setCollisionGroups(GROUPS.obstacle),
        { kind: 'rock' },
      );
    }

    // --- trees in the greener biomes; dead snags in the desert ---
    for (let i = 0; i < 180; i++) {
      const x = (rand() - 0.5) * (this.size - 50);
      const z = (rand() - 0.5) * (this.size - 50);
      if (Math.hypot(x, z) < 26) continue;
      if (Math.max(Math.abs(x), Math.abs(z)) > halfEdge) continue;
      const biome = this.biomeAt(x, z);
      const chance = biome === 'forest' ? 0.92 : biome === 'grassland' ? 0.85 : biome === 'hills' ? 0.55
        : biome === 'savanna' ? 0.3 : biome === 'desert' ? 0.12 : biome === 'tundra' ? 0.18 : 0.0;
      if (rand() > chance) continue;
      const y = this.heightAt(x, z);
      const scale = 1.2 + rand() * 1.3;
      const kind = (biome === 'desert' || biome === 'savanna') ? 'dead'
        : biome === 'tundra' ? 'pine'
        : (rand() > 0.45 ? 'pine' : 'leafy');
      const tree = this._cloneTpl(this._tpl[kind], rand);
      tree.scale.setScalar(scale);
      tree.position.set(x, y - 0.2, z);                // root into the ground
      tree.rotation.y = rand() * Math.PI * 2;
      this.group.add(tree);
      this._addStatic(
        RAPIER.ColliderDesc.cylinder(1.3 * scale, 0.28 * scale).setTranslation(x, y + 1.3 * scale, z)
          .setCollisionGroups(GROUPS.obstacle),
        { kind: 'tree' },
      );
    }

    // --- scattered abandoned wrecks (atmosphere + navigation) ---
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2, d = 50 + rand() * (this.size * 0.3);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.max(Math.abs(x), Math.abs(z)) > this.size * 0.45) continue;
      this._wreck(x, z, rand);
    }
  }

  _wreck(x, z, rand) {
    const y = this.heightAt(x, z);
    const b = new PartBuilder();
    b.add(PRIMS.box, PAL.rust, { pos: [0, 0.4, 0], scale: [2.2, 0.8, 3.0], rot: [0, rand() * 0.6, 0.12] });
    b.add(PRIMS.box, PAL.steelDark, { pos: [0.3, 1.0, -0.6], scale: [1.4, 0.9, 1.2] });
    b.add(PRIMS.cyl12, PAL.rubber, { pos: [-1.1, 0.3, 1.0], rot: [0, 0, Math.PI / 2], scale: [0.7, 0.3, 0.7] });
    b.add(PRIMS.cyl12, PAL.rubber, { pos: [1.1, 0.25, -1.0], rot: [0.3, 0, Math.PI / 2], scale: [0.6, 0.3, 0.6] });
    const mesh = new THREE.Mesh(b.bake(), MATERIALS.block);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this._addStatic(
      RAPIER.ColliderDesc.cuboid(1.3, 0.6, 1.7).setTranslation(x, y + 0.6, z)
        .setRotation(quatY(mesh.rotation.y)).setCollisionGroups(GROUPS.obstacle),
      { kind: 'wreck' },
    );
    this.landmarks.push({ x, z, color: PAL.rust, kind: 'wreck' });
  }

  _placeLandmarks() {
    // low stone monuments with a glowing beacon crystal — navigation waypoints
    const colors = [PAL.accent, PAL.blue, PAL.green, PAL.red];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const d = this.size * 0.3;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = this.heightAt(x, z);
      const mon = buildMonument(colors[i]);
      mon.position.set(x, y - 0.2, z);          // base beds into the ground
      this.group.add(mon);
      this._addStatic(
        RAPIER.ColliderDesc.cuboid(1.3, 1.0, 1.3).setTranslation(x, y + 0.8, z).setCollisionGroups(GROUPS.obstacle),
        { kind: 'monument' },
      );
      this.landmarks.push({ x, z, color: colors[i], kind: 'beacon' });
    }
  }

  // ---- queries ------------------------------------------------------------

  /** Exact bilinear height of the terrain surface at world (x,z). */
  heightAt(x, z) {
    const N = this.N, size = this.size, H = this.heights;
    if (!H) return this.groundY;
    const gx = (x / size + 0.5) * N;
    const gz = (z / size + 0.5) * N;
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(gx)));
    const j0 = Math.max(0, Math.min(N - 1, Math.floor(gz)));
    const fx = Math.max(0, Math.min(1, gx - i0));
    const fz = Math.max(0, Math.min(1, gz - j0));
    const idx = (i, j) => j * (N + 1) + i;
    const h00 = H[idx(i0, j0)], h10 = H[idx(i0 + 1, j0)];
    const h01 = H[idx(i0, j0 + 1)], h11 = H[idx(i0 + 1, j0 + 1)];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /** A safe, roughly flat spot near (x,z) for spawning, returns {x,y,z}. */
  findFlatSpot(cx, cz, radius = 40, tries = 12) {
    const rand = mulberry32((this.seed ^ (cx | 0) ^ ((cz | 0) << 8)) >>> 0);
    let best = null;
    for (let t = 0; t < tries; t++) {
      const a = rand() * Math.PI * 2, d = 12 + rand() * radius;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (Math.max(Math.abs(x), Math.abs(z)) > this.size * 0.44) continue;
      const h = this.heightAt(x, z);
      const slope = Math.abs(h - this.heightAt(x + 2, z)) + Math.abs(h - this.heightAt(x, z + 2));
      if (!best || slope < best.slope) best = { x, y: h, z, slope };
      if (slope < 0.6) break;
    }
    return best || { x: cx, y: this.heightAt(cx, cz), z: cz, slope: 0 };
  }

  dispose() {
    for (const b of this.bodies) this.game.physics.removeBody(b);
    this.bodies.length = 0;
    this.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    if (this._groundMat) this._groundMat.dispose();
    this.group.removeFromParent();
  }
}

function quatY(yaw) {
  const h = yaw / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}
