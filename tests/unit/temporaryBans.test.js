const { test, eq } = require("./_harness");
const { processDueTemporaryBans } = require("../../src/systems/temporaryBans");

function makeModel(records) {
  const deleted = [];
  return {
    deleted,
    find(filter) {
      this.filter = filter;
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => records,
      };
    },
    async deleteOne(filter) {
      deleted.push(filter);
      return { deletedCount: 1 };
    },
  };
}

function makeBan(overrides = {}) {
  return {
    guildId: "111111111111111111",
    userId: "222222222222222222",
    userTag: "member#0001",
    token: "timer-token",
    expiresAt: new Date(1),
    ...overrides,
  };
}

test("processDueTemporaryBans unbans expired members and records the action", async () => {
  const model = makeModel([makeBan()]);
  const events = [];
  const guild = {
    bans: {
      async fetch() {
        return { reason: "Temporary ban [rabbit-tempban:timer-token]" };
      },
      async remove(userId, reason) {
        events.push(["unban", userId, reason]);
      },
    },
  };
  const client = {
    user: { id: "999999999999999999" },
    guilds: { cache: new Map([["111111111111111111", guild]]) },
  };
  const expired = await processDueTemporaryBans(client, {
    model,
    now: 2,
    createInfraction: async (entry) => events.push(["case", entry.type]),
    writeLog: async () => events.push(["log"]),
  });

  eq(expired, 1);
  eq(events[0][0], "unban");
  eq(events[1][0], "case");
  eq(events[1][1], "UNBAN");
  eq(events[2][0], "log");
  eq(model.deleted.length, 1);
});

test("processDueTemporaryBans retains records when the guild is unavailable", async () => {
  const model = makeModel([makeBan()]);
  const expired = await processDueTemporaryBans(
    { guilds: { cache: new Map() } },
    { model, now: 2 },
  );

  eq(expired, 0);
  eq(model.deleted.length, 0);
});

test("processDueTemporaryBans retries transient Discord failures", async () => {
  const model = makeModel([makeBan()]);
  const guild = {
    bans: {
      async fetch() {
        return { reason: "Temporary ban [rabbit-tempban:timer-token]" };
      },
      async remove() {
        throw new Error("Discord unavailable");
      },
    },
  };
  const expired = await processDueTemporaryBans(
    {
      guilds: { cache: new Map([["111111111111111111", guild]]) },
    },
    { model, now: 2, writeLog: async () => {} },
  );

  eq(expired, 0);
  eq(model.deleted.length, 0);
});

test("processDueTemporaryBans clears schedules for bans already removed manually", async () => {
  const model = makeModel([makeBan()]);
  const guild = {
    bans: {
      async fetch() {
        throw { code: 10026 };
      },
      async remove() {},
    },
  };
  const expired = await processDueTemporaryBans(
    {
      guilds: { cache: new Map([["111111111111111111", guild]]) },
    },
    { model, now: 2 },
  );

  eq(expired, 1);
  eq(model.deleted.length, 1);
});

test("processDueTemporaryBans never removes a different ban for the same user", async () => {
  const model = makeModel([makeBan()]);
  let removed = false;
  const guild = {
    bans: {
      async fetch() {
        return { reason: "Manual ban from another moderator" };
      },
      async remove() {
        removed = true;
      },
    },
  };
  const expired = await processDueTemporaryBans(
    {
      guilds: { cache: new Map([["111111111111111111", guild]]) },
    },
    { model, now: 2 },
  );

  eq(expired, 1);
  eq(removed, false);
  eq(model.deleted.length, 1);
});
