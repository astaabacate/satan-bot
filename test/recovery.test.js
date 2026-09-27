const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkBot, runIsUsable, BOT_STEP } = require('../scripts/check-bot');
const { watchDiscord } = require('../scripts/discord-health');
const now = Date.parse('2026-09-26T04:32:00Z');
const run = (status = 'in_progress', minutes = 60) => ({
  id: 1, head_branch: 'main', status, created_at: new Date(now - minutes * 60_000).toISOString(),
});
const job = (stepStatus = 'in_progress') => ({
  name: 'bot', status: 'in_progress', started_at: run().created_at,
  steps: [{ name: BOT_STEP, status: stepStatus, conclusion: stepStatus === 'completed' ? 'failure' : null }],
});
test('run em andamento com etapa falhada nao e bot vivo (incidente)', () => {
  assert.equal(runIsUsable(run(), [job('completed')], now), false);
});
test('etapa em andamento e saudavel dentro do limite', () => {
  assert.equal(runIsUsable(run(), [job()], now), true);
});
test('fila e instalacao recebem tolerancia, nao espera infinita', () => {
  for (const status of ['queued', 'requested', 'waiting', 'pending']) {
    assert.equal(runIsUsable(run(status, 2), [], now), true);
    assert.equal(runIsUsable(run(status, 20), [], now), false);
  }
  assert.equal(runIsUsable(run('in_progress', 2), [{ ...job(), steps: [] }], now), true);
  assert.equal(runIsUsable(run(), [{ ...job(), steps: [] }], now), false);
});
test('job finalizado ou mais velho que teto nao e saudavel', () => {
  assert.equal(runIsUsable(run(), [{ ...job(), status: 'completed' }], now), false);
  assert.equal(runIsUsable(run(), [{ ...job(), started_at: run('in_progress', 361).created_at }], now), false);
});
function fakeApi(runs, jobs) {
  const calls = [];
  return { calls, api: async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    if (method === 'POST') return null;
    return endpoint.includes('/jobs?') ? { jobs } : { workflow_runs: runs };
  } };
}
test('watchdog dispara substituto para run fantasma sem cancelar o antigo', async () => {
  const { api, calls } = fakeApi([run()], [job('completed')]);
  await checkBot(api, now);
  assert.deepEqual(calls.filter(c => c.method === 'POST'), [{ method: 'POST', endpoint: '/actions/workflows/satan.yml/dispatches', body: { ref: 'main' } }]);
});
test('nao duplica bot ativo, inicializando ou tentativa muito recente', async () => {
  for (const [runs, jobs] of [
    [[run()], [job()]], [[run('queued', 2)], []],
    [[run('completed', 2)], []], [[run(), run('queued', 2)], [job('completed')]],
  ]) {
    const { api, calls } = fakeApi(runs, jobs);
    await checkBot(api, now);
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  }
});
test('fila travada, ausencia de runs ou ultima falha antiga permitem recuperacao', async () => {
  for (const runs of [[], [run('queued', 20)], [run('completed', 10)]]) {
    const { api, calls } = fakeApi(runs, []);
    await checkBot(api, now);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  }
});
test('execucao em branch de trabalho nao bloqueia recuperacao da producao', async () => {
  const { api, calls } = fakeApi([{ ...run(), head_branch: 'arena/test' }], [job()]);
  await checkBot(api, now);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});
test('erro na API interrompe verificacao, nao dispara as cegas', async () => {
  let posts = 0;
  await assert.rejects(checkBot(async method => {
    if (method === 'POST') posts++;
    throw new Error('HTTP 403');
  }, now), /HTTP 403/);
  assert.equal(posts, 0);
});
test('Discord tem tolerancia para reconectar e reinicia se ficar offline', () => {
  let time = 0, ready = false, tick, destroyed = 0;
  const exits = [], logs = [];
  watchDiscord({ isReady: () => ready, destroy: () => destroyed++ }, {
    now: () => time, every: fn => { tick = fn; },
    exit: code => exits.push(code), log: (...args) => logs.push(args),
  });
  time = 90_000; tick(); assert.equal(exits.length, 0);
  ready = true; tick(); // reconectou: zera contagem
  ready = false; time = 180_000; tick(); assert.equal(exits.length, 0);
  time = 210_000; tick();
  assert.deepEqual(exits, [1]); assert.equal(destroyed, 1);
  assert.equal(logs[0][0], 'DISCORD_OFFLINE');
});
test('login que nunca fica pronto tambem reinicia', () => {
  let time = 0, tick, exit;
  watchDiscord({ isReady: () => false, destroy() {} }, {
    now: () => time, every: fn => { tick = fn; }, log() {}, exit: code => { exit = code; },
  });
  time = 120_000; tick(); assert.equal(exit, 1);
});
