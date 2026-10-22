// Users module extension for OzarkDashboard
// Lógica da tab de Utilizadores extraída para este módulo.
// Este ficheiro substitui OzarkDashboard.loadUsers e OzarkDashboard.loadUserHistory
// pelas implementações reais, usando o namespace global.

(function () {
  if (!window.OzarkDashboard) return;

  const D = window.OzarkDashboard;
  const state = D.state;
  const apiGet = D.apiGet;
  const apiPost = D.apiPost;
  const toast = D.toast;
  const t = D.t;
  let userHistoryAbortController = null;
  let usersRequestSequence = 0;
  const escapeHtml = D.escapeHtml;

  function updatePremiumBadge(row) {
    if (!row) return;
    const title = row.querySelector(".title");
    if (!title) return;
    const existing = title.querySelector(".premium-badge");
    const isPayer =
      state.premiumPayerId &&
      String(row.dataset.userId) === String(state.premiumPayerId);
    if (!isPayer) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const badge = document.createElement("span");
    badge.className = "badge premium-badge";
    badge.textContent = t("premium_badge");
    title.appendChild(badge);
  }

  D.refreshPremiumBadges = function () {
    document
      .querySelectorAll("#usersList .list-item[data-user-id]")
      .forEach(updatePremiumBadge);
  };

  function buildUserRow(u, listEl) {
    if (!u) return null;

    const row = document.createElement("div");
    row.className = "list-item";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-pressed", "false");
    row.dataset.userId = u.id || "";
    row.dataset.username = u.username || u.tag || u.id || "";

    const name = u.username || u.tag || u.id;
    const roles = (u.roles || [])
      .map(function (r) {
        return r.name;
      })
      .join(", ");
    const isBot = !!u.bot;

    row.innerHTML = `
      <div class="user-row-header">
        <div class="title">${escapeHtml(name)}</div>
        <div class="user-type-badge ${isBot ? "bot" : "human"}">
          ${escapeHtml(isBot ? t("users_row_bot") : t("users_row_user"))}
        </div>
      </div>
      <div class="subtitle">
        ${escapeHtml(u.id)}${roles ? " • " + escapeHtml(roles) : ""}
      </div>
    `;
    updatePremiumBadge(row);

    row.addEventListener("click", function () {
      const previouslyActive = listEl.querySelector(".list-item.active");
      if (previouslyActive) {
        previouslyActive.classList.remove("active");
        previouslyActive.setAttribute("aria-pressed", "false");
      }
      row.classList.add("active");
      row.setAttribute("aria-pressed", "true");

      state.selectedUserId = u.id || null;
      state.userSelectionPinned = true;
      loadUserHistory(u);
    });
    row.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      row.click();
    });

    return row;
  }

  function appendUserRows(listEl, items) {
    if (!Array.isArray(items) || !items.length) return;
    items.forEach(function (u) {
      const row = buildUserRow(u, listEl);
      if (row) listEl.appendChild(row);
    });
  }

  async function loadUsers() {
    const requestSequence = ++usersRequestSequence;
    const listEl = document.getElementById("usersList");
    const searchEl = document.getElementById("usersSearch");
    const limitEl = document.getElementById("usersLimit");
    const sortEl = document.getElementById("usersSort");
    const btnLoadMore = document.getElementById("btnUsersLoadMore");
    const botsEl = document.getElementById("usersIncludeBots");
    const countEl = document.getElementById("usersResultCount");

    if (!listEl) return;

    function updateResultCount(shown, total) {
      if (!countEl) return;
      if (!total) {
        countEl.textContent = "";
        return;
      }
      countEl.textContent = t("users_results_count", {
        shown: String(shown),
        total: String(total),
      });
    }

    // Atualizar contador de membros (se soubermos)
    const membersLabel = document.getElementById("usersMemberCount");
    if (membersLabel) {
      const guildInfo = Array.isArray(state.guilds)
        ? state.guilds.find(function (g) {
            return g && g.id === state.guildId;
          })
        : null;
      if (guildInfo && typeof guildInfo.memberCount === "number") {
        membersLabel.textContent =
          state.lang === "pt"
            ? guildInfo.memberCount + " membros"
            : guildInfo.memberCount + " members";
      } else {
        membersLabel.textContent = "";
      }
    }

    if (!state.guildId) {
      listEl.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("users_select_guild");
      listEl.appendChild(empty);
      if (btnLoadMore) btnLoadMore.style.display = "none";
      updateResultCount(0, 0);
      return;
    }

    const guildId = state.guildId;
    const search =
      searchEl && searchEl.value ? searchEl.value.toString().trim() : "";
    const includeBots = !!(botsEl && botsEl.checked);
    let limit = 50;
    if (limitEl && limitEl.value) {
      const n = Number(limitEl.value);
      if (Number.isFinite(n) && n > 0) limit = n;
    }

    const sortRaw = sortEl && sortEl.value ? String(sortEl.value) : "name";
    const usersSort =
      ["name", "joined", "id"].indexOf(sortRaw) !== -1 ? sortRaw : "name";

    state.usersPage = 1;
    state.usersSearch = search;
    state.usersLimit = limit;
    state.usersIncludeBots = includeBots;
    state.usersSort = usersSort;

    function setLoadMoreVisible(visible) {
      if (!btnLoadMore) return;
      btnLoadMore.style.display = visible ? "" : "none";
      btnLoadMore.disabled = !visible;
    }

    function renderUsers(items, append) {
      if (!append) listEl.innerHTML = "";

      if (!Array.isArray(items) || !items.length) {
        if (!append) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = search
            ? t("users_empty_search")
            : t("users_empty_generic");
          listEl.appendChild(empty);
        }
        return;
      }

      appendUserRows(listEl, items);
    }

    async function fetchPage(page, opts) {
      const append = !!(opts && opts.append);
      const sync = !!(opts && opts.sync);

      const params = [];
      params.push("page=" + encodeURIComponent(String(page)));
      params.push("limit=" + encodeURIComponent(String(limit)));
      if (search) params.push("search=" + encodeURIComponent(search));
      if (includeBots) params.push("includeBots=1");
      if (usersSort && usersSort !== "name")
        params.push("sort=" + encodeURIComponent(usersSort));
      if (sync) params.push("sync=1");

      const url =
        "/guilds/" + encodeURIComponent(guildId) + "/users?" + params.join("&");
      const res = await apiGet(url);
      if (
        requestSequence !== usersRequestSequence ||
        String(state.guildId || "") !== String(guildId)
      ) {
        return null;
      }

      const items = Array.isArray(res.items) ? res.items : [];
      const total = typeof res.total === "number" ? res.total : items.length;

      // Render
      renderUsers(items, append);
      updateResultCount(listEl.querySelectorAll(".list-item").length, total);

      // Load more
      const hasMore = page * limit < total;
      setLoadMoreVisible(hasMore);

      state.usersPage = page;
      state.usersTotal = total;

      // Auto-select user previously selected (only on first page render)
      if (!append && state.userSelectionPinned && state.selectedUserId) {
        const row = listEl.querySelector(
          '.list-item[data-user-id="' + CSS.escape(state.selectedUserId) + '"]',
        );
        if (row) {
          row.classList.add("active");
          row.setAttribute("aria-pressed", "true");
        }
      }

      return { items, total, hasMore };
    }

    return window.OzarkDashboard.withLoading(
      function () {
        listEl.innerHTML = `<div class="empty">${escapeHtml(t("loading"))}</div>`;
        setLoadMoreVisible(false);
        return fetchPage(1, { append: false });
      },
      {
        onError: function () {
          if (requestSequence !== usersRequestSequence) return;
          listEl.innerHTML = "";
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = t("users_error_generic");
          listEl.appendChild(empty);
          setLoadMoreVisible(false);
          updateResultCount(0, 0);
        },
      },
    );
  }

  // Bind controls once
  document.addEventListener("DOMContentLoaded", function () {
    const btnReload = document.getElementById("btnReloadUsers");
    const btnLoadMore = document.getElementById("btnUsersLoadMore");
    const btnSync = document.getElementById("btnSyncUsers");
    const searchEl = document.getElementById("usersSearch");
    const limitEl = document.getElementById("usersLimit");
    const sortEl = document.getElementById("usersSort");
    const botsEl = document.getElementById("usersIncludeBots");

    let searchTimer = null;

    function reload() {
      window.OzarkDashboard.loadUsers().catch(function () {});
    }

    // Export CSV/JSON dos utilizadores, com os filtros ativos na toolbar.
    async function exportUsers(format) {
      if (!state.guildId) return;

      const params = [];
      const searchValue =
        searchEl && searchEl.value ? searchEl.value.toString().trim() : "";
      if (searchValue) params.push("search=" + encodeURIComponent(searchValue));
      if (botsEl && botsEl.checked) params.push("includeBots=1");
      if (state.usersSort && state.usersSort !== "name") {
        params.push("sort=" + encodeURIComponent(state.usersSort));
      }
      params.push("format=" + format);

      const url =
        "/api/guilds/" +
        encodeURIComponent(state.guildId) +
        "/users/export?" +
        params.join("&");

      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error("HTTP " + res.status);

        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = "users-" + state.guildId + "." + format;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);

        toast(t("users_export_ok"), { type: "success" });
      } catch (err) {
        console.error("Failed to export users", err);
        toast(t("users_export_error"), { type: "error" });
      }
    }

    const btnExportCsv = document.getElementById("btnExportUsersCsv");
    if (btnExportCsv) {
      btnExportCsv.addEventListener("click", function () {
        btnExportCsv.disabled = true;
        exportUsers("csv").finally(function () {
          btnExportCsv.disabled = false;
        });
      });
    }

    const btnExportJson = document.getElementById("btnExportUsersJson");
    if (btnExportJson) {
      btnExportJson.addEventListener("click", function () {
        btnExportJson.disabled = true;
        exportUsers("json").finally(function () {
          btnExportJson.disabled = false;
        });
      });
    }

    if (btnReload) btnReload.addEventListener("click", reload);

    if (limitEl) {
      limitEl.addEventListener("change", reload);
    }

    if (sortEl) {
      sortEl.addEventListener("change", reload);
    }

    if (botsEl) {
      botsEl.addEventListener("change", reload);
    }

    if (searchEl) {
      searchEl.addEventListener("input", function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          reload();
          searchTimer = null;
        }, 300);
      });
    }

    if (btnLoadMore) {
      btnLoadMore.addEventListener("click", function () {
        if (!state.guildId) return;

        const guildId = state.guildId;
        const requestSequence = usersRequestSequence;
        const page =
          (typeof state.usersPage === "number" ? state.usersPage : 1) + 1;
        const limit =
          typeof state.usersLimit === "number" ? state.usersLimit : 50;
        const search = state.usersSearch || "";
        const includeBots = !!state.usersIncludeBots;

        const params = [];
        params.push("page=" + encodeURIComponent(String(page)));
        params.push("limit=" + encodeURIComponent(String(limit)));
        if (search) params.push("search=" + encodeURIComponent(search));
        if (includeBots) params.push("includeBots=1");
        if (state.usersSort && state.usersSort !== "name")
          params.push("sort=" + encodeURIComponent(state.usersSort));

        const url =
          "/guilds/" +
          encodeURIComponent(guildId) +
          "/users?" +
          params.join("&");

        btnLoadMore.disabled = true;

        apiGet(url)
          .then(function (res) {
            if (
              requestSequence !== usersRequestSequence ||
              String(state.guildId || "") !== String(guildId)
            ) {
              return;
            }
            const listEl = document.getElementById("usersList");
            if (!listEl) return;

            const items = Array.isArray(res.items) ? res.items : [];
            const total =
              typeof res.total === "number" ? res.total : items.length;

            appendUserRows(listEl, items);

            state.usersPage = page;
            state.usersTotal = total;

            const countEl = document.getElementById("usersResultCount");
            if (countEl && total) {
              countEl.textContent = t("users_results_count", {
                shown: String(listEl.querySelectorAll(".list-item").length),
                total: String(total),
              });
            }

            const hasMore = page * limit < total;
            btnLoadMore.style.display = hasMore ? "" : "none";
          })
          .catch(function (err) {
            if (requestSequence !== usersRequestSequence) return;
            toast((err && err.apiMessage) || t("users_error_generic"), {
              type: "error",
            });
          })
          .finally(function () {
            if (requestSequence === usersRequestSequence)
              btnLoadMore.disabled = false;
          });
      });
    }

    if (btnSync) {
      btnSync.addEventListener("click", function () {
        if (!state.guildId) return;

        const guildId = state.guildId;
        const limit =
          typeof state.usersLimit === "number" ? state.usersLimit : 50;
        const search =
          document.getElementById("usersSearch") &&
          document.getElementById("usersSearch").value
            ? document.getElementById("usersSearch").value.toString().trim()
            : "";

        const includeBots = !!(botsEl && botsEl.checked);

        const params = [];
        params.push("page=1");
        params.push("limit=" + encodeURIComponent(String(limit)));
        if (search) params.push("search=" + encodeURIComponent(search));
        if (includeBots) params.push("includeBots=1");
        params.push("sync=1");

        btnSync.disabled = true;

        apiGet(
          "/guilds/" +
            encodeURIComponent(guildId) +
            "/users?" +
            params.join("&"),
        )
          .then(function () {
            reload();
          })
          .catch(function (err) {
            toast((err && err.apiMessage) || t("users_error_generic"), {
              type: "error",
            });
          })
          .finally(function () {
            btnSync.disabled = false;
          });
      });
    }
  });

  async function loadUserHistory(user) {
    const detailEl = document.getElementById("userDetailPanel");
    if (!detailEl) return;

    if (!detailEl.dataset.actionsBound) {
      detailEl.dataset.actionsBound = "1";
      detailEl.addEventListener("click", function (event) {
        const button = event.target.closest("[data-copy-user-id]");
        if (!button) return;
        const userId = button.getAttribute("data-copy-user-id") || "";
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          toast(t("users_copy_id_error"), { type: "error" });
          return;
        }
        navigator.clipboard
          .writeText(userId)
          .then(function () {
            toast(t("users_copy_id_ok"), { type: "success" });
          })
          .catch(function () {
            toast(t("users_copy_id_error"), { type: "error" });
          });
      });
    }

    if (!state.guildId || !user || !user.id) {
      detailEl.innerHTML = `<div class="empty">${escapeHtml(t("users_detail_empty"))}</div>`;
      return;
    }

    // Placeholder for bots
    if (user.bot) {
      detailEl.innerHTML = `
        <div class="title">${escapeHtml(t("users_history_title"))}</div>
        <div class="subtitle">${escapeHtml(user.username || user.id)} • BOT</div>
        <div class="user-detail-actions">
          <button class="btn xs" type="button" data-copy-user-id="${escapeHtml(user.id)}">${escapeHtml(t("users_copy_id"))}</button>
          <a class="btn xs btn-ghost" href="https://discord.com/users/${encodeURIComponent(user.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("users_open_discord_profile"))}</a>
        </div>
        <div class="empty">${escapeHtml(t("users_history_none"))}</div>
      `;
      return;
    }

    // Cancelar pedidos anteriores de histórico (evita race conditions)
    if (userHistoryAbortController) {
      userHistoryAbortController.abort();
    }
    userHistoryAbortController = new AbortController();
    const signal = userHistoryAbortController.signal;

    try {
      if (
        window.OzarkDashboard &&
        typeof window.OzarkDashboard.setPanelLoading === "function"
      ) {
        window.OzarkDashboard.setPanelLoading("userDetailPanel", true);
      }
    } catch {}
    detailEl.innerHTML = `<div class="empty">${escapeHtml(t("loading"))}</div>`;

    try {
      const [historyRes, userRes] = await Promise.all([
        apiGet(
          "/guilds/" +
            encodeURIComponent(state.guildId) +
            "/users/" +
            encodeURIComponent(user.id) +
            "/history",
          { signal: signal },
        ),
        apiGet(
          "/user?guildId=" +
            encodeURIComponent(state.guildId) +
            "&userId=" +
            encodeURIComponent(user.id),
          { signal: signal },
        ),
      ]);

      if (!historyRes || historyRes.ok === false) {
        console.error("User history error", historyRes && historyRes.error);
        detailEl.innerHTML = `<div class="empty">${escapeHtml(t("users_history_error_generic"))}</div>`;
        return;
      }

      const infractions = historyRes.infractions || [];
      const counts = historyRes.counts || {};
      const tickets = historyRes.tickets || [];

      const dbInfo = userRes && userRes.db ? userRes.db : null;

      let html = "";

      html += `<div class="title">${escapeHtml(t("users_history_title"))}</div>`;
      html += `<div class="subtitle">${escapeHtml(user.username || user.id)} • ${escapeHtml(user.id)}</div>`;
      html += '<div class="user-detail-actions">';
      html += `<button class="btn xs" type="button" data-copy-user-id="${escapeHtml(user.id)}">${escapeHtml(t("users_copy_id"))}</button>`;
      html += `<a class="btn xs btn-ghost" href="https://discord.com/users/${encodeURIComponent(user.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("users_open_discord_profile"))}</a>`;
      html += "</div>";
      if (Array.isArray(user.roles) && user.roles.length) {
        html += `<div class="subtitle user-detail-roles">${escapeHtml(t("users_roles_label"))}: ${escapeHtml(
          user.roles
            .map(function (role) {
              return role.name;
            })
            .join(", "),
        )}</div>`;
      }
      if (user.joinedAt) {
        const joinedDate =
          typeof D.formatDateTime === "function"
            ? D.formatDateTime(user.joinedAt)
            : user.joinedAt;
        html += `<div class="subtitle">${escapeHtml(t("users_joined_label"))}: ${escapeHtml(joinedDate)}</div>`;
      }

      // Trust e próxima penalização
      if (dbInfo && typeof dbInfo.trust === "number") {
        html += '<div class="history-section user-trust">';
        html += `<h3>${escapeHtml(t("users_trust_title"))}</h3>`;

        html += '<div class="user-trust-main">';

        // Badge para nível de trust (baixo / médio / alto)
        var trustVal = dbInfo.trust;
        var trustLabel = dbInfo.trustLabel ? String(dbInfo.trustLabel) : "";
        var trustLabelLower = trustLabel.toLowerCase();
        var trustLevelClass = "neutral";

        if (
          trustLabelLower.includes("alto") ||
          trustLabelLower.includes("high")
        ) {
          trustLevelClass = "high";
        } else if (
          trustLabelLower.includes("médio") ||
          trustLabelLower.includes("medio") ||
          trustLabelLower.includes("medium")
        ) {
          trustLevelClass = "medium";
        } else if (
          trustLabelLower.includes("baixo") ||
          trustLabelLower.includes("low")
        ) {
          trustLevelClass = "low";
        }

        html += '<div class="user-trust-header">';
        html +=
          '<div class="user-trust-score">' +
          escapeHtml(t("users_trust_score")) +
          ": " +
          String(trustVal) +
          "</div>";

        if (trustLabel) {
          html +=
            '<span class="trust-badge trust-badge-' +
            trustLevelClass +
            '" title="' +
            escapeHtml(t("users_trust_score") + ": " + String(trustVal)) +
            '">' +
            escapeHtml(trustLabel) +
            "</span>";
        }

        html += "</div>";

        if (dbInfo.nextPenalty && dbInfo.nextPenalty.automationEnabled) {
          var np = dbInfo.nextPenalty;
          var remaining =
            typeof np.remaining === "number" ? np.remaining : null;
          var mins =
            typeof np.estimatedMuteMinutes === "number"
              ? np.estimatedMuteMinutes
              : null;

          // Número atual de WARNs (para mostrar no texto de limiar)
          var currentWarns =
            dbInfo && typeof dbInfo.warnings === "number"
              ? dbInfo.warnings
              : (counts && counts.WARN) || 0;

          html += '<div class="user-trust-next">';
          if (mins !== null) {
            if (remaining !== null && remaining > 0) {
              html += `<span>${escapeHtml(t("users_trust_next_penalty_prefix"))} ${String(
                remaining,
              )} warn(s); ${escapeHtml(t("users_trust_next_penalty_suffix"))} ~${String(mins)} min</span>`;
            } else {
              html += `<span>${escapeHtml(
                t("users_trust_next_penalty_at_threshold"),
              )} ~${String(mins)} min (${String(currentWarns)} WARN(s) atuais)</span>`;
            }
          }
          html += "</div>";
        } else {
          html +=
            '<div class="user-trust-next-disabled">' +
            escapeHtml(t("users_trust_automation_disabled")) +
            "</div>";
        }

        html += "</div>"; // user-trust-main

        // Histórico visual da evolução do Trust
        var trustHistory = Array.isArray(dbInfo.trustHistory)
          ? dbInfo.trustHistory
          : [];
        if (trustHistory.length) {
          html += '<div class="user-trust-history">';
          html += `<h4>${escapeHtml(t("users_trust_history_title"))}</h4>`;
          html += '<div class="trust-hist-list">';

          // Most recent first
          trustHistory
            .slice()
            .reverse()
            .forEach(function (ev) {
              var delta = typeof ev.delta === "number" ? ev.delta : 0;
              var sign = delta > 0 ? "+" : "";
              var deltaClass =
                delta > 0 ? "pos" : delta < 0 ? "neg" : "neutral";
              var reasonKey = ev.reason
                ? "users_trust_reason_" + String(ev.reason)
                : "";
              var reasonText = reasonKey ? t(reasonKey) : "";
              if (!reasonText || reasonText === reasonKey) {
                reasonText = ev.reason ? String(ev.reason) : "";
              }
              var dateText =
                ev.at && D && typeof D.formatDateTime === "function"
                  ? D.formatDateTime(ev.at)
                  : ev.at
                    ? String(ev.at)
                    : "";

              html += '<div class="trust-hist-row">';
              html += `<span class="trust-hist-date">${escapeHtml(dateText)}</span>`;
              html += `<span class="trust-hist-delta ${deltaClass}">${escapeHtml(
                sign + String(delta),
              )}</span>`;
              html += `<span class="trust-hist-trust">${escapeHtml(
                typeof ev.trust === "number" ? String(ev.trust) : "-",
              )}</span>`;
              if (reasonText) {
                html += `<span class="trust-hist-reason">${escapeHtml(reasonText)}</span>`;
              }
              html += "</div>";
            });

          html += "</div>"; // trust-hist-list
          html += "</div>"; // user-trust-history
        }

        html += "</div>"; // history-section user-trust
      }

      // Badges de resumo
      html += '<div class="badge-row">';

      const warnCount =
        dbInfo && typeof dbInfo.warnings === "number"
          ? dbInfo.warnings
          : counts.WARN || 0;
      const muteCount = counts.MUTE || 0;
      const kickCount = counts.KICK || 0;
      const banCount = counts.BAN || 0;

      if (warnCount || muteCount || kickCount || banCount) {
        if (warnCount) {
          html += `<div class="badge badge-warn">WARN: ${String(warnCount)}</div>`;
        }
        if (muteCount) {
          html += `<div class="badge badge-mute">MUTE: ${String(muteCount)}</div>`;
        }
        if (kickCount) {
          html += `<div class="badge">KICK: ${String(kickCount)}</div>`;
        }
        if (banCount) {
          html += `<div class="badge">BAN: ${String(banCount)}</div>`;
        }
      } else {
        html += `<div class="badge">${escapeHtml(t("users_history_none"))}</div>`;
      }

      html += "</div>";

      // Ações rápidas de moderação
      html += '<div class="history-section user-actions">';
      html += `<h3>${escapeHtml(t("users_actions_title"))}</h3>`;

      html += '<div class="user-actions-fields">';
      html += `<input type="text" class="input xs user-actions-reason" placeholder="${escapeHtml(
        t("users_actions_reason_placeholder"),
      )}" name="auto_field_6" id="auto_id_6">`;
      html += `<input type="text" class="input xs user-actions-ban-duration" placeholder="${escapeHtml(
        t("users_actions_ban_duration_placeholder"),
      )}" inputmode="text" maxlength="32">`;
      html += "</div>";

      html += '<div class="badge-row user-actions-buttons">';
      html += `<button type="button" class="btn xs btn-warn" data-action="warn">${escapeHtml(
        t("users_actions_warn"),
      )}</button>`;
      html += `<button type="button" class="btn xs btn-kick" data-action="kick">${escapeHtml(
        t("users_actions_kick"),
      )}</button>`;
      html += `<button type="button" class="btn xs btn-ban" data-action="ban">${escapeHtml(
        t("users_actions_ban"),
      )}</button>`;
      html += `<button type="button" class="btn xs btn-unmute" data-action="unmute">${escapeHtml(
        t("users_actions_unmute"),
      )}</button>`;
      html += `<button type="button" class="btn xs btn-reset" data-action="reset">${escapeHtml(
        t("users_actions_reset"),
      )}</button>`;
      html += "</div>";
      html += "</div>";

      // Infrações recentes
      html += '<div class="history-section">';
      html += `<h3>${escapeHtml(t("users_history_infractions"))}</h3>`;
      html +=
        '<div class="history-hint">' +
        escapeHtml(t("users_history_click_to_remove")) +
        "</div>";

      if (!infractions.length) {
        html += `<div class="empty mt-1">${escapeHtml(t("users_history_none"))}</div>`;
      } else {
        html += '<ul class="infractions-list">';
        infractions.forEach(function (inf) {
          const id = (inf._id || inf.id || "").toString();
          const when = inf.createdAt
            ? new Date(inf.createdAt).toLocaleString()
            : "";
          const reason = inf.reason || "";
          const line =
            "[" +
            (inf.type || "UNK") +
            "] " +
            (reason ? reason : "") +
            (when ? " • " + when : "");
          html += `<li class="infraction-item" data-infraction-id="${escapeHtml(id)}">${escapeHtml(line)}</li>`;
        });
        html += "</ul>";
      }
      html += "</div>";

      // Tickets recentes
      html += '<div class="history-section">';
      html += `<h3>${escapeHtml(t("users_history_tickets"))}</h3>`;

      if (!tickets.length) {
        html += `<div class="empty mt-1">${escapeHtml(t("users_history_none"))}</div>`;
      } else {
        html += "<ul>";
        tickets.forEach(function (tkt) {
          const opened = tkt.createdAt
            ? new Date(tkt.createdAt).toLocaleString()
            : "";
          const status = tkt.closedAt
            ? t("users_ticket_closed")
            : t("users_ticket_open");
          const line =
            "#" +
            String(tkt.ticketNumber).padStart(3, "0") +
            " • " +
            status +
            (opened ? " • " + opened : "");
          html += `<li>${escapeHtml(line)}</li>`;
        });
        html += "</ul>";
      }
      html += "</div>";

      detailEl.innerHTML = html;

      // Bind quick moderation actions
      try {
        const container = detailEl.querySelector(".user-actions");
        if (container) {
          container
            .querySelectorAll("button[data-action]")
            .forEach(function (btn) {
              btn.addEventListener("click", function () {
                const action = btn.getAttribute("data-action");
                if (!state.guildId || !user || !user.id) return;

                const reasonInput =
                  container.querySelector(".user-actions-reason") || null;

                const reasonRaw =
                  reasonInput && reasonInput.value ? reasonInput.value : "";
                const reason =
                  reasonRaw.trim() || t("common_no_reason_provided");

                if (action === "reset-history") {
                  if (!window.confirm(t("users_actions_reset_history_confirm")))
                    return;
                  apiPost("/mod/reset-history", {
                    guildId: state.guildId,
                    userId: user.id,
                    reason: reason,
                  })
                    .then(function (res) {
                      if (!res || res.ok === false) {
                        console.error("Reset history failed", res && res.error);
                        toast(
                          res && res.error
                            ? String(res.error)
                            : t("users_history_error_generic"),
                          { type: "error" },
                        );
                        return;
                      }
                      toast(t("users_actions_reset_history_ok"), {
                        type: "success",
                      });
                      window.OzarkDashboard.loadUserHistory(user).catch(
                        function () {},
                      );
                    })
                    .catch(function (err) {
                      console.error("Reset history error", err);
                      toast(t("users_history_error_generic"), {
                        type: "error",
                      });
                    });
                } else if (action === "warn") {
                  apiPost("/mod/warn", {
                    guildId: state.guildId,
                    userId: user.id,
                    reason: reason,
                  })
                    .then(function (res) {
                      if (!res || res.ok === false) {
                        console.error("Warn failed", res && res.error);
                        toast(
                          res && res.error
                            ? String(res.error)
                            : t("users_history_error_generic"),
                          { type: "error" },
                        );
                        return;
                      }
                      toast(t("users_actions_warn_ok"), { type: "success" });
                      // reload history to reflect new infraction
                      window.OzarkDashboard.loadUserHistory(user).catch(
                        function () {},
                      );
                    })
                    .catch(function (err) {
                      console.error("Warn error", err);
                      toast(t("users_history_error_generic"), {
                        type: "error",
                      });
                    });
                } else if (action === "unmute") {
                  apiPost("/mod/unmute", {
                    guildId: state.guildId,
                    userId: user.id,
                    reason: reason,
                  })
                    .then(function (res) {
                      if (!res || res.ok === false) {
                        console.error("Unmute failed", res && res.error);
                        toast(
                          res && res.error
                            ? String(res.error)
                            : t("users_history_error_generic"),
                          { type: "error" },
                        );
                        return;
                      }
                      toast(t("users_actions_unmute_ok"), { type: "success" });
                      window.OzarkDashboard.loadUserHistory(user).catch(
                        function () {},
                      );
                    })
                    .catch(function (err) {
                      console.error("Unmute error", err);
                      toast(t("users_history_error_generic"), {
                        type: "error",
                      });
                    });
                } else if (action === "kick" || action === "ban") {
                  const confirmationKey =
                    action === "kick"
                      ? "users_actions_kick_confirm"
                      : "users_actions_ban_confirm";
                  if (
                    !window.confirm(
                      t(
                        action === "ban" &&
                          container
                            .querySelector(".user-actions-ban-duration")
                            ?.value.trim()
                          ? "users_actions_tempban_confirm"
                          : confirmationKey,
                        {
                          user: user.username || user.tag || user.id,
                          duration: container
                            .querySelector(".user-actions-ban-duration")
                            ?.value.trim(),
                        },
                      ),
                    )
                  ) {
                    return;
                  }
                  if (state._memberActionInFlight) return;
                  state._memberActionInFlight = true;
                  btn.disabled = true;
                  const actionPayload = {
                    guildId: state.guildId,
                    userId: user.id,
                    reason: reason,
                  };
                  if (action === "ban") {
                    const duration = container
                      .querySelector(".user-actions-ban-duration")
                      ?.value.trim();
                    if (duration) actionPayload.duration = duration;
                  }
                  apiPost("/mod/" + action, actionPayload)
                    .then(function (res) {
                      if (!res || res.ok === false) {
                        toast(
                          res && res.error
                            ? String(res.error)
                            : t("users_history_error_generic"),
                          { type: "error" },
                        );
                        return;
                      }
                      toast(
                        t(
                          action === "kick"
                            ? "users_actions_kick_ok"
                            : "users_actions_ban_ok",
                        ),
                        { type: "success" },
                      );
                      detailEl.innerHTML =
                        '<div class="empty">' +
                        escapeHtml(t("users_detail_empty")) +
                        "</div>";
                      window.OzarkDashboard.loadUsers().catch(function () {});
                    })
                    .catch(function (err) {
                      console.error(action + " error", err);
                      toast(t("users_history_error_generic"), {
                        type: "error",
                      });
                    })
                    .finally(function () {
                      state._memberActionInFlight = false;
                      btn.disabled = false;
                    });
                } else if (action === "reset") {
                  if (!window.confirm(t("users_actions_reset_confirm"))) return;
                  // Prevent accidental double-click spam (backend also rate-limits).
                  if (state._resetTrustInFlight) return;
                  state._resetTrustInFlight = true;
                  apiPost("/mod/reset-trust", {
                    guildId: state.guildId,
                    userId: user.id,
                    reason: reason,
                  })
                    .then(function (res) {
                      if (!res || res.ok === false) {
                        console.error("Reset trust failed", res && res.error);
                        toast(
                          res && res.error
                            ? String(res.error)
                            : t("users_history_error_generic"),
                          { type: "error" },
                        );
                        return;
                      }
                      toast(t("users_actions_reset_ok"), { type: "success" });
                      window.OzarkDashboard.loadUserHistory(user).catch(
                        function () {},
                      );
                    })
                    .catch(function (err) {
                      console.error("Reset trust error", err);
                      toast(t("users_history_error_generic"), {
                        type: "error",
                      });
                    })
                    .finally(function () {
                      state._resetTrustInFlight = false;
                    });
                }
              });
            });
        }

        // Bind infractions click-to-remove
        const infraList = detailEl.querySelector(".infractions-list");
        if (infraList) {
          infraList.querySelectorAll(".infraction-item").forEach(function (li) {
            li.addEventListener("click", function () {
              const id = li.getAttribute("data-infraction-id");
              if (!id || !state.guildId || !user || !user.id) return;

              if (!window.confirm(t("users_history_remove_confirm"))) return;

              // Avoid hammering the API (prevents 429s when user clicks multiple items quickly)
              const now = Date.now();
              if (state._removeInfractionInFlight) return;
              if (
                state._removeInfractionCooldownUntil &&
                now < state._removeInfractionCooldownUntil
              ) {
                const waitMs = state._removeInfractionCooldownUntil - now;
                toast(
                  (t("common_rate_limit_wait") || "Aguarda um momento...") +
                    ` (${Math.ceil(waitMs / 100) / 10}s)`,
                  { type: "warn" },
                );
                return;
              }
              state._removeInfractionInFlight = true;
              li.classList.add("removing");

              apiPost("/mod/remove-infraction", {
                guildId: state.guildId,
                userId: user.id,
                infractionId: id,
              })
                .then(function (res) {
                  if (!res || res.ok === false) {
                    console.error("Remove infraction failed", res && res.error);
                    toast(
                      res && res.error
                        ? String(res.error)
                        : t("users_history_error_generic"),
                      { type: "error" },
                    );
                    return;
                  }
                  toast(t("users_history_remove_success"), { type: "success" });
                  window.OzarkDashboard.loadUserHistory(user).catch(
                    function () {},
                  );
                })
                .catch(function (err) {
                  console.error("Remove infraction error", err);
                  // If backend provides retryAfterMs, show a helpful message.
                  const ra =
                    err &&
                    err.payload &&
                    typeof err.payload.retryAfterMs === "number"
                      ? err.payload.retryAfterMs
                      : null;
                  if (err && err.status === 429 && ra) {
                    toast(
                      (t("common_rate_limit_wait") ||
                        "Muitas ações seguidas. Aguarda") +
                        ` ${Math.ceil(ra / 100) / 10}s`,
                      { type: "warn" },
                    );
                  } else {
                    toast((err && err.apiMessage) || t("users_error_generic"), {
                      type: "error",
                    });
                  }
                })
                .finally(function () {
                  state._removeInfractionInFlight = false;
                  state._removeInfractionCooldownUntil = Date.now() + 800;
                  // Keep the visual state if the item was removed on refresh; otherwise re-enable.
                  try {
                    li.classList.remove("removing");
                  } catch {}
                });
            });
          });
        }
      } catch (err) {
        console.error("Failed to bind user quick actions", err);
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        // Pedido de histórico cancelado devido a uma nova seleção de utilizador; ignorar.
        return;
      }
      console.error("Failed to load user history", err);
      detailEl.innerHTML = `<div class="empty">${escapeHtml(t("users_history_error_generic"))}</div>`;
    } finally {
      try {
        if (
          window.OzarkDashboard &&
          typeof window.OzarkDashboard.setPanelLoading === "function"
        ) {
          window.OzarkDashboard.setPanelLoading("userDetailPanel", false);
        }
      } catch {}
    }
  }

  // Substituir as funções expostas no namespace pela versão deste módulo
  D.loadUsers = loadUsers;
  D.loadUserHistory = loadUserHistory;
})();
