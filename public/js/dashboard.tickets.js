// Tickets module for OzarkDashboard
// List (left) + detail (right) inside Extras -> Tickets panel.

(function () {
  if (!window.OzarkDashboard) return;

  const D = window.OzarkDashboard;
  const state = D.state;
  const apiGet = D.apiGet;
  const apiPost = D.apiPost;
  const toast = D.toast;
  const t = D.t;
  const escapeHtml = D.escapeHtml;

  let _loading = false;
  let _ticketsRequestSequence = 0;
  let _detailTimeout = null;
  const MAX_REPLY_LEN = 1800;

  function waitForI18nReady(maxMs) {
    const deadline = Date.now() + (typeof maxMs === "number" ? maxMs : 4000);
    return new Promise((resolve) => {
      (function tick() {
        try {
          const I = D && D.I18n;
          const ok =
            I && I.translations && Object.keys(I.translations).length > 0;
          if (ok) return resolve(true);
        } catch {}
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tick, 50);
      })();
    });
  }

  function getGuildId() {
    return state.guildId ? String(state.guildId) : "";
  }

  function fmtDate(v) {
    if (!v) return "";
    try {
      if (D && typeof D.formatDateTime === "function")
        return D.formatDateTime(v);
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch {
      return "";
    }
  }

  function setListActive(index) {
    const listEl = document.getElementById("ticketsList");
    if (!listEl) return;
    listEl.querySelectorAll(".list-item").forEach((el) => {
      el.classList.remove("active");
      el.setAttribute("aria-pressed", "false");
    });
    const row = listEl.querySelector(`.list-item[data-index="${index}"]`);
    if (row) {
      row.classList.add("active");
      row.setAttribute("aria-pressed", "true");
    }
  }

  function renderList(items) {
    const listEl = document.getElementById("ticketsList");
    if (!listEl) return;

    listEl.innerHTML = "";

    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("tickets_empty");
      listEl.appendChild(empty);
      return;
    }

    items.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-pressed", "false");
      row.dataset.index = String(idx);

      const num =
        it.ticketNumber != null
          ? String(it.ticketNumber)
          : String(it._id || "").slice(-6);
      const subject = it.subject || t("tickets_subject_default");
      const username = it.username || it.userId || "";
      const status =
        (it.status || "open") === "closed"
          ? t("tickets_status_closed")
          : t("tickets_status_open");
      const created = fmtDate(it.createdAt);
      const priorityLabels = {
        low: t("tickets_priority_low"),
        normal: t("tickets_priority_normal"),
        high: t("tickets_priority_high"),
        urgent: t("tickets_priority_urgent"),
      };
      const priority = priorityLabels[it.priority] || priorityLabels.normal;

      row.innerHTML = `
        <div class="user-row-header">
          <div class="title">#${escapeHtml(num)} • ${escapeHtml(subject)}</div>
          <div class="user-type-badge ${it.status === "closed" ? "bot" : "human"}">${escapeHtml(status)}</div>
        </div>
        <div class="subtitle">${escapeHtml(username)}${created ? " • " + escapeHtml(created) : ""} • ${escapeHtml(priority)}</div>
      `;

      row.addEventListener("click", () => {
        setListActive(idx);
        selectTicketByIndex(idx);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        row.click();
      });

      listEl.appendChild(row);
    });
  }

  function renderDetailSkeleton() {
    // Match the visual language used in other panels (feeds/temp voice): shimmer + skeleton blocks.
    return `
      <div>
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-line skeleton-line--w80"></div>
        <div class="skeleton skeleton-line skeleton-line--w60"></div>

        <div class="mt-3">
          <div class="skeleton skeleton-block"></div>
          <div class="skeleton skeleton-block"></div>
          <div class="skeleton skeleton-block"></div>
        </div>
      </div>
    `;
  }

  function renderDetailEmpty() {
    const panel = document.getElementById("ticketDetailPanel");
    if (!panel) return;
    try {
      if (
        window.OzarkDashboard &&
        typeof window.OzarkDashboard.setPanelLoading === "function"
      ) {
        window.OzarkDashboard.setPanelLoading("ticketDetailPanel", false);
      }
    } catch {}
    panel.innerHTML = `<div class="empty">${escapeHtml(t("tickets_detail_empty"))}</div>`;
  }

  function selectTicketByIndex(index) {
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0) return;
    const items = Array.isArray(state.ticketsItems) ? state.ticketsItems : [];
    const it = items[idx];
    if (!it) return;

    state.activeTicketIndex = idx;
    const panel = document.getElementById("ticketDetailPanel");
    if (panel) {
      try {
        if (
          window.OzarkDashboard &&
          typeof window.OzarkDashboard.setPanelLoading === "function"
        ) {
          window.OzarkDashboard.setPanelLoading("ticketDetailPanel", true);
        }
      } catch {}
      panel.innerHTML = renderDetailSkeleton();
    }

    if (_detailTimeout) clearTimeout(_detailTimeout);
    _detailTimeout = setTimeout(() => {
      const curItems = Array.isArray(state.ticketsItems)
        ? state.ticketsItems
        : [];
      const cur = curItems[idx];
      if (!cur) return;
      renderDetail(cur);
      _detailTimeout = null;
    }, 350);
  }

  function renderDetail(ticket) {
    const panel = document.getElementById("ticketDetailPanel");
    if (!panel) return;

    const username = ticket.username || ticket.userId || "";
    const status =
      ticket.status === "closed"
        ? t("tickets_status_closed")
        : t("tickets_status_open");
    const created = fmtDate(ticket.createdAt);
    const closedAt = fmtDate(ticket.closedAt);
    const dueAt = ticket.slaDueAt ? new Date(ticket.slaDueAt) : null;
    const overdue =
      ticket.status !== "closed" &&
      dueAt &&
      !Number.isNaN(dueAt.getTime()) &&
      dueAt.getTime() < Date.now();
    const slaLabel =
      dueAt && !Number.isNaN(dueAt.getTime())
        ? overdue
          ? t("tickets_sla_overdue")
          : t("tickets_sla_due", { date: fmtDate(dueAt) })
        : t("tickets_sla_none");
    const priorityValue = ["low", "normal", "high", "urgent"].includes(
      ticket.priority,
    )
      ? ticket.priority
      : "normal";
    const slaHours = [0, 4, 8, 24, 48, 72].includes(Number(ticket.slaHours))
      ? Number(ticket.slaHours)
      : 0;
    const priorityOptions = [
      { value: "low", label: t("tickets_priority_low") },
      { value: "normal", label: t("tickets_priority_normal") },
      { value: "high", label: t("tickets_priority_high") },
      { value: "urgent", label: t("tickets_priority_urgent") },
    ];

    const canClose = ticket.status !== "closed";
    const canReopen = ticket.status === "closed";

    // Detail header should be readable and not repeat what the list already shows.
    // We show the generic title + status and compact meta badges.
    panel.innerHTML = `
      <div class="ticket-detail-header">
        <div class="user-row-header">
          <div class="title">${escapeHtml(t("tickets_detail_title"))}</div>
          <div class="user-type-badge ${ticket.status === "closed" ? "bot" : "human"}">${escapeHtml(status)}</div>
        </div>
        <div class="ticket-detail-meta">
          <div class="badge">${escapeHtml(t("tickets_detail_user"))}: ${escapeHtml(username)}</div>
          <div class="badge">${escapeHtml(t("tickets_detail_created"))}: ${escapeHtml(created || "-")}</div>
          <div class="badge">${escapeHtml(t("tickets_assignment"))}: ${escapeHtml(ticket.assignedToName || ticket.assignedToId || t("tickets_unassigned"))}</div>
          <div class="badge ${overdue ? "ticket-sla-overdue" : ""}">${escapeHtml(slaLabel)}</div>
          ${closedAt ? `<div class="badge">${escapeHtml(t("tickets_detail_closed"))}: ${escapeHtml(closedAt)}</div>` : ""}
        </div>
      </div>

      <form class="ticket-management-form" id="ticketManagementForm">
        <label class="field">
          <span>${escapeHtml(t("tickets_assignee_id"))}</span>
          <input class="input" id="ticketAssigneeId" type="text" inputmode="numeric" pattern="[0-9]{10,32}" maxlength="32" value="${escapeHtml(ticket.assignedToId || "")}" placeholder="${escapeHtml(t("tickets_assignee_placeholder"))}" />
        </label>
        <label class="field">
          <span>${escapeHtml(t("tickets_priority"))}</span>
          <select class="select" id="ticketPriority">
            ${priorityOptions.map(({ value, label }) => `<option value="${value}"${value === priorityValue ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>${escapeHtml(t("tickets_sla"))}</span>
          <select class="select" id="ticketSlaHours">
            ${[0, 4, 8, 24, 48, 72].map((hours) => `<option value="${hours}"${hours === slaHours ? " selected" : ""}>${escapeHtml(hours ? t("tickets_sla_hours", { hours }) : t("tickets_sla_none"))}</option>`).join("")}
          </select>
        </label>
        <div class="ticket-management-form__actions">
          <button class="btn xs" type="submit">${escapeHtml(t("tickets_save_management"))}</button>
          <span class="hint" id="ticketManagementStatus" role="status" aria-live="polite"></span>
        </div>
      </form>

      <div class="history-section user-actions">
        <h3>${escapeHtml(t("tickets_detail_actions"))}</h3>
        <div class="ticket-actions">
          <textarea id="ticketReplyContent" class="input ticket-reply" placeholder="${escapeHtml(t("tickets_reply_placeholder"))}"></textarea>
          <div class="ticket-actions-row">
            <button type="button" class="btn xs" id="btnTicketSendReply">${escapeHtml(t("tickets_action_reply"))}</button>
            ${canClose ? `<button type="button" class="btn xs" id="btnTicketClose">${escapeHtml(t("tickets_action_close"))}</button>` : ""}
            ${canReopen ? `<button type="button" class="btn xs" id="btnTicketReopen">${escapeHtml(t("tickets_action_reopen"))}</button>` : ""}
            <button type="button" class="btn xs" id="btnTicketRefresh">${escapeHtml(t("reload"))}</button>
          </div>
        </div>
      </div>

      <details class="ticket-section" open>
        <summary class="details-summary">${escapeHtml(t("tickets_detail_messages"))}</summary>
        <div id="ticketsMessagesBox" class="ticket-messages">
          <div class="empty">${escapeHtml(t("loading"))}</div>
        </div>
      </details>

      <details class="ticket-section">
        <summary class="details-summary">${escapeHtml(t("tickets_detail_audit"))}</summary>
        <div id="ticketsAuditBox" class="ticket-audit">
          <div class="empty">${escapeHtml(t("loading"))}</div>
        </div>
      </details>
    `;

    try {
      if (
        window.OzarkDashboard &&
        typeof window.OzarkDashboard.setPanelLoading === "function"
      ) {
        window.OzarkDashboard.setPanelLoading("ticketDetailPanel", false);
      }
    } catch {}

    const guildId = getGuildId();
    const ticketId = ticket._id;

    const managementForm = panel.querySelector("#ticketManagementForm");
    if (managementForm) {
      managementForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = managementForm.querySelector('button[type="submit"]');
        const status = panel.querySelector("#ticketManagementStatus");
        if (submit) submit.disabled = true;
        if (status) status.textContent = t("premium_admin_saving");
        try {
          const result = await apiPost(
            `/tickets/${encodeURIComponent(ticketId)}/manage`,
            {
              guildId,
              assignedToId: panel
                .querySelector("#ticketAssigneeId")
                .value.trim(),
              priority: panel.querySelector("#ticketPriority").value,
              slaHours: Number(panel.querySelector("#ticketSlaHours").value),
            },
          );
          if (!result || result.ok === false || !result.ticket)
            throw new Error((result && result.error) || "TICKET_UPDATE_FAILED");

          Object.assign(ticket, result.ticket);
          const items = Array.isArray(state.ticketsItems)
            ? state.ticketsItems
            : [];
          const index = items.findIndex(
            (item) => String(item._id) === String(ticketId),
          );
          if (index >= 0) {
            items[index] = ticket;
            renderList(items);
            setListActive(index);
          }
          toast(t("tickets_management_saved"), { type: "success" });
          renderDetail(ticket);
        } catch (error) {
          console.error("Ticket metadata update error", error);
          if (status)
            status.textContent =
              error?.apiMessage || t("tickets_management_error");
        } finally {
          if (submit && submit.isConnected) submit.disabled = false;
        }
      });
    }

    async function loadAndRenderMessages() {
      const box = panel.querySelector("#ticketsMessagesBox");
      if (!box) return;
      box.innerHTML = `<div class="empty">${escapeHtml(t("loading"))}</div>`;
      try {
        const res = await apiGet(
          `/tickets/${encodeURIComponent(ticketId)}/messages?guildId=${encodeURIComponent(guildId)}&limit=25`,
        );
        const items = res && Array.isArray(res.items) ? res.items : [];
        const visible = items.filter((m) => {
          const c = String(m?.content || "").trim();
          if (!c) return false;
          // Backend already filters; keep defensive.
          if (!m?.isBot) return true;
          return !!m?.isStaffReply;
        });
        if (!visible.length) {
          box.innerHTML = `<div class="empty">${escapeHtml(t("tickets_messages_empty"))}</div>`;
          return;
        }
        box.innerHTML = visible
          .map((m) => {
            const who = m.isStaffReply
              ? t("tickets_staff_label") || "Equipa"
              : m.authorUsername || m.authorId || "";
            const when = m.createdAt ? fmtDate(m.createdAt) : "";
            const content = (m.content || "").toString();
            return `
            <div class="ticket-msg">
              <div class="ticket-msg-meta">
                 <strong>${escapeHtml(who)}</strong>${m.isStaffReply ? ' <span class="ticket-msg-badge">' + escapeHtml(t("tickets_staff_badge") || "Dashboard") + "</span>" : ""}${when ? " • " + escapeHtml(when) : ""}
              </div>
              <div class="ticket-msg-body">${escapeHtml(content)}</div>
            </div>
          `;
          })
          .join("");
      } catch {
        box.innerHTML = `<div class="empty">${escapeHtml(t("tickets_messages_error"))}</div>`;
      }
    }

    // initial load
    loadAndRenderMessages();

    async function loadAndRenderAudit() {
      const box = panel.querySelector("#ticketsAuditBox");
      if (!box) return;
      box.innerHTML = `<div class="empty">${escapeHtml(t("loading"))}</div>`;
      try {
        const res = await apiGet(
          `/tickets/${encodeURIComponent(ticketId)}/audit?guildId=${encodeURIComponent(guildId)}`,
        );
        const items = res && Array.isArray(res.items) ? res.items : [];
        if (!items.length) {
          box.innerHTML = `<div class="empty">${escapeHtml(t("tickets_audit_empty"))}</div>`;
          return;
        }
        box.innerHTML = items
          .map((ev) => {
            const when = ev.createdAt ? fmtDate(ev.createdAt) : "";
            const who = ev.actorUsername || ev.actorId || "";
            const raw = ev.action || "";
            const what =
              raw === "opened"
                ? t("tickets_audit_opened") || "Aberto"
                : raw === "closed"
                  ? t("tickets_audit_closed") || "Fechado"
                  : raw;
            return `<div class="ticket-audit-row"><span class="ticket-audit-what">${escapeHtml(what)}</span>${who ? " • " + escapeHtml(who) : ""}${when ? " • " + escapeHtml(when) : ""}</div>`;
          })
          .join("");
      } catch {
        box.innerHTML = `<div class="empty">${escapeHtml(t("tickets_audit_error"))}</div>`;
      }
    }

    loadAndRenderAudit();

    const btnSend = panel.querySelector("#btnTicketSendReply");
    if (btnSend) {
      btnSend.addEventListener("click", async () => {
        const ta = panel.querySelector("#ticketReplyContent");
        const content = (ta && ta.value ? ta.value : "").trim();
        if (!content) {
          toast(t("tickets_reply_empty"), { type: "warn" });
          return;
        }
        if (content.length > MAX_REPLY_LEN) {
          toast(t("tickets_reply_too_long", { max: MAX_REPLY_LEN }), {
            type: "warn",
          });
          return;
        }
        try {
          btnSend.disabled = true;
          const res = await apiPost(
            `/tickets/${encodeURIComponent(ticketId)}/reply`,
            { guildId, content },
          );
          if (res && res.ok) {
            if (ta) ta.value = "";
            toast(t("tickets_reply_sent"), { type: "success" });
            // Refresh only the message panel (avoid reloading list -> avoids rate-limit + preserves UX)
            await loadAndRenderMessages();
            await loadAndRenderAudit();
          } else {
            toast(t("tickets_error_generic"), { type: "error" });
          }
        } catch (e) {
          toast((e && e.apiMessage) || t("tickets_error_generic"), {
            type: "error",
          });
        } finally {
          btnSend.disabled = false;
        }
      });
    }

    const btnClose = panel.querySelector("#btnTicketClose");
    if (btnClose) {
      btnClose.addEventListener("click", async () => {
        if (
          typeof window.confirm === "function" &&
          !window.confirm(t("tickets_close_confirm"))
        )
          return;
        try {
          btnClose.disabled = true;
          const res = await apiPost(
            `/tickets/${encodeURIComponent(ticketId)}/close`,
            { guildId },
          );
          if (res && res.ok) {
            toast(t("tickets_closed"), { type: "success" });
            await loadTickets(true);
            await loadAndRenderAudit();
          } else {
            toast(t("tickets_error_generic"), { type: "error" });
          }
        } catch (e) {
          toast((e && e.apiMessage) || t("tickets_error_generic"), {
            type: "error",
          });
        } finally {
          btnClose.disabled = false;
        }
      });
    }

    const btnReopen = panel.querySelector("#btnTicketReopen");
    if (btnReopen) {
      btnReopen.addEventListener("click", async () => {
        try {
          btnReopen.disabled = true;
          const res = await apiPost(
            `/tickets/${encodeURIComponent(ticketId)}/reopen`,
            { guildId },
          );
          if (res && res.ok) {
            toast(t("tickets_reopened"), { type: "success" });
            await loadTickets(true);
            await loadAndRenderAudit();
          } else {
            toast(t("tickets_error_generic"), { type: "error" });
          }
        } catch (e) {
          toast((e && e.apiMessage) || t("tickets_error_generic"), {
            type: "error",
          });
        } finally {
          btnReopen.disabled = false;
        }
      });
    }

    const btnRefresh = panel.querySelector("#btnTicketRefresh");
    if (btnRefresh)
      btnRefresh.addEventListener("click", () => loadAndRenderMessages());
  }

  function getSearchQuery() {
    const el = document.getElementById("ticketsSearch");
    return el ? String(el.value || "").trim() : "";
  }

  function setLoadMoreVisible(v) {
    const btn = document.getElementById("btnTicketsLoadMore");
    if (!btn) return;
    btn.classList.toggle("hidden", !v);
  }

  async function loadTickets(reset) {
    const listEl = document.getElementById("ticketsList");
    if (!listEl) return;

    if (_loading && !reset) return;
    const requestSequence = ++_ticketsRequestSequence;
    const requestedGuildId = getGuildId();
    _loading = true;

    try {
      await waitForI18nReady();
      const guildId = requestedGuildId;
      if (!guildId) {
        renderList([]);
        renderDetailEmpty();
        return;
      }

      const filterEl = document.getElementById("ticketsStatusFilter");
      const status = filterEl ? filterEl.value || "open" : "open";
      const q = getSearchQuery();

      if (reset) {
        listEl.innerHTML = `<div class="empty">${escapeHtml(t("tickets_loading"))}</div>`;
        renderDetailEmpty();
        state.ticketsItems = [];
        state.activeTicketIndex = null;
        state.ticketsNextCursor = null;
      }

      const cursor = state.ticketsNextCursor
        ? `&cursor=${encodeURIComponent(state.ticketsNextCursor)}`
        : "";
      const qParam = q ? `&q=${encodeURIComponent(q)}` : "";
      const res = await apiGet(
        `/tickets?guildId=${encodeURIComponent(guildId)}&status=${encodeURIComponent(status)}&limit=30${cursor}${qParam}`,
      );
      if (
        requestSequence !== _ticketsRequestSequence ||
        guildId !== getGuildId()
      ) {
        return;
      }
      const page = res && Array.isArray(res.items) ? res.items : [];

      const merged = reset
        ? page
        : Array.isArray(state.ticketsItems)
          ? state.ticketsItems.concat(page)
          : page;
      state.ticketsItems = merged;
      state.ticketsNextCursor =
        res && res.nextCursor ? String(res.nextCursor) : null;

      renderList(merged);
      // Detail panel should only show after user clicks a ticket.
      if (!merged.length) renderDetailEmpty();
      setLoadMoreVisible(!!state.ticketsNextCursor);
    } catch (e) {
      if (requestSequence !== _ticketsRequestSequence) return;
      console.error("loadTickets error", e);
      const listEl2 = document.getElementById("ticketsList");
      if (listEl2)
        listEl2.innerHTML = `<div class="empty">${escapeHtml(t("tickets_error_generic"))}</div>`;
      renderDetailEmpty();
    } finally {
      if (requestSequence === _ticketsRequestSequence) _loading = false;
    }
  }

  function initTicketsUI() {
    const reloadBtn = document.getElementById("btnReloadTickets");
    if (reloadBtn) reloadBtn.addEventListener("click", () => loadTickets(true));

    const filterEl = document.getElementById("ticketsStatusFilter");
    if (filterEl) filterEl.addEventListener("change", () => loadTickets(true));

    const searchEl = document.getElementById("ticketsSearch");
    if (searchEl) {
      let _t = null;
      const trigger = () => {
        if (_t) clearTimeout(_t);
        _t = setTimeout(() => loadTickets(true), 250);
      };
      searchEl.addEventListener("input", trigger);
      searchEl.addEventListener("change", trigger);
    }

    const btnMore = document.getElementById("btnTicketsLoadMore");
    if (btnMore) btnMore.addEventListener("click", () => loadTickets(false));
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTicketsUI();
  });

  // Expose
  D.loadTickets = loadTickets;
})();
