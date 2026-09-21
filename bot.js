const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { figCreate } = require('./fig.js');
const automod = require('./automod.js'); // automod NATIVO do discord (bloqueia antes de aparecer)

// token vem do .env ao lado — nao precisa de variavel de ambiente nem de chave na mao
if (!process.env.DISCORD_TOKEN) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/DISCORD_TOKEN=(.+)/);
    if (m) process.env.DISCORD_TOKEN = m[1].trim();
  } catch {}
}
const TOKEN = process.env.DISCORD_TOKEN;
const ROOT = __dirname;
const OWNER_ID = '1521612392105250836';          // só o dono usa comandos
const GUILD_OFICIAL = '1484007517091528914';       // nuke/paineis sempre aqui, nunca no server de teste
// servers onde o bot fica / boas-vindas ativas (teste + oficial)
const INFERNO_GUILDS = new Set(['1525806672839442633', '1484007517091528914']);
const INBOX = path.join(ROOT, 'inbox.jsonl');
const ERRORS = path.join(ROOT, 'errors.log');

// anti-flood (ajustavel via antispam_config.json)
const ANTIFLOOD_CFG = path.join(ROOT, 'antispam_config.json');
const RE_INV = /[\s\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2800\u3164\ufeff\ufe00-\ufe0f\ufff0-\ufff8\ufffe\uffff\u{e0000}-\u{e007f}]/gu;
const ANTIFLOOD_DEFAULT = { chars: 500, windowMs: 6000, max: 5, penaltyMs: 10000, repeatWindowMs: 30000 };
const floodBuf = new Map();
const repBuf = new Map();
const penaltyUntil = new Map();

// castigo (timeout) progressivo: repetiu 10+ vezes -> 1h, e +1h a cada reincidencia
const MUTE_STATE = path.join(ROOT, 'mute_state.json');
const MUTE_BASE_MS = 60 * 60 * 1000;
const REP_MUTE_QTD = 10;
const repStreak = new Map(); // userId -> { sig, count }
const emoStreak = new Map();
const shortBuf = new Map(); // userId -> msgs curtas (spam W/Ww) // userId -> qtd seguida de msgs so de emoji
const linkBuf = new Map();   // userId -> [timestamps de links]
const RE_LINK = /(https?:\/\/|discord\.gg\/|discord\.com\/invite|discordapp\.com\/)/i;

// assinatura da mensagem: vale pra TUDO (texto, emoji, figurinha, imagem, gif, embed)
function msgSig(m) {
  const txt = (m.content || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const em = m.content ? (m.content.match(/<(a?):\w+:(\d+)>/g) || []).join(',') : '';
  const st = m.stickers && m.stickers.size ? [...m.stickers.values()].map((s) => s.id || s.name).join(',') : '';
  const at = m.attachments.size ? [...m.attachments.values()].map((a) => a.width || a.height ? `img:${a.width}x${a.height}` : `f:${a.name}`).join(',') : '';
  const eb = m.embeds.length ? m.embeds.map((e) => (e.image && e.image.url) || (e.thumbnail && e.thumbnail.url) || e.title || 'eb').join('|') : '';
  return [txt, em, st, at, eb].filter(Boolean).join('#') || 'vazia';
}
function msgKind(m) {
  if (m.stickers && m.stickers.size) return 'figurinha';
  if (m.attachments.size) return 'arquivo';
  if (m.embeds.length) return 'embed';
  const semEmoji = (m.content || '').replace(/<(a?):\w+:(\d+)>/g, '').trim();
  if (m.content && !semEmoji) return 'emoji';
  return 'texto';
}

// nuke (owner): ciclo de 1h
const NUKE_STATE = path.join(ROOT, 'nuke_state.json');
const NUKE_EVERY_MS = 60 * 60 * 1000; // 1h

// bump reminder (estilo fibo): 2h apos o bump do disboard, repete a cada 2h
const DISBOARD_ID = '302050872383242240';
const BUMP_STATE = path.join(ROOT, 'bump_state.json');
const BUMP_EVERY_MS = 2 * 60 * 60 * 1000;



// boas-vindas (DM pro membro novo)
const WELCOME_MSG = {
  flags: 1 << 15,
  components: [
    {
      type: 17,
      accent_color: 8912896,
      components: [
        { type: 10, content: '# Bem-vindo ao Inferno' },
        { type: 14, spacing: 1, divider: true },
        { type: 10, content: 'Aqui não existe **nenhuma regra**. Pode falar sobre qualquer assunto, sem censura e sem limite — ninguém vai te julgar, punir ou banir pelo que você disser.' },
        { type: 14, spacing: 1, divider: false },
        { type: 10, content: 'Sinta-se em casa. Faça o que quiser.' },
      ],
    },
  ],
};

// menu V2: header premium (titulo+tagline+thumbnail), comandos em negrito/code sem texto explicativo, separadores entre grupos
function menuMsg() {
  return {
    flags: 1 << 15,
    components: [
      {
        type: 17,
        accent_color: 8912896,
        components: [
          {
            type: 9,
            components: [
              { type: 10, content: '# Comandos do Satan' },
              { type: 10, content: '-# tudo que voce controla' },
            ],
            accessory: { type: 11, media: { url: client.user.avatarURL({ size: 128 }) }, description: 'Satan' },
          },
          { type: 14, spacing: 2, divider: true },
          {
            type: 10,
            content: [
              '-# **server**',
              '**`.nuke on / off`**',
              '',
              '**`.nuke agora`**',
              '',
              '**`.cl [qtd]`**',
              '',
              '**`.bump`**',
              '',
              '**`.automod`**',
            ].join('\n'),
          },
          { type: 14, spacing: 2, divider: true },
          {
            type: 10,
            content: [
              '-# **fabrica**',
              '**`.fig`**',
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

// lembrete de bump (components V2), marca o alvo configurado (.bump)
function mentionsOf(t) {
  const us = (t && t.users) || [];
  const rs = (t && t.roles) || [];
  if (!us.length && !rs.length) return `<@${OWNER_ID}>`;
  return [...us.map((id) => `<@${id}>`), ...rs.map((id) => `<@&${id}>`)].join(' ');
}
function bumpAvisoMsg() {
  return {
    flags: 1 << 15,
    components: [
      {
        type: 17,
        accent_color: 8912896,
        components: [
          { type: 10, content: 'vou marcar vocês pra dar bump daqui a duas horas :)' },
        ],
      },
    ],
  };
}

// ---------- painel do bump: multi-selecao de quem o lembrete marca ----------

function bumpPanel(st) {
  const body = [
    '**Painel do bump**',
    '',
    `Quem eu marco no lembrete de 2h: ${mentionsOf(st.target)}`,
    '',
    'Escolhe nas listas ai embaixo — sem digitar nada.',
  ].join('\n');
  return {
    flags: 1 << 15,
    components: [{
      type: 17, accent_color: 8912896,
      components: [
        { type: 10, content: body },
        { type: 1, components: [{ type: 5, custom_id: 'bump_sel_user', min_values: 1, max_values: 25, placeholder: '+ escolher pessoa(s)' }] },
        { type: 1, components: [{ type: 6, custom_id: 'bump_sel_role', min_values: 1, max_values: 25, placeholder: '+ escolher cargo(s)' }] },
        { type: 1, components: [
          { type: 2, style: 3, label: 'Salvar', custom_id: 'bump_sel_done' },
          { type: 2, style: 2, label: 'Me inclui', custom_id: 'bump_self' },
          { type: 2, style: 4, label: 'Zerar (so eu)', custom_id: 'bump_reset' },
        ]},
      ],
    }],
  };
}

function bumpAddMentions(st, m) {
  st.target = st.target || { users: [], roles: [] };
  st.target.users = st.target.users || [];
  st.target.roles = st.target.roles || [];
  let n = 0;
  for (const u of m.mentions.users.values()) if (!st.target.users.includes(u.id)) { st.target.users.push(u.id); n++; }
  for (const r of m.mentions.roles.values()) if (!st.target.roles.includes(r.id)) { st.target.roles.push(r.id); n++; }
  return n;
}

let seq = 0;
const log = (tag, obj) => {
  seq++;
  const line = `#${String(seq).padStart(4,'0')} [${tag}] ${typeof obj === 'string' ? obj : JSON.stringify(obj)}`;
  console.log(line);
};

function append(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function err(e) {
  const s = `${new Date().toISOString()} ${e && e.stack ? e.stack : e}\n`;
  fs.appendFileSync(ERRORS, s);
  console.error('ERR', s.trim());
}

// ---------- webhook: TUDO que o bot fala nos canais sai como webhook "Satan" ----------
let AVATAR_B64 = null;
async function carregarAvatarWebhook() {
  const url = client.user.displayAvatarURL({ forceStatic: true, extension: 'png', size: 256 });
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  const buf = Buffer.from(await r.arrayBuffer());
  AVATAR_B64 = 'data:image/png;base64,' + buf.toString('base64');
}
const whCache = new Map(); // channelId -> webhook
async function getWebhook(ch) {
  if (whCache.has(ch.id)) return whCache.get(ch.id);
  let wh = null;
  const hooks = await ch.fetchWebhooks().catch(() => null);
  if (hooks) wh = hooks.find((h) => h.name === 'Satan') || null;
  if (!wh) {
    if (!AVATAR_B64) await carregarAvatarWebhook();
    wh = await ch.createWebhook({ name: 'Satan', avatar: AVATAR_B64 });
  }
  whCache.set(ch.id, wh);
  return wh;
}
async function whSend(ch, payload) {
  const wh = await getWebhook(ch);
  return wh.send(payload);
}
async function whEdit(ch, messageId, payload) {
  const wh = await getWebhook(ch);
  return wh.editMessage(messageId, payload);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ---------- automod nativo do discord ----------
// as regras vivem no servidor do discord (nao no bot), entao bloqueiam a mensagem
// ANTES dela aparecer no canal e continuam valendo enquanto o bot reinicia
automod.usar({ log, err });
automod.criarSeFaltar();
const automodBlocks = new Map(); // userId -> [timestamps] de bloqueios recentes do automod

// manda uma DM pro dono (usado quando o automod nao consegue fazer algo)
async function avisarDono(texto) {
  try {
    const u = await client.users.fetch(OWNER_ID);
    await u.send(texto);
    log('AVISO_DONO', { texto });
  } catch (e) { log('AVISO_DONO_FAIL', { err: e && e.message }); }
}

let automodUltimoResumo = '';
async function automodSync(tag) {
  // espera o estado do repo chegar antes de mexer nas regras: sincronizar com a
  // config local (vazia) apagaria regra que na verdade ainda existe
  await ghStatePronto.catch(() => {});
  const cfg = automod.ler();
  for (const gid of INFERNO_GUILDS) {
    const g = client.guilds.cache.get(gid);
    if (!g) continue;
    const cfgAntes = JSON.stringify(cfg);
    const r = await automod.sincronizar(g, cfg);
    // A absorcao registra o conteudo da regra antiga no arquivo persistente;
    // isso precisa ser salvo mesmo sem o dono jamais mandar .automod.
    if (JSON.stringify(cfg) !== cfgAntes) {
      automod.salvar(cfg);
      ghStateSyncTick();
    }
    let regras = [];
    try {
      regras = (await automod.listar(g)).map((x) => ({ nome: x.nome, nosso: x.nosso, on: x.on, gatilho: x.gatilho, acoes: x.acoes }));
    } catch (e) { err(e); }
    // diario no automod_status.json (vai pro repo): da pra conferir de fora se as
    // regras existem mesmo no servidor e qual foi o ultimo erro
    const errosAntes = (automod.statusDe(gid) || {}).erros || [];
    const absorvida = r.absorvida || (cfg.absorvida && cfg.absorvida[gid] && cfg.absorvida[gid].nome) || null;
    automod.registrarStatus(gid, { on: cfg.on, permiteGerenciar: automod.podeGerenciar(g), criadas: r.criadas, ligadas: r.ligadas, removidas: r.removidas, adotadas: r.adotadas, absorvida, avisos: r.avisos, erros: r.erros, regras });
    const novosErros = r.erros.filter((e) => !errosAntes.includes(e));
    if (novosErros.length) avisarDono(`automod (servidor ${gid}) deu erro:\n${novosErros.join('\n')}`).catch(err);

    const resumo = { guild: gid, on: cfg.on, criadas: r.criadas, ligadas: r.ligadas, ok: r.ok.length, off: r.off, removidas: r.removidas, adotadas: r.adotadas, avisos: r.avisos, erros: r.erros };
    const json = JSON.stringify(resumo);
    if (json !== automodUltimoResumo) { // so loga quando muda, senao a cada 10min enchia o log
      log('AUTOMOD_SYNC', { tag, ...resumo });
      automodUltimoResumo = json;
    }
  }
  return cfg;
}

// reconfere de tempo em tempo: se alguem apagar/desligar a regra no painel do
// discord, o bot recria sozinho (o discord nao avisa o bot direito sobre isso)
setInterval(() => { automodSync('tick').catch(err); }, 10 * 60 * 1000);

client.once('ready', async () => {
  log('READY', { user: client.user.tag, id: client.user.id, guilds: client.guilds.cache.size });
  client.user.setActivity('o sofrimento dos condenados', { type: 3 });
  if (typeof varrerLinks === 'function') varrerLinks().catch(err); else err(new Error('varrerLinks ausente no ready'));
  if (typeof varrerFlood === 'function') varrerFlood().catch(err); else err(new Error('varrerFlood ausente no ready'));
  automodSync('ready').catch(err); // liga/confere as regras do automod nativo
  (async () => {
    const stN = readJsonSafe(NUKE_STATE, {});
    if (stN && stN.on === true && stN.nextAt) {
      const maxAt = Date.now() + NUKE_EVERY_MS;
      if (stN.nextAt > maxAt) { // ciclo mudou: ajusta o nuke que ja estava armado
        stN.nextAt = maxAt;
        fs.writeFileSync(NUKE_STATE, JSON.stringify(stN, null, 2));
        ghStateSyncTick();
      }
      await garantirPainelNuke(stN);
      await editarPainelNuke(stN);
    }
  })().catch(err);
  // slash commands removidos a pedido do dono (nao registrar mais)
});

// server novo: so entra se o dono adicionou; ai vira casa oficial (welcome + varredura)
client.on('guildCreate', async (g) => {
  const dono = await g.fetchOwner().catch(() => null);
  if (dono && dono.user && dono.user.id === OWNER_ID) {
    INFERNO_GUILDS.add(g.id);
    log('GUILD_NOVA_DO_DONO', { guild: g.id, name: g.name });
  } else {
    log('GUILD_LEAVE', { guild: g.id, name: g.name });
    try { await g.leave(); } catch (e) { err(e); }
  }
});

// membro novo no inferno -> manda as boas-vindas na DM
client.on('guildMemberAdd', async (member) => {
  if (!INFERNO_GUILDS.has(member.guild.id)) return;
  try {
    await member.send(WELCOME_MSG);
    log('WELCOME', { user: member.id, tag: member.user.tag });
  } catch (e) {
    log('WELCOME_FAIL', { user: member.id, err: e && e.message });
  }
});

// ---------- estado persistente no repo GitHub (sobrevive a religadas/updates) ----------
const GH_STATE_FILES = ['nuke_state.json', 'bump_state.json', 'mute_state.json', 'nuke_log.json', 'automod_config.json', 'automod_status.json'];
async function ghStateLoad() {
  const tok = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!tok || !repo) return;
  for (const f of GH_STATE_FILES) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${f}`, { headers: { Authorization: `token ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'satan-state' } });
      if (!r.ok) continue;
      const j = await r.json();
      fs.writeFileSync(path.join(ROOT, f), Buffer.from(j.content, 'base64').toString('utf8'));
      log('STATE_LOAD', { f });
    } catch (e) { err(e); }
  }
}
const ghLastMtime = {};
async function ghStateSyncTick() {
  const tok = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!tok || !repo) return;
  for (const f of GH_STATE_FILES) {
    const p = path.join(ROOT, f);
    let stt; try { stt = fs.statSync(p); } catch { continue; }
    if (ghLastMtime[f] === stt.mtimeMs) continue;
    ghLastMtime[f] = stt.mtimeMs;
    try {
      const H = { Authorization: `token ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'satan-state', 'Content-Type': 'application/json' };
      const cur = await fetch(`https://api.github.com/repos/${repo}/contents/${f}`, { headers: H });
      let sha; if (cur.ok) sha = (await cur.json()).sha;
      const put = await fetch(`https://api.github.com/repos/${repo}/contents/${f}`, {
        method: 'PUT', headers: H,
        body: JSON.stringify({ message: `state ${f}`, content: fs.readFileSync(p).toString('base64'), ...(sha ? { sha } : {}) }),
      });
      if (!put.ok) throw new Error('put ' + put.status);
      log('STATE_SYNC', { f });
    } catch (e) { err(e); delete ghLastMtime[f]; }
  }
}
const ghStatePronto = ghStateLoad();
setInterval(ghStateSyncTick, 60 * 1000);

const figState = new Map(); // guildId -> { msgId, lines: [] }

function figPanel(st, fim) {
  const body = [
    '**Fabrica de figurinhas**' + (fim ? ` — ${fim}` : ' — coleta ATIVA'),
    '',
    'Manda foto, video ou gif como ARQUIVO ANEXADO (um ou varios na mesma mensagem).',
    'Cada item vira na hora uma figurinha QUADRADA 320x320 deste server.',
    'Quando acabar, aperta CONCLUIR.',
  ];
  if (st && st.lines.length) body.push('', ...st.lines.slice(-12));
  const comps = [{ type: 10, content: body.join('\n') }];
  if (!fim) comps.push({
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Concluir', custom_id: 'fig_done' },
      { type: 2, style: 4, label: 'Cancelar', custom_id: 'fig_cancel' },
    ],
  });
  return { flags: 1 << 15, components: [{ type: 17, accent_color: 8912896, components: comps }] };
}

client.on('messageCreate', async (m) => {
  // bump reminder: detecta a confirmacao de bump do disboard e agenda lembrete a cada 2h
  if (m.author.id === DISBOARD_ID && m.guild) {
    if (isBumpDone(m)) {
      const bumper = (m.interaction && m.interaction.user && m.interaction.user.id) || OWNER_ID;
      const st = readJsonSafe(BUMP_STATE, {});
      const target = st.target || null;
      st[m.channelId] = { nextAt: Date.now() + BUMP_EVERY_MS, lastBumper: bumper };
      fs.writeFileSync(BUMP_STATE, JSON.stringify(st, null, 2));
      await whSend(m.channel, bumpAvisoMsg()).catch((e) => err(e));
      log('BUMP_DETECTADO', { channel: m.channelId, bumper, target });
    }
    return;
  }
  if (m.author.bot) return;
  const rec = {
    ts: new Date().toISOString(),
    id: m.id,
    author: m.author.tag,
    authorId: m.author.id,
    where: m.guild ? `guild:${m.guild.id}:${m.channel.name}` : 'dm',
    channelId: m.channelId,
    content: m.content,
    attachments: m.attachments.map((a) => ({ name: a.name, url: a.url })),
  };
  append(INBOX, rec);
  if (m.author.id === OWNER_ID) {
    // fala do dono: tag propria pra achar rapido no log
    log('DONO', { channel: m.channelId, where: rec.where, content: m.content });
  } else {
    log('MSG', rec);
  }

  // ---------- comandos do dono (.nuke / .menu / .cl) — qualquer outro usuário é ignorado ----------
  if (m.guild && m.author.id === OWNER_ID) {
    const c = m.content.trim().toLowerCase();
    if (c === '.nuke' || c === '.nuke on' || c === '.nuke off') {
      if (c === '.nuke' || c === '.nuke on') {
        const stJa = readJsonSafe(NUKE_STATE, {});
        if (stJa && stJa.on === true) {
          await m.delete().catch(() => {});
          await whSend(m.channel, { flags: 1 << 15, components: [{ type: 17, accent_color: 8912896, components: [
            { type: 10, content: 'o nuke **ja ta armado**.' },
          ]}] }).catch(() => {});
          return;
        }
        const stPrev0 = readJsonSafe(NUKE_STATE, {});
        const baseN = stPrev0 && stPrev0.lastNuke ? stPrev0.lastNuke + NUKE_EVERY_MS : 0;
        const st2 = { on: true, nextAt: baseN > Date.now() ? baseN : Date.now() + NUKE_EVERY_MS, cmdChannel: m.channel.id, lastNuke: (stPrev0 && stPrev0.lastNuke) || 0 };
        await m.delete().catch(() => {});
        const stPrev = readJsonSafe(NUKE_STATE, {});
        if (stPrev && stPrev.painel && stPrev.painel.channelId) {
          const och = await client.channels.fetch(stPrev.painel.channelId).catch(() => null);
          if (och) await och.messages.fetch(stPrev.painel.messageId).then((mm) => mm.delete().catch(() => {})).catch(() => {});
        }
        const alvo = canalDoPainel(m.guild, m.channel.id);
        const pm = await whSend(alvo, nukePainelMsg(st2.nextAt)).catch(() => null);
        if (pm) st2.painel = { channelId: alvo.id, messageId: pm.id };
        fs.writeFileSync(NUKE_STATE, JSON.stringify(st2, null, 2));
        ghStateSyncTick();
        log('NUKE_ON_GLOBAL', { guild: m.guild.id, nextAt: st2.nextAt, cmdChannel: m.channel.id, painel: painelId });
      } else {
        const stPrev = readJsonSafe(NUKE_STATE, {});
        if (!stPrev || stPrev.on !== true) {
          await m.delete().catch(() => {});
          await whSend(m.channel, { flags: 1 << 15, components: [{ type: 17, accent_color: 8912896, components: [
            { type: 10, content: 'o nuke **ja ta desarmado**.' },
          ]}] }).catch(() => {});
          return;
        }
        if (stPrev && stPrev.painel && stPrev.painel.channelId) {
          const chp = await client.channels.fetch(stPrev.painel.channelId).catch(() => null);
          if (chp) await chp.messages.fetch(stPrev.painel.messageId).then((mm) => mm.delete().catch(() => {})).catch(() => {});
        }
        await m.delete().catch(() => {});
        fs.writeFileSync(NUKE_STATE, JSON.stringify({ on: false }, null, 2));
        const choff = canalDoPainel(m.guild, m.channel.id);
        await whSend(choff, nukeOffMsg()).catch(() => {});
        ghStateSyncTick();
        log('NUKE_OFF_GLOBAL', { guild: m.guild.id });
      }
      return;
    }
    if (c === '.nuke agora' || c === '.nuke now') {
      await m.delete().catch(() => {});
      const stA = readJsonSafe(NUKE_STATE, {});
      const r = await limparServer(m.guild);
      stA.lastNuke = Date.now();
      if (stA.on === true) stA.nextAt = Date.now() + NUKE_EVERY_MS;
      fs.writeFileSync(NUKE_STATE, JSON.stringify(stA, null, 2));
      ghStateSyncTick();
      if (stA.on === true) await editarPainelNuke(stA);
      const chf = canalDoPainel(m.guild, m.channel.id);
      const tmp = await whSend(chf, nukeManualMsg()).catch(() => null);
      if (tmp) setTimeout(() => tmp.delete().catch(() => {}), 15000);
      log('NUKE_MANUAL', { guild: m.guild.id, msgs: r.msgs });
      return;
    }
    if (c === '.menu') {
      await whSend(m.channel, menuMsg()).catch((e) => err(e));
      log('MENU', { channel: m.channelId });
      return;
    }
    // .cl [qtd] — apaga mensagens de uma vez (dono). sem valor = 10.
    if (c === '.cl' || c.startsWith('.cl ')) {
      const n = parseInt(c.split(/\s+/)[1], 10);
      const total = isNaN(n) ? 10 : Math.min(Math.max(n, 1), 500);
      try {
        await m.delete().catch(() => {}); // o comando some e nao entra na conta
        let left = total, deleted = 0;
        while (left > 0) {
          const batch = Math.min(100, left);
          const col = await m.channel.bulkDelete(batch, true).catch(() => null);
          if (!col || col.size === 0) break;
          deleted += col.size;
          left -= col.size;
          if (col.size < batch) break;
        }
        log('CL', { channel: m.channelId, pedido: total, apagadas: deleted });
      } catch (e) { err(e); }
      return;
    }
    // ---------- .automod — automod NATIVO do discord ----------
    // a regra mora no servidor do discord: a mensagem e barrada antes de aparecer,
    // sem esperar o bot (segue valendo enquanto o bot reinicia)
    if (c === '.automod' || c.startsWith('.automod ')) {
      await m.delete().catch(() => {}); // o comando nao fica no canal
      const args = m.content.trim().split(/\s+/).slice(1);
      const sub = (args[0] || '').toLowerCase();
      const arg = args.slice(1).join(' ');
      const low = arg.toLowerCase();
      const cfg = automod.ler();
      const dizer = (texto) => whSend(m.channel, {
        flags: 1 << 15,
        components: [{ type: 17, accent_color: 8912896, components: [{ type: 10, content: String(texto).slice(0, 1900) }] }],
      }).catch((e) => { err(e); return null; });
      const sincronizar = async (extra) => {
        automod.salvar(cfg);
        let r;
        try { r = await automod.sincronizar(m.guild, cfg, { forcar: true }); }
        catch (e) { err(e); r = { erros: [String(e.message || e)] }; }
        const linhas = [];
        if (r.criadas && r.criadas.length) linhas.push('criadas/atualizadas: ' + r.criadas.join(', '));
        if (r.ligadas && r.ligadas.length) linhas.push('religadas: ' + r.ligadas.join(', '));
        if (r.off && r.off.length) linhas.push('desligadas: ' + r.off.join(', '));
        if (r.removidas && r.removidas.length) linhas.push('apagadas (regra do bot sem uso): ' + r.removidas.join(', '));
        if (r.adotadas && r.adotadas.length) linhas.push('achei regra feita na mão e usei ela: ' + r.adotadas.join(', '));
        if (r.avisos && r.avisos.length) linhas.push('avisos: ' + r.avisos.join(' | '));
        if (r.erros && r.erros.length) linhas.push('erros: ' + r.erros.join(' | '));
        if (!linhas.length) linhas.push('tudo ja tava em dia.');
        log('AUTOMOD_CMD', { sub, guild: m.guild.id, r });
        return dizer([extra, ...linhas].filter(Boolean).join('\n'));
      };

      const AJUDA = [
        '# AutoMod do Discord',
        'Barra a mensagem **antes** dela aparecer no canal — e vale até com o bot desligado.',
        '-# quem tem Administrador ou Gerenciar Servidor passa direto (isso é do próprio Discord)',
        '',
        '**`.automod`** liga/sincroniza  •  **`.automod status`** o que tá valendo',
        '**`.automod off`** desliga as regras do bot  •  **`.automod apagar`** apaga elas de vez',
        '',
        '**`.automod spam on|off`**',
        '**`.automod mencoes 5`** limite de marcações por mensagem (ou `off`)',
        '**`.automod links on|off`**  •  **`.automod link permitir <txt>`**',
        '**`.automod palavra <txt>`** bloqueia palavra/frase (aceita `*` curinga)',
        '**`.automod palavra del <txt>`**  •  **`.automod palavras`** lista',
        '**`.automod regex <padrão>`** até 10 (sem retrovisor tipo \\1)',
        '**`.automod regex del <n>`**  •  **`.automod regex lista`**',
        '**`.automod asterisco on|off`** bloqueia quem usa `*` quebrado',
        '**`.automod compacto on|off`** junta link+palavras+regex numa regra só (cabe em 1 vaga)',
        '**`.automod timeout 600`** o próprio automod dá timeout (0 = só bloqueia)',
        '**`.automod castigo 3 10`** 3 bloqueios em 10min = castigo progressivo do bot',
        '**`.automod alertas #canal`** o Discord posta lá o que bloqueou (ou `off`)',
        '**`.automod canal #canal`** / **`.automod cargo @cargo`** isenta (ou `limpar`)',
      ].join('\n');

      try {
        if (!sub || sub === 'on' || sub === 'ligar' || sub === 'sync') {
          cfg.on = true;
          return void await sincronizar('automod **ligado** e sincronizado nesse servidor.');
        }
        if (sub === 'off') {
          cfg.on = false;
          return void await sincronizar('automod **desligado** (as regras ficam desativadas, nada é apagado).');
        }
        if (sub === 'apagar' || sub === 'limpar-tudo') {
          const r = await automod.apagar(m.guild, cfg);
          log('AUTOMOD_APAGAR', { guild: m.guild.id, r });
          return void await dizer([`apaguei ${r.apagadas.length} regra(s): ${r.apagadas.join(', ') || '-'}`, r.restauradas && r.restauradas.length ? `restaurei a regra manual: ${r.restauradas.join(', ')}` : '', r.erros.length ? 'erros: ' + r.erros.join(' | ') : ''].filter(Boolean).join('\n'));
        }
        if (sub === 'status') {
          const regras = await automod.listar(m.guild);
          const linha = (r) => `${r.on ? '🟢' : '⚫'} \`${r.nome}\` — ${r.gatilho} → ${r.acoes}${r.cargos.length ? ` (${r.cargos.length} cargo(s) imune(s))` : ''}${r.canais.length ? ` (${r.canais.length} canal(is) isento(s))` : ''}`;
          const minhas = regras.filter((r) => r.nosso);
          const manuais = regras.filter((r) => !r.nosso);
          const corpo = [
            minhas.length ? minhas.map(linha).join('\n') : 'nenhuma regra do bot nesse servidor. manda `.automod` pra criar.',
            manuais.length ? '\n**feitas na mão no painel do discord** (o bot não mexe):\n' + manuais.map(linha).join('\n') : '',
          ].filter(Boolean).join('\n');
          return void await dizer([
            '# AutoMod',
            cfg.on ? 'estado no arquivo: **ligado**' : 'estado no arquivo: **desligado**',
            `modo: **${cfg.compacto !== false ? 'compacto (1 regra)' : 'separado'}** • timeout do automod: **${cfg.timeoutSegundos || 0}s** • castigo: **${cfg.castigo.blocos} bloqueio(s) em ${cfg.castigo.janelaMin}min**`,
            `palavras: **${cfg.palavras.length}** • regex: **${cfg.regex.length}** • alertas: ${cfg.canalAlertas ? `<#${cfg.canalAlertas}>` : 'off'}`,
            '',
            corpo,
          ].join('\n'));
        }
        if (sub === 'ajuda' || sub === 'help' || sub === '?') return void await dizer(AJUDA);
        if (sub === 'spam') {
          if (!low) return void await dizer(`spam está **${cfg.spam ? 'ligado' : 'desligado'}**. use \`.automod spam on\` ou \`.automod spam off\`.`);
          cfg.spam = low === 'on' || low === 'ligar';
          return void await sincronizar(`spam do discord: **${cfg.spam ? 'ligado' : 'desligado'}**.`);
        }
        if (sub === 'mencoes' || sub === 'menções') {
          if (!low || low === 'on') { cfg.mencoes.on = true; return void await sincronizar(`limite de menções: **${cfg.mencoes.limite}** por mensagem.`); }
          if (low === 'off') { cfg.mencoes.on = false; return void await sincronizar('limite de menções: **desligado**.'); }
          const n = parseInt(low, 10);
          if (isNaN(n)) return void await dizer('usa `.automod mencoes <número>` (1 a 50).');
          cfg.mencoes.on = true;
          cfg.mencoes.limite = Math.max(1, Math.min(50, n));
          return void await sincronizar(`limite de menções: **${cfg.mencoes.limite}** por mensagem.`);
        }
        if (sub === 'links' || sub === 'link') {
          if (sub === 'links') {
            if (!low) return void await dizer(`links estão **${cfg.links.on ? 'bloqueados' : 'liberados'}**. use \`.automod links on\` ou \`off\`.`);
            cfg.links.on = low === 'on' || low === 'ligar';
            return void await sincronizar(`links: **${cfg.links.on ? 'bloqueados' : 'liberados'}**.`);
          }
          if (low.startsWith('permitir')) {
            const txt = arg.replace(/^permitir\s*/i, '').trim();
            if (!txt) return void await dizer('qual link liberar? `.automod link permitir youtube.com`');
            if (!cfg.links.permitidos.includes(txt)) cfg.links.permitidos.push(txt);
            return void await sincronizar(`liberado: **${txt}** (resto continua bloqueado).`);
          }
          if (low === 'limpar' || low === 'reset') { cfg.links.permitidos = []; return void await sincronizar('lista de links liberados zerada.'); }
          return void await dizer('usa `.automod link permitir <texto>` ou `.automod link limpar`.');
        }
        if (sub === 'palavra' || sub === 'palavras' || sub === 'bloquear') {
          const del = /^(del|remover|tirar|apagar)\s+/i.test(arg);
          const txt = arg.replace(/^(del|remover|tirar|apagar)\s+/i, '').trim();
          if (sub === 'palavras' && !arg) {
            const lista = cfg.palavras.length ? cfg.palavras.map((p, i) => `${i + 1}. \`${p}\``).join('\n') : 'lista vazia.';
            return void await dizer(`# Palavras bloqueadas (${cfg.palavras.length})\n${lista}`);
          }
          if (!txt) return void await dizer('manda a palavra/frase: `.automod palavra bom dia` (aceita `*` curinga, ex: `*promo*`).');
          if (del) {
            cfg.palavras = cfg.palavras.filter((p) => p.toLowerCase() !== txt.toLowerCase());
            return void await sincronizar(`removido da lista: \`${txt}\` (${cfg.palavras.length} restantes).`);
          }
          if (!cfg.palavras.some((p) => p.toLowerCase() === txt.toLowerCase())) cfg.palavras.push(txt);
          return void await sincronizar(`bloqueado: \`${txt}\` — agora ninguém consegue nem enviar essa mensagem.`);
        }
        if (sub === 'regex') {
          if (!arg || low === 'lista') {
            const lista = cfg.regex.length ? cfg.regex.map((p, i) => `${i + 1}. \`${p}\``).join('\n') : 'lista vazia.';
            return void await dizer(`# Regex (${cfg.regex.length}/10)\n${lista}\n-# regex do discord é a do rust: não tem retrovisor (\\1), lookahead, etc.`);
          }
          if (/^(del|remover|tirar|apagar)\s+/i.test(arg)) {
            const n = parseInt(arg.replace(/^(del|remover|tirar|apagar)\s+/i, ''), 10);
            if (isNaN(n) || !cfg.regex[n - 1]) return void await dizer('qual número? usa `.automod regex lista` pra ver.');
            const fora = cfg.regex.splice(n - 1, 1)[0];
            return void await sincronizar(`regex removida: \`${fora}\``);
          }
          if (cfg.regex.length >= 10) return void await dizer('já tem 10 regex (limite do discord). remove uma antes.');
          cfg.regex.push(arg);
          return void await sincronizar(`regex adicionada: \`${arg}\``);
        }
        if (sub === 'asterisco') {
          if (!low) return void await dizer(`asterisco está **${cfg.asterisco ? 'bloqueado' : 'liberado'}** (o bot já apaga mensagem com \`*\` na mão).`);
          cfg.asterisco = low === 'on' || low === 'ligar';
          return void await sincronizar(`asterisco: **${cfg.asterisco ? 'bloqueado' : 'liberado'}**.`);
        }
        if (sub === 'compacto') {
          if (!low) return void await dizer(`modo compacto está **${cfg.compacto !== false ? 'ligado' : 'desligado'}** (ligado = link+palavras+regex+asterisco numa regra só, ocupa 1 vaga em vez de 4).`);
          cfg.compacto = low === 'on' || low === 'ligar';
          return void await sincronizar(`modo compacto: **${cfg.compacto ? 'ligado' : 'desligado'}**.`);
        }
        if (sub === 'timeout') {
          const n = parseInt(low, 10);
          if (isNaN(n) || n < 0) return void await dizer('usa `.automod timeout <segundos>` (0 = só bloqueia a mensagem). máximo 4 semanas.');
          cfg.timeoutSegundos = Math.min(2419200, n);
          return void await sincronizar(`timeout do automod: **${cfg.timeoutSegundos}s** (0 = só bloqueia; só vale pra palavra/regex/menção).`);
        }
        if (sub === 'castigo') {
          const [a1, a2] = low.split(/\s+/);
          const blocos = parseInt(a1, 10);
          if (isNaN(blocos)) return void await dizer('usa `.automod castigo <bloqueios> [minutos]` — ex: `.automod castigo 3 10`');
          cfg.castigo.blocos = Math.max(1, Math.min(50, blocos));
          if (!isNaN(parseInt(a2, 10))) cfg.castigo.janelaMin = Math.max(1, Math.min(1440, parseInt(a2, 10)));
          return void await sincronizar(`castigo: **${cfg.castigo.blocos} bloqueio(s) em ${cfg.castigo.janelaMin}min** → timeout progressivo (1h, 2h, 3h...).`);
        }
        if (sub === 'alertas' || sub === 'alerta') {
          if (low === 'off' || low === '0') { cfg.canalAlertas = ''; return void await sincronizar('alertas do automod: **off**.'); }
          const ch = m.mentions.channels.first() || m.guild.channels.cache.get(arg.replace(/[<#>]/g, ''));
          if (!ch) return void await dizer('marca o canal: `.automod alertas #mod-log` (ou `off`).');
          cfg.canalAlertas = ch.id;
          return void await sincronizar(`o discord vai postar o que bloqueou em <#${ch.id}>.`);
        }
        if (sub === 'canal' || sub === 'cargo') {
          if (low === 'limpar' || low === 'reset' || low === 'off') {
            if (sub === 'cargo') cfg.cargosImunes = []; else cfg.canaisImunes = [];
            return void await sincronizar(`imunes: lista de ${sub === 'cargo' ? 'cargos' : 'canais'} zerada.`);
          }
          const alvo = sub === 'cargo' ? m.mentions.roles.first() : m.mentions.channels.first();
          if (!alvo) return void await dizer(`marca o ${sub}: \`.automod ${sub} @cargo\` (ou \`limpar\`).`);
          const lista = sub === 'cargo' ? cfg.cargosImunes : cfg.canaisImunes;
          if (!lista.includes(alvo.id)) lista.push(alvo.id);
          return void await sincronizar(`imune: ${sub === 'cargo' ? `<@&${alvo.id}>` : `<#${alvo.id}>`} passa por cima de todas as regras do bot.`);
        }
        return void await dizer('não entendi. manda `.automod ajuda`.' + '\n\n' + AJUDA);
      } catch (e) {
        err(e);
        return void await dizer('.automod falhou: ' + (e.message || e) + '\n-# o bot precisa da permissão **Gerenciar Servidor** pra mexer no automod.');
      }
    }
    // .att [arquivo] — sobe o arquivo pro repo do GitHub e religa com o codigo novo (só no bot hospedado)
    if (c === '.att' || c.startsWith('.att ')) {
      const att = m.attachments.first();
      const ghTok = process.env.GITHUB_TOKEN;
      const repo = process.env.GITHUB_REPOSITORY;
      if (!ghTok || !repo) {
        await whSend(m.channel, 'o .att só funciona no bot hospedado no GitHub.').catch(() => {});
        return;
      }
      if (!att) {
        await whSend(m.channel, 'manda o arquivo junto com o .att (ex: bot.js)').catch(() => {});
        return;
      }
      try {
        const name = path.basename(att.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!name || name === '.' || name === '..') throw new Error('nome de arquivo invalido');
        const res = await fetch(att.url);
        if (!res.ok) throw new Error('download falhou ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const GH = { Authorization: `token ${ghTok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'satan-att' };
        const meta = await fetch(`https://api.github.com/repos/${repo}/contents/${name}`, { headers: GH });
        let sha;
        if (meta.ok) sha = (await meta.json()).sha;
        const put = await fetch(`https://api.github.com/repos/${repo}/contents/${name}`, {
          method: 'PUT',
          headers: { ...GH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `.att ${name}`, content: buf.toString('base64'), ...(sha ? { sha } : {}) }),
        });
        if (!put.ok) throw new Error('commit falhou ' + put.status + ' ' + (await put.text()).slice(0, 150));
        fs.writeFileSync(path.join(ROOT, name), buf); // troca o arquivo local pra religar ja com o novo
        await whSend(m.channel, `**${name}** atualizado no repositório. religando com o código novo em 3s...`).catch(() => {});
        log('ATT', { name, size: buf.length });
        setTimeout(() => process.exit(0), 3000); // o loop do workflow liga de novo com o codigo novo
      } catch (e) {
        await whSend(m.channel, '.att falhou: ' + e.message).catch(() => {});
        err(e);
      }
      return;
    }
    // .bump — painel de quem o lembrete marca (dono); .bump @x @y adiciona direto
    if (c === '.bump' || c.startsWith('.bump ')) {
      const st = readJsonSafe(BUMP_STATE, {});
      if (m.mentions.users.size || m.mentions.roles.size) {
        bumpAddMentions(st, m);
        fs.writeFileSync(BUMP_STATE, JSON.stringify(st, null, 2));
        await whSend(m.channel, `adicionado. agora eu marco: ${mentionsOf(st.target)}`).catch(() => {});
        log('BUMP_ALVO', { target: st.target });
        return;
      }
      await whSend(m.channel, bumpPanel(st)).catch((e) => err(e));
      return;
    }
    // .fig — abre o painel da fabrica de figurinhas (dono)
    if (c === '.fig') {
      if (figState.has(m.guild.id)) {
        await whSend(m.channel, 'ja tem coleta ativa aqui. termina no botao CONCLUIR.').catch(() => {});
        return;
      }
      const msg = await whSend(m.channel, figPanel(null)).catch((e) => { err(e); return null; });
      if (msg) {
        figState.set(m.guild.id, { msgId: msg.id, lines: [] });
        log('FIG_ON', { guild: m.guild.id, channel: m.channelId });
      }
      return;
    }
  }

  // ---------- coleta do .fig: anexos e links do dono viram figurinha ----------
  if (m.guild && m.author.id === OWNER_ID && figState.has(m.guild.id)) {
    const st = figState.get(m.guild.id);
    const srcs = [];
    for (const a of m.attachments.values()) srcs.push({ url: a.url, name: a.name, ctype: a.contentType });
    if (srcs.length) {
      for (const s of srcs) {
        try {
          const nm = await figCreate(m.guild, s.url, s.name, s.ctype);
          st.lines.push('ok: ' + nm);
          log('FIG_OK', { guild: m.guild.id, name: nm });
        } catch (e) {
          st.lines.push('erro (' + (s.name || s.url).slice(0, 30) + '): ' + String(e.message).slice(0, 90));
          err(e);
        }
        await whEdit(m.channel, st.msgId, figPanel(st)).catch(() => {});
      }
      return;
    }
  }

async function aplicarCastigo(m, motivo) {
  return castigar(m.guild, m.author.id, motivo, { member: m.member, canal: m.channel });
}

// castigo progressivo (serve pro filtro do bot E pro automod): 1h, 2h, 3h...
// funciona so com o id do cara — o automod bloqueia a mensagem antes dela chegar,
// entao o castigo de la nao tem Message nenhuma pra usar
async function castigar(guild, userId, motivo, opts = {}) {
  const st = readJsonSafe(MUTE_STATE, {});
  const rec = st[userId] || { level: 0, until: 0 };
  if (Date.now() < rec.until) return null; // ja esta de castigo agora
  rec.level += 1;
  const horas = rec.level;
  rec.until = Date.now() + horas * MUTE_BASE_MS;
  st[userId] = rec;
  fs.writeFileSync(MUTE_STATE, JSON.stringify(st, null, 2));
  repStreak.delete(userId);
  linkBuf.delete(userId);
  const membro = opts.member || (guild ? await guild.members.fetch(userId).catch(() => null) : null);
  const aviso = `Você tomou castigo de ${horas} hora${horas > 1 ? 's' : ''}. Caso continue floodando, o tempo aumentará pra ${horas + 1} horas e assim consecutivamente.`;
  try {
    if (membro) await membro.timeout(horas * MUTE_BASE_MS, 'flood: ' + motivo);
    log('CASTIGO', { author: userId, horas, motivo });
  } catch (e) { err(e); }
  // aviso so pra pessoa: o Discord nao deixa mensagem invisivel solta, entao vai por DM (privada)
  const alvo = membro || await client.users.fetch(userId).catch(() => null);
  const dmOk = alvo ? await alvo.send(aviso).then(() => true).catch(() => false) : false;
  if (!dmOk) {
    const ch = opts.canal || (opts.channelId && guild ? await guild.channels.fetch(opts.channelId).catch(() => null) : null);
    if (ch) {
      const tmp = await whSend(ch, `<@${userId}> ${aviso}`).catch(() => null);
      if (tmp) setTimeout(() => tmp.delete().catch(() => {}), 15000);
    }
  }
  return { horas, aviso };
}

// varre os canais ao ligar: apaga sobra de flood/repetida/invisivel que passou durante o gap do restart
async function varrerFlood() {
  for (const gid of INFERNO_GUILDS) {
    const g = client.guilds.cache.get(gid);
    if (!g) continue;
    for (const ch of [...g.channels.cache.values()]) {
      if (!ch.isTextBased()) continue;
      try {
        const msgs = (await ch.messages.fetch({ limit: 100 })).filter((x) => !x.author.bot && x.author.id !== OWNER_ID && x.deletable);
        const por = {};
        for (const x of [...msgs.values()]) (por[x.author.id] = por[x.author.id] || []).push(x);
        const alvos = new Set();
        for (const arr of Object.values(por)) {
          arr.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          for (let i = 1; i < arr.length; i++) {
            if (msgSig(arr[i]) === msgSig(arr[i - 1]) && arr[i].createdTimestamp - arr[i - 1].createdTimestamp < 30000) alvos.add(arr[i]);
          }
          const curtas = arr.filter((x) => { const v = (x.content || '').trim(); return v.length > 0 && v.length <= 3; });
          for (let i = 5; i < curtas.length; i++) {
            if (curtas[i].createdTimestamp - curtas[i - 5].createdTimestamp < 60000) curtas.slice(i - 5, i + 1).forEach((x) => alvos.add(x));
          }
          for (const x of arr) { const v = x.content || ''; if (v && !v.replace(RE_INV, '')) alvos.add(x); }
          for (const x of arr) { if ((x.content || '').includes('*')) alvos.add(x); }
        }
        for (const x of alvos) await x.delete().catch(() => {});
        if (alvos.size) log('VARREDURA_FLOOD', { canal: ch.id, apagadas: alvos.size });
      } catch (e) { /* sem permissao, segue */ }
    }
  }
}

// varre os canais ao ligar: apaga link que passou enquanto o bot reiniciava
async function varrerLinks() {
  for (const gid of INFERNO_GUILDS) {
    const g = client.guilds.cache.get(gid);
    if (!g) continue;
    for (const ch of [...g.channels.cache.values()]) {
      if (!ch.isTextBased()) continue;
      try {
        const msgs = await ch.messages.fetch({ limit: 100 });
        const alvos = msgs.filter((x) => !x.author.bot && x.author.id !== OWNER_ID && RE_LINK.test(x.content || '') && x.deletable);
        if (!alvos.size) continue;
        await ch.bulkDelete(alvos, true).catch(async () => {
          for (const x of [...alvos.values()]) await x.delete().catch(() => {});
        });
        log('VARREDURA', { canal: ch.id, apagadas: alvos.size });
      } catch (e) { /* sem permissao no canal, segue */ }
    }
  }
}

  // ---------- anti-flood: apaga na hora, sem esperar o flood terminar ----------
  // TODA mensagem conta pro flood, independente de qual regra ja pegou ela
  try {
    if (!m.guild) return;
    if (m.author.id === OWNER_ID) return; // o dono e imune: nada e apagado nele
    const cfg = readJsonSafe(ANTIFLOOD_CFG, ANTIFLOOD_DEFAULT);
    const reasons = [];
    const now = Date.now();

    // 1) limite de caracteres por mensagem (nao poluir tela de celular)
    if (m.content.length > cfg.chars) reasons.push(`chars>${cfg.chars}`);

    // 1.5) qualquer link / convite de server morre na hora
    if (RE_LINK.test(m.content)) reasons.push('link');

    // 1.6) asterisco (markdown quebrado tipo **teste*): apaga na hora, sem castigo
    if ((m.content || '').includes('*')) reasons.push('asterisco');

    // 1.7) mensagem invisivel (so espacos/zero-width/tags unicode): apaga na hora; grande = castigo
    {
      const bruto = m.content || '';
      const visivel = bruto.replace(RE_INV, '');
      if (bruto.length > 0 && visivel.length === 0) {
        reasons.push('invisivel');
      }
    }

    // 2) mensagem repetida: compara com as 3 últimas do mesmo autor (pega
    //    "emoji, emoji" e tambem "emoji1, emoji2, emoji1" alternado)
    //    assinatura cobre texto, emoji, figurinha, imagem/gif, arquivo e embed
    {
      const sig = msgSig(m);
      const hist = repBuf.get(m.author.id) || [];
      if (hist.some((h) => h.sig === sig && now - h.ts < cfg.repeatWindowMs)) reasons.push('repetida');
      hist.push({ sig, ts: now });
      while (hist.length > 3) hist.shift();
      repBuf.set(m.author.id, hist);
    }

    // 3) penalidade ativa: quem floodou tem tudo apagado durante o cooldown
    if (now < (penaltyUntil.get(m.author.id) || 0)) reasons.push('penalidade');

    // 4) flood: mais de max msgs na janela -> apaga TUDO (inclusive retroativo) + penalidade
    {
      const arr = (floodBuf.get(m.author.id) || []).filter((e) => now - e.t < cfg.windowMs);
      arr.push({ t: now, id: m.id });
      floodBuf.set(m.author.id, arr);
      if (arr.length > cfg.max) {
        reasons.push(`flood>${cfg.max}em${cfg.windowMs / 1000}s`);
        penaltyUntil.set(m.author.id, now + cfg.penaltyMs);
        // retroativo: apaga pelo id todas as msgs da janela que passaram antes
        let n = 0;
        for (const e of arr) {
          if (e.id === m.id) continue;
          await m.channel.messages.delete(e.id).catch(() => {});
          n++;
        }
        if (n) log('ANTIFLOOD_RETRO', { author: m.author.id, apagadas: n });
      }
    }

    // 5) repetiu a MESMA mensagem mais de 10 vezes -> castigo progressivo
    {
      const sig = msgSig(m);
      const s = repStreak.get(m.author.id);
      const streak = s && s.sig === sig ? { sig, count: s.count + 1 } : { sig, count: 1 };
      repStreak.set(m.author.id, streak);
      if (streak.count > REP_MUTE_QTD) await aplicarCastigo(m, 'repetir a mesma mensagem 10+ vezes');
    }

    // 5b) 5+ mensagens seguidas so de emoji -> castigo progressivo
    {
      const txt = (m.content || '').trim();
      const soEmoji = txt.length > 0 && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]+$/u.test(txt);
      if (soEmoji) {
        const q = (emoStreak.get(m.author.id) || 0) + 1;
        emoStreak.set(m.author.id, q);
        if (q >= 5) await aplicarCastigo(m, 'chuva de emojis');
      } else {
        emoStreak.delete(m.author.id);
      }
    }


    // 7) spam de msg curta (W, Ww, kkk alternado curto): 6+ msgs de ate 3 caracteres em 60s -> apaga tudo + penalidade
    {
      const vis = (m.content || '').trim();
      if (vis.length > 0 && vis.length <= 3) {
        const arr = (shortBuf.get(m.author.id) || []).filter((e) => now - e.t < 60000);
        arr.push({ t: now, id: m.id });
        shortBuf.set(m.author.id, arr);
        if (arr.length >= 6) {
          reasons.push('spam-curto');
          penaltyUntil.set(m.author.id, now + cfg.penaltyMs);
          for (const e of arr) {
            if (e.id === m.id) continue;
            await m.channel.messages.delete(e.id).catch(() => {});
          }
        }
      }
    }

    // 6) chuva de link: 10+ links em 10 minutos -> castigo progressivo
    if (RE_LINK.test(m.content || '')) {
      const arr = (linkBuf.get(m.author.id) || []).filter((t) => now - t < 10 * 60 * 1000);
      arr.push(now);
      linkBuf.set(m.author.id, arr);
      if (arr.length > REP_MUTE_QTD) await aplicarCastigo(m, 'mandar link 10+ vezes');
    }

    if (reasons.length && m.deletable) {
      await m.delete().catch(() => {});
      log('ANTIFLOOD', { reason: reasons.join('+'), kind: msgKind(m), author: m.author.id, channel: m.channelId, len: m.content.length });
    }
  } catch (e) {
    err(e);
  }
});

// ---------- automod nativo: o discord conta pro bot o que ele bloqueou ----------
// mensagem bloqueada NAO vira evento de mensagem (ela nunca chegou a existir no
// canal), entao esse evento e o unico jeito de saber o que rolou + punir quem insiste
client.on('autoModerationActionExecution', async (a) => {
  try {
    if (!a.guild || !a.userId) return;
    const regra = (a.autoModerationRule && a.autoModerationRule.name) || String(a.ruleId);
    const bloqueou = !!(a.action && a.action.type === 1); // 1 = BLOCK_MESSAGE
    const texto = String(a.content || '');
    append(INBOX, {
      ts: new Date().toISOString(),
      id: null,
      author: a.user ? a.user.tag : a.userId,
      authorId: a.userId,
      where: `automod:${regra}`,
      channelId: a.channelId || null,
      content: texto,
      automod: { regra, gatilho: a.ruleTriggerType, keyword: a.matchedKeyword, bloqueado: bloqueou },
    });
    log('AUTOMOD_BLOCK', { regra, autor: a.userId, canal: a.channelId, keyword: a.matchedKeyword, bloqueado: bloqueou, content: texto.slice(0, 120) });

    if (!String(regra).startsWith(automod.PREFIXO)) return; // regra feita a mao no painel: so registra
    const cfg = automod.ler();
    const janelaMs = Math.max(1, Number((cfg.castigo && cfg.castigo.janelaMin) || 10)) * 60 * 1000;
    const minimo = Math.max(1, Number((cfg.castigo && cfg.castigo.blocos) || 3));
    const now = Date.now();
    const arr = (automodBlocks.get(a.userId) || []).filter((t) => now - t < janelaMs);
    arr.push(now);
    automodBlocks.set(a.userId, arr);
    if (arr.length >= minimo) {
      automodBlocks.delete(a.userId);
      await castigar(a.guild, a.userId, `automod: ${regra}`, { member: a.member, channelId: a.channelId });
    }
  } catch (e) { err(e); }
});

client.on('interactionCreate', async (i) => {
  // botoes do painel .fig (so o dono)
  if (i.isButton() && (i.customId === 'fig_done' || i.customId === 'fig_cancel')) {
    await i.deferUpdate().catch(() => {});
    if (i.user.id !== OWNER_ID || !i.guild) return;
    const st = figState.get(i.guild.id);
    figState.delete(i.guild.id);
    const fim = i.customId === 'fig_done' ? 'concluido' : 'cancelado';
    if (st) await whEdit(i.channel, st.msgId, figPanel(st, fim)).catch(() => {});
    log('FIG_FIM', { guild: i.guild.id, fim, itens: st ? st.lines.length : 0 });
    return;
  }
  // painel do bump: selects e botoes (so o dono)
  if ((i.isUserSelectMenu && i.isUserSelectMenu() && i.customId === 'bump_sel_user') ||
      (i.isRoleSelectMenu && i.isRoleSelectMenu() && i.customId === 'bump_sel_role')) {
    await i.deferUpdate().catch(() => {});
    if (i.user.id !== OWNER_ID || !i.guild) return;
    const st = readJsonSafe(BUMP_STATE, {});
    st.target = st.target || { users: [], roles: [] };
    st.target.users = st.target.users || [];
    st.target.roles = st.target.roles || [];
    const ids = i.values || [];
    if (i.customId === 'bump_sel_user') for (const id of ids) if (!st.target.users.includes(id)) st.target.users.push(id);
    else for (const id of ids) if (!st.target.roles.includes(id)) st.target.roles.push(id);
    fs.writeFileSync(BUMP_STATE, JSON.stringify(st, null, 2));
    await whEdit(i.channel, i.message.id, bumpPanel(st)).catch(() => {});
    log('BUMP_PAINEL', { custom: i.customId, ids, target: st.target });
    return;
  }
  if (i.isButton() && i.customId === 'bump_sel_done') {
    if (i.user.id !== OWNER_ID) { await i.reply({ flags: 64, components: [{ type: 17, accent_color: 8912896, components: [{ type: 10, content: 'só o dono usa isso.' }] }] }); return; }
    await i.deferUpdate().catch(() => {});
    await i.message.delete().catch(() => {});
    return;
  }
  if (i.isButton() && ['bump_self', 'bump_reset'].includes(i.customId)) {
    await i.deferUpdate().catch(() => {});
    if (i.user.id !== OWNER_ID || !i.guild) return;
    const st = readJsonSafe(BUMP_STATE, {});
    st.target = st.target || { users: [], roles: [] };
    st.target.users = st.target.users || [];
    if (i.customId === 'bump_self') { if (!st.target.users.includes(OWNER_ID)) st.target.users.push(OWNER_ID); }
    else st.target = { users: [], roles: [] };
    fs.writeFileSync(BUMP_STATE, JSON.stringify(st, null, 2));
    await whEdit(i.channel, i.message.id, bumpPanel(st)).catch(() => {});
    log('BUMP_PAINEL', { custom: i.customId, target: st.target });
    return;
  }
});

client.on('error', err);
process.on('unhandledRejection', err);

// confirmacao de bump do disboard — nao depende do idioma da resposta.
// 1) o comando que gerou a mensagem eh /bump  2) embed com a cor do disboard
// 3) texto de sucesso em pt/en/es (bump done, concluido, exito, logrado...)
const DISBOARD_EMBED_COLOR = 5786862; // 0x5865F2
const BUMP_OK_RE = /(bump\w*\s*(done|feito|complete[d]?|success)|done\s*bump|sucess|conclu[ií]d|[eé]xito|logrado|gracias|obrigad|thank|confira no disboard|disboard\.org\/server)/i;
function isBumpDone(m) {
  const cmd = m.interaction && m.interaction.commandName;
  if (cmd && cmd.toLowerCase() === 'bump') return true;
  if (!m.embeds || !m.embeds.length) return BUMP_OK_RE.test(m.content || ''); // formato novo: texto puro, sem embed
  if (m.embeds.some((e) => e.color === DISBOARD_EMBED_COLOR)) return true;
  const hay = (m.content || '') + ' ' + JSON.stringify(m.embeds.map((e) => ({ t: e.title, d: e.description, f: e.fields })));
  return BUMP_OK_RE.test(hay);
}

function readJsonSafe(p, d) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; }
}

// recria um canal (clone mantém nome/permissões/categoria/posição), apaga o original
// e manda o embed Components V2 no canal novo

// ---------- painel do nuke: countdown Components V2, atualizado a cada minuto ----------
function fmtResto(nextAt) {
  const ms = Math.max(0, nextAt - Date.now());
  const h = Math.floor(ms / 3600000);
  const mn = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return h + 'h ' + String(mn).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
  return String(mn).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
}
function barraResto(nextAt) {
  const frac = Math.max(0, Math.min(1, (nextAt - Date.now()) / NUKE_EVERY_MS));
  const cheio = Math.round(frac * 10);
  return '[' + '█'.repeat(cheio) + '░'.repeat(10 - cheio) + ']';
}
function periodoDoDia(h) {
  if (h < 6) return 'da madrugada';
  if (h < 12) return 'da manha';
  if (h < 18) return 'da tarde';
  return 'da noite';
}
function horaBrasilia(nextAt) {
  const iso = new Date(nextAt - 3 * 3600000).toISOString();
  const h = parseInt(iso.slice(11, 13), 10);
  return iso.slice(11, 16) + ' ' + periodoDoDia(h);
}
function nukePainelMsg(nextAt) {
  return {
    flags: 1 << 15,
    components: [{
      type: 17, accent_color: 8912896,
      components: [
        { type: 10, content: '# NUKE ARMADO' },
        { type: 10, content: '**' + fmtResto(nextAt) + '**' },
        { type: 10, content: barraResto(nextAt) },
        { type: 10, content: 'próxima limpeza às ' + horaBrasilia(nextAt) },
      ],
    }],
  };
}
// canal do painel: o do comando, mas NUNCA o confessionario (cai no bump)
function canalDoPainel(guild, preferId) {
  let ch = null;
  if (preferId) ch = guild.channels.cache.get(preferId) || null;
  if (!ch || /confessionar/i.test(ch.name || '')) {
    ch = guild.channels.cache.find((cc) => cc.type === 0 && /^bump$/i.test(cc.name || '')) || ch;
  }
  return ch;
}
function nukeAnuncioMsg() {
  return {
    embeds: [{ description: 'As portas do inferno foram abertas', color: 8912896 }],
  };
}
async function anunciarNuke(guild) {
  const all = await guild.channels.fetch().catch(() => guild.channels.cache);
  const ch = [...all.values()].find((c) => (c.type === 0 || c.type === 5) && /confessionar/i.test(c.name || ''));
  if (!ch) return;
  const msg = await whSend(ch, nukeAnuncioMsg()).catch((e) => { err(e); return null; });
  if (msg) setTimeout(() => msg.delete().catch(() => {}), 5000);
}
function nukeManualMsg() {
  return {
    flags: 1 << 15,
    components: [{ type: 17, accent_color: 8912896, components: [
      { type: 10, content: '**nuke manual feito** — calls limpas, ・confessionario recriado. contador do automatico zerado.' },
    ]}],
  };
}
function nukeOffMsg() {
  return {
    flags: 1 << 15,
    components: [{ type: 17, accent_color: 8912896, components: [
      { type: 10, content: 'nuke desarmado. painel removido, nada será limpo.' },
    ]}],
  };
}
// limpa: chat das calls (bulk) + ・confessionario RECRRIA o canal identico (posicao/perms/topic)
const NUKE_LOG = path.join(ROOT, 'nuke_log.json');
async function limparServer(guild) {
  let msgs = 0;
  const nlog = { quando: new Date().toISOString(), confAchado: null, confDelete: null, confCreate: null, anuncio: null, calls: [], erros: [] };
  // 1) PRIMEIRO o confessionario: recria e anuncia na hora (sem esperar as calls)
  const todos = await guild.channels.fetch().catch((e) => { nlog.erros.push('fetch canais: ' + (e && e.message)); return guild.channels.cache; });
  const chans = [...todos.values()];
  let conf = chans.find((c) => (c.type === 0 || c.type === 5) && /confessionar/i.test(c.name || ''));
  nlog.confAchado = conf ? conf.id : null;
  if (!conf) {
    // canal sumiu (delete falhou antes, alguem apagou): recria do zero na categoria do bump
    log('NUKE_CONF_NAO_ACHADO', { guild: guild.id });
    const bump = chans.find((c) => c.type === 0 && /^bump$/i.test(c.name || ''));
    conf = await guild.channels.create({
      name: '・confessionario',
      type: 0,
      parent: (bump && bump.parentId) || undefined,
      reason: 'nuke: confessionario recriado do zero',
    }).catch((e) => { nlog.erros.push('create do zero: ' + (e && e.message)); err(e); return null; });
    nlog.confCreate = conf ? conf.id : null;
    if (conf) {
      await guild.setSystemChannel(conf).catch((e) => err(e));
      await anunciarNuke(guild).catch(() => {}); nlog.anuncio = 'ok';
    }
  }
  if (conf) {
    try {
      const f = await conf.fetch().catch(() => conf);
      const eraSistema = guild.systemChannelId === f.id;
      const over = f.permissionOverwrites.cache.map((o) => ({
        id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString(),
      }));
      const spec = {
        name: f.name,
        type: f.type,
        parent: f.parentId || undefined,
        topic: f.topic || undefined,
        nsfw: f.nsfw,
        rateLimitPerUser: f.rateLimitPerUser || undefined,
        position: f.position,
        reason: 'nuke: renascimento do confessionario',
      };
      await f.delete('nuke: confessionario renasce').then(() => { nlog.confDelete = 'ok'; }).catch((e) => { nlog.confDelete = 'erro: ' + (e && e.message); err(e); });
      const novo = await guild.channels.create(spec).catch((e) => { nlog.erros.push('create: ' + (e && e.message)); err(e); return null; });
      nlog.confCreate = novo ? novo.id : null;
      if (novo) {
        log('NUKE_CONF_RECRIADO', { novo: novo.id, pos: novo.position, sistema: eraSistema });
        await guild.setSystemChannel(novo).catch((e) => err(e)); // confessionario sempre selecionado
        await anunciarNuke(guild); // mensagem entra no canal novo na hora
        nlog.anuncio = 'ok';
      }
    } catch (e) { nlog.erros.push('conf: ' + (e && e.message)); err(e); }
  }
  try { fs.writeFileSync(NUKE_LOG, JSON.stringify(nlog, null, 2)); ghStateSyncTick(); } catch (e) { err(e); }
  // 2) depois as calls (mais rapido: pausa menor entre lotes)
  for (const ch of chans) {
    if (ch.type !== 2) continue;
    let q = 0;
    try {
      while (true) {
        const del = await ch.bulkDelete(100, true).catch((e) => { nlog.erros.push(`call ${ch.name}: ` + (e && e.message)); return null; });
        if (!del || del.size === 0) break;
        q += del.size;
        if (del.size < 100) break;
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch (e) { nlog.erros.push(`call ${ch.name}: ` + (e && e.message)); err(e); }
    nlog.calls.push({ canal: ch.name, apagadas: q });
    msgs += q;
  }
  nlog.totalMsgs = msgs;
  try { fs.writeFileSync(NUKE_LOG, JSON.stringify(nlog, null, 2)); ghStateSyncTick(); } catch (e) { err(e); }
  return { msgs };
}

// confere a cada minuto se chegou a hora do nuke (1h)
async function nukeTick() {
  try {
    const st = readJsonSafe(NUKE_STATE, {});
    if (!st || st.on !== true || !st.nextAt) return;
    const maxAt = Date.now() + NUKE_EVERY_MS;
    if (st.nextAt > maxAt) { // ciclo menor que o armado (ex.: mudou de 12h pra 6h)
      st.nextAt = maxAt;
      fs.writeFileSync(NUKE_STATE, JSON.stringify(st, null, 2));
      ghStateSyncTick();
    }
    await garantirPainelNuke(st);
    if (Date.now() >= st.nextAt) {
      const guild = client.guilds.cache.get(GUILD_OFICIAL) || client.guilds.cache.find((g) => g.ownerId === OWNER_ID) || client.guilds.cache.first();
      if (!guild) return;
      const r = await limparServer(guild);
      st.nextAt = Date.now() + NUKE_EVERY_MS;
      st.lastNuke = Date.now();
      fs.writeFileSync(NUKE_STATE, JSON.stringify(st, null, 2));
      ghStateSyncTick();
      await editarPainelNuke(st);
      log('NUKE_AUTO_GLOBAL', { guild: guild.id, msgs: r.msgs, nextAt: st.nextAt });
    }
  } catch (e) { err(e); }
}

// recria o painel so se ele tiver sumido (restart/apagaram); nao edita por minuto (zero rate limit)
async function garantirPainelNuke(st) {
  try {
    if (!st || st.on !== true || !st.nextAt) return;
    const guild = client.guilds.cache.get(GUILD_OFICIAL) || client.guilds.cache.find((g) => g.ownerId === OWNER_ID) || client.guilds.cache.first();
    if (!guild) return;
    if (!st.painel || !st.painel.channelId) {
      const ch = canalDoPainel(guild, st.cmdChannel);
      if (!ch) return;
      const pm = await whSend(ch, nukePainelMsg(st.nextAt)).catch(() => null);
      if (pm) { st.painel = { channelId: ch.id, messageId: pm.id }; fs.writeFileSync(NUKE_STATE, JSON.stringify(st, null, 2)); }
      return;
    }
    const ch = await client.channels.fetch(st.painel.channelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(st.painel.messageId).catch(() => null);
    if (msg) {
      const ok = await whEdit(ch, st.painel.messageId, nukePainelMsg(st.nextAt)).then(() => true).catch(() => false);
      if (ok) return;
      await ch.messages.delete(st.painel.messageId).catch(() => {});
    }
    {
      const pm = await whSend(ch, nukePainelMsg(st.nextAt)).catch(() => null);
      if (pm) { st.painel.messageId = pm.id; fs.writeFileSync(NUKE_STATE, JSON.stringify(st, null, 2)); }
    }
  } catch (e) { err(e); }
}
// edita o painel (usado no .nuke on e apos cada limpeza)
async function editarPainelNuke(st) {
  try {
    if (!st || !st.painel || !st.painel.channelId) return;
    const ch = await client.channels.fetch(st.painel.channelId).catch(() => null);
    if (!ch) return;
    await whEdit(ch, st.painel.messageId, nukePainelMsg(st.nextAt)).catch(() => {});
  } catch (e) { err(e); }
}
// lembrete de bump: a cada 2h desde o ultimo bump, repete ate bumpar de novo
async function bumpTick() {
  try {
    const st = readJsonSafe(BUMP_STATE, {});
    const now = Date.now();
    for (const [cid, info] of Object.entries(st)) {
      if (info && now >= info.nextAt) {
        const ch = await client.channels.fetch(cid).catch(() => null);
        if (!ch) { delete st[cid]; fs.writeFileSync(BUMP_STATE, JSON.stringify(st, null, 2)); continue; }
        await whSend(ch, {
          content: mentionsOf(st.target), // @ pingando (unica parte que notifica)
          embeds: [{ title: 'ESCREVA /bump E ENVIE NESSE CANAL', description: 'o disboard tá liberado de novo.', color: 8912896 }],
        }).catch((e) => err(e));
        delete st[cid]; // lembrete uma vez por bump; so avisa de novo com bump novo
        fs.writeFileSync(BUMP_STATE, JSON.stringify(st, null, 2));
        log('BUMP_LEMBRETE', { channel: cid });
      }
    }
  } catch (e) { err(e); }
}

setInterval(nukeTick, 60 * 1000);
setInterval(() => { editarPainelNuke(readJsonSafe(NUKE_STATE, {})).catch(() => {}); }, 5 * 1000); // relogio vivo do painel (5s)
setInterval(bumpTick, 60 * 1000);

client.login(TOKEN).catch((e) => {
  err(e);
  process.exit(1);
});
