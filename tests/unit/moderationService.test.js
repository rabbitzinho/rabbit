const { test, eq } = require("./_harness");
const {
  executeMemberAction,
  executeUnbanAction,
} = require("../../src/services/moderationService");

function makeClient(member, additionalMembers = []) {
  const botMember = { roles: { highest: { position: 10 } } };
  const guild = {
    id: "111111111111111111",
    members: {
      cache: new Map(
        [member, ...additionalMembers].map((guildMember) => [
          guildMember.id,
          guildMember,
        ]),
      ),
      me: botMember,
    },
  };
  return {
    user: { id: "999999999999999999", tag: "bot#0001" },
    guilds: { cache: new Map([[guild.id, guild]]) },
  };
}

function makeMember(overrides = {}) {
  const id = overrides.id || "222222222222222222";
  return {
    id,
    user: { id, tag: "member#0001" },
    roles: { highest: { position: 1 } },
    permissions: { has: () => false },
    kickable: true,
    bannable: true,
    ...overrides,
  };
}

test("executeMemberAction performs the Discord action before recording its case", async () => {
  const events = [];
  const member = makeMember({
    id: "222222222222222222",
    async kick(reason) {
      events.push(["kick", reason]);
    },
  });
  const result = await executeMemberAction({
    client: makeClient(member),
    guildId: "111111111111111111",
    userId: member.id,
    action: "KICK",
    reason: "Repeated harassment",
    source: "slash",
    createInfraction: async (payload) => {
      events.push(["case", payload.type, payload.source]);
      return { caseId: 8 };
    },
    writeLog: async () => events.push(["log"]),
    cancelBan: async () => {},
  });

  eq(result.infraction.caseId, 8);
  eq(events[0][0], "kick");
  eq(events[1][0], "case");
  eq(events[1][1], "KICK");
  eq(events[2][0], "log");
});

test("executeMemberAction records successful bans as BAN cases", async () => {
  const events = [];
  const moderator = makeMember({
    id: "888888888888888888",
    roles: { highest: { position: 3 } },
  });
  const member = makeMember({
    id: "555555555555555555",
    async ban(options) {
      events.push(["ban", options.reason]);
    },
  });
  const result = await executeMemberAction({
    client: makeClient(member),
    guildId: "111111111111111111",
    userId: member.id,
    action: "BAN",
    reason: "Severe abuse",
    executorMember: moderator,
    source: "dashboard",
    actor: "moderator",
    createInfraction: async (payload) => {
      events.push([
        "case",
        payload.type,
        payload.reason,
        payload.source,
        payload.moderator.id,
      ]);
      return { caseId: 9 };
    },
    writeLog: async () => events.push(["log"]),
    cancelBan: async () => {},
  });

  eq(result.infraction.caseId, 9);
  eq(events[0][0], "ban");
  eq(events[0][1], "Severe abuse (dashboard: moderator)");
  eq(events[1][0], "case");
  eq(events[1][1], "BAN");
  eq(events[1][2], "Severe abuse");
  eq(events[1][3], "dashboard");
  eq(events[1][4], moderator.id);
  eq(events[2][0], "log");
});

test("executeMemberAction rejects a member above the bot before acting", async () => {
  let kicked = false;
  const member = makeMember({
    id: "333333333333333333",
    roles: { highest: { position: 10 } },
    async kick() {
      kicked = true;
    },
  });
  let error = null;
  try {
    await executeMemberAction({
      client: makeClient(member),
      guildId: "111111111111111111",
      userId: member.id,
      action: "KICK",
      createInfraction: async () => null,
      writeLog: async () => {},
    });
  } catch (caught) {
    error = caught;
  }

  eq(error && error.code, "TARGET_ROLE_HIGHER_OR_EQUAL");
  eq(kicked, false);
});

test("executeMemberAction schedules a temporary ban before applying it", async () => {
  const events = [];
  const member = makeMember({
    id: "101010101010101010",
    async ban(options) {
      events.push(["ban", options.reason]);
    },
  });
  const result = await executeMemberAction({
    client: makeClient(member),
    guildId: "111111111111111111",
    userId: member.id,
    action: "BAN",
    durationMs: 60_000,
    reason: "Temporary action",
    scheduleBan: async (record) =>
      events.push(["schedule", record.expiresAt, record.token]),
    cancelBan: async () => events.push(["cancel"]),
    createInfraction: async (payload) => {
      events.push(["case", payload.duration]);
      return null;
    },
    writeLog: async () => {},
  });

  eq(events[0][0], "schedule");
  eq(events[1][0], "ban");
  eq(events[1][1].includes(`[rabbit-tempban:${events[0][2]}]`), true);
  eq(events[2][0], "case");
  eq(events[2][1], 60_000);
  eq(result.expiresAt instanceof Date, true);
});

test("executeMemberAction cancels a temporary schedule when the ban fails", async () => {
  const events = [];
  const member = makeMember({
    id: "111111111111111112",
    async ban() {
      throw new Error("Discord unavailable");
    },
  });
  let error = null;
  try {
    await executeMemberAction({
      client: makeClient(member),
      guildId: "111111111111111111",
      userId: member.id,
      action: "BAN",
      durationMs: 60_000,
      scheduleBan: async () => events.push("schedule"),
      cancelBan: async () => events.push("cancel"),
      createInfraction: async () => null,
      writeLog: async () => {},
    });
  } catch (caught) {
    error = caught;
  }

  eq(error && error.code, "FAILED_TO_BAN");
  eq(events.join(","), "schedule,cancel");
});

test("executeMemberAction rejects a target above the moderator before acting", async () => {
  let kicked = false;
  const member = makeMember({
    id: "666666666666666666",
    roles: { highest: { position: 2 } },
    async kick() {
      kicked = true;
    },
  });
  const moderator = makeMember({
    id: "777777777777777777",
    roles: { highest: { position: 1 } },
  });
  let error = null;
  try {
    await executeMemberAction({
      client: makeClient(member, [moderator]),
      guildId: "111111111111111111",
      userId: member.id,
      executorId: moderator.id,
      action: "KICK",
      createInfraction: async () => null,
      writeLog: async () => {},
    });
  } catch (caught) {
    error = caught;
  }

  eq(error && error.code, "CANNOT_MODERATE_TARGET_ROLE");
  eq(kicked, false);
});

test("executeMemberAction blocks administrator targets by default", async () => {
  const { PermissionsBitField } = require("discord.js");
  let banned = false;
  const member = makeMember({
    id: "444444444444444444",
    permissions: {
      has: (permission) =>
        permission === PermissionsBitField.Flags.Administrator,
    },
    async ban() {
      banned = true;
    },
  });
  let error = null;
  try {
    await executeMemberAction({
      client: makeClient(member),
      guildId: "111111111111111111",
      userId: member.id,
      action: "BAN",
      createInfraction: async () => null,
      writeLog: async () => {},
    });
  } catch (caught) {
    error = caught;
  }

  eq(error && error.code, "CANNOT_MODERATE_ADMIN");
  eq(banned, false);
});

test("executeUnbanAction checks permission, removes the ban and records UNBAN", async () => {
  const { PermissionsBitField } = require("discord.js");
  const events = [];
  const user = { id: "121212121212121212", tag: "member#0001" };
  const guild = {
    id: "131313131313131313",
    members: {
      me: {
        permissions: {
          has: (permission) =>
            permission === PermissionsBitField.Flags.BanMembers,
        },
      },
    },
    bans: {
      async fetch(userId) {
        events.push(["fetch", userId]);
        return { user };
      },
      async remove(userId, reason) {
        events.push(["remove", userId, reason]);
      },
    },
  };
  const client = {
    user: { id: "141414141414141414" },
    guilds: { cache: new Map([[guild.id, guild]]) },
  };
  const moderator = {
    id: "151515151515151515",
    user: { id: "151515151515151515" },
  };
  const result = await executeUnbanAction({
    client,
    guildId: guild.id,
    userId: user.id,
    reason: "Appeal accepted",
    executorMember: moderator,
    source: "slash",
    cancelBan: async () => events.push(["cancel-schedule"]),
    createInfraction: async (payload) => {
      events.push(["case", payload.type, payload.moderator.id]);
      return { caseId: 12 };
    },
    writeLog: async () => events.push(["log"]),
  });

  eq(result.infraction.caseId, 12);
  eq(events[0][0], "fetch");
  eq(events[1][0], "remove");
  eq(events[2][0], "cancel-schedule");
  eq(events[3][0], "case");
  eq(events[3][1], "UNBAN");
  eq(events[3][2], moderator.user.id);
});

test("executeUnbanAction rejects a bot without BanMembers", async () => {
  const guild = {
    id: "161616161616161616",
    members: { me: { permissions: { has: () => false } } },
    bans: { fetch: async () => null, remove: async () => {} },
  };
  let error = null;
  try {
    await executeUnbanAction({
      client: {
        user: { id: "171717171717171717" },
        guilds: { cache: new Map([[guild.id, guild]]) },
      },
      guildId: guild.id,
      userId: "181818181818181818",
    });
  } catch (caught) {
    error = caught;
  }

  eq(error && error.code, "BOT_MISSING_BAN_PERMISSION");
});
