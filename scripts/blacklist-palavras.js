// Palavras bloqueadas pelo dono (.bloquear / .desbloquear / .bloqueios).
//
// É a lista DO DONO, mexida em runtime — diferente das REGRAS do
// scripts/filtro-denuncia.js, que são código (conteúdo que derruba o servidor e
// que ninguém deve desligar por engano). Aqui ele bloqueia e desbloqueia o que
// quiser na hora, sem redeploy.
//
// O estado vive em blacklist_palavras.json e TEM que estar no GH_STATE_FILES:
// o runner do Actions é descartável, e sem isso a lista sumiria a cada restart.
//
// Casamento: o texto e o termo passam pela mesma normalização do filtro (sem
// acento, sem invisível, leet -> letra), então "cu", "CÚ" e "c.u" dão na mesma.
// A palavra precisa estar INTEIRA: bloquear "cu" não derruba "inculo", mas pega
// "cuuu" e "c.u".

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

// regex do termo: cada letra pode estar separada por pontuacao/espaco (furar
// "c.u" e "b o s t a"), a ultima pode estar esticada ("cuuu", "bostaaa") e a
// palavra precisa ser INTEIRA — senao "inculo" cairia no bloqueio de "cu" e
// "putaria" no de "puta".
const cacheRegex = new Map();
function regexDoTermo(k) {
  if (cacheRegex.has(k)) return cacheRegex.get(k);
  let rx = null;
  const letras = k.replace(/[^a-z]/g, '');
  if (letras) {
    const partes = letras.split('');
    const fim = escapeRegex(partes.pop());
    const corpo = partes.map((c) => escapeRegex(c) + '[^a-z]*').join('');
    rx = new RegExp('(?<![a-z])' + corpo + fim + '{1,4}(?![a-z])');
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
