import { WHEEL_LEFT, WHEEL_RIGHT } from '../core/wheelOrient.js';
import { orientationMapping } from '../vehicles/Orientation.js';

// A mechanical block oriented so its base (-Y) bolts to the block BEHIND it (-Z)
// and its output (+Y) faces forward (+Z). Used for front-mounted drills/rotators.
const FACE_FWD = orientationMapping([0, -1, 0], [0, 0, -1]);

/**
 * Enemy machines are built from the EXACT same blocks as the player, so every
 * surviving part is salvageable. Each archetype has several variants; the
 * spawner picks by difficulty tier.
 *
 * Blueprint format matches VehicleGrid: { v, blocks:[{i,p,o,c?}] }.
 */

const V = 2;
const wl = WHEEL_LEFT, wr = WHEEL_RIGHT;

/** Helper: 4 wheels at the given x/z corners around y=0. */
function quadWheels(xr = 1, zf = 1, zb = -1, type = 'wheel') {
  return [
    { i: type, p: [xr, 0, zf], o: wr }, { i: type, p: [-xr, 0, zf], o: wl },
    { i: type, p: [xr, 0, zb], o: wr }, { i: type, p: [-xr, 0, zb], o: wl },
  ];
}

export const ARCHETYPES = {
  // ---- SCOUT: small, fast, weak, one cannon ----
  scout: {
    tier: 1, name: 'Scout', color: 0x3f9b5a,
    ai: { aggression: 0.8, preferredRange: 28, speed: 1.0 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'cannon', p: [0, 1, 0], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'armor_plate', p: [0, 1, 0], o: 0 },
        { i: 'cannon', p: [0, 0, 1], o: 0 },
        ...quadWheels(1, 0, -1),
        { i: 'wheel', p: [1, 0, 1], o: wr }, { i: 'wheel', p: [-1, 0, 1], o: wl },
      ] },
    ],
  },

  // ---- MINER: medium, drills, close range, valuable parts ----
  miner: {
    tier: 2, name: 'Miner', color: 0xb5703c,
    ai: { aggression: 0.95, preferredRange: 5, speed: 0.8, ram: true },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, -1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -2], o: 0 },
        { i: 'armor', p: [0, 1, -1], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 },
        { i: 'drill', p: [0, 1, 1], o: 0 },
        ...quadWheels(1, 0, -2, 'wheel_heavy'),
      ] },
    ],
  },

  // ---- BRUISER: heavy, armored, slow, strong gun ----
  bruiser: {
    tier: 3, name: 'Bruiser', color: 0xc0392b,
    ai: { aggression: 0.7, preferredRange: 18, speed: 0.6 },
    variants: [
      { v: V, blocks: [
        // 3x3 hull so every outboard wheel has a block to bolt onto
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [1, 0, 0], o: 0 }, { i: 'structural', p: [-1, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 }, { i: 'structural', p: [1, 0, 1], o: 0 }, { i: 'structural', p: [-1, 0, 1], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 }, { i: 'engine', p: [1, 0, -1], o: 0 }, { i: 'structural', p: [-1, 0, -1], o: 0 },
        // armour skin + turret
        { i: 'armor', p: [0, 1, 0], o: 0 }, { i: 'armor', p: [0, 1, 1], o: 0 }, { i: 'armor', p: [0, 1, -1], o: 0 },
        { i: 'armor_plate', p: [1, 1, 0], o: 0 }, { i: 'armor_plate', p: [-1, 1, 0], o: 0 },
        { i: 'turret', p: [0, 2, 0], o: 0 },
        // six heavy wheels down each flank
        { i: 'wheel_heavy', p: [2, 0, 1], o: wr }, { i: 'wheel_heavy', p: [-2, 0, 1], o: wl },
        { i: 'wheel_heavy', p: [2, 0, 0], o: wr }, { i: 'wheel_heavy', p: [-2, 0, 0], o: wl },
        { i: 'wheel_heavy', p: [2, 0, -1], o: wr }, { i: 'wheel_heavy', p: [-2, 0, -1], o: wl },
      ] },
    ],
  },

  // ---- ENGINEER: unusual build with a servo-mounted gun arm ----
  engineer: {
    tier: 3, name: 'Engineer', color: 0x7d5ac4,
    ai: { aggression: 0.75, preferredRange: 30, speed: 0.75 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'armor_plate', p: [0, 1, 0], o: 0 },
        { i: 'structural', p: [0, 1, 1], o: 0 },
        { i: 'turret', p: [0, 2, 1], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- RAIDER: fast scattergun buggy, gets in close ----
  raider: {
    tier: 2, name: 'Raider', color: 0xd98a2b,
    ai: { aggression: 0.95, preferredRange: 14, speed: 1.05 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'scattergun', p: [0, 1, 0], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- ARTILLERY: slow, heavily armoured, lobs heavy shells from range ----
  artillery: {
    tier: 3, name: 'Artillery', color: 0x7a6b4a,
    ai: { aggression: 0.6, preferredRange: 46, speed: 0.5 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, -1], o: 0 },
        { i: 'armor', p: [0, 1, 0], o: 0 },
        { i: 'engine', p: [0, 1, 1], o: 0 },
        { i: 'heavy_cannon', p: [0, 1, -1], o: 0 },
        ...quadWheels(1, 1, -1, 'wheel_heavy'),
      ] },
    ],
  },

  // ---- GUNNER: minigun buggy, hoses light rounds at medium range ----
  gunner: {
    tier: 2, name: 'Gunner', color: 0x8a9a3b,
    ai: { aggression: 1.0, preferredRange: 20, speed: 1.0 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'minigun', p: [0, 1, 0], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- SNIPER: railgun on a light chassis, hangs back at long range ----
  sniper: {
    tier: 3, name: 'Sniper', color: 0x556b7a,
    ai: { aggression: 0.55, preferredRange: 60, speed: 0.7 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'armor', p: [0, 1, 0], o: 0 },
        { i: 'turret_rail', p: [0, 1, 1], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- FLAK WAGON: close-range flak burst platform ----
  flakwagon: {
    tier: 2, name: 'Flak Wagon', color: 0x6b5a2b,
    ai: { aggression: 0.9, preferredRange: 24, speed: 0.85 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'flak', p: [0, 1, 0], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- SPINNER: a rotator-driven drill flail on the front ----
  spinner: {
    tier: 2, name: 'Spinner', color: 0xf0c419,
    ai: { aggression: 1.0, preferredRange: 4, speed: 0.9, ram: true },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, -1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -2], o: 0 },
        { i: 'armor', p: [0, 1, -1], o: 0 },
        // a forward-mounted drill flail on the nose
        { i: 'structural', p: [0, 0, 1], o: 0 },
        { i: 'drill', p: [0, 0, 2], o: FACE_FWD },
        ...quadWheels(1, 0, -2, 'wheel_heavy'),
      ] },
    ],
  },

  // ---- TRADER: a neutral Freewheel hauler that roams peacefully; raid it for loot ----
  trader: {
    tier: 1, name: 'Freewheel Trader', color: 0x3fa0c0, neutral: true,
    ai: { aggression: 0, preferredRange: 30, speed: 0.7 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 }, { i: 'structural', p: [0, 0, -1], o: 0 },
        { i: 'armor_plate', p: [0, 1, 0], o: 0 }, { i: 'armor_plate', p: [0, 1, -1], o: 0 },
        { i: 'battery', p: [0, 1, 1], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- ZAPPER: Volt EMP skirmisher that shuts your machine down ----
  zapper: {
    tier: 3, name: 'Zapper', color: 0x5fd0ff,
    ai: { aggression: 0.85, preferredRange: 30, speed: 1.0 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'emp_cannon', p: [0, 1, 0], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- BURNER: Marauder laser-cutter brawler that closes in ----
  burner: {
    tier: 3, name: 'Burner', color: 0xff3a5a,
    ai: { aggression: 1.0, preferredRange: 9, speed: 1.05, ram: true },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'laser_cutter', p: [0, 1, 0], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- SIPHON: Volt energy-leech raider ----
  siphon: {
    tier: 3, name: 'Siphon', color: 0xb060ff,
    ai: { aggression: 0.8, preferredRange: 26, speed: 1.0 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, 0], o: 0 },
        { i: 'engine', p: [0, 0, -1], o: 0 },
        { i: 'energy_leech', p: [0, 1, 0], o: 0 },
        ...quadWheels(1, 1, -1),
      ] },
    ],
  },

  // ---- THE CRUSHER: a gigantic modular boss — armour, twin turrets, a ram nose ----
  crusher: {
    tier: 4, name: 'The Crusher', color: 0xb02a2a, boss: true,
    ai: { aggression: 0.95, preferredRange: 14, speed: 0.55, ram: true },
    variants: [
      { v: V, blocks: [
        // base deck (y=0): 3-wide spine + front extension
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [1, 0, 0], o: 0 }, { i: 'structural', p: [-1, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 }, { i: 'structural', p: [1, 0, 1], o: 0 }, { i: 'structural', p: [-1, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, -1], o: 0 }, { i: 'structural', p: [1, 0, -1], o: 0 }, { i: 'structural', p: [-1, 0, -1], o: 0 },
        { i: 'structural', p: [0, 0, 2], o: 0 }, { i: 'structural', p: [1, 0, 2], o: 0 }, { i: 'structural', p: [-1, 0, 2], o: 0 },
        { i: 'engine', p: [0, 0, -2], o: 0 },
        // armoured superstructure (y=1)
        { i: 'armor', p: [0, 1, 0], o: 0 }, { i: 'armor', p: [0, 1, 1], o: 0 }, { i: 'armor', p: [0, 1, -1], o: 0 },
        { i: 'bulkhead', p: [1, 1, 2], o: 0 }, { i: 'bulkhead', p: [-1, 1, 2], o: 0 }, { i: 'bulkhead', p: [0, 1, 2], o: 0 },
        { i: 'reactive_armor', p: [1, 1, 0], o: 0 }, { i: 'reactive_armor', p: [-1, 1, 0], o: 0 },
        // ram nose + twin turrets
        { i: 'ram', p: [0, 0, 3], o: 0 },
        { i: 'heavy_turret', p: [0, 2, 0], o: 0 },
        { i: 'turret', p: [0, 2, 1], o: 0 },
        // six heavy wheels down each flank
        { i: 'wheel_heavy', p: [2, 0, 1], o: wr }, { i: 'wheel_heavy', p: [2, 0, 0], o: wr }, { i: 'wheel_heavy', p: [2, 0, -1], o: wr },
        { i: 'wheel_heavy', p: [-2, 0, 1], o: wl }, { i: 'wheel_heavy', p: [-2, 0, 0], o: wl }, { i: 'wheel_heavy', p: [-2, 0, -1], o: wl },
      ] },
    ],
  },

  // ---- THE THUNDERHEAD: Volt EMP fortress — same chassis, electric loadout ----
  thunderhead: {
    tier: 4, name: 'The Thunderhead', color: 0x5fd0ff, boss: true,
    ai: { aggression: 0.8, preferredRange: 28, speed: 0.6 },
    variants: [
      { v: V, blocks: [
        { i: 'cab', p: [0, 0, 0], o: 0 },
        { i: 'structural', p: [1, 0, 0], o: 0 }, { i: 'structural', p: [-1, 0, 0], o: 0 },
        { i: 'structural', p: [0, 0, 1], o: 0 }, { i: 'structural', p: [1, 0, 1], o: 0 }, { i: 'structural', p: [-1, 0, 1], o: 0 },
        { i: 'structural', p: [0, 0, -1], o: 0 }, { i: 'structural', p: [1, 0, -1], o: 0 }, { i: 'structural', p: [-1, 0, -1], o: 0 },
        { i: 'structural', p: [0, 0, 2], o: 0 }, { i: 'structural', p: [1, 0, 2], o: 0 }, { i: 'structural', p: [-1, 0, 2], o: 0 },
        { i: 'engine', p: [0, 0, -2], o: 0 },
        { i: 'armor', p: [0, 1, 0], o: 0 }, { i: 'armor', p: [0, 1, 1], o: 0 }, { i: 'armor', p: [0, 1, -1], o: 0 },
        { i: 'bulkhead', p: [1, 1, 2], o: 0 }, { i: 'bulkhead', p: [-1, 1, 2], o: 0 }, { i: 'bulkhead', p: [0, 1, 2], o: 0 },
        { i: 'reactive_armor', p: [1, 1, 0], o: 0 }, { i: 'reactive_armor', p: [-1, 1, 0], o: 0 },
        { i: 'emp_cannon', p: [0, 0, 3], o: 0 },
        { i: 'heavy_turret', p: [0, 2, 0], o: 0 },
        { i: 'emp_cannon', p: [0, 2, 1], o: 0 },
        { i: 'wheel_heavy', p: [2, 0, 1], o: wr }, { i: 'wheel_heavy', p: [2, 0, 0], o: wr }, { i: 'wheel_heavy', p: [2, 0, -1], o: wr },
        { i: 'wheel_heavy', p: [-2, 0, 1], o: wl }, { i: 'wheel_heavy', p: [-2, 0, 0], o: wl }, { i: 'wheel_heavy', p: [-2, 0, -1], o: wl },
      ] },
    ],
  },
};

export const ARCHETYPE_LIST = Object.keys(ARCHETYPES);

/** Pick an archetype id appropriate for a difficulty tier (1..3), seeded.
 *  Bosses never appear in the normal pool — they spawn through their own event. */
export function pickArchetype(rand, maxTier) {
  const pool = ARCHETYPE_LIST.filter((k) => ARCHETYPES[k].tier <= maxTier && !ARCHETYPES[k].boss);
  return pool[Math.floor(rand() * pool.length)] || 'scout';
}

/** All boss archetype ids (for dedicated boss-spawn events). */
export const BOSS_LIST = ARCHETYPE_LIST.filter((k) => ARCHETYPES[k].boss);

export function pickVariant(archetypeId, rand) {
  const a = ARCHETYPES[archetypeId];
  return a.variants[Math.floor(rand() * a.variants.length)];
}
