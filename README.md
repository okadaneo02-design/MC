# MACHINECRAFT

A 3D modular vehicle construction, combat, salvage and exploration sandbox, running
entirely in the browser. Three.js for rendering, Rapier 3D for physics, and every
single model generated procedurally at runtime — there are no external art assets.

**Current state: Milestone 1 complete and verified.**

---

## Running it

This machine has no Node.js, so the game is written as plain ES modules with an
import map and needs nothing more than a static file server. Ruby ships with macOS:

```bash
ruby /Users/h/Documents/machinecraft/tools/serve.rb 5173
```

Then open:

- **Game** — http://localhost:5173/
- **Test suite** — http://localhost:5173/tests.html

`three` and `@dimforge/rapier3d-compat` are pulled from a CDN by the import map, so
the first load needs an internet connection (they are cached afterwards).

If you ever install Node, `npm install && npm run dev` also works — `package.json`
and the import-map module specifiers are deliberately kept npm-compatible.

---

## Controls

### Driving
| Key | Action |
| --- | --- |
| `W` / `S` | Throttle / brake — tap `S` while stopped to reverse |
| `A` / `D` | Steer |
| `Space` | Handbrake |
| Mouse | Orbit camera (click the canvas to capture the pointer) |
| Wheel | Zoom |
| `C` | Recentre camera behind the machine |
| `R` | Right the machine if you flip it |
| `B` | Enter Build Mode |
| `Tab` | Inventory |
| `Esc` | Pause |
| `F3` / `F4` | Debug overlay / collision wireframe |

### Build Mode
| Key | Action |
| --- | --- |
| Left click | Place the selected block |
| Right click | Remove a block (refunds it to inventory) |
| `R` | Rotate 90° about the current axis |
| `Q` / `E` | Change the rotation axis (X / Y / Z) |
| `Shift` + wheel | Cycle block type (plain wheel zooms the camera) |
| `1`–`9` | Quick-select a block |
| RMB drag / MMB drag | Orbit / pan the build camera |
| `Z` / `Y` | Undo / redo |
| `M` | Toggle symmetry |
| `B` | Return to driving |

---

## What is implemented and tested

### Vehicle construction
- 1 m snapping grid with full 24-orientation block rotation.
- Placement validation: no overlaps, no floating blocks, attachment faces must
  genuinely face each other, exactly one controller cab, cab must be placed first.
- Wheels auto-align to whichever face you click; `R` rolls them about their hub.
- Symmetry mode mirrors placement *and* removal, and correctly flips the mount
  direction of auto-oriented parts like wheels.
- Undo/redo of the whole design **and** the matching inventory state.
- Removal is blocked when it would strand other blocks from the cab.
- Survival consumes/refunds inventory; Creative is unlimited.

### Physics
- Rapier 3D at a fixed 1/60 s timestep with an accumulator; rendering interpolates
  between physics states and never advances the simulation.
- Rigidly connected blocks become **one compound rigid body** — not one body per cube.
- Custom raycast suspension per wheel: spring/damper load, longitudinal drive and
  brake forces, lateral grip, and a friction circle that limits the combined force.
  Everything is applied as impulses at the contact point — nothing is teleported.
- Wheels contribute mass but carry no colliding geometry; the raycast owns ground contact.
- Steering authority and drive force both taper with speed; reverse is geared to
  roughly a third of forward top speed.

### World
- Seeded, reproducible proving ground: ground plane, perimeter walls, ramps,
  a raised platform, stair steps, crates, rock clusters and four coloured landmarks.
- Every collider is built from the same numbers as the mesh it represents — the
  ramps use a convex hull of the exact render vertices.

### Presentation
- All models procedurally generated and baked into a single merged, vertex-coloured
  geometry per block type, so an entire block is one draw call on a shared material.
- Three quality levels control model detail, shadow map size and pixel ratio.
- Procedural sky doubles as the image-based lighting environment (PMREM), so metals
  have something to reflect.
- Chase camera with orbit, zoom, speed pull-back, auto-recentre and terrain avoidance.

### UI and persistence
- Main menu, settings (quality, shadows, render distance, sensitivity, volume,
  invert-Y, full key rebinding), pause menu, inventory, blueprint library.
- HUD: cab/hull health, speed, gear, live machine stats, compass, radar.
- F3 debug overlay: fps, frame time, physics ms/step, draw calls, triangles,
  rigid bodies, colliders, joints, assemblies, position, world seed, heap.
- IndexedDB saves (world seed, position, inventory, blueprint with per-block health,
  key bindings) with schema versioning and validation that refuses corrupt records.
  Autosaves every 90 s and on unload.

---

## Test results

64 / 64 passing — run them yourself at http://localhost:5173/tests.html.

| Group | Tests | Covers |
| --- | --- | --- |
| orientation | 8 | 24-orientation table, rotation composition, mount-face mapping, mirroring |
| grid snapping & placement | 8 | snapping, overlap rejection, floating rejection, cab uniqueness, attach faces |
| structural connectivity | 4 | assembly partitioning, damage splits, orphan prediction |
| validation | 3 | cab requirement, warnings, clean starter machine |
| stats | 2 | mass summation, destroyed engines produce no power |
| inventory | 6 | consumption, refund, overdraw rejection, creative, round-trip |
| blueprint serialisation | 6 | round-trip fidelity, health, rotation, corrupt/unknown/overlapping input |
| control bindings | 3 | no duplicate driving keys, settings round-trip, defaults complete |
| save validation | 2 | well-formed accept, corrupt reject |
| procedural determinism | 4 | same seed → same stream and same arena layout |
| model generation | 3 | geometry exists, fits its cell at every detail level, is shared |
| physics integration | 10 | settling on suspension, driving, braking, **wall collision**, destroyed wheels, rebuild preserves motion, no body/collider leaks, fixed timestep, reverse gearing |
| persistence (IndexedDB) | 4 | real save/load/delete round trips for worlds and blueprints |

The physics tests are genuine simulations, not syntax checks: they build the real
machine, run hundreds of fixed steps and assert on the resulting world state.

### Manual play-testing performed
Driven in the live game (not just in tests):
- Four-wheel starter machine accelerates to ~15 m/s, steers, brakes, reverses.
- Driven at full throttle into the test wall: stopped by it, never passed through.
- Build mode: placed and removed blocks, confirmed inventory debits/credits,
  confirmed undo/redo restores both grid and inventory, confirmed a second cab is
  refused, confirmed symmetry mirrors armour and wheels onto valid cells.
- Built an 8-wheel, 15-block, 1.08 t machine in Creative and drove it — all eight
  wheels report ground contact.
- Full round trip: build → drive → save → quit to menu → Continue, restoring seed,
  position, inventory and the modified blueprint exactly.

### Measured performance
With a 15-block machine in the proving ground: **0.5–1.1 ms per physics step**,
**35 draw calls**, **19.7k triangles**, **14–20 MB JS heap**. Comfortable headroom
for an 8 GB Mac.

---

## Known limitations

- **Sustained framerate is not yet measured.** The automation browser pane throttles
  `requestAnimationFrame`, so the figures above are physics/draw-call costs rather
  than an observed FPS. Physics cost leaves roughly 15× headroom inside a 16.6 ms
  budget, but a real human play session is the only way to confirm the frame rate.
- **Audio is not implemented.** The volume slider is stored and persisted but there
  is nothing playing yet; sound is scheduled for Milestone 5.
- CDN dependency on first load (no Node on this machine, so no local `node_modules`).
- The world is a single fixed-size arena with a flat ground plane. Seeded biome
  terrain and chunk streaming are Milestone 4.
- Damage, enemies and salvage are not in this build — that is Milestone 2. Block
  health, armour values and damage-split handling in the assembly graph are already
  in place and unit-tested, so the system has somewhere to land.
- Mechanical parts (hinge, servo, piston, rotator, drill) are Milestone 3. The
  assembly graph is already plural and the joint/part-config UI shells exist, but
  no mechanical blocks are registered — deliberately, so the palette never shows a
  block that does nothing.
- Multi-cell blocks are supported by the grid logic but no block currently uses more
  than one cell.

---

## Next: Milestone 2 — damage and salvaging

1. Per-block damage from projectiles and collision impulses, scaled by impact energy
   and armour, with a minimum threshold so harmless taps do nothing.
2. A simple mounted weapon with projectiles, cooldown and range.
3. The first AI enemy archetype built from the *same* block system as the player.
4. Controller-cab destruction that disables the machine while **preserving every
   surviving block** — explicitly not deleting the wreck.
5. Damage-driven assembly splits using the existing connectivity graph, with the
   detached pieces positioned correctly at the moment of the split.
6. Salvage interaction (drive close, press `E`) with a take-selected / take-all UI
   that transfers surviving parts into the inventory without duplication or loss.

---

## Project layout

```
machinecraft/
├── index.html              game shell + import map
├── tests.html              browser test runner
├── package.json            npm-compatible manifest (unused here; no Node installed)
├── tools/serve.rb          zero-install static server
└── src/
    ├── main.js             boot, Rapier init, error reporting
    ├── core/               Game loop, PhysicsWorld, Input, CameraRig, Settings, Debug
    ├── vehicles/           BlockRegistry, VehicleGrid, Vehicle, VehiclePhysics,
    │                       VehicleBuilder, Orientation
    ├── models/             ProceduralModels — every mesh in the game
    ├── world/              Arena, Sky
    ├── systems/            Inventory, SaveSystem
    ├── ui/                 HUD, BuildMenu, MainMenu (overlays)
    └── tests/              harness + suite
```
