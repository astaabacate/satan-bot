// Regras do anti-flood INDIVIDUAL (por autor).
//
// Ficam aqui, puras e testaveis, porque foi exatamente isso que falhou no
// incidente de 02/10/2026: tres contas repetindo "eai boy prazer 17 anos alto
// cabelo cacheado" em #confessionario, uma mensagem a cada ~10-40s cada uma.
//
// O que existia antes:
//   - 2a copia dentro de 30s  -> apagava (janela CURTA demais: 1 msg a cada
//     35s passava batido, e o print mostrou 8 msgs no mesmo MINUTO)
//   - 11a copia seguida       -> (o castigo que existia aqui foi removido: o
//     dono quer só apagar)
//   - os contadores viviam na memoria -> todo restart do bot (e ele reinicia
//     muito) zerava a conta no meio do flood
//
// Depois veio o caso de 02/10/2026 a noite: "kk" duas vezes em 27s (2 chars,
// conversa normal) caiu como repetiu-2x, e quando o delete falhou o bot avisou
// o servidor que a pessoa estava floodando. Falso positivo.
//
// Agora: contador persistente (antiflood_state.json), janela de 5 min e 3a copia
// -> apaga (o backlog do autor tambem). Mensagem curtinha/emoji/figurinha e
// tratada com mais paciencia: janela de 30s e 4 copias. So apagar: sem
// castigo/timeout. Uma pessoa so, sem regra nenhuma "de varias contas juntas".

const DEFAULT = {
  repMs: 5 * 60 * 1000, // janela em que copias da MESMA mensagem contam
  repApagar: 3,         // 3a copia na janela -> apaga (inclusive as anteriores)
  // mensagem curtinha / so emoji / figurinha: janela de 30s e precisa de MAIS
  // copias. Foi o falso positivo de 02/10/2026: "kk" (2 chars) duas vezes em 27s
  // numa conversa normal caiu como repetiu-2x e o bot tentou apagar (e, quando o
  // delete falhou, avisou o servidor inteiro que a pessoa estava floodando).
  repApagarCurto: 4,
  maxChavesPorAutor: 12, // poda: quantas mensagens diferentes rastreamos por autor
};

function inteiroPositivo(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : padrao;
}

// cfg vem do antispam_config.json (ou do ANTIFLOOD_DEFAULT do bot.js)
function normalizarRep(cfg = {}) {
  const repApagar = Math.max(2, inteiroPositivo(cfg.repApagar, DEFAULT.repApagar));
  return {
    repMs: inteiroPositivo(cfg.repMs, DEFAULT.repMs),
    repApagar,
    // mensagem curta nunca pode ser MAIS facil de cair que a normal
    repApagarCurto: Math.max(repApagar + 1, inteiroPositivo(cfg.repApagarCurto, DEFAULT.repApagarCurto)),
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

// o que fazer com a contagem: null | 'apagar'
// (castigo/timeout removido a pedido do dono: aqui é só apagar)
// curta=true -> mensagem curtinha/emoji/figurinha: exige repApagarCurto copias
// (antes o bot contava a msg curta numa janela de 30s mas decidia com o limite
//  da regra normal, entao a protecao da msg curta virava o oposto: 2 copias em
//  27s apagavam uma conversa normal — o falso positivo de 02/10/2026)
function decidirRepeticao(qtd, cfg, { curta = false } = {}) {
  const c = normalizarRep(cfg);
  const limite = curta ? c.repApagarCurto : c.repApagar;
  if (qtd >= limite) return 'apagar';
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
