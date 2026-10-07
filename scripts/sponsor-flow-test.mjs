// Full sponsor checkout flow through the real Worker, with Stripe mocked by
// scripts/mock-stripe.mjs. .dev.vars for this run:
//   STRIPE_SECRET_KEY=sk_test_local  STRIPE_API_BASE=http://127.0.0.1:8897
//   STRIPE_WEBHOOK_SECRET=whsec_local  ADMIN_TOKEN=local-admin
//   node scripts/sponsor-flow-test.mjs

import crypto from "node:crypto";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const MOCK = process.env.MOCK || "http://127.0.0.1:8897";
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || "whsec_local";
const ADMIN = process.env.ADMIN_TOKEN || "local-admin";
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) fails.push(msg);
};
const room = `sp-${Date.now().toString(36)}`;
const co = (body) => fetch(`${BASE}/api/sponsor/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room, ...body }) });
const sponsors = async () => (await fetch(`${BASE}/api/sponsors`)).json();

async function buy(tier, name, qty, { pay = true, url } = {}) {
  const r = await co({ tier, name, url });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  const id = new URL(j.url).pathname.split("/").pop();
  if (pay) await fetch(`${MOCK}/pay/${id}?qty=${qty}`, { method: "POST" });
  return id;
}

const pageHtml = await (await fetch(`${BASE}/r/${room}`)).text();
check(/data-sponsor="500,300,100:168:test"/.test(pageHtml), "game page advertises the 3 tiers, 7-day spots, test mode");
check((await co({ tier: 250, name: "x" })).status === 400, "unknown tier rejected");
check((await co({ tier: 100, name: "" })).status === 400, "empty name rejected");
check((await co({ tier: 100, name: "x", url: "http://nope" })).status === 400, "non-https link rejected");

const a = await buy(500, "Acme", 1, { url: "https://acme.example" });
const pa = await (await fetch(`${BASE}/sponsored?session_id=${a}&room=${room}`)).text();
check(pa.includes("on the board") && pa.includes("top spot"), "success page records Acme ($500) at the top");

const b = await buy(300, "Bolt", 2);
await fetch(`${BASE}/sponsored?session_id=${b}&room=${room}`);
let list = await sponsors();
check(list[0]?.name === "Bolt" && list[0].amount === 600, "2 × $300 = $600 beats $500");

await fetch(`${BASE}/sponsored?session_id=${a}&room=${room}`);
list = await sponsors();
check(list.filter((s) => s.name === "Acme").length === 1 && list.find((s) => s.name === "Acme").amount === 500, "revisiting the success page doesn't double count");

const c = await buy(100, "Unpaid Co", 1, { pay: false });
const pc = await (await fetch(`${BASE}/sponsored?session_id=${c}&room=${room}`)).text();
check(pc.includes("pending") && !(await sponsors()).some((s) => s.name === "Unpaid Co"), "unpaid checkout isn't listed");

const d = await buy(100, "Hooky", 1);
const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: d } } });
const t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac("sha256", WHSEC).update(`${t}.${payload}`).digest("hex");
const bad = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": `t=${t},v1=${"0".repeat(64)}` } });
check(bad.status === 400, "webhook with a bad signature is rejected");
const good = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
check(good.ok && (await sponsors()).some((s) => s.name === "Hooky"), "signed webhook records the sponsor without the success page");

const a2 = await buy(300, "acme", 1);
await fetch(`${BASE}/sponsored?session_id=${a2}&room=${room}`);
list = await sponsors();
if (list[0]?.amount !== 800) console.log("     board:", JSON.stringify(list));
check(list[0]?.name === "Acme" && list[0].amount === 800, "Acme tops up ($500 + $300) and retakes #1");

const del = await fetch(`${BASE}/api/admin/sponsorships/${b}`, { method: "DELETE", headers: { authorization: `Bearer ${ADMIN}` } });
check(del.ok && !(await sponsors()).some((s) => s.name === "Bolt"), "admin removal takes Bolt off the board");
check((await fetch(`${BASE}/api/admin/sponsorships/${a}`, { method: "DELETE" })).status === 401, "removal needs the admin token");

for (const id of [a, a2, d]) await fetch(`${BASE}/api/admin/sponsorships/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${ADMIN}` } });

if (fails.length) {
  console.error(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS");
process.exit(0);
