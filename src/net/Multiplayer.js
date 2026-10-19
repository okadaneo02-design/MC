import * as THREE from 'three';
import { Net } from './Net.js';
import { RemoteVehicle } from './RemoteVehicle.js';

/**
 * Host-authoritative 2-player multiplayer over the WiFi relay.
 *
 *  - The HOST runs the entire simulation (physics, enemies, combat, salvage). It
 *    spawns the client's machine as a second player-faction vehicle, applies the
 *    client's streamed input to it, and broadcasts every vehicle's pose + blueprint.
 *  - The CLIENT runs no simulation. It renders every vehicle the host streams as a
 *    ghost, follows its own ghost with the camera, and streams its input up.
 *
 * Both load the same seeded world, so terrain and props line up exactly.
 */

const SNAP_HZ = 20;
const _v = new THREE.Vector3();

export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.net = new Net();
    this.active = false;
    this.isHost = false;
    this.isClient = false;

    this.ghosts = new Map();        // id -> RemoteVehicle (client side)
    this._sentVersions = new Map(); // id -> grid.version (host side)
    this._snapAcc = 0;
    this._clientInput = null;       // latest input from the client (host side)
    this.clientVehicle = null;      // the client's vehicle on the host
    this.selfId = null;             // client's own vehicle id (client side)
    this._bpSent = false;
    this.status = 'offline';
    this._unsub = null;
  }

  // ===== lifecycle ========================================================

  async host(room) {
    this.isHost = true; this.isClient = false;
    this._wire();
    this.status = 'waiting';
    await this.net.connect(room, true);
    this.active = true;
    this.net.onPeers((n) => {
      this.status = n >= 2 ? 'connected' : 'waiting';
      if (n >= 2) {
        this.game.hud?.toast('Player 2 connected!', 'good');
        this.greetClient();                 // hand them the seed so they build the world
      } else {
        this.game.hud?.toast('Waiting for Player 2…', 'good');
        this._dropClientVehicle();
      }
    });
    this.game.hud?.toast('Hosting. Share your WiFi link + room code.', 'good');
  }

  async join(room) {
    this.isHost = false; this.isClient = true;
    this._wire();
    this.status = 'connecting';
    await this.net.connect(room, false);
    this.active = true;
    this.game.hud?.toast('Connected — waiting for the host world…', 'good');
  }

  _wire() {
    this._unsub = this.net.onMessage((m) => this._onMessage(m));
  }

  stop() {
    this.active = false;
    if (this._unsub) this._unsub();
    for (const g of this.ghosts.values()) g.dispose();
    this.ghosts.clear();
    this.net.close();
    this.status = 'offline';
  }

  // ===== message handling =================================================

  _onMessage(m) {
    if (!m || !m.t) return;
    if (this.isHost) this._hostMessage(m);
    else this._clientMessage(m);
  }

  _hostMessage(m) {
    if (m.t === 'ready') {
      this._spawnClientVehicle(m.bp);
    } else if (m.t === 'input') {
      this._clientInput = m;
    }
  }

  _clientMessage(m) {
    switch (m.t) {
      case 'init':
        // Build the world once (first init carries the seed); later inits patch
        // in our real vehicle id so we can tag our own ghost + follow it.
        if (m.seed != null && !this._worldBuilt) {
          this.game._startClientWorld(m.seed);
          this._worldBuilt = true;
        }
        if (typeof m.selfId === 'number' && m.selfId >= 0) {
          this.selfId = m.selfId;
          const mine = this.ghosts.get(this.selfId);
          if (mine && !mine.isSelf) {
            mine.isSelf = true; mine.isPlayer = true;
            this.game.clientSelf = mine;
            this.game.cameraRig.snapBehind(mine);
          }
        }
        if (!this._bpSent) {
          this.net.send({ t: 'ready', bp: this.game.clientBlueprint() });
          this._bpSent = true;
        }
        break;
      case 'bp': {
        let g = this.ghosts.get(m.id);
        if (!g) {
          g = new RemoteVehicle(this.game.scene, m.id, {
            detail: this.game.detail, isSelf: m.id === this.selfId,
            faction: m.faction, tint: m.tint || null, name: m.name,
          });
          this.ghosts.set(m.id, g);
          if (m.id === this.selfId) { this.game.clientSelf = g; this.game.cameraRig.snapBehind(g); }
        }
        g.setBlueprint(m.bp, m.hash);
        break;
      }
      case 'snap':
        for (const row of m.v) {
          const g = this.ghosts.get(row[0]);
          if (g) g.setPose([row[1], row[2], row[3]], [row[4], row[5], row[6], row[7]], row[8], row[9], !!row[10]);
        }
        break;
      case 'gone': {
        const g = this.ghosts.get(m.id);
        if (g) { g.dispose(); this.ghosts.delete(m.id); }
        break;
      }
      case '__closed':
        this.game.hud?.toast('Disconnected from host.', 'bad');
        break;
    }
  }

  // ===== host: spawn + drive the client's machine =========================

  _spawnClientVehicle(bp) {
    if (this.clientVehicle) return;
    const g = this.game;
    const spot = g.arena.findFlatSpot ? g.arena.findFlatSpot(0, -14, 20) : { x: 0, y: g.arena.heightAt(0, -14), z: -14 };
    const { grid } = g._deserialize(bp);
    const v = g._spawnVehicle(grid, [spot.x, spot.y, spot.z], 0, false, { name: 'Player 2', faction: 'player', tint: 0x39c2ff });
    v.isPlayer = false;
    v.mpControlled = true;           // player-controlled over the network
    v.invuln = 3.0;
    this.clientVehicle = v;
    this.game.hud?.toast('Player 2 deployed.', 'good');
    // tell the client which vehicle id is theirs (its blueprint streams via hostTick)
    this.greetClient();
  }

  _dropClientVehicle() {
    if (this.clientVehicle) { this.game.removeVehicle(this.clientVehicle); this.clientVehicle = null; }
    this._clientInput = null;
  }

  /** Host: apply the client's input to its vehicle, then stream the world. */
  hostTick(dt) {
    if (!this.active) return;
    const cv = this.clientVehicle;
    if (cv && cv.built && !cv.disabled && this._clientInput) {
      const i = this._clientInput;
      if (i.c) cv.setControls(i.c);
      cv.mpAim = { firing: !!i.fire, aimDir: i.aim ? _v.set(i.aim[0], i.aim[1], i.aim[2]).clone() : null, target: null };
      if (i.mech) cv.setMechControls(i.mech);
    } else if (cv && cv.built) {
      cv.setControls({ throttle: 0, steer: 0, brake: 1, handbrake: true });
    }

    this._snapAcc += dt;
    if (this._snapAcc < 1 / SNAP_HZ) return;
    this._snapAcc = 0;

    // blueprint sync: resend any vehicle whose structure changed
    const live = new Set();
    for (const v of this.game.vehicles) {
      live.add(v.id);
      const ver = v.grid.version;
      if (this._sentVersions.get(v.id) !== ver) {
        this._sentVersions.set(v.id, ver);
        this.net.send({
          t: 'bp', id: v.id, bp: v.grid.serialize(), hash: ver,
          faction: v.faction, tint: v.tintColor || null, name: v.name,
        });
      }
    }
    // removals
    for (const id of [...this._sentVersions.keys()]) {
      if (!live.has(id)) { this._sentVersions.delete(id); this.net.send({ t: 'gone', id }); }
    }

    // pose snapshot
    const rows = [];
    for (const v of this.game.vehicles) {
      const a = v.mainAssembly;
      if (!a || !a.body) continue;
      const t = a.body.translation(), q = a.body.rotation();
      rows.push([v.id, round(t.x), round(t.y), round(t.z),
        r3(q.x), r3(q.y), r3(q.z), r3(q.w),
        Math.round((v.telemetry?.forwardSpeed || 0) * 10) / 10, v.telemetry?.grounded || 0, v.disabled ? 1 : 0]);
    }
    this.net.send({ t: 'snap', v: rows });

    // when the client first connects, make sure it has every blueprint + its id
    if (this.net.peerCount >= 2 && !this._greeted) {
      this._greeted = true;
    }
  }

  /** Host: called when a peer count hits 2 — hand the client its world. */
  greetClient() {
    // (re)send init so a freshly-joined client gets the seed; its id is the
    // client vehicle's id once spawned, but we send seed immediately so it can
    // build the world, then patch selfId when the vehicle exists.
    this.net.send({ t: 'init', seed: this.game.seed, selfId: this.clientVehicle ? this.clientVehicle.id : -1 });
  }

  /** Client: send input every frame and advance ghost interpolation. */
  clientFrame(dt) {
    if (!this.active) return;
    const input = this.game.input;
    const cam = this.game.camera;
    // build control from local keys (same mapping as single-player driving)
    const steer = input.axis('steerLeft', 'steerRight');
    const fwd = input.down('throttle'), back = input.down('brake');
    const c = { throttle: fwd && !back ? 1 : 0, steer, brake: back && !fwd ? 1 : 0, handbrake: input.down('handbrake') };
    const aimDir = _v.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    this.net.send({
      t: 'input', c, fire: input.down('fire') && !input.mouse.overUI,
      aim: [round(aimDir.x, 3), round(aimDir.y, 3), round(aimDir.z, 3)],
      mech: this.game._playerMechSignals ? this.game._playerMechSignals() : null,
    });
    for (const g of this.ghosts.values()) g.render();
  }
}

const round = (n, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };
const r3 = (n) => Math.round(n * 1000) / 1000;
