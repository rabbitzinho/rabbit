// GameNews module extension for OzarkDashboard
// Implementa a tab GameNews no mesmo padrão da tab Utilizadores:
// lista à esquerda + painel de detalhe à direita.

(function () {
  if (!window.OzarkDashboard) return;

  const D = window.OzarkDashboard;
  const state = D.state;
  const apiGet = D.apiGet;
  const apiPost = D.apiPost;
  const toast = D.toast;
  const t = D.t;
  const escapeHtml = D.escapeHtml;

  // ------------------------
  // Helpers internos
  // ------------------------

  let _gameNewsDetailTimeout = null;

  function gameNewsBackupKey(guildId) {
    return "rabbit.gamenews.backup.v1:" + String(guildId || "");
  }

  function readGameNewsBackup(guildId) {
    try {
      const stored = JSON.parse(
        localStorage.getItem(gameNewsBackupKey(guildId)) || "[]",
      );
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  function writeGameNewsBackup(guildId, feeds) {
    try {
      const key = gameNewsBackupKey(guildId);
      if (Array.isArray(feeds) && feeds.length) {
        localStorage.setItem(key, JSON.stringify(feeds));
      } else {
        localStorage.removeItem(key);
      }
    } catch (err) {
      console.warn("Could not update the local GameNews backup.", err);
    }
  }

  function showGameNewsBackupNotice(feeds) {
    const notice = document.getElementById("gamenewsBackupNotice");
    const message = document.getElementById("gamenewsBackupMessage");
    const backup = Array.isArray(feeds) ? feeds : [];
    state.gameNewsBackupFeeds = backup;
    if (notice) notice.classList.toggle("hidden", backup.length === 0);
    if (message && backup.length) {
      message.textContent = t("gamenews_backup_available", {
        count: backup.length.toLocaleString(state.lang),
      });
    }
  }

  function makeStatusKey(obj) {
    // Key used to correlate a feed configuration with its status entry.
    // We need to support both:
    //  - feed objects from /api/gamenews/feeds   -> { name, feedUrl, channelId }
    //  - status objects from /api/gamenews-status -> { feedName, feedUrl, channelId }
    if (!obj) return "";
    let feedUrl = "";
    let channelId = "";
    let name = "";

    try {
      // Some callers use feedUrl, others still expose the DB field as "feed".
      feedUrl = (
        obj.feedUrl != null
          ? String(obj.feedUrl)
          : obj.feed != null
            ? String(obj.feed)
            : ""
      ).trim();
    } catch {}
    try {
      channelId = (obj.channelId != null ? String(obj.channelId) : "").trim();
    } catch {}
    try {
      // Prefer "name", but fall back to "feedName" (used by status payloads).
      name =
        obj.name != null
          ? String(obj.name)
          : obj.feedName != null
            ? String(obj.feedName)
            : "";
    } catch {}

    return JSON.stringify({
      feedUrl,
      channelId,
      name,
    });
  }

  function buildStatusIndex(items) {
    const idx = {};
    if (!Array.isArray(items)) return idx;
    items.forEach(function (it) {
      if (!it) return;
      const key = makeStatusKey(it);
      if (key) idx[key] = it;
    });
    return idx;
  }

  function formatDateTimeShort(value) {
    if (!value) return "";
    try {
      if (D && typeof D.formatDateTime === "function") {
        return D.formatDateTime(value);
      }
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch {
      return "";
    }
  }

  function formatIntervalMinutes(ms) {
    if (!ms || typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0)
      return "";
    const mins = ms / 60000;
    if (Number.isInteger(mins)) return String(mins);
    return String(Math.round(mins * 10) / 10);
  }

  function buildChannelOptions(channels, selectedId, allowNone) {
    const list = Array.isArray(channels) ? channels : [];
    const seen = new Set();
    let html = "";
    if (allowNone) {
      html += `<option value="">${escapeHtml(t("common_none_option") || "— None —")}</option>`;
    }
    list.forEach(function (ch) {
      if (!ch || !ch.id) return;
      const id = String(ch.id);
      if (seen.has(id)) return;
      seen.add(id);
      const name = ch.name ? String(ch.name) : id;
      const selected =
        selectedId && String(selectedId) === id ? " selected" : "";
      html += `<option value="${escapeHtml(id)}"${selected}>#${escapeHtml(name)} (${escapeHtml(id)})</option>`;
    });

    // If current selection is not in the list (e.g., missing perms or a different channel type),
    // keep it selectable so saving doesn't wipe it.
    if (selectedId && !seen.has(String(selectedId))) {
      const id = String(selectedId);
      html += `<option value="${escapeHtml(id)}" selected>${escapeHtml(id)}</option>`;
    }
    return html;
  }

  function normalizeUrlMaybe(value) {
    if (!value) return "";
    const v = String(value).trim();
    if (!v) return "";
    // If user typed without protocol, assume https.
    if (!/^https?:\/\//i.test(v) && /^[\w.-]+\.[a-z]{2,}/i.test(v)) {
      return "https://" + v;
    }
    return v;
  }

  // Parse a comma/newline separated string into a clean keyword list.
  function parseKeywordsInput(value) {
    const raw = Array.isArray(value)
      ? value
      : String(value == null ? "" : value).split(/[,\n]/);
    const out = [];
    const seen = new Set();
    raw.forEach(function (item) {
      const k = String(item == null ? "" : item)
        .trim()
        .toLowerCase();
      if (!k || k.length > 64) return;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(k);
    });
    return out.slice(0, 50);
  }

  // Parse a comma/newline separated string (or array) into a clean list of channel IDs.
  // Accepts raw IDs and Discord mentions like <#123...>; keeps invalid entries so the
  // editor can flag them instead of silently dropping the user's input.
  function parseChannelIdsInput(value) {
    const raw = Array.isArray(value)
      ? value
      : String(value == null ? "" : value).split(/[,\n]/);
    const out = [];
    const seen = new Set();
    raw.forEach(function (item) {
      const s = String(item == null ? "" : item).trim();
      if (!s) return;
      const digits = s.replace(/[^\d]/g, "");
      const id = digits || s;
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out.slice(0, 5);
  }

  const CHANNEL_ID_RE = /^[0-9]{10,32}$/;

  function validateFeedConfig(feed) {
    const errors = {};
    const feedUrl = normalizeUrlMaybe(feed && feed.feedUrl);
    const channelId =
      feed && feed.channelId != null ? String(feed.channelId).trim() : "";
    const maxPerCycleRaw =
      feed && feed.maxPerCycle != null ? String(feed.maxPerCycle).trim() : "";
    if (!feedUrl) {
      errors.feedUrl = t("gamenews_validation_url_required");
    } else {
      // Be permissive: some valid RSS endpoints fail stricter URL parsing.
      // Backend also validates protocol and rejects whitespace.
      if (!/^https?:\/\/\S+$/i.test(feedUrl)) {
        errors.feedUrl = t("gamenews_validation_url_invalid");
      }
    }
    if (!channelId) {
      errors.channelId = t("gamenews_validation_channel_required");
    }

    if (maxPerCycleRaw) {
      const n = parseInt(maxPerCycleRaw, 10);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        errors.maxPerCycle = t("gamenews_validation_max_per_cycle_invalid");
      }
    }

    const extraChannelIds = parseChannelIdsInput(feed && feed.extraChannelIds);
    if (
      extraChannelIds.some(function (id) {
        return !CHANNEL_ID_RE.test(id);
      })
    ) {
      errors.extraChannelIds = t("gamenews_validation_extra_channels_invalid");
    }
    return {
      ok: Object.keys(errors).length === 0,
      errors,
      normalized: { feedUrl, channelId },
    };
  }

  function setFieldError(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function setInputError(inputEl, hasError) {
    if (!inputEl) return;
    if (hasError) inputEl.classList.add("input-error");
    else inputEl.classList.remove("input-error");
  }

  // ------------------------
  // Dirty-state (unsaved changes) tracking for GameNews editor
  // ------------------------

  function ensureGameNewsMaps() {
    if (!state.gameNewsOriginalByKey) state.gameNewsOriginalByKey = {};
  }

  function feedKey(feed) {
    if (!feed) return "";
    const id = feed.id || feed._id || feed._mongoId;
    if (id) return String(id);
    return makeStatusKey(feed);
  }

  function snapshotFeed(feed) {
    if (!feed) return "";
    const url = normalizeUrlMaybe(feed.feedUrl);
    const channelId =
      feed.channelId != null ? String(feed.channelId).trim() : "";
    const logChannelId =
      feed.logChannelId != null ? String(feed.logChannelId).trim() : "";
    const name = feed.name != null ? String(feed.name).trim() : "";
    const enabled = feed.enabled !== false;
    const intervalMs =
      typeof feed.intervalMs === "number" &&
      Number.isFinite(feed.intervalMs) &&
      feed.intervalMs > 0
        ? Math.round(feed.intervalMs)
        : null;
    const maxPerCycle =
      typeof feed.maxPerCycle === "number" && Number.isFinite(feed.maxPerCycle)
        ? Math.round(feed.maxPerCycle)
        : null;
    const excludeKeywords = parseKeywordsInput(feed.excludeKeywords);
    const extraChannelIds = parseChannelIdsInput(feed.extraChannelIds);
    return JSON.stringify({
      name,
      feedUrl: url,
      channelId,
      logChannelId: logChannelId || null,
      extraChannelIds,
      enabled,
      intervalMs,
      maxPerCycle,
      excludeKeywords,
    });
  }

  function setOriginalForFeeds(feeds) {
    ensureGameNewsMaps();
    const map = {};
    (Array.isArray(feeds) ? feeds : []).forEach(function (f) {
      const k = feedKey(f);
      if (!k) return;
      map[k] = snapshotFeed(f);
    });
    state.gameNewsOriginalByKey = map;
  }

  function isFeedDirty(feed) {
    ensureGameNewsMaps();
    const k = feedKey(feed);
    if (!k) return true;
    const orig = state.gameNewsOriginalByKey[k];
    if (!orig) return true; // new/unsaved feed
    return snapshotFeed(feed) !== orig;
  }

  D.hasUnsavedGameNewsChanges = function () {
    const feeds = Array.isArray(state.gameNewsFeeds) ? state.gameNewsFeeds : [];
    return feeds.some(isFeedDirty);
  };

  function pruneOriginalMap(feeds) {
    ensureGameNewsMaps();
    const keep = new Set();
    (Array.isArray(feeds) ? feeds : []).forEach(function (f) {
      const k = feedKey(f);
      if (k) keep.add(k);
    });
    const next = {};
    Object.keys(state.gameNewsOriginalByKey).forEach(function (k) {
      if (keep.has(k)) next[k] = state.gameNewsOriginalByKey[k];
    });
    state.gameNewsOriginalByKey = next;
  }

  function updateGameNewsFeedRowByIndex(idx) {
    const listEl = document.getElementById("gamenewsFeedsList");
    if (!listEl) return;
    const row = listEl.querySelector(
      '.list-item[data-index="' + String(idx) + '"]',
    );
    if (!row) return;
    const f = Array.isArray(state.gameNewsFeeds)
      ? state.gameNewsFeeds[idx]
      : null;
    if (!f) return;

    const nameEl = row.querySelector(".title");
    const badgeEl = row.querySelector(".user-type-badge");
    const subtitleEl = row.querySelector(".subtitle");
    if (!nameEl || !badgeEl || !subtitleEl) return;

    const name = f.name || "Feed";
    const feedUrl = f.feedUrl || "";
    const channelId = f.channelId || "";
    const enabled = f.enabled !== false;

    const v = validateFeedConfig({ feedUrl: feedUrl, channelId: channelId });
    const complete = v && v.ok;

    const st = state.gameNewsStatusIndex
      ? state.gameNewsStatusIndex[makeStatusKey(f)]
      : null;
    const hasStatusError = !!(st && st.lastError);

    const dirty = isFeedDirty(f);

    let badgeClass = "human";
    let badgeText = t("gamenews_feed_status_on");
    if (!complete) {
      badgeClass = "warn";
      badgeText = t("gamenews_feed_status_incomplete");
    } else if (dirty) {
      badgeClass = "warn";
      badgeText = t("gamenews_feed_status_dirty");
    } else if (hasStatusError) {
      badgeClass = "error";
      badgeText = t("gamenews_feed_status_error");
    } else {
      badgeClass = enabled ? "human" : "bot";
      badgeText = enabled
        ? t("gamenews_feed_status_on")
        : t("gamenews_feed_status_off");
    }

    nameEl.textContent = name;
    badgeEl.className = "user-type-badge " + badgeClass;
    badgeEl.textContent = badgeText;
    badgeEl.title =
      hasStatusError && st.lastError ? String(st.lastError) : badgeText;

    subtitleEl.textContent =
      (feedUrl || "") + (channelId ? " • " + channelId : "");

    if (dirty) row.classList.add("dirty");
    else row.classList.remove("dirty");
  }

  // ------------------------
  // Render da lista de feeds
  // ------------------------

  function renderGameNewsFeedsList(feeds) {
    const listEl = document.getElementById("gamenewsFeedsList");
    updateGameNewsEnabledToggle();
    if (!listEl) return;

    listEl.innerHTML = "";

    if (!Array.isArray(feeds) || feeds.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("gamenews_editor_empty");
      listEl.appendChild(empty);
      return;
    }

    feeds.forEach(function (f, idx) {
      const row = document.createElement("div");
      row.className = "list-item";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-pressed", "false");
      row.dataset.index = String(idx);
      row.dataset.feedUrl = f.feedUrl || "";
      row.dataset.feedName = f.name || "";

      const name = f.name || "Feed";
      const feedUrl = f.feedUrl || "";
      const channelId = f.channelId || "";
      // Badge will be updated after render (dirty/error/incomplete/on/off)
      const badgeClass = "human";
      const badgeText = t("gamenews_feed_status_on");

      row.innerHTML = `
        <div class="user-row-header">
          <div class="title">${escapeHtml(name)}</div>
          <div class="user-type-badge ${badgeClass}">
            ${escapeHtml(badgeText)}
          </div>
        </div>
        <div class="subtitle">
          ${escapeHtml(feedUrl)}${channelId ? " • " + escapeHtml(channelId) : ""}
        </div>
      `;

      row.addEventListener("click", function () {
        // Remover seleção das outras linhas
        const siblings = listEl.querySelectorAll(".list-item");
        siblings.forEach(function (el) {
          el.classList.remove("active");
        });
        row.classList.add("active");

        selectGameNewsFeedByIndex(idx);
      });
      row.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        row.click();
      });

      listEl.appendChild(row);
      updateGameNewsFeedRowByIndex(idx);
    });
  }

  function updateGameNewsEnabledToggle() {
    const input = document.getElementById("gamenewsEnabled");
    if (!input) return;
    const feeds = Array.isArray(state.gameNewsFeeds) ? state.gameNewsFeeds : [];
    const enabledCount = feeds.filter(function (feed) {
      return feed && feed.enabled !== false;
    }).length;
    input.checked = enabledCount > 0;
    input.indeterminate = enabledCount > 0 && enabledCount < feeds.length;
    input.disabled =
      !feeds.length ||
      state.gameNewsSource === "static" ||
      feeds.some(function (feed) {
        return !validateFeedConfig(feed).ok;
      });
  }

  // ------------------------
  // Painel de detalhe do feed
  // ------------------------

  function renderGameNewsFeedSkeleton() {
    return `<div class="empty">${escapeHtml(t("loading"))}</div>`;
  }

  function selectGameNewsFeedByIndex(idx) {
    const numericIdx = Number(idx);
    if (!Number.isInteger(numericIdx) || numericIdx < 0) return;
    if (!Array.isArray(state.gameNewsFeeds)) return;

    const prevIdx = state.activeGameNewsFeedIndex;
    if (typeof prevIdx === "number" && prevIdx !== numericIdx) {
      const prevFeed = state.gameNewsFeeds[prevIdx];
      if (prevFeed && isFeedDirty(prevFeed)) {
        toast(
          t("gamenews_unsaved_changes_notice") ||
            "Tens alterações por guardar noutro feed.",
          { type: "warn" },
        );
      }
    }

    const feed = state.gameNewsFeeds[numericIdx];
    if (!feed) return;

    const listEl = document.getElementById("gamenewsFeedsList");
    if (listEl) {
      const rows = listEl.querySelectorAll(".list-item");
      rows.forEach(function (r) {
        r.classList.remove("active");
        r.setAttribute("aria-pressed", "false");
      });
      const activeRow = listEl.querySelector(
        `.list-item[data-index="${numericIdx}"]`,
      );
      if (activeRow) {
        activeRow.classList.add("active");
        activeRow.setAttribute("aria-pressed", "true");
      }
    }

    const detailEl = document.getElementById("gamenewsFeedDetailPanel");
    state.activeGameNewsFeedIndex = numericIdx;
    if (detailEl) {
      try {
        if (
          window.OzarkDashboard &&
          typeof window.OzarkDashboard.setPanelLoading === "function"
        ) {
          window.OzarkDashboard.setPanelLoading(
            "gamenewsFeedDetailPanel",
            true,
          );
        }
      } catch {}
      detailEl.innerHTML = renderGameNewsFeedSkeleton();
    }

    if (_gameNewsDetailTimeout) {
      clearTimeout(_gameNewsDetailTimeout);
    }

    _gameNewsDetailTimeout = setTimeout(function () {
      if (!Array.isArray(state.gameNewsFeeds)) return;
      const currentFeed = state.gameNewsFeeds[numericIdx];
      if (!currentFeed) return;
      renderGameNewsFeedDetail(currentFeed);
      _gameNewsDetailTimeout = null;
    }, 350);
  }

  function renderGameNewsFeedDetail(feed) {
    const detailEl = document.getElementById("gamenewsFeedDetailPanel");
    if (!detailEl) return;

    if (!state.guildId || !feed) {
      detailEl.innerHTML = `<div class="empty">${escapeHtml(t("gamenews_detail_empty"))}</div>`;
      try {
        if (
          window.OzarkDashboard &&
          typeof window.OzarkDashboard.setPanelLoading === "function"
        ) {
          window.OzarkDashboard.setPanelLoading(
            "gamenewsFeedDetailPanel",
            false,
          );
        }
      } catch {}
      return;
    }

    const statusIndex = state.gameNewsStatusIndex || {};
    const statusKey = makeStatusKey(feed);
    const st = statusIndex[statusKey] || null;

    const feedName = feed.name || "Feed";
    const feedUrl = feed.feedUrl || "";
    const channelId = feed.channelId || "";
    const logChannelId = feed.logChannelId || "";

    const channels = Array.isArray(state.gamenewsChannels)
      ? state.gamenewsChannels
      : [];
    const channelOptionsHtml = buildChannelOptions(channels, channelId, false);
    const logChannelOptionsHtml = buildChannelOptions(
      channels,
      logChannelId,
      true,
    );

    const intervalMs =
      typeof feed.intervalMs === "number" ? feed.intervalMs : null;
    const intervalMinutes = intervalMs ? formatIntervalMinutes(intervalMs) : "";
    const maxPerCycle =
      typeof feed.maxPerCycle === "number" && Number.isFinite(feed.maxPerCycle)
        ? feed.maxPerCycle
        : null;

    const lastSent =
      st && st.lastSentAt ? formatDateTimeShort(st.lastSentAt) : "";
    const lastError = st && st.lastError ? st.lastError : "";

    let html = "";

    // Cabeçalho
    html += `<div class="title">${escapeHtml(t("gamenews_detail_title"))}</div>`;
    html += `<div class="subtitle">${escapeHtml(feedName)}${feedUrl ? " • " + escapeHtml(feedUrl) : ""}</div>`;

    // Secção Configuração (EDITÁVEL)
    html += '<div class="history-section gamenews-detail-config">';

    html += `<h3>${escapeHtml(t("gamenews_detail_config_title"))}</h3>`;

    html += '<div class="row gap">';
    html += '<div class="col">';
    html += `<label for="gnDetailName">${escapeHtml(t("gamenews_feed_name_label"))}</label>`;
    html += `<input type="text" class="input" id="gnDetailName" value="${escapeHtml(feedName)}">`;
    html += "</div>";
    html += '<div class="col">';
    html += `<label for="gnDetailUrl">${escapeHtml(t("gamenews_feed_url_label"))}</label>`;
    html += `<input type="text" class="input" id="gnDetailUrl" value="${escapeHtml(feedUrl)}">
    <div class="field-error" id="gnErrUrl" style="display:none"></div>`;
    html += "</div>";
    html += "</div>";

    html += '<div class="row gap">';
    html += '<div class="col">';
    html += `<label for="gnDetailChannel">${escapeHtml(t("gamenews_feed_channel_label"))}</label>`;
    html += `<select class="input" id="gnDetailChannel">${channelOptionsHtml}</select>
    <div class="field-error" id="gnErrChannel" style="display:none"></div>`;
    html += "</div>";
    html += '<div class="col">';
    html += `<label for="gnDetailLogChannel">${escapeHtml(
      t("gamenews_feed_log_channel_label"),
    )}</label>`;
    html += `<select class="input" id="gnDetailLogChannel">${logChannelOptionsHtml}</select>`;
    html += "</div>";
    html += "</div>";

    html += '<details class="ftk-advanced gamenews-advanced">';
    html += `<summary>${escapeHtml(t("giveaways_advanced"))}</summary>`;
    html += '<div class="ftk-advanced__body">';
    html += '<div class="row gap">';
    html += '<div class="col">';
    html += `<label for="gnDetailInterval">${escapeHtml(
      t("gamenews_feed_interval_label"),
    )}</label>`;
    html += `<input
      type="number"
      min="0"
      class="input"
      id="gnDetailInterval"
      value="${intervalMinutes}"
      placeholder="${escapeHtml(t("gamenews_feed_interval_placeholder"))}"
    >`;
    html += "</div>";
    html += '<div class="col">';
    html += `<label for="gnDetailMaxPerCycle">${escapeHtml(
      t("gamenews_feed_max_per_cycle_label"),
    )}</label>`;
    html += `<input
      type="number"
      min="1"
      max="10"
      step="1"
      class="input"
      id="gnDetailMaxPerCycle"
      value="${maxPerCycle != null ? String(maxPerCycle) : ""}"
      placeholder="${escapeHtml(t("gamenews_feed_max_per_cycle_placeholder"))}"
    >`;
    html += `<div class="field-error" id="gnErrMaxPerCycle" style="display:none"></div>`;
    html += `<p class="hint mt-1">${escapeHtml(t("gamenews_feed_max_per_cycle_hint"))}</p>`;
    html += "</div>";
    html += "</div>";

    const excludeKeywordsValue = parseKeywordsInput(feed.excludeKeywords).join(
      ", ",
    );
    html += '<div class="row gap">';
    html += '<div class="col">';
    html += `<label for="gnDetailExcludeKeywords">${escapeHtml(
      t("gamenews_feed_exclude_keywords_label"),
    )}</label>`;
    html += `<input
      type="text"
      class="input"
      id="gnDetailExcludeKeywords"
      value="${escapeHtml(excludeKeywordsValue)}"
      placeholder="${escapeHtml(t("gamenews_feed_exclude_keywords_placeholder"))}"
    >`;
    html += `<p class="hint mt-1">${escapeHtml(
      t("gamenews_feed_exclude_keywords_hint"),
    )}</p>`;
    html += "</div>";
    html += "</div>";

    const extraChannelsValue = parseChannelIdsInput(feed.extraChannelIds).join(
      ", ",
    );
    html += '<div class="row gap">';
    html += '<div class="col">';
    html += `<label for="gnDetailExtraChannels">${escapeHtml(
      t("gamenews_feed_extra_channels_label"),
    )}</label>`;
    html += `<input
      type="text"
      class="input"
      id="gnDetailExtraChannels"
      value="${escapeHtml(extraChannelsValue)}"
      placeholder="${escapeHtml(t("gamenews_feed_extra_channels_placeholder"))}"
    >`;
    html += `<div class="field-error" id="gnErrExtraChannels" style="display:none"></div>`;
    html += `<p class="hint mt-1">${escapeHtml(
      t("gamenews_feed_extra_channels_hint"),
    )}</p>`;
    html += "</div>";
    html += "</div>";
    html += "</div></details>";

    html += "</div>"; // /history-section config
    // Secção Ações rápidas (mesmo estilo dos utilizadores)
    html +=
      '<div class="history-section user-actions gamenews-detail-actions">';
    html += `<h3>${escapeHtml(t("gamenews_detail_actions_title") || t("users_actions_title"))}</h3>`;
    html += '<div class="badge-row user-actions-buttons">';
    html += `<button type="button" class="btn xs gamenews-action btn-save" data-action="save">${escapeHtml(t("gamenews_detail_action_save"))}</button>`;
    html += `<button type="button" class="btn xs gamenews-action btn-cancel" data-action="cancel">${escapeHtml(t("gamenews_detail_action_cancel"))}</button>`;
    html += `<button type="button" class="btn xs gamenews-action btn-toggle-enabled" data-action="toggle-enabled">${escapeHtml(t("gamenews_detail_action_toggle"))}</button>`;
    html += `<button type="button" class="btn xs gamenews-action btn-remove" data-action="remove">${escapeHtml(t("gamenews_detail_action_remove"))}</button>`;

    html += "</div>";
    html += `<div class="history-hint" id="gnDirtyHint" style="display:none"></div>`;
    html += "</div>"; // /history-section actions

    // Secção Estado / histórico
    html += '<div class="history-section gamenews-detail-state">';
    html += `<h3>${escapeHtml(t("gamenews_detail_state_title"))}</h3>`;

    if (!st) {
      html += `<div class="empty">${escapeHtml(
        t("gamenews_detail_state_empty"),
      )}</div>`;
    } else {
      if (lastSent)
        html += `<div class="badge">${escapeHtml(t("gamenews_detail_last_sent"))}: ${escapeHtml(lastSent)}</div>`;

      if (lastError) {
        html += '<div class="row">';
        html += `<div class="col"><strong>${escapeHtml(
          t("gamenews_detail_last_error"),
        )}:</strong> ${escapeHtml(lastError)}</div>`;
        html += "</div>";
      }
    }

    html += "</div>"; // /history-section state
    detailEl.innerHTML = html;

    try {
      if (
        window.OzarkDashboard &&
        typeof window.OzarkDashboard.setPanelLoading === "function"
      ) {
        window.OzarkDashboard.setPanelLoading("gamenewsFeedDetailPanel", false);
      }
    } catch {}

    // Ligação inputs -> state.gameNewsFeeds[activeIndex]
    const idx = state.activeGameNewsFeedIndex;
    if (
      typeof idx !== "number" ||
      !Array.isArray(state.gameNewsFeeds) ||
      !state.gameNewsFeeds[idx]
    )
      return;
    const target = state.gameNewsFeeds[idx];

    function syncFromInputs() {
      const nameEl = detailEl.querySelector("#gnDetailName");
      const urlEl = detailEl.querySelector("#gnDetailUrl");
      const chEl = detailEl.querySelector("#gnDetailChannel");
      const logEl = detailEl.querySelector("#gnDetailLogChannel");
      const intEl = detailEl.querySelector("#gnDetailInterval");
      const maxEl = detailEl.querySelector("#gnDetailMaxPerCycle");
      const kwEl = detailEl.querySelector("#gnDetailExcludeKeywords");
      const extraChEl = detailEl.querySelector("#gnDetailExtraChannels");

      target.name = nameEl ? nameEl.value.trim() || "Feed" : target.name;
      target.feedUrl = urlEl ? urlEl.value.trim() : target.feedUrl;
      target.channelId = chEl ? chEl.value.trim() : target.channelId;
      target.logChannelId = logEl
        ? logEl.value.trim() || null
        : target.logChannelId;

      if (intEl) {
        const raw = intEl.value.trim();
        if (!raw) {
          target.intervalMs = null;
        } else {
          const mins = Number(raw.replace(",", "."));
          const MIN = 1; // 1 minuto
          const MAX = 7 * 24 * 60; // 7 dias em minutos

          if (Number.isFinite(mins) && mins > 0) {
            const clamped = Math.max(MIN, Math.min(MAX, mins));
            target.intervalMs = Math.round(clamped * 60 * 1000);
            if (clamped !== mins) {
              intEl.value = String(clamped);
            }
          } else {
            target.intervalMs = null;
          }
        }
      }

      if (maxEl) {
        const raw = String(maxEl.value || "").trim();
        if (!raw) {
          target.maxPerCycle = null;
        } else {
          const n = parseInt(raw, 10);
          if (Number.isFinite(n)) {
            const clamped = Math.max(1, Math.min(10, n));
            target.maxPerCycle = clamped;
            if (clamped !== n) maxEl.value = String(clamped);
          } else {
            target.maxPerCycle = null;
          }
        }
      }

      if (kwEl) {
        target.excludeKeywords = parseKeywordsInput(kwEl.value);
      }

      if (extraChEl) {
        target.extraChannelIds = parseChannelIdsInput(extraChEl.value);
      }

      // Validation + UI (inline)
      const v = validateFeedConfig(target);
      // Keep normalized values (e.g. auto-add https://)
      if (v && v.normalized) {
        if (v.normalized.feedUrl) target.feedUrl = v.normalized.feedUrl;
        if (v.normalized.channelId) target.channelId = v.normalized.channelId;
        if (
          urlEl &&
          v.normalized.feedUrl &&
          urlEl.value.trim() !== v.normalized.feedUrl
        ) {
          urlEl.value = v.normalized.feedUrl;
        }
      }

      setFieldError(
        detailEl.querySelector("#gnErrUrl"),
        v.errors && v.errors.feedUrl,
      );
      setFieldError(
        detailEl.querySelector("#gnErrChannel"),
        v.errors && v.errors.channelId,
      );
      setFieldError(
        detailEl.querySelector("#gnErrMaxPerCycle"),
        v.errors && v.errors.maxPerCycle,
      );
      setFieldError(
        detailEl.querySelector("#gnErrExtraChannels"),
        v.errors && v.errors.extraChannelIds,
      );
      setInputError(urlEl, !!(v.errors && v.errors.feedUrl));
      setInputError(chEl, !!(v.errors && v.errors.channelId));
      setInputError(maxEl, !!(v.errors && v.errors.maxPerCycle));
      setInputError(extraChEl, !!(v.errors && v.errors.extraChannelIds));

      const btnSave = detailEl.querySelector(
        '.gamenews-action[data-action="save"]',
      );
      const btnCancel = detailEl.querySelector(
        '.gamenews-action[data-action="cancel"]',
      );
      const dirty = isFeedDirty(target);

      const dirtyHintEl = detailEl.querySelector("#gnDirtyHint");
      if (dirtyHintEl) {
        const msg = dirty
          ? t("gamenews_detail_unsaved") || "Alterações por guardar neste feed."
          : "";
        dirtyHintEl.textContent = msg;
        dirtyHintEl.style.display = dirty ? "block" : "none";
      }

      if (btnSave) btnSave.disabled = !v.ok || !dirty;
      if (btnCancel) btnCancel.disabled = !dirty;

      updateGameNewsFeedRowByIndex(idx);
    }

    detailEl
      .querySelectorAll(
        "#gnDetailName,#gnDetailUrl,#gnDetailChannel,#gnDetailLogChannel,#gnDetailInterval,#gnDetailMaxPerCycle,#gnDetailExcludeKeywords,#gnDetailExtraChannels",
      )
      .forEach(function (el) {
        el.addEventListener("input", syncFromInputs);
        el.addEventListener("change", syncFromInputs);
      });

    // Inicializar validação
    syncFromInputs();

    // Ações rápidas
    const actionButtons = detailEl.querySelectorAll(".gamenews-action");
    actionButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        const action = btn.getAttribute("data-action");
        if (action === "save") {
          syncFromInputs();
          const v = validateFeedConfig(target);
          if (!v.ok) {
            toast(
              (v.errors && (v.errors.feedUrl || v.errors.channelId)) ||
                t("gamenews_validation_fix_errors"),
              { type: "warn" },
            );
            return;
          }
          saveGameNewsFeeds().catch(function (e) {
            toast((e && e.apiMessage) || t("gamenews_error_generic"), {
              type: "error",
            });
          });
        } else if (action === "toggle-enabled") {
          const prev = target.enabled;
          target.enabled = !target.enabled;
          syncFromInputs();
          const v = validateFeedConfig(target);
          if (!v.ok) {
            target.enabled = prev;
            toast(
              (v.errors && (v.errors.feedUrl || v.errors.channelId)) ||
                t("gamenews_validation_fix_errors"),
              { type: "warn" },
            );
            return;
          }
          saveGameNewsFeeds().catch(function (e) {
            toast((e && e.apiMessage) || t("gamenews_error_generic"), {
              type: "error",
            });
          });
        } else if (action === "cancel") {
          // Reverter alterações locais para o snapshot original (ou defaults se for um feed novo)
          const k = feedKey(target);
          const orig =
            state.gameNewsOriginalByKey && k
              ? state.gameNewsOriginalByKey[k]
              : null;
          if (orig) {
            try {
              const snap = JSON.parse(orig);
              target.name = snap.name || "Feed";
              target.feedUrl = snap.feedUrl || "";
              target.channelId = snap.channelId || "";
              target.logChannelId = snap.logChannelId || null;
              target.enabled = snap.enabled !== false;
              target.intervalMs =
                typeof snap.intervalMs === "number" ? snap.intervalMs : null;
              target.maxPerCycle =
                typeof snap.maxPerCycle === "number" ? snap.maxPerCycle : null;
              target.excludeKeywords = parseKeywordsInput(snap.excludeKeywords);
            } catch {
              // fallback para defaults
              target.name = "Feed";
              target.feedUrl = "";
              target.channelId = "";
              target.logChannelId = null;
              target.enabled = true;
              target.intervalMs = null;
              target.maxPerCycle = null;
              target.excludeKeywords = [];
            }
          } else {
            target.name = "Feed";
            target.feedUrl = "";
            target.channelId = "";
            target.logChannelId = null;
            target.enabled = true;
            target.intervalMs = null;
            target.maxPerCycle = null;
            target.excludeKeywords = [];
          }

          updateGameNewsFeedRowByIndex(idx);
          renderGameNewsFeedDetail(target);
        } else if (action === "remove") {
          // Remove do state, ajusta seleção e persiste na BD
          state.gameNewsFeeds.splice(idx, 1);
          pruneOriginalMap(state.gameNewsFeeds);

          if (!state.gameNewsFeeds.length) {
            state.activeGameNewsFeedIndex = null;
            renderGameNewsFeedsList(state.gameNewsFeeds);
            detailEl.innerHTML = `<div class="empty">${escapeHtml(t("gamenews_detail_empty"))}</div>`;
          } else {
            const nextIndex = Math.max(
              0,
              Math.min(idx, state.gameNewsFeeds.length - 1),
            );
            renderGameNewsFeedsList(state.gameNewsFeeds);
            selectGameNewsFeedByIndex(nextIndex);
          }

          saveGameNewsFeeds().catch(function (e) {
            toast((e && e.apiMessage) || t("gamenews_error_generic"), {
              type: "error",
            });
          });
        }
      });
    });
  }

  // ------------------------
  // Guardar feeds na DB
  // ------------------------

  async function saveGameNewsFeeds() {
    if (!state.guildId) return false;
    const guildId = String(state.guildId);

    const feeds = Array.isArray(state.gameNewsFeeds) ? state.gameNewsFeeds : [];
    let hadInvalid = false;
    let hadInvalidUrl = false;
    let hadInvalidChannel = false;

    const payloadFeeds = feeds
      .map(function (f) {
        if (!f) return null;
        const name = f.name || "Feed";
        let feedUrl = (f.feedUrl != null ? String(f.feedUrl) : "").trim();
        const channelIdRaw = (
          f.channelId != null ? String(f.channelId) : ""
        ).trim();
        const rawLogChannelId =
          f.logChannelId != null ? String(f.logChannelId) : "";
        const logChannelIdRaw = rawLogChannelId.trim();
        const enabled = f.enabled !== false;
        const intervalMs =
          typeof f.intervalMs === "number" && f.intervalMs > 0
            ? f.intervalMs
            : null;
        const maxPerCycle =
          typeof f.maxPerCycle === "number" && Number.isFinite(f.maxPerCycle)
            ? Math.round(f.maxPerCycle)
            : null;

        if (!feedUrl || !channelIdRaw) {
          hadInvalid = true;
          return null;
        }

        // Normalize common inputs: allow missing protocol and Discord mention formats.
        if (
          feedUrl &&
          !/^https?:\/\//i.test(feedUrl) &&
          /\./.test(feedUrl) &&
          !/\s/.test(feedUrl)
        ) {
          feedUrl = `https://${feedUrl}`;
        }

        const extractId = function (s) {
          if (!s) return "";
          const m = String(s).match(/\d{10,32}/);
          return m ? m[0] : "";
        };

        const channelId = extractId(channelIdRaw) || channelIdRaw;
        const logChannelId = extractId(logChannelIdRaw) || logChannelIdRaw;

        // Basic client-side validation to prevent accidental data loss.
        // Be permissive; backend enforces protocol and rejects whitespace.
        if (!/^https?:\/\/\S+$/i.test(feedUrl)) {
          hadInvalidUrl = true;
          return null;
        }

        if (!/^[0-9]{10,32}$/.test(channelId)) {
          hadInvalidChannel = true;
          return null;
        }

        if (logChannelId && !/^[0-9]{10,32}$/.test(logChannelId)) {
          hadInvalidChannel = true;
          return null;
        }

        const extraChannelIds = parseChannelIdsInput(f.extraChannelIds)
          .map(function (s) {
            return String(s).replace(/[^\d]/g, "");
          })
          .filter(Boolean)
          .filter(function (id) {
            return id !== channelId;
          });

        if (
          extraChannelIds.some(function (id) {
            return !/^[0-9]{10,32}$/.test(id);
          })
        ) {
          hadInvalidChannel = true;
          return null;
        }

        return {
          name: name,
          feedUrl: feedUrl,
          channelId: channelId,
          logChannelId: logChannelId || null,
          extraChannelIds: extraChannelIds,
          enabled: enabled,
          intervalMs: intervalMs,
          maxPerCycle: maxPerCycle,
          excludeKeywords: parseKeywordsInput(f.excludeKeywords),
        };
      })
      .filter(function (x) {
        return !!x;
      });

    if (hadInvalidUrl) {
      toast(t("gamenews_validation_invalid_url"), { type: "warn" });
      return false;
    }
    if (hadInvalidChannel) {
      toast(t("gamenews_validation_invalid_channel"), { type: "warn" });
      return false;
    }
    if (hadInvalid) {
      toast(t("gamenews_validation_missing"), { type: "warn" });
      return false;
    }

    const body = {
      guildId: guildId,
      feeds: payloadFeeds,
    };

    const guildParam = "?guildId=" + encodeURIComponent(guildId);
    let res = null;
    try {
      res = await apiPost("/gamenews/feeds" + guildParam, body);
    } catch (err) {
      // Surface backend validation details (helps diagnose 400s without opening DevTools)
      const details = err && err.payload && err.payload.details;
      if (Array.isArray(details) && details.length) {
        const first = details[0];
        const issue =
          first && Array.isArray(first.issues) && first.issues.length
            ? first.issues[0]
            : null;
        const msg = issue && issue.message ? String(issue.message) : null;
        toast(
          msg
            ? t("gamenews_error_generic") + ": " + msg
            : (err && err.apiMessage) || t("gamenews_error_generic"),
          { type: "error" },
        );
      } else {
        toast((err && err.apiMessage) || t("gamenews_error_generic"), {
          type: "error",
        });
      }
      return false;
    }

    if (res && res.ok) {
      toast(t("gamenews_save_success"), { type: "success" });
      if (typeof D.invalidatePremiumDiagnosis === "function") {
        D.invalidatePremiumDiagnosis("gamenews", guildId);
        if (typeof D.diagnosePremiumModule === "function")
          D.diagnosePremiumModule("gamenews").catch(function () {});
      }
      // Atualizar state.gameNewsFeeds com o que vier da DB
      const returnedFeeds =
        (res && Array.isArray(res.items) && res.items) ||
        (res && Array.isArray(res.feeds) && res.feeds) ||
        null;

      if (returnedFeeds) {
        writeGameNewsBackup(guildId, returnedFeeds);
        if (String(state.guildId || "") !== guildId) return true;
        state.gameNewsFeeds = returnedFeeds.slice();
        showGameNewsBackupNotice([]);
        setOriginalForFeeds(state.gameNewsFeeds);
        renderGameNewsFeedsList(state.gameNewsFeeds);
        // Clamp active index if needed
        let idx =
          typeof state.activeGameNewsFeedIndex === "number"
            ? state.activeGameNewsFeedIndex
            : 0;
        if (idx < 0) idx = 0;
        if (idx >= state.gameNewsFeeds.length)
          idx = state.gameNewsFeeds.length - 1;
        if (idx >= 0 && state.gameNewsFeeds.length) {
          selectGameNewsFeedByIndex(idx);
        }
      }
      return true;
    } else {
      toast(t("gamenews_error_generic"), { type: "error" });
      return false;
    }
  }

  // ------------------------
  // Carregar GameNews (lista + estado)
  // ------------------------

  async function loadGameNews() {
    const listEl = document.getElementById("gamenewsFeedsList");
    const detailEl = document.getElementById("gamenewsFeedDetailPanel");
    if (!listEl) return;

    if (!state.guildId) {
      showGameNewsBackupNotice([]);
      listEl.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("gamenews_select_guild");
      listEl.appendChild(empty);

      if (detailEl) {
        detailEl.innerHTML = `<div class="empty">${escapeHtml(t("gamenews_detail_empty"))}</div>`;
      }

      return;
    }

    const requestedGuildId = String(state.guildId);
    const guildParam = "?guildId=" + encodeURIComponent(requestedGuildId);

    return window.OzarkDashboard.withLoading(
      function () {
        return Promise.allSettled([
          apiGet("/gamenews/feeds" + guildParam),
          apiGet("/gamenews-status" + guildParam),
          apiGet("/guilds/" + encodeURIComponent(requestedGuildId) + "/meta"),
        ]).then(function (results) {
          if (String(state.guildId || "") !== requestedGuildId) return;
          if (results[0].status === "rejected") throw results[0].reason;
          const feedsRes = results[0].value;
          const statusRes =
            results[1].status === "fulfilled" ? results[1].value : null;
          const metaRes =
            results[2].status === "fulfilled" ? results[2].value : null;

          if (!statusRes || !metaRes) {
            console.warn(
              "GameNews loaded with incomplete status or channel metadata.",
            );
          }

          // Cache channels list for nicer selectors in the detail panel
          state.gamenewsChannels =
            metaRes && Array.isArray(metaRes.channels) ? metaRes.channels : [];

          const feeds = (
            feedsRes && Array.isArray(feedsRes.items) ? feedsRes.items : []
          ).slice();
          const backup = feeds.length
            ? []
            : readGameNewsBackup(requestedGuildId);
          if (feeds.length) writeGameNewsBackup(requestedGuildId, feeds);
          showGameNewsBackupNotice(backup);
          const statusItems =
            statusRes && Array.isArray(statusRes.items) ? statusRes.items : [];

          state.gameNewsFeeds = feeds;
          state.gameNewsSource = feedsRes && feedsRes.source;
          state.gameNewsLoadedGuildId = requestedGuildId;
          setOriginalForFeeds(feeds);
          state.gameNewsStatusIndex = buildStatusIndex(statusItems);
          state.activeGameNewsFeedIndex = null;

          renderGameNewsFeedsList(feeds);

          // Painel de detalhe: não selecionar automaticamente (só abre ao clicar num feed)
          if (detailEl) {
            detailEl.innerHTML = `<div class="empty">${escapeHtml(t("gamenews_detail_empty"))}</div>`;
          }
        });
      },
      {
        onStart: function () {
          if (state.gameNewsLoadedGuildId !== requestedGuildId) {
            listEl.innerHTML = `<div class="empty">${escapeHtml(t("loading"))}</div>`;
            if (detailEl) {
              detailEl.innerHTML = `<div class="empty">${escapeHtml(t("loading"))}</div>`;
            }
          }
        },
        onError: function () {
          if (String(state.guildId || "") !== requestedGuildId) return;
          if (
            state.gameNewsLoadedGuildId === requestedGuildId &&
            Array.isArray(state.gameNewsFeeds)
          ) {
            toast(t("gamenews_error_generic"), { type: "warn" });
            return;
          }
          const backup = readGameNewsBackup(requestedGuildId);
          if (backup.length) {
            state.gameNewsFeeds = backup.slice();
            state.gameNewsSource = "browser-backup";
            state.gameNewsLoadedGuildId = requestedGuildId;
            setOriginalForFeeds(backup);
            showGameNewsBackupNotice(backup);
            renderGameNewsFeedsList(backup);
            if (detailEl) {
              detailEl.innerHTML = `<div class="empty">${escapeHtml(t("gamenews_detail_empty"))}</div>`;
            }
            toast(t("gamenews_error_generic"), { type: "warn" });
            return;
          }
          listEl.innerHTML = "";
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = t("gamenews_error_generic");
          listEl.appendChild(empty);
          if (detailEl) {
            detailEl.innerHTML = `<div class="empty">${escapeHtml(t("gamenews_detail_empty"))}</div>`;
          }
        },
      },
    );
  }

  // ------------------------
  // Event handlers dos botões da tab
  // ------------------------

  document.addEventListener("DOMContentLoaded", function () {
    const enabledToggle = document.getElementById("gamenewsEnabled");
    if (enabledToggle) {
      enabledToggle.addEventListener("change", async function () {
        const enabled = enabledToggle.checked;
        const feeds = Array.isArray(state.gameNewsFeeds)
          ? state.gameNewsFeeds
          : [];
        const previousStates = feeds.map(function (feed) {
          return feed && feed.enabled !== false;
        });
        feeds.forEach(function (feed) {
          if (feed) feed.enabled = enabled;
        });
        renderGameNewsFeedsList(feeds);
        enabledToggle.disabled = true;
        try {
          const saved = await saveGameNewsFeeds();
          if (!saved) {
            feeds.forEach(function (feed, index) {
              if (feed) feed.enabled = previousStates[index];
            });
            renderGameNewsFeedsList(feeds);
          }
        } finally {
          updateGameNewsEnabledToggle();
        }
      });
    }

    const btnAdd = document.getElementById("btnAddGameNewsFeed");
    if (btnAdd) {
      btnAdd.addEventListener("click", function () {
        if (!Array.isArray(state.gameNewsFeeds)) {
          state.gameNewsFeeds = [];
        }
        state.gameNewsFeeds.push({
          name: "Feed",
          feedUrl: "",
          channelId: "",
          logChannelId: null,
          extraChannelIds: [],
          enabled: true,
          intervalMs: null,
          excludeKeywords: [],
        });
        renderGameNewsFeedsList(state.gameNewsFeeds);
        selectGameNewsFeedByIndex(state.gameNewsFeeds.length - 1);
      });
    }

    const restoreBackupButton = document.getElementById(
      "btnRestoreGameNewsBackup",
    );
    if (restoreBackupButton) {
      restoreBackupButton.addEventListener("click", async function () {
        const backup = Array.isArray(state.gameNewsBackupFeeds)
          ? state.gameNewsBackupFeeds
          : [];
        if (!backup.length || !state.guildId) return;
        restoreBackupButton.disabled = true;
        state.gameNewsFeeds = backup.slice();
        renderGameNewsFeedsList(state.gameNewsFeeds);
        try {
          await saveGameNewsFeeds();
        } finally {
          restoreBackupButton.disabled = false;
        }
      });
    }
  });

  // ------------------------
  // Export para namespace global
  // ------------------------

  D.loadGameNews = loadGameNews;
})();
