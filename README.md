# SNEK: multiplayer snake inside a tweet

> **This is just a fun experiment.** I saw someone put a playable game inside a post on X and wanted to see how it works and how cool it could get. It isn't a business, it isn't affiliated with or endorsed by X Corp. or the makers of any other snake game, and it isn't trying to get around anyone's rules. If X asks for embeds like this to come down, they come down.

A slither-style multiplayer snake game that plays inside an X (Twitter) post. Click the post and you're straight in, playing everyone else who opened it. There's no menu, no install and no account needed.

![gameplay](public/card.png)

## How it works

- **The embed** is a standard X [player card](https://developer.x.com/en/docs/x-for-websites/cards/overview/player-card). The share link (`/r/<room>`) carries `twitter:card=player` meta tags that point at `/play/<room>`, which X loads in an iframe. The page sends `frame-ancestors` so only X (and the site itself) can frame it.
- **The server** is one Cloudflare Worker plus a Durable Object per room. The room object runs the authoritative simulation at 20 ticks/s: movement, collisions, food and bots.
- **The wire protocol** is compact binary over a WebSocket. A client only receives the snakes and food near its own view, so it uses about 2 KiB/s. The client rebuilds every snake body from head positions using the same spacing rule as the server.
- **The client** is about 27 KB of TypeScript with no framework. WebGL2 instanced rendering handles segments, food, glows and the hex floor, and a canvas/DOM overlay handles the HUD.
- **First seconds:** your snake spawns on autopilot with a short shield, so the embed is already playing the moment it opens. Your first mouse move or touch takes over. Bots keep quiet rooms busy.
- **Names:** you play as `guest####` by default. **Sign in with X** (optional, in a popup) shows your @handle and profile picture instead. It's an OAuth 2.0 + PKCE login that only reads your public profile, and the server signs its own short session token. Nothing else about you is stored.
- **Leaderboard:** top snakes by length, plus a sponsor section managed through an admin endpoint. It collapses to a small pill and opens when you tap it or die.

## Controls

| | Steer | Boost (costs length) |
|---|---|---|
| Desktop | move the mouse (or A/D, ←/→) | hold click / space |
| Phone | drag anywhere (floating joystick) | second finger or the BOOST button |

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # local-only secrets, never committed
npm run dev                      # builds the client, starts wrangler on 127.0.0.1:8787
```

- `http://127.0.0.1:8787/` opens the game full-page.
- `http://127.0.0.1:8787/dev-embed.html` shows it inside a mock post at tweet size.

## Tests

```bash
npm run check      # TypeScript, client and worker
npm run test:sim   # 2 simulated minutes: perf, collisions, growth, client/server sync
npm run test:e2e   # against a running server: card meta, login hand-off, joins, sponsors
```

## Configuration

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | HMAC key for player session tokens (required for sign-in) |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X developer app for Sign in with X; leave unset to hide the button |
| `ADMIN_TOKEN` | Bearer token for `PUT /api/admin/sponsors` |
| `SPONSOR_URL` | Optional link behind "Your name here →" on the leaderboard |
| `DEV_LOGIN` | `1` enables a fake login for local testing only; never set it in production |

Set production values with `wrangler secret put <NAME>`.

## Notes

- X's player-card guidelines are written with video and audio in mind, and X decides what gets embedded. Treat this as an experiment that could stop working at any time.
- All art is drawn procedurally in shaders. There are no third-party game assets.
