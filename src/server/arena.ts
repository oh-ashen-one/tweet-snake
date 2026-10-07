// One Durable Object per room. It owns the live World and ticks it while any
// socket is connected; with nobody watching it stops and can be evicted.

import { DurableObject } from "cloudflare:workers";
import type { Sponsor } from "../shared/protocol";
import { TICK_MS } from "../shared/rules";
import { verifyToken, type AuthEnv } from "./auth";
import type { Meta } from "./meta";
import { World, guestIdentity } from "./world";

export interface Env extends AuthEnv {
  ARENA: DurableObjectNamespace<Arena>;
  META: DurableObjectNamespace<Meta>;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
  SPONSOR_URL?: string;
}

const SPONSOR_REFRESH_MS = 30e3;

export class Arena extends DurableObject<Env> {
  private world: World | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private sponsorsAt = 0;

  async fetch(req: Request): Promise<Response> {
    const room = new URL(req.url).pathname.split("/").pop() || "main";
    if (req.headers.get("Upgrade") !== "websocket") {
      const w = this.world;
      return Response.json({ room, viewers: w ? w.clients.size : 0, playing: w ? w.humansPlaying : 0 });
    }
    this.world ??= new World(room);
    const world = this.world;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const cid = world.addClient((d) => {
      try {
        server.send(d);
      } catch {
        // Socket already closing; the close handler cleans up.
      }
    });
    server.addEventListener("message", (e) => {
      const data = e.data as string | ArrayBuffer;
      if (typeof data === "string" && data.startsWith("{")) {
        let m: { t?: string; token?: unknown; guest?: unknown; skin?: unknown; aspect?: unknown };
        try {
          m = JSON.parse(data);
        } catch {
          return;
        }
        if (m.t === "join") {
          verifyToken(this.env.SESSION_SECRET, m.token).then((id) =>
            world.join(cid, id ?? guestIdentity(m.guest), m.skin, m.aspect));
          return;
        }
        if (m.t === "auth") {
          verifyToken(this.env.SESSION_SECRET, m.token).then((id) => id && world.rename(cid, id));
          return;
        }
      }
      world.onMessage(cid, data);
    });
    const drop = () => {
      world.removeClient(cid);
      if (world.clients.size === 0) this.stop();
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);
    this.start();
    if (Date.now() - this.sponsorsAt > 5000) this.refreshSponsors();
    return new Response(null, { status: 101, webSocket: client });
  }

  private start(): void {
    if (this.timer) return;
    this.last = Date.now();
    this.acc = 0;
    this.timer = setInterval(() => this.loop(), TICK_MS / 2);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Fixed-step loop: the interval fires twice per tick so timer jitter never
  // drops a step, and catch-up is capped so a stall can't spiral.
  private loop(): void {
    const now = Date.now();
    this.acc += now - this.last;
    this.last = now;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 3) {
      this.world?.step();
      this.acc -= TICK_MS;
      steps++;
    }
    if (this.acc > TICK_MS * 3) this.acc = 0;
    if (now - this.sponsorsAt > SPONSOR_REFRESH_MS) this.refreshSponsors();
  }

  private refreshSponsors(): void {
    this.sponsorsAt = Date.now();
    const meta = this.env.META.get(this.env.META.idFromName("global"));
    meta.fetch("https://meta/sponsors")
      .then((r) => r.json() as Promise<Sponsor[]>)
      .then((list) => this.world?.setSponsors(list))
      .catch(() => {});
  }
}
