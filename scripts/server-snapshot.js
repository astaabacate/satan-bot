// Backup de estrutura do servidor: o bot salva um snapshot completo (guild,
// categorias, canais com TODAS as permissoes/overwrites, cargos com permissoes,
// emojis e stickers) em server_snapshot.json, commitado no repo junto com os
// outros estados. O historico do git vira backup: se o servidor cair de novo,
// da pra reconstituir canais/cargos/permissoes a partir de qualquer versao.
// (antes nada disso era persistido — o nuke sequer copiava as overwrites do
// confessionario — e nao havia como reconstruir o servidor.)

function bitfield(v) {
  const b = v && typeof v === 'object' && 'bitfield' in v ? v.bitfield : v;
  return String(b === undefined || b === null ? 0 : b);
}

function overwriteToJson(o) {
  return { id: o.id, type: o.type, allow: bitfield(o.allow), deny: bitfield(o.deny) };
}

function channelToJson(c) {
  const out = {
    id: c.id,
    name: c.name,
    type: c.type,
    parentId: c.parentId || null,
    position: c.position,
    topic: c.topic || null,
    nsfw: !!c.nsfw,
    rateLimitPerUser: c.rateLimitPerUser || 0,
    overwrites: [...((c.permissionOverwrites && c.permissionOverwrites.cache && c.permissionOverwrites.cache.values()) || [])]
      .map(overwriteToJson),
  };
  if (c.bitrate) out.bitrate = c.bitrate;
  if (typeof c.userLimit === 'number') out.userLimit = c.userLimit;
  return out;
}

function roleToJson(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.color || 0,
    hoist: !!r.hoist,
    position: r.position,
    permissions: bitfield(r.permissions),
    mentionable: !!r.mentionable,
    managed: !!r.managed,
  };
}

// guild: objeto no formato discord.js (caches .cache.values()) OU ja-mapeado
function snapshotGuild(guild, { salvoEm } = {}) {
  const canais = [...((guild.channels && guild.channels.cache && guild.channels.cache.values()) || [])]
    .map(channelToJson)
    .sort((a, b) => a.position - b.position || String(a.name).localeCompare(String(b.name)));
  const cargos = [...((guild.roles && guild.roles.cache && guild.roles.cache.values()) || [])]
    .map(roleToJson)
    .sort((a, b) => b.position - a.position || String(a.name).localeCompare(String(b.name)));
  return {
    salvoEm: salvoEm || new Date().toISOString(),
    guild: {
      id: guild.id,
      name: guild.name,
      description: guild.description || null,
      ownerId: guild.ownerId,
      icon: guild.icon || null,
      banner: guild.banner || null,
      verificationLevel: guild.verificationLevel,
      mfaLevel: guild.mfaLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      systemChannelId: guild.systemChannelId || null,
      rulesChannelId: guild.rulesChannelId || null,
      publicUpdatesChannelId: guild.publicUpdatesChannelId || null,
      preferredLocale: guild.preferredLocale || null,
      premiumTier: guild.premiumTier,
      premiumSubscriptionCount: guild.premiumSubscriptionCount || 0,
      features: [...(guild.features || [])],
    },
    categorias: canais.filter((c) => c.type === 4),
    canais: canais.filter((c) => c.type !== 4),
    cargos,
    emojis: [...((guild.emojis && guild.emojis.cache && guild.emojis.cache.values()) || [])].map((e) => ({
      id: e.id, name: e.name, animated: !!e.animated, available: e.available !== false,
    })),
    stickers: [...((guild.stickers && guild.stickers.cache && guild.stickers.cache.values()) || [])].map((s) => ({
      id: s.id, name: s.name, description: s.description || null, tags: s.tags || null,
    })),
  };
}

module.exports = { snapshotGuild, channelToJson, roleToJson, overwriteToJson };
