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

function client(token, guest) {
  const wsUrl = BASE.replace(/^http/, "ws") + `/ws/${ROOM}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  const c = { ws, json: [], ticks: 0, bytes: 0, myIds: new Set() };
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
      ws.send(JSON.stringify({ t: "join", token, guest, skin: 2, aspect: 1 }));
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

const nonce = "e2enonce" + Math.random().toString(36).slice(2, 14);
const login = await fetch(`${BASE}/auth/dev?n=${nonce}&h=alice`);
check(login.ok, "dev login page");
const claim = await fetch(`${BASE}/auth/claim?n=${nonce}`);
const token = claim.status === 200 ? (await claim.json()).token : null;
check(!!token, "nonce claim returns token");
const again = await fetch(`${BASE}/auth/claim?n=${nonce}`);
check(again.status === 204, "claim is single-use");

const alice = client(token, "1111");
const guest = client(null, "2222");
const forged = client(token ? token.slice(0, -4) + "AAAA" : "x.y", "3333");
await Promise.all([alice.ready, guest.ready, forged.ready]);
await sleep(3000);

const you = (c) => c.json.find((m) => m.t === "you");
check(you(alice)?.name === "@alice" && you(alice)?.verified === true, "signed-in player is @alice (verified)");
check(you(guest)?.name === "guest2222" && you(guest)?.verified === false, "guest gets guest2222");
check(you(forged)?.verified === false, "forged token falls back to guest");
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
const late = client(null, "4444");
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
