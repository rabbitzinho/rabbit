const { test, deepEq } = require("./_harness");
const { selectStaffRoleIds } = require("../../src/utils/staff");

test("feature-specific staff roles override the server-wide staff list", () => {
  deepEq(
    selectStaffRoleIds(
      {
        staffRoleIds: ["general"],
        staffRolesByFeature: { moderation: ["mod", "mod"] },
      },
      "moderation",
    ),
    ["mod"],
  );
});

test("empty feature-specific staff roles fall back to server-wide roles", () => {
  deepEq(
    selectStaffRoleIds(
      {
        staffRoleIds: ["general"],
        staffRolesByFeature: { tickets: [] },
      },
      "tickets",
    ),
    ["general"],
  );
});
