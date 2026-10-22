(function () {
  "use strict";

  function clearInlineError(el) {
    if (!el) return;
    el.classList.remove("input-error");
    // remove adjacent error node created by setInlineError
    var next = el.nextElementSibling;
    if (
      next &&
      next.classList &&
      next.classList.contains("field-error") &&
      next.dataset &&
      next.dataset.for === el.id
    ) {
      next.remove();
    }
  }

  function setInlineError(el, msg) {
    if (!el) return;
    el.classList.add("input-error");
    var next = el.nextElementSibling;
    if (
      next &&
      next.classList &&
      next.classList.contains("field-error") &&
      next.dataset &&
      next.dataset.for === el.id
    ) {
      next.textContent = msg || "";
      return;
    }
    var div = document.createElement("div");
    div.className = "field-error";
    div.dataset.for = el.id;
    div.textContent = msg || "";
    el.insertAdjacentElement("afterend", div);
  }

  function clearInlineErrors(ids) {
    (ids || []).forEach(function (id) {
      clearInlineError(document.getElementById(id));
    });
  }

  // Global namespace for multi-file-friendly dashboard
  window.OzarkDashboard = window.OzarkDashboard || {};

  const state = {
    lang: "en",
    guildId: null,
    guildsLoaded: false,
    currentTab: "overview",
    guilds: [],
    guildInventoryFilter: "all",
    me: null,
    perms: {},
    trustDirty: false,
    trustLastSavedAt: null,
    currentTrustConfig: null,
    trustExtraOverride: null,
    theme: "dark",
    density: "comfortable",
  };

  function formatDateTime(ts) {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "—";
      const opts = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      };
      const tz = state && state.guildTimezone ? state.guildTimezone : undefined;
      const lang = state && state.lang ? state.lang : "pt";
      return new Intl.DateTimeFormat(
        lang === "en" ? "en-GB" : "pt-PT",
        tz ? Object.assign({ timeZone: tz }, opts) : opts,
      ).format(d);
    } catch {
      try {
        return new Date(ts).toLocaleString();
      } catch {
        return String(ts);
      }
    }
  }

  const API_BASE = "/api";
  const GUILD_KEY = "DASHBOARD_GUILD_ID";

  function getDefaultLanguage() {
    return "en";
  }

  state.lang = getDefaultLanguage();

  // Clean up the "selectGuild" hint left by the OAuth callback.
  // The session token itself lives in an HttpOnly cookie set by the backend,
  // so it is never read from or written to localStorage.
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.has("selectGuild")) {
      if (params.get("selectGuild") === "1") {
        try {
          localStorage.removeItem(GUILD_KEY);
        } catch {}
      }
      params.delete("selectGuild");
      params.delete("token");
      const qs = params.toString();
      const newUrl =
        window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
    }
  } catch {}

  // -----------------------------
  // Small helpers
  // -----------------------------

  function getStoredGuildId() {
    try {
      return localStorage.getItem(GUILD_KEY) || "";
    } catch {
      return "";
    }
  }

  function setStoredGuildId(guildId) {
    try {
      if (guildId) localStorage.setItem(GUILD_KEY, guildId);
    } catch {}
  }

  // For Discord OAuth sessions, mint a "server-scoped" session after the user selects a guild.
  // The token never touches the frontend: the backend stores it in an HttpOnly cookie.
  async function ensureGuildScopedToken(guildId) {
    if (!guildId) {
      if (!state.me || state.me.role !== "BOT_OWNER") return false;
      if (
        !state.me.selectedGuildId &&
        state.me.profile === "UNSCOPED" &&
        state.me.guildScopeVersion === 2
      )
        return true;
      try {
        await apiPost("/auth/global", {});
        await loadMe();
        return true;
      } catch {
        return false;
      }
    }

    if (
      state.me &&
      state.me.selectedGuildId === guildId &&
      state.me.profile &&
      state.me.profile !== "UNSCOPED"
    ) {
      return true;
    }

    try {
      const res = await apiPost("/auth/select-guild", { guildId: guildId });
      if (res && res.ok) {
        await loadMe().catch(function () {});
        return true;
      }
      toast(t("guild_select_error_access"), { type: "error" });
      return false;
    } catch (e) {
      if (
        e &&
        (e.apiMessage === "BOT_NOT_INSTALLED" ||
          e.message === "BOT_NOT_INSTALLED")
      ) {
        toast(t("bot_not_installed"), { type: "error" });
        return false;
      }
      toast(
        e && e.apiMessage ? e.apiMessage : t("guild_select_error_generic"),
        { type: "error" },
      );
      return false;
    }
  }

  // Authentication is carried by the HttpOnly session cookie, sent automatically
  // on same-origin requests, so no auth headers are needed here.
  function getAuthHeaders() {
    return {};
  }

  async function forceLogout(opts) {
    try {
      // Server-side logout clears HttpOnly cookies (cannot be cleared from JS directly).
      await fetch(API_BASE + "/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {}
    try {
      if (typeof window.OzarkDashboard.showLogin === "function")
        window.OzarkDashboard.showLogin();
    } catch {}
    try {
      if (opts && opts.redirect) {
        window.location.replace("/");
      }
    } catch {}
  }

  function handleAuthError(status, payload) {
    if (status === 401) {
      const code = payload && (payload.error || payload.code);
      if (code === "REAUTH_REQUIRED") {
        // Recover from stale tokens/cookies by forcing a server-side logout.
        forceLogout();
        return;
      }
      try {
        // Sessão expirada ou token inválido: mostra o ecrã de login.
        // Evitamos reload em loop (especialmente quando o token está num cookie HttpOnly).
        if (typeof window.OzarkDashboard.showLogin === "function")
          window.OzarkDashboard.showLogin();
      } catch (e) {
        console.error("Failed to show login after 401", e);
      }
    }
  }

  // Helpers partilhados por todos os pedidos à API (evita duplicação entre GET/POST/PATCH/DELETE).
  function buildApiError(res, payload, path) {
    const msg = payload && (payload.error || payload.message);
    const err = new Error(msg || `HTTP ${res.status} for ${path}`);
    err.status = res.status;
    if (msg) err.apiMessage = msg;
    err.payload = payload;
    return err;
  }

  async function readJsonSafe(res) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async function apiRequest(method, path, body, options) {
    const opts = options || {};
    const headers = Object.assign({}, getAuthHeaders());
    const init = { method: method, headers: headers, signal: opts.signal };
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(API_BASE + path, init);
    const payload = await readJsonSafe(res);
    if (!res.ok) {
      handleAuthError(res.status, payload);
      throw buildApiError(res, payload, path);
    }
    return payload;
  }

  async function apiGet(path, options) {
    const opts = options || {};
    async function sleep(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }

    async function fetchWithRetry(attempt) {
      const res = await fetch(API_BASE + path, {
        method: "GET",
        headers: getAuthHeaders(),
        signal: opts.signal,
      });

      if (!res.ok) {
        // Retry only for transient GET failures.
        const retriable =
          res.status === 429 ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504;
        if (retriable && attempt < 2) {
          let waitMs = 0;
          const ra =
            res.headers && res.headers.get
              ? res.headers.get("retry-after")
              : null;
          if (res.status === 429 && ra) {
            const sec = Number(ra);
            if (Number.isFinite(sec) && sec > 0)
              waitMs = Math.min(10_000, sec * 1000);
          }
          if (!waitMs) {
            waitMs = (res.status === 429 ? 900 : 400) * Math.pow(2, attempt);
          }
          await sleep(waitMs);
          return fetchWithRetry(attempt + 1);
        }
      }

      return res;
    }

    const res = await fetchWithRetry(0);
    // Tentar ler JSON mesmo em erro, para extrair mensagem da API
    const payload = await readJsonSafe(res);
    if (!res.ok) {
      handleAuthError(res.status, payload);
      throw buildApiError(res, payload, path);
    }
    return payload;
  }

  async function apiPost(path, body, options) {
    return apiRequest("POST", path, body, options);
  }

  async function apiPatch(path, body, options) {
    return apiRequest("PATCH", path, body, options);
  }

  function createLogRow(log) {
    const row = document.createElement("div");
    row.className = "list-item log-record-row";

    // Título simples; cai para i18n ou "Log" se não existir
    const fallbackTitle =
      (typeof t === "function" && t("logs_default_title")) || "Log";
    const title = log.title || fallbackTitle;

    // Linha meta: utilizador, moderador, data/hora (localizada)
    const metaParts = [];

    const userLabel =
      (typeof t === "function" && t("logs_user_label")) || "User";
    const modLabel = (typeof t === "function" && t("logs_mod_label")) || "Mod";

    if (log.user && log.user.tag) {
      metaParts.push(userLabel + ": " + log.user.tag);
    }
    if (log.executor && log.executor.tag) {
      metaParts.push(modLabel + ": " + log.executor.tag);
    }
    if (log.time) {
      try {
        const d = new Date(log.time);
        if (!isNaN(d.getTime())) {
          metaParts.push(d.toLocaleString());
        }
      } catch {
        // se der erro mantemos só os restantes campos
      }
    }

    const metaText = metaParts.join(" • ");

    // Descrição em linha separada (se existir)
    const desc = log.description || "";

    row.innerHTML = `
        <div class="title">${escapeHtml(title)}</div>
        <div class="subtitle">${escapeHtml(metaText)}</div>
        ${desc ? `<div class="subtitle small">${escapeHtml(desc)}</div>` : ""}
      `;

    return row;
  }

  // Toasts (stacked, typed, accessible)
  function toast(message, opts) {
    opts = opts || {};
    var type = (opts.type || "info").toLowerCase();
    var duration = typeof opts.duration === "number" ? opts.duration : 2800;

    var hostId = "rabbitToastHost";
    var host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement("div");
      host.id = hostId;
      host.className = "toast-host";
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-relevant", "additions");
      document.body.appendChild(host);
    }

    var item = document.createElement("div");
    item.className = "toast toast--" + (type || "info");
    item.setAttribute("role", type === "error" ? "alert" : "status");
    item.textContent = String(message || "");

    host.appendChild(item);

    // animate in
    requestAnimationFrame(function () {
      item.classList.add("toast--visible");
    });

    clearTimeout(item._hideTimer);
    item._hideTimer = setTimeout(
      function () {
        item.classList.remove("toast--visible");
        // remove after transition
        setTimeout(function () {
          try {
            item.remove();
          } catch {}
          try {
            // keep DOM clean
            if (host && host.children && host.children.length === 0)
              host.remove();
          } catch {}
        }, 220);
      },
      Math.max(800, duration),
    );
  }

  function withLoading(promiseFactory, opts) {
    opts = opts || {};
    var onStart = typeof opts.onStart === "function" ? opts.onStart : null;
    var onError = typeof opts.onError === "function" ? opts.onError : null;
    var onFinally =
      typeof opts.onFinally === "function" ? opts.onFinally : null;
    var toastOnError = opts.toastOnError || null;

    if (onStart) {
      try {
        onStart();
      } catch (e) {
        console.error(e);
      }
    }

    return Promise.resolve()
      .then(function () {
        return promiseFactory();
      })
      .catch(function (err) {
        console.error(err);
        if (toastOnError) {
          toast(toastOnError, { type: "error" });
        }
        if (onError) {
          try {
            onError(err);
          } catch (e2) {
            console.error(e2);
          }
        }
        throw err;
      })
      .finally(function () {
        if (onFinally) {
          try {
            onFinally();
          } catch (e3) {
            console.error(e3);
          }
        }
      });
  }
  window.OzarkDashboard.withLoading = withLoading;

  // -----------------------------
  // Global banner (estado/avisos)
  // -----------------------------
  var bannerState = { active: false, locked: false, lastKey: "" };

  function clearGlobalBanner() {
    var el = document.getElementById("globalBanner");
    var titleEl = document.getElementById("globalBannerTitle");
    var msgEl = document.getElementById("globalBannerMessage");
    var actionsEl = document.getElementById("globalBannerActions");
    if (!el || !titleEl || !msgEl || !actionsEl) return;

    el.classList.add("hidden");
    el.classList.remove(
      "global-banner--info",
      "global-banner--success",
      "global-banner--warn",
      "global-banner--error",
    );
    titleEl.textContent = "";
    msgEl.textContent = "";
    actionsEl.innerHTML = "";
    bannerState.active = false;
    bannerState.lastKey = "";
  }

  function setGlobalBanner(opts) {
    opts = opts || {};
    var type = (opts.type || "info").toLowerCase();
    var key = String(
      opts.key || type + ":" + (opts.title || "") + ":" + (opts.message || ""),
    );

    // If user closed the same banner recently, don't resurrect it unless forced.
    if (bannerState.locked && bannerState.lastKey === key && !opts.force)
      return;

    var el = document.getElementById("globalBanner");
    var titleEl = document.getElementById("globalBannerTitle");
    var msgEl = document.getElementById("globalBannerMessage");
    var actionsEl = document.getElementById("globalBannerActions");
    var closeBtn = document.getElementById("globalBannerClose");
    if (!el || !titleEl || !msgEl || !actionsEl) return;

    bannerState.active = true;
    bannerState.lastKey = key;

    el.classList.remove(
      "global-banner--info",
      "global-banner--success",
      "global-banner--warn",
      "global-banner--error",
    );
    if (type === "success") el.classList.add("global-banner--success");
    else if (type === "warn" || type === "warning")
      el.classList.add("global-banner--warn");
    else if (type === "error") el.classList.add("global-banner--error");
    else el.classList.add("global-banner--info");

    titleEl.textContent = opts.title || "";
    msgEl.textContent = opts.message || "";
    actionsEl.innerHTML = "";

    var actions = Array.isArray(opts.actions) ? opts.actions : [];
    actions.forEach(function (a) {
      if (!a) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      btn.textContent = a.label || "OK";
      btn.addEventListener("click", function () {
        try {
          if (typeof a.onClick === "function") a.onClick();
        } catch {}
      });
      actionsEl.appendChild(btn);
    });

    el.classList.remove("hidden");

    if (closeBtn && !closeBtn.__ozarkBound) {
      closeBtn.__ozarkBound = true;
      closeBtn.addEventListener("click", function () {
        bannerState.locked = true;
        clearGlobalBanner();
      });
    }
  }

  function refreshGlobalBanner() {
    // Avoid flashing “select guild” while guild list is still loading.
    if (!state.guildsLoaded) {
      clearGlobalBanner();
      return;
    }
    // Priority: no guild selected > bot offline > none
    if (!state.guildId && state.me && state.me.role === "BOT_OWNER") {
      clearGlobalBanner();
      return;
    }
    if (!state.guildId) {
      setGlobalBanner({
        key: "no-guild",
        type: "info",
        title: t("warn_select_guild"),
        message: t("select_guild"),
        actions: [
          {
            label: t("select_guild") || "Selecionar",
            onClick: function () {
              var picker = document.getElementById("guildPicker");
              if (picker) {
                picker.focus();
                picker.click && picker.click();
              }
            },
          },
        ],
      });
      return;
    }

    if (bannerState.lastBotOk === false) {
      setGlobalBanner({
        key: "bot-offline",
        type: "warn",
        title: t("badge_bot_offline"),
        message:
          t("overview_bot_offline_hint") ||
          "O bot parece offline ou não está pronto no Discord.",
        actions: [
          {
            label: t("retry") || "Recarregar",
            onClick: function () {
              refreshBotStatusBadge();
            },
          },
        ],
      });
      return;
    }

    clearGlobalBanner();
  }

  function setPanelLoading(panelId, isLoading) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    if (isLoading) {
      panel.classList.add("panel-loading");
      panel.setAttribute("aria-busy", "true");
    } else {
      panel.classList.remove("panel-loading");
      panel.removeAttribute("aria-busy");
    }
  }

  // Expose for external modules (users/tickets/gamenews) to show consistent loading.
  window.OzarkDashboard = window.OzarkDashboard || {};
  window.OzarkDashboard.setPanelLoading = setPanelLoading;

  // Backwards compatible helper (kept for older call sites).
  // Prefer setPanelLoading(panelId, true/false) around real async work.
  function showPanelLoading(panelId) {
    setPanelLoading(panelId, true);
    // Keep a short minimum, but do not lie about completion for long operations.
    clearTimeout(showPanelLoading._t);
    showPanelLoading._t = setTimeout(function () {
      setPanelLoading(panelId, false);
    }, 650);
  }

  window.OzarkDashboard.showPanelLoading = showPanelLoading;

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return value
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // -----------------------------
  // i18n (simplificado)
  // -----------------------------

  function t(key, params) {
    if (window.OzarkDashboard && window.OzarkDashboard.I18n) {
      return window.OzarkDashboard.I18n.t(key, params || {});
    }
    return key;
  }

  function applyI18n() {
    document.documentElement.lang = state.lang;

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      el.textContent = t(key);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key) return;
      el.setAttribute("placeholder", t(key));
    });

    // Acessibilidade: rótulos/títulos traduzíveis.
    [
      ["data-i18n-aria-label", "aria-label"],
      ["data-i18n-title", "title"],
    ].forEach(function (pair) {
      document.querySelectorAll("[" + pair[0] + "]").forEach(function (el) {
        const key = el.getAttribute(pair[0]);
        if (!key) return;
        el.setAttribute(pair[1], t(key));
      });
    });

    const warn = document.getElementById("tabWarning");
    if (warn) warn.textContent = t("warn_select_guild");

    // Re-render badges because they include translated labels.
    try {
      updateAccessBadges();
    } catch {}

    // Os botões de preferências mostram dicas traduzidas.
    try {
      updatePrefButtons();
    } catch {}
  }

  var dashboardLanguageSequence = 0;

  async function setDashboardLanguage(language) {
    var sequence = ++dashboardLanguageSequence;
    var selectedLanguage =
      language === "en" || language === "pt" ? language : getDefaultLanguage();

    try {
      await window.OzarkDashboard.I18n.init(selectedLanguage);
    } catch (err) {
      if (sequence !== dashboardLanguageSequence) return;
      console.error("Failed to load dashboard language", selectedLanguage, err);
      selectedLanguage = "en";
      try {
        await window.OzarkDashboard.I18n.init("en");
      } catch (fallbackError) {
        console.error(
          "Failed to load fallback dashboard language",
          fallbackError,
        );
      }
    }

    if (sequence !== dashboardLanguageSequence) return;
    state.lang = selectedLanguage;
    applyI18n();
    renderGlobalGuildInventory();
  }

  async function loadGuildDashboardLanguage(guildId) {
    var sequence = ++dashboardLanguageSequence;
    if (!guildId || !(state.perms.canViewConfig || state.perms.canEditConfig)) {
      await setDashboardLanguage(getDefaultLanguage());
      return;
    }

    try {
      var response = await apiGet(
        "/guilds/" + encodeURIComponent(guildId) + "/config",
      );
      if (sequence !== dashboardLanguageSequence || state.guildId !== guildId)
        return;
      var config = response && response.config ? response.config : {};
      state.guildLanguage =
        typeof config.language === "string" ? config.language : "auto";
      await setDashboardLanguage(state.guildLanguage);
    } catch (err) {
      if (sequence !== dashboardLanguageSequence || state.guildId !== guildId)
        return;
      console.error("Failed to load configured dashboard language", err);
      await setDashboardLanguage(getDefaultLanguage());
    }
  }

  async function refreshBotStatusBadge() {
    const el = document.getElementById("badgeBot");
    if (!el) return;

    try {
      const res = await fetch("/health", { method: "GET" });
      if (!res.ok) throw new Error("Health failed");
      const data = await res.json();

      const ok = !!data.ok && !!data.discordReady;

      bannerState.lastBotOk = ok;

      el.classList.remove("status-online", "status-offline");

      if (ok) {
        el.classList.add("status-online");
        el.textContent = t("badge_bot_online");
        el.title = t("badge_bot_tooltip_online");
        refreshGlobalBanner();
      } else {
        el.classList.add("status-offline");
        el.textContent = t("badge_bot_offline");
        el.title = t("badge_bot_tooltip_offline");
        bannerState.lastBotOk = false;
        refreshGlobalBanner();
      }
    } catch (e) {
      console.error("Failed to refresh bot status badge", e);
      el.classList.remove("status-online");
      el.classList.add("status-offline");
      el.textContent = t("badge_bot_offline");
      el.title = t("badge_bot_tooltip_offline");
      bannerState.lastBotOk = false;
      refreshGlobalBanner();
    }
  }

  function updateAccessBadges() {
    var elProfile = document.getElementById("badgeProfile");
    var elAccess = document.getElementById("badgeAccess");
    if (!elProfile || !elAccess) return;

    var me = state.me;
    if (!me) {
      elProfile.classList.add("hidden");
      elAccess.classList.add("hidden");
      elProfile.textContent = "";
      elAccess.textContent = "";
      return;
    }

    var profileLabel = elProfile.querySelector('[data-role="profile-label"]');
    var profileAvatar = document.getElementById("badgeProfileAvatar");
    if (profileLabel) {
      profileLabel.textContent =
        me.role === "BOT_OWNER"
          ? t("profile_bot_owner")
          : me.username || "Discord";
    }
    if (profileAvatar) {
      profileAvatar.classList.toggle("hidden", !me.avatarUrl);
      if (me.avatarUrl) profileAvatar.src = me.avatarUrl;
      else profileAvatar.removeAttribute("src");
    }
    elProfile.classList.remove("badge-premium");
    elProfile.classList.toggle("badge-bot-owner", me.role === "BOT_OWNER");
    elProfile.classList.remove("hidden");

    var perms =
      state.perms && typeof state.perms === "object" ? state.perms : {};
    var scoped = !!(
      me.selectedGuildId ||
      (me.profile && me.profile !== "UNSCOPED")
    );
    var canManage = !!(
      me.role === "BOT_OWNER" ||
      perms.canEditConfig ||
      perms.canActOnCases ||
      perms.canManageTickets ||
      perms.canManageGameNews
    );

    var accessLabel;
    if (!scoped && me.role === "BOT_OWNER") {
      accessLabel = t("scope_global");
      elAccess.classList.add("badge-manage");
      elAccess.classList.remove("badge-readonly");
    } else if (scoped) {
      var selectedGuild = (state.guilds || []).find(function (guild) {
        return guild && guild.id === state.guildId;
      });
      accessLabel = t("scope_server", {
        server: selectedGuild ? selectedGuild.name : state.guildId,
      });
      elAccess.classList.add("badge-manage");
      elAccess.classList.remove("badge-readonly");
    } else if (me.oauth) {
      accessLabel = t("access_select_guild");
      elAccess.classList.remove("badge-readonly", "badge-manage");
    } else {
      accessLabel = canManage ? t("access_manage") : t("access_readonly");
      elAccess.classList.toggle("badge-manage", canManage);
      elAccess.classList.toggle("badge-readonly", !canManage);
    }

    elAccess.textContent = t("badge_access", { access: accessLabel });
    elAccess.classList.remove("hidden");
  }

  // ------------------------------
  // Tempo online (duração da sessão)
  // ------------------------------
  // Guardado em sessionStorage: persiste entre navegações dentro do mesmo
  // separador e é limpo ao terminar sessão. O contador arranca no primeiro
  // carregamento autenticado (ou seja, logo após o login).
  const SESSION_KEY = "ozark.loginAt";
  var sessionStartedAt = 0;

  function ensureSessionStart() {
    if (sessionStartedAt > 0) return sessionStartedAt;
    var now = Date.now();
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      var n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n > 0) {
        sessionStartedAt = n;
        return sessionStartedAt;
      }
      sessionStorage.setItem(SESSION_KEY, String(now));
    } catch {}
    sessionStartedAt = now;
    return sessionStartedAt;
  }

  function clearSessionStart() {
    sessionStartedAt = 0;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  function formatSessionDuration(ms) {
    var totalMinutes = Math.max(0, Math.floor(ms / 60000));
    var days = Math.floor(totalMinutes / 1440);
    var hours = Math.floor((totalMinutes % 1440) / 60);
    var minutes = totalMinutes % 60;
    if (days > 0) return days + "d " + hours + "h";
    if (hours > 0) return hours + "h " + minutes + "m";
    return minutes + "m";
  }

  function updateSessionBadge() {
    var el = document.getElementById("badgeSession");
    if (!el) return;
    if (!state.me) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    var elapsed = Date.now() - ensureSessionStart();
    el.textContent = t("badge_session", {
      time: formatSessionDuration(elapsed),
    });
    el.title = t("badge_session_tooltip");
    el.classList.remove("hidden");
  }

  // -----------------------------
  // Preferências de interface (tema / densidade)
  // -----------------------------
  // Vivem apenas no cliente (localStorage) e traduzem-se em atributos em
  // <html> que os tokens de tokens.css usam para fazer os overrides.

  const THEME_KEY = "ozark.theme";
  const DENSITY_KEY = "ozark.density";

  function readPref(key, allowed, fallback) {
    try {
      const raw = (localStorage.getItem(key) || "").toLowerCase();
      if (allowed.indexOf(raw) !== -1) return raw;
    } catch {}
    return fallback;
  }

  function applyTheme(theme, persist) {
    state.theme = theme === "light" ? "light" : "dark";
    const root = document.documentElement;
    if (state.theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, state.theme);
      } catch {}
    }
    updatePrefButtons();
  }

  function applyDensity(density, persist) {
    state.density = density === "compact" ? "compact" : "comfortable";
    const root = document.documentElement;
    if (state.density === "compact")
      root.setAttribute("data-density", "compact");
    else root.removeAttribute("data-density");
    if (persist) {
      try {
        localStorage.setItem(DENSITY_KEY, state.density);
      } catch {}
    }
    updatePrefButtons();
  }

  function toggleTheme() {
    applyTheme(state.theme === "light" ? "dark" : "light", true);
  }

  function toggleDensity() {
    applyDensity(state.density === "compact" ? "comfortable" : "compact", true);
  }

  function updatePrefButtons() {
    const themeBtn = document.getElementById("themeToggle");
    if (themeBtn) {
      const isLight = state.theme === "light";
      const hint = t(isLight ? "pref_theme_to_dark" : "pref_theme_to_light");
      themeBtn.setAttribute("aria-pressed", isLight ? "true" : "false");
      themeBtn.setAttribute("title", hint);
      themeBtn.setAttribute("aria-label", hint);
    }

    const densityBtn = document.getElementById("densityToggle");
    if (densityBtn) {
      const isCompact = state.density === "compact";
      const hint = t(
        isCompact ? "pref_density_to_comfortable" : "pref_density_to_compact",
      );
      densityBtn.setAttribute("aria-pressed", isCompact ? "true" : "false");
      densityBtn.setAttribute("title", hint);
      densityBtn.setAttribute("aria-label", hint);
    }
  }

  function initPreferences() {
    const themeBtn = document.getElementById("themeToggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
    const densityBtn = document.getElementById("densityToggle");
    if (densityBtn) densityBtn.addEventListener("click", toggleDensity);
    const dashboardBtn = document.getElementById("adminMenuDashboard");
    if (dashboardBtn)
      dashboardBtn.addEventListener("click", function () {
        setTab("overview");
      });
    updatePrefButtons();

    // Dropdown menu de preferências
    const prefsTrigger = document.getElementById("badgeProfile");
    const prefsPanel = document.getElementById("prefsPanel");
    if (prefsTrigger && prefsPanel && !prefsTrigger.dataset.bound) {
      prefsTrigger.dataset.bound = "1";

      function togglePrefsMenu(open) {
        const willOpen =
          typeof open === "boolean"
            ? open
            : prefsPanel.classList.contains("hidden");
        prefsPanel.classList.toggle("hidden", !willOpen);
        prefsTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      }

      prefsTrigger.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePrefsMenu();
        if (!prefsPanel.classList.contains("hidden")) {
          var firstItem = prefsPanel.querySelector('[role="menuitem"]');
          if (firstItem) firstItem.focus();
        }
      });

      // Fechar ao clicar fora
      document.addEventListener("click", function (e) {
        if (prefsPanel.classList.contains("hidden")) return;
        const menu = document.getElementById("prefsMenu");
        if (menu && !menu.contains(e.target)) togglePrefsMenu(false);
      });

      // Fechar com Escape e permitir navegação por teclado
      prefsPanel.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          togglePrefsMenu(false);
          prefsTrigger.focus();
          return;
        }
        var menuItems = Array.prototype.filter.call(
          prefsPanel.querySelectorAll('[role="menuitem"]'),
          function (item) {
            return !item.disabled && !item.classList.contains("hidden");
          },
        );
        if (!menuItems.length) return;
        var activeIndex = menuItems.indexOf(e.target);
        var nextIndex = activeIndex;
        if (e.key === "ArrowDown")
          nextIndex = (activeIndex + 1) % menuItems.length;
        else if (e.key === "ArrowUp")
          nextIndex = (activeIndex - 1 + menuItems.length) % menuItems.length;
        else if (e.key === "Home") nextIndex = 0;
        else if (e.key === "End") nextIndex = menuItems.length - 1;
        else return;
        e.preventDefault();
        menuItems[nextIndex].focus();
      });

      // Fechar após clicar num item (exceto se for um toggle que pode querer manter aberto)
      prefsPanel.querySelectorAll(".prefs-menu__item").forEach(function (item) {
        item.addEventListener("click", function () {
          // Pequeno delay para o utilizador ver o estado visual do toggle
          setTimeout(function () {
            togglePrefsMenu(false);
          }, 120);
        });
      });
    }
  }

  // Aplicar o mais cedo possível (o script é `defer`, corre antes do
  // DOMContentLoaded) para evitar um "flash" do tema errado.
  applyTheme(readPref(THEME_KEY, ["dark", "light"], "dark"), false);
  applyDensity(
    readPref(DENSITY_KEY, ["comfortable", "compact"], "comfortable"),
    false,
  );

  // -----------------------------
  // Tab / layout helpers
  // -----------------------------

  // Mantém em sincronia o estado visual e ARIA dos botões de tab.
  // Roving tabindex: só a tab ativa é alcançável por Tab; as setas movem o foco.
  function applyTabButtonState(activeName) {
    document.querySelectorAll(".tabs button[data-tab]").forEach(function (btn) {
      var isActive = btn.getAttribute("data-tab") === activeName;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
    });
  }

  function confirmLeavingGameNewsDraft() {
    var dashboard = window.OzarkDashboard;
    if (
      !dashboard ||
      typeof dashboard.hasUnsavedGameNewsChanges !== "function" ||
      !dashboard.hasUnsavedGameNewsChanges()
    ) {
      return true;
    }
    return window.confirm(t("gamenews_leave_unsaved_confirm"));
  }

  function setTab(name) {
    if (name !== state.currentTab && !confirmLeavingGameNewsDraft()) return;

    if (
      name === "premium-admin" &&
      state.me &&
      state.me.role === "BOT_OWNER" &&
      state.guildId
    ) {
      var previousGuildId = state.guildId;
      state.guildId = null;
      ensureGuildScopedToken(null)
        .then(function (ok) {
          if (!ok) {
            state.guildId = previousGuildId;
            updateTabAccess();
            return;
          }
          try {
            localStorage.removeItem(GUILD_KEY);
          } catch {}
          var picker = document.getElementById("guildPicker");
          if (picker) picker.value = "";
          updateTabAccess();
          setTab(name);
        })
        .catch(function () {
          state.guildId = previousGuildId;
          updateTabAccess();
        });
      return;
    }

    const tabsRequiringGuild = ["logs", "features", "user", "config"];
    if (!state.guildId && tabsRequiringGuild.indexOf(name) !== -1) {
      // Em vez de mudar tab, certifica-nos que overview está ativo
      state.currentTab = "overview";
      // Warning visibility is handled centrally in updateTabAccess() (prevents flashing during bootstrap).
      updateTabAccess();
      // Reforçar botões ativos
      document.querySelectorAll(".section").forEach(function (sec) {
        sec.classList.remove("active");
      });
      const section = document.getElementById("tab-overview");
      if (section) section.classList.add("active");
      applyTabButtonState("overview");
      return;
    }
    if (
      name === "premium-admin" &&
      !(state.me && state.me.role === "BOT_OWNER")
    ) {
      state.currentTab = "overview";
      name = "overview";
    }
    state.currentTab = name;

    // Avoid "opening on the right" if the previous view caused horizontal scroll.
    try {
      window.scrollTo(0, window.scrollY || 0);
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
    } catch {}

    // Reset seleção de utilizadores / GameNews ao entrar nas tabs
    if (name === "user") {
      state.selectedUserId = null;
      state.userSelectionPinned = false;
      const userDetail = document.getElementById("userDetailPanel");
      if (userDetail) {
        userDetail.innerHTML = `<div class="empty">${escapeHtml(t("users_detail_empty"))}</div>`;
      }
      const userList = document.querySelector("#tab-user .list");
      if (userList) {
        userList.querySelectorAll(".list-item").forEach(function (row) {
          row.classList.remove("active");
        });
      }
    } else if (name === "features") {
      // Os painéis de GameNews, voz temporária e giveaways são reiniciados ao entrar.
      state.activeGameNewsFeedIndex = null;
      const feedDetail = document.getElementById("gamenewsFeedDetailPanel");
      if (feedDetail) {
        feedDetail.innerHTML = `<div class="empty">${escapeHtml(t("gamenews_detail_empty"))}</div>`;
      }
      const feedList = document.getElementById("gamenewsFeedsList");
      if (feedList) {
        feedList.querySelectorAll(".list-item").forEach(function (row) {
          row.classList.remove("active");
        });
      }

      // Reset da seleção de voz temporária ao entrar na tab de funcionalidades.
      try {
        state.tempVoiceBase = state.tempVoiceBase || {
          items: [],
          selectedIndex: -1,
        };
        state.tempVoiceBase.selectedIndex = -1;

        var tvBaseIdInput =
          document.getElementById("tempVoiceAddBaseSelect") ||
          document.getElementById("tempVoiceBaseId");
        if (tvBaseIdInput) tvBaseIdInput.value = "";

        var tvEmptyEl = document.getElementById("tempVoiceDetailEmpty");
        var tvContentEl = document.getElementById("tempVoiceDetailContent");
        var tvCurrentLabel = document.getElementById(
          "tempVoiceCurrentBaseLabel",
        );
        if (tvEmptyEl) tvEmptyEl.classList.remove("hidden");
        if (tvContentEl) tvContentEl.classList.add("hidden");
        if (tvCurrentLabel) {
          tvCurrentLabel.textContent =
            t("tempvoice_current_base") + " (nenhum selecionado)";
        }
        if (typeof renderTempVoiceBaseList === "function") {
          renderTempVoiceBaseList();
        }
      } catch (e) {
        console.error("Failed to reset temp voice detail", e);
      }
    }

    document.querySelectorAll(".section").forEach(function (sec) {
      sec.classList.remove("active");
    });

    const section = document.getElementById("tab-" + name);
    if (section) section.classList.add("active");

    applyTabButtonState(name);

    updateTabAccess();
    if (name === "overview") {
      loadOverview().catch(function () {});
    } else if (name === "logs") {
      // Overlay loading for the tab while we fetch the panel data.
      setPanelLoading("tab-logs", true);
      var p1 = window.OzarkDashboard.loadModerationOverview
        ? window.OzarkDashboard.loadModerationOverview()
        : Promise.resolve();
      var p2 = window.OzarkDashboard.loadLogs
        ? window.OzarkDashboard.loadLogs()
        : Promise.resolve();
      var p3 = window.OzarkDashboard.loadTickets
        ? window.OzarkDashboard.loadTickets(true)
        : Promise.resolve();
      Promise.allSettled([p1, p2, p3]).finally(function () {
        setPanelLoading("tab-logs", false);
      });
    } else if (name === "features") {
      setPanelLoading("tab-features", true);
      var f1 = window.OzarkDashboard.loadFeatures
        ? window.OzarkDashboard.loadFeatures()
        : Promise.resolve();
      var f2 = window.OzarkDashboard.loadPremium
        ? window.OzarkDashboard.loadPremium()
        : Promise.resolve();
      // Garantir que canais/roles de configuração estão disponíveis para Tickets/Extras
      var f3 =
        typeof loadGuildConfig === "function"
          ? loadGuildConfig()
          : Promise.resolve();
      var f4 = Promise.allSettled([f2, f3]).then(function () {
        var dashboard = window.OzarkDashboard;
        if (!dashboard.isPremiumActive || !dashboard.isPremiumActive()) return;
        var modules = ["gamenews", "tempvoice", "trust", "giveaways"];
        var moduleLoads = dashboard.loadPremiumModules
          ? dashboard.loadPremiumModules(modules)
          : Promise.resolve();
        return Promise.resolve(moduleLoads).then(function () {
          if (typeof dashboard.diagnosePremiumModule !== "function") return;
          return Promise.allSettled(
            modules.map(function (module) {
              return dashboard.diagnosePremiumModule(module);
            }),
          );
        });
      });
      Promise.allSettled([f1, f2, f3, f4]).finally(function () {
        setPanelLoading("tab-features", false);
      });
    } else if (name === "user") {
      setPanelLoading("tab-user", true);
      var u1 = window.OzarkDashboard.loadUsers
        ? window.OzarkDashboard.loadUsers()
        : Promise.resolve();
      var u2 = window.OzarkDashboard.loadPremium
        ? window.OzarkDashboard.loadPremium()
        : Promise.resolve();
      Promise.allSettled([u1, u2]).finally(function () {
        setPanelLoading("tab-user", false);
      });
    } else if (name === "config") {
      setPanelLoading("tab-config", true);
      // A auditoria só carrega a pedido (botão "Recarregar" ou filtros):
      // entrar na aba não deve disparar pedidos que o utilizador não pediu.
      var c1 =
        typeof loadGuildConfig === "function"
          ? loadGuildConfig()
          : Promise.resolve();
      Promise.resolve(c1).finally(function () {
        setPanelLoading("tab-config", false);
      });
    } else if (name === "premium-admin") {
      setPanelLoading("tab-premium-admin", true);
      var maintenanceLoad = loadBotMaintenance();
      var managementOverviewLoad = loadBotManagementOverview();
      var premiumAdminLoad =
        window.OzarkDashboard && window.OzarkDashboard.loadPremiumAdmin
          ? window.OzarkDashboard.loadPremiumAdmin()
          : Promise.resolve();
      Promise.allSettled([
        maintenanceLoad,
        managementOverviewLoad,
        premiumAdminLoad,
      ]).finally(function () {
        setPanelLoading("tab-premium-admin", false);
      });
    }
  }

  function updateTabAccess() {
    const warn = document.getElementById("tabWarning");
    const hasGuild = !!state.guildId;
    const ready = !!state.guildsLoaded;
    const globalPremiumView = state.currentTab === "premium-admin";
    const globalOwnerView =
      state.me && state.me.role === "BOT_OWNER" && !hasGuild;
    var globalInventory = document.getElementById("overviewGlobalInventory");
    var globalShortcuts = document.getElementById("overviewGlobalShortcuts");
    var serverShortcuts = document.getElementById("overviewServerShortcuts");
    if (globalInventory)
      globalInventory.classList.toggle("hidden", !globalOwnerView);
    if (globalShortcuts)
      globalShortcuts.classList.toggle("hidden", !globalOwnerView);
    if (serverShortcuts) serverShortcuts.classList.toggle("hidden", !hasGuild);
    if (warn) {
      // Avoid flashing the warning during bootstrap (before guilds are loaded).
      warn.style.display =
        !ready || hasGuild || globalPremiumView || globalOwnerView
          ? "none"
          : "block";
      warn.classList.toggle(
        "hidden",
        !ready || hasGuild || globalPremiumView || globalOwnerView,
      );
    }

    const p =
      state && state.perms && typeof state.perms === "object"
        ? state.perms
        : {};
    const isAuthed = !!(state && state.me);
    const canViewLogs = !!p.canViewLogs;
    const canActOnCases = !!p.canActOnCases;
    const canManageTickets = !!p.canManageTickets;
    const canViewConfig = !!(p.canViewConfig || p.canEditConfig);

    // While OAuth is unscoped (before selecting a guild), disable everything that requires permissions.
    const requiresPerms = hasGuild && isAuthed;
    const ticketsPanel = document.getElementById("ticketsManagementPanel");
    if (ticketsPanel)
      ticketsPanel.classList.toggle(
        "hidden",
        !requiresPerms || !canManageTickets,
      );

    const tabRules = {
      logs: requiresPerms && canViewLogs,
      user: requiresPerms && canActOnCases,
      features: requiresPerms && canViewConfig,
      config: requiresPerms && canViewConfig,
      "premium-admin": !!(state.me && state.me.role === "BOT_OWNER"),
    };

    const tabs = ["logs", "features", "user", "config", "premium-admin"];
    tabs.forEach(function (name) {
      const btn = document.querySelector(
        '.tabs button[data-tab="' + name + '"]',
      );
      if (!btn) return;
      btn.classList.toggle(
        "hidden",
        name === "premium-admin" && !tabRules[name],
      );
      btn.disabled =
        name === "premium-admin"
          ? !tabRules[name]
          : !hasGuild || !tabRules[name];
    });

    // Atalhos do Overview seguem as mesmas regras das abas.
    document
      .querySelectorAll("#overviewShortcuts [data-goto]")
      .forEach(function (btn) {
        const name = btn.getAttribute("data-goto");
        btn.disabled = !hasGuild || !tabRules[name];
      });

    // If current tab becomes inaccessible, fallback to overview.
    if (state.currentTab && state.currentTab !== "overview") {
      const allowed = tabRules[state.currentTab] === true;
      if ((!hasGuild && state.currentTab !== "premium-admin") || !allowed) {
        setTab("overview");
      }
    }
  }

  // -----------------------------
  // Overview
  // -----------------------------

  function animateKpiValue(el, value) {
    const target = Number(value) || 0;
    if (!el) return;
    el.textContent = "0";
    el.classList.add("kpi-value--loading");
    const duration = 500;
    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(target * eased);
      el.textContent = String(current);
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        el.textContent = String(target);
        el.classList.remove("kpi-value--loading");
      }
    }
    requestAnimationFrame(frame);
  }

  function renderKpiTrend(trendEl, trend) {
    if (!trendEl) return;
    if (!trend || typeof trend !== "object") {
      trendEl.classList.add("hidden");
      return;
    }
    const dir = trend.direction; // 'up' | 'down' | 'neutral'
    const pct = trend.percent;
    if (!dir || typeof pct !== "number") {
      trendEl.classList.add("hidden");
      return;
    }
    const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
    trendEl.textContent = arrow + " " + Math.abs(Math.round(pct)) + "%";
    trendEl.classList.remove(
      "hidden",
      "kpi__trend--up",
      "kpi__trend--down",
      "kpi__trend--neutral",
    );
    trendEl.classList.add("kpi__trend--" + dir);
  }

  async function loadOverview() {
    const guildsEl = document.getElementById("kpiGuilds");
    const usersEl = document.getElementById("kpiUsers");
    const actionsEl = document.getElementById("kpiActions24h");
    if (!guildsEl || !usersEl || !actionsEl) return;

    const isGlobal =
      !state.guildId && state.me && state.me.role === "BOT_OWNER";
    const title = document.getElementById("overviewTitle");
    const hint = document.getElementById("overviewHint");
    const guildKpi = document.getElementById("overviewGuildKpi");
    const kpis = document.getElementById("overviewKpis");
    const guildLabel = guildKpi && guildKpi.querySelector(".kpi-label");
    if (title) {
      title.setAttribute(
        "data-i18n",
        isGlobal ? "overview_global_title" : "overview_server_title",
      );
      title.textContent = t(
        isGlobal ? "overview_global_title" : "overview_server_title",
      );
    }
    if (hint) {
      hint.setAttribute(
        "data-i18n",
        isGlobal ? "overview_global_hint" : "overview_server_hint",
      );
      hint.textContent = t(
        isGlobal ? "overview_global_hint" : "overview_server_hint",
      );
    }
    if (guildLabel) {
      guildLabel.setAttribute(
        "data-i18n",
        isGlobal ? "kpi_guilds" : "kpi_server_scope",
      );
      guildLabel.textContent = t(isGlobal ? "kpi_guilds" : "kpi_server_scope");
    }
    if (guildKpi) guildKpi.classList.toggle("hidden", !isGlobal);
    if (kpis) kpis.classList.toggle("overview-kpis--server", !isGlobal);
    const readinessPanel = document.getElementById("overviewServerReadiness");
    if (readinessPanel) {
      readinessPanel.classList.toggle("hidden", !state.guildId);
      if (state.guildId) loadServerReadiness(state.guildId);
    }

    try {
      const overviewPath = state.guildId
        ? "/overview?guildId=" + encodeURIComponent(state.guildId)
        : "/overview";
      const data = await apiGet(overviewPath);
      if (!data || data.ok === false) {
        throw new Error("Bad payload");
      }
      animateKpiValue(guildsEl, data.guilds ?? 0);
      animateKpiValue(usersEl, data.users ?? 0);
      animateKpiValue(actionsEl, data.actions24h ?? 0);

      // Tendências (opcionais — a API pode incluir trends.guilds/users/actions)
      if (data.trends) {
        renderKpiTrend(
          document.getElementById("kpiGuildsTrend"),
          data.trends.guilds,
        );
        renderKpiTrend(
          document.getElementById("kpiUsersTrend"),
          data.trends.users,
        );
        renderKpiTrend(
          document.getElementById("kpiActionsTrend"),
          data.trends.actions,
        );
      }
    } catch (err) {
      console.error("Overview load error", err);
      toast(
        err && err.apiMessage ? err.apiMessage : t("overview_error_generic"),
        { type: "error" },
      );
    }
  }

  var readinessRequestSequence = 0;

  async function loadServerReadiness(guildId) {
    var checklist = document.getElementById("overviewSetupChecklist");
    var healthList = document.getElementById("overviewFeatureHealth");
    var summary = document.getElementById("overviewReadinessSummary");
    if (!checklist || !healthList || !guildId) return;

    var requestSequence = ++readinessRequestSequence;
    var scopedGuildId = String(guildId);
    checklist.innerHTML = "";
    healthList.innerHTML = "";
    if (summary) summary.textContent = t("loading");

    try {
      var results = await Promise.all([
        apiGet("/guilds/" + encodeURIComponent(scopedGuildId) + "/config"),
        apiGet("/guilds/" + encodeURIComponent(scopedGuildId) + "/meta"),
        apiGet("/features?guildId=" + encodeURIComponent(scopedGuildId)),
      ]);
      if (
        requestSequence !== readinessRequestSequence ||
        String(state.guildId || "") !== scopedGuildId
      )
        return;

      var config = results[0] && results[0].config ? results[0].config : {};
      var channels =
        results[1] && Array.isArray(results[1].channels)
          ? results[1].channels
          : [];
      var roles =
        results[1] && Array.isArray(results[1].roles) ? results[1].roles : [];
      var featureData = results[2] || {};
      var features = featureData.features || {};
      var configuredFeatures = featureData.configuredFeatures || {};
      var guild = (state.guilds || []).find(function (item) {
        return item && String(item.id) === scopedGuildId;
      });
      var staffByFeature = config.staffRolesByFeature || {};
      var staffIds = [].concat(
        config.staffRoleIds || [],
        staffByFeature.moderation || [],
        staffByFeature.tickets || [],
      );
      var hasStaffRole = staffIds.some(function (id) {
        return roles.some(function (role) {
          return String(role.id) === String(id);
        });
      });
      var hasLogChannel = channels.some(function (channel) {
        return String(channel.id) === String(config.logChannelId || "");
      });
      var configuredCount = Object.keys(configuredFeatures).filter(
        function (key) {
          return configuredFeatures[key] === true;
        },
      ).length;
      var canEdit =
        !!(state.me && state.me.role === "BOT_OWNER") ||
        !!(state.perms && state.perms.canEditConfig);

      function appendSetupItem(labelText, complete, target) {
        var item = document.createElement("li");
        item.className = "overview-readiness__item";
        var label = document.createElement("span");
        label.textContent = labelText;
        var status = document.createElement("span");
        status.className =
          "overview-readiness__status " +
          (complete ? "is-complete" : "is-pending");
        status.textContent = t(
          complete ? "overview_check_done" : "overview_check_pending",
        );
        item.appendChild(label);
        item.appendChild(status);
        if (!complete && target && canEdit) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "btn xs btn-ghost";
          button.dataset.goto = target;
          button.textContent = t("overview_open");
          item.appendChild(button);
        }
        checklist.appendChild(item);
      }

      appendSetupItem(t("overview_setup_bot"), !!(guild && guild.botPresent));
      appendSetupItem(t("overview_setup_logs"), hasLogChannel, "config");
      appendSetupItem(t("overview_setup_staff"), hasStaffRole, "config");
      appendSetupItem(
        t("overview_setup_tickets"),
        !!config.ticketThreadChannelId,
        "features",
      );
      appendSetupItem(
        t("overview_setup_features"),
        configuredCount > 0,
        "features",
      );

      var activeFeatures = Object.keys(configuredFeatures).filter(
        function (key) {
          return (
            configuredFeatures[key] === true &&
            features[key] &&
            features[key].enabled === true
          );
        },
      );
      var diagnoses = await Promise.allSettled(
        activeFeatures.map(function (key) {
          return apiGet(
            "/features/" +
              encodeURIComponent(key) +
              "/diagnose?guildId=" +
              encodeURIComponent(scopedGuildId),
          );
        }),
      );
      if (
        requestSequence !== readinessRequestSequence ||
        String(state.guildId || "") !== scopedGuildId
      )
        return;

      var attentionCount = 0;
      var featureNames = {
        messageLogs: t("feature_message_logs_name"),
        reactionRoles: t("feature_reaction_roles_name"),
        autoKick: t("feature_auto_kick_name"),
        autoModeration: t("feature_auto_moderation_name"),
        antiSpam: t("feature_anti_spam_name"),
        levels: t("feature_levels_name"),
        starboard: t("feature_starboard_name"),
        polls: t("feature_polls_name"),
        verification: t("feature_verification_name"),
        tickets: t("feature_tickets_name"),
        welcome: t("feature_welcome_name"),
        goodbye: t("feature_goodbye_name"),
        serverStats: t("feature_server_stats_name"),
        memes: t("feature_memes_name"),
        twitch: t("feature_twitch_name"),
      };
      diagnoses.forEach(function (result, index) {
        var key = activeFeatures[index];
        var diagnosis =
          result.status === "fulfilled" && result.value
            ? result.value.diagnosis
            : null;
        var statusValue =
          diagnosis && diagnosis.status ? diagnosis.status : "error";
        var healthy = statusValue === "ready";
        if (!healthy) attentionCount += 1;

        var item = document.createElement("li");
        item.className = "overview-readiness__item";
        var label = document.createElement("span");
        label.textContent = featureNames[key] || key;
        var status = document.createElement("span");
        status.className =
          "overview-readiness__status " +
          (healthy ? "is-complete" : "is-pending");
        var statusKey =
          {
            ready: "features_diagnosis_status_ready",
            incomplete: "features_diagnosis_status_incomplete",
            blocked: "features_diagnosis_status_blocked",
            disabled: "features_diagnosis_status_disabled",
            error: "features_diagnosis_status_error",
          }[statusValue] || "features_diagnosis_status_error";
        status.textContent = t(statusKey);
        item.appendChild(label);
        item.appendChild(status);
        if (!healthy) {
          var fixButton = document.createElement("button");
          fixButton.type = "button";
          fixButton.className = "btn xs btn-ghost";
          fixButton.dataset.goto = "features";
          fixButton.textContent = t("overview_health_fix");
          item.appendChild(fixButton);
        }
        healthList.appendChild(item);
      });
      if (!activeFeatures.length) {
        var empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = t("overview_health_none");
        healthList.appendChild(empty);
      }
      if (summary) {
        summary.textContent = t("overview_health_summary", {
          checked: String(activeFeatures.length),
          attention: String(attentionCount),
        });
      }
    } catch (error) {
      if (requestSequence !== readinessRequestSequence) return;
      console.error("Server readiness load error", error);
      if (summary) summary.textContent = t("overview_readiness_error");
      checklist.innerHTML = "";
      healthList.innerHTML = "";
    }
  }

  function renderGlobalGuildInventory(query) {
    var list = document.getElementById("overviewGuildInventoryList");
    var empty = document.getElementById("overviewGuildInventoryEmpty");
    var picker = document.getElementById("guildPicker");
    var search = document.getElementById("overviewGuildSearch");
    var filters = document.getElementById("overviewGuildFilters");
    var summary = document.getElementById("overviewGuildInventorySummary");
    if (!list || !empty) return;
    if (search && !search.dataset.bound) {
      search.dataset.bound = "1";
      search.addEventListener("input", function () {
        renderGlobalGuildInventory(search.value);
      });
    }

    if (filters && !filters.dataset.bound) {
      filters.dataset.bound = "1";
      filters.addEventListener("click", function (event) {
        var button = event.target.closest("[data-inventory-filter]");
        if (!button || !filters.contains(button)) return;
        state.guildInventoryFilter = button.dataset.inventoryFilter;
        renderGlobalGuildInventory(search ? search.value : "");
      });
    }

    var allGuilds = (state.guilds || []).filter(Boolean);
    var manageableCount = allGuilds.filter(function (guild) {
      return guild.manageable;
    }).length;
    var connectedCount = allGuilds.filter(function (guild) {
      return guild.botPresent;
    }).length;
    if (summary) {
      summary.textContent = t("overview_inventory_summary", {
        manageable: manageableCount.toLocaleString(state.lang),
        total: allGuilds.length.toLocaleString(state.lang),
        connected: connectedCount.toLocaleString(state.lang),
      });
    }
    if (filters) {
      Array.prototype.forEach.call(
        filters.querySelectorAll("[data-inventory-filter]"),
        function (button) {
          var active =
            button.dataset.inventoryFilter === state.guildInventoryFilter;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        },
      );
    }

    var normalizedQuery = String(query || "")
      .trim()
      .toLocaleLowerCase();
    var guilds = allGuilds.filter(function (guild) {
      var matchesQuery =
        guild &&
        (!normalizedQuery ||
          String(guild.name || "")
            .toLocaleLowerCase()
            .includes(normalizedQuery));
      var matchesFilter =
        state.guildInventoryFilter === "all" ||
        (state.guildInventoryFilter === "manageable" && guild.manageable) ||
        (state.guildInventoryFilter === "connected" && guild.botPresent);
      return matchesQuery && matchesFilter;
    });
    list.innerHTML = "";
    guilds.forEach(function (guild) {
      var row = document.createElement("div");
      row.className = "list-item overview-guild-row";
      row.setAttribute("role", "listitem");

      var identity = document.createElement("div");
      identity.className = "overview-guild-row__identity";
      var name = document.createElement("strong");
      name.className = "title";
      name.textContent = guild.name || guild.id;
      var metadata = document.createElement("span");
      metadata.className = "subtitle";
      metadata.textContent =
        typeof guild.memberCount === "number"
          ? t("overview_inventory_members", {
              count: guild.memberCount.toLocaleString(state.lang),
            })
          : guild.id;
      identity.appendChild(name);
      identity.appendChild(metadata);
      row.appendChild(identity);

      var statuses = document.createElement("div");
      statuses.className = "overview-guild-row__statuses";
      var botStatus = document.createElement("span");
      botStatus.className =
        "badge overview-guild-row__bot-status " +
        (guild.botPresent ? "is-connected" : "is-disconnected");
      botStatus.textContent = t(
        guild.botPresent
          ? "overview_inventory_bot_connected"
          : "overview_inventory_bot_not_connected",
      );
      statuses.appendChild(botStatus);
      var accessStatus = document.createElement("span");
      accessStatus.className = "badge badge-readonly";
      accessStatus.textContent = t(
        guild.manageable
          ? "overview_inventory_manageable"
          : "overview_inventory_no_access",
      );
      statuses.appendChild(accessStatus);
      row.appendChild(statuses);

      if (guild.manageable) {
        var openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "btn xs";
        openButton.textContent = t("overview_open_server");
        openButton.addEventListener("click", function () {
          if (!picker) return;
          picker.value = guild.id;
          picker.dispatchEvent(new Event("change", { bubbles: true }));
        });
        row.appendChild(openButton);
      }
      list.appendChild(row);
    });
    empty.classList.toggle("hidden", guilds.length > 0);
  }

  // -----------------------------
  // Guilds + Users
  // -----------------------------

  async function loadGuilds() {
    const select = document.getElementById("guildPicker");
    if (!select) return;

    state.guildsLoaded = false;

    select.innerHTML = "";
    const optLoading = document.createElement("option");
    optLoading.value = "";
    optLoading.textContent = t("guilds_loading_option");
    select.appendChild(optLoading);

    try {
      const res = await apiGet("/guilds");
      if (res && res.reason === "NO_ELIGIBLE_GUILDS") {
        // User has no eligible guilds (must be owner or Administrator). Force logout and show login message.
        try {
          await forceLogout();
        } catch {}
        try {
          if (typeof window.OzarkDashboard.showLogin === "function")
            window.OzarkDashboard.showLogin();
        } catch {}
        return;
      }
      const items = (res && res.items) || [];
      state.guilds = items;
      renderGlobalGuildInventory();
      select.innerHTML = "";

      var returnParams = new URLSearchParams(window.location.search);
      var paymentReturnStatus = returnParams.get("premiumPayment");
      var paymentReturnGuildId = returnParams.get("guildId");
      var isBotOwner = state.me && state.me.role === "BOT_OWNER";
      if (
        paymentReturnStatus &&
        paymentReturnGuildId &&
        items.some(function (g) {
          return g && g.id === paymentReturnGuildId && g.manageable;
        })
      ) {
        state.guildId = paymentReturnGuildId;
        setStoredGuildId(state.guildId);
      }

      const optEmpty = document.createElement("option");
      optEmpty.value = "";
      optEmpty.textContent = t(isBotOwner ? "scope_global" : "select_guild");
      select.appendChild(optEmpty);

      items.forEach(function (g) {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.dataset.guildName = g.name;
        opt.dataset.manageable = g.manageable ? "true" : "false";
        opt.textContent = g.manageable
          ? g.name
          : g.name + " · " + t("guild_read_only");
        opt.disabled = !g.manageable;
        select.appendChild(opt);
      });

      // Restore the last selected guild for every profile when it is still allowed.
      if (!state.guildId) {
        var stored = getStoredGuildId();
        if (
          stored &&
          items.some(function (g) {
            return g && g.id === stored && g.manageable;
          })
        ) {
          state.guildId = stored;
        } else if (stored) {
          localStorage.removeItem(GUILD_KEY);
        }
      }

      // Bot owners default to Global; server admins can auto-select one guild.
      const manageableGuilds = items.filter(function (guild) {
        return guild && guild.manageable;
      });
      if (
        !isBotOwner &&
        !state.guildId &&
        manageableGuilds.length === 1 &&
        manageableGuilds[0].id
      ) {
        state.guildId = manageableGuilds[0].id;
        setStoredGuildId(state.guildId);
      }

      if (isBotOwner && !state.guildId) {
        localStorage.removeItem(GUILD_KEY);
        await ensureGuildScopedToken(null);
      }

      // Mark loaded before we show/hide warnings.
      state.guildsLoaded = true;

      if (state.guildId) {
        select.value = state.guildId;
        const scopedOk = await ensureGuildScopedToken(state.guildId);
        if (!scopedOk) {
          // If the stored/selected guild is no longer allowed, clear it and force the selector.
          state.guildId = null;
          try {
            localStorage.removeItem(GUILD_KEY);
          } catch {}
          select.value = "";
          if (!isBotOwner) {
            try {
              window.OzarkDashboard.showGuildSelect(manageableGuilds);
            } catch {}
          }
          updateTabAccess();
          return;
        }
        await loadGuildDashboardLanguage(state.guildId);
        updateTabAccess();
        try {
          refreshGlobalBanner();
        } catch {}
        if (paymentReturnStatus) {
          if (paymentReturnStatus === "success") setTab("features");
          window.dispatchEvent(
            new CustomEvent("dashboard:premium-return", {
              detail: { status: paymentReturnStatus, guildId: state.guildId },
            }),
          );
          returnParams.delete("premiumPayment");
          returnParams.delete("guildId");
          var returnQuery = returnParams.toString();
          window.history.replaceState(
            null,
            "",
            window.location.pathname +
              (returnQuery ? "?" + returnQuery : "") +
              window.location.hash,
          );
        }
      } else {
        // Server admins with multiple eligible guilds must choose one. Bot owners stay Global.
        if (!isBotOwner && manageableGuilds.length > 1) {
          try {
            window.OzarkDashboard.showGuildSelect(manageableGuilds);
          } catch {}
        }
        updateTabAccess();
        try {
          refreshGlobalBanner();
        } catch {}
      }
    } catch (err) {
      console.error("Failed to load guilds", err);
      toast(
        err && err.apiMessage ? err.apiMessage : t("guilds_error_generic"),
        { type: "error" },
      );
      state.guildsLoaded = true;
      updateTabAccess();
      try {
        refreshGlobalBanner();
      } catch {}
    }
  }

  async function loadMe() {
    try {
      const res = await apiGet("/auth/me");
      state.me = res && res.user ? res.user : null;
      state.perms =
        state.me &&
        state.me.permissions &&
        typeof state.me.permissions === "object"
          ? state.me.permissions
          : {};
      applyPermissionGates();
      updateTabAccess();
      updateAccessBadges();
      updateSessionBadge();
    } catch {
      state.me = null;
      state.perms = {};
      clearSessionStart();
      applyPermissionGates();
      updateTabAccess();
      updateAccessBadges();
      updateSessionBadge();
    }
  }

  function applyPermissionGates() {
    // Trust controls live inside the Config tab (Extras -> Trust).
    const canEdit = !!(
      state.me &&
      (state.me.role === "BOT_OWNER" || state.perms.canEditConfig)
    );
    const trustInputs = [
      "trustPresetSelect",
      "btnApplyTrustPreset",
      "btnSaveTrustConfig",
      "trustBaseInput",
      "trustMinInput",
      "trustMaxInput",
      "trustWarnPenaltyInput",
      "trustMutePenaltyInput",
      "trustRegenPerDayInput",
      "trustRegenMaxDaysInput",
      "trustLowThresholdInput",
      "trustHighThresholdInput",
    ];
    trustInputs.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.disabled = !canEdit;
    });
  }

  // -----------------------------
  // Trust presets (Config -> Extras -> Trust)
  // -----------------------------

  const TRUST_PRESETS = {
    balanced: {
      base: 50,
      min: 0,
      max: 100,
      warnPenalty: 8,
      mutePenalty: 20,
      regenPerDay: 2,
      regenMaxDays: 21,
      lowThreshold: 25,
      highThreshold: 75,
      lowTrustWarningsPenalty: 1,
      lowTrustMessagesPenalty: 2,
      highTrustMessagesBonus: 1,
      lowTrustMuteMultiplier: 2.0,
      highTrustMuteMultiplier: 0.6,
    },
    strict: {
      base: 40,
      min: 0,
      max: 100,
      warnPenalty: 10,
      mutePenalty: 25,
      regenPerDay: 1,
      regenMaxDays: 14,
      lowThreshold: 35,
      highThreshold: 80,
      lowTrustWarningsPenalty: 1,
      lowTrustMessagesPenalty: 2,
      highTrustMessagesBonus: 0,
      lowTrustMuteMultiplier: 2.2,
      highTrustMuteMultiplier: 0.7,
    },
    relaxed: {
      base: 60,
      min: 0,
      max: 100,
      warnPenalty: 6,
      mutePenalty: 15,
      regenPerDay: 3,
      regenMaxDays: 30,
      lowThreshold: 20,
      highThreshold: 70,
      lowTrustWarningsPenalty: 0,
      lowTrustMessagesPenalty: 1,
      highTrustMessagesBonus: 2,
      lowTrustMuteMultiplier: 1.6,
      highTrustMuteMultiplier: 0.55,
    },
  };

  function readNum(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = Number(el.value);
    return Number.isFinite(v) ? v : null;
  }

  function setNum(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value === null || value === undefined ? "" : String(value);
  }

  function getTrustInputs() {
    return {
      base: readNum("trustBaseInput"),
      min: readNum("trustMinInput"),
      max: readNum("trustMaxInput"),
      warnPenalty: readNum("trustWarnPenaltyInput"),
      mutePenalty: readNum("trustMutePenaltyInput"),
      regenPerDay: readNum("trustRegenPerDayInput"),
      regenMaxDays: readNum("trustRegenMaxDaysInput"),
      lowThreshold: readNum("trustLowThresholdInput"),
      highThreshold: readNum("trustHighThresholdInput"),
    };
  }

  function setTrustInputs(cfg) {
    const c = cfg || {};
    setNum("trustBaseInput", c.base);
    setNum("trustMinInput", c.min);
    setNum("trustMaxInput", c.max);
    setNum("trustWarnPenaltyInput", c.warnPenalty);
    setNum("trustMutePenaltyInput", c.mutePenalty);
    setNum("trustRegenPerDayInput", c.regenPerDay);
    setNum("trustRegenMaxDaysInput", c.regenMaxDays);
    setNum("trustLowThresholdInput", c.lowThreshold);
    setNum("trustHighThresholdInput", c.highThreshold);
  }

  function nearlyEqual(a, b) {
    return Number(a) === Number(b);
  }

  function detectTrustPreset(cfg) {
    const c = cfg || {};
    const keys = [
      "base",
      "min",
      "max",
      "warnPenalty",
      "mutePenalty",
      "regenPerDay",
      "regenMaxDays",
      "lowThreshold",
      "highThreshold",
      "lowTrustWarningsPenalty",
      "lowTrustMessagesPenalty",
      "highTrustMessagesBonus",
      "lowTrustMuteMultiplier",
      "highTrustMuteMultiplier",
    ];
    for (const [name, preset] of Object.entries(TRUST_PRESETS)) {
      const ok = keys.every((k) => nearlyEqual(c[k], preset[k]));
      if (ok) return name;
    }
    return "custom";
  }

  function validateTrustCore(cfg) {
    const c = cfg || {};
    const req = [
      "base",
      "min",
      "max",
      "warnPenalty",
      "mutePenalty",
      "regenPerDay",
      "regenMaxDays",
      "lowThreshold",
      "highThreshold",
    ];
    const allFieldIds = [
      "trustBaseInput",
      "trustMinInput",
      "trustMaxInput",
      "trustWarnPenaltyInput",
      "trustMutePenaltyInput",
      "trustRegenPerDayInput",
      "trustRegenMaxDaysInput",
      "trustLowThresholdInput",
      "trustHighThresholdInput",
    ];

    for (const k of req) {
      if (!Number.isFinite(Number(c[k]))) {
        return {
          ok: false,
          msg: t("trust_invalid_numbers"),
          fields: allFieldIds,
        };
      }
    }

    const min = Number(c.min);
    const max = Number(c.max);
    const base = Number(c.base);
    const low = Number(c.lowThreshold);
    const high = Number(c.highThreshold);

    if (min < 0 || max > 100 || min >= max) {
      return {
        ok: false,
        msg: t("trust_invalid_range"),
        fields: ["trustMinInput", "trustMaxInput"],
      };
    }
    if (base < min || base > max) {
      return {
        ok: false,
        msg: t("trust_invalid_base"),
        fields: ["trustBaseInput"],
      };
    }
    if (low < min || high > max || low >= high) {
      return {
        ok: false,
        msg: t("trust_invalid_thresholds"),
        fields: [
          "trustLowThresholdInput",
          "trustHighThresholdInput",
          "trustMinInput",
          "trustMaxInput",
        ],
      };
    }
    if (Number(c.warnPenalty) < 0 || Number(c.mutePenalty) < 0) {
      return {
        ok: false,
        msg: t("trust_invalid_penalties"),
        fields: ["trustWarnPenaltyInput", "trustMutePenaltyInput"],
      };
    }
    if (Number(c.regenPerDay) < 0 || Number(c.regenMaxDays) < 0) {
      return {
        ok: false,
        msg: t("trust_invalid_regen"),
        fields: ["trustRegenPerDayInput", "trustRegenMaxDaysInput"],
      };
    }
    return { ok: true };
  }

  function buildTrustPatch(core, presetKey) {
    const k = presetKey || "custom";
    const baseExtra = state.currentTrustConfig || TRUST_PRESETS.balanced;
    const presetExtra = TRUST_PRESETS[k];
    const extra =
      presetExtra && k !== "custom"
        ? presetExtra
        : state.trustExtraOverride || baseExtra;

    return {
      trust: {
        enabled:
          !document.getElementById("trustEnabled") ||
          document.getElementById("trustEnabled").checked,
        base: Number(core.base),
        min: Number(core.min),
        max: Number(core.max),
        warnPenalty: Number(core.warnPenalty),
        mutePenalty: Number(core.mutePenalty),
        regenPerDay: Number(core.regenPerDay),
        regenMaxDays: Number(core.regenMaxDays),
        lowThreshold: Number(core.lowThreshold),
        highThreshold: Number(core.highThreshold),

        // Advanced knobs (kept stable unless a preset is applied)
        lowTrustWarningsPenalty: Number(extra.lowTrustWarningsPenalty),
        lowTrustMessagesPenalty: Number(extra.lowTrustMessagesPenalty),
        highTrustMessagesBonus: Number(extra.highTrustMessagesBonus),
        lowTrustMuteMultiplier: Number(extra.lowTrustMuteMultiplier),
        highTrustMuteMultiplier: Number(extra.highTrustMuteMultiplier),
      },
    };
  }

  // -----------------------------
  // Guild Config
  // -----------------------------

  let _configStatusTimer = null;
  function setConfigStatus(msg, opts) {
    var el = document.getElementById("configStatus");
    if (!el) return;
    if (_configStatusTimer) {
      clearTimeout(_configStatusTimer);
      _configStatusTimer = null;
    }
    el.textContent = msg || "";
    const autoHideMs = opts && Number(opts.autoHideMs);
    if (msg && Number.isFinite(autoHideMs) && autoHideMs > 0) {
      _configStatusTimer = setTimeout(function () {
        // Only clear if we are not dirty (avoid hiding the UNSAVED state)
        if (!state.configDirty) {
          const el2 = document.getElementById("configStatus");
          if (el2) el2.textContent = "";
        }
      }, autoHideMs);
    }
  }

  function setConfigDirty(isDirty) {
    state.configDirty = !!isDirty;
    var btn = document.getElementById("btnSaveGuildConfig");
    if (btn) btn.disabled = !state.configDirty;

    // UX: keep "unsaved" visible; do not keep "loaded" permanently.
    if (state.configDirty) {
      setConfigStatus(t("config_status_unsaved"));
    } else {
      setConfigStatus("");
    }
  }

  function markConfigDirty() {
    setConfigDirty(true);
  }

  function bindConfigDirtyListeners() {
    var ids = [
      "configLogChannel",
      "configDashboardLogChannel",
      "configStaffRoles",
      "staffRolesModeration",
      "staffRolesTickets",
      "configServerLanguage",
      "configServerTimezone",
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.dataset.dirtyBound) return;
      el.dataset.dirtyBound = "1";
      function onDirty() {
        clearInlineError(el);
        markConfigDirty();
      }
      el.addEventListener("change", onDirty);
      el.addEventListener("input", onDirty);
    });
  }

  async function loadGuildConfig() {
    if (!state.guildId) {
      updateTabAccess();
      return;
    }

    const configGuildId = state.guildId;
    const statusEl = document.getElementById("configStatus");
    if (statusEl) {
      statusEl.textContent = t("config_loading");
    }

    try {
      const meta = await apiGet(
        "/guilds/" + encodeURIComponent(configGuildId) + "/meta",
      );
      const cfg = await apiGet(
        "/guilds/" + encodeURIComponent(configGuildId) + "/config",
      );
      if (state.guildId !== configGuildId) return;

      const channels = (meta && meta.channels) || [];
      const roles = (meta && meta.roles) || [];
      const voiceChannels = (meta && meta.voiceChannels) || [];
      const categories = (meta && meta.categories) || [];
      const conf = cfg && cfg.config ? cfg.config : {};

      // Cache meta for UI helpers
      state._guildMeta = state._guildMeta || {};
      state._guildMeta.roles = roles;
      state._guildMeta.channels = channels;
      state._guildMeta.voiceChannels = voiceChannels;
      state._guildMeta.categories = categories;

      // Server language / timezone (guild-level settings)
      state.guildLanguage =
        conf && typeof conf.language === "string" ? conf.language : "auto";
      state.guildTimezone =
        conf && typeof conf.timezone === "string" && conf.timezone.trim()
          ? conf.timezone.trim()
          : null;
      await setDashboardLanguage(state.guildLanguage);

      const logSelect = document.getElementById("configLogChannel");
      const dashLogSelect = document.getElementById(
        "configDashboardLogChannel",
      );
      const staffSelect = document.getElementById("configStaffRoles");
      const langSelect = document.getElementById("configServerLanguage");
      const tzSelect = document.getElementById("configServerTimezone");
      if (langSelect) langSelect.value = state.guildLanguage || "auto";
      if (tzSelect) tzSelect.value = state.guildTimezone || "";

      if (logSelect) {
        logSelect.innerHTML = "";
        const optNone = document.createElement("option");
        optNone.value = "";
        optNone.textContent = t("common_none_option");
        logSelect.appendChild(optNone);

        channels.forEach(function (ch) {
          const opt = document.createElement("option");
          opt.value = ch.id;
          opt.textContent = "#" + ch.name + " (" + ch.id + ")";
          if (conf.logChannelId && conf.logChannelId === ch.id)
            opt.selected = true;
          logSelect.appendChild(opt);
        });
      }

      if (dashLogSelect) {
        dashLogSelect.innerHTML = "";
        const optNone2 = document.createElement("option");
        optNone2.value = "";
        optNone2.textContent = t("common_none_option");
        dashLogSelect.appendChild(optNone2);

        channels.forEach(function (ch) {
          const opt = document.createElement("option");
          opt.value = ch.id;
          opt.textContent = "#" + ch.name + " (" + ch.id + ")";
          if (
            conf.dashboardLogChannelId &&
            conf.dashboardLogChannelId === ch.id
          )
            opt.selected = true;
          dashLogSelect.appendChild(opt);
        });
      }

      function fillRoleMultiSelect(sel, selectedIds) {
        if (!sel) return;
        const selected = Array.isArray(selectedIds) ? selectedIds : [];
        sel.innerHTML = "";
        roles.forEach(function (r) {
          const opt = document.createElement("option");
          opt.value = r.id;
          opt.textContent = "@" + r.name + " (" + r.id + ")";
          if (selected.indexOf(r.id) !== -1) opt.selected = true;
          sel.appendChild(opt);
        });
      }

      fillRoleMultiSelect(staffSelect, conf.staffRoleIds);
      const staffByFeature = conf.staffRolesByFeature || {};
      fillRoleMultiSelect(
        document.getElementById("staffRolesModeration"),
        staffByFeature.moderation,
      );
      fillRoleMultiSelect(
        document.getElementById("staffRolesTickets"),
        staffByFeature.tickets,
      );

      function getSelectedValues(sel) {
        const out = [];
        if (!sel) return out;
        Array.prototype.forEach.call(sel.selectedOptions || [], function (opt) {
          if (opt && opt.value) out.push(opt.value);
        });
        return out;
      }

      function setSelectedValues(sel, values) {
        if (!sel) return;
        const set = new Set(Array.isArray(values) ? values : []);
        Array.prototype.forEach.call(sel.options || [], function (opt) {
          opt.selected = set.has(opt.value);
        });
      }

      const staffRolePreview = document.getElementById("staffRolePreview");
      if (staffRolePreview) {
        staffRolePreview.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = t("config_staff_preview_select_role");
        staffRolePreview.appendChild(placeholder);
        roles.forEach(function (role) {
          const option = document.createElement("option");
          option.value = String(role.id);
          option.textContent = "@" + role.name;
          staffRolePreview.appendChild(option);
        });
      }

      function updateStaffRoleAccessPreview() {
        if (!staffRolePreview) return;
        const roleId = staffRolePreview.value;
        const generalRoleIds = getSelectedValues(staffSelect);

        function updateResult(selectId, resultId) {
          const specificRoleIds = getSelectedValues(
            document.getElementById(selectId),
          );
          const effectiveRoleIds = specificRoleIds.length
            ? specificRoleIds
            : generalRoleIds;
          const result = document.getElementById(resultId);
          if (!result) return;

          const allowed = roleId && effectiveRoleIds.includes(roleId);
          result.textContent = roleId
            ? t(
                allowed
                  ? "config_staff_preview_allowed"
                  : "config_staff_preview_denied",
              )
            : t("config_staff_preview_select_role");
          result.classList.toggle("is-allowed", !!allowed);
          result.classList.toggle("is-denied", !!roleId && !allowed);
        }

        updateResult("staffRolesModeration", "staffRolePreviewModeration");
        updateResult("staffRolesTickets", "staffRolePreviewTickets");
      }

      if (staffRolePreview && !staffRolePreview.dataset.previewBound) {
        staffRolePreview.dataset.previewBound = "1";
        staffRolePreview.addEventListener(
          "change",
          updateStaffRoleAccessPreview,
        );
      }
      ["staffRolesModeration", "staffRolesTickets"].forEach(function (id) {
        const select = document.getElementById(id);
        if (!select || select.dataset.previewBound) return;
        select.dataset.previewBound = "1";
        select.addEventListener("change", updateStaffRoleAccessPreview);
      });

      // Role-picker UX: chips + add dropdown, backed by the hidden multi-select.
      function setupRolePicker(multiId) {
        const multi = document.getElementById(multiId);
        const chips = document.getElementById(multiId + "Chips");
        const addSel = document.getElementById(multiId + "Add");
        const addBtn = document.getElementById(multiId + "AddBtn");
        if (!multi || !chips || !addSel || !addBtn) return;

        function rebuildAddOptions() {
          const selected = new Set(getSelectedValues(multi));
          addSel.innerHTML = "";
          const opt0 = document.createElement("option");
          opt0.value = "";
          opt0.textContent = t("config_rolepicker_placeholder");
          addSel.appendChild(opt0);

          Array.prototype.forEach.call(multi.options || [], function (opt) {
            if (!opt || !opt.value) return;
            if (selected.has(opt.value)) return;
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.textContent;
            addSel.appendChild(o);
          });
        }

        function renderChips() {
          const selected = getSelectedValues(multi);
          chips.innerHTML = "";

          if (!selected.length) {
            const empty = document.createElement("div");
            empty.className = "hint";
            empty.textContent = t("config_rolepicker_empty");
            chips.appendChild(empty);
            return;
          }

          selected.forEach(function (id) {
            const opt = Array.prototype.find.call(
              multi.options || [],
              function (o) {
                return o.value === id;
              },
            );
            const label = opt ? opt.textContent : id;

            const chip = document.createElement("div");
            chip.className = "role-chip";

            const name = document.createElement("span");
            name.className = "name";
            // Render as role name without the id suffix for readability.
            name.textContent = label
              .replace(/\s*\([0-9]+\)\s*$/, "")
              .replace(/^@/, "");

            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "remove";
            rm.textContent = "✕";
            rm.addEventListener("click", function () {
              const next = getSelectedValues(multi).filter(function (x) {
                return x !== id;
              });
              setSelectedValues(multi, next);
              renderAll();
              markConfigDirty();
            });

            chip.appendChild(name);
            chip.appendChild(rm);
            chips.appendChild(chip);
          });
        }

        function renderAll() {
          renderChips();
          rebuildAddOptions();
          updateStaffRoleAccessPreview();
        }

        if (!addBtn.dataset.bound) {
          addBtn.dataset.bound = "1";
          addBtn.addEventListener("click", function () {
            const id = addSel.value;
            if (!id) return;
            const current = getSelectedValues(multi);
            if (current.indexOf(id) === -1) {
              current.push(id);
              setSelectedValues(multi, current);
              renderAll();
              markConfigDirty();
            }
          });

          // Keep chips in sync when presets apply/clear overrides.
          multi.addEventListener("change", function () {
            renderAll();
          });
        }

        renderAll();
      }

      // Activate role picker for global staff roles.
      setupRolePicker("configStaffRoles");
      updateStaffRoleAccessPreview();

      // Trust config preview (read-only, global)
      const trust = conf && conf.trust ? conf.trust : null;
      const trustEnabledInput = document.getElementById("trustEnabled");
      if (trustEnabledInput)
        trustEnabledInput.checked = !trust || trust.enabled !== false;
      const baseEl = document.getElementById("trustBaseValue");
      const minMaxEl = document.getElementById("trustMinMaxValue");
      const penaltiesEl = document.getElementById("trustPenaltiesValue");
      const regenEl = document.getElementById("trustRegenValue");
      const riskEl = document.getElementById("trustRiskValue");

      const baseInput = document.getElementById("trustBaseInput");
      const minInput = document.getElementById("trustMinInput");
      const maxInput = document.getElementById("trustMaxInput");
      const warnInput = document.getElementById("trustWarnPenaltyInput");
      const muteInput = document.getElementById("trustMutePenaltyInput");
      const regenPerDayInput = document.getElementById("trustRegenPerDayInput");
      const regenMaxDaysInput = document.getElementById(
        "trustRegenMaxDaysInput",
      );
      const lowThresholdInput = document.getElementById(
        "trustLowThresholdInput",
      );
      const highThresholdInput = document.getElementById(
        "trustHighThresholdInput",
      );

      if (trust && baseEl && minMaxEl && penaltiesEl && regenEl && riskEl) {
        state.currentTrustConfig = trust;
        const base = Number.isFinite(Number(trust.base))
          ? Number(trust.base)
          : null;
        const min = Number.isFinite(Number(trust.min))
          ? Number(trust.min)
          : null;
        const max = Number.isFinite(Number(trust.max))
          ? Number(trust.max)
          : null;

        baseEl.textContent = base !== null ? String(base) : "—";
        minMaxEl.textContent =
          min !== null && max !== null ? min + " / " + max : "—";

        if (baseInput) baseInput.value = base !== null ? String(base) : "";

        if (minInput) minInput.value = min !== null ? String(min) : "";
        if (maxInput) maxInput.value = max !== null ? String(max) : "";

        const warnPenalty = Number.isFinite(Number(trust.warnPenalty))
          ? Number(trust.warnPenalty)
          : null;
        const mutePenalty = Number.isFinite(Number(trust.mutePenalty))
          ? Number(trust.mutePenalty)
          : null;
        penaltiesEl.textContent =
          warnPenalty !== null && mutePenalty !== null
            ? "WARN: -" + warnPenalty + " • MUTE: -" + mutePenalty
            : "—";

        if (warnInput)
          warnInput.value = warnPenalty !== null ? String(warnPenalty) : "";
        if (muteInput)
          muteInput.value = mutePenalty !== null ? String(mutePenalty) : "";

        const regenPerDay = Number.isFinite(Number(trust.regenPerDay))
          ? Number(trust.regenPerDay)
          : null;
        const regenMaxDays = Number.isFinite(Number(trust.regenMaxDays))
          ? Number(trust.regenMaxDays)
          : null;
        regenEl.textContent =
          regenPerDay !== null && regenMaxDays !== null
            ? regenPerDay + " / dia até " + regenMaxDays + " dias"
            : "—";

        if (regenPerDayInput)
          regenPerDayInput.value =
            regenPerDay !== null ? String(regenPerDay) : "";
        if (regenMaxDaysInput)
          regenMaxDaysInput.value =
            regenMaxDays !== null ? String(regenMaxDays) : "";

        const lowT = Number.isFinite(
          Number(trust.lowTrustThreshold || trust.lowThreshold),
        )
          ? Number(trust.lowTrustThreshold || trust.lowThreshold)
          : null;
        const highT = Number.isFinite(
          Number(trust.highTrustThreshold || trust.highThreshold),
        )
          ? Number(trust.highTrustThreshold || trust.highThreshold)
          : null;
        if (lowT !== null && highT !== null) {
          riskEl.textContent = `< ${lowT} (risco) • > ${highT} (confiança)`;
        } else {
          riskEl.textContent = "—";
        }

        if (lowThresholdInput)
          lowThresholdInput.value = lowT !== null ? String(lowT) : "";
        if (highThresholdInput)
          highThresholdInput.value = highT !== null ? String(highT) : "";

        // Preset selection (best-effort)
        var presetSelect = document.getElementById("trustPresetSelect");
        if (presetSelect) {
          presetSelect.value = detectTrustPreset(trust);
        }
      } else if (baseEl && minMaxEl && penaltiesEl && regenEl && riskEl) {
        // No guild-specific trust config found; show the global defaults so the UI is didactic.
        var defaultBase = 50;
        var defaultMin = 0;
        var defaultMax = 100;
        var defaultWarnPenalty = 8;
        var defaultMutePenalty = 20;
        var defaultRegenPerDay = 2;
        var defaultRegenMaxDays = 21;
        var defaultLowThreshold = 25;
        var defaultHighThreshold = 75;

        baseEl.textContent = String(defaultBase);
        minMaxEl.textContent = defaultMin + " / " + defaultMax;
        penaltiesEl.textContent =
          "WARN: -" + defaultWarnPenalty + " • MUTE: -" + defaultMutePenalty;
        regenEl.textContent =
          defaultRegenPerDay + " / dia até " + defaultRegenMaxDays + " dias";
        riskEl.textContent =
          "< " +
          defaultLowThreshold +
          " (risco) • > " +
          defaultHighThreshold +
          " (confiança)";

        if (baseInput) baseInput.value = String(defaultBase);
        if (minInput) minInput.value = String(defaultMin);
        if (maxInput) maxInput.value = String(defaultMax);
        if (warnInput) warnInput.value = String(defaultWarnPenalty);
        if (muteInput) muteInput.value = String(defaultMutePenalty);
        if (regenPerDayInput)
          regenPerDayInput.value = String(defaultRegenPerDay);
        if (regenMaxDaysInput)
          regenMaxDaysInput.value = String(defaultRegenMaxDays);
        if (lowThresholdInput)
          lowThresholdInput.value = String(defaultLowThreshold);
        if (highThresholdInput)
          highThresholdInput.value = String(defaultHighThreshold);

        state.currentTrustConfig = Object.assign({}, TRUST_PRESETS.balanced);
        var presetSelect2 = document.getElementById("trustPresetSelect");
        if (presetSelect2) presetSelect2.value = "balanced";
      }

      bindConfigDirtyListeners();
      setConfigDirty(false);
      setConfigStatus(t("config_status_loaded"), { autoHideMs: 1200 });
    } catch (err) {
      console.error("Failed to load guild config", err);
      setConfigStatus(t("config_error_generic"));
    }
  }

  async function loadTrustSummary() {
    const box = document.getElementById("trustDistribution");
    if (!box) return;

    if (!state.guildId) {
      box.innerHTML = "";
      return;
    }

    function renderHint(text) {
      box.innerHTML = '<div class="hint">' + escapeHtml(text) + "</div>";
    }

    try {
      const data = await apiGet(
        "/trust/summary?guildId=" + encodeURIComponent(state.guildId),
      );

      if (!data || data.ok === false) {
        renderHint(t("trust_distribution_error"));
        return;
      }
      if (data.disabled) {
        renderHint(t("trust_distribution_disabled"));
        return;
      }

      const total = Number(data.totalUsers) || 0;
      if (!total) {
        renderHint(t("trust_distribution_empty"));
        return;
      }

      const b = data.buckets || {};
      const low = Number(b.low) || 0;
      const medium = Number(b.medium) || 0;
      const high = Number(b.high) || 0;

      function pct(n) {
        return total ? Math.round((n / total) * 100) : 0;
      }

      const rows = [
        {
          cls: "trust-dist-high",
          label: t("trust_distribution_high"),
          count: high,
        },
        {
          cls: "trust-dist-medium",
          label: t("trust_distribution_medium"),
          count: medium,
        },
        {
          cls: "trust-dist-low",
          label: t("trust_distribution_low"),
          count: low,
        },
      ];

      let html =
        '<div class="trust-dist-total">' +
        escapeHtml(t("trust_distribution_total", { total: total })) +
        "</div>";

      rows.forEach(function (r) {
        const p = pct(r.count);
        html +=
          '<div class="trust-dist-row">' +
          '<div class="trust-dist-label">' +
          escapeHtml(r.label) +
          "</div>" +
          '<div class="trust-dist-bar"><span class="trust-dist-fill ' +
          r.cls +
          '" style="width:' +
          p +
          '%"></span></div>' +
          '<div class="trust-dist-value">' +
          r.count +
          " (" +
          p +
          "%)</div>" +
          "</div>";
      });

      box.innerHTML = html;
    } catch (err) {
      console.error("Failed to load trust summary", err);
      renderHint(t("trust_distribution_error"));
    }
  }

  window.OzarkDashboard.loadPremiumModuleData = function (module) {
    switch (module) {
      case "gamenews":
        return window.OzarkDashboard.loadGameNews
          ? window.OzarkDashboard.loadGameNews()
          : Promise.reject(new Error("GAMENEWS_LOADER_UNAVAILABLE"));
      case "tempvoice":
        return Promise.all([loadTempVoiceConfig(), loadTempVoiceActive()]);
      case "tickets":
        return window.OzarkDashboard.loadTickets
          ? window.OzarkDashboard.loadTickets(true)
          : Promise.reject(new Error("TICKETS_LOADER_UNAVAILABLE"));
      case "trust":
        return loadTrustSummary();
      case "giveaways":
        return window.OzarkDashboard.loadGiveaways
          ? window.OzarkDashboard.loadGiveaways()
          : Promise.reject(new Error("GIVEAWAYS_LOADER_UNAVAILABLE"));
      default:
        return Promise.reject(new Error("UNKNOWN_PREMIUM_MODULE: " + module));
    }
  };

  async function saveGuildConfig() {
    if (!state.guildId) return;

    if (!state.configDirty) {
      toast(t("config_nothing_to_save"), { type: "info" });
      return;
    }

    setConfigStatus(t("config_loading"));

    const logSelect = document.getElementById("configLogChannel");
    const dashLogSelect = document.getElementById("configDashboardLogChannel");
    const staffSelect = document.getElementById("configStaffRoles");
    const langSelect = document.getElementById("configServerLanguage");
    const tzSelect = document.getElementById("configServerTimezone");

    const logChannelId = logSelect && logSelect.value ? logSelect.value : null;
    const dashLogChannelId =
      dashLogSelect && dashLogSelect.value ? dashLogSelect.value : null;
    const staffRoleIds = [];
    if (staffSelect) {
      Array.prototype.forEach.call(
        staffSelect.selectedOptions || [],
        function (opt) {
          if (opt.value) staffRoleIds.push(opt.value);
        },
      );
    }
    function selectedRoles(id) {
      const select = document.getElementById(id);
      return select
        ? Array.prototype.map
            .call(select.selectedOptions || [], function (option) {
              return option.value;
            })
            .filter(Boolean)
        : [];
    }
    const staffRolesByFeature = {
      moderation: selectedRoles("staffRolesModeration"),
      tickets: selectedRoles("staffRolesTickets"),
    };

    const language = langSelect && langSelect.value ? langSelect.value : "auto";
    const timezone =
      tzSelect && tzSelect.value ? tzSelect.value.trim() || null : null;

    // Inline validation (low risk): validate IDs and timezone format before POST
    function isSnowflake(id) {
      return typeof id === "string" && /^\d{5,25}$/.test(id);
    }

    // Clear previous field errors
    clearInlineError(logSelect);
    clearInlineError(dashLogSelect);
    clearInlineError(staffSelect);
    clearInlineError(tzSelect);

    if (logChannelId && !isSnowflake(logChannelId)) {
      setInlineError(logSelect, t("config_invalid_channel_id"));
      toast(t("config_invalid_channel_id"), { type: "warn" });
      return;
    }
    if (dashLogChannelId && !isSnowflake(dashLogChannelId)) {
      setInlineError(dashLogSelect, t("config_invalid_channel_id"));
      toast(t("config_invalid_channel_id"), { type: "warn" });
      return;
    }
    var allRoleIds = staffRoleIds.concat.apply(
      staffRoleIds,
      Object.keys(staffRolesByFeature).map(function (key) {
        return staffRolesByFeature[key];
      }),
    );

    for (var i = 0; i < allRoleIds.length; i++) {
      if (allRoleIds[i] && !isSnowflake(allRoleIds[i])) {
        // Mark the most relevant select
        setInlineError(staffSelect, t("config_invalid_role_id"));
        toast(t("config_invalid_role_id"), { type: "warn" });
        return;
      }
    }

    if (timezone) {
      var tzOk =
        /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(timezone) ||
        /^UTC$/i.test(timezone) ||
        /^Etc\/(GMT|UTC)([+-]?\d{1,2})?$/.test(timezone);
      if (!tzOk) {
        setInlineError(tzSelect, t("config_invalid_timezone"));
        toast(t("config_invalid_timezone"), { type: "warn" });
        return;
      }
    }

    try {
      await apiPost(
        "/guilds/" + encodeURIComponent(state.guildId) + "/config",
        {
          logChannelId: logChannelId,
          dashboardLogChannelId: dashLogChannelId,
          staffRoleIds: staffRoleIds,
          staffRolesByFeature: staffRolesByFeature,
          language: language,
          timezone: timezone,
        },
      );

      state.guildLanguage = language;
      state.guildTimezone = timezone;
      await setDashboardLanguage(language);

      if (window.OzarkDashboard.loadFeatures) {
        await window.OzarkDashboard.loadFeatures().catch(function () {});
      }

      // mark clean + update UI
      state.configDirty = false;
      var btnSave = document.getElementById("btnSaveGuildConfig");
      if (btnSave) btnSave.disabled = true;
      setConfigStatus("");
      toast(t("config_saved"), { type: "success" });
    } catch (err) {
      console.error("Failed to save guild config", err);
      setConfigStatus("");
      toast(t("config_error_save"), { type: "error" });
    }
  }

  async function loadBotMaintenance() {
    const panel = document.getElementById("botMaintenancePanel");
    const enabled = document.getElementById("configMaintenanceEnabled");
    const message = document.getElementById("configMaintenanceMessage");
    const allowStaff = document.getElementById("configMaintenanceAllowStaff");
    const saveButton = document.getElementById("btnSaveBotMaintenance");
    const status = document.getElementById("botMaintenanceStatus");
    if (!panel || !state.me || state.me.role !== "BOT_OWNER") return;
    if (status) status.textContent = t("config_loading");
    try {
      const result = await apiGet("/config");
      const maintenance =
        (result && result.config && result.config.globalMaintenance) || {};
      if (enabled) {
        enabled.value = maintenance.enabled === true ? "true" : "false";
        enabled.disabled = false;
      }
      if (message) {
        message.value =
          typeof maintenance.message === "string" ? maintenance.message : "";
        message.disabled = false;
      }
      if (allowStaff) {
        allowStaff.value = maintenance.allowStaff === false ? "false" : "true";
        allowStaff.disabled = false;
      }
      if (saveButton) saveButton.disabled = false;
      if (status) status.textContent = "";
    } catch {
      if (status) status.textContent = t("config_error_load");
      if (saveButton) saveButton.disabled = true;
    }
  }

  async function loadBotManagementOverview() {
    const discord = document.getElementById("managementDiscordStatus");
    const database = document.getElementById("managementDatabaseStatus");
    const guildCount = document.getElementById("managementGuildCount");
    const actionsCount = document.getElementById("managementActionsCount");
    if (!discord || !database || !guildCount || !actionsCount) return;

    const healthPromise = fetch("/health").then(function (response) {
      if (!response.ok) throw new Error("Health check failed");
      return response.json();
    });
    const overviewPromise = apiGet("/overview");
    const results = await Promise.allSettled([healthPromise, overviewPromise]);
    const health = results[0].status === "fulfilled" ? results[0].value : null;
    const overview =
      results[1].status === "fulfilled" ? results[1].value : null;

    discord.textContent = health
      ? t(health.discordReady ? "badge_bot_online" : "badge_bot_offline")
      : t("management_status_unavailable");
    database.textContent = health
      ? t(
          health.mongoConnected
            ? "management_status_connected"
            : "management_status_disconnected",
        )
      : t("management_status_unavailable");
    guildCount.textContent =
      overview && Number.isFinite(overview.guilds)
        ? overview.guilds.toLocaleString(state.lang)
        : t("management_status_unavailable");
    actionsCount.textContent =
      overview && Number.isFinite(overview.actions24h)
        ? overview.actions24h.toLocaleString(state.lang)
        : t("management_status_unavailable");
  }

  async function saveBotMaintenance() {
    if (!state.me || state.me.role !== "BOT_OWNER") return;
    const enabled = document.getElementById("configMaintenanceEnabled");
    const message = document.getElementById("configMaintenanceMessage");
    const allowStaff = document.getElementById("configMaintenanceAllowStaff");
    const saveButton = document.getElementById("btnSaveBotMaintenance");
    const status = document.getElementById("botMaintenanceStatus");
    if (saveButton) saveButton.disabled = true;
    if (status) status.textContent = t("config_loading");
    try {
      await apiPatch("/config", {
        globalMaintenance: {
          enabled: !!(enabled && enabled.value === "true"),
          message: message && message.value ? message.value.trim() : null,
          allowStaff: !allowStaff || allowStaff.value !== "false",
        },
      });
      if (status) status.textContent = t("config_saved");
    } catch {
      if (status) status.textContent = t("config_error_save");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  function getGuildMetaList(kind) {
    const m = state._guildMeta || {};
    return kind && m[kind] ? m[kind] : [];
  }

  function getVoiceChannelNameById(id) {
    if (!id) return null;
    const list = getGuildMetaList("voiceChannels");
    const found = list.find(function (c) {
      return c && c.id === id;
    });
    return found ? found.name : null;
  }

  async function ensureGuildMetaForTempVoice() {
    if (!state.guildId) return;
    state._guildMeta = state._guildMeta || {};
    var hasVoice =
      Array.isArray(state._guildMeta.voiceChannels) &&
      state._guildMeta.voiceChannels.length;
    var hasCats =
      Array.isArray(state._guildMeta.categories) &&
      state._guildMeta.categories.length;
    if (hasVoice && hasCats) return;
    try {
      const meta = await apiGet(
        "/guilds/" + encodeURIComponent(state.guildId) + "/meta",
      );
      if (meta) {
        state._guildMeta.voiceChannels = Array.isArray(meta.voiceChannels)
          ? meta.voiceChannels
          : [];
        state._guildMeta.categories = Array.isArray(meta.categories)
          ? meta.categories
          : [];
      }
    } catch {}
  }

  function populateTempVoiceSelects() {
    const addBaseSel =
      document.getElementById("tempVoiceAddBaseSelect") ||
      document.getElementById("tempVoiceBaseId");
    const catSel = document.getElementById("tempVoiceCategoryId");

    if (addBaseSel) {
      const current = addBaseSel.value || "";
      addBaseSel.innerHTML = "";
      const optNone = document.createElement("option");
      optNone.value = "";
      optNone.textContent = t("common_select_placeholder") || "-";
      addBaseSel.appendChild(optNone);

      getGuildMetaList("voiceChannels").forEach(function (ch) {
        const opt = document.createElement("option");
        opt.value = ch.id;
        opt.textContent = ch.name;
        addBaseSel.appendChild(opt);
      });
      addBaseSel.value = current;
    }

    if (catSel) {
      const current = catSel.value || "";
      catSel.innerHTML = "";
      const optNone = document.createElement("option");
      optNone.value = "";
      optNone.textContent = t("common_none_option");
      catSel.appendChild(optNone);

      getGuildMetaList("categories").forEach(function (c) {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        catSel.appendChild(opt);
      });
      catSel.value = current;
    }
  }

  // TempVoice dirty tracking (same idea as GameNews dirty hint)
  function _tvNormalizeBaseIds(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter(function (x) {
        return !!x;
      })
      .map(function (x) {
        return String(x);
      });
  }

  function getTempVoiceSnapshotFromUI() {
    var enabledSel = document.getElementById("tempVoiceEnabled");
    var catInput = document.getElementById("tempVoiceCategoryId");
    var delayInput = document.getElementById("tempVoiceDeleteDelay");
    var maxUsersInput = document.getElementById("tempVoiceMaxUsers");

    var enabled = enabledSel && enabledSel.value === "true";
    var categoryId = (catInput && String(catInput.value || "").trim()) || "";
    var delaySeconds = parseInt((delayInput && delayInput.value) || "10", 10);
    if (!Number.isFinite(delaySeconds) || delaySeconds < 2) delaySeconds = 10;

    var maxUsers = null;
    try {
      var raw =
        maxUsersInput && maxUsersInput.value
          ? String(maxUsersInput.value).trim()
          : "";
      if (raw) {
        var n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 99) maxUsers = n;
      }
    } catch {}

    var baseChannelIds = _tvNormalizeBaseIds(
      state.tempVoiceBase && state.tempVoiceBase.items,
    );

    return {
      enabled: !!enabled,
      categoryId: categoryId,
      deleteDelaySeconds: delaySeconds,
      maxUsersPerRoom: maxUsers,
      baseChannelIds: baseChannelIds,
    };
  }

  function _tvSnapshotsEqual(a, b) {
    if (!a || !b) return false;
    if (!!a.enabled !== !!b.enabled) return false;
    if (String(a.categoryId || "") !== String(b.categoryId || "")) return false;
    if (Number(a.deleteDelaySeconds) !== Number(b.deleteDelaySeconds))
      return false;
    var am =
      a.maxUsersPerRoom === null || a.maxUsersPerRoom === undefined
        ? null
        : Number(a.maxUsersPerRoom);
    var bm =
      b.maxUsersPerRoom === null || b.maxUsersPerRoom === undefined
        ? null
        : Number(b.maxUsersPerRoom);
    if (am !== bm) return false;

    var aa = _tvNormalizeBaseIds(a.baseChannelIds);
    var bb = _tvNormalizeBaseIds(b.baseChannelIds);
    if (aa.length !== bb.length) return false;
    for (var i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  }

  function setTempVoiceDirty(isDirty) {
    state.tempVoiceDirty = !!isDirty;
    var btn = document.getElementById("btnSaveTempVoice");
    var hint = document.getElementById("tvDirtyHint");
    var panel = document.getElementById("tempVoiceDetailPanel");

    // Permission gate: allow save only if user can manage extras
    var perms = state.perms || {};
    var canEdit =
      !!(state.me && state.me.role === "BOT_OWNER") ||
      !!perms.canEditConfig ||
      !!perms.canManageGameNews;

    if (panel) {
      panel.classList.toggle("dirty", !!state.tempVoiceDirty && canEdit);
    }

    if (btn) {
      btn.disabled = !canEdit || !state.tempVoiceDirty;
      btn.classList.toggle("primary", !!state.tempVoiceDirty && canEdit);
    }
    if (hint) {
      if (state.tempVoiceDirty && canEdit) {
        hint.classList.remove("hidden");
        hint.textContent =
          t("tempvoice_unsaved_hint") || "Alteracoes por guardar.";
      } else {
        hint.classList.add("hidden");
        hint.textContent = "";
      }
    }
  }

  function updateTempVoiceDirtyFromUI() {
    var snap = getTempVoiceSnapshotFromUI();
    var orig = state.tempVoiceOriginal || null;
    setTempVoiceDirty(!(orig && _tvSnapshotsEqual(orig, snap)));
  }

  function bindTempVoiceDirtyTrackingOnce() {
    var marker =
      document.body && document.body.dataset
        ? document.body.dataset.tvDirtyBound
        : null;
    if (marker) return;
    if (document.body && document.body.dataset)
      document.body.dataset.tvDirtyBound = "1";

    var enabledSel = document.getElementById("tempVoiceEnabled");
    var headerEnabled = document.getElementById("tempVoiceHeaderEnabled");
    var catInput = document.getElementById("tempVoiceCategoryId");
    var delayInput = document.getElementById("tempVoiceDeleteDelay");
    var maxUsersInput = document.getElementById("tempVoiceMaxUsers");

    [enabledSel, catInput].forEach(function (el) {
      if (!el) return;
      el.addEventListener("change", function () {
        if (el === enabledSel && headerEnabled)
          headerEnabled.checked = enabledSel.value === "true";
        updateTempVoiceDirtyFromUI();
      });
    });

    if (headerEnabled) {
      headerEnabled.addEventListener("change", function () {
        var wasDisabled = headerEnabled.disabled;
        var previousEnabled = !headerEnabled.checked;
        if (enabledSel)
          enabledSel.value = headerEnabled.checked ? "true" : "false";
        updateTempVoiceDirtyFromUI();
        headerEnabled.disabled = true;
        headerEnabled.setAttribute("aria-busy", "true");
        saveTempVoiceConfig()
          .then(function (saved) {
            if (saved) return;
            headerEnabled.checked = previousEnabled;
            if (enabledSel)
              enabledSel.value = previousEnabled ? "true" : "false";
            updateTempVoiceDirtyFromUI();
          })
          .finally(function () {
            headerEnabled.disabled = wasDisabled;
            headerEnabled.removeAttribute("aria-busy");
          });
      });
    }

    [delayInput, maxUsersInput].forEach(function (el) {
      if (!el) return;
      el.addEventListener("input", function () {
        updateTempVoiceDirtyFromUI();
      });
    });
  }

  async function loadTempVoiceConfig() {
    if (!state.guildId) return;

    try {
      const res = await apiGet(
        `/temp-voice/config?guildId=${encodeURIComponent(state.guildId)}`,
      );
      if (!res || !res.ok) return;

      var cfg = res.config || {};
      var enabledSel = document.getElementById("tempVoiceEnabled");
      var headerEnabled = document.getElementById("tempVoiceHeaderEnabled");
      var baseIdInput =
        document.getElementById("tempVoiceAddBaseSelect") ||
        document.getElementById("tempVoiceBaseId");
      var catInput = document.getElementById("tempVoiceCategoryId");
      var delayInput = document.getElementById("tempVoiceDeleteDelay");
      var maxUsersInput = document.getElementById("tempVoiceMaxUsers");

      // Ensure guild meta is available (voice channels + categories)
      await ensureGuildMetaForTempVoice();
      populateTempVoiceSelects();

      var baseIds = Array.isArray(cfg.baseChannelIds) ? cfg.baseChannelIds : [];

      state.tempVoiceBase = state.tempVoiceBase || {
        items: [],
        selectedIndex: -1,
      };
      state.tempVoiceBase.items = baseIds.slice();
      state.tempVoiceBase.selectedIndex = -1;

      if (enabledSel) {
        enabledSel.value = cfg.enabled ? "true" : "false";
      }
      if (headerEnabled) headerEnabled.checked = cfg.enabled === true;
      if (baseIdInput) {
        baseIdInput.value = "";
      }
      if (catInput) {
        catInput.value = cfg.categoryId || "";
      }
      if (delayInput) {
        delayInput.value =
          typeof cfg.deleteDelaySeconds === "number"
            ? String(cfg.deleteDelaySeconds)
            : "10";
      }
      if (maxUsersInput) {
        maxUsersInput.value =
          cfg.maxUsersPerRoom !== null && cfg.maxUsersPerRoom !== undefined
            ? String(cfg.maxUsersPerRoom)
            : "";
      }

      if (typeof renderTempVoiceBaseList === "function") {
        renderTempVoiceBaseList();
      }

      // Snapshot for dirty tracking
      state.tempVoiceOriginal = getTempVoiceSnapshotFromUI();
      bindTempVoiceDirtyTrackingOnce();
      setTempVoiceDirty(false);
    } catch (err) {
      console.error("Failed to load temp voice config", err);
      var detailEmpty = document.getElementById("tempVoiceDetailEmpty");
      var detailContent = document.getElementById("tempVoiceDetailContent");
      if (detailEmpty) {
        detailEmpty.textContent = t("tempvoice_config_load_error");
        detailEmpty.classList.remove("hidden");
      }
      if (detailContent) detailContent.classList.add("hidden");
    }
  }

  async function saveTempVoiceConfig() {
    if (!state.guildId) return false;
    try {
      updateTempVoiceDirtyFromUI();
    } catch {}
    if (!state.tempVoiceDirty) {
      toast(t("tempvoice_nothing_to_save") || "Nada para guardar.", {
        type: "info",
      });
      return false;
    }
    var _btnSave = document.getElementById("btnSaveTempVoice");
    if (_btnSave) _btnSave.disabled = true;

    var enabledSel = document.getElementById("tempVoiceEnabled");
    var catInput = document.getElementById("tempVoiceCategoryId");
    var delayInput = document.getElementById("tempVoiceDeleteDelay");
    var maxUsersInput = document.getElementById("tempVoiceMaxUsers");

    var enabled = enabledSel && enabledSel.value === "true";
    var categoryId = (catInput && catInput.value) || "";
    var delayRaw = (delayInput && delayInput.value) || "10";

    var baseChannelIds = (
      (state.tempVoiceBase && state.tempVoiceBase.items) ||
      []
    ).filter(function (s) {
      return !!s;
    });

    var delaySeconds = parseInt(delayRaw, 10);
    if (!Number.isFinite(delaySeconds) || delaySeconds < 2) delaySeconds = 10;

    var maxUsers = null;
    try {
      var raw =
        maxUsersInput && maxUsersInput.value
          ? String(maxUsersInput.value).trim()
          : "";
      if (raw) {
        var n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 99) maxUsers = n;
      }
    } catch {}

    try {
      const body = {
        guildId: state.guildId,
        enabled: enabled,
        baseChannelIds: baseChannelIds,
        categoryId: categoryId,
        deleteDelaySeconds: delaySeconds,
        maxUsersPerRoom: maxUsers,
      };
      const res = await apiPost("/temp-voice/config", body);
      if (res && res.ok) {
        if (
          window.OzarkDashboard &&
          typeof window.OzarkDashboard.invalidatePremiumDiagnosis === "function"
        ) {
          window.OzarkDashboard.invalidatePremiumDiagnosis(
            "tempvoice",
            String(state.guildId),
          );
        }
        toast(t("tempvoice_saved"), { type: "success" });
        setTempVoiceDirty(false);
        if (
          window.OzarkDashboard &&
          typeof window.OzarkDashboard.diagnosePremiumModule === "function"
        ) {
          window.OzarkDashboard.diagnosePremiumModule("tempvoice").catch(
            function () {},
          );
        }
        loadTempVoiceConfig().catch(function () {});
        return true;
      } else {
        toast(t("tempvoice_save_error"), { type: "error" });
        return false;
      }
    } catch (err) {
      console.error("Failed to save temp voice config", err);
      toast(t("tempvoice_save_error"), { type: "error" });
      return false;
    } finally {
      try {
        updateTempVoiceDirtyFromUI();
      } catch {}
    }
  }

  async function loadTempVoiceActive() {
    if (!state.guildId) return;

    try {
      const res = await apiGet(
        `/temp-voice/active?guildId=${encodeURIComponent(state.guildId)}`,
      );
      const listEl = document.getElementById("tempVoiceActiveList");
      const countEl = document.getElementById("tempVoiceActiveCount");
      if (!listEl) return;

      listEl.innerHTML = "";
      const activeRooms =
        res && res.ok && Array.isArray(res.items) ? res.items : [];
      if (countEl) {
        countEl.textContent = t("tempvoice_active_count", {
          count: activeRooms.length.toLocaleString(state.lang),
        });
      }

      if (!activeRooms.length) {
        listEl.innerHTML = `<div class="empty">${escapeHtml(t("tempvoice_active_empty"))}</div>`;
        return;
      }

      activeRooms.forEach(function (item) {
        var el = document.createElement("div");
        el.className = "list-item";
        el.innerHTML = `
            <div class="row space">
              <div>
                <div class="title">${escapeHtml(item.channelName || getVoiceChannelNameById(item.channelId) || (item.channelId ? "#" + item.channelId : ""))}</div>
                <div class="subtitle">
                  ${escapeHtml(t("tempvoice_active_owner_label") || "Owner")}: ${escapeHtml(item.ownerTag || item.ownerId || "?")}
                  · ${escapeHtml(t("tempvoice_active_base_label") || "Base")}: ${escapeHtml(item.baseChannelName || getVoiceChannelNameById(item.baseChannelId) || item.baseChannelId || "?")}
                </div>
              </div>
            </div>
          `;
        listEl.appendChild(el);
      });
    } catch (err) {
      console.error("Failed to load temp voice active list", err);
      const listEl = document.getElementById("tempVoiceActiveList");
      if (listEl) {
        listEl.innerHTML = `<div class="empty">${escapeHtml(t("tempvoice_active_load_error"))}</div>`;
      }
      const countEl = document.getElementById("tempVoiceActiveCount");
      if (countEl) countEl.textContent = t("management_status_unavailable");
    }
  }

  function renderTempVoiceBaseList() {
    var listEl = document.getElementById("tempVoiceBaseList");
    if (!listEl) return;

    listEl.innerHTML = "";

    var items = state.tempVoiceBase.items || [];
    if (!items.length) {
      listEl.innerHTML =
        '<div class="empty">' +
        escapeHtml(t("tempvoice_base_list_empty")) +
        "</div>";
      return;
    }

    items.forEach(function (id, index) {
      var row = document.createElement("div");
      row.className =
        "list-item" +
        (index === state.tempVoiceBase.selectedIndex ? " active" : "");
      row.dataset.index = String(index);
      row.innerHTML = `
        <div class="row space">
          <div>
            <div class="title">${escapeHtml(getVoiceChannelNameById(id) || id || "")}</div>
            <div class="subtitle">${escapeHtml(t("tempvoice_base_list_hint"))}</div>
          </div>
        </div>
      `;
      row.addEventListener("click", function () {
        // mostrar estado de loading ao estilo dos feeds
        if (typeof showPanelLoading === "function") {
          showPanelLoading("tempVoiceDetailPanel");
        }
        selectTempVoiceBaseIndex(index);
      });
      listEl.appendChild(row);
    });
  }

  function selectTempVoiceBaseIndex(index) {
    var items = state.tempVoiceBase.items || [];
    var emptyEl = document.getElementById("tempVoiceDetailEmpty");
    var contentEl = document.getElementById("tempVoiceDetailContent");
    var currentLabel = document.getElementById("tempVoiceCurrentBaseLabel");

    if (index < 0 || index >= items.length) {
      state.tempVoiceBase.selectedIndex = -1;
      var baseIdInput =
        document.getElementById("tempVoiceAddBaseSelect") ||
        document.getElementById("tempVoiceBaseId");
      if (baseIdInput) baseIdInput.value = "";
      if (emptyEl) emptyEl.classList.remove("hidden");
      if (contentEl) contentEl.classList.add("hidden");
      if (currentLabel)
        currentLabel.textContent =
          t("tempvoice_current_base") + " (nenhum selecionado)";
      renderTempVoiceBaseList();
      return;
    }

    state.tempVoiceBase.selectedIndex = index;
    var baseIdInput2 =
      document.getElementById("tempVoiceAddBaseSelect") ||
      document.getElementById("tempVoiceBaseId");
    if (baseIdInput2) baseIdInput2.value = "";
    if (emptyEl) emptyEl.classList.add("hidden");
    if (contentEl) contentEl.classList.remove("hidden");
    if (currentLabel)
      currentLabel.textContent =
        (t("tempvoice_current_base") || "Canal base:") +
        " " +
        (getVoiceChannelNameById(items[index]) || items[index] || "");
    renderTempVoiceBaseList();
  }
  function addTempVoiceBaseChannel() {
    if (!state.tempVoiceBase)
      state.tempVoiceBase = { items: [], selectedIndex: -1 };
    if (!Array.isArray(state.tempVoiceBase.items))
      state.tempVoiceBase.items = [];

    var baseSel =
      document.getElementById("tempVoiceAddBaseSelect") ||
      document.getElementById("tempVoiceBaseId");
    var val = baseSel ? String(baseSel.value || "").trim() : "";
    if (!val) {
      toast(
        t("tempvoice_select_base_first") ||
          t("common_select_placeholder") ||
          "Selecione um canal base primeiro.",
        { type: "warn" },
      );
      return;
    }

    // Avoid duplicates
    if (state.tempVoiceBase.items.indexOf(val) === -1) {
      state.tempVoiceBase.items.push(val);
    }
    state.tempVoiceBase.selectedIndex = state.tempVoiceBase.items.indexOf(val);

    // Reset select for convenience
    if (baseSel) baseSel.value = "";

    renderTempVoiceBaseList();
    selectTempVoiceBaseIndex(state.tempVoiceBase.selectedIndex);
    try {
      bindTempVoiceDirtyTrackingOnce();
    } catch {}
    updateTempVoiceDirtyFromUI();
  }
  function deleteTempVoiceBaseAt(index) {
    if (!state.tempVoiceBase || !Array.isArray(state.tempVoiceBase.items))
      return;
    if (index < 0 || index >= state.tempVoiceBase.items.length) return;

    state.tempVoiceBase.items.splice(index, 1);
    if (state.tempVoiceBase.items.length === 0) {
      state.tempVoiceBase.selectedIndex = -1;
      var baseIdInput =
        document.getElementById("tempVoiceAddBaseSelect") ||
        document.getElementById("tempVoiceBaseId");
      if (baseIdInput) baseIdInput.value = "";
    } else if (
      state.tempVoiceBase.selectedIndex >= state.tempVoiceBase.items.length
    ) {
      state.tempVoiceBase.selectedIndex = state.tempVoiceBase.items.length - 1;
      var baseIdInput2 =
        document.getElementById("tempVoiceAddBaseSelect") ||
        document.getElementById("tempVoiceBaseId");
      if (baseIdInput2)
        baseIdInput2.value =
          state.tempVoiceBase.items[state.tempVoiceBase.selectedIndex] || "";
    }
    renderTempVoiceBaseList();
    try {
      bindTempVoiceDirtyTrackingOnce();
    } catch {}
    updateTempVoiceDirtyFromUI();
  }

  // -----------------------------
  // Init
  // -----------------------------

  document.addEventListener("DOMContentLoaded", function () {
    // Preferências de interface (tema / densidade)
    initPreferences();

    // Bot status badge
    refreshBotStatusBadge();
    setInterval(refreshBotStatusBadge, 5000);

    // Tempo online (duração da sessão atual)
    updateSessionBadge();
    setInterval(updateSessionBadge, 30000);

    // English is the global default; explicit server settings may override it.
    var languageReady = Promise.resolve();
    window.OzarkDashboard = window.OzarkDashboard || {};
    window.OzarkDashboard.I18n = window.OzarkDashboard.I18n || {};
    if (typeof window.OzarkDashboard.I18n.init === "function") {
      languageReady = window.OzarkDashboard.I18n.init(state.lang)
        .catch(function (err) {
          console.error("Failed to load dashboard language", state.lang, err);
          state.lang = "en";
          return window.OzarkDashboard.I18n.init("en").catch(
            function (fallbackError) {
              console.error(
                "Failed to load fallback dashboard language",
                fallbackError,
              );
            },
          );
        })
        .finally(function () {
          applyI18n();
        });
    } else {
      applyI18n();
    }

    // Navegação por teclado (setas/Home/End) + roving tabindex para um tablist.
    function wireTablist(selector) {
      var tabs = Array.prototype.slice.call(
        document.querySelectorAll(selector) || [],
      );
      if (!tabs.length) return;

      function moveFocus(target) {
        if (!target) return;
        tabs.forEach(function (b) {
          b.setAttribute("tabindex", b === target ? "0" : "-1");
        });
        target.focus();
      }

      tabs.forEach(function (btn) {
        btn.addEventListener("keydown", function (ev) {
          var key = ev.key || ev.code;
          // Ignorar tabs desativadas (ex.: sem servidor selecionado).
          var enabled = tabs.filter(function (b) {
            return !b.disabled;
          });
          if (!enabled.length) return;
          var current = Math.max(0, enabled.indexOf(btn));

          if (key === "ArrowRight" || key === "Right") {
            ev.preventDefault();
            moveFocus(enabled[(current + 1) % enabled.length]);
          } else if (key === "ArrowLeft" || key === "Left") {
            ev.preventDefault();
            moveFocus(enabled[(current - 1 + enabled.length) % enabled.length]);
          } else if (key === "Home") {
            ev.preventDefault();
            moveFocus(enabled[0]);
          } else if (key === "End") {
            ev.preventDefault();
            moveFocus(enabled[enabled.length - 1]);
          } else if (key === "Enter" || key === " ") {
            // activate
            ev.preventDefault();
            try {
              btn.click();
            } catch {}
          }
        });
      });
    }

    function setupTabsKeyboardNavigation() {
      wireTablist(".tabs button[data-tab]");
    }

    function setupConfigSectionNavigation() {
      var nav = document.querySelector("#tab-config .config-nav");
      if (!nav || typeof window.IntersectionObserver !== "function") return;

      var links = Array.prototype.slice.call(
        nav.querySelectorAll('a[href^="#"]'),
      );
      var sections = links
        .map(function (link) {
          return document.querySelector(link.getAttribute("href"));
        })
        .filter(Boolean);
      if (!sections.length) return;

      var observer = new IntersectionObserver(
        function (entries) {
          var visible = entries.filter(function (entry) {
            return entry.isIntersecting;
          });
          if (!visible.length) return;
          visible.sort(function (left, right) {
            return left.boundingClientRect.top - right.boundingClientRect.top;
          });
          var activeId = visible[0].target.id;
          links.forEach(function (link) {
            var active = link.getAttribute("href") === "#" + activeId;
            link.classList.toggle("is-active", active);
            if (active) link.setAttribute("aria-current", "location");
            else link.removeAttribute("aria-current");
          });
        },
        { rootMargin: "-96px 0px -65% 0px", threshold: 0 },
      );

      sections.forEach(function (section) {
        observer.observe(section);
      });
    }

    // Tabs
    document.querySelectorAll(".tabs button[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-tab");
        if (!tab) return;
        setTab(tab);
      });
    });

    setupTabsKeyboardNavigation();
    setupConfigSectionNavigation();

    // Atalhos do Overview: navegam para a aba correspondente.
    [
      document.getElementById("overviewShortcuts"),
      document.getElementById("overviewGlobalShortcuts"),
      document.getElementById("overviewServerReadiness"),
    ].forEach(function (overviewShortcuts) {
      if (!overviewShortcuts) return;
      overviewShortcuts.addEventListener("click", function (ev) {
        var btn =
          ev.target && ev.target.closest
            ? ev.target.closest("[data-goto]")
            : null;
        if (!btn || btn.disabled) return;
        var target = btn.getAttribute("data-goto");
        if (target) setTab(target);
      });
    });

    // Guild picker
    var guildPicker = document.getElementById("guildPicker");
    if (guildPicker) {
      guildPicker.addEventListener("change", function () {
        (async function () {
          var previousGuildId = state.guildId;
          var v = guildPicker.value || "";
          if (
            String(v || "") !== String(previousGuildId || "") &&
            !confirmLeavingGameNewsDraft()
          ) {
            guildPicker.value = previousGuildId || "";
            return;
          }
          state.guildId = v || null;
          try {
            if (
              window.OzarkDashboard &&
              typeof window.OzarkDashboard.restoreLogsPrefs === "function"
            )
              window.OzarkDashboard.restoreLogsPrefs(state.guildId);
          } catch {}
          try {
            refreshGlobalBanner();
          } catch {}
          try {
            if (state.guildId) setStoredGuildId(state.guildId);
            else localStorage.removeItem(GUILD_KEY);
          } catch {}
          // Mint scoped OAuth token (if needed) before enabling tabs.
          var okScoped = await ensureGuildScopedToken(state.guildId);
          if (!okScoped) {
            state.guildId = previousGuildId;
            guildPicker.value = previousGuildId || "";
            updateTabAccess();
            return;
          }

          await loadGuildDashboardLanguage(state.guildId);
          updateTabAccess();

          // Se nenhum servidor estiver selecionado, volta sempre para a visão geral.
          if (!state.guildId) {
            try {
              localStorage.removeItem(GUILD_KEY);
            } catch {}
            setTab("overview");
            updateAccessBadges();
            loadOverview().catch(function () {});
            return;
          }

          if (state.currentTab !== "overview") {
            // reload current tab data when guild changes
            if (state.currentTab === "logs") {
              if (window.OzarkDashboard.loadModerationOverview) {
                window.OzarkDashboard.loadModerationOverview().catch(
                  function () {},
                );
              }
              window.OzarkDashboard.loadLogs().catch(function () {});
              if (window.OzarkDashboard.loadTickets)
                window.OzarkDashboard.loadTickets(true);
            } else if (state.currentTab === "features") {
              if (window.OzarkDashboard.loadFeatures)
                window.OzarkDashboard.loadFeatures().catch(function () {});
              if (window.OzarkDashboard.loadPremium)
                window.OzarkDashboard.loadPremium().catch(function () {});
              loadGuildConfig().catch(function () {});
            } else if (state.currentTab === "user") {
              window.OzarkDashboard.loadUsers().catch(function () {});
            } else if (state.currentTab === "config") {
              loadGuildConfig().catch(function () {});
              if (window.OzarkDashboard.reloadAudit) {
                window.OzarkDashboard.reloadAudit().catch(function () {});
              }
            } else if (state.currentTab === "premium-admin") {
              loadBotMaintenance().catch(function () {});
            }
          }
        })().catch(function () {
          // ignore
        });
      });
    }

    // Temp voice config
    var btnDeleteTempVoiceBase = document.getElementById(
      "btnDeleteTempVoiceBase",
    );
    if (btnDeleteTempVoiceBase) {
      btnDeleteTempVoiceBase.addEventListener("click", function () {
        if (!state.tempVoiceBase) return;
        var idx = state.tempVoiceBase.selectedIndex;
        if (
          typeof window.confirm === "function" &&
          !window.confirm(t("tempvoice_delete_confirm"))
        )
          return;
        if (typeof deleteTempVoiceBaseAt === "function") {
          deleteTempVoiceBaseAt(idx);
        }
      });
    }

    // Temp voice base channels
    var btnTempVoiceAddBase = document.getElementById("btnTempVoiceAddBase");
    if (btnTempVoiceAddBase) {
      btnTempVoiceAddBase.addEventListener("click", function () {
        addTempVoiceBaseChannel();
      });
    }
    var baseIdInput =
      document.getElementById("tempVoiceAddBaseSelect") ||
      document.getElementById("tempVoiceBaseId");
    if (baseIdInput) {
      // Selecting a voice channel and clicking "Adicionar" adds it to the base list.
      // Also allow quick-add on change (optional).
      if (!baseIdInput.dataset.boundTempVoiceAdd) {
        baseIdInput.dataset.boundTempVoiceAdd = "1";
        baseIdInput.addEventListener("change", function () {
          // Do not auto-add if user just cleared it
          if (String(baseIdInput.value || "").trim()) {
            // Keep it explicit: only auto-add if there are no bases yet
            if (
              !state.tempVoiceBase ||
              !Array.isArray(state.tempVoiceBase.items) ||
              state.tempVoiceBase.items.length === 0
            ) {
              addTempVoiceBaseChannel();
            }
          }
        });
      }
    }

    var btnSaveTempVoice = document.getElementById("btnSaveTempVoice");
    if (btnSaveTempVoice) {
      btnSaveTempVoice.addEventListener("click", function () {
        saveTempVoiceConfig().catch(function () {});
      });
    }

    // Logs controls
    var btnReloadLogs = document.getElementById("btnReloadLogs");
    if (btnReloadLogs) {
      btnReloadLogs.addEventListener("click", function () {
        var resultsDisclosure = document.getElementById(
          "logsResultsDisclosure",
        );
        if (resultsDisclosure && !resultsDisclosure.open) {
          resultsDisclosure.open = true;
          return;
        }
        window.OzarkDashboard.loadLogs().catch(function () {});
      });
    }

    var logLimitSelect = document.getElementById("logLimit");
    if (logLimitSelect) {
      logLimitSelect.addEventListener("change", function () {
        window.OzarkDashboard.loadLogs().catch(function () {});
      });
    }

    var logTypeSelect = document.getElementById("logType");
    if (logTypeSelect) {
      logTypeSelect.addEventListener("change", function () {
        window.OzarkDashboard.loadLogs().catch(function () {});
      });
    }

    var logSearchInput = document.getElementById("logSearch");
    if (logSearchInput) {
      var logSearchTimer = null;

      function triggerLogsDebounced() {
        if (logSearchTimer) clearTimeout(logSearchTimer);
        logSearchTimer = setTimeout(function () {
          window.OzarkDashboard.loadLogs().catch(function () {});
        }, 300);
      }

      logSearchInput.addEventListener("input", function () {
        triggerLogsDebounced();
      });

      logSearchInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          if (logSearchTimer) {
            clearTimeout(logSearchTimer);
            logSearchTimer = null;
          }
          window.OzarkDashboard.loadLogs().catch(function () {});
        }
      });
    }

    // Config buttons
    var btnReloadGuildConfig = document.getElementById("btnReloadGuildConfig");
    if (btnReloadGuildConfig) {
      btnReloadGuildConfig.addEventListener("click", function () {
        loadGuildConfig().catch(function () {});
      });
    }

    var btnSaveGuildConfig = document.getElementById("btnSaveGuildConfig");
    if (btnSaveGuildConfig) {
      btnSaveGuildConfig.addEventListener("click", function () {
        saveGuildConfig().catch(function () {});
      });
    }

    var btnSaveBotMaintenance = document.getElementById(
      "btnSaveBotMaintenance",
    );
    if (btnSaveBotMaintenance)
      btnSaveBotMaintenance.addEventListener("click", function () {
        saveBotMaintenance().catch(function () {});
      });

    // Trust presets + save (Config -> Extras -> Trust)
    var trustPresetSelect = document.getElementById("trustPresetSelect");
    var btnApplyTrustPreset = document.getElementById("btnApplyTrustPreset");
    var btnSaveTrustConfig = document.getElementById("btnSaveTrustConfig");
    var trustSaveStatus = document.getElementById("trustSaveStatus");
    var trustEnabledInput = document.getElementById("trustEnabled");

    if (trustEnabledInput && !trustEnabledInput.dataset.bound) {
      trustEnabledInput.dataset.bound = "1";
      trustEnabledInput.addEventListener("change", function () {
        var enabled = trustEnabledInput.checked;
        if (!state.guildId) {
          trustEnabledInput.checked = !enabled;
          return;
        }
        trustEnabledInput.disabled = true;
        trustEnabledInput.setAttribute("aria-busy", "true");
        apiPatch(
          "/guilds/" + encodeURIComponent(state.guildId) + "/trust-config",
          {
            trustOverrides: Object.assign({}, state.currentTrustConfig || {}, {
              enabled: enabled,
            }),
          },
        )
          .then(function (result) {
            if (!result || result.ok === false)
              throw new Error((result && result.error) || "SAVE_FAILED");
            if (result.trust) state.currentTrustConfig = result.trust;
            if (
              window.OzarkDashboard &&
              typeof window.OzarkDashboard.invalidatePremiumDiagnosis ===
                "function"
            ) {
              window.OzarkDashboard.invalidatePremiumDiagnosis(
                "trust",
                String(state.guildId),
              );
            }
            if (
              window.OzarkDashboard &&
              typeof window.OzarkDashboard.diagnosePremiumModule === "function"
            ) {
              window.OzarkDashboard.diagnosePremiumModule("trust").catch(
                function () {},
              );
            }
            toast(t("trust_save_ok"), { type: "success" });
          })
          .catch(function (error) {
            trustEnabledInput.checked = !enabled;
            toast((error && error.apiMessage) || t("trust_save_error"), {
              type: "error",
            });
          })
          .finally(function () {
            trustEnabledInput.disabled = false;
            trustEnabledInput.removeAttribute("aria-busy");
            applyPermissionGates();
          });
      });
    }

    function setTrustStatus(msg) {
      if (!trustSaveStatus) return;
      trustSaveStatus.textContent = msg || "";
    }

    function markTrustDirty() {
      state.trustDirty = true;
      setTrustStatus(t("trust_status_unsaved"));
    }

    // Bind input changes -> mark dirty + switch to "custom"
    var trustInputIds = [
      "trustBaseInput",
      "trustMinInput",
      "trustMaxInput",
      "trustWarnPenaltyInput",
      "trustMutePenaltyInput",
      "trustRegenPerDayInput",
      "trustRegenMaxDaysInput",
      "trustLowThresholdInput",
      "trustHighThresholdInput",
    ];
    trustInputIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("input", function () {
        clearInlineError(el);
        if (trustPresetSelect) trustPresetSelect.value = "custom";
        state.trustExtraOverride = null;
        markTrustDirty();
      });
    });
    // Presets: update the numeric fields immediately when selecting a preset
    // (still only persists after clicking "Guardar Trust").
    if (trustPresetSelect && !trustPresetSelect.dataset.boundChange) {
      trustPresetSelect.dataset.boundChange = "1";
      trustPresetSelect.addEventListener("change", function () {
        var key = trustPresetSelect.value || "custom";
        if (!TRUST_PRESETS[key] || key === "custom") {
          // Custom: do nothing; user edits the fields manually.
          return;
        }
        setTrustInputs(TRUST_PRESETS[key]);
        state.trustExtraOverride = TRUST_PRESETS[key];
        markTrustDirty();
        setTrustStatus(t("trust_status_preset_applied"));
      });
    }

    if (btnApplyTrustPreset && !btnApplyTrustPreset.dataset.bound) {
      btnApplyTrustPreset.dataset.bound = "1";
      btnApplyTrustPreset.addEventListener("click", function () {
        if (!trustPresetSelect) return;
        var key = trustPresetSelect.value || "custom";
        if (!TRUST_PRESETS[key]) {
          trustPresetSelect.value = "custom";
          return;
        }
        setTrustInputs(TRUST_PRESETS[key]);
        state.trustExtraOverride = TRUST_PRESETS[key];
        markTrustDirty();
        toast(t("trust_preset_applied"), { type: "success" });
      });
    }

    if (btnSaveTrustConfig && !btnSaveTrustConfig.dataset.bound) {
      btnSaveTrustConfig.dataset.bound = "1";
      btnSaveTrustConfig.addEventListener("click", function () {
        (async function () {
          try {
            var core = getTrustInputs();
            var v = validateTrustCore(core);
            // Clear previous inline errors
            clearInlineErrors([
              "trustBaseInput",
              "trustMinInput",
              "trustMaxInput",
              "trustWarnPenaltyInput",
              "trustMutePenaltyInput",
              "trustRegenPerDayInput",
              "trustRegenMaxDaysInput",
              "trustLowThresholdInput",
              "trustHighThresholdInput",
            ]);
            if (!v.ok) {
              (v.fields || []).forEach(function (id) {
                setInlineError(document.getElementById(id), v.msg);
              });
              toast(v.msg, { type: "warn" });
              return;
            }
            var presetKey = trustPresetSelect
              ? trustPresetSelect.value
              : "custom";
            var patch = buildTrustPatch(core, presetKey);

            btnSaveTrustConfig.disabled = true;
            btnSaveTrustConfig.classList.add("is-loading");

            var res = await apiPatch(
              "/guilds/" + encodeURIComponent(state.guildId) + "/trust-config",
              {
                trustOverrides: patch.trust,
              },
            );
            if (!res || res.ok === false) {
              throw new Error(
                (res && (res.error || res.message)) || "SAVE_FAILED",
              );
            }

            state.trustDirty = false;
            state.trustLastSavedAt = Date.now();
            state.trustExtraOverride = null;
            if (
              window.OzarkDashboard &&
              typeof window.OzarkDashboard.invalidatePremiumDiagnosis ===
                "function"
            ) {
              window.OzarkDashboard.invalidatePremiumDiagnosis(
                "trust",
                String(state.guildId),
              );
              if (
                typeof window.OzarkDashboard.diagnosePremiumModule ===
                "function"
              )
                window.OzarkDashboard.diagnosePremiumModule("tempvoice").catch(
                  function () {},
                );
              if (
                typeof window.OzarkDashboard.diagnosePremiumModule ===
                "function"
              ) {
                window.OzarkDashboard.diagnosePremiumModule("trust").catch(
                  function () {},
                );
              }
            }
            if (res.trust) {
              state.currentTrustConfig = res.trust;
              if (trustPresetSelect) {
                trustPresetSelect.value = detectTrustPreset(res.trust);
              }
            }

            setTrustStatus("");
            toast(t("trust_save_ok"), { type: "success" });
            // Refresh config panel to update computed preview labels
            loadGuildConfig().catch(function () {});
          } catch (e) {
            console.error("Failed to save trust config", e);
            var msg =
              e && e.apiMessage
                ? e.apiMessage
                : e && e.message
                  ? e.message
                  : t("trust_save_error");
            toast(msg, { type: "error" });
          } finally {
            btnSaveTrustConfig.disabled = false;
            btnSaveTrustConfig.classList.remove("is-loading");
            applyPermissionGates();
          }
        })();
      });
    }

    // Login form
    var loginScreen = document.getElementById("loginScreen");
    var loginDiscordBtn = document.getElementById("loginDiscordBtn");
    var loginError = document.getElementById("loginError");

    // Guild selector overlay
    var guildSelectScreen = document.getElementById("guildSelectScreen");
    var guildSelectList = document.getElementById("guildSelectList");
    var guildSelectError = document.getElementById("guildSelectError");
    var guildSelectPremiumAdmin = document.getElementById(
      "guildSelectPremiumAdmin",
    );

    if (guildSelectPremiumAdmin) {
      guildSelectPremiumAdmin.addEventListener("click", function () {
        if (guildSelectScreen) guildSelectScreen.classList.add("hidden");
        setTab("premium-admin");
      });
    }

    function showGuildSelect(items) {
      if (!guildSelectScreen || !guildSelectList) return;
      if (guildSelectPremiumAdmin) {
        var isBotOwner = state.me && state.me.role === "BOT_OWNER";
        guildSelectPremiumAdmin.classList.toggle("hidden", !isBotOwner);
      }
      if (!Array.isArray(items) || items.length < 2) {
        guildSelectScreen.classList.add("hidden");
        return;
      }
      guildSelectList.innerHTML = "";
      if (guildSelectError) guildSelectError.textContent = "";

      items.forEach(function (g) {
        if (!g || !g.id) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "guild-select-item";

        var name = document.createElement("div");
        name.className = "guild-select-name";
        name.textContent = g.name || g.id;

        var sub = document.createElement("div");
        sub.className = "hint";
        sub.textContent = g.id;

        btn.appendChild(name);
        btn.appendChild(sub);

        btn.addEventListener("click", function () {
          state.guildId = g.id;
          setStoredGuildId(g.id);

          try {
            var guildPicker = document.getElementById("guildPicker");
            if (guildPicker) guildPicker.value = g.id;
          } catch {}

          (async function () {
            var okScoped = await ensureGuildScopedToken(state.guildId);
            if (!okScoped) {
              if (guildSelectError)
                guildSelectError.textContent = t("guild_select_error_access");
              return;
            }
            await loadGuildDashboardLanguage(state.guildId);
            updateTabAccess();
            guildSelectScreen.classList.add("hidden");
            setTab("overview");
          })().catch(function () {});
        });

        guildSelectList.appendChild(btn);
      });

      guildSelectScreen.classList.remove("hidden");
    }
    window.OzarkDashboard.showGuildSelect = showGuildSelect;

    function showLogin() {
      if (loginScreen) loginScreen.classList.remove("hidden");
      if (loginError) loginError.textContent = "";
      try {
        if (loginDiscordBtn) loginDiscordBtn.focus();
      } catch {}
    }
    window.OzarkDashboard.showLogin = showLogin;

    function hideLogin() {
      if (loginScreen) loginScreen.classList.add("hidden");
      if (loginError) loginError.textContent = "";
    }

    // Bind login / invite actions (always, regardless of auth state)
    if (loginDiscordBtn && !loginDiscordBtn.dataset.bound) {
      loginDiscordBtn.dataset.bound = "1";
      loginDiscordBtn.addEventListener("click", function () {
        try {
          window.location.href = "/api/auth/discord";
        } catch {}
      });
    }

    var loginAddBotBtn = document.getElementById("loginAddBotBtn");
    if (loginAddBotBtn && !loginAddBotBtn.dataset.bound) {
      loginAddBotBtn.dataset.bound = "1";
      loginAddBotBtn.addEventListener("click", function () {
        (async function () {
          try {
            var r = await fetch("/api/public/invite", { method: "GET" });
            var j = await r.json().catch(function () {
              return null;
            });
            if (j && j.ok && j.url) {
              window.open(j.url, "_blank", "noopener");
            } else {
              toast(t("add_bot_error"), { type: "error" });
            }
          } catch {
            toast(t("add_bot_error"), { type: "error" });
          }
        })();
      });
    }

    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && !logoutBtn.dataset.bound) {
      logoutBtn.dataset.bound = "1";
      logoutBtn.addEventListener("click", function () {
        forceLogout({ redirect: true });
      });
    }

    var profileTrigger = document.getElementById("accountProfileBtn");
    var profileDialog = document.getElementById("accountProfileDialog");
    function closeAccountProfile() {
      if (profileDialog && profileDialog.open) profileDialog.close();
    }
    if (profileTrigger && profileDialog) {
      profileTrigger.addEventListener("click", function () {
        const me = state.me || {};
        const roleKey =
          me.role === "BOT_OWNER"
            ? "profile_bot_owner"
            : me.role === "GUILD_ADMIN"
              ? "profile_guild_admin"
              : "profile_viewer";
        document.getElementById("accountProfileUsername").textContent =
          me.username || "Discord";
        var profileAvatar = document.getElementById("accountProfileAvatar");
        if (profileAvatar) {
          profileAvatar.classList.toggle("hidden", !me.avatarUrl);
          if (me.avatarUrl) profileAvatar.src = me.avatarUrl;
          else profileAvatar.removeAttribute("src");
        }
        document.getElementById("accountProfileId").textContent = me.id || "—";
        document.getElementById("accountProfileRole").textContent = t(roleKey);
        var guildPicker = document.getElementById("guildPicker");
        var selectedGuild =
          guildPicker && guildPicker.selectedOptions
            ? guildPicker.selectedOptions[0]
            : null;
        document.getElementById("accountProfileScope").textContent =
          state.guildId
            ? (selectedGuild && selectedGuild.textContent) || state.guildId
            : t("profile_scope_global");
        profileDialog.showModal();
      });
      [
        document.getElementById("btnCloseAccountProfile"),
        document.getElementById("btnCloseAccountProfileFooter"),
      ].forEach(function (button) {
        if (button) button.addEventListener("click", closeAccountProfile);
      });
      profileDialog.addEventListener("click", function (event) {
        if (event.target === profileDialog) closeAccountProfile();
      });
    }

    // Bootstrap auth from the HttpOnly session cookie (/auth/me).
    (async function () {
      await languageReady;
      await loadMe().catch(function () {});
      if (state.me && state.me.id) {
        hideLogin();
        await loadGuilds().catch(function () {});
        setTab("overview");
      } else {
        showLogin();
      }
      document.documentElement.classList.remove("i18n-loading");
    })();
  });

  // Expose key parts on global namespace for future multi-file split
  window.OzarkDashboard.state = state;
  window.OzarkDashboard.API_BASE = API_BASE;
  window.OzarkDashboard.apiGet = apiGet;
  window.OzarkDashboard.apiPost = apiPost;
  window.OzarkDashboard.apiPatch = apiPatch;
  window.OzarkDashboard.toast = toast;
  window.OzarkDashboard.t = t;
  window.OzarkDashboard.escapeHtml = escapeHtml;
  window.OzarkDashboard.formatDateTime = formatDateTime;
  window.OzarkDashboard.setTab = setTab;
  window.OzarkDashboard.loadGuilds = loadGuilds;

  // Moderation (logs / cases)
  window.OzarkDashboard.createLogRow = createLogRow;

  // JSON import/export helpers for guild config

  async function exportGuildConfigJson() {
    if (!state.guildId) return;
    if (typeof document === "undefined") return;

    try {
      const cfg = await apiGet(
        "/guilds/" + encodeURIComponent(state.guildId) + "/config",
      );
      const conf = cfg && cfg.config ? cfg.config : {};

      const payload = {
        guildId: conf.guildId || state.guildId || null,
        language: typeof conf.language === "string" ? conf.language : "auto",
        timezone:
          typeof conf.timezone === "string" && conf.timezone.trim()
            ? conf.timezone.trim()
            : null,
        logChannelId: conf.logChannelId || null,
        dashboardLogChannelId: conf.dashboardLogChannelId || null,
        staffRoleIds: Array.isArray(conf.staffRoleIds) ? conf.staffRoleIds : [],
      };

      const json = JSON.stringify(payload, null, 2);

      const ta = document.getElementById("configJsonExport");
      if (ta) {
        ta.value = json;
      }

      try {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          "rabbit-guild-config-" + (payload.guildId || "unknown") + ".json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn("Unable to trigger automatic JSON download:", e);
      }

      toast(t("config_saved"), { type: "success" });
    } catch (err) {
      console.error("Failed to export guild config JSON", err);
      toast(t("config_error_generic"), { type: "error" });
    }
  }

  async function importGuildConfigJson() {
    if (!state.guildId) return;
    if (typeof document === "undefined") return;

    const ta = document.getElementById("configJsonImport");
    if (!ta || !ta.value.trim()) {
      toast(t("config_error_generic"), { type: "error" });
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(ta.value);
    } catch (e) {
      console.error("Invalid JSON for import", e);
      toast(t("config_error_generic"), { type: "error" });
      return;
    }

    const payload = {
      logChannelId: parsed.logChannelId || null,
      dashboardLogChannelId: parsed.dashboardLogChannelId || null,
      staffRoleIds: Array.isArray(parsed.staffRoleIds)
        ? parsed.staffRoleIds.filter(Boolean)
        : [],
    };

    if (typeof parsed.language === "string") {
      payload.language = parsed.language;
    }
    if (typeof parsed.timezone === "string") {
      payload.timezone = parsed.timezone;
    }

    if (
      typeof window.confirm === "function" &&
      !window.confirm(t("config_import_confirm"))
    ) {
      return;
    }

    try {
      await apiPost(
        "/guilds/" + encodeURIComponent(state.guildId) + "/config",
        payload,
      );
      toast(t("config_saved"), { type: "success" });

      if (payload.language) {
        state.guildLanguage = payload.language;
        await setDashboardLanguage(payload.language);
      }
      if (Object.prototype.hasOwnProperty.call(payload, "timezone")) {
        state.guildTimezone = payload.timezone;
      }

      await loadGuildConfig();
    } catch (err) {
      console.error("Failed to import guild config JSON", err);
      toast(t("config_error_save"), { type: "error" });
    }
  }

  window.OzarkDashboard.exportGuildConfigJson = exportGuildConfigJson;
  window.OzarkDashboard.importGuildConfigJson = importGuildConfigJson;
})(); // close main dashboard IIFE

// Wire JSON import/export buttons (safe even if DOMContentLoaded already ran)
(function () {
  if (typeof document === "undefined") return;
  function bindJsonButtons() {
    var btnExport = document.getElementById("configJsonExportBtn");
    var btnImport = document.getElementById("configJsonImportBtn");
    if (
      btnExport &&
      window.OzarkDashboard &&
      typeof window.OzarkDashboard.exportGuildConfigJson === "function"
    ) {
      btnExport.addEventListener(
        "click",
        function () {
          window.OzarkDashboard.exportGuildConfigJson().catch(function () {});
        },
        { once: true },
      );
    }
    if (
      btnImport &&
      window.OzarkDashboard &&
      typeof window.OzarkDashboard.importGuildConfigJson === "function"
    ) {
      btnImport.addEventListener(
        "click",
        function () {
          window.OzarkDashboard.importGuildConfigJson().catch(function () {});
        },
        { once: true },
      );
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindJsonButtons);
  } else {
    bindJsonButtons();
  }
})();
