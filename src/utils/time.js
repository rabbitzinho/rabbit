// src/utils/time.js

/**
 * Parse a compact duration string like: 10s, 5m, 2h, 7d
 * Returns milliseconds, or null if invalid.
 */
function parseDuration(input) {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim().toLowerCase();

  // Allow plain numbers as seconds (e.g. "90" -> 90s)
  if (/^[0-9]+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!seconds || seconds <= 0) return null;
    return seconds * 1000;
  }

  const match = trimmed.match(/^([0-9]+)(s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (!value || value <= 0) return null;

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Format milliseconds into the shortest compact unit string.
 * Example: 600000 -> "10m".
 */
function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);

  if (day >= 1 && day * 24 * 60 * 60 * 1000 === ms) return `${day}d`;
  if (hour >= 1 && hour * 60 * 60 * 1000 === ms) return `${hour}h`;
  if (min >= 1 && min * 60 * 1000 === ms) return `${min}m`;
  return `${sec}s`;
}

module.exports = { parseDuration, formatDuration };
