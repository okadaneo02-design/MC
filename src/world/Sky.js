import * as THREE from 'three';

/**
 * Procedural sky + image-based lighting.
 *
 * Metallic PBR surfaces are almost black without something to reflect, so the
 * same generated gradient is used as both the scene background and (through
 * PMREM) its environment map. No HDR files, no external assets.
 */

const SKY_W = 128;
const SKY_H = 64;

function lerp(a, b, t) { return a + (b - a) * t; }

export function createSkyTexture({
  zenith = [0x3f, 0x92, 0xd8],      // bright azure
  horizon = [0xcf, 0xe9, 0xf6],     // pale sky blue
  ground = [0x6a, 0x8f, 0x4c],      // green haze
  sunDir = new THREE.Vector3(48, 70, 30).normalize(),
  sunColor = [0xff, 0xf2, 0xcf],
} = {}) {
  const data = new Uint8Array(SKY_W * SKY_H * 4);
  const dir = new THREE.Vector3();

  for (let y = 0; y < SKY_H; y++) {
    // equirectangular: v = 0 at +Y (zenith), 1 at -Y (nadir)
    const v = (y + 0.5) / SKY_H;
    const phi = v * Math.PI;
    for (let x = 0; x < SKY_W; x++) {
      const u = (x + 0.5) / SKY_W;
      const theta = u * Math.PI * 2;
      dir.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );

      let r, g, b;
      if (dir.y >= 0) {
        const t = Math.pow(dir.y, 0.55);
        r = lerp(horizon[0], zenith[0], t);
        g = lerp(horizon[1], zenith[1], t);
        b = lerp(horizon[2], zenith[2], t);
      } else {
        const t = Math.pow(-dir.y, 0.7);
        r = lerp(horizon[0], ground[0], t);
        g = lerp(horizon[1], ground[1], t);
        b = lerp(horizon[2], ground[2], t);
      }

      // warm sun bloom so highlights have somewhere to come from
      const d = Math.max(0, dir.dot(sunDir));
      const glow = Math.pow(d, 48) * 1.0 + Math.pow(d, 6) * 0.22;
      r = Math.min(255, r + sunColor[0] * glow);
      g = Math.min(255, g + sunColor[1] * glow);
      b = Math.min(255, b + sunColor[2] * glow);

      const i = (y * SKY_W + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, SKY_W, SKY_H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Install sky + IBL on a scene. Returns a dispose function. */
export function installSky(renderer, scene, opts = {}) {
  const tex = createSkyTexture(opts);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  scene.environment = rt.texture;
  scene.environmentIntensity = opts.intensity ?? 1.15;
  scene.background = tex;
  scene.backgroundIntensity = 1.0;
  pmrem.dispose();

  /** Horizon colour, so fog blends into the sky instead of cutting a band. */
  const horizon = opts.horizon || [0xcf, 0xe9, 0xf6];
  const fogColor = new THREE.Color(
    horizon[0] / 255, horizon[1] / 255, horizon[2] / 255,
  ).convertSRGBToLinear();

  return {
    fogColor,
    dispose() { tex.dispose(); rt.dispose(); scene.environment = null; scene.background = null; },
  };
}
