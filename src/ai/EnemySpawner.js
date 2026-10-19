import * as THREE from 'three';
import { VehicleGrid } from '../vehicles/VehicleGrid.js';
import { EnemyAI } from './EnemyAI.js';
import { ARCHETYPES, pickArchetype, pickVariant, BOSS_LIST } from './EnemyBlueprints.js';
import { mulberry32 } from '../world/Arena.js';

// Each archetype belongs to a faction. Different factions are hostile to each
// other AND to the player, so you'll come across rival machines fighting on their own.
const ARCH_FACTION = {
  scout: 'marauders', raider: 'marauders', gunner: 'marauders', spinner: 'marauders',
  miner: 'gearworks', artillery: 'gearworks',
  bruiser: 'ironclad', flakwagon: 'ironclad', crusher: 'ironclad',
  engineer: 'volt', sniper: 'volt', zapper: 'volt', siphon: 'volt',
  burner: 'marauders',
  crusher: 'ironclad', thunderhead: 'volt',
  trader: 'neutral',   // Freewheel Collective — roams, won't fight
};

/**
 * Spawns and manages AI enemies. Keeps a target population alive within a ring
 * around the player, spawns at safe distances on valid ground, and scales
 * difficulty with how far the player has roamed rather than inflating health.
 */
export class EnemyManager {
  constructor(game, { seed = 1 } = {}) {
    this.game = game;
    this.rand = mulberry32(seed ^ 0xE1E1);
    this.enemies = [];
    this.disabledWrecks = [];
    this.maxActive = 4;
    this.spawnTimer = 3;
    this.minDist = 55;
    this.maxDist = 95;
    this.kills = 0;
    this._nextBossAt = 8;   // first boss after 8 kills, then every ~12
  }

  get tier() {
    // difficulty grows with player LEVEL, distance from origin, and kills
    const d = this.game.playerVehicle ? this.game.playerVehicle.position.length() : 0;
    const lvl = this.game.level || 1;
    return Math.min(5, 1 + Math.floor((lvl - 1) / 2) + Math.floor(d / 160) + Math.floor(this.kills / 5));
  }

  update(dt) {
    // tick AI
    for (const v of this.enemies) if (v.ai) v.ai.update(dt);

    // maintain population
    this.spawnTimer -= dt;
    const active = this.enemies.filter((v) => !v.disabled).length;
    if (active < this.maxActive && this.spawnTimer <= 0) {
      this.spawnTimer = 5 + this.rand() * 6;
      this.spawnOne();
    }

    // boss event: once you've proven yourself, a boss rolls in (one at a time)
    if (BOSS_LIST.length && this.kills >= this._nextBossAt && this.tier >= 2 && !this._bossAlive()) {
      this._nextBossAt = this.kills + 12;
      this.spawnBoss();
    }

    // cull far-away disabled wrecks that the player ignored for a long time
    this._cullFar();
  }

  _bossAlive() { return this.enemies.some((v) => v.isBoss && !v.disabled); }

  /** Spawn a boss machine with a dramatic announcement. */
  spawnBoss() {
    const id = BOSS_LIST[Math.floor(this.rand() * BOSS_LIST.length)];
    const v = this.spawnOne({ archetype: id });
    if (v) {
      v.isBoss = true;
      this.game.hud?.toast(`⚠ ${ARCHETYPES[id].name} has entered the region!`, 'bad');
    }
    return v;
  }

  spawnOne(opts = {}) {
    const player = this.game.playerVehicle;
    if (!player) return null;
    const pp = player.worldPosition(new THREE.Vector3());

    // find a spawn point on valid ground at a safe distance
    let pos = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.minDist + this.rand() * (this.maxDist - this.minDist);
      const x = pp.x + Math.cos(a) * r;
      const z = pp.z + Math.sin(a) * r;
      const ground = this.game.arena.heightAt ? this.game.arena.heightAt(x, z) : 0;
      if (ground == null) continue;
      // keep inside the arena bounds if finite
      if (this.game.arena.size && (Math.abs(x) > this.game.arena.size / 2 - 8 || Math.abs(z) > this.game.arena.size / 2 - 8)) continue;
      pos = { x, y: ground, z };
      break;
    }
    if (!pos) return null;

    const archId = opts.archetype || pickArchetype(this.rand, this.tier);
    const arch = ARCHETYPES[archId];
    const bp = pickVariant(archId, this.rand);
    const { grid, errors } = VehicleGrid.deserialize(bp);
    if (errors.length) console.warn(`[enemy] ${archId} blueprint issues:`, errors);
    if (!grid.size) return null;

    // face roughly toward the player
    const yaw = Math.atan2(pp.x - pos.x, pp.z - pos.z);
    const faction = opts.faction || ARCH_FACTION[archId] || 'marauders';
    const v = this.game._spawnVehicle(grid, [pos.x, pos.y, pos.z], yaw, false, {
      name: arch.name, faction, tint: arch.color,
    });
    v.archetype = archId;
    v.ai = new EnemyAI(this.game, v, arch.ai);
    v.settleAbove(pos.y);
    this.enemies.push(v);
    this.game.hud?.toast(`${arch.name} inbound.`, 'bad');
    return v;
  }

  onRemoved(v) {
    let i = this.enemies.indexOf(v);
    if (i >= 0) this.enemies.splice(i, 1);
    i = this.disabledWrecks.indexOf(v);
    if (i >= 0) this.disabledWrecks.splice(i, 1);
  }

  onDisabled(v) {
    this.kills++;
    if (!this.disabledWrecks.includes(v)) this.disabledWrecks.push(v);
    if (v.isBoss) {
      this.bossesDefeated = (this.bossesDefeated || 0) + 1;
      this.game.addCogs?.(80, v.worldPosition(new THREE.Vector3()));
      this.game.hud?.toast(`★ ${v.name} DEFEATED! +80 cogs`, 'good');
    }
    this._milestone(this.kills);
  }

  _milestone(k) {
    const marks = { 1: 'First blood!', 10: '10 machines wrecked', 25: '25 machines wrecked',
      50: 'Scrap Baron — 50 wrecked', 100: 'Warlord — 100 machines wrecked' };
    if (marks[k]) this.game.hud?.toast(`★ ${marks[k]}`, 'good');
  }

  _cullFar() {
    const player = this.game.playerVehicle;
    if (!player) return;
    const pp = player.worldPosition(new THREE.Vector3());
    for (const v of [...this.enemies]) {
      if (v.disabled) continue;
      const d = v.worldPosition(new THREE.Vector3()).distanceTo(pp);
      if (d > 220) this.game.removeVehicle(v);
    }
  }

  activeCount() { return this.enemies.filter((v) => !v.disabled).length; }
}
