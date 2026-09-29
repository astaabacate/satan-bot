// Limite de pessoas nas calls (user_limit do Discord): aplica o mesmo limite em
// todos os canais de voz, ou só num quando vem o nome. 0 = sem limite.
// Nunca mexe em canal de texto nem em categoria.
//
// O backup (server_snapshot.json) grava o userLimit de cada call, então depois
// de definir aqui o limite passa a acompanhar o .restaurar tambem.

const TIPO_VOZ = 2;
const LIMITE_MAX = 99; // o Discord nao aceita mais que isso

function normalizarLimite(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(LIMITE_MAX, Math.round(n)));
}

function canaisDeVoz(guild, { apenas = null } = {}) {
  const todos = [...(guild.channels.cache.values ? guild.channels.cache.values() : guild.channels.cache)];
  const vozes = todos.filter((c) => c && c.type === TIPO_VOZ);
  if (!apenas) return vozes;
  const alvo = String(apenas).toLowerCase().replace(/^[・\s]+|[・\s]+$/g, '');
  return vozes.filter((c) => String(c.name || '').toLowerCase()
    .replace(/^[・\s]+|[・\s]+$/g, '') === alvo);
}

// devolve { limite, aplicados: [{nome, antes, depois}], pulados: [...], erros: [...] }
async function aplicarLimiteVoz(guild, limite, { apenas = null, log = () => {}, motivo = 'limite de pessoas nas calls' } = {}) {
  const alvo = normalizarLimite(limite);
  const rel = { limite: alvo, aplicados: [], pulados: [], erros: [] };
  if (!guild) { rel.erros.push('sem servidor'); return rel; }
  if (alvo === null) { rel.erros.push('limite invalido (usa um numero de 0 a 99)'); return rel; }
  const canais = canaisDeVoz(guild, { apenas });
  if (!canais.length) { rel.erros.push(apenas ? `não achei a call \`${apenas}\`` : 'não tem canal de voz nenhum'); return rel; }
  for (const c of canais) {
    if (c.userLimit === alvo) { rel.pulados.push(c.name); continue; } // ja ta assim: nao gasta requisição
    try {
      const antes = c.userLimit;
      await c.edit({ userLimit: alvo, reason: motivo });
      rel.aplicados.push({ nome: c.name, antes, depois: alvo });
    } catch (e) { rel.erros.push(`call ${c.name}: ${(e && e.message) || e}`); }
  }
  log('CALL_LIMITE', { guild: guild.id, limite: alvo, aplicados: rel.aplicados.length, erros: rel.erros.length });
  return rel;
}

// cada call pode ter o seu limite:
//   '.call limite 99'                 -> todas ficam em 99
//   '.call limite 99 gf caos'         -> só essas duas, em 99
//   '.call limite gf=2 caos=10 ...'   -> cada uma com o seu
// plano = [{ nome, limite }] (nome null = todas as calls)
function parsearCallLimite(texto) {
  const partes = String(texto || '').trim().split(/[\s,]+/).filter(Boolean);
  const plano = [];
  const erros = [];
  let geral = null;
  const nomes = new Set();
  for (const p of partes) {
    const par = p.match(/^([^=\d][^=]*)=(\d{1,3})$/); // nome=limite
    if (par) {
      nomes.add(par[1]);
      plano.push({ nome: par[1], limite: normalizarLimite(par[2]) });
      continue;
    }
    if (/^\d{1,3}$/.test(p)) { if (geral === null) geral = normalizarLimite(p); else erros.push(`limite repetido: ${p}`); continue; }
    if (geral === null) { erros.push(`não entendi \`${p}\` — usa \`.call limite 99\` ou \`.call limite gf=2\``); continue; }
    nomes.add(p);
    plano.push({ nome: p, limite: geral });
  }
  if (!plano.length) {
    if (geral === null) return { plano: [], erros: erros.length ? erros : ['diz o limite: `.call limite 99`'] };
    plano.push({ nome: null, limite: geral }); // nenhum nome: todas
  }
  return { plano, erros };
}

// modo escada: a PRIMEIRA call fica sem limite e as outras sobem de 1 em 1
// conforme descem na lista (gf=2, conclave=3, ritual=4...) — é a regra do inferno
function ehEscada(texto) { return /^escada\b/i.test(String(texto || '').trim()); }

function posicaoOrdenavel(c) {
  if (typeof c.rawPosition === 'number') return c.rawPosition;
  return (c && c.position) || 0;
}

// '.call limite escada' (comeca em 2) ou '.call limite escada 5'
function planoEscada(guild, { inicio = 2 } = {}) {
  const ini = normalizarLimite(inicio) ?? 2;
  const vozes = [...canaisDeVoz(guild)].sort((a, b) => posicaoOrdenavel(a) - posicaoOrdenavel(b)
    || String(a.id).localeCompare(String(b.id)));
  return vozes.map((c, i) => ({ nome: c.name, limite: i === 0 ? 0 : Math.min(LIMITE_MAX, ini + i - 1) }));
}

// aplica um plano inteiro (cada call com o seu limite)
async function aplicarLimitesVoz(guild, plano, { log = () => {}, motivo = 'limite de pessoas nas calls' } = {}) {
  const rel = { aplicados: [], pulados: [], erros: [] };
  for (const item of plano) {
    const r = await aplicarLimiteVoz(guild, item.limite, { apenas: item.nome, log, motivo });
    rel.aplicados.push(...r.aplicados.map((a) => ({ ...a, limite: r.limite })));
    rel.pulados.push(...r.pulados);
    rel.erros.push(...r.erros);
  }
  return rel;
}

module.exports = {
  aplicarLimiteVoz, aplicarLimitesVoz, canaisDeVoz, normalizarLimite, parsearCallLimite,
  planoEscada, ehEscada, LIMITE_MAX,
};
