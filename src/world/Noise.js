/**
 * Tiny deterministic value-noise toolkit. Everything is driven by an integer
 * seed so a given seed always rebuilds the exact same world — no Math.random.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic hash of two integer lattice coords + seed -> [0,1). */
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth value noise in [0,1] at continuous (x,z). */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const v00 = hash2(ix, iz, seed);
  const v10 = hash2(ix + 1, iz, seed);
  const v01 = hash2(ix, iz + 1, seed);
  const v11 = hash2(ix + 1, iz + 1, seed);
  const ux = fade(fx), uz = fade(fz);
  return lerp(lerp(v00, v10, ux), lerp(v01, v11, ux), uz);
}

/** Fractal Brownian motion: layered value noise, returns [0,1]. */
export function fbm(x, z, seed, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise for sharp mountain crests, returns [0,1]. */
export function ridged(x, z, seed, octaves = 4) {
  let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise(x * freq, z * freq, seed + o * 2003) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5; freq *= 2.0;
  }
  return sum / norm;
}

export const smoothstep = (edge0, edge1, x) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
