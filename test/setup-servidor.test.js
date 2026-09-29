const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configurarServidor } = require('../scripts/setup-servidor');

const snap = {
  guild: { systemChannelId: 'ch-conf' },
  cargos: [{ id: 'role-1', name: 'staff', color: 1, hoist: false, position: 1, permissions: '8', mentionable: false, managed: false }],
  categorias: [],
  canais: [
    { id: 'ch-conf', name: '・confessionario', papel: 'sistema', type: 0, parentId: null, position: 1, topic: null, nsfw: false, rateLimitPerUser: 0, overwrites: [] },
    { id: 'ch-logs', name: 'logs-do-satan', papel: 'logs', type: 0, parentId: null, position: 2, topic: null, nsfw: false, rateLimitPerUser: 0, overwrites: [] },
    { id: 'ch-painel', name: 'painel', papel: 'painel', type: 0, parentId: null, position: 3, topic: null, nsfw: false, rateLimitPerUser: 0, overwrites: [] },
    { id: 'ch-bump', name: 'bump', papel: 'bump', type: 0, parentId: null, position: 4, topic: null, nsfw: false, rateLimitPerUser: 0, overwrites: [] },
    { id: 'ch-vc', name: 'purgatorio', type: 2, parentId: null, position: 5, topic: null, nsfw: false, rateLimitPerUser: 0, overwrites: [] },
  ],
};

function fakeGuild() {
  const canais = new Map();
  const cargos = new Map();
  const estado = { sistema: null, perms: [], apagados: [], pins: 0, posts: 0, ordem: [] };
  let seq = 0;
  // o spec do create vem por ultimo, mas as sobrescritas do fake (metodo .edit)
  // precisam vencer o array permissionOverwrites que vem no spec
  const deco = (id, spec = {}) => ({
    id, name: spec.name || id, type: spec.type || 0,
    delete: async () => { canais.delete(id); estado.apagados.push(id); },
    send: async () => { estado.posts++; return { id: 'msg1', pin: async () => { estado.pins++; } }; },
    isTextBased: () => true,
    ...spec,
    permissionOverwrites: { edit: async (role, perms) => { estado.perms.push({ id, perms }); } },
  });
  return {
    id: 'g-novo', estado, cargos,
    channels: {
      cache: canais,
      fetch: async () => canais,
      setPositions: async (lista) => { estado.ordem.push(lista); },
      create: async (spec) => { const n = deco('novo-' + (seq++), spec); canais.set(n.id, n); return n; },
    },
    roles: { create: async (spec) => { const c = { id: 'cargo-' + cargos.size, ...spec }; cargos.set(c.id, c); return c; } },
    members: { me: { roles: { highest: { id: 'cargo-bot' } } } },
    setSystemChannel: async (id) => { estado.sistema = id; },
    add: (id, extra) => { const c = deco(id, extra); canais.set(c.id, c); return c; },
  };
}

test('setup cria tudo, da permissao do bot, aponta o sistema e religa logs/painel/bump', async () => {
  const g = fakeGuild();
  // canais que o Discord cria sozinho no servidor novo
  g.add('padrao-texto', { name: 'general', type: 0 });
  g.add('padrao-voz', { name: 'Voice', type: 2 });

  const nukeState = { on: true, nextAt: Date.now() + 999999, cmdChannel: 'VELHO', painel: { channelId: 'VELHO', messageId: '9' } };
  const logsState = { on: true, channelId: 'VELHO', webhookId: 'webhook-morto' };
  const bumpState = { target: { users: ['1'], roles: [] }, 'CANAL_VELHO': { nextAt: 1 } };
  const salvos = { nuke: null, logs: null, bump: null, painel: 0 };
  let textoPostado = null;

  const rel = await configurarServidor(g, snap, {
    nukeState, salvarNuke: (s) => { salvos.nuke = s; },
    logsState, salvarLogs: (s) => { salvos.logs = s; },
    bumpState, salvarBump: (s) => { salvos.bump = s; },
    textoBemVindo: { conteudo: 'inferno' },
    rearmarPainel: async () => { salvos.painel++; },
    postar: async (ch, payload) => { textoPostado = { ch: ch.id, payload }; return { id: 'm', pin: async () => {} }; },
  });

  assert.equal(rel.canais, 5);
  assert.equal(rel.erros.length, 0);
  // bot com permissao em TODO canal (os 5 do blueprint + os 2 padrao que
  // ainda existem nesse instante e so depois sao apagados)
  assert.equal(g.estado.perms.length, 7);
  const voz = g.estado.perms.find((p) => p.id === 'novo-4');
  assert.equal(voz.perms.Connect, true);
  assert.equal(voz.perms.ManageMessages, true);
  // canal de sistema = confessionario novo
  assert.equal(g.estado.sistema, 'novo-0');
  // canais padrao do Discord apagados
  assert.deepEqual(g.estado.apagados.sort(), ['padrao-texto', 'padrao-voz']);
  // painel: id antigo morreu -> recria e rearma o nuke
  assert.equal(salvos.nuke.painel, null);
  assert.notEqual(salvos.nuke.cmdChannel, 'VELHO');
  assert.equal(salvos.painel, 1);
  // logs: canal novo + webhook limpo (recria o "Satan Logs")
  assert.equal(salvos.logs.webhookId, '');
  assert.equal(salvos.logs.channelId, 'novo-1');
  // bump: chave do canal velho migrada
  assert.equal(salvos.bump['VELHO'], undefined);
  assert.ok(Object.keys(salvos.bump).some((k) => k !== 'target'));
  assert.deepEqual(salvos.bump.target, { users: ['1'], roles: [] });
  // o textinho do inferno vai pro confessionario, no canal de sistema
  assert.equal(textoPostado.ch, 'novo-0');
  assert.deepEqual(textoPostado.payload, { conteudo: 'inferno' });
});

test('modo limpo: apaga TUDO fora do blueprint, mas preserva canal e mensagens do que fica', async () => {
  const g = fakeGuild();
  // canal do blueprint que ja existe (com mensagem dentro) + sujeira
  g.add('meu-bump', { name: 'bump', type: 0 });
  g.add('lixo-1', { name: 'memes', type: 0 });
  g.add('lixo-2', { name: 'Call da Call', type: 2 });
  g.add('cmd-channel', { name: 'zap', type: 0 }); // de onde o comando saiu
  const rel = await configurarServidor(g, snap, {
    limparExtras: true, manterCanalId: 'cmd-channel',
    nukeState: { on: true, nextAt: Date.now() + 999999, painel: { channelId: 'VELHO', messageId: '1' } }, salvarNuke: () => {},
  });
  const sobraram = [...g.channels.cache.keys()];
  assert.ok(sobraram.includes('meu-bump'), 'canal do blueprint continua (mensagens preservadas)');
  assert.ok(sobraram.includes('cmd-channel'), 'canal do comando sobrevive');
  assert.equal(sobraram.includes('lixo-1'), false, 'canal fora do blueprint apagado');
  assert.equal(sobraram.includes('lixo-2'), false, 'canal de voz fora do blueprint apagado');
  assert.equal(rel.apagados, 2);
  // e os canais faltantes foram criados
  assert.equal(rel.canais, 4);
});

test('modo normal (sem limpar) so apaga o que o Discord cria sozinho', async () => {
  const g = fakeGuild();
  g.add('meu-memes', { name: 'memes', type: 0 });
  g.add('general', { name: 'general', type: 0 });
  const rel = await configurarServidor(g, snap, { nukeState: null });
  assert.equal(g.channels.cache.has('meu-memes'), true);
  assert.equal(g.channels.cache.has('general'), false);
  assert.equal(rel.apagados, 1);
});

test('recriar tambem deixa o inferno em primeiro e o confessionario em segundo', async () => {
  const g = fakeGuild();
  // canal inferno existente, mas depois de tudo (o rebuild copia position e o
  // Discord nao renumera: sem o reindex o confessionario fica na frente dele)
  g.add('inf', { name: 'inferno', type: 0, position: 9 });
  const rel = await configurarServidor(g, snap, { nukeState: null });
  assert.deepEqual(rel.ordem, ['inferno', '・confessionario', 'logs-do-satan', 'painel', 'bump', 'purgatorio']);
  assert.equal(g.estado.ordem.length, 1); // um PATCH so
  assert.deepEqual(g.estado.ordem[0].map((p) => p.channel), ['inf', 'novo-0', 'novo-1', 'novo-2', 'novo-3', 'novo-4']);
  assert.deepEqual(g.estado.ordem[0].map((p) => p.position), [0, 1, 2, 3, 4, 5]);
});

test('setup nao mexe em quem ja estava certo (painel vivo) e nao quebra sem blueprint', async () => {
  const g = fakeGuild();
  g.add('X', { name: 'painel', type: 0 }); // o canal do painel existe de verdade
  const nukeState = { on: true, nextAt: Date.now() + 1000, painel: { channelId: 'X', messageId: 'Y' } };
  let painelChamou = 0;
  await configurarServidor(g, snap, {
    nukeState, salvarNuke: () => {},
    rearmarPainel: async () => { painelChamou++; },
  });
  assert.equal(painelChamou, 0);
  assert.equal(nukeState.painel.channelId, 'X');
  const vazio = await configurarServidor(g, null);
  assert.deepEqual(vazio.erros, ['sem guild ou sem blueprint']);
});
