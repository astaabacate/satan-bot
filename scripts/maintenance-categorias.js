// Manutenção pontual. Sem gateway, sem publicar conteúdo ou credenciais.
const assert = require('node:assert/strict');
const GUILD = '1554284137261830184', OWNER = '1521612392105250836';
const bit = n => 1n << BigInt(n);
const VIEW = bit(10), HISTORY = bit(16), SEND = bit(11);
// Ações em canais de texto: reações, gestão, envio, threads, mídia, apps etc.
const ACTIONS = [4,6,11,12,13,14,15,17,18,29,31,34,35,36,37,38,39,45,46,49,50,51].reduce((a,n)=>a|bit(n),0n);
function notice(message) { console.log('::notice::' + message.replace(/%/g,'%25').replace(/\n/g,'%0A').replace(/\r/g,'%0D')); }
async function api(endpoint, method='GET', body) {
  const r = await fetch('https://discord.com/api/v10'+endpoint, {method, headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(30000)});
  if (!r.ok) throw Error(`${method} ${endpoint}: HTTP ${r.status}`);
  return r.status===204 ? null : r.json();
}
const normalize = s => s.normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z]/g,'');
async function main() {
  assert.ok(process.env.DISCORD_TOKEN, 'Token ausente');
  const me = await api('/users/@me');
  const guild = await api(`/guilds/${GUILD}`);
  assert.equal(guild.owner_id, OWNER); assert.equal(guild.name, 'inferno');
  const member = await api(`/guilds/${GUILD}/members/${me.id}`);
  const roles = await api(`/guilds/${GUILD}/roles`);
  const botRoles = new Set(roles.filter(r=>r.tags?.bot_id===me.id).map(r=>r.id));
  const channels = await api(`/guilds/${GUILD}/channels`);
  const chosen = {};
  for(const name of ['inferno','confessionario','bump','logs']) {
    const matches = channels.filter(c=>c.type===0 && normalize(c.name)===name);
    assert.ok(matches.length === 1 || (name==='inferno' && matches.length===0),`Canal ambíguo/ausente: ${name}`);
    chosen[name]=matches[0];
  }
  const voiceCat = channels.find(c=>c.id==='1554324703282466816' && c.type===4 && c.name==='・');
  assert.ok(voiceCat,'Categoria de voz não localizada');
  const otherCats = channels.filter(c=>c.type===4 && c.name==='・' && c.id!==voiceCat.id);
  assert.ok(otherCats.length<=1,'Mais de uma categoria de texto possível');
  const baseBotPerms = [10,11,13,14,15,16,29].reduce((a,n)=>a|bit(n),0n);
  function spec(channel, kind) {
    const allow = kind==='private' ? 0n : VIEW|HISTORY|(kind==='text'?SEND:0n);
    const deny = kind==='private' ? VIEW : ACTIONS & ~(kind==='text'?SEND:0n);
    const result = (channel?.permission_overwrites||[]).map(o=>({...o}));
    // Impede permissões explícitas de outros cargos de anularem as restrições.
    for(const o of result) {
      if(o.id===me.id || botRoles.has(o.id)) continue;
      o.allow=(BigInt(o.allow)&~deny).toString();
    }
    let everyone=result.find(o=>o.id===GUILD && o.type===0);
    if(!everyone) {everyone={id:GUILD,type:0,allow:'0',deny:'0'};result.push(everyone);}
    everyone.allow=((BigInt(everyone.allow)&~deny)|allow).toString();
    everyone.deny=((BigInt(everyone.deny)&~allow)|deny).toString();
    let bot=result.find(o=>o.id===me.id && o.type===1);
    if(!bot) {bot={id:me.id,type:1,allow:'0',deny:'0'};result.push(bot);}
    bot.allow=(BigInt(bot.allow)|baseBotPerms).toString();
    bot.deny=(BigInt(bot.deny)&~baseBotPerms).toString();
    return {overwrites:result,allow,deny};
  }
  const plans = ['inferno','confessionario','bump','logs'].map(name=>({name,channel:chosen[name],...spec(chosen[name],name==='inferno'?'read':name==='confessionario'?'text':'private')}));
  notice(`Plano validado: inferno somente leitura; confessionario texto; bump/logs privados. Categoria de voz preservada. Administradores continuam com acesso por regra do Discord.`);
  const cat=otherCats[0] || await api(`/guilds/${GUILD}/channels`,'POST',{name:'・',type:4});
  const ids=[];
  for(const p of plans) {
    const payload={parent_id:cat.id,permission_overwrites:p.overwrites};
    const c=p.channel ? await api(`/channels/${p.channel.id}`,'PATCH',payload) : await api(`/guilds/${GUILD}/channels`,'POST',{...payload,name:p.name,type:0});
    ids.push(c.id); p.id=c.id;
  }
  await api(`/guilds/${GUILD}/channels`,'PATCH',ids.map((id,i)=>({id,position:i})));
  const after=await api(`/guilds/${GUILD}/channels`);
  const ordered=after.filter(c=>ids.includes(c.id)).sort((a,b)=>a.position-b.position);
  assert.deepEqual(ordered.map(c=>c.id),ids,'Ordem final incorreta');
  for(const p of plans) {
    const c=after.find(c=>c.id===p.id); assert.equal(c.parent_id,cat.id);
    const ev=c.permission_overwrites.find(o=>o.id===GUILD && o.type===0);
    assert.equal(BigInt(ev.allow)&p.allow,p.allow);
    assert.equal(BigInt(ev.deny)&p.deny,p.deny);
    for(const o of c.permission_overwrites) {
      if(o.id===me.id || botRoles.has(o.id)) continue;
      assert.equal(BigInt(o.allow)&p.deny,0n,'Outra overwrite ainda libera ação proibida');
    }
    notice(`Verificado ${c.name} (${c.id}): categoria ${cat.id}, posição ${c.position}; restrições aplicadas, bot preservado.`);
  }
  for(const c of channels.filter(c=>c.type===2)) {
    const current=after.find(x=>x.id===c.id);
    assert.equal(current.parent_id,c.parent_id);
    assert.deepEqual(current.permission_overwrites,c.permission_overwrites);
  }
  notice('CONCLUIDO: 4 canais na segunda categoria ・, ordem e permissões verificadas; voz intacta.');
}
main().catch(e=>{console.log('::error::'+e.message);process.exitCode=1;});
