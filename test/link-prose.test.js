const { test } = require('node:test');
const assert = require('node:assert/strict');

// replica da lógica corrigida de bot.js (stripCodeBlocks + normLinkText + temLink)
// Mantém sincronizado com bot.js; se bot.js mudar, este arquivo deve acompanhar.
const RE_INV_LINK = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2800\u3164\ufeff\ufe00-\ufe0f\ufff0-\ufff8\ufffe\uffff\u{e0000}-\u{e007f}]/gu;
const RE_LINK = /(?:https?:\/\/|www\.|\b[\p{L}0-9][\p{L}0-9-]{1,63}\.(?:[\p{L}]{2,24}|xn--[a-z0-9-]{2,59})(?:\b|\/))/iu;
const RE_INVITE = /(?:\b(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/invite\/|\bdiscord\.gg\/|\bdiscord\.me\/|\bdiscord\.io\/|\bdiscord\.li\/|\bdsc\.gg\/|\binvite\.gg\/|\bdisboard\.org\/server\b|\bdiscordservers\.com\/server\b|discord:\/\/-\/invite\/)/i;
function stripCodeBlocks(t) {
  return String(t || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ');
}
function normLinkText(t) {
  let s = String(t || '')
    .normalize('NFKC')
    .replace(RE_INV_LINK, '')
    .replace(/[。｡]/g, '.')
    .replace(/[⁄∕／\\]/g, '/');
  s = s.replace(/\s*\/\s*/g, '/');
  s = s.replace(/\s*\.\s*/g, (m, off, str) => {
    const hadSpace = /\s/.test(m);
    const after = str.slice(off + m.length);
    const next = after.trimStart()[0] || '';
    const isUpper = next && /[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÑ]/u.test(next);
    if (hadSpace && isUpper) return '. ';
    if (hadSpace) {
      const nextWord = after.trimStart().split(/[^a-z0-9-]/i)[0] || '';
      const low = nextWord.toLowerCase();
      const conhecidos = new Set(['com','net','org','io','gg','me','li','co','br','app','dev','xyz','info','tv','ai','is','de','fr','es','pt','it','nl','be','ch','at','pl','ru','cn','jp','kr','au','ca','uk','us','eu','online','site','store','tech','blog','shop','icu','top','win','vip','live','cloud','page','link','biz','pro','mobi','name','so','in','ph','id','my','sg','th','vn','nz','za','mx','ar','cl','pe','uy','py','bo','cr','gt','hn','ni','pa','sv','do','pr','hn','gl','to','cc','ws','fm','am','im','st','gs','vg','vc','ag','lc','sc','gd','tc','gy','bz','dm','kn','ms','tt','ht','com.br','net.br','org.br']);
      if (low && !conhecidos.has(low) && /^[a-z]{2,24}$/.test(low)) {
        return '. ';
      }
    }
    return '.';
  });
  return s.toLowerCase();
}
function temLink(t) {
  if (!t) return false;
  const semCodigo = stripCodeBlocks(t);
  const n = normLinkText(semCodigo);
  return RE_LINK.test(n) || RE_INVITE.test(n);
}

test('frase normal "Conta criada ontem. Perdeu?" não é link', () => {
  assert.equal(temLink('Conta criada ontem. Perdeu?'), false);
  assert.equal(temLink('Conta criada ontem. Perdeu? kkk'), false);
  assert.equal(temLink('Conta criada ontem. Perdeu'), false);
});

test('mesma frase dentro de bloco de código não é link', () => {
  assert.equal(temLink('```\nConta criada ontem. Perdeu?\n```'), false);
  assert.equal(temLink('```js\nConta criada ontem. Perdeu?\n```'), false);
  assert.equal(temLink('`Conta criada ontem. Perdeu?`'), false);
  assert.equal(temLink('veja ```Conta criada ontem. Perdeu?``` aqui'), false);
});

test('prosa comum com ponto + espaço + maiúscula não é link', () => {
  for (const txt of [
    'Olá. Tudo bem?',
    'Bom dia. Como vai?',
    'Ontem. Hoje. Amanhã.',
    'Ele disse oi. Ela respondeu.',
    'Teste. Outra frase.',
  ]) {
    assert.equal(temLink(txt), false, `falso positivo: "${txt}"`);
  }
});

test('link http/www ainda é detectado', () => {
  for (const txt of [
    'https://example.com',
    'http://exemplo.com.br/path',
    'www.example.com',
    'https://sub.dominio.com.br/abc?x=1',
    'visite https://example.com agora',
  ]) {
    assert.equal(temLink(txt), true, txt);
  }
});

test('convite discord ainda é detectado', () => {
  for (const txt of [
    'discord.gg/abc',
    'https://discord.com/invite/abc',
    'https://discord.gg/abc',
    'discord.gg/abc123',
    'disboard.org/server',
  ]) {
    assert.equal(temLink(txt), true, txt);
  }
});

test('convite obfuscado com espaços ainda é detectado', () => {
  for (const txt of [
    'discord . gg / abc',
    'discord . gg/abc',
    'discord  .  gg  /  abc',
    'canary.discord.com/invite/abc',
    'discord://-/invite/abc',
  ]) {
    assert.equal(temLink(txt), true, txt);
  }
});

test('link obfuscado com espaços e TLD conhecido ainda é detectado', () => {
  for (const txt of [
    'exemplo . com',
    'meusite . net',
    'visite exemplo . com hoje',
    'www . example . com',
  ]) {
    assert.equal(temLink(txt), true, txt);
  }
});

test('link dentro de bloco de código é ignorado', () => {
  assert.equal(temLink('```\nhttps://example.com\n```'), false);
  assert.equal(temLink('`https://example.com`'), false);
  assert.equal(temLink('```discord.gg/abc```'), false);
  assert.equal(temLink('codigo `www.example.com` fim'), false);
});

test('ponto com TLD desconhecido e espaço não é link, mas com TLD conhecido é', () => {
  // "ontem.perdeu" (TLD desconhecido) com espaço original não deve ser link
  assert.equal(temLink('ontem. perdeu'), false);
  assert.equal(temLink('ontem . perdeu'), false);
  // já "exemplo.com" (TLD conhecido) sem espaço é link
  assert.equal(temLink('exemplo.com'), true);
  assert.equal(temLink('exemplo.net'), true);
});
