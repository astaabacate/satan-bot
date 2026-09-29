const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ehErroDeAutenticacao, corridaComTimeout, LoginTimeoutError, TIMEOUT_CODE,
} = require('../scripts/login-guard');

test('token morto (TokenInvalid/401/403) e reconhecido como autenticacao', () => {
  assert.equal(ehErroDeAutenticacao(Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' })), true);
  assert.equal(ehErroDeAutenticacao({ status: 401, message: 'Unauthorized' }), true);
  assert.equal(ehErroDeAutenticacao({ code: 0, status: 403, message: 'Missing Access' }), true);
  assert.equal(ehErroDeAutenticacao(new Error('Authentication failed')), true); // fechamento 4004 do gateway
});

test('falha de rede/servidor nao e confundida com token invalido', () => {
  assert.equal(ehErroDeAutenticacao(new Error('Client network socket disconnected before secure TLS connection was established')), false);
  assert.equal(ehErroDeAutenticacao({ status: 500, message: 'Internal Server Error' }), false);
  assert.equal(ehErroDeAutenticacao(null), false);
  assert.equal(ehErroDeAutenticacao(undefined), false);
});

test('login que nunca resolve estoura por tempo (nao vira processo zumbi)', async () => {
  const timers = [];
  const agendar = (fn, ms) => timers.push({ fn, ms, cancelado: false }) && timers[timers.length - 1];
  const cancelar = (t) => { t.cancelado = true; };
  const travado = corridaComTimeout(new Promise(() => {}), 120_000, { setTimeout: agendar, clearTimeout: cancelar });
  const erro = travado.then(() => null, (e) => e);
  assert.equal(timers[0].ms, 120_000);
  assert.equal(timers[0].cancelado, false);
  timers[0].fn(); // o teto de tempo dispara
  const e = await erro;
  assert.ok(e instanceof LoginTimeoutError);
  assert.equal(e.code, TIMEOUT_CODE);
});

test('login normal cancela o relogio e propaga valor/erro original', async () => {
  const timers = [];
  const agendar = (fn, ms) => timers.push({ fn, ms, cancelado: false }) && timers[timers.length - 1];
  const cancelar = (t) => { t.cancelado = true; };
  assert.equal(await corridaComTimeout(Promise.resolve('token'), 1000, { setTimeout: agendar, clearTimeout: cancelar }), 'token');
  assert.equal(timers[0].cancelado, true);
  const falha = Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' });
  await assert.rejects(corridaComTimeout(Promise.reject(falha), 1000, { setTimeout: agendar, clearTimeout: cancelar }), /invalid token/);
  assert.equal(timers[1].cancelado, true);
});
