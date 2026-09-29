// Manutenção pontual no runner: garante que @everyone NÃO pode escrever no chat
// dos canais de voz do inferno. Não inicia o bot e não grava nada no repo.
const token = process.env.DISCORD_TOKEN;
const GUILD_ID = '1554284137261830184';
const base = 'https://discord.com/api/v10';
const SEND_MESSAGES = 1n << 11n;

const originalLog = console.log;
console.log = (...args) => {
  const text = args.join(' ').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  originalLog(`::notice::${text}`);
};

async function request(endpoint, method = 'GET', body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 429) throw new Error('Discord rate limited; aborting');
  if (!response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function main() {
  if (!token) throw new Error('DISCORD_TOKEN ausente no runner');
  const me = await request('/users/@me');
  console.log(`Bot ${me.id}; verificando canais de voz do servidor ${GUILD_ID}`);
  const channels = await request(`/guilds/${GUILD_ID}/channels`);
  const voices = channels.filter(c => c.type === 2);
  console.log(`Canais de voz encontrados: ${voices.length}`);
  const changes = [];
  for (const channel of voices) {
    const current = await request(`/channels/${channel.id}`);
    const overwrites = current.permission_overwrites || [];
    const everyone = overwrites.find(o => o.id === GUILD_ID && o.type === 0);
    const allow = BigInt(everyone?.allow || 0);
    const deny = BigInt(everyone?.deny || 0);
    if ((deny & SEND_MESSAGES) === SEND_MESSAGES && (allow & SEND_MESSAGES) === 0n) {
      console.log(`OK: ${channel.name} (${channel.id}) já está sem escrever para @everyone`);
      continue;
    }
    const newAllow = allow & ~SEND_MESSAGES;
    const newDeny = deny | SEND_MESSAGES;
    await request(`/channels/${channel.id}/permissions/${GUILD_ID}`, 'PUT', {
      allow: newAllow.toString(),
      deny: newDeny.toString(),
      type: 0,
    });
    changes.push(channel.id);
    console.log(`Ajustado: ${channel.name} (${channel.id}) — @everyone sem Enviar mensagens`);
  }
  // verificação final
  let failures = 0;
  for (const channel of voices) {
    const current = await request(`/channels/${channel.id}`);
    const everyone = (current.permission_overwrites || []).find(o => o.id === GUILD_ID && o.type === 0);
    const allow = BigInt(everyone?.allow || 0);
    const deny = BigInt(everyone?.deny || 0);
    const ok = (deny & SEND_MESSAGES) === SEND_MESSAGES && (allow & SEND_MESSAGES) === 0n;
    if (!ok) { failures++; console.log(`FALHA: ${channel.name} (${channel.id}) ainda permite escrever`); }
  }
  if (failures) throw new Error(`${failures} canal(is) de voz seguem com escrita liberada`);
  console.log(`Concluído: ${changes.length} canal(is) ajustados, ${voices.length} verificados.`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
