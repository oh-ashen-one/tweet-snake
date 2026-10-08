// Routes:
//   /                   game page for the default room (also an X player card)
//   /r/:room            shareable link: player-card meta for X, playable for humans
//   /play/:room         the page X loads inside the tweet iframe
//   /ws/:room           WebSocket into the room's Durable Object
//   /api/room/:room     live counts
//   /api/sponsors       current sponsor board (paid + house entries)
//   /api/sponsor/checkout  POST {tier,name,url?,room} -> Stripe Checkout URL
//   /sponsored          Stripe success page: records the payment, shows the result
//   /api/stripe/webhook Stripe webhook (checkout.session.completed)
//   /api/admin/sponsors PUT house sponsor entries (Bearer ADMIN_TOKEN)
//   /api/admin/sponsorships/:id  DELETE a paid sponsorship (moderation)

import { Arena, type Env } from "./arena";
import { Meta, cleanUrl } from "./meta";
import { cleanDisplayName } from "../shared/names";
import { spanText } from "../shared/format";
import { TIERS, createCheckout, getSession, isSessionId, sponsorHours, stripeKey, verifyWebhook, type StripeSession } from "./sponsorship";
import { TITLE } from "../shared/rules";

export { Arena, Meta };

const ROOM_RE = /^[a-z0-9-]{1,32}$/;

// Bump when public/card.png changes; X caches preview images by URL.
const CARD_VERSION = 2;

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
<meta name="twitter:image" content="${origin}/card.png?v=${CARD_VERSION}">
<meta name="twitter:player" content="${playerUrl}">
<meta name="twitter:player:width" content="480">
<meta name="twitter:player:height" content="480">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${origin}/card.png?v=${CARD_VERSION}">
<meta property="og:url" content="${shareUrl}">
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/style.css">
</head>
<body data-room="${esc(room)}" data-embed="${embed ? 1 : 0}" data-sponsor="${stripeKey(env) ? `${TIERS.join(",")}:${sponsorHours(env)}:${/_test_/.test(env.STRIPE_SECRET_KEY || "") ? "test" : "live"}` : ""}">
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

async function record(env: Env, session: StripeSession): Promise<{ recorded: boolean; unpaid?: boolean; sponsorship?: { name: string; amount: number }; board?: { name: string }[] }> {
  const r = await meta(env).fetch("https://meta/record", {
    method: "POST",
    body: JSON.stringify({ session, hours: sponsorHours(env) }),
  });
  return r.json();
}

function infoPage(title: string, body: string, room: string): Response {
  const back = `/r/${encodeURIComponent(room)}`;
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/style.css">
<body class="info"><div class="card"><div class="dt">${esc(title)}</div><p class="info-p">${esc(body)}</p>
<a class="play wallet" href="${back}">Back to the game</a></div></body>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function checkout(req: Request, env: Env, origin: string): Promise<Response> {
  if (!stripeKey(env)) return Response.json({ error: "Sponsor spots aren't open yet." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { tier?: unknown; name?: unknown; url?: unknown; room?: unknown } | null;
  const tier = Number(body?.tier);
  if (!(TIERS as readonly number[]).includes(tier)) return Response.json({ error: "Pick a sponsor tier." }, { status: 400 });
  const name = cleanDisplayName(body?.name, 24);
  if (!name) return Response.json({ error: "Enter the name to show." }, { status: 400 });
  const url = cleanUrl(body?.url);
  if (url === null) return Response.json({ error: "Links must start with https://" }, { status: 400 });
  const room = typeof body?.room === "string" && ROOM_RE.test(body.room) ? body.room : "main";
  try {
    const s = await createCheckout(env, origin, room, tier, name, url);
    return Response.json({ url: s.url });
  } catch (e) {
    console.error("checkout failed", e);
    return Response.json({ error: "Couldn't start checkout, try again." }, { status: 502 });
  }
}

async function sponsored(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get("session_id") || "";
  const room = ROOM_RE.test(url.searchParams.get("room") || "") ? url.searchParams.get("room")! : "main";
  if (!stripeKey(env) || !isSessionId(id)) return infoPage("Hmm", "That sponsor link isn't valid.", room);
  try {
    const r = await record(env, await getSession(env, id));
    if (r.unpaid) return infoPage("Payment pending", "Stripe hasn't confirmed this payment yet. Your spot appears as soon as it does.", room);
    const sp = r.sponsorship!;
    const rank = (r.board ?? []).findIndex((s) => s.name.toLowerCase() === sp.name.toLowerCase()) + 1;
    const where = rank === 1 ? "the 👑 top spot" : rank > 0 ? `#${rank}` : "the sponsor list";
    return infoPage("You're on the board 🎉", `Thanks! ${sp.name} now holds ${where} on the SNEK leaderboard for the next ${spanText(sponsorHours(env))}.`, room);
  } catch (e) {
    console.error("sponsored lookup failed", e);
    return infoPage("One moment", "We couldn't confirm the payment right now. If you paid, your spot will appear shortly.", room);
  }
}

async function webhook(req: Request, env: Env): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  const payload = await req.text();
  if (!secret || !stripeKey(env) || !(await verifyWebhook(secret, payload, req.headers.get("stripe-signature") || ""))) {
    return new Response("bad signature", { status: 400 });
  }
  const event = JSON.parse(payload) as { type?: string; data?: { object?: { id?: string } } };
  const id = event.data?.object?.id || "";
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && isSessionId(id)) {
    // Re-fetch rather than trusting the payload beyond the id.
    await record(env, await getSession(env, id));
  }
  return new Response("ok");
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

    if (head === "sponsored" && parts.length === 1) return sponsored(url, env);

    if (head === "api") {
      if (second === "sponsor" && parts[2] === "checkout" && req.method === "POST") return checkout(req, env, url.origin);
      if (second === "stripe" && parts[2] === "webhook" && req.method === "POST") return webhook(req, env);
      if (second === "room" && parts[2] && ROOM_RE.test(parts[2])) {
        return env.ARENA.get(env.ARENA.idFromName(parts[2])).fetch(new Request(`${url.origin}/room/${parts[2]}`));
      }
      if (second === "sponsors") return meta(env).fetch("https://meta/sponsors");
      if (second === "admin") {
        if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
          return new Response("unauthorized", { status: 401 });
        }
        if (parts[2] === "sponsors" && req.method === "PUT") {
          return meta(env).fetch("https://meta/sponsors", { method: "PUT", body: await req.text() });
        }
        if (parts[2] === "sponsorships" && parts[3] && isSessionId(parts[3]) && req.method === "DELETE") {
          return meta(env).fetch(`https://meta/sponsorships/${parts[3]}`, { method: "DELETE" });
        }
        return new Response("not found", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
