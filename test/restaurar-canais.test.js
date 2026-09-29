const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restaurarCanais, faltantes, overwritesDoBackup, ordemDoBackup } = require('../scripts/restaurar-canais');

const CAT = 'cat-voz';

function canal(id, name, type, position, extra = {}) {
  return { id, name, type, parentId: CAT, position, rawPosition: position, ...extra };
}

// backup com 4 canais de voz; no servidor só sobraram 2 (o caso real: 9 -> 2)
const snap = {
  salvoEm: '2026-09-29T11:30:36.277Z',
  guild: { id: 'guild-1' },
  categorias: [{ id: CAT, name: '・', type: 4, parentId: null, position: 1, overwrites: [] }],
  canais: [
    { id: 'v1', name: 'purgatorio', type: 2, parentId: CAT, position: 0, bitrate: 64000, userLimit: 0, overwrites: [{ id: 'guild-1', type: 0, allow: '0', deny: '2048' }, { id: 'role-viva', type: 0, allow: '104189505', deny: '0' }, { id: 'role-morta', type: 0, allow: '1024', deny: '0' }] },
    { id: 'v2', name: 'gf', type: 2, parentId: CAT, position: 1, overwrites: [] },
    { id: 'v3', name: 'conclave', type: 2, parentId: CAT, position: 2, overwrites: [] },
    { id: 'v4', name: 'ritual', type: 2, parentId: CAT, position: 3, overwrites: [] },
    { id: 't1', name: 'bump', type: 0, parentId: 'cat-texto', position: 0, overwrites: [] },
  ],
};

function fakeGuild(canaisIniciais = [], rolesExistentes = ['role-viva']) {
  // a categoria continua no servidor (só os canais de voz sumiram)
  const inicial = [{ id: CAT, name: '・', type: 4, parentId: null, position: 1, rawPosition: 1 }, ...canaisIniciais];
  const cache = new Map(inicial.map((c) => [c.id, c]));
  const created = [];
  const patches = [];
  const apagados = [];
  return {
    id: 'guild-1', created, patches, apagados,
    roles: { cache: new Map(rolesExistentes.map((r) => [r, { id: r }])) },
    channels: {
      cache,
      fetch: async () => cache,
      setPositions: async (lista) => { patches.push(lista); },
      create: async (spec) => {
        const n = {
          id: 'novo-' + created.length,
          name: spec.name, type: spec.type,
          parentId: spec.parent || null,
          position: spec.position, rawPosition: spec.position,
          ...spec,
        };
        created.push(n);
        cache.set(n.id, n);
        return n;
      },
    },
  };
}

test('faltantes: so o que nao existe mais (nome+tipo), sem mexer no que ficou', () => {
  const g = fakeGuild([canal('v2', 'gf', 2, 0), canal('v4', 'ritual', 2, 1)]);
  const f = faltantes(g, snap);
  assert.deepEqual(f.canais.map((c) => c.name), ['purgatorio', 'conclave', 'bump']);
  assert.equal(f.categorias.length, 0); // categoria ainda existe
});

test('faltantes: tipos=[2] devolve so os canais de voz', () => {
  const g = fakeGuild([canal('v2', 'gf', 2, 0)]);
  const f = faltantes(g, snap, { tipos: [2] });
  assert.deepEqual(f.canais.map((c) => c.name), ['purgatorio', 'conclave', 'ritual']);
});

test('restaurar: recria os 2 que sumiram dentro da categoria, com as permissoes, e NAO apaga nada', async () => {
  const g = fakeGuild([canal('v2', 'gf', 2, 5), canal('v4', 'ritual', 2, 6)]);
  const antes = g.channels.cache.size;
  const rel = await restaurarCanais(g, snap, { tipos: [2] });
  assert.deepEqual(rel.canais, ['purgatorio', 'conclave']);
  assert.equal(rel.erros.length, 0);
  assert.equal(g.apagados.length, 0);
  assert.equal(g.channels.cache.size, antes + 2);
  const [purg, conc] = g.created;
  assert.equal(purg.parentId, CAT); // dentro da categoria original
  assert.equal(purg.bitrate, 64000);
  assert.equal(purg.userLimit, 0);
  // overwrite do @everyone vem como bigint e o cargo que nao existe mais sai
  assert.deepEqual(purg.permissionOverwrites, [
    { id: 'guild-1', type: 0, allow: 0n, deny: 2048n },
    { id: 'role-viva', type: 0, allow: 104189505n, deny: 0n },
  ]);
  assert.equal(conc.parentId, CAT);
});

test('restaurar: cargo que saiu do servidor nao derruba a recriacao', () => {
  const g = { id: 'guild-1', roles: { cache: new Map([['guild-1', { id: 'guild-1' }]]) } };
  const over = overwritesDoBackup(g, snap.canais[0]);
  assert.deepEqual(over.map((o) => o.id), ['guild-1']);
});

test('restaurar: canal que ja existe nao é recriado (pulados)', async () => {
  const g = fakeGuild([canal('v1', 'purgatorio', 2, 0)]);
  const rel = await restaurarCanais(g, snap, { tipos: [2] });
  assert.deepEqual(rel.canais, ['gf', 'conclave', 'ritual']);
  assert.equal(rel.pulados >= 1, true);
  assert.equal(g.created.some((c) => c.name === 'purgatorio'), false);
});

test('restaurar: volta na ordem do backup mesmo com buraco nas posicoes', async () => {
  // os que sobraram ficaram com posicao bruta alta (o Discord nao renumera):
  // sem reindex, os recriados nascem todos na frente deles
  const g = fakeGuild([canal('v2', 'gf', 2, 5, { rawPosition: 20 }), canal('v4', 'ritual', 2, 6, { rawPosition: 21 })]);
  const rel = await restaurarCanais(g, snap, { tipos: [2] });
  assert.deepEqual(rel.ordem, [{ pai: CAT, paiNome: '・', canais: ['purgatorio', 'gf', 'conclave', 'ritual'] }]);
  assert.deepEqual(g.patches[0].map((p) => p.channel), ['novo-0', 'v2', 'novo-1', 'v4']);
  assert.deepEqual(g.patches[0].map((p) => p.position), [0, 1, 2, 3]);
});

test('restaurar: recriado ja no lugar certo nao gasta PATCH', async () => {
  const g = fakeGuild([canal('v2', 'gf', 2, 1), canal('v4', 'ritual', 2, 3)]);
  const rel = await restaurarCanais(g, snap, { tipos: [2] });
  assert.deepEqual(rel.canais, ['purgatorio', 'conclave']);
  assert.deepEqual(rel.ordem, []); // ja estava na ordem do backup
  assert.equal(g.patches.length, 0);
});

test('ordemDoBackup: quem nao esta no backup vai pro fim', () => {
  const irmaos = [
    { id: 'a', name: 'gf', type: 2, position: 0, rawPosition: 0 },
    { id: 'b', name: 'novo-na-mão', type: 2, position: 1, rawPosition: 1 },
  ];
  const ordem = ordemDoBackup(irmaos, snap, CAT);
  assert.deepEqual(ordem.map((c) => c.name), ['gf', 'novo-na-mão']);
});

test('restaurar: erro na criacao nao derruba os outros canais', async () => {
  const g = fakeGuild([canal('v2', 'gf', 2, 5)]);
  g.channels.create = async (spec) => {
    if (spec.name === 'purgatorio') throw new Error('Missing Permissions');
    return { id: 'novo-x', name: spec.name, type: spec.type, parentId: spec.parent || null, position: spec.position, rawPosition: spec.position };
  };
  const rel = await restaurarCanais(g, snap, { tipos: [2] });
  assert.deepEqual(rel.canais, ['conclave', 'ritual']);
  assert.equal(rel.erros.length, 1);
  assert.match(rel.erros[0], /purgatorio/);
});

test('restaurar sem backup valido avisa e nao cria nada', async () => {
  const g = fakeGuild([]);
  const rel = await restaurarCanais(g, null);
  assert.deepEqual(rel.erros, ['sem guild ou sem backup']);
  assert.equal(g.created.length, 0);
});
