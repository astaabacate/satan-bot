'use strict';
const assert = require('assert');
const automod = require('./automod.js');

function cacheMap(entries) {
  const m = new Map(entries);
  return { has: (k) => m.has(k), get: (k) => m.get(k), keys: () => m.keys(), values: () => m.values() };
}

function mockGuild(regras) {
  const store = new Map(regras.map((r) => [r.id, { ...r, exemptRoles: cacheMap([]), exemptChannels: cacheMap([]) }]));
  let next = 100;
  const guild = {
    id: 'g1',
    members: { me: { permissions: { has: () => true } } },
    roles: { cache: cacheMap([]) },
    channels: { cache: cacheMap([]) },
    autoModerationRules: {
      fetch: async () => store,
      create: async (p) => {
        const id = String(++next);
        const r = { id, name: p.name, enabled: p.enabled !== false, triggerType: p.triggerType, triggerMetadata: p.triggerMetadata || {}, actions: p.actions || [], eventType: p.eventType, exemptRoles: cacheMap([]), exemptChannels: cacheMap([]) };
        store.set(id, r);
        return r;
      },
      edit: async (rOrId, p) => {
        const r = typeof rOrId === 'object' ? store.get(rOrId.id) : store.get(rOrId);
        Object.assign(r, p);
        if (p.name) r.name = p.name;
        return r;
      },
      delete: async (rOrId) => {
        const id = typeof rOrId === 'object' ? rOrId.id : rOrId;
        store.delete(id);
      },
    },
  };
  return { guild, store };
}

async function main() {
  assert.ok(!JSON.stringify(automod.REGEX_NATIVOS).includes('{501,'), 'nao pode ter regex gigante');
  const { guild, store } = mockGuild([
    { id: '1', name: 'selo0', enabled: true, triggerType: 1, triggerMetadata: { keywordFilter: ['palavra-velha'], regexPatterns: [] }, actions: [{ type: 1, metadata: {} }] },
    { id: '2', name: 'selo1', enabled: true, triggerType: 1, triggerMetadata: { keywordFilter: ['outra'], regexPatterns: [] }, actions: [{ type: 1, metadata: {} }] },
    { id: '3', name: 'minha-regra-manual', enabled: true, triggerType: 1, triggerMetadata: { keywordFilter: ['ficar'], regexPatterns: [] }, actions: [{ type: 1, metadata: {} }] },
    { id: '4', name: 'selo-preset1', enabled: true, triggerType: 3, triggerMetadata: {}, actions: [{ type: 1, metadata: {} }] },
  ]);
  const cfg = { ...automod.PADRAO, on: true, compacto: true, palavras: [], regex: [], absorvida: {} };
  const r = await automod.sincronizar(guild, cfg);
  assert.ok(cfg.palavras.includes('palavra-velha'));
  assert.ok(cfg.palavras.includes('outra'));
  assert.ok(r.removidas.includes('selo0'));
  assert.ok(r.removidas.includes('selo1'));
  const nomes = [...store.values()].map((x) => x.name).sort();
  assert.ok(nomes.includes('[satan] filtro'));
  assert.ok(nomes.includes('[satan] spam') || r.adotadas.includes('selo-preset1'));
  assert.ok(nomes.includes('[satan] mencoes'));
  assert.ok(nomes.includes('minha-regra-manual'), 'regra manual deve ficar');
  assert.ok(!nomes.includes('selo0'));
  const filtro = [...store.values()].find((x) => x.name === '[satan] filtro');
  assert.ok(filtro.triggerMetadata.keywordFilter.includes('*https://*'));
  assert.ok(filtro.triggerMetadata.keywordFilter.includes('palavra-velha'));
  assert.ok(!(filtro.triggerMetadata.regexPatterns || []).some((p) => p.includes('{501,')));
  assert.ok((filtro.triggerMetadata.regexPatterns || []).some((p) => p.includes('200b') || p.includes('\\*')));

  const semPerm = mockGuild([]);
  semPerm.guild.members.me.permissions.has = () => false;
  const r2 = await automod.sincronizar(semPerm.guild, cfg);
  assert.ok(r2.erros.some((e) => /Gerenciar Servidor/.test(e)));
  console.log('ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
