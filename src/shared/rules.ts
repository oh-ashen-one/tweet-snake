// Game tuning shared by the server simulation and the client renderer.
// The client rebuilds every snake body from head positions, so anything that
// shapes a body (spacing, length, radius) must stay identical on both sides.

export const TITLE = "SNEK";

export const TICK_MS = 50;
export const DT = TICK_MS / 1000;

export const WORLD_R = 2800;
export const SPACING = 6;

export const START_MASS = 10;
export const MIN_BOOST_MASS = 14;
export const BASE_SPEED = 210;
export const BOOST_SPEED = 470;
export const MAGNET = 22;

export const FOOD_CELL = 256;
export const NATURAL_FOOD = 2200;
export const MAX_FOOD = 6000;

export const MAX_NAME = 16;
export const MAX_HUMANS = 80;

export function radiusOf(mass: number): number {
  return 9 + 4 * Math.log2(1 + mass / 20);
}

export function lengthOf(mass: number): number {
  return 40 + 8 * Math.pow(mass, 0.75);
}

// Number of spaced path points a snake of this mass keeps.
export function pointsOf(mass: number): number {
  return Math.ceil(lengthOf(mass) / SPACING) + 1;
}

export function turnRateOf(mass: number): number {
  return 5.6 / (1 + (radiusOf(mass) - 11) / 18);
}

// Half of the visible world extent along the screen's shorter axis.
export function viewHalfOf(mass: number): number {
  return 235 + 10 * Math.sqrt(mass);
}

export function boostCostOf(mass: number): number {
  return 4 + mass * 0.01;
}

export function foodRadius(v: number): number {
  return 3.2 + Math.sqrt(v) * 2.2;
}

export function foodCellOf(x: number, y: number): number {
  const cx = Math.floor(x / FOOD_CELL) + 64;
  const cy = Math.floor(y / FOOD_CELL) + 64;
  return cx * 128 + cy;
}

// Appends spaced points from the last point toward the head. Both sides run
// exactly this so the client's copy of a body matches the server's.
export function extendPath(pts: number[], hx: number, hy: number): void {
  let lx = pts[pts.length - 2];
  let ly = pts[pts.length - 1];
  let dx = hx - lx;
  let dy = hy - ly;
  let d = Math.hypot(dx, dy);
  while (d >= SPACING) {
    lx = Math.fround(lx + (dx / d) * SPACING);
    ly = Math.fround(ly + (dy / d) * SPACING);
    pts.push(lx, ly);
    dx = hx - lx;
    dy = hy - ly;
    d = Math.hypot(dx, dy);
  }
}

export function trimPath(pts: number[], keep: number): number {
  const extra = pts.length / 2 - keep;
  if (extra > 0) pts.splice(0, extra * 2);
  return extra > 0 ? extra : 0;
}

export const SKINS: [number, number, number][][] = [
  [[0.98, 0.33, 0.42], [1.0, 0.62, 0.55]],
  [[0.2, 0.78, 1.0], [0.55, 0.92, 1.0]],
  [[0.55, 0.92, 0.3], [0.85, 1.0, 0.5]],
  [[1.0, 0.76, 0.18], [1.0, 0.92, 0.5]],
  [[0.72, 0.42, 1.0], [0.9, 0.7, 1.0]],
  [[1.0, 0.45, 0.85], [1.0, 0.75, 0.95]],
  [[0.15, 0.95, 0.75], [0.6, 1.0, 0.9]],
  [[1.0, 0.52, 0.2], [0.25, 0.22, 0.3]],
  [[0.95, 0.95, 0.98], [0.2, 0.75, 1.0]],
  [[0.2, 0.2, 0.26], [0.98, 0.33, 0.42]],
  [[0.38, 0.5, 1.0], [1.0, 1.0, 1.0]],
  [[1.0, 0.9, 0.3], [0.2, 0.2, 0.26]],
];
