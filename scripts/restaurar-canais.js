// Restaura o que sumiu a partir de um backup (server_snapshot.json, no formato
// de scripts/server-snapshot.js): cria SÓ o que não existe mais, no pai
// original, com as permissões originais e na ordem original.
//
// Nunca apaga nada (quem apaga é o `.recriar limpo`) e não cria cargo: o
// servidor é o mesmo, então os ids de cargo/usuário que estão nas overwrites
// continuam valendo — diferentemente do `.recriar`, que remapeia tudo porque
// nasce num servidor novo.

const { irmaosOrdenados, aplicarOrdem } = require('./channel-order.js');

const TIPO_CATEGORIA = 4;

// identidade de um canal no backup: nome + tipo (é o que o .recriar usa)
function chave(c) { return `${c.type}:${String((c && c.name) || '')}`; }

// o que está no backup e NÃO existe mais no servidor (categorias primeiro)
function faltantes(guild, snap, { tipos = null } = {}) {
  const existe = new Set([...(guild.channels.cache.values ? guild.channels.cache.values() : guild.channels.cache)].map(chave));
  const cats = [...(snap.categorias || [])].filter((c) => !existe.has(chave(c)));
  const cans = [...(snap.canais || [])].filter((c) => c.type !== TIPO_CATEGORIA && !existe.has(chave(c)) && (!tipos || tipos.includes(c.type)));
  return { categorias: cats, canais: cans };
}

// overwrites do backup prontas pro create. cargo que nao existe mais é fora
// (senão o Discord recusa o canal inteiro); usuario mantém (pode ter saido, aí
// o create avisa e a gente tenta de novo sem elas)
function overwritesDoBackup(guild, c) {
  const roles = guild.roles && guild.roles.cache;
  return (c.overwrites || [])
    .filter((o) => (o.type === 0 ? o.id === guild.id || !roles || roles.has(o.id) : true))
    .map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow || 0), deny: BigInt(o.deny || 0) }));
}

// devolve a ordem que o pai tinha no backup: quem está no backup na ordem do
// backup, e quem apareceu depois vai pro fim (na ordem atual)
function ordemDoBackup(irmaos, snap, pai) {
  const desejada = [];
  const usados = new Set();
  for (const c of [...(snap.canais || []), ...(snap.categorias || [])]) {
    if ((c.parentId || null) !== pai) continue;
    const vivo = irmaos.find((i) => i.name === c.name && i.type === c.type);
    if (vivo && !usados.has(vivo.id)) { desejada.push(vivo); usados.add(vivo.id); }
  }
  for (const i of irmaos) if (!usados.has(i.id)) { desejada.push(i); usados.add(i.id); }
  return desejada;
}

async function reordenarPais(guild, snap, rel, { log = () => {} } = {}) {
  const pais = new Set();
  for (const c of (snap.canais || [])) if (rel.canais.includes(c.name)) pais.add(c.parentId || null);
  for (const pai of pais) {
    try {
      const todos = await guild.channels.fetch().catch(() => guild.channels.cache);
      const irmaos = irmaosOrdenados([...(todos.values ? todos.values() : todos)], pai);
      const desejada = ordemDoBackup(irmaos, snap, pai);
      if (desejada.length < 2) continue;
      if (!desejada.some((c, i) => !irmaos[i] || c.id !== irmaos[i].id)) continue; // já tá na ordem
      await aplicarOrdem(guild, desejada);
      const cat = pai && guild.channels.cache.get(pai);
      const paiNome = cat ? cat.name : (pai ? 'categoria' : 'topo');
      rel.ordem.push({ pai: pai || 'topo', paiNome, canais: desejada.map((c) => c.name) });
      log('RESTAURAR_ORDEM', { pai: pai || 'topo', ordem: desejada.map((c) => c.name) });
    } catch (e) { rel.erros.push('ordem: ' + ((e && e.message) || e)); }
  }
}

// cria o que falta; tipos = [2] restaura só os canais de voz, por exemplo
async function restaurarCanais(guild, snap, { log = () => {}, tipos = null, motivo = 'restaurar canais do backup' } = {}) {
  const rel = { categorias: [], canais: [], pulados: 0, ordem: [], semPermissao: [], erros: [] };
  if (!guild || !snap || !Array.isArray(snap.canais)) { rel.erros.push('sem guild ou sem backup'); return rel; }
  const falta = faltantes(guild, snap, { tipos });
  const total = (snap.categorias || []).length + (snap.canais || []).length;
  rel.pulados = Math.max(0, total - falta.categorias.length - falta.canais.length);
  const idMap = new Map(); // id do backup -> id novo (pai dos canais recriados)

  for (const c of falta.categorias) {
    try {
      const novo = await guild.channels.create({ name: c.name, type: TIPO_CATEGORIA, position: c.position, reason: motivo });
      idMap.set(c.id, novo.id);
      rel.categorias.push(c.name);
    } catch (e) { rel.erros.push(`categoria ${c.name}: ${(e && e.message) || e}`); }
  }

  for (const c of falta.canais) {
    const pai = c.parentId
      ? (idMap.get(c.parentId) || (guild.channels.cache.has(c.parentId) ? c.parentId : undefined))
      : undefined;
    const spec = {
      name: c.name,
      type: c.type,
      parent: pai,
      topic: c.topic || undefined,
      nsfw: !!c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser || undefined,
      bitrate: c.bitrate || undefined,
      userLimit: typeof c.userLimit === 'number' ? c.userLimit : undefined,
      position: c.position,
      permissionOverwrites: overwritesDoBackup(guild, c),
      reason: motivo,
    };
    try {
      const novo = await guild.channels.create(spec);
      idMap.set(c.id, novo.id);
      rel.canais.push(c.name);
    } catch (e) {
      // usuario que saiu do servidor derruba o create inteiro: tenta sem as
      // overwrites, mas ainda dentro da categoria certa
      try {
        const novo = await guild.channels.create({ ...spec, permissionOverwrites: [] });
        idMap.set(c.id, novo.id);
        rel.canais.push(c.name);
        rel.semPermissao.push(c.name); // recriado sem as permissões do backup
      } catch (e2) { rel.erros.push(`canal ${c.name}: ${(e2 && e2.message) || e2}`); }
    }
  }

  await reordenarPais(guild, snap, rel, { log });
  log('RESTAURAR', { guild: guild.id, ...rel });
  return rel;
}

module.exports = { restaurarCanais, faltantes, overwritesDoBackup, ordemDoBackup, chave };
