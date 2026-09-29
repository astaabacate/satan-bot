const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aplicarLimiteVoz, canaisDeVoz, normalizarLimite, LIMITE_MAX } = require('../scripts/call-limite');

function fakeGuild(canais) {
  const cache = new Map(canais.map((c) => [c.id, { ...c, edits: [] }]));
  const guild = {
    id: 'g1',
    channels: {
      cache,
      // o que interessa: o edit chega com o userLimit certo e fica registrado
    },
  };
  for (const c of cache.values()) {
    c.edit = async (spec) => { c.edits.push(spec); c.userLimit = spec.userLimit; return c; };
  }
  return guild;
}

const CANAIS = [
  { id: 'v1', name: 'purgatorio', type: 2, userLimit: 0 },
  { id: 'v2', name: 'gf', type: 2, userLimit: 0 },
  { id: 'v3', name: 'caos', type: 2, userLimit: 10 },
  { id: 't1', name: 'bump', type: 0, userLimit: undefined },
  { id: 'c1', name: '・', type: 4, userLimit: undefined },
];

test('normalizarLimite: 0..99, arredonda e rejeita lixo', () => {
  assert.equal(normalizarLimite('99'), 99);
  assert.equal(normalizarLimite(0), 0);
  assert.equal(normalizarLimite(500), LIMITE_MAX); // Discord nao aceita > 99
  assert.equal(normalizarLimite(-3), 0);
  assert.equal(normalizarLimite(9.6), 10);
  assert.equal(normalizarLimite('abc'), null);
});

test('canaisDeVoz: so tipo 2 (texto e categoria ficam fora)', () => {
  const g = fakeGuild(CANAIS);
  assert.deepEqual(canaisDeVoz(g).map((c) => c.name), ['purgatorio', 'gf', 'caos']);
  assert.deepEqual(canaisDeVoz(g, { apenas: '・gf' }).map((c) => c.name), ['gf']);
});

test('aplicarLimiteVoz: mete o limite em todas as calls e NAO encosta em texto/categoria', async () => {
  const g = fakeGuild(CANAIS);
  const rel = await aplicarLimiteVoz(g, 99);
  assert.equal(rel.limite, 99);
  assert.deepEqual(rel.aplicados.map((a) => a.nome), ['purgatorio', 'gf', 'caos']);
  assert.equal(rel.erros.length, 0);
  for (const id of ['v1', 'v2', 'v3']) assert.equal(g.channels.cache.get(id).userLimit, 99);
  assert.equal(g.channels.cache.get('t1').edits.length, 0); // canal de texto intocado
  assert.equal(g.channels.cache.get('c1').edits.length, 0); // categoria intocada
});

test('aplicarLimiteVoz: call que ja ta no limite nao gasta requisicao', async () => {
  const g = fakeGuild(CANAIS);
  const rel = await aplicarLimiteVoz(g, 10);
  assert.deepEqual(rel.aplicados.map((a) => a.nome), ['purgatorio', 'gf']);
  assert.deepEqual(rel.pulados, ['caos']); // ja era 10
  assert.equal(g.channels.cache.get('v3').edits.length, 0);
});

test('aplicarLimiteVoz: 0 volta pro sem limite', async () => {
  const g = fakeGuild(CANAIS);
  const rel = await aplicarLimiteVoz(g, 0);
  assert.equal(rel.limite, 0);
  assert.equal(g.channels.cache.get('v3').userLimit, 0);
});

test('aplicarLimiteVoz: da pra aplicar so numa call pelo nome', async () => {
  const g = fakeGuild(CANAIS);
  const rel = await aplicarLimiteVoz(g, 20, { apenas: 'gf' });
  assert.deepEqual(rel.aplicados.map((a) => a.nome), ['gf']);
  assert.equal(g.channels.cache.get('v1').userLimit, 0); // as outras seguem como estao
  assert.equal(g.channels.cache.get('v2').userLimit, 20);
});

test('aplicarLimiteVoz: call que nao existe e limite invalido viram erro (sem mexer em nada)', async () => {
  const g = fakeGuild(CANAIS);
  const ruim = await aplicarLimiteVoz(g, 'muitas pessoas');
  assert.match(ruim.erros[0], /limite invalido/);
  const semCall = await aplicarLimiteVoz(g, 10, { apenas: 'nao-existe' });
  assert.match(semCall.erros[0], /não achei a call/);
  for (const id of ['v1', 'v2', 'v3']) assert.equal(g.channels.cache.get(id).edits.length, 0);
});

test('aplicarLimiteVoz: erro do Discord numa call nao derruba as outras', async () => {
  const g = fakeGuild(CANAIS);
  g.channels.cache.get('v2').edit = async () => { throw new Error('Missing Permissions'); };
  const rel = await aplicarLimiteVoz(g, 99);
  assert.deepEqual(rel.aplicados.map((a) => a.nome), ['purgatorio', 'caos']);
  assert.equal(rel.erros.length, 1);
  assert.match(rel.erros[0], /gf/);
});

// ---------- cada call com o seu limite ----------
const { parsearCallLimite, aplicarLimitesVoz } = require('../scripts/call-limite');

test('parsearCallLimite: numero sozinho vale pra todas', () => {
  const { plano, erros } = parsearCallLimite('99');
  assert.deepEqual(plano, [{ nome: null, limite: 99 }]);
  assert.deepEqual(erros, []);
});

test('parsearCallLimite: numero + nomes aplica so naqueles', () => {
  const { plano } = parsearCallLimite('99 gf caos');
  assert.deepEqual(plano, [{ nome: 'gf', limite: 99 }, { nome: 'caos', limite: 99 }]);
});

test('parsearCallLimite: nome=limite aceita um limite por call (e virgula)', () => {
  const { plano, erros } = parsearCallLimite('gf=2, caos=10 purgatorio=99');
  assert.deepEqual(plano, [
    { nome: 'gf', limite: 2 },
    { nome: 'caos', limite: 10 },
    { nome: 'purgatorio', limite: 99 },
  ]);
  assert.deepEqual(erros, []);
});

test('parsearCallLimite: sem numero e sem nome= devolve erro explicando o uso', () => {
  const { plano, erros } = parsearCallLimite('muita gente');
  assert.deepEqual(plano, []);
  assert.match(erros[0], /\.call limite 99/);
});

test('aplicarLimitesVoz: cada call fica com o seu', async () => {
  const g = fakeGuild(CANAIS);
  const { plano } = parsearCallLimite('gf=2 caos=20 purgatorio=99');
  const rel = await aplicarLimitesVoz(g, plano);
  assert.equal(rel.erros.length, 0);
  assert.equal(g.channels.cache.get('v1').userLimit, 99); // purgatorio
  assert.equal(g.channels.cache.get('v2').userLimit, 2); // gf
  assert.equal(g.channels.cache.get('v3').userLimit, 20); // caos (era 10)
  assert.deepEqual(rel.aplicados.map((a) => `${a.nome}:${a.limite}`).sort(), ['caos:20', 'gf:2', 'purgatorio:99']);
  assert.deepEqual(rel.pulados, []);
});

test('aplicarLimitesVoz: call inexistente no plano vira erro mas as outras aplicam', async () => {
  const g = fakeGuild(CANAIS);
  const { plano } = parsearCallLimite('gf=2 naoexiste=5');
  const rel = await aplicarLimitesVoz(g, plano);
  assert.equal(g.channels.cache.get('v2').userLimit, 2);
  assert.equal(rel.erros.length, 1);
  assert.match(rel.erros[0], /naoexiste/);
});

test('aplicarLimitesVoz: call que ja esta no limite pedido vai pra pulados', async () => {
  const g = fakeGuild(CANAIS); // caos ja esta em 10
  const { plano } = parsearCallLimite('gf=2 caos=10');
  const rel = await aplicarLimitesVoz(g, plano);
  assert.deepEqual(rel.aplicados.map((a) => a.nome), ['gf']);
  assert.deepEqual(rel.pulados, ['caos']);
  assert.equal(g.channels.cache.get('v3').edits.length, 0); // zero requisição
});
