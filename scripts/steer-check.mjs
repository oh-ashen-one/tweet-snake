// Verifies steering end to end: join, hold a heading, and check our snake's
// head actually moves that way (reads our own head from TICK updates).
//   BASE=http://127.0.0.1:8787 node scripts/steer-check.mjs
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const ws = new WebSocket(BASE.replace(/^http/, "ws") + `/ws/steer-${Date.now().toString(36)}`);
ws.binaryType = "arraybuffer";
let myId = 0;
const heads = [];
ws.onmessage = (e) => {
  if (typeof e.data === "string") return;
  const dv = new DataView(e.data);
  let o = 5;
  myId = dv.getUint16(o, true); o += 2 + 8;
  const nLeave = dv.getUint16(o, true); o += 2 + nLeave * 3;
  const nEnter = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < nEnter; i++) {
    const id = dv.getUint16(o, true); o += 4;
    const nl = dv.getUint8(o); o += 1 + nl + 4;
    const np = dv.getUint16(o, true); o += 2 + np * 8;
    const hx = dv.getFloat32(o, true), hy = dv.getFloat32(o + 4, true); o += 8;
    if (id === myId) heads.push([hx, hy]);
  }
  const nUpd = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < nUpd; i++) {
    const id = dv.getUint16(o, true);
    const hx = dv.getFloat32(o + 2, true), hy = dv.getFloat32(o + 6, true);
    o += 15;
    if (id === myId) heads.push([hx, hy]);
  }
};
const send = (a) => {
  const b = new ArrayBuffer(4), dv = new DataView(b);
  dv.setUint8(0, 1); dv.setUint16(1, Math.round(((a % (2 * Math.PI)) / (2 * Math.PI)) * 65535) & 0xffff, true); dv.setUint8(3, 0);
  ws.send(b);
};
ws.onopen = async () => {
  ws.send(JSON.stringify({ t: "join", name: "steer", guest: "1111", skin: 1, aspect: 1 }));
  const results = {};
  for (const [label, a] of [["down", Math.PI / 2], ["left", Math.PI], ["up", 1.5 * Math.PI]]) {
    const iv = setInterval(() => send(a), 50);
    await new Promise((r) => setTimeout(r, 1500));
    const start = heads.length;
    await new Promise((r) => setTimeout(r, 600));
    clearInterval(iv);
    const seg = heads.slice(start);
    if (seg.length < 5) {
      // Our snake died or left view mid-check (bots roam the room); rejoin and skip.
      ws.send(JSON.stringify({ t: "join", name: "steer", guest: "1111", skin: 1, aspect: 1 }));
      results[label] = "skipped";
      continue;
    }
    const [x0, y0] = seg[0], [x1, y1] = seg[seg.length - 1];
    const got = Math.atan2(y1 - y0, x1 - x0);
    const err = Math.abs(Math.atan2(Math.sin(got - a), Math.cos(got - a)));
    results[label] = +err.toFixed(2);
  }
  console.log(JSON.stringify({ myId, headingErrorRad: results }));
  const vals = Object.values(results).filter((e) => e !== "skipped");
  const ok = vals.length >= 2 && vals.every((e) => e < 0.35);
  console.log(ok ? "PASS" : "FAIL");
  process.exit(ok ? 0 : 1);
};
