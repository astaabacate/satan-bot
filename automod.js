'use strict';
// ============ AutoMod NATIVO do Discord ============
// Isso NAO e o filtro do bot: e o AutoMod do proprio Discord, que roda no
// servidor dele e BLOQUEIA a mensagem ANTES dela ser publicada no canal.
// Ou seja: ninguem ve a mensagem, ela nao aparece nem por um piscar de olho
// (o autor recebe um aviso privado do Discord dizendo que foi bloqueada).
// De quebra vale enquanto o bot estiver desligado/reiniciando, porque quem
// barra e o Discord, nao o bot.
//
// Toda regra criada por aqui tem PREFIXO no nome — o bot so mexe nas dele e
// nunca encosta em regra feita na mao no painel do servidor.
//
// Obs do proprio Discord (nao da pra mudar): quem tem as permissoes
// "Gerenciar Servidor" ou "Administrador" passa por cima de TODAS as regras,
// e bots/webhooks tambem sao isentos. O dono do servidor tambem escapa
// (dono tem todas as permissoes).
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

// Valores da API do Discord. Mantemos os payloads sem depender dos enums do
// discord.js (e assim uma atualização da biblioteca não muda o que enviamos).
const TRIGGER = { Keyword: 1, Spam: 3, MentionSpam: 5 };
const ACAO = { BlockMessage: 1, SendAlertMessage: 2, Timeout: 3 };
const EVENTO = { MessageSend: 1 };

const PREFIXO = '[satan] ';
const ARQUIVO = path.join(__dirname, 'automod_config.json');
const ARQUIVO_STATUS = path.join(__dirname, 'automod_status.json'); // so leitura: ultima sincronizacao
const LIMITE_TIMEOUT = 2419200; // 4 semanas (limite do discord)
const MAX_REGEX = 10;
const MAX_PALAVRAS = 1000;
const MAX_CHARS_PALAVRA = 60;
const MAX_CHARS_REGEX = 260;

let _log = () => {};
let _err = () => {};
function usar(refs = {}) {
  if (refs.log) _log = refs.log;
  if (refs.err) _err = refs.err;
}

// tudo que da pra ajustar: mexe no automod_config.json ou pelos comandos .automod
const PADRAO = {
  on: true,                                  // AutoMod ligado/desligado
  spam: true,                                // spam generico (detector do discord)
  mencoes: { on: true, limite: 5, antiRaid: true },
  links: { on: true, permitidos: [] },       // link/convite bloqueado antes de aparecer
  palavras: [],                              // palavras/frases bloqueadas (aceita * curinga)
  regex: [],                                 // ate 10 padroes (regex do rust: sem \1/retrovisor)
  asterisco: false,                          // mantido para compatibilidade com o painel; o nativo ja bloqueia *
  timeoutSegundos: 0,                        // >0 = o proprio automod da timeout (so palavra/regex/mencao)
  castigo: { blocos: 3, janelaMin: 10 },     // 3 bloqueios em 10min -> castigo progressivo do bot
  aviso: {},                                 // texto que o autor ve quando e bloqueado
  cargosImunes: [],                          // cargos que passam direto
  canaisImunes: [],                          // canais que nao tem automod
  canalAlertas: '',                          // canal onde o discord posta o que foi bloqueado
  compacto: true,                            // junta link+palavras+regex numa regra so (o discord so deixa 6)
  absorvida: {},                             // regra manual assumida: guildId -> conteudo original
};

const AVISO_PADRAO = {
  spam: 'spam bloqueado. manda uma coisa por vez.',
  mencoes: 'muita mencao de uma vez. marca menos gente.',
  links: 'link bloqueado nesse servidor.',
  palavras: 'mensagem bloqueada pela lista de palavras.',
  regex: 'mensagem bloqueada pelas regras do servidor.',
  asterisco: 'asterisco bloqueado. tira o * da mensagem (** ~~ ~).',
  filtro: 'bloqueado pelo automod: palavra, link ou padrao proibido.',
};

const PALAVRAS_LINK = [
  '*http://*',
  '*https://*',
  '*discord.gg/*',
  '*discord.com/invite*',
  '*discordapp.com/invite*',
  '*dsc.gg/*',
];

// O filtro nativo precisa pegar tambem o que antes era tratado somente no
// messageCreate. Sao regex Rust validas no AutoMod do Discord; as tres ficam
// sempre na regra compacta para que o bot nao dependa de comando ou config.
const REGEX_GIGANTE = '(?s)^.{501,}$';
const REGEX_INVISIVEL = String.raw`^[\s\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2800\u3164\ufeff\ufe00-\ufe0f\ufff0-\ufff8\ufffe\uffff\u{e0000}-\u{e007f}]+$`;
const REGEX_ASTERISCO = String.raw`\*`;
const REGEX_NATIVOS = [REGEX_GIGANTE, REGEX_INVISIVEL, REGEX_ASTERISCO];

// ---------------- config ----------------
function ehObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function fundir(base, novo) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(novo || {})) {
    if (ehObj(v) && ehObj(out[k])) out[k] = fundir(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

function ler() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); } catch { raw = {}; }
  return fundir(PADRAO, raw);
}

function salvar(cfg) {
  fs.writeFileSync(ARQUIVO, JSON.stringify(cfg, null, 2));
}

function criarSeFaltar() {
  try { if (!fs.existsSync(ARQUIVO)) salvar(PADRAO); } catch (e) { _err(e); }
}

// ---------- diario da ultima sincronizacao ----------
// gravado so quando alguma coisa muda (senao viraria commit a cada 10min) e
// sincronizado no repo junto com o resto do estado: da pra ver de fora se as
// regras realmente existem no servidor e qual foi o ultimo erro
function lerStatus() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_STATUS, 'utf8')); } catch { return {}; }
}

function statusDe(guildId) {
  const st = lerStatus();
  return (st.guildas && st.guildas[guildId]) || null;
}

function registrarStatus(guildId, dados) {
  try {
    const st = lerStatus();
    st.guildas = st.guildas || {};
    const antes = st.guildas[guildId] ? { ...st.guildas[guildId], atualizadoEm: undefined } : null;
    const agora = new Date().toISOString();
    const novo = { ...dados, atualizadoEm: agora };
    if (JSON.stringify(antes) === JSON.stringify({ ...novo, atualizadoEm: undefined })) return false; // nada mudou
    st.guildas[guildId] = novo;
    st.atualizadoEm = agora;
    fs.writeFileSync(ARQUIVO_STATUS, JSON.stringify(st, null, 2));
    return true;
  } catch (e) { _err(e); return false; }
}

// ---------------- limpeza das listas ----------------
function limparPalavras(lista) {
  const out = [];
  for (const p of lista || []) {
    const s = String(p).trim();
    if (!s) continue;
    if (s.length > MAX_CHARS_PALAVRA) { _log('AUTOMOD_AVISO', { motivo: 'palavra longa demais (max 60)', palavra: s.slice(0, 40) }); continue; }
    if (!out.includes(s) && out.length < MAX_PALAVRAS) out.push(s);
  }
  return out;
}

function limparRegex(lista) {
  const out = [];
  for (const p of lista || []) {
    const s = String(p).trim();
    if (!s) continue;
    if (s.length > MAX_CHARS_REGEX) { _log('AUTOMOD_AVISO', { motivo: 'regex longa demais (max 260)', regex: s.slice(0, 40) }); continue; }
    if (!out.includes(s) && out.length < MAX_REGEX) out.push(s);
  }
  return out;
}

function msg(e) { return String((e && e.message) || e).slice(0, 200); }

function podeGerenciar(guild) {
  const me = guild && guild.members && guild.members.me;
  return !!me && me.permissions.has(PermissionFlagsBits.ManageGuild);
}

function podeTimeout(guild) {
  const me = guild && guild.members && guild.members.me;
  return !!me && me.permissions.has(PermissionFlagsBits.ModerateMembers);
}

function cargosValidos(guild, ids) {
  return (ids || []).filter((id) => guild.roles.cache.has(id)).slice(0, 20);
}

function canaisValidos(guild, ids) {
  return (ids || []).filter((id) => {
    const ch = guild.channels.cache.get(id);
    return !!ch && ch.isTextBased();
  }).slice(0, 50);
}

// ---------------- montagem das regras ----------------
function bloqueio(texto) {
  return { type: ACAO.BlockMessage, metadata: { customMessage: String(texto).slice(0, 150) } };
}

function alerta(canalId) {
  return { type: ACAO.SendAlertMessage, metadata: { channel: canalId } };
}

function timeouts(segundos) {
  return { type: ACAO.Timeout, metadata: { durationSeconds: segundos } };
}

// lista de regras que o bot quer ver no servidor (sem isso nao existe automod)
function definicoes(cfg, guild) {
  const aviso = { ...AVISO_PADRAO, ...(cfg.aviso || {}) };
  const tSeg = Math.max(0, Math.min(LIMITE_TIMEOUT, Math.floor(Number(cfg.timeoutSegundos) || 0)));
  const canalAlertas = cfg.canalAlertas && guild.channels.cache.get(cfg.canalAlertas);
  const extra = canalAlertas ? [alerta(canalAlertas.id)] : [];
  const defs = [];

  if (cfg.spam) {
    defs.push({
      chave: 'spam',
      nome: 'spam',
      unico: true, // o discord so deixa 1 regra de spam por servidor
      triggerType: TRIGGER.Spam,
      triggerMetadata: undefined, // o detector de spam do discord nao tem o que configurar
      actions: [bloqueio(aviso.spam), ...extra],
    });
  }

  if (cfg.mencoes && cfg.mencoes.on) {
    defs.push({
      chave: 'mencoes',
      nome: 'mencoes',
      unico: true, // idem: so 1 regra de mencoes por servidor
      triggerType: TRIGGER.MentionSpam,
      triggerMetadata: {
        mentionTotalLimit: Math.max(1, Math.min(50, Math.floor(Number(cfg.mencoes.limite) || 5))),
        mentionRaidProtectionEnabled: !!cfg.mencoes.antiRaid,
      },
      actions: [bloqueio(aviso.mencoes), ...(tSeg > 0 && podeTimeout(guild) ? [timeouts(tSeg)] : []), ...extra],
    });
  }

  const linksOn = !!(cfg.links && cfg.links.on);
  const permitidos = linksOn ? limparPalavras(cfg.links.permitidos).slice(0, 100) : []; // allow_list: max 100
  const palavras = limparPalavras(cfg.palavras);
  const regex = limparRegex(cfg.regex);
  const temTimeout = tSeg > 0 && podeTimeout(guild);

  if (cfg.compacto !== false) {
    // uma regra so pro filtro inteiro: o discord deixa no maximo 6 regras de
    // palavra por servidor, entao juntar tudo em 1 e o que faz caber
    const keywordFilter = [...(linksOn ? PALAVRAS_LINK : []), ...palavras].slice(0, MAX_PALAVRAS);
    // Reserva tres das dez regex do Discord para as protecoes que sempre
    // precisam estar ligadas: mensagem gigante, invisivel e asterisco.
    const regexPatterns = [...REGEX_NATIVOS, ...regex].slice(0, MAX_REGEX);
    if (keywordFilter.length || regexPatterns.length) {
      defs.push({
        chave: 'filtro',
        nome: 'filtro',
        triggerType: TRIGGER.Keyword,
        triggerMetadata: {
          ...(keywordFilter.length ? { keywordFilter } : {}),
          ...(regexPatterns.length ? { regexPatterns } : {}),
          ...(permitidos.length ? { allowList: permitidos } : {}),
        },
        actions: [bloqueio(aviso.filtro), ...(temTimeout ? [timeouts(tSeg)] : []), ...extra],
      });
    }
    return defs;
  }

  if (linksOn) {
    defs.push({
      chave: 'links',
      nome: 'links',
      triggerType: TRIGGER.Keyword,
      triggerMetadata: { keywordFilter: PALAVRAS_LINK, allowList: permitidos },
      actions: [bloqueio(aviso.links), ...(temTimeout ? [timeouts(tSeg)] : []), ...extra],
    });
  }

  if (palavras.length) {
    defs.push({
      chave: 'palavras',
      nome: 'palavras',
      triggerType: TRIGGER.Keyword,
      triggerMetadata: { keywordFilter: palavras },
      actions: [bloqueio(aviso.palavras), ...(temTimeout ? [timeouts(tSeg)] : []), ...extra],
    });
  }

  if (regex.length) {
    defs.push({
      chave: 'regex',
      nome: 'regex',
      triggerType: TRIGGER.Keyword,
      triggerMetadata: { regexPatterns: regex },
      actions: [bloqueio(aviso.regex), ...(temTimeout ? [timeouts(tSeg)] : []), ...extra],
    });
  }

  if (cfg.asterisco) {
    defs.push({
      chave: 'asterisco',
      nome: 'asterisco',
      triggerType: TRIGGER.Keyword,
      triggerMetadata: { regexPatterns: ['\\*'] },
      actions: [bloqueio(aviso.asterisco), ...extra],
    });
  }

  return defs;
}

// compara o que ja existe no discord com o que o bot quer, pra nao mandar PATCH atoa
function igual(existente, def, extraCargos, extraCanais) {
  const tm = existente.triggerMetadata || {};
  const querTm = def.triggerMetadata || {};
  const mesmo = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
  if (!mesmo(tm.keywordFilter, querTm.keywordFilter)) return false;
  if (!mesmo(tm.regexPatterns, querTm.regexPatterns)) return false;
  if (!mesmo(tm.allowList, querTm.allowList)) return false;
  if (!mesmo(tm.presets, querTm.presets)) return false;
  if ((tm.mentionTotalLimit ?? null) !== (querTm.mentionTotalLimit ?? null)) return false;
  if (!!tm.mentionRaidProtectionEnabled !== !!querTm.mentionRaidProtectionEnabled) return false;

  const acoesAtuais = (existente.actions || []).map((a) => ({
    type: a.type,
    custom: (a.metadata && a.metadata.customMessage) || null,
    dur: (a.metadata && a.metadata.durationSeconds) || null,
    canal: (a.metadata && a.metadata.channelId) || null,
  }));
  const acoesQuer = (def.actions || []).map((a) => ({
    type: a.type,
    custom: (a.metadata && a.metadata.customMessage) || null,
    dur: (a.metadata && a.metadata.durationSeconds) || null,
    canal: (a.metadata && a.metadata.channelId) || (a.metadata && a.metadata.channel) || null,
  }));
  if (JSON.stringify(acoesAtuais) !== JSON.stringify(acoesQuer)) return false;

  const ids = (col) => [...(col ? col.keys() : [])].sort();
  if (JSON.stringify(ids(existente.exemptRoles)) !== JSON.stringify([...extraCargos].sort())) return false;
  if (JSON.stringify(ids(existente.exemptChannels)) !== JSON.stringify([...extraCanais].sort())) return false;
  return true;
}

function copiar(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

function idsDe(col) {
  if (!col) return [];
  if (typeof col.keys === 'function') return [...col.keys()];
  if (Array.isArray(col)) return col.map((x) => (x && x.id) || x).filter(Boolean);
  return [];
}

// Uma regra manual que foi absorvida precisa poder voltar a ser manual. Alem
// de ser uma protecao contra perda acidental, isso deixa claro no arquivo de
// estado qual conteudo existia antes do bot assumir a vaga.
function snapshotRegra(r) {
  return {
    id: r.id,
    nome: r.name,
    eventType: r.eventType,
    triggerType: r.triggerType,
    triggerMetadata: copiar(r.triggerMetadata || {}),
    actions: copiar(r.actions || []),
    enabled: r.enabled !== false,
    exemptRoles: idsDe(r.exemptRoles),
    exemptChannels: idsDe(r.exemptChannels),
  };
}

function absorvidaDe(cfg, guildId) {
  const todas = cfg && cfg.absorvida;
  return todas && ehObj(todas) ? todas[guildId] || null : null;
}

function guardarSnapshot(cfg, guildId, regra) {
  if (!ehObj(cfg.absorvida)) cfg.absorvida = {};
  const snap = snapshotRegra(regra);
  cfg.absorvida[guildId] = snap;
  return snap;
}

function payloadOriginal(snap) {
  if (!snap) return null;
  return {
    name: snap.nome,
    eventType: snap.eventType || EVENTO.MessageSend,
    triggerType: snap.triggerType,
    triggerMetadata: copiar(snap.triggerMetadata || {}),
    actions: copiar(snap.actions || []),
    enabled: snap.enabled !== false,
    exemptRoles: [...(snap.exemptRoles || [])],
    exemptChannels: [...(snap.exemptChannels || [])],
    reason: 'satan: restaurando regra manual absorvida',
  };
}

// ---------------- sincronizacao com o discord ----------------
// cfg.on = true  -> cria/liga/atualiza as regras
// cfg.on = false -> desliga so as regras [satan] (nao apaga nada)
async function sincronizar(guild, cfg = ler(), opts = {}) {
  const out = { criadas: [], ligadas: [], ok: [], erros: [], off: [], removidas: [], adotadas: [], absorvida: null, avisos: [] };
  if (!guild) { out.erros.push('sem guild'); return out; }
  if (!podeGerenciar(guild)) {
    out.erros.push('o bot nao tem a permissao "Gerenciar Servidor" nesse servidor');
    return out;
  }

  let existentes;
  try {
    existentes = await guild.autoModerationRules.fetch();
  } catch (e) {
    out.erros.push('listar regras: ' + msg(e));
    return out;
  }
  const todas = [...existentes.values()];
  const minhas = todas.filter((r) => String(r.name || '').startsWith(PREFIXO));
  const porGatilho = (t) => todas.filter((r) => r.triggerType === t);
  // Regra desligada tambem ocupa uma vaga na API. Contar somente as ligadas
  // era justamente o que fazia a criacao falhar quando as seis selo0..selo5
  // estavam presentes.
  let keywordCount = porGatilho(TRIGGER.Keyword).length;

  if (!cfg.on) {
    for (const r of minhas) {
      if (!r.enabled) continue;
      try {
        await guild.autoModerationRules.edit(r, { enabled: false, reason: 'satan: automod off' });
        out.off.push(r.name);
      } catch (e) { out.erros.push(r.name + ': ' + msg(e)); }
    }
    return out;
  }

  const cargos = cargosValidos(guild, cfg.cargosImunes);
  const canais = canaisValidos(guild, cfg.canaisImunes);
  const defs = definicoes(cfg, guild);

  // mesmo com o bot "off", uma regra feita na mao no painel do discord continua
  // valendo (o bot nao encosta nela) — melhor avisar do que parecer que desligou
  for (const [chave, gatilho, rotulo] of [['spam', TRIGGER.Spam, 'spam'], ['mencoes', TRIGGER.MentionSpam, 'mencoes']]) {
    const ligado = chave === 'spam' ? cfg.spam : !!(cfg.mencoes && cfg.mencoes.on);
    if (ligado) continue;
    const manualLigada = porGatilho(gatilho).find((r) => !String(r.name || '').startsWith(PREFIXO) && r.enabled);
    if (manualLigada) out.avisos.push(`"${manualLigada.name}" (${rotulo}) foi feita na mao e segue ligada — o bot nao mexe nela`);
  }

  for (const def of defs) {
    const nome = PREFIXO + def.nome;
    try {
      const existente = minhas.find((r) => r.name === nome) || todas.find((r) => r.name === nome) || null;

      // gatilho que o discord so deixa ter UM (spam e mencoes): se o dono ja
      // configurou o dele na mao no painel, o bot nao cria outro (daria erro) —
      // ele adota a regra que ja existe
      if (!existente && def.unico) {
        const manual = porGatilho(def.triggerType).find((r) => !String(r.name || '').startsWith(PREFIXO));
        if (manual) {
          if (!manual.enabled) {
            await guild.autoModerationRules.edit(manual, { enabled: true, reason: 'satan: automod ligado' });
            out.ligadas.push(manual.name + ' (regra do painel)');
          }
          out.adotadas.push(manual.name);
          continue;
        }
      }

      // Palavra: o Discord permite no maximo seis regras por servidor. Se nao
      // houver vaga, assume uma regra manual inteira — inclusive a id dela —
      // em vez de pedir que o dono abra espaco no painel.
      if (!existente && !def.unico && def.triggerType === TRIGGER.Keyword && keywordCount >= 6) {
        const manual = porGatilho(TRIGGER.Keyword).find((r) => !String(r.name || '').startsWith(PREFIXO));
        if (manual) {
          const nomeOriginal = manual.name;
          guardarSnapshot(cfg, guild.id, manual);
          await guild.autoModerationRules.edit(manual, {
            name: nome,
            eventType: EVENTO.MessageSend,
            triggerType: def.triggerType,
            triggerMetadata: def.triggerMetadata,
            actions: def.actions,
            enabled: true,
            exemptRoles: cargos,
            exemptChannels: canais,
            reason: 'satan: assumindo vaga de regra manual',
          });
          // Alguns mocks e algumas versoes do discord.js nao atualizam o
          // objeto local retornado pelo fetch depois do edit.
          manual.name = nome;
          manual.eventType = EVENTO.MessageSend;
          manual.triggerType = def.triggerType;
          manual.triggerMetadata = def.triggerMetadata;
          manual.actions = def.actions;
          manual.enabled = true;
          out.absorvida = nomeOriginal;
          out.adotadas.push(nomeOriginal);
          continue;
        }
        out.avisos.push(`o servidor ja tem as 6 regras de palavra que o discord permite e nenhuma e do bot — "${nome}" nao coube`);
        continue;
      }

      if (!existente) {
        await guild.autoModerationRules.create({
          name: nome,
          eventType: EVENTO.MessageSend,
          triggerType: def.triggerType,
          triggerMetadata: def.triggerMetadata,
          actions: def.actions,
          enabled: true,
          exemptRoles: cargos,
          exemptChannels: canais,
          reason: 'satan: automod ligado',
        });
        out.criadas.push(nome);
        if (def.triggerType === TRIGGER.Keyword) keywordCount++;
        continue;
      }
      if (!existente.enabled) {
        await guild.autoModerationRules.edit(existente, { enabled: true, reason: 'satan: automod ligado' });
        out.ligadas.push(nome);
      }
      if (opts.forcar || !igual(existente, def, cargos, canais)) {
        await guild.autoModerationRules.edit(existente, {
          triggerMetadata: def.triggerMetadata,
          actions: def.actions,
          exemptRoles: cargos,
          exemptChannels: canais,
          reason: 'satan: automod sincronizado',
        });
        out.criadas.push(nome + ' (atualizada)');
      } else {
        out.ok.push(nome);
      }
    } catch (e) {
      const m = msg(e);
      if (/maximum|max\b|limit|limite/i.test(m) && def.triggerType === TRIGGER.Keyword) {
        // servidor cheio de regras de palavra: nao e erro do bot, e o limite do discord
        out.avisos.push(`o discord recusou "${nome}" por limite de regras — apaga/desliga uma regra manual no painel do discord que o bot cria a dele sozinho`);
      } else {
        out.erros.push(nome + ': ' + m);
        _err(new Error(`automod ${nome}: ${m}`));
      }
    }
  }

  // regra do bot que nao tem mais o que bloquear (lista esvaziou, mudou pro modo
  // compacto...). APAGA de vez: regra desativada continuaria ocupando uma das
  // (poucas) vagas do discord, e a config no automod_config.json e a fonte da
  // verdade — se voltar a ter conteudo, o bot cria ela de novo
  const desejados = new Set(defs.map((d) => PREFIXO + d.nome));
  for (const r of minhas) {
    if (desejados.has(r.name)) continue;
    try {
      await guild.autoModerationRules.delete(r, 'satan: regra sem uso');
      out.removidas.push(r.name);
    } catch (e) { out.erros.push(r.name + ': ' + msg(e)); }
  }
  return out;
}

// apaga de vez as regras do bot (o servidor fica sem automod nenhum, so as manuais ficam)
async function apagar(guild, cfg = ler()) {
  const out = { apagadas: [], restauradas: [], erros: [] };
  let existentes;
  try { existentes = await guild.autoModerationRules.fetch(); } catch (e) { out.erros.push(msg(e)); return out; }
  const snap = absorvidaDe(cfg, guild.id);
  for (const r of existentes.values()) {
    if (!String(r.name || '').startsWith(PREFIXO)) continue; // regra feita na mao: nao encosta
    try {
      // A regra manual que ocupava a ultima vaga nao foi criada pelo bot;
      // devolve-a ao dono em vez de apagar conteudo que estava no servidor.
      if (snap && r.id === snap.id && r.name === PREFIXO + 'filtro') {
        await guild.autoModerationRules.edit(r, payloadOriginal(snap));
        out.restauradas.push(snap.nome);
      } else {
        await guild.autoModerationRules.delete(r, 'satan: automod removido');
        out.apagadas.push(r.name);
      }
    } catch (e) { out.erros.push(r.name + ': ' + msg(e)); }
  }
  return out;
}

// resumo pro .automod status (inclui as regras feitas na mao no painel do discord)
async function listar(guild) {
  const existentes = await guild.autoModerationRules.fetch();
  const gatilho = { 1: 'palavra', 3: 'spam', 4: 'preset', 5: 'mencoes', 6: 'perfil' };
  const acao = { 1: 'bloqueia', 2: 'alerta no canal', 3: 'timeout', 4: 'quarentena' };
  return [...existentes.values()]
    .map((r) => ({
      nosso: String(r.name || '').startsWith(PREFIXO),
      nome: r.name,
      id: r.id,
      on: r.enabled,
      gatilho: gatilho[r.triggerType] || r.triggerType,
      acoes: (r.actions || []).map((a) => {
        const t = acao[a.type] || a.type;
        const dur = a.metadata && a.metadata.durationSeconds ? ` (${a.metadata.durationSeconds}s)` : '';
        return t + dur;
      }).join(' + '),
      cargos: [...(r.exemptRoles ? r.exemptRoles.keys() : [])],
      canais: [...(r.exemptChannels ? r.exemptChannels.keys() : [])],
    }));
}

module.exports = {
  PREFIXO,
  ARQUIVO,
  ARQUIVO_STATUS,
  PADRAO,
  AVISO_PADRAO,
  PALAVRAS_LINK,
  usar,
  ler,
  salvar,
  criarSeFaltar,
  lerStatus,
  statusDe,
  registrarStatus,
  sincronizar,
  apagar,
  listar,
  podeGerenciar,
  podeTimeout,
  limparPalavras,
  limparRegex,
};
