// instalador das atualizacoes no bot.js
// uso: node instalar-updates.js           aplica no bot.js
//      node instalar-updates.js --check   so confere (nao escreve)
const fs = require('fs');
const P = [
 {
  "nome": "requires",
  "old": "const { buildChannelSpec, missingPerms, PERMS_BOT_CANAL } = require('./scripts/channel-rebirth.js');\n",
  "novo": "const { buildChannelSpec, missingPerms, PERMS_BOT_CANAL } = require('./scripts/channel-rebirth.js');\nconst { snapshotGuild } = require('./scripts/server-snapshot.js');\nconst { rebuildServer } = require('./scripts/rebuild-server.js');\nconst { configurarServidor } = require('./scripts/setup-servidor.js');\nconst { classificarDenuncia } = require('./scripts/filtro-denuncia.js');\n",
  "marca": "require('./scripts/filtro-denuncia.js')"
 },
 {
  "nome": "gh_state_files",
  "old": "const GH_STATE_FILES = ['nuke_state.json', 'bump_state.json', 'mute_state.json', 'nuke_log.json', 'logs_state.json', 'blacklist_state.json'];",
  "novo": "const GH_STATE_FILES = ['nuke_state.json', 'bump_state.json', 'mute_state.json', 'nuke_log.json', 'logs_state.json', 'blacklist_state.json', 'server_snapshot.json'];",
  "marca": "'server_snapshot.json']"
 },
 {
  "nome": "snapshot_setup",
  "old": "setInterval(ghStateSyncTick, 60 * 1000);\n",
  "novo": "setInterval(ghStateSyncTick, 60 * 1000);\n\n// ---------- backup de estrutura do servidor (server_snapshot.json no repo) ----------\n// canais + permissoes, cargos, emojis e stickers salvos no repo: o historico do\n// git vira backup. (incidente 28/09: os servidores cairam e nada disso existia\n// em lugar nenhum - so os logs do runner, sem acesso facil.)\nconst SNAPSHOT = path.join(ROOT, 'server_snapshot.json');\nasync function salvarSnapshot(guild) {\n  try {\n    const snap = snapshotGuild(guild, { salvoEm: new Date().toISOString() });\n    fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));\n    ghStateSyncTick();\n    log('SNAPSHOT_SALVO', { guild: guild.id, nome: guild.name, canais: snap.canais.length + snap.categorias.length, cargos: snap.cargos.length });\n  } catch (e) { err(e); }\n}\nconst snapshotTimer = new Map(); // guildId -> timer (agrupa rajadas de mudancas)\n\n// ---------- setup automatico do servidor novo do dono ----------\n// espera o cache do guild baixar (o guildCreate dispara antes dos canais chegarem)\nasync function esperarGuild(guild, ms = 60000) {\n  const ate = Date.now() + ms;\n  while (Date.now() < ate) {\n    if (guild.channels && guild.channels.cache.size > 0) return true;\n    await new Promise((r) => setTimeout(r, 1000));\n  }\n  return false;\n}\nasync function setupServidorNovo(guild, opts = {}) {\n  log('SETUP_INICIADO', { guild: guild.id, name: guild.name, limparExtras: !!opts.limparExtras });\n  if (!(await esperarGuild(guild))) { log('SETUP_TIMEOUT', { guild: guild.id }); return null; }\n  const snap = readJsonSafe(path.join(ROOT, 'server_blueprint.json'), null);\n  if (!snap || !Array.isArray(snap.canais)) { log('SETUP_SEM_BLUEPRINT', { guild: guild.id }); return null; }\n  const rel = await configurarServidor(guild, snap, {\n    log,\n    nukeState: readJsonSafe(NUKE_STATE, {}), salvarNuke: (st) => { fs.writeFileSync(NUKE_STATE, JSON.stringify(st, null, 2)); ghStateSyncTick(); },\n    logsState: lerLogsState(), salvarLogs: salvarLogsState,\n    bumpState: readJsonSafe(BUMP_STATE, {}), salvarBump: (st) => { fs.writeFileSync(BUMP_STATE, JSON.stringify(st, null, 2)); ghStateSyncTick(); },\n    textoBemVindo: WELCOME_MSG,\n    rearmarPainel: (st) => garantirPainelNuke(st),\n    postar: (ch, payload) => whSend(ch, payload),\n    limparExtras: !!opts.limparExtras,\n    manterCanalId: opts.manterCanalId || null,\n  });\n  await salvarSnapshot(guild).catch(() => {});\n  await avisarDono([\n    '**servidor novo configurado.**',\n    `Canais: **${rel.canais}** (já existiam: ${rel.pulados}) • Cargos: **${rel.cargos}** • Apagados: **${rel.apagados}**`,\n    rel.semPermissao.length ? `sem permissão em: ${rel.semPermissao.join(', ')}` : '',\n    rel.erros.length ? 'erros: ' + rel.erros.slice(0, 5).join(' | ') : '',\n    'faltam só o **ícone** e os **cargos/permissões** que nunca foram salvos (o bot não pode trocar o ícone).',\n  ].filter(Boolean).join('\\n')).catch(() => {});\n  return rel;\n}\nfunction agendarSnapshot(guild, atrasoMs = 30 * 1000) {\n  if (!guild) return;\n  if (snapshotTimer.has(guild.id)) return;\n  snapshotTimer.set(guild.id, setTimeout(() => {\n    snapshotTimer.delete(guild.id);\n    salvarSnapshot(guild).catch(err);\n  }, atrasoMs));\n}\n",
  "marca": "const SNAPSHOT = path.join(ROOT, 'server_snapshot.json');"
 },
 {
  "nome": "ready",
  "old": "  client.user.setActivity('o sofrimento dos condenados', { type: 3 });\n",
  "novo": "  client.user.setActivity('o sofrimento dos condenados', { type: 3 });\n  // servidores do dono entram como \"inferno\" em TODO restart (o set comeca\n  // vazio de hardcoded: sem isso o servidor novo ficava sem moderacao, sem\n  // logs e sem boas-vindas depois que o processo reiniciasse)\n  for (const g of client.guilds.cache.values()) {\n    if (g.ownerId === OWNER_ID && !INFERNO_GUILDS.has(g.id)) { INFERNO_GUILDS.add(g.id); log('GUILD_ADOTADA', { guild: g.id, name: g.name }); }\n  }\n  // PANICO: o bot ta online e nao tem mais servidor nenhum. Em 28/09 foi assim\n  // que os dois servidores sumiram - o dono precisa saber na hora, com o\n  // caminho pra recriar (o backup esta no repositorio, versionado).\n  if (client.guilds.cache.size === 0) {\n    log('PANICO_SEM_SERVIDOR', { user: client.user.id });\n    setTimeout(() => avisarDono([\n      '🚨 **o bot está online e não está em nenhum servidor.**',\n      'Se o seu servidor caiu de novo, o backup da estrutura está no repositório (`server_snapshot.json` / `server_blueprint.json`, versionados).',\n      'Recria o servidor, me adiciona nele que eu me configuro sozinho — ou manda `.recriar` no canal do painel.',\n      'Se você está lendo isso e o servidor existe, provavelmente o bot foi removido de lá: me adiciona de novo.',\n    ].join('\\n')).catch(() => {}), 10000);\n  }\n  const gSnap = client.guilds.cache.get(GUILD_OFICIAL) || client.guilds.cache.find((g) => g.ownerId === OWNER_ID) || client.guilds.cache.first();\n  if (gSnap) salvarSnapshot(gSnap).catch(err); // backup da estrutura do servidor ao ligar\n  // servidor novo SEM NENHUM canal do blueprint (bot ja entrou antes do setup):\n  // configura sozinho. Se ja tem canal do blueprint, é o servidor de sempre e\n  // nao mexe - recriar canal que o dono apagou de propósito é chato.\n  for (const g of client.guilds.cache.values()) {\n    if (g.ownerId !== OWNER_ID) continue;\n    setTimeout(() => {\n      const bp = readJsonSafe(path.join(ROOT, 'server_blueprint.json'), null);\n      if (!bp || !Array.isArray(bp.canais)) return;\n      const nomes = new Set(bp.canais.map((c) => c.name));\n      const algumExiste = [...g.channels.cache.values()].some((c) => nomes.has(c.name));\n      if (!algumExiste) setupServidorNovo(g).catch((e) => err(e));\n      else log('SETUP_PULADO', { guild: g.id, motivo: 'ja tem canais do blueprint' });\n    }, 20000);\n  }\n",
  "marca": "log('GUILD_ADOTADA'"
 },
 {
  "nome": "guild_create",
  "old": "    log('GUILD_NOVA_DO_DONO', { guild: g.id, name: g.name });\n",
  "novo": "    log('GUILD_NOVA_DO_DONO', { guild: g.id, name: g.name });\n    await setupServidorNovo(g).catch((e) => err(e));\n",
  "marca": "await setupServidorNovo(g).catch"
 },
 {
  "nome": "listeners",
  "old": "// membro novo no inferno -> manda as boas-vindas na DM\n",
  "novo": "// backup quando a estrutura muda (canal/cargo criado, editado ou apagado)\nfor (const ev of ['channelCreate', 'channelUpdate', 'channelDelete', 'roleCreate', 'roleUpdate', 'roleDelete']) {\n  client.on(ev, (alvo) => { if (alvo && alvo.guild) agendarSnapshot(alvo.guild); });\n}\nclient.on('guildUpdate', (antigo, novo) => agendarSnapshot(novo || antigo));\n\n// membro novo no inferno -> manda as boas-vindas na DM\n",
  "marca": "client.on('guildUpdate'"
 },
 {
  "nome": "filtro_denuncia",
  "old": "    if (m.author.id === OWNER_ID) return; // o dono e imune: nada e apagado nele\n",
  "novo": "    if (m.author.id === OWNER_ID) return; // o dono e imune: nada e apagado nele\n\n    // 0) PRIORIDADE MAXIMA: conteudo que faz o DISCORD derrubar o servidor.\n    //    Apaga na hora, antes que alguem tire print e denuncie (foi assim que\n    //    o servidor caiu: print de mensagem + denuncia = remocao definitiva\n    //    do servidor e ban do dono). Loga e avisa o dono sempre.\n    if (m.content) {\n      const den = classificarDenuncia(m.content);\n      if (den) {\n        await m.delete().catch(() => {});\n        log('DENUNCIA_APAGADA', { guild: m.guild.id, canal: m.channelId, user: m.author.id, cat: den.cat, termo: den.termo });\n        logEvento(den.grave ? '🚨 conteúdo GRAVE apagado' : '⚠️ conteúdo denunciável apagado', [\n          `**Categoria:** \\`${den.cat}\\``,\n          `**Conta:** <@${m.author.id}> (\\`${m.author.id}\\`)`,\n          `**Canal:** <#${m.channelId}>`,\n          `**Mensagem:** \\`${m.id}\\``,\n          `**Trecho:** ${corta(limparCodigo(m.content), 900)}`,\n          den.grave ? '-# isso derruba servidor e ban o dono. O ban é por sua conta.' : '',\n        ].filter(Boolean), den.cor);\n        avisarDono([\n          den.grave ? '🚨 **alerta grave** — isso derruba servidor:' : '⚠️ apaguei uma mensagem denunciável:',\n          `**Categoria:** \\`${den.cat}\\``,\n          `**Quem:** <@${m.author.id}> (\\`${m.author.id}\\`)`,\n          `**Trecho:** ${corta(limparCodigo(m.content), 300)}`,\n        ].join('\\n')).catch(() => {});\n        if (den.grave) castigar(m.guild, m.author.id, `denuncia:${den.cat}`, {}).catch((e) => err(e));\n        return; // nao cai no anti-flood: ja foi tratado\n      }\n    }\n",
  "marca": "classificarDenuncia(m.content)"
 },
 {
  "nome": "nuke_snapshot",
  "old": "  nlog.totalMsgs = msgs;\n  try { fs.writeFileSync(NUKE_LOG, JSON.stringify(nlog, null, 2)); ghStateSyncTick(); } catch (e) { err(e); }\n  return { msgs };",
  "novo": "  nlog.totalMsgs = msgs;\n  try { fs.writeFileSync(NUKE_LOG, JSON.stringify(nlog, null, 2)); ghStateSyncTick(); } catch (e) { err(e); }\n  await salvarSnapshot(guild); // backup a cada ciclo: historico do git guarda as versoes\n  return { msgs };",
  "marca": "await salvarSnapshot(guild); // backup a cada ciclo"
 },
 {
  "nome": "cmd_recriar",
  "old": "    if (c === '.nuke' || c === '.nuke on' || c === '.nuke off') {\n",
  "novo": "      if (c === '.recriar' || c === '.recriar limpo' || c === '.recriar refazer') {\n        // recria a estrutura do servidor a partir do server_blueprint.json\n        // (usado depois de recriarem o servidor: canal/cargo que ja existe e pulado)\n        const limpo = c !== '.recriar';\n        await m.delete().catch(() => {});\n        const snap = readJsonSafe(path.join(ROOT, 'server_blueprint.json'), null);\n        if (!snap || !Array.isArray(snap.canais)) {\n          await whSend(m.channel, 'não achei `server_blueprint.json` (ou ele está vazio).').catch(() => {});\n          return;\n        }\n        await whSend(m.channel, limpo\n          ? '**Apagando tudo e refazendo** do zero pelo blueprint (as mensagens dos canais que ficam são preservadas)...'\n          : '**Recriando o servidor** pelo blueprint... isso pode levar uns segundos.').catch(() => {});\n        const r = await setupServidorNovo(m.guild, { limparExtras: limpo, manterCanalId: m.channelId })\n          .catch((e) => { err(e); return { cargos: 0, categorias: 0, canais: 0, pulados: 0, apagados: 0, semPermissao: [], erros: [String(e && e.message)] }; });\n        await whSend(m.channel, [\n          '**Recriação terminada.**',\n          `Cargos: **${r.cargos}** • Categorias: **${r.categorias}** • Canais: **${r.canais}** • Já existiam: **${r.pulados}** • Apagados: **${r.apagados}**`,\n          r.semPermissao && r.semPermissao.length ? 'Sem permissão do bot em: ' + r.semPermissao.join(', ') : '',\n          r.erros.length ? 'Erros:\\n' + r.erros.slice(0, 10).map((x) => '• ' + x).join('\\n') : '',\n          'Falta só o **ícone** e os **cargos/permissões** (não existiam em backup nenhum — o bot não pode trocar o ícone).',\n        ].filter(Boolean).join('\\n')).catch(() => {});\n        return;\n      }\n    if (c === '.nuke' || c === '.nuke on' || c === '.nuke off') {\n",
  "marca": "c === '.recriar'"
 }
];
const arq = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'bot.js';
const check = process.argv.includes('--check');
let s = fs.readFileSync(arq, 'utf8');
const feito = [], jaLa = [], falhas = [];
for (const p of P) {
  if (s.includes(p.marca)) { jaLa.push(p.nome); continue; }
  if (!s.includes(p.old)) { falhas.push(p.nome); continue; }
  if (check) { feito.push(p.nome); continue; }
  s = s.replace(p.old, p.novo); feito.push(p.nome);
}
if (check) { console.log('aplicaveis: ' + feito.length + ', ja feitos: ' + jaLa.length + (falhas.length ? ', NAO ENCONTRADOS: ' + falhas.join(', ') : '')); process.exit(falhas.length ? 1 : 0); }
if (falhas.length) {
  console.error('PAROU: nao achei o trecho de ' + falhas.join(', ') + ' no bot.js - NAO escrevi nada.');
  console.error('Roda com --check, ou me manda esse trecho do bot.js que eu ajusto o instalador.');
  process.exit(1);
}
fs.writeFileSync(arq, s);
console.log('bot.js atualizado: ' + feito.join(', '));
if (jaLa.length) console.log('ja estavam ok: ' + jaLa.join(', '));