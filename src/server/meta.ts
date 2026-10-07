// Single global Durable Object for state shared across rooms: admin "house"
// sponsor entries and paid Stripe sponsorships.

import { DurableObject } from "cloudflare:workers";
import { cleanDisplayName } from "../shared/names";
import type { Sponsor } from "../shared/protocol";
import { board, type StripeSession, type Sponsorship } from "./sponsorship";

export function cleanUrl(url: unknown): string | undefined | null {
  if (url === undefined || url === "") return undefined;
  if (typeof url !== "string" || url.length > 300) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function cleanSponsors(raw: unknown): Sponsor[] | null {
  if (!Array.isArray(raw) || raw.length > 20) return null;
  const out: Sponsor[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const { name, url, amount } = r as Record<string, unknown>;
    const clean = cleanDisplayName(name, 24);
    if (!clean || typeof amount !== "number" || !(amount >= 0)) return null;
    const s: Sponsor = { name: clean, amount };
    const u = cleanUrl(url);
    if (u === null) return null;
    if (u) s.url = u;
    out.push(s);
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export class Meta extends DurableObject {
  private async sponsors(): Promise<Sponsor[]> {
    const house = (await this.ctx.storage.get<Sponsor[]>("sponsors")) ?? [];
    const spons = [...(await this.ctx.storage.list<Sponsorship>({ prefix: "spon:" })).values()];
    return board(spons, house, Date.now());
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/sponsors") {
      if (req.method === "PUT") {
        const list = cleanSponsors(await req.json().catch(() => null));
        if (!list) return new Response("bad sponsor list", { status: 400 });
        await this.ctx.storage.put("sponsors", list);
        return Response.json(list);
      }
      return Response.json(await this.sponsors());
    }

    // Record a Checkout Session the worker fetched from Stripe. Idempotent:
    // the webhook and the success page may both report the same session.
    if (url.pathname === "/record" && req.method === "POST") {
      const { session, hours } = (await req.json()) as { session: StripeSession; hours: number };
      const key = `spon:${session.id}`;
      const existing = await this.ctx.storage.get<Sponsorship>(key);
      if (existing) return Response.json({ recorded: false, sponsorship: existing, board: await this.sponsors() });
      if (session.mode !== "payment" || session.payment_status !== "paid" || !session.amount_total) {
        return Response.json({ recorded: false, unpaid: true });
      }
      const now = Date.now();
      const sp: Sponsorship = {
        id: session.id,
        name: cleanDisplayName(session.metadata?.sponsor_name, 24) || "Anonymous sponsor",
        amount: session.amount_total / 100,
        paidAt: now,
        until: now + hours * 3600e3,
      };
      const u = cleanUrl(session.metadata?.sponsor_url);
      if (u) sp.url = u;
      await this.ctx.storage.put(key, sp);
      return Response.json({ recorded: true, sponsorship: sp, board: await this.sponsors() });
    }

    const m = url.pathname.match(/^\/sponsorships\/(cs_[A-Za-z0-9_]+)$/);
    if (m && req.method === "DELETE") {
      const key = `spon:${m[1]}`;
      const sp = await this.ctx.storage.get<Sponsorship>(key);
      if (!sp) return new Response("not found", { status: 404 });
      sp.removed = true;
      await this.ctx.storage.put(key, sp);
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }
}
