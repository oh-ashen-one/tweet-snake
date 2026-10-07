# Handoff: SNEK (multiplayer snake in an X post)

Updated 2026-10-06. Branch: `claude/snake-io-prototype` (pushed to GitHub, public).

## Verified state
- `npm run check`: clean (client and worker tsconfigs).
- `npm run test:sim`: PASS.
  - 120 simulated seconds, tick p99 ≈ 0.3 ms, 21 snakes, about 95 kill-feed events.
  - Client/server body drift 0; food ghosts 0, food missing 0; about 2.2 KiB/s per client.
- `npm run test:e2e` against `wrangler dev`: PASS, 18 checks.
  - Covers card meta, CSP, dev login nonce hand-off, verified, guest and forged-token joins, about 20 ticks/s, the leaderboard, admin auth, sponsor validation, ordering and delivery.
- Checked by eye in Chrome (local mock post at tweet size, plus full page):
  - Instant auto-join, autopilot until first input, steer hint.
  - Leaderboard pill expands with the sponsor section.
  - Death card with the expanded board, share button and tap-to-respawn.
  - Sign in (dev) renames the live snake to @handle.
- Not verified yet: real phones (touch joystick, boost button), a real X embed, real Sign in with X (needs an X developer app), and a Cloudflare deploy.

## Layout
- `src/server/world.ts` simulation (transport-agnostic) · `bots.ts` bot and autopilot brain · `arena.ts` room DO · `meta.ts` global DO (sponsors and login claims) · `auth.ts` X OAuth and session tokens · `index.ts` routes.
- `src/shared/rules.ts` tuning shared by both sides · `protocol.ts` wire format.
- `src/client/*`: `state.ts` decode, `render.ts` WebGL2, `main.ts` loop, `ui.ts` DOM, `hud.ts` canvas HUD, `input.ts`, `net.ts`, `login.ts`.
- Debug handle: `window.__snek` (net, state, input, ui).

## Next steps
1. Deploy to Cloudflare (`npm run deploy`) on a domain, then post the `/r/main` link from a throwaway X account to confirm X renders the player iframe for a new domain. **Needs owner approval** (account and spend).
2. Create an X developer app with callback `https://<domain>/auth/x/callback` and set `X_CLIENT_ID`, `X_CLIENT_SECRET` and `SESSION_SECRET` with `wrangler secret put`. Confirm the app's API tier allows `GET /2/users/me`.
3. Sponsors: decide payment (for example a Stripe Payment Link in `SPONSOR_URL`), then add paid sponsors with `PUT /api/admin/sponsors` (Bearer `ADMIN_TOKEN`). Approval is manual, which doubles as moderation.
4. Test on real phones inside the X app.
5. Polish: a real card image (current `public/card.png` is a gameplay screenshot), sound, a pfp texture on the snake head, overflow rooms when a room hits `MAX_HUMANS`.

## Known limits
- Login claims live in Meta DO memory (5-minute TTL); an eviction mid-login means trying again.
- Rooms re-read sponsors on connect (at most every 5 s) and every 30 s.
- `DEV_LOGIN=1` mints tokens for any handle. Local only; never set it in production.
