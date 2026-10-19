import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'https://unpkg.com/three@0.169.0/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'https://unpkg.com/three@0.169.0/examples/jsm/loaders/MTLLoader.js';

/**
 * Loads the authored .glb props and turns each into a normalized, cell-sized
 * template the BlockRegistry can clone. Everything is preloaded once at boot; if
 * an asset fails to load the block simply falls back to its procedural model, so
 * the game never breaks on a missing file.
 *
 * Per-asset options (see ASSET_MAP):
 *   rot   [x,y,z] radians applied before measuring, so the model faces +Z forward
 *   fit   target size of the largest dimension in cells (default 0.94)
 *   strip [meshName,…] meshes to delete before measuring (e.g. the light
 *         cannon's carriage wheels)
 *   wrap  name of a child the game animates — 'turret.head' (aimer) or
 *         'drill.moving' (spinning tool)
 */

// Authored .glb props → block ids. Single source of truth, shared with props.html.
const PROP_BASE = './assets/props/';
export const ASSET_MAP = {
  structural:   { url: PROP_BASE + 'structural.glb' },
  light_frame:  { url: PROP_BASE + 'light_frame.glb' },
  armor:        { url: PROP_BASE + 'armor.glb' },
  armor_plate:  { url: PROP_BASE + 'armor_plate.glb' },
  // slope sits in a full 1×1×1 cell: scale the original model up uniformly to fill
  // it (no axis distortion), so the ramp reads bigger/taller than the default fit.
  wedge:        { url: PROP_BASE + 'wedge.glb', fit: 1.0 },
  wheel:        { url: PROP_BASE + 'wheel.glb' },
  wheel_giant:  { url: PROP_BASE + 'wheel_giant.glb' },
  wheel_heavy:  { url: PROP_BASE + 'wheel_giant.glb' },   // monster-truck tyre suits the heavy wheel too
  wheel_light:  { url: PROP_BASE + 'wheel_light.glb' },
  wheel_front:  { url: PROP_BASE + 'wheel.glb' },
  // light cannon: barrel modelled pointing -Z, so flip it; strip the carriage
  // wheels; scale up a touch so it reads as a proper gun.
  cannon:       { url: PROP_BASE + 'cannon.glb', fit: 1.32, rot: [0, Math.PI, 0],
                  offset: [0, -0.22, 0],
                  strip: ['mesh733241714_1', 'group729818692', 'group2009397206'] },
  heavy_cannon: { url: PROP_BASE + 'heavy_cannon.glb', rot: [0, -Math.PI / 2, 0] },
  autocannon:   { url: PROP_BASE + 'autocannon.glb', rot: [0, -Math.PI / 2, 0] },
  scattergun:   { url: PROP_BASE + 'scattergun.glb' },
  minigun:      { url: PROP_BASE + 'minigun.glb' },
  flak:         { url: PROP_BASE + 'flak.glb', rot: [0, Math.PI / 2, 0] },   // barrel runs along X → turn to +Z so the 2-cell length is correct
  turret:       { url: PROP_BASE + 'turret.glb', wrap: 'turret.head' },
  heavy_turret: { url: PROP_BASE + 'heavy_turret.glb', wrap: 'turret.head' },
  turret_rail:  { url: PROP_BASE + 'turret_rail.glb', wrap: 'turret.head' },
  hammer:       { url: PROP_BASE + 'hammer.glb', wrap: 'drill.moving' },
  buzzsaw:      { url: PROP_BASE + 'buzzsaw.glb', wrap: 'drill.moving' },
  drill:        { url: PROP_BASE + 'drill.glb', wrap: 'drill.moving', rot: [0, Math.PI, 0] },
  spikeball:    { url: PROP_BASE + 'spikeball.glb', wrap: 'drill.moving' },
  // spike modelled pointing +Y (up); tip it forward (+Z) so it rams straight.
  ram:          { url: PROP_BASE + 'ram.glb', rot: [Math.PI / 2, 0, 0] },
  // ---- mobility ----
  // a proper pre-built track; scale it uniformly (no distortion) to fill the
  // tread block's long 1×1×4 footprint.
  tread:        { url: PROP_BASE + 'tread.glb', uniformSize: true },
  // ---- power / utility ----
  // combustion engine: 1-cell block, mesh scaled up UNIFORMLY (no stretch) to
  // span ~2 blocks, nudged backward so it sits as [ ][ ] over its cells.
  engine:       { url: PROP_BASE + 'engine.glb', fit: 2.0, offset: [0, 0, -0.5] },
  engine_v6:    { url: PROP_BASE + 'v8_src/2GR.obj', mtl: PROP_BASE + 'v8_src/2GR.mtl', fit: 1.4, offset: [0, -0.18, 0] },   // the V8 mesh, scaled up in one cell
  reactor:      { url: PROP_BASE + 'reactor.glb' },
  // gyros: one shared mesh, tinted per strength tier
  gyroscope:    { url: PROP_BASE + 'gyroscope.glb', tint: 0x4fa8ff, rot: [0, Math.PI / 2, 0] },   // blue (default)
  gyro_small:   { url: PROP_BASE + 'gyroscope.glb', tint: 0x5fd07a, rot: [0, Math.PI / 2, 0] },   // green
  gyro_large:   { url: PROP_BASE + 'gyroscope.glb', tint: 0xff5a4a, rot: [0, Math.PI / 2, 0] },   // red
  gyro_array:   { url: PROP_BASE + 'gyroscope.glb', tint: 0xb060ff, rot: [0, Math.PI / 2, 0] },   // purple
  thruster:     { url: PROP_BASE + 'thruster.glb' },
  battery:      { url: PROP_BASE + 'battery.glb' },
  solar:        { url: PROP_BASE + 'solar.glb', rot: [0, -Math.PI / 2, 0] },
  // solar array = the solar panel, blue cells recoloured green (grey frame kept)
  solar_array:  { url: PROP_BASE + 'solar.glb', rot: [0, -Math.PI / 2, 0], recolor: 'blue2green' },
  engine_light: { url: PROP_BASE + 'engine_light.glb' },
  engine_turbo: { url: PROP_BASE + 'engine_turbo.glb' },
  // shield + repair use their procedural models (the shield.glb was mis-oriented).
  // railgun turret (new mesh); aims via the head wrap like the others.
  turret_rail:  { url: PROP_BASE + 'turret_rail.glb', wrap: 'turret.head' },
  // balloon off-road tyre.
  wheel_balloon: { url: PROP_BASE + 'wheel_balloon.glb' },
  // bulkhead = the heavy-block mesh, darkened.
  bulkhead:     { url: PROP_BASE + 'armor.glb', darken: 0.5 },
  // steel beam: authored ~3 units along X — stand it along Z and scale uniformly,
  // so the 1 / 2 / 3-cell versions are just the same beam made shorter.
  beam:         { url: PROP_BASE + 'steel_beam.glb', rot: [0, Math.PI / 2, 0], beam: true },
  beam_2:       { url: PROP_BASE + 'steel_beam.glb', rot: [0, Math.PI / 2, 0], beam: true },
  beam_3:       { url: PROP_BASE + 'steel_beam.glb', rot: [0, Math.PI / 2, 0], beam: true },
};

const _templates = new Map();   // block id -> THREE.Group template
const _loader = new GLTFLoader();

/** A point + outward normal on a stadium (rounded-rectangle) loop in the Y-Z plane. */
function stadiumAt(a, R, sh) {
  const straight = 2 * sh, arc = Math.PI * R;
  const P = 2 * straight + 2 * arc;
  a = ((a % P) + P) % P;
  if (a < straight) { const t = a; return { z: -sh + t, y: R, nz: 0, ny: 1 }; }          // top run
  a -= straight;
  if (a < arc) { const f = a / R; return { z: sh + R * Math.sin(f), y: R * Math.cos(f), nz: Math.sin(f), ny: Math.cos(f) }; } // right cap
  a -= arc;
  if (a < straight) { const t = a; return { z: sh - t, y: -R, nz: 0, ny: -1 }; }          // bottom run
  a -= straight;
  const f = a / R; return { z: -sh - R * Math.sin(f), y: -R * Math.cos(f), nz: -Math.sin(f), ny: -Math.cos(f) }; // left cap
}

/** Bend a long flat strip into a closed belt around two wheels (the (====) shape). */
function wrapStripToBelt(scene, belt) {
  // Bake every node's world transform into its geometry, then zero all transforms,
  // so vertex positions are plain world coords (no hidden scale to fight).
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.applyMatrix4(o.matrixWorld); meshes.push(o); } });
  scene.traverse((o) => { o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); });
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const ax = ['x', 'y', 'z'];
  const longAxis = ax[[size.x, size.y, size.z].indexOf(Math.max(size.x, size.y, size.z))];
  const rest = ax.filter((a) => a !== longAxis);
  const widthAxis = size[rest[0]] >= size[rest[1]] ? rest[0] : rest[1];
  const thickAxis = widthAxis === rest[0] ? rest[1] : rest[0];
  const P = 2 * (2 * belt.sh) + 2 * Math.PI * belt.R;
  const lMin = box.min[longAxis], lLen = size[longAxis] || 1;
  const wMid = (box.min[widthAxis] + box.max[widthAxis]) / 2, wLen = size[widthAxis] || 1;
  const tMid = (box.min[thickAxis] + box.max[thickAxis]) / 2, tLen = size[thickAxis] || 1;

  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lv = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
      const s = (lv[longAxis] - lMin) / lLen;
      const wdt = ((lv[widthAxis] - wMid) / wLen) * belt.width;
      const thk = ((lv[thickAxis] - tMid) / tLen) * belt.thick;
      const p = stadiumAt(s * P, belt.R, belt.sh);
      pos.setXYZ(i, wdt, p.y + thk * p.ny, p.z + thk * p.nz);   // X=across, Y/Z=loop
    }
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
  }
}

// Cache so a texture shared across meshes is only recoloured once.
const _texCache = new Map();
/** Return a copy of a texture with blue pixels turned green (grey/metal untouched). */
function swapBlueGreenTexture(tex) {
  if (!tex) return tex;
  if (_texCache.has(tex)) return _texCache.get(tex);
  const img = tex.image;
  if (!img || !img.width) return tex;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  try {
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    const p = data.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      if (b > g && b > r) { p[i + 1] = b; p[i + 2] = g; }   // bluish → swap G/B = green
    }
    ctx.putImageData(data, 0, 0);
  } catch (e) { return tex; }   // tainted canvas etc. — fall back to original
  const nt = new THREE.CanvasTexture(cv);
  nt.flipY = tex.flipY; nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT;
  nt.colorSpace = tex.colorSpace; nt.needsUpdate = true;
  _texCache.set(tex, nt);
  return nt;
}

function buildTemplate(scene, opts = {}) {
  if (opts.belt) wrapStripToBelt(scene, opts.belt);
  // Drop unwanted meshes (e.g. the light cannon's wheels) before measuring, so
  // centring and scaling are based on what actually remains.
  if (opts.strip && opts.strip.length) {
    const kill = [];
    scene.traverse((o) => { if (o.isMesh && opts.strip.includes(o.name)) kill.push(o); });
    for (const m of kill) m.removeFromParent();
  }

  // Authored meshes are single-sided, which makes thin / inward-facing faces
  // look see-through. Force double-sided and make sure nothing is stuck
  // translucent, then enable shadows.
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < mats.length; i++) {
      let m = mats[i];
      if (!m) continue;
      // blue→green recolour (repair reuses the shield model, tinted green): clone
      // the material so the shared source isn't mutated, then swap G/B on any
      // bluish channel. Grey/metal (r≈g≈b) is left untouched.
      if (opts.recolor === 'blue2green') {
        m = m.clone();
        if (m.color && m.color.b > m.color.g) { const t = m.color.g; m.color.g = m.color.b; m.color.b = t; }
        if (m.emissive && m.emissive.b > m.emissive.g) { const t = m.emissive.g; m.emissive.g = m.emissive.b; m.emissive.b = t; }
        // Most of the blue lives in the texture (solar panel) — recolour the map too.
        if (m.map) m.map = swapBlueGreenTexture(m.map);
        if (m.emissiveMap) m.emissiveMap = swapBlueGreenTexture(m.emissiveMap);
        if (Array.isArray(o.material)) o.material[i] = m; else o.material = m;
      }
      // Recolour the whole model to a tier colour, keeping each material's own
      // light/dark shading (used to tint the shared gyro mesh per strength tier).
      if (opts.tint != null && m.color) {
        m = m.clone();
        const tr = ((opts.tint >> 16) & 255) / 255, tg = ((opts.tint >> 8) & 255) / 255, tb = (opts.tint & 255) / 255;
        const lum = THREE.MathUtils.clamp((m.color.r + m.color.g + m.color.b) / 3 * 1.6, 0.18, 1);
        m.color.setRGB(tr * lum, tg * lum, tb * lum);
        if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05) m.emissive.setRGB(tr * 0.5, tg * 0.5, tb * 0.5);
        if (Array.isArray(o.material)) o.material[i] = m; else o.material = m;
      }
      // Darken every material (e.g. bulkhead = a darker heavy block).
      if (opts.darken != null && m.color) {
        m = m.clone();
        m.color.multiplyScalar(opts.darken);
        if (Array.isArray(o.material)) o.material[i] = m; else o.material = m;
      }
      m.side = THREE.DoubleSide;
      if (m.transparent && m.opacity >= 1) m.transparent = false;
      m.depthWrite = true;
    }
  });

  if (opts.rot) scene.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // Fit mode:
  //  belt  → already true-sized, don't refit
  //  beam  → fit the CROSS-section to a cell; length then scales per-block (shorten)
  //  else  → uniform fit so the largest dim = `fit` (one cell)
  let s;
  if (opts.belt) s = 1;
  else if (opts.beam) s = 0.7 / (Math.max(size.x, size.y) || 1);   // beam runs along Z; fit its X/Y cross-section
  else s = (opts.fit ?? 0.94) / maxDim;
  if (!opts.belt) scene.position.set(-ctr.x, -ctr.y, -ctr.z);

  const scaler = new THREE.Group();
  scaler.scale.setScalar(s);
  // Per-axis stretch on top of the uniform fit (e.g. make the slope taller on Y).
  if (opts.postScale) scaler.scale.set(s * opts.postScale[0], s * opts.postScale[1], s * opts.postScale[2]);
  scaler.add(scene);
  // Nudge the whole model within its cell (e.g. drop the light cannon down).
  if (opts.offset) scaler.position.set(opts.offset[0], opts.offset[1], opts.offset[2]);

  const outer = new THREE.Group();
  outer.name = 'glb';
  if (opts.wrap) {
    const w = new THREE.Group();
    w.name = opts.wrap;
    w.add(scaler);
    outer.add(w);
  } else {
    outer.add(scaler);
  }
  // Record the fitted bounding size so createAssetModel can grow a multi-cell
  // block uniformly to fit WITHIN its footprint (never stretching).
  outer.updateMatrixWorld(true);
  const fit = new THREE.Box3().setFromObject(outer).getSize(new THREE.Vector3());
  outer.userData.fitExtent = [fit.x || 1, fit.y || 1, fit.z || 1];
  if (opts.belt) outer.userData.noSizeScale = true;   // belt is pre-sized to its footprint
  if (opts.beam) outer.userData.beamUnitLen = fit.z || 1;   // length (Z) of the beam at scale 1
  if (opts.fillLong) outer.userData.fillLong = true;   // grow uniformly to fill the longest footprint axis
  return outer;
}

/** Load a .glb (default) or .obj (+ optional .mtl) and return its scene group. */
async function loadScene(entry) {
  if (entry.url.toLowerCase().endsWith('.obj')) {
    const objLoader = new OBJLoader();
    if (entry.mtl) {
      const mats = await new MTLLoader().loadAsync(entry.mtl);
      mats.preload();
      objLoader.setMaterials(mats);
    }
    return objLoader.loadAsync(entry.url);   // OBJLoader resolves to a Group
  }
  const gltf = await _loader.loadAsync(entry.url);
  return gltf.scene;
}

/** Preload a map of { id: {url, fit?, rot?, strip?, wrap?, mtl?} }. Never rejects. */
export async function preloadModels(map = ASSET_MAP, onProgress) {
  const ids = Object.keys(map);
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    try {
      const scene = await loadScene(map[id]);
      _templates.set(id, buildTemplate(scene, map[id]));
    } catch (e) {
      console.warn(`[models] "${id}" failed to load, using procedural fallback:`, e.message || e);
    }
    done++;
    if (onProgress) onProgress(done / ids.length, id);
  }));
}

export function hasModel(id) { return _templates.has(id); }

/** A fresh clone of a loaded template, or null if not loaded.
 *  `size` is the block's cell footprint [x,y,z]. Multi-cell blocks are scaled
 *  UNIFORMLY (never stretched) so the model keeps its natural proportions and
 *  simply grows to fill its footprint's longest axis.
 *  Exception: a `beam`-mode template stretches only along its length so the 1/2/3
 *  versions are the same beam cut shorter, not shrunk. */
export function createAssetModel(id, size) {
  const t = _templates.get(id);
  if (!t) return null;
  const m = t.clone(true);
  if (t.userData.noSizeScale || !size) return m;
  const maxCell = Math.max(size[0], size[1], size[2]);
  if (t.userData.beamUnitLen) {
    m.scale.set(1, 1, size[2] / t.userData.beamUnitLen);   // shorten, keep cross-section
  } else if (t.userData.fillLong) {
    // grow UNIFORMLY (no stretch) until the model spans the footprint's longest
    // axis — a boxy 1×1×2 engine becomes ~2 long and proportionally bigger.
    const e = t.userData.fitExtent || [1, 1, 1];
    m.scale.setScalar((maxCell * 0.98) / Math.max(e[0], e[1], e[2]));
  } else if (maxCell !== 1) {
    // uniform grow to the largest scale that still fits within the footprint box
    const e = t.userData.fitExtent || [1, 1, 1];
    const s = Math.min((size[0] * 0.98) / e[0], (size[1] * 0.98) / e[1], (size[2] * 0.98) / e[2]);
    m.scale.setScalar(s);
  }
  return m;
}
