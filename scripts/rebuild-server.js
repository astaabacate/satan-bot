// Recria a estrutura de um servidor a partir de um snapshot/blueprint no formato
// de scripts/server-snapshot.js (categorias, canais com overwrites, cargos).
// Usado pelo comando .recriar (dono) num servidor novo: cria o que faltar,
// remapeando ids antigos -> novos nas permissoes e na system channel.

function mapOverwrites(overwrites, idMap) {
  return (overwrites || []).map((o) => ({
    id: idMap.get(o.id) || o.id,
    type: o.type,
    allow: BigInt(o.allow || 0),
    deny: BigInt(o.deny || 0),
  }));
}

async function rebuildServer(guild, snap, { log = () => {} } = {}) {
  const idMap = new Map(); // id antigo -> id novo
  const resumo = { cargos: 0, categorias: 0, canais: 0, pulados: 0, erros: [] };
  const jaExiste = (nome, tipo) => [...guild.channels.cache.values()].some(
    (c) => c.name === nome && c.type === tipo,
  );

  // 1) cargos primeiro: as overwrites dos canais podem referenciar eles
  for (const r of (snap.cargos || [])) {
    if (r.managed || r.id === guild.id) continue;
    try {
      const novo = await guild.roles.create({
        name: r.name,
        color: r.color || undefined,
        hoist: !!r.hoist,
        permissions: BigInt(r.permissions || 0),
        mentionable: !!r.mentionable,
        reason: 'recriar servidor',
      });
      idMap.set(r.id, novo.id);
      resumo.cargos++;
    } catch (e) { resumo.erros.push(`cargo ${r.name}: ${e && e.message}`); }
  }

  // 2) categorias (na ordem/salvoEm)
  for (const c of (snap.categorias || [])) {
    if (jaExiste(c.name, 4)) { resumo.pulados++; continue; }
    try {
      const novo = await guild.channels.create({
        name: c.name, type: 4, position: c.position,
        reason: 'recriar servidor',
      });
      idMap.set(c.id, novo.id);
      resumo.categorias++;
    } catch (e) { resumo.erros.push(`categoria ${c.name}: ${e && e.message}`); }
  }

  // 3) canais (texto/voz/etc) com permissoes remapeadas
  for (const c of (snap.canais || [])) {
    if (jaExiste(c.name, c.type)) { resumo.pulados++; continue; }
    try {
      const novo = await guild.channels.create({
        name: c.name,
        type: c.type,
        parent: c.parentId ? (idMap.get(c.parentId) || undefined) : undefined,
        topic: c.topic || undefined,
        nsfw: !!c.nsfw,
        rateLimitPerUser: c.rateLimitPerUser || undefined,
        bitrate: c.bitrate || undefined,
        userLimit: typeof c.userLimit === 'number' ? c.userLimit : undefined,
        position: c.position,
        permissionOverwrites: mapOverwrites(c.overwrites, idMap),
        reason: 'recriar servidor',
      });
      idMap.set(c.id, novo.id);
      resumo.canais++;
    } catch (e) { resumo.erros.push(`canal ${c.name}: ${e && e.message}`); }
  }

  // 4) canal de sistema (ex.: confessionario)
  const sysAntigo = snap.guild && snap.guild.systemChannelId;
  if (sysAntigo && idMap.get(sysAntigo) && typeof guild.setSystemChannel === 'function') {
    await guild.setSystemChannel(idMap.get(sysAntigo)).catch((e) => resumo.erros.push('system channel: ' + (e && e.message)));
  }
  log('REBUILD', resumo);
  resumo.idMap = idMap; // id antigo -> id novo (pra religar estado e permissoes)
  return resumo;
}

module.exports = { rebuildServer, mapOverwrites };
