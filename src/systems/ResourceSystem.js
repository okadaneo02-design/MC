import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS } from '../core/PhysicsWorld.js';
import { MATERIALS, PAL, PartBuilder, PRIMS } from '../models/ProceduralModels.js';
import { mulberry32 } from '../world/Noise.js';
import BlockRegistry from '../vehicles/BlockRegistry.js';

/**
 * Mineable resource deposits.
 *
 * Deposits are physical nodes with health. A drill or weapon that actually
 * touches one (the ray/contact carries a `{kind:'resource'}` collider meta) calls
 * hit(); accumulated damage depletes the node, which pays out its material and a
 * few ready-to-use blocks straight into the inventory — so mining feeds building,
 * which is the whole point of the loop.
 */

export const RESOURCES = {
  scrap:   { name: 'Scrap', color: PAL.rust, hp: 120, yield: 6, blocks: { structural: 3, armor_plate: 1 }, biomes: ['grassland', 'hills', 'desert', 'rocky'] },
  iron:    { name: 'Iron', color: 0x9aa4ad, hp: 220, yield: 5, blocks: { armor: 1, structural: 2 }, biomes: ['rocky', 'mountains'] },
  copper:  { name: 'Copper', color: PAL.copper, hp: 180, yield: 4, blocks: { wheel: 1, drill: 1 }, biomes: ['hills', 'rocky', 'desert'] },
  crystal: { name: 'Energy Crystal', color: 0x7fe0ff, hp: 300, yield: 3, blocks: { engine: 1, cannon: 1 }, biomes: ['mountains', 'rocky'] },
  titanium: { name: 'Titanium', color: 0xcfd6dd, hp: 360, yield: 3, blocks: { armor: 2, light_frame: 1 }, biomes: ['mountains'] },
  gold:     { name: 'Gold', color: 0xe8c23a, hp: 240, yield: 4, blocks: { battery: 1, solar: 1 }, biomes: ['desert', 'hills'] },
  oil:      { name: 'Oil', color: 0x2a2320, hp: 200, yield: 6, blocks: { engine_light: 1, wheel: 1 }, biomes: ['grassland', 'desert'] },
  plasma:   { name: 'Plasma Core', color: 0xff6ad5, hp: 420, yield: 2, blocks: { shield: 1, autocannon: 1 }, biomes: ['mountains', 'rocky'] },
};

export class ResourceSystem {
  constructor(game) {
    this.game = game;
    this.nodes = [];
    this.group = new THREE.Group();
    this.group.name = 'resources';
    game.scene.add(this.group);
  }

  /** Scatter deposits deterministically across the terrain by biome. */
  populate(terrain, count = 46) {
    const rand = mulberry32((terrain.seed ^ 0xC0FFEE) >>> 0);
    const keys = Object.keys(RESOURCES);
    let placed = 0, attempts = 0;
    while (placed < count && attempts < count * 12) {
      attempts++;
      const x = (rand() - 0.5) * (terrain.size - 70);
      const z = (rand() - 0.5) * (terrain.size - 70);
      if (Math.hypot(x, z) < 24) continue;            // not on top of spawn
      const biome = terrain.biomeAt(x, z);
      // weight resource choice by biome fit
      const fit = keys.filter((k) => RESOURCES[k].biomes.includes(biome));
      const pool = fit.length ? fit : ['scrap'];
      const type = pool[Math.floor(rand() * pool.length)];
      const y = terrain.heightAt(x, z);
      this._spawnNode(type, x, y, z, rand);
      placed++;
    }
    return this;
  }

  _spawnNode(type, x, y, z, rand) {
    const def = RESOURCES[type];
    const scale = 0.9 + rand() * 0.6;
    const b = new PartBuilder();
    // ore boulder base
    b.add(PRIMS.sphLo, PAL.rock, { pos: [0, 0.3 * scale, 0], scale: [1.5 * scale, 1.1 * scale, 1.5 * scale] });
    // crystalline / ore shards in the resource colour
    const shards = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + rand();
      const r = 0.4 * scale + rand() * 0.3;
      b.add(type === 'crystal' ? PRIMS.cone12 : PRIMS.box, def.color, {
        pos: [Math.cos(a) * r, (0.5 + rand() * 0.7) * scale, Math.sin(a) * r],
        rot: [rand() * 0.8, a, rand() * 0.8],
        scale: [0.28 * scale, (0.5 + rand() * 0.6) * scale, 0.28 * scale],
      });
    }
    const mesh = new THREE.Mesh(b.bake(), MATERIALS.block);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);

    // faint glow for crystals so they read at distance
    let glow = null;
    if (type === 'crystal') {
      glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), MATERIALS.emissive(def.color));
      glow.position.set(x, y + 1.1 * scale, z);
      this.group.add(glow);
    }

    const world = this.game.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.2 * scale, 1.0 * scale, 1.2 * scale)
        .setTranslation(x, y + 0.9 * scale, z)
        .setCollisionGroups(GROUPS.resource),
      body,
    );
    const node = {
      type, x, y, z, def, mesh, glow, body, col,
      hp: def.hp, maxHp: def.hp, dead: false,
    };
    this.game.physics.registerCollider(col, { kind: 'resource', node });
    this.nodes.push(node);
    return node;
  }

  /** Called by weapons/drill when they strike a resource collider. */
  hit(meta, amount, point) {
    const node = meta.node;
    if (!node || node.dead) return;
    node.hp -= amount;
    this.game.effects?.impact(point || node, { x: 0, y: 1, z: 0 }, node.def.color);
    // shrink to telegraph depletion
    const s = Math.max(0.35, node.hp / node.maxHp);
    node.mesh.scale.setScalar(s);
    if (node.glow) node.glow.scale.setScalar(s);
    if (node.hp <= 0) this._deplete(node);
  }

  _deplete(node) {
    node.dead = true;
    const def = node.def;
    // material tally (HUD flavour / score)
    this.game.addMaterial?.(node.type, def.yield);
    // blocks straight into the inventory
    const parts = [];
    for (const [id, n] of Object.entries(def.blocks)) {
      this.game.inventory?.add(id, n);
      parts.push(`${n}× ${this._shortName(id)}`);
    }
    this.game.effects?.explosion(node, 0.6, def.color);
    this.game.hud?.toast(`Mined ${def.name}: ${parts.join(', ')}`, 'good');
    this.game.audio?.pickup();
    this._remove(node);
  }

  _shortName(id) {
    return BlockRegistry.get(id)?.name || id.replace('_', ' ');
  }

  _remove(node) {
    const i = this.nodes.indexOf(node);
    if (i >= 0) this.nodes.splice(i, 1);
    if (node.col) this.game.physics.unregisterCollider(node.col);
    if (node.body) this.game.physics.removeBody(node.body);
    node.mesh?.removeFromParent();
    node.mesh?.geometry?.dispose();
    node.glow?.removeFromParent();
  }

  /** Nearest live node to a point, within range (for HUD/radar). */
  nearest(x, z, range = Infinity) {
    let best = null, bd = range * range;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  dispose() {
    for (const n of [...this.nodes]) this._remove(n);
    this.nodes.length = 0;
    this.group.removeFromParent();
  }
}
