// Palavras bloqueadas pelo dono (.bloquear).
//
// É a lista DO DONO, mexida em runtime — o ÚNICO filtro de conteúdo: quem manda
// no que é apagado é ele, não uma lista fixa em código.
//
// O estado vive em blacklist_palavras.json e TEM que estar no GH_STATE_FILES:
// o runner do Actions é descartável, e sem isso a lista sumiria a cada restart.
//
// Casamento por FORMAÇÃO (não por letra): o termo vira o começo da palavra e
// pega as variações que o povo escreve pra fugir do filtro. Exemplos:
//
//   bloquear "estu"   -> estupro, estuprar, estuprando, stupro, st, stu
//   bloquear "est"    -> estupro, stupro, st   (e "teste"/"tu" NÃO caem)
//   bloquear "estupr" -> estupro, stupro (e "estudo" NÃO cai)
//   bloquear "molest" -> molestar, molestei, molestando, molestaram
//   bloquear "pedo"   -> pedofilo, pedofilia (e "pedido" NÃO cai)
//
// Regras do casamento (tudo normalizado: sem acento, sem invisível, leet->letra):
//  - o termo casa no COMEÇO da palavra (formação), com a pontuação/efeito de
//    teclado no meio ("s.t.u") e letra esticada no fim ("estuuupro");
//  - versões sem a vogal inicial também casam ("estu" pega "stupro", "st");
//  - abreviações da forma sem vogal ("st", "stu") casam como palavra inteira;
//  - termo de 2 letras digitado curto (cu, cp) só casa palavra INTEIRA, senão
//    "cuidado"/"cpus" cairiam junto;
//  - frase (com espaço, ex.: "vai se fuder") casa a frase toda, como antes.
//
// ATENÇÃO: formação é literal — bloquear "estu" apaga também estudo/estudante/
// estúpido (tudo que começa com essas letras). Pra pegar só o crime, bloqueie
// "estupr": pega estupro/stupro e deixa "estudo" em paz.

const { normalizar } = require('./filtro-denuncia.js');

const MAX_PALAVRAS = 300;
const MAX_TAMANHO = 60;

function chave(termo) { return normalizar(termo); }

function estadoVazio() { return { palavras: {} }; }

// separa o que o dono mandou numa linha: virgula, pipe, ponto-e-virgula ou quebra
function separarTermos(texto) {
  return String(texto || '')
    .split(/[,|\n;]+/)
    .map((t) => String(t).trim())
    .filter(Boolean);
}

function termoValido(t) {
  return !!chave(t) && String(t).trim().length <= MAX_TAMANHO;
}

// termos -> { adicionadas, jaTinham, invalidas, semEspaco } (muta st)
function adicionarPalavras(st, termos, { por = '' } = {}) {
  const res = { adicionadas: [], jaTinham: [], invalidas: [], semEspaco: [] };
  st.palavras = st.palavras || {};
  for (const bruto of termos) {
    if (!termoValido(bruto)) { res.invalidas.push(String(bruto).slice(0, 30)); continue; }
    const k = chave(bruto);
    if (st.palavras[k]) { res.jaTinham.push(bruto); continue; }
    if (Object.keys(st.palavras).length >= MAX_PALAVRAS) { res.semEspaco.push(bruto); continue; }
    st.palavras[k] = { termo: String(bruto).trim(), chave: k, por, criadoEm: new Date().toISOString(), usos: 0 };
    res.adicionadas.push(bruto);
  }
  return res;
}

function removerPalavras(st, termos) {
  const res = { removidas: [], naoTinham: [] };
  st.palavras = st.palavras || {};
  for (const bruto of termos) {
    const k = chave(bruto);
    if (!k) { res.naoTinham.push(bruto); continue; }
    if (st.palavras[k]) { res.removidas.push(st.palavras[k].termo); delete st.palavras[k]; }
    // sem a chave exata (acento/pontuacao diferentes): tenta por fora
    else {
      const achou = Object.keys(st.palavras).find((x) => x === k || st.palavras[x].termo.toLowerCase() === String(bruto).toLowerCase().trim());
      if (achou) { res.removidas.push(st.palavras[achou].termo); delete st.palavras[achou]; }
      else res.naoTinham.push(bruto);
    }
  }
  return res;
}

// lista em ordem alfabetica (pra mostrar pro dono)
function listarPalavras(st) {
  const ps = (st && st.palavras) || {};
  return Object.values(ps).sort((a, b) => a.termo.localeCompare(b.termo, 'pt-BR'));
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Formações do termo: ele mesmo + as versões sem a vogal inicial.
// "estu" -> ["estu","stu"]   (estupro/stupro/st)
// A vogal inicial é exatamente o pedaço que o povo come pra fugir do filtro
// (estupro -> stupro -> st), então cada versão vira um começo de palavra válido.
function formacoes(k) {
  const letras = String(k).replace(/[^a-z]/g, '');
  const out = [];
  const add = (s) => { if (s && s.length >= 2 && !out.includes(s)) out.push(s); };
  add(letras);
  let s = letras;
  while (s.length > 2 && /^[aeiou]/.test(s)) { s = s.slice(1); add(s); }
  return out;
}

// uma alternativa do regex: as letras do termo, aceitando pontuação/espaço no
// meio (c.u, b o s t a) e letra esticada no fim (cuuu). prefixo=true deixa a
// palavra continuar (formação: estu -> estupro); false exige palavra inteira.
function alternativa(letras, prefixo) {
  const partes = String(letras).split('');
  if (!partes.length) return null;
  const fim = escapeRegex(partes.pop());
  const corpo = partes.map((c) => escapeRegex(c) + '[^a-z]*').join('');
  return '(?<![a-z])' + corpo + fim + '{1,4}' + (prefixo ? '[a-z]*' : '(?![a-z])');
}

// regex do termo bloqueado (por formação). null = termo sem letra útil.
const cacheRegex = new Map();
function regexDoTermo(k) {
  if (cacheRegex.has(k)) return cacheRegex.get(k);
  let rx = null;
  const base = String(k).replace(/[^a-z]/g, '');
  if (base) {
    const alts = [];
    if (/\s/.test(k)) {
      // frase inteira (ex.: "vai se fuder"): casa a frase toda, como antes
      const a = alternativa(base, false);
      if (a) alts.push(a);
    } else {
      const formas = formacoes(k);
      formas.forEach((f, i) => {
        // termo de 2 letras digitado assim mesmo (cu, cp): palavra INTEIRA,
        // senão "cuidado"/"cpus" cairiam junto. A versão sem vogal ("st" de
        // "estu") veio de um termo maior, então essa continua valendo como
        // começo de palavra (stupro).
        const a = alternativa(f, !(i === 0 && f.length <= 2));
        if (a) alts.push(a);
      });
      // abreviação da forma sem vogal inicial: "st"/"stu" (de estupro)
      const elidida = formas[1];
      if (elidida && elidida.length >= 3) {
        for (let n = 2; n < elidida.length; n++) {
          const a = alternativa(elidida.slice(0, n), false);
          if (a) alts.push(a);
        }
      }
    }
    if (alts.length) rx = new RegExp('(?:' + alts.join('|') + ')');
  }
  cacheRegex.set(k, rx);
  return rx;
}

// o texto cai em alguma palavra bloqueada? devolve { termo, chave } ou null
function casarPalavras(texto, st) {
  if (!texto || !st || !st.palavras) return null;
  const txt = normalizar(texto);
  for (const p of Object.values(st.palavras)) {
    const k = p.chave || chave(p.termo);
    const rx = k && regexDoTermo(k);
    if (rx && rx.test(txt)) return { termo: p.termo, chave: k, entrada: p };
  }
  return null;
}

// conta o uso (pra o dono saber se a palavra ta pegando alguma coisa)
function registrarUso(st, chaveAlvo) {
  if (!st || !st.palavras || !st.palavras[chaveAlvo]) return false;
  const p = st.palavras[chaveAlvo];
  p.usos = (p.usos || 0) + 1;
  p.ultimoUso = new Date().toISOString();
  return true;
}

module.exports = {
  estadoVazio, chave, separarTermos, termoValido, adicionarPalavras, removerPalavras,
  listarPalavras, casarPalavras, registrarUso, MAX_PALAVRAS, MAX_TAMANHO,
};
