// Routes:
//   /                   game page for the default room (also an X player card)
//   /r/:room            shareable link: player-card meta for X, playable for humans
//   /play/:room         the page X loads inside the tweet iframe
//   /ws/:room           WebSocket into the room's Durable Object
//   /api/room/:room     live counts
//   /api/sponsors       current sponsor list
//   /api/admin/sponsors PUT the sponsor list (Bearer ADMIN_TOKEN)

import { Arena, type Env } from "./arena";
import { Meta } from "./meta";
import { TITLE } from "../shared/rules";

export { Arena, Meta };

const ROOM_RE = /^[a-z0-9-]{1,32}$/;

const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://x.com https://*.x.com https://twitter.com https://*.twitter.com";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(origin: string, room: string, embed: boolean, env: Env): string {
  const shareUrl = `${origin}/r/${room}`;
  const playerUrl = `${origin}/play/${room}`;
  const title = room === "main" ? TITLE : `${TITLE} · ${room}`;
  const desc = "Live multiplayer snake inside the tweet. Tap and you're in, playing everyone else right now.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0b0d14">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="twitter:card" content="player">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${origin}/card.png">
<meta name="twitter:player" content="${playerUrl}">
<meta name="twitter:player:width" content="480">
<meta name="twitter:player:height" content="480">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${origin}/card.png">
<meta property="og:url" content="${shareUrl}">
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/style.css">
</head>
<body data-room="${esc(room)}" data-embed="${embed ? 1 : 0}" data-sponsor-url="${esc(env.SPONSOR_URL || "")}">
<canvas id="gl"></canvas>
<canvas id="hud"></canvas>
<div id="ui"></div>
<script type="module" src="/game.js"></script>
</body>
</html>`;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": FRAME_ANCESTORS,
      "cache-control": "public, max-age=60",
    },
  });
}

function meta(env: Env) {
  return env.META.get(env.META.idFromName("global"));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const [head, second] = parts;

    if (parts.length === 0) return html(page(url.origin, "main", false, env));

    if (head === "r" || head === "play" || head === "ws") {
      const room = (second || "").toLowerCase();
      if (parts.length !== 2 || !ROOM_RE.test(room)) return new Response("bad room", { status: 400 });
      if (head === "ws") return env.ARENA.get(env.ARENA.idFromName(room)).fetch(req);
      return html(page(url.origin, room, head === "play", env));
    }

    if (head === "api") {
      if (second === "room" && parts[2] && ROOM_RE.test(parts[2])) {
        return env.ARENA.get(env.ARENA.idFromName(parts[2])).fetch(new Request(`${url.origin}/room/${parts[2]}`));
      }
      if (second === "sponsors") return meta(env).fetch("https://meta/sponsors");
      if (second === "admin" && parts[2] === "sponsors" && req.method === "PUT") {
        if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
          return new Response("unauthorized", { status: 401 });
        }
        return meta(env).fetch("https://meta/sponsors", { method: "PUT", body: await req.text() });
      }
      return new Response("not found", { status: 404 });
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
