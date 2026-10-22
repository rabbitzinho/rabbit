const { test, eq } = require("./_harness");
const { findBotAddEntry } = require("../../src/events/guildCreate");

test("findBotAddEntry attributes a recent audit entry to the invited bot", () => {
  const now = 1_800_000_000_000;
  const expected = { target: { id: "bot-id" }, createdTimestamp: now - 1000 };
  const entry = findBotAddEntry(
    [{ target: { id: "other-bot" }, createdTimestamp: now }, expected],
    "bot-id",
    now,
  );
  eq(entry, expected);
});

test("findBotAddEntry rejects stale or future unrelated audit entries", () => {
  const now = 1_800_000_000_000;
  const entry = findBotAddEntry(
    [
      { target: { id: "bot-id" }, createdTimestamp: now - 11 * 60_000 },
      { target: { id: "bot-id" }, createdTimestamp: now + 2 * 60_000 },
    ],
    "bot-id",
    now,
  );
  eq(entry, null);
});
