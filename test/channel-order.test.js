const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  irmaosOrdenados, ordemDoInferno, posicaoDoConfessionario, montarReindexacao,
  aplicarOrdem, garantirOrdemInferno, ehInferno, ehConfessionario,
} = require('../scripts/channel-order');

const CAT = 'cat-1';
function ch(id, name, position, extra = {}) {
  return { id, name, type: 0, parentId: CAT, position, rawPosition: position + 10, ...extra };
}

const CANAIS = [
  ch('c-bump', 'bump', 0),
  ch('c-inf', 'inferno', 1),
  ch('c-conf', 'confessionario', 2),
  ch('c-logs', 'logs', 3),
  { id: 'cat-1', name: '・', type: 4, parentId: null, position: 0, rawPosition: 0 },
  { id: 'c-vc', name: 'purgatorio', type: 2, parentId: 'cat-2', position: 0, rawPosition: 40 },
];

test('irmaos: so os canais do mesmo pai, na ordem que o Discord mostra (sem categoria)', () => {
  const irmaos = irmaosOrdenados(CANAIS, CAT);
  assert.deepEqual(irmaos.map((c) => c.name), ['bump', 'inferno', 'confessionario', 'logs']);
});

test('ordemDoInferno: inferno em primeiro, confessionario em segundo, resto como estava', () => {
  // cena do bug: o confessionario renasceu em cima do inferno (posicoes 0 e 1)
  const irmaos = irmaosOrdenados([
    ch('c-conf', 'confessionario', 0),
    ch('c-inf', 'inferno', 1),
    ch('c-bump', 'bump', 2),
    ch('c-logs', 'logs', 3),
  ], CAT);
  assert.deepEqual(ordemDoInferno(irmaos).map((c) => c.name), ['inferno', 'confessionario', 'bump', 'logs']);
});

test('ordemDoInferno: quando ja esta certo nao reordena nada', () => {
  const irmaos = irmaosOrdenados([
    ch('c-inf', 'inferno', 0),
    ch('c-conf', 'confessionario', 1),
    ch('c-logs', 'logs', 2),
  ], CAT);
  const ordem = ordemDoInferno(irmaos);
  assert.deepEqual(ordem.map((c) => c.name), ['inferno', 'confessionario', 'logs']);
  assert.deepEqual(ordem.map((c) => c.id), irmaos.map((c) => c.id)); // nenhuma troca
});

test('ordemDoInferno: sem canal inferno no pai, mantem tudo como esta', () => {
  const irmaos = irmaosOrdenados([
    ch('c-bump', 'bump', 0),
    ch('c-conf', 'confessionario', 1),
  ], CAT);
  assert.deepEqual(ordemDoInferno(irmaos).map((c) => c.name), ['bump', 'confessionario']);
});

test('ordemDoInferno: acha o inferno mesmo fora de ordem e com nome com ponto', () => {
  const irmaos = irmaosOrdenados([
    ch('c-logs', 'logs', 0),
    ch('c-bump', 'bump', 1),
    ch('c-conf', '・confessionario', 2),
    ch('c-inf', 'inferno', 3),
  ], CAT);
  assert.deepEqual(ordemDoInferno(irmaos).map((c) => c.name), ['inferno', '・confessionario', 'logs', 'bump']);
});

test('enfeite no nome nao engana: ・confessionario / Confessionário / ・inferno', () => {
  assert.equal(ehInferno({ name: 'inferno' }), true);
  assert.equal(ehInferno({ name: '・inferno' }), true);
  assert.equal(ehInferno({ name: 'portas do inferno' }), false); // outro canal
  assert.equal(ehConfessionario({ name: '・Confessionário' }), true);
  assert.equal(ehConfessionario({ name: 'confessionario' }), true);
  assert.equal(ehConfessionario({ name: 'bump' }), false);
});

test('posicaoDoConfessionario: nasce logo abaixo do inferno (nao no topo)', () => {
  const semConf = irmaosOrdenados([
    ch('c-bump', 'bump', 0),
    ch('c-inf', 'inferno', 1),
    ch('c-logs', 'logs', 2),
  ], CAT);
  assert.equal(posicaoDoConfessionario(semConf, 1), 2); // inferno(0? nao) -> abaixo do inferno
  const certo = irmaosOrdenados([ch('c-inf', 'inferno', 0), ch('c-logs', 'logs', 1)], CAT);
  assert.equal(posicaoDoConfessionario(certo, 1), 1); // inferno primeiro -> conf em segundo
});

test('posicaoDoConfessionario: sem inferno, mantem o indice antigo', () => {
  const semConf = irmaosOrdenados([ch('c-bump', 'bump', 0), ch('c-logs', 'logs', 1)], CAT);
  assert.equal(posicaoDoConfessionario(semConf, 1), 1);
  assert.equal(posicaoDoConfessionario(semConf, 9), 2); // nunca passa do fim
});

test('montarReindexacao: renumbera todo mundo de 0..n-1 na ordem desejada', () => {
  const ordem = irmaosOrdenados([ch('c-inf', 'inferno', 0), ch('c-conf', 'confessionario', 1)], CAT);
  assert.deepEqual(montarReindexacao(ordem), [
    { id: 'c-inf', position: 0 },
    { id: 'c-conf', position: 1 },
  ]);
});

function fakeGuild(canais) {
  const patches = [];
  return {
    id: 'guild-1',
    patches,
    channels: {
      cache: new Map(canais.map((c) => [c.id, c])),
      fetch: async () => new Map(canais.map((c) => [c.id, c])),
      setPositions: async (lista) => { patches.push(lista); },
    },
  };
}

test('aplicarOrdem: um PATCH so com todos os irmaos renumerados', async () => {
  const g = fakeGuild(CANAIS);
  const irmaos = irmaosOrdenados(CANAIS, CAT);
  const alvo = await aplicarOrdem(g, ordemDoInferno(irmaos));
  assert.equal(g.patches.length, 1);
  assert.deepEqual(g.patches[0], [
    { channel: 'c-inf', position: 0 },
    { channel: 'c-conf', position: 1 },
    { channel: 'c-bump', position: 2 },
    { channel: 'c-logs', position: 3 },
  ]);
  assert.deepEqual(alvo, [
    { id: 'c-inf', position: 0 },
    { id: 'c-conf', position: 1 },
    { id: 'c-bump', position: 2 },
    { id: 'c-logs', position: 3 },
  ]);
});

test('garantirOrdemInferno: conserta a ordem depois que o nuke recria o canal', async () => {
  // estado do bug: confessionario renasceu no topo, inferno ficou em segundo
  const g = fakeGuild([
    ch('c-conf', 'confessionario', 0),
    ch('c-inf', 'inferno', 1),
    ch('c-bump', 'bump', 2),
    ch('c-logs', 'logs', 3),
  ]);
  const logs = [];
  const r = await garantirOrdemInferno(g, g.channels.cache.get('c-conf'), { log: (...a) => logs.push(a) });
  assert.equal(r.ok, true);
  assert.equal(r.mudou, true);
  assert.deepEqual(r.ordem, ['inferno', 'confessionario', 'bump', 'logs']);
  assert.equal(g.patches.length, 1);
  assert.deepEqual(g.patches[0].map((p) => p.channel), ['c-inf', 'c-conf', 'c-bump', 'c-logs']);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'ORDEM_CANAIS');
});

test('garantirOrdemInferno: na ordem certa nao gasta PATCH nenhum', async () => {
  const g = fakeGuild([
    ch('c-inf', 'inferno', 0),
    ch('c-conf', 'confessionario', 1),
    ch('c-logs', 'logs', 2),
  ]);
  const r = await garantirOrdemInferno(g, g.channels.cache.get('c-conf'));
  assert.equal(r.mudou, false);
  assert.deepEqual(r.ordem, ['inferno', 'confessionario', 'logs']);
  assert.equal(g.patches.length, 0);
});

test('garantirOrdemInferno: falha de permissao nao derruba o nuke (so avisa)', async () => {
  const g = fakeGuild([
    ch('c-conf', 'confessionario', 0),
    ch('c-inf', 'inferno', 1),
  ]);
  g.channels.setPositions = async () => { throw new Error('Missing Permissions'); };
  const r = await garantirOrdemInferno(g, g.channels.cache.get('c-conf'));
  assert.equal(r.ok, false);
  assert.match(r.erro, /Missing Permissions/);
  assert.deepEqual(r.ordem, ['inferno', 'confessionario']);
});
