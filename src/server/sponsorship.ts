// Paid sponsor spots via Stripe Checkout. Three price points; buyers can raise
// the quantity on Stripe's page, and the leaderboard ranks sponsors by total
// paid within the active window (default 24 h). A payment is recorded either
// by the signed webhook or when the buyer lands on the success page; both
// paths look the session up and are idempotent by session id.

import type { Sponsor } from "../shared/protocol";

export const TIERS = [500, 300, 100] as const;
export const SLOTS = 5;
const MAX_QTY = 20;

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_ALLOW_LIVE?: string;
  STRIPE_API_BASE?: string; // tests point this at a local mock
  SPONSOR_HOURS?: string;
}

export interface Sponsorship {
  id: string; // Stripe Checkout Session id
  name: string;
  url?: string;
  amount: number; // dollars actually paid
  paidAt: number;
  until: number;
  removed?: boolean;
}

export interface StripeSession {
  id: string;
  url?: string;
  mode?: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string;
  metadata?: Record<string, string>;
}

// Live keys are refused unless STRIPE_ALLOW_LIVE=1, so a test setup can't
// take real money by accident.
export function stripeKey(env: StripeEnv): string | null {
  const k = env.STRIPE_SECRET_KEY?.trim();
  if (!k) return null;
  if (/^(sk|rk)_test_/.test(k)) return k;
  if (/^(sk|rk)_live_/.test(k) && env.STRIPE_ALLOW_LIVE === "1") return k;
  return null;
}

export function sponsorHours(env: StripeEnv): number {
  const h = Number(env.SPONSOR_HOURS);
  return Number.isFinite(h) && h > 0 ? h : 24;
}

async function stripe<T>(env: StripeEnv, method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<T> {
  const key = stripeKey(env);
  if (!key) throw new Error("stripe not configured");
  const base = env.STRIPE_API_BASE?.trim() || "https://api.stripe.com";
  const r = await fetch(`${base}/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const j = (await r.json()) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message || `stripe ${path} ${r.status}`);
  return j;
}

export function createCheckout(env: StripeEnv, origin: string, room: string, tier: number, name: string, url?: string): Promise<StripeSession> {
  const form: Record<string, string> = {
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(tier * 100),
    "line_items[0][price_data][product_data][name]": `SNEK sponsor spot · $${tier}`,
    "line_items[0][price_data][product_data][description]":
      `Shows "${name}" in the sponsor section of the leaderboard for ${sponsorHours(env)} hours. Ranked by total paid; add quantity to climb.`,
    "line_items[0][quantity]": "1",
    "line_items[0][adjustable_quantity][enabled]": "true",
    "line_items[0][adjustable_quantity][minimum]": "1",
    "line_items[0][adjustable_quantity][maximum]": String(MAX_QTY),
    "metadata[sponsor_name]": name,
    success_url: `${origin}/sponsored?session_id={CHECKOUT_SESSION_ID}&room=${encodeURIComponent(room)}`,
    cancel_url: `${origin}/r/${encodeURIComponent(room)}`,
  };
  if (url) form["metadata[sponsor_url]"] = url;
  return stripe<StripeSession>(env, "POST", "checkout/sessions", form);
}

export function getSession(env: StripeEnv, id: string): Promise<StripeSession> {
  return stripe<StripeSession>(env, "GET", `checkout/sessions/${encodeURIComponent(id)}`);
}

export function isSessionId(id: string): boolean {
  return /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(id);
}

const enc = new TextEncoder();

// Verifies a Stripe-Signature header (t=...,v1=...) over the raw body.
export async function verifyWebhook(secret: string, payload: string, header: string, now = Date.now()): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${parts.t}.${payload}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && [...s].every((c, i) => c === expected[i]));
}

// Paid sponsorships within their window plus admin "house" entries; a name's
// purchases add up, highest total first.
export function board(spons: Sponsorship[], house: Sponsor[], now: number): Sponsor[] {
  const totals = new Map<string, Sponsor & { last: number }>();
  for (const s of spons) {
    if (s.removed || s.until <= now) continue;
    const key = s.name.toLowerCase();
    const cur = totals.get(key);
    if (cur) {
      cur.amount += s.amount;
      if (s.paidAt > cur.last) {
        cur.last = s.paidAt;
        if (s.url) cur.url = s.url;
      }
    } else {
      totals.set(key, { name: s.name, url: s.url, amount: s.amount, last: s.paidAt });
    }
  }
  const paid: Sponsor[] = [...totals.values()].map(({ name, url, amount }) => (url ? { name, url, amount } : { name, amount }));
  return [...paid, ...house].sort((a, b) => b.amount - a.amount).slice(0, SLOTS);
}
