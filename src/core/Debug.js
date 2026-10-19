import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/** F3 overlay: live counters plus an optional Rapier collision wireframe. */
export class DebugOverlay {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('debug-overlay');
    this.visible = false;
    this.showColliders = false;

    this.frames = 0;
    this.fps = 0;
    this._acc = 0;
    this._frameMs = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  attach(scene) { scene.add(this.lines); }

  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
    if (!this.visible) { this.showColliders = false; this.lines.visible = false; }
  }
  toggleColliders() {
    if (!this.visible) return;
    this.showColliders = !this.showColliders;
    this.lines.visible = this.showColliders;
  }

  frame(dt, frameMs) {
    this.frames++;
    this._acc += dt;
    this._frameMs = this._frameMs * 0.9 + frameMs * 0.1;
    if (this._acc >= 0.5) {
      this.fps = this.frames / this._acc;
      this.frames = 0; this._acc = 0;
    }
    if (!this.visible) return;

    if (this.showColliders) this._updateColliderLines();
    this._render();
  }

  _updateColliderLines() {
    const buffers = this.game.physics.world.debugRender();
    this.lines.geometry.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
    this.lines.geometry.setAttribute('color', new THREE.BufferAttribute(colorsFromRapier(buffers.colors), 3));
  }

  _render() {
    const g = this.game;
    const r = g.renderer.info;
    const p = g.physics.stats();
    const v = g.playerVehicle;
    const s = v ? v.grid.stats() : null;
    const mem = performance.memory
      ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB JS heap\n` : '';

    const warn = [];
    if (this.fps < 45) warn.push('low framerate');
    if (p.stepMs > 9) warn.push('physics step over budget');

    this.el.textContent =
      `MACHINECRAFT · debug  (F3 toggle · F4 colliders)\n` +
      `fps          ${this.fps.toFixed(1)}   frame ${this._frameMs.toFixed(1)} ms\n` +
      `physics      ${p.stepMs.toFixed(2)} ms/step @ ${(1 / g.physics.world.timestep).toFixed(0)} Hz  (steps ${g.physics.stepCount})\n` +
      `draw calls   ${r.render.calls}   tris ${r.render.triangles}\n` +
      `rigid bodies ${p.bodies}   colliders ${p.colliders}   joints ${p.joints}\n` +
      `vehicles     ${g.vehicles.length}   assemblies ${g.vehicles.reduce((a, x) => a + x.assemblies.length, 0)}\n` +
      (s ? `player       ${s.blocks} blocks · ${s.mass.toFixed(0)} kg · ${s.wheels} wheels (${v.telemetry.grounded} down)\n` : '') +
      (v ? `position     ${fmtVec(v.worldPosition(_v))}\n` : '') +
      `world seed   ${g.seed}\n` +
      `mode         ${g.mode}${g.paused ? ' (paused)' : ''}\n` +
      mem +
      (warn.length ? `\n! ${warn.join(' · ')}` : '');
  }
}

const _v = new THREE.Vector3();
const fmtVec = (v) => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;

/** Rapier debug colours are RGBA floats; Three wants RGB. */
function colorsFromRapier(rgba) {
  const out = new Float32Array((rgba.length / 4) * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2];
  }
  return out;
}
