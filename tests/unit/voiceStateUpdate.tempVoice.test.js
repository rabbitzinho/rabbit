const { Collection, ChannelType } = require("discord.js");
const { test, eq } = require("./_harness");
const GuildConfig = require("../../src/database/models/GuildConfig");
const TempVoiceChannel = require("../../src/database/models/TempVoiceChannel");
const registerTempVoiceHandler = require("../../src/events/voiceStateUpdate.tempVoice");

function makeVoiceStates(suffix) {
  const guildId = "90000000000000000" + suffix;
  const userId = "80000000000000000" + suffix;
  const baseChannelId = "70000000000000000" + suffix;
  const channels = new Collection();
  channels.set(baseChannelId, {
    id: baseChannelId,
    name: "waiting-room",
    type: ChannelType.GuildVoice,
  });

  const member = { id: userId, user: { bot: false } };
  const guild = {
    id: guildId,
    channels: { cache: channels },
    members: { cache: new Collection([[userId, member]]) },
    roles: { everyone: { id: guildId } },
  };
  const newState = {
    guild,
    id: userId,
    channelId: baseChannelId,
    setChannel: async () => {},
  };

  return {
    guild,
    oldState: { guild, id: userId, channelId: null },
    newState,
    baseChannelId,
  };
}

async function runVoiceUpdate(states, configs, options = {}) {
  const originalFindOne = GuildConfig.findOne;
  const originalFind = TempVoiceChannel.find;
  const originalTempVoiceFindOne = TempVoiceChannel.findOne;
  const originalCreate = TempVoiceChannel.create;
  let configIndex = 0;
  let handler = null;

  GuildConfig.findOne = () => ({
    select() {
      return this;
    },
    lean: async () => configs[Math.min(configIndex++, configs.length - 1)],
  });
  TempVoiceChannel.find = () => ({ lean: async () => [] });
  TempVoiceChannel.findOne =
    options.findOne || (() => ({ lean: async () => null }));
  TempVoiceChannel.create = options.createRecord || (async (record) => record);

  try {
    registerTempVoiceHandler({
      on(event, callback) {
        if (event === "voiceStateUpdate") handler = callback;
      },
    });
    await handler(states.oldState, states.newState);
  } finally {
    GuildConfig.findOne = originalFindOne;
    TempVoiceChannel.find = originalFind;
    TempVoiceChannel.findOne = originalTempVoiceFindOne;
    TempVoiceChannel.create = originalCreate;
  }
}

test("temporary voice does not create a room when disabled", async () => {
  const states = makeVoiceStates("101");
  let createCalls = 0;
  states.guild.channels.create = async () => {
    createCalls++;
  };

  await runVoiceUpdate(states, [{ tempVoice: { enabled: false } }]);

  eq(createCalls, 0);
});

test("temporary voice rechecks activation before creating a room", async () => {
  const states = makeVoiceStates("102");
  let createCalls = 0;
  states.guild.channels.create = async () => {
    createCalls++;
  };
  const enabledConfig = {
    tempVoice: { enabled: true, baseChannelIds: [states.baseChannelId] },
  };
  const disabledConfig = { tempVoice: { enabled: false } };

  await runVoiceUpdate(states, [enabledConfig, disabledConfig]);

  eq(createCalls, 0);
});

test("temporary voice deletes a created room if its database record fails", async () => {
  const states = makeVoiceStates("103");
  let created = 0;
  let recordAttempted = 0;
  let deleted = 0;
  let moved = 0;
  states.newState.setChannel = async () => {
    moved++;
  };
  states.guild.channels.create = async (options) => {
    created++;
    return {
      id: "60000000000000000",
      name: options.name,
      type: ChannelType.GuildVoice,
      delete: async () => {
        deleted++;
      },
    };
  };
  const enabledConfig = {
    tempVoice: { enabled: true, baseChannelIds: [states.baseChannelId] },
  };
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await runVoiceUpdate(states, [enabledConfig, enabledConfig], {
      createRecord: async () => {
        recordAttempted++;
        throw new Error("database unavailable");
      },
    });
  } finally {
    console.error = originalConsoleError;
  }

  eq(created, 1, "channel creation calls");
  eq(recordAttempted, 1, "database record attempts");
  eq(deleted, 1);
  eq(moved, 0);
});

test("temporary voice still schedules cleanup for existing rooms after disable", async () => {
  const states = makeVoiceStates("104");
  const temporaryChannelId = "60000000000000001";
  let findCalls = 0;
  let scheduledDelay = null;
  states.guild.channels.cache.set(temporaryChannelId, {
    id: temporaryChannelId,
    type: ChannelType.GuildVoice,
    members: { size: 0 },
  });
  states.oldState.channelId = temporaryChannelId;
  states.newState.channelId = null;
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (_callback, delay) => {
    scheduledDelay = delay;
    return 1;
  };

  try {
    await runVoiceUpdate(
      states,
      [{ tempVoice: { enabled: false, deleteDelaySeconds: 7 } }],
      {
        findOne: () => {
          findCalls++;
          return {
            lean: async () => ({
              guildId: states.guild.id,
              channelId: temporaryChannelId,
            }),
          };
        },
      },
    );
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  eq(scheduledDelay, 7_000);
  eq(findCalls, 1);
});
