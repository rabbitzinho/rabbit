function escapeRegex(text) {
  if (text === null || text === undefined) return "";
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { escapeRegex };
