const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllBanIds, unbanIds, createUnbanAllCommand } = require('../scripts/unban-all');

function fixture() {
  const sent = [], removed = [], logs = [], errors = [];
  let time = 0, allowed = true;
  const guild = {
    id: 'guild-one',
    members: { fetchMe: async () => ({ permissions: { has: name => name === 'BanMembers' && allowed } }) },
    bans: {
      fetch: async () => new Map([['1', {}], ['2', {}]]),
      remove: async (id, reason) => { removed.push({ id, reason }); },
    },
  };
  const handle = createUnbanAllCommand({ ownerId: 'owner', now: () => time,
    send: async (_message, text) => sent.push(text), log: (tag, data) => logs.push({ tag, data }),
    onError: error => errors.push(error), isBlacklisted: id => id === '2',
  });
  const message = (content, extra = {}) => ({ content, author: { id: 'owner', bot: false }, guild, channelId: 'channel-one', ...extra });
  return { handle, message, guild, sent, removed, logs, errors,
    setTime: value => { time = value; }, setPermission: value => { allowed = value; } };
}

test('pagina todos os banimentos, inclusive mais de mil e sem cache', async () => {
  const calls = [];
  const ids = await fetchAllBanIds({ bans: { fetch: async options => {
    calls.push(options);
    return options.after ? new Map([['1001', {}]])
      : new Map(Array.from({ length: 1000 }, (_, n) => [String(1000 - n), {}]));
  } } });
  assert.equal(ids.length, 1001);
  assert.deepEqual(calls, [{ limit: 1000, cache: false }, { limit: 1000, cache: false, after: '1000' }]);
});
test('interrompe paginacao que nao avanca', async () => {
  const page = new Map(Array.from({ length: 1000 }, (_, n) => [String(n + 1), {}]));
  await assert.rejects(fetchAllBanIds({ bans: { fetch: async () => page } }), /nao avancou/);
});
test('somente dono humano e sem webhook pode usar; ignora outros comandos', async () => {
  const f = fixture();
  assert.equal(await f.handle(f.message('.menu')), false);
  for (const extra of [{ author: { id: 'other' } }, { author: { id: 'owner', bot: true } }, { webhookId: 'wh' }]) {
    await f.handle(f.message('.desbanir todos', extra));
  }
  assert.equal(f.sent.length, 0); assert.equal(f.removed.length, 0);
});
test('em DM orienta usar no servidor sem remover bans', async () => {
  const f = fixture(); await f.handle(f.message('.desbanir todos', { guild: null }));
  assert.match(f.sent[0], /em um canal do servidor/); assert.equal(f.removed.length, 0);
});
test('exige permissao antes de preparar ou executar e nao desbane sem confirmacao', async () => {
  const f = fixture();
  await f.handle(f.message('.desbanir todos confirmar'));
  assert.match(f.sent.at(-1), /sem confirmação válida/);
  f.setPermission(false);
  await f.handle(f.message('.desbanir todos'));
  assert.match(f.sent.at(-1), /Banir membros/);
  assert.equal(f.removed.length, 0);
});
test('pede confirmacao, desbane sequencialmente e avisa sobre blacklist sem altera-la', async () => {
  const f = fixture();
  await f.handle(f.message(' .DESBANIR   TODOS '));
  assert.equal(f.removed.length, 0);
  assert.match(f.sent[0], /blacklist automática \*\*não será apagada/);
  await f.handle(f.message('.desbanir todos confirmar'));
  assert.deepEqual(f.removed.map(x => x.id), ['1', '2']);
  assert.ok(f.removed.every(x => x.reason.includes('owner')));
  assert.match(f.sent.at(-1), /Desbanidos: \*\*2\*\*/);
  assert.match(f.sent.at(-1), /\*\*1\*\* dos desbanidos continuam na blacklist/);
  assert.equal(f.logs.at(-1).tag, 'DESBANIR_FIM');
  await f.handle(f.message('.desbanir todos confirmar'));
  assert.equal(f.removed.length, 2); // confirmacao consumida
});
test('confirmacao limitada ao canal, servidor, prazo e pode ser cancelada', async () => {
  const f = fixture();
  await f.handle(f.message('.desbanir todos'));
  await f.handle(f.message('.desbanir todos confirmar', { channelId: 'other' }));
  await f.handle(f.message('.desbanir todos confirmar', { guild: { ...f.guild, id: 'other' } }));
  assert.equal(f.removed.length, 0);
  f.setTime(60_000);
  await f.handle(f.message('.desbanir todos confirmar'));
  assert.equal(f.removed.length, 0);
  await f.handle(f.message('.desbanir todos'));
  await f.handle(f.message('.desbanir cancelar'));
  await f.handle(f.message('.desbanir todos confirmar'));
  assert.equal(f.removed.length, 0);
});
test('revalida permissoes ao confirmar', async () => {
  const f = fixture(); await f.handle(f.message('.desbanir todos'));
  f.setPermission(false); await f.handle(f.message('.desbanir todos confirmar'));
  assert.equal(f.removed.length, 0); assert.match(f.sent.at(-1), /Banir membros/);
});
test('lista vazia retorna mensagem correta', async () => {
  const f = fixture(); f.guild.bans.fetch = async () => new Map();
  await f.handle(f.message('.desbanir todos')); await f.handle(f.message('.desbanir todos confirmar'));
  assert.match(f.sent.at(-1), /não há pessoas banidas/);
});
test('falha ao listar nao remove nenhum ban e libera trava para nova tentativa', async () => {
  const f = fixture(); f.guild.bans.fetch = async () => { throw new Error('fetch failed'); };
  await f.handle(f.message('.desbanir todos')); await f.handle(f.message('.desbanir todos confirmar'));
  assert.equal(f.removed.length, 0); assert.equal(f.errors.length, 1);
  await f.handle(f.message('.desbanir todos'));
  assert.match(f.sent.at(-1), /Para confirmar/);
});
test('contabiliza falhas individuais e bans ja removidos, continuando os demais', async () => {
  const attempted = [];
  const result = await unbanIds({ id: 'guild', bans: { remove: async id => {
    attempted.push(id);
    if (id === '1') throw Object.assign(new Error('Unknown Ban'), { code: 10026 });
    if (id === '2') throw Object.assign(new Error('Server error'), { code: 500 });
  } } }, ['1', '2', '3'], { reason: 'test', log() {}, isBlacklisted: () => false });
  assert.deepEqual(attempted, ['1', '2', '3']);
  assert.deepEqual(result, { total: 3, removed: 1, alreadyRemoved: 1, failed: 1, pending: 0, blacklisted: 0 });
});
test('perda de permissao interrompe e conta pendentes', async () => {
  const result = await unbanIds({ id: 'guild', bans: { remove: async () => {
    throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
  } } }, ['1', '2', '3'], { reason: 'test', log() {}, isBlacklisted: () => false });
  assert.equal(result.failed, 1); assert.equal(result.pending, 2); assert.equal(result.removed, 0);
});
test('bloqueia operacoes simultaneas no mesmo servidor', async () => {
  const f = fixture();
  let release;
  f.guild.bans.fetch = () => new Promise(resolve => { release = resolve; });
  await f.handle(f.message('.desbanir todos'));
  const work = f.handle(f.message('.desbanir todos confirmar'));
  await f.handle(f.message('.desbanir todos confirmar'));
  assert.ok(f.sent.some(text => text.includes('já estou desbanindo')));
  // Permite que a primeira operacao chegue a listagem antes de desbloquear.
  await new Promise(resolve => setImmediate(resolve));
  release(new Map()); await work;
});
