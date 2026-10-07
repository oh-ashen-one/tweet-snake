// Headless behavioural test: runs the real World for two simulated minutes with
// bots and two fake humans, decodes one human's stream with the real client
// decoder, and checks the client mirror stays faithful to the server.
//
//   npm run test:sim

import { MSG_INPUT, packAngle, type ServerJson } from "../src/shared/protocol";
import { DT, foodCellOf, radiusOf } from "../src/shared/rules";
import { World, guestIdentity } from "../src/server/world";
import { applyTick, state } from "../src/client/state";

const SECONDS = Number(process.env.SECONDS || 120);
const world = new World("test");

let bytesA = 0;
const jsonA: ServerJson[] = [];
const a = world.addClient((d) => {
  if (typeof d === "string") jsonA.push(JSON.parse(d));
  else {
    bytesA += d.byteLength;
    applyTick(d, performance.now());
  }
});
const b = world.addClient(() => {});
world.join(a, guestIdentity("1234"), 3, 1);
world.join(b, { name: "@tester", pfp: "", verified: true }, 5, 16 / 9);

function steer(cid: number, angle: number, boost: boolean) {
  const buf = new ArrayBuffer(4);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG_INPUT);
  dv.setUint16(1, packAngle(angle), true);
  dv.setUint8(3, boost ? 1 : 0);
  world.onMessage(cid, buf);
}

const ticks = Math.round(SECONDS / DT);
const times: number[] = [];
let maxErr = 0;
let checks = 0;
let foodGhosts = 0;
let foodMissing = 0;
let respawnsA = 0;
let maxSnakes = 0;
let maxMass = 0;
let ang = 0;

for (let t = 1; t <= ticks; t++) {
  if (t % 15 === 0) ang += (Math.random() - 0.5) * 2;
  steer(a, ang, t % 200 < 20);
  steer(b, -ang * 1.3, false);

  const t0 = performance.now();
  world.step();
  times.push(performance.now() - t0);

  for (const c of [a, b]) {
    if (!world.clients.get(c)!.snake) {
      if (c === a) respawnsA++;
      world.join(c, guestIdentity("1234"), 3, 1);
    }
  }
  maxSnakes = Math.max(maxSnakes, world.snakes.size);
  for (const s of world.snakes.values()) maxMass = Math.max(maxMass, s.mass);

  if (t % 20 === 0) {
    // Body reconstruction: compare newest points (aligned from the head).
    for (const cs of state.snakes.values()) {
      const ss = world.snakes.get(cs.id);
      if (!ss) continue;
      const n = Math.min(ss.pts.length, cs.pts.length) / 2;
      for (let k = 1; k <= n; k += 7) {
        const si = ss.pts.length - k * 2, ci = cs.pts.length - k * 2;
        const e = Math.hypot(ss.pts[si] - cs.pts[ci], ss.pts[si + 1] - cs.pts[ci + 1]);
        if (e > maxErr) maxErr = e;
        checks++;
      }
      if (Math.hypot(ss.x - cs.hx, ss.y - cs.hy) > 0.01) maxErr = Math.max(maxErr, 999);
    }
    // Food: nothing on the client that the server ate; nothing missing in subscribed cells.
    const cells = (world.clients.get(a) as unknown as { cells: Set<number> }).cells;
    for (const id of state.food.keys()) if (!world.food.has(id)) foodGhosts++;
    for (const f of world.food.values()) if (cells.has(foodCellOf(f.x, f.y)) && !state.food.has(f.id)) foodMissing++;
  }
}

times.sort((x, y) => x - y);
const avg = times.reduce((s, x) => s + x, 0) / times.length;
const p99 = times[Math.floor(times.length * 0.99)];
const kills = jsonA.filter((m) => m.t === "kill").length;
const lbs = jsonA.filter((m) => m.t === "lb").length;
const kbps = bytesA / SECONDS / 1024;

const report = {
  simSeconds: SECONDS,
  stepAvgMs: +avg.toFixed(3),
  stepP99Ms: +p99.toFixed(3),
  maxSnakes,
  maxMass: Math.round(maxMass),
  killFeedEvents: kills,
  leaderboardMsgs: lbs,
  respawnsA,
  clientKiBps: +kbps.toFixed(1),
  bodyChecks: checks,
  bodyMaxErr: +maxErr.toFixed(4),
  foodGhosts,
  foodMissing,
  myRadius: +radiusOf(world.clients.get(a)!.snake?.mass ?? 10).toFixed(1),
};
console.log(JSON.stringify(report, null, 2));

const fails: string[] = [];
if (p99 > 8) fails.push(`tick p99 ${p99.toFixed(2)}ms > 8ms`);
if (maxSnakes < 10) fails.push("bots did not populate the arena");
if (kills < 3) fails.push("almost no deaths: collisions may be broken");
if (maxMass < 60) fails.push("nobody grew: eating may be broken");
if (checks < 100) fails.push("too few body checks: client saw no snakes");
if (maxErr > 0.5) fails.push(`client body drifted ${maxErr.toFixed(3)} units from server`);
if (foodGhosts > 0) fails.push(`${foodGhosts} ghost food on client`);
if (foodMissing > 0) fails.push(`${foodMissing} food missing on client`);
if (lbs < SECONDS - 2) fails.push("leaderboard not sent every second");
if (kbps > 40) fails.push(`client bandwidth ${kbps.toFixed(1)} KiB/s too high`);

if (fails.length) {
  console.error("FAIL\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("PASS");
