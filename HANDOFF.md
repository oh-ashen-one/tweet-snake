# Handoff: SNEK (multiplayer snake in an X post)

Updated 2026-10-07. Branch: `claude/snake-io-prototype` (public repo oh-ashen-one/tweet-snake).
Live: https://tweet-snake.notashenone.workers.dev (Cloudflare Worker `tweet-snake`).

## Verified state
- `npm run check` clean. `npm run test:sim` PASS (body/food sync exact, tick p99 well under 1 ms).
- `npm run test:e2e` PASS locally and against production (`BASE=https://... npm run test:e2e`, with `ADMIN_TOKEN` loaded from `~/.config/tweet-snake/secrets.env`).
  - Covers card meta, names, real steering input, rename, leaderboard and sponsors.
- Fixed: binary steering frames crashed rooms (normalised in `arena.ts`; `world.onMessage` reads via Uint8Array).
- Gameplay feel and phones: the owner is testing these himself.

## Decisions
- No accounts: players tap their name to set it (stored on their device). A leading @ is stripped and a small slur filter falls back to guest####.
- Sponsors (owner's spec, 2026-10-07): Stripe Checkout at $500 / $300 / $100 with adjustable quantity. Spots last **7 days** and the board ranks by total paid (same-name buys add up).
  - **LIVE since 2026-10-07** on the Ashen AI Stripe account (`acct_1Sv0yHLsHHGBvJwu`, statement "ASHEN AI"), approved by the owner.
  - The key is a restricted live key: in `~/.config/tweet-snake/secrets.env`, and set on the Worker with `STRIPE_ALLOW_LIVE=1`. Without that flag the server refuses live keys.
  - Crypto bidding was built, then dropped at the owner's request. Don't re-add it unasked.
  - Admin: `PUT /api/admin/sponsors` (house entries), `DELETE /api/admin/sponsorships/:cs_id` (moderation).
  - Tested: `npm run test:unit` and `npm run test:sponsor` against `scripts/mock-stripe.mjs` (the latter failed once out of 5 runs, just after a cold restart; not reproduced since).
- New players start on autopilot with a 2.5 s shield until their first input.

## Next
- To try real Stripe test checkout: create a Stripe account (test mode), then `wrangler secret put STRIPE_SECRET_KEY` (sk_test_…) and redeploy.
  - Optionally add a webhook endpoint `https://<host>/api/stripe/webhook` for `checkout.session.completed` and `wrangler secret put STRIPE_WEBHOOK_SECRET`. Without it, payments still record when the buyer reaches the success page.
- Owner playtest feedback.
- Optional: a custom domain (the workers.dev URL contains the account name), a real card image, sound.
