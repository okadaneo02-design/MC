import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { PhysicsWorld, rayGroups, CG } from './PhysicsWorld.js';
import { Input } from './Input.js';
import { Settings, QUALITY_PRESETS } from './Settings.js';
import { CameraRig } from './CameraRig.js';
import { DebugOverlay } from './Debug.js';

import BlockRegistry from '../vehicles/BlockRegistry.js';
import { VehicleGrid } from '../vehicles/VehicleGrid.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { VehicleBuilder } from '../vehicles/VehicleBuilder.js';
import { WHEEL_LEFT, WHEEL_RIGHT } from './wheelOrient.js';
import { EnemyManager } from '../ai/EnemySpawner.js';
import { EnemyAI } from '../ai/EnemyAI.js';
import { Salvage } from '../systems/Salvage.js';
import { Multiplayer } from '../net/Multiplayer.js';

import { Arena } from '../world/Arena.js';
import { Terrain } from '../world/Terrain.js';
import { ResourceSystem } from '../systems/ResourceSystem.js';
import { RaceSystem } from '../systems/RaceSystem.js';
import { BarricadeSystem } from '../systems/Barricades.js';
import { installSky } from '../world/Sky.js';
import { Inventory, STARTER_INVENTORY } from '../systems/Inventory.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { Effects } from '../fx/Effects.js';
import { Weapons, VehicleWeapons } from '../systems/Weapons.js';
import { DamageSystem } from '../systems/DamageSystem.js';
import { Audio } from '../systems/Audio.js';

import { HUD } from '../ui/HUD.js';
import { BuildMenu } from '../ui/BuildMenu.js';
import { UI } from '../ui/MainMenu.js';

export { WHEEL_LEFT, WHEEL_RIGHT };

/** The starter machine: a cab, a spine, an engine, four wheels and TWO light cannons. */
export const STARTER_BLUEPRINT = {
  v: VehicleGrid.SCHEMA_VERSION,
  blocks: [
    { i: 'cab', p: [0, 0, 1], o: 0 },
    { i: 'structural', p: [0, 0, 0], o: 0 },
    { i: 'engine', p: [0, 0, -1], o: 0 },
    { i: 'structural', p: [1, 0, 0], o: 0 },     // right sponson
    { i: 'structural', p: [-1, 0, 0], o: 0 },    // left sponson
    { i: 'cannon', p: [1, 1, 0], o: 0 },         // right cannon, facing +Z
    { i: 'cannon', p: [-1, 1, 0], o: 0 },        // left cannon, facing +Z
    { i: 'wheel', p: [1, 0, 1], o: WHEEL_RIGHT },
    { i: 'wheel', p: [-1, 0, 1], o: WHEEL_LEFT },
    { i: 'wheel', p: [1, 0, -1], o: WHEEL_RIGHT },
    { i: 'wheel', p: [-1, 0, -1], o: WHEEL_LEFT },
  ],
};

/** A bare-bones machine you respawn into after your cab is destroyed. */
export const RESPAWN_BLUEPRINT = {
  v: VehicleGrid.SCHEMA_VERSION,
  blocks: [
    { i: 'cab', p: [0, 0, 1], o: 0 },
    { i: 'structural', p: [0, 0, 0], o: 0 },
    { i: 'engine', p: [0, 0, -1], o: 0 },
    { i: 'wheel', p: [1, 0, 1], o: WHEEL_RIGHT },
    { i: 'wheel', p: [-1, 0, 1], o: WHEEL_LEFT },
    { i: 'wheel', p: [1, 0, -1], o: WHEEL_RIGHT },
    { i: 'wheel', p: [-1, 0, -1], o: WHEEL_LEFT },
  ],
};

/** A tiny, weaponless drone that roars around drawing enemy fire. */
export const DECOY_BLUEPRINT = {
  v: VehicleGrid.SCHEMA_VERSION,
  blocks: [
    { i: 'cab', p: [0, 0, 0], o: 0 },
    { i: 'engine', p: [0, 0, -1], o: 0 },
    { i: 'wheel_light', p: [1, 0, 0], o: WHEEL_RIGHT },
    { i: 'wheel_light', p: [-1, 0, 0], o: WHEEL_LEFT },
    { i: 'wheel_light', p: [1, 0, -1], o: WHEEL_RIGHT },
    { i: 'wheel_light', p: [-1, 0, -1], o: WHEEL_LEFT },
  ],
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'menu';          // menu | drive | build
    this.paused = false;
    this.running = false;
    this.seed = 1337;
    this.vehicles = [];
    this.playerVehicle = null;
    this.arena = null;
    this.assets = null;         // external GLB assets (ModelAssets); set during boot

    this.settings = new Settings();
    this.input = new Input(canvas);
    this.input.setBindings(this.settings.data.bindings);
    this.save = new SaveSystem();
    // Active save slot (1..10). Each slot keeps its own vehicle + world locally;
    // switching slots loads that slot's machine, and switching back restores it.
    this.MAX_SLOTS = 10;
    this.currentSlot = (() => {
      try { const n = parseInt(localStorage.getItem('mc.slot'), 10); return (n >= 1 && n <= 10) ? n : 1; }
      catch { return 1; }
    })();
    this.inventory = new Inventory(STARTER_INVENTORY);

    this._initRenderer();
    this._initScene();

    this.physics = new PhysicsWorld({ gravity: -19.0 });
    this.cameraRig = new CameraRig(this.camera, this.input, this.settings, this.physics);
    this.debug = new DebugOverlay(this);
    this.debug.attach(this.scene);

    this.effects = new Effects(this.scene, this.settings.preset.maxParticles);
    this.weapons = new Weapons(this);
    this.damage = new DamageSystem(this);
    this.audio = new Audio(this.settings);
    this._mechSignals = {};

    this.builder = new VehicleBuilder(this);
    this.hud = new HUD(this);
    this.buildMenu = new BuildMenu(this);
    this.ui = new UI(this);
    this.builder.onChange = () => this.buildMenu.refresh();
    this.inventory.onChange(() => { if (this.mode === 'build') this.buildMenu.refresh(); });

    this.physics.onPreStep((dt) => { for (const v of this.vehicles) v.fixedUpdate(dt); });
    this.physics.onPostStep(() => { for (const v of this.vehicles) v.postStep(); });
    this.physics.onContactForce((a, b, mag) => {
      if (this.mode === 'drive' && !this.paused) this.damage.onContact(a, b, mag);
    });

    this.input.setUnlockHandler(() => {
      if (this.mode === 'drive' && this.running && !this.paused && !this.ui.anyOverlayOpen) this.setPaused(true);
    });

    this._lastTime = performance.now();
    this._autosaveTimer = 0;
    window.addEventListener('resize', () => this._onResize());
    this.applySettings();
  }

  get detail() { return this.settings.preset.blockDetail; }

  // =========================================================================
  // setup
  // =========================================================================
  _initRenderer() {
    const preset = QUALITY_PRESETS[this.settings.data.quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.settings.data.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.sky = installSky(this.renderer, this.scene);
    this.scene.fog = new THREE.Fog(0xcfe9f6, 150, this.settings.data.renderDistance + 120);
    this.scene.fog.color.copy(this.sky.fogColor);

    this.camera = new THREE.PerspectiveCamera(
      62, window.innerWidth / window.innerHeight, 0.25, this.settings.data.renderDistance + 200,
    );
    this.camera.position.set(0, 8, -14);

    const hemi = new THREE.HemisphereLight(0xcfe9f6, 0x6a8f4c, 1.05);
    this.scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.7);
    sun.position.set(48, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    const rim = new THREE.DirectionalLight(0x6f96c8, 0.65);
    rim.position.set(-40, 24, -36);
    this.scene.add(rim);
  }

  applySettings() {
    const d = this.settings.data;
    const preset = QUALITY_PRESETS[d.quality] || QUALITY_PRESETS.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.shadowMap.enabled = d.shadows;
    this.sun.castShadow = d.shadows;
    this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    const sd = preset.shadowDistance;
    const cam = this.sun.shadow.camera;
    cam.left = -sd; cam.right = sd; cam.top = sd; cam.bottom = -sd;
    cam.near = 1; cam.far = 260;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }

    this.scene.fog.far = d.renderDistance;
    this.camera.far = d.renderDistance + 200;
    this.camera.updateProjectionMatrix();

    this.effects?.setMax(preset.maxParticles);
    this.audio?.setVolume(d.volume);

    if (this._appliedDetail !== undefined && this._appliedDetail !== preset.blockDetail) {
      BlockRegistry.clearModelCache();
      for (const v of this.vehicles) { v.detail = preset.blockDetail; v.build({ preserveMotion: true }); }
      this.builder._ghostId = null;
    }
    this._appliedDetail = preset.blockDetail;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  // =========================================================================
  // world lifecycle
  // =========================================================================

  /** Set the active save slot (1..10) and remember it locally. */
  setSlot(n) {
    this.currentSlot = Math.min(this.MAX_SLOTS, Math.max(1, n | 0));
    try { localStorage.setItem('mc.slot', String(this.currentSlot)); } catch {}
    return this.currentSlot;
  }
  _slotKey(n = this.currentSlot) { return `slot${n}`; }

  /** Metadata for all 10 slots (for the menu): {slot, used, savedAt, blocks, level, creative}. */
  async listSlots() {
    const out = [];
    for (let n = 1; n <= this.MAX_SLOTS; n++) {
      const rec = await this.save.loadWorld(this._slotKey(n));
      if (rec && rec.data) {
        out.push({ slot: n, used: true, savedAt: rec.savedAt,
          blocks: (rec.data.blueprint?.blocks?.length) || 0,
          level: rec.data.level || 1, creative: !!rec.data.creative });
      } else out.push({ slot: n, used: false });
    }
    return out;
  }

  async newGame({ creative = false, seed = null, tester = false, slot = null } = {}) {
    if (slot) this.setSlot(slot);
    this.seed = seed ?? (Math.floor(Math.random() * 1e9) | 0);
    this.materials = {};
    this.cogs = 0;
    this.level = 1; this.xp = 0;
    this.testerMode = tester;            // tester = creative sandbox with no enemies
    this.inventory = new Inventory(STARTER_INVENTORY, creative || tester);
    this.inventory.onChange(() => { if (this.mode === 'build') this.buildMenu.refresh(); });
    await this._startWorld(STARTER_BLUEPRINT, [0, 0, 0]);
    this.hud.toast(tester
      ? 'Tester Mode — unlimited parts, no enemies. Build and experiment freely.'
      : creative
        ? 'Creative Mode — unlimited parts. Press <b>B</b> to build.'
        : 'Press <b>B</b> to open the builder, or just drive.', 'good');
  }

  // ===== multiplayer entry points (all web-based, over the WiFi relay) =====
  async hostGame(room) {
    this.testerMode = false;
    this.materials = {}; this.cogs = 0; this.level = 1; this.xp = 0;
    this.inventory = new Inventory(STARTER_INVENTORY, false);
    this.inventory.onChange(() => { if (this.mode === 'build') this.buildMenu.refresh(); });
    this.seed = Math.floor(Math.random() * 1e9) | 0;
    await this._startWorld(STARTER_BLUEPRINT, [0, 0, 0]);
    this.mp = new Multiplayer(this);
    try { await this.mp.host(room); }
    catch (e) { this.hud.toast('Host failed: ' + e.message, 'bad'); this.mp = null; }
  }

  async joinGame(room) {
    this.mp = new Multiplayer(this);
    try {
      await this.mp.join(room);
      this.ui.hideAllOverlays();
      this.hud.show();
    } catch (e) {
      this.hud.toast('Join failed: ' + e.message, 'bad');
      this.mp = null;
    }
  }

  /** The blueprint a joining client deploys with. */
  clientBlueprint() {
    return STARTER_BLUEPRINT;
  }
  _deserialize(bp) { return VehicleGrid.deserialize(bp); }

  /** Client-side world: terrain visuals only; the host owns all simulation. */
  _startClientWorld(seed) {
    this._teardownWorld();
    this.seed = seed;
    this.arena = new Terrain(this, { seed, size: 760, cells: 400, tiles: 8 });
    this.arena.build();
    this.scene.add(this.arena.group);
    this.ui.hideAllOverlays();
    this.running = true;
    this.paused = false;
    this.mode = 'drive';
    this.cameraRig.setMode('drive');
    this.hud.show();
    this._lastTime = performance.now();
    this.hud.toast('Joined! You are Player 2 (blue). Drive with WASD.', 'good');
  }

  async continueGame(slot = null) {
    if (slot) this.setSlot(slot);
    const rec = await this.save.loadWorld(this._slotKey());
    if (!rec) { this.hud.toast('No save found.', 'bad'); return; }
    const d = rec.data;
    this.seed = d.seed;
    this.materials = d.materials || {};
    this.cogs = d.cogs || 0;
    this.level = d.level || 1; this.xp = d.xp || 0;
    this.inventory = Inventory.fromJSON(d.inventory, !!d.creative);
    this.inventory.onChange(() => { if (this.mode === 'build') this.buildMenu.refresh(); });
    if (d.bindings) { this.settings.set({ bindings: d.bindings }); this.input.setBindings(d.bindings); }
    await this._startWorld(d.blueprint, d.playerPosition || [0, 0, 0], d.playerYaw || 0);
    this.hud.toast('Game loaded.', 'good');
  }

  async _startWorld(blueprint, position, yaw = 0) {
    this._teardownWorld();

    // Seeded procedural heightmap world (the Arena remains for the test suite).
    // Bigger map + finer cells so collision matches the hills and the car rides
    // over them instead of clipping in.
    this.arena = new Terrain(this, { seed: this.seed, size: 760, cells: 400, tiles: 8 });
    this.arena.build();
    this.scene.add(this.arena.group);

    this.race = new RaceSystem(this);
    this.resources = new ResourceSystem(this);
    this.resources.populate(this.arena);
    this.barricades = new BarricadeSystem(this);

    this.enemies = new EnemyManager(this, { seed: this.seed });
    this.salvage = new Salvage(this);

    const { grid, errors } = VehicleGrid.deserialize(blueprint);
    if (errors.length) console.warn('[game] blueprint restore warnings:', errors);
    if (grid.size === 0) {
      console.error('[game] blueprint produced no blocks; falling back to the starter machine');
      const fallback = VehicleGrid.deserialize(STARTER_BLUEPRINT);
      this.playerVehicle = this._spawnVehicle(fallback.grid, position, yaw, true);
    } else {
      this.playerVehicle = this._spawnVehicle(grid, position, yaw, true);
    }
    this.playerVehicle.settleAbove(this.arena.heightAt());

    this.ui.hideAllOverlays();
    this.running = true;
    this.paused = false;
    this.mode = 'drive';
    this.cameraRig.setMode('drive');
    this.cameraRig.snapBehind(this.playerVehicle);
    this.hud.show();
    this._lastTime = performance.now();
  }

  _spawnVehicle(grid, position, yaw, isPlayer, opts = {}) {
    const v = new Vehicle(this, {
      grid, position: [position[0], position[1] + 2.5, position[2]],
      rotationY: yaw, isPlayer, detail: this.detail,
      name: opts.name || (isPlayer ? 'Your Machine' : 'Machine'),
    });
    v.faction = isPlayer ? 'player' : (opts.faction || 'enemy');
    v.tintColor = opts.tint || null;
    v.weaponCtl = new VehicleWeapons(this, v);
    // 3 seconds of spawn protection so you can't be blown up while you settle.
    if (isPlayer) v.invuln = 3.0;
    this.scene.add(v.root);
    v.build();
    this.vehicles.push(v);
    return v;
  }

  /** Launch a decoy drone near (x,z): a weaponless player-faction machine that
   *  roams and strongly attracts enemy targeting, then self-destructs. */
  spawnDecoy(x, z, yaw = 0) {
    const { grid } = VehicleGrid.deserialize(DECOY_BLUEPRINT);
    if (!grid.size) return null;
    const y = this.arena?.heightAt ? this.arena.heightAt(x, z) : 0;
    const v = this._spawnVehicle(grid, [x, y, z], yaw, false, { name: 'Decoy', faction: 'player', tint: 0x37c6d8 });
    v.isDecoy = true;
    v.life = 9;
    v.ai = new EnemyAI(this, v, { aggression: 1, preferredRange: 7, speed: 1.4 });
    v.settleAbove?.(y);
    (this._decoys ||= []).push(v);
    this.hud?.toast('Decoy drone deployed.', 'good');
    return v;
  }

  /** Remove a vehicle entirely (empty wreck fully salvaged / despawned). */
  removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (v.ai) this.enemies?.onRemoved(v);
    v.dispose();
    if (v === this.playerVehicle) this.playerVehicle = null;
  }

  onVehicleDisabled(v) {
    if (v === this.playerVehicle) {
      this.hud.toast('Your cab is destroyed! Respawning a basic machine…', 'bad');
      this.audio?.boom(v.position, 1.3);
      this._respawnIn = 3.2;             // seconds until a fresh small build
      this._deadWreck = v;
    } else {
      this.hud.toast(`${v.name} disabled! Drive close to absorb its surviving parts.`, 'good');
      this.audio?.boom(v.position, 1);
      if (v.ai) v.ai.state = 'disabled';
      this.enemies?.onDisabled(v);
      // XP for the kill — scaled by how big/tough the enemy was.
      const tier = v.ai?.arch?.tier || 1;
      this.addXP(30 + tier * 25 + Math.round((v.mass || 0) / 120));
    }
  }

  // ===== leveling =========================================================

  xpForLevel(lvl) { return 80 + (lvl - 1) * 70; }

  addXP(n) {
    if (!n) return;
    this.xp = (this.xp || 0) + n;
    let leveled = false;
    while (this.xp >= this.xpForLevel(this.level || 1)) {
      this.xp -= this.xpForLevel(this.level || 1);
      this.level = (this.level || 1) + 1;
      leveled = true;
    }
    if (leveled) {
      this.hud?.toast(`LEVEL UP! You are now level <b>${this.level}</b>. Tougher enemies — and longer weapon range.`, 'good');
    }
    this.hud?.refreshLevel?.();
  }

  /** Player weapon range multiplier: short early, reaching full by ~level 11. */
  playerRangeMul() { return Math.min(1.15, 0.42 + ((this.level || 1) - 1) * 0.055); }

  /** Count down a pending respawn and bring the player back in a small build. */
  _tickRespawn(dt) {
    if (!this._respawnIn) return;
    this._respawnIn -= dt;
    if (this._respawnIn > 0) return;
    this._respawnIn = 0;
    this.respawnPlayer();
  }

  /**
   * Respawn the player with a bare-bones machine at a safe spot in the SAME world.
   * Inventory, materials, seed and the explored world are all kept.
   */
  respawnPlayer() {
    const old = this._deadWreck || this.playerVehicle;
    let cx = 0, cz = 0;
    let leftWreck = false;
    if (old) {
      const p = old.worldPosition(_v3); cx = p.x; cz = p.z;
      // LEAVE the wreck behind as a loot cache. It is now a disabled, non-player
      // vehicle, so the normal drive-near salvage absorbs your surviving blocks
      // when you return. If nothing salvageable remains, clear it.
      old.faction = 'wreck';
      old.name = 'Your Wreck';
      old.isLootCache = true;
      const survivors = old.grid.list().filter((b) => b.health > 0).length;
      if (survivors > 0) leftWreck = true; else this.removeVehicle(old);
    }
    this._deadWreck = null;

    // respawn a little away from the wreck so you don't instantly re-absorb it
    const spot = this.arena.findFlatSpot
      ? this.arena.findFlatSpot(cx + 18, cz + 18, 24)
      : { x: cx + 18, y: this.arena.heightAt(cx + 18, cz + 18), z: cz + 18 };
    const { grid } = VehicleGrid.deserialize(RESPAWN_BLUEPRINT);
    this.playerVehicle = this._spawnVehicle(grid, [spot.x, spot.y, spot.z], 0, true);
    this.playerVehicle.settleAbove(this.arena.heightAt(spot.x, spot.z));
    this.cameraRig.snapBehind(this.playerVehicle);
    this.hud.toast(leftWreck
      ? 'Respawned nearby. Your <b>wreck</b> is marked on the radar — drive back to reclaim its blocks.'
      : 'Respawned with a basic machine. Open the builder (<b>B</b>) to rebuild.', 'good');
  }

  _teardownWorld() {
    this._respawnIn = 0;
    this._deadWreck = null;
    for (const v of this.vehicles) v.dispose();
    this.vehicles.length = 0;
    this.playerVehicle = null;
    this.enemies = null;
    this.salvage = null;
    if (this.race) { this.race.dispose(); this.race = null; }
    if (this.barricades) { this.barricades.dispose(); this.barricades = null; }
    this._decoys = null;
    if (this.resources) { this.resources.dispose(); this.resources = null; }
    if (this.arena) { this.arena.dispose(); this.arena = null; }
  }

  /** Material tally from mining (HUD flavour + score). */
  addMaterial(type, n) {
    if (!this.materials) this.materials = {};
    this.materials[type] = (this.materials[type] || 0) + n;
    this.hud?.refreshMaterials?.();
  }

  /** Cogs earned from breaking enemy blocks — the shop currency. */
  addCogs(n, atPoint = null) {
    this.cogs = (this.cogs || 0) + n;
    this.hud?.refreshCogs?.(n);
    if (atPoint) this.effects?.floatText?.(atPoint, `+${n}`, 0xffd36a);
  }

  quitToMenu() {
    this.running = false;
    this.mode = 'menu';
    this.builder.exit();
    this._teardownWorld();
    this.input.exitPointerLock();
    this.ui.showMainMenu();
  }

  // =========================================================================
  // modes
  // =========================================================================

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'build') {
      this.mode = 'build';
      this.input.exitPointerLock();
      this.cameraRig.setMode('build');
      const v = this.playerVehicle;
      const b = v.grid.bounds();
      const centre = v.mainAssembly ? v.mainAssembly.group.position.clone() : new THREE.Vector3();
      const radius = b ? Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) * 0.5 + 1 : 2;
      this.cameraRig.frameOn(centre, radius);
      this.builder.enter();
      this.hud.hide();
      this.buildMenu.show();
    } else {
      // leaving build mode: the design has to be legal
      if (this.mode === 'build') {
        const val = this.playerVehicle.grid.validate();
        if (!val.ok) {
          this.hud.toast(val.errors[0], 'bad');
          return;
        }
        this.builder.exit();
        this.buildMenu.hide();
        this.playerVehicle.setFrozen(false);
        this.playerVehicle.settleAbove(this.arena.heightAt());
        for (const w of val.warnings) this.hud.toast(w);
      }
      this.mode = 'drive';
      this.cameraRig.setMode('drive');
      this.cameraRig.snapBehind(this.playerVehicle);
      this.hud.show();
      this.input.requestPointerLock();
      if (!this.mp) this.saveGame();   // persist the machine the moment you finish building
    }
  }

  setPaused(p) {
    this.paused = p;
    if (p) { this.ui.showPause(); this.input.exitPointerLock(); }
    else {
      this.ui.hidePause();
      this._lastTime = performance.now();
      if (this.mode === 'drive') this.input.requestPointerLock();
    }
  }

  // =========================================================================
  // blueprint / save
  // =========================================================================

  loadBlueprintIntoPlayer(blueprint) {
    const { grid, errors } = VehicleGrid.deserialize(blueprint);
    if (errors.length) console.warn('[game] blueprint load warnings:', errors);
    if (!grid.size) return { ok: false, reason: 'Blueprint contained no usable blocks.' };
    const val = grid.validate();
    if (!val.ok) return { ok: false, reason: val.errors[0] };

    if (!this.inventory.creative) {
      // Survival: you must actually own the parts. Returns the current machine first.
      const refund = new Map();
      for (const b of this.playerVehicle.grid.list()) refund.set(b.id, (refund.get(b.id) || 0) + 1);
      const need = new Map();
      for (const b of grid.list()) need.set(b.id, (need.get(b.id) || 0) + 1);
      const missing = [];
      for (const [id, n] of need) {
        const have = this.inventory.count(id) + (refund.get(id) || 0);
        if (have < n) missing.push(`${n - have}× ${BlockRegistry.get(id)?.name || id}`);
      }
      if (missing.length) return { ok: false, reason: `Missing parts: ${missing.join(', ')}` };
      for (const [id, n] of refund) this.inventory.add(id, n);
      for (const [id, n] of need) this.inventory.take(id, n);
    }

    const v = this.playerVehicle;
    const pos = v.worldPosition(new THREE.Vector3());
    v.grid = grid;
    v.build();
    v.mainAssembly.body.setTranslation({ x: pos.x, y: pos.y + 1.5, z: pos.z }, true);
    v.settleAbove(this.arena.heightAt());
    if (this.mode === 'build') {
      v.setFrozen(true);
      this.builder.undoStack.length = 0;
      this.builder.redoStack.length = 0;
      this.builder._pushUndo();
      this.buildMenu.refresh();
    }
    return { ok: true };
  }

  async saveGame() {
    if (!this.running || !this.playerVehicle) return false;
    const p = this.playerVehicle.worldPosition(new THREE.Vector3());
    const q = this.playerVehicle.quaternion;
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    return this.save.saveWorld(this._slotKey(), {
      seed: this.seed,
      creative: this.inventory.creative,
      blueprint: this.playerVehicle.grid.serialize(),
      inventory: this.inventory.toJSON(),
      playerPosition: [p.x, p.y, p.z],
      playerYaw: yaw,
      materials: this.materials || {},
      cogs: this.cogs || 0,
      level: this.level || 1, xp: this.xp || 0,
      bindings: this.settings.data.bindings,
    });
  }

  // =========================================================================
  // main loop
  // =========================================================================

  start() {
    const tick = () => {
      this._frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _frame() {
    const t0 = performance.now();
    const now = t0;
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > 0.25) dt = 0.25;

    if (this.running && this.mp && this.mp.isClient && this.mp.active) {
      // Thin client: no local simulation — stream input, render host's world.
      this._handleInput(dt);
      this.mp.clientFrame(dt);
      this.effects.update(dt);
      this.cameraRig.update(dt, this.clientSelf);
      this._updateSun();
      if (this.clientSelf) { this.playerVehicle = this.clientSelf; this.hud.update(); }
    } else if (this.running) {
      this._handleInput(dt);
      if (!this.paused) {
        this.physics.update(dt);
        for (const v of this.vehicles) if (v.invuln > 0) v.invuln = Math.max(0, v.invuln - dt);
        if (this.mode === 'drive') this._updateCombat(dt);
        if (this.mp && this.mp.isHost && this.mp.active) this.mp.hostTick(dt);
        this.effects.update(dt);
        this.damage.flush();
        this._tickRespawn(dt);
        this._autosaveTimer += dt;
        if (this._autosaveTimer > 20 && !this.mp) { this._autosaveTimer = 0; this.saveGame(); }
      }
      if (this.mode === 'build') this.builder.update();
      for (const v of this.vehicles) v.syncRender(this.paused ? 1 : this.physics.alpha);
      this.cameraRig.update(dt, this.playerVehicle);
      this._updateSun(this.paused ? 0 : dt);
      if (this.mode === 'drive') this.hud.update();
    }

    this.renderer.render(this.scene, this.camera);
    this.debug.frame(dt, performance.now() - t0);
    this.input.endFrame();
  }

  _updateSun(dt = 0) {
    const v = this.playerVehicle || this.clientSelf;
    if (!v) return;
    // Day/night: a full cycle every ~6 minutes. daylight (0..1) drives solar panels.
    this.timeOfDay = (((this.timeOfDay ?? 0.3) + dt / 360) % 1 + 1) % 1;
    const t = this.timeOfDay;
    const sunH = Math.sin(t * Math.PI * 2 - Math.PI / 2);     // -1 midnight … +1 noon
    this.daylight = Math.max(0, sunH);
    const p = v.worldPosition(_v3);
    this.sun.position.set(p.x + Math.cos(t * Math.PI * 2) * 90, p.y + Math.max(8, sunH * 95), p.z + Math.sin(t * Math.PI * 2) * 60);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = 0.2 + this.daylight * 1.2;
    this.sun.color.setRGB(1, 0.8 + 0.2 * this.daylight, 0.62 + 0.38 * this.daylight);
    if (this.ambient) this.ambient.intensity = 0.22 + this.daylight * 0.5;
    if (this.hemi) this.hemi.intensity = 0.2 + this.daylight * 0.6;
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(_nightSky).lerp(_daySky, this.daylight);
    }
    if (this.scene.fog && this.scene.fog.color) this.scene.fog.color.copy(_nightSky).lerp(_daySky, this.daylight);
  }

  // =========================================================================
  // combat + mechanical driving
  // =========================================================================

  _updateCombat(dt) {
    // enemy AI first (sets each enemy's drive + aim) — never in Tester mode
    if (this.enemies && !this.testerMode) this.enemies.update(dt);

    // player aim from the crosshair
    const pv = this.playerVehicle;
    const firing = pv && pv.built && !pv.disabled && this.input.down('fire') && !this.input.mouse.overUI;
    const aim = this._playerAim(firing);

    for (const v of this.vehicles) {
      if (!v.weaponCtl) continue;
      if (v === pv) v.weaponCtl.update(dt, aim);
      else if (v.mpControlled && v.mpAim) v.weaponCtl.update(dt, v.mpAim);
      else if (v.ai) v.weaponCtl.update(dt, v.ai.aim);
    }

    this.weapons.update(dt);
    if (this.barricades) this.barricades.update(dt);

    // decoy drones: drive themselves, draw fire, and expire
    if (this._decoys && this._decoys.length) {
      for (let i = this._decoys.length - 1; i >= 0; i--) {
        const d = this._decoys[i];
        if (!d.built || d.disabled || (d.life -= dt) <= 0) {
          this.effects?.explosion(d.worldPosition(_v3), 0.6);
          this.removeVehicle(d);
          this._decoys.splice(i, 1);
          continue;
        }
        d.ai.update(dt);
        d.weaponCtl.update(dt, d.ai.aim);
      }
    }

    // Auto-salvage: drive near a defeated wreck and its surviving parts get
    // vacuumed into your inventory, one every tick so it reads as absorption.
    if (this.race) this.race.update(dt);
    if (this.salvage) {
      this.salvage.update();
      const w = this.salvage.near;
      if (w && pv && pv.built) {
        this.hud.showPrompt(`Absorbing parts from ${w.name}…`);
        this._salvageAcc = (this._salvageAcc || 0) + dt;
        if (this._salvageAcc >= 0.1) {
          this._salvageAcc = 0;
          const man = this.salvage.manifest(w);
          if (man.length) {
            const name = w.name;
            this.salvage.take(w, man[0].id, 1);
            if (!this.vehicles.includes(w)) this.hud.toast(`Fully salvaged ${name}.`, 'good');
          }
        }
      } else {
        this._salvageAcc = 0;
        this.hud.hidePrompt();
      }
    }

    // engine sound follows the player's speed
    if (pv && pv.built && !pv.disabled) this.audio.engine(Math.abs(pv.telemetry.forwardSpeed), Math.abs(this.input.axis('brake', 'throttle')));
    else this.audio.engineOff();
  }

  _playerAim(firing) {
    const v = this.playerVehicle;
    if (!v) return { firing: false, target: null, aimDir: null };
    // Ray from the camera through the screen centre.
    _aimOrigin.copy(this.camera.position);
    _aimDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const hit = this.physics.castRay(
      { x: _aimOrigin.x, y: _aimOrigin.y, z: _aimOrigin.z },
      { x: _aimDir.x, y: _aimDir.y, z: _aimDir.z }, 400, AIM_RAY,
      (meta) => meta && meta.vehicleId === v.id);
    const target = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : _aimTarget.copy(_aimOrigin).addScaledVector(_aimDir, 120).clone();
    // crosshair heat when aiming at an enemy
    this._crosshairHot = !!(hit && hit.meta && hit.meta.kind === 'block' && hit.meta.vehicle && hit.meta.vehicle !== v);
    return { firing, target, aimDir: _aimDir.clone() };
  }

  /** Mechanical control signals for the player's joints and tools, from bindings. */
  _playerMechSignals() {
    const i = this.input;
    const s = {
      servoLeft: i.down('servoLeft'), servoRight: i.down('servoRight'),
      pistonOut: i.down('pistonOut'), pistonIn: i.down('pistonIn'),
      rotatorRun: i.down('rotatorRun'), toolToggle: i.down('toolToggle'),
    };
    this._mechSignals = s;
    return s;
  }

  _handleInput(dt) {
    const input = this.input;

    if (input.pressed('debug')) this.debug.toggle();
    if (input.codePressed('F4')) this.debug.toggleColliders();

    if (input.codePressed('Escape')) {
      if (this.ui.anyOverlayOpen && !this.paused) this.ui.hideAllOverlays();
      else this.setPaused(!this.paused);
      return;
    }
    if (this.paused || this.ui.anyOverlayOpen) {
      if (input.pressed('inventory')) this.ui.toggleInventory();
      return;
    }

    if (input.pressed('inventory')) { this.ui.toggleInventory(); return; }
    if (input.pressed('buildMode')) { this.setMode(this.mode === 'build' ? 'drive' : 'build'); return; }

    if (this.mode === 'build') this._handleBuildInput();
    else this._handleDriveInput(dt);
  }

  _handleBuildInput() {
    const input = this.input;
    const b = this.builder;

    // R / T / H rotate about X / Y / Z directly (Shift reverses).
    const rev = input.codeDown('ShiftLeft') || input.codeDown('ShiftRight') ? -1 : 1;
    if (input.codePressed('KeyR')) b.rotate('x', rev);
    if (input.codePressed('KeyT')) b.rotate('y', rev);
    if (input.codePressed('KeyH')) b.rotate('z', rev);
    if (input.codePressed('KeyF') && b.hover) {
      const blk = this.playerVehicle.grid.blocks.get(b.hover.uid);
      if (blk && ['joint', 'drill', 'turret', 'weapon'].includes(blk.def.behavior)) {
        this.ui.openPartConfig(blk, this.playerVehicle);
      } else {
        this.hud.toast('That block has nothing to configure.');
      }
    }
    if (input.codePressed('KeyZ')) { if (!b.undo()) this.hud.toast('Nothing to undo'); }
    if (input.codePressed('KeyY')) { if (!b.redo()) this.hud.toast('Nothing to redo'); }
    if (input.codePressed('KeyM')) { b.toggleSymmetry(); this.buildMenu.refresh(); }
    if (input.codePressed('KeyX')) {
      // X puts the held part away; pressing X with nothing held toggles the
      // delete tool instead. Equipping a part (palette/number keys) exits delete.
      if (b.selectedId) {
        b.unequip();
        this.hud.toast('Part unequipped. Press X again for the delete tool.', 'good');
      } else {
        const on = b.toggleDelete();
        this.hud.toast(on ? 'Delete tool ON — click blocks to remove.' : 'Delete tool off.', on ? 'bad' : 'good');
      }
      this.buildMenu.refresh();
    }

    // Shift + wheel cycles the selected block (plain wheel is camera zoom).
    if (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight')) {
      const w = input.mouse.wheel;
      if (w) { b.cycleSelection(w > 0 ? 1 : -1); this.buildMenu.refresh(); input.mouse.wheel = 0; }
    }
    for (let i = 1; i <= 9; i++) {
      if (input.codePressed('Digit' + i)) {
        const list = BlockRegistry.all();
        if (list[i - 1]) { b.select(list[i - 1].id); this.buildMenu.refresh(); }
      }
    }

    if (input.mouse.pressed.has(0) && !input.mouse.overUI) {
      // Left click deletes when the delete tool is on, otherwise it places.
      const res = b.deleteMode ? b.tryRemove() : b.tryPlace();
      this._reportBuildResult(res);
    }
    // Right mouse is reserved for orbiting the camera — it no longer deletes.
  }

  _reportBuildResult(res) {
    if (!res) return;
    if (!res.ok && res.reason) { this.hud.toast(res.reason, 'bad'); return; }
    if (res.ok && res.stranded > 0) {
      this.hud.toast(`Returned ${res.stranded} attached block${res.stranded === 1 ? '' : 's'} to inventory.`);
    }
  }

  _handleDriveInput(dt) {
    const input = this.input;
    const v = this.playerVehicle;
    if (!v) return;

    if (input.pressed('recover')) { v.recover(); this.hud.toast('Machine righted.'); }
    // Salvage is automatic now (drive near a wreck); E opens the full parts list
    // as a manual override if you want to pick selectively.
    if (input.pressed('interact') && this.salvage && this.salvage.near) {
      this.ui.openSalvage(this.salvage.near);
      return;
    }

    const steer = input.axis('steerLeft', 'steerRight');
    const fwd = input.down('throttle');
    const back = input.down('brake');
    const speed = v.telemetry.forwardSpeed;

    let throttle = 0, brake = 0;
    if (fwd && !back) {
      // forward key brakes first if we're rolling backwards
      if (speed < -0.8) brake = 1; else throttle = 1;
    } else if (back && !fwd) {
      if (speed > 0.8) brake = 1; else throttle = -0.72;   // reverse is weaker
    } else if (fwd && back) {
      brake = 1;
    }

    v.setControls({
      throttle, brake, steer: -steer,
      handbrake: input.down('handbrake'),
      boost: input.down('boost'),
    });
    v.setMechControls(this._playerMechSignals());

    if (v.telemetry.skidding) this.cameraRig.addShake(dt * 0.25);
  }
}

const _v3 = new THREE.Vector3();
const _nightSky = new THREE.Color(0x0a0e18);
const _daySky = new THREE.Color(0x9fc4e8);
const _aimOrigin = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimTarget = new THREE.Vector3();
const AIM_RAY = rayGroups(CG.GROUND | CG.OBSTACLE | CG.VEHICLE | CG.RESOURCE | CG.DEBRIS);
