// src/utils/staff.js

const { PermissionsBitField } = require("discord.js");
const { getGuildConfig } = require("../systems/guildConfigService");

// Small TTL cache to avoid hitting Mongo on every permission check.
// Key: `${guildId}` -> { exp:number, roles:string[] }
const _rolesCache = new Map();
const CACHE_TTL_MS = 30_000;

function selectStaffRoleIds(guildConfig, feature) {
  if (!guildConfig) return [];
  const specific =
    feature &&
    guildConfig.staffRolesByFeature &&
    guildConfig.staffRolesByFeature[feature];
  const selected =
    Array.isArray(specific) && specific.length
      ? specific
      : guildConfig.staffRoleIds;
  return Array.isArray(selected)
    ? Array.from(new Set(selected.map(String)))
    : [];
}

function invalidateStaffRoleCache(guildId) {
  const prefix = guildId ? `${String(guildId)}:` : "";
  for (const key of _rolesCache.keys()) {
    if (!prefix || key.startsWith(prefix)) _rolesCache.delete(key);
  }
}

/**
 * Obtém a lista de roles de staff para uma guild,
 * baseada apenas na configuração gravada na base de dados (GuildConfig).
 *
 * Nota: isto significa que, a partir de agora, STAFF_ROLE_IDS/.env deixam
 * de ser usados como fallback em tempo de execução. Se precisares de
 * definir roles de staff, usa a aba "Acesso e cargos de staff" na dashboard.
 */
async function getStaffRoleIdsForGuild(guildId, feature) {
  if (!guildId) return [];

  const cacheKey = `${String(guildId)}:${String(feature || "*")}`;
  const cached = _rolesCache.get(cacheKey);
  if (cached && cached.exp > Date.now() && Array.isArray(cached.roles)) {
    return cached.roles;
  }

  try {
    const guildCfg = await getGuildConfig(guildId);

    const roles = selectStaffRoleIds(guildCfg, feature);
    if (roles.length) {
      _rolesCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, roles });
      return roles;
    }
  } catch (err) {
    console.error("[Staff] Failed to read GuildConfig for staff roles:", err);
  }

  // Cache empty results briefly to avoid repeated DB hits when no staff is configured.
  _rolesCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, roles: [] });
  return [];
}

/**
 * Verifica se o membro é considerado STAFF.
 * Regra:
 *  - Administradores são sempre staff
 *  - Roles configuradas na dashboard (GuildConfig.staffRoleIds) contam como staff
 */
async function isStaff(member, feature) {
  if (!member) return false;

  const isAdmin = member.permissions?.has(
    PermissionsBitField.Flags.Administrator,
  );
  if (isAdmin) return true;

  const guild = member.guild;
  if (!guild) return false;

  const staffRoles = await getStaffRoleIdsForGuild(guild.id, feature);
  if (!staffRoles.length) return false;

  return member.roles?.cache?.some((r) => staffRoles.includes(r.id)) || false;
}

/**
 * Permissão para usar /ticket e /help.
 * Para simplificar e evitar mil variantes de permissões, usamos a mesma regra de STAFF:
 *  - Admin OU está na lista de roles de staff.
 */
async function canUseTicketOrHelp(member) {
  return isStaff(member);
}

/**
 * Alias de staff "forte". Neste momento é igual a isStaff,
 * mas mantemos separado para futura expansão se quiseres níveis diferentes.
 */
async function isHighStaff(member) {
  return isStaff(member);
}

module.exports = {
  isStaff,
  canUseTicketOrHelp,
  isHighStaff,
  getStaffRoleIdsForGuild,
  invalidateStaffRoleCache,
  selectStaffRoleIds,
};
