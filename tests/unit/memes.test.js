const { test, eq } = require("./_harness");
const { normalizeMeme } = require("../../src/systems/memes");

const safePayload = {
  nsfw: false,
  spoiler: false,
  title: "A wholesome meme",
  url: "https://i.redd.it/meme.png",
  postLink: "https://redd.it/example",
  author: "example_user",
};

test("memes accepts SFW Reddit posts and keeps validated URLs", () => {
  const meme = normalizeMeme(safePayload);
  eq(meme.imageUrl, safePayload.url);
  eq(meme.postUrl, safePayload.postLink);
  eq(meme.author, safePayload.author);
});

test("memes rejects NSFW, spoiler, and non-Reddit image URLs", () => {
  eq(normalizeMeme({ ...safePayload, nsfw: true }), null);
  eq(normalizeMeme({ ...safePayload, spoiler: true }), null);
  eq(
    normalizeMeme({ ...safePayload, url: "https://example.com/meme.png" }),
    null,
  );
  eq(
    normalizeMeme({ ...safePayload, postLink: "https://example.com/post" }),
    null,
  );
});

test("memes removes mention markers and bounds external text", () => {
  const meme = normalizeMeme({
    ...safePayload,
    title: "@everyone " + "x".repeat(300),
  });
  eq(meme.title.startsWith("everyone"), true);
  eq(meme.title.length, 250);
});
