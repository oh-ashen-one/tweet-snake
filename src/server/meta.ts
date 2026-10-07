// Single global Durable Object for state shared across rooms: the sponsor list
// and short-lived login hand-offs (nonce -> token).

import { DurableObject } from "cloudflare:workers";
import type { Sponsor } from "../shared/protocol";

const CLAIM_TTL_MS = 5 * 60e3;

export function cleanSponsors(raw: unknown): Sponsor[] | null {
  if (!Array.isArray(raw) || raw.length > 20) return null;
  const out: Sponsor[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const { name, url, amount } = r as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || typeof amount !== "number" || !(amount >= 0)) return null;
    const s: Sponsor = { name: name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24), amount };
    if (url !== undefined) {
      if (typeof url !== "string") return null;
      try {
        if (new URL(url).protocol !== "https:") return null;
      } catch {
        return null;
      }
      s.url = url.slice(0, 300);
    }
    out.push(s);
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export class Meta extends DurableObject {
  private claims = new Map<string, { token: string; at: number }>();

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/sponsors") {
      if (req.method === "PUT") {
        const list = cleanSponsors(await req.json().catch(() => null));
        if (!list) return new Response("bad sponsor list", { status: 400 });
        await this.ctx.storage.put("sponsors", list);
        return Response.json(list);
      }
      return Response.json((await this.ctx.storage.get<Sponsor[]>("sponsors")) ?? []);
    }

    if (url.pathname === "/claim") {
      const nonce = url.searchParams.get("n") || "";
      const now = Date.now();
      for (const [k, v] of this.claims) if (now - v.at > CLAIM_TTL_MS) this.claims.delete(k);
      if (req.method === "PUT") {
        const { token } = (await req.json()) as { token: string };
        this.claims.set(nonce, { token, at: now });
        return new Response("ok");
      }
      const c = this.claims.get(nonce);
      if (!c) return new Response(null, { status: 204 });
      this.claims.delete(nonce);
      return Response.json({ token: c.token });
    }

    return new Response("not found", { status: 404 });
  }
}
