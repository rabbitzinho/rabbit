const { test, eq } = require("./_harness");
const {
  normalizeStreamerName,
  hasNewLiveStream,
  fetchLiveStream,
} = require("../../src/systems/twitch");

test("twitch normalizes valid streamer logins and rejects malformed values", () => {
  eq(normalizeStreamerName(" @Some_Stream "), "some_stream");
  eq(normalizeStreamerName("not a login"), "");
  eq(normalizeStreamerName("a".repeat(26)), "");
});

test("twitch detects stream transitions without alerting on initial baseline", () => {
  eq(hasNewLiveStream(null, "channel", "stream-1"), false);
  eq(
    hasNewLiveStream(
      { login: "channel", streamId: null },
      "channel",
      "stream-1",
    ),
    true,
  );
  eq(
    hasNewLiveStream(
      { login: "channel", streamId: "stream-1" },
      "channel",
      "stream-1",
    ),
    false,
  );
  eq(
    hasNewLiveStream(
      { login: "channel", streamId: "stream-1" },
      "channel",
      "stream-2",
    ),
    true,
  );
  eq(
    hasNewLiveStream({ login: "other", streamId: null }, "channel", "stream-1"),
    false,
  );
});

test("twitch uses app credentials and the Helix streams endpoint", async () => {
  const oldClientId = process.env.TWITCH_CLIENT_ID;
  const oldClientSecret = process.env.TWITCH_CLIENT_SECRET;
  process.env.TWITCH_CLIENT_ID = "unit-client-id";
  process.env.TWITCH_CLIENT_SECRET = "unit-client-secret";
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://id.twitch.tv/oauth2/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "unit-token", expires_in: 3600 }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "stream-1" }] }),
    };
  };

  try {
    const stream = await fetchLiveStream("Unit_Test_Channel", { fetchImpl });
    eq(stream.id, "stream-1");
    eq(calls.length, 2);
    eq(calls[0].options.method, "POST");
    eq(
      calls[1].url,
      "https://api.twitch.tv/helix/streams?user_login=unit_test_channel",
    );
    eq(calls[1].options.headers["Client-Id"], "unit-client-id");
    eq(calls[1].options.headers.Authorization, "Bearer unit-token");
  } finally {
    if (oldClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = oldClientId;
    if (oldClientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = oldClientSecret;
  }
});
