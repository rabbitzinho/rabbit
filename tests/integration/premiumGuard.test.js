const test = require("node:test");
const assert = require("node:assert/strict");
const { createPremiumGuard } = require("../../src/dashboard/routes/premium");

const GUILD_ID = "123456789012345678";
const USER_ID = "987654321098765432";

function makeGuard({ guildPremium, databaseError } = {}) {
  let storedPremium = guildPremium || { enabled: false };
  const GuildConfig = {
    findOne() {
      return {
        select() {
          return this;
        },
        lean: async () => {
          if (databaseError) throw databaseError;
          return { guildId: GUILD_ID, premium: storedPremium };
        },
      };
    },
    findOneAndUpdate(query, update) {
      storedPremium = update.$set.premium;
      return {
        lean: async () => ({ guildId: query.guildId, premium: storedPremium }),
      };
    },
    getPremium() {
      return storedPremium;
    },
  };
  return createPremiumGuard({
    GuildConfig,
    sanitizeId: (value) => String(value || "").replace(/\D/g, ""),
  })();
}

async function runGuard(middleware, role, userId = USER_ID) {
  let statusCode = null;
  let body = null;
  let passed = false;
  const req = {
    dashboardUser: role ? { _id: userId, role } : null,
    body: { guildId: GUILD_ID },
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  await middleware(req, res, () => {
    passed = true;
  });
  return { passed, statusCode, body };
}

test("a dashboard account without a guild license cannot access premium features", async () => {
  const guard = makeGuard();
  const result = await runGuard(guard, "GUILD_ADMIN");
  assert.equal(result.passed, false);
  assert.equal(result.statusCode, 402);
  assert.equal(result.body.error, "PREMIUM_REQUIRED");
});

test("an active legacy guild license remains valid after migration", async () => {
  const guard = makeGuard({
    guildPremium: {
      enabled: true,
      until: new Date(Date.now() + 86_400_000),
      accountUserId: USER_ID,
    },
  });
  const result = await runGuard(guard, "GUILD_ADMIN");
  assert.equal(result.passed, true);
});

test("an expired guild license does not unlock premium features", async () => {
  const guard = makeGuard({
    guildPremium: { enabled: true, until: new Date(Date.now() - 1000) },
  });
  const result = await runGuard(guard, "GUILD_ADMIN");
  assert.equal(result.statusCode, 402);
  assert.equal(result.body.error, "PREMIUM_REQUIRED");
});

test("legacy BOT_ADMIN sessions still need an active server license", async () => {
  const guard = makeGuard();
  const result = await runGuard(guard, "BOT_ADMIN");
  assert.equal(result.passed, false);
  assert.equal(result.statusCode, 402);
  assert.equal(result.body.error, "PREMIUM_REQUIRED");
});

test("bot owners still need an active server license to use Premium modules", async () => {
  const guard = makeGuard();
  const result = await runGuard(guard, "BOT_OWNER");
  assert.equal(result.passed, false);
  assert.equal(result.statusCode, 402);
  assert.equal(result.body.error, "PREMIUM_REQUIRED");
});

test("a legacy operator test bypass does not grant Premium to guild members", async () => {
  const guard = makeGuard({
    guildPremium: {
      enabled: true,
      until: new Date(Date.now() + 15 * 60 * 1000),
      testBypass: true,
    },
  });
  const result = await runGuard(guard, "GUILD_ADMIN");
  assert.equal(result.statusCode, 402);
});

test("premium guard reports database failures instead of treating them as a missing license", async () => {
  const guard = makeGuard({ databaseError: new Error("database unavailable") });
  const result = await runGuard(guard, "GUILD_ADMIN");
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.error, "PREMIUM_CHECK_FAILED");
});
