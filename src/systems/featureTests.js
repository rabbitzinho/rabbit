// src/systems/featureTests.js
//
// Executa um "teste" de cada funcionalidade: envia uma amostra para o canal
// configurado para que o utilizador valide a configuração sem esperar por
// eventos reais de membros/mensagens.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js");
const { buildMemberMessage } = require("./welcomeMessages");
const { getGuildLang, tGuild } = require("./i18n");
const { getFeatureText, applyTemplate } = require("./featureText");

async function fetchSendable(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.send !== "function") return null;
  return channel;
}

function formatPanelDate(lang, now) {
  try {
    return new Intl.DateTimeFormat(lang === "pt" ? "pt-PT" : "en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now || new Date());
  } catch {
    return "";
  }
}

/**
 * Verifica se o bot consegue atribuir um cargo (gestão de cargos + hierarquia).
 * @param {import('discord.js').GuildMember|null} me
 * @param {import('discord.js').Guild} guild
 * @param {string} roleId
 */
function canAssignRole(me, guild, roleId) {
  if (!me || !roleId) return false;
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return false;
  const role = guild.roles.cache.get(roleId) || null;
  return !!(role && role.editable);
}

/**
 * @returns {Promise<{ok:boolean, error?:string, info?:string, data?:object}>}
 */
async function runFeatureTest({ client, guild, feature, config, testMessage }) {
  const c = config || {};

  switch (feature) {
    case "welcome":
    case "goodbye": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      const lang = await getGuildLang(guild.id);
      await channel.send(
        buildMemberMessage({
          config: c,
          guild,
          user: null,
          kind: feature,
          lang,
        }),
      );
      return { ok: true };
    }

    case "serverStats": {
      const { refreshGuild } = require("./serverStats");
      const r = await refreshGuild(client, guild, { force: true });
      if (!r || r.ok === false) return { ok: false, error: "TEST_FAILED" };
      return {
        ok: true,
        data: { members: r.members, joins: r.joins, leaves: r.leaves },
      };
    }

    case "memes": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      const { sendMeme } = require("./memes");
      await sendMeme(channel);
      return { ok: true };
    }

    case "twitch": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      if (!c.streamerName)
        return { ok: false, error: "TWITCH_STREAMER_INVALID" };
      const { fetchLiveStream } = require("./twitch");
      try {
        const stream = await fetchLiveStream(c.streamerName);
        return { ok: true, info: stream ? "twitch_live" : "twitch_offline" };
      } catch (err) {
        return {
          ok: false,
          error: err && err.code ? err.code : "TWITCH_TEST_FAILED",
        };
      }
    }

    case "messageLogs": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      const embed = new EmbedBuilder()
        .setTitle("Teste — registo de mensagens")
        .setDescription("Esta é uma mensagem de teste do sistema de logs.")
        .setColor("#7c3aed");
      await channel.send({ embeds: [embed] });
      return { ok: true };
    }

    case "reactionRoles": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      const entries = Array.isArray(c.entries) ? c.entries : [];
      if (!entries.length) return { ok: false, error: "ENTRIES_REQUIRED" };

      const embed = new EmbedBuilder()
        .setTitle("Teste — cargos por reação")
        .setDescription("Reage a esta mensagem com os emojis configurados.");
      const message = await channel.send({ embeds: [embed] });

      const { toReactable } = require("./reactionRoles");
      let unresolved = 0;
      for (const entry of entries) {
        const reactable = toReactable(entry && entry.emoji);
        if (!reactable) {
          unresolved += 1;
          continue;
        }
        await message.react(reactable).catch(() => null);
      }

      // Diagnóstico: sem isto uma falha de permissões/hierarquia era silenciosa.
      if (unresolved)
        return {
          ok: true,
          info: "reactionRolesUnresolved",
          data: { unresolved },
        };

      const me =
        guild.members.me || (await guild.members.fetchMe().catch(() => null));
      const blocked = entries.filter(
        (e) => e && e.roleId && !canAssignRole(me, guild, e.roleId),
      ).length;
      if (blocked)
        return {
          ok: true,
          info: "reactionRolesPermissions",
          data: { roles: blocked },
        };

      return { ok: true };
    }

    case "levels": {
      const channel = await fetchSendable(client, c.announceChannelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      await channel.send({
        content: "🎉 Teste — um membro subiu para o nível 2!",
      });
      return { ok: true };
    }

    case "starboard": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      const embed = new EmbedBuilder()
        .setDescription("⭐ (teste) — entrada de starboard de exemplo")
        .setColor("#fbbf24");
      await channel.send({ embeds: [embed] });
      return { ok: true };
    }

    case "verification": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel || !c.roleId)
        return { ok: false, error: "CHANNEL_ROLE_REQUIRED" };
      const lang = await getGuildLang(guild.id);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("verify:test")
          .setLabel(
            c.buttonLabel ||
              (await tGuild(guild.id, "verify.testButton", undefined, lang)),
          )
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
      );
      const embed = new EmbedBuilder()
        .setTitle(
          await getFeatureText({
            guildId: guild.id,
            feature: "verification",
            field: "title",
            value: c.title,
            lang,
          }),
        )
        .setDescription(
          await getFeatureText({
            guildId: guild.id,
            feature: "verification",
            field: "description",
            value: c.description,
            lang,
          }),
        );
      await channel.send({ embeds: [embed], components: [row] });
      return { ok: true };
    }

    case "tickets": {
      const channel = await fetchSendable(client, c.channelId);
      if (!channel) return { ok: false, error: "CHANNEL_REQUIRED" };
      const lang = await getGuildLang(guild.id);
      const title = await getFeatureText({
        guildId: guild.id,
        feature: "tickets",
        field: "panelTitle",
        value: c.panelTitle,
        lang,
      });
      const description = await getFeatureText({
        guildId: guild.id,
        feature: "tickets",
        field: "panelDescription",
        value: c.panelDescription,
        params: { emoji: c.openEmoji || "🎫" },
        lang,
      });
      const footer = await getFeatureText({
        guildId: guild.id,
        feature: "tickets",
        field: "panelFooter",
        lang,
      });
      const now = new Date();
      const footerText = [footer, formatPanelDate(lang, now)]
        .filter(Boolean)
        .join(" • ");
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(
          applyTemplate(description, { emoji: c.openEmoji || "🎫" }),
        )
        .setFooter({ text: footerText })
        .setTimestamp(now);
      const message = await channel.send({ embeds: [embed] });
      const { toReactable } = require("./reactionRoles");
      const reactable = toReactable(c.openEmoji || "🎫");
      if (reactable) await message.react(reactable).catch(() => null);
      return { ok: true };
    }

    case "autoKick":
      // Sem efeitos colaterais: o teste devolve a configuração efetiva.
      return {
        ok: true,
        info: "autoKick",
        data: { infractionsToKick: c.infractionsToKick },
      };

    case "antiSpam":
      // Sem mensagens ou punições de teste: valida e apresenta a configuração efetiva.
      return {
        ok: true,
        info: "antiSpam",
        data: {
          enabled: c.enabled === true,
          maxMessages: c.maxMessages,
          intervalSeconds: c.intervalSeconds,
          muteDurationMinutes: c.muteDurationMinutes,
        },
      };

    case "autoModeration": {
      if (typeof testMessage !== "string" || !testMessage.trim()) {
        return { ok: false, error: "SIMULATION_MESSAGE_REQUIRED" };
      }
      if (c.enabled === false) {
        return {
          ok: true,
          info: "autoModerationDisabled",
          data: { word: null },
        };
      }
      const { evaluateAutoModeration } = require("./autoModeration");
      const { matchedWord } = evaluateAutoModeration(testMessage, c, guild.id);
      return {
        ok: true,
        info: matchedWord ? "autoModerationMatched" : "autoModerationNoMatch",
        data: {
          word: matchedWord,
          maxWarnings: c.maxWarnings,
          muteDurationMinutes: c.muteDurationMinutes,
        },
      };
    }

    case "polls":
      // As enquetes são criadas por slash command no servidor.
      return { ok: true, info: "polls" };

    default:
      return { ok: false, error: "TEST_NOT_AVAILABLE" };
  }
}

module.exports = { runFeatureTest };
