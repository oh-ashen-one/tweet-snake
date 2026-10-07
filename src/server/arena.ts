// One Durable Object per room. It owns the live World and ticks it while any
// socket is connected; with nobody watching it stops and can be evicted.

import { DurableObject } from "cloudflare:workers";
import type { Sponsor } from "../shared/protocol";
import { TICK_MS } from "../shared/rules";
import type { Meta } from "./meta";
import type { StripeEnv } from "./sponsorship";
import { World, playerName } from "./world";

export interface Env extends StripeEnv {
  ARENA: DurableObjectNamespace<Arena>;
  META: DurableObjectNamespace<Meta>;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
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
      try {
        this.onSocketMessage(world, cid, e.data);
      } catch (err) {
        console.error("message handler failed", err);
      }
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

  // Binary frames can arrive as ArrayBuffer or a typed-array view depending on
  // the runtime; normalise before the world reads them.
  private onSocketMessage(world: World, cid: number, raw: unknown): void {
    let data: string | ArrayBuffer;
    if (typeof raw === "string") data = raw;
    else if (raw instanceof ArrayBuffer) data = raw;
    else if (ArrayBuffer.isView(raw)) data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer;
    else return;

    if (typeof data === "string" && data.startsWith("{")) {
      let m: { t?: string; name?: unknown; guest?: unknown; skin?: unknown; aspect?: unknown };
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (m.t === "join") return world.join(cid, playerName(m.name, m.guest), m.skin, m.aspect);
      if (m.t === "name") return world.rename(cid, playerName(m.name, m.guest));
    }
    world.onMessage(cid, data);
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
      try {
        this.world?.step();
      } catch (err) {
        console.error("tick failed", err);
      }
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
