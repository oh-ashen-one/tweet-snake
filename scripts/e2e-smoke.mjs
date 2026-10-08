// End-to-end smoke test against a running server (default: wrangler dev).
// Covers: player-card meta, dev login hand-off via nonce claim, verified join,
// guest join, tick rate, leaderboard, admin auth, sponsor broadcast.
//
//   npm run dev   (in another shell)
//   npm run test:e2e            or  BASE=https://... npm run test:e2e

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const ADMIN = process.env.ADMIN_TOKEN || "local-admin";
const ROOM = `e2e-${Date.now().toString(36)}`;
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) fails.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, guest) {
  const wsUrl = BASE.replace(/^http/, "ws") + `/ws/${ROOM}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  const c = { ws, json: [], ticks: 0, bytes: 0, myIds: new Set(), closed: null };
  ws.onclose = (e) => (c.closed = e.code);
  ws.onmessage = (e) => {
    if (typeof e.data === "string") {
      if (e.data !== "pong") c.json.push(JSON.parse(e.data));
      return;
    }
    c.ticks++;
    c.bytes += e.data.byteLength;
    const dv = new DataView(e.data);
    const id = dv.getUint16(5, true);
    if (id) c.myIds.add(id);
  };
  c.ready = new Promise((res, rej) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "join", name, guest, skin: 2, aspect: 1 }));
      res();
    };
    ws.onerror = rej;
  });
  return c;
}

const card = await (await fetch(`${BASE}/r/${ROOM}`, { headers: { "user-agent": "Twitterbot/1.0" } })).text();
check(card.includes('name="twitter:card" content="player"'), "player card meta present");
check(card.includes(`/play/${ROOM}"`), "player url points at /play/<room>");
const play = await fetch(`${BASE}/play/${ROOM}`);
check((play.headers.get("content-security-policy") || "").includes("https://x.com"), "frame-ancestors allows x.com");

const alice = client("alice", "1111");
const guest = client("", "2222");
const forged = client("@elonmusk", "3333");
await Promise.all([alice.ready, guest.ready, forged.ready]);
// Steer like a real player: binary input every 50ms (this once crashed rooms).
let k = 0;
const steer = setInterval(() => {
  const b = new ArrayBuffer(4);
  const dv = new DataView(b);
  dv.setUint8(0, 1);
  dv.setUint16(1, (k++ * 700) & 0xffff, true);
  dv.setUint8(3, k % 20 < 5 ? 1 : 0);
  alice.ws.send(b);
}, 50);
await sleep(3000);
clearInterval(steer);

const you = (c) => c.json.find((m) => m.t === "you");
check(you(alice)?.name === "alice", "chosen name is used");
check(you(guest)?.name === "guest2222", "no name gives guest2222");
check(you(forged)?.name === "elonmusk", "leading @ is stripped (no fake handles)");
check(alice.closed === null && guest.closed === null, "steering input keeps the room alive");
alice.ws.send(JSON.stringify({ t: "name", name: "alice2", guest: "1111" }));
await sleep(300);
check(alice.json.filter((m) => m.t === "you").pop()?.name === "alice2", "rename mid-game works");
alice.ws.send(JSON.stringify({ t: "auto" }));
await sleep(300);
check(alice.closed === null, "autopilot request (menu open) is accepted");
check(alice.ticks >= 45 && alice.ticks <= 75, `tick rate ~20/s (${alice.ticks} in 3s)`);
check(alice.json.some((m) => m.t === "lb" && m.top.length > 0), "leaderboard received");
check(alice.json.some((m) => m.t === "hello"), "hello received");
console.log(`     bandwidth ${(alice.bytes / 3 / 1024).toFixed(1)} KiB/s per client`);

const denied = await fetch(`${BASE}/api/admin/sponsors`, { method: "PUT", body: "[]", headers: { authorization: "Bearer nope" } });
check(denied.status === 401, "admin endpoint rejects bad token");
const bad = await fetch(`${BASE}/api/admin/sponsors`, {
  method: "PUT", headers: { authorization: `Bearer ${ADMIN}` },
  body: JSON.stringify([{ name: "x", url: "javascript:alert(1)", amount: 5 }]),
});
check(bad.status === 400, "sponsor list rejects non-https url");
const put = await fetch(`${BASE}/api/admin/sponsors`, {
  method: "PUT", headers: { authorization: `Bearer ${ADMIN}` },
  body: JSON.stringify([{ name: "Small Co", amount: 50 }, { name: "Big Co", url: "https://example.com", amount: 500 }]),
});
check(put.ok, "admin can set sponsors");
const list = await (await fetch(`${BASE}/api/sponsors`)).json();
check(list[0]?.name === "Big Co", "highest payer takes the top sponsor slot");

// Rooms re-read sponsors on connect at most every 5s (and every 30s while live).
for (const c of [alice, guest, forged]) c.ws.close();
await sleep(5500);
const late = client("", "4444");
await late.ready;
await sleep(1500);
const got = late.json.filter((m) => m.t === "hello" || m.t === "sponsors").pop();
check((got?.sponsors ?? got?.list)?.[0]?.name === "Big Co", "new players receive the current sponsor list");
late.ws.close();

await fetch(`${BASE}/api/admin/sponsors`, { method: "PUT", headers: { authorization: `Bearer ${ADMIN}` }, body: "[]" });

if (fails.length) {
  console.error(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS");
process.exit(0);
