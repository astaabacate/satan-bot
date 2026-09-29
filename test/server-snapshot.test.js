const { test } = require('node:test');
const assert = require('node:assert/strict');
const { snapshotGuild, channelToJson } = require('../scripts/server-snapshot');

// fakes no formato discord.js (caches com .values())
const perm = (bitfield) => ({ bitfield: BigInt(bitfield) });
function fakeGuild() {
  const over = (id, type, allow, deny) => ({ id, type, allow: perm(allow), deny: perm(deny) });
  return {
    id: 'guild-1', name: 'inferno', description: 'desc', ownerId: 'owner-1',
    icon: 'abc', banner: null, verificationLevel: 2, mfaLevel: 1,
    explicitContentFilter: 1, defaultMessageNotifications: 1,
    systemChannelId: 'ch-conf', rulesChannelId: null, publicUpdatesChannelId: null,
    preferredLocale: 'pt-BR', premiumTier: 2, premiumSubscriptionCount: 7,
    features: ['COMMUNITY'],
    channels: { cache: new Map([
      ['ch-cat', { id: 'ch-cat', name: 'categoria', type: 4, parentId: null, position: 0, topic: null, nsfw: false, rateLimitPerUser: 0, permissionOverwrites: { cache: new Map() } }],
      ['ch-conf', { id: 'ch-conf', name: '・confessionario', type: 0, parentId: 'ch-cat', position: 1, topic: 'confissoes', nsfw: false, rateLimitPerUser: 5, permissionOverwrites: { cache: new Map([['role-1', over('role-1', 0, 1024, 2048)]]) } }],
      ['ch-vc', { id: 'ch-vc', name: 'purgatorio', type: 2, parentId: 'ch-cat', position: 2, topic: null, nsfw: false, rateLimitPerUser: 0, bitrate: 64000, userLimit: 0, permissionOverwrites: { cache: new Map([['user-1', over('user-1', 1, 0, 1048576)]]) } }],
    ]) },
    roles: { cache: new Map([
      ['role-2', { id: 'role-2', name: 'membro', color: 0, hoist: false, position: 1, permissions: perm(2048), mentionable: false, managed: false }],
      ['role-1', { id: 'role-1', name: 'staff', color: 16711680, hoist: true, position: 5, permissions: perm(8n), mentionable: true, managed: false }],
    ]) },
    emojis: { cache: new Map([['e1', { id: 'e1', name: 'brabo', animated: true, available: true }]]) },
    stickers: { cache: new Map([['s1', { id: 's1', name: 'gato', description: 'um gato', tags: 'cat' }]]) },
  };
}

test('snapshot guarda guild, canais com overwrites, cargos na hierarquia, emojis e stickers', () => {
  const snap = snapshotGuild(fakeGuild(), { salvoEm: '2026-09-28T22:00:00.000Z' });
  assert.equal(snap.salvoEm, '2026-09-28T22:00:00.000Z');
  assert.equal(snap.guild.name, 'inferno');
  assert.equal(snap.guild.ownerId, 'owner-1');
  assert.equal(snap.guild.systemChannelId, 'ch-conf');
  assert.deepEqual(snap.guild.features, ['COMMUNITY']);
  // categoria separada dos canais
  assert.deepEqual(snap.categorias.map((c) => c.name), ['categoria']);
  assert.deepEqual(snap.canais.map((c) => c.name), ['・confessionario', 'purgatorio']);
  // overwrites viram string JSON-safe e nao somem
  assert.deepEqual(snap.canais[0].overwrites, [{ id: 'role-1', type: 0, allow: '1024', deny: '2048' }]);
  assert.deepEqual(snap.canais[1].overwrites, [{ id: 'user-1', type: 1, allow: '0', deny: '1048576' }]);
  assert.equal(snap.canais[1].bitrate, 64000);
  // cargos ordenados da hierarquia pra baixo
  assert.deepEqual(snap.cargos.map((r) => r.name), ['staff', 'membro']);
  assert.equal(snap.cargos[0].permissions, '8'); // bigint vira string
  assert.equal(snap.cargos[0].color, 16711680);
  assert.deepEqual(snap.emojis, [{ id: 'e1', name: 'brabo', animated: true, available: true }]);
  assert.deepEqual(snap.stickers, [{ id: 's1', name: 'gato', description: 'um gato', tags: 'cat' }]);
});

test('snapshot funciona com caches vazios (servidor novo)', () => {
  const snap = snapshotGuild({
    id: 'g2', name: 'vazio', ownerId: 'o2',
    channels: { cache: new Map() }, roles: { cache: new Map() },
    emojis: { cache: new Map() }, stickers: { cache: new Map() },
  });
  assert.deepEqual(snap.canais, []);
  assert.deepEqual(snap.cargos, []);
  assert.equal(snap.guild.name, 'vazio');
});

test('channelToJson aceita allow/deny como bitfield puro ou objeto PermissionsBitField', () => {
  const c = channelToJson({
    id: 'c1', name: 'x', type: 0, parentId: null, position: 0, topic: null,
    nsfw: false, rateLimitPerUser: 0,
    permissionOverwrites: { cache: new Map([
      ['a', { id: 'a', type: 0, allow: { bitfield: 1n }, deny: { bitfield: 0n } }],
      ['b', { id: 'b', type: 1, allow: 32, deny: null }],
    ]) },
  });
  assert.deepEqual(c.overwrites, [
    { id: 'a', type: 0, allow: '1', deny: '0' },
    { id: 'b', type: 1, allow: '32', deny: '0' },
  ]);
});
