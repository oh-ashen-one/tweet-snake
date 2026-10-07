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
- Sponsors: an admin-managed list only (`PUT /api/admin/sponsors`, Bearer `ADMIN_TOKEN`). Crypto bidding was built, then dropped at the owner's request (2026-10-07). Don't re-add it unasked.
- New players start on autopilot with a 2.5 s shield until their first input.

## Next
- Owner playtest feedback.
- Optional: a custom domain (the workers.dev URL contains the account name), a real card image, sound.
