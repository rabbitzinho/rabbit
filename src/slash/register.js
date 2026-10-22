// src/slash/register.js

const { REST, Routes } = require("discord.js");
const config = require("../config/defaultConfig");
const buildSlashCommands = require("./commands");

module.exports = async function registerSlashCommands(client) {
  try {
    const slashCfg = config.slash || {};
    if (slashCfg.enabled === false) return;
    if (slashCfg.registerOnStartup === false) {
      console.log(
        "[slash/register] registerOnStartup=false; skipping slash registration.",
      );
      return;
    }

    // Scope control to avoid duplicated commands in Discord UI.
    // If you register commands globally *and* per-guild with the same names,
    // Discord will show duplicates while the global cache propagates.
    // Supported scopes: 'global' (default), 'guild', 'both'.
    const scopeRaw = (slashCfg.scope || process.env.SLASH_SCOPE || "global")
      .toString()
      .trim()
      .toLowerCase();
    const scope =
      scopeRaw === "both" || scopeRaw === "guild" ? scopeRaw : "global";

    const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
    const clientId =
      slashCfg.clientId || process.env.CLIENT_ID || client?.user?.id;
    if (!token || !clientId) {
      console.warn(
        "[slash/register] Missing TOKEN or CLIENT_ID (or unable to infer). Skipping slash registration.",
      );
      return;
    }

    const rest = new REST({ version: "10" }).setToken(token);
    const commands = buildSlashCommands(config.prefix || "!");

    if (!Array.isArray(commands) || commands.length === 0) {
      console.warn("[slash/register] No slash commands to register.");
      return;
    }

    const guildId =
      slashCfg.guildId || process.env.SLASH_GUILD_ID || process.env.GUILD_ID;

    // Helper: clear a guild command set (to eliminate duplicates) when operating in global mode.
    async function maybeClearGuildCommands() {
      if (!guildId) return;
      const shouldClear = slashCfg.clearGuildCommandsOnGlobal !== false;
      if (!shouldClear) return;
      try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
          body: [],
        });
        console.log(
          `[slash/register] Cleared existing guild slash commands for guild ${guildId} (scope=global).`,
        );
      } catch (e) {
        console.warn(
          "[slash/register] Failed to clear guild slash commands:",
          e?.message || e,
        );
      }
    }

    // Register commands according to desired scope.
    if (scope === "global" || scope === "both") {
      try {
        await rest.put(Routes.applicationCommands(clientId), {
          body: commands,
        });
        console.log(
          `[slash/register] Registered ${commands.length} global slash commands (scope=${scope}).`,
        );
      } catch (globalErr) {
        console.error(
          "[slash/register] Failed to register global slash commands:",
          globalErr,
        );
      }
    }

    if ((scope === "guild" || scope === "both") && guildId) {
      try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
          body: commands,
        });
        console.log(
          `[slash/register] Registered ${commands.length} guild slash commands in guild ${guildId} (scope=${scope}).`,
        );
      } catch (guildErr) {
        console.error(
          "[slash/register] Failed to register guild slash commands:",
          guildErr,
        );
      }
    }

    // If the user wants only global commands, clear guild duplicates (configured guild only).
    if (scope === "global") {
      await maybeClearGuildCommands();
    }
  } catch (err) {
    console.error("[slash/register] Error:", err);
  }
};
