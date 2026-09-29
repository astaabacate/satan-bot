const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rebuildServer, mapOverwrites } = require('../scripts/rebuild-server');

function fakeGuild() {
  const created = [];
  let sys = null;
  return {
    id: 'guild-new',
    created,
    get sys() { return sys; },
    channels: {
      cache: new Map(),
      create: async (spec) => {
        const novo = { id: 'novo-' + created.length, ...spec };
        created.push(novo);
        return novo;
      },
    },
    roles: {
      create: async (spec) => {
        const novo = { id: 'cargo-' + created.length, ...spec };
        created.push(novo);
        return novo;
      },
    },
    setSystemChannel: async (id) => { sys = id; },
  };
}

const snap = {
  guild: { systemChannelId: 'ch-conf' },
  cargos: [
    { id: 'role-1', name: 'staff', color: 16711680, hoist: true, position: 5, permissions: '8', mentionable: true, managed: false },
    { id: 'role-bot', name: 'int', managed: true, permissions: '0' },
  ],
  categorias: [{ id: 'cat-1', name: 'calls', type: 4, position: 0 }],
  canais: [
    { id: 'ch-conf', name: '・confessionario', type: 0, parentId: null, position: 1, topic: null, nsfw: false, rateLimitPerUser: 0, overwrites: [{ id: 'role-1', type: 0, allow: '1024', deny: '0' }] },
    { id: 'ch-vc', name: 'purgatorio', type: 2, parentId: 'cat-1', position: 2, topic: null, nsfw: false, rateLimitPerUser: 0, overwrites: [] },
  ],
};

test('rebuild cria cargos (sem managed), categorias, canais com overwrites remapeadas e system channel', async () => {
  const g = fakeGuild();
  const r = await rebuildServer(g, snap);
  assert.equal(r.cargos, 1); // role-bot (managed) pulado
  assert.equal(r.categorias, 1);
  assert.equal(r.canais, 2);
  assert.equal(r.erros.length, 0);
  const [cargo, cat, conf, vc] = g.created;
  assert.equal(cargo.name, 'staff');
  assert.equal(cargo.permissions, 8n);
  assert.equal(cat.type, 4);
  // overwrite do confessionario aponta pro CARGO NOVO, nao pro id antigo
  assert.equal(conf.permissionOverwrites[0].id, cargo.id);
  assert.equal(conf.permissionOverwrites[0].allow, 1024n);
  // canal de voz nasce dentro da categoria nova
  assert.equal(vc.parent, cat.id);
  // system channel remapeada
  assert.equal(g.sys, conf.id);
});

test('rebuild pula canal que ja existe (nome+tipo) e reporta erros sem parar', async () => {
  const g = fakeGuild();
  g.channels.cache.set('ja', { name: 'purgatorio', type: 2 });
  g.channels.create = async (spec) => {
    if (spec.name === '・confessionario') throw new Error('sem permissao');
    return { id: 'novo-x', ...spec };
  };
  const r = await rebuildServer(g, snap);
  assert.equal(r.pulados, 1);
  assert.equal(r.canais, 0); // um falhou, o outro pulou
  assert.deepEqual(r.erros, ['canal ・confessionario: sem permissao']);
});

test('mapOverwrites usa ids novos quando existem e mantem os demais (usuarios)', () => {
  const out = mapOverwrites([
    { id: 'role-1', type: 0, allow: '8', deny: '0' },
    { id: 'user-9', type: 1, allow: '0', deny: '1024' },
  ], new Map([['role-1', 'cargo-novo']]));
  assert.deepEqual(out, [
    { id: 'cargo-novo', type: 0, allow: 8n, deny: 0n },
    { id: 'user-9', type: 1, allow: 0n, deny: 1024n },
  ]);
});
