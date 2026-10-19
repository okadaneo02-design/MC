import * as THREE from 'three';
import {
  buildStructural, buildArmor, buildArmorPlate, buildCab, buildEngine, buildWheel,
  buildCannon, buildTurret, buildDrill, PAL,
  buildLightFrame, buildHeavyBlock, buildWedge, WEDGE_VERTS,
  buildEngineLight, buildEngineV8, buildEngineTurbo,
  buildRacingWheel, buildMonsterWheel,
  buildAutocannon, buildHeavyCannon, buildScattergun, buildHeavyTurret, buildWallTurret,
  buildBuzzsaw, buildGrinder, buildRam,
  buildGyroscope, buildFrontalWheel, buildTread,
  buildBattery, buildSolar, buildRepair, buildShield,
  buildSpikeball, buildHammer, buildThruster,
} from '../models/ProceduralModels.js';

// Gyro-family factory (control category) — same model, different strength/mass.
function gyroVariant(id, name, strength, mass, swatch, tint) {
  return {
    id, name, category: 'control',
    desc: `A stabilizer that keeps the hull upright and damps spin (strength ${strength}). Stack for stronger self-righting.`,
    size: [1, 1, 1], mass, health: 150 + mass, armor: 2, behavior: 'gyro', gyro: { strength }, protrudes: true,
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch, model: (d) => buildGyroscope(d, tint),
  };
}
// Shared factory for contact-melee tools (behavior 'drill'): mounts on any face,
// spins/pounds its `drill.moving` head, damages whatever it touches while powered.
function meleeTool(id, name, desc, mass, health, tool, swatch, model) {
  return {
    id, name, category: 'weapons', desc,
    size: [1, 1, 1], mass, health, armor: 3, behavior: 'drill',
    autoOrient: true, mountFace: [0, -1, 0],
    config: { key: 'toolToggle', hold: true },
    tool, attachFaces: [3],
    collider: { type: 'cuboid', half: [0.44, 0.5, 0.44] },
    swatch, model,
  };
}
import { FACES } from './Orientation.js';
import { hasModel, createAssetModel } from '../models/ModelLoader.js';

/** One grid cell = one metre. */
export const CELL = 1.0;

export const CATEGORIES = [
  { id: 'structure', label: 'Structure' },
  { id: 'mobility', label: 'Mobility' },
  { id: 'power', label: 'Power' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'control', label: 'Control' },
];

const ALL_FACES = FACES.map((_, i) => i);

/**
 * A block definition is pure data plus a model factory. Nothing here touches
 * physics or rendering state, which is what makes the logic unit-testable.
 */
const DEFS = [
  {
    id: 'structural',
    name: 'Structural Block',
    category: 'structure',
    desc: 'The frame everything else bolts onto. Cheap, light, connects on all six faces.',
    size: [1, 1, 1],
    mass: 42,
    health: 120,
    armor: 2,
    behavior: 'structural',
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#49535e',
    model: (d) => buildStructural(d, PAL.steel),
  },
  {
    id: 'armor',
    name: 'Armor Block',
    category: 'structure',
    desc: 'Heavy chamfered plating cube. Soaks damage and flattens incoming hits, but it is dead weight.',
    size: [1, 1, 1],
    mass: 115,
    health: 340,
    armor: 11,
    behavior: 'structural',
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#3b4149',
    model: (d) => buildArmor(d),
  },
  {
    id: 'armor_plate',
    name: 'Armor Plate',
    category: 'structure',
    desc: 'Thin sloped plating that lies FLAT against the face you click. Cheap directional protection, barely any weight.',
    size: [1, 1, 1],
    mass: 46,
    health: 200,
    armor: 9,
    behavior: 'structural',
    autoOrient: true,
    mountFace: [0, -1, 0],      // the face that beds against the block beneath it
    attachFaces: [3],           // index into FACES -> [0,-1,0]
    // Collider is a thin slab hugging the mount face, matching the mesh.
    collider: { type: 'cuboid', half: [0.47, 0.09, 0.47], offset: [0, -0.40, 0] },
    swatch: '#434d57',
    model: (d) => buildArmorPlate(d),
  },
  {
    id: 'light_frame',
    name: 'Light Frame',
    category: 'structure',
    desc: 'An open welded truss. Barely any weight, so your machine turns and climbs quicker — but it is fragile.',
    size: [1, 1, 1],
    mass: 20,
    health: 70,
    armor: 1,
    behavior: 'structural',
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#8c98a4',
    model: (d) => buildLightFrame(d),
  },
  {
    id: 'wedge',
    name: 'Wedge',
    category: 'structure',
    desc: 'A sloped half-block. Deflects hits and shapes sleek hulls; the collider is an exact wedge, low at the front.',
    size: [1, 1, 1],
    mass: 38,
    health: 130,
    armor: 4,
    behavior: 'structural',
    attachFaces: ALL_FACES,
    collider: { type: 'convex', points: WEDGE_VERTS },
    swatch: '#49535e',
    model: (d) => buildWedge(d),
  },
  {
    id: 'cab',
    name: 'Controller Cab',
    category: 'control',
    desc: 'The brain. Exactly one per vehicle. Destroy it and the machine goes dark — but its parts survive.',
    size: [1, 1, 1],
    mass: 180,
    health: 450,
    armor: 6,
    behavior: 'cab',
    unique: true,
    forward: [0, 0, 1],
    protrudes: true,                 // windshield/hood/lightbar sit slightly proud of the cell
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#2f7fd0',
    model: (d) => buildCab(d, PAL.accent),
  },
  {
    id: 'gyroscope',
    name: 'Gyroscope',
    category: 'control',
    desc: 'A spinning stabilizer that keeps your machine upright, damps rolls and self-rights it after a flip. Stack more for stronger correction. Vital for tall or top-heavy builds.',
    size: [1, 1, 1],
    mass: 95,
    health: 170,
    armor: 2,
    behavior: 'gyro',
    gyro: { strength: 1.0 },
    protrudes: true,
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#39c2ff',
    model: (d) => buildGyroscope(d, 0x39c2ff),   // blue = weakest / default
  },
  gyroVariant('gyro_small', 'Compact Gyro', 0.5, 50, '#5fd07a', 0x5fd07a),   // green
  gyroVariant('gyro_large', 'Heavy Gyro', 2.4, 180, '#ff5a4a', 0xff5a4a),    // red
  gyroVariant('gyro_array', 'Gyro Array', 4.0, 300, '#b060ff', 0xb060ff),    // purple
  {
    id: 'engine',
    name: 'Combustion Engine',
    category: 'power',
    desc: 'Supplies drive force to every powered wheel. More engines, more shove — and more mass.',
    size: [1, 1, 1],
    mass: 160,
    health: 200,
    armor: 2,
    behavior: 'engine',
    protrudes: true,          // a big block — the model overhangs its cell
    engine: { power: 13000, topSpeed: 24 },   // newtons of total drive budget, m/s
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 1.5] },   // hitbox runs 2 cells longer than the footprint
    swatch: '#7a4a2c',
    model: (d) => buildEngine(d),
  },
  {
    id: 'wheel',
    name: 'Road Wheel',
    category: 'mobility',
    desc: 'Sprung, driven and steerable. Mounts on its hub face; the axle lines up automatically.',
    size: [1, 1, 1],
    mass: 58,
    health: 140,
    armor: 1,
    behavior: 'wheel',
    autoOrient: true,
    mountFace: [-1, 0, 0],      // local face that bolts to the hull
    attachFaces: [1],           // index into FACES -> [-1,0,0]
    // Wheels contribute mass but never collide: the raycast suspension owns ground contact.
    collider: { type: 'cuboid', half: [0.16, 0.42, 0.42], noCollide: true },
    wheel: {
      radius: 0.45, width: 0.32,
      restDrop: 0.5, suspensionTravel: 0.32,
      stiffness: 66000, damping: 4400,
      gripLateral: 1.45, gripLongitudinal: 1.35,
      steerAngle: 0.56, maxBrake: 7200,
    },
    swatch: '#1b1d21',
    model: (d) => buildWheel(d, 0.45, 0.32),
  },
  {
    id: 'wheel_balloon', name: 'Balloon Tyre', category: 'mobility',
    desc: 'A fat, soft off-road tyre. Huge grip and float over rough ground, but heavy and slow.',
    size: [1, 1, 1], mass: 90, health: 180, armor: 2, behavior: 'wheel', protrudes: true,
    autoOrient: true, mountFace: [-1, 0, 0], attachFaces: [1],
    collider: { type: 'cuboid', half: [0.2, 0.5, 0.5], noCollide: true },
    wheel: {
      radius: 0.5, width: 0.44, restDrop: 0.58, suspensionTravel: 0.42,
      stiffness: 60000, damping: 4200, gripLateral: 1.6, gripLongitudinal: 1.5, steerAngle: 0.5, maxBrake: 9000,
    },
    swatch: '#17191d', model: (d) => buildWheel(d, 0.5, 0.44),
  },
  {
    id: 'wheel_heavy',
    name: 'Heavy Wheel',
    category: 'mobility',
    desc: 'Wide off-road tyre. More grip and durability, slower to spin up, and it steers lazily.',
    size: [1, 1, 1],
    mass: 92,
    health: 230,
    armor: 3,
    behavior: 'wheel',
    autoOrient: true,
    mountFace: [-1, 0, 0],
    attachFaces: [1],
    collider: { type: 'cuboid', half: [0.22, 0.48, 0.48], noCollide: true },
    wheel: {
      radius: 0.52, width: 0.44,
      restDrop: 0.48, suspensionTravel: 0.38,
      stiffness: 88000, damping: 5800,
      gripLateral: 1.7, gripLongitudinal: 1.6,
      steerAngle: 0.40, maxBrake: 9600,
    },
    swatch: '#2a2d33',
    model: (d) => buildWheel(d, 0.52, 0.44),
  },
  {
    id: 'wheel_light',
    name: 'Racing Wheel',
    category: 'mobility',
    desc: 'A small slick tyre. Spins up fast and steers sharply for nimble buggies — low grip and durability, though.',
    size: [1, 1, 1],
    mass: 32,
    health: 85,
    armor: 0,
    behavior: 'wheel',
    autoOrient: true,
    mountFace: [-1, 0, 0],
    attachFaces: [1],
    collider: { type: 'cuboid', half: [0.13, 0.36, 0.36], noCollide: true },
    wheel: {
      radius: 0.38, width: 0.26,
      restDrop: 0.36, suspensionTravel: 0.30,
      stiffness: 52000, damping: 3400,
      gripLateral: 1.3, gripLongitudinal: 1.5,
      steerAngle: 0.68, maxBrake: 6000,
    },
    swatch: '#15161a',
    model: (d) => buildRacingWheel(d),
  },
  {
    id: 'wheel_giant',
    name: 'Monster Wheel',
    category: 'mobility',
    desc: 'A huge off-road tyre that crawls over rocks and boulders. Massive grip and toughness; very heavy and slow to turn.',
    size: [1, 1, 1],
    mass: 155,
    health: 380,
    armor: 4,
    behavior: 'wheel',
    autoOrient: true,
    mountFace: [-1, 0, 0],
    attachFaces: [1],
    collider: { type: 'cuboid', half: [0.28, 0.6, 0.6], noCollide: true },
    wheel: {
      radius: 0.66, width: 0.56,
      restDrop: 0.58, suspensionTravel: 0.50,
      stiffness: 112000, damping: 7400,
      gripLateral: 1.9, gripLongitudinal: 1.85,
      steerAngle: 0.32, maxBrake: 13000,
    },
    swatch: '#242830',
    model: (d) => buildMonsterWheel(d),
  },
  {
    id: 'wheel_front',
    name: 'Frontal Wheel',
    category: 'mobility',
    desc: 'A road wheel that bolts onto a FRONT or back face instead of the side — perfect for a centred tricycle wheel. Still steers and drives.',
    size: [1, 1, 1],
    mass: 58,
    health: 140,
    armor: 1,
    behavior: 'wheel',
    autoOrient: true,
    mountFace: [0, 0, -1],          // beds against the block behind it
    attachFaces: [5],               // FACES index of [0,0,-1]
    collider: { type: 'cuboid', half: [0.42, 0.42, 0.16], noCollide: true },
    wheel: {
      radius: 0.45, width: 0.32,
      restDrop: 0.5, suspensionTravel: 0.32,
      stiffness: 66000, damping: 4400,
      gripLateral: 1.45, gripLongitudinal: 1.35,
      steerAngle: 0.6, maxBrake: 7200,
    },
    swatch: '#1b1d21',
    model: (d) => buildFrontalWheel(d, 0.45, 0.32),
  },
  {
    id: 'tread',
    name: 'Tank Tread',
    category: 'mobility',
    desc: 'A 4-cell driven track — ends rounded, (=====) belt between. Enormous grip, climbs slopes, shrugs off damage. Heavy and slow to turn.',
    size: [1, 1, 4],                       // four cells long
    mass: 360,
    health: 900,
    armor: 5,
    behavior: 'wheel',
    autoOrient: true,
    mountFace: [-1, 0, 0],
    attachFaces: [1],
    collider: { type: 'cuboid', half: [0.22, 0.42, 2.0], noCollide: true },
    wheel: {
      radius: 0.42, width: 0.42, length: 4.0, contacts: 4, tank: true,
      restDrop: 0.42, suspensionTravel: 0.34,
      stiffness: 150000, damping: 9000,
      gripLateral: 2.2, gripLongitudinal: 2.1,
      steerAngle: 0, maxBrake: 22000,
    },
    swatch: '#23262c',
    model: (d) => buildTread(d, 0.42, 4.0, 0.42),
  },
  // ---- engines (extra) --------------------------------------------------
  {
    id: 'engine_light',
    name: 'Light Engine',
    category: 'power',
    desc: 'A compact single-pot motor. Light and revvy — great in a small buggy, outmatched in a heavy rig.',
    size: [1, 1, 1],
    mass: 90,
    health: 120,
    armor: 1,
    behavior: 'engine',
    protrudes: true,          // intakes, blowers and turbines stick out of the cell
    engine: { power: 7000, topSpeed: 27 },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#6a7079',
    model: (d) => buildEngineLight(d),
  },
  {
    id: 'engine_turbo',
    name: 'Turbo Engine',
    category: 'power',
    desc: 'Mid-weight with a turbocharger — strong power and a high top speed. The sweet spot for fast fighters.',
    size: [1, 1, 1],
    mass: 180,
    health: 200,
    armor: 2,
    behavior: 'engine',
    protrudes: true,          // intakes, blowers and turbines stick out of the cell
    engine: { power: 16000, topSpeed: 34 },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#2f5f86',
    model: (d) => buildEngineTurbo(d),
  },

  // ---- energy / utility -------------------------------------------------
  {
    id: 'battery', name: 'Battery', category: 'power',
    desc: 'Stores energy for repair generators and shields. Charge it with solar panels.',
    size: [1, 1, 1], mass: 70, health: 150, armor: 2, behavior: 'structural',
    energy: { capacity: 400 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#3f6ea5', model: (d) => buildBattery(d),
  },
  {
    id: 'solar', name: 'Solar Panel', category: 'power',
    desc: 'Trickle-charges your batteries whenever the sun is up. Useless at night — mount a few.',
    size: [1, 1, 1], mass: 40, health: 90, armor: 1, behavior: 'structural', protrudes: true,
    energy: { solar: 26 },
    autoOrient: true, mountFace: [0, -1, 0], attachFaces: [3],
    collider: { type: 'cuboid', half: [0.47, 0.22, 0.47], offset: [0, -0.28, 0] },
    swatch: '#2f6fd0', model: (d) => buildSolar(d),
  },
  {
    id: 'repair', name: 'Repair Generator', category: 'power',
    desc: 'Spends stored energy to slowly mend your damaged blocks while you drive. Keep it fed with batteries + solar.',
    size: [1, 1, 1], mass: 120, health: 180, armor: 2, behavior: 'structural',
    repair: { hps: 24, costPerHp: 1.2 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#3f9b5a', model: (d) => buildRepair(d),
  },
  {
    id: 'shield', name: 'Shield Generator', category: 'power',
    desc: 'Projects a regenerating energy buffer that soaks incoming damage before your blocks take any. Stacks.',
    size: [1, 1, 1], mass: 130, health: 190, armor: 2, behavior: 'structural', protrudes: true,
    shield: { capacity: 220, regen: 14 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#39c2ff', model: (d) => buildShield(d),
  },
  {
    id: 'thruster',
    name: 'Thruster',
    category: 'power',
    desc: 'A rocket booster. Points its nozzle backward and FIRES on Nitro (Shift) for a burst of speed — no thruster, no nitro. Rotate it to aim the shove.',
    size: [1, 1, 1], mass: 70, health: 120, armor: 2, behavior: 'thruster',
    forward: [0, 0, 1], protrudes: true,
    thruster: { force: 52000 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.4, 0.4, 0.5] },
    swatch: '#6b7580', model: (d) => buildThruster(d),
  },

  // ---- weapons ----------------------------------------------------------
  {
    id: 'cannon',
    name: 'Light Cannon',
    category: 'weapons',
    desc: 'Fixed forward-firing cannon. Aim it by pointing the whole machine. Hold Fire to shoot.',
    size: [1, 1, 1],
    mass: 95,
    health: 130,
    armor: 3,
    behavior: 'weapon',
    forward: [0, 0, 1],
    muzzle: [0, 0, 0.55],
    weapon: { damage: 34, fireRate: 2.6, speed: 85, range: 90, spread: 0.012, projMass: 2, ball: true, projScale: 1.5 },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.4, 0.4, 0.5] },
    swatch: '#55606b',
    model: (d) => buildCannon(d),
  },
  {
    id: 'turret',
    name: 'Turret',
    category: 'weapons',
    desc: 'Rotating turret that aims on its own — at the cursor for you, at you for the enemy. Fires automatically in range.',
    size: [1, 1, 1],
    mass: 140,
    health: 220,
    armor: 5,
    behavior: 'turret',
    muzzle: [0, 0.16, 0.55],       // in head-local space
    turret: { yawRate: 2.4, pitchRate: 1.6, maxPitch: 0.5, minPitch: -0.22 },
    weapon: { damage: 16, fireRate: 3.0, speed: 95, range: 80, spread: 0.022, projMass: 1.4 },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.46, 0.46, 0.46] },
    swatch: '#6c7884',
    model: (d) => buildTurret(d),
  },
  {
    id: 'autocannon',
    name: 'Autocannon',
    category: 'weapons',
    desc: 'Twin rapid-fire barrels. Low damage per round but a withering stream of them. Hold Fire.',
    size: [1, 1, 1],
    mass: 115,
    health: 140,
    armor: 3,
    behavior: 'weapon',
    forward: [0, 0, 1],
    muzzle: [0, 0.04, 0.6],
    weapon: { damage: 11, fireRate: 9, speed: 125, range: 85, spread: 0.028, projMass: 0.6 },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.38, 0.38, 0.5] },
    swatch: '#5a646f',
    model: (d) => buildAutocannon(d),
  },
  {
    id: 'heavy_cannon',
    name: 'Heavy Cannon',
    category: 'weapons',
    desc: 'One enormous barrel that lobs a slow, heavy shell. Punishing damage and a long reload. Point the hull and fire.',
    size: [1, 1, 1],
    mass: 210,
    health: 230,
    armor: 5,
    behavior: 'weapon',
    forward: [0, 0, 1],
    muzzle: [0, 0.02, 0.78],
    weapon: { damage: 110, fireRate: 0.8, speed: 72, range: 120, spread: 0.005, projMass: 6, projScale: 2.6, ball: true },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.42, 0.42, 0.52] },
    swatch: '#4a535d',
    model: (d) => buildHeavyCannon(d),
  },
  {
    id: 'scattergun',
    name: 'Scattergun',
    category: 'weapons',
    desc: 'A cluster of stub barrels that spit a wide pellet spread. Devastating up close, useless at range.',
    size: [1, 1, 1],
    mass: 125,
    health: 150,
    armor: 3,
    behavior: 'weapon',
    forward: [0, 0, 1],
    muzzle: [0, 0.02, 0.5],
    weapon: { damage: 9, pellets: 7, fireRate: 1.3, speed: 68, range: 42, spread: 0.09, projMass: 0.4 },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.36, 0.36, 0.42] },
    swatch: '#556069',
    model: (d) => buildScattergun(d),
  },
  {
    id: 'heavy_turret',
    name: 'Heavy Turret',
    category: 'weapons',
    desc: 'A big armoured turret with twin barrels. Tracks on its own and hits hard. Lots of health, lots of mass.',
    size: [1, 1, 1],
    mass: 250,
    health: 360,
    armor: 7,
    behavior: 'turret',
    muzzle: [0.16, 0.18, 0.6],
    turret: { yawRate: 1.8, pitchRate: 1.3, maxPitch: 0.5, minPitch: -0.2 },
    weapon: { damage: 34, fireRate: 1.9, speed: 100, range: 100, spread: 0.011, projMass: 3, projScale: 1.8 },
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#5f6b77',
    model: (d) => buildHeavyTurret(d),
  },
  {
    id: 'buzzsaw',
    name: 'Buzzsaw',
    category: 'weapons',
    desc: 'A spinning toothed blade — a melee like the drill. Mount it forward and hold its key to shred enemy blocks on contact.',
    size: [1, 1, 1],
    mass: 120,
    health: 190,
    armor: 3,
    behavior: 'drill',
    autoOrient: true,
    mountFace: [0, -1, 0],         // place it on any face; the blade faces outward
    config: { key: 'toolToggle', hold: true },
    tool: { dps: 150, reach: 0.9, spin: 30, spinAxis: 'x', resourceFactor: 0.3 },
    attachFaces: [3],
    collider: { type: 'cuboid', half: [0.2, 0.5, 0.5] },
    swatch: '#8a9098',
    model: (d) => buildBuzzsaw(d),
  },
  {
    id: 'ram',
    name: 'Ram Spike',
    category: 'weapons',
    desc: 'A passive armoured prow. No trigger — just drive it into the enemy. Deals heavy collision damage and shrugs off the hit itself.',
    size: [1, 1, 1],
    mass: 150,
    health: 320,
    armor: 8,
    behavior: 'structural',
    melee: { bonus: 3.0, selfProtect: 0.25 },
    protrudes: true,               // spikes stick out the front on purpose
    forward: [0, 0, 1],
    attachFaces: ALL_FACES,
    collider: { type: 'cuboid', half: [0.46, 0.4, 0.5] },
    swatch: '#6b6f74',
    model: (d) => buildRam(d),
  },
  meleeTool('spikeball', 'Spiked Flail',
    'A spinning spiked ball. Hold its key and sweep it through enemy blocks — fast, vicious, short reach.',
    135, 200, { dps: 150, reach: 0.9, spin: 22, resourceFactor: 0.5 }, '#5a5e63', (d) => buildSpikeball(d)),
  meleeTool('hammer', 'Pneumatic Hammer',
    'A heavy mallet that pounds whatever it touches. Big slow hits that crumple armour.',
    170, 260, { dps: 200, reach: 0.95, spin: 9, resourceFactor: 0.8 }, '#49535e', (d) => buildHammer(d)),
  // ---- mining drills (in Weapons; they auto-orient and cut on contact) ----
  {
    id: 'drill',
    name: 'Mining Drill',
    category: 'weapons',
    desc: 'A spinning bit that chews through rock, resource deposits and enemy blocks it actually touches. Takes no collision damage.',
    size: [1, 1, 1],
    mass: 110,
    health: 200,
    armor: 3,
    behavior: 'drill',
    autoOrient: true,
    mountFace: [0, -1, 0],         // adapts to the face you click; the bit points outward
    config: { key: 'toolToggle', hold: true },
    tool: { dps: 85, reach: 0.65, spin: 18 },
    attachFaces: [3],              // mounts via its base
    collider: { type: 'cuboid', half: [0.42, 0.5, 0.42] },
    swatch: '#8a5a2c',
    model: (d) => buildDrill(d),
  },

  // ===== extra content blocks (reuse existing models with new stats) =====
  // -- weapons --
  {
    id: 'minigun', name: 'Minigun', category: 'weapons',
    desc: 'A spun-up rotary barrel that hoses a torrent of light rounds. Murderous sustained fire, little punch.',
    size: [1, 1, 1], mass: 120, health: 140, armor: 3, behavior: 'weapon', forward: [0, 0, 1],
    muzzle: [0, 0.04, 0.6],
    weapon: { damage: 6, fireRate: 16, speed: 140, range: 80, spread: 0.045, projMass: 0.4 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.38, 0.38, 0.5] },
    swatch: '#54606b', model: (d) => buildScattergun(d),
  },
  {
    id: 'flak', name: 'Flak Cannon', category: 'weapons',
    desc: 'A two-cell burst gun that lobs a cone of fragmenting shells. Shreds light machines at medium range.',
    size: [1, 1, 2], mass: 150, health: 190, armor: 3, behavior: 'weapon', forward: [0, 0, 1], protrudes: true,
    muzzle: [0, 0.02, 1.0],
    weapon: { damage: 8, pellets: 5, fireRate: 1.8, speed: 80, range: 58, spread: 0.06, projMass: 0.5 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.36, 0.36, 1.0] },
    swatch: '#5a6069', model: (d) => buildScattergun(d),
  },
  {
    id: 'turret_rail', name: 'Railgun Turret', category: 'weapons',
    desc: 'A heavy auto-tracking turret with a railgun slug. Long reach, slow cycle.',
    size: [1, 1, 1], mass: 220, health: 300, armor: 6, behavior: 'turret',
    muzzle: [0, 0.2, 0.6],
    turret: { yawRate: 1.6, pitchRate: 1.1, maxPitch: 0.4, minPitch: -0.18 },
    weapon: { damage: 70, fireRate: 1.0, speed: 190, range: 140, spread: 0.004, projMass: 4, projScale: 1.2, ball: true },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.48, 0.48, 0.48] },
    swatch: '#5a6673', model: (d) => buildHeavyTurret(d),
  },
  // -- power --
  {
    id: 'engine_v6', name: 'V6 Engine', category: 'power',
    desc: 'A big V-block with serious shove for heavy machines. Heavy and thirsty, but it moves tonnage.',
    size: [1, 1, 1], mass: 230, health: 280, armor: 3, behavior: 'engine', protrudes: true,
    engine: { power: 20000, topSpeed: 25 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#5a4126', model: (d) => buildEngineV8(d),
  },
  {
    id: 'reactor', name: 'Fusion Reactor', category: 'power',
    desc: 'A heavy power cell with huge storage for big shield + repair builds. Worth the weight.',
    size: [1, 1, 1], mass: 150, health: 220, armor: 3, behavior: 'structural',
    energy: { capacity: 1000 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#3f8aa5', model: (d) => buildBattery(d),
  },
  {
    id: 'solar_array', name: 'Solar Array', category: 'power',
    desc: 'A big tilted panel bank that charges far faster than a single cell in daylight.',
    size: [1, 1, 1], mass: 60, health: 110, armor: 1, behavior: 'structural', protrudes: true,
    energy: { solar: 55 },
    autoOrient: true, mountFace: [0, -1, 0], attachFaces: [3],
    collider: { type: 'cuboid', half: [0.47, 0.22, 0.47], offset: [0, -0.28, 0] },
    swatch: '#2f7fd0', model: (d) => buildSolar(d),
  },
  // -- structure --
  {
    id: 'bulkhead', name: 'Bulkhead', category: 'structure',
    desc: 'The toughest plating in the shop. Enormous HP for a frontline nose or crumple zone.',
    size: [1, 1, 1], mass: 200, health: 520, armor: 7, behavior: 'structural',
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#5c646e', model: (d) => buildHeavyBlock(d),
  },
  {
    id: 'beam', name: 'Steel Beam (1)', category: 'structure',
    desc: 'A single-cell steel strut for cheap reach and scaffolding.',
    size: [1, 1, 1], mass: 24, health: 90, armor: 2, behavior: 'structural',
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#808990', model: (d) => buildLightFrame(d),
  },
  {
    id: 'beam_2', name: 'Steel Beam (2)', category: 'structure',
    desc: 'A two-cell steel beam — span gaps and brace a chassis in one piece.',
    size: [1, 1, 2], mass: 46, health: 170, armor: 2, behavior: 'structural',
    autoOrient: true, mountFace: [0, 0, -1],   // near end bonds to the clicked face; beam extends outward
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 1.0] },
    swatch: '#808990', model: (d) => buildLightFrame(d),
  },
  {
    id: 'beam_3', name: 'Steel Beam (3)', category: 'structure',
    desc: 'A three-cell steel beam for long reach — booms, spars and bridges.',
    size: [1, 1, 3], mass: 68, health: 250, armor: 2, behavior: 'structural',
    autoOrient: true, mountFace: [0, 0, -1],   // near end bonds to the clicked face; beam extends outward
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 1.5] },
    swatch: '#808990', model: (d) => buildLightFrame(d),
  },

  // ===== combat-tech blocks (Living World update) =====
  {
    id: 'ricochet_armor', name: 'Ricochet Armor', category: 'structure',
    desc: 'Angled plating that deflects glancing shots instead of taking the hit. Point the slope at the enemy.',
    size: [1, 1, 1], mass: 120, health: 260, armor: 6, behavior: 'structural',
    ricochet: { chance: 0.7 },
    autoOrient: true, mountFace: [0, -1, 0], attachFaces: [3],
    collider: { type: 'convex', points: WEDGE_VERTS },
    swatch: '#8a9098', model: (d) => buildWedge(d),
  },
  {
    id: 'reactive_armor', name: 'Reactive Armor', category: 'structure',
    desc: 'Explosive-reactive plating. Each heavy hit blows a charge to soak most of the damage — a few charges, then it is spent.',
    size: [1, 1, 1], mass: 150, health: 220, armor: 4, behavior: 'structural',
    reactive: { charges: 4, absorb: 0.7 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
    swatch: '#9a5a4a', model: (d) => buildArmor(d),
  },
  {
    id: 'emp_cannon', name: 'EMP Cannon', category: 'weapons',
    desc: 'Fires an electromagnetic bolt that shorts out an enemy’s engines, weapons and shields for a few seconds. Low direct damage.',
    size: [1, 1, 1], mass: 140, health: 160, armor: 3, behavior: 'weapon', forward: [0, 0, 1],
    muzzle: [0, 0.04, 0.6],
    weapon: { damage: 4, fireRate: 0.9, speed: 110, range: 95, spread: 0.01, projMass: 1, emp: 3.5, hex: 0x5fd0ff },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.4, 0.4, 0.5] },
    swatch: '#3f7fa5', model: (d) => buildAutocannon(d),
  },
  {
    id: 'energy_leech', name: 'Energy Leech', category: 'weapons',
    desc: 'Fires a siphon bolt that drains an enemy’s stored energy into your own batteries — starves their shields and powered weapons.',
    size: [1, 1, 1], mass: 130, health: 150, armor: 3, behavior: 'weapon', forward: [0, 0, 1],
    muzzle: [0, 0.04, 0.6],
    weapon: { damage: 5, fireRate: 1.5, speed: 120, range: 85, spread: 0.01, projMass: 0.8, leech: 60, hex: 0xb060ff },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.4, 0.4, 0.5] },
    swatch: '#7a4fb0', model: (d) => buildAutocannon(d),
  },
  {
    id: 'laser_cutter', name: 'Laser Cutter', category: 'weapons',
    desc: 'A short-range continuous beam that melts through blocks and rock. Devastating up close; overheats if you hold it.',
    size: [1, 1, 1], mass: 120, health: 150, armor: 3, behavior: 'laser', forward: [0, 0, 1],
    muzzle: [0, 0.02, 0.5],
    laser: { dps: 160, range: 22, hex: 0xff3a5a },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.38, 0.38, 0.42] },
    swatch: '#a33348', model: (d) => buildHeavyCannon(d),
  },
  {
    id: 'smoke_launcher', name: 'Smoke Launcher', category: 'weapons',
    desc: 'Pops a thick smoke cloud that blinds enemy targeting. Great for breaking contact and escaping a losing fight.',
    size: [1, 1, 1], mass: 70, health: 120, armor: 2, behavior: 'smoke', forward: [0, 0, 1],
    muzzle: [0, 0.3, 0.3],
    smoke: { radius: 14, duration: 7, cooldown: 6 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.4, 0.4, 0.4] },
    swatch: '#6b7278', model: (d) => buildScattergun(d),
  },
  {
    id: 'barricade_dispenser', name: 'Barricade Dispenser', category: 'weapons',
    desc: 'Drops a solid barricade behind you — block routes, make cover, or slow a pursuer. Hold Fire to deploy; they are limited and temporary.',
    size: [1, 1, 1], mass: 90, health: 150, armor: 3, behavior: 'barricade',
    barricade: { cooldown: 2.5 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.45, 0.45, 0.45] },
    swatch: '#c2a23a', model: (d) => buildBattery(d),
  },
  {
    id: 'decoy_launcher', name: 'Decoy Launcher', category: 'weapons',
    desc: 'Deploys a weaponless decoy drone that roars off and soaks enemy fire while you reposition. Hold Fire to launch.',
    size: [1, 1, 1], mass: 85, health: 130, armor: 2, behavior: 'decoy',
    decoy: { cooldown: 9 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.42, 0.42, 0.42] },
    swatch: '#37c6d8', model: (d) => buildScattergun(d),
  },
  {
    id: 'mine_layer', name: 'Mine Layer', category: 'weapons',
    desc: 'Drops a proximity mine behind you that detonates when an enemy machine rolls over it. Great for ambushes and shaking pursuers.',
    size: [1, 1, 1], mass: 85, health: 120, armor: 2, behavior: 'mine',
    mine: { cooldown: 2.0 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.42, 0.42, 0.42] },
    swatch: '#c24a3a', model: (d) => buildBattery(d),
  },
  {
    id: 'bridge_dispenser', name: 'Bridge Dispenser', category: 'weapons',
    desc: 'Lays a flat, drivable bridge plank ahead of you to span gaps, trenches and broken roads. Hold Fire to deploy.',
    size: [1, 1, 1], mass: 110, health: 170, armor: 3, behavior: 'bridge',
    bridge: { cooldown: 2.0 },
    attachFaces: ALL_FACES, collider: { type: 'cuboid', half: [0.45, 0.45, 0.45] },
    swatch: '#8b949c', model: (d) => buildBattery(d),
  },
];

class Registry {
  constructor() {
    this.defs = new Map();
    this._geomCache = new Map();   // `${id}:${detail}` -> THREE.Group template
    this.overrides = new Map();    // id -> external template Object3D (e.g. a Tripo/GLB)
    for (const d of DEFS) this.register(d);
  }

  /**
   * Supply an external model (a normalised Object3D template) to replace a
   * block's procedural model. Dropping assets/models/blocks/<id>.glb and loading
   * it here is all it takes; createModel() then clones this instead.
   * Name a child "moving" (and "head" for turrets) to keep powered parts animating.
   */
  setModelOverride(id, template) {
    if (!template) { this.overrides.delete(id); return; }
    // Normalise the expected animated-part names so the existing systems drive it.
    const def = this.get(id);
    const moving = template.getObjectByName?.('moving');
    if (moving) {
      if (def?.behavior === 'joint') moving.name = `${def.joint.type}.moving`;
      else if (def?.behavior === 'drill') moving.name = 'drill.moving';
    }
    const head = template.getObjectByName?.('head');
    if (head && def?.behavior === 'turret') head.name = 'turret.head';
    this.overrides.set(id, template);
  }

  register(def) {
    if (this.defs.has(def.id)) throw new Error(`[BlockRegistry] duplicate block id "${def.id}"`);
    const full = {
      size: [1, 1, 1], mass: 50, health: 100, armor: 0,
      attachFaces: ALL_FACES, behavior: 'structural',
      collider: { type: 'cuboid', half: [0.5, 0.5, 0.5] },
      ...def,
    };
    this.defs.set(full.id, full);
    return full;
  }

  get(id) {
    const d = this.defs.get(id);
    if (!d) {
      console.error(`[BlockRegistry] missing block definition "${id}"`);
      return null;
    }
    return d;
  }

  has(id) { return this.defs.has(id); }
  all() { return [...this.defs.values()]; }
  byCategory(cat) { return this.all().filter((d) => d.category === cat); }

  /**
   * Returns a fresh THREE.Object3D for a block, cloned from a cached template so
   * geometry and materials are shared across every instance of that block type.
   */
  createModel(id, detail = 1) {
    // A loaded .glb asset wins over the procedural model.
    if (hasModel(id)) { const d0 = this.get(id); const m = createAssetModel(id, d0 && d0.size); if (m) return m; }
    const ov = this.overrides.get(id);
    if (ov) return ov.clone(true);
    const key = `${id}:${detail}`;
    let tpl = this._geomCache.get(key);
    if (!tpl) {
      const def = this.get(id);
      if (!def) return new THREE.Group();
      tpl = def.model(detail);
      this._geomCache.set(key, tpl);
    }
    return tpl.clone(true);
  }

  /** Drop cached templates (used when the quality setting changes). */
  clearModelCache() {
    for (const tpl of this._geomCache.values()) {
      tpl.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
    this._geomCache.clear();
  }

  /** Total cells a block occupies (multi-cell blocks reserved for later milestones). */
  cellCount(id) {
    const d = this.get(id);
    return d ? d.size[0] * d.size[1] * d.size[2] : 1;
  }
}

export const BlockRegistry = new Registry();
export default BlockRegistry;
