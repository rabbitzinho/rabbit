// src/dashboard/routes/premium.js
//
// Premium por servidor: leitura do estado, ativação manual pelo administrador
// do bot e o guard usado pelos módulos premium
// (gamenews, voz temporária, tickets, trust, giveaways).

const { normalizePremium, PREMIUM_MODULES } = require("../../systems/premium");
const { invalidateGuildConfig } = require("../../systems/guildConfigService");
const { createPayPalService } = require("../paypalService");
const { formatUserTag } = require("../../services/guildService");
const { isGlobalBotOwner } = require("../botRoles");

const PREMIUM_FIXED_AMOUNT = "10.00";
const PREMIUM_FIXED_CURRENCY = "EUR";

function parseDate(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getDashboardOrigin(req, config) {
  const configured = String(process.env.DASHBOARD_ORIGIN || "")
    .split(",")[0]
    .trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:")
        return url.origin;
    } catch {}
  }
  if (process.env.NODE_ENV !== "production" && req && req.get) {
    const host = req.get("host");
    if (host) return `${req.protocol}://${host}`;
  }
  if (
    process.env.NODE_ENV !== "production" &&
    config &&
    config.dashboard &&
    Array.isArray(config.dashboard.allowedOrigins)
  ) {
    try {
      const url = new URL(String(config.dashboard.allowedOrigins[0] || ""));
      if (url.protocol === "https:" || url.protocol === "http:")
        return url.origin;
    } catch {}
  }
  return null;
}

function getCaptureDetails(payload) {
  if (payload && payload.resource) {
    const resource = payload.resource;
    return {
      orderId: resource.supplementary_data?.related_ids?.order_id || null,
      captureId: resource.id || null,
      status: resource.status || null,
      amount: resource.amount?.value || null,
      currency: resource.amount?.currency_code || null,
      purchaserDiscordUserId: resource.custom_id || null,
      guildId: null,
      payerId: resource.payer?.payer_id || null,
      payerEmail: resource.payer?.email_address || null,
    };
  }

  const unit = Array.isArray(payload && payload.purchase_units)
    ? payload.purchase_units[0]
    : null;
  const capture =
    unit && unit.payments && Array.isArray(unit.payments.captures)
      ? unit.payments.captures[0]
      : null;
  return {
    orderId: payload && payload.id ? String(payload.id) : null,
    captureId: capture && capture.id ? String(capture.id) : null,
    status:
      capture && capture.status ? capture.status : payload && payload.status,
    amount: capture && capture.amount ? capture.amount.value : null,
    currency: capture && capture.amount ? capture.amount.currency_code : null,
    purchaserDiscordUserId:
      unit && unit.custom_id ? String(unit.custom_id) : null,
    guildId: unit && unit.reference_id ? String(unit.reference_id) : null,
    payerId: payload && payload.payer ? payload.payer.payer_id || null : null,
    payerEmail:
      payload && payload.payer ? payload.payer.email_address || null : null,
  };
}

function sameAmount(left, right) {
  const toCents = (value) => {
    const text = String(value || "");
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    return Math.round(Number(text) * 100);
  };
  const a = toCents(left);
  const b = toCents(right);
  return a !== null && b !== null && a === b;
}

function getFixedPayPalMeLink(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname !== "paypal.me") return null;
    const username = url.pathname.split("/").filter(Boolean)[0];
    if (!username || !/^[A-Za-z0-9._-]+$/.test(username)) return null;
    url.pathname = "/" + username + "/10EUR";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isPayPalLink(value) {
  return Boolean(getFixedPayPalMeLink(value));
}

/**
 * Guard reutilizável para módulos cujo acesso pertence ao servidor.
 */
function createPremiumGuard({ GuildConfig, sanitizeId }) {
  return function requirePremium({ from = "body", key = "guildId" } = {}) {
    return async (req, res, next) => {
      let raw = "";
      try {
        if (from === "query") raw = (req.query && req.query[key]) || "";
        else if (from === "params") raw = (req.params && req.params[key]) || "";
        else raw = (req.body && req.body[key]) || "";
      } catch {
        raw = "";
      }

      const guildId =
        typeof sanitizeId === "function"
          ? sanitizeId(String(raw || ""))
          : String(raw || "");
      if (!guildId)
        return res.status(400).json({ ok: false, error: "GUILD_ID_REQUIRED" });

      try {
        if (GuildConfig) {
          const cfg = await GuildConfig.findOne({ guildId })
            .select("premium")
            .lean();
          const guildPremium = cfg && cfg.premium;
          if (
            !(guildPremium && guildPremium.testBypass) &&
            normalizePremium(guildPremium).active
          )
            return next();
        }
      } catch (err) {
        console.warn("[Premium] verificação falhou:", err?.message || err);
        return res
          .status(500)
          .json({ ok: false, error: "PREMIUM_CHECK_FAILED" });
      }

      return res.status(402).json({ ok: false, error: "PREMIUM_REQUIRED" });
    };
  };
}

function registerPremiumRoutes({
  app,
  requireDashboardAuth,
  requirePerm,
  requireGuildAccess,
  sanitizeId,
  GuildConfig,
  PremiumPayment,
  PremiumSettings,
  getClient,
  config,
  rateLimit,
  paypal = createPayPalService(),
}) {
  const guardGuildQuery =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId" })
      : (req, res, next) => next();

  const guardGuildBody =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "body", key: "guildId" })
      : (req, res, next) => next();

  const canViewConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canViewConfig", "canEditConfig"] })
      : (req, res, next) => next();

  const canEditConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canEditConfig"] })
      : (req, res, next) => next();

  const canCheckout = canEditConfig;
  const checkoutRateLimit =
    typeof rateLimit === "function"
      ? rateLimit({
          windowMs: 60_000,
          max: 5,
          keyPrefix: "rl:premium:checkout:",
        })
      : (req, res, next) => next();

  function requireBotOwner(req, res, next) {
    if (!isGlobalBotOwner(req.dashboardUser)) {
      return res.status(403).json({ ok: false, error: "BOT_OWNER_REQUIRED" });
    }
    return next();
  }

  async function getPlan() {
    const envPlan = paypal.getPlan();
    if (!PremiumSettings)
      return Object.assign({}, envPlan, {
        amount: PREMIUM_FIXED_AMOUNT,
        currency: PREMIUM_FIXED_CURRENCY,
        paymentLink: null,
      });
    const settings = await PremiumSettings.findById("global")
      .lean()
      .catch(() => null);
    if (!settings)
      return Object.assign({}, envPlan, {
        amount: PREMIUM_FIXED_AMOUNT,
        currency: PREMIUM_FIXED_CURRENCY,
        paymentLink: null,
      });
    const plan = paypal.normalizePlan({
      amount: PREMIUM_FIXED_AMOUNT,
      currency: PREMIUM_FIXED_CURRENCY,
      durationDays: settings.durationDays,
    });
    return Object.assign({}, plan || envPlan, {
      amount: PREMIUM_FIXED_AMOUNT,
      currency: PREMIUM_FIXED_CURRENCY,
      paymentLink: getFixedPayPalMeLink(settings.paymentLink),
    });
  }

  function getCachedGuildDetails(guildId) {
    const client = typeof getClient === "function" ? getClient() : null;
    const guild =
      client && client.guilds && client.guilds.cache
        ? client.guilds.cache.get(String(guildId)) || null
        : null;
    if (!guild) return { guildName: null, ownerId: null, ownerName: null };
    const ownerId = String(guild.ownerId || "");
    const owner =
      ownerId && guild.members && guild.members.cache
        ? guild.members.cache.get(ownerId) || null
        : null;
    const ownerUser =
      (owner && owner.user) ||
      (client &&
        client.users &&
        client.users.cache &&
        client.users.cache.get(ownerId));
    return {
      guildName: typeof guild.name === "string" ? guild.name : null,
      ownerId: ownerId || null,
      ownerName:
        (ownerUser && (ownerUser.globalName || formatUserTag(ownerUser))) ||
        null,
    };
  }

  async function getGuildDetails(guildId) {
    const client = typeof getClient === "function" ? getClient() : null;
    let guild =
      client && client.guilds && client.guilds.cache
        ? client.guilds.cache.get(String(guildId)) || null
        : null;
    if (
      !guild &&
      client &&
      client.guilds &&
      typeof client.guilds.fetch === "function"
    ) {
      try {
        guild = await client.guilds.fetch(String(guildId));
      } catch (err) {
        console.warn(
          "[Premium] Could not fetch Discord server details:",
          guildId,
          err?.message || err,
        );
      }
    }
    if (!guild) return { guildName: null, ownerId: null, ownerName: null };

    const ownerId = String(guild.ownerId || "");
    let owner =
      ownerId && guild.members && guild.members.cache
        ? guild.members.cache.get(ownerId) || null
        : null;
    if (
      !owner &&
      ownerId &&
      guild.members &&
      typeof guild.members.fetch === "function"
    ) {
      try {
        owner = await guild.members.fetch(ownerId);
      } catch (err) {
        console.warn(
          "[Premium] Could not fetch Discord server owner:",
          guildId,
          ownerId,
          err?.message || err,
        );
      }
    }
    const ownerUser = owner && owner.user;
    return {
      guildName: typeof guild.name === "string" ? guild.name : null,
      ownerId: ownerId || null,
      ownerName:
        (ownerUser && (ownerUser.globalName || formatUserTag(ownerUser))) ||
        null,
    };
  }

  app.get(
    "/api/premium/admin/settings",
    requireDashboardAuth,
    requireBotOwner,
    async (req, res) => {
      try {
        const settings = await getPlan();
        return res.json({ ok: true, settings });
      } catch (err) {
        console.error(
          "[Dashboard] Premium settings read error:",
          err?.message || err,
        );
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  app.patch(
    "/api/premium/admin/settings",
    requireDashboardAuth,
    requireBotOwner,
    async (req, res) => {
      try {
        if (!PremiumSettings)
          return res
            .status(503)
            .json({ ok: false, error: "PREMIUM_SETTINGS_MODEL_MISSING" });
        const body = req.body || {};
        const plan = paypal.normalizePlan({
          amount: PREMIUM_FIXED_AMOUNT,
          currency: PREMIUM_FIXED_CURRENCY,
          durationDays: body.durationDays,
        });
        const paymentLink = String(body.paymentLink || "").trim();
        if (!plan)
          return res
            .status(400)
            .json({ ok: false, error: "PREMIUM_SETTINGS_INVALID" });
        if (paymentLink && !getFixedPayPalMeLink(paymentLink)) {
          return res
            .status(400)
            .json({ ok: false, error: "PREMIUM_PAYMENT_LINK_INVALID" });
        }

        const settings = await PremiumSettings.findOneAndUpdate(
          { _id: "global" },
          {
            $set: Object.assign({}, plan, {
              paymentLink: getFixedPayPalMeLink(paymentLink),
              updatedBy: String(req.dashboardUser._id || ""),
            }),
          },
          { upsert: true, returnDocument: "after" },
        ).lean();
        return res.json({ ok: true, settings });
      } catch (err) {
        console.error(
          "[Dashboard] Premium settings update error:",
          err?.message || err,
        );
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  app.get(
    "/api/premium/admin/guilds",
    requireDashboardAuth,
    requireBotOwner,
    async (req, res) => {
      try {
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });
        const guildConfigs = await GuildConfig.find({})
          .sort({ updatedAt: -1 })
          .limit(500)
          .lean();
        const guildIds = guildConfigs.map((item) => item.guildId);
        const payments =
          PremiumPayment && guildIds.length
            ? await PremiumPayment.find({
                guildId: { $in: guildIds },
                status: "COMPLETED",
              })
                .sort({ completedAt: -1 })
                .lean()
            : [];
        const latestByGuild = new Map();
        payments.forEach((payment) => {
          if (!latestByGuild.has(payment.guildId))
            latestByGuild.set(payment.guildId, payment);
        });
        const query = String(req.query.q || "")
          .trim()
          .toLowerCase();
        const items = guildConfigs
          .map((item) => {
            const license = normalizePremium(item.premium);
            if (item.premium && item.premium.testBypass) {
              license.enabled = false;
              license.active = false;
            }
            const latestPayment = latestByGuild.get(item.guildId) || null;
            const details = getCachedGuildDetails(item.guildId);
            return {
              guildId: item.guildId,
              guildName: details.guildName,
              ownerId: details.ownerId,
              ownerName: details.ownerName,
              enabled: license.enabled,
              active: license.active,
              until: license.until,
              note: license.note,
              activatedAt: license.activatedAt,
              purchasedByUserId:
                (item.premium && item.premium.purchasedByUserId) ||
                (latestPayment &&
                  (latestPayment.purchaserDiscordUserId ||
                    latestPayment.discordUserId)) ||
                null,
              purchaserName:
                (latestPayment &&
                  (latestPayment.purchaserDiscordUsername ||
                    latestPayment.discordUsername)) ||
                null,
              updatedAt: item.updatedAt,
              latestPayment: latestPayment
                ? {
                    amount: latestPayment.amount,
                    currency: latestPayment.currency,
                    completedAt: latestPayment.completedAt,
                    purchaserDiscordUserId:
                      latestPayment.purchaserDiscordUserId ||
                      latestPayment.discordUserId,
                    purchaserDiscordUsername:
                      latestPayment.purchaserDiscordUsername ||
                      latestPayment.discordUsername,
                    paypalPayerEmail: latestPayment.paypalPayerEmail,
                    paypalCaptureId: latestPayment.paypalCaptureId,
                    approvalUrl: latestPayment.approvalUrl,
                  }
                : null,
            };
          })
          .filter(
            (item) =>
              !query ||
              [
                item.guildId,
                item.guildName,
                item.ownerId,
                item.ownerName,
                item.purchasedByUserId,
                item.purchaserName,
                item.note,
                item.latestPayment && item.latestPayment.paypalPayerEmail,
              ].some((value) =>
                String(value || "")
                  .toLowerCase()
                  .includes(query),
              ),
          );
        return res.json({ ok: true, items });
      } catch (err) {
        console.error(
          "[Dashboard] Premium guilds read error:",
          err?.message || err,
        );
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  app.patch(
    "/api/premium/admin/guilds/:guildId",
    requireDashboardAuth,
    requireBotOwner,
    async (req, res) => {
      try {
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });
        const guildId = sanitizeId(req.params.guildId || "");
        if (!guildId)
          return res.status(400).json({ ok: false, error: "GUILD_ID_INVALID" });
        const body = req.body || {};
        if (typeof body.enabled !== "boolean")
          return res
            .status(400)
            .json({ ok: false, error: "PREMIUM_ENABLED_REQUIRED" });
        const until = body.until ? parseDate(body.until) : null;
        if (body.until && !until)
          return res
            .status(400)
            .json({ ok: false, error: "PREMIUM_DATE_INVALID" });
        const note =
          String(body.note || "")
            .trim()
            .slice(0, 200) || null;
        const update = {
          "premium.enabled": body.enabled,
          "premium.until": until,
          "premium.note": note,
          "premium.testBypass": false,
        };
        if (body.enabled) update["premium.activatedAt"] = new Date();
        const premium = await GuildConfig.findOneAndUpdate(
          { guildId },
          {
            $set: update,
            $unset: { "premium.accountUserId": "" },
          },
          { upsert: true, returnDocument: "after", projection: { premium: 1 } },
        ).lean();
        invalidateGuildConfig(guildId);
        return res.json({
          ok: true,
          guildId,
          premium: normalizePremium(premium && premium.premium),
        });
      } catch (err) {
        console.error(
          "[Dashboard] Premium guild update error:",
          err?.message || err,
        );
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  function redirectPayment(req, res, status, guildId) {
    const origin = getDashboardOrigin(req, config);
    if (!origin)
      return res.status(503).send("Dashboard origin is not configured.");
    const url = new URL("/", origin);
    url.searchParams.set("premiumPayment", status);
    if (guildId) url.searchParams.set("guildId", String(guildId));
    return res.redirect(url.toString());
  }

  async function completePayment(payment, payload) {
    const capture = getCaptureDetails(payload);
    if (
      !capture.orderId ||
      capture.orderId !== payment.paypalOrderId ||
      capture.status !== "COMPLETED" ||
      !capture.captureId ||
      capture.purchaserDiscordUserId !==
        (payment.purchaserDiscordUserId || payment.discordUserId) ||
      !sameAmount(capture.amount, payment.amount) ||
      String(capture.currency || "").toUpperCase() !== payment.currency ||
      (capture.guildId && capture.guildId !== payment.guildId)
    ) {
      await PremiumPayment.updateOne(
        { _id: payment._id, status: { $in: ["PENDING", "PROCESSING"] } },
        { $set: { status: "FAILED" } },
      );
      return false;
    }

    const claimed = await PremiumPayment.findOneAndUpdate(
      { _id: payment._id, status: "PENDING" },
      { $set: { status: "PROCESSING" } },
      { new: true },
    ).lean();
    if (!claimed) {
      const current = await PremiumPayment.findById(payment._id).lean();
      return Boolean(current && current.status === "COMPLETED");
    }

    try {
      if (!GuildConfig) throw new Error("GUILD_CONFIG_MODEL_MISSING");
      const currentConfig = await GuildConfig.findOne({
        guildId: payment.guildId,
      })
        .select("premium")
        .lean();
      const currentPremium = normalizePremium(
        currentConfig && currentConfig.premium,
      );
      const now = new Date();
      const startsAt =
        currentPremium.active &&
        currentPremium.until &&
        currentPremium.until > now
          ? currentPremium.until
          : now;
      const expiresAt = new Date(
        startsAt.getTime() + payment.durationDays * 24 * 60 * 60 * 1000,
      );

      await GuildConfig.findOneAndUpdate(
        { guildId: payment.guildId },
        {
          $set: {
            "premium.enabled": true,
            "premium.until": expiresAt,
            "premium.note": "PayPal",
            "premium.activatedAt": currentPremium.activatedAt || now,
            "premium.purchasedByUserId":
              payment.purchaserDiscordUserId || payment.discordUserId,
            "premium.accountUserId": null,
            "premium.testBypass": false,
          },
        },
        { returnDocument: "after", upsert: true },
      ).lean();
      invalidateGuildConfig(payment.guildId);

      await PremiumPayment.updateOne(
        { _id: payment._id, status: "PROCESSING" },
        {
          $set: {
            status: "COMPLETED",
            paypalCaptureId: capture.captureId,
            paypalPayerId: capture.payerId,
            paypalPayerEmail: capture.payerEmail,
            startsAt,
            expiresAt,
            completedAt: now,
          },
        },
      );
      return true;
    } catch (err) {
      await PremiumPayment.updateOne(
        { _id: payment._id, status: "PROCESSING" },
        { $set: { status: "PENDING" } },
      ).catch(() => null);
      throw err;
    }
  }

  app.post(
    "/api/premium/checkout",
    requireDashboardAuth,
    canCheckout,
    guardGuildBody,
    checkoutRateLimit,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.body && req.body.guildId);
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "GUILD_ID_REQUIRED" });
        if (!PremiumPayment)
          return res
            .status(503)
            .json({ ok: false, error: "PREMIUM_PAYMENT_MODEL_MISSING" });
        const plan = await getPlan();
        if (!paypal.isConfigured(plan))
          return res
            .status(503)
            .json({ ok: false, error: "PAYPAL_NOT_CONFIGURED" });

        const origin = getDashboardOrigin(req, config);
        if (!origin)
          return res
            .status(503)
            .json({ ok: false, error: "DASHBOARD_ORIGIN_NOT_CONFIGURED" });
        const user = req.dashboardUser || {};
        const userId = String(user._id || "");
        if (!/^\d{10,32}$/.test(userId))
          return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });
        const currentConfig = await GuildConfig.findOne({ guildId })
          .select("premium")
          .lean();
        const currentPremium = normalizePremium(
          currentConfig && currentConfig.premium,
        );
        if (currentPremium.active && !currentPremium.until) {
          return res
            .status(409)
            .json({ ok: false, error: "PREMIUM_ALREADY_PERMANENT" });
        }

        const order = await paypal.createOrder({
          guildId,
          purchaserDiscordUserId: userId,
          returnUrl: `${origin}/api/premium/paypal/return`,
          cancelUrl: `${origin}/api/premium/paypal/cancel`,
          plan,
        });
        await PremiumPayment.create({
          paypalOrderId: order.id,
          approvalUrl: order.approvalUrl,
          guildId,
          purchaserDiscordUserId: userId,
          purchaserDiscordUsername: String(user.username || "Discord").slice(
            0,
            80,
          ),
          amount: order.plan.amount,
          currency: order.plan.currency,
          durationDays: order.plan.durationDays,
          status: "PENDING",
        });

        return res.json({
          ok: true,
          approvalUrl: order.approvalUrl,
          amount: order.plan.amount,
          currency: order.plan.currency,
          durationDays: order.plan.durationDays,
        });
      } catch (err) {
        console.error(
          "[Dashboard] Premium checkout error:",
          err?.message || err,
        );
        return res
          .status(502)
          .json({ ok: false, error: "PAYPAL_CHECKOUT_FAILED" });
      }
    },
  );

  app.get("/api/premium/paypal/return", async (req, res) => {
    let payment = null;
    try {
      const orderId = String(req.query.token || "");
      if (!/^[A-Za-z0-9-]{6,64}$/.test(orderId) || !PremiumPayment) {
        return redirectPayment(req, res, "error");
      }
      payment = await PremiumPayment.findOne({ paypalOrderId: orderId }).lean();
      if (!payment) return redirectPayment(req, res, "error");
      if (payment.status === "COMPLETED")
        return redirectPayment(req, res, "success", payment.guildId);

      const capture = await paypal.captureOrder(orderId);
      const completed = await completePayment(payment, capture);
      return redirectPayment(
        req,
        res,
        completed ? "success" : "error",
        payment.guildId,
      );
    } catch (err) {
      console.error("[Dashboard] PayPal return error:", err?.message || err);
      return redirectPayment(req, res, "error", payment && payment.guildId);
    }
  });

  app.get("/api/premium/paypal/cancel", async (req, res) => {
    const orderId = String(req.query.token || "");
    if (PremiumPayment && /^[A-Za-z0-9-]{6,64}$/.test(orderId)) {
      await PremiumPayment.updateOne(
        { paypalOrderId: orderId, status: "PENDING" },
        { $set: { status: "CANCELLED" } },
      ).catch(() => null);
    }
    const payment =
      PremiumPayment && /^[A-Za-z0-9-]{6,64}$/.test(orderId)
        ? await PremiumPayment.findOne({ paypalOrderId: orderId })
            .select("guildId")
            .lean()
            .catch(() => null)
        : null;
    return redirectPayment(req, res, "cancelled", payment && payment.guildId);
  });

  app.post("/api/premium/paypal/webhook", async (req, res) => {
    const webhookId = String(process.env.PAYPAL_WEBHOOK_ID || "").trim();
    if (!webhookId || !PremiumPayment)
      return res
        .status(503)
        .json({ ok: false, error: "PAYPAL_WEBHOOK_NOT_CONFIGURED" });
    try {
      const event = req.body;
      if (
        !(await paypal.verifyWebhook({
          headers: req.headers,
          webhookId,
          event,
        }))
      ) {
        return res
          .status(400)
          .json({ ok: false, error: "PAYPAL_WEBHOOK_INVALID" });
      }
      if (!event || event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
        return res.json({ ok: true, ignored: true });
      }

      const capture = getCaptureDetails(event);
      const payment = capture.orderId
        ? await PremiumPayment.findOne({
            paypalOrderId: capture.orderId,
          }).lean()
        : null;
      if (!payment) return res.json({ ok: true, ignored: true });
      if (payment.status === "COMPLETED")
        return res.json({ ok: true, duplicate: true });
      const completed = await completePayment(payment, event);
      if (!completed) return res.json({ ok: true, ignored: true });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[Dashboard] PayPal webhook error:", err?.message || err);
      return res
        .status(500)
        .json({ ok: false, error: "PAYPAL_WEBHOOK_PROCESSING_FAILED" });
    }
  });

  app.get(
    "/api/premium/payments",
    requireDashboardAuth,
    requireBotOwner,
    async (req, res) => {
      try {
        if (!PremiumPayment)
          return res
            .status(503)
            .json({ ok: false, error: "PREMIUM_PAYMENT_MODEL_MISSING" });
        const requestedStatus = String(req.query.status || "ALL").toUpperCase();
        const validStatuses = [
          "ALL",
          "PENDING",
          "PROCESSING",
          "COMPLETED",
          "CANCELLED",
          "FAILED",
        ];
        if (!validStatuses.includes(requestedStatus)) {
          return res
            .status(400)
            .json({ ok: false, error: "PREMIUM_PAYMENT_STATUS_INVALID" });
        }
        const pageValue = Number.parseInt(String(req.query.page || "1"), 10);
        const pageSizeValue = Number.parseInt(
          String(req.query.pageSize || "50"),
          10,
        );
        const page =
          Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
        const pageSize = Number.isFinite(pageSizeValue)
          ? Math.min(100, Math.max(1, pageSizeValue))
          : 50;
        const query =
          requestedStatus === "ALL" ? {} : { status: requestedStatus };
        const [items, total] = await Promise.all([
          PremiumPayment.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean(),
          PremiumPayment.countDocuments(query),
        ]);
        const pages = Math.ceil(total / pageSize);
        return res.json({
          ok: true,
          page,
          pageSize,
          total,
          pages,
          status: requestedStatus,
          items: items.map((item) => ({
            guildId: item.guildId,
            guildName: getCachedGuildDetails(item.guildId).guildName,
            status: item.status,
            purchaserDiscordUsername:
              item.purchaserDiscordUsername || item.discordUsername,
            purchaserDiscordUserId:
              item.purchaserDiscordUserId || item.discordUserId,
            paypalPayerEmail: item.paypalPayerEmail,
            paypalCaptureId: item.paypalCaptureId,
            amount: item.amount,
            currency: item.currency,
            createdAt: item.createdAt,
            completedAt: item.completedAt,
            expiresAt: item.expiresAt,
          })),
        });
      } catch (err) {
        console.error(
          "[Dashboard] Premium payments error:",
          err?.message || err,
        );
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  // GET /api/premium?guildId=123
  app.get(
    "/api/premium",
    requireDashboardAuth,
    canViewConfig,
    guardGuildQuery,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.query.guildId || "");
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "GUILD_ID_REQUIRED" });
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });

        const cfg = GuildConfig
          ? await GuildConfig.findOne({ guildId }).select("premium").lean()
          : null;
        const guildPremium = cfg && cfg.premium;
        const plan = await getPlan();
        const guildLicense = normalizePremium(guildPremium);
        const paidActive =
          guildLicense.active && !(guildPremium && guildPremium.testBypass);
        const guildDetails = await getGuildDetails(guildId);
        const latestPayment = PremiumPayment
          ? await PremiumPayment.findOne({ guildId, status: "COMPLETED" })
              .sort({ completedAt: -1 })
              .lean()
          : null;
        const checkoutAvailable = Boolean(
          GuildConfig &&
          PremiumPayment &&
          paypal.isConfigured(plan) &&
          getDashboardOrigin(req, config),
        );
        const referenceLinkAvailable = Boolean(
          GuildConfig &&
          plan.amount &&
          plan.durationDays &&
          plan.paymentLink &&
          isPayPalLink(plan.paymentLink),
        );
        const licenseStatus = paidActive
          ? "ACTIVE"
          : guildLicense.enabled &&
              guildLicense.until &&
              guildLicense.until.getTime() <= Date.now()
            ? "EXPIRED"
            : "INACTIVE";
        return res.json({
          ok: true,
          premium: {
            enabled: paidActive,
            active: paidActive,
            until: guildLicense.until,
            note: guildLicense.note,
            activatedAt: guildLicense.activatedAt,
            status: licenseStatus,
            testBypass: false,
            effectiveActive: paidActive,
          },
          server: {
            id: guildId,
            name: guildDetails.guildName,
            ownerId: guildDetails.ownerId,
            ownerName: guildDetails.ownerName,
            purchaserDiscordUserId:
              (guildPremium && guildPremium.purchasedByUserId) ||
              (latestPayment &&
                (latestPayment.purchaserDiscordUserId ||
                  latestPayment.discordUserId)) ||
              null,
            purchaserDiscordUsername:
              (latestPayment &&
                (latestPayment.purchaserDiscordUsername ||
                  latestPayment.discordUsername)) ||
              null,
          },
          modules: PREMIUM_MODULES,
          payment: {
            available: checkoutAvailable || referenceLinkAvailable,
            checkoutAvailable,
            referenceLinkAvailable,
            amount: plan.amount,
            currency: plan.currency,
            durationDays: plan.durationDays,
            paymentLink:
              plan.paymentLink && isPayPalLink(plan.paymentLink)
                ? plan.paymentLink
                : null,
          },
        });
      } catch (err) {
        console.error("[Dashboard] /api/premium GET error:", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );
}

module.exports = { registerPremiumRoutes, createPremiumGuard };
