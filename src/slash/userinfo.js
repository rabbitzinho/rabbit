// src/slash/userinfo.js

const { EmbedBuilder } = require("discord.js");

const config = require("../config/defaultConfig");
const warningsService = require("../systems/warningsService");
const Infraction = require("../database/models/Infraction");
const logger = require("../systems/logger");
const { tContext, getGuildLang } = require("../systems/i18n");
const { isStaff } = require("./utils");
const { getGuildTrustConfig, getTrustLabel } = require("../utils/trust");
const { replyEphemeral, safeReply } = require("../utils/discord");

function truncate(str, fallback, max = 90) {
  const s = String(str || "").trim();
  if (!s) return fallback;
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function formatRelativeTime(date) {
  if (!date) return "N/A";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "N/A";
  return `<t:${Math.floor(d.getTime() / 1000)}:R>`;
}

function formatInfractionLine(inf, noReasonLabel) {
  const type = String(inf?.type || "UNKNOWN").toUpperCase();
  const duration =
    inf?.duration != null &&
    Number.isFinite(Number(inf.duration)) &&
    Number(inf.duration) > 0
      ? ` • ${Math.round(Number(inf.duration) / 60000)}m`
      : "";

  const ts = formatRelativeTime(inf?.createdAt);
  const reason = truncate(inf?.reason, noReasonLabel, 80);

  return `• **${type}**${duration} — ${ts}\n  └ ${reason}`;
}

function joinFieldSafe(lines, emptyLabel, maxLen = 1024) {
  const out = [];
  let total = 0;

  for (const line of lines) {
    const s = String(line);
    const add = (out.length ? 1 : 0) + s.length;
    if (total + add > maxLen) break;
    out.push(s);
    total += add;
  }

  if (lines.length > out.length) {
    const ell = "…";
    if (total + (out.length ? 1 : 0) + ell.length <= maxLen) out.push(ell);
  }

  return out.join("\n") || emptyLabel;
}

module.exports = async function userinfoSlash(client, interaction) {
  try {
    if (!interaction?.guild) return;

    const guild = interaction.guild;
    const trustCfg = await getGuildTrustConfig(guild.id);
    const requesterIsStaff = await isStaff(interaction.member, "moderation");
    const lang = await getGuildLang(guild.id);

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member?.user) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "common.cannotResolveUser"),
      );
    }

    const user = member.user;
    const dbUser = await warningsService.getOrCreateUser(guild.id, user.id);
    const noReasonLabel = await tContext(interaction, "common.noReason");
    const noRecentLabel = await tContext(
      interaction,
      "userinfo.noRecentInfractions",
    );
    const unknownLabel = await tContext(interaction, "history.unknown");

    const warnings = dbUser?.warnings ?? 0;
    const trustValue = Number.isFinite(dbUser?.trust)
      ? dbUser.trust
      : trustCfg.base;
    const trustLabel = getTrustLabel(trustValue, trustCfg, lang);

    let infractionsCount = 0;
    try {
      infractionsCount = await Infraction.countDocuments({
        guildId: guild.id,
        userId: user.id,
      });
    } catch {
      // ignore
    }

    let recentInfractions = [];
    if (requesterIsStaff) {
      try {
        recentInfractions = await Infraction.find({
          guildId: guild.id,
          userId: user.id,
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean();
      } catch {
        recentInfractions = [];
      }
    }

    const createdAt = user.createdAt
      ? `<t:${Math.floor(user.createdAt.getTime() / 1000)}:F>`
      : unknownLabel;

    const joinedAt = member.joinedAt
      ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>`
      : unknownLabel;

    let trustFieldValue = await tContext(interaction, "userinfo.trustDisabled");
    if (trustCfg.enabled) {
      trustFieldValue = requesterIsStaff
        ? await tContext(interaction, "userinfo.trustStaff", {
            trustValue,
            trustMax: trustCfg.max,
            trustLabel,
          })
        : await tContext(interaction, "userinfo.trustPublic");
    }

    let recentFieldValue = await tContext(
      interaction,
      "userinfo.recentStaffOnly",
    );
    if (requesterIsStaff) {
      const lines = (recentInfractions || []).map((inf) =>
        formatInfractionLine(inf, noReasonLabel),
      );
      recentFieldValue = joinFieldSafe(lines, noRecentLabel, 1024);
    }

    const embed = new EmbedBuilder()
      .setTitle(
        await tContext(interaction, "userinfo.title", { tag: user.tag }),
      )
      .setColor("Blue")
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: await tContext(interaction, "userinfo.fieldUser"),
          value: await tContext(interaction, "userinfo.tagAndId", {
            tag: user.tag,
            id: user.id,
          }),
          inline: false,
        },
        {
          name: await tContext(interaction, "userinfo.fieldAccount"),
          value: await tContext(interaction, "userinfo.accountDates", {
            createdAt,
            joinedAt,
          }),
          inline: false,
        },
        {
          name: await tContext(interaction, "userinfo.fieldWarnings"),
          value: await tContext(interaction, "userinfo.warningsBlock", {
            warnings,
            maxWarnings: config.maxWarnings ?? 3,
            infractionsCount,
          }),
          inline: false,
        },
        {
          name: await tContext(interaction, "userinfo.fieldTrust"),
          value: trustFieldValue,
          inline: false,
        },
        {
          name: await tContext(interaction, "userinfo.fieldRecent"),
          value: recentFieldValue,
          inline: false,
        },
      )
      .setFooter({
        text: await tContext(interaction, "userinfo.requestedBy", {
          tag: interaction.user.tag,
        }),
      })
      .setTimestamp(new Date());

    // Resposta pública (sem ephemeral)
    await interaction.reply({ embeds: [embed] }).catch(() => null);

    await logger(
      client,
      "Slash User Info",
      user,
      interaction.user,
      await tContext(interaction, "log.actions.userinfo", {
        tag: user.tag,
        id: user.id,
        warnings,
        maxWarnings: config.maxWarnings ?? 3,
        infractionsCount,
        trust: trustCfg.enabled ? `${trustValue}/${trustCfg.max}` : "N/A",
        riskLabel: trustCfg.enabled ? trustLabel : "N/A",
      }),
      guild,
    );
  } catch (err) {
    console.error("[slash/userinfo] Error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "common.unexpectedError") },
      { ephemeral: true },
    );
  }
};
