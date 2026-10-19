import RAPIER from '@dimforge/rapier3d-compat';

/** Collision membership bits. */
export const CG = {
  GROUND:    1 << 0,
  OBSTACLE:  1 << 1,
  VEHICLE:   1 << 2,
  WHEEL:     1 << 3,  // mass-only colliders; collide with nothing
  PROJECTILE:1 << 4,
  DEBRIS:    1 << 5,
  RESOURCE:  1 << 6,
};

/** Build a Rapier interaction-group bitfield: upper 16 = membership, lower 16 = filter. */
export const groups = (membership, filter) => ((membership << 16) | filter) >>> 0;

export const SOLID_WORLD = CG.GROUND | CG.OBSTACLE | CG.RESOURCE;

/**
 * Ray-cast interaction groups.
 *
 * A Rapier interaction only happens when BOTH sides accept each other, so a ray
 * needs a membership every solid body's filter already contains — otherwise the
 * ray silently passes through the world. Rays therefore claim full membership and
 * select what they hit purely through their filter mask.
 */
export const rayGroups = (filter) => groups(0xffff, filter);

export const GROUPS = {
  ground:     groups(CG.GROUND,   CG.VEHICLE | CG.PROJECTILE | CG.DEBRIS | CG.OBSTACLE | CG.RESOURCE),
  obstacle:   groups(CG.OBSTACLE, CG.VEHICLE | CG.PROJECTILE | CG.DEBRIS | CG.GROUND | CG.RESOURCE),
  resource:   groups(CG.RESOURCE, CG.VEHICLE | CG.PROJECTILE | CG.DEBRIS | CG.GROUND | CG.OBSTACLE),
  vehicle:    groups(CG.VEHICLE,  SOLID_WORLD | CG.VEHICLE | CG.PROJECTILE | CG.DEBRIS),
  wheel:      groups(CG.WHEEL,    0),
  projectile: groups(CG.PROJECTILE, SOLID_WORLD | CG.VEHICLE | CG.DEBRIS),
  debris:     groups(CG.DEBRIS,   SOLID_WORLD | CG.VEHICLE | CG.DEBRIS),
};

export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

/**
 * Owns the Rapier world and the fixed-timestep accumulator.
 * Rendering never advances physics directly; it asks for an interpolation alpha.
 */
export class PhysicsWorld {
  constructor({ gravity = -19.0 } = {}) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    // A couple of extra solver iterations keeps block-compound stacks from jittering.
    this.world.numSolverIterations = 6;

    this.eventQueue = new RAPIER.EventQueue(true);
    this.accumulator = 0;
    this.alpha = 0;
    this.stepCount = 0;
    this.lastStepMs = 0;

    /** colliderHandle -> arbitrary metadata object (set by whoever creates the collider) */
    this.colliderMeta = new Map();
    /** Listeners invoked once per fixed step, before world.step(). */
    this._preStep = new Set();
    /** Listeners invoked once per fixed step, after world.step(), with the event queue drained. */
    this._postStep = new Set();
    /** Contact-force listeners: fn(meta1, meta2, magnitude, event) */
    this._contactListeners = new Set();
  }

  onPreStep(fn) { this._preStep.add(fn); return () => this._preStep.delete(fn); }
  onPostStep(fn) { this._postStep.add(fn); return () => this._postStep.delete(fn); }
  onContactForce(fn) { this._contactListeners.add(fn); return () => this._contactListeners.delete(fn); }

  registerCollider(collider, meta) {
    this.colliderMeta.set(collider.handle, meta);
    return collider;
  }
  metaFor(handle) { return this.colliderMeta.get(handle); }
  unregisterCollider(collider) { this.colliderMeta.delete(collider.handle); }

  removeCollider(collider) {
    if (!collider) return;
    this.colliderMeta.delete(collider.handle);
    this.world.removeCollider(collider, true);
  }

  removeBody(body) {
    if (!body) return;
    for (let i = 0; i < body.numColliders(); i++) {
      this.colliderMeta.delete(body.collider(i).handle);
    }
    this.world.removeRigidBody(body);
  }

  /**
   * Advance by real elapsed time, running 0..N fixed steps.
   * Returns the number of steps actually taken.
   */
  update(dtSeconds) {
    this.accumulator += Math.min(dtSeconds, 0.25);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      const t0 = performance.now();
      for (const fn of this._preStep) fn(FIXED_DT);
      this.world.step(this.eventQueue);
      this._drainEvents();
      for (const fn of this._postStep) fn(FIXED_DT);
      this.lastStepMs = performance.now() - t0;
      this.accumulator -= FIXED_DT;
      this.stepCount++;
      steps++;
    }
    // If we blew the budget, drop the backlog rather than spiralling.
    if (this.accumulator >= FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.alpha = this.accumulator / FIXED_DT;
    return steps;
  }

  _drainEvents() {
    if (this._contactListeners.size === 0) return;
    this.eventQueue.drainContactForceEvents((event) => {
      const a = this.colliderMeta.get(event.collider1());
      const b = this.colliderMeta.get(event.collider2());
      if (!a && !b) return;
      const mag = event.totalForceMagnitude();
      for (const fn of this._contactListeners) fn(a, b, mag, event);
    });
  }

  /**
   * Ray cast returning {toi, point, normal, collider, meta} or null.
   * `skip` is an optional predicate (meta, collider) => true to ignore a hit.
   */
  castRay(origin, dir, maxToi, filterGroups, skip = null) {
    const ray = new RAPIER.Ray(origin, dir);
    let best = null;
    this.world.intersectionsWithRay(
      ray, maxToi, true,
      (hit) => {
        const meta = this.colliderMeta.get(hit.collider.handle);
        if (skip && skip(meta, hit.collider)) return true; // keep searching
        // Rapier renamed `toi` -> `timeOfImpact`; accept either.
        const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
        if (!best || toi < best.toi) {
          best = {
            toi,
            normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
            collider: hit.collider,
            meta,
          };
        }
        return true;
      },
      undefined, filterGroups,
    );
    if (best) {
      best.point = {
        x: origin.x + dir.x * best.toi,
        y: origin.y + dir.y * best.toi,
        z: origin.z + dir.z * best.toi,
      };
    }
    return best;
  }

  stats() {
    return {
      bodies: this.world.bodies.len(),
      colliders: this.world.colliders.len(),
      joints: this.world.impulseJoints.len(),
      stepMs: this.lastStepMs,
    };
  }
}

export { RAPIER };
