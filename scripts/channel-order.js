// Ordem dos canais dentro de uma categoria (ou no topo do servidor).
//
// O BUG: o nuke apaga o ・confessionario e recria passando `position: f.position`.
// Só que `f.position` é o ÍNDICE calculado pelo discord.js dentro do pai (0, 1,
// 2...) e não a posição bruta que o Discord usa pra ordenar. O Discord não
// renumera as posições quando um canal é apagado — sobram buracos (0, 5, 7...) —
// então um índice pequeno (1) nasce ANTES de todo mundo: o confessionario
// renascia em cima do canal inferno a cada nuke.
//
// O conserto não é adivinhar a posição na criação: é aplicar a ordem
// explicitamente DEPOIS de criar, reindexando os irmãos de uma vez
// (inferno em primeiro, confessionario em segundo, resto como já estava).

const RE_INFERNO = /^inferno$/i;
const RE_CONFESSIONARIO = /confessionar/i;
const TIPO_CATEGORIA = 4;
// enfeite de nome ("・", emoji, espaço, underline) não conta: "・inferno" é o
// mesmo canal que "inferno" (o bot mesmo cria "・confessionario")
const RE_ENFEITE = /^[\s\W_]+|[\s\W_]+$/g;

function nomeLimpo(c) {
  return String((c && c.name) || '')
    .toLowerCase()
    .replace(RE_ENFEITE, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // sem acento
}

function ehInferno(c) { return RE_INFERNO.test(nomeLimpo(c)); }
function ehConfessionario(c) { return RE_CONFESSIONARIO.test(nomeLimpo(c)); }

// posição que o Discord usa pra ordenar (bruta quando dá, senão a calculada)
function posicaoOrdenavel(c) {
  if (c && typeof c.rawPosition === 'number') return c.rawPosition;
  return (c && c.position) || 0;
}

// ids do Discord tem o mesmo tamanho: comparar como string é estável
function cmpId(a, b) {
  const sa = String(a || ''); const sb = String(b || '');
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

// canais do mesmo pai (menos categorias), na ordem em que o Discord mostra
function irmaosOrdenados(canais, parentId) {
  const pai = parentId || null;
  return [...canais]
    .filter((c) => c && c.type !== TIPO_CATEGORIA && (c.parentId || null) === pai)
    .sort((a, b) => posicaoOrdenavel(a) - posicaoOrdenavel(b) || cmpId(a.id, b.id));
}

// ordem desejada: inferno primeiro, confessionario logo abaixo, o resto como
// estava. Sem canal inferno entre os irmãos, não mexe em nada.
function ordemDoInferno(irmaos) {
  const inferno = irmaos.find(ehInferno);
  const confs = irmaos.filter(ehConfessionario);
  if (!inferno || !confs.length) return [...irmaos]; // nada pra consertar
  const resto = irmaos.filter((c) => c !== inferno && !confs.includes(c));
  return [inferno, ...confs, ...resto];
}

// onde o confessionario deve nascer (índice entre os irmãos, sem contar ele).
// indiceAntigo só vale quando não existe canal inferno no pai.
function posicaoDoConfessionario(irmaosSemConf, indiceAntigo = 0) {
  const i = irmaosSemConf.findIndex(ehInferno);
  if (i >= 0) return i + 1;
  return Math.max(0, Math.min(indiceAntigo, irmaosSemConf.length));
}

// payload do PATCH: todo mundo renumerado 0..n-1 na ordem desejada
function montarReindexacao(ordem) {
  return ordem.map((c, i) => ({ id: c.id, position: i }));
}

// manda a reindexação pro Discord (um PATCH só, sem gastar rate limit por
// canal). Quem mexe na ordem é o mesmo PATCH que o discord.js usa no
// setPosition, só que com todos os irmãos de uma vez.
async function aplicarOrdem(guild, ordem) {
  const alvo = montarReindexacao(ordem);
  await guild.channels.setPositions(alvo.map((p) => ({ channel: p.id, position: p.position })));
  return alvo;
}

// garante inferno -> confessionario -> resto depois que o nuke recria o canal.
// devolve { ok, mudou, ordem, erro } — nunca estoura (ordem errada não pode
// derrubar o nuke), só avisa quem chamou.
async function garantirOrdemInferno(guild, canal, { log = () => {} } = {}) {
  const res = { ok: true, mudou: false, ordem: [], erro: null };
  try {
    if (!guild || !canal) return res;
    const todos = await guild.channels.fetch().catch(() => guild.channels.cache);
    const atual = [...(todos && todos.values ? todos.values() : todos)];
    const vivo = atual.find((c) => c.id === canal.id) || canal;
    const irmaos = irmaosOrdenados(atual, vivo.parentId);
    const desejada = ordemDoInferno(irmaos);
    res.ordem = desejada.map((c) => c.name);
    if (!desejada.some((c, i) => !irmaos[i] || c.id !== irmaos[i].id)) return res; // já tá na ordem
    await aplicarOrdem(guild, desejada);
    res.mudou = true;
    log('ORDEM_CANAIS', { guild: guild.id, canal: canal.id, ordem: res.ordem });
  } catch (e) {
    res.ok = false;
    res.erro = (e && e.message) || String(e);
  }
  return res;
}

module.exports = {
  irmaosOrdenados, ordemDoInferno, posicaoDoConfessionario, montarReindexacao,
  aplicarOrdem, garantirOrdemInferno, ehInferno, ehConfessionario,
  RE_INFERNO, RE_CONFESSIONARIO,
};
