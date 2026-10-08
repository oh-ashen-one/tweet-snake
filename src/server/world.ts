// Authoritative arena simulation. Transport-agnostic: the Durable Object (or a
// test harness) feeds it messages and gives each client a send callback.

import {
  BASE_SPEED, BOOST_SPEED, DT, MAGNET, MAX_FOOD, MAX_HUMANS, MAX_NAME, MIN_BOOST_MASS,
  NATURAL_FOOD, SKINS, SPACING, START_MASS, WORLD_R, FOOD_CELL,
  boostCostOf, extendPath, foodCellOf, foodRadius, pointsOf, radiusOf, trimPath, turnRateOf,
  viewHalfOf,
} from "../shared/rules";
import {
  FLAG_BOOST, FLAG_BOT, FLAG_SHIELD, MSG_INPUT, MSG_TICK, Writer, unpackAngle,
  type LeaderEntry, type ServerJson, type Sponsor,
} from "../shared/protocol";
import { cleanDisplayName } from "../shared/names";
import { BOT_NAMES, makeBrain, thinkBot, type BotBrain } from "./bots";

const TAU = Math.PI * 2;
const GRID = 64;
const SHIELD_TICKS = 50;

export interface Food {
  id: number;
  x: number;
  y: number;
  v: number;
  hue: number;
  cell: number;
  natural: boolean;
}

export interface Snake {
  id: number;
  name: string;
  skin: number;
  bot: boolean;
  cid: number;
  x: number;
  y: number;
  angle: number;
  target: number;
  boost: boolean;
  boosting: boolean;
  boostAcc: number;
  mass: number;
  pts: number[];
  alive: boolean;
  dying: boolean;
  kills: number;
  born: number;
  bestRank: number;
  shieldUntil: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  ai: BotBrain | null;
}

interface Client {
  id: number;
  send: (d: ArrayBuffer | string) => void;
  snake: Snake | null;
  aspect: number;
  known: Set<number>;
  cells: Set<number>;
  spectate: number;
  camX: number;
  camY: number;
}

// Uniform grid of body points, rebuilt every tick, for collisions and bot sight.
export class Grid {
  private cells = new Map<number, number[]>();
  private used: number[][] = [];

  clear(): void {
    for (const a of this.used) a.length = 0;
    this.used.length = 0;
  }

  add(x: number, y: number, r: number, id: number): void {
    const k = (Math.floor(x / GRID) + 512) * 1024 + (Math.floor(y / GRID) + 512);
    let a = this.cells.get(k);
    if (!a) {
      a = [];
      this.cells.set(k, a);
    }
    if (a.length === 0) this.used.push(a);
    a.push(x, y, r, id);
  }

  // Visits entries in cells overlapping the circle; stops when fn returns true.
  query(x: number, y: number, rad: number, fn: (px: number, py: number, pr: number, id: number) => boolean): boolean {
    const x0 = Math.floor((x - rad) / GRID);
    const x1 = Math.floor((x + rad) / GRID);
    const y0 = Math.floor((y - rad) / GRID);
    const y1 = Math.floor((y + rad) / GRID);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const a = this.cells.get((cx + 512) * 1024 + (cy + 512));
        if (!a) continue;
        for (let i = 0; i < a.length; i += 4) {
          if (fn(a[i], a[i + 1], a[i + 2], a[i + 3])) return true;
        }
      }
    }
    return false;
  }
}

// A player's chosen display name, or guest#### when empty or blocked.
export function playerName(raw: unknown, guest: unknown): string {
  const digits = String(guest ?? "").replace(/\D/g, "").slice(0, 4);
  return cleanDisplayName(raw, MAX_NAME) || `guest${digits.length === 4 ? digits : 1000 + Math.floor(Math.random() * 9000)}`;
}

// Bots are marked wherever a name is shown, so players can tell who's real.
function label(s: Snake): string {
  return s.bot ? `${s.name} 🤖` : s.name;
}

function clampAspect(a: unknown): number {
  const n = Number(a);
  return Number.isFinite(n) ? Math.min(3, Math.max(1 / 3, n)) : 1;
}

export class World {
  tick = 0;
  snakes = new Map<number, Snake>();
  clients = new Map<number, Client>();
  food = new Map<number, Food>();
  grid = new Grid();

  private foodCells = new Map<number, Set<Food>>();
  private naturalCount = 0;
  private nextSnakeId = 1;
  private nextFoodId = 1;
  private nextClientId = 1;
  private added: Food[] = [];
  private eaten: { f: Food; by: number }[] = [];
  private leader: Snake | null = null;
  private sponsors: Sponsor[] = [];
  private w = new Writer(32768);

  constructor(public room = "main") {
    for (let i = 0; i < NATURAL_FOOD; i++) this.spawnNaturalFood();
    this.added.length = 0;
  }

  get humansPlaying(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.snake) n++;
    return n;
  }

  addClient(send: (d: ArrayBuffer | string) => void): number {
    const id = this.nextClientId++;
    this.clients.set(id, {
      id, send, snake: null, aspect: 1, known: new Set(), cells: new Set(),
      spectate: 0, camX: 0, camY: 0,
    });
    this.json(id, { t: "hello", room: this.room, humans: this.humansPlaying, sponsors: this.sponsors });
    return id;
  }

  removeClient(cid: number): void {
    const c = this.clients.get(cid);
    if (!c) return;
    this.clients.delete(cid);
    if (c.snake) this.kill(c.snake, null);
  }

  onMessage(cid: number, data: string | ArrayBuffer): void {
    const c = this.clients.get(cid);
    if (!c) return;
    if (typeof data === "string") {
      if (data === "ping") return c.send("pong");
      let m: { t?: string; aspect?: unknown };
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (m.t === "view") c.aspect = clampAspect(m.aspect);
      // A menu is open on the client: let the bot brain drive until the
      // player's next steering input takes control back.
      else if (m.t === "auto" && c.snake && !c.snake.ai) c.snake.ai = makeBrain();
      return;
    }
    const b = new Uint8Array(data);
    if (b.length < 4) return;
    if (b[0] === MSG_INPUT && c.snake) {
      c.snake.ai = null;
      c.snake.target = unpackAngle(b[1] | (b[2] << 8));
      c.snake.boost = b[3] === 1;
    }
  }

  // The name is already cleaned by playerName().
  join(cid: number, name: string, skinRaw: unknown, aspect: unknown): void {
    const c = this.clients.get(cid);
    if (!c || c.snake) return;
    if (this.humansPlaying >= MAX_HUMANS) {
      this.json(c.id, { t: "full", next: this.room });
      return;
    }
    const skin = Math.abs(Math.floor(Number(skinRaw) || 0)) % SKINS.length;
    c.aspect = clampAspect(aspect);
    // New players start on autopilot (bot brain) with a short shield, so the
    // embed is already playing well before their first touch. Their first
    // input hands over control.
    c.snake = this.spawnSnake(name, skin, makeBrain(), c.id, START_MASS);
    c.snake.bot = false;
    c.snake.shieldUntil = this.tick + SHIELD_TICKS;
    this.json(c.id, { t: "you", name });
  }

  // Change a live player's name. Forgetting the snake on every client makes
  // the next tick resend it with the new name.
  rename(cid: number, name: string): void {
    const c = this.clients.get(cid);
    if (!c) return;
    this.json(c.id, { t: "you", name });
    const s = c.snake;
    if (!s || s.name === name) return;
    s.name = name;
    for (const o of this.clients.values()) o.known.delete(s.id);
  }

  setSponsors(list: Sponsor[]): void {
    if (JSON.stringify(list) === JSON.stringify(this.sponsors)) return;
    this.sponsors = list;
    this.broadcast({ t: "sponsors", list });
  }

  private json(cid: number, m: ServerJson): void {
    this.clients.get(cid)?.send(JSON.stringify(m));
  }

  private broadcast(m: ServerJson): void {
    const s = JSON.stringify(m);
    for (const c of this.clients.values()) c.send(s);
  }

  private allocSnakeId(): number {
    for (;;) {
      const id = this.nextSnakeId;
      this.nextSnakeId = this.nextSnakeId >= 65535 ? 1 : this.nextSnakeId + 1;
      if (!this.snakes.has(id)) return id;
    }
  }

  private findSpawn(): [number, number] {
    let x = 0;
    let y = 0;
    for (let i = 0; i < 30; i++) {
      const r = WORLD_R * 0.75 * Math.sqrt(Math.random());
      const a = Math.random() * TAU;
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
      if (!this.grid.query(x, y, 300, () => true)) break;
    }
    return [x, y];
  }

  spawnSnake(name: string, skin: number, ai: BotBrain | null, cid: number, mass: number): Snake {
    const [x, y] = this.findSpawn();
    const angle = Math.atan2(-y, -x) + (Math.random() - 0.5) * 1.4;
    const n = pointsOf(mass);
    const pts: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      pts.push(Math.fround(x - Math.cos(angle) * SPACING * i), Math.fround(y - Math.sin(angle) * SPACING * i));
    }
    const s: Snake = {
      id: this.allocSnakeId(), name, skin, bot: !!ai, cid,
      x: pts[pts.length - 2], y: pts[pts.length - 1], angle, target: angle,
      boost: false, boosting: false, boostAcc: 0, mass, pts,
      alive: true, dying: false, kills: 0, born: this.tick, bestRank: 999, shieldUntil: 0,
      minX: x, minY: y, maxX: x, maxY: y, ai,
    };
    this.bounds(s);
    this.snakes.set(s.id, s);
    return s;
  }

  private bounds(s: Snake): void {
    const p = s.pts;
    let minX = s.x, maxX = s.x, minY = s.y, maxY = s.y;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i], y = p[i + 1];
      if (x < minX) minX = x; else if (x > maxX) maxX = x;
      if (y < minY) minY = y; else if (y > maxY) maxY = y;
    }
    s.minX = minX; s.maxX = maxX; s.minY = minY; s.maxY = maxY;
  }

  addFood(x: number, y: number, v: number, hue: number, natural: boolean): Food {
    const d = Math.hypot(x, y);
    if (d > WORLD_R - 20) {
      x *= (WORLD_R - 20) / d;
      y *= (WORLD_R - 20) / d;
    }
    const f: Food = {
      id: this.nextFoodId, x: Math.round(x), y: Math.round(y), v, hue,
      cell: 0, natural,
    };
    this.nextFoodId = (this.nextFoodId + 1) >>> 0 || 1;
    f.cell = foodCellOf(f.x, f.y);
    this.food.set(f.id, f);
    let set = this.foodCells.get(f.cell);
    if (!set) {
      set = new Set();
      this.foodCells.set(f.cell, set);
    }
    set.add(f);
    if (natural) this.naturalCount++;
    this.added.push(f);
    return f;
  }

  private removeFood(f: Food): void {
    this.food.delete(f.id);
    this.foodCells.get(f.cell)?.delete(f);
    if (f.natural) this.naturalCount--;
  }

  private spawnNaturalFood(): void {
    const r = WORLD_R * 0.98 * Math.sqrt(Math.random());
    const a = Math.random() * TAU;
    const roll = Math.random();
    const v = roll < 0.6 ? 1 : roll < 0.9 ? 2 : 4;
    this.addFood(Math.cos(a) * r, Math.sin(a) * r, v, Math.floor(Math.random() * 200), true);
  }

  forEachFoodNear(x: number, y: number, rad: number, fn: (f: Food) => void): void {
    const x0 = Math.floor((x - rad) / FOOD_CELL);
    const x1 = Math.floor((x + rad) / FOOD_CELL);
    const y0 = Math.floor((y - rad) / FOOD_CELL);
    const y1 = Math.floor((y + rad) / FOOD_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.foodCells.get((cx + 64) * 128 + (cy + 64));
        if (set) for (const f of set) fn(f);
      }
    }
  }

  private move(s: Snake): void {
    const tr = turnRateOf(s.mass) * DT;
    let da = s.target - s.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    s.angle += Math.max(-tr, Math.min(tr, da));

    let speed = BASE_SPEED;
    s.boosting = s.boost && s.mass > MIN_BOOST_MASS;
    if (s.boosting) {
      speed = BOOST_SPEED;
      const cost = boostCostOf(s.mass) * DT;
      s.mass -= cost;
      s.boostAcc += cost;
      if (s.boostAcc >= 2.5) {
        const r = radiusOf(s.mass);
        this.addFood(
          s.pts[0] + (Math.random() - 0.5) * r, s.pts[1] + (Math.random() - 0.5) * r,
          Math.max(1, Math.round(s.boostAcc * 0.8)), 200 + s.skin, false,
        );
        s.boostAcc = 0;
      }
    }

    s.x = Math.fround(s.x + Math.cos(s.angle) * speed * DT);
    s.y = Math.fround(s.y + Math.sin(s.angle) * speed * DT);
    extendPath(s.pts, s.x, s.y);
    trimPath(s.pts, pointsOf(s.mass));
    this.bounds(s);
  }

  private kill(s: Snake, killer: Snake | null): void {
    if (!s.alive) return;
    s.alive = false;
    this.snakes.delete(s.id);

    const r = radiusOf(s.mass);
    const p = s.pts;
    const n = p.length / 2;
    const drops = Math.max(3, Math.min(240, Math.floor(n / 2)));
    const per = Math.max(1, (s.mass * 0.8) / drops);
    for (let k = 0; k < drops; k++) {
      const i = Math.floor((k / drops) * n) * 2;
      const v = Math.min(255, Math.max(1, Math.round(per * (0.6 + Math.random() * 0.8))));
      this.addFood(p[i] + (Math.random() - 0.5) * r * 1.4, p[i + 1] + (Math.random() - 0.5) * r * 1.4, v, 200 + s.skin, false);
    }

    if (killer) killer.kills++;
    if (s.mass >= 40 || !s.bot || (killer && !killer.bot)) {
      this.broadcast({ t: "kill", k: killer ? label(killer) : "", v: label(s), m: Math.floor(s.mass) });
    }

    const c = s.cid ? this.clients.get(s.cid) : undefined;
    if (c && c.snake === s) {
      c.snake = null;
      c.spectate = killer ? killer.id : 0;
      c.camX = s.x;
      c.camY = s.y;
      this.json(c.id, {
        t: "dead", mass: Math.floor(s.mass), kills: s.kills, killer: killer ? label(killer) : null,
        best: s.bestRank, secs: Math.round((this.tick - s.born) * DT),
      });
    }
  }

  step(): void {
    this.tick++;

    for (const s of this.snakes.values()) if (s.ai) thinkBot(this, s);
    for (const s of this.snakes.values()) this.move(s);

    this.grid.clear();
    for (const s of this.snakes.values()) {
      if (s.shieldUntil > this.tick) continue;
      const r = radiusOf(s.mass);
      const p = s.pts;
      for (let i = p.length - 2; i >= 0; i -= 4) this.grid.add(p[i], p[i + 1], r, s.id);
      this.grid.add(s.x, s.y, r, s.id);
    }

    const deaths: [Snake, Snake | null][] = [];
    for (const s of this.snakes.values()) {
      const r = radiusOf(s.mass);
      if (Math.hypot(s.x, s.y) > WORLD_R - r * 0.5) {
        s.dying = true;
        deaths.push([s, null]);
        continue;
      }
      if (s.shieldUntil > this.tick) continue;
      let hit = 0;
      this.grid.query(s.x, s.y, r + 46, (px, py, pr, id) => {
        if (id === s.id) return false;
        const lim = (r + pr) * 0.78;
        const dx = px - s.x, dy = py - s.y;
        if (dx * dx + dy * dy < lim * lim) {
          hit = id;
          return true;
        }
        return false;
      });
      if (hit) {
        s.dying = true;
        deaths.push([s, this.snakes.get(hit) ?? null]);
      }
    }

    for (const s of this.snakes.values()) {
      if (s.dying) continue;
      const reach = radiusOf(s.mass) + MAGNET;
      this.forEachFoodNear(s.x, s.y, reach + 20, (f) => {
        const lim = reach + foodRadius(f.v) * 0.5;
        const dx = f.x - s.x, dy = f.y - s.y;
        if (dx * dx + dy * dy < lim * lim) {
          this.removeFood(f);
          s.mass += f.v;
          this.eaten.push({ f, by: s.id });
        }
      });
    }

    for (const [s, k] of deaths) this.kill(s, k);

    for (let i = 0; i < 40 && this.naturalCount < NATURAL_FOOD && this.food.size < MAX_FOOD; i++) {
      this.spawnNaturalFood();
    }

    if (this.tick % 5 === 0) this.balanceBots();

    this.leader = null;
    for (const s of this.snakes.values()) if (!this.leader || s.mass > this.leader.mass) this.leader = s;

    for (const c of this.clients.values()) this.sync(c);
    if (this.tick % 20 === 0) this.leaderboard();

    this.added.length = 0;
    this.eaten.length = 0;
  }

  private balanceBots(): void {
    let bots = 0;
    let smallest: Snake | null = null;
    for (const s of this.snakes.values()) {
      if (!s.bot) continue;
      bots++;
      if (!smallest || s.mass < smallest.mass) smallest = s;
    }
    // A few bots keep a quiet arena alive; they bow out as real players join.
    const target = this.clients.size > 0 ? Math.max(2, 8 - this.humansPlaying) : 0;
    if (bots < target) {
      // Fill an empty arena fast so a fresh embed never looks dead.
      const used = new Set([...this.snakes.values()].map((s) => s.name));
      for (let i = Math.min(4, target - bots); i > 0; i--) {
        const free = BOT_NAMES.filter((n) => !used.has(n));
        const pool = free.length ? free : BOT_NAMES;
        const name = pool[Math.floor(Math.random() * pool.length)];
        used.add(name);
        const mass = START_MASS + Math.floor(Math.random() ** 3 * 400);
        this.spawnSnake(name, Math.floor(Math.random() * SKINS.length), makeBrain(), 0, mass);
      }
    } else if (bots > target + 2 && smallest) {
      this.kill(smallest, null);
    }
  }

  private sync(c: Client): void {
    let focus: Snake | null = c.snake;
    if (!focus && c.spectate) focus = this.snakes.get(c.spectate) ?? null;
    if (!focus && this.tick % 40 === 0) c.spectate = 0;
    if (!focus && !c.spectate) focus = this.leader;
    if (focus) {
      c.camX = focus.x;
      c.camY = focus.y;
    }
    const half = viewHalfOf(focus ? focus.mass : 200);
    const hx = half * Math.max(1, c.aspect) + 90;
    const hy = half * Math.max(1, 1 / c.aspect) + 90;
    const cx = c.camX, cy = c.camY;

    const w = this.w.reset();
    w.u8(MSG_TICK);
    w.u32(this.tick);
    w.u16(c.snake ? c.snake.id : 0);
    w.f32(cx);
    w.f32(cy);

    const enter: Snake[] = [];
    const upd: Snake[] = [];
    const leaveAt = w.slot();
    let nLeave = 0;
    for (const id of c.known) {
      const s = this.snakes.get(id);
      if (s && this.visible(s, cx, cy, hx, hy)) continue;
      w.u16(id);
      w.u8(s ? 0 : 1);
      c.known.delete(id);
      nLeave++;
    }
    w.setU16(leaveAt, nLeave);

    for (const s of this.snakes.values()) {
      if (c.known.has(s.id)) upd.push(s);
      else if (this.visible(s, cx, cy, hx, hy)) enter.push(s);
    }

    w.u16(enter.length);
    for (const s of enter) {
      c.known.add(s.id);
      w.u16(s.id);
      w.u8(s.skin);
      w.u8(this.flags(s));
      w.str(s.name);
      w.f32(s.mass);
      const n = s.pts.length / 2;
      w.u16(n);
      for (let i = 0; i < s.pts.length; i++) w.f32(s.pts[i]);
      w.f32(s.x);
      w.f32(s.y);
    }

    w.u16(upd.length);
    for (const s of upd) {
      w.u16(s.id);
      w.f32(s.x);
      w.f32(s.y);
      w.f32(s.mass);
      w.u8(this.flags(s));
    }

    const cells = new Set<number>();
    const x0 = Math.floor((cx - hx) / FOOD_CELL), x1 = Math.floor((cx + hx) / FOOD_CELL);
    const y0 = Math.floor((cy - hy) / FOOD_CELL), y1 = Math.floor((cy + hy) / FOOD_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) cells.add((gx + 64) * 128 + (gy + 64));
    }

    const dropAt = w.slot();
    let nDrop = 0;
    for (const k of c.cells) {
      if (cells.has(k)) continue;
      w.u16(k);
      nDrop++;
    }
    w.setU16(dropAt, nDrop);

    const foodAt = w.slot();
    let nFood = 0;
    const writeFood = (f: Food) => {
      w.u32(f.id);
      w.i16(f.x);
      w.i16(f.y);
      w.u8(Math.min(255, f.v));
      w.u8(f.hue);
      nFood++;
    };
    for (const k of cells) {
      if (c.cells.has(k)) continue;
      const set = this.foodCells.get(k);
      if (set) for (const f of set) writeFood(f);
    }
    for (const f of this.added) {
      if (c.cells.has(f.cell) && cells.has(f.cell) && this.food.has(f.id)) writeFood(f);
    }
    w.setU16(foodAt, nFood);

    const eatAt = w.slot();
    let nEat = 0;
    for (const e of this.eaten) {
      if (!cells.has(e.f.cell)) continue;
      w.u32(e.f.id);
      w.u16(e.by);
      nEat++;
    }
    w.setU16(eatAt, nEat);

    c.cells = cells;
    c.send(w.bytes());
  }

  private flags(s: Snake): number {
    return (s.boosting ? FLAG_BOOST : 0) | (s.bot ? FLAG_BOT : 0) | (s.shieldUntil > this.tick ? FLAG_SHIELD : 0);
  }

  private visible(s: Snake, cx: number, cy: number, hx: number, hy: number): boolean {
    const r = radiusOf(s.mass) + 10;
    return s.maxX + r >= cx - hx && s.minX - r <= cx + hx && s.maxY + r >= cy - hy && s.minY - r <= cy + hy;
  }

  private leaderboard(): void {
    const sorted = [...this.snakes.values()].sort((a, b) => b.mass - a.mass);
    sorted.forEach((s, i) => {
      if (i + 1 < s.bestRank) s.bestRank = i + 1;
    });
    const top: LeaderEntry[] = sorted.slice(0, 10).map((s) => ({
      id: s.id, n: label(s), s: s.skin, m: Math.floor(s.mass), x: Math.round(s.x), y: Math.round(s.y),
    }));
    const humans = this.humansPlaying;
    for (const c of this.clients.values()) {
      const rank = c.snake ? sorted.indexOf(c.snake) + 1 : 0;
      this.json(c.id, { t: "lb", top, rank, count: sorted.length, humans });
    }
  }
}
