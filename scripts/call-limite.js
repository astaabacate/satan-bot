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

module.exports = { aplicarLimiteVoz, canaisDeVoz, normalizarLimite, LIMITE_MAX };
