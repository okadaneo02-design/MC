import * as THREE from 'three';
import { MATERIALS, PAL } from '../models/ProceduralModels.js';
import { mulberry32 } from '../world/Noise.js';

/**
 * A free-roam time-trial. A deterministic loop of ring checkpoints is scattered
 * around spawn; drive through the glowing one to advance, complete the lap for a
 * Cog payout scaled by how fast you were. Purely additive — it never touches the
 * driving physics, it just watches the player's position.
 */
const N = 6;            // checkpoints per lap
const PASS_R = 7;       // metres to count as "through" the ring

export class RaceSystem {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group(); this.group.name = 'race';
    game.scene.add(this.group);
    this.rings = [];
    this.active = 0;
    this.lapTime = 0;
    this.started = false;
    this._build();
  }

  _build() {
    const t = this.game.arena;
    const rand = mulberry32((t.seed ^ 0x5ACE) >>> 0);
    const ringGeo = new THREE.TorusGeometry(4, 0.4, 8, 20);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rand() * 0.5;
      const d = 70 + rand() * 120;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = (t.heightAt ? t.heightAt(x, z) : 0) + 4;
      const mesh = new THREE.Mesh(ringGeo, MATERIALS.emissive(0x39c2ff));
      mesh.position.set(x, y, z);
      mesh.rotation.y = a;             // face roughly tangential
      this.group.add(mesh);
      this.rings.push({ x, y, z, mesh });
    }
    this._highlight();
  }

  _highlight() {
    this.rings.forEach((r, i) => {
      const on = i === this.active;
      r.mesh.material = MATERIALS.emissive(on ? 0xffce4a : 0x2a4a66);
      r.mesh.scale.setScalar(on ? 1.15 : 0.9);
    });
  }

  update(dt) {
    const v = this.game.playerVehicle;
    if (!v || !v.built) return;
    if (this.started) this.lapTime += dt;
    const p = v.position;
    const r = this.rings[this.active];
    const dx = p.x - r.x, dz = p.z - r.z, dy = p.y - r.y;
    if (dx * dx + dz * dz + dy * dy < PASS_R * PASS_R) {
      if (!this.started) { this.started = true; this.lapTime = 0; }
      this.active++;
      this.game.audio?.pickup?.();
      if (this.active >= this.rings.length) {
        const reward = Math.max(20, Math.round(260 - this.lapTime * 4));
        this.game.addCogs?.(reward);
        this.game.hud?.toast(`🏁 Lap complete in ${this.lapTime.toFixed(1)}s — +${reward} cogs!`, 'good');
        this.active = 0; this.started = false; this.lapTime = 0;
      } else {
        this.game.hud?.toast(`Checkpoint ${this.active}/${this.rings.length}!`, 'good');
      }
      this._highlight();
    }
  }

  /** Checkpoints for the HUD radar/minimap. */
  markers() { return this.rings.map((r, i) => ({ x: r.x, z: r.z, active: i === this.active })); }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }
}
