# Koyeb deployment

Recommended environment variables:

- `NODE_ENV=production`
- `DISCORD_TOKEN=...`
- `MONGO_URI=...`

Dashboard auth (Discord OAuth 2.0):

- `DASHBOARD_JWT_SECRET=...` (strong random)
- `DISCORD_OAUTH_CLIENT_ID=...`
- `DISCORD_OAUTH_CLIENT_SECRET=...`
- `BOT_OWNER_IDS=...` (optional additional Discord user IDs separated by commas, semicolons, or whitespace; these are bot/application owners and can change global Premium pricing/settings)
- Discord user `810243963574550558` is the default bot owner. `BOT_OWNER_IDS` may override it with one trusted owner ID. The owner has global dashboard access but can manage a server only if they are also its Discord owner or Administrator.
- Use the Discord **user ID** of the person authorized to own the bot application in the Developer Portal, not the application/client ID or a Discord server owner ID. For a team-owned application, list only the people explicitly trusted with global control.
- After changing either ID list, restart the app and sign out/in to refresh dashboard roles; existing sessions can retain their role for up to four hours.
- Bot owners/admins can open the **Premium management** tab without selecting a Discord server. It lists server licenses and a paginated payment history; Premium modules still require an active license even for bot operators.
- `DASHBOARD_ORIGIN=https://<your-koyeb-domain>` (required for the dashboard UI)
- Register the redirect URI in the Discord Developer Portal: `https://<your-koyeb-domain>/api/auth/discord/callback`

PayPal Premium:

- `PAYPAL_CLIENT_ID=...`
- `PAYPAL_CLIENT_SECRET=...`
- `PAYPAL_ENV=sandbox` while testing, then `live` for real payments
- `PREMIUM_DURATION_DAYS=30`
- `PAYPAL_WEBHOOK_ID=...`
- Register `https://<your-koyeb-domain>/api/premium/paypal/webhook` in PayPal for the `PAYMENT.CAPTURE.COMPLETED` event.

Premium checkout is fixed at €10 per server; only the license duration and optional PayPal.Me reference link are configurable in the dashboard. A reference link is prefilled for €10 and requires manual payment verification. The app captures successful orders server-to-server and also verifies PayPal webhook signatures. Keep the client secret and webhook ID private; use sandbox credentials and a sandbox webhook before switching to live mode.

Optional:

- `DASHBOARD_ALLOW_ANY_ORIGIN=true` (NOT recommended; bypasses CORS hardening)
- `TWITCH_CLIENT_ID=...` and `TWITCH_CLIENT_SECRET=...` (required only for Twitch live alerts; store both as Koyeb secrets, not in per-server dashboard config)
