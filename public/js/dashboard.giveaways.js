// Giveaways module extension for OzarkDashboard
// Configures GamerPower giveaways posting per guild + live preview.

(function () {
  if (!window.OzarkDashboard) return;

  const D = window.OzarkDashboard;
  const state = D.state;
  const apiGet = D.apiGet;
  const apiPost = D.apiPost;
  const toast = D.toast;
  const t = D.t;
  const escapeHtml = D.escapeHtml;

  function getGuildId() {
    return state && state.guildId ? String(state.guildId) : "";
  }

  let savingGiveaways = false;

  function q(id) {
    return document.getElementById(id);
  }

  function fmtTs(ts) {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleString();
    } catch {
      return "—";
    }
  }

  async function loadGiveawaysStatus() {
    const guildId = getGuildId();
    if (!guildId) return;

    const data = await apiGet(
      "/giveaways/status?guildId=" + encodeURIComponent(guildId),
    );
    const st = data && data.status ? data.status : null;

    const elStatus = q("giveawaysStatusValue");
    const elChannel = q("giveawaysStatusChannel");
    const elLast = q("giveawaysStatusLast");
    const elNext = q("giveawaysStatusNext");
    const elSent = q("giveawaysStatusSent");
    const elErrRow = q("giveawaysStatusErrorRow");
    const elErr = q("giveawaysStatusError");

    const elHeadline = q("giveawaysHeadline");

    if (!st) {
      if (elStatus) {
        elStatus.textContent = t
          ? t("giveaways_status_inactive") || "Inativo"
          : "Inativo";
        elStatus.classList.remove("is-on");
        elStatus.classList.add("is-off");
      }
      if (elChannel) elChannel.textContent = "—";
      if (elLast) elLast.textContent = "—";
      if (elNext) elNext.textContent = "—";
      if (elSent) elSent.textContent = "—";
      if (elErrRow) elErrRow.classList.add("hidden");
      if (elHeadline) elHeadline.innerHTML = "";
      return;
    }

    if (elStatus) {
      const on = !!st.enabled;
      elStatus.textContent = on
        ? t
          ? t("giveaways_status_active") || "Ativo"
          : "Ativo"
        : t
          ? t("giveaways_status_inactive") || "Inativo"
          : "Inativo";
      elStatus.classList.toggle("is-on", on);
      elStatus.classList.toggle("is-off", !on);
    }
    if (elChannel) {
      const name = st.channelName
        ? "#" + st.channelName
        : st.channelId
          ? "#" + st.channelId
          : "—";
      elChannel.textContent = name;
      if (elHeadline) {
        if (st.enabled && name && name !== "—") {
          elHeadline.innerHTML =
            (t
              ? t("giveaways_headline_posting") || "A publicar em"
              : "A publicar em") +
            " <strong>" +
            escapeHtml(name) +
            "</strong>";
        } else {
          elHeadline.innerHTML = "";
        }
      }
    }
    if (elLast) elLast.textContent = fmtTs(st.lastPollAt);
    if (elNext) elNext.textContent = fmtTs(st.nextPollAt);
    if (elSent) elSent.textContent = fmtTs(st.lastSentAt);

    if (st.lastError) {
      if (elErrRow) elErrRow.classList.remove("hidden");
      if (elErr) elErr.textContent = st.lastError;
    } else {
      if (elErrRow) elErrRow.classList.add("hidden");
    }
  }

  function stopStatusPolling() {
    if (D.__giveawaysStatusTimer) {
      clearInterval(D.__giveawaysStatusTimer);
      D.__giveawaysStatusTimer = null;
    }
  }

  function startStatusPolling() {
    if (D.__giveawaysStatusTimer) return;
    D.__giveawaysStatusTimer = setInterval(function () {
      loadGiveawaysStatus().catch(function () {});
    }, 10_000);

    // Cleanup: garante que o timer não sobrevive a um reload/navegação.
    if (!D.__giveawaysStatusCleanupBound) {
      D.__giveawaysStatusCleanupBound = true;
      window.addEventListener("beforeunload", stopStatusPolling);
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stopStatusPolling();
        else startStatusPolling();
      });
    }
  }

  async function triggerGiveawaysNow() {
    const guildId = getGuildId();
    if (!guildId) return;
    try {
      await apiPost(
        "/giveaways/trigger?guildId=" + encodeURIComponent(guildId),
        {},
      );
      toast((t && t("giveaways_trigger_ok")) || "Verificação iniciada", {
        type: "success",
      });
      loadGiveawaysStatus().catch(function () {});
    } catch (e) {
      toast(
        ((t && t("giveaways_trigger_fail")) || "Falha a verificar") +
          (e && e.message ? ": " + e.message : ""),
        { type: "error" },
      );
    }
  }

  function readChecks(containerId) {
    const root = q(containerId);
    if (!root) return [];
    const out = [];
    root.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (cb && cb.checked) out.push(String(cb.value || "").trim());
    });
    return out.filter(Boolean);
  }

  function setChecks(containerId, values) {
    const set = new Set(
      (values || []).map(function (v) {
        return String(v);
      }),
    );
    const root = q(containerId);
    if (!root) return;
    root.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (!cb) return;
      cb.checked = set.has(String(cb.value || ""));
    });
  }

  const sampleCache = {}; // key(platform|type) -> sample item
  let renderToken = 0;

  function formatDatePill(dmy) {
    return (
      '<span class="giveaway-preview__ts">' + escapeHtml(dmy || "—") + "</span>"
    );
  }

  async function loadSampleFor(platform, type) {
    const guildId = getGuildId();
    if (!guildId) return null;
    const key = String(platform || "steam") + "|" + String(type || "game");
    if (sampleCache[key]) return sampleCache[key];
    try {
      const data = await apiGet(
        "/giveaways/sample?guildId=" +
          encodeURIComponent(guildId) +
          "&platform=" +
          encodeURIComponent(platform || "steam") +
          "&type=" +
          encodeURIComponent(type || "game"),
      );
      const item = data && data.item ? data.item : null;
      if (item) sampleCache[key] = item;
      return item;
    } catch {
      return null;
    }
  }

  async function renderPreview() {
    const enabled = !!(q("giveawaysEnabled") && q("giveawaysEnabled").checked);
    const controls = q("giveawaysControls");
    if (controls) {
      if (enabled) controls.classList.remove("is-disabled");
      else controls.classList.add("is-disabled");
    }
    const platforms = readChecks("giveawaysPlatforms");
    // Free-To-Keep posts only games; types are fixed to "game".
    const primaryPlatform = platforms[0] || "steam";
    const pLower = String(primaryPlatform).toLowerCase();
    const showSteam = pLower.includes("steam");
    const showEpic = pLower.includes("epic");

    const logoUrl = platformLogoUrl(primaryPlatform);

    const token = ++renderToken;
    const sample = await loadSampleFor(primaryPlatform, "game");
    if (token !== renderToken) return; // stale

    const example = sample || {
      title: "Just Move: Clean City Messy Battle",
      worth: "€15.79",
      end_date: "04/03/2026",
      publisher: "FreeStuff",
      image: "",
      giveaway_url: "https://store.steampowered.com/",
      gamerpower_url: "https://www.gamerpower.com/",
      open_giveaway_url: "https://www.gamerpower.com/open/",
    };

    // Avoid mixed-content blocking on HTTPS dashboards.
    const imgUrl = (function normalize(u) {
      u = String(u || "");
      if (u.startsWith("http://"))
        return "https://" + u.slice("http://".length);
      return u;
    })(example.image);

    const root = q("giveawaysPreview");
    if (!root) return;

    if (!enabled) {
      root.innerHTML =
        '<div class="empty">' +
        escapeHtml(
          t("giveaways_preview_disabled") || "Ativa para ver a preview.",
        ) +
        "</div>";
      return;
    }

    // O backend já devolve o título limpo (apenas o nome do jogo).
    const title = escapeHtml(String(example.title || "").trim() || "Giveaway");
    // Screenshot style: strikethrough worth then "Free until".
    const worthHtml = example.worth
      ? '<span class="giveaway-preview__worth">' +
        escapeHtml(example.worth) +
        "</span>"
      : "";
    const meta =
      (worthHtml
        ? '<span class="giveaway-preview__worth-wrap">' + worthHtml + "</span> "
        : "") +
      "<span><b>" +
      escapeHtml(t("giveaways_preview_free") || "Free") +
      "</b> " +
      escapeHtml(t("giveaways_preview_until") || "until") +
      " " +
      formatDatePill(example.end_date || "—") +
      "</span>";

    const footerLeft = "via .rabbitstuff.xyz";
    const footerRight = example.publisher
      ? "© " + escapeHtml(example.publisher)
      : "";

    // Ligações decorativas que espelham o embed real. São <span> (não <button>)
    // para não criar controlos focáveis que não fazem nada (acessibilidade).
    const linkClass = "giveaway-preview__linkbtn";
    const linkBrowser =
      '<span class="' +
      linkClass +
      '"><b>' +
      escapeHtml(t("giveaways_preview_open_browser") || "Open in browser ↗") +
      "</b></span>";
    const linkClient = showSteam
      ? '<span class="' +
        linkClass +
        '"><b>' +
        escapeHtml(
          t("giveaways_preview_open_steam") || "Open in Steam Client ↗",
        ) +
        "</b></span>"
      : showEpic
        ? '<span class="' +
          linkClass +
          '"><b>' +
          escapeHtml(
            t("giveaways_preview_open_epic") || "Open in Epic Games ↗",
          ) +
          "</b></span>"
        : '<span class="' +
          linkClass +
          '"><b>' +
          escapeHtml(
            t("giveaways_preview_open_ubisoft") || "Open in Ubisoft Games ↗",
          ) +
          "</b></span>";

    root.innerHTML =
      '<div class="giveaway-preview__header">' +
      '<div class="giveaway-preview__left">' +
      '<div class="giveaway-preview__title">' +
      title +
      "</div>" +
      '<div class="giveaway-preview__meta-line">' +
      meta +
      "</div>" +
      '<div class="giveaway-preview__actions">' +
      linkBrowser +
      (linkClient ? linkClient : "") +
      "</div>" +
      "</div>" +
      (logoUrl
        ? '<div class="giveaway-preview__thumb"><img alt="" src="' +
          escapeHtml(logoUrl) +
          '" /></div>'
        : "") +
      "</div>" +
      (imgUrl
        ? '<div class="giveaway-preview__image"><img alt="" src="' +
          escapeHtml(imgUrl) +
          '" /></div>'
        : "") +
      '<div class="giveaway-preview__footer">' +
      "<span>" +
      escapeHtml(footerLeft) +
      "</span>" +
      (footerRight ? "<span>" + footerRight + "</span>" : "") +
      "</div>";

    function platformLogoUrl(p) {
      p = String(p || "").toLowerCase();
      // Keep preview consistent with Discord: use the same public badge route.
      if (p.includes("steam")) return "/platform-badge/steam.png?v=preview";
      if (p.includes("epic")) return "/platform-badge/epic.png?v=preview";
      if (p.includes("ubisoft") || p.includes("uplay"))
        return "/platform-badge/ubisoft.png?v=preview";
      return "";
    }
  }

  async function loadChannelsIntoSelect() {
    const guildId = getGuildId();
    const sel = q("giveawaysChannel");
    if (!guildId || !sel) return;

    const desired = sel.dataset.desiredValue || sel.value || "";

    sel.innerHTML =
      '<option value="">' +
      escapeHtml(t("select_channel") || "Seleciona um canal") +
      "</option>";

    let data = null;
    try {
      // NOTE: dashboard.js already prefixes API_BASE ("/api"), so paths here must be relative.
      data = await apiGet(
        "/guilds/" + encodeURIComponent(guildId) + "/channels",
      );
    } catch {
      data = null;
    }

    const items =
      data && (data.items || data.channels) ? data.items || data.channels : [];
    // Cache for search filtering
    window.OzarkDashboard = window.OzarkDashboard || {};
    window.OzarkDashboard._giveawaysChannels = items;

    function makeOpt(value, text) {
      const opt = document.createElement("option");
      opt.value = String(value);
      opt.textContent = text;
      return opt;
    }

    function groupKey(ch) {
      const kind = ch && ch.kind ? String(ch.kind) : "text";
      const parent = ch && ch.parentName ? String(ch.parentName) : "";
      return kind + "|" + parent;
    }

    function kindLabel(kind) {
      kind = String(kind || "").toLowerCase();
      if (kind === "announcement")
        return t("channels_group_announcements") || "Anúncios";
      if (kind === "thread") return t("channels_group_threads") || "Threads";
      return t("channels_group_text") || "Texto";
    }

    function rebuildOptions(filter) {
      const f = String(filter || "")
        .trim()
        .toLowerCase();
      const selectedId = (sel.dataset.desiredValue || sel.value || "").trim();

      sel.innerHTML = "";
      sel.appendChild(makeOpt("", t("select_channel") || "Seleciona um canal"));

      // Pin selected channel at the top (even if filtered out)
      if (selectedId) {
        const selected =
          items.find((c) => c && String(c.id) === String(selectedId)) || null;
        if (selected) {
          const og = document.createElement("optgroup");
          og.label = t("channels_group_selected") || "Selecionado";
          const name = selected.name ? String(selected.name) : "";
          const label = name ? "#" + name : String(selected.id);
          og.appendChild(makeOpt(selected.id, label));
          sel.appendChild(og);
        }
      }

      // Group channels by kind, then category.
      const buckets = new Map();
      items.forEach(function (ch) {
        if (!ch || !ch.id) return;
        const name = ch.name ? String(ch.name) : "";
        const label = name ? "#" + name : String(ch.id);
        if (
          f &&
          !(label.toLowerCase().includes(f) || String(ch.id).includes(f))
        )
          return;
        const k = groupKey(ch);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push({
          id: ch.id,
          label,
          kind: ch.kind || "text",
          parentName: ch.parentName || "",
        });
      });

      // Order groups: text, announcements, threads; within: category name.
      const orderKind = { text: 0, announcement: 1, thread: 2 };
      const groups = Array.from(buckets.values());
      const keys = Array.from(buckets.keys());
      const groupObjs = keys.map((k, i) => {
        const parts = k.split("|");
        return {
          kind: parts[0] || "text",
          parentName: parts.slice(1).join("|") || "",
          items: groups[i],
        };
      });
      groupObjs.sort((a, b) => {
        const ka = orderKind[String(a.kind).toLowerCase()] ?? 99;
        const kb = orderKind[String(b.kind).toLowerCase()] ?? 99;
        if (ka !== kb) return ka - kb;
        return String(a.parentName || "").localeCompare(
          String(b.parentName || ""),
        );
      });

      // Render groups: kind label as optgroup, with category separators via prefix.
      // If we have category names, we create nested optgroups by encoding "Kind — Category".
      groupObjs.forEach(function (g) {
        const cat = (g.parentName || "").trim();
        const label = cat ? kindLabel(g.kind) + " — " + cat : kindLabel(g.kind);
        const og = document.createElement("optgroup");
        og.label = label;
        g.items.forEach(function (it) {
          // Avoid duplicating the pinned selected channel in groups.
          if (selectedId && String(it.id) === String(selectedId)) return;
          og.appendChild(makeOpt(it.id, it.label));
        });
        if (og.children.length) sel.appendChild(og);
      });
    }

    // Expose for the search input to rebuild without duplicating logic.
    window.OzarkDashboard._giveawaysRebuildChannels = rebuildOptions;

    rebuildOptions(
      q("giveawaysChannelSearch") ? q("giveawaysChannelSearch").value : "",
    );

    // Reapply desired value when options arrive
    if (desired) {
      const exists = !!sel.querySelector(
        'option[value="' + CSS.escape(desired) + '"]',
      );
      if (exists) {
        sel.value = desired;
        delete sel.dataset.desiredValue;
      } else {
        sel.value = "";
      }
    }
  }

  async function loadGiveawaysConfig() {
    const guildId = getGuildId();
    if (!guildId) return;

    const data = await apiGet(
      "/giveaways/config?guildId=" + encodeURIComponent(guildId),
    );

    const cfg = data && data.giveaways ? data.giveaways : {};
    if (q("giveawaysEnabled")) q("giveawaysEnabled").checked = !!cfg.enabled;

    const sel = q("giveawaysChannel");
    if (sel) {
      const v = cfg.channelId ? String(cfg.channelId) : "";
      sel.dataset.desiredValue = v;
      sel.value = v;
    }

    setChecks("giveawaysPlatforms", cfg.platforms || ["steam"]);
    // Types are fixed to game in Free-To-Keep.

    if (q("giveawaysPoll"))
      q("giveawaysPoll").value = String(
        cfg.pollIntervalSeconds != null ? cfg.pollIntervalSeconds : 60,
      );
    if (q("giveawaysMaxPerCycle"))
      q("giveawaysMaxPerCycle").value = String(
        cfg.maxPerCycle != null ? cfg.maxPerCycle : 0,
      );

    await renderPreview();
  }

  async function saveGiveaways() {
    const guildId = getGuildId();
    if (!guildId || savingGiveaways) return false;

    const enabled = !!(q("giveawaysEnabled") && q("giveawaysEnabled").checked);
    const sel = q("giveawaysChannel");
    const channelId = sel && sel.value ? String(sel.value) : null;

    const platforms = readChecks("giveawaysPlatforms");
    const poll = q("giveawaysPoll") ? Number(q("giveawaysPoll").value) : 60;
    const maxPer = q("giveawaysMaxPerCycle")
      ? Number(q("giveawaysMaxPerCycle").value)
      : 0;

    // Basic validation UX
    if (enabled && (!channelId || channelId.length < 5)) {
      toast(t("giveaways_err_channel") || "Seleciona um canal de publicação.", {
        type: "error",
      });
      return false;
    }

    const warn = q("giveawaysPlatformsWarn");
    if (enabled && (!platforms || platforms.length === 0)) {
      if (warn) warn.classList.remove("hidden");
      return false;
    }
    if (warn) warn.classList.add("hidden");

    const payload = {
      guildId: guildId,
      giveaways: {
        enabled: enabled,
        channelId: channelId,
        platforms: platforms.length ? platforms : ["steam"],
        types: ["game"],
        pollIntervalSeconds: Math.max(
          60,
          Math.min(3600, Math.trunc(poll || 60)),
        ),
        maxPerCycle: Math.max(0, Math.min(50, Math.trunc(maxPer || 0))),
      },
    };

    const saveBtn = q("giveawaysSaveBtn");
    savingGiveaways = true;
    if (saveBtn) saveBtn.disabled = true;

    try {
      const saved = await apiPost("/giveaways/config", payload);

      if (typeof D.invalidatePremiumDiagnosis === "function") {
        D.invalidatePremiumDiagnosis("giveaways", guildId);
        if (typeof D.diagnosePremiumModule === "function")
          D.diagnosePremiumModule("giveaways").catch(function () {});
      }
      toast(t("saved") || "Guardado", { type: "success" });
      const hint = q("giveawaysSavedHint");
      if (hint) {
        hint.textContent =
          (t("saved_now") || "Guardado agora") +
          " • " +
          (D.formatDateTime ? D.formatDateTime(Date.now()) : "");
        setTimeout(function () {
          hint.textContent = "";
        }, 3500);
      }

      // Keep UI in sync with what the server persisted (prevents "snap back").
      if (saved && saved.giveaways) {
        const cfg = saved.giveaways;
        if (q("giveawaysEnabled"))
          q("giveawaysEnabled").checked = !!cfg.enabled;
        const sel2 = q("giveawaysChannel");
        if (sel2) {
          const v2 = cfg.channelId ? String(cfg.channelId) : "";
          sel2.dataset.desiredValue = v2;
          // Apply immediately to avoid apparent "revert" before channels are reloaded.
          sel2.value = v2;
        }
        setChecks("giveawaysPlatforms", cfg.platforms || ["steam"]);
        // Types are fixed to game in Free-To-Keep.
        if (q("giveawaysPoll"))
          q("giveawaysPoll").value = String(
            cfg.pollIntervalSeconds != null ? cfg.pollIntervalSeconds : 60,
          );
        if (q("giveawaysMaxPerCycle"))
          q("giveawaysMaxPerCycle").value = String(
            cfg.maxPerCycle != null ? cfg.maxPerCycle : 0,
          );
      }

      // Reload channels to make sure the chosen value exists in the select.
      await loadChannelsIntoSelect();
      await renderPreview();
      return true;
    } finally {
      savingGiveaways = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function sendTest() {
    const guildId = getGuildId();
    if (!guildId) return;
    const enabled = !!(q("giveawaysEnabled") && q("giveawaysEnabled").checked);
    const sel = q("giveawaysChannel");
    const channelId = sel && sel.value ? String(sel.value) : "";
    if (!enabled) {
      toast(
        t("giveaways_test_need_enabled") || "Ativa o Free-To-Keep para testar.",
        { type: "error" },
      );
      return;
    }
    if (!channelId) {
      toast(t("giveaways_err_channel") || "Seleciona um canal de publicação.", {
        type: "error",
      });
      return;
    }
    const platforms = readChecks("giveawaysPlatforms");
    const platform = platforms[0] || "steam";
    await apiPost("/giveaways/test", { guildId, channelId, platform });
    toast(t("giveaways_test_sent") || "Teste enviado.", { type: "success" });
  }

  function bindEvents() {
    // Prevent duplicate listeners when the user re-opens the subtab.
    if (D.__giveawaysBound) return;
    D.__giveawaysBound = true;

    const ids = [
      "giveawaysEnabled",
      "giveawaysChannel",
      "giveawaysPoll",
      "giveawaysMaxPerCycle",
      "giveawaysChannelSearch",
    ];
    ids.forEach(function (id) {
      const el = q(id);
      if (!el) return;
      el.addEventListener("change", function () {
        renderPreview();
      });
      el.addEventListener("input", function () {
        renderPreview();
      });
    });

    const enabledToggle = q("giveawaysEnabled");
    if (enabledToggle) {
      enabledToggle.addEventListener("change", async function () {
        const requestedEnabled = enabledToggle.checked;
        const wasDisabled = enabledToggle.disabled;
        enabledToggle.disabled = true;
        enabledToggle.setAttribute("aria-busy", "true");
        try {
          const saved = await saveGiveaways();
          if (!saved) enabledToggle.checked = !requestedEnabled;
        } catch (error) {
          enabledToggle.checked = !requestedEnabled;
          toast(
            (error && error.apiMessage) ||
              t("error_save_generic") ||
              "Erro ao guardar.",
            { type: "error" },
          );
        } finally {
          enabledToggle.disabled = wasDisabled;
          enabledToggle.removeAttribute("aria-busy");
        }
      });
    }

    ["giveawaysPlatforms"].forEach(function (id) {
      const wrap = q(id);
      if (!wrap) return;
      wrap.addEventListener("change", function () {
        const warn = q("giveawaysPlatformsWarn");
        if (warn) warn.classList.add("hidden");
        renderPreview();
      });
    });

    // Channel search filtering (uses the cached rebuild function).
    const cs = q("giveawaysChannelSearch");
    if (cs) {
      cs.addEventListener("input", function () {
        const fn =
          window.OzarkDashboard &&
          window.OzarkDashboard._giveawaysRebuildChannels
            ? window.OzarkDashboard._giveawaysRebuildChannels
            : null;
        if (fn) fn(cs.value);
      });
    }

    const btn = q("giveawaysSaveBtn");
    if (btn)
      btn.addEventListener("click", function () {
        saveGiveaways().catch(function () {
          toast(t("error_save_generic") || "Erro ao guardar.", {
            type: "error",
          });
        });
      });

    const testBtn = q("giveawaysTestBtn");
    if (testBtn)
      testBtn.addEventListener("click", function () {
        sendTest().catch(function () {
          toast(t("error_send_test") || "Erro ao enviar teste.", {
            type: "error",
          });
        });
      });

    const trigBtn = q("giveawaysTriggerBtn");
    if (trigBtn)
      trigBtn.addEventListener("click", function () {
        triggerGiveawaysNow().catch(function () {});
      });

    const resetBtn = q("giveawaysResetBtn");
    if (resetBtn)
      resetBtn.addEventListener("click", function () {
        // reset UI defaults (does not auto-save)
        if (q("giveawaysEnabled")) q("giveawaysEnabled").checked = false;
        const sel = q("giveawaysChannel");
        if (sel) sel.value = "";
        if (q("giveawaysChannelSearch")) q("giveawaysChannelSearch").value = "";
        setChecks("giveawaysPlatforms", [
          "steam",
          "epic-games-store",
          "ubisoft",
        ]);
        if (q("giveawaysPoll")) q("giveawaysPoll").value = "60";
        if (q("giveawaysMaxPerCycle")) q("giveawaysMaxPerCycle").value = "0";
        const adv = q("giveawaysAdvanced");
        if (adv) adv.open = false;
        const warn = q("giveawaysPlatformsWarn");
        if (warn) warn.classList.add("hidden");
        renderPreview();
        toast(t("giveaways_reset_ok") || "Valores repostos", {
          type: "success",
        });
      });
  }

  // Public hook for core tab switcher
  D.loadGiveaways = async function () {
    bindEvents();
    await loadChannelsIntoSelect();
    await loadGiveawaysConfig();
    await loadGiveawaysStatus().catch(function () {});
    startStatusPolling();
  };
})();
