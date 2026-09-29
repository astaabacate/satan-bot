// Numeric channel types and permission bitfields are stable Discord API values.
// Keeping this helper independent of discord.js also lets its tests run offline.
const CHANNEL_TYPES = new Set([0, 2, 4, 5, 15]);
const CHANNEL_CATEGORY = 4;
const PERMISSION_BITS = {
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n,
  ReadMessageHistory: 1n << 16n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  MoveMembers: 1n << 24n,
  ManageWebhooks: 1n << 29n,
};

function validateBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== 'object' || !Array.isArray(blueprint.channels)) {
    throw new TypeError('blueprint deve conter uma lista channels');
  }
  for (const [index, channel] of blueprint.channels.entries()) {
    if (!channel || typeof channel.name !== 'string' || !channel.name.trim()) {
      throw new TypeError(`canal ${index}: nome ausente`);
    }
    if (!CHANNEL_TYPES.has(channel.type)) {
      throw new TypeError(`canal ${channel.name}: tipo Discord inválido`);
    }
    if (channel.overwrites !== undefined && !Array.isArray(channel.overwrites)) {
      throw new TypeError(`canal ${channel.name}: overwrites deve ser uma lista`);
    }
  }
  if (blueprint.roles !== undefined && !Array.isArray(blueprint.roles)) {
    throw new TypeError('roles deve ser uma lista');
  }
  return blueprint;
}

function permissionValue(value) {
  if (typeof value === 'bigint' || typeof value === 'number') return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (Array.isArray(value)) {
    return value.reduce((bits, name) => {
      const bit = PERMISSION_BITS[name];
      if (bit === undefined) throw new TypeError(`permissão desconhecida: ${name}`);
      return bits | bit;
    }, 0n);
  }
  throw new TypeError('permissões devem ser um bitfield decimal ou uma lista de nomes');
}

function remapOverwrites(overwrites, guild, roleIds) {
  const result = [];
  for (const overwrite of overwrites || []) {
    let id;
    if (overwrite.target === 'everyone' || overwrite.id === '@everyone') id = guild.id;
    else if (overwrite.target === 'role' || overwrite.type === 0 || overwrite.type === 'role') {
      id = roleIds.get(overwrite.id) || roleIds.get(overwrite.role);
      // Não deixa um cargo antigo sem correspondência bloquear ou abrir acesso.
      if (!id) continue;
    } else if (overwrite.target === 'owner') {
      id = guild.ownerId;
    } else {
      // IDs de membros do servidor antigo não existem no servidor novo.
      continue;
    }
    result.push({
      id,
      type: overwrite.target === 'owner' ? 1 : (overwrite.type === 1 || overwrite.type === 'member' ? 1 : 0),
      allow: permissionValue(overwrite.allow || '0'),
      deny: permissionValue(overwrite.deny || '0'),
    });
  }
  return result;
}

async function ensureBotChannelPermissions(channel, guild) {
  const botMember = guild.members && guild.members.me;
  if (!botMember || !channel.permissionOverwrites || typeof channel.permissionOverwrites.edit !== 'function') return;
  await channel.permissionOverwrites.edit(botMember, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    ManageMessages: true,
    ManageWebhooks: true,
    Connect: true,
    Speak: true,
    MoveMembers: true,
  }, { reason: 'permissões necessárias do Satan Bot após recriação' });
}

async function rebuildServer(guild, sourceBlueprint, { onProgress = () => {} } = {}) {
  if (!guild || !guild.channels || !guild.roles) throw new TypeError('servidor inválido');
  const blueprint = validateBlueprint(sourceBlueprint);
  const roleIds = new Map();
  const created = { roles: [], channels: [], existing: [] };

  // Só cria o que ainda não existe. Repetir .recriar não duplica a estrutura.
  for (const role of blueprint.roles || []) {
    const existing = guild.roles.cache.find((r) => r.name === role.name);
    if (existing) {
      if (role.id) roleIds.set(role.id, existing.id);
      created.existing.push(existing.name);
      continue;
    }
    const newRole = await guild.roles.create({
      name: role.name,
      color: role.color,
      hoist: !!role.hoist,
      mentionable: !!role.mentionable,
      permissions: permissionValue(role.permissions || '0'),
      reason: 'recriação da estrutura do servidor',
    });
    if (role.id) roleIds.set(role.id, newRole.id);
    created.roles.push(newRole);
    onProgress({ kind: 'role', name: role.name });
  }

  const channelsBySourceId = new Map();
  const ordered = [...blueprint.channels].sort((a, b) => {
    const aCat = a.type === CHANNEL_CATEGORY ? 0 : 1;
    const bCat = b.type === CHANNEL_CATEGORY ? 0 : 1;
    return aCat - bCat || (a.position || 0) - (b.position || 0);
  });
  for (const spec of ordered) {
    const existing = guild.channels.cache.find((c) => c.name === spec.name && c.type === spec.type);
    if (existing) {
      if (spec.id) channelsBySourceId.set(spec.id, existing.id);
      await ensureBotChannelPermissions(existing, guild);
      created.existing.push(existing.name);
      continue;
    }
    const parent = spec.parentId && channelsBySourceId.get(spec.parentId);
    const permissionOverwrites = remapOverwrites(spec.overwrites, guild, roleIds);
    const options = {
      name: spec.name,
      type: spec.type,
      ...(spec.topic ? { topic: spec.topic } : {}),
      ...(spec.nsfw !== undefined ? { nsfw: !!spec.nsfw } : {}),
      ...(spec.rateLimitPerUser ? { rateLimitPerUser: spec.rateLimitPerUser } : {}),
      ...(spec.type !== CHANNEL_CATEGORY && parent ? { parent } : {}),
      ...(permissionOverwrites.length ? { permissionOverwrites } : {}),
      reason: 'recriação da estrutura do servidor',
    };
    const channel = await guild.channels.create(options);
    if (spec.id) channelsBySourceId.set(spec.id, channel.id);
    await ensureBotChannelPermissions(channel, guild);
    created.channels.push(channel);
    onProgress({ kind: 'channel', name: spec.name });
  }

  const systemName = blueprint.systemChannel;
  if (systemName) {
    const system = guild.channels.cache.find((c) => c.name === systemName)
      || created.channels.find((c) => c.name === systemName);
    if (system && typeof guild.setSystemChannel === 'function') {
      await guild.setSystemChannel(system).catch(() => {});
    }
  }
  return created;
}

module.exports = { validateBlueprint, permissionValue, remapOverwrites, rebuildServer };
