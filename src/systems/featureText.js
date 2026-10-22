const { tGuild } = require("./i18n");

const FEATURE_TEXT_KEYS = {
  verification: {
    title: "verify.panelTitle",
    description: "verify.panelDescription",
    buttonLabel: "verify.button",
    testButton: "verify.testButton",
  },
  tickets: {
    panelTitle: "tickets.panelTitle",
    panelDescription: "tickets.panelDescription",
    panelFooter: "tickets.panelFooter",
    alreadyOpenMessage: "tickets.alreadyOpen",
    welcomeTitle: "tickets.welcomeTitle",
    welcomeMessage: "tickets.welcomeDescription",
    ticketNumber: "tickets.ticketNumber",
    openedBy: "tickets.openedBy",
    cannotClose: "tickets.cannotClose",
    closeMessage: "tickets.closedBy",
  },
  welcome: {
    message: "featureDefaults.welcome.message",
  },
  goodbye: {
    message: "featureDefaults.goodbye.message",
  },
  serverStats: {
    memberTemplate: "featureDefaults.serverStats.memberTemplate",
    joinsTemplate: "featureDefaults.serverStats.joinsTemplate",
    leavesTemplate: "featureDefaults.serverStats.leavesTemplate",
  },
};

function applyTemplate(text, vars) {
  return String(text == null ? "" : text).replace(/\{(\w+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key))
      return String(vars[key]);
    return m;
  });
}

async function getFeatureText({
  guildId,
  feature,
  field,
  value,
  params,
  lang,
}) {
  const custom = typeof value === "string" ? value.trim() : "";
  if (custom) return custom;

  const key = FEATURE_TEXT_KEYS[feature] && FEATURE_TEXT_KEYS[feature][field];
  if (!key) return custom || "";
  return tGuild(guildId, key, params, lang);
}

module.exports = {
  FEATURE_TEXT_KEYS,
  applyTemplate,
  getFeatureText,
};
