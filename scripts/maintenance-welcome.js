// Publicação pontual solicitada pelo dono. Não inicia o bot.
const assert = require('node:assert/strict');
const GUILD='1554284137261830184', CHANNEL='1554329873961590788', OLD='1554333094537072743';
const paragraphs = [
'# Bem-vindo ao Inferno',
'Aqui não existe NENHUMA regra, não existe administrador para decidir o que você pode fazer',
'Não existe punição e não existe banimento, não importa o que você faça ou diga, você não será banido, de jeito nenhum.',
'O Inferno é um experimento, pessoas de diferentes lugares, idades, classes sociais e formas de pensar colocadas no mesmo ambiente, sem os limites que normalmente controlam o comportamento.\n\nEntre apenas se estiver pronto.',
'Não estou te pedindo para fazer nada, apenas te avisando que, pela primeira vez, você pode.',
];
async function api(path, method='GET', body) {
 const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 if(!r.ok) throw Error(`${method} ${path}: HTTP ${r.status}`);
 return r.status===204 ? null : r.json();
}
async function main(){
 assert.ok(process.env.DISCORD_TOKEN);
 const guild=await api(`/guilds/${GUILD}`);
 assert.equal(guild.owner_id,'1521612392105250836');
 const channel=await api(`/channels/${CHANNEL}`);
 assert.equal(channel.guild_id,GUILD);assert.equal(channel.name,'inferno');assert.equal(channel.type,0);
 const me=await api('/users/@me');
 const previous=await api(`/channels/${CHANNEL}/messages/${OLD}`);
 assert.equal(previous.author.id,me.id);
 assert.ok(JSON.stringify(previous.components).includes('Sinta-se em casa. Faça o que quiser.'));
 const components=[];
 for(const [i,text] of paragraphs.entries()){
  if(i) components.push({type:14,spacing:1,divider:i===1});
  components.push({type:10,content:text});
 }
 const msg=await api(`/channels/${CHANNEL}/messages`,'POST',{
  flags:1<<15,components:[{type:17,accent_color:8912896,components}],allowed_mentions:{parse:[]},nonce:'inferno-final-20260929-1',enforce_nonce:true,
 });
 const verified=await api(`/channels/${CHANNEL}/messages/${msg.id}`);
 assert.equal(verified.author.id,me.id);
 assert.deepEqual(verified.components[0].components.filter(c=>c.type===10).map(c=>c.content),paragraphs);
 console.log(`::notice::NOVA MENSAGEM VERIFICADA: https://discord.com/channels/${GUILD}/${CHANNEL}/${msg.id}`);
 await api(`/channels/${CHANNEL}/messages/${OLD}`,'DELETE');
 try {await api(`/channels/${CHANNEL}/messages/${OLD}`);throw Error('Mensagem antiga ainda existe');}
 catch(e){if(!e.message.endsWith('HTTP 404'))throw e;}
 console.log('::notice::CONCLUIDO: mensagem de teste apagada; novo texto publicado e verificado.');
}
main().catch(e=>{console.log('::error::'+e.message);process.exitCode=1;});
