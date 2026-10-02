// Regras do anti-flood INDIVIDUAL (por autor).
//
// Ficam aqui, puras e testaveis, porque foi exatamente isso que falhou no
// incidente de 02/10/2026: tres contas repetindo "eai boy prazer 17 anos alto
// cabelo cacheado" em #confessionario, uma mensagem a cada ~10-40s cada uma.
//
// O que existia antes:
//   - 2a copia dentro de 30s  -> apagava (janela CURTA demais: 1 msg a cada
//     35s passava batido, e o print mostrou 8 msgs no mesmo MINUTO)
//   - 11a copia seguida       -> castigo (lento demais; a pessoa so era
//     punida depois de encher a tela)
//   - os contadores viviam na memoria -> todo restart do bot (e ele reinicia
//     muito) zerava a conta no meio do flood
//
// Agora: contador persistente (antiflood_state.json), janela de 5 min e escada
// curta -> 2a copia apaga, 3a copia castiga. Uma pessoa so, sem precisar de
// regra nenhuma "de varias contas juntas".

const DEFAULT = {
  repMs: 5 * 60 * 1000, // janela em que copias da MESMA mensagem contam
  repApagar: 2,         // 2a copia na janela -> apaga (inclusive as anteriores)
  repCastigo: 3,        // 3a copia na janela -> castigo progressivo
  maxChavesPorAutor: 12, // poda: quantas mensagens diferentes rastreamos por autor
};

function inteiroPositivo(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : padrao;
}

// cfg vem do antispam_config.json (ou do ANTIFLOOD_DEFAULT do bot.js)
function normalizarRep(cfg = {}) {
  const apagar = Math.max(2, inteiroPositivo(cfg.repApagar, DEFAULT.repApagar));
  const castigo = Math.max(apagar, inteiroPositivo(cfg.repCastigo, DEFAULT.repCastigo));
  return {
    repMs: inteiroPositivo(cfg.repMs, DEFAULT.repMs),
    repApagar: apagar,
    repCastigo: castigo,
    maxChavesPorAutor: inteiroPositivo(cfg.maxChavesPorAutor, DEFAULT.maxChavesPorAutor),
  };
}

// chave curta da assinatura da mensagem: o estado persistido nao precisa (nem
// deve) guardar o texto de tudo que o servidor fala
function chaveSig(sig) {
  const s = String(sig || 'vazia');
  let h = 2166136261; // FNV-1a 32 bits
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(36)}:${s.length}`;
}

// registra uma copia da mensagem e devolve quantas vezes ela apareceu na janela
function registrarRepeticao(ledger, { userId, sig, agora = Date.now(), cfg } = {}) {
  const c = normalizarRep(cfg);
  const id = String(userId);
  const chave = chaveSig(sig);
  ledger[id] = ledger[id] || {};
  const item = ledger[id][chave] || { t: [] };
  item.t = (Array.isArray(item.t) ? item.t : []).filter((t) => agora - t < c.repMs && t <= agora);
  item.t.push(agora);
  ledger[id][chave] = item;
  return { qtd: item.t.length, chave, janelaMs: c.repMs, primeira: item.t[0] };
}

// o que fazer com a contagem: null | 'apagar' | 'castigar'
function decidirRepeticao(qtd, cfg) {
  const c = normalizarRep(cfg);
  if (qtd >= c.repCastigo) return 'castigar';
  if (qtd >= c.repApagar) return 'apagar';
  return null;
}

// tira do estado o que ja saiu da janela (e o excesso de chaves por autor)
function podarLedger(ledger, agora = Date.now(), cfg) {
  const c = normalizarRep(cfg);
  for (const id of Object.keys(ledger)) {
    const porChave = ledger[id] || {};
    for (const k of Object.keys(porChave)) {
      const item = porChave[k];
      const t = (item && Array.isArray(item.t) ? item.t : []).filter((x) => agora - x < c.repMs && x <= agora);
      if (!t.length) delete porChave[k];
      else { item.t = t; porChave[k] = item; }
    }
    const chaves = Object.keys(porChave);
    if (chaves.length > c.maxChavesPorAutor) {
      chaves
        .sort((a, b) => (porChave[a].t[porChave[a].t.length - 1] || 0) - (porChave[b].t[porChave[b].t.length - 1] || 0))
        .slice(0, chaves.length - c.maxChavesPorAutor)
        .forEach((k) => delete porChave[k]);
    }
    if (!Object.keys(porChave).length) delete ledger[id];
  }
  return ledger;
}

// quantas copias a mesma mensagem ainda conta (pro /antiflood e pra sweep de boot)
function contarRepetidas(ledger, { userId, sig, agora = Date.now(), cfg } = {}) {
  const c = normalizarRep(cfg);
  const item = (ledger[String(userId)] || {})[chaveSig(sig)];
  if (!item || !Array.isArray(item.t)) return 0;
  return item.t.filter((t) => agora - t < c.repMs && t <= agora).length;
}

module.exports = {
  DEFAULT,
  normalizarRep,
  chaveSig,
  registrarRepeticao,
  decidirRepeticao,
  podarLedger,
  contarRepetidas,
};
