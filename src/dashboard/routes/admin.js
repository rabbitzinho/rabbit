// src/dashboard/routes/admin.js

const { sendServerError } = require("./_errors");
const { getGuild, getCachedChannel } = require("../../services/guildService");
const { isBotOwner } = require("../botRoles");

function registerAdminRoutes({
  app,
  express,
  requireDashboardAuth,
  requirePerm,
  requireGuildAccess,
  sanitizeId,
  rateLimit,
  fetchChannel,
  configManager,
  status,
  getClient,
  getTrustLabel,
  getEffectiveMaxMessages,
  getEffectiveMuteDuration,
  logger,
}) {
  const rlSelfTest = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: "rl:admin:selftest:",
  });
  const rlTestLogChannels = rateLimit({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "rl:admin:testlogs:",
  });

  const guardGuildBody =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "body", key: "guildId" })
      : (req, res, next) => next();

  const guardGuildParam =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "params", key: "guildId" })
      : (req, res, next) => next();

  const canRunSelfTest =
    typeof requirePerm === "function"
      ? requirePerm({
          anyOf: ["canViewConfig", "canManageUsers", "canEditConfig"],
        })
      : (req, res, next) => next();

  const canTestLogChannels =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canEditConfig"] })
      : (req, res, next) => next();

  // Dashboard-triggered self-test (no real punishments, only diagnostics)
  app.post(
    "/api/admin/selftest",
    requireDashboardAuth,
    canRunSelfTest,
    rlSelfTest,
    express.json(),
    guardGuildBody,
    async (req, res) => {
      try {
        const u = req.dashboardUser;
        const perms = (u && u.permissions) || {};
        const isAdmin = isBotOwner(u);

        if (!isAdmin && !perms.canViewConfig && !perms.canManageUsers) {
          return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
        }

        const client = typeof getClient === "function" ? getClient() : null;
        if (!client) {
          return res
            .status(503)
            .json({ ok: false, error: "Bot client not ready" });
        }

        const body = req.body || {};
        const guildId = sanitizeId(String(body.guildId || "").trim());
        const channelId = String(body.channelId || "").trim();

        if (!guildId || !channelId) {
          return res.status(400).json({ ok: false, error: "MISSING_TARGET" });
        }

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          return res.status(404).json({ ok: false, error: "GUILD_NOT_FOUND" });
        }

        const channel = await fetchChannel(client, channelId);
        if (!channel || !channel.isTextBased?.()) {
          return res.status(400).json({ ok: false, error: "CHANNEL_NOT_TEXT" });
        }

        const cfg = configManager.getPublicConfig();
        const automation = cfg.automation || {};
        const autoMute = automation.autoMute || {};
        const antiSpamCfg = cfg.antiSpam || {};
        const trustCfg =
          await require("../../utils/trust").getGuildTrustConfig(guildId);
        const gameNewsCfg = cfg.gameNews || {};

        const st =
          typeof status.getStatus === "function" ? status.getStatus() : {};

        const baseMaxMessages = antiSpamCfg.maxMessages ?? 5;
        const baseMuteMs = antiSpamCfg.muteDurationMs ?? 30 * 60 * 1000;

        const lowTrust = trustCfg.lowThreshold;
        const highTrust = trustCfg.highThreshold;
        const baseTrust = trustCfg.base;

        const lowTrustMaxMsgs = getEffectiveMaxMessages(
          baseMaxMessages,
          trustCfg,
          lowTrust,
        );
        const highTrustMaxMsgs = getEffectiveMaxMessages(
          baseMaxMessages,
          trustCfg,
          highTrust,
        );
        const lowTrustMuteMs = getEffectiveMuteDuration(
          baseMuteMs,
          trustCfg,
          lowTrust,
        );
        const highTrustMuteMs = getEffectiveMuteDuration(
          baseMuteMs,
          trustCfg,
          highTrust,
        );

        const lines = [];
        lines.push("### 🧪 Self-test do bot de moderação");
        lines.push("");
        lines.push(`- Discord: **${st.discordReady ? "online" : "offline"}**`);
        lines.push(
          `- MongoDB: **${st.mongoConnected ? "ligado" : "desligado"}**`,
        );
        lines.push(
          `- GameNews: **${st.gameNewsRunning && gameNewsCfg.enabled !== false ? "ativo" : "inativo"}**`,
        );
        lines.push("");
        lines.push("**Moderação automática**");
        lines.push(
          `- Anti-spam: **${antiSpamCfg.enabled === false ? "desativado" : "ativado"}**`,
        );
        lines.push(
          `- Sistema de confiança (Trust): **${trustCfg.enabled === false ? "desativado" : "ativado"}**`,
        );
        lines.push(
          `- Auto-mute (base): **${autoMute.enabled ? "ativado" : "desativado"}** (dur. base ➜ ${Math.round(baseMuteMs / 60000)} min)`,
        );
        lines.push("");
        lines.push("**Simulação Trust / Anti-spam**");
        lines.push(
          `- Trust base: **${baseTrust}** (${getTrustLabel(baseTrust, trustCfg)})`,
        );
        lines.push(
          `- Utilizador de baixo trust (${lowTrust}) teria limite de **${lowTrustMaxMsgs} msgs / ${Math.round(lowTrustMuteMs / 60000)} min** de mute.`,
        );
        lines.push(
          `- Utilizador de alto trust (${highTrust}) teria limite de **${highTrustMaxMsgs} msgs / ${Math.round(highTrustMuteMs / 60000)} min** de mute.`,
        );
        lines.push("");
        lines.push(
          "> Este teste não aplica ações reais em utilizadores. Apenas valida o estado da ligação, da configuração e da lógica de Trust/Anti-spam.",
        );

        await channel.send({ content: lines.join("\n") }).catch(() => null);

        try {
          await logger(
            client,
            "Dashboard self-test",
            null,
            null,
            "Dashboard self-test executado a partir da dashboard (sem ações reais em utilizadores).",
            guild,
          );
        } catch (e) {
          console.error("[Dashboard] Failed to log self-test:", e);
        }

        return res.json({ ok: true });
      } catch (err) {
        return sendServerError(res, "/api/admin/selftest", err);
      }
    },
  );

  // Test helper for log channels
  app.post(
    "/api/guilds/:guildId/test-log-channels",
    requireDashboardAuth,
    canTestLogChannels,
    guardGuildParam,
    rlTestLogChannels,
    express.json(),
    async (req, res) => {
      try {
        const client = typeof getClient === "function" ? getClient() : null;
        if (!client)
          return res
            .status(503)
            .json({ ok: false, error: "Bot client not ready" });

        const guildId = sanitizeId(
          (req.params.guildId || "").toString().trim(),
        );
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        const guild = getGuild(client, guildId);
        if (!guild)
          return res.status(404).json({ ok: false, error: "Guild not found" });

        const logChannelId = (req.body?.logChannelId || "").toString().trim();
        const dashboardLogChannelId = (req.body?.dashboardLogChannelId || "")
          .toString()
          .trim();

        const results = [];

        async function trySend(channelId, label) {
          if (!channelId) {
            results.push({
              label,
              channelId: null,
              ok: false,
              error: "No channel selected",
            });
            return;
          }
          const ch = getCachedChannel(client, guildId, channelId);
          if (!ch || !ch.isTextBased?.()) {
            results.push({
              label,
              channelId,
              ok: false,
              error: "Channel not found or not text-based",
            });
            return;
          }

          try {
            await ch.send(
              `✅ [TESTE] Mensagem de teste do dashboard para **${label}**. Se estás a ver isto, está tudo OK.`,
            );
            results.push({ label, channelId, ok: true });
          } catch (err) {
            results.push({
              label,
              channelId,
              ok: false,
              error: String(err?.message || err),
            });
          }
        }

        await trySend(logChannelId, "Canal de logs do bot");
        await trySend(dashboardLogChannelId, "Canal de logs do dashboard");

        return res.json({ ok: true, results });
      } catch (err) {
        return sendServerError(res, "test-log-channels", err);
      }
    },
  );
}

module.exports = { registerAdminRoutes };
