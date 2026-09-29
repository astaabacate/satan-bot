// Manutenção pontual, invocada SOMENTE no runner do workflow (não inicia o bot).
// Duas etapas: primeiro relatório sem mudanças, depois execução explícita.
const assert = require('node:assert/strict');
const blueprint = require('../server_blueprint.json');

const guildIds = [...new Set([blueprint.guild.id, blueprint.guild.idServidorAntigo, '1525806672839442633'])];
const OWNER_ID = '1521612392105250836';
const base = 'https://discord.com/api/v10';
const token = process.env.DISCORD_TOKEN;
const apply = process.env.MAINTENANCE_APPLY === 'true';

async function request(endpoint, method = 'GET', body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 429) throw new Error('Discord rate limited; aborting without retry');
  if (!response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function main() {
  if (!token) throw new Error('DISCORD_TOKEN ausente no runner');
  const me = await request('/users/@me');
  console.log(`Modo: ${apply ? 'APLICAR' : 'INSPECIONAR'}; bot ${me.id}`);
  const matches = [];
  for (const id of guildIds) {
    let guild;
    try { guild = await request(`/guilds/${id}`); }
    catch (e) {
      if (/HTTP (403|404)$/.test(e.message)) { console.log(`Servidor ${id} indisponível para o bot`); continue; }
      throw e;
    }
    if (guild.name !== 'inferno' || guild.owner_id !== OWNER_ID) {
      console.log(`Servidor ${id}: não corresponde ao nome/dono esperado; ignorado`);
      continue;
    }
    const channels = await request(`/guilds/${id}/channels`);
    const categories = channels.filter(c => c.type === 4 && c.name.trim() === '・');
    console.log(`Servidor ${id} (${guild.name}): ${channels.length} canais, ${categories.length} categorias chamadas ・`);
    if (categories.length === 1) matches.push({ guild, channels, category: categories[0] });
  }
  if (matches.length !== 1) throw new Error(`Esperava um único servidor inferno com uma única categoria ・; encontrei ${matches.length}. Nenhuma alteração.`);
  const { guild, channels, category } = matches[0];
  const voices = channels.filter(c => c.type === 2 && c.parent_id !== category.id);
  console.log(`Categoria escolhida: ${category.id}; canais de voz a mover (${voices.length}): ${voices.map(c => `${c.name}(${c.id})`).join(', ') || '(nenhum)'}`);
  const pinned = [];
  const errors = [];
  // Canais de voz também oferecem chat; examinar todos os canais onde pode haver pins.
  for (const channel of channels.filter(c => [0, 2, 5, 13, 15].includes(c.type))) {
    try {
      const result = await request(`/channels/${channel.id}/pins`);
      const list = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(list) || (result.has_more === true)) throw new Error('resposta paginada ou inesperada');
      for (const item of list) {
        const msg = item.message || item;
        pinned.push({ channelId: channel.id, channelName: channel.name, id: msg.id, authorId: msg.author?.id, webhookId: msg.webhook_id });
      }
    } catch (e) { errors.push(`${channel.name}(${channel.id}): ${e.message}`); }
  }
  console.log('Mensagens fixadas:', JSON.stringify(pinned));
  if (errors.length) console.log('Canais cujos fixados não pude verificar:', JSON.stringify(errors));
  if (!apply) return;
  assert.equal(errors.length, 0, 'Nem todos os canais foram verificados; nada será apagado ou movido');
  assert.equal(pinned.length, 1, 'Há zero ou mais de uma mensagem fixada; nada será apagado ou movido');
  assert.equal(pinned[0].authorId, me.id, 'A única mensagem fixada não é do bot; nada será apagado ou movido');
  // Exclusão remove o pin junto com a mensagem, sem precisar de um unpin separado.
  await request(`/channels/${pinned[0].channelId}/messages/${pinned[0].id}`, 'DELETE');
  console.log(`Mensagem do bot apagada (e desafixada): ${pinned[0].channelId}/${pinned[0].id}`);
  let failures = 0;
  for (const channel of voices) {
    try {
      await request(`/channels/${channel.id}`, 'PATCH', { parent_id: category.id });
      console.log(`Movido: ${channel.name}(${channel.id}) -> ${category.id}`);
    } catch (e) {
      failures++;
      console.error(`Falha ao mover ${channel.name}(${channel.id}): ${e.message}`);
    }
  }
  if (failures) throw new Error(`${failures} canal(is) de voz não movido(s); consulte o relatório`);
  console.log(`Concluído: servidor ${guild.id}, ${voices.length} canais de voz movidos.`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
