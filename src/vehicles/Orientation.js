import * as THREE from 'three';

/**
 * The 24 axis-aligned orientations of a cube.
 *
 * Blocks store an integer index into this table, which keeps blueprints compact
 * and makes serialisation stable across versions (the table is generated in a
 * fixed deterministic order).
 */

function buildTable() {
  const quats = [];
  const seen = new Set();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix3();
  const m4 = new THREE.Matrix4();
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        e.set(x * Math.PI / 2, y * Math.PI / 2, z * Math.PI / 2, 'XYZ');
        q.setFromEuler(e);
        m4.makeRotationFromQuaternion(q);
        m.setFromMatrix4(m4);
        const key = Array.from(m.elements).map((v) => Math.round(v)).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        // Re-derive an exact quaternion from the rounded matrix so there is no drift.
        const el = Array.from(m.elements).map((v) => Math.round(v));
        const mm = new THREE.Matrix4().set(
          el[0], el[3], el[6], 0,
          el[1], el[4], el[7], 0,
          el[2], el[5], el[8], 0,
          0, 0, 0, 1,
        );
        quats.push(new THREE.Quaternion().setFromRotationMatrix(mm));
      }
    }
  }
  return quats;
}

export const ORIENTATIONS = buildTable();          // length 24
export const ORIENT_MATRICES = ORIENTATIONS.map((q) => new THREE.Matrix4().makeRotationFromQuaternion(q));

const _v = new THREE.Vector3();

/** Rotate an integer local direction by orientation index. Returns a new [x,y,z]. */
export function rotateDir(dir, orient) {
  _v.set(dir[0], dir[1], dir[2]).applyMatrix4(ORIENT_MATRICES[orient]);
  return [Math.round(_v.x), Math.round(_v.y), Math.round(_v.z)];
}

/** Rotate an integer local offset (cells) by orientation index. */
export const rotateOffset = rotateDir;

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** Index of the orientation closest to a quaternion. */
export function indexOfQuaternion(q) {
  let best = 0, bestDot = -Infinity;
  for (let i = 0; i < ORIENTATIONS.length; i++) {
    const d = Math.abs(ORIENTATIONS[i].dot(q));
    if (d > bestDot) { bestDot = d; best = i; }
  }
  return best;
}

/** Compose: apply a 90° turn about `axis` ('x'|'y'|'z') on top of orientation `orient`. */
export function rotateOrientation(orient, axis, steps = 1) {
  const ax = axis === 'x' ? new THREE.Vector3(1, 0, 0)
    : axis === 'y' ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
  _qa.setFromAxisAngle(ax, (Math.PI / 2) * steps);
  _qb.copy(_qa).multiply(ORIENTATIONS[orient]);
  return indexOfQuaternion(_qb);
}

/**
 * Mirror an orientation across a plane whose normal is `axis`.
 * Conjugating a rotation by a reflection yields another proper rotation, so the
 * result is always one of the 24 table entries — this is what symmetry mode uses.
 */
export function mirrorOrientation(orient, axis = 'x') {
  const s = [axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1];
  const M = new THREE.Matrix4().makeScale(s[0], s[1], s[2]);
  const R = new THREE.Matrix4().makeRotationFromQuaternion(ORIENTATIONS[orient]);
  const out = new THREE.Matrix4().multiplyMatrices(M, R).multiply(M);
  const q = new THREE.Quaternion().setFromRotationMatrix(out);
  return indexOfQuaternion(q);
}

/**
 * Mirror the orientation of a block that bolts on through a single mount face.
 *
 * Plain conjugation (mirrorOrientation) mirrors the block's *shape* correctly,
 * but a reflection is improper, so the leftover 180° can leave the mount face
 * pointing away from the hull. For these blocks the mount direction is what
 * matters, so mirror that directly and pick an orientation that achieves it.
 */
export function mirrorMountOrientation(orient, mountFace, axis = 'x') {
  const d = rotateDir(mountFace, orient);
  const mirrored = [
    axis === 'x' ? -d[0] : d[0],
    axis === 'y' ? -d[1] : d[1],
    axis === 'z' ? -d[2] : d[2],
  ];
  const o = orientationMapping(mountFace, mirrored);
  return o >= 0 ? o : mirrorOrientation(orient, axis);
}

/** The six unit face directions, in a fixed order. */
export const FACES = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

export const FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

export function faceIndex(dir) {
  for (let i = 0; i < FACES.length; i++) {
    const f = FACES[i];
    if (f[0] === dir[0] && f[1] === dir[1] && f[2] === dir[2]) return i;
  }
  return -1;
}

/**
 * Find an orientation index that maps the block's local `mountFace` onto the
 * world direction `target`. Used so wheels/parts auto-align to the face you click.
 * Returns -1 if none (never happens for axis-aligned inputs).
 */
export function orientationMapping(mountFace, target, preferUp = [0, 1, 0]) {
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < ORIENTATIONS.length; i++) {
    const d = rotateDir(mountFace, i);
    if (d[0] !== target[0] || d[1] !== target[1] || d[2] !== target[2]) continue;
    // Among the 4 valid rolls prefer the one that keeps local +Y nearest world up.
    const up = rotateDir([0, 1, 0], i);
    const score = up[0] * preferUp[0] + up[1] * preferUp[1] + up[2] * preferUp[2];
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
