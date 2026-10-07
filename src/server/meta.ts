// Single global Durable Object for state shared across rooms (the sponsor list).

import { DurableObject } from "cloudflare:workers";
import type { Sponsor } from "../shared/protocol";

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

    return new Response("not found", { status: 404 });
  }
}
