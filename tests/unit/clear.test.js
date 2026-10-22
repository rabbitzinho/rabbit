const { test, eq } = require("./_harness");
const { deleteMessages } = require("../../src/slash/clear");

const DAY_MS = 24 * 60 * 60 * 1000;

function makeMessage(id, createdTimestamp) {
  return {
    id,
    createdTimestamp,
    deleted: false,
    async delete() {
      this.deleted = true;
    },
  };
}

function makeChannel(messages, bulkDelete) {
  return {
    messages: {
      fetch: async ({ limit }) =>
        new Map(messages.slice(0, limit).map((m) => [m.id, m])),
    },
    bulkDelete,
  };
}

test("clear bulk-deletes recent messages and individually deletes older ones", async () => {
  const now = 20 * DAY_MS;
  const recentA = makeMessage("recent-a", now - DAY_MS);
  const recentB = makeMessage("recent-b", now - DAY_MS);
  const oldA = makeMessage("old-a", now - 20 * DAY_MS);
  const oldB = makeMessage("old-b", now - 30 * DAY_MS);
  let bulkIds = [];
  const channel = makeChannel(
    [recentA, oldA, recentB, oldB],
    async (messages) => {
      bulkIds = messages.map((message) => message.id);
      return new Map(messages.map((message) => [message.id, message]));
    },
  );

  const result = await deleteMessages(channel, 4, now);

  eq(bulkIds.join(","), "recent-a,recent-b");
  eq(oldA.deleted, true);
  eq(oldB.deleted, true);
  eq(result.fetchedCount, 4);
  eq(result.deletedCount, 4);
  eq(result.failedCount, 0);
});

test("clear retries recent messages individually when bulk deletion fails", async () => {
  const now = 20 * DAY_MS;
  const recentA = makeMessage("recent-a", now - DAY_MS);
  const recentB = makeMessage("recent-b", now - DAY_MS);
  const channel = makeChannel([recentA, recentB], async () => {
    throw new Error("bulk delete unavailable");
  });

  const result = await deleteMessages(channel, 2, now);

  eq(recentA.deleted, true);
  eq(recentB.deleted, true);
  eq(result.deletedCount, 2);
  eq(result.failedCount, 0);
});

test("clear counts individual deletion failures without losing successful deletes", async () => {
  const now = 20 * DAY_MS;
  const oldA = makeMessage("old-a", now - 20 * DAY_MS);
  const oldB = makeMessage("old-b", now - 30 * DAY_MS);
  oldB.delete = async () => {
    throw new Error("delete failed");
  };
  const channel = makeChannel([oldA, oldB], async () => {
    throw new Error("bulk delete should not run for old messages");
  });

  const result = await deleteMessages(channel, 2, now);

  eq(oldA.deleted, true);
  eq(result.deletedCount, 1);
  eq(result.failedCount, 1);
});
