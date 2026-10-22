// Moderation module extension for OzarkDashboard
// Lógica da tab de Moderação (Logs & Cases) extraída para este módulo.

(function () {
  if (!window.OzarkDashboard) return;

  const D = window.OzarkDashboard;
  const state = D.state;
  const apiGet = D.apiGet;
  const apiPost = D.apiPost;
  const toast = D.toast;
  const t = D.t;
  const escapeHtml = D.escapeHtml;
  const createLogRow = D.createLogRow;

  // -----------------------------
  // Skeleton helpers
  // -----------------------------

  // Used while fetching logs.
  function renderLogsSkeleton(count) {
    count = typeof count === "number" && count > 0 ? count : 6;
    let html = '<div class="list-skeleton" aria-hidden="true">';
    for (let i = 0; i < count; i++) {
      html +=
        '<div class="skeleton-row">' +
        '<div class="skeleton-line skeleton-line--w60"></div>' +
        '<div class="skeleton-line skeleton-line--w80"></div>' +
        '<div class="skeleton-line skeleton-line--w35"></div>' +
        "</div>";
    }
    html += "</div>";
    return html;
  }

  // -----------------------------
  // Preferences (per-guild) for logs filters
  // -----------------------------
  function logsPrefsKey(guildId) {
    return "ozark.logsPrefs." + String(guildId || "none");
  }

  function saveLogsPrefs(guildId, prefs) {
    try {
      if (!guildId) return;
      localStorage.setItem(logsPrefsKey(guildId), JSON.stringify(prefs || {}));
    } catch {}
  }

  function loadLogsPrefs(guildId) {
    try {
      if (!guildId) return null;
      const raw = localStorage.getItem(logsPrefsKey(guildId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function applyLogsPrefsToControls(guildId) {
    const prefs = loadLogsPrefs(guildId);
    if (!prefs) return;

    const searchInput = document.getElementById("logSearch");
    const typeSelect = document.getElementById("logType");
    const limitSelect = document.getElementById("logLimit");
    const sortSelect = document.getElementById("logSort");
    const fromInput = document.getElementById("logFrom");
    const toInput = document.getElementById("logTo");

    if (searchInput && typeof prefs.search === "string")
      searchInput.value = prefs.search;
    if (typeSelect && typeof prefs.type === "string")
      typeSelect.value = prefs.type;
    if (limitSelect && typeof prefs.limit === "number")
      limitSelect.value = [5, 10, 20].includes(prefs.limit)
        ? String(prefs.limit)
        : "10";
    if (sortSelect && (prefs.sort === "oldest" || prefs.sort === "newest"))
      sortSelect.value = prefs.sort;
    if (fromInput && typeof prefs.from === "string")
      fromInput.value = prefs.from;
    if (toInput && typeof prefs.to === "string") toInput.value = prefs.to;
  }

  // Lê os filtros De/Até (inputs type=date) e devolve o intervalo em ISO.
  function readLogsDateRange() {
    const fromEl = document.getElementById("logFrom");
    const toEl = document.getElementById("logTo");
    const fromRaw =
      fromEl && fromEl.value ? fromEl.value.toString().trim() : "";
    const toRaw = toEl && toEl.value ? toEl.value.toString().trim() : "";

    let since = null;
    let until = null;

    if (fromRaw) {
      const d = new Date(fromRaw + "T00:00:00");
      if (!Number.isNaN(d.getTime())) since = d.toISOString();
    }
    if (toRaw) {
      const d = new Date(toRaw + "T23:59:59.999");
      if (!Number.isNaN(d.getTime())) until = d.toISOString();
    }

    return { since: since, until: until, from: fromRaw, to: toRaw };
  }

  // Expose so core can restore on guild change
  D.restoreLogsPrefs = function (guildId) {
    applyLogsPrefsToControls(guildId);
  };

  let logsAbortController = null;
  let modServerRange = "7d";
  let modTicketsRange = "7d";
  let modTopOnlineRange = "7d";
  let modTicketsPage = 1;

  function formatSecondsForUi(totalSec) {
    const s = Math.max(0, Number(totalSec) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return h + "h " + String(m).padStart(2, "0") + "m";
    if (m > 0) return m + "m " + String(sec).padStart(2, "0") + "s";
    return sec + "s";
  }

  async function loadLogs() {
    const listEl = document.getElementById("logsList");
    const searchInput = document.getElementById("logSearch");
    const typeSelect = document.getElementById("logType");
    const limitSelect = document.getElementById("logLimit");
    const sortSelect = document.getElementById("logSort");
    const btnLoadMore = document.getElementById("btnLogsLoadMore");
    const resultsDisclosure = document.getElementById("logsResultsDisclosure");

    if (!listEl || !typeSelect) return;
    if (resultsDisclosure && !resultsDisclosure.open) return;

    function setLoadMoreVisible(visible) {
      if (!btnLoadMore) return;
      btnLoadMore.style.display = visible ? "" : "none";
      btnLoadMore.disabled = !visible;
    }

    function renderLogsPage(items, append) {
      if (!append) listEl.innerHTML = "";

      if (!items || !items.length) {
        if (!append) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = t("logs_empty");
          listEl.appendChild(empty);
        }
        return;
      }

      items.forEach(function (log) {
        const row = createLogRow(log);
        listEl.appendChild(row);
      });
    }

    if (!state.guildId) {
      listEl.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("warn_select_guild");
      listEl.appendChild(empty);
      setLoadMoreVisible(false);
      state.logsPage = 1;
      return;
    }

    const search =
      searchInput && searchInput.value
        ? searchInput.value.toString().trim()
        : "";
    const typeValue = (typeSelect.value || "").trim();
    const sortValue =
      sortSelect && sortSelect.value === "oldest" ? "oldest" : "newest";
    const range = readLogsDateRange();
    let limit = 10;
    if (limitSelect && limitSelect.value) {
      const n = Number(limitSelect.value);
      if (Number.isFinite(n) && n > 0) limit = n;
    }

    state.logsPage = 1;
    state.logsSearch = search;
    state.logsType = typeValue;
    state.logsSort = sortValue;
    state.logsLimit = limit;
    state.logsSince = range.since;
    state.logsUntil = range.until;

    saveLogsPrefs(state.guildId, {
      search: search,
      type: typeValue,
      sort: sortValue,
      limit: limit,
      from: range.from,
      to: range.to,
    });

    if (btnLoadMore) btnLoadMore.disabled = true;

    // Abort previous
    if (logsAbortController) logsAbortController.abort();
    logsAbortController = new AbortController();
    const signal = logsAbortController.signal;

    return window.OzarkDashboard.withLoading(
      async function () {
        listEl.innerHTML = renderLogsSkeleton();
        setLoadMoreVisible(false);

        const params = [];
        params.push("guildId=" + encodeURIComponent(state.guildId));
        params.push("limit=" + String(limit));
        params.push("page=1");
        if (search) params.push("search=" + encodeURIComponent(search));
        if (typeValue) params.push("type=" + encodeURIComponent(typeValue));
        if (sortValue === "oldest") params.push("sort=oldest");
        if (range.since)
          params.push("since=" + encodeURIComponent(range.since));
        if (range.until)
          params.push("until=" + encodeURIComponent(range.until));

        const res = await apiGet("/logs?" + params.join("&"), {
          signal: signal,
        });

        const items = (res && res.items) || [];
        const total = typeof res.total === "number" ? res.total : items.length;

        listEl.innerHTML = "";
        renderLogsPage(items, false);

        const hasMore = 1 * limit < total;
        setLoadMoreVisible(hasMore);

        state.logsTotal = total;
      },
      {
        onError: function () {
          listEl.innerHTML = "";
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = t("logs_error_generic");
          listEl.appendChild(empty);
          setLoadMoreVisible(false);
        },
      },
    ).finally(function () {
      logsAbortController = null;
      if (btnLoadMore) btnLoadMore.disabled = false;
    });
  }

  async function loadModerationOverview() {
    const guildId = state.guildId;
    const insightsContent = document.getElementById("modServerInsightsContent");
    const ticketsList = document.getElementById("modTicketsList");
    const topOnlineList = document.getElementById("modTopOnlineList");

    if (!insightsContent || !ticketsList || !topOnlineList) return;

    if (!guildId) {
      insightsContent.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("logs_server_insights_no_guild");
      insightsContent.appendChild(empty);

      ticketsList.innerHTML = "";
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = t("logs_tickets_panel_no_guild");
      ticketsList.appendChild(li);

      topOnlineList.innerHTML = "";
      const li2 = document.createElement("li");
      li2.className = "empty";
      li2.textContent = t("logs_top_online_panel_no_guild");
      topOnlineList.appendChild(li2);
      return;
    }

    const rangeParam =
      "?range=" +
      encodeURIComponent(modServerRange || "7d") +
      "&guildId=" +
      encodeURIComponent(guildId);

    return window.OzarkDashboard.withLoading(
      function () {
        return Promise.resolve()
          .then(function () {
            // Painel de "Server Insights"
            insightsContent.innerHTML = "";
            const loading = document.createElement("div");
            loading.className = "empty";
            insightsContent.innerHTML =
              '<div class="grid-3" aria-hidden="true">' +
              '<div class="skeleton-row"><div class="skeleton-line skeleton-line--w60"></div><div class="skeleton-line skeleton-line--w35"></div></div>' +
              '<div class="skeleton-row"><div class="skeleton-line skeleton-line--w60"></div><div class="skeleton-line skeleton-line--w35"></div></div>' +
              '<div class="skeleton-row"><div class="skeleton-line skeleton-line--w60"></div><div class="skeleton-line skeleton-line--w35"></div></div>' +
              "</div>";

            // Tickets list skeleton
            ticketsList.innerHTML = "";
            for (let i = 0; i < 4; i++) {
              const liS = document.createElement("li");
              liS.className = "skeleton-row";
              liS.innerHTML =
                '<div class="skeleton-line skeleton-line--w80"></div><div class="skeleton-line skeleton-line--w35"></div>';
              ticketsList.appendChild(liS);
            }

            // Top online skeleton
            topOnlineList.innerHTML = "";
            for (let j = 0; j < 5; j++) {
              const liO = document.createElement("li");
              liO.className = "skeleton-row";
              liO.innerHTML =
                '<div class="skeleton-line skeleton-line--w60"></div><div class="skeleton-line skeleton-line--w35"></div>';
              topOnlineList.appendChild(liO);
            }

            return apiGet("/mod/overview" + rangeParam)
              .then(function (res) {
                insightsContent.innerHTML = "";
                // Backend currently returns a flat payload (ok, moderationCounts, tickets).
                // Keep forward compatibility with a future {data:{stats}} wrapper.
                const data = (res && (res.data || res)) || {};
                let stats = data.stats || null;

                if (!stats) {
                  const mc = data.moderationCounts || data.moderation || {};
                  const warns = Number(mc.warn || 0) || 0;
                  const mutes = Number(mc.mute || 0) || 0;
                  const totalActions = warns + mutes;
                  stats = { totalActions, warns, mutes };
                }
                const cards = [
                  {
                    key: "totalActions",
                    labelKey: "logs_server_insights_total_actions",
                    value: stats.totalActions || 0,
                  },
                  {
                    key: "warns",
                    labelKey: "logs_server_insights_warns",
                    value: stats.warns || 0,
                  },
                  {
                    key: "mutes",
                    labelKey: "logs_server_insights_mutes",
                    value: stats.mutes || 0,
                  },
                ];

                const list = document.createElement("ul");
                list.className = "insights-list";

                cards.forEach(function (c) {
                  const li = document.createElement("li");
                  li.className = "insights-item";
                  const value = typeof c.value === "number" ? c.value : 0;
                  li.innerHTML =
                    '<div class="insights-label">' +
                    escapeHtml(t(c.labelKey)) +
                    "</div>" +
                    '<div class="insights-value">' +
                    escapeHtml(String(value)) +
                    "</div>";
                  list.appendChild(li);
                });

                // Breakdown de riscos, se existir
                if (
                  Array.isArray(data.riskBreakdown) &&
                  data.riskBreakdown.length
                ) {
                  const breakdownTitle = document.createElement("div");
                  breakdownTitle.className = "insights-section-title";
                  breakdownTitle.textContent = t(
                    "logs_server_insights_risk_breakdown_title",
                  );
                  insightsContent.appendChild(breakdownTitle);

                  const breakdownList = document.createElement("ul");
                  breakdownList.className = "insights-breakdown-list";

                  data.riskBreakdown.forEach(function (r) {
                    const li = document.createElement("li");
                    li.className = "insights-breakdown-item";
                    li.innerHTML =
                      "<strong>" +
                      escapeHtml(String(r.label)) +
                      ":</strong> " +
                      String(r.value);
                    breakdownList.appendChild(li);
                  });

                  insightsContent.appendChild(breakdownList);
                }

                insightsContent.appendChild(list);
              })
              .catch(function (err) {
                console.error("Failed to load moderation overview", err);
                insightsContent.innerHTML = "";
                const errBox = document.createElement("div");
                errBox.className = "empty";
                errBox.textContent = t("logs_server_insights_error");
                insightsContent.appendChild(errBox);
              });
          })
          .then(function () {
            // Painel de "Top Online" (atividade por mensagens)
            topOnlineList.innerHTML = "";
            const loadingOnline = document.createElement("li");
            loadingOnline.className = "empty";
            loadingOnline.textContent = t("logs_top_online_panel_loading");
            topOnlineList.appendChild(loadingOnline);

            const qp =
              "?range=" +
              encodeURIComponent(modTopOnlineRange || "7d") +
              "&guildId=" +
              encodeURIComponent(guildId);

            return apiGet("/mod/top-online" + qp)
              .then(function (resTop) {
                topOnlineList.innerHTML = "";
                const items = resTop && resTop.items ? resTop.items : [];
                if (!items.length) {
                  const li = document.createElement("li");
                  li.className = "empty";
                  li.textContent = t("logs_top_online_panel_empty");
                  topOnlineList.appendChild(li);
                  return;
                }

                const mode = resTop && resTop.mode ? String(resTop.mode) : null;

                items.forEach(function (it) {
                  const li = document.createElement("li");
                  const name = it.username || it.userId || "—";

                  if (
                    mode === "presence" ||
                    (it.secondsOnline !== undefined &&
                      it.secondsOnline !== null)
                  ) {
                    const sec = Number(it.secondsOnline || 0) || 0;
                    li.innerHTML =
                      '<div class="title">' +
                      escapeHtml(String(name)) +
                      "</div>" +
                      '<div class="subtitle">' +
                      escapeHtml(formatSecondsForUi(sec)) +
                      " " +
                      escapeHtml(t("logs_top_online_panel_time")) +
                      "</div>";
                  } else {
                    const count = Number(it.messages || 0) || 0;
                    li.innerHTML =
                      '<div class="title">' +
                      escapeHtml(String(name)) +
                      "</div>" +
                      '<div class="subtitle">' +
                      escapeHtml(String(count)) +
                      " " +
                      escapeHtml(t("logs_top_online_panel_messages")) +
                      "</div>";
                  }

                  topOnlineList.appendChild(li);
                });
              })
              .catch(function (err) {
                console.error("Failed to load top online panel", err);
                topOnlineList.innerHTML = "";
                const li = document.createElement("li");
                li.className = "empty";
                li.textContent =
                  err && err.apiMessage
                    ? err.apiMessage
                    : t("logs_top_online_panel_error");
                topOnlineList.appendChild(li);
              });
          })
          .then(function () {
            // Painel de análises de tickets (com intervalo e paginação)
            ticketsList.innerHTML = "";
            const loadingTickets = document.createElement("li");
            loadingTickets.className = "empty";
            loadingTickets.textContent = t("logs_tickets_panel_loading");
            ticketsList.appendChild(loadingTickets);

            // Compute a "since" window and ask backend to apply it (more accurate pagination).
            const now = Date.now();
            let windowMs = 7 * 24 * 60 * 60 * 1000;
            if (modTicketsRange === "14d") windowMs = 14 * 24 * 60 * 60 * 1000;
            else if (modTicketsRange === "7d")
              windowMs = 7 * 24 * 60 * 60 * 1000;
            else if (modTicketsRange === "30d")
              windowMs = 30 * 24 * 60 * 60 * 1000;
            else if (modTicketsRange === "1y")
              windowMs = 365 * 24 * 60 * 60 * 1000;
            const sinceIso = new Date(now - windowMs).toISOString();

            return apiGet(
              "/logs?type=tickets&limit=4&page=" +
                encodeURIComponent(String(modTicketsPage)) +
                "&guildId=" +
                encodeURIComponent(guildId) +
                "&since=" +
                encodeURIComponent(sinceIso),
            )
              .then(function (resTickets) {
                ticketsList.innerHTML = "";
                const rawItems = (resTickets && resTickets.items) || [];
                const total =
                  resTickets && typeof resTickets.total === "number"
                    ? resTickets.total
                    : rawItems.length;
                // Backend now supports `since` filtering, but keep a defensive fallback.
                const cutoff = Date.parse(sinceIso);
                const items = rawItems.filter(function (it) {
                  const tsStr = it.createdAt || it.timestamp || it.time;
                  if (!tsStr || Number.isNaN(cutoff)) return true;
                  const ts = Date.parse(tsStr);
                  if (Number.isNaN(ts)) return true;
                  return ts >= cutoff;
                });

                if (!items.length) {
                  const li = document.createElement("li");
                  li.className = "empty";
                  li.textContent = t("logs_tickets_panel_empty");
                  ticketsList.appendChild(li);
                } else {
                  items.forEach(function (it) {
                    const li = document.createElement("li");
                    const title = it.title || "Ticket";
                    const desc = it.description || "";
                    li.innerHTML =
                      '<div class="title">' +
                      escapeHtml(String(title)) +
                      "</div>" +
                      (desc
                        ? '<div class="subtitle">' +
                          escapeHtml(String(desc)) +
                          "</div>"
                        : "");
                    ticketsList.appendChild(li);
                  });
                }

                // Update pagination buttons (avoid “dead” clicks)
                const btnPrev = document.getElementById("modTicketsPrevPage");
                const btnNext = document.getElementById("modTicketsNextPage");
                const pageSize = 4;
                if (btnPrev) btnPrev.disabled = modTicketsPage <= 1;
                if (btnNext)
                  btnNext.disabled = modTicketsPage * pageSize >= total;
              })
              .catch(function (err) {
                console.error("Failed to load moderation tickets panel", err);
                ticketsList.innerHTML = "";
                const li = document.createElement("li");
                li.className = "empty";
                li.textContent =
                  err && err.apiMessage
                    ? err.apiMessage
                    : t("logs_tickets_panel_error");
                ticketsList.appendChild(li);
              });
          });
      },
      {
        // Aqui podemos, no futuro, ligar um spinner global da tab de moderação se quisermos.
      },
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    const resultsDisclosure = document.getElementById("logsResultsDisclosure");
    if (resultsDisclosure) {
      resultsDisclosure.addEventListener("toggle", function () {
        if (resultsDisclosure.open) loadLogs().catch(function () {});
      });
    }

    const unbanForm = document.getElementById("moderationUnbanForm");
    if (unbanForm) {
      unbanForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!state.guildId) {
          toast(t("warn_select_guild"), { type: "warn" });
          return;
        }

        const userId = document
          .getElementById("moderationUnbanUserId")
          .value.trim();
        const reason = document
          .getElementById("moderationUnbanReason")
          .value.trim();
        const button = document.getElementById("btnModerationUnban");
        if (button) button.disabled = true;

        apiPost("/mod/unban", {
          guildId: state.guildId,
          userId,
          reason,
        })
          .then(function (response) {
            if (!response || response.ok === false) {
              throw new Error(response?.error || t("moderation_unban_error"));
            }
            toast(t("moderation_unban_success"), { type: "success" });
            unbanForm.reset();
          })
          .catch(function (error) {
            toast(
              error?.apiMessage ||
                error?.message ||
                t("moderation_unban_error"),
              {
                type: "error",
              },
            );
          })
          .finally(function () {
            if (button) button.disabled = false;
          });
      });
    }

    const serverRangeEl = document.getElementById("modServerInsightsRange");
    if (serverRangeEl) {
      serverRangeEl.addEventListener("click", function (ev) {
        const btn = ev.target.closest(".chip");
        if (!btn || !btn.dataset.range) return;
        const range = btn.dataset.range;
        if (!range) return;
        modServerRange = range;
        Array.from(serverRangeEl.querySelectorAll(".chip")).forEach(
          function (el) {
            el.classList.toggle("chip-active", el === btn);
          },
        );
        loadModerationOverview();
      });
    }

    const topOnlineRangeEl = document.getElementById("modTopOnlineRange");
    if (topOnlineRangeEl) {
      topOnlineRangeEl.addEventListener("click", function (ev) {
        const btn = ev.target.closest(".chip");
        if (!btn || !btn.dataset.range) return;
        const range = btn.dataset.range;
        if (!range) return;
        modTopOnlineRange = range;
        Array.from(topOnlineRangeEl.querySelectorAll(".chip")).forEach(
          function (el) {
            el.classList.toggle("chip-active", el === btn);
          },
        );
        loadModerationOverview();
      });
    }

    const ticketsRangeEl = document.getElementById("modTicketsRange");
    if (ticketsRangeEl) {
      ticketsRangeEl.addEventListener("click", function (ev) {
        const btn = ev.target.closest(".chip");
        if (!btn || !btn.dataset.range) return;
        const range = btn.dataset.range;
        if (!range) return;
        modTicketsRange = range;
        modTicketsPage = 1;
        Array.from(ticketsRangeEl.querySelectorAll(".chip")).forEach(
          function (el) {
            el.classList.toggle("chip-active", el === btn);
          },
        );
        loadModerationOverview();
      });
    }

    const btnPrev = document.getElementById("modTicketsPrevPage");
    const btnNext = document.getElementById("modTicketsNextPage");
    if (btnPrev && btnNext) {
      btnPrev.addEventListener("click", function () {
        if (modTicketsPage > 1) {
          modTicketsPage -= 1;
          loadModerationOverview();
        }
      });
      btnNext.addEventListener("click", function () {
        modTicketsPage += 1;
        loadModerationOverview();
      });
    }

    const logFromEl = document.getElementById("logFrom");
    const logToEl = document.getElementById("logTo");
    [logFromEl, logToEl].forEach(function (el) {
      if (el) {
        el.addEventListener("change", function () {
          window.OzarkDashboard.loadLogs().catch(function () {});
        });
      }
    });

    const logSortEl = document.getElementById("logSort");
    if (logSortEl) {
      logSortEl.addEventListener("change", function () {
        window.OzarkDashboard.loadLogs().catch(function () {});
      });
    }

    const btnExportLogs = document.getElementById("btnExportLogs");
    if (btnExportLogs) {
      btnExportLogs.addEventListener("click", function () {
        if (!state.guildId) return;

        const params = [];
        params.push("guildId=" + encodeURIComponent(state.guildId));
        const search = state.logsSearch || "";
        const typeValue = state.logsType || "";
        if (search) params.push("search=" + encodeURIComponent(search));
        if (typeValue) params.push("type=" + encodeURIComponent(typeValue));
        if (state.logsSort === "oldest") params.push("sort=oldest");
        if (state.logsSince)
          params.push("since=" + encodeURIComponent(state.logsSince));
        if (state.logsUntil)
          params.push("until=" + encodeURIComponent(state.logsUntil));

        window.location.href = "/api/logs/export.csv?" + params.join("&");
      });
    }

    const btnLogsLoadMore = document.getElementById("btnLogsLoadMore");
    if (btnLogsLoadMore) {
      btnLogsLoadMore.addEventListener("click", function () {
        if (!state.guildId) return;

        const listEl = document.getElementById("logsList");
        if (!listEl) return;

        const page =
          (typeof state.logsPage === "number" ? state.logsPage : 1) + 1;
        const limit =
          typeof state.logsLimit === "number" ? state.logsLimit : 10;
        const search = state.logsSearch || "";
        const typeValue = state.logsType || "";
        const since = state.logsSince || null;
        const until = state.logsUntil || null;

        const params = [];
        params.push("guildId=" + encodeURIComponent(state.guildId));
        params.push("limit=" + String(limit));
        params.push("page=" + String(page));
        if (search) params.push("search=" + encodeURIComponent(search));
        if (typeValue) params.push("type=" + encodeURIComponent(typeValue));
        if (state.logsSort === "oldest") params.push("sort=oldest");
        if (since) params.push("since=" + encodeURIComponent(since));
        if (until) params.push("until=" + encodeURIComponent(until));

        btnLogsLoadMore.disabled = true;

        apiGet("/logs?" + params.join("&"))
          .then(function (res) {
            const items = (res && res.items) || [];
            const total =
              typeof res.total === "number" ? res.total : items.length;

            if (Array.isArray(items) && items.length) {
              items.forEach(function (log) {
                const row = createLogRow(log);
                listEl.appendChild(row);
              });
            }

            state.logsPage = page;
            state.logsTotal = total;

            const hasMore = page * limit < total;
            btnLogsLoadMore.style.display = hasMore ? "" : "none";
          })
          .catch(function (err) {
            toast((err && err.apiMessage) || t("logs_error_generic"), {
              type: "error",
            });
          })
          .finally(function () {
            btnLogsLoadMore.disabled = false;
          });
      });
    }
  });

  // Substituir as funções no namespace pela versão deste módulo
  D.loadLogs = loadLogs;
  D.loadModerationOverview = loadModerationOverview;
})();
