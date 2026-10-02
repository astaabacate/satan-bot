const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT, normalizarRep, chaveSig, registrarRepeticao, decidirRepeticao,
  podarLedger, contarRepetidas,
} = require('../scripts/antiflood-regras');

// caso real de 02/10/2026 em #confessionario: tres contas repetindo a MESMA
// frase, cada uma mandando 1 copia a cada ~10-40s. Com a janela antiga de 30s
// e o castigo na 11a copia, isso passava batido ("o bot nao faz nada").
const FRASE = 'eai boy prazer 17 anos alto cabelo cacheado';

test('padroes: 2a copia apaga, 3a castiga, janela de 5 min', () => {
  const c = normalizarRep({});
  assert.equal(c.repApagar, 2);
  assert.equal(c.repCastigo, 3);
  assert.equal(c.repMs, DEFAULT.repMs);
  assert.equal(decidirRepeticao(1, {}), null);
  assert.equal(decidirRepeticao(2, {}), 'apagar');
  assert.equal(decidirRepeticao(3, {}), 'castigar');
  assert.equal(decidirRepeticao(9, {}), 'castigar');
});

test('a MESMA frase repetida em ~40s cai na escada (antes passava)', () => {
  const ledger = {};
  const t0 = 1_800_000_000_000;
  const autor = '111';
  // 1a copia
  let r = registrarRepeticao(ledger, { userId: autor, sig: FRASE, agora: t0 });
  assert.equal(r.qtd, 1);
  assert.equal(decidirRepeticao(r.qtd, {}), null);
  // 2a copia 40s depois (a janela antiga de 30s perdia isso)
  r = registrarRepeticao(ledger, { userId: autor, sig: FRASE, agora: t0 + 40_000 });
  assert.equal(r.qtd, 2);
  assert.equal(decidirRepeticao(r.qtd, {}), 'apagar');
  // 3a copia 40s depois -> castigo
  r = registrarRepeticao(ledger, { userId: autor, sig: FRASE, agora: t0 + 80_000 });
  assert.equal(r.qtd, 3);
  assert.equal(decidirRepeticao(r.qtd, {}), 'castigar');
});

test('ponta de frase diferente NAO conta como copia', () => {
  const ledger = {};
  const t0 = 1_000;
  registrarRepeticao(ledger, { userId: '1', sig: 'bom dia galera', agora: t0 });
  const r = registrarRepeticao(ledger, { userId: '1', sig: 'boa noite galera', agora: t0 + 5000 });
  assert.equal(r.qtd, 1);
});

test('fora da janela a conta comeca de novo', () => {
  const ledger = {};
  const t0 = 5_000;
  registrarRepeticao(ledger, { userId: '1', sig: FRASE, agora: t0 });
  registrarRepeticao(ledger, { userId: '1', sig: FRASE, agora: t0 + 1000 });
  // 6 min depois: as duas antigas saem da janela de 5 min
  const r = registrarRepeticao(ledger, { userId: '1', sig: FRASE, agora: t0 + 6 * 60_000 });
  assert.equal(r.qtd, 1);
  assert.equal(decidirRepeticao(r.qtd, {}), null);
});

test('contadores sao por autor (nao mistura gente diferente)', () => {
  const ledger = {};
  const t0 = 7_000;
  registrarRepeticao(ledger, { userId: 'a', sig: FRASE, agora: t0 });
  registrarRepeticao(ledger, { userId: 'a', sig: FRASE, agora: t0 + 1000 });
  const r = registrarRepeticao(ledger, { userId: 'b', sig: FRASE, agora: t0 + 2000 });
  assert.equal(r.qtd, 1); // b mandou a 1a copia dele
  assert.equal(contarRepetidas(ledger, { userId: 'a', sig: FRASE, agora: t0 + 3000 }), 2);
});

test('podar tira da memoria o que saiu da janela (ledger nao cresce pra sempre)', () => {
  const ledger = {};
  const t0 = 10_000;
  registrarRepeticao(ledger, { userId: 'x', sig: 'oi', agora: t0 });
  registrarRepeticao(ledger, { userId: 'y', sig: 'oi', agora: t0 });
  podarLedger(ledger, t0 + 6 * 60_000, {});
  assert.deepEqual(Object.keys(ledger), []);
});

test('podar limita quantas mensagens diferentes rastreamos por autor', () => {
  const ledger = {};
  const t0 = 20_000;
  for (let i = 0; i < 30; i++) {
    registrarRepeticao(ledger, { userId: 'z', sig: `msg ${i}`, agora: t0 + i });
  }
  podarLedger(ledger, t0 + 30, { maxChavesPorAutor: 5 });
  assert.equal(Object.keys(ledger.z).length, 5);
});

test('mensagem curtinha pode usar janela curta (cfg.repMs) sem virar flood', () => {
  const ledger = {};
  const t0 = 15_000;
  // bot passa repMs: 30000 pra "kkk"/emoji: 40s depois ja nao conta
  registrarRepeticao(ledger, { userId: '1', sig: 'kkk', agora: t0, cfg: { repMs: 30_000 } });
  const r = registrarRepeticao(ledger, { userId: '1', sig: 'kkk', agora: t0 + 40_000, cfg: { repMs: 30_000 } });
  assert.equal(r.qtd, 1);
  assert.equal(decidirRepeticao(r.qtd, {}), null);
});

test('chaveSig e estavel e distingue textos diferentes', () => {
  assert.equal(chaveSig(FRASE), chaveSig(FRASE));
  assert.notEqual(chaveSig(FRASE), chaveSig(FRASE + '!'));
  assert.equal(typeof chaveSig(''), 'string');
});

test('estado persistido (JSON) continua valendo depois de recarregar', () => {
  const ledger = {};
  const t0 = 30_000;
  registrarRepeticao(ledger, { userId: '1', sig: FRASE, agora: t0 });
  registrarRepeticao(ledger, { userId: '1', sig: FRASE, agora: t0 + 60_000 });
  // simula o bot reiniciando: estado vai e volta pelo JSON do antiflood_state.json
  const recarregado = JSON.parse(JSON.stringify(ledger));
  const r = registrarRepeticao(recarregado, { userId: '1', sig: FRASE, agora: t0 + 120_000 });
  assert.equal(r.qtd, 3);
  assert.equal(decidirRepeticao(r.qtd, {}), 'castigar');
});
