# Security notes (.rabbit)

This repository ships with a built-in dashboard (Express + JWT auth). To run it safely in production:

1. Set a strong JWT secret:
   - `DASHBOARD_JWT_SECRET` (>= 32 random chars)

2. Configure CORS explicitly (required in production):
   - `DASHBOARD_ORIGIN=https://<your-domain>`
   - or `dashboard.allowedOrigins` in `src/config/defaultConfig.js`

   If you do not configure CORS, the server will refuse cross-origin requests in production.
   This is intentional hardening.

3. Dashboard login is exclusively via Discord OAuth 2.0.
   - Configure `DISCORD_OAUTH_CLIENT_ID` and `DISCORD_OAUTH_CLIENT_SECRET`.
   - The OAuth callback issues a session JWT stored in an HttpOnly cookie; there is no local password login.
   - `dashboard.requireAuth=false` is ignored in production; auth bypass is development-only.

4. Global and guild access are separate:
   - The bot owner can access global bot configuration, metrics, and Premium/payment administration.
   - The owner can manage a server only when Discord OAuth confirms they own it or have the Administrator permission there.
   - The owner may see the bot's installed-server inventory, but installations outside their own/admin guilds are read-only and cannot be selected for management.
   - Other users' tokens carry only the guilds where Discord OAuth confirms owner/Administrator access; requests to any other guild are rejected.
   - `BOT_OWNER_IDS` is limited to one ID (the first valid entry); if unset, the built-in primary owner is used.

5. Rate limiting:
   - Baseline limiter is applied on `/api` plus stricter per-endpoint limiters on auth/mod actions.
