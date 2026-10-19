import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { group, test, assert, eq, near, deepEq, summary } from './harness.js';
import BlockRegistry, { CELL, CATEGORIES } from '../vehicles/BlockRegistry.js';
import { VehicleGrid, worldCells, worldAttachFaces, keyOf } from '../vehicles/VehicleGrid.js';
import {
  ORIENTATIONS, rotateDir, rotateOrientation, orientationMapping,
  mirrorOrientation, mirrorMountOrientation, indexOfQuaternion,
} from '../vehicles/Orientation.js';
import { Inventory, STARTER_INVENTORY } from '../systems/Inventory.js';
import { SaveSystem, validateWorld, SAVE_VERSION } from '../systems/SaveSystem.js';
import { PhysicsWorld, FIXED_DT, GROUPS } from '../core/PhysicsWorld.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { Arena, mulberry32 } from '../world/Arena.js';
import { Terrain } from '../world/Terrain.js';
import { ResourceSystem, RESOURCES } from '../systems/ResourceSystem.js';
import { STARTER_BLUEPRINT } from '../core/Game.js';
import { DEFAULT_BINDINGS } from '../core/Input.js';
import { Settings } from '../core/Settings.js';
import { DamageSystem } from '../systems/DamageSystem.js';
import { Salvage } from '../systems/Salvage.js';
import * as enemies from '../ai/EnemyBlueprints.js';

const combat = { DamageSystem, Salvage };

/** Minimal stand-in for Game, enough for Vehicle/Arena to run headless. */
function fakeGame(physics) {
  return { physics, scene: new THREE.Scene() };
}

function gridWith(blocks) {
  const g = new VehicleGrid();
  for (const [id, pos, orient] of blocks) g.place(id, pos, orient ?? 0, { verbose: false });
  return g;
}

export async function runAll() {
  // =======================================================================
  group('orientation');

  await test('there are exactly 24 axis-aligned orientations', () => {
    eq(ORIENTATIONS.length, 24);
  });

  await test('orientations are all distinct rotations', () => {
    const seen = new Set();
    for (const q of ORIENTATIONS) {
      const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
      seen.add(m.elements.map((v) => Math.round(v)).join(','));
    }
    eq(seen.size, 24);
  });

  await test('rotating +Z four times about Y returns to start', () => {
    let o = 0;
    for (let i = 0; i < 4; i++) o = rotateOrientation(o, 'y');
    deepEq(rotateDir([0, 0, 1], o), [0, 0, 1]);
  });

  await test('one 90° turn about Y maps +Z to +X', () => {
    const o = rotateOrientation(0, 'y', 1);
    deepEq(rotateDir([0, 0, 1], o), [1, 0, 0]);
  });

  await test('orientationMapping aligns a mount face with a target direction', () => {
    for (const target of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const o = orientationMapping([-1, 0, 0], target);
      assert(o >= 0, `no orientation found for ${target}`);
      deepEq(rotateDir([-1, 0, 0], o), target, `mount face did not land on ${target}`);
    }
  });

  await test('mirrorOrientation yields a valid orientation and mirrors direction', () => {
    for (let o = 0; o < 24; o++) {
      const m = mirrorOrientation(o, 'x');
      assert(m >= 0 && m < 24, 'mirror produced an out-of-range index');
      const d = rotateDir([0, 0, 1], o);
      const dm = rotateDir([0, 0, 1], m);
      deepEq(dm, [-d[0], d[1], d[2]], `mirror of orientation ${o} is wrong`);
    }
  });

  await test('mirroring a mount-face block keeps its hub pointing at the hull', () => {
    const mount = [-1, 0, 0];
    // right-hand wheel: hub faces -X, hull is on its -X side
    const right = orientationMapping(mount, [-1, 0, 0]);
    const mirroredLeft = mirrorMountOrientation(right, mount, 'x');
    deepEq(rotateDir(mount, mirroredLeft), [1, 0, 0],
      'mirrored wheel hub should face +X so it bolts to a hull on its +X side');
    // and mirroring back returns the original mount direction
    deepEq(rotateDir(mount, mirrorMountOrientation(mirroredLeft, mount, 'x')), [-1, 0, 0]);
  });

  await test('symmetry mirrors a wheel onto a valid cell on the far side', () => {
    const g = gridWith([['cab', [0, 0, 0]]]);
    const right = orientationMapping([-1, 0, 0], [-1, 0, 0]);
    assert(g.place('wheel', [1, 0, 0], right, { verbose: false }), 'right wheel rejected');
    const left = mirrorMountOrientation(right, [-1, 0, 0], 'x');
    assert(g.place('wheel', [-1, 0, 0], left, { verbose: false }), 'mirrored left wheel rejected');
    eq(g.computeAssemblies().detached.length, 0, 'mirrored wheel ended up detached');
  });

  // =======================================================================
  group('grid snapping & placement');

  await test('a 1x1x1 block occupies exactly its own cell', () => {
    const def = BlockRegistry.get('structural');
    deepEq(worldCells(def, [3, -2, 5], 0), [[3, -2, 5]]);
  });

  await test('cells stay anchored when the block is rotated', () => {
    const def = BlockRegistry.get('structural');
    for (let o = 0; o < 24; o++) deepEq(worldCells(def, [1, 2, 3], o), [[1, 2, 3]]);
  });

  await test('first block must be a controller cab', () => {
    const g = new VehicleGrid();
    const bad = g.canPlace('structural', [0, 0, 0], 0);
    assert(!bad.ok, 'structural block was wrongly accepted as the first block');
    const good = g.canPlace('cab', [0, 0, 0], 0);
    assert(good.ok, `cab rejected as first block: ${good.reason}`);
  });

  await test('valid placement on an adjacent face succeeds', () => {
    const g = gridWith([['cab', [0, 0, 0]]]);
    const b = g.place('structural', [0, 0, -1], 0, { verbose: false });
    assert(b, 'adjacent structural block was rejected');
    eq(g.size, 2);
  });

  await test('overlapping placement is rejected', () => {
    const g = gridWith([['cab', [0, 0, 0]], ['structural', [0, 0, -1]]]);
    const res = g.canPlace('structural', [0, 0, -1], 0);
    assert(!res.ok, 'overlap was allowed');
    eq(res.reason, 'Cell already occupied');
    eq(g.place('structural', [0, 0, -1], 0, { verbose: false }), null);
    eq(g.size, 2, 'rejected placement must not change the grid');
  });

  await test('floating placement with no touching face is rejected', () => {
    const g = gridWith([['cab', [0, 0, 0]]]);
    const res = g.canPlace('structural', [0, 3, 0], 0);
    assert(!res.ok, 'floating block was allowed');
    assert(/attachment/i.test(res.reason), `unexpected reason: ${res.reason}`);
  });

  await test('a second controller cab is rejected', () => {
    const g = gridWith([['cab', [0, 0, 0]]]);
    const res = g.canPlace('cab', [0, 0, -1], 0);
    assert(!res.ok, 'second cab was allowed');
    assert(/only one/i.test(res.reason), `unexpected reason: ${res.reason}`);
  });

  await test('wheels only attach through their hub face', () => {
    const g = gridWith([['cab', [0, 0, 0]]]);
    const def = BlockRegistry.get('wheel');
    // orientation 0 leaves the hub facing -X, so it can only bolt to a block at -X
    const faces = worldAttachFaces(def, 0);
    eq(faces.length, 1);
    deepEq(faces[0], [-1, 0, 0]);
    assert(g.canPlace('wheel', [1, 0, 0], 0).ok, 'wheel should attach to the -X neighbour');
    assert(!g.canPlace('wheel', [-1, 0, 0], 0).ok, 'wheel attached through a non-hub face');
  });

  await test('auto-orientation lets a wheel mount on either side', () => {
    const g = gridWith([['cab', [0, 0, 0]]]);
    const left = orientationMapping([-1, 0, 0], [1, 0, 0]);   // hub points +X -> block sits at -X
    assert(g.canPlace('wheel', [-1, 0, 0], left).ok, 'left-side wheel rejected');
  });

  // =======================================================================
  group('structural connectivity');

  await test('a connected machine is a single assembly', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const a = g.computeAssemblies();
    eq(a.detached.length, 0, 'starter machine should have no detached parts');
    eq(a.main.length, g.size);
  });

  await test('removing a spine block splits the machine into two assemblies', () => {
    // self-contained spine so the test does not depend on the starter's shape
    const g = gridWith([
      ['cab', [0, 0, 2]], ['structural', [0, 0, 1]], ['structural', [0, 0, 0]],
      ['structural', [0, 0, -1]], ['structural', [0, 0, -2]],
    ]);
    const spine = g.blockAt(0, 0, 0);
    assert(spine, 'expected a structural block at the origin');
    g.remove(spine.uid);
    const a = g.computeAssemblies();
    eq(a.detached.length, 1, 'expected exactly one detached group');
    const detachedCount = a.detached[0].length;
    eq(detachedCount, 2, 'the two blocks beyond the cut should detach together');
    eq(a.main.length + detachedCount, g.size);
  });

  await test('every block in the main assembly is flagged connected', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    g.computeAssemblies();
    for (const b of g.list()) assert(b.connected, `${b.id} was not flagged connected`);
  });

  await test('wouldOrphan predicts a split without mutating the grid', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const before = g.size;
    const spine = g.blockAt(0, 0, 0);
    assert(g.wouldOrphan(spine.uid), 'removing the spine should orphan the rear');
    eq(g.size, before, 'wouldOrphan must not change the grid');
    const wheel = g.blockAt(1, 0, 1);
    assert(!g.wouldOrphan(wheel.uid), 'removing a wheel should not orphan anything');
    eq(g.size, before);
  });

  // =======================================================================
  group('validation');

  await test('a machine with no cab fails validation', () => {
    const g = gridWith([['cab', [0, 0, 0]], ['structural', [0, 0, -1]]]);
    g.remove(g.cab().uid);
    const v = g.validate();
    assert(!v.ok);
    assert(v.errors.some((e) => /No Controller Cab/.test(e)), `unexpected errors: ${v.errors}`);
  });

  await test('the starter machine validates clean', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = g.validate();
    assert(v.ok, `starter machine failed validation: ${v.errors.join(', ')}`);
    eq(v.warnings.length, 0, `unexpected warnings: ${v.warnings.join(', ')}`);
  });

  await test('a machine with no wheels warns but stays valid', () => {
    const g = gridWith([['cab', [0, 0, 0]], ['engine', [0, 0, -1]]]);
    const v = g.validate();
    assert(v.ok);
    assert(v.warnings.some((w) => /No wheels/.test(w)));
  });

  // =======================================================================
  group('stats');

  await test('mass is the sum of block masses', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    let expected = 0;
    for (const b of g.list()) expected += b.def.mass;
    near(g.stats().mass, expected, 1e-9);
  });

  await test('destroyed engines contribute no power', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const withEngine = g.stats().power;
    assert(withEngine > 0);
    const eng = g.list().find((b) => b.def.behavior === 'engine');
    eng.health = 0;
    eq(g.stats().power, 0, 'a dead engine still produced power');
  });

  // =======================================================================
  group('inventory');

  await test('placing consumes stock and removing refunds it', () => {
    const inv = new Inventory({ structural: 2 });
    eq(inv.count('structural'), 2);
    assert(inv.take('structural'), 'take should succeed');
    eq(inv.count('structural'), 1);
    inv.add('structural', 1);
    eq(inv.count('structural'), 2);
  });

  await test('taking more than you own fails and changes nothing', () => {
    const inv = new Inventory({ wheel: 1 });
    assert(!inv.take('wheel', 2), 'overdraw should fail');
    eq(inv.count('wheel'), 1);
  });

  await test('creative mode is unlimited and never decrements', () => {
    const inv = new Inventory({}, true);
    eq(inv.count('structural'), Infinity);
    assert(inv.take('structural', 999));
    eq(inv.count('structural'), Infinity);
  });

  await test('unknown block ids are refused', () => {
    const inv = new Inventory({});
    inv.add('definitely_not_a_block', 5);
    eq(inv.count('definitely_not_a_block'), 0);
  });

  await test('inventory survives a JSON round trip', () => {
    const inv = new Inventory(STARTER_INVENTORY);
    const back = Inventory.fromJSON(inv.toJSON());
    for (const [id, n] of inv.nonEmpty()) eq(back.count(id), n, `${id} count changed`);
  });

  await test('the starter kit can actually build the starter machine', () => {
    const inv = new Inventory(STARTER_INVENTORY);
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    for (const b of g.list()) assert(inv.take(b.id, 1), `not enough ${b.id} in the starter kit`);
  });

  // =======================================================================
  group('blueprint serialisation');

  await test('serialise → deserialise preserves every block', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const round = VehicleGrid.deserialize(g.serialize());
    eq(round.errors.length, 0, `round trip reported errors: ${round.errors.join(', ')}`);
    eq(round.grid.size, g.size);
    for (const b of g.list()) {
      const other = round.grid.blockAt(b.pos[0], b.pos[1], b.pos[2]);
      assert(other, `block missing at ${b.pos}`);
      eq(other.id, b.id);
      eq(other.orient, b.orient);
    }
  });

  await test('block health is carried through serialisation', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const cab = g.cab();
    cab.health = 97;
    const round = VehicleGrid.deserialize(g.serialize()).grid;
    eq(round.cab().health, 97);
  });

  await test('a rotated design round-trips exactly', () => {
    const g = new VehicleGrid();
    g.place('cab', [0, 0, 0], 5, { verbose: false });
    g.place('structural', [0, 1, 0], 11, { verbose: false });
    g.place('armor', [0, 2, 0], 19, { verbose: false });
    const back = VehicleGrid.deserialize(g.serialize()).grid;
    eq(back.size, 3);
    eq(back.blockAt(0, 1, 0).orient, 11);
    eq(back.blockAt(0, 2, 0).orient, 19);
  });

  await test('corrupt blueprints are rejected without throwing', () => {
    for (const bad of [null, undefined, 42, 'nope', {}, { v: 99, blocks: [] }, { v: 2 }]) {
      const r = VehicleGrid.deserialize(bad);
      assert(r.errors.length > 0, `bad input ${JSON.stringify(bad)} produced no error`);
      eq(r.grid.size, 0);
    }
  });

  await test('unknown block ids inside a blueprint are skipped, not fatal', () => {
    const bp = {
      v: 2,
      blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'ghost_block', p: [0, 0, -1], o: 0 },
        { i: 'structural', p: [0, 0, -1], o: 0 },
      ],
    };
    const r = VehicleGrid.deserialize(bp);
    eq(r.grid.size, 2);
    assert(r.errors.some((e) => /ghost_block/.test(e)));
  });

  await test('a blueprint with overlapping blocks loads the legal subset', () => {
    const bp = {
      v: 2,
      blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, -1], o: 0 },
        { i: 'armor', p: [0, 0, -1], o: 0 },
      ],
    };
    const r = VehicleGrid.deserialize(bp);
    eq(r.grid.size, 2);
    assert(r.errors.length > 0);
  });

  // =======================================================================
  group('control bindings');

  await test('default bindings have no duplicate keys within a mode', () => {
    const driving = ['throttle', 'brake', 'steerLeft', 'steerRight', 'handbrake', 'interact', 'recover', 'camReset', 'buildMode'];
    const used = new Map();
    for (const a of driving) {
      const code = DEFAULT_BINDINGS[a];
      assert(!used.has(code), `${a} and ${used.get(code)} both bound to ${code}`);
      used.set(code, a);
    }
  });

  await test('bindings survive a settings round trip', () => {
    const s = new Settings();
    const custom = { ...DEFAULT_BINDINGS, throttle: 'ArrowUp', brake: 'ArrowDown' };
    s.set({ bindings: custom });
    const s2 = new Settings();
    eq(s2.data.bindings.throttle, 'ArrowUp');
    eq(s2.data.bindings.brake, 'ArrowDown');
    eq(s2.data.bindings.steerLeft, DEFAULT_BINDINGS.steerLeft, 'untouched binding changed');
    s.resetDefaults();
  });

  await test('every bindable action has a default', () => {
    for (const [action, code] of Object.entries(DEFAULT_BINDINGS)) {
      assert(typeof code === 'string' && code.length > 0, `${action} has no default binding`);
    }
  });

  // =======================================================================
  group('save validation');

  await test('a well-formed save record validates', () => {
    const rec = {
      version: SAVE_VERSION, savedAt: Date.now(),
      data: { seed: 5, blueprint: STARTER_BLUEPRINT, inventory: {}, playerPosition: [0, 1, 0] },
    };
    deepEq(validateWorld(rec), []);
  });

  await test('corrupt save records are caught', () => {
    assert(validateWorld(null).length > 0);
    assert(validateWorld({ version: 999, data: {} }).length > 0);
    assert(validateWorld({ version: SAVE_VERSION, data: { seed: NaN, blueprint: STARTER_BLUEPRINT } }).length > 0);
    assert(validateWorld({ version: SAVE_VERSION, data: { seed: 1 } }).length > 0);
    assert(validateWorld({
      version: SAVE_VERSION,
      data: { seed: 1, blueprint: STARTER_BLUEPRINT, playerPosition: [0, 'x', 0] },
    }).length > 0);
  });

  // =======================================================================
  group('procedural determinism');

  await test('the same seed produces the same random stream', () => {
    const a = mulberry32(12345), b = mulberry32(12345);
    for (let i = 0; i < 200; i++) eq(a(), b(), `stream diverged at ${i}`);
  });

  await test('different seeds produce different streams', () => {
    const a = mulberry32(1), b = mulberry32(2);
    let same = 0;
    for (let i = 0; i < 50; i++) if (a() === b()) same++;
    assert(same < 5, 'two different seeds produced nearly identical streams');
  });

  await test('the same seed rebuilds an identical arena layout', () => {
    const p1 = new PhysicsWorld();
    const p2 = new PhysicsWorld();
    const a1 = new Arena(fakeGame(p1), { seed: 777, size: 160 }).build();
    const a2 = new Arena(fakeGame(p2), { seed: 777, size: 160 }).build();
    eq(a1.bodies.length, a2.bodies.length, 'collider count differs');
    deepEq(a1.landmarks, a2.landmarks, 'landmark layout differs');
    const pos1 = a1.group.children.map((c) => [c.position.x.toFixed(4), c.position.z.toFixed(4)]);
    const pos2 = a2.group.children.map((c) => [c.position.x.toFixed(4), c.position.z.toFixed(4)]);
    deepEq(pos1, pos2, 'prop positions differ');
  });

  await test('a different seed produces a different arena', () => {
    const a1 = new Arena(fakeGame(new PhysicsWorld()), { seed: 1, size: 160 }).build();
    const a2 = new Arena(fakeGame(new PhysicsWorld()), { seed: 2, size: 160 }).build();
    const pos1 = JSON.stringify(a1.group.children.map((c) => c.position.toArray()));
    const pos2 = JSON.stringify(a2.group.children.map((c) => c.position.toArray()));
    assert(pos1 !== pos2, 'two seeds produced identical arenas');
  });

  // =======================================================================
  group('model generation');

  await test('every registered block produces a mesh with geometry', () => {
    for (const def of BlockRegistry.all()) {
      const m = BlockRegistry.createModel(def.id, 1);
      let verts = 0;
      m.traverse((o) => { if (o.isMesh && o.geometry) verts += o.geometry.attributes.position.count; });
      assert(verts > 0, `${def.id} generated no geometry`);
    }
  });

  await test('block models stay inside their grid cell footprint', () => {
    for (const def of BlockRegistry.all()) {
      for (const detail of [0, 1, 2]) {
        const m = BlockRegistry.createModel(def.id, detail);
        const box = new THREE.Box3().setFromObject(m);
        // Wheels bulge to their own radius; weapons/drills/mechanical parts have
        // functional protrusions (barrels, bits, output plates). Plain structure
        // must fit its cell so stacked blocks never interpenetrate.
        const protruding = ['weapon', 'turret', 'drill', 'joint', 'laser', 'smoke'].includes(def.behavior) || def.protrudes;
        const limit = def.behavior === 'wheel'
          // tyre radius, mount reach, or (for long treads) half the track length
          ? Math.max(def.wheel.radius + 0.1, (def.wheel.length ? def.wheel.length / 2 + 0.22 : 0), 0.55)
          : Math.max(...def.size) * CELL * 0.5 + (protruding ? 0.62 : 0.03);
        const worst = Math.max(
          Math.abs(box.max.x), Math.abs(box.max.y), Math.abs(box.max.z),
          Math.abs(box.min.x), Math.abs(box.min.y), Math.abs(box.min.z),
        );
        assert(worst <= limit,
          `${def.id} (detail ${detail}) overflows its cell: ${worst.toFixed(3)} > ${limit.toFixed(3)}`);
      }
    }
  });

  await test('models are cached and shared between instances', () => {
    const a = BlockRegistry.createModel('structural', 1);
    const b = BlockRegistry.createModel('structural', 1);
    assert(a !== b, 'createModel must return independent objects');
    const ga = a.children[0].geometry, gb = b.children[0].geometry;
    assert(ga === gb, 'geometry should be shared between instances');
    assert(a.children[0].material === b.children[0].material, 'material should be shared');
  });

  // =======================================================================
  group('physics integration');

  await test('a dynamic box falls and comes to rest on the ground', async () => {
    const physics = new PhysicsWorld();
    const world = physics.world;
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 2, 50).setTranslation(0, -2, 0).setCollisionGroups(GROUPS.ground),
      ground,
    );
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 8, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(GROUPS.vehicle), body);
    for (let i = 0; i < 240; i++) world.step();
    const y = body.translation().y;
    near(y, 0.5, 0.06, 'box did not settle on the ground surface');
  });

  await test('the starter machine rests on its suspension without sinking', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const arena = new Arena(game, { seed: 99, size: 160, clutter: false }).build();
    game.scene.add(arena.group);

    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = new Vehicle(game, { grid, position: [0, 3, 0], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    physics.onPreStep((dt) => v.fixedUpdate(dt));
    physics.onPostStep(() => v.postStep());

    for (let i = 0; i < 300; i++) physics.update(FIXED_DT);

    const p = v.worldPosition(new THREE.Vector3());
    assert(p.y > 0.2, `machine sank through the ground (y = ${p.y.toFixed(3)})`);
    assert(p.y < 1.6, `machine is floating (y = ${p.y.toFixed(3)})`);
    eq(v.telemetry.grounded, 4, 'all four wheels should be in contact');
    const lin = v.mainAssembly.body.linvel();
    assert(Math.hypot(lin.x, lin.y, lin.z) < 0.35,
      `machine never settled (speed ${Math.hypot(lin.x, lin.y, lin.z).toFixed(3)})`);
  });

  await test('throttle actually accelerates the machine forwards', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const arena = new Arena(game, { seed: 99, size: 200, clutter: false }).build();
    game.scene.add(arena.group);

    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = new Vehicle(game, { grid, position: [-80, 3, -60], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    physics.onPreStep((dt) => v.fixedUpdate(dt));
    physics.onPostStep(() => v.postStep());

    for (let i = 0; i < 120; i++) physics.update(FIXED_DT);   // settle
    const startZ = v.worldPosition(new THREE.Vector3()).z;

    v.setControls({ throttle: 1, steer: 0, brake: 0, handbrake: false });
    for (let i = 0; i < 180; i++) physics.update(FIXED_DT);   // 3 seconds of throttle

    const p = v.worldPosition(new THREE.Vector3());
    assert(p.z - startZ > 8, `machine barely moved: travelled ${(p.z - startZ).toFixed(2)} m in 3 s`);
    assert(v.telemetry.forwardSpeed > 4, `forward speed too low: ${v.telemetry.forwardSpeed.toFixed(2)} m/s`);
    assert(p.y > 0.2, 'machine fell through the world while driving');
  });

  await test('braking stops a moving machine', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const arena = new Arena(game, { seed: 99, size: 200, clutter: false }).build();
    game.scene.add(arena.group);
    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = new Vehicle(game, { grid, position: [-80, 3, -60], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    physics.onPreStep((dt) => v.fixedUpdate(dt));
    physics.onPostStep(() => v.postStep());

    for (let i = 0; i < 120; i++) physics.update(FIXED_DT);
    v.setControls({ throttle: 1, steer: 0, brake: 0, handbrake: false });
    for (let i = 0; i < 180; i++) physics.update(FIXED_DT);
    const fast = Math.abs(v.telemetry.forwardSpeed);
    assert(fast > 4, 'setup failed: machine never got up to speed');

    v.setControls({ throttle: 0, steer: 0, brake: 1, handbrake: true });
    for (let i = 0; i < 240; i++) physics.update(FIXED_DT);
    assert(Math.abs(v.telemetry.forwardSpeed) < 0.6,
      `braking failed: still moving at ${v.telemetry.forwardSpeed.toFixed(2)} m/s`);
  });

  await test('a machine driven at a wall is stopped by it', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const arena = new Arena(game, { seed: 99, size: 200, clutter: false }).build();   // test wall spans z = 26
    game.scene.add(arena.group);

    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = new Vehicle(game, { grid, position: [0, 3, 10], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    physics.onPreStep((dt) => v.fixedUpdate(dt));
    physics.onPostStep(() => v.postStep());

    for (let i = 0; i < 90; i++) physics.update(FIXED_DT);
    v.setControls({ throttle: 1, steer: 0, brake: 0, handbrake: false });
    for (let i = 0; i < 480; i++) physics.update(FIXED_DT);   // 8 s of full throttle into the wall

    const p = v.worldPosition(new THREE.Vector3());
    assert(p.z < 25.3, `machine drove through the wall (z = ${p.z.toFixed(2)}, wall front face is z = 25.25)`);
    assert(p.z > 18, `machine never reached the wall (z = ${p.z.toFixed(2)})`);
  });

  await test('a wheel marked destroyed stops producing grip', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const arena = new Arena(game, { seed: 99, size: 160, clutter: false }).build();
    game.scene.add(arena.group);
    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = new Vehicle(game, { grid, position: [0, 3, -40], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    physics.onPreStep((dt) => v.fixedUpdate(dt));
    physics.onPostStep(() => v.postStep());
    for (let i = 0; i < 150; i++) physics.update(FIXED_DT);
    eq(v.telemetry.grounded, 4);

    for (const w of v.mainAssembly.wheels) { if (w.hardpoint.x > 0) w.destroyed = true; }
    for (let i = 0; i < 90; i++) physics.update(FIXED_DT);
    eq(v.telemetry.grounded, 2, 'destroyed wheels should not report ground contact');
    for (const w of v.mainAssembly.wheels) {
      if (w.destroyed) eq(w.load, 0, 'a destroyed wheel still carried load');
    }
  });

  await test('rebuilding a vehicle preserves its motion state', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const arena = new Arena(game, { seed: 99, size: 160, clutter: false }).build();
    game.scene.add(arena.group);
    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = new Vehicle(game, { grid, position: [5, 3, -20], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    for (let i = 0; i < 120; i++) physics.update(FIXED_DT);
    const before = v.worldPosition(new THREE.Vector3()).clone();

    v.grid.place('armor', [0, 1, 1], 0, { verbose: false });
    v.build({ preserveMotion: true });
    const after = v.worldPosition(new THREE.Vector3());
    near(after.x, before.x, 1e-6, 'x moved during rebuild');
    near(after.z, before.z, 1e-6, 'z moved during rebuild');
  });

  await test('physics bodies and colliders are released when a vehicle is disposed', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const before = physics.stats();
    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const v = new Vehicle(game, { grid, position: [0, 3, 0], detail: 0 });
    game.scene.add(v.root);
    v.build();
    const during = physics.stats();
    assert(during.bodies > before.bodies, 'no body was created');
    assert(during.colliders >= 7, 'expected one collider per block');
    v.dispose();
    const after = physics.stats();
    eq(after.bodies, before.bodies, 'rigid body leaked');
    eq(after.colliders, before.colliders, 'colliders leaked');
    eq(physics.colliderMeta.size, 0, 'collider metadata leaked');
  });

  await test('fixed timestep runs a deterministic number of steps', () => {
    const physics = new PhysicsWorld();
    eq(physics.update(1 / 60), 1);
    eq(physics.update(1 / 30), 2);
    eq(physics.update(0), 0);
    near(physics.world.timestep, 1 / 60, 1e-9);
  });

  await test('reverse is geared far lower than forward', async () => {
    const drive = async (throttle, seconds) => {
      const physics = new PhysicsWorld();
      const game = fakeGame(physics);
      const arena = new Arena(game, { seed: 99, size: 200, clutter: false }).build();
      game.scene.add(arena.group);
      const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
      // Start at the far end of the lane so nine seconds of travel fits inside the arena,
      // whichever way the machine is being driven.
      const v = new Vehicle(game, { grid, position: [-80, 3, throttle > 0 ? -88 : 88], detail: 0 });
      game.scene.add(v.root);
      v.build();
      physics.onPreStep((dt) => v.fixedUpdate(dt));
      physics.onPostStep(() => v.postStep());
      for (let i = 0; i < 120; i++) physics.update(FIXED_DT);
      v.setControls({ throttle, steer: 0, brake: 0, handbrake: false });
      for (let i = 0; i < seconds * 60; i++) physics.update(FIXED_DT);
      return Math.abs(v.telemetry.forwardSpeed);
    };
    const fwd = await drive(1, 9);
    const rev = await drive(-0.72, 9);
    assert(fwd > 14, `forward top speed too low: ${fwd.toFixed(1)} m/s`);
    assert(rev < fwd * 0.55, `reverse is too fast: ${rev.toFixed(1)} vs forward ${fwd.toFixed(1)} m/s`);
    assert(rev > 2, `reverse barely works: ${rev.toFixed(1)} m/s`);
  });

  // =======================================================================
  group('persistence (IndexedDB)');

  const save = new SaveSystem();
  const TEST_SLOT = '__test__';

  await test('a saved world reads back identically', async () => {
    const payload = {
      seed: 24680,
      creative: false,
      blueprint: STARTER_BLUEPRINT,
      inventory: { structural: 7, wheel: 3 },
      playerPosition: [1.5, 2.5, -3.5],
      playerYaw: 0.75,
    };
    assert(await save.saveWorld(TEST_SLOT, payload), 'saveWorld reported failure');
    const rec = await save.loadWorld(TEST_SLOT);
    assert(rec, 'saved record could not be read back');
    eq(rec.version, SAVE_VERSION);
    eq(rec.data.seed, 24680);
    eq(rec.data.inventory.structural, 7);
    deepEq(rec.data.playerPosition, [1.5, 2.5, -3.5]);
    eq(rec.data.blueprint.blocks.length, STARTER_BLUEPRINT.blocks.length);
  });

  await test('loading a slot that was never written returns nothing', async () => {
    const rec = await save.loadWorld('__no_such_slot__');
    assert(!rec, `a missing slot must not produce a record, got ${JSON.stringify(rec)}`);
  });

  await test('deleting a world removes it', async () => {
    await save.deleteWorld(TEST_SLOT);
    assert(!(await save.loadWorld(TEST_SLOT)), 'world survived deletion');
  });

  // =======================================================================
  group('combat: damage & salvage');

  await test('armour softens damage but never fully negates it', () => {
    const { DamageSystem } = combat;
    const soft = DamageSystem.mitigate(100, 11);   // armour block
    const none = DamageSystem.mitigate(100, 0);    // bare
    assert(soft < none, 'armour should reduce damage');
    assert(soft >= 12, 'armour must never block more than ~88%');
    assert(DamageSystem.mitigate(100, 999) >= 12, 'infinite armour still lets 12% through');
  });

  await test('drills cut through armour better than kinetic rounds', () => {
    const { DamageSystem } = combat;
    assert(DamageSystem.mitigate(100, 11, 'drill') > DamageSystem.mitigate(100, 11, 'kinetic'));
  });

  await test('destroying the cab disables the machine but preserves its other blocks', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const before = g.size;
    const cab = g.cab();
    g.remove(cab.uid);
    eq(g.size, before - 1, 'only the cab should be gone');
    eq(g.cab(), null, 'no cab remains');
    // every surviving block is still present and salvageable
    const survivors = g.list();
    eq(survivors.length, before - 1);
    assert(survivors.every((b) => b.health > 0), 'survivors keep their health');
  });

  await test('salvage manifest lists survivors and take() transfers without loss', () => {
    const inv = new Inventory({});
    const wreckGame = {
      inventory: inv, vehicles: [], audio: null,
      removeVehicle(v) { const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1); },
    };
    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const wreck = { name: 'Wreck', grid, disabled: true, built: true, build() {}, worldPosition: (o) => (o || new THREE.Vector3()) };
    wreckGame.vehicles.push(wreck);
    const salvage = new combat.Salvage(wreckGame);

    const manifest = salvage.manifest(wreck);
    const wheelEntry = manifest.find((m) => m.id === 'wheel');
    eq(wheelEntry.count, 4, 'starter machine has 4 wheels to salvage');

    const beforeBlocks = grid.size;
    const took = salvage.take(wreck, 'wheel', 2);
    eq(took, 2, 'should take exactly 2 wheels');
    eq(inv.count('wheel'), 2, 'inventory gained exactly what was taken');
    eq(grid.size, beforeBlocks - 2, 'wreck lost exactly the taken blocks — no duplication');

    const rest = salvage.takeAll(wreck);
    eq(rest, beforeBlocks - 2, 'take-all grabs every remaining survivor');
    assert(!wreckGame.vehicles.includes(wreck), 'an emptied wreck is removed');
    // total conservation: inventory now holds every block the machine had
    let totalInv = 0; for (const [, n] of inv.nonEmpty()) totalInv += n;
    eq(totalInv, beforeBlocks, 'no blocks created or destroyed during salvage');
  });

  await test('destroyed blocks are never salvageable', () => {
    const inv = new Inventory({});
    const wreckGame = { inventory: inv, vehicles: [], audio: null, removeVehicle() {} };
    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const eng = grid.list().find((b) => b.def.behavior === 'engine');
    eng.health = 0;   // "destroyed" but still in grid for this check
    const wreck = { grid, disabled: true, built: true, build() {}, worldPosition: (o) => o || new THREE.Vector3() };
    const salvage = new combat.Salvage(wreckGame);
    assert(!salvage.manifest(wreck).some((m) => m.id === 'engine'), 'a dead engine must not appear in salvage');
  });

  // =======================================================================
  group('enemy blueprints');

  await test('every enemy variant builds a valid, cab-led machine', () => {
    for (const [id, arch] of Object.entries(enemies.ARCHETYPES)) {
      for (let i = 0; i < arch.variants.length; i++) {
        const { grid, errors } = VehicleGrid.deserialize(arch.variants[i]);
        eq(errors.length, 0, `${id} variant ${i} load errors: ${errors.join(', ')}`);
        const val = grid.validate();
        assert(val.ok, `${id} variant ${i} invalid: ${val.errors.join(', ')}`);
        assert(grid.cab(), `${id} variant ${i} has no cab`);
      }
    }
  });

  await test('enemy blueprints only reference real blocks', () => {
    for (const [id, arch] of Object.entries(enemies.ARCHETYPES)) {
      for (const variant of arch.variants) {
        for (const blk of variant.blocks) {
          assert(BlockRegistry.has(blk.i), `${id} references unknown block "${blk.i}"`);
        }
      }
    }
  });

  await test('enemy archetypes cover every tier 1..3', () => {
    const tiers = new Set(Object.values(enemies.ARCHETYPES).map((a) => a.tier));
    for (const t of [1, 2, 3]) assert(tiers.has(t), `no archetype at tier ${t}`);
  });

  await test('blueprints save, list and delete', async () => {
    const before = (await save.listBlueprints()).length;
    const n = STARTER_BLUEPRINT.blocks.length;
    const id = await save.saveBlueprint('__test rig__', STARTER_BLUEPRINT, { blocks: n });
    assert(id != null, 'saveBlueprint returned no id');
    const rows = await save.listBlueprints();
    eq(rows.length, before + 1, 'blueprint count did not grow');
    const mine = rows.find((r) => r.id === id);
    assert(mine, 'saved blueprint missing from the list');
    eq(mine.name, '__test rig__');
    eq(mine.blueprint.blocks.length, n);
    await save.deleteBlueprint(id);
    eq((await save.listBlueprints()).length, before, 'blueprint survived deletion');
  });

  // =======================================================================
  group('procedural terrain (M4)');

  // Height sampling without physics: replicate build()'s prelude.
  const sampleTerrain = (seed) => {
    const t = new Terrain({}, { seed, size: 400, cells: 64 });
    t.spawnHeight = t._elevation(0, 0);
    t._sampleHeights();
    return t;
  };

  await test('the same seed produces an identical heightmap', () => {
    const a = sampleTerrain(4242), b = sampleTerrain(4242);
    eq(a.heights.length, b.heights.length, 'height arrays differ in size');
    let maxDiff = 0;
    for (let i = 0; i < a.heights.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a.heights[i] - b.heights[i]));
    near(maxDiff, 0, 1e-9, 'same seed gave different terrain');
  });

  await test('different seeds produce different terrain', () => {
    const a = sampleTerrain(1), b = sampleTerrain(2);
    let diff = 0;
    for (let i = 0; i < a.heights.length; i++) diff += Math.abs(a.heights[i] - b.heights[i]);
    assert(diff > 50, `terrain barely changed across seeds (total diff ${diff.toFixed(1)})`);
  });

  await test('heightAt bilinear matches the stored grid at sample nodes', () => {
    const t = sampleTerrain(77);
    const N = t.N, size = t.size;
    for (const [i, j] of [[10, 10], [0, 0], [N, N], [32, 5]]) {
      const x = (i / N - 0.5) * size, z = (j / N - 0.5) * size;
      near(t.heightAt(x, z), t.heights[j * (N + 1) + i], 1e-4,
        `heightAt disagrees with grid at (${i},${j})`);
    }
  });

  await test('the spawn zone is flattened for a safe start', () => {
    const t = sampleTerrain(5);
    near(t.heightAt(0, 0), t.spawnHeight, 0.01, 'origin is not at spawn height');
    const slope = Math.abs(t.heightAt(0, 0) - t.heightAt(4, 0)) + Math.abs(t.heightAt(0, 0) - t.heightAt(0, 4));
    assert(slope < 1.0, `spawn is too steep (slope ${slope.toFixed(2)})`);
  });

  await test('terrain classifies into multiple biomes', () => {
    const t = sampleTerrain(9);
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const x = (mulberry32(i + 1)() - 0.5) * t.size * 0.8;
      const z = (mulberry32(i + 999)() - 0.5) * t.size * 0.8;
      seen.add(t.biomeAt(x, z));
    }
    assert(seen.size >= 3, `expected several biomes, saw ${[...seen].join(',')}`);
  });

  await test('a vehicle rests on the heightfield without sinking', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    const terrain = new Terrain(game, { seed: 2024, size: 300, cells: 96 }).build();
    game.scene.add(terrain.group);
    game.arena = terrain;

    const grid = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const gy = terrain.heightAt(0, 0);
    const v = new Vehicle(game, { grid, position: [0, gy + 3, 0], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    physics.onPreStep((dt) => v.fixedUpdate(dt));
    physics.onPostStep(() => v.postStep());
    for (let i = 0; i < 300; i++) physics.update(FIXED_DT);

    const t = v.mainAssembly.body.translation();
    const ground = terrain.heightAt(t.x, t.z);
    assert(t.y - ground > 0.1, `machine sank into the terrain (gap ${(t.y - ground).toFixed(2)})`);
    assert(t.y - ground < 1.8, `machine floats above the terrain (gap ${(t.y - ground).toFixed(2)})`);
    eq(v.telemetry.grounded, 4, 'all four wheels should rest on the terrain');
  });

  await test('resource definitions reference real blocks and biomes', () => {
    const validBiomes = new Set(['grassland', 'hills', 'desert', 'rocky', 'mountains']);
    for (const [k, def] of Object.entries(RESOURCES)) {
      assert(def.yield > 0, `${k} has no yield`);
      for (const id of Object.keys(def.blocks)) assert(BlockRegistry.has(id), `${k} yields unknown block "${id}"`);
      for (const b of def.biomes) assert(validBiomes.has(b), `${k} lists unknown biome "${b}"`);
    }
  });

  await test('mining a deposit pays out materials and blocks', async () => {
    const physics = new PhysicsWorld();
    const game = fakeGame(physics);
    game.materials = {};
    game.inventory = new Inventory({}, false);
    game.addMaterial = (type, n) => { game.materials[type] = (game.materials[type] || 0) + n; };
    const terrain = new Terrain(game, { seed: 7, size: 300, cells: 64 }).build();
    game.arena = terrain;
    const res = new ResourceSystem(game);
    res.populate(terrain, 10);
    assert(res.nodes.length > 0, 'no resource nodes were placed');
    const node = res.nodes[0];
    const type = node.type;
    const expectBlocks = Object.keys(RESOURCES[type].blocks);
    let guard = 0;
    while (!node.dead && guard++ < 5000) res.hit({ kind: 'resource', node }, 25, node);
    assert(node.dead, 'node never depleted');
    assert((game.materials[type] || 0) > 0, 'no material awarded');
    for (const id of expectBlocks) assert(game.inventory.count(id) > 0, `no ${id} awarded from mining`);
  });

  // =======================================================================
  group('expanded content & balance');

  await test('the starter machine ships with two light cannons', () => {
    const g = VehicleGrid.deserialize(STARTER_BLUEPRINT).grid;
    const cannons = g.list().filter((b) => b.id === 'cannon');
    eq(cannons.length, 2, 'starter should mount exactly two cannons');
    eq(g.validate().ok, true, 'starter blueprint must be valid');
  });

  await test('all new block types are registered with valid categories', () => {
    const want = ['light_frame', 'wedge', 'wheel_light', 'wheel_giant',
      'engine_light', 'engine_v6', 'engine_turbo', 'autocannon', 'heavy_cannon',
      'scattergun', 'heavy_turret', 'buzzsaw', 'ram'];
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const id of want) {
      assert(BlockRegistry.has(id), `missing block "${id}"`);
      assert(cats.has(BlockRegistry.get(id).category), `${id} has an unknown category`);
    }
  });

  await test('cab is tougher and turrets hit softer than before', () => {
    assert(BlockRegistry.get('cab').health >= 400, 'cab HP should be raised');
    assert(BlockRegistry.get('turret').weapon.damage < 20, 'turret damage should be reduced');
    assert(BlockRegistry.get('heavy_turret').weapon.damage < BlockRegistry.get('heavy_cannon').weapon.damage,
      'heavy turret should hit softer than the heavy cannon');
  });

  await test('scattergun fires a pellet spread and heavy rounds are bigger', () => {
    assert(BlockRegistry.get('scattergun').weapon.pellets > 1, 'scattergun needs multiple pellets');
    assert((BlockRegistry.get('heavy_cannon').weapon.projScale || 1) > 1, 'heavy cannon round should scale up');
  });

  await test('ram carries melee stats and melee tools auto-orient to a face', () => {
    const ram = BlockRegistry.get('ram');
    assert(ram.melee && ram.melee.bonus > 1, 'ram needs a melee bonus');
    for (const id of ['drill', 'buzzsaw']) {
      const d = BlockRegistry.get(id);
      assert(d.autoOrient && d.mountFace, `${id} should auto-orient to the clicked face`);
    }
    assert(BlockRegistry.get('buzzsaw').tool.spinAxis === 'x', 'buzzsaw blade should spin about X (forward-facing)');
  });

  await test('turret range gating uses each weapon\'s range', () => {
    // range values are finite and modest so turrets cannot snipe across the map
    for (const id of ['turret', 'heavy_turret']) {
      const r = BlockRegistry.get(id).weapon.range;
      assert(r > 0 && r <= 110, `${id} range should be limited (got ${r})`);
    }
  });

  await test('a wedge builds a convex collider and rests on the ground', async () => {
    const physics = new PhysicsWorld();
    const world = physics.world;
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(40, 2, 40).setTranslation(0, -2, 0).setCollisionGroups(GROUPS.ground), ground);
    const game = fakeGame(physics);
    const grid = gridWith([['cab', [0, 0, 0]], ['wedge', [0, 0, 1]], ['wedge', [1, 0, 0]]]);
    const v = new Vehicle(game, { grid, position: [0, 3, 0], isPlayer: true, detail: 0 });
    game.scene.add(v.root);
    v.build();
    physics.onPreStep((dt) => v.fixedUpdate(dt));
    physics.onPostStep(() => v.postStep());
    for (let i = 0; i < 200; i++) physics.update(FIXED_DT);
    const y = v.mainAssembly.body.translation().y;
    assert(Number.isFinite(y) && y > 0 && y < 3, `wedge machine did not settle sanely (y=${y})`);
    assert(v.mainAssembly.colliders.length >= 3, 'wedge machine should have a collider per block');
  });

  await test('an external model override replaces the procedural model', () => {
    const marker = new THREE.Group();
    marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial()));
    BlockRegistry.setModelOverride('structural', marker);
    const m = BlockRegistry.createModel('structural', 1);
    assert(m !== marker, 'should return a CLONE, not the template');
    assert(m.children.length > 0, 'override clone should carry the template contents');
    BlockRegistry.setModelOverride('structural', null);   // restore
    assert(!BlockRegistry.overrides.has('structural'), 'override should clear');
  });

  return summary();
}
