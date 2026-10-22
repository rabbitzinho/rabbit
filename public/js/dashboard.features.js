// public/js/dashboard.features.js
//
// Tab "Funcionalidades": renderiza e guarda as funcionalidades opcionais
// definidas em GuildConfig.features. Cada funcionalidade tem um interruptor
// independente e uma área de configuração própria.

(function () {
  "use strict";

  var NS = (window.OzarkDashboard = window.OzarkDashboard || {});

  function byId(id) {
    return document.getElementById(id);
  }
  function t(key, params) {
    return NS.t ? NS.t(key, params) : key;
  }
  function esc(v) {
    return NS.escapeHtml
      ? NS.escapeHtml(v == null ? "" : String(v))
      : String(v == null ? "" : v);
  }
  function notify(msg, opts) {
    if (typeof NS.toast === "function") NS.toast(msg, opts);
  }
  function guildId() {
    return NS.state && NS.state.guildId ? NS.state.guildId : null;
  }
  // camelCase -> snake_case (ex.: messageLogs -> message_logs), para casar as chaves i18n.
  function snake(s) {
    return String(s)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
  }
  var premiumActive = false;
  var staticPremiumCards = null;

  function getStaticPremiumCards() {
    if (staticPremiumCards) return staticPremiumCards;
    var source = byId("extrasGrid");
    staticPremiumCards = source
      ? Array.prototype.filter.call(source.children, function (child) {
          return child.classList && child.classList.contains("feature-card");
        })
      : [];
    return staticPremiumCards;
  }

  function appendStaticPremiumCards(grid) {
    getStaticPremiumCards().forEach(function (card) {
      grid.appendChild(card);
    });
  }

  var FEATURES = [
    {
      key: "messageLogs",
      fields: [
        { type: "channel", name: "channelId", label: "features_channel" },
        { type: "bool", name: "ignoreBots", label: "features_ignore_bots" },
      ],
      presets: [
        {
          id: "members",
          label: "preset_logs_members",
          values: { ignoreBots: true },
        },
        {
          id: "all",
          label: "preset_logs_all",
          values: { ignoreBots: false },
        },
      ],
    },
    {
      key: "reactionRoles",
      fields: [
        { type: "channel", name: "channelId", label: "features_channel" },
        { type: "text", name: "messageId", label: "features_message_id" },
        { type: "entries" },
      ],
    },
    {
      key: "autoKick",
      fields: [
        {
          type: "number",
          name: "infractionsToKick",
          label: "features_infractions",
          min: 1,
          max: 100,
        },
      ],
      presets: [
        {
          id: "soft",
          label: "preset_autokick_soft",
          values: { infractionsToKick: 5 },
        },
        {
          id: "strict",
          label: "preset_autokick_strict",
          values: { infractionsToKick: 3 },
        },
        {
          id: "severe",
          label: "preset_autokick_severe",
          values: { infractionsToKick: 1 },
        },
      ],
    },
    {
      key: "autoModeration",
      fields: [
        {
          type: "number",
          name: "maxWarnings",
          label: "features_automod_max_warnings",
          min: 1,
          max: 10,
        },
        {
          type: "number",
          name: "muteDurationMinutes",
          label: "features_automod_mute_duration",
          min: 1,
          max: 1440,
        },
      ],
      advancedFields: [
        {
          type: "textarea",
          name: "bannedWordsPt",
          label: "features_automod_words_pt",
          placeholderKey: "features_automod_words_placeholder",
          maxLength: 6000,
        },
        {
          type: "textarea",
          name: "bannedWordsEn",
          label: "features_automod_words_en",
          placeholderKey: "features_automod_words_placeholder",
          maxLength: 6000,
        },
        {
          type: "multiRole",
          name: "bypassRoleIds",
          label: "features_automod_bypass_roles",
          hintKey: "features_automod_bypass_hint",
        },
        {
          type: "multiChannel",
          name: "bypassChannelIds",
          label: "features_automod_bypass_channels",
          hintKey: "features_automod_bypass_hint",
        },
        {
          type: "simulation",
          name: "simulationMessage",
          label: "features_automod_simulation_label",
          placeholderKey: "features_automod_simulation_placeholder",
          maxLength: 1000,
        },
      ],
    },
    {
      key: "antiSpam",
      fields: [
        {
          type: "number",
          name: "maxMessages",
          label: "features_antispam_max_messages",
          min: 2,
          max: 30,
        },
        {
          type: "number",
          name: "intervalSeconds",
          label: "features_antispam_interval",
          min: 1,
          max: 120,
        },
        {
          type: "number",
          name: "muteDurationMinutes",
          label: "features_antispam_mute_duration",
          min: 1,
          max: 1440,
        },
      ],
      advancedFields: [
        {
          type: "bool",
          name: "softActionsEnabled",
          label: "features_antispam_soft_actions",
        },
        {
          type: "number",
          name: "strikesToMute",
          label: "features_antispam_strikes",
          min: 1,
          max: 10,
        },
        {
          type: "number",
          name: "strikeWindowSeconds",
          label: "features_antispam_strike_window",
          min: 1,
          max: 3600,
        },
        {
          type: "number",
          name: "actionCooldownSeconds",
          label: "features_antispam_cooldown",
          min: 0,
          max: 3600,
        },
        {
          type: "number",
          name: "minLength",
          label: "features_antispam_min_length",
          min: 0,
          max: 100,
        },
        {
          type: "number",
          name: "similarityThreshold",
          label: "features_antispam_similarity",
          min: 0.5,
          max: 1,
          step: 0.05,
        },
        {
          type: "bool",
          name: "ignoreAttachments",
          label: "features_antispam_ignore_attachments",
        },
        {
          type: "bool",
          name: "bypassAdmins",
          label: "features_antispam_bypass_admins",
        },
        {
          type: "bool",
          name: "sendMessage",
          label: "features_antispam_send_message",
        },
      ],
    },
    {
      key: "levels",
      fields: [
        {
          type: "number",
          name: "xpMin",
          label: "features_xp_min",
          min: 1,
          max: 1000,
        },
        {
          type: "number",
          name: "xpMax",
          label: "features_xp_max",
          min: 1,
          max: 1000,
        },
        {
          type: "number",
          name: "cooldownSeconds",
          label: "features_cooldown",
          min: 0,
          max: 86400,
        },
        {
          type: "channel",
          name: "announceChannelId",
          label: "features_announce_channel",
        },
      ],
      presets: [
        {
          id: "casual",
          label: "preset_levels_casual",
          values: { xpMin: 15, xpMax: 25, cooldownSeconds: 60 },
        },
        {
          id: "fast",
          label: "preset_levels_fast",
          values: { xpMin: 30, xpMax: 50, cooldownSeconds: 30 },
        },
        {
          id: "slow",
          label: "preset_levels_slow",
          values: { xpMin: 5, xpMax: 10, cooldownSeconds: 180 },
        },
      ],
    },
    {
      key: "starboard",
      fields: [
        { type: "channel", name: "channelId", label: "features_channel" },
        {
          type: "number",
          name: "threshold",
          label: "features_threshold",
          min: 1,
          max: 100,
        },
        {
          type: "text",
          name: "emoji",
          label: "features_emoji",
          placeholder: "⭐",
        },
      ],
      presets: [
        {
          id: "classic",
          label: "preset_starboard_classic",
          values: { threshold: 3, emoji: "⭐" },
        },
        {
          id: "strict",
          label: "preset_starboard_strict",
          values: { threshold: 5, emoji: "⭐" },
        },
        {
          id: "easy",
          label: "preset_starboard_easy",
          values: { threshold: 2, emoji: "🔥" },
        },
      ],
    },
    {
      key: "polls",
      fields: [],
    },
    {
      key: "verification",
      fields: [
        { type: "role", name: "roleId", label: "features_role" },
        { type: "channel", name: "channelId", label: "features_channel" },
        {
          type: "number",
          name: "kickAfterMinutes",
          label: "features_kick_after",
          min: 0,
          max: 10080,
        },
        { type: "publish" },
      ],
      advancedFields: [
        {
          type: "text",
          name: "title",
          label: "features_field_title",
          placeholderKey: "features_placeholder_verify_title",
          maxLength: 120,
        },
        {
          type: "textarea",
          name: "description",
          label: "features_description",
          placeholderKey: "features_placeholder_verify_description",
          maxLength: 500,
        },
        {
          type: "text",
          name: "buttonLabel",
          label: "features_button_label",
          placeholderKey: "features_placeholder_verify_button",
          maxLength: 80,
        },
      ],
      presets: [
        {
          id: "never",
          label: "preset_verify_never",
          values: { kickAfterMinutes: 0 },
        },
        {
          id: "hour",
          label: "preset_verify_hour",
          values: { kickAfterMinutes: 60 },
        },
        {
          id: "day",
          label: "preset_verify_day",
          values: { kickAfterMinutes: 1440 },
        },
        {
          id: "week",
          label: "preset_verify_week",
          values: { kickAfterMinutes: 10080 },
        },
      ],
    },
    {
      key: "tickets",
      premiumModule: "tickets",
      fields: [
        { type: "channel", name: "channelId", label: "features_channel" },
        { type: "publish" },
      ],
      advancedFields: [
        {
          type: "text",
          name: "openEmoji",
          label: "features_open_emoji",
          placeholderKey: "features_placeholder_ticket_open_emoji",
          maxLength: 64,
        },
        {
          type: "text",
          name: "closeEmoji",
          label: "features_close_emoji",
          placeholderKey: "features_placeholder_ticket_close_emoji",
          maxLength: 64,
        },
        {
          type: "text",
          name: "panelTitle",
          label: "features_field_title",
          placeholderKey: "features_placeholder_ticket_title",
          maxLength: 120,
        },
        {
          type: "textarea",
          name: "panelDescription",
          label: "features_description",
          placeholderKey: "features_placeholder_ticket_description",
          maxLength: 500,
        },
        {
          type: "textarea",
          name: "alreadyOpenMessage",
          label: "features_already_open_message",
          placeholderKey: "features_placeholder_ticket_already_open",
          maxLength: 300,
        },
        {
          type: "textarea",
          name: "welcomeMessage",
          label: "features_welcome_message",
          placeholderKey: "features_placeholder_ticket_welcome",
          maxLength: 1200,
        },
        {
          type: "textarea",
          name: "closeMessage",
          label: "features_close_message",
          placeholderKey: "features_placeholder_ticket_close",
          maxLength: 300,
        },
      ],
      presets: [
        {
          id: "standard",
          label: "preset_tickets_standard",
          values: { openEmoji: "🎫", closeEmoji: "🔒" },
        },
      ],
    },
    {
      key: "welcome",
      preview: "welcome",
      fields: [
        { type: "channel", name: "channelId", label: "features_channel" },
        {
          type: "textarea",
          name: "message",
          label: "features_message",
          placeholderKey: "features_placeholder_welcome_message",
          maxLength: 500,
        },
      ],
      advancedFields: [
        { type: "bool", name: "embed", label: "features_embed" },
        {
          type: "text",
          name: "color",
          label: "features_color",
          placeholderKey: "features_placeholder_welcome_color",
        },
        {
          type: "text",
          name: "bannerUrl",
          label: "features_banner_url",
          placeholderKey: "features_placeholder_banner_url",
        },
      ],
      presets: [
        {
          id: "plain",
          label: "preset_welcome_plain",
          values: {
            embed: false,
            message: function () {
              return t("welcome_preset_message");
            },
            color: "#7c3aed",
          },
        },
        {
          id: "card",
          label: "preset_welcome_card",
          values: {
            embed: true,
            message: function () {
              return t("welcome_preset_message");
            },
            color: "#7c3aed",
          },
        },
        {
          id: "vip",
          label: "preset_welcome_vip",
          values: {
            embed: true,
            message: function () {
              return t("welcome_preset_vip_message");
            },
            color: "#7c3aed",
          },
        },
      ],
    },
    {
      key: "goodbye",
      preview: "goodbye",
      fields: [
        { type: "channel", name: "channelId", label: "features_channel" },
        {
          type: "textarea",
          name: "message",
          label: "features_message",
          placeholderKey: "features_placeholder_goodbye_message",
          maxLength: 500,
        },
      ],
      advancedFields: [
        { type: "bool", name: "embed", label: "features_embed" },
        {
          type: "text",
          name: "color",
          label: "features_color",
          placeholderKey: "features_placeholder_goodbye_color",
        },
        {
          type: "text",
          name: "bannerUrl",
          label: "features_banner_url",
          placeholderKey: "features_placeholder_banner_url",
        },
      ],
      presets: [
        {
          id: "plain",
          label: "preset_goodbye_plain",
          values: {
            embed: false,
            message: function () {
              return t("goodbye_preset_plain_message");
            },
            color: "#ef4444",
          },
        },
        {
          id: "card",
          label: "preset_goodbye_card",
          values: {
            embed: true,
            message: function () {
              return t("goodbye_preset_card_message");
            },
            color: "#ef4444",
          },
        },
      ],
    },
    {
      key: "serverStats",
      fields: [
        {
          type: "bool",
          name: "showMembers",
          label: "features_stats_show_members",
        },
        { type: "bool", name: "showJoins", label: "features_stats_show_joins" },
        {
          type: "bool",
          name: "showLeaves",
          label: "features_stats_show_leaves",
        },
      ],
      advancedFields: [
        {
          type: "text",
          name: "memberTemplate",
          label: "features_stats_member",
          placeholderKey: "features_placeholder_stats_member",
          maxLength: 100,
        },
        {
          type: "text",
          name: "joinsTemplate",
          label: "features_stats_joins",
          placeholderKey: "features_placeholder_stats_joins",
          maxLength: 100,
        },
        {
          type: "text",
          name: "leavesTemplate",
          label: "features_stats_leaves",
          placeholderKey: "features_placeholder_stats_leaves",
          maxLength: 100,
        },
      ],
      presets: [
        {
          id: "members",
          label: "preset_stats_members",
          values: {
            showMembers: true,
            showJoins: false,
            showLeaves: false,
            memberTemplate: function () {
              return t("stats_preset_members_template");
            },
          },
        },
        {
          id: "emojis",
          label: "preset_stats_emojis",
          values: {
            showMembers: true,
            showJoins: true,
            showLeaves: true,
            memberTemplate: function () {
              return t("stats_preset_emojis_members");
            },
            joinsTemplate: function () {
              return t("stats_preset_emojis_joins");
            },
            leavesTemplate: function () {
              return t("stats_preset_emojis_leaves");
            },
          },
        },
        {
          id: "plain",
          label: "preset_stats_plain",
          values: {
            showMembers: true,
            showJoins: true,
            showLeaves: true,
            memberTemplate: function () {
              return t("stats_preset_plain_members");
            },
            joinsTemplate: function () {
              return t("stats_preset_plain_joins");
            },
            leavesTemplate: function () {
              return t("stats_preset_plain_leaves");
            },
          },
        },
      ],
    },
    {
      key: "memes",
      fields: [
        { type: "channel", name: "channelId", label: "features_channel" },
        {
          type: "number",
          name: "intervalMinutes",
          label: "features_memes_interval",
          min: 15,
          max: 1440,
          step: 15,
        },
      ],
      presets: [
        {
          id: "hourly",
          label: "preset_memes_hourly",
          values: { intervalMinutes: 60 },
        },
        {
          id: "daily",
          label: "preset_memes_daily",
          values: { intervalMinutes: 720 },
        },
        {
          id: "frequent",
          label: "preset_memes_frequent",
          values: { intervalMinutes: 30 },
        },
      ],
    },
    {
      key: "twitch",
      fields: [
        {
          type: "text",
          name: "streamerName",
          label: "features_twitch_streamer",
          placeholderKey: "features_placeholder_twitch_streamer",
          maxLength: 25,
        },
        { type: "channel", name: "channelId", label: "features_channel" },
        { type: "role", name: "roleId", label: "features_twitch_role" },
      ],
    },
  ];

  var current = {}; // Valores carregados da API (por funcionalidade).
  var configuredFeatures = {};
  var activeFeatureFilter = "all";
  var diagnosisStorageKey = "rabbit.featureDiagnosis.v1";
  var diagnosisResults = (function () {
    try {
      var stored = JSON.parse(sessionStorage.getItem(diagnosisStorageKey));
      return stored && typeof stored === "object"
        ? stored
        : Object.create(null);
    } catch {
      return Object.create(null);
    }
  })();
  var requiredSetupFields = {
    messageLogs: ["channelId"],
    reactionRoles: ["channelId", "messageId", "entries"],
    autoKick: ["infractionsToKick"],
    levels: ["xpMin", "xpMax", "cooldownSeconds"],
    starboard: ["channelId", "threshold"],
    verification: ["roleId", "channelId"],
    tickets: ["channelId", "openEmoji", "closeEmoji"],
    welcome: ["channelId", "message"],
    goodbye: ["channelId", "message"],
    serverStats: ["serverStats"],
    memes: ["channelId", "intervalMinutes"],
    twitch: ["streamerName", "channelId"],
  };
  var channels = null; // Cache de canais do guild.
  var roles = null; // Cache de cargos do guild.
  var metaGuildId = null;
  var loading = false;

  // -----------------------------
  // Helpers de render
  // -----------------------------

  function optionList(items, selected, noneLabel, isRole, multiple) {
    var html = multiple
      ? ""
      : '<option value="">' + esc(noneLabel) + "</option>";
    var selectedIds = new Set(
      (Array.isArray(selected) ? selected : [selected])
        .filter(function (id) {
          return id != null && id !== "";
        })
        .map(String),
    );
    (items || []).forEach(function (it) {
      if (!it || !it.id) return;
      var id = String(it.id);
      var name = it.name ? String(it.name) : id;
      var label = isRole ? "@" + name : "#" + name;
      html +=
        '<option value="' +
        esc(id) +
        '"' +
        (selectedIds.has(id) ? " selected" : "") +
        ">" +
        esc(label) +
        "</option>";
    });
    return html;
  }

  function entryRowHtml(entry) {
    var emoji = entry && entry.emoji ? String(entry.emoji) : "";
    var roleId = entry && entry.roleId ? String(entry.roleId) : "";
    return (
      "" +
      '<div class="feature-entry" data-role="entry-row">' +
      '<input class="input" type="text" data-entry="emoji" maxlength="64" placeholder="' +
      esc(t("features_placeholder_emoji")) +
      '" value="' +
      esc(emoji) +
      '" />' +
      '<select class="select" data-entry="roleId">' +
      optionList(roles, roleId, t("features_role"), true) +
      "</select>" +
      '<button type="button" class="btn xs danger" data-role="entry-remove">' +
      esc(t("features_remove")) +
      "</button>" +
      "</div>"
    );
  }

  function fieldHtml(feature, field, value) {
    var v = value == null ? "" : value;
    var placeholder = field.placeholderKey
      ? t(field.placeholderKey)
      : field.placeholder;

    if (
      field.type === "channel" ||
      field.type === "role" ||
      field.type === "multiChannel" ||
      field.type === "multiRole"
    ) {
      var isRole = field.type === "role" || field.type === "multiRole";
      var multiple =
        field.type === "multiChannel" || field.type === "multiRole";
      var items = isRole ? roles : channels;
      return (
        '<div class="field">' +
        "<label>" +
        esc(t(field.label)) +
        "</label>" +
        '<select class="select" data-field="' +
        esc(field.name) +
        '"' +
        (multiple ? ' multiple size="4"' : "") +
        ">" +
        optionList(
          items,
          v,
          t(isRole ? "features_role" : "select_channel"),
          isRole,
          multiple,
        ) +
        "</select>" +
        (field.hintKey
          ? '<p class="hint">' + esc(t(field.hintKey)) + "</p>"
          : "") +
        "</div>"
      );
    }

    if (field.type === "number") {
      return (
        '<div class="field">' +
        "<label>" +
        esc(t(field.label)) +
        "</label>" +
        '<input class="input" type="number" data-field="' +
        esc(field.name) +
        '"' +
        (typeof field.min === "number" ? ' min="' + field.min + '"' : "") +
        (typeof field.max === "number" ? ' max="' + field.max + '"' : "") +
        (typeof field.step === "number" ? ' step="' + field.step + '"' : "") +
        ' value="' +
        esc(v) +
        '" />' +
        "</div>"
      );
    }

    if (field.type === "textarea") {
      return (
        '<div class="field field--full">' +
        "<label>" +
        esc(t(field.label)) +
        "</label>" +
        '<textarea class="input" rows="3" data-field="' +
        esc(field.name) +
        '"' +
        (typeof field.maxLength === "number"
          ? ' maxlength="' + field.maxLength + '"'
          : "") +
        (placeholder ? ' placeholder="' + esc(placeholder) + '"' : "") +
        ">" +
        esc(v) +
        "</textarea>" +
        "</div>"
      );
    }

    if (field.type === "simulation") {
      return (
        '<div class="field field--full">' +
        "<label>" +
        esc(t(field.label)) +
        "</label>" +
        '<textarea class="input" rows="3" data-field="' +
        esc(field.name) +
        '"' +
        (typeof field.maxLength === "number"
          ? ' maxlength="' + field.maxLength + '"'
          : "") +
        (placeholder ? ' placeholder="' + esc(placeholder) + '"' : "") +
        "></textarea>" +
        "</div>"
      );
    }

    if (field.type === "bool") {
      var checked = value === true;
      return (
        '<div class="field">' +
        '<label class="switch"><input type="checkbox" data-field="' +
        esc(field.name) +
        '"' +
        (checked ? " checked" : "") +
        ' /><span class="slider"></span></label>' +
        '<span class="switch-label">' +
        esc(t(field.label)) +
        "</span>" +
        "</div>"
      );
    }

    if (field.type === "entries") {
      var entries = Array.isArray(value) ? value : [];
      var rows = entries.map(entryRowHtml).join("");
      return (
        '<div class="field">' +
        "<label>" +
        esc(t("features_entries")) +
        "</label>" +
        '<div class="feature-entries" data-role="entries">' +
        rows +
        "</div>" +
        '<button type="button" class="btn xs" data-role="add-entry">' +
        esc(t("features_add_entry")) +
        "</button>" +
        "</div>"
      );
    }

    if (field.type === "publish") {
      var messageId =
        current[feature] && current[feature].messageId
          ? String(current[feature].messageId)
          : "";
      return (
        '<div class="feature-card__publish">' +
        '<div class="hint" data-role="message-id">' +
        (messageId
          ? esc(t("features_message_published", { id: messageId }))
          : "") +
        "</div>" +
        "</div>"
      );
    }

    return (
      '<div class="field">' +
      "<label>" +
      esc(t(field.label)) +
      "</label>" +
      '<input class="input" type="text" data-field="' +
      esc(field.name) +
      '"' +
      (typeof field.maxLength === "number"
        ? ' maxlength="' + field.maxLength + '"'
        : ' maxlength="64"') +
      (placeholder ? ' placeholder="' + esc(placeholder) + '"' : "") +
      ' value="' +
      esc(v) +
      '" />' +
      "</div>"
    );
  }

  // -----------------------------
  // Pré-visualização de embeds (boas-vindas / saída)
  // -----------------------------

  function sampleGuildName() {
    var gid = guildId();
    var list = (NS.state && NS.state.guilds) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === gid) return list[i].name || "Servidor";
    }
    return "Servidor";
  }

  // Substitui os placeholders por valores de exemplo, iguais aos que o bot usa.
  function applySampleVars(text) {
    return String(text || "")
      .replace(/\{user\}/g, "@Membro")
      .replace(/\{username\}/g, "Membro")
      .replace(/\{tag\}/g, "Membro")
      .replace(/\{server\}/g, sampleGuildName())
      .replace(/\{memberCount\}/g, "1 234");
  }

  function escNl(v) {
    return esc(v).replace(/\n/g, "<br>");
  }

  function readCardField(card, name) {
    return card.querySelector('[data-field="' + name + '"]');
  }

  function renderEmbedPreview(card, feature, box) {
    var msgEl = readCardField(card, "message");
    var colorEl = readCardField(card, "color");
    var embedEl = readCardField(card, "embed");
    var bannerEl = readCardField(card, "bannerUrl");

    var message = applySampleVars(msgEl ? msgEl.value : "");
    var color = colorEl ? String(colorEl.value || "").trim() : "";
    var isEmbed = embedEl ? !!embedEl.checked : false;
    var banner = bannerEl ? String(bannerEl.value || "").trim() : "";

    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      color = feature.preview === "goodbye" ? "#ef4444" : "#7c3aed";
    }

    var emptyHtml =
      '<span class="embed-preview__empty">' +
      esc(t("preview_empty")) +
      "</span>";

    if (!isEmbed) {
      box.classList.add("embed-preview--plain");
      box.innerHTML =
        '<div class="embed-preview__plain">' +
        (message ? escNl(message) : emptyHtml) +
        "</div>";
      return;
    }

    box.classList.remove("embed-preview--plain");
    box.style.setProperty("--embed-accent", color);

    var footer =
      feature.preview === "goodbye"
        ? t("preview_footer_goodbye")
        : t("preview_footer_welcome");
    var title =
      feature.preview === "goodbye"
        ? t("preview_goodbye_title")
        : t("preview_welcome_title");

    box.innerHTML =
      '<div class="embed-preview__box">' +
      '<div class="embed-preview__content">' +
      '<div class="embed-preview__author">' +
      '<span class="embed-preview__avatar" aria-hidden="true"></span>' +
      '<span class="embed-preview__author-name">' +
      esc(sampleGuildName()) +
      "</span>" +
      "</div>" +
      '<div class="embed-preview__title">' +
      esc(title) +
      "</div>" +
      '<div class="embed-preview__desc">' +
      (message ? escNl(message) : emptyHtml) +
      "</div>" +
      (/^https?:\/\//i.test(banner)
        ? '<img class="embed-preview__image" src="' +
          esc(banner) +
          '" alt="" />'
        : "") +
      '<div class="embed-preview__footer">' +
      "<span>" +
      esc(footer) +
      "</span>" +
      '<span class="embed-preview__time">' +
      esc(t("preview_now")) +
      "</span>" +
      "</div>" +
      "</div>" +
      '<span class="embed-preview__thumb" aria-hidden="true"></span>' +
      "</div>";
  }

  var diagnosisStatuses = {
    unknown: function () {
      return t("features_diagnosis_status_unknown");
    },
    checking: function () {
      return t("features_diagnosis_status_checking");
    },
    ready: function () {
      return t("features_diagnosis_status_ready");
    },
    disabled: function () {
      return t("features_diagnosis_status_disabled");
    },
    incomplete: function () {
      return t("features_diagnosis_status_incomplete");
    },
    blocked: function () {
      return t("features_diagnosis_status_blocked");
    },
    error: function () {
      return t("features_diagnosis_status_error");
    },
  };

  var diagnosisIssues = {
    missing_channel: function (params) {
      return t("features_diagnosis_issue_missing_channel", params);
    },
    missing_announce_channel: function (params) {
      return t("features_diagnosis_issue_missing_announce_channel", params);
    },
    missing_role: function (params) {
      return t("features_diagnosis_issue_missing_role", params);
    },
    missing_message: function (params) {
      return t("features_diagnosis_issue_missing_message", params);
    },
    missing_entries: function (params) {
      return t("features_diagnosis_issue_missing_entries", params);
    },
    missing_streamer: function (params) {
      return t("features_diagnosis_issue_missing_streamer", params);
    },
    missing_twitch_credentials: function (params) {
      return t("features_diagnosis_issue_missing_twitch_credentials", params);
    },
    missing_stats_metric: function (params) {
      return t("features_diagnosis_issue_missing_stats_metric", params);
    },
    bot_member_unavailable: function (params) {
      return t("features_diagnosis_issue_bot_member_unavailable", params);
    },
    permission_missing: function (params) {
      return t("features_diagnosis_issue_permission_missing", params);
    },
    role_unavailable: function (params) {
      return t("features_diagnosis_issue_role_unavailable", params);
    },
    role_not_manageable: function (params) {
      return t("features_diagnosis_issue_role_not_manageable", params);
    },
    channel_unavailable: function (params) {
      return t("features_diagnosis_issue_channel_unavailable", params);
    },
    channel_permissions_unavailable: function (params) {
      return t(
        "features_diagnosis_issue_channel_permissions_unavailable",
        params,
      );
    },
    request_failed: function (params) {
      return t("features_diagnosis_issue_request_failed", params);
    },
  };

  var diagnosisPermissions = {
    ViewChannel: function () {
      return t("features_permission_ViewChannel");
    },
    SendMessages: function () {
      return t("features_permission_SendMessages");
    },
    EmbedLinks: function () {
      return t("features_permission_EmbedLinks");
    },
    AddReactions: function () {
      return t("features_permission_AddReactions");
    },
    ReadMessageHistory: function () {
      return t("features_permission_ReadMessageHistory");
    },
    ManageRoles: function () {
      return t("features_permission_ManageRoles");
    },
    KickMembers: function () {
      return t("features_permission_KickMembers");
    },
    ManageChannels: function () {
      return t("features_permission_ManageChannels");
    },
    CreatePrivateThreads: function () {
      return t("features_permission_CreatePrivateThreads");
    },
    SendMessagesInThreads: function () {
      return t("features_permission_SendMessagesInThreads");
    },
  };

  function diagnosisIssueText(issue) {
    var params = {};
    var permissionLabel = diagnosisPermissions[issue.permission];
    if (permissionLabel) params.permission = permissionLabel();
    var renderIssue =
      diagnosisIssues[issue.code] || diagnosisIssues.request_failed;
    return renderIssue(params);
  }

  function renderDiagnosis(card, diagnosis) {
    var panel = card && card.querySelector('[data-role="diagnosis"]');
    if (!panel || !diagnosis) return;

    panel.dataset.status = diagnosis.status || "error";
    var status = panel.querySelector('[data-role="diagnosis-status"]');
    if (status) {
      var renderStatus =
        diagnosisStatuses[diagnosis.status] || diagnosisStatuses.error;
      status.textContent = renderStatus();
    }

    var list = panel.querySelector('[data-role="diagnosis-issues"]');
    if (!list) return;
    var issues = Array.isArray(diagnosis.issues) ? diagnosis.issues : [];
    list.innerHTML = issues
      .map(function (issue) {
        var text = diagnosisIssueText(issue);
        if (issue.field) {
          return (
            '<li><button type="button" class="feature-diagnosis__field" data-role="diagnosis-focus" data-field-name="' +
            esc(issue.field) +
            '">' +
            esc(text) +
            "</button></li>"
          );
        }
        return "<li>" + esc(text) + "</li>";
      })
      .join("");
    list.classList.toggle("hidden", issues.length === 0);
    updateFeatureOverview();
  }

  function diagnosisResultKey(serverId, key) {
    return JSON.stringify([serverId, key]);
  }

  function persistDiagnosisResults() {
    try {
      sessionStorage.setItem(
        diagnosisStorageKey,
        JSON.stringify(diagnosisResults),
      );
    } catch {
      // Keep the in-memory result when browser storage is unavailable.
    }
  }

  function resetDiagnosis(card) {
    var panel = card && card.querySelector('[data-role="diagnosis"]');
    if (!panel) return;
    delete diagnosisResults[
      diagnosisResultKey(guildId(), card.getAttribute("data-feature"))
    ];
    persistDiagnosisResults();
    panel.dataset.status = "unknown";
    var status = panel.querySelector('[data-role="diagnosis-status"]');
    if (status) status.textContent = t("features_diagnosis_status_unknown");
    var list = panel.querySelector('[data-role="diagnosis-issues"]');
    if (list) {
      list.innerHTML = "";
      list.classList.add("hidden");
    }
    updateFeatureOverview();
  }

  async function diagnoseFeature(key) {
    var card = cardFor(key);
    var button = card && card.querySelector('[data-role="diagnose"]');
    var panel = card && card.querySelector('[data-role="diagnosis"]');
    var status = panel && panel.querySelector('[data-role="diagnosis-status"]');
    var gid = guildId();
    if (!card || !button || !gid || button.disabled) return;
    var resultKey = diagnosisResultKey(gid, key);

    button.disabled = true;
    if (panel) panel.dataset.status = "checking";
    if (status) status.textContent = t("features_diagnosis_status_checking");
    try {
      var result = await NS.apiGet(
        "/features/" +
          encodeURIComponent(key) +
          "/diagnose?guildId=" +
          encodeURIComponent(gid),
      );
      if (!result || result.ok === false || !result.diagnosis) {
        throw new Error((result && result.error) || "DIAGNOSIS_FAILED");
      }
      if (guildId() !== gid) return;
      diagnosisResults[resultKey] = result.diagnosis;
      persistDiagnosisResults();
      renderDiagnosis(card, result.diagnosis);
    } catch (err) {
      if (guildId() !== gid) return;
      console.error("Feature diagnosis error", err);
      diagnosisResults[resultKey] = {
        status: "error",
        issues: [{ code: "request_failed" }],
      };
      persistDiagnosisResults();
      renderDiagnosis(card, diagnosisResults[resultKey]);
    } finally {
      button.disabled = false;
    }
  }

  function cardHtml(feature) {
    var isConfigured = configuredFeatures[feature.key] === true;
    var isInherited =
      (feature.key === "antiSpam" || feature.key === "autoModeration") &&
      !isConfigured;
    var v =
      isConfigured || isInherited
        ? current[feature.key] || {}
        : { enabled: false };
    var enabled = v.enabled === true;
    var premiumModule = feature.premiumModule
      ? String(feature.premiumModule)
      : "";

    var fields = (feature.fields || [])
      .map(function (f) {
        return fieldHtml(feature.key, f, v[f.name]);
      })
      .join("");
    var advancedFields = (feature.advancedFields || [])
      .map(function (f) {
        return fieldHtml(feature.key, f, v[f.name]);
      })
      .join("");
    var advancedFieldsHtml = advancedFields
      ? '<details class="feature-advanced"><summary>' +
        esc(t("features_advanced_settings")) +
        '</summary><div class="feature-card__fields">' +
        advancedFields +
        "</div></details>"
      : "";

    var hasPublish = (feature.fields || [])
      .concat(feature.advancedFields || [])
      .some(function (f) {
        return f.type === "publish";
      });
    var publishLabel =
      current[feature.key] && current[feature.key].messageId
        ? t("features_republish")
        : t("features_publish");
    var actionsRight =
      hasPublish &&
      !(
        feature.key === "tickets" &&
        current[feature.key] &&
        current[feature.key].messageId
      )
        ? '<button class="btn xs" type="button" data-role="publish">' +
          esc(publishLabel) +
          "</button>"
        : "";

    // Chaves construídas fora do t(...) para o audit i18n não as interpretar como literais.
    var nameKey = "feature_" + snake(feature.key) + "_name";
    var descKey = "feature_" + snake(feature.key) + "_desc";

    // Presets: em vez de preencher tudo à mão, um clique aplica um conjunto
    // de valores recomendados (a configuração continua editável depois).
    var presetsHtml =
      feature.presets && feature.presets.length
        ? '<div class="feature-presets" data-role="presets">' +
          '<span class="feature-presets__label">' +
          esc(t("features_presets")) +
          "</span>" +
          feature.presets
            .map(function (p) {
              return (
                '<button type="button" class="chip preset-chip" data-role="preset" data-preset="' +
                esc(p.id) +
                '" aria-pressed="false">' +
                esc(t(p.label)) +
                "</button>"
              );
            })
            .join("") +
          '<button type="button" class="chip preset-chip" data-role="preset" data-preset="custom" aria-pressed="false">' +
          esc(t("features_preset_custom")) +
          "</button>" +
          "</div>"
        : "";

    var configStateHtml =
      '<span class="feature-card__config-state" data-role="config-state">' +
      esc(
        t(
          isConfigured
            ? "features_configured"
            : isInherited
              ? "features_inherited"
              : "features_not_configured",
        ),
      ) +
      "</span>";
    var setupHintHtml =
      isConfigured || isInherited
        ? ""
        : '<p class="hint" data-role="setup-hint">' +
          esc(t("features_setup_hint")) +
          "</p>";

    // Pré-visualização (boas-vindas/saída): espelha o embed enviado ao Discord.
    var previewHtml = feature.preview
      ? '<div class="embed-preview-wrap">' +
        '<span class="feature-presets__label">' +
        esc(t("preview_label")) +
        "</span>" +
        '<div class="embed-preview" data-role="preview"></div>' +
        "</div>"
      : "";

    return (
      "" +
      '<article class="feature-card' +
      (enabled ? "" : " is-off") +
      '"' +
      ' data-feature="' +
      esc(feature.key) +
      '"' +
      (premiumModule
        ? ' data-premium="true" data-premium-module="' +
          esc(premiumModule) +
          '"'
        : "") +
      ">" +
      '<div class="feature-card__head">' +
      '<label class="switch" title="' +
      esc(t("features_enabled")) +
      '">' +
      '<input type="checkbox" data-role="enabled"' +
      (enabled ? " checked" : "") +
      " />" +
      '<span class="slider"></span>' +
      "</label>" +
      '<h3 class="feature-card__name">' +
      esc(t(nameKey)) +
      "</h3>" +
      (premiumModule
        ? '<span class="feature-card__tier" data-i18n="premium_badge">' +
          esc(t("premium_badge")) +
          '</span><button type="button" class="btn xs btn-ghost premium-card__offer hidden" data-premium-action="offer" data-i18n="premium_offer_button" aria-haspopup="dialog">' +
          esc(t("premium_offer_button")) +
          "</button>"
        : "") +
      '<button type="button" class="icon-btn feature-card__toggle" data-role="toggle" aria-expanded="false" aria-controls="feature-body-' +
      esc(feature.key) +
      '" title="' +
      esc(t("features_details")) +
      '">▾</button>' +
      "</div>" +
      '<p class="hint">' +
      esc(t(descKey)) +
      "</p>" +
      configStateHtml +
      '<div class="feature-diagnosis" data-role="diagnosis" data-status="unknown">' +
      '<div class="feature-diagnosis__header">' +
      '<span class="feature-diagnosis__status" data-role="diagnosis-status" role="status" aria-live="polite">' +
      esc(t("features_diagnosis_status_unknown")) +
      "</span>" +
      '<button class="btn xs btn-ghost" type="button" data-role="diagnose">' +
      esc(t("features_diagnose")) +
      "</button>" +
      "</div>" +
      '<ul class="feature-diagnosis__issues hidden" data-role="diagnosis-issues"></ul>' +
      "</div>" +
      '<div class="feature-card__body hidden" id="feature-body-' +
      esc(feature.key) +
      '">' +
      setupHintHtml +
      presetsHtml +
      (fields ? '<div class="feature-card__fields">' + fields + "</div>" : "") +
      advancedFieldsHtml +
      previewHtml +
      '<div class="feature-card__actions">' +
      '<div class="feature-card__actions-left">' +
      '<button class="btn xs" type="button" data-role="save">' +
      esc(t("common_save")) +
      "</button>" +
      '<button class="btn xs" type="button" data-role="test">' +
      esc(t("features_test")) +
      "</button>" +
      '<span class="hint" data-role="status"></span>' +
      "</div>" +
      '<div class="feature-card__actions-right">' +
      actionsRight +
      "</div>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function featureCardEnabled(card) {
    var input = card.querySelector('[data-role="enabled"]');
    if (!input) {
      var module = card.getAttribute("data-premium-module");
      var inputIds = {
        gamenews: "gamenewsEnabled",
        tempvoice: "tempVoiceHeaderEnabled",
        trust: "trustEnabled",
        giveaways: "giveawaysEnabled",
      };
      input = inputIds[module] ? byId(inputIds[module]) : null;
    }
    return !!(input && input.checked);
  }

  function featureCardNeedsAttention(card) {
    var diagnosis = card.querySelector('[data-role="diagnosis"]');
    var status = diagnosis ? diagnosis.dataset.status : "unknown";
    return ["incomplete", "blocked", "error"].includes(status);
  }

  function updateFeatureOverview() {
    var grid = byId("featuresGrid");
    if (!grid) return;
    var cards = Array.prototype.slice.call(
      grid.querySelectorAll(".feature-card"),
    );
    var counts = {
      all: cards.length,
      active: 0,
      attention: 0,
      disabled: 0,
    };
    cards.forEach(function (card) {
      if (featureCardEnabled(card)) counts.active++;
      else counts.disabled++;
      if (featureCardNeedsAttention(card)) counts.attention++;
    });
    Object.keys(counts).forEach(function (filter) {
      var counter = document.querySelector(
        '[data-filter-count="' + filter + '"]',
      );
      if (counter) counter.textContent = String(counts[filter]);
    });
    filterFeatureCards();
  }

  NS.refreshFeatureOverview = updateFeatureOverview;

  function filterFeatureCards() {
    var grid = byId("featuresGrid");
    var search = byId("featuresSearch");
    if (!grid) return;

    var query = normalizeSearchText(search ? search.value : "");
    var visibleCount = 0;
    Array.prototype.slice
      .call(grid.querySelectorAll(".feature-card"))
      .forEach(function (card) {
        var name = card.querySelector(".feature-card__name");
        var description = card.querySelector(".feature-card__head + .hint");
        var searchableText = normalizeSearchText(
          (name ? name.textContent : "") +
            " " +
            (description ? description.textContent : ""),
        );
        var isActive = featureCardEnabled(card);
        var matchesFilter =
          activeFeatureFilter === "all" ||
          (activeFeatureFilter === "active" && isActive) ||
          (activeFeatureFilter === "disabled" && !isActive) ||
          (activeFeatureFilter === "attention" &&
            featureCardNeedsAttention(card));
        var matchesSearch = !query || searchableText.indexOf(query) !== -1;
        var matches = matchesFilter && matchesSearch;
        card.classList.toggle("hidden", !matches);
        if (matches) visibleCount += 1;
      });

    var emptyState = byId("featuresNoResults");
    if (emptyState) emptyState.classList.toggle("hidden", visibleCount > 0);
  }

  function bindFeatureSearch() {
    var search = byId("featuresSearch");
    if (search && search.dataset.bound !== "true") {
      search.dataset.bound = "true";
      search.addEventListener("input", filterFeatureCards);
    }
    var filters = byId("featuresFilters");
    if (filters && filters.dataset.bound !== "true") {
      filters.dataset.bound = "true";
      filters.addEventListener("click", function (event) {
        var button = event.target.closest("[data-feature-filter]");
        if (!button) return;
        activeFeatureFilter =
          button.getAttribute("data-feature-filter") || "all";
        Array.prototype.forEach.call(
          filters.querySelectorAll("[data-feature-filter]"),
          function (item) {
            var selected = item === button;
            item.classList.toggle("is-selected", selected);
            item.setAttribute("aria-pressed", selected ? "true" : "false");
          },
        );
        filterFeatureCards();
      });
    }
  }

  function render() {
    var grid = byId("featuresGrid");
    if (!grid) return;
    grid.innerHTML = FEATURES.map(cardHtml).join("");
    appendStaticPremiumCards(grid);
    bindFeatureSearch();
    Array.prototype.slice
      .call(grid.querySelectorAll(".feature-card"))
      .forEach(function (card) {
        wireCard(card);
        var diagnosis =
          diagnosisResults[
            diagnosisResultKey(guildId(), card.getAttribute("data-feature"))
          ];
        if (diagnosis) renderDiagnosis(card, diagnosis);
      });
    applyPremiumState();
    updateFeatureOverview();
  }

  function applyPremiumState(active) {
    if (typeof active === "boolean") premiumActive = active;
    var grid = byId("featuresGrid");
    if (!grid) return;
    Array.prototype.slice
      .call(grid.querySelectorAll(".feature-card"))
      .forEach(function (card) {
        if (card.getAttribute("data-premium") === "true") {
          card.setAttribute(
            "data-premium-locked",
            premiumActive ? "false" : "true",
          );
          var offerButton = card.querySelector('[data-premium-action="offer"]');
          if (offerButton)
            offerButton.classList.toggle("hidden", premiumActive);
          var detailsToggle = card.querySelector(".feature-card__toggle");
          if (detailsToggle)
            detailsToggle.classList.toggle("hidden", !premiumActive);
        }
        applyDisabled(card);
      });
  }

  // -----------------------------
  // Interação
  // -----------------------------

  function cardFor(key) {
    var grid = byId("featuresGrid");
    return grid
      ? grid.querySelector('.feature-card[data-feature="' + key + '"]')
      : null;
  }

  function setCardExpanded(card, expanded) {
    var body = card && card.querySelector(".feature-card__body");
    var toggle = card && card.querySelector(".feature-card__toggle");
    if (!body || !toggle) return false;

    if (expanded && card.parentElement) {
      Array.prototype.forEach.call(
        card.parentElement.children,
        function (sibling) {
          if (
            sibling !== card &&
            sibling.classList &&
            sibling.classList.contains("is-expanded")
          ) {
            setCardExpanded(sibling, false);
          }
        },
      );
    }

    body.inert = !expanded;
    body.classList.toggle("hidden", !expanded);
    card.classList.toggle("is-expanded", expanded);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    return expanded;
  }

  function toggleCardDetails(card) {
    var body = card && card.querySelector(".feature-card__body");
    return body
      ? setCardExpanded(card, body.classList.contains("hidden"))
      : false;
  }

  function updateConfigState(card) {
    if (!card) return;
    var key = card.getAttribute("data-feature");
    var state = card.querySelector('[data-role="config-state"]');
    var setupHint = card.querySelector('[data-role="setup-hint"]');
    var isConfigured = configuredFeatures[key] === true;
    var isInherited =
      (key === "antiSpam" || key === "autoModeration") && !isConfigured;
    var isDirty = card.getAttribute("data-dirty") === "true";
    if (state) {
      state.textContent = t(
        isDirty
          ? "features_unsaved"
          : isConfigured
            ? "features_configured"
            : isInherited
              ? "features_inherited"
              : "features_not_configured",
      );
    }
    if (setupHint)
      setupHint.classList.toggle(
        "hidden",
        isConfigured || isInherited || isDirty,
      );
  }

  function markCardDraft(card, preservePreset) {
    if (!card) return;
    card.setAttribute("data-dirty", "true");
    var feature = FEATURES.filter(function (item) {
      return item.key === card.getAttribute("data-feature");
    })[0];
    if (feature && feature.presets && !preservePreset) {
      card.setAttribute("data-selected-preset", "custom");
      Array.prototype.forEach.call(
        card.querySelectorAll('[data-role="preset"]'),
        function (button) {
          button.setAttribute(
            "aria-pressed",
            button.getAttribute("data-preset") === "custom" ? "true" : "false",
          );
        },
      );
    }
    updateConfigState(card);
  }

  function applyDisabled(card) {
    if (!card) return;
    var key = card.getAttribute("data-feature");
    var enabledEl = card.querySelector('[data-role="enabled"]');
    var on = !!(enabledEl && enabledEl.checked);
    var premiumLocked =
      card.getAttribute("data-premium") === "true" && !premiumActive;
    var saving = card.getAttribute("data-saving") === "true";
    card.classList.toggle("is-off", !on);
    card.classList.toggle("is-premium-locked", premiumLocked);
    Array.prototype.slice
      .call(
        card.querySelectorAll(
          '[data-field], [data-entry], [data-role="save"], [data-role="test"], [data-role="add-entry"], [data-role="entry-remove"], [data-role="publish"], [data-role="preset"]',
        ),
      )
      .forEach(function (el) {
        el.disabled = premiumLocked || saving;
      });
    var testBtn = card.querySelector('[data-role="test"]');
    var publishBtn = card.querySelector('[data-role="publish"]');
    if (testBtn) testBtn.disabled = !on || premiumLocked || saving;
    if (publishBtn) publishBtn.disabled = !on || premiumLocked || saving;
    if (enabledEl)
      enabledEl.disabled =
        premiumLocked || saving || configuredFeatures[key] !== true;
  }

  function wireCard(card) {
    var key = card.getAttribute("data-feature");
    var feature = FEATURES.filter(function (f) {
      return f.key === key;
    })[0];
    if (!feature) return;

    var toggle = card.querySelector('[data-role="toggle"]');
    var enabledEl = card.querySelector('[data-role="enabled"]');
    var saveBtn = card.querySelector('[data-role="save"]');
    var testBtn = card.querySelector('[data-role="test"]');
    var diagnoseBtn = card.querySelector('[data-role="diagnose"]');
    var publishBtn = card.querySelector('[data-role="publish"]');
    var addEntryBtn = card.querySelector('[data-role="add-entry"]');
    var entriesBox = card.querySelector('[data-role="entries"]');
    var presetsBox = card.querySelector('[data-role="presets"]');
    var previewBox = card.querySelector('[data-role="preview"]');

    if (toggle) {
      toggle.addEventListener("click", function () {
        toggleCardDetails(card);
      });
    }

    if (enabledEl) {
      enabledEl.addEventListener("change", function () {
        if (card.getAttribute("data-dirty") === "true") {
          enabledEl.checked = !!(current[key] && current[key].enabled);
          notify(t("features_save_before_toggle"), { type: "info" });
          return;
        }
        resetDiagnosis(card);
        applyDisabled(card);
        saveFeature(key);
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        saveFeature(key);
      });
    }

    if (testBtn) {
      testBtn.addEventListener("click", function () {
        testFeature(key);
      });
    }

    if (diagnoseBtn) {
      diagnoseBtn.addEventListener("click", function () {
        diagnoseFeature(key);
      });
    }

    if (publishBtn) {
      publishBtn.addEventListener("click", function () {
        publishFeature(key);
      });
    }

    if (addEntryBtn && entriesBox) {
      addEntryBtn.addEventListener("click", function () {
        var wrapper = document.createElement("div");
        wrapper.innerHTML = entryRowHtml(null);
        var row = wrapper.firstChild;
        entriesBox.appendChild(row);
        applyDisabled(card);
      });
    }

    if (presetsBox) {
      presetsBox.addEventListener("click", function (ev) {
        var btn =
          ev.target && ev.target.closest
            ? ev.target.closest('[data-role="preset"]')
            : null;
        if (!btn) return;
        applyPreset(key, btn.getAttribute("data-preset"), btn);
      });
    }

    var fieldsWraps = card.querySelectorAll(".feature-card__fields");
    var refreshPreview = previewBox
      ? function () {
          renderEmbedPreview(card, feature, previewBox);
        }
      : null;
    Array.prototype.forEach.call(fieldsWraps, function (fieldsWrap) {
      fieldsWrap.addEventListener("input", function () {
        markCardDraft(card);
        resetDiagnosis(card);
        if (refreshPreview) refreshPreview();
      });
      fieldsWrap.addEventListener("change", function () {
        markCardDraft(card);
        resetDiagnosis(card);
        if (refreshPreview) refreshPreview();
      });
    });
    if (refreshPreview) refreshPreview();

    card.addEventListener("click", function (ev) {
      var target = ev.target;
      var diagnosisField =
        target && target.closest
          ? target.closest('[data-role="diagnosis-focus"]')
          : null;
      if (diagnosisField) {
        var fieldName = diagnosisField.getAttribute("data-field-name");
        var field =
          fieldName === "entries"
            ? card.querySelector('[data-role="add-entry"]')
            : fieldName
              ? card.querySelector('[data-field="' + fieldName + '"]')
              : null;
        if (field) {
          setCardExpanded(card, true);
          field.focus();
        }
        return;
      }
      if (
        target &&
        target.closest &&
        target.closest('[data-role="entry-remove"]')
      ) {
        var row = target.closest('[data-role="entry-row"]');
        if (row && row.parentNode) row.parentNode.removeChild(row);
      }
    });

    applyDisabled(card);
  }

  function collect(key) {
    var feature = FEATURES.filter(function (f) {
      return f.key === key;
    })[0];
    var card = cardFor(key);
    var prev = current[key] || {};
    var out = {};
    Object.keys(prev).forEach(function (k) {
      out[k] = prev[k];
    });
    if (!feature || !card) return out;

    var enabledEl = card.querySelector('[data-role="enabled"]');
    out.enabled = !!(enabledEl && enabledEl.checked);

    (feature.fields || [])
      .concat(feature.advancedFields || [])
      .forEach(function (f) {
        if (f.type === "publish" || f.type === "simulation") return;

        if (f.type === "entries") {
          out.entries = Array.prototype.slice
            .call(card.querySelectorAll('[data-role="entry-row"]'))
            .map(function (row) {
              var emojiEl = row.querySelector('[data-entry="emoji"]');
              var roleEl = row.querySelector('[data-entry="roleId"]');
              return {
                emoji: emojiEl ? String(emojiEl.value || "").trim() : "",
                roleId: roleEl ? String(roleEl.value || "").trim() : "",
              };
            })
            .filter(function (e) {
              return e.emoji && e.roleId;
            });
          return;
        }

        var el = card.querySelector('[data-field="' + f.name + '"]');
        if (!el) return;

        if (f.type === "bool") {
          out[f.name] = !!el.checked;
        } else if (f.type === "multiRole" || f.type === "multiChannel") {
          out[f.name] = Array.prototype.map
            .call(el.selectedOptions || [], function (option) {
              return String(option.value || "").trim();
            })
            .filter(Boolean);
        } else if (f.type === "number") {
          var rawNumber = String(el.value || "").trim();
          var n = rawNumber ? Number(rawNumber) : NaN;
          out[f.name] = Number.isFinite(n)
            ? n
            : prev[f.name] != null
              ? prev[f.name]
              : null;
        } else {
          var v = String(el.value || "").trim();
          out[f.name] = v ? v : null;
        }
      });

    return out;
  }

  // Presets only populate the draft. Saving and enabling remain explicit.
  function applyPreset(key, presetId, button) {
    var feature = FEATURES.filter(function (f) {
      return f.key === key;
    })[0];
    var card = cardFor(key);
    if (!feature || !card || !feature.presets) return;

    var preset =
      presetId === "custom"
        ? { id: "custom", values: {} }
        : feature.presets.filter(function (p) {
            return p.id === presetId;
          })[0];
    if (!preset) return;

    if (presetId !== "custom") {
      Object.keys(preset.values || {}).forEach(function (name) {
        var el = card.querySelector('[data-field="' + name + '"]');
        if (!el) return;
        var val = preset.values[name];
        if (typeof val === "function") val = val();
        if (el.type === "checkbox") {
          el.checked = val === true;
        } else {
          el.value = val == null ? "" : String(val);
        }
      });
      var advancedDetails = card.querySelector(".feature-advanced");
      if (
        advancedDetails &&
        Object.keys(preset.values || {}).some(function (name) {
          return advancedDetails.querySelector('[data-field="' + name + '"]');
        })
      ) {
        advancedDetails.open = true;
      }
    }

    var previewBox = card.querySelector('[data-role="preview"]');
    if (previewBox) renderEmbedPreview(card, feature, previewBox);
    card.setAttribute("data-selected-preset", presetId);
    Array.prototype.forEach.call(
      card.querySelectorAll('[data-role="preset"]'),
      function (presetButton) {
        presetButton.setAttribute(
          "aria-pressed",
          presetButton === button ? "true" : "false",
        );
      },
    );
    setCardExpanded(card, true);
    markCardDraft(card, true);
    resetDiagnosis(card);
    notify(t("features_preset_applied"), { type: "info" });
  }

  function updateMessageIdLabel(key) {
    var card = cardFor(key);
    if (!card) return;
    var label = card.querySelector('[data-role="message-id"]');
    if (!label) return;
    var id =
      current[key] && current[key].messageId
        ? String(current[key].messageId)
        : "";
    label.textContent = id ? t("features_message_published", { id: id }) : "";
  }

  async function saveFeature(key, silent) {
    var gid = guildId();
    if (!gid) return;

    var card = cardFor(key);
    if (card && card.getAttribute("data-saving") === "true") return false;
    var value = collect(key);
    var feature = FEATURES.filter(function (item) {
      return item.key === key;
    })[0];
    if (configuredFeatures[key] !== true) {
      var hasPresets = feature && feature.presets && feature.presets.length;
      var selectedPreset = card && card.getAttribute("data-selected-preset");
      var missing = (requiredSetupFields[key] || []).some(function (name) {
        if (name === "entries") return !value.entries || !value.entries.length;
        if (name === "serverStats")
          return !value.showMembers && !value.showJoins && !value.showLeaves;
        return value[name] == null || value[name] === "";
      });
      if ((hasPresets && !selectedPreset) || missing) {
        notify(t("features_setup_incomplete"), { type: "warn" });
        return false;
      }
    }
    var saveBtn = card ? card.querySelector('[data-role="save"]') : null;
    var statusEl = card ? card.querySelector('[data-role="status"]') : null;

    // Proteção contra duplo clique / pedidos repetidos.
    if (card) {
      card.setAttribute("data-saving", "true");
      applyDisabled(card);
    }
    if (saveBtn) saveBtn.disabled = true;

    try {
      var res = await NS.apiPost("/features", {
        guildId: gid,
        feature: key,
        value: value,
      });
      if (!res || res.ok === false)
        throw new Error((res && res.error) || "ERROR");
      current[key] = res && res.value ? res.value : value;
      configuredFeatures[key] = true;
      card.setAttribute("data-dirty", "false");
      updateConfigState(card);
      resetDiagnosis(card);
      if (!silent) {
        if (statusEl) statusEl.textContent = "";
        notify(t("features_saved"), { type: "success" });
      }
      if (value && Object.prototype.hasOwnProperty.call(value, "messageId"))
        updateMessageIdLabel(key);
      return true;
    } catch (err) {
      console.error("Feature save error", err);
      var enabledEl = card ? card.querySelector('[data-role="enabled"]') : null;
      if (enabledEl)
        enabledEl.checked = !!(current[key] && current[key].enabled);
      if (statusEl) statusEl.textContent = "";
      notify(
        t(
          err && err.apiMessage === "PREMIUM_REQUIRED"
            ? "premium_lock_hint"
            : "features_save_error",
        ),
        { type: "error" },
      );
      return false;
    } finally {
      if (card) card.removeAttribute("data-saving");
      if (saveBtn) saveBtn.disabled = false;
      applyDisabled(card);
      updateFeatureOverview();
    }
  }

  // Guarda a configuração atual e envia uma amostra da funcionalidade.
  async function testFeature(key) {
    var gid = guildId();
    if (!gid) return;

    var card = cardFor(key);
    var btn = card ? card.querySelector('[data-role="test"]') : null;
    var statusEl = card ? card.querySelector('[data-role="status"]') : null;
    if (btn) btn.disabled = true;

    try {
      var testPayload = { guildId: gid };
      if (key === "autoModeration") {
        var sampleField =
          card && card.querySelector('[data-field="simulationMessage"]');
        var sampleMessage = sampleField
          ? String(sampleField.value || "").trim()
          : "";
        if (!sampleMessage) {
          notify(t("features_automod_simulation_required"), { type: "warn" });
          return;
        }
        testPayload.testMessage = sampleMessage.slice(0, 1000);
        testPayload.config = collect(key);
      } else {
        var saved = await saveFeature(key, true);
        if (!saved) throw new Error("SAVE_FAILED");
      }
      var res = await NS.apiPost(
        "/features/" + encodeURIComponent(key) + "/test",
        testPayload,
      );
      if (!res || res.ok === false)
        throw new Error((res && res.error) || "ERROR");
      var infoKey = res.info
        ? "features_test_info_" + res.info
        : "features_test_ok";
      if (statusEl) statusEl.textContent = t(infoKey, res.data || {});
      notify(t(infoKey, res.data || {}), { type: "success" });
    } catch (err) {
      console.error("Feature test error", err);
      if (statusEl) statusEl.textContent = "";
      var errorKey =
        err && err.apiMessage === "PREMIUM_REQUIRED"
          ? "premium_lock_hint"
          : err && err.apiMessage === "TWITCH_CREDENTIALS_MISSING"
            ? "features_twitch_credentials_missing"
            : "features_test_error";
      notify(t(errorKey), { type: "error" });
    } finally {
      if (btn) btn.disabled = false;
      applyDisabled(card);
    }
  }

  async function publishFeature(key) {
    var gid = guildId();
    if (!gid) return;

    var card = cardFor(key);
    var btn = card ? card.querySelector('[data-role="publish"]') : null;
    if (btn) btn.disabled = true;

    try {
      var saved = await saveFeature(key, true);
      if (!saved) throw new Error("SAVE_FAILED");
      var res = await NS.apiPost(
        "/features/" + encodeURIComponent(key) + "/publish",
        { guildId: gid },
      );
      if (!res || res.ok === false)
        throw new Error((res && res.error) || "ERROR");
      if (res.value) current[key] = res.value;
      updateMessageIdLabel(key);
      notify(t("features_publish_ok"), { type: "success" });
    } catch (err) {
      console.error("Feature publish error", err);
      notify(
        t(
          err && err.apiMessage === "PREMIUM_REQUIRED"
            ? "premium_lock_hint"
            : "features_publish_error",
        ),
        { type: "error" },
      );
    } finally {
      if (btn) btn.disabled = false;
      applyDisabled(card);
    }
  }

  // -----------------------------
  // Carregamento
  // -----------------------------

  async function loadMeta(gid) {
    if (metaGuildId !== gid) {
      channels = null;
      roles = null;
      metaGuildId = gid;
    }
    if (channels && roles) return;

    try {
      var ch = await NS.apiGet(
        "/guilds/" + encodeURIComponent(gid) + "/channels",
      );
      channels = ch && (ch.items || ch.channels) ? ch.items || ch.channels : [];
    } catch {
      channels = channels || [];
    }

    try {
      var meta = await NS.apiGet(
        "/guilds/" + encodeURIComponent(gid) + "/meta",
      );
      roles = meta && meta.roles ? meta.roles : [];
    } catch {
      roles = roles || [];
    }
  }

  async function loadFeatures() {
    var grid = byId("featuresGrid");
    if (!grid) return;

    var gid = guildId();
    if (!gid) {
      current = {};
      configuredFeatures = {};
      grid.innerHTML = "";
      appendStaticPremiumCards(grid);
      return;
    }
    if (loading) return;
    loading = true;

    try {
      await loadMeta(gid);
      var data = await NS.apiGet(
        "/features?guildId=" + encodeURIComponent(gid),
      );
      current = data && data.features ? data.features : {};
      configuredFeatures =
        data && data.configuredFeatures ? data.configuredFeatures : {};
      FEATURES.forEach(function (feature) {
        if (configuredFeatures[feature.key] !== true)
          current[feature.key] = { enabled: false };
      });
      render();
      FEATURES.forEach(function (feature) {
        if (
          configuredFeatures[feature.key] === true &&
          current[feature.key] &&
          current[feature.key].enabled === true
        ) {
          diagnoseFeature(feature.key);
        }
      });
    } catch (err) {
      console.error("Features load error", err);
      notify(t("features_load_error"), { type: "error" });
    } finally {
      loading = false;
    }
  }

  NS.loadFeatures = loadFeatures;
  NS.applyPremiumState = applyPremiumState;
  NS.toggleFeatureCard = toggleCardDetails;
})();
