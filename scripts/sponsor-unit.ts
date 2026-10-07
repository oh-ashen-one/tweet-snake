// Unit checks for sponsorship logic: live-key guard, ranking, expiry, webhook signatures.
//   npx tsx scripts/sponsor-unit.ts

import { board, stripeKey, verifyWebhook, type Sponsorship } from "../src/server/sponsorship";
import crypto from "node:crypto";

const fails: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) fails.push(msg);
};

check(stripeKey({ STRIPE_SECRET_KEY: "sk_test_abc" }) === "sk_test_abc", "test key accepted");
check(stripeKey({ STRIPE_SECRET_KEY: "sk_live_abc" }) === null, "live key refused by default");
check(stripeKey({ STRIPE_SECRET_KEY: "rk_live_abc", STRIPE_ALLOW_LIVE: "1" }) === "rk_live_abc", "live key only with STRIPE_ALLOW_LIVE=1");
check(stripeKey({}) === null, "no key, no sponsorships");

const now = 1_000_000_000;
const sp = (id: string, name: string, amount: number, ageH: number, extra: Partial<Sponsorship> = {}): Sponsorship =>
  ({ id, name, amount, paidAt: now - ageH * 3600e3, until: now - ageH * 3600e3 + 24 * 3600e3, ...extra });
const b = board([
  sp("1", "Acme", 500, 1),
  sp("2", "Bolt", 300, 2), sp("3", "bolt", 300, 1, { url: "https://bolt.example" }),
  sp("4", "Old", 900, 25),
  sp("5", "Gone", 1000, 1, { removed: true }),
  sp("6", "Cheap", 100, 3),
], [{ name: "House", amount: 50 }], now);
check(b[0]?.name === "Bolt" && b[0].amount === 600, "two $300 buys by the same name total $600 and take #1");
check(b[0]?.url === "https://bolt.example", "latest link wins");
check(b[1]?.name === "Acme", "$500 is second");
check(!b.some((s) => s.name === "Old"), "spots expire after 24h");
check(!b.some((s) => s.name === "Gone"), "removed sponsorships are hidden");
check(b[b.length - 1]?.name === "House", "house entries rank by amount too");

const secret = "whsec_unit";
const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_x" } } });
const t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
check(await verifyWebhook(secret, payload, `t=${t},v1=${sig}`), "valid webhook signature accepted");
check(!(await verifyWebhook(secret, payload + " ", `t=${t},v1=${sig}`)), "tampered body rejected");
check(!(await verifyWebhook("whsec_other", payload, `t=${t},v1=${sig}`)), "wrong secret rejected");
check(!(await verifyWebhook(secret, payload, `t=${t - 900},v1=${crypto.createHmac("sha256", secret).update(`${t - 900}.${payload}`).digest("hex")}`)), "stale timestamp rejected");

if (fails.length) process.exit(1);
console.log("PASS");
