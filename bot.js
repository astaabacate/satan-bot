const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { figCreate } = require('./fig.js');
const { buildChannelSpec, missingPerms, PERMS_BOT_CANAL } = require('./scripts/channel-rebirth.js');
const { garantirOrdemInferno, irmaosOrdenados, posicaoDoConfessionario } = require('./scripts/channel-order.js');
const { adicionarPalavras, removerPalavras, listarPalavras, casarPalavras, registrarUso, separarTermos } = require('./scripts/blacklist-palavras.js');
const { snapshotGuild } = require('./scripts/server-snapshot.js');
const { watchDiscord } = require('./scripts/discord-health.js');
const { corridaComTimeout, ehErroDeAutenticacao, TIMEOUT_CODE, CODIGO_LOGIN_TRAVADO, CODIGO_TOKEN_INVALIDO } = require('./scripts/login-guard.js');
const { registrarRepeticao, decidirRepeticao, podarLedger } = require('./scripts/antiflood-regras.js');
// as regras antigas de conteudo sairam do filtro AO VIVO (pedido do dono em
// 02/10: so a lista dele filtra), mas continuam aqui para a faxina do historico
const { classificarDenuncia } = require('./scripts/filtro-denuncia.js');

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
const ERRORS = path.join(ROOT, 'errors.log');

// anti-flood (ajustavel via antispam_config.json)
const ANTIFLOOD_CFG = path.join(ROOT, 'antispam_config.json');
// memoria do anti-flood (contadores por autor + historico do que o bot fez):
// vive no repo igual mute_state.json, entao reiniciar o bot NAO zera a conta de
// quem estava floodando — era assim que um flood lento passava entre religadas.
const ANTIFLOOD_STATE = path.join(ROOT, 'antiflood_state.json');
const RE_INV = /[\s\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2800\u3164\ufeff\ufe00-\ufe0f\ufff0-\ufff8\ufffe\uffff\u{e0000}-\u{e007f}]/gu;
const RE_INV_LINK = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2800\u3164\ufeff\ufe00-\ufe0f\ufff0-\ufff8\ufffe\uffff\u{e0000}-\u{e007f}]/gu;
const ANTIFLOOD_DEFAULT = {
  chars: 300,
  windowMs: 6000,      // rajada: N msgs do mesmo autor na janela
  max: 5,
  penaltyMs: 10000,
  // repeticao da MESMA mensagem (individual). 5 min de janela: um flood lento,
  // de 1 copia a cada 30-40s, nao escapa mais (era o caso do print de 02/10).
  repeatWindowMs: 300000,
  repMs: 300000,
  repApagar: 2,        // 2a copia -> apaga (inclusive as anteriores)
  retroMs: 10 * 60 * 1000, // limpeza retroativa: ate 10 min de copias
  emojiWindowMs: 60000,
  emojiMax: 5,
};
// repeticao DENTRO da mesma mensagem: qualquer palavra/emoji que apareca mais de
// REP_INTERNA_MAX vezes derruba a mensagem (nigga\nnigga\nnigga..., oi oi oi oi, 😂😂😂😂).
// unica coisa liberada e risada de k (kkkk, k k k k, kk kk kk kk). Letra repetida
// dentro de uma palavra (naaaao, simmmm) nao conta: o alvo e PALAVRA repetida.
const REP_INTERNA_MAX = 3;
const RE_RISADA_K = /^k+$/;
// palavrinha de ligacao: so conta se dominar a mensagem (evita apagar frase
// normal tipo "o gato e o rato e o pato e o cao" por causa do "e"/"o")
const STOPWORDS_PT = new Set(['a', 'o', 'e', 'é', 'as', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'que', 'se', 'eu', 'tu', 'ele', 'ela', 'vc', 'você', 'voce', 'me', 'te', 'meu', 'minha', 'seu', 'sua', 'pra', 'para', 'por', 'com', 'sem', 'mas', 'ou', 'não', 'nao', 'sim', 'ta', 'tá', 'to', 'tô', 'ai', 'aí', 'la', 'lá', 'ja', 'já', 'so', 'só', 'mais', 'muito', 'the', 'and', 'to', 'of', 'in', 'is', 'it', 'i', 'you']);
const RE_EMOJI_CUSTOM = /<a?:\w+:(\d+)>/g;
const RE_EMOJI_UNI = /\p{Extended_Pictographic}(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*/gu;
// link de CDN do discord (imagem/arquivo colado como texto): morre sempre, mesmo se o
// regex generico de link falhar por algum motivo
const RE_CDN = /(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net|attachments\/\d{17,20}\/\d{17,20}\/)/i;
function temLinkCdn(m) {
  const partes = [normLinkText(stripCodeBlocks(m.content || ''))];
  for (const e of m.embeds || []) partes.push(e.url || '', (e.image && e.image.url) || '', (e.thumbnail && e.thumbnail.url) || '', (e.video && e.video.url) || '');
  return RE_CDN.test(partes.join(' '));
}
// devolve o motivo (string) se a mensagem tem repeticao interna acima do limite; senao null
function repeticaoInterna(content) {
  const bruto = String(content || '');
  if (!bruto) return null;
  const contagem = new Map();
  const conta = (t) => contagem.set(t, (contagem.get(t) || 0) + 1);
  let total = 0;
  // emoji custom (por id) e emoji unicode contam como token
  let resto = bruto.replace(RE_EMOJI_CUSTOM, (_, id) => { conta('ce:' + id); total++; return ' '; });
  resto = resto.replace(RE_EMOJI_UNI, (e) => { conta('e:' + e.replace(/\uFE0F/g, '')); total++; return ' '; });
  // palavras: minusculo, sem acento, sem pontuacao, sem invisivel
  const limpo = resto.normalize('NFKD').replace(/\p{M}/gu, '').replace(RE_INV, ' ').toLowerCase();
  const palavras = limpo.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const p of palavras) {
    if (RE_RISADA_K.test(p)) continue; // kkkkk liberado
    // "naaaao" / "simmmm" / "aaaa": letra esticada nao e palavra repetida, mas
    // colapsa pra comparar (oi oiii oi oi = mesma palavra)
    const norm = p.replace(/(.)\1+/gu, '$1');
    conta('w:' + norm);
    total++;
  }
  let pior = null;
  for (const [t, c] of contagem) {
    if (c <= REP_INTERNA_MAX) continue;
    const w = t.startsWith('w:') ? t.slice(2) : null;
    // stopword / letra solta so conta se dominar a msg ("a a a a a" cai, "o gato e o rato e o pato" nao)
    if (w && (STOPWORDS_PT.has(w) || w.length <= 1) && c < total * 0.5) continue;
    if (!pior || c > pior.c) pior = { t, c };
  }
  if (pior) return `repeticao-interna:${pior.t.slice(0, 30)}x${pior.c}`;
  // grudado: oioioioioi, hahahahaha, lolololol, 😂😂😂😂 sem espaco (unidade de 2+ chars
  // repetida mais de 3 vezes). unidade de uma letra so (aaaaaa, kkkkkk) e liberada.
  const gluer = limpo.replace(/\s+/g, '');
  const re = /(\S{2,10}?)\1{3,}/gu;
  let mm;
  while ((mm = re.exec(gluer))) {
    const u = mm[1];
    if (/^(.)\1*$/u.test(u)) continue; // mesma letra esticada
    if (RE_RISADA_K.test(u)) continue;
    return `repeticao-grudada:${u.slice(0, 10)}`;
  }
  // emoji unicode colado tambem passa pelo regex acima? nao (foi trocado por espaco), entao
  // a contagem por emoji la em cima ja cobre 😂😂😂😂.
  return null;
}
const floodBuf = new Map();
const penaltyUntil = new Map();

const LOGS_STATE = path.join(ROOT, 'logs_state.json');
const BLACKLIST_STATE = path.join(ROOT, 'blacklist_state.json');
const PALAVRAS_STATE = path.join(ROOT, 'blacklist_palavras.json'); // palavras bloqueadas pelo dono (.bloquear)
const emoStreak = new Map();
const emoBuf = new Map(); // userId -> timestamps de msgs so de emoji (chuva espacada/com texto no meio)
const shortBuf = new Map(); // userId -> msgs curtas (spam W/Ww)
const recentMsgBuf = new Map(); // channelId -> msgs recentes p/ apagar retroativo (variações rápidas)
const RECENT_MSG_MS = 2 * 60 * 1000;
// Link/convite robusto: pega http(s), www e dominio com TLD realista,
// alem de convites do Discord com espacos/zero-width/fullwidth no meio
// (ex: discord . gg /abc, canary.discord.com/invite/abc, discord://-/invite/abc).
// Correção: prosa normal "ontem. Perdeu?" não pode virar "ontem.perdeu" (falso positivo)
// e conteúdo dentro de bloco de código (`...` / ```...```) é ignorado.
function stripCodeBlocks(t) {
  return String(t || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ');
}
const RE_LINK = /(?:https?:\/\/|www\.|\b[\p{L}0-9][\p{L}0-9-]{1,63}\.(?:[\p{L}]{2,24}|xn--[a-z0-9-]{2,59})(?:\b|\/))/iu;
const RE_INVITE = /(?:\b(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/invite\/|\bdiscord\.gg\/|\bdiscord\.me\/|\bdiscord\.io\/|\bdiscord\.li\/|\bdsc\.gg\/|\binvite\.gg\/|\bdisboard\.org\/server\b|\bdiscordservers\.com\/server\b|discord:\/\/-\/invite\/)/i;
function normLinkText(t) {
  let s = String(t || '')
    .normalize('NFKC')
    .replace(RE_INV_LINK, '')
    .replace(/[。｡]/g, '.')
    .replace(/[⁄∕／\\]/g, '/');
  // barra: sempre colapsa espaços ao redor (pega "discord / invite")
  s = s.replace(/\s*\/\s*/g, '/');
  // ponto: colapsa só quando não parece fim de frase.
  // "ontem. Perdeu?" (ponto + espaço + maiúscula) deve ficar "ontem. Perdeu?",
  // não "ontem.perdeu". Caso contrário, falso positivo com qualquer palavra após ponto.
  s = s.replace(/\s*\.\s*/g, (m, off, str) => {
    const hadSpace = /\s/.test(m);
    const after = str.slice(off + m.length);
    const next = after.trimStart()[0] || '';
    const isUpper = next && /[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÑ]/u.test(next);
    if (hadSpace && isUpper) return '. ';
    if (hadSpace) {
      const nextWord = after.trimStart().split(/[^a-z0-9-]/i)[0] || '';
      const low = nextWord.toLowerCase();
      const conhecidos = new Set(['com','net','org','io','gg','me','li','co','br','app','dev','xyz','info','tv','ai','is','de','fr','es','pt','it','nl','be','ch','at','pl','ru','cn','jp','kr','au','ca','uk','us','eu','online','site','store','tech','blog','shop','icu','top','win','vip','live','cloud','page','link','biz','pro','mobi','name','so','in','ph','id','my','sg','th','vn','nz','za','mx','ar','cl','pe','uy','py','bo','cr','gt','hn','ni','pa','sv','do','pr','hn','gl','to','cc','ws','fm','am','im','st','gs','vg','vc','ag','lc','sc','gd','tc','gy','bz','dm','kn','ms','tt','ht','com.br','net.br','org.br']);
      if (low && !conhecidos.has(low) && /^[a-z]{2,24}$/.test(low)) {
        return '. ';
      }
    }
    return '.';
  });
  return s.toLowerCase();
}
function temLink(t) {
  if (!t) return false;
  const semCodigo = stripCodeBlocks(t);
  const n = normLinkText(semCodigo);
  return RE_LINK.test(n) || RE_INVITE.test(n);
}
function sigTextoVisual(t) {
  return normLinkText(t)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(RE_INVITE, ' <invite> ')
    .replace(RE_LINK, ' <link> ')
    .replace(/[`*_~|>#\[\](){}.,;:!?+="'\-]+/g, ' ')
    .replace(/(.)\1{3,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function bigramas(s) {
  const v = sigTextoVisual(s);
  if (v.length < 2) return v ? [v] : [];
  const out = [];
  for (let i = 0; i < v.length - 1; i++) out.push(v.slice(i, i + 2));
  return out;
}
function similarTexto(a, b) {
  const x = sigTextoVisual(a), y = sigTextoVisual(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const mn = Math.min(x.length, y.length), mx = Math.max(x.length, y.length);
  if (mn >= 40 && (x.includes(y) || y.includes(x)) && mn / mx >= 0.72) return true;
  if (mn >= 12 && (x.includes(y) || y.includes(x)) && mn / mx >= 0.68) return true;
  if (mn < 25) return false;
  const ax = bigramas(x), by = bigramas(y);
  const counts = new Map();
  for (const g of ax) counts.set(g, (counts.get(g) || 0) + 1);
  let inter = 0;
  for (const g of by) {
    const n = counts.get(g) || 0;
    if (n) { inter++; counts.set(g, n - 1); }
  }
  return (2 * inter) / (ax.length + by.length) >= 0.82;
}
function registrarRecente(m, reasons, now, retroMs = RECENT_MSG_MS) {
  if (!m.guild) return [];
  const key = m.channelId;
  const arr = (recentMsgBuf.get(key) || []).filter((e) => now - e.ts < retroMs);
  const rec = {
    id: m.id,
    ts: now,
    userId: m.author.id,
    content: m.content || '',
    sig: sigTextoVisual(m.content || ''),
    len: (m.content || '').length,
    suspeita: reasons.length > 0 || temLink(m.content || '') || (m.content || '').length > 220,
  };
  arr.push(rec);
  recentMsgBuf.set(key, arr.slice(-150));
  return arr;
}
async function apagarRelacionadas(m, recentes, motivo) {
  let n = 0;
  for (const e of recentes) {
    if (e.id === m.id) continue;
    // só o MESMO autor: o anti-flood é individual (o dono não quer regra que
    // mexe na mensagem dos outros)
    if (e.userId !== m.author.id) continue;
    if (!similarTexto(m.content || '', e.content || '')) continue;
    const ok = await m.channel.messages.delete(e.id).then(() => true).catch(() => false);
    if (ok) n++;
  }
  if (n) log('ANTIFLOOD_RETRO_VARIACAO', { canal: m.channelId, apagadas: n, motivo });
  return n;
}

// limpa o backlog do MESMO autor: pega as copias que o buffer de 2 min (memoria)
// nao alcanca mais — inclusive as que passaram antes de um restart do bot.
// E a parte "individual" que o dono pediu: quem repetiu, perde tudo que repetiu.
async function limparRepetidasDoAutor(m, janelaMs) {
  let n = 0;
  try {
    const msgs = await m.channel.messages.fetch({ limit: 100 });
    const alvo = msgSig(m);
    for (const x of msgs.values()) {
      if (x.id === m.id) continue;
      if (!x.author || x.author.id !== m.author.id) continue;
      if (Date.now() - x.createdTimestamp > janelaMs) continue;
      if (msgSig(x) !== alvo) continue;
      const ok = await x.delete().then(() => true).catch(() => false);
      if (ok) n++;
    }
  } catch (e) {
    log('ANTIFLOOD_LIMPEZA_FALHOU', { canal: m.channelId, author: m.author.id, err: e && e.message });
  }
  if (n) log('ANTIFLOOD_LIMPEZA', { canal: m.channelId, author: m.author.id, apagadas: n, janelaMs });
  return n;
}

// assinatura da mensagem: vale pra TUDO (texto, emoji, figurinha, imagem, gif, embed)
function msgSig(m) {
  const txt = sigTextoVisual(m.content || '');
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

// menu V2: apenas os comandos permitidos
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
              { type: 10, content: '-# apenas o essencial' },
            ],
            accessory: { type: 11, media: { url: client.user.avatarURL({ size: 128 }) }, description: 'Satan' },
          },
          { type: 14, spacing: 2, divider: true },
          {
            type: 10,
            content: [
              '**`.nuke on / off`**',
              '**`.nuke agora`**',
              '**`.cl [qtd]`**',
              '**`.bump`**',
              '**`.fig`**',
              '**`.bloquear`** (painel)',
              '**`.antiflood`** (o que ele andou fazendo)',
              '**`.logs on / off / teste`**',
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
const ownWebhookIds = new Set();
function isOwnWebhookId(id) { return !!id && ownWebhookIds.has(id); }
async function getWebhook(ch) {
  if (whCache.has(ch.id)) return whCache.get(ch.id);
  let wh = null;
  const hooks = await ch.fetchWebhooks().catch(() => null);
  if (hooks) wh = hooks.find((h) => h.name === 'Satan') || null;
  if (!wh) {
    if (!AVATAR_B64) await carregarAvatarWebhook();
    wh = await ch.createWebhook({ name: 'Satan', avatar: AVATAR_B64 });
  }
  if (wh && wh.id) ownWebhookIds.add(wh.id);
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

const logWhCache = new Map();
const logMsgCache = new Map(); // logId -> { content, authorId, guildId, channelId }
const logQueue = [];
let logSending = false;
let logSeq = 0;
function lerLogsState() { return readJsonSafe(LOGS_STATE, { on: false, channelId: '', webhookId: '' }); }
function salvarLogsState(st) { fs.writeFileSync(LOGS_STATE, JSON.stringify(st, null, 2)); ghStateSyncTick(); }
function lerBlacklist() { return readJsonSafe(BLACKLIST_STATE, { users: {} }); }
function salvarBlacklist(st) { fs.writeFileSync(BLACKLIST_STATE, JSON.stringify(st, null, 2)); ghStateSyncTick(); }
function blacklistTem(userId) { const st = lerBlacklist(); return !!(st.users && st.users[userId]); }
function blacklistAdd(userId, dados = {}) {
  const st = lerBlacklist();
  st.users = st.users || {};
  st.users[userId] = { userId, ...st.users[userId], ...dados, atualizadoEm: new Date().toISOString() };
  salvarBlacklist(st);
  return st.users[userId];
}
// palavras bloqueadas pelo dono: lista dele, mexida por comando, sem redeploy.
// cache por mtime: o teste roda em TODA mensagem, nao da pra reler o json sempre
let palavrasCache = null;
let palavrasCacheMtime = 0;
function lerPalavrasBloqueadas() {
  try {
    const stt = fs.statSync(PALAVRAS_STATE);
    if (palavrasCache && stt.mtimeMs === palavrasCacheMtime) return palavrasCache;
    palavrasCache = readJsonSafe(PALAVRAS_STATE, { palavras: {} });
    palavrasCacheMtime = stt.mtimeMs;
    return palavrasCache;
  } catch {
    return (palavrasCache = readJsonSafe(PALAVRAS_STATE, { palavras: {} }));
  }
}
function salvarPalavras(st) {
  fs.writeFileSync(PALAVRAS_STATE, JSON.stringify(st, null, 2));
  palavrasCache = st;
  try { palavrasCacheMtime = fs.statSync(PALAVRAS_STATE).mtimeMs; } catch { palavrasCacheMtime = 0; }
  ghStateSyncTick();
}

// ---------- memoria do anti-flood (antiflood_state.json) ----------
// rep: quantas copias da MESMA mensagem cada autor mandou (sobrevive a restart)
// acoes/stats: o que o bot fez — fica versionado no repo, entao da pra ver que
// o anti-flood esta vivo mesmo com o canal de logs off (era o caso em 02/10).
let antifloodMem = null;
function estadoAntiflood() {
  if (antifloodMem) return antifloodMem;
  const st = readJsonSafe(ANTIFLOOD_STATE, {});
  antifloodMem = {
    rep: st.rep && typeof st.rep === 'object' ? st.rep : {},
    acoes: Array.isArray(st.acoes) ? st.acoes : [],
    stats: st.stats && typeof st.stats === 'object' ? st.stats : {},
    // purga da lista do dono: quando varreu, a "impressao digital" da lista e
    // onde cada canal parou (pra continuar de onde ficou no proximo boot)
    palavrasVarreduraEm: Number(st.palavrasVarreduraEm) || 0,
    palavrasHash: typeof st.palavrasHash === 'string' ? st.palavrasHash : '',
    purga: st.purga && typeof st.purga === 'object' ? st.purga : {},
    // resumo da ultima faxina (fica no repo: da pra ver que rodou e o que apagou)
    faxina: st.faxina && typeof st.faxina === 'object' ? st.faxina : null,
  };
  return antifloodMem;
}
let antifloodPendente = null;
function salvarAntiflood(imediato = false) {
  const grava = () => {
    try { fs.writeFileSync(ANTIFLOOD_STATE, JSON.stringify(estadoAntiflood(), null, 2)); } catch (e) { err(e); }
  };
  // o handler roda em TODA mensagem: nao da pra escrever em disco a cada uma
  if (imediato) {
    if (antifloodPendente) { clearTimeout(antifloodPendente); antifloodPendente = null; }
    grava();
    return;
  }
  if (antifloodPendente) return;
  antifloodPendente = setTimeout(() => { antifloodPendente = null; grava(); }, 5000);
  if (antifloodPendente.unref) antifloodPendente.unref();
}
function registrarAcaoAntiflood(rec) {
  try {
    const st = estadoAntiflood();
    st.acoes.unshift({ ts: new Date().toISOString(), ...rec });
    while (st.acoes.length > 200) st.acoes.pop();
    const dia = new Date().toISOString().slice(0, 10);
    st.stats[dia] = st.stats[dia] || { deteccoes: 0, apagadas: 0, castigos: 0, falhas: 0 };
    const s = st.stats[dia];
    s.deteccoes += 1;
    if (rec.apagou === true) s.apagadas += Math.max(1, Number(rec.apagadas) || 1);
    if (rec.apagou === false) s.falhas += 1;
    if (rec.castigo) s.castigos += 1;
    salvarAntiflood();
  } catch (e) { err(e); }
}
function blacklistDel(userId) {
  const st = lerBlacklist();
  st.users = st.users || {};
  const tinha = !!st.users[userId];
  delete st.users[userId];
  salvarBlacklist(st);
  return tinha;
}
async function getLogsWebhook(st = lerLogsState()) {
  if (!st.on || !st.channelId) return null;
  if (st.webhookId && logWhCache.has(st.webhookId)) return logWhCache.get(st.webhookId);
  const ch = await client.channels.fetch(st.channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return null;
  const hooks = await ch.fetchWebhooks().catch(() => null);
  let wh = hooks ? (st.webhookId && hooks.get(st.webhookId)) || hooks.find((h) => h.name === 'Satan Logs') : null;
  if (!wh) {
    if (!AVATAR_B64) await carregarAvatarWebhook().catch(() => {});
    wh = await ch.createWebhook({ name: 'Satan Logs', ...(AVATAR_B64 ? { avatar: AVATAR_B64 } : {}) });
    st.webhookId = wh.id;
    salvarLogsState(st);
  }
  if (wh && wh.id) ownWebhookIds.add(wh.id);
  logWhCache.set(wh.id, wh);
  return wh;
}
function corta(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function limparCodigo(s) { return String(s || '').replace(/```/g, 'ʼʼʼ'); }
function esperar(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function enfileirarLog(payload) {
  logQueue.push(payload);
  drenarLogs().catch(err);
}
const LOG_QUEUE_MAX = 400; // se o canal sumir, segura no maximo isso (descarta o mais antigo)
let logFalhaSeguida = 0;
async function drenarLogs() {
  if (logSending) return;
  logSending = true;
  try {
    while (logQueue.length) {
      const wh = await getLogsWebhook().catch(() => null);
      // sem webhook (canal apagado, webhook deletado, sem permissao): NAO joga a fila fora.
      // guarda tudo e espera o vigia dos logs consertar — antes o bot perdia os logs pra sempre aqui.
      if (!wh) {
        logFalhaSeguida++;
        if (logFalhaSeguida === 1 || logFalhaSeguida % 40 === 0) {
          log('LOG_FILA_PARADA', { naFila: logQueue.length, tentativas: logFalhaSeguida });
        }
        while (logQueue.length > LOG_QUEUE_MAX) logQueue.shift();
        await esperar(10000);
        continue;
      }
      const payload = logQueue.shift();
      try {
        await wh.send(payload);
        logFalhaSeguida = 0;
        await esperar(250);
      } catch (e) {
        const st = e && (e.status || (e.httpStatus !== undefined ? e.httpStatus : e.code));
        const ms = (e && e.retryAfter) || (e && e.retry_after) || 0;
        logFalhaSeguida++;
        // 429/rate limit ou falha passageira: devolve o payload na frente da fila e tenta de novo
        logQueue.unshift(payload);
        while (logQueue.length > LOG_QUEUE_MAX) logQueue.pop();
        const pausa = st === 429 || st === 500 || st === 502 || st === 503 || st === 504
          ? Math.min(30000, Math.max(ms ? ms * 1000 : 0, 1500 * Math.min(logFalhaSeguida, 8)))
          : 5000;
        log('LOG_SEND_FAIL', { err: e && e.message, status: st || null, fila: logQueue.length, pausaMs: pausa });
        await esperar(pausa);
      }
    }
  } finally { logSending = false; }
}

// ---------- vigia dos logs: o canal/webhook nao pode matar os logs de vez ----------
// manda DM pro dono (o canal de logs pode ser justamente o que morreu)
async function avisarDono(texto) {
  try {
    const u = await client.users.fetch(OWNER_ID);
    await u.send(texto);
    log('AVISO_DONO', { texto: String(texto).slice(0, 120) });
  } catch (e) { log('AVISO_DONO_FAIL', { err: e && e.message }); }
}
let logsAvisoDonoEm = 0;
async function vigiarLogs() {
  const st = lerLogsState();
  if (!st.on) return;
  if (!st.channelId) { // ligado mas sem canal: espera o dono mandar .logs on em algum canal
    log('LOGS_SEM_CANAL', { dica: 'manda .logs on no canal que voce quer os logs' });
    return;
  }
  const ch = await client.channels.fetch(st.channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) {
    // canal morreu (levado pelo nuke ou apagado na mao): limpa o cache e avisa o dono 1x a cada 30min
    if (st.webhookId) logWhCache.delete(st.webhookId);
    if (Date.now() - logsAvisoDonoEm > 30 * 60 * 1000) {
      logsAvisoDonoEm = Date.now();
      avisarDono(`⚠️ os **logs** estão ligados mas o canal <#${st.channelId}> sumiu (apagado ou levado pelo nuke). Manda \`.logs on\` no canal novo pra religar.`).catch(() => {});
    }
    log('LOGS_CANAL_MORTO', { channelId: st.channelId });
    return;
  }
  const wh = await getLogsWebhook(st).catch((e) => { log('LOGS_WEBHOOK_FAIL', { err: e && e.message }); return null; });
  if (!wh) {
    // webhook foi apagado: esquece o id velho e recria na proxima tentativa
    logWhCache.delete(st.webhookId);
    st.webhookId = '';
    salvarLogsState(st);
    log('LOGS_WEBHOOK_RECRIAR', { channelId: st.channelId });
    return;
  }
  if (logFalhaSeguida) log('LOGS_OK', { fila: logQueue.length, webhook: wh.id });
  logFalhaSeguida = 0;
}
setInterval(() => { vigiarLogs().catch(err); }, 5 * 60 * 1000);
function cardLogSimples(titulo, linhas, cor = 8912896) {
  const txt = [titulo ? `### ${titulo}` : '', ...linhas].filter(Boolean).join('\n');
  return {
    username: 'Satan Logs',
    allowedMentions: { parse: [] },
    flags: 1 << 15,
    components: [{ type: 17, accent_color: cor, components: [{ type: 10, content: corta(txt, 3900) }] }],
  };
}
function nomeUser(u) { return (u && (u.tag || u.username || u.id)) || 'desconhecido'; }
function avatarUser(u) { return u && u.displayAvatarURL ? u.displayAvatarURL({ size: 128 }) : null; }
function fmtCanal(id) { return id ? `<#${id}>` : '`-`'; }
function fmtUser(id) { return id ? `<@${id}>` : '`-`'; }
function conteudoMsg(m) {
  if (!m) return '*sem texto*';
  const partes = [];
  const content = m.content || '';
  partes.push(content ? limparCodigo(content) : '*sem texto*');
  if (m.attachments && m.attachments.size) partes.push('\n**Anexos:**\n' + [...m.attachments.values()].map((a) => a.url || a.name).slice(0, 10).join('\n'));
  if (m.stickers && m.stickers.size) partes.push('\n**Stickers:** ' + [...m.stickers.values()].map((x) => x.name || x.id).join(', '));
  if (m.embeds && m.embeds.length) partes.push(`\n**Embeds:** ${m.embeds.length}`);
  return corta(partes.join('\n'), 3600);
}
function logEvento(titulo, linhas, cor) { enfileirarLog(cardLogSimples(titulo, linhas, cor)); }
async function enviarLogMensagem(m) {
  const st = lerLogsState();
  if (!st.on || !m.guild || m.webhookId === st.webhookId) return;
  const logId = String(++logSeq);
  const avatar = m.author.displayAvatarURL ? m.author.displayAvatarURL({ size: 128 }) : null;
  const conteudo = m.content || '';
  logMsgCache.set(logId, { content: conteudo, authorId: m.author.id, guildId: m.guild.id, channelId: m.channelId, msgId: m.id });
  if (logMsgCache.size > 500) logMsgCache.delete(logMsgCache.keys().next().value);
  const desc = conteudoMsg(m);
  const tag = m.author.tag || m.author.username || m.author.id;
  enfileirarLog({
    username: corta(tag, 80),
    avatarURL: avatar || undefined,
    allowedMentions: { parse: [] },
    flags: 1 << 15,
    components: [{
      type: 17,
      accent_color: 8912896,
      components: [
        {
          type: 9,
          components: [
            { type: 10, content: `**${tag}**` },
            { type: 10, content: `-# ID: ${m.author.id}` },
          ],
          ...(avatar ? { accessory: { type: 11, media: { url: avatar }, description: tag } } : {}),
        },
        { type: 14, spacing: 1, divider: true },
        { type: 10, content: `**Canal:** <#${m.channelId}>\n**Mensagem:** \`${m.id}\`\n**Conta:** <@${m.author.id}>` },
        { type: 14, spacing: 1, divider: true },
        { type: 10, content: `**Conteúdo:**\n${desc}` },
        { type: 14, spacing: 1, divider: true },
        { type: 1, components: [
          { type: 2, style: 4, label: 'Banir', custom_id: `log_ban:${m.author.id}` },
          { type: 2, style: 4, label: 'Blacklist', custom_id: `log_bl:${m.author.id}` },
          { type: 2, style: 2, label: 'Tirar BL', custom_id: `log_unbl:${m.author.id}` },
          { type: 2, style: 1, label: 'Copiar msg', custom_id: `log_copy:${logId}` },
        ]},
      ],
    }],
  });
}
async function enviarLogSistema(texto) {
  const st = lerLogsState();
  if (!st.on) return;
  enfileirarLog({
    username: 'Satan Logs',
    allowedMentions: { parse: [] },
    flags: 1 << 15,
    components: [{
      type: 17,
      accent_color: 0xff4444,
      components: [
        { type: 10, content: String(texto).slice(0, 3900) },
      ],
    }],
  });
}



const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

client.once('ready', async () => {
  log('READY', { user: client.user.tag, id: client.user.id, guilds: client.guilds.cache.size });
  // troca de guarda: este bot ja esta online, agora sim derruba o run antigo do Actions.
  // (antes o antigo era cancelado ANTES do novo subir: 1-2min offline a cada redeploy,
  //  e era nesse buraco que spam passava e o .nuke now nao respondia)
  cancelarRunsAntigos().catch(err);
  client.user.setActivity('o sofrimento dos condenados', { type: 3 });
  // servidores do dono entram como "inferno" em TODO restart (o set comeca
  // vazio de hardcoded: sem isso o servidor novo ficava sem moderacao, sem
  // logs e sem boas-vindas depois que o processo reiniciasse)
  for (const g of client.guilds.cache.values()) {
    if (g.ownerId === OWNER_ID && !INFERNO_GUILDS.has(g.id)) { INFERNO_GUILDS.add(g.id); log('GUILD_ADOTADA', { guild: g.id, name: g.name }); }
  }
  // PANICO: o bot ta online e nao tem mais servidor nenhum. Em 28/09 foi assim
  // que os dois servidores sumiram - o dono precisa saber na hora, com o
  // backup esta no repositorio, versionado
  if (client.guilds.cache.size === 0) {
    log('PANICO_SEM_SERVIDOR', { user: client.user.id });
    setTimeout(() => avisarDono([
      '🚨 **o bot está online e não está em nenhum servidor.**',
      'Se o seu servidor caiu de novo, o backup da estrutura está no repositório (`server_snapshot.json` / `server_blueprint.json`, versionados).',
      'Recria o servidor e me adiciona nele que eu me configuro sozinho.',
      'Se você está lendo isso e o servidor existe, provavelmente o bot foi removido de lá: me adiciona de novo.',
    ].join('\n')).catch(() => {}), 10000);
  }
  const gSnap = client.guilds.cache.get(GUILD_OFICIAL) || client.guilds.cache.find((g) => g.ownerId === OWNER_ID) || client.guilds.cache.first();
  if (gSnap) salvarSnapshot(gSnap).catch(err); // backup da estrutura do servidor ao ligar
  // ordem dos canais (inferno em primeiro, confessionario em segundo) tambem no
  // boot: senao o conserto so apareceria no proximo nuke, ate 1h depois do deploy
  if (gSnap) {
    const confBoot = [...gSnap.channels.cache.values()].find((c) => /confessionar/i.test(c.name || ''));
    if (confBoot) garantirOrdemInferno(gSnap, confBoot, { log }).catch(err);
  }
  // (auto-setup de blueprint removido — apenas comandos essenciais mantidos)
  if (typeof varrerLinks === 'function') varrerLinks().catch(err); else err(new Error('varrerLinks ausente no ready'));
  if (typeof varrerPalavras === 'function') varrerPalavras().catch(err); else err(new Error('varrerPalavras ausente no ready'));
  if (typeof varrerFlood === 'function') varrerFlood().catch(err); else err(new Error('varrerFlood ausente no ready'));
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
  // logs: confere o canal/webhook ja no boot e deixa escrito no log do runner se estao vivos
  const logsBoot = lerLogsState();
  log('LOGS_BOOT', { on: !!logsBoot.on, channelId: logsBoot.channelId || null, webhookId: logsBoot.webhookId || null });
  vigiarLogs().catch(err);
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

// backup quando a estrutura muda (canal/cargo criado, editado ou apagado)
for (const ev of ['channelCreate', 'channelUpdate', 'channelDelete', 'roleCreate', 'roleUpdate', 'roleDelete']) {
  client.on(ev, (alvo) => { if (alvo && alvo.guild) agendarSnapshot(alvo.guild); });
}
client.on('guildUpdate', (antigo, novo) => agendarSnapshot(novo || antigo));

// membro novo no inferno -> manda as boas-vindas na DM
client.on('guildMemberAdd', async (member) => {
  if (!INFERNO_GUILDS.has(member.guild.id)) return;
  if (!member.user.bot) logEvento('🟢 membro entrou', [
    `**Conta:** <@${member.id}>`,
    `**Nome:** ${member.user.tag}`,
    `**ID:** ${member.id}`,
    `**Criada:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
  ], 0x2ecc71);
  if (blacklistTem(member.id)) {
    try {
      await member.ban({ reason: 'blacklist: entrou novamente' });
      log('BLACKLIST_AUTO_BAN', { user: member.id, tag: member.user.tag, guild: member.guild.id });
      enviarLogSistema(`🚫 <@${member.id}> (${member.user.tag}) entrou e foi banido automaticamente pela blacklist.`).catch(() => {});
    } catch (e) { err(e); }
    return;
  }
  try {
    await member.send(WELCOME_MSG);
    log('WELCOME', { user: member.id, tag: member.user.tag });
  } catch (e) {
    log('WELCOME_FAIL', { user: member.id, err: e && e.message });
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    if (!member.guild || !INFERNO_GUILDS.has(member.guild.id) || (member.user && member.user.bot)) return;
    logEvento('🔴 membro saiu', [
      `**Conta:** ${fmtUser(member.id)}`,
      `**Nome:** ${nomeUser(member.user)}`,
      `**ID:** ${member.id}`,
    ], 0xe74c3c);
  } catch (e) { err(e); }
});

client.on('guildMemberUpdate', async (oldM, newM) => {
  try {
    if (!newM.guild || !INFERNO_GUILDS.has(newM.guild.id) || (newM.user && newM.user.bot)) return;
    const linhas = [`**Conta:** ${fmtUser(newM.id)}`, `**ID:** ${newM.id}`];
    if ((oldM.nickname || '') !== (newM.nickname || '')) linhas.push(`**Nick:** \`${oldM.nickname || '-'}\` → \`${newM.nickname || '-'}\``);
    const oldRoles = oldM.roles && oldM.roles.cache ? new Set(oldM.roles.cache.keys()) : new Set();
    const newRoles = newM.roles && newM.roles.cache ? new Set(newM.roles.cache.keys()) : new Set();
    const add = [...newRoles].filter((id) => !oldRoles.has(id) && id !== newM.guild.id);
    const rem = [...oldRoles].filter((id) => !newRoles.has(id) && id !== newM.guild.id);
    if (add.length) linhas.push(`**Cargos +:** ${add.map((id) => `<@&${id}>`).join(' ')}`);
    if (rem.length) linhas.push(`**Cargos -:** ${rem.map((id) => `<@&${id}>`).join(' ')}`);
    const oldTo = oldM.communicationDisabledUntilTimestamp || 0;
    const newTo = newM.communicationDisabledUntilTimestamp || 0;
    if (oldTo !== newTo) linhas.push(newTo ? `**Timeout:** até <t:${Math.floor(newTo / 1000)}:F>` : '**Timeout:** removido');
    if (linhas.length > 2) logEvento('📝 membro atualizado', linhas, 0xf1c40f);
  } catch (e) { err(e); }
});

client.on('guildBanAdd', async (ban) => {
  try {
    if (!ban.guild || !INFERNO_GUILDS.has(ban.guild.id) || (ban.user && ban.user.bot)) return;
    logEvento('🚫 membro banido', [`**Conta:** ${fmtUser(ban.user.id)}`, `**Nome:** ${nomeUser(ban.user)}`, `**ID:** ${ban.user.id}`], 0xe74c3c);
  } catch (e) { err(e); }
});

client.on('guildBanRemove', async (ban) => {
  try {
    if (!ban.guild || !INFERNO_GUILDS.has(ban.guild.id) || (ban.user && ban.user.bot)) return;
    logEvento('✅ membro desbanido', [`**Conta:** ${fmtUser(ban.user.id)}`, `**Nome:** ${nomeUser(ban.user)}`, `**ID:** ${ban.user.id}`], 0x2ecc71);
  } catch (e) { err(e); }
});

client.on('voiceStateUpdate', async (oldS, newS) => {
  try {
    const guild = newS.guild || oldS.guild;
    const member = newS.member || oldS.member;
    if (!guild || !member || !INFERNO_GUILDS.has(guild.id) || (member.user && member.user.bot)) return;
    const linhas = [`**Conta:** ${fmtUser(member.id)}`, `**ID:** ${member.id}`];
    if (!oldS.channelId && newS.channelId) linhas.push(`**Entrou na call:** ${fmtCanal(newS.channelId)}`);
    else if (oldS.channelId && !newS.channelId) linhas.push(`**Saiu da call:** ${fmtCanal(oldS.channelId)}`);
    else if (oldS.channelId !== newS.channelId) linhas.push(`**Mudou de call:** ${fmtCanal(oldS.channelId)} → ${fmtCanal(newS.channelId)}`);
    if (oldS.selfMute !== newS.selfMute) linhas.push(`**Mic:** ${newS.selfMute ? 'mutado' : 'desmutado'}`);
    if (oldS.selfDeaf !== newS.selfDeaf) linhas.push(`**Áudio:** ${newS.selfDeaf ? 'surdo' : 'ouvindo'}`);
    if (oldS.streaming !== newS.streaming) linhas.push(`**Stream:** ${newS.streaming ? 'iniciou' : 'parou'}`);
    if (oldS.selfVideo !== newS.selfVideo) linhas.push(`**Câmera:** ${newS.selfVideo ? 'ligou' : 'desligou'}`);
    if (linhas.length > 2) logEvento('🔊 call', linhas, 0x3498db);
  } catch (e) { err(e); }
});

client.on('messageUpdate', async (oldM, newM) => {
  try {
    if (!newM.guild || !INFERNO_GUILDS.has(newM.guild.id)) return;
    if (newM.webhookId && lerLogsState().webhookId === newM.webhookId) return;
    if (newM.author && newM.author.bot && !newM.webhookId) return;
    const oldTxt = oldM && oldM.content ? oldM.content : '';
    const newTxt = newM && newM.content ? newM.content : '';
    if (oldTxt === newTxt) return;
    logEvento('✏️ mensagem editada', [
      `**Conta:** ${fmtUser(newM.author && newM.author.id)}`,
      `**Canal:** ${fmtCanal(newM.channelId)}`,
      `**Mensagem:** \`${newM.id}\``,
      `**Antes:**
${corta(limparCodigo(oldTxt || '*sem cache*'), 1200)}`,
      `**Depois:**
${corta(limparCodigo(newTxt || '*sem texto*'), 1200)}`,
    ], 0xf1c40f);
  } catch (e) { err(e); }
});

client.on('messageDelete', async (m) => {
  try {
    if (!m.guild || !INFERNO_GUILDS.has(m.guild.id)) return;
    if (m.webhookId && lerLogsState().webhookId === m.webhookId) return;
    if (m.author && m.author.bot && !m.webhookId) return;
    logEvento('🗑️ mensagem apagada', [
      `**Conta:** ${fmtUser(m.author && m.author.id)}`,
      `**Canal:** ${fmtCanal(m.channelId)}`,
      `**Mensagem:** \`${m.id}\``,
      `**Conteúdo:**
${conteudoMsg(m)}`,
    ], 0x95a5a6);
  } catch (e) { err(e); }
});

client.on('messageDeleteBulk', async (msgs, channel) => {
  try {
    const guild = channel && channel.guild;
    if (!guild || !INFERNO_GUILDS.has(guild.id)) return;
    logEvento('🧹 mensagens apagadas em massa', [`**Canal:** ${fmtCanal(channel.id)}`, `**Quantidade:** ${msgs.size}`], 0x95a5a6);
  } catch (e) { err(e); }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
    if (!reaction.message || !reaction.message.guild || !INFERNO_GUILDS.has(reaction.message.guild.id) || user.bot) return;
    logEvento('➕ reação adicionada', [`**Conta:** ${fmtUser(user.id)}`, `**Canal:** ${fmtCanal(reaction.message.channelId)}`, `**Mensagem:** \`${reaction.message.id}\``, `**Emoji:** ${reaction.emoji}`], 0x3498db);
  } catch (e) { err(e); }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
    if (!reaction.message || !reaction.message.guild || !INFERNO_GUILDS.has(reaction.message.guild.id) || user.bot) return;
    logEvento('➖ reação removida', [`**Conta:** ${fmtUser(user.id)}`, `**Canal:** ${fmtCanal(reaction.message.channelId)}`, `**Mensagem:** \`${reaction.message.id}\``, `**Emoji:** ${reaction.emoji}`], 0x3498db);
  } catch (e) { err(e); }
});

client.on('typingStart', async (t) => {
  try {
    if (!t.guild || !INFERNO_GUILDS.has(t.guild.id) || !t.user || t.user.bot) return;
    // log de digitando e muito barulhento; fica so no console pra nao poluir o webhook
    log('TYPING', { user: t.user.id, channel: t.channel && t.channel.id });
  } catch (e) { err(e); }
});


// ---------- estado persistente no repo GitHub (sobrevive a religadas/updates) ----------
const GH_STATE_FILES = ['nuke_state.json', 'bump_state.json', 'mute_state.json', 'nuke_log.json', 'logs_state.json', 'blacklist_state.json', 'blacklist_palavras.json', 'server_snapshot.json', 'antiflood_state.json'];
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
// o antiflood_state.json chega junto: descarta o cache lido antes do download
ghStatePronto.then(() => { antifloodMem = null; }).catch(() => {});
setInterval(ghStateSyncTick, 60 * 1000);

// ---------- backup de estrutura do servidor (server_snapshot.json no repo) ----------
// canais + permissoes, cargos, emojis e stickers salvos no repo: o historico do
// git vira backup. (incidente 28/09: os servidores cairam e nada disso existia
// em lugar nenhum - so os logs do runner, sem acesso facil.)
const SNAPSHOT = path.join(ROOT, 'server_snapshot.json');
// quantos canais+categorias um snapshot conhece (serve pra comparar versoes)
function qtdCanaisSnap(s) {
  if (!s || !Array.isArray(s.canais)) return 0;
  return s.canais.length + (Array.isArray(s.categorias) ? s.categorias.length : 0);
}
async function salvarSnapshot(guild, { forcado = false } = {}) {
  try {
    const snap = snapshotGuild(guild, { salvoEm: new Date().toISOString() });
    // NAO deixa um snapshot pior sobrescrever o backup bom: se sumiram canais
    // (alguem apagou, raid, bug), o backup com a estrutura completa é justamente
    // o que permite restaurar depois. Sem isso, o proximo boot do bot jogaria
    // fora o unico backup que ainda tem os canais. Pra forçar: salvarSnapshot(guild, { forcado: true })
    const anterior = readJsonSafe(SNAPSHOT, null);
    if (!forcado && qtdCanaisSnap(anterior) > qtdCanaisSnap(snap)) {
      log('SNAPSHOT_RECUSADO', { salvo: qtdCanaisSnap(anterior), novo: qtdCanaisSnap(snap), salvoEm: anterior && anterior.salvoEm });
      return 'recusado';
    }
    fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));
    ghStateSyncTick();
    log('SNAPSHOT_SALVO', { guild: guild.id, nome: guild.name, canais: snap.canais.length + snap.categorias.length, cargos: snap.cargos.length });
    return 'salvo';
  } catch (e) { err(e); return 'erro'; }
}
const snapshotTimer = new Map(); // guildId -> timer (agrupa rajadas de mudancas)
function agendarSnapshot(guild, atrasoMs = 30 * 1000) {
  if (!guild) return;
  if (snapshotTimer.has(guild.id)) return;
  snapshotTimer.set(guild.id, setTimeout(() => {
    snapshotTimer.delete(guild.id);
    salvarSnapshot(guild).catch(err);
  }, atrasoMs));
}

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

// ---------- painel unico do .bloquear (components V2) ----------
// Tudo por CLIQUE: cada palavra aparece num menu de seleção e, clicando nela,
// o bot remove na hora (o dono pediu: "podia ser tudo só clicando dentro").
// Só o "Adicionar" abre modal, porque escrever palavra nova exige teclado.
const PALAVRAS_POR_PAGINA = 25;
function bloquearPanel(nota = '', pagina = 0) {
  const st = lerPalavrasBloqueadas();
  const lista = listarPalavras(st);
  const total = lista.length;
  const totalPags = Math.max(1, Math.ceil(total / PALAVRAS_POR_PAGINA));
  const pag = Math.min(Math.max(0, Number(pagina) || 0), totalPags - 1);
  const coms = [
    { type: 10, content: '# 🔒 palavras bloqueadas\n-# clique na palavra pra desbloquear na hora — sem digitar nada' },
  ];
  if (total) {
    coms.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `bloq_sel:${pag}`,
        placeholder: 'escolha a palavra pra remover',
        options: lista.slice(pag * PALAVRAS_POR_PAGINA, pag * PALAVRAS_POR_PAGINA + PALAVRAS_POR_PAGINA).map((p) => ({
          label: String(p.termo).slice(0, 100),
          value: p.chave,
          description: `${p.usos || 0} uso(s)`.slice(0, 100),
        })),
      }],
    });
  }
  if (totalPags > 1) {
    coms.push({
      type: 1,
      components: [
        { type: 2, style: 2, label: '◀', custom_id: `bloq_pg:${Math.max(0, pag - 1)}`, disabled: pag <= 0 },
        { type: 2, style: 2, label: `página ${pag + 1}/${totalPags}`, custom_id: 'bloq_pg_atual', disabled: true },
        { type: 2, style: 2, label: '▶', custom_id: `bloq_pg:${Math.min(totalPags - 1, pag + 1)}`, disabled: pag >= totalPags - 1 },
      ],
    });
  }
  coms.push({ type: 14, spacing: 1, divider: true });
  coms.push({
    type: 10,
    content: [
      `**${total}** palavra(s) bloqueada(s)${nota ? ` • ${nota}` : ''}`,
      '-# casa por FORMAÇÃO: o termo é o COMEÇO da palavra (estupr → estupro, stupro, estuprar; deixa estudo em paz).',
      '-# termo de 2 letras (cu, cp) só casa a palavra inteira.',
    ].join('\n'),
  });
  coms.push({ type: 14, spacing: 1, divider: true });
  coms.push({
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Adicionar', custom_id: 'bloq_add' },
      { type: 2, style: 2, label: 'Testar frase', custom_id: 'bloq_test' },
      { type: 2, style: 2, label: 'Atualizar', custom_id: 'bloq_refresh' },
      { type: 2, style: 4, label: 'Fechar', custom_id: 'bloq_close' },
    ],
  });
  return { flags: 1 << 15, components: [{ type: 17, accent_color: 8912896, components: coms }] };
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
  const logsStAtual = lerLogsState();
  if (m.webhookId && (isOwnWebhookId(m.webhookId) || (logsStAtual.webhookId && m.webhookId === logsStAtual.webhookId))) return; // nao filtrar/logar webhooks do proprio bot
  // Bots reais continuam ignorados, mas webhook precisa passar pelo filtro:
  // raid costuma usar webhook e, no Discord, webhook aparece como author.bot.
  if (m.author.bot && !m.webhookId) return;
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
  enviarLogMensagem(m).catch(err);
  if (m.author.id === OWNER_ID) {
    // fala do dono: tag propria pra achar rapido no log
    log('DONO', { channel: m.channelId, where: rec.where, content: m.content });
  } else {
    log('MSG', rec);
  }

  // ---------- comandos do dono — apenas os permitidos ----------
  if (m.guild && m.author.id === OWNER_ID) {
    const c = m.content.trim().toLowerCase();
    const cRaw = m.content.trim();

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
        log('NUKE_ON_GLOBAL', { guild: m.guild.id, nextAt: st2.nextAt, cmdChannel: m.channel.id });
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
    // .logs on/off/teste/status
    if (c === '.logs' || c.startsWith('.logs')) {
      await m.delete().catch(() => {});
      const sub = (m.content.trim().split(/\s+/)[1] || '').toLowerCase();
      const st = lerLogsState();
      if (sub === 'off' || sub === 'desligar') {
        st.on = false;
        salvarLogsState(st);
        await whSend(m.channel, 'logs **off**. nada é postado no canal de logs (o estado fica salvo, `.logs on` religa).').catch(() => {});
        log('LOGS_OFF', { channel: m.channelId });
        return;
      }
      if (sub === 'on' || sub === 'ligar' || sub === 'canal' || sub === 'aqui' || sub === 'rebind') {
        st.on = true;
        st.channelId = m.channelId;
        if (st.webhookId) logWhCache.delete(st.webhookId);
        st.webhookId = '';
        const wh = await getLogsWebhook(st).catch((e) => { err(e); return null; });
        if (wh) st.webhookId = wh.id;
        salvarLogsState(st);
        if (wh) {
          await whSend(m.channel, `logs **on** em <#${m.channelId}> — tudo que acontecer aqui dentro vai sair em tempo real por esse canal, e continua ligado depois de reiniciar.`).catch(() => {});
          await enviarLogSistema(`✅ logs ligados neste canal por <@${m.author.id}>.`).catch(() => {});
          vigiarLogs().catch(() => {});
        } else {
          await whSend(m.channel, 'não consegui criar o webhook de logs aqui — me dá **Gerenciar Webhooks** nesse canal e manda `.logs on` de novo.').catch(() => {});
        }
        log('LOGS_ON', { channel: m.channelId, webhookId: st.webhookId, webhook: !!wh });
        return;
      }
      if (sub === 'teste') {
        await enviarLogSistema(`🧪 teste de logs pedido por <@${m.author.id}> — se você leu isso no canal de logs, tá tudo vivo.`).catch(() => {});
        await whSend(m.channel, st.channelId ? `mandei um teste em <#${st.channelId}>.` : 'os logs estão ligados **sem canal**: manda `.logs on` no canal que você quer.').catch(() => {});
        return;
      }
      const onde = st.channelId ? ` em <#${st.channelId}>` : ' **sem canal** (manda `.logs on` no canal que você quer)';
      await whSend(m.channel, [
        `logs: **${st.on ? 'on' : 'off'}**${st.on ? onde : ''}`,
        st.webhookId ? `-# webhook \`${st.webhookId}\` • fila ${logQueue.length} • vigia a cada 5min (recria o webhook se apagarem)` : '-# sem webhook ainda',
        '',
        '**`.logs on`** liga neste canal  •  **`.logs off`** desliga  •  **`.logs teste`** confere se tá vivo',
      ].join('\n')).catch(() => {});
      return;
    }
    // .cl [qtd]
    if (c === '.cl' || c.startsWith('.cl ')) {
      const n = parseInt(c.split(/\s+/)[1], 10);
      const total = isNaN(n) ? 10 : Math.min(Math.max(n, 1), 500);
      try {
        await m.delete().catch(() => {});
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
    // .antiflood — o que o anti-flood andou fazendo (nao depende do canal de logs)
    if (c === '.antiflood' || c === '.af') {
      await m.delete().catch(() => {});
      const stAF = estadoAntiflood();
      const dia = new Date().toISOString().slice(0, 10);
      const hoje = stAF.stats[dia] || { deteccoes: 0, apagadas: 0, castigos: 0, falhas: 0 };
      const perms = m.channel.permissionsFor(m.guild.members.me);
      const falta = perms ? missingPerms((p) => perms.has(p)) : Object.keys(PERMS_BOT_CANAL);
      const linhaAcao = (a) => {
        const p = [`-# ${String(a.ts || '').slice(11, 19)}`];
        if (a.autor) p.push(`<@${a.autor}>`);
        if (a.canal) p.push(`<#${a.canal}>`);
        if (a.motivo) p.push('`' + corta(String(a.motivo), 50) + '`');
        if (a.castigo) p.push(`castigo ${a.castigo}h`);
        else if (a.castigo === 0) p.push('⚠️ castigo falhou');
        if (a.apagou === false) p.push('⚠️ não apagou');
        else if (a.apagou === true) p.push(`${a.apagadas || 1} apagada(s)`);
        if (a.erro) p.push('erro: ' + corta(String(a.erro), 60));
        return p.join(' • ');
      };
      const ultimas = stAF.acoes.slice(0, 8).map(linhaAcao);
      await whSend(m.channel, [
        '**anti-flood**',
        `hoje: **${hoje.deteccoes}** detecções • **${hoje.apagadas}** mensagens apagadas • **${hoje.falhas}** falhas de exclusão`,
        `autores monitorados agora: **${Object.keys(stAF.rep).length}**`,
        `-# faxina do histórico: ${stAF.faxina ? `${stAF.faxina.canais || 0} canal(is), ${stAF.faxina.apagadas || 0} apagada(s) • ${String(stAF.faxina.em || '').slice(0, 16).replace('T', ' ')} UTC` : 'ainda nao rodou'}`,
        `permissões neste canal: ${falta.length ? '⚠️ faltando ' + falta.join(', ') : '✅ ok'}`,
        '',
        ultimas.length ? '**últimas ações:**' : '-# nenhuma ação registrada ainda',
        ...ultimas,
      ].join('\n')).catch((e) => err(e));
      log('ANTIFLOOD_PAINEL', { canal: m.channelId, deteccoes: hoje.deteccoes });
      return;
    }

    // .bump
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
    // .fig
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
    // .bloquear — painel unico em components V2
    if (c === '.bloquear' || c.startsWith('.bloquear')) {
      await m.delete().catch(() => {});
      await whSend(m.channel, bloquearPanel()).catch((e) => err(e));
      log('BLOQUEAR_PAINEL', { channel: m.channelId });
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


  // ---------- anti-flood: apaga na hora, sem esperar o flood terminar ----------
  // TODA mensagem conta pro flood, independente de qual regra ja pegou ela
  try {
    if (!m.guild) return;
    if (m.author.id === OWNER_ID) return; // o dono e imune: nada e apagado nele

    // 0) ÚNICO filtro de conteúdo: a lista DO DONO (.bloquear). O filtro de
    //    denúncia sai do ao vivo a pedido dele (02/10): quem cuida das palavras
    //    agora é a lista dele, que casa por formação. Sem castigo: apaga e
    //    registra (o dono vê no .antiflood e nos logs). A classificação de
    //    denúncia continua só na faxina do histórico (ver motivosLegado).
    if (m.content) {
      const stPal = lerPalavrasBloqueadas();
      const hit = casarPalavras(m.content, stPal);
      if (hit) {
        registrarUso(stPal, hit.chave);
        salvarPalavras(stPal);
        let erroPal = null;
        let apagouPal = await m.delete().then(() => true).catch((e) => { erroPal = e; return false; });
        if (!apagouPal) {
          // canal com permissao quebrada (nuke/overwrite): tenta reparar e repete
          const curouPal = await garantirPermModeracao(m.guild, m.channel).catch(() => false);
          if (curouPal) apagouPal = await m.delete().then(() => true).catch((e) => { erroPal = e; return false; });
          if (!apagouPal) {
            // guarda o erro REAL no estado (antes ficava so "delete falhou"):
            // e assim que da pra saber se foi falta de permissao (50013), mensagem
            // ja apagada (10008) ou rate limit (429)
            log('PALAVRA_BLOQUEADA_FALHA', {
              guild: m.guild.id, canal: m.channelId, user: m.author.id, autorBot: !!m.author.bot,
              webhook: !!m.webhookId, termo: hit.termo, curouPal,
              erro: erroPal && (erroPal.code || erroPal.status || erroPal.message),
            });
            avisarFalhaDelete(m, `bloqueio:${hit.termo}`, erroPal || 'delete falhou').catch(err);
          }
        }
        log('PALAVRA_BLOQUEADA', { guild: m.guild.id, canal: m.channelId, user: m.author.id, autorBot: !!m.author.bot, termo: hit.termo, usos: hit.entrada.usos, apagou: apagouPal });
        registrarAcaoAntiflood({ canal: m.channelId, guild: m.guild.id, autor: m.author.id, motivo: `bloqueio:${hit.termo}`, apagou: apagouPal, apagadas: apagouPal ? 1 : 0, tipo: 'palavra', ...(apagouPal ? {} : { erro: corta(String((erroPal && (erroPal.code || erroPal.status)) || erroPal || 'delete falhou'), 120), autorBot: !!m.author.bot, webhook: !!m.webhookId }) });
        logEvento('🚫 palavra bloqueada', [
          `**Palavra:** \`${hit.termo}\``,
          `**Conta:** <@${m.author.id}> (\`${m.author.id}\`)`,
          `**Canal:** <#${m.channelId}>`,
          `**Trecho:** ${corta(limparCodigo(m.content), 300)}`,
          apagouPal ? '' : '⚠️ **não consegui apagar** (confira minhas permissões neste canal).',
        ].filter(Boolean), 0x992d22);
        return;
      }
    }
    const cfg = readJsonSafe(ANTIFLOOD_CFG, ANTIFLOOD_DEFAULT);
    const reasons = [];
    const now = Date.now();

    // 1) limite de caracteres por mensagem (nao poluir tela de celular)
    if (m.content.length > cfg.chars) reasons.push(`chars>${cfg.chars}`);

    // 1.5) qualquer link / convite de server morre na hora
    if (temLink(m.content)) reasons.push('link');
    // 1.5b) link de cdn do discord (imagem colada como texto / embed): morre sempre
    if (temLinkCdn(m)) reasons.push('link-cdn');

    // 1.55) repeticao DENTRO da mensagem: mesma palavra/emoji mais de 3x
    //       (nigga\nnigga\nnigga..., oi oi oi oi, oioioioi, 😂😂😂😂). k liberado.
    {
      const rep = repeticaoInterna(m.content);
      if (rep) reasons.push(rep);
    }

    // 1.6) asterisco (markdown quebrado tipo **teste*): apaga na hora, sem mais nada
    if ((m.content || '').includes('*')) reasons.push('asterisco');

    // 1.6b) comeca com # (tenta virar texto grande/bold): apaga na hora
    if (/^#/.test((m.content || '').trim())) reasons.push('header');

    // 1.7) mensagem invisivel (so espacos/zero-width/tags unicode): apaga na hora
    {
      const bruto = m.content || '';
      const visivel = bruto.replace(RE_INV, '');
      if (bruto.length > 0 && visivel.length === 0) {
        reasons.push('invisivel');
      }
    }

    // 2) repeticao da MESMA mensagem pelo MESMO autor — a regra individual
    //    principal. O contador mora em antiflood_state.json (persiste):
    //      a partir da 2a copia na janela -> apaga essa, as anteriores e o
    //      backlog do autor. SEM castigo (o dono nao quer timeout): so apagar.
    //    Janela de 5 min: pega o flood lento (1 copia a cada ~40s) que a janela
    //    antiga de 30s deixava passar — e que tambem se perdia a cada restart
    //    do bot, porque o contador era so memoria.
    let repeticaoAgora = null;
    {
      const sig = msgSig(m);
      const txt = (m.content || '').trim();
      const soEmoji = txt.length > 0 && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]+$/u.test(txt);
      // mensagem curtinha/emoji: janela CURTA (30s), senao "kkk" ou o mesmo
      // emoji duas vezes em 5 min de conversa normal cairia como flood
      const cfgRep = soEmoji || sig.length < 8 ? { ...cfg, repMs: Math.min(30000, cfg.repMs || 30000) } : cfg;
      const stAF = estadoAntiflood();
      const rep = registrarRepeticao(stAF.rep, { userId: m.author.id, sig, agora: now, cfg: cfgRep });
      const decisao = decidirRepeticao(rep.qtd, cfg);
      if (decisao) {
        repeticaoAgora = { ...rep, decisao };
        reasons.push(`repetiu-${rep.qtd}x`);
      }
      podarLedger(stAF.rep, now, cfg);
      salvarAntiflood();
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

    // 5) (removido) castigo por 10+ repeticoes: a regra 2 ja apaga desde a 2a
    //    copia e o dono nao quer castigo nenhum — só apagar.

    // 5b) 5+ mensagens so de emoji -> apaga (sem castigo). Conta seguidas E por
    //     janela: texto no meio nao zera mais a chuva (5 emojis em 60s cai
    //     mesmo com "oi" entre eles)
    {
      const txt = (m.content || '').trim();
      const soEmoji = txt.length > 0 && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]+$/u.test(txt);
      if (soEmoji) {
        const q = (emoStreak.get(m.author.id) || 0) + 1;
        emoStreak.set(m.author.id, q);
        const arr = (emoBuf.get(m.author.id) || []).filter((t) => now - t < cfg.emojiWindowMs);
        arr.push(now);
        emoBuf.set(m.author.id, arr);
        if (q >= 5 || arr.length >= (cfg.emojiMax || 5)) reasons.push('chuva-emojis');
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

    // 6) (removido) chuva de link e o antigo castigo por link: o filtro de link
    //    saiu a pedido do dono, e timeout nao existe mais.

    const recentes = registrarRecente(m, reasons, now, cfg.retroMs || RECENT_MSG_MS);
    if (reasons.length) {
      const motivo = reasons.join('+');
      let retro = await apagarRelacionadas(m, recentes, motivo).catch((e) => { err(e); return 0; });
      // quem repetiu a MESMA mensagem perde tambem o backlog que o buffer em
      // memoria nao alcanca (mensagens de antes do restart, flood lento)
      if (repeticaoAgora) retro += await limparRepetidasDoAutor(m, cfg.retroMs || RECENT_MSG_MS).catch(() => 0);
      // apaga a mensagem atual; se falhar, tenta se curar (canal sem permissao:
      // nuke/overwrite quebrado) e so entao avisa o dono — sem silencio
      let erroAF = null;
      let apagou = await m.delete().then(() => true).catch((e) => { erroAF = e; return false; });
      if (!apagou) {
        const curou = await garantirPermModeracao(m.guild, m.channel).catch(() => false);
        if (curou) apagou = await m.delete().then(() => true).catch((e) => { erroAF = e; return false; });
        if (!apagou) {
          log('ANTIFLOOD_DELETE_FAIL', { reason: motivo, author: m.author.id, channel: m.channelId, deletable: m.deletable, curou, erro: erroAF && (erroAF.code || erroAF.status || erroAF.message) });
          avisarFalhaDelete(m, motivo, erroAF || 'delete falhou (mesmo depois de tentar consertar a permissão)').catch(err);
        }
      }
      const apagadas = (apagou ? 1 : 0) + retro;
      log('ANTIFLOOD', { reason: motivo, kind: msgKind(m), author: m.author.id, channel: m.channelId, len: m.content.length, apagou, retro });
      registrarAcaoAntiflood({
        canal: m.channelId, guild: m.guild.id, autor: m.author.id, motivo,
        apagou, apagadas, tipo: msgKind(m),
      });
      // visivel pro dono: antes a acao ia so pro console do runner e parecia
      // que o bot "nao fazia nada" no servidor
      logEvento('🛡️ Anti-flood', [
        `**Conta:** <@${m.author.id}>`,
        `**Canal:** <#${m.channelId}>`,
        `**Motivo:** \`${motivo}\``,
        apagou ? `**Mensagens apagadas:** ${apagadas}${retro ? ` (${retro} retroativa${retro > 1 ? 's' : ''})` : ''}` : '⚠️ **Não consegui apagar** (confira as permissões).',
      ], apagou ? 0xe67e22 : 0xff4444);
    }
  } catch (e) {
    err(e);
  }
});

// delete falhando (normalmente falta Gerenciar Mensagens no canal) nao pode ser
// silencioso: avisa o dono 1x por canal a cada 30min e registra no canal de logs
const falhaDeleteAvisoEm = new Map(); // channelId -> ts do ultimo aviso
async function avisarFalhaDelete(m, motivo, erro) {
  const codigo = Number((erro && erro.code) || (erro && erro.status)) || 0;
  const semPerm = !m.deletable || [50001, 50013].includes(codigo);
  const agora = Date.now();
  // toda falha fica registrada no antiflood_state.json (versionado no repo):
  // mesmo com o canal de logs off, da pra ver depois que o bot TENTOU e falhou
  // posicao do cargo do autor x posicao do cargo do bot: e o que explica delete
  // recusado mesmo com Gerenciar Mensagens (autor com cargo igual/acima do bot)
  const posCargo = (mem) => (mem && mem.roles && mem.roles.highest ? mem.roles.highest.position : null);
  registrarAcaoAntiflood({
    canal: m.channelId, guild: m.guild && m.guild.id, autor: m.author.id, motivo,
    apagou: false, erro: corta(String(erro || 'desconhecido'), 120),
    autorBot: !!(m.author && m.author.bot), webhook: !!m.webhookId,
    canalNome: m.channel && m.channel.name,
    posAutor: posCargo(m.member),
    posBot: m.guild && m.guild.members ? posCargo(m.guild.members.me) : null,
  });
  const ultimo = falhaDeleteAvisoEm.get(m.channelId) || 0;
  if (agora - ultimo < 30 * 60 * 1000) return;
  falhaDeleteAvisoEm.set(m.channelId, agora);
  logEvento('⚠️ Anti-flood sem permissão', [
    `**Canal:** <#${m.channelId}>`,
    `**Motivo do anti-flood:** \`${motivo}\``,
    `**Erro:** ${erro || 'desconhecido'}`,
    semPerm ? 'Preciso de **Gerenciar Mensagens** (e Histórico) neste canal.' : 'Confira as permissões do bot.',
  ], 0xff4444);
  // aviso no proprio canal: se o bot nao consegue apagar, todo mundo ve que ele
  // ao menos detectou — e o dono fica sabendo por DM, nao por acaso
  const tmp = await whSend(m.channel, `⚠️ detectei flood de <@${m.author.id}> mas **não consegui apagar** (${semPerm ? 'falta Gerenciar Mensagens neste canal' : 'erro: ' + (erro || '?')}). já avisei o dono.`).catch(() => null);
  if (tmp) setTimeout(() => tmp.delete().catch(() => {}), 20000);
  await avisarDono(`⚠️ Não consegui apagar spam em <#${m.channelId}> (motivo: ${motivo}). ${semPerm ? 'Falta permissão de Gerenciar Mensagens neste canal.' : 'Erro: ' + (erro || '?')}`);
}

// ---------- anti-flood: só apagar ----------
// (castigo/timeout removido a pedido do dono, 02/10: "n preciso do castigo
//  de jeito nenhum, só apagar mesmo". Nada aqui aplica timeout.)

// varre os canais ao ligar: apaga sobra de flood/repetida/invisivel que passou durante o gap do restart
async function varrerFlood() {
  const cfgV = readJsonSafe(ANTIFLOOD_CFG, ANTIFLOOD_DEFAULT);
  const cfgRetro = cfgV.retroMs || ANTIFLOOD_DEFAULT.retroMs;
  const cfgChars = cfgV.chars || ANTIFLOOD_DEFAULT.chars;
  // contadores de repeticao velhos nao precisam sobreviver no estado
  try { podarLedger(estadoAntiflood().rep, Date.now(), cfgV); salvarAntiflood(); } catch (e) { err(e); }
  for (const gid of INFERNO_GUILDS) {
    const g = client.guilds.cache.get(gid);
    if (!g) continue;
    for (const ch of [...g.channels.cache.values()]) {
      if (!ch.isTextBased()) continue;
      try {
        const msgs = (await ch.messages.fetch({ limit: 100 })).filter((x) => (!x.author.bot || x.webhookId) && !isOwnWebhookId(x.webhookId) && x.author.id !== OWNER_ID && x.deletable);
        const por = {};
        for (const x of [...msgs.values()]) (por[x.author.id] = por[x.author.id] || []).push(x);
        const alvos = new Set();
        for (const arr of Object.values(por)) {
          arr.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          for (let i = 1; i < arr.length; i++) {
            if (msgSig(arr[i]) === msgSig(arr[i - 1]) && arr[i].createdTimestamp - arr[i - 1].createdTimestamp < 30000) alvos.add(arr[i]);
          }
          // o MESMO autor repetindo a MESMA mensagem 3+ vezes em ate 10 min
          // (qualquer espacamento): o flood lento que o corte de 30s acima
          // deixava de pe no boot do bot
          const porSig = new Map();
          for (const x of arr) {
            const s = msgSig(x);
            if (!porSig.has(s)) porSig.set(s, []);
            porSig.get(s).push(x);
          }
          for (const grupo of porSig.values()) {
            if (grupo.length < 3) continue;
            for (let i = 2; i < grupo.length; i++) {
              if (grupo[i].createdTimestamp - grupo[i - 2].createdTimestamp < cfgRetro) {
                alvos.add(grupo[i - 2]); alvos.add(grupo[i - 1]); alvos.add(grupo[i]);
              }
            }
          }
          const curtas = arr.filter((x) => { const v = (x.content || '').trim(); return v.length > 0 && v.length <= 3; });
          for (let i = 5; i < curtas.length; i++) {
            if (curtas[i].createdTimestamp - curtas[i - 5].createdTimestamp < 60000) curtas.slice(i - 5, i + 1).forEach((x) => alvos.add(x));
          }
          for (const x of arr) { const v = x.content || ''; if (v && !v.replace(RE_INV, '')) alvos.add(x); }
          for (const x of arr) { if ((x.content || '').includes('*')) alvos.add(x); }
          // mesmas regras instantaneas do messageCreate (pega o que passou enquanto o bot reiniciava)
          for (const x of arr) {
            const c = x.content || '';
            if (c.length > cfgChars || repeticaoInterna(c) || temLinkCdn(x)) alvos.add(x);
          }
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
        const alvos = msgs.filter((x) => (!x.author.bot || x.webhookId) && !isOwnWebhookId(x.webhookId) && x.author.id !== OWNER_ID && temLink(x.content || '') && x.deletable);
        if (!alvos.size) continue;
        await ch.bulkDelete(alvos, true).catch(async () => {
          for (const x of [...alvos.values()]) await x.delete().catch(() => {});
        });
        log('VARREDURA', { canal: ch.id, apagadas: alvos.size });
      } catch (e) { /* sem permissao no canal, segue */ }
    }
  }
}

// ---------- filtros antigos (so para a faxina do historico) ----------
// "apague todas as mensagens do filtro meu e seu que já tinha no código"
// (dono, 02/10): estas regras nao filtram mais nada ao vivo, mas marcam o que
// ja estava salvo e que os filtros antigos teriam apagado.
function motivosLegado(x, cfg) {
  const c = (x && x.content) || '';
  const charsMax = (cfg && cfg.chars) || ANTIFLOOD_DEFAULT.chars;
  const ms = [];
  if (c.length > charsMax) ms.push(`chars>${charsMax}`);
  if (temLink(c)) ms.push('link');
  if (temLinkCdn(x)) ms.push('link-cdn');
  const rep = repeticaoInterna(c);
  if (rep) ms.push(rep);
  if (c.includes('*')) ms.push('asterisco');
  if (/^#/.test(c.trim())) ms.push('header');
  if (c && !c.replace(RE_INV, '')) ms.push('invisivel');
  const den = classificarDenuncia(c);
  if (den) ms.push(`denuncia:${den.cat}`);
  return ms;
}

// ---------- purga da lista do dono ----------
// "quero que apague todas que estejam salvas no sistema que eu coloquei" (02/10):
// nao basta pegar o que chega depois do deploy — no boot o bot varre o historico
// de cada canal e apaga tudo que casa com a lista do dono. Roda no maximo 1x a
// cada PURGA_INTERVALO_MS, e na hora de novo se a lista mudou.
const PURGA_PAGINAS = 50; // 50 x 100 msgs por canal a cada rodada
const PURGA_INTERVALO_MS = 60 * 60 * 1000;
// a lista do dono mudou (ele adicionou palavra): re-varre o historico em alguns
// minutos — sem isso a purga so rodaria no proximo boot do bot
let faxinaTimer = null;
function agendarFaxina(atrasoMs = 3 * 60 * 1000) {
  if (faxinaTimer) clearTimeout(faxinaTimer);
  faxinaTimer = setTimeout(() => { faxinaTimer = null; varrerPalavras().catch(err); }, atrasoMs);
  if (faxinaTimer.unref) faxinaTimer.unref();
}

async function varrerPalavras() {
  // espera o ghStateLoad terminar: ele zera o cache do antiflood ao final, e sem
  // isso a faxina escrevia a posicao num objeto morto (o progresso se perdia)
  await ghStatePronto.catch(() => {});
  const st = lerPalavrasBloqueadas();
  const cfgLegado = readJsonSafe(ANTIFLOOD_CFG, ANTIFLOOD_DEFAULT);
  const palavras = (st && st.palavras) || {};
  const stAF = estadoAntiflood();
  const hash = Object.keys(palavras).sort().join('|') + '|legado-v1';
  const agora = Date.now();
  if (stAF.palavrasHash === hash && agora - (stAF.palavrasVarreduraEm || 0) < PURGA_INTERVALO_MS) return;
  if (stAF.palavrasHash !== hash) stAF.purga = {}; // lista mudou: recomeça do topo
  stAF.palavrasHash = hash;
  stAF.palavrasVarreduraEm = agora;
  salvarAntiflood(true);
  const antigo = stAF.purga && typeof stAF.purga === 'object' ? stAF.purga : {};
  const purgaNova = {};
  let total = 0, falhas = 0, canais = 0, paginas = 0;
  const porTermo = {};
  const semLeitura = []; // canais que o bot nao conseguiu ler (permissao/fetch)
  const salvarResumo = () => {
    const vivo = estadoAntiflood();
    vivo.purga = purgaNova;
    vivo.faxina = { em: new Date().toISOString(), canais, paginas, apagadas: total, falhas, motivos: porTermo, semLeitura, iniciadaEm: new Date(agora).toISOString() };
    salvarAntiflood(true);
  };
  for (const gid of INFERNO_GUILDS) {
    const g = client.guilds.cache.get(gid);
    if (!g) continue;
    for (const ch of [...g.channels.cache.values()]) {
      if (!ch.isTextBased()) continue;
      if (antigo[ch.id] === 'fim') { purgaNova[ch.id] = 'fim'; continue; } // ja varreu o canal inteiro
      let antes = antigo[ch.id] || null;
      let acabou = false;
      for (let pag = 0; pag < PURGA_PAGINAS; pag++) {
        let deuErro = false;
        const lote = await ch.messages.fetch(antes ? { limit: 100, before: antes } : { limit: 100 }).catch(() => { deuErro = true; return null; });
        if (deuErro && !antes) { semLeitura.push(`#${ch.name}`); acabou = true; break; } // nao consegui ler: registra pra o dono arrumar
        if (!lote || !lote.size) { acabou = true; break; }
        paginas += 1;
        const alvos = new Map();
        for (const x of lote.values()) {
          if (!x.deletable || x.author.id === OWNER_ID) continue; // dono e imune
          if (x.author.bot && !x.webhookId) continue;             // bots reais fora
          if (isOwnWebhookId(x.webhookId)) continue;              // nossos paineis/logs
          const hit = casarPalavras(x.content, st);
          if (hit) {
            alvos.set(x.id, x);
            const m = `lista:${hit.termo}`;
            porTermo[m] = (porTermo[m] || 0) + 1;
            continue;
          }
          const antigos = motivosLegado(x, cfgLegado);
          if (antigos.length) {
            alvos.set(x.id, x);
            porTermo[antigos[0]] = (porTermo[antigos[0]] || 0) + 1;
          }
        }
        if (alvos.size) {
          const apagadas = await ch.bulkDelete([...alvos.keys()], true).catch(() => null);
          let n = apagadas ? apagadas.size : 0;
          for (const x of alvos.values()) {
            if (apagadas && apagadas.has(x.id)) continue; // ja foi no bulk
            const ok = await x.delete().then(() => true).catch(() => false);
            if (ok) n++; else falhas++;
          }
          total += n;
          registrarAcaoAntiflood({ canal: ch.id, guild: g.id, motivo: 'faxina-historico', apagou: n > 0, apagadas: n });
        }
        const maisAntiga = [...lote.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
        antes = maisAntiga.id;
        if (lote.size < 100) { acabou = true; break; }
      }
      purgaNova[ch.id] = acabou ? 'fim' : antes; // guarda a posicao pra continuar no proximo boot
      canais += 1;
      salvarResumo(); // grava no estado VIVO (nao numa copia)
    }
  }
  salvarResumo();
  log('PURGA_PALAVRAS', { apagadas: total, falhas, canais, paginas, semLeitura, motivos: porTermo });
  if (semLeitura.length) {
    logEvento('⚠️ Faxina não conseguiu ler alguns canais', [
      `**Canais:** ${semLeitura.slice(0, 20).join(', ')}`,
      'Falta permissão de **Ver Canal / Ler Histórico** pra mim nesses canais — as mensagens antigas deles não foram varridas.',
    ], 0xff4444);
  }
  if (total || falhas) {
    const termos = Object.entries(porTermo).map(([t, n]) => `${t} (${n})`).join(', ');
    logEvento('🧹 Faxina do histórico (bloqueio + filtros antigos)', [
      `**Mensagens antigas apagadas:** ${total}${falhas ? ` • **falhas:** ${falhas}` : ''}`,
      termos ? `**Motivos:** ${corta(termos, 300)}` : '',
    ].filter(Boolean), 0x992d22);
  }
}

client.on('interactionCreate', async (i) => {
  // botoes dos logs (so o dono)
  if (i.isButton() && String(i.customId || '').startsWith('log_')) {
    const [acao, arg] = i.customId.split(':');
    try {
      if (i.user.id !== OWNER_ID) {
        await i.deferUpdate().catch(() => {});
        return;
      }
      if (acao === 'log_copy') {
        const rec = logMsgCache.get(arg);
        if (!rec) return void await i.reply({ content: 'essa mensagem saiu da memoria do bot (reiniciou ou ficou antiga).', ephemeral: true }).catch(() => {});
        const txt = rec.content || '*sem texto*';
        return void await i.reply({ content: 'copia daqui:\n```\n' + limparCodigo(corta(txt, 1800)) + '\n```', ephemeral: true }).catch(() => {});
      }
      await i.deferUpdate().catch(() => {});
      const userId = arg;
      if (!i.guild || !/^\d{15,25}$/.test(userId)) return void await enviarLogSistema('botao de log falhou: id invalido.');
      if (userId === OWNER_ID) return void await enviarLogSistema('botao de log ignorado: nao vou punir o dono.');
      if (acao === 'log_ban') {
        await i.guild.members.ban(userId, { reason: `banido pelo botão de log por ${i.user.tag}` });
        await enviarLogSistema(`🔨 <@${userId}> foi banido pelo botão do log.`);
        log('LOG_BAN', { userId, by: i.user.id });
        return;
      }
      if (acao === 'log_bl') {
        blacklistAdd(userId, { tag: userId, motivo: `blacklist pelo botão de log por ${i.user.tag}`, by: i.user.id, criadoEm: new Date().toISOString() });
        await i.guild.members.ban(userId, { reason: `blacklist pelo botão de log por ${i.user.tag}` }).catch((e) => log('BLACKLIST_BAN_FAIL', { userId, err: e && e.message }));
        await enviarLogSistema(`⛔ <@${userId}> foi colocado na blacklist e banido pelo botão do log.`);
        log('BLACKLIST_ADD', { userId, by: i.user.id });
        return;
      }
      if (acao === 'log_unbl') {
        const tinha = blacklistDel(userId);
        await enviarLogSistema(tinha ? `✅ <@${userId}> foi removido da blacklist pelo botão do log.` : `ℹ️ <@${userId}> não estava na blacklist.`);
        log('BLACKLIST_DEL', { userId, by: i.user.id, tinha });
        return;
      }
    } catch (e) {
      err(e);
      await enviarLogSistema('botao de log falhou: ' + (e.message || e)).catch(() => {});
      return;
    }
  }
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

  // ---------- painel unico .bloquear (components V2) ----------
  if (i.isButton() && String(i.customId || '').startsWith('bloq_')) {
    if (i.user.id !== OWNER_ID) {
      await i.reply({ content: 'só o dono usa isso.', ephemeral: true }).catch(() => {});
      return;
    }
    const id = i.customId;
    if (id === 'bloq_add') {
      await i.showModal({
        custom_id: 'bloq_modal_add',
        title: 'Adicionar palavras',
        components: [{
          type: 1,
          components: [{
            type: 4,
            custom_id: 'palavras_input',
            label: 'Palavras (separe por vírgula)',
            style: 2,
            placeholder: 'ex: estupr, molest, pedo — o começo da palavra já basta',
            required: true,
            max_length: 1000,
          }]
        }]
      }).catch((e) => err(e));
      return;
    }
    // paginação do menu (mostra 25 palavras por página)
    if (id.startsWith('bloq_pg:')) {
      await i.deferUpdate().catch(() => {});
      const pag = Number(id.split(':')[1]) || 0;
      await whEdit(i.channel, i.message.id, bloquearPanel('', pag)).catch(() => {});
      return;
    }
    if (id === 'bloq_test') {
      await i.showModal({
        custom_id: 'bloq_modal_test',
        title: 'Testar frase',
        components: [{
          type: 1,
          components: [{
            type: 4,
            custom_id: 'frase_input',
            label: 'Frase para testar',
            style: 2,
            placeholder: 'digite a frase que quer testar',
            required: true,
            max_length: 1000,
          }]
        }]
      }).catch((e) => err(e));
      return;
    }
    if (id === 'bloq_refresh') {
      await i.deferUpdate().catch(() => {});
      await whEdit(i.channel, i.message.id, bloquearPanel()).catch(() => {});
      return;
    }
    if (id === 'bloq_close') {
      await i.deferUpdate().catch(() => {});
      await i.message.delete().catch(() => {});
      return;
    }
    // qualquer botão do painel antigo ("Remover", "Listar tudo"...): só
    // re-renderiza no formato novo, pra ninguém ficar preso no modelo velho
    await i.deferUpdate().catch(() => {});
    await whEdit(i.channel, i.message.id, bloquearPanel()).catch(() => {});
    return;
  }

  // menu do painel: clicou na palavra -> remove na hora (sem modal, sem digitar)
  if (i.isStringSelectMenu && i.isStringSelectMenu() && String(i.customId || '').startsWith('bloq_sel')) {
    if (i.user.id !== OWNER_ID) {
      await i.reply({ content: 'só o dono usa isso.', ephemeral: true }).catch(() => {});
      return;
    }
    const pag = Number(String(i.customId).split(':')[1]) || 0;
    const chaveSel = (i.values && i.values[0]) || '';
    const st = lerPalavrasBloqueadas();
    const alvo = (st.palavras && st.palavras[chaveSel]) || null;
    const termo = alvo ? alvo.termo : chaveSel;
    const r = removerPalavras(st, [chaveSel]);
    if (r.removidas.length) salvarPalavras(st);
    log('BLOQ_DEL_CLIQUE', { por: i.user.id, termo, removida: r.removidas.length > 0 });
    await i.deferUpdate().catch(() => {});
    const restou = Object.keys(st.palavras || {}).length;
    const pagFinal = Math.min(pag, Math.max(0, Math.ceil(restou / PALAVRAS_POR_PAGINA) - 1));
    const nota = r.removidas.length ? `🗑️ removida: \`${termo}\`` : `⚠️ não achei \`${termo}\``;
    await whEdit(i.channel, i.message.id, bloquearPanel(nota, pagFinal)).catch(() => {});
    return;
  }

  // modals do bloquear
  if (i.isModalSubmit && i.isModalSubmit() && String(i.customId || '').startsWith('bloq_modal_')) {
    if (i.user.id !== OWNER_ID) {
      await i.reply({ content: 'só o dono usa isso.', ephemeral: true }).catch(() => {});
      return;
    }
    const mid = i.customId;
    if (mid === 'bloq_modal_add') {
      const raw = i.fields.getTextInputValue('palavras_input') || '';
      const termos = separarTermos(raw);
      if (!termos.length) {
        await i.reply({ content: 'nenhuma palavra válida.', ephemeral: true }).catch(() => {});
        return;
      }
      const st = lerPalavrasBloqueadas();
      const r = adicionarPalavras(st, termos, { por: i.user.id });
      salvarPalavras(st);
      if (r.adicionadas.length) agendarFaxina(); // palavra nova: limpa o historico dela
      const total = Object.keys(st.palavras).length;
      await i.reply({
        content: [
          r.adicionadas.length ? `**Bloqueadas:** ${r.adicionadas.map(t => '`' + t + '`').join(', ')}` : '',
          r.jaTinham.length ? 'Já estavam: ' + r.jaTinham.map(t => '`' + t + '`').join(', ') : '',
          r.invalidas.length ? 'Ignoradas: ' + r.invalidas.join(', ') : '',
          r.semEspaco.length ? 'Sem espaço: ' + r.semEspaco.join(', ') : '',
          `Total: **${total}**`,
        ].filter(Boolean).join('\n'),
        ephemeral: true
      }).catch(() => {});
      // atualiza o painel NO LUGAR (o modal guarda o link da mensagem); se não
      // der, manda um painel novo — antes ficava acumulando painel no canal
      const notaAdd = r.adicionadas.length ? `➕ ${r.adicionadas.length} nova(s)` : 'nada novo';
      if (i.message && i.message.id) {
        const okEdit = await whEdit(i.channel, i.message.id, bloquearPanel(notaAdd)).then(() => true).catch(() => false);
        if (!okEdit) await whSend(i.channel, bloquearPanel(notaAdd)).catch(() => {});
      } else {
        await whSend(i.channel, bloquearPanel(notaAdd)).catch(() => {});
      }
      log('BLOQ_ADD', { por: i.user.id, termos: r.adicionadas, total });
      return;
    }
    if (mid === 'bloq_modal_remove') {
      const raw = i.fields.getTextInputValue('palavras_input') || '';
      const termos = separarTermos(raw);
      if (!termos.length) {
        await i.reply({ content: 'nenhuma palavra válida.', ephemeral: true }).catch(() => {});
        return;
      }
      const st = lerPalavrasBloqueadas();
      const r = removerPalavras(st, termos);
      salvarPalavras(st);
      const total = Object.keys(st.palavras).length;
      await i.reply({
        content: [
          r.removidas.length ? `**Desbloqueadas:** ${r.removidas.map(t => '`' + t + '`').join(', ')}` : 'nada removido.',
          r.naoTinham.length ? 'Não estavam: ' + r.naoTinham.map(t => '`' + t + '`').join(', ') : '',
          `Total: **${total}**`,
        ].filter(Boolean).join('\n'),
        ephemeral: true
      }).catch(() => {});
      const notaDel = r.removidas.length ? `🗑️ ${r.removidas.length} removida(s)` : 'nada removido';
      if (i.message && i.message.id) {
        const okEdit = await whEdit(i.channel, i.message.id, bloquearPanel(notaDel)).then(() => true).catch(() => false);
        if (!okEdit) await whSend(i.channel, bloquearPanel(notaDel)).catch(() => {});
      } else {
        await whSend(i.channel, bloquearPanel(notaDel)).catch(() => {});
      }
      log('BLOQ_DEL', { por: i.user.id, termos: r.removidas, total });
      return;
    }
    if (mid === 'bloq_modal_test') {
      const frase = i.fields.getTextInputValue('frase_input') || '';
      const st = lerPalavrasBloqueadas();
      const hit = casarPalavras(frase, st);
      await i.reply({
        content: hit
          ? `🚫 cai na palavra bloqueada \`${hit.termo}\` (casamento por formação).`
          : '✅ não cai em nenhuma palavra bloqueada.',
        ephemeral: true
      }).catch(() => {});
      return;
    }
  }
});


client.on('error', err);
client.on('shardError', err);
client.on('shardDisconnect', (event, shardId) => log('DISCORD_DISCONNECT', { shardId, code: event.code, quando: new Date().toISOString() }));
client.on('shardReconnecting', shardId => log('DISCORD_RECONNECTING', { shardId }));
client.on('shardResume', shardId => log('DISCORD_RESUME', { shardId }));
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
// garante que o bot consiga moderar o canal recem-criado: se ele renasceu sem
// permissoes (bug antigo: "over" era calculado e jogado fora), o anti-flood
// nao conseguia apagar nada la e a falha era silenciosa
async function garantirPermModeracao(guild, canal) {
  try {
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me) return false;
    const perms = canal.permissionsFor(me);
    const falta = perms ? missingPerms((p) => perms.has(p)) : Object.keys(PERMS_BOT_CANAL);
    if (!falta.length) return true;
    await canal.permissionOverwrites.edit(me.id, PERMS_BOT_CANAL);
    log('PERM_CANAL_REPARADA', { canal: canal.id, guild: guild.id, faltava: falta });
    return true;
  } catch (e) {
    err(e);
    return false;
  }
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
    const pai = (bump && bump.parentId) || undefined;
    conf = await guild.channels.create({
      name: '・confessionario',
      type: 0,
      parent: pai,
      // nasce logo abaixo do canal inferno (ver ordem abaixo)
      position: posicaoDoConfessionario(irmaosOrdenados(chans, pai || null)),
      reason: 'nuke: confessionario recriado do zero',
    }).catch((e) => { nlog.erros.push('create do zero: ' + (e && e.message)); err(e); return null; });
    nlog.confCreate = conf ? conf.id : null;
    if (conf) {
      await garantirPermModeracao(guild, conf);
      await guild.setSystemChannel(conf).catch((e) => err(e));
      // inferno primeiro, confessionario em segundo (mesma ordem do renascimento)
      const ord = await garantirOrdemInferno(guild, conf, { log });
      nlog.ordem = { canais: ord.ordem, mudou: ord.mudou, ok: ord.ok };
      if (!ord.ok) nlog.erros.push('ordem: ' + ord.erro);
      await anunciarNuke(guild).catch(() => {}); nlog.anuncio = 'ok';
    }
  }
  if (conf) {
    try {
      const f = await conf.fetch().catch(() => conf);
      const eraSistema = guild.systemChannelId === f.id;
      // BUG ANTIGO: "over" era calculado aqui e nunca entrava no spec — o canal
      // renascia SEM as permissoes originais toda hora. Agora o spec carrega tudo.
      const over = f.permissionOverwrites.cache.map((o) => ({
        id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield,
      }));
      // BUG ANTIGO 2: copiar f.position fazia o confessionario nascer em cima do
      // canal inferno. f.position e o INDICE dentro do pai (0, 1, 2...), nao a
      // posicao bruta do Discord — e como o Discord nao renumera as posicoes
      // quando um canal e apagado (sobram buracos), o indice 2 caia antes de
      // todo mundo. Aqui o canal ja nasce no lugar certo (abaixo do inferno) e
      // o garantirOrdemInferno reindexa os irmaos pra cravar a ordem.
      const irmaos = irmaosOrdenados(chans, f.parentId);
      const posNova = posicaoDoConfessionario(irmaos.filter((c) => c.id !== f.id), f.position);
      const spec = buildChannelSpec({
        name: f.name,
        type: f.type,
        parentId: f.parentId,
        topic: f.topic,
        nsfw: f.nsfw,
        rateLimitPerUser: f.rateLimitPerUser,
        position: posNova,
      }, over, { reason: 'nuke: renascimento do confessionario' });
      await f.delete('nuke: confessionario renasce').then(() => { nlog.confDelete = 'ok'; }).catch((e) => { nlog.confDelete = 'erro: ' + (e && e.message); err(e); });
      const novo = await guild.channels.create(spec).catch((e) => { nlog.erros.push('create: ' + (e && e.message)); err(e); return null; });
      nlog.confCreate = novo ? novo.id : null;
      if (novo) {
        log('NUKE_CONF_RECRIADO', { novo: novo.id, pos: novo.position, sistema: eraSistema, overwrites: over.length });
        await garantirPermModeracao(guild, novo); // self-heal se as perms antigas ja estavam perdidas
        await guild.setSystemChannel(novo).catch((e) => err(e)); // confessionario sempre selecionado
        // ordem certa da categoria: inferno em primeiro, confessionario em segundo
        const ord = await garantirOrdemInferno(guild, novo, { log });
        nlog.ordem = { canais: ord.ordem, mudou: ord.mudou, ok: ord.ok };
        if (!ord.ok) nlog.erros.push('ordem: ' + ord.erro);
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
  await salvarSnapshot(guild); // backup a cada ciclo: historico do git guarda as versoes
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

// ---------- renovacao preventiva no GitHub Actions ----------
// o runner tem teto de 6h por job: quando dava o teto, o bot morria e so o cron
// (a cada 6h) religava — as vezes com o codigo velho do main. aqui o proprio bot
// dispara um run novo ANTES do teto; quando o novo ficar READY ele cancela este
// (troca de guarda). O watchdog externo cobre falha do runner; Actions nao garante uptime.
const RUN_ID = process.env.GITHUB_RUN_ID;
const GH_REPO = process.env.GITHUB_REPOSITORY;
const GH_TOK = process.env.GITHUB_TOKEN;
const JOB_TETO_MS = 360 * 60 * 1000;      // timeout-minutes: 360 do workflow
const JOB_FOLGA_MS = 10 * 60 * 1000;      // religa 10min antes do teto
let jobComecouEm = Date.now();
let relogando = false;
let ultimoDispatch = 0;
async function iniciarRunSatan(motivo) {
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/satan.yml/dispatches`, {
    signal: AbortSignal.timeout(30_000),
    method: 'POST',
    headers: {
      Authorization: `token ${GH_TOK}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'satan-bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!r.ok && r.status !== 204) throw new Error('dispatch ' + r.status + ' ' + (await r.text()).slice(0, 160));
  log('RUN_NOVO', { motivo });
  return true;
}
async function cancelarRunsAntigos() {
  if (!GH_TOK || !GH_REPO || !RUN_ID) return;
  const H = { Authorization: `token ${GH_TOK}`, Accept: 'application/vnd.github+json', 'User-Agent': 'satan-bot' };
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/satan.yml/runs?per_page=20&status=in_progress`, { headers: H, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error('lista runs ' + r.status);
  const j = await r.json();
  const meu = Number(RUN_ID);
  const antigos = (j.workflow_runs || []).filter((x) => x.head_branch === 'main' && Number(x.id) < meu);
  for (const x of antigos) {
    const c = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/runs/${x.id}/cancel`, { method: 'POST', headers: H, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    log('TROCA_DE_GUARDA', { runAntigo: x.id, runNovo: meu, ok: !!(c && (c.ok || c.status === 202)) });
  }
}
async function descobrirInicioDoJob() {
  // process.uptime() conta so o node; o npm i antes ja comeu uns minutos do job
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/runs/${RUN_ID}/jobs?per_page=30`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `token ${GH_TOK}`, Accept: 'application/vnd.github+json', 'User-Agent': 'satan-bot' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const meu = (j.jobs || []).find((x) => x.status === 'in_progress') || (j.jobs || [])[0];
    return meu && meu.started_at ? new Date(meu.started_at).getTime() : null;
  } catch { return null; }
}
async function tickImortal() {
  if (relogando || Date.now() - ultimoDispatch < 5 * 60 * 1000 || !GH_TOK || !GH_REPO || !RUN_ID) return; // fora do GitHub Actions: nao faz nada
  const inicio = await descobrirInicioDoJob().catch(() => null);
  if (inicio) jobComecouEm = inicio;
  const falta = jobComecouEm + JOB_TETO_MS - JOB_FOLGA_MS - Date.now();
  if (falta > 0) return;
  if (Date.now() - jobComecouEm < 30 * 60 * 1000) {
    // relogio errado (job comecou agora): nao dispara, senao vira laco de restart
    log('IMORTAL_IGNORADO', { motivo: 'job novo demais', uptimeMin: Math.round((Date.now() - jobComecouEm) / 60000) });
    return;
  }
  relogando = true;
  try {
    await iniciarRunSatan('teto de 6h do runner: religando antes de morrer');
    ultimoDispatch = Date.now();
    log('IMORTAL', { acao: 'run solicitado; aguardando substituto conectar, nova tentativa em 5min se necessario' });
  } catch (e) {
    log('IMORTAL_FAIL', { err: e && e.message });
  } finally {
    relogando = false;
  }
}
setInterval(() => { tickImortal().catch(err); }, 60 * 1000);

watchDiscord(client, { log });

// login com teto de tempo: sem isso o processo pode ficar VIVO com o REST sem
// token (intervalos rodando, nada respondido, nem apagado) — foi assim no
// incidente de 29/09, com o token resetado no Developer Portal.
const LOGIN_TIMEOUT_MS = 120 * 1000;
corridaComTimeout(client.login(TOKEN), LOGIN_TIMEOUT_MS).catch((e) => {
  err(e);
  if (e && e.code === TIMEOUT_CODE) {
    console.error('FATAL LOGIN_TRAVADO: o login nao resolveu em 2min; saindo para o loop religar limpo (processo sem token nao modera nada).');
    process.exit(CODIGO_LOGIN_TRAVADO);
  }
  if (ehErroDeAutenticacao(e)) {
    console.error('FATAL TOKEN_INVALIDO: o DISCORD_TOKEN do secret nao autentica mais (TokenInvalid/401). Copie o token atual em discord.com/developers/applications > Bot > Reset Token e cole em Settings > Secrets and variables > Actions > DISCORD_TOKEN. Enquanto isso o bot nao tem como subir: o workflow vai parar de tentar em vez de ficar em loop.');
    process.exit(CODIGO_TOKEN_INVALIDO);
  }
  process.exit(1);
});
