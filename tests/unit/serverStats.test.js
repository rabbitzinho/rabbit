const { ChannelType } = require("discord.js");
const { test, eq, deepEq } = require("./_harness");
const { refreshGuild, removeGuild } = require("../../src/systems/serverStats");

test("refreshGuild removes managed channels when serverStats is disabled", async () => {
  const GuildConfig = require("../../src/database/models/GuildConfig");
  const originalFindOne = GuildConfig.findOne;
  const originalUpdateOne = GuildConfig.updateOne;
  const {
    invalidateGuildConfig,
  } = require("../../src/systems/guildConfigService");
  const guildId = "123456789012345679";
  const channels = new Map();
  let update = null;
  const config = {
    features: {
      serverStats: {
        enabled: false,
        memberChannelId: "members-off",
        joinsChannelId: "joins-off",
        leavesChannelId: "leaves-off",
        categoryId: "stats-off",
      },
    },
  };
  GuildConfig.findOne = () => ({ lean: async () => config });
  GuildConfig.updateOne = async (filter, value) => {
    update = { filter, value };
  };
  ["members-off", "joins-off", "leaves-off", "stats-off"].forEach((id) => {
    channels.set(id, { id, delete: async () => channels.delete(id) });
  });
  const guild = {
    id: guildId,
    channels: {
      cache: {
        get: (id) => channels.get(id) || null,
        filter: () => [],
      },
      fetch: async () => null,
    },
  };

  try {
    invalidateGuildConfig(guildId);
    const result = await refreshGuild(null, guild);
    eq(result.skipped, true);
    eq(channels.size, 0);
    eq(update.filter.guildId, guildId);
  } finally {
    invalidateGuildConfig(guildId);
    GuildConfig.findOne = originalFindOne;
    GuildConfig.updateOne = originalUpdateOne;
  }
});

test("removeGuild preserves manual channels and deletes managed stats channels", async () => {
  const modelPath = require.resolve("../../src/database/models/GuildConfig");
  const originalModel = require.cache[modelPath];
  let update = null;
  require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: {
      findOne: () => ({
        lean: async () => ({
          features: {
            serverStats: {
              memberChannelId: "members",
              joinsChannelId: "joins",
              leavesChannelId: "leaves",
              categoryId: "stats",
            },
          },
        }),
      }),
      updateOne: async (filter, value) => {
        update = { filter, value };
      },
    },
  };

  const channels = new Map();
  function addChannel(id, type, parentId) {
    const channel = {
      id,
      type,
      parentId,
      delete: async () => channels.delete(id),
      setParent: async (newParentId) => {
        channel.parentId = newParentId;
      },
    };
    channels.set(id, channel);
    return channel;
  }

  addChannel("stats", ChannelType.GuildCategory, null);
  addChannel("members", ChannelType.GuildVoice, "stats");
  addChannel("joins", ChannelType.GuildVoice, "stats");
  addChannel("leaves", ChannelType.GuildVoice, "stats");
  const manual = addChannel("manual", ChannelType.GuildText, "stats");
  const guild = {
    id: "123456789012345678",
    channels: {
      cache: {
        get: (id) => channels.get(id) || null,
        filter: (predicate) => Array.from(channels.values()).filter(predicate),
      },
      fetch: async () => null,
    },
  };

  try {
    await removeGuild(guild);
    eq(manual.parentId, null);
    eq(channels.has("manual"), true);
    eq(channels.has("members"), false);
    eq(channels.has("joins"), false);
    eq(channels.has("leaves"), false);
    eq(channels.has("stats"), false);
    deepEq(update, {
      filter: { guildId: guild.id },
      value: {
        $set: {
          "features.serverStats.memberChannelId": null,
          "features.serverStats.joinsChannelId": null,
          "features.serverStats.leavesChannelId": null,
          "features.serverStats.categoryId": null,
        },
      },
    });
  } finally {
    if (originalModel) require.cache[modelPath] = originalModel;
    else delete require.cache[modelPath];
  }
});

test("removeGuild treats Discord Unknown Channel as an already deleted channel", async () => {
  const modelPath = require.resolve("../../src/database/models/GuildConfig");
  const originalModel = require.cache[modelPath];
  let update = null;
  require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: {
      findOne: () => ({
        lean: async () => ({
          features: { serverStats: { memberChannelId: "missing" } },
        }),
      }),
      updateOne: async (filter, value) => {
        update = { filter, value };
      },
    },
  };

  const channel = {
    id: "missing",
    delete: async () => {
      throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
    },
  };
  const guild = {
    id: "123456789012345678",
    channels: {
      cache: {
        get: (id) => (id === channel.id ? channel : null),
        filter: () => [],
      },
      fetch: async () => null,
    },
  };

  try {
    await removeGuild(guild);
    deepEq(update, {
      filter: { guildId: guild.id },
      value: { $set: { "features.serverStats.memberChannelId": null } },
    });
  } finally {
    if (originalModel) require.cache[modelPath] = originalModel;
    else delete require.cache[modelPath];
  }
});
