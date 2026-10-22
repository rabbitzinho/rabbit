// Users module extension for OzarkDashboard
// Painel de auditoria da dashboard (tab Configuração).

(function () {
  if (!window.OzarkDashboard) return;

  const D = window.OzarkDashboard;
  const state = D.state;
  const apiGet = D.apiGet;
  const toast = D.toast;
  const t = D.t;
  const escapeHtml = D.escapeHtml;

  let auditPage = 1;
  let auditLoading = false;
  let auditRequestSequence = 0;
  // Só fica true depois de o utilizador pedir para ver a auditoria pela
  // primeira vez (botão "Recarregar" ou filtros).
  let auditLoaded = false;

  function q(id) {
    return document.getElementById(id);
  }

  function getGuildId() {
    return state && state.guildId ? String(state.guildId) : "";
  }

  function fmt(ts) {
    if (typeof D.formatDateTime === "function") return D.formatDateTime(ts);
    return ts ? String(ts) : "—";
  }

  function actionLabel(action) {
    switch (String(action || "")) {
      case "config.patch":
        return t("audit_action_config_patch");
      case "bot.invite":
        return t("audit_action_bot_invite");
      case "features.update":
        return t("audit_action_features_update");
      case "trust.config.update":
        return t("audit_action_trust_config_update");
      case "server.config.update":
        return t("audit_action_server_config_update");
      case "server.maintenance.update":
        return t("audit_action_server_maintenance_update");
      case "gamenews.feeds.clear":
        return t("audit_action_gamenews_feeds_clear");
      case "gamenews.feeds.save":
        return t("audit_action_gamenews_feeds_save");
      case "gamenews.feed.test":
        return t("audit_action_gamenews_feed_test");
      case "giveaways.update":
        return t("audit_action_giveaways_update");
      case "logs.clear":
        return t("audit_action_logs_clear");
      case "mod.warn":
        return t("audit_action_mod_warn");
      case "mod.mute":
        return t("audit_action_mod_mute");
      case "mod.unmute":
        return t("audit_action_mod_unmute");
      case "mod.resetTrust":
        return t("audit_action_mod_reset_trust");
      case "mod.removeInfraction":
        return t("audit_action_mod_remove_infraction");
      case "ticket.close":
        return t("audit_action_ticket_close");
      case "ticket.reopen":
        return t("audit_action_ticket_reopen");
      case "ticket.reply":
        return t("audit_action_ticket_reply");
      case "opened":
        return t("audit_action_ticket_opened");
      case "closed":
        return t("audit_action_ticket_closed");
      default:
        return action ? String(action) : t("audit_unknown_action");
    }
  }

  function buildRow(item) {
    const row = document.createElement("div");
    row.className = "list-item audit-item";

    const action = actionLabel(item && item.action);
    const actor = item && item.actor ? String(item.actor) : "";
    const route = [item && item.method, item && item.route]
      .filter(Boolean)
      .join(" ");
    const target = item && item.targetUserId ? String(item.targetUserId) : "";
    const when =
      item && (item.at || item.createdAt) ? fmt(item.at || item.createdAt) : "";

    let payloadLine = "";
    if (
      item &&
      item.payload &&
      typeof item.payload === "object" &&
      Object.keys(item.payload).length
    ) {
      payloadLine = `<div class="subtitle audit-payload">${escapeHtml(JSON.stringify(item.payload))}</div>`;
    }

    row.innerHTML = `
      <div class="title">${escapeHtml(action)}</div>
      <div class="subtitle">${escapeHtml([actor, route, target, when].filter(Boolean).join(" • "))}</div>
      ${payloadLine}
    `;

    return row;
  }

  function collectParams(page) {
    const params = ["page=" + encodeURIComponent(String(page))];

    const limitEl = q("auditLimit");
    const limit = limitEl && limitEl.value ? limitEl.value : "25";
    params.push("limit=" + encodeURIComponent(limit));

    const guildId = getGuildId();
    if (guildId) params.push("guildId=" + encodeURIComponent(guildId));

    const searchEl = q("auditSearch");
    const search =
      searchEl && searchEl.value ? searchEl.value.toString().trim() : "";
    if (search) params.push("search=" + encodeURIComponent(search));

    const actionEl = q("auditActionFilter");
    const action = actionEl && actionEl.value ? actionEl.value : "";
    if (action) params.push("action=" + encodeURIComponent(action));

    return params;
  }

  // Reconstrói as opções dinâmicas do filtro de ação, preservando a escolha atual.
  function updateActionOptions(actions) {
    const sel = q("auditActionFilter");
    if (!sel) return;

    const current = sel.value;

    Array.prototype.slice
      .call(sel.querySelectorAll("option"))
      .forEach(function (opt) {
        if (!opt.hasAttribute("data-keep")) opt.remove();
      });

    (actions || []).forEach(function (a) {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = actionLabel(a);
      sel.appendChild(opt);
    });

    const stillThere = Array.prototype.some.call(sel.options, function (o) {
      return o.value === current;
    });
    sel.value = stillThere ? current : "";
  }

  function setLoadMore(visible) {
    const btn = q("btnAuditLoadMore");
    if (!btn) return;
    btn.style.display = visible ? "" : "none";
    btn.disabled = !visible;
  }

  async function loadAudit(opts) {
    const append = !!(opts && opts.append);
    if (append && auditLoading) return;
    const listEl = q("auditList");
    if (!listEl) return;

    const requestId = ++auditRequestSequence;
    const page = append ? auditPage + 1 : 1;

    auditLoading = true;
    if (!append)
      listEl.innerHTML = `<div class="empty">${escapeHtml(t("loading"))}</div>`;

    try {
      const res = await apiGet("/audit?" + collectParams(page).join("&"));
      if (requestId !== auditRequestSequence) return;
      auditLoaded = true;

      const items = Array.isArray(res.items) ? res.items : [];
      const total = typeof res.total === "number" ? res.total : items.length;

      const limitEl = q("auditLimit");
      const limit =
        limitEl && limitEl.value ? parseInt(limitEl.value, 10) || 25 : 25;

      if (!append) {
        listEl.innerHTML = "";
        updateActionOptions(res.actions);
      }

      if (!items.length) {
        if (!append) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = t("audit_empty");
          listEl.appendChild(empty);
        }
      } else {
        items.forEach(function (it) {
          listEl.appendChild(buildRow(it));
        });
      }

      auditPage = page;

      const countEl = q("auditResultCount");
      if (countEl) {
        countEl.textContent = total
          ? t("audit_results_count", {
              shown: String(listEl.querySelectorAll(".audit-item").length),
              total: String(total),
            })
          : "";
      }

      setLoadMore(page * limit < total);
    } catch (err) {
      if (requestId !== auditRequestSequence) return;
      console.error("Failed to load audit", err);
      if (!append) {
        listEl.innerHTML = `<div class="empty">${escapeHtml(t("audit_error"))}</div>`;
      } else {
        toast((err && err.apiMessage) || t("audit_error"), { type: "error" });
      }
      setLoadMore(false);
    } finally {
      if (requestId === auditRequestSequence) auditLoading = false;
    }
  }

  D.loadAudit = loadAudit;

  // Recarrega apenas se a auditoria já foi pedida pelo utilizador: mudar de
  // servidor não deve disparar um pedido que ninguém pediu.
  D.reloadAudit = function () {
    return auditLoaded ? loadAudit() : Promise.resolve();
  };

  document.addEventListener("DOMContentLoaded", function () {
    // Estado inicial: nada é carregado até o utilizador clicar em "Recarregar".
    const listEl = q("auditList");
    if (listEl && !listEl.childElementCount) {
      const idle = document.createElement("div");
      idle.className = "empty";
      idle.textContent = t("audit_idle_hint");
      listEl.appendChild(idle);
    }

    const reloadBtn = q("btnReloadAudit");
    if (reloadBtn) {
      reloadBtn.addEventListener("click", function () {
        loadAudit();
      });
    }

    const loadMoreBtn = q("btnAuditLoadMore");
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", function () {
        loadAudit({ append: true });
      });
    }

    const actionEl = q("auditActionFilter");
    if (actionEl) {
      actionEl.addEventListener("change", function () {
        loadAudit();
      });
    }

    const limitEl = q("auditLimit");
    if (limitEl) {
      limitEl.addEventListener("change", function () {
        loadAudit();
      });
    }

    const searchEl = q("auditSearch");
    if (searchEl) {
      let searchTimer = null;
      searchEl.addEventListener("input", function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          loadAudit();
          searchTimer = null;
        }, 300);
      });
    }
  });
})();
