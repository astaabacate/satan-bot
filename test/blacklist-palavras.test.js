const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  estadoVazio, chave, separarTermos, termoValido, adicionarPalavras, removerPalavras,
  listarPalavras, casarPalavras, registrarUso, MAX_PALAVRAS,
} = require('../scripts/blacklist-palavras');

function comTermos(...termos) {
  const st = estadoVazio();
  adicionarPalavras(st, termos, { por: 'dono' });
  return st;
}

test('separarTermos: aceita virgula, pipe, ponto-e-virgula e quebra de linha', () => {
  assert.deepEqual(separarTermos('cu, bosta|merda;bosta\ncaralho'), ['cu', 'bosta', 'merda', 'bosta', 'caralho']);
  assert.deepEqual(separarTermos('  só um  '), ['só um']);
  assert.deepEqual(separarTermos(''), []);
});

test('chave normaliza: acento, caixa e pontuacao dão na mesma palavra', () => {
  assert.equal(chave('CÚ'), chave('cu'));
  assert.equal(chave('  Cu  '), chave('cu'));
  assert.equal(chave('c.u'), 'c u'); // invisivel/pontuacao vira espaco
});

test('termoValido: recusa vazio e termo gigante', () => {
  assert.equal(termoValido('cu'), true);
  assert.equal(termoValido('   '), false);
  assert.equal(termoValido('a'.repeat(200)), false);
});

test('adicionarPalavras: adiciona, avisa o que ja tinha e guarda quem pediu', () => {
  const st = estadoVazio();
  const r1 = adicionarPalavras(st, ['cu', 'bosta'], { por: 'dono1' });
  assert.deepEqual(r1.adicionadas, ['cu', 'bosta']);
  const r2 = adicionarPalavras(st, ['CU', 'nova'], { por: 'dono1' });
  assert.deepEqual(r2.jaTinham, ['CU']); // repetido (mesma chave)
  assert.deepEqual(r2.adicionadas, ['nova']);
  assert.equal(st.palavras[chave('cu')].por, 'dono1');
  assert.ok(st.palavras[chave('cu')].criadoEm);
});

test('adicionarPalavras: termo vazio ou gigante vai pra invalidas sem sujar a lista', () => {
  const st = estadoVazio();
  const r = adicionarPalavras(st, ['ok', '   ', 'a'.repeat(120)]);
  assert.deepEqual(r.adicionadas, ['ok']);
  assert.equal(r.invalidas.length, 2);
  assert.equal(Object.keys(st.palavras).length, 1);
});

test('adicionarPalavras: respeita o teto e avisa o que ficou de fora', () => {
  const st = estadoVazio();
  const termos = [];
  for (let i = 0; i < MAX_PALAVRAS + 5; i++) termos.push('termo' + i.toString(26).split('').map((d) => String.fromCharCode(97 + parseInt(d, 26))).join(''));
  const r = adicionarPalavras(st, termos);
  assert.equal(r.adicionadas.length, MAX_PALAVRAS);
  assert.equal(r.semEspaco.length, 5);
});

test('removerPalavras: remove pelo termo, por acento diferente e avisa o que nao tinha', () => {
  const st = comTermos('cu', 'bosta');
  const r = removerPalavras(st, ['CÚ', 'naoexiste']);
  assert.deepEqual(r.removidas, ['cu']); // achou mesmo com acento/caixa
  assert.deepEqual(r.naoTinham, ['naoexiste']);
  assert.deepEqual(listarPalavras(st).map((p) => p.termo), ['bosta']);
});

test('removerPalavras: cai fora do estado tambem quando a chave normalizada difere', () => {
  const st = comTermos('c.u');
  const r = removerPalavras(st, ['c u']);
  assert.deepEqual(r.removidas, ['c.u']);
  assert.equal(Object.keys(st.palavras).length, 0);
});

test('listarPalavras: vem em ordem alfabetica', () => {
  const st = comTermos('zebra', 'abacaxi', 'macaco');
  assert.deepEqual(listarPalavras(st).map((p) => p.termo), ['abacaxi', 'macaco', 'zebra']);
});

test('casarPalavras: pega no meio da frase, em caixa alta e com letra esticada', () => {
  const st = comTermos('cu', 'bosta');
  assert.equal(casarPalavras('que cu grande', st).termo, 'cu');
  assert.equal(casarPalavras('ESCREVI CU ALTO', st).termo, 'cu');
  assert.equal(casarPalavras('cuuu', st).termo, 'cu'); // letra esticada no fim
  assert.equal(casarPalavras('frase limpa', st), null);
});

test('casarPalavras: evasao com pontuacao no meio pega no texto colado (4+ letras)', () => {
  const st = comTermos('bosta');
  assert.equal(casarPalavras('mandou um b.o.s.t.a', st).termo, 'bosta');
  assert.equal(casarPalavras('mandou um b o s t a', st).termo, 'bosta');
  assert.equal(casarPalavras('mandou um bosta', st).termo, 'bosta');
});

test('casarPalavras: frase inteira tambem pode ser bloqueada', () => {
  const st = comTermos('vai se fuder');
  assert.equal(casarPalavras('VAI   SE   FUDER', st).termo, 'vai se fuder');
  assert.equal(casarPalavras('vai se fu-der', st).termo, 'vai se fuder');
  assert.equal(casarPalavras('vai ser fuder', st), null); // palavra do meio diferente
});

test('casarPalavras: palavra inteira — nao derruba quem so tem o termo no meio', () => {
  const st = comTermos('cu');
  assert.equal(casarPalavras('ele é inculo', st), null); // "inculo" contem "cu"
  assert.equal(casarPalavras('diz cu', st).termo, 'cu');
  assert.equal(casarPalavras('tomar c.u', st).termo, 'cu'); // evasao: casa
  const st2 = comTermos('puta');
  assert.equal(casarPalavras('putaria', st2), null); // sufixo: precisa bloquear a variante
  assert.equal(casarPalavras('aquela puta', st2).termo, 'puta');
});

test('casarPalavras: sem texto ou sem lista, nada acontece', () => {
  assert.equal(casarPalavras('', comTermos('cu')), null);
  assert.equal(casarPalavras('oi', estadoVazio()), null);
  assert.equal(casarPalavras(null, null), null);
});

test('registrarUso: conta quantas vezes a palavra pegou (e quando)', () => {
  const st = comTermos('cu');
  const hit = casarPalavras('fala cu', st);
  registrarUso(st, hit.chave);
  registrarUso(st, hit.chave);
  assert.equal(st.palavras[hit.chave].usos, 2);
  assert.ok(st.palavras[hit.chave].ultimoUso);
  assert.equal(registrarUso(st, 'chave-que-nao-existe'), false);
});
