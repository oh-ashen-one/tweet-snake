// Client mirror of the server world, rebuilt from TICK messages. Bodies are
// reconstructed from head positions with the same spacing rule the server uses.

import { FLAG_BOOST, FLAG_BOT, FLAG_SHIELD, FLAG_VERIFIED, MSG_TICK, Reader } from "../shared/protocol";
import { TICK_MS, extendPath, foodCellOf, pointsOf, trimPath } from "../shared/rules";

export interface CSnake {
  id: number;
  name: string;
  pfp: string;
  verified: boolean;
  skin: number;
  bot: boolean;
  mass: number;
  pts: number[];
  base: number; // absolute index of pts[0], keeps stripes fixed to the body
  hx: number;
  hy: number;
  px: number;
  py: number;
  dir: number;
  boost: boolean;
  shield: boolean;
}

export interface CFood {
  id: number;
  x: number;
  y: number;
  v: number;
  hue: number;
  born: number;
}

export interface Eaten {
  x: number;
  y: number;
  v: number;
  hue: number;
  by: number;
  t0: number;
}

export interface Burst {
  x: number;
  y: number;
  skin: number;
  r: number;
  t0: number;
}

export const state = {
  snakes: new Map<number, CSnake>(),
  food: new Map<number, CFood>(),
  eaten: [] as Eaten[],
  bursts: [] as Burst[],
  myId: 0,
  tick: 0,
  camX: 0,
  camY: 0,
  lastAt: 0,
  interval: TICK_MS,
  bytesIn: 0,
};

// Client keeps a couple of extra tail points so the interpolated tail never
// runs out of path between ticks.
const TAIL_SPARE = 3;

export function applyTick(buf: ArrayBuffer, now: number): void {
  const r = new Reader(buf);
  if (r.u8() !== MSG_TICK) return;
  state.bytesIn += buf.byteLength;
  state.tick = r.u32();
  state.myId = r.u16();
  state.camX = r.f32();
  state.camY = r.f32();

  let n = r.u16();
  for (let i = 0; i < n; i++) {
    const id = r.u16();
    const died = r.u8();
    const s = state.snakes.get(id);
    if (!s) continue;
    if (died) state.bursts.push({ x: s.hx, y: s.hy, skin: s.skin, r: Math.sqrt(s.mass), t0: now });
    state.snakes.delete(id);
  }

  n = r.u16();
  for (let i = 0; i < n; i++) {
    const id = r.u16();
    const skin = r.u8();
    const flags = r.u8();
    const name = r.str();
    const pfp = r.str();
    const mass = r.f32();
    const np = r.u16();
    const pts = new Array<number>(np * 2);
    for (let k = 0; k < np * 2; k++) pts[k] = r.f32();
    const hx = r.f32();
    const hy = r.f32();
    const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
    const ox = pts.length >= 4 ? pts[pts.length - 4] : lx - 1;
    const oy = pts.length >= 4 ? pts[pts.length - 3] : ly;
    state.snakes.set(id, {
      id, name, pfp, verified: (flags & FLAG_VERIFIED) !== 0, skin, bot: (flags & FLAG_BOT) !== 0, mass, pts, base: 0,
      hx, hy, px: hx, py: hy, dir: Math.atan2(ly - oy, lx - ox), boost: (flags & FLAG_BOOST) !== 0,
      shield: (flags & FLAG_SHIELD) !== 0,
    });
  }

  n = r.u16();
  for (let i = 0; i < n; i++) {
    const id = r.u16();
    const hx = r.f32();
    const hy = r.f32();
    const mass = r.f32();
    const flags = r.u8();
    const s = state.snakes.get(id);
    if (!s) continue;
    s.px = s.hx;
    s.py = s.hy;
    s.hx = hx;
    s.hy = hy;
    if (hx !== s.px || hy !== s.py) s.dir = Math.atan2(hy - s.py, hx - s.px);
    s.mass = mass;
    s.boost = (flags & FLAG_BOOST) !== 0;
    s.shield = (flags & FLAG_SHIELD) !== 0;
    extendPath(s.pts, hx, hy);
    s.base += trimPath(s.pts, pointsOf(mass) + TAIL_SPARE);
  }

  n = r.u16();
  if (n > 0) {
    const drop = new Set<number>();
    for (let i = 0; i < n; i++) drop.add(r.u16());
    for (const [id, f] of state.food) if (drop.has(foodCellOf(f.x, f.y))) state.food.delete(id);
  }

  n = r.u16();
  for (let i = 0; i < n; i++) {
    const id = r.u32();
    const x = r.i16();
    const y = r.i16();
    const v = r.u8();
    const hue = r.u8();
    if (!state.food.has(id)) state.food.set(id, { id, x, y, v, hue, born: now });
  }

  n = r.u16();
  for (let i = 0; i < n; i++) {
    const id = r.u32();
    const by = r.u16();
    const f = state.food.get(id);
    if (!f) continue;
    state.food.delete(id);
    state.eaten.push({ x: f.x, y: f.y, v: f.v, hue: f.hue, by, t0: now });
  }

  if (state.lastAt) {
    const dt = Math.min(200, now - state.lastAt);
    state.interval = state.interval * 0.92 + dt * 0.08;
  }
  state.lastAt = now;
}

export function resetWorld(): void {
  state.snakes.clear();
  state.food.clear();
  state.eaten.length = 0;
  state.bursts.length = 0;
  state.myId = 0;
  state.lastAt = 0;
}
