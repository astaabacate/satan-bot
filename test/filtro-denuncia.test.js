const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classificarDenuncia, normalizar, colado, resumoRegras } = require('../scripts/filtro-denuncia');

test('pega as categorias que derrubam servidor', () => {
  assert.equal(classificarDenuncia('isso aqui é pornografia infantil mesmo').cat, 'menor-sexual');
  assert.equal(classificarDenuncia('me manda foto de menor nu').cat, 'menor-sexual');
  assert.equal(classificarDenuncia('menor de 13 anos nua').cat, 'menor-sexual');
  assert.equal(classificarDenuncia('vou me matar hoje').cat, 'automutilacao');
  assert.equal(classificarDenuncia('vou te matar se você não pagar').cat, 'ameaca');
  assert.equal(classificarDenuncia('manda pix que eu mostro').cat, 'extorsao');
  assert.equal(classificarDenuncia('meu cpf é 529.982.247-25').cat, 'dox');
  assert.equal(classificarDenuncia('vou postar seu nude no twitter').cat, 'extorsao');
});

test('furando filtro: letra trocada, pontuação e zero-width', () => {
  assert.equal(classificarDenuncia('p0rn0gr4f14 inf4nt1l').cat, 'menor-sexual');
  assert.equal(classificarDenuncia('p.o.r.n.o infantil').cat, 'menor-sexual');
  assert.equal(classificarDenuncia('papo infantil').cat, 'menor-sexual'); // zero-width no meio
  assert.equal(classificarDenuncia('M E N O R   N U').cat, 'menor-sexual');
  assert.equal(classificarDenuncia('vou te mat4r').cat, 'ameaca');
  assert.equal(classificarDenuncia('meu cpf: 52998224725').cat, 'dox');
  assert.equal(classificarDenuncia('liga (11) 91234-5678').cat, 'dox');
  assert.equal(classificarDenuncia('meu email é mano@exemplo.com.br').cat, 'dox');
});

test('não derruba mensagem normal (falso positivo é o pior erro aqui)', () => {
  for (const txt of [
    'kkkkkkkkkkk', 'boa noite galera', 'vou matar a fome', 'to com sono',
    'capa do filme é Linda', 'eu quero morrer de rir',
    'me mato de rir kkk', 'vou explodir essa foto', 'gorei nesse bottoms',
    'papo de macho', 'aquele jogo é daxo', 'amanhã tem aula', 'bom dia',
    'qualquer coisa me chama', 'to com medo do',
  ]) {
    const r = classificarDenuncia(txt);
    assert.equal(r, null, `falso positivo em: "${txt}" (${r && r.cat})`);
  }
});

test('normalização e colado', () => {
  assert.equal(normalizar('  ÇÃO,   tudo\n bem '), 'cao tudo bem');
  assert.equal(colado('p o r n o'), 'porno');
  assert.equal(classificarDenuncia(null), null);
  assert.equal(classificarDenuncia(''), null);
});

test('só o conteúdo mais grave marca como grave (alerta vermelho pro dono)', () => {
  const graves = resumoRegras().filter((r) => r.grave).map((r) => r.cat);
  assert.deepEqual(graves, ['menor-sexual', 'automutilacao', 'ameaca', 'extorsao']);
  assert.equal(classificarDenuncia('meu cpf é 529.982.247-25').grave, false);
  assert.equal(classificarDenuncia('pornografia infantil').grave, true);
});


test('CP e siglas relacionadas são bloqueadas inclusive em usos não sexuais', () => {
  for (const text of ['CP', 'cp do pokemon', 'manda cp', 'c.p', 'C P', 'c-p',
    'c\u200bp', 'c\u2060p', 'ＣＰ', '(cp)', 'cp!', 'c💀p', 'CP brincadeira',
    'csam', 'C.S.A.M.', 'CSEM', 'c s e m']) {
    const result = classificarDenuncia(text);
    assert.equal(result?.cat, 'menor-sexual', text);
    assert.equal(result.grave, true, text);
  }
});

test('siglas não são substrings de palavras ou letras entre palavras', () => {
  for (const text of ['CPF', 'TCP', 'SCP', 'cpus', 'recepcao', 'abc poe',
    'pc para jogar', 'c pessoa', 'csample', 'cseminario', 'acp', 'cp2', 'ação cpá']) {
    assert.equal(classificarDenuncia(text), null, text);
  }
});

test('amplia termos de proteção infantil sem exceção por alegar brincadeira', () => {
  for (const text of ['material de abuso sexual infantil', 'exploração sexual de menores',
    'child sexual abuse material', 'child sexual exploitation material',
    'pedopornografia', 'pedofilia', 'nudes de menores', 'pornografia de crianças',
    'pornografia infantil brincadeira', 'pedofilia de rir']) {
    assert.equal(classificarDenuncia(text)?.cat, 'menor-sexual', text);
  }
});
