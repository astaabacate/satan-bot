const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildChannelSpec, missingPerms, PERMS_BOT_CANAL } = require('../scripts/channel-rebirth');

const chan = {
  name: '・confessionario', type: 0, parentId: 'cat1', topic: 'confissoes',
  nsfw: false, rateLimitPerUser: 5, position: 3,
};

test('recriacao copia as permissoes do canal original (antes eram calculadas e jogadas fora)', () => {
  const spec = buildChannelSpec(chan, [
    { id: 'role1', type: 0, allow: '1024', deny: '0' },
    { id: 'user1', type: 1, allow: 0n, deny: '2048' },
  ], { reason: 'nuke' });
  assert.equal(spec.name, '・confessionario');
  assert.equal(spec.parent, 'cat1');
  assert.equal(spec.topic, 'confissoes');
  assert.equal(spec.rateLimitPerUser, 5);
  assert.equal(spec.reason, 'nuke');
  assert.deepEqual(spec.permissionOverwrites, [
    { id: 'role1', type: 0, allow: 1024n, deny: 0n },
    { id: 'user1', type: 1, allow: 0n, deny: 2048n },
  ]);
});

test('sem overwrites e sem motivo ainda gera spec valido', () => {
  const spec = buildChannelSpec(chan);
  assert.deepEqual(spec.permissionOverwrites, []);
  assert.equal('reason' in spec, false);
  assert.equal(spec.parent, 'cat1');
});

test('aceita bitfield em bigint, number ou string', () => {
  const spec = buildChannelSpec(chan, [
    { id: 'a', type: 0, allow: 2097152n, deny: 0 },
    { id: 'b', type: 1, allow: '8192', deny: 2048 },
  ]);
  assert.equal(spec.permissionOverwrites[0].allow, 2097152n);
  assert.equal(spec.permissionOverwrites[1].allow, 8192n);
  assert.equal(spec.permissionOverwrites[1].deny, 2048n);
});

test('missingPerms aponta o que falta pra moderar o canal', () => {
  const tudo = () => true;
  assert.deepEqual(missingPerms(tudo), []);
  const semNada = () => false;
  assert.deepEqual(missingPerms(semNada), Object.keys(PERMS_BOT_CANAL));
  const soLeitura = (p) => ['ViewChannel', 'ReadMessageHistory'].includes(p);
  assert.deepEqual(missingPerms(soLeitura), [
    'SendMessages', 'EmbedLinks', 'AttachFiles', 'ManageMessages', 'ManageWebhooks',
  ]);
});
