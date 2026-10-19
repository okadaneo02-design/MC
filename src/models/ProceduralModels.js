import * as THREE from 'three';

/**
 * All art in MACHINECRAFT is generated here at runtime. No external assets.
 *
 * Strategy for performance: every block type is baked ONCE into a single merged,
 * vertex-coloured BufferGeometry (per detail level) so an entire block renders in
 * one draw call with one shared material. Parts that genuinely need a different
 * material (glass, emissive lights) are emitted as a small number of extra meshes.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
export const PAL = {
  steelDark:   0x39424c,
  steel:       0x5c6773,
  steelLight:  0x808d99,
  steelPale:   0xa3afba,
  iron:        0x4a525c,
  rust:        0x7a4a2c,
  accent:      0xffa41f,
  accentDeep:  0xc4760c,
  hazard:      0xf0c419,
  rubber:      0x1b1d21,
  rubberWorn:  0x2a2d33,
  copper:      0xb5703c,
  blue:        0x2f7fd0,
  blueDeep:    0x1d4f86,
  red:         0xc0392b,
  green:       0x3f9b5a,
  purple:      0x7d5ac4,
  bone:        0xc9c2b0,
  sand:        0xe8c86a,
  grass:       0x63bd43,
  rock:        0x8b9199,
  snow:        0xecf3fa,
};

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------
const matCache = new Map();
function makeMat(key, params) {
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(params); matCache.set(key, m); }
  return m;
}

export const MATERIALS = {
  get block() {
    return makeMat('block', {
      vertexColors: true, metalness: 0.38, roughness: 0.56, flatShading: false,
    });
  },
  /** Damage tint buckets — shared, so damaged blocks still batch. */
  damage(bucket) {
    const tints = [0xffffff, 0xe8d2c6, 0xd2a391, 0xb86f5c];
    return makeMat('block.dmg' + bucket, {
      vertexColors: true, metalness: 0.38, roughness: 0.60,
      color: new THREE.Color(tints[bucket]),
    });
  },
  get glass() {
    return makeMat('glass', {
      color: 0x6fc0ff, metalness: 0.2, roughness: 0.08,
      transparent: true, opacity: 0.42, envMapIntensity: 1.2,
    });
  },
  /** Flat-shaded vertex-coloured material for the crisp low-poly props (rocks, trees). */
  get flat() {
    return makeMat('flat', {
      vertexColors: true, metalness: 0.04, roughness: 0.92, flatShading: true,
    });
  },
  emissive(hex) {
    return makeMat('emi' + hex, {
      color: hex, emissive: hex, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0,
    });
  },
  get ghostOk() {
    return makeMat('ghostOk', {
      color: 0x51d98a, transparent: true, opacity: 0.45, depthWrite: false,
      emissive: 0x1d6b3f, emissiveIntensity: 0.6,
    });
  },
  get ghostBad() {
    return makeMat('ghostBad', {
      color: 0xff5a4d, transparent: true, opacity: 0.4, depthWrite: false,
      emissive: 0x6b1d18, emissiveIntensity: 0.6,
    });
  },
  get highlight() {
    return makeMat('hl', {
      color: 0xffc14d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    });
  },
};

export function disposeSharedMaterials() {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}

// ---------------------------------------------------------------------------
// Geometry merge helper
// ---------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _col = new THREE.Color();

/** Accumulates transformed, coloured primitives and bakes them into one geometry. */
export class PartBuilder {
  constructor() { this.parts = []; this.extras = []; }

  /**
   * @param {THREE.BufferGeometry} geom source primitive (never mutated)
   * @param {number} colorHex sRGB hex
   * @param {object} t {pos:[x,y,z], rot:[rx,ry,rz] radians, scale:[x,y,z]|number}
   */
  add(geom, colorHex, t = {}) {
    const pos = t.pos || [0, 0, 0];
    const rot = t.rot || [0, 0, 0];
    let s = t.scale ?? 1;
    if (typeof s === 'number') s = [s, s, s];
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(pos[0], pos[1], pos[2]), _q, new THREE.Vector3(s[0], s[1], s[2]));
    this.parts.push({ geom, color: colorHex, matrix: _m4.clone() });
    return this;
  }

  /** A part that must keep its own material (glass, glow). Returned as a separate mesh. */
  addExtra(geom, material, t = {}) {
    const pos = t.pos || [0, 0, 0];
    const rot = t.rot || [0, 0, 0];
    let s = t.scale ?? 1;
    if (typeof s === 'number') s = [s, s, s];
    this.extras.push({ geom, material, pos, rot, scale: s, name: t.name });
    return this;
  }

  /** Bake accumulated parts into a single non-indexed vertex-coloured geometry. */
  bake() {
    let total = 0;
    const baked = this.parts.map((p) => {
      const g = p.geom.index ? p.geom.toNonIndexed() : p.geom.clone();
      g.applyMatrix4(p.matrix);
      total += g.attributes.position.count;
      return { g, color: p.color };
    });

    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    let off = 0;
    for (const { g, color: hex } of baked) {
      const pa = g.attributes.position.array;
      const na = g.attributes.normal ? g.attributes.normal.array : null;
      const n = g.attributes.position.count;
      position.set(pa, off * 3);
      if (na) normal.set(na, off * 3);
      _col.setHex(hex);
      for (let i = 0; i < n; i++) {
        color[(off + i) * 3 + 0] = _col.r;
        color[(off + i) * 3 + 1] = _col.g;
        color[(off + i) * 3 + 2] = _col.b;
      }
      off += n;
      g.dispose();
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(position, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    out.setAttribute('color', new THREE.BufferAttribute(color, 3));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }

  /** Build a Group: one merged mesh + any extras. Pass a material to override MATERIALS.block. */
  toGroup(name = 'part', material = null) {
    const group = new THREE.Group();
    group.name = name;
    if (this.parts.length) {
      const mesh = new THREE.Mesh(this.bake(), material || MATERIALS.block);
      mesh.name = name + '.body';
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const ex of this.extras) {
      const m = new THREE.Mesh(ex.geom, ex.material);
      m.position.set(ex.pos[0], ex.pos[1], ex.pos[2]);
      m.rotation.set(ex.rot[0], ex.rot[1], ex.rot[2]);
      m.scale.set(ex.scale[0], ex.scale[1], ex.scale[2]);
      m.castShadow = false; m.receiveShadow = false;
      if (ex.name) m.name = ex.name;
      group.add(m);
    }
    return group;
  }
}

// ---------------------------------------------------------------------------
// Shared primitives (never mutated; PartBuilder clones)
// ---------------------------------------------------------------------------
const P = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cyl20: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  cone12: new THREE.ConeGeometry(0.5, 1, 12),
  sph: new THREE.SphereGeometry(0.5, 10, 7),
  sphLo: new THREE.SphereGeometry(0.5, 7, 5),
  torus: new THREE.TorusGeometry(0.5, 0.16, 8, 18),
  ico: new THREE.IcosahedronGeometry(0.5, 0),     // 20-face low-poly blob (rocks, foliage)
  ico1: new THREE.IcosahedronGeometry(0.5, 1),    // 80-face, slightly rounder
  cone6: new THREE.ConeGeometry(0.5, 1, 6),       // chunky low-poly cone (pine tiers)
};
export const PRIMS = P;

const HALF = Math.PI / 2;

// ---------------------------------------------------------------------------
// Reusable detail helpers
// ---------------------------------------------------------------------------

/** Twelve edge beams + eight corner nubs = the signature MACHINECRAFT frame. */
function frameCube(b, size, beam, beamColor, cornerColor) {
  const h = size / 2;
  const len = size;
  // edges along X
  for (const y of [-h, h]) for (const z of [-h, h]) {
    b.add(P.box, beamColor, { pos: [0, y, z], scale: [len, beam, beam] });
  }
  // edges along Y
  for (const x of [-h, h]) for (const z of [-h, h]) {
    b.add(P.box, beamColor, { pos: [x, 0, z], scale: [beam, len, beam] });
  }
  // edges along Z
  for (const x of [-h, h]) for (const y of [-h, h]) {
    b.add(P.box, beamColor, { pos: [x, y, 0], scale: [beam, beam, len] });
  }
  // corner nubs
  const c = beam * 1.28;
  for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) {
    b.add(P.box, cornerColor, { pos: [x, y, z], scale: c });
  }
}

/** Bolt heads on a face. axis: 'x'|'y'|'z', sign ±1 */
function bolts(b, axis, sign, offset, inset, color, r = 0.035, h = 0.035) {
  const rot = axis === 'y' ? [0, 0, 0] : axis === 'x' ? [0, 0, HALF] : [HALF, 0, 0];
  for (const a of [-inset, inset]) for (const c of [-inset, inset]) {
    const pos = axis === 'y' ? [a, sign * offset, c]
      : axis === 'x' ? [sign * offset, a, c]
        : [a, c, sign * offset];
    b.add(P.cyl8, color, { pos, rot, scale: [r * 2, h, r * 2] });
  }
}

/** Parallel cooling fins across the local X axis. */
function vents(b, count, pos, size, color, axis = 'z') {
  const [w, hh, d] = size;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1) - 0.5);
    const p = [...pos];
    if (axis === 'z') p[1] += t * hh;
    else p[0] += t * w;
    b.add(P.box, color, {
      pos: p,
      scale: axis === 'z' ? [w, hh / (count * 2.2), d] : [w / (count * 2.2), hh, d],
    });
  }
}

// ---------------------------------------------------------------------------
// Block model builders. Each returns a THREE.Group.
// `detail` 0 = low, 1 = medium, 2 = high.
// ---------------------------------------------------------------------------

export function buildStructural(detail = 1, tint = PAL.steel) {
  const b = new PartBuilder();
  b.add(P.box, tint, { scale: 0.74 });                       // core
  frameCube(b, 0.88, 0.12, PAL.steelDark, PAL.iron);
  // recessed face panels
  for (const [ax, sg] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
    const pos = ax === 'x' ? [sg * 0.40, 0, 0] : [0, 0, sg * 0.40];
    const sc = ax === 'x' ? [0.06, 0.62, 0.62] : [0.62, 0.62, 0.06];
    b.add(P.box, PAL.steelLight, { pos, scale: sc });
  }
  b.add(P.box, PAL.steelLight, { pos: [0, 0.40, 0], scale: [0.62, 0.06, 0.62] });
  b.add(P.box, PAL.steelDark, { pos: [0, -0.40, 0], scale: [0.62, 0.06, 0.62] });
  // chamfered corner cubes soften the silhouette
  for (const x of [-0.4, 0.4]) for (const y of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) {
    b.add(P.box, PAL.steel, { pos: [x, y, z], rot: [0.5, 0.5, 0], scale: 0.12 });
  }
  // accent trim stripe wrapping the waist
  b.add(P.box, PAL.accentDeep, { pos: [0, 0.12, 0.455], scale: [0.5, 0.05, 0.02] });
  b.add(P.box, PAL.accentDeep, { pos: [0, 0.12, -0.455], scale: [0.5, 0.05, 0.02] });
  // recessed inner panel squares for depth
  for (const [ax, sg] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
    const pos = ax === 'x' ? [sg * 0.44, -0.05, 0] : [0, -0.05, sg * 0.44];
    const sc = ax === 'x' ? [0.03, 0.34, 0.34] : [0.34, 0.34, 0.03];
    b.add(P.box, PAL.iron, { pos, scale: sc });
  }
  if (detail >= 1) {
    bolts(b, 'y', 1, 0.455, 0.30, PAL.steelPale);
    bolts(b, 'z', 1, 0.455, 0.30, PAL.steelPale);
  }
  if (detail >= 2) {
    bolts(b, 'z', -1, 0.455, 0.30, PAL.steelPale);
    bolts(b, 'x', 1, 0.455, 0.30, PAL.steelPale);
    bolts(b, 'x', -1, 0.455, 0.30, PAL.steelPale);
    b.add(P.box, PAL.accentDeep, { pos: [0, 0.44, 0], scale: [0.5, 0.02, 0.09] });
  }
  return b.toGroup('structural');
}

export function buildArmor(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.iron, { scale: 0.88 });
  // chamfer illusion: shrunken plate on every face
  for (const [p, s] of [
    [[0, 0.45, 0], [0.80, 0.08, 0.80]], [[0, -0.45, 0], [0.80, 0.08, 0.80]],
    [[0.45, 0, 0], [0.08, 0.80, 0.80]], [[-0.45, 0, 0], [0.08, 0.80, 0.80]],
    [[0, 0, 0.45], [0.80, 0.80, 0.08]], [[0, 0, -0.45], [0.80, 0.80, 0.08]],
  ]) b.add(P.box, PAL.steelDark, { pos: p, scale: s });
  // corner reinforcement wedges
  for (const x of [-0.42, 0.42]) for (const y of [-0.42, 0.42]) for (const z of [-0.42, 0.42]) {
    b.add(P.box, PAL.steel, { pos: [x, y, z], scale: 0.18 });
  }
  // diagonal rib across the front plate
  b.add(P.box, PAL.steelLight, { pos: [0, 0, 0.47], rot: [0, 0, Math.PI / 4], scale: [0.86, 0.11, 0.05] });
  b.add(P.box, PAL.hazard, { pos: [0, 0.34, 0.49], scale: [0.66, 0.07, 0.03] });
  if (detail >= 1) {
    bolts(b, 'z', 1, 0.50, 0.33, PAL.steelPale, 0.045, 0.045);
    bolts(b, 'y', 1, 0.50, 0.33, PAL.steelPale, 0.045, 0.045);
  }
  if (detail >= 2) {
    bolts(b, 'z', -1, 0.50, 0.33, PAL.steelPale, 0.045, 0.045);
    bolts(b, 'x', 1, 0.50, 0.33, PAL.steelPale, 0.045, 0.045);
    bolts(b, 'x', -1, 0.50, 0.33, PAL.steelPale, 0.045, 0.045);
  }
  return b.toGroup('armor');
}

/** Controller cab. +Z is the vehicle's forward direction. */
export function buildCab(detail = 1, accent = PAL.accent) {
  const b = new PartBuilder();
  // --- chassis: a bright two-tone body with a chamfered nose ---
  b.add(P.box, PAL.steelLight, { pos: [0, -0.16, -0.02], scale: [0.9, 0.56, 0.9] });     // main body
  b.add(P.box, accent, { pos: [0, -0.3, 0.0], scale: [0.94, 0.18, 0.94] });              // painted skirt band (takes paint)
  b.add(P.box, PAL.steel, { pos: [0, 0.02, 0.40], rot: [0.66, 0, 0], scale: [0.82, 0.12, 0.40] }); // sloped hood
  // --- cockpit tub (open so the seat reads) ---
  b.add(P.box, PAL.steelDark, { pos: [0, 0.14, -0.1], scale: [0.78, 0.10, 0.74] });      // cockpit floor
  // driver seat
  b.add(P.box, 0x2a2e34, { pos: [0, 0.26, -0.26], scale: [0.26, 0.26, 0.2] });           // seat back
  b.add(P.box, 0x2a2e34, { pos: [0, 0.16, -0.14], scale: [0.26, 0.1, 0.24] });           // seat base
  // steering column + wheel
  b.add(P.cyl8, PAL.steelDark, { pos: [0, 0.2, 0.02], rot: [0.5, 0, 0], scale: [0.03, 0.28, 0.03] });
  b.add(P.torus, 0x1c1f24, { pos: [0, 0.3, 0.1], rot: [0.5, 0, 0], scale: [0.14, 0.14, 0.14] }); // wheel
  // --- wrap-around canopy: A-pillars + a big glass bubble ---
  for (const sx of [-1, 1]) {
    b.add(P.cyl8, PAL.steelLight, { pos: [sx * 0.4, 0.3, 0.32], rot: [-0.5, 0, 0], scale: [0.05, 0.6, 0.05] }); // front A-pillar
    b.add(P.cyl8, PAL.steelLight, { pos: [sx * 0.42, 0.34, -0.36], scale: [0.05, 0.62, 0.05] });                // rear pillar
    b.addExtra(new THREE.BoxGeometry(0.03, 0.3, 0.42), MATERIALS.glass, { pos: [sx * 0.4, 0.34, -0.04], name: 'cab.sidewin' });
  }
  b.addExtra(new THREE.BoxGeometry(0.72, 0.42, 0.03), MATERIALS.glass, { pos: [0, 0.3, 0.3], rot: [-0.5, 0, 0], name: 'cab.glass' }); // windshield
  b.addExtra(new THREE.BoxGeometry(0.72, 0.03, 0.5), MATERIALS.glass, { pos: [0, 0.52, -0.04], name: 'cab.glasstop' });              // glass roof
  // --- roof cap + light bar ---
  b.add(P.box, accent, { pos: [0, 0.56, -0.3], scale: [0.72, 0.08, 0.28] });             // rear roof cap (painted)
  b.add(P.box, PAL.steelDark, { pos: [0, 0.57, 0.18], scale: [0.5, 0.06, 0.1] });        // light bar housing
  b.addExtra(new THREE.BoxGeometry(0.44, 0.04, 0.05), MATERIALS.emissive(0xffd27a), { pos: [0, 0.58, 0.225], name: 'cab.lightbar' });
  // --- front: grille, bumper, headlamps ---
  b.add(P.box, PAL.steelDark, { pos: [0, -0.34, 0.45], scale: [0.86, 0.18, 0.1] });      // bumper
  b.add(P.box, PAL.hazard, { pos: [0, -0.34, 0.5], scale: [0.6, 0.06, 0.03] });          // hazard stripe
  for (const sx of [-0.28, 0.28]) {
    b.add(P.cyl12, PAL.steelDark, { pos: [sx, -0.12, 0.46], rot: [HALF, 0, 0], scale: [0.14, 0.05, 0.14] });   // bezel
    b.addExtra(new THREE.SphereGeometry(0.06, 8, 6), MATERIALS.emissive(0xfff0c0), { pos: [sx, -0.12, 0.49] }); // lamp
  }
  // --- rear: vent stack + status beacon ---
  vents(b, 4, [0, 0.0, -0.46], [0.6, 0.34, 0.05], PAL.steelDark, 'z');
  b.addExtra(new THREE.SphereGeometry(0.045, 8, 6), MATERIALS.emissive(0x5fd07a), { pos: [0, 0.62, -0.3], name: 'cab.beacon' });
  if (detail >= 1) {
    bolts(b, 'y', -1, 0.44, 0.36, PAL.steelPale);
    b.add(P.cyl8, PAL.steelPale, { pos: [0.34, 0.44, -0.38], scale: [0.03, 0.18, 0.03] });                       // antenna
    b.addExtra(new THREE.SphereGeometry(0.03, 6, 5), MATERIALS.emissive(0xff5a4d), { pos: [0.34, 0.55, -0.38] }); // antenna tip
  }
  return b.toGroup('cab');
}

/** Base Combustion Engine: an upright INLINE-4 crowned by a round air filter. */
export function buildEngine(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.18, 0], scale: [0.86, 0.42, 0.9] });        // crankcase/oil pan
  b.add(P.box, PAL.steel, { pos: [0, 0.08, 0], scale: [0.5, 0.22, 0.86] });              // block
  // four cylinders in a row along Z
  for (const z of [-0.3, -0.1, 0.1, 0.3]) {
    b.add(P.cyl12, PAL.steelLight, { pos: [0, 0.26, z], scale: [0.17, 0.3, 0.17] });
    b.add(P.cyl12, PAL.iron, { pos: [0, 0.42, z], scale: [0.2, 0.05, 0.2] });            // head bolts ring
  }
  b.add(P.box, PAL.steel, { pos: [0, 0.42, 0], scale: [0.38, 0.1, 0.84] });              // valve cover
  // round air filter on a central intake
  b.add(P.cyl12, PAL.steelDark, { pos: [0, 0.52, 0], scale: [0.18, 0.1, 0.18] });
  b.add(P.cyl20, PAL.copper, { pos: [0, 0.62, 0], scale: [0.44, 0.12, 0.44] });          // filter housing
  b.add(P.cyl20, PAL.steelPale, { pos: [0, 0.69, 0], scale: [0.38, 0.04, 0.38] });
  // 4-into-1 exhaust header down the +X side
  for (const z of [-0.3, -0.1, 0.1, 0.3]) {
    b.add(P.cyl8, PAL.rust, { pos: [0.3, 0.1, z], rot: [0, 0, 0.9], scale: [0.08, 0.4, 0.08] });
  }
  b.add(P.cyl8, PAL.rust, { pos: [0.42, -0.1, 0], rot: [HALF, 0, 0], scale: [0.12, 0.8, 0.12] });
  b.add(P.box, PAL.accentDeep, { pos: [0, -0.37, 0], scale: [0.9, 0.08, 0.94] });
  b.addExtra(new THREE.SphereGeometry(0.05, 8, 6), MATERIALS.emissive(0xffa41f), { pos: [-0.3, 0.3, 0.4], name: 'engine.light' });
  if (detail >= 1) bolts(b, 'y', -1, 0.4, 0.32, PAL.steelPale);
  return b.toGroup('engine');
}

/**
 * Wheel. Axle runs along LOCAL X; the wheel rolls about +X so the vehicle
 * travels along local Z. The hub face that bolts onto the hull is local -X.
 *
 * Returns a group with two named children so the renderer can spin the tyre
 * without spinning the mount:
 *   - `wheel.spin`  — tyre, rim, hub, spokes, lugs (rotates with road speed)
 *   - `wheel.mount` — suspension strut + hub carrier bridging hull to wheel (steers only)
 */
export function buildWheel(detail = 1, radius = 0.45, width = 0.32) {
  const group = new THREE.Group();
  group.name = 'wheel';

  // -------- spinning parts --------
  const sb = new PartBuilder();
  const segs = detail >= 2 ? 24 : detail >= 1 ? 16 : 10;
  const tyre = new THREE.CylinderGeometry(radius, radius, width, segs);
  const inner = new THREE.CylinderGeometry(radius * 0.66, radius * 0.66, width * 1.04, segs);
  sb.add(tyre, PAL.rubber, { rot: [0, 0, HALF] });
  sb.add(inner, PAL.steelDark, { rot: [0, 0, HALF] });
  sb.add(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.52, segs),
    PAL.steelLight, { rot: [0, 0, HALF] });
  sb.add(P.cyl12, PAL.steel, { pos: [width * 0.30, 0, 0], rot: [0, 0, HALF], scale: [radius * 0.34, width * 0.34, radius * 0.34] });
  sb.add(P.cyl12, PAL.accent, { pos: [width * 0.42, 0, 0], rot: [0, 0, HALF], scale: [radius * 0.17, width * 0.22, radius * 0.17] });
  const spokes = detail >= 1 ? 6 : 4;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    sb.add(P.box, PAL.steelPale, {
      pos: [width * 0.18, Math.sin(a) * radius * 0.40, Math.cos(a) * radius * 0.40],
      rot: [-a, 0, 0], scale: [width * 0.18, radius * 0.08, radius * 0.56],
    });
  }
  const lugs = detail >= 2 ? 20 : detail >= 1 ? 14 : 8;
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    sb.add(P.box, PAL.rubberWorn, {
      pos: [((i % 2) ? 1 : -1) * width * 0.22, Math.sin(a) * radius * 0.97, Math.cos(a) * radius * 0.97],
      rot: [-a, 0, 0], scale: [width * 0.42, radius * 0.14, radius * 0.17],
    });
  }
  if (detail >= 1) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      sb.add(P.cyl8, PAL.steelPale, {
        pos: [width * 0.40, Math.sin(a) * radius * 0.24, Math.cos(a) * radius * 0.24],
        rot: [0, 0, HALF], scale: [0.05, width * 0.12, 0.05],
      });
    }
  }
  const spin = sb.toGroup('wheel.spin');
  group.add(spin);
  tyre.dispose(); inner.dispose();

  // -------- hub carrier (moves with suspension, does NOT spin) --------
  const cb = new PartBuilder();
  cb.add(P.cyl12, PAL.steelDark, { pos: [-width * 0.08, 0, 0], rot: [0, 0, HALF], scale: [radius * 0.5, width * 0.3, radius * 0.5] });
  // short strut stub reaching inboard toward the hull mount
  cb.add(P.box, PAL.steel, { pos: [-0.24, 0.02, 0], scale: [0.3, 0.15, 0.15] });
  const carrier = cb.toGroup('wheel.carrier');
  group.add(carrier);

  // -------- hull mounting plate (stays bolted to the chassis; no suspension) --------
  const hbld = new PartBuilder();
  hbld.add(P.box, PAL.iron, { pos: [-0.45, 0, 0], scale: [0.1, 0.5, 0.5] });
  hbld.add(P.box, PAL.accentDeep, { pos: [-0.45, 0, 0], scale: [0.105, 0.16, 0.16] });
  // a telescoping sleeve that visually bridges to the carrier
  hbld.add(P.cyl8, PAL.steelLight, { pos: [-0.3, 0, 0], rot: [0, 0, HALF], scale: [0.12, 0.34, 0.12] });
  if (detail >= 1) {
    for (const yz of [[0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]]) {
      hbld.add(P.cyl8, PAL.steelPale, { pos: [-0.47, yz[0], yz[1]], rot: [0, 0, HALF], scale: [0.05, 0.06, 0.05] });
    }
  }
  const hull = hbld.toGroup('wheel.hull');
  group.add(hull);

  return group;
}

/**
 * Thin armour plate that lies FLAT against the block it mounts to. The mount
 * face is local -Y, so the plate hugs the bottom of its cell; auto-orientation
 * swings that face toward whatever you click.
 */
export function buildArmorPlate(detail = 1) {
  const b = new PartBuilder();
  const yc = -0.40;             // plate centre, hugging the mount face at y = -0.5
  b.add(P.box, PAL.iron, { pos: [0, yc, 0], scale: [0.94, 0.17, 0.94] });
  b.add(P.box, PAL.steelDark, { pos: [0, yc + 0.095, 0], scale: [0.9, 0.04, 0.9] });   // top skin
  // angled deflector lip along +Z
  b.add(P.box, PAL.steel, { pos: [0, yc + 0.06, 0.40], rot: [-0.5, 0, 0], scale: [0.9, 0.14, 0.12] });
  // reinforcement ribs
  for (const x of [-0.28, 0, 0.28]) b.add(P.box, PAL.steelLight, { pos: [x, yc + 0.07, -0.05], scale: [0.07, 0.05, 0.74] });
  b.add(P.box, PAL.hazard, { pos: [0, yc + 0.095, -0.40], scale: [0.6, 0.02, 0.07] });
  if (detail >= 1) {
    for (const x of [-0.36, 0.36]) for (const z of [-0.36, 0.36]) {
      b.add(P.cyl8, PAL.steelPale, { pos: [x, yc + 0.085, z], scale: [0.07, 0.05, 0.07] });
    }
  }
  return b.toGroup('armor_plate');
}

/**
 * Turret: a ring base (rigid with the hull) and a rotating head carrying a
 * barrel. Head is a separate named child `turret.head` so the aim animation can
 * yaw/pitch it; the barrel muzzle sits at local (0, h, +Z) within the head.
 */
export function buildTurret(detail = 1, accent = PAL.accent) {
  const group = new THREE.Group();
  group.name = 'turret';

  // ---- base ----
  const bb = new PartBuilder();
  bb.add(P.box, PAL.steelDark, { pos: [0, -0.34, 0], scale: [0.9, 0.3, 0.9] });
  bb.add(P.cyl12, PAL.steel, { pos: [0, -0.12, 0], scale: [0.74, 0.22, 0.74] });        // turntable ring
  bb.add(P.cyl12, PAL.iron, { pos: [0, -0.02, 0], scale: [0.5, 0.12, 0.5] });
  if (detail >= 1) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      bb.add(P.cyl8, PAL.steelPale, { pos: [Math.cos(a) * 0.34, -0.1, Math.sin(a) * 0.34], scale: [0.05, 0.22, 0.05] });
    }
  }
  const base = bb.toGroup('turret.base');
  group.add(base);

  // ---- rotating head ----
  const hb = new PartBuilder();
  hb.add(P.box, accent === PAL.red ? PAL.steelDark : PAL.steel, { pos: [0, 0.14, -0.08], scale: [0.6, 0.34, 0.5] });  // body
  hb.add(P.box, PAL.steelLight, { pos: [0, 0.3, -0.08], scale: [0.5, 0.08, 0.44] });     // top plate
  for (const sx of [-1, 1]) hb.add(P.box, accent, { pos: [sx * 0.31, 0.14, -0.08], scale: [0.04, 0.2, 0.4] });
  // barrel pointing +Z
  hb.add(P.cyl12, PAL.steelDark, { pos: [0, 0.12, 0.28], rot: [HALF, 0, 0], scale: [0.14, 0.5, 0.14] });
  hb.add(P.cyl12, PAL.iron, { pos: [0, 0.12, 0.52], rot: [HALF, 0, 0], scale: [0.17, 0.22, 0.17] });   // muzzle brake
  hb.addExtra(new THREE.SphereGeometry(0.04, 8, 6), MATERIALS.emissive(0xff6a4a), { pos: [0, 0.3, -0.2], name: 'turret.eye' });
  if (detail >= 1) {
    hb.add(P.box, PAL.steelDark, { pos: [0, 0.12, -0.3], scale: [0.4, 0.26, 0.14] });    // counterweight
  }
  const head = hb.toGroup('turret.head');
  head.position.y = 0.04;
  group.add(head);

  return group;
}

/** Fixed forward-firing cannon. Barrel points +Z; muzzle at local (0,0,+0.55). */
export function buildCannon(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.1, -0.1], scale: [0.62, 0.5, 0.66] });   // breech
  b.add(P.box, PAL.steel, { pos: [0, 0.16, -0.1], scale: [0.5, 0.2, 0.54] });
  b.add(P.cyl12, PAL.iron, { pos: [0, 0, 0.18], rot: [HALF, 0, 0], scale: [0.2, 0.7, 0.2] });   // barrel
  b.add(P.cyl12, PAL.steelDark, { pos: [0, 0, 0.5], rot: [HALF, 0, 0], scale: [0.24, 0.16, 0.24] });  // muzzle
  b.add(P.box, PAL.accentDeep, { pos: [0, -0.32, -0.1], scale: [0.64, 0.08, 0.68] });
  b.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0xffb020), { pos: [0.22, 0.2, -0.28] });
  if (detail >= 1) {
    for (const z of [-0.05, 0.08, 0.21]) b.add(P.cyl12, PAL.steelLight, { pos: [0, 0, z], rot: [HALF, 0, 0], scale: [0.24, 0.03, 0.24] });  // barrel rings
  }
  return b.toGroup('cannon');
}

// ---------------------------------------------------------------------------
// Mechanical blocks. Each returns a group with a `*.moving` child that the
// joint drives, plus a static base. Base face is local -Y; output face +Y.
// ---------------------------------------------------------------------------

function mechBase(b, color = PAL.steelDark) {
  b.add(P.box, color, { pos: [0, -0.34, 0], scale: [0.9, 0.3, 0.9] });
  b.add(P.box, PAL.iron, { pos: [0, -0.48, 0], scale: [0.78, 0.06, 0.78] });
}

export function buildHinge(detail = 1) {
  const group = new THREE.Group(); group.name = 'hinge';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  // fixed bracket cheeks around the pin (pin along X)
  for (const sx of [-1, 1]) bb.add(P.box, PAL.steel, { pos: [sx * 0.34, 0.02, 0], scale: [0.16, 0.5, 0.42] });
  bb.add(P.cyl12, PAL.steelPale, { pos: [0, 0.05, 0], rot: [0, 0, HALF], scale: [0.14, 0.86, 0.14] });   // pin
  group.add(bb.toGroup('hinge.base'));

  const mb = new PartBuilder();
  mb.add(P.box, PAL.steel, { pos: [0, 0.3, 0], scale: [0.5, 0.4, 0.4] });            // swinging arm
  mb.add(P.box, PAL.steelLight, { pos: [0, 0.5, 0], scale: [0.86, 0.1, 0.5] });       // output plate
  mb.add(P.cyl12, PAL.accent, { pos: [0, 0.08, 0], rot: [0, 0, HALF], scale: [0.1, 0.52, 0.1] });
  const m = mb.toGroup('hinge.moving');
  group.add(m);
  return group;
}

export function buildServo(detail = 1) {
  const group = new THREE.Group(); group.name = 'servo';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.box, PAL.steel, { pos: [0, -0.06, 0], scale: [0.78, 0.4, 0.78] });        // motor housing
  vents(bb, 4, [0, -0.06, 0.4], [0.5, 0.3, 0.04], PAL.steelLight, 'z');
  bb.add(P.box, PAL.accentDeep, { pos: [0, -0.06, -0.4], scale: [0.5, 0.3, 0.04] });
  bb.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0x39c2ff), { pos: [0.3, 0.12, 0.3], name: 'servo.led' });
  group.add(bb.toGroup('servo.base'));

  const mb = new PartBuilder();
  mb.add(P.cyl12, PAL.steelLight, { pos: [0, 0.2, 0], scale: [0.6, 0.12, 0.6] });     // output plate
  mb.add(P.cyl12, PAL.steel, { pos: [0, 0.28, 0], scale: [0.34, 0.12, 0.34] });
  // index marks so rotation is visible
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; mb.add(P.box, PAL.accent, { pos: [Math.cos(a) * 0.4, 0.26, Math.sin(a) * 0.4], scale: [0.1, 0.05, 0.1] }); }
  mb.add(P.box, PAL.iron, { pos: [0, 0.42, 0], scale: [0.72, 0.18, 0.3] });           // mounting tab
  const m = mb.toGroup('servo.moving');
  group.add(m);
  return group;
}

export function buildRotator(detail = 1) {
  const group = new THREE.Group(); group.name = 'rotator';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.cyl12, PAL.steel, { pos: [0, -0.06, 0], scale: [0.7, 0.42, 0.7] });        // motor can
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; bb.add(P.box, PAL.steelDark, { pos: [Math.cos(a) * 0.36, -0.06, Math.sin(a) * 0.36], scale: [0.06, 0.4, 0.06] }); }
  bb.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0x7d5ac4), { pos: [0, 0.14, 0.34], name: 'rotator.led' });
  group.add(bb.toGroup('rotator.base'));

  const mb = new PartBuilder();
  mb.add(P.cyl12, PAL.steelLight, { pos: [0, 0.22, 0], scale: [0.5, 0.2, 0.5] });     // spinning shaft
  mb.add(P.box, PAL.accent, { pos: [0, 0.3, 0], scale: [0.86, 0.1, 0.14] });          // cross vane
  mb.add(P.box, PAL.accent, { pos: [0, 0.3, 0], scale: [0.14, 0.1, 0.86] });
  mb.add(P.box, PAL.iron, { pos: [0, 0.44, 0], scale: [0.4, 0.2, 0.4] });             // output boss
  const m = mb.toGroup('rotator.moving');
  group.add(m);
  return group;
}

/**
 * Piston: housing (base) + telescoping rod (moving). The rod translates along
 * +Y; the renderer offsets `piston.moving` by the live extension.
 */
export function buildPiston(detail = 1) {
  const group = new THREE.Group(); group.name = 'piston';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.cyl12, PAL.steel, { pos: [0, 0.0, 0], scale: [0.6, 0.72, 0.6] });          // cylinder
  bb.add(P.cyl12, PAL.steelDark, { pos: [0, 0.36, 0], scale: [0.5, 0.08, 0.5] });     // gland
  bb.add(P.box, PAL.accentDeep, { pos: [0, -0.1, 0.32], scale: [0.4, 0.5, 0.05] });   // feed line face
  group.add(bb.toGroup('piston.base'));

  const mb = new PartBuilder();
  mb.add(P.cyl12, PAL.steelPale, { pos: [0, 0.28, 0], scale: [0.28, 0.7, 0.28] });    // rod
  mb.add(P.box, PAL.iron, { pos: [0, 0.6, 0], scale: [0.72, 0.16, 0.72] });           // end cap / mount
  mb.add(P.box, PAL.accent, { pos: [0, 0.6, 0], scale: [0.5, 0.17, 0.12] });
  const m = mb.toGroup('piston.moving');
  group.add(m);
  return group;
}

/**
 * Drill: motor base + conical spiral head (moving, spins about +Y). Damages
 * mineable/vehicle objects it is actually touching while powered.
 */
export function buildDrill(detail = 1) {
  const group = new THREE.Group(); group.name = 'drill';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.box, PAL.steel, { pos: [0, -0.04, 0], scale: [0.74, 0.44, 0.74] });        // gearbox
  vents(bb, 4, [0, -0.04, 0.38], [0.5, 0.3, 0.04], PAL.steelLight, 'z');
  bb.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0xff8a3a), { pos: [0.3, 0.1, 0.3], name: 'drill.led' });
  group.add(bb.toGroup('drill.base'));

  const mb = new PartBuilder();
  const segs = detail >= 1 ? 14 : 8;
  mb.add(P.cyl12, PAL.steelLight, { pos: [0, 0.2, 0], scale: [0.4, 0.14, 0.4] });     // chuck
  // conical bit
  mb.add(new THREE.ConeGeometry(0.34, 0.8, segs), PAL.steelPale, { pos: [0, 0.68, 0] });
  // spiral flutes
  const flutes = detail >= 1 ? 3 : 2;
  for (let i = 0; i < flutes; i++) {
    const a = (i / flutes) * Math.PI * 2;
    for (let t = 0; t < 5; t++) {
      const yy = 0.34 + t * 0.12;
      const rr = 0.3 * (1 - t / 6);
      const aa = a + t * 0.6;
      mb.add(P.box, PAL.accent, { pos: [Math.cos(aa) * rr, yy, Math.sin(aa) * rr], rot: [0, -aa, 0.5], scale: [0.12, 0.05, 0.1] });
    }
  }
  const m = mb.toGroup('drill.moving');
  group.add(m);
  return group;
}

// ---------------------------------------------------------------------------
// Projectile + FX geometry
// ---------------------------------------------------------------------------

let _projGeo = null;
export function projectileMesh() {
  if (!_projGeo) {
    _projGeo = new THREE.SphereGeometry(0.11, 8, 6);
    _projGeo.scale(1, 1, 2.2);
  }
  const m = new THREE.Mesh(_projGeo, MATERIALS.emissive(0xffd36a));
  m.name = 'projectile';
  return m;
}

// ===========================================================================
// EXPANDED BLOCK SET — light/heavy structure, more wheels, engines, weapons,
// and melee tools. Each keeps the one-merged-mesh (+ a few extras) convention.
// ===========================================================================

// ---- structure ----------------------------------------------------------

/** Light Frame: an open welded truss. Reads as hollow and lightweight. */
export function buildLightFrame(detail = 1) {
  const b = new PartBuilder();
  frameCube(b, 0.94, 0.085, PAL.steelLight, PAL.steel);
  const L = 1.08, t = 0.05;
  // in-plane cross-braces on the ±Z faces (long axis X, tilted 45° about Z)
  for (const z of [0.44, -0.44]) {
    b.add(P.box, PAL.steel, { pos: [0, 0, z], rot: [0, 0, Math.PI / 4], scale: [L, t, t] });
    b.add(P.box, PAL.steel, { pos: [0, 0, z], rot: [0, 0, -Math.PI / 4], scale: [L, t, t] });
  }
  // in-plane cross-braces on the ±X faces (long axis Y, tilted 45° about X)
  for (const x of [0.44, -0.44]) {
    b.add(P.box, PAL.steel, { pos: [x, 0, 0], rot: [Math.PI / 4, 0, 0], scale: [t, L, t] });
    b.add(P.box, PAL.steel, { pos: [x, 0, 0], rot: [-Math.PI / 4, 0, 0], scale: [t, L, t] });
  }
  if (detail >= 1) {
    for (const x of [-0.44, 0.44]) for (const y of [-0.44, 0.44]) for (const z of [-0.44, 0.44]) {
      b.add(P.box, PAL.accentDeep, { pos: [x, y, z], scale: 0.1 });
    }
  }
  return b.toGroup('light_frame');
}

/** Heavy Block: a dense, thickly riveted mass. Reads heavy and strong. */
export function buildHeavyBlock(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.iron, { scale: 0.9 });
  // thick raised plate on every face
  for (const [p, s] of [
    [[0, 0.47, 0], [0.84, 0.1, 0.84]], [[0, -0.47, 0], [0.84, 0.1, 0.84]],
    [[0.47, 0, 0], [0.1, 0.84, 0.84]], [[-0.47, 0, 0], [0.1, 0.84, 0.84]],
    [[0, 0, 0.47], [0.84, 0.84, 0.1]], [[0, 0, -0.47], [0.84, 0.84, 0.1]],
  ]) b.add(P.box, PAL.steelDark, { pos: p, scale: s });
  // massive corner blocks
  for (const x of [-0.40, 0.40]) for (const y of [-0.40, 0.40]) for (const z of [-0.40, 0.40]) {
    b.add(P.box, PAL.steel, { pos: [x, y, z], scale: 0.22 });
  }
  // hazard chevrons on the front face (kept within the cell)
  b.add(P.box, PAL.hazard, { pos: [0, 0, 0.5], scale: [0.5, 0.14, 0.02] });
  b.add(P.box, PAL.steelDark, { pos: [0, 0, 0.505], rot: [0, 0, Math.PI / 4], scale: [0.14, 0.14, 0.02] });
  if (detail >= 1) {
    bolts(b, 'z', 1, 0.49, 0.3, PAL.steelPale, 0.05, 0.05);
    bolts(b, 'y', 1, 0.49, 0.3, PAL.steelPale, 0.05, 0.05);
  }
  if (detail >= 2) {
    bolts(b, 'z', -1, 0.49, 0.3, PAL.steelPale, 0.05, 0.05);
    bolts(b, 'x', 1, 0.49, 0.3, PAL.steelPale, 0.05, 0.05);
    bolts(b, 'x', -1, 0.49, 0.3, PAL.steelPale, 0.05, 0.05);
  }
  return b.toGroup('heavy_block');
}

/** Canonical wedge vertices (cell-local, metres). Shared by mesh + collider. */
// X is shrunk slightly (±0.44) so the slope reads as a clean 1×1 block.
export const WEDGE_VERTS = [
  [-0.44, -0.5, -0.5], [0.44, -0.5, -0.5], [0.44, -0.5, 0.5], [-0.44, -0.5, 0.5], // base
  [-0.44, 0.5, -0.5], [0.44, 0.5, -0.5],                                          // high back edge
];
const WEDGE_FACES = [
  [0, 2, 1], [0, 3, 2],       // bottom
  [0, 1, 5], [0, 5, 4],       // back (tall) wall
  [3, 4, 5], [3, 5, 2],       // slope
  [0, 4, 3],                   // left
  [1, 2, 5],                   // right
];

/** Wedge: a sloped half-cube. Low at +Z, full height at -Z. */
export function buildWedge(detail = 1) {
  const pos = [];
  for (const f of WEDGE_FACES) for (const idx of f) pos.push(...WEDGE_VERTS[idx]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const colors = new Float32Array(pos.length);
  const c = new THREE.Color(PAL.steel);
  for (let i = 0; i < pos.length / 3; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(g, MATERIALS.block);
  mesh.name = 'wedge.body';
  mesh.castShadow = true; mesh.receiveShadow = true;

  // dress it with a builder for edge trim so it is not a bare triangle
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.46, 0], scale: [0.98, 0.09, 0.98] });   // base plate
  b.add(P.box, PAL.accentDeep, { pos: [0, 0.0, -0.46], scale: [0.9, 0.9, 0.06] });   // back face accent
  // slope rails
  b.add(P.box, PAL.steelLight, { pos: [0.44, 0.0, 0.0], rot: [Math.PI / 4, 0, 0], scale: [0.06, 0.08, 1.35] });
  b.add(P.box, PAL.steelLight, { pos: [-0.44, 0.0, 0.0], rot: [Math.PI / 4, 0, 0], scale: [0.06, 0.08, 1.35] });
  const grp = b.toGroup('wedge');
  grp.add(mesh);
  return grp;
}

// ---- engines -------------------------------------------------------------

/** Light Engine: a low, wide flat-twin BOXER — cylinders poke out each side. */
export function buildEngineLight(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.22, 0], scale: [0.5, 0.3, 0.72] });        // low crankcase
  b.add(P.box, PAL.steel, { pos: [0, -0.05, 0], scale: [0.36, 0.22, 0.6] });
  // horizontally-opposed cylinders sticking out ±X with finned heads
  for (const sx of [-1, 1]) {
    b.add(P.cyl12, PAL.steelLight, { pos: [sx * 0.36, -0.05, 0], rot: [0, 0, HALF], scale: [0.26, 0.4, 0.26] });
    for (let f = 0; f < 3; f++) b.add(P.cyl12, PAL.steel, { pos: [sx * (0.4 + f * 0.07), -0.05, 0], rot: [0, 0, HALF], scale: [0.3, 0.03, 0.3] });
    b.add(P.cyl12, PAL.iron, { pos: [sx * 0.56, -0.05, 0], rot: [0, 0, HALF], scale: [0.2, 0.05, 0.2] });   // end cap
  }
  // little pancake air filter + green tell-tale
  b.add(P.cyl20, PAL.copper, { pos: [0, 0.14, 0], scale: [0.3, 0.08, 0.3] });
  b.add(P.cyl8, PAL.rust, { pos: [0, -0.12, -0.4], rot: [0.4, 0, 0], scale: [0.1, 0.26, 0.1] });            // stinger exhaust
  b.add(P.box, PAL.accentDeep, { pos: [0, -0.37, 0], scale: [0.52, 0.06, 0.74] });
  b.addExtra(new THREE.SphereGeometry(0.045, 8, 6), MATERIALS.emissive(0x5fd07a), { pos: [0, 0.14, 0.26], name: 'engine.light' });
  return b.toGroup('engine_light');
}

/** V8 Engine: a V-block topped by a ribbed SUPERCHARGER blower and scoop. */
export function buildEngineV8(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.2, 0], scale: [0.9, 0.42, 0.94] });        // crankcase
  // two angled banks of four cylinders in a V
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -0.3 + i * 0.2;
      b.add(P.cyl12, PAL.steel, { pos: [side * 0.26, 0.04, z], rot: [0, 0, side * 0.52], scale: [0.16, 0.34, 0.16] });
    }
    b.add(P.box, PAL.iron, { pos: [side * 0.32, 0.12, 0], rot: [0, 0, side * 0.52], scale: [0.1, 0.12, 0.84] });  // valve cover
    // fat exhaust header curving down and out
    b.add(P.cyl12, PAL.rust, { pos: [side * 0.48, -0.16, 0], rot: [HALF, 0, 0], scale: [0.12, 0.86, 0.12] });
    for (let i = 0; i < 4; i++) b.add(P.cyl8, PAL.rust, { pos: [side * 0.4, 0.0, -0.3 + i * 0.2], rot: [0, 0, side * 0.9], scale: [0.08, 0.3, 0.08] });
  }
  // supercharger blower sitting in the valley + forward-facing scoop
  b.add(P.box, PAL.steelLight, { pos: [0, 0.34, 0], scale: [0.34, 0.22, 0.7] });
  for (let i = 0; i < 6; i++) b.add(P.box, PAL.steelDark, { pos: [0, 0.46, -0.3 + i * 0.12], scale: [0.38, 0.03, 0.05] });  // blower ribs
  b.add(P.box, PAL.accent, { pos: [0, 0.4, 0.42], rot: [-0.3, 0, 0], scale: [0.4, 0.26, 0.18] });            // scoop mouth
  b.add(P.box, PAL.iron, { pos: [0, 0.52, 0.5], rot: [-0.3, 0, 0], scale: [0.42, 0.05, 0.2] });
  b.add(P.box, PAL.accentDeep, { pos: [0, -0.4, 0], scale: [0.92, 0.08, 0.96] });
  b.addExtra(new THREE.SphereGeometry(0.05, 8, 6), MATERIALS.emissive(0xff6a4a), { pos: [0, 0.34, -0.4] });
  if (detail >= 1) bolts(b, 'y', -1, 0.42, 0.34, PAL.steelPale);
  return b.toGroup('engine_v8');
}

/** Turbo Engine: a horizontal GAS TURBINE — intake fan up front, glowing jet exhaust aft. */
export function buildEngineTurbo(detail = 1) {
  const b = new PartBuilder();
  // support cradle
  b.add(P.box, PAL.steelDark, { pos: [0, -0.34, 0], scale: [0.62, 0.3, 0.9] });
  for (const sx of [-1, 1]) b.add(P.box, PAL.steel, { pos: [sx * 0.22, -0.1, 0], scale: [0.1, 0.3, 0.3] });
  // main turbine barrel along Z
  b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 20), PAL.steelLight, { pos: [0, 0.06, -0.02], rot: [HALF, 0, 0] });
  // banding rings
  for (const z of [-0.3, -0.05, 0.2]) b.add(new THREE.CylinderGeometry(0.37, 0.37, 0.05, 20), PAL.steelDark, { pos: [0, 0.06, z], rot: [HALF, 0, 0] });
  // intake fan at the front (+Z): a ring + radial blades
  b.add(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 20), PAL.iron, { pos: [0, 0.06, 0.46], rot: [HALF, 0, 0] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(P.box, PAL.steelPale, { pos: [Math.cos(a) * 0.22, 0.06 + Math.sin(a) * 0.22, 0.47], rot: [0, 0, -a], scale: [0.4, 0.07, 0.03] });
  }
  b.add(P.cyl12, PAL.accent, { pos: [0, 0.06, 0.5], rot: [HALF, 0, 0], scale: [0.14, 0.12, 0.14] });        // spinner cone
  // glowing afterburner nozzle at the back (-Z)
  b.add(new THREE.CylinderGeometry(0.28, 0.36, 0.2, 16), PAL.steelDark, { pos: [0, 0.06, -0.5], rot: [HALF, 0, 0] });
  b.addExtra(new THREE.CylinderGeometry(0.22, 0.3, 0.14, 16), MATERIALS.emissive(0x39c2ff), { pos: [0, 0.06, -0.58], rot: [HALF, 0, 0], name: 'turbo.glow' });
  b.add(P.box, PAL.accentDeep, { pos: [0, -0.46, 0], scale: [0.64, 0.06, 0.92] });
  return b.toGroup('engine_turbo');
}

// ---- wheels (reuse buildWheel with different proportions) ----------------
export function buildRacingWheel(detail = 1) { return buildWheel(detail, 0.38, 0.26); }
export function buildMonsterWheel(detail = 1) { return buildWheel(detail, 0.66, 0.56); }

// ---- weapons -------------------------------------------------------------

/** Autocannon: twin rapid-fire barrels with an ammo drum. Fires +Z. */
export function buildAutocannon(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.08, -0.12], scale: [0.6, 0.46, 0.6] });  // receiver
  b.add(P.cyl12, PAL.steel, { pos: [0, -0.18, -0.28], rot: [HALF, 0, 0], scale: [0.34, 0.3, 0.34] }); // drum
  for (const sx of [-1, 1]) {
    b.add(P.cyl12, PAL.iron, { pos: [sx * 0.13, 0.04, 0.2], rot: [HALF, 0, 0], scale: [0.12, 0.7, 0.12] });
    b.add(P.cyl12, PAL.steelDark, { pos: [sx * 0.13, 0.04, 0.52], rot: [HALF, 0, 0], scale: [0.15, 0.14, 0.15] });
  }
  b.add(P.box, PAL.accentDeep, { pos: [0, 0.18, -0.12], scale: [0.4, 0.08, 0.5] });
  b.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0xff6a4a), { pos: [0.2, 0.16, -0.3] });
  if (detail >= 1) for (const z of [0.0, 0.14, 0.28]) b.add(P.cyl12, PAL.steelLight, { pos: [0, 0.04, z], rot: [HALF, 0, 0], scale: [0.26, 0.03, 0.26] });
  return b.toGroup('autocannon');
}

/** Heavy Cannon: one enormous barrel and a recoiling breech. Fires +Z. */
export function buildHeavyCannon(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.iron, { pos: [0, 0, -0.18], scale: [0.78, 0.66, 0.74] });         // breech
  b.add(P.box, PAL.steelDark, { pos: [0, 0.3, -0.18], scale: [0.6, 0.16, 0.6] });
  b.add(P.cyl12, PAL.steel, { pos: [0, 0.02, 0.28], rot: [HALF, 0, 0], scale: [0.3, 0.95, 0.3] });   // barrel
  b.add(P.cyl12, PAL.steelDark, { pos: [0, 0.02, 0.74], rot: [HALF, 0, 0], scale: [0.38, 0.2, 0.38] }); // muzzle brake
  b.add(P.box, PAL.steelDark, { pos: [0, 0.02, 0.6], scale: [0.5, 0.1, 0.12] });     // brake vents
  // recoil rails
  for (const sx of [-1, 1]) b.add(P.cyl8, PAL.steelLight, { pos: [sx * 0.22, -0.18, 0.1], rot: [HALF, 0, 0], scale: [0.07, 0.8, 0.07] });
  b.add(P.box, PAL.hazard, { pos: [0, -0.36, -0.18], scale: [0.6, 0.06, 0.6] });
  b.addExtra(new THREE.SphereGeometry(0.045, 8, 6), MATERIALS.emissive(0xffb020), { pos: [0.3, 0.3, -0.3] });
  if (detail >= 1) for (const z of [0.1, 0.3, 0.5]) b.add(P.cyl12, PAL.steelLight, { pos: [0, 0.02, z], rot: [HALF, 0, 0], scale: [0.33, 0.04, 0.33] });
  return b.toGroup('heavy_cannon');
}

/** Scattergun: a fan of short wide barrels. Fires a +Z pellet spread. */
export function buildScattergun(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.05, -0.15], scale: [0.66, 0.5, 0.6] });
  // seven stubby barrels in a hex cluster
  const spots = [[0, 0], [0.18, 0], [-0.18, 0], [0.09, 0.16], [-0.09, 0.16], [0.09, -0.16], [-0.09, -0.16]];
  for (const [x, y] of spots) {
    b.add(P.cyl8, PAL.iron, { pos: [x, y + 0.02, 0.22], rot: [HALF, 0, 0], scale: [0.1, 0.44, 0.1] });
    b.add(P.cyl8, PAL.steelDark, { pos: [x, y + 0.02, 0.44], rot: [HALF, 0, 0], scale: [0.12, 0.08, 0.12] });
  }
  b.add(P.cyl12, PAL.steel, { pos: [0, 0.02, 0.06], rot: [HALF, 0, 0], scale: [0.5, 0.12, 0.5] });   // muzzle shroud
  b.add(P.box, PAL.accentDeep, { pos: [0, 0.3, -0.15], scale: [0.4, 0.06, 0.5] });
  b.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0xff8a3a), { pos: [0.24, 0.22, -0.3] });
  return b.toGroup('scattergun');
}

/** Heavy Turret: a bigger armoured turret with twin barrels. Head spins to aim. */
export function buildHeavyTurret(detail = 1, accent = PAL.accent) {
  const group = new THREE.Group();
  group.name = 'turret';

  const bb = new PartBuilder();
  bb.add(P.box, PAL.steelDark, { pos: [0, -0.36, 0], scale: [0.96, 0.28, 0.96] });
  bb.add(P.cyl20, PAL.steel, { pos: [0, -0.12, 0], scale: [0.86, 0.26, 0.86] });       // turntable
  bb.add(P.cyl12, PAL.iron, { pos: [0, 0.02, 0], scale: [0.56, 0.14, 0.56] });
  if (detail >= 1) for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; bb.add(P.cyl8, PAL.steelPale, { pos: [Math.cos(a) * 0.4, -0.1, Math.sin(a) * 0.4], scale: [0.06, 0.26, 0.06] }); }
  group.add(bb.toGroup('turret.base'));

  const hb = new PartBuilder();
  hb.add(P.box, PAL.steelDark, { pos: [0, 0.18, -0.1], scale: [0.8, 0.44, 0.66] });    // armoured mantlet
  hb.add(P.box, PAL.steel, { pos: [0, 0.4, -0.1], scale: [0.66, 0.1, 0.56] });
  for (const sx of [-1, 1]) hb.add(P.box, accent, { pos: [sx * 0.41, 0.18, -0.1], scale: [0.05, 0.28, 0.5] });
  // twin barrels +Z
  for (const sx of [-1, 1]) {
    hb.add(P.cyl12, PAL.iron, { pos: [sx * 0.16, 0.12, 0.3], rot: [HALF, 0, 0], scale: [0.14, 0.72, 0.14] });
    hb.add(P.cyl12, PAL.steelDark, { pos: [sx * 0.16, 0.12, 0.68], rot: [HALF, 0, 0], scale: [0.17, 0.2, 0.17] });
  }
  hb.add(P.box, PAL.steelDark, { pos: [0, 0.14, -0.42], scale: [0.5, 0.34, 0.2] });    // counterweight
  hb.addExtra(new THREE.SphereGeometry(0.05, 8, 6), MATERIALS.emissive(0xff6a4a), { pos: [0, 0.42, -0.26], name: 'turret.eye' });
  const head = hb.toGroup('turret.head');
  head.position.y = 0.06;
  group.add(head);
  return group;
}

/**
 * Wall Turret: a bracket that beds FLAT against the face you click (mount face
 * -Y) and projects a compact rotating turret outward along +Y. Auto-orients like
 * the armour plate, so you stick it on the side of a hull and it tracks on its own.
 */
export function buildWallTurret(detail = 1, accent = PAL.accent) {
  const group = new THREE.Group();
  group.name = 'turret';

  const bb = new PartBuilder();
  // mounting plate hugging the -Y face
  bb.add(P.box, PAL.iron, { pos: [0, -0.42, 0], scale: [0.92, 0.16, 0.92] });
  bb.add(P.box, PAL.accentDeep, { pos: [0, -0.42, 0], scale: [0.3, 0.17, 0.3] });
  if (detail >= 1) for (const x of [-0.34, 0.34]) for (const z of [-0.34, 0.34]) bb.add(P.cyl8, PAL.steelPale, { pos: [x, -0.44, z], scale: [0.06, 0.06, 0.06] });
  // neck/arm projecting outward
  bb.add(P.box, PAL.steelDark, { pos: [0, -0.18, 0], scale: [0.6, 0.36, 0.6] });
  bb.add(P.cyl12, PAL.steel, { pos: [0, 0.02, 0], scale: [0.6, 0.2, 0.6] });            // turntable
  group.add(bb.toGroup('wallturret.base'));

  const hb = new PartBuilder();
  hb.add(P.box, PAL.steel, { pos: [0, 0.2, -0.06], scale: [0.54, 0.32, 0.46] });        // head body
  hb.add(P.box, PAL.steelLight, { pos: [0, 0.35, -0.06], scale: [0.44, 0.07, 0.4] });
  for (const sx of [-1, 1]) hb.add(P.box, accent, { pos: [sx * 0.28, 0.2, -0.06], scale: [0.04, 0.2, 0.38] });
  hb.add(P.cyl12, PAL.iron, { pos: [0, 0.16, 0.26], rot: [HALF, 0, 0], scale: [0.13, 0.5, 0.13] });     // barrel +Z
  hb.add(P.cyl12, PAL.steelDark, { pos: [0, 0.16, 0.5], rot: [HALF, 0, 0], scale: [0.16, 0.2, 0.16] }); // muzzle
  hb.addExtra(new THREE.SphereGeometry(0.04, 8, 6), MATERIALS.emissive(0xff6a4a), { pos: [0, 0.34, -0.2], name: 'wt.eye' });
  const head = hb.toGroup('turret.head');
  head.position.y = 0.12;
  group.add(head);
  return group;
}

// ---- melee tools ---------------------------------------------------------

/**
 * Buzzsaw: a motor base + a toothed disc that spins about +Y. Reuses the drill
 * tool path (spinning `drill.moving` child + +Y contact ray), so mounted on the
 * front and rotated to point forward it carves into whatever it touches.
 */
export function buildBuzzsaw(detail = 1) {
  const group = new THREE.Group(); group.name = 'buzzsaw';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.box, PAL.steel, { pos: [0, 0.0, 0], scale: [0.5, 0.5, 0.74] });             // gearbox straddling the blade
  bb.add(P.cyl12, PAL.steelDark, { pos: [0, 0.14, 0], rot: [0, 0, HALF], scale: [0.3, 0.5, 0.3] });  // spindle (axis = X)
  bb.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0xff5a3c), { pos: [0, 0.3, -0.3], name: 'buzzsaw.led' });
  group.add(bb.toGroup('buzzsaw.base'));

  // Blade is VERTICAL (plane = Y-Z), normal along X, spinning about X — so mounted
  // facing forward it presents its cutting edge "---", not the flat disc "O".
  const mb = new PartBuilder();
  const R = 0.58, yc = 0.5;
  mb.add(new THREE.CylinderGeometry(R, R, 0.05, 30), PAL.steelPale, { pos: [0, yc, 0], rot: [0, 0, HALF] }); // disc, axis X
  mb.add(new THREE.CylinderGeometry(R * 0.38, R * 0.38, 0.12, 16), PAL.steel, { pos: [0, yc, 0], rot: [0, 0, HALF] }); // hub
  const teeth = detail >= 1 ? 22 : 14;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    // teeth live in the Y-Z plane (y around the hub, z around the hub)
    mb.add(P.box, PAL.steelLight, { pos: [0, yc + Math.cos(a) * R, Math.sin(a) * R], rot: [-a, 0, 0], scale: [0.14, 0.055, 0.17] });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    mb.add(P.box, PAL.accent, { pos: [0, yc + Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5], rot: [-a, 0, 0], scale: [0.07, R * 0.66, 0.06] });
  }
  const m = mb.toGroup('drill.moving');     // named so the drill tool path drives it
  group.add(m);
  return group;
}

/** Heavy Drill: a larger, meaner version of the mining drill. */
export function buildGrinder(detail = 1) {
  const group = new THREE.Group(); group.name = 'grinder';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.box, PAL.iron, { pos: [0, -0.02, 0], scale: [0.82, 0.5, 0.82] });          // heavy gearbox
  vents(bb, 5, [0, -0.02, 0.42], [0.6, 0.36, 0.04], PAL.steelLight, 'z');
  bb.addExtra(new THREE.SphereGeometry(0.04, 8, 6), MATERIALS.emissive(0xff8a3a), { pos: [0.32, 0.12, 0.32], name: 'grinder.led' });
  group.add(bb.toGroup('grinder.base'));

  const mb = new PartBuilder();
  const segs = detail >= 1 ? 16 : 10;
  mb.add(P.cyl12, PAL.steelLight, { pos: [0, 0.2, 0], scale: [0.5, 0.16, 0.5] });     // chuck
  mb.add(new THREE.ConeGeometry(0.42, 0.82, segs), PAL.steelPale, { pos: [0, 0.66, 0] });  // long bit
  const flutes = detail >= 1 ? 4 : 2;
  for (let i = 0; i < flutes; i++) {
    const a = (i / flutes) * Math.PI * 2;
    for (let t = 0; t < 5; t++) {
      const yy = 0.4 + t * 0.12, rr = 0.36 * (1 - t / 6), aa = a + t * 0.6;
      mb.add(P.box, PAL.accent, { pos: [Math.cos(aa) * rr, yy, Math.sin(aa) * rr], rot: [0, -aa, 0.5], scale: [0.16, 0.06, 0.12] });
    }
  }
  const m = mb.toGroup('drill.moving');
  group.add(m);
  return group;
}

/** Ram Spike: a passive armoured prow with forward spikes (+Z). Melee on contact. */
export function buildRam(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.iron, { pos: [0, 0, -0.2], scale: [0.86, 0.72, 0.5] });            // backing block
  // sloped wedge prow toward +Z
  b.add(P.box, PAL.steelDark, { pos: [0, 0.18, 0.18], rot: [-0.5, 0, 0], scale: [0.84, 0.16, 0.5] });
  b.add(P.box, PAL.steelDark, { pos: [0, -0.18, 0.18], rot: [0.5, 0, 0], scale: [0.84, 0.16, 0.5] });
  // three spikes
  for (const x of [-0.26, 0, 0.26]) {
    b.add(P.cone12, PAL.steelPale, { pos: [x, 0, 0.42], rot: [HALF, 0, 0], scale: [0.2, 0.6, 0.2] });
  }
  b.add(P.box, PAL.hazard, { pos: [0, 0, -0.44], scale: [0.7, 0.14, 0.03] });
  b.add(P.box, PAL.hazard, { pos: [0, 0, -0.44], rot: [0, 0, Math.PI / 4], scale: [0.14, 0.14, 0.04] });
  if (detail >= 1) { for (const x of [-0.3, 0.3]) for (const y of [-0.26, 0.26]) b.add(P.cyl8, PAL.steelPale, { pos: [x, y, -0.44], scale: [0.05, 0.06, 0.05] }); }
  return b.toGroup('ram');
}

/**
 * Frontal wheel: same rolling wheel, but its mount bracket faces the block
 * BEHIND it (local -Z) instead of to the side, so it bolts onto a front/back
 * face for tricycles and centre wheels. The axle stays along X, so it still
 * rolls forward normally.
 */
export function buildFrontalWheel(detail = 1, radius = 0.45, width = 0.32) {
  const g = buildWheel(detail, radius, width);
  for (const name of ['wheel.carrier', 'wheel.hull']) {
    const sub = g.getObjectByName(name);
    if (sub) sub.rotation.y = -HALF;     // swing the bracket from -X round to -Z
  }
  return g;
}

/**
 * Tank tread: a long driven track. Functionally a very grippy, durable wheel
 * (raycast suspension + drive), visually an oval belt with end rollers and lugs.
 * Only the rollers live in the spin group so the look stays sane.
 */
export function buildTread(detail = 1, radius = 0.4, length = 1.7, width = 0.42) {
  const group = new THREE.Group();
  group.name = 'wheel';
  const hl = length / 2 - radius;        // straight-run half length (sprocket centres at ±hl)
  const W = width;

  // Empty spin group so _syncWheel never falls back to spinning the whole tread.
  group.add(new PartBuilder().toGroup('wheel.spin'));

  // Everything visible lives in the carrier (bobs with suspension, never orbits).
  const c = new PartBuilder();
  const segs = detail >= 1 ? 16 : 10;

  // --- the belt: two straight runs (top + ground) wrapping the sprockets ---
  c.add(P.box, PAL.rubber, { pos: [0, radius, 0], scale: [W * 1.02, radius * 0.42, hl * 2] });    // top run
  c.add(P.box, PAL.rubber, { pos: [0, -radius, 0], scale: [W * 1.02, radius * 0.42, hl * 2] });   // ground run
  // cleats on the ground run (what bites the dirt)
  const cleats = detail >= 2 ? 11 : 7;
  for (let i = 0; i < cleats; i++) {
    const z = -hl + (i + 0.5) / cleats * hl * 2;
    c.add(P.box, PAL.rubberWorn, { pos: [0, -radius - 0.06, z], scale: [W * 1.08, 0.12, hl * 2 / cleats * 0.6] });
  }

  // --- drive sprockets at both ends: a toothed gear the belt wraps around ---
  for (const z of [-hl, hl]) {
    c.add(new THREE.CylinderGeometry(radius, radius, W, segs), PAL.steelDark, { pos: [0, 0, z], rot: [0, 0, HALF] });
    c.add(new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, W * 1.04, segs), PAL.steel, { pos: [0, 0, z], rot: [0, 0, HALF] });
    c.add(P.cyl12, PAL.accent, { pos: [0, 0, z], rot: [0, 0, HALF], scale: [radius * 0.26, W * 1.06, radius * 0.26] });  // hub
    const teeth = detail >= 1 ? 12 : 8;
    for (let t = 0; t < teeth; t++) {
      const a = (t / teeth) * Math.PI * 2;
      c.add(P.box, PAL.steelLight, { pos: [0, Math.cos(a) * radius, z + Math.sin(a) * radius], rot: [a, 0, 0], scale: [W * 0.9, 0.12, 0.16] });
    }
  }

  // --- road wheels along the bottom, between the sprockets ---
  const road = detail >= 1 ? 4 : 3;
  for (let i = 0; i < road; i++) {
    const z = -hl + 0.4 + (i / (road - 1)) * (hl * 2 - 0.8);
    c.add(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, W * 0.7, 12), PAL.steelLight, { pos: [0, -radius * 0.35, z], rot: [0, 0, HALF] });
    c.add(P.cyl8, PAL.accentDeep, { pos: [0, -radius * 0.35, z], rot: [0, 0, HALF], scale: [radius * 0.22, W * 0.74, radius * 0.22] });
  }

  // inboard side skirt + hull mount plate
  c.add(P.box, PAL.iron, { pos: [-W * 0.56, 0, 0], scale: [0.08, radius * 1.4, hl * 2] });
  group.add(c.toGroup('wheel.carrier'));

  const hb = new PartBuilder();
  hb.add(P.box, PAL.iron, { pos: [-W * 0.66, 0, 0], scale: [0.1, 0.62, 0.62] });
  hb.add(P.box, PAL.accentDeep, { pos: [-W * 0.66, 0, 0], scale: [0.11, 0.2, 0.2] });
  group.add(hb.toGroup('wheel.hull'));

  return group;
}

/** Spiked Flail: a spinning spiked ball on a stubby arm (contact melee, +Y). */
export function buildSpikeball(detail = 1) {
  const group = new THREE.Group(); group.name = 'spikeball';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.cyl12, PAL.steel, { pos: [0, 0.1, 0], scale: [0.4, 0.4, 0.4] });
  group.add(bb.toGroup('spikeball.base'));
  const mb = new PartBuilder();
  mb.add(P.cyl8, PAL.steelLight, { pos: [0, 0.4, 0], scale: [0.14, 0.42, 0.14] });        // shaft
  mb.add(P.sph, PAL.iron, { pos: [0, 0.74, 0], scale: [0.42, 0.42, 0.42] });                // ball
  const spikes = detail >= 1 ? 10 : 6;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2, el = (i % 2 ? 0.22 : -0.22);
    mb.add(P.cone12, PAL.steelPale, { pos: [Math.cos(a) * 0.3, 0.74 + el, Math.sin(a) * 0.3], rot: [Math.PI / 2 - el, a, 0], scale: [0.13, 0.28, 0.13] });
  }
  group.add(mb.toGroup('drill.moving'));
  return group;
}

/** Ram Lance: a long reinforced spike that gores on contact (+Y). */
export function buildLance(detail = 1) {
  const group = new THREE.Group(); group.name = 'lance';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.box, PAL.steel, { pos: [0, 0.0, 0], scale: [0.5, 0.4, 0.5] });
  group.add(bb.toGroup('lance.base'));
  const mb = new PartBuilder();
  mb.add(P.cyl12, PAL.steelLight, { pos: [0, 0.4, 0], scale: [0.18, 0.5, 0.18] });
  mb.add(new THREE.ConeGeometry(0.16, 0.5, 12), PAL.steelPale, { pos: [0, 0.85, 0] });
  for (const y of [0.35, 0.52, 0.69]) mb.add(P.torus, PAL.accent, { pos: [0, y, 0], rot: [HALF, 0, 0], scale: [0.36, 0.36, 0.36] });
  group.add(mb.toGroup('drill.moving'));
  return group;
}

/** Pneumatic Hammer: a heavy mallet head that pounds on contact (+Y). */
export function buildHammer(detail = 1) {
  const group = new THREE.Group(); group.name = 'hammer';
  const bb = new PartBuilder();
  mechBase(bb, PAL.steelDark);
  bb.add(P.cyl12, PAL.steel, { pos: [0, 0.1, 0], scale: [0.5, 0.5, 0.5] });
  vents(bb, 3, [0, 0.1, 0.42], [0.4, 0.3, 0.04], PAL.steelLight, 'z');
  group.add(bb.toGroup('hammer.base'));
  const mb = new PartBuilder();
  mb.add(P.cyl8, PAL.steelLight, { pos: [0, 0.45, 0], scale: [0.16, 0.5, 0.16] });         // piston rod
  mb.add(P.box, PAL.iron, { pos: [0, 0.82, 0], scale: [0.68, 0.42, 0.68] });                // mallet head
  mb.add(P.box, PAL.hazard, { pos: [0, 1.03, 0], scale: [0.7, 0.06, 0.7] });
  for (const x of [-0.28, 0.28]) for (const z of [-0.28, 0.28]) mb.add(P.cyl8, PAL.steelPale, { pos: [x, 0.82, z], rot: [0, 0, HALF], scale: [0.05, 0.7, 0.05] });
  group.add(mb.toGroup('drill.moving'));
  return group;
}

/** Thruster: a jet that pushes the machine along its +Z (exhaust glows out -Z). */
export function buildThruster(detail = 1, scale = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, 0, -0.1], scale: [0.6 * scale, 0.6 * scale, 0.6] });     // body
  b.add(P.cyl12, PAL.steel, { pos: [0, 0, 0.0], rot: [HALF, 0, 0], scale: [0.5 * scale, 0.5, 0.5 * scale] });
  b.add(new THREE.CylinderGeometry(0.34 * scale, 0.22 * scale, 0.3, 16), PAL.iron, { pos: [0, 0, -0.42], rot: [HALF, 0, 0] });  // nozzle (−Z)
  b.add(P.box, PAL.accentDeep, { pos: [0, 0.32 * scale, -0.1], scale: [0.4 * scale, 0.05, 0.4] });
  b.addExtra(new THREE.CylinderGeometry(0.18 * scale, 0.26 * scale, 0.22, 14), MATERIALS.emissive(0x39c2ff), { pos: [0, 0, -0.56], rot: [HALF, 0, 0], name: 'thruster.flame' });
  if (detail >= 1) for (const a of [0, 1, 2, 3]) { const an = a * Math.PI / 2; b.add(P.cyl8, PAL.steelPale, { pos: [Math.cos(an) * 0.32 * scale, Math.sin(an) * 0.32 * scale, -0.3], rot: [HALF, 0, 0], scale: [0.05, 0.3, 0.05] }); }
  return b.toGroup('thruster');
}

/** Gyroscope: a caged gimbal with a glowing rotor. Stabilizes & self-rights. */
export function buildGyroscope(detail = 1, tint = 0x39c2ff) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.36, 0], scale: [0.84, 0.28, 0.84] });   // base
  frameCube(b, 0.92, 0.08, PAL.steel, PAL.iron);                                      // protective cage
  // two gimbal rings at right angles — the inner one carries the variant colour
  b.add(P.torus, PAL.accent, { rot: [0, 0, 0], scale: [0.78, 0.78, 0.78] });
  b.add(P.torus, tint, { rot: [HALF, 0, 0], scale: [0.62, 0.62, 0.62] });
  // pivot pins
  for (const r of [[0, 0, HALF], [HALF, 0, 0]]) b.add(P.cyl8, PAL.steelPale, { pos: [0, 0, 0], rot: r, scale: [0.07, 1.0, 0.07] });
  // glowing rotor at the heart — tinted to signal the gyro's strength tier
  b.addExtra(new THREE.SphereGeometry(0.24, 12, 10), MATERIALS.emissive(tint), { pos: [0, 0.02, 0], name: 'gyro.rotor' });
  if (detail >= 1) bolts(b, 'y', -1, 0.4, 0.3, PAL.steelPale);
  return b.toGroup('gyroscope');
}

/** Battery: stores energy. Terminals + a glowing charge gauge. */
export function buildBattery(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { scale: 0.86 });
  frameCube(b, 0.9, 0.1, PAL.iron, PAL.steel);
  b.add(P.box, PAL.copper, { pos: [-0.2, 0.46, 0], scale: [0.14, 0.12, 0.14] });   // + terminal
  b.add(P.box, PAL.steelPale, { pos: [0.2, 0.46, 0], scale: [0.14, 0.1, 0.14] });   // - terminal
  for (let i = 0; i < 4; i++) b.addExtra(new THREE.BoxGeometry(0.5, 0.06, 0.04), MATERIALS.emissive(0x5fd07a), { pos: [0, -0.2 + i * 0.14, 0.44] });
  return b.toGroup('battery');
}

/** Solar panel: a flat cell array that charges batteries in daylight. */
export function buildSolar(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.4, 0], scale: [0.9, 0.2, 0.9] });        // base
  b.add(P.box, PAL.iron, { pos: [0, -0.18, 0], scale: [0.86, 0.08, 0.86] });
  const cells = detail >= 1 ? 4 : 2;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    b.addExtra(new THREE.BoxGeometry(0.8 / cells - 0.03, 0.03, 0.8 / cells - 0.03),
      MATERIALS.emissive(0x2f6fd0), { pos: [-0.4 + (i + 0.5) * 0.8 / cells, -0.12, -0.4 + (j + 0.5) * 0.8 / cells] });
  }
  return b.toGroup('solar');
}

/** Repair generator: spends energy to mend damaged blocks. */
export function buildRepair(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steel, { scale: 0.82 });
  frameCube(b, 0.88, 0.09, PAL.steelDark, PAL.iron);
  vents(b, 4, [0, 0, 0.44], [0.6, 0.5, 0.04], PAL.steelLight, 'z');
  b.add(P.box, PAL.green, { pos: [0, 0, 0.46], scale: [0.3, 0.07, 0.03] });          // cross emblem
  b.add(P.box, PAL.green, { pos: [0, 0, 0.46], scale: [0.07, 0.3, 0.03] });
  b.addExtra(new THREE.SphereGeometry(0.05, 8, 6), MATERIALS.emissive(0x5fd07a), { pos: [0.3, 0.32, 0.3], name: 'repair.led' });
  return b.toGroup('repair');
}

/** Shield generator: a projector dome; feeds a regenerating damage buffer. */
export function buildShield(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, -0.3, 0], scale: [0.82, 0.4, 0.82] });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(P.cyl8, PAL.steelPale, { pos: [Math.cos(a) * 0.32, 0.0, Math.sin(a) * 0.32], scale: [0.07, 0.4, 0.07] }); }
  b.addExtra(new THREE.SphereGeometry(0.3, 14, 10), MATERIALS.emissive(0x39c2ff), { pos: [0, 0.18, 0], name: 'shield.core' });
  return b.toGroup('shield');
}

/** Wing: a flat airfoil that makes lift from airspeed. Spans sideways (±X). */
export function buildWing(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, 0, 0], scale: [0.3, 0.3, 0.6] });            // root
  b.add(P.box, PAL.steelLight, { pos: [0.5, 0.04, 0.0], scale: [0.7, 0.08, 0.86] });   // main plane +X
  b.add(P.box, PAL.accent, { pos: [0.5, 0.06, 0.4], rot: [0, 0, 0], scale: [0.7, 0.05, 0.1] }); // leading edge
  b.add(P.box, PAL.steel, { pos: [0.86, 0.1, 0.0], rot: [0, 0, 0.2], scale: [0.14, 0.24, 0.5] }); // winglet
  if (detail >= 1) for (const z of [-0.3, 0, 0.3]) b.add(P.box, PAL.iron, { pos: [0.5, 0.02, z], scale: [0.68, 0.11, 0.03] });
  return b.toGroup('wing');
}

/** Gun Wing: an airfoil with a cannon built in. Lift + a +Z barrel (muzzle on the wing). */
export function buildWingGun(detail = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.steelDark, { pos: [0, 0, 0], scale: [0.34, 0.34, 0.6] });            // root/receiver
  b.add(P.box, PAL.steelLight, { pos: [0.5, 0.0, 0.0], scale: [0.7, 0.1, 0.86] });        // main plane +X
  b.add(P.box, PAL.accent, { pos: [0.5, 0.02, 0.4], scale: [0.7, 0.06, 0.1] });           // leading edge
  b.add(P.box, PAL.steel, { pos: [0.86, 0.06, 0.0], rot: [0, 0, 0.2], scale: [0.14, 0.24, 0.5] }); // winglet
  // cannon pod on top of the wing, firing +Z
  b.add(P.box, PAL.iron, { pos: [0.5, 0.18, -0.08], scale: [0.26, 0.22, 0.5] });          // gun housing
  b.add(P.cyl12, PAL.steelDark, { pos: [0.5, 0.12, 0.28], rot: [HALF, 0, 0], scale: [0.14, 0.6, 0.14] });  // barrel
  b.add(P.cyl12, PAL.iron, { pos: [0.5, 0.12, 0.56], rot: [HALF, 0, 0], scale: [0.17, 0.16, 0.17] });      // muzzle
  b.addExtra(new THREE.SphereGeometry(0.035, 8, 6), MATERIALS.emissive(0xffb020), { pos: [0.36, 0.2, -0.2] });
  if (detail >= 1) for (const z of [-0.3, 0, 0.3]) b.add(P.box, PAL.iron, { pos: [0.5, -0.03, z], scale: [0.68, 0.08, 0.03] });
  return b.toGroup('wing_gun');
}

// ---------------------------------------------------------------------------
// World props
// ---------------------------------------------------------------------------

/**
 * Low-poly boulder. A chunky main mass of faceted icosahedra with a few satellite
 * rocks and sharp shards, plus a buried skirt so, planted at ground height, it
 * reads as part of the landscape rather than a ball resting on top.
 */
export function buildRock(seedRand, scale = 1) {
  const b = new PartBuilder();
  const dark = [0x3f4348, 0x474b50, 0x4c5156];
  const mid = [PAL.rock, 0x5f6368, 0x565b61];
  const lite = [0x6c7076, 0x74787e];
  const pick = (arr) => arr[Math.floor(seedRand() * arr.length)];

  // main mass: 2-3 overlapping angular blocks
  const masses = 2 + Math.floor(seedRand() * 2);
  for (let i = 0; i < masses; i++) {
    const s = (0.8 + seedRand() * 0.7) * scale;
    b.add(P.ico, i === 0 ? pick(mid) : pick(dark), {
      pos: [(seedRand() - 0.5) * 0.5 * scale, (0.1 + seedRand() * 0.35) * scale, (seedRand() - 0.5) * 0.5 * scale],
      rot: [seedRand() * 3, seedRand() * 3, seedRand() * 3],
      scale: [s * (0.9 + seedRand() * 0.4), s * (0.7 + seedRand() * 0.4), s * (0.9 + seedRand() * 0.4)],
    });
  }
  // sunlit top facet (lighter tone) for readable form
  b.add(P.ico, pick(lite), { pos: [(seedRand() - 0.5) * 0.3 * scale, 0.55 * scale, (seedRand() - 0.5) * 0.3 * scale], rot: [seedRand(), seedRand() * 3, seedRand()], scale: [0.5 * scale, 0.3 * scale, 0.5 * scale] });
  // satellite rocks around the base
  const sats = 2 + Math.floor(seedRand() * 3);
  for (let i = 0; i < sats; i++) {
    const a = (i / sats) * Math.PI * 2 + seedRand();
    const r = (0.6 + seedRand() * 0.4) * scale;
    const s = (0.25 + seedRand() * 0.35) * scale;
    b.add(P.ico, pick(dark), { pos: [Math.cos(a) * r, (seedRand() * 0.15) * scale, Math.sin(a) * r], rot: [seedRand() * 3, seedRand() * 3, seedRand() * 3], scale: s });
  }
  // a couple of sharp shards for silhouette
  if (seedRand() > 0.4) {
    for (let i = 0; i < 2; i++) {
      b.add(P.cone6, pick(mid), { pos: [(seedRand() - 0.5) * 0.7 * scale, (0.4 + seedRand() * 0.5) * scale, (seedRand() - 0.5) * 0.7 * scale], rot: [seedRand() * 0.6 - 0.3, seedRand() * 3, seedRand() * 0.6 - 0.3], scale: [0.3 * scale, (0.7 + seedRand() * 0.6) * scale, 0.3 * scale] });
    }
  }
  // broad buried skirt — no visible gap under the rock
  b.add(P.ico, 0x3a3e43, { pos: [0, -0.55 * scale, 0], scale: [scale * 1.4, scale * 0.8, scale * 1.4] });
  return b.toGroup('rock', MATERIALS.flat);
}

/**
 * Low-poly tree. `kind`:
 *   'pine'  — tapered trunk + stacked faceted cone tiers
 *   'leafy' — leaning trunk with branch stubs + a clustered blob canopy
 *   'dead'  — bare desert snag with angular branches, no foliage
 * Built around origin with the trunk base at y=0 (plant at ground height).
 */
export function buildTree(seedRand, scale = 1, kind = 'pine') {
  const b = new PartBuilder();
  const barks = [0x5a4028, 0x6b4a2e, 0x4e3a26];
  const bark = barks[Math.floor(seedRand() * barks.length)];
  const greens = [0x3f7a3a, 0x4f8a42, 0x356b34, 0x5a7a30, 0x2f6330];
  const pick = (arr) => arr[Math.floor(seedRand() * arr.length)];

  if (kind === 'pine') {
    const trunkH = (1.0 + seedRand() * 0.5) * scale;
    b.add(new THREE.CylinderGeometry(0.12 * scale, 0.22 * scale, trunkH, 7), bark, { pos: [0, trunkH * 0.5, 0] });
    b.add(P.cone6, 0x4a3420, { pos: [0, 0.08 * scale, 0], scale: [0.5 * scale, 0.3 * scale, 0.5 * scale] });   // root flare
    const tiers = 4 + Math.floor(seedRand() * 2);
    let y = trunkH * 0.85;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const r = (1.25 - t * 0.85) * scale;
      const hgt = (1.15 - t * 0.35) * scale;
      const ox = (seedRand() - 0.5) * 0.12 * scale, oz = (seedRand() - 0.5) * 0.12 * scale;
      const geo = seedRand() > 0.5 ? P.cone6 : P.cone12;
      b.add(geo, i < 2 ? pick([greens[2], greens[4]]) : pick(greens), {
        pos: [ox, y + hgt * 0.4, oz], rot: [0, seedRand() * Math.PI, 0], scale: [r, hgt, r],
      });
      y += hgt * 0.52;
    }
  } else if (kind === 'leafy') {
    const trunkH = (1.3 + seedRand() * 0.6) * scale;
    const lean = (seedRand() - 0.5) * 0.18;
    b.add(new THREE.CylinderGeometry(0.14 * scale, 0.26 * scale, trunkH, 7), bark, { pos: [lean * trunkH * 0.5, trunkH * 0.5, 0], rot: [0, 0, lean] });
    b.add(P.cone6, 0x4a3420, { pos: [0, 0.1 * scale, 0], scale: [0.55 * scale, 0.3 * scale, 0.55 * scale] });
    // a couple of branch stubs
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + seedRand();
      b.add(P.cyl8, bark, { pos: [Math.cos(a) * 0.3 * scale, trunkH * (0.7 + 0.1 * i), Math.sin(a) * 0.3 * scale], rot: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], scale: [0.09 * scale, 0.7 * scale, 0.09 * scale] });
    }
    // clustered canopy of faceted blobs
    const cy = trunkH + 0.5 * scale;
    const blobs = 5 + Math.floor(seedRand() * 3);
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * Math.PI * 2;
      const rr = (0.35 + seedRand() * 0.5) * scale;
      const s = (0.9 + seedRand() * 0.7) * scale;
      b.add(seedRand() > 0.5 ? P.ico : P.ico1, pick(greens), {
        pos: [Math.cos(a) * rr, cy + (seedRand() - 0.3) * 0.6 * scale, Math.sin(a) * rr],
        rot: [seedRand() * 3, seedRand() * 3, seedRand() * 3], scale: s,
      });
    }
    b.add(P.ico1, pick(greens), { pos: [0, cy + 0.4 * scale, 0], scale: 1.15 * scale });   // crown
  } else { // dead snag
    const trunkH = (1.8 + seedRand() * 0.8) * scale;
    const grey = seedRand() > 0.5 ? 0x6a5a48 : 0x5a4e40;
    b.add(new THREE.CylinderGeometry(0.1 * scale, 0.26 * scale, trunkH, 6), grey, { pos: [0, trunkH * 0.5, 0] });
    b.add(P.cone6, 0x4a3f32, { pos: [0, 0.08 * scale, 0], scale: [0.55 * scale, 0.3 * scale, 0.55 * scale] });
    const branches = 3 + Math.floor(seedRand() * 3);
    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * Math.PI * 2 + seedRand();
      const by = trunkH * (0.45 + seedRand() * 0.45);
      const len = (0.6 + seedRand() * 0.7) * scale;
      const tilt = 0.5 + seedRand() * 0.6;
      b.add(new THREE.CylinderGeometry(0.04 * scale, 0.1 * scale, len, 5), grey, {
        pos: [Math.cos(a) * len * 0.3, by + len * 0.25, Math.sin(a) * len * 0.3],
        rot: [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt], scale: 1,
      });
    }
  }
  return b.toGroup('tree', MATERIALS.flat);
}

/**
 * Landmark monument — replaces the old pylon "towers". A low stepped stone cairn
 * with a glowing beacon crystal on top. ~4 m tall, reads as a waypoint.
 */
export function buildMonument(color = PAL.accent) {
  const group = new THREE.Group();
  group.name = 'monument';
  const b = new PartBuilder();
  // three stone tiers
  b.add(P.box, 0x5a5e63, { pos: [0, 0.3, 0], scale: [2.6, 0.6, 2.6] });
  b.add(P.box, 0x4c5156, { pos: [0, 0.85, 0], scale: [1.9, 0.6, 1.9] });
  b.add(P.box, 0x5f6368, { pos: [0, 1.35, 0], scale: [1.2, 0.5, 1.2] });
  // a short pylon shaft
  b.add(P.cyl8, PAL.steelDark, { pos: [0, 2.0, 0], scale: [0.45, 1.2, 0.45] });
  const grp = b.toGroup('monument', MATERIALS.flat);
  group.add(grp);
  // glowing beacon crystal
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), MATERIALS.emissive(color));
  crystal.name = 'monument.beacon';
  crystal.position.set(0, 3.1, 0);
  group.add(crystal);
  // colour ring band
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.09, 6, 16), MATERIALS.emissive(color));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.5;
  group.add(ring);
  return group;
}

export function buildCrate(size = 1) {
  const b = new PartBuilder();
  b.add(P.box, PAL.rust, { scale: size * 0.96 });
  frameCube(b, size * 0.99, size * 0.1, PAL.steelDark, PAL.iron);
  b.add(P.box, PAL.hazard, { pos: [0, size * 0.1, size * 0.5], scale: [size * 0.5, size * 0.09, size * 0.02] });
  return b.toGroup('crate');
}

export function buildRamp(w = 6, h = 2, d = 8) {
  // A wedge built from a custom BufferGeometry so the collider can match exactly.
  const hw = w / 2, hd = d / 2;
  const v = [
    [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],   // base
    [-hw, h, -hd], [hw, h, -hd],                                // top edge (back is high)
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],       // bottom
    [0, 1, 5], [0, 5, 4],       // back vertical
    [3, 4, 5], [3, 5, 2],       // slope
    [0, 4, 3],                   // left
    [1, 2, 5],                   // right
  ];
  const pos = [];
  for (const f of faces) for (const idx of f) pos.push(...v[idx]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const colors = new Float32Array(pos.length);
  _col.setHex(PAL.steel);
  for (let i = 0; i < pos.length / 3; i++) { colors[i * 3] = _col.r; colors[i * 3 + 1] = _col.g; colors[i * 3 + 2] = _col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(g, MATERIALS.block);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const grp = new THREE.Group();
  grp.add(mesh);
  return { group: grp, vertices: v, faces };
}

/** Thin wire-grid helper used by build mode. */
export function buildGridPlane(size = 24, color = 0x3d6b8c) {
  const g = new THREE.GridHelper(size, size, color, 0x24323e);
  g.material.transparent = true;
  g.material.opacity = 0.32;
  g.material.depthWrite = false;
  return g;
}
