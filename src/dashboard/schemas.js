// src/dashboard/schemas.js
//
// Schemas Zod que validam os payloads da dashboard.
// Extraído de src/dashboard.js (puros, testáveis isoladamente).

const { z } = require("zod");

const GuildConfigSchema = z
  .object({
    logChannelId: z.string().regex(/^\d+$/).nullable().optional(),
    dashboardLogChannelId: z.string().regex(/^\d+$/).nullable().optional(),
    ticketThreadChannelId: z.string().regex(/^\d+$/).nullable().optional(),
    staffRoleIds: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
    staffRolesByFeature: z
      .object({
        tickets: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
        moderation: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
        gamenews: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
        logs: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
        config: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
      })
      .strict()
      .optional(),

    maintenanceMode: z
      .object({
        enabled: z.boolean().optional(),
        message: z.string().max(180).nullable().optional(),
        allowStaff: z.boolean().optional(),
      })
      .partial()
      .optional(),

    // Guild settings
    language: z.enum(["auto", "pt", "en"]).optional(),
    timezone: z.string().max(64).nullable().optional(),
  })
  .strict();

const ModMuteSchema = z.object({
  guildId: z.string().min(1).max(32),
  userId: z.string().min(1).max(32),
  duration: z.string().min(1).max(32).optional(),
  reason: z.string().max(1000).optional(),
});

const ModWarnSchema = z.object({
  guildId: z.string().min(1).max(32),
  userId: z.string().min(1).max(32),
  reason: z.string().max(1000).optional(),
});

const ModBanSchema = ModWarnSchema.extend({
  duration: z.string().trim().max(32).optional(),
});

const ModUnbanSchema = ModWarnSchema;

const ModUnmuteSchema = z.object({
  guildId: z.string().min(1).max(32),
  userId: z.string().min(1).max(32),
  reason: z.string().max(1000).optional(),
});

// Logs endpoint supports optional guildId (some panels show "select guild" states).
// Keep it permissive and validate semantics in the route when needed.
const LogsQuerySchema = z
  .object({
    guildId: z.string().min(1).max(32).optional(),
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  })
  .passthrough();

// NOTE: This schema validates each feed item received from the dashboard.
// The UI may send forward-compatible fields (e.g., `language`).
// Do not reject payloads due to unknown keys; accept-and-ignore instead.
const GameNewsFeedSchema = z
  .object({
    name: z.string().trim().min(1).max(64),

    // canonical field is feedUrl; we still accept legacy "feed" and normalize on write
    // NOTE: zod's .url() is stricter than what many RSS endpoints accept in practice
    // (e.g., hostnames with underscores or other legacy formats). We validate protocol
    // and basic structure here and let the downstream fetcher fail gracefully if needed.
    feedUrl: z
      .string()
      .trim()
      .min(8)
      .max(2048)
      .refine((v) => /^https?:\/\/\S+$/i.test(v), { message: "Invalid URL" }),
    feed: z
      .string()
      .trim()
      .min(8)
      .max(2048)
      .refine((v) => /^https?:\/\/\S+$/i.test(v), { message: "Invalid URL" })
      .optional(),

    channelId: z.string().trim().min(10).max(32),
    logChannelId: z.string().trim().min(10).max(32).nullable().optional(),

    // Extra channels that receive a copy of every post (max 5, deduped on write).
    extraChannelIds: z
      .array(z.string().trim().min(10).max(32))
      .max(5)
      .optional(),

    enabled: z.boolean().optional(),
    intervalMs: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1000)
      .nullable()
      .optional(),
    maxPerCycle: z.number().int().min(1).max(10).nullable().optional(),

    // Terms that cause a news item to be skipped (case-insensitive substring match).
    excludeKeywords: z
      .array(z.string().trim().min(1).max(64))
      .max(50)
      .optional(),

    // Optional forward-compatible field.
    language: z.string().trim().min(2).max(16).optional(),
  })
  // Accept unknown keys (dashboard may evolve). We will ignore what we don't persist.
  .passthrough();

module.exports = {
  GuildConfigSchema,
  ModMuteSchema,
  ModWarnSchema,
  ModBanSchema,
  ModUnbanSchema,
  ModUnmuteSchema,
  LogsQuerySchema,
  GameNewsFeedSchema,
};
