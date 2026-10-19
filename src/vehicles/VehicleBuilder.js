import * as THREE from 'three';
import BlockRegistry, { CELL } from './BlockRegistry.js';
import { VehicleGrid, worldCells } from './VehicleGrid.js';
import {
  ORIENTATIONS, rotateOrientation, orientationMapping, rotateDir,
  mirrorOrientation, mirrorMountOrientation,
} from './Orientation.js';
import { MATERIALS } from '../models/ProceduralModels.js';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

const UNDO_LIMIT = 60;

/**
 * Build Mode. Owns placement rules at the *interaction* level; the grid itself
 * is the authority on what is legal (see VehicleGrid.canPlace).
 */
export class VehicleBuilder {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.selectedId = 'structural';
    this.orient = 0;
    this.rotAxis = 'y';
    this.symmetry = false;
    this.deleteMode = false;     // X toggles a dedicated delete tool

    this.hover = null;          // {cell:[x,y,z], normal:[x,y,z], uid}
    this.placement = null;      // {ok, reason, cell, orient}
    this.undoStack = [];
    this.redoStack = [];

    this.helpers = new THREE.Group();
    this.helpers.name = 'build-helpers';

    this.ghost = new THREE.Group();
    this.helpers.add(this.ghost);
    this._ghostId = null;
    this._ghostDetail = null;

    this.faceHighlight = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98),
      MATERIALS.highlight,
    );
    this.faceHighlight.visible = false;
    this.helpers.add(this.faceHighlight);

    // Red cage shown over the hovered block when the delete tool is active.
    this.deleteGhost = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 1.04, CELL * 1.04, CELL * 1.04),
      MATERIALS.ghostBad,
    );
    this.deleteGhost.visible = false;
    this.helpers.add(this.deleteGhost);

    this.gridHelper = new THREE.GridHelper(32, 32, 0x4a86b8, 0x263440);
    this.gridHelper.material.transparent = true;
    this.gridHelper.material.opacity = 0.25;
    this.gridHelper.material.depthWrite = false;
    this.helpers.add(this.gridHelper);

    this.onChange = () => {};
  }

  get vehicle() { return this.game.playerVehicle; }
  get grid() { return this.vehicle.grid; }
  get inventory() { return this.game.inventory; }

  // =========================================================================
  enter() {
    this.active = true;
    this.helpers.visible = true;
    this.game.scene.add(this.helpers);
    this.vehicle.setFrozen(true);
    this._positionGrid();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._pushUndo();              // baseline so the first action is undoable
    this.onChange();
  }

  exit() {
    this.active = false;
    this.helpers.removeFromParent();
    this.hover = null;
    this.placement = null;
    this.deleteMode = false;
    this.deleteGhost.visible = false;
  }

  _positionGrid() {
    const v = this.vehicle;
    const b = this.grid.bounds();
    const t = v.mainAssembly ? v.mainAssembly.group.position : new THREE.Vector3();
    this.gridHelper.position.set(t.x, t.y + (b ? (b.lo[1] - 0.5) * CELL : -0.5), t.z);
    this.gridHelper.quaternion.copy(v.quaternion);
  }

  // =========================================================================
  // selection / orientation
  // =========================================================================
  select(id) {
    if (!BlockRegistry.has(id)) return;
    this.selectedId = id;
    this.deleteMode = false;        // equipping a part always leaves delete mode
    const def = BlockRegistry.get(id);
    this.orient = 0; this._rollSteps = 0; this._manual = false;
    void def;
    this.onChange();
  }

  /** Put the current part away — nothing is held, so left-click places nothing. */
  unequip() {
    this.selectedId = null;
    this._ghostId = null;
    this.ghost.visible = false;
    this.onChange();
  }

  cycleSelection(dir) {
    const list = this._availableBlocks();
    if (!list.length) return;
    let i = list.findIndex((d) => d.id === this.selectedId);
    if (i < 0) i = 0;
    i = (i + dir + list.length) % list.length;
    this.select(list[i].id);
  }

  _availableBlocks() {
    return BlockRegistry.all().filter((d) => this.inventory.count(d.id) > 0 || this.inventory.creative);
  }

  /** Rotate the held part about an axis ('x'|'y'|'z'). Works on EVERY block —
   *  the first manual rotation takes an auto-oriented part off auto-snap so all
   *  three axes become usable. */
  rotate(axis, steps = 1) {
    if (axis === 'x' || axis === 'y' || axis === 'z') this.rotAxis = axis;
    this.orient = rotateOrientation(this.orient, this.rotAxis, steps);
    this._manual = true;
    this.onChange();
  }

  cycleAxis(dir) {
    const axes = ['x', 'y', 'z'];
    const i = axes.indexOf(this.rotAxis);
    this.rotAxis = axes[(i + dir + 3) % 3];
    this.onChange();
  }

  toggleSymmetry() { this.symmetry = !this.symmetry; this.onChange(); }

  // =========================================================================
  // per-frame
  // =========================================================================
  toggleDelete() { this.deleteMode = !this.deleteMode; return this.deleteMode; }

  update() {
    if (!this.active) return;
    this._positionGrid();
    this._pick();
    if (this.deleteMode) {
      this.ghost.visible = false;
      this._updateDeleteGhost();
    } else if (!this.selectedId) {
      this.ghost.visible = false;        // nothing equipped: no ghost, nothing to place
      this.deleteGhost.visible = false;
    } else {
      this.deleteGhost.visible = false;
      this._updateGhost();
    }
  }

  /** Position the red delete cage over the hovered block. */
  _updateDeleteGhost() {
    const h = this.hover;
    if (!h || h.uid == null) { this.deleteGhost.visible = false; return; }
    const block = this.grid.blocks.get(h.uid);
    if (!block) { this.deleteGhost.visible = false; return; }
    const a = this.vehicle.mainAssembly;
    const local = this.grid.blockLocalPosition(block);
    this.deleteGhost.position.set(local[0], local[1], local[2])
      .applyQuaternion(a.group.quaternion).add(a.group.position);
    this.deleteGhost.quaternion.copy(a.group.quaternion);
    this.deleteGhost.visible = true;
  }

  /** Remove the block currently under the cursor (used by the delete tool). */
  tryDeleteHovered() {
    if (!this.hover || this.hover.uid == null) return { ok: false };
    return this.tryRemove();
  }

  _pick() {
    const input = this.game.input;
    if (input.mouse.overUI) { this.hover = null; this.placement = null; this.faceHighlight.visible = false; return; }

    _ndc.set(input.mouse.ndcX, input.mouse.ndcY);
    _ray.setFromCamera(_ndc, this.game.camera);

    const v = this.vehicle;
    const targets = [];
    v.root.traverse((o) => { if (o.isMesh) targets.push(o); });
    const hits = _ray.intersectObjects(targets, false);

    let result = null;
    if (hits.length) {
      const hit = hits[0];
      const uid = findUid(hit.object);
      if (uid != null) {
        // face normal -> vehicle-local, snapped to an axis
        _m3.getNormalMatrix(hit.object.matrixWorld);
        _n.copy(hit.face.normal).applyMatrix3(_m3).normalize();
        const assembly = v.mainAssembly;
        _n.applyQuaternion(assembly.group.getWorldQuaternion(_tmpQ).invert());
        snapAxis(_n);
        _p.copy(hit.point);
        assembly.group.worldToLocal(_p);
        const cell = [
          Math.round((_p.x - _n.x * 0.5) / CELL),
          Math.round((_p.y - _n.y * 0.5) / CELL),
          Math.round((_p.z - _n.z * 0.5) / CELL),
        ];
        result = { cell, normal: [_n.x, _n.y, _n.z], uid };
      }
    }
    this.hover = result;

    if (!result) {
      this.placement = null;
      this.faceHighlight.visible = false;
      return;
    }

    // face highlight sits on the clicked face
    const a = this.vehicle.mainAssembly;
    const fx = (result.cell[0] + result.normal[0] * 0.5) * CELL;
    const fy = (result.cell[1] + result.normal[1] * 0.5) * CELL;
    const fz = (result.cell[2] + result.normal[2] * 0.5) * CELL;
    this.faceHighlight.position.set(fx, fy, fz).applyQuaternion(a.group.quaternion).add(a.group.position);
    const nq = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(...result.normal),
    );
    this.faceHighlight.quaternion.copy(a.group.quaternion).multiply(nq);
    this.faceHighlight.position.addScaledVector(
      new THREE.Vector3(...result.normal).applyQuaternion(a.group.quaternion), 0.012,
    );
    this.faceHighlight.visible = true;

    // candidate placement
    const target = [
      result.cell[0] + result.normal[0],
      result.cell[1] + result.normal[1],
      result.cell[2] + result.normal[2],
    ];
    const orient = this._orientFor(result.normal);
    const check = this.grid.canPlace(this.selectedId, target, orient);
    const stocked = this.inventory.has(this.selectedId, this.symmetry && this._mirrorOf(target) ? 2 : 1);
    this.placement = {
      ok: check.ok && stocked,
      reason: !check.ok ? check.reason : (!stocked ? 'Not enough parts in inventory' : null),
      cell: target, orient,
    };
  }

  _orientFor(normal) {
    const def = BlockRegistry.get(this.selectedId);
    if (!def) return this.orient;
    // Once the player manually rotates (R/T/H), use that orientation verbatim so
    // all three axes work even on auto-oriented parts.
    if (def.autoOrient && !this._manual) {
      // mount face must point back into the block we clicked on
      const back = [-normal[0], -normal[1], -normal[2]];
      const base = orientationMapping(def.mountFace, back);
      if (base < 0) return this.orient;
      // user rolls the part around its own mount axis with R
      let o = base;
      const axis = Math.abs(back[0]) ? 'x' : Math.abs(back[1]) ? 'y' : 'z';
      const steps = this._rollSteps || 0;
      if (steps) o = rotateOrientation(o, axis, steps);
      return o;
    }
    return this.orient;
  }

  _updateGhost() {
    const p = this.placement;
    if (!p) { this.ghost.visible = false; return; }
    this.ghost.visible = true;

    if (this._ghostId !== this.selectedId || this._ghostDetail !== this.game.detail) {
      this.ghost.clear();
      const model = BlockRegistry.createModel(this.selectedId, 0);
      model.traverse((o) => {
        if (o.isMesh) { o.material = MATERIALS.ghostOk; o.castShadow = false; o.receiveShadow = false; }
      });
      this.ghost.add(model);
      this._ghostId = this.selectedId;
      this._ghostDetail = this.game.detail;
    }
    const mat = p.ok ? MATERIALS.ghostOk : MATERIALS.ghostBad;
    this.ghost.traverse((o) => { if (o.isMesh) o.material = mat; });

    const a = this.vehicle.mainAssembly;
    // Centre the ghost on the block's FULL footprint so a multi-cell part (tread)
    // previews exactly where it will be placed — no 1.5-cell drift.
    const def = BlockRegistry.get(this.selectedId);
    const cells = worldCells(def, p.cell, p.orient);
    let cx = 0, cy = 0, cz = 0;
    for (const c of cells) { cx += c[0]; cy += c[1]; cz += c[2]; }
    const n = cells.length || 1;
    const local = new THREE.Vector3((cx / n) * CELL, (cy / n) * CELL, (cz / n) * CELL);
    this.ghost.position.copy(local).applyQuaternion(a.group.quaternion).add(a.group.position);
    this.ghost.quaternion.copy(a.group.quaternion).multiply(ORIENTATIONS[p.orient]);
  }

  // =========================================================================
  // actions
  // =========================================================================

  tryPlace() {
    if (!this.selectedId) return { ok: false };     // nothing equipped — silent no-op
    const p = this.placement;
    if (!p) return { ok: false, reason: 'Nothing targeted' };
    if (!p.ok) return { ok: false, reason: p.reason || 'Invalid placement' };

    const mirror = this.symmetry ? this._mirrorOf(p.cell) : null;
    const needed = mirror ? 2 : 1;
    if (!this.inventory.has(this.selectedId, needed)) {
      return { ok: false, reason: 'Not enough parts in inventory' };
    }

    this._pushUndo();
    const placed = this.grid.place(this.selectedId, p.cell, p.orient);
    if (!placed) { this.undoStack.pop(); return { ok: false, reason: 'Placement rejected by grid' }; }
    this.inventory.take(this.selectedId, 1);

    let mirrored = null;
    if (mirror) {
      const def = BlockRegistry.get(this.selectedId);
      const mo = def.mountFace
        ? mirrorMountOrientation(p.orient, def.mountFace, 'x')
        : mirrorOrientation(p.orient, 'x');
      const check = this.grid.canPlace(this.selectedId, mirror, mo);
      if (check.ok) {
        mirrored = this.grid.place(this.selectedId, mirror, mo);
        if (mirrored) this.inventory.take(this.selectedId, 1);
      }
    }

    this.redoStack.length = 0;
    this._rebuild();
    return { ok: true, block: placed, mirrored };
  }

  tryRemove() {
    const h = this.hover;
    if (!h) return { ok: false, reason: 'Nothing targeted' };
    const b = this.grid.blocks.get(h.uid);
    if (!b) return { ok: false, reason: 'Nothing targeted' };
    // The cab is the one block you can never remove — it is the machine's core.
    if (b.def.behavior === 'cab') {
      return { ok: false, reason: 'The Controller Cab cannot be removed' };
    }

    this._pushUndo();
    const removed = this.grid.remove(b.uid);
    if (!removed) { this.undoStack.pop(); return { ok: false, reason: 'Removal failed' }; }
    this.inventory.add(removed.id, 1);

    // symmetric partner (never the cab)
    if (this.symmetry) {
      const m = this._mirrorOf(removed.pos);
      if (m) {
        const partner = this.grid.blockAt(m[0], m[1], m[2]);
        if (partner && partner.id === removed.id && partner.def.behavior !== 'cab') {
          this.grid.remove(partner.uid);
          this.inventory.add(partner.id, 1);
        }
      }
    }

    // Deleting a block can strand whatever hung off it. Those blocks come off
    // too and go straight back into the inventory, so nothing is ever lost.
    let stranded = 0;
    const parts = this.grid.computeAssemblies();
    for (const group of parts.detached) {
      for (const uid of group) {
        const d = this.grid.remove(uid);
        if (d) { this.inventory.add(d.id, 1); stranded++; }
      }
    }

    this.redoStack.length = 0;
    this._rebuild();
    return { ok: true, block: removed, stranded };
  }

  /** Mirror a grid position across the cab's X plane. Returns null if it maps to itself. */
  _mirrorOf(pos) {
    const cab = this.grid.cab();
    if (!cab) return null;
    const cx = cab.pos[0];
    const mx = 2 * cx - pos[0];
    if (mx === pos[0]) return null;
    return [mx, pos[1], pos[2]];
  }

  // ---- undo / redo -------------------------------------------------------
  _snapshot() {
    return {
      grid: this.grid.serialize(),
      inv: this.inventory.toJSON(),
    };
  }

  _pushUndo() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  _restore(snap) {
    const { grid, errors } = VehicleGrid.deserialize(snap.grid);
    if (errors.length) console.warn('[build] undo restore warnings:', errors);
    this.vehicle.grid = grid;
    this.inventory.items = new Map(Object.entries(snap.inv));
    this.inventory._emit();
    this._rebuild();
  }

  undo() {
    if (this.undoStack.length <= 1) return false;
    const current = this._snapshot();
    const prev = this.undoStack.pop();
    this.redoStack.push(current);
    this._restore(prev);
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const current = this._snapshot();
    const next = this.redoStack.pop();
    this.undoStack.push(current);
    this._restore(next);
    return true;
  }

  _rebuild() {
    this.vehicle.build({ preserveMotion: true });
    this.vehicle.setFrozen(true);
    this._ghostId = null;           // force ghost refresh (materials were swapped)
    this.onChange();
  }
}

const _tmpQ = new THREE.Quaternion();

function findUid(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.uid != null) return o.userData.uid;
    o = o.parent;
  }
  return null;
}

function snapAxis(v) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ax >= ay && ax >= az) v.set(Math.sign(v.x), 0, 0);
  else if (ay >= az) v.set(0, Math.sign(v.y), 0);
  else v.set(0, 0, Math.sign(v.z));
}
