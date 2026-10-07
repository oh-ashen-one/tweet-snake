// Bot snakes keep the arena alive when few humans are around. They forage,
// steer around bodies and the wall, and occasionally hunt smaller snakes.

import { BASE_SPEED, WORLD_R, radiusOf } from "../shared/rules";
import type { Snake, World } from "./world";

export interface BotBrain {
  goal: number;
  wander: number;
  nextThink: number;
  boostTicks: number;
  aggro: number;
  sloppy: number;
}

export const BOT_NAMES = [
  "noodle", "sssam", "danger noodle", "slinky", "worm king", "hissy fit", "snekboi",
  "spaghetti", "long boi", "nope rope", "zigzag", "boop", "mamba", "viper", "pretzel",
  "garden hose", "hiss hiss", "slippy", "wiggles", "lil sneaky", "chonk", "python",
  "linguine", "sidewinder", "hissterical", "coil", "squiggle", "jormungandr", "tube", "ramen",
];

export function makeBrain(): BotBrain {
  const a = Math.random() * Math.PI * 2;
  return {
    goal: a, wander: a, nextThink: 0, boostTicks: 0,
    aggro: 0.1 + Math.random() * 0.5,
    sloppy: 0.01 + Math.random() * 0.12,
  };
}

function angleTo(s: Snake, x: number, y: number): number {
  return Math.atan2(y - s.y, x - s.x);
}

function angDist(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function chooseGoal(w: World, s: Snake, b: BotBrain): void {
  const fromCenter = Math.hypot(s.x, s.y);
  if (fromCenter > WORLD_R * 0.82) {
    b.goal = angleTo(s, 0, 0) + (Math.random() - 0.5) * 0.8;
    return;
  }

  if (s.mass > 30 && Math.random() < b.aggro) {
    let prey: Snake | null = null;
    let best = 360;
    for (const o of w.snakes.values()) {
      if (o === s || o.mass > s.mass * 0.9) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < best) {
        best = d;
        prey = o;
      }
    }
    if (prey) {
      const lead = radiusOf(prey.mass) * 7;
      b.goal = angleTo(s, prey.x + Math.cos(prey.angle) * lead, prey.y + Math.sin(prey.angle) * lead);
      if (Math.random() < 0.35) b.boostTicks = 8 + Math.floor(Math.random() * 10);
      return;
    }
  }

  let bestScore = 0;
  let bx = 0, by = 0, bv = 0, bd = 0;
  w.forEachFoodNear(s.x, s.y, 380, (f) => {
    const d = Math.hypot(f.x - s.x, f.y - s.y);
    const score = f.v / (d + 40);
    if (score > bestScore) {
      bestScore = score;
      bx = f.x; by = f.y; bv = f.v; bd = d;
    }
  });
  if (bestScore > 0) {
    b.goal = angleTo(s, bx, by);
    if (bv >= 6 && bd > 120 && s.mass > 30 && Math.random() < 0.4) b.boostTicks = 6;
    return;
  }

  b.wander += (Math.random() - 0.5) * 0.9;
  b.goal = b.wander;
}

function danger(w: World, s: Snake, a: number): number {
  const r = radiusOf(s.mass);
  const reach = [r * 2, r * 4, r * 7, BASE_SPEED * 0.7];
  let d = 0;
  for (const L of reach) {
    const px = s.x + Math.cos(a) * L;
    const py = s.y + Math.sin(a) * L;
    const weight = 200 / (L + 50);
    if (Math.hypot(px, py) > WORLD_R - r * 2) d += 3 * weight;
    if (w.grid.query(px, py, r * 1.5, (_x, _y, _r, id) => id !== s.id)) d += 4 * weight;
  }
  return d;
}

export function thinkBot(w: World, s: Snake): void {
  const b = s.ai!;
  if (w.tick >= b.nextThink) {
    b.nextThink = w.tick + 4 + Math.floor(Math.random() * 5);
    chooseGoal(w, s, b);
  }

  let target = b.goal;
  if (Math.random() > b.sloppy && danger(w, s, b.goal) > 0) {
    const options = [s.angle, s.angle + 0.5, s.angle - 0.5, s.angle + 1.1, s.angle - 1.1,
      s.angle + 1.8, s.angle - 1.8, s.angle + Math.PI];
    let best = Infinity;
    for (const a of options) {
      const score = danger(w, s, a) + angDist(a, b.goal) * 0.15;
      if (score < best) {
        best = score;
        target = a;
      }
    }
  }

  s.target = target;
  s.boost = b.boostTicks > 0;
  if (b.boostTicks > 0) b.boostTicks--;
}
