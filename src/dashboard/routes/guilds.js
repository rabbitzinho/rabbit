// src/dashboard/routes/guilds.js

const { sendServerError } = require("./_errors");
const { ChannelType } = require("discord.js");
const { getGuild, getCachedChannel } = require("../../services/guildService");
const { isBotOwner, isGuildAdministrator } = require("../botRoles");

/**
 * Guild-related routes used by the dashboard UI:
 * - list guilds
 * - guild meta (channels + roles)
 * - text channels
 */
function registerGuildsRoutes({
  app,
  requireDashboardAuth,
  requireGuildAccess,
  getClient,
  sanitizeId,
}) {
  // List guilds
  app.get("/api/guilds", requireDashboardAuth, async (req, res) => {
    try {
      const _client = getClient();
      const u = req.dashboardUser;
      const clientGuilds =
        _client && _client.guilds && _client.guilds.cache
          ? _client.guilds.cache
          : null;
      const signedGuildIds = new Set(
        Array.isArray(u && u.allowedGuildIds)
          ? u.allowedGuildIds.map(String)
          : [],
      );
      const manageableIds = new Set(
        Array.isArray(u && u.allowedGuilds)
          ? u.allowedGuilds
              .filter(
                (guild) =>
                  guild &&
                  signedGuildIds.has(String(guild.id)) &&
                  isGuildAdministrator(guild) &&
                  guild.botPresent !== false,
              )
              .map((guild) => String(guild.id))
          : u && u.oauth
            ? []
            : Array.from(signedGuildIds),
      );

      if (u && u.oauth && manageableIds.size === 0 && !isBotOwner(u)) {
        return res.json({ ok: true, items: [], reason: "NO_ELIGIBLE_GUILDS" });
      }

      const inventory = isBotOwner(u)
        ? Array.isArray(u.botGuildInventory) && u.botGuildInventory.length
          ? u.botGuildInventory
          : clientGuilds
            ? Array.from(clientGuilds.values()).map((guild) => ({
                id: guild.id,
                name: guild.name,
                icon: guild.icon || null,
                memberCount: guild.memberCount || null,
              }))
            : []
        : Array.isArray(u && u.allowedGuilds)
          ? u.allowedGuilds.filter(
              (guild) =>
                guild &&
                guild.id &&
                manageableIds.has(String(guild.id)) &&
                isGuildAdministrator(guild) &&
                guild.botPresent !== false,
            )
          : Array.from(manageableIds).map((id) => ({ id }));

      const items = inventory.map((g) => {
        const cg = clientGuilds ? clientGuilds.get(String(g.id)) : null;
        return {
          id: String(g.id),
          name:
            cg && cg.name
              ? cg.name
              : typeof g.name === "string"
                ? g.name
                : String(g.id),
          icon: typeof g.icon === "string" ? g.icon : null,
          botPresent: !!cg || (isBotOwner(u) && g.botPresent !== false),
          manageable: manageableIds.has(String(g.id)),
          memberCount:
            cg && typeof cg.memberCount === "number"
              ? cg.memberCount
              : cg && typeof cg.approximateMemberCount === "number"
                ? cg.approximateMemberCount
                : null,
        };
      });
      items.sort((a, b) => {
        if (a.manageable !== b.manageable) return a.manageable ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return res.json({ ok: true, items });
    } catch (err) {
      return sendServerError(res, "/api/guilds", err);
    }
  });

  // Guild metadata for dashboard UI (channels + roles)
  const guardGuildParam =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "params", key: "guildId" })
      : (req, res, next) => next();

  app.get(
    "/api/guilds/:guildId/meta",
    requireDashboardAuth,
    guardGuildParam,
    async (req, res) => {
      try {
        const _client = getClient();
        if (!_client) return res.json({ ok: true, channels: [], roles: [] });

        const guildId = sanitizeId(req.params.guildId);
        const guild = getGuild(_client, guildId);
        if (!guild)
          return res.status(404).json({ ok: false, error: "Guild not found" });

        const channels =
          guild.channels?.cache
            ?.filter(
              (c) =>
                c &&
                (c.type === ChannelType.GuildText ||
                  c.type === ChannelType.GuildAnnouncement),
            )
            .map((c) => ({ id: c.id, name: c.name, type: c.type }))
            .sort((a, b) => a.name.localeCompare(b.name)) || [];

        const voiceChannels =
          guild.channels?.cache
            ?.filter(
              (c) =>
                c &&
                (c.type === ChannelType.GuildVoice ||
                  c.type === ChannelType.GuildStageVoice),
            )
            .map((c) => ({ id: c.id, name: c.name, type: c.type }))
            .sort((a, b) => a.name.localeCompare(b.name)) || [];

        const categories =
          guild.channels?.cache
            ?.filter((c) => c && c.type === ChannelType.GuildCategory)
            .map((c) => ({ id: c.id, name: c.name, type: c.type }))
            .sort((a, b) => a.name.localeCompare(b.name)) || [];

        const roles =
          guild.roles?.cache
            ?.filter((r) => r && r.id !== guild.id && !r.managed)
            .map((r) => ({ id: r.id, name: r.name, position: r.position }))
            .sort((a, b) => b.position - a.position) || [];

        return res.json({
          ok: true,
          channels,
          roles,
          voiceChannels,
          categories,
        });
      } catch (err) {
        return sendServerError(res, "/api/guilds/:guildId/meta", err);
      }
    },
  );

  // List text-based channels (used by some selectors)
  app.get(
    "/api/guilds/:guildId/channels",
    requireDashboardAuth,
    guardGuildParam,
    async (req, res) => {
      try {
        const _client = getClient();
        if (!_client) return res.json({ ok: true, items: [] });

        const guildId = sanitizeId(req.params.guildId);
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        const guild = getGuild(_client, guildId) || null;
        if (!guild)
          return res.status(404).json({ ok: false, error: "Guild not found" });

        // Include parent/category + channel type info so dashboards can group/pin channels.
        const items = guild.channels.cache
          .filter((ch) => ch && ch.isTextBased?.() && !ch.isDMBased?.())
          .map((ch) => {
            const parentId = ch.parentId || null;
            const parent = parentId
              ? getCachedChannel(_client, guildId, parentId)
              : null;
            const parentName =
              parent && parent.name ? String(parent.name) : null;

            // Normalize a lightweight "kind" used by UI pickers.
            // discord.js v14 types are numeric; we avoid importing enums here.
            const rawType = ch.type;
            const isThread = !!ch.isThread?.();
            // GuildAnnouncement is 5 in discord.js v14 (ChannelType.GuildAnnouncement)
            const isAnnouncement =
              rawType === 5 ||
              String(rawType).toLowerCase().includes("announcement");
            const kind = isThread
              ? "thread"
              : isAnnouncement
                ? "announcement"
                : "text";

            return {
              id: ch.id,
              name: ch.name,
              parentId,
              parentName,
              kind,
            };
          })
          .sort((a, b) => {
            const pa = (a.parentName || "").toLowerCase();
            const pb = (b.parentName || "").toLowerCase();
            if (pa !== pb) return pa.localeCompare(pb);
            const ka = (a.kind || "").toLowerCase();
            const kb = (b.kind || "").toLowerCase();
            if (ka !== kb) return ka.localeCompare(kb);
            return String(a.name || "").localeCompare(String(b.name || ""));
          });

        return res.json({ ok: true, items });
      } catch (err) {
        return sendServerError(res, "/api/guilds/:guildId/channels", err);
      }
    },
  );
}

module.exports = { registerGuildsRoutes };
