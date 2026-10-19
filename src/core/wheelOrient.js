import { orientationMapping } from '../vehicles/Orientation.js';

/**
 * A wheel's hub face (local -X) must point back at the hull it bolts to, so left
 * and right wheels carry different orientations. Derived from the orientation
 * table so it stays the single source of truth; shared by the starter blueprint,
 * enemy blueprints and the builder.
 */
export const WHEEL_RIGHT = orientationMapping([-1, 0, 0], [-1, 0, 0]);  // hull at -X
export const WHEEL_LEFT = orientationMapping([-1, 0, 0], [1, 0, 0]);    // hull at +X
