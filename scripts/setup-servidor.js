// Configuracao automatica de um servidor novo do dono: cria a estrutura a
// partir do blueprint, da as permissoes que o bot precisa em CADA canal, aponta
// o canal de sistema, religa logs/painel/bump (os ids do servidor antigo
// morreram com ele) e posta o texto de boas-vindas do inferno.
const { rebuildServer } = require('./rebuild-server.js');
const { PERMS_BOT_CANAL } = require('./channel-rebirth.js');

const PERMS_BOT_VOZ = { ...PERMS_BOT_CANAL, Connect: true, Speak: true, MoveMembers: true, ManageChannels: true };

// canais que o Discord cria sozinho num servidor novo e que nao fazem parte do inferno
const CANAIS_PADRAO_DISCORD = /^(general|canal-de-texto|voz-general|voice|canais|text|voz)$/i;

function canaisPorPapel(snap) {
  const por = {};
  for (const c of (snap.canais || [])) if (c.papel) por[c.papel] = c;
  return por;
}

function permissaoDoCanal(c) {
  return c.type === 2 ? PERMS_BOT_VOZ : PERMS_BOT_CANAL;
}

async function configurarServidor(guild, snap, deps = {}) {
  const {
    log = () => {},
    nukeState = null, salvarNuke = () => {},
    logsState = null, salvarLogs = () => {},
    bumpState = null, salvarBump = () => {},
    textoBemVindo = null,
    rearmarPainel = async () => {},
    postar = async (ch, payload) => ch.send(payload),
    darPermissao = async (ch, perms) => ch.permissionOverwrites.edit(guild.members.me.roles.highest, perms, { reason: 'setup do inferno' }),
    // .recriar limpo: apaga TUDO que nao esta no blueprint (nao so os canais
    // padrao do Discord) e refaz do zero. O canal de onde o comando saiu e
    // protegido pra nao perder a resposta.
    limparExtras = false,
    manterCanalId = null,
  } = deps;

  const rel = { cargos: 0, categorias: 0, canais: 0, pulados: 0, apagados: 0, semPermissao: [], erros: [], sistema: null, logs: null, painel: null, bump: null, texto: false };
  if (!guild || !snap) { rel.erros.push('sem guild ou sem blueprint'); return rel; }

  // 1) estrutura (categorias, canais, cargos) + mapa id antigo -> id novo
  const r = await rebuildServer(guild, snap, { log });
  rel.cargos = r.cargos; rel.categorias = r.categorias; rel.canais = r.canais; rel.pulados = r.pulados;
  rel.erros.push(...(r.erros || []));
  const idMap = r.idMap || new Map();
  const papel = canaisPorPapel(snap);

  // 2) permissao do bot em TODO canal criado (o anti-flood precisa de
  //    Gerenciar Mensagens em cada um, senao apaga nada em silencio)
  for (const c of guild.channels.cache.values()) {
    if (c.type === 4) continue;
    try { await darPermissao(c, permissaoDoCanal({ type: c.type })); }
    catch (e) { rel.semPermissao.push(`${c.name}: ${(e && e.message) || e}`); }
  }

  // 3) canal de sistema (o confessionario, recriado pelo nuke)
  const sysAntigo = (snap.guild && snap.guild.systemChannelId) || (papel.sistema && papel.sistema.id);
  const sysNovo = sysAntigo && idMap.get(sysAntigo);
  if (sysNovo) {
    await guild.setSystemChannel(sysNovo).catch((e) => rel.erros.push('system channel: ' + ((e && e.message) || e)));
    rel.sistema = sysNovo;
  }

  // 4) apaga o que sobrou: por so os canais padrao do Discord, ou TUDO que nao
  //    esta no blueprint quando o dono mandou .recriar limpo
  const nomesBlueprint = new Set([...(snap.canais || []), ...(snap.categorias || [])].map((c) => c.name));
  for (const c of [...guild.channels.cache.values()]) {
    if (c.id === rel.sistema || c.id === manterCanalId) continue;
    if (nomesBlueprint.has(c.name)) continue; // ja esta no blueprint: preserva (e as mensagens junto)
    if (!limparExtras && !CANAIS_PADRAO_DISCORD.test(c.name || '')) continue;
    try { await c.delete('canal que nao existe no blueprint do inferno'); rel.apagados++; }
    catch (e) { rel.erros.push(`apagar ${c.name}: ${(e && e.message) || e}`); }
  }

  // 5) religa o estado que morreu junto com o servidor antigo
  if (nukeState) {
    const painelAntigo = nukeState.painel && nukeState.painel.channelId;
    const painelNovo = (papel.painel && idMap.get(papel.painel.id)) || undefined;
    // o painel esta bom se o canal dele existir AGORA (se died junto com o
    // servidor antigo, o id nao existe mais -> recria no canal do blueprint)
    const painelVivo = !!painelAntigo && guild.channels.cache.has(painelAntigo);
    if (!painelVivo) { // painel apontava pro canal morto: deixa o garantirPainelNuke recriar
      if (painelNovo) nukeState.cmdChannel = painelNovo;
      nukeState.painel = null;
      nukeState.on = true;
      if (!nukeState.nextAt || nukeState.nextAt < Date.now()) nukeState.nextAt = Date.now() + 60 * 60 * 1000;
      salvarNuke(nukeState);
      rel.painel = painelNovo || null;
      await rearmarPainel(nukeState).catch((e) => rel.erros.push('painel: ' + ((e && e.message) || e)));
    }
  }
  if (logsState && papel.logs && idMap.get(papel.logs.id)) {
    logsState.on = true;
    logsState.channelId = idMap.get(papel.logs.id);
    logsState.webhookId = ''; // webhook do servidor antigo morreu: recria o "Satan Logs" com o avatar do bot
    salvarLogs(logsState);
    rel.logs = logsState.channelId;
  }
  if (bumpState && papel.bump && idMap.get(papel.bump.id)) {
    const bumpId = idMap.get(papel.bump.id);
    for (const k of Object.keys(bumpState)) { // chaves = id do canal antigo
      if (k !== 'target' && k !== bumpId) { delete bumpState[k]; rel.bump = bumpId; }
    }
    bumpState[bumpId] = { nextAt: Date.now() + 60 * 60 * 1000, lastBumper: '' };
    salvarBump(bumpState);
    rel.bump = bumpId;
  }

  // 6) o textinho do inferno, no confessionario
  if (textoBemVindo && rel.sistema) {
    const ch = guild.channels.cache.get(rel.sistema);
    if (ch && ch.isTextBased()) {
      const msg = await postar(ch, textoBemVindo).catch((e) => { rel.erros.push('texto: ' + ((e && e.message) || e)); return null; });
      if (msg) { rel.texto = true; await msg.pin().catch(() => {}); }
    }
  }

  log('SETUP_SERVIDOR', { guild: guild.id, ...rel });
  return rel;
}

module.exports = { configurarServidor, canaisPorPapel, PERMS_BOT_VOZ, CANAIS_PADRAO_DISCORD };
