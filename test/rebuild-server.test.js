const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBlueprint,
  permissionValue,
  remapOverwrites,
  rebuildServer,
} = require('../scripts/rebuild-server');

function collection(items = []) {
  return {
    items,
    find: (fn) => items.find(fn),
    get: (id) => items.find((item) => item.id === id),
    values: () => items.values(),
  };
}

test('valida o blueprint e rejeita tipo inválido', () => {
  assert.equal(validateBlueprint({ channels: [{ name: 'geral', type: 0 }] }).channels.length, 1);
  assert.throws(() => validateBlueprint({ channels: [{ name: 'x', type: 999 }] }), /tipo Discord inválido/);
  assert.throws(() => validateBlueprint({}), /channels/);
});

test('converte permissões nomeadas e remapeia everyone/cargo, ignorando IDs sem destino', () => {
  assert.equal(permissionValue(['ViewChannel', 'SendMessages']), (1n << 10n) | (1n << 11n));
  const guild = { id: 'new-guild', ownerId: 'owner-new' };
  const result = remapOverwrites([
    { target: 'everyone', allow: ['ViewChannel'] },
    { target: 'role', id: 'old-role', allow: '8', deny: '0' },
    { target: 'member', id: 'old-user', allow: '1' },
  ], guild, new Map([['old-role', 'new-role']]));
  assert.deepEqual(result.map((x) => x.id), ['new-guild', 'new-role']);
  assert.equal(result[0].allow, (1n << 10n));
});

test('cria categorias antes dos canais e remapeia parent/overwrites; segunda execução não duplica', async () => {
  let id = 0;
  const made = [];
  const guild = {
    id: 'guild-1', ownerId: 'owner-1',
    members: { me: { id: 'bot-1' } },
    roles: {
      cache: collection(),
      create: async (data) => {
        const role = { id: `role-${++id}`, name: data.name };
        guild.roles.cache.items.push(role);
        return role;
      },
    },
    channels: {
      cache: collection(),
      create: async (data) => {
        const channel = {
          id: `channel-${++id}`, name: data.name, type: data.type, parent: data.parent,
          options: data, permissionOverwrites: { edit: async () => {} },
        };
        made.push(channel);
        guild.channels.cache.items.push(channel);
        return channel;
      },
    },
    setSystemChannel: async (channel) => { guild.systemChannel = channel; },
  };
  const blueprint = {
    systemChannel: 'confessionario',
    roles: [{ id: 'old-role', name: 'Moderador', permissions: ['ManageMessages'] }],
    channels: [
      { id: 'old-text', name: 'confessionario', type: 0, parentId: 'old-category', overwrites: [{ target: 'role', id: 'old-role', allow: ['ViewChannel'] }] },
      { id: 'old-category', name: 'comunidade', type: 4 },
    ],
  };
  const first = await rebuildServer(guild, blueprint);
  assert.deepEqual(made.map((ch) => ch.name), ['comunidade', 'confessionario']);
  assert.equal(made[1].parent, made[0].id);
  assert.equal(made[1].options.permissionOverwrites[0].id, guild.roles.cache.items[0].id);
  assert.equal(guild.systemChannel.name, 'confessionario');
  assert.equal(first.channels.length, 2);
  const second = await rebuildServer(guild, blueprint);
  assert.equal(second.channels.length, 0);
  assert.equal(second.existing.length, 3); // cargo + dois canais existentes
  assert.equal(made.length, 2);
});
