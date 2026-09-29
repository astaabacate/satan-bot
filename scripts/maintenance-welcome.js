const assert = require('node:assert/strict');
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
const GUILD='1554284137261830184', CHANNEL='1554329873961590788';
async function api(path, method='GET', body) {
 const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 if(!r.ok) throw Error(`${method} ${path}: HTTP ${r.status}`);
 return r.json();
}
async function main(){
 assert.ok(process.env.DISCORD_TOKEN);
 const guild=await api(`/guilds/${GUILD}`);
 assert.equal(guild.owner_id,'1521612392105250836');
 const channel=await api(`/channels/${CHANNEL}`);
 assert.equal(channel.guild_id,GUILD);assert.equal(channel.name,'inferno');assert.equal(channel.type,0);
 const me=await api('/users/@me');
 const msg=await api(`/channels/${CHANNEL}/messages`,'POST',{...WELCOME_MSG,allowed_mentions:{parse:[]},nonce:'welcome-test-20260929-1',enforce_nonce:true});
 const verified=await api(`/channels/${CHANNEL}/messages/${msg.id}`);
 assert.equal(verified.author.id,me.id);assert.equal(verified.channel_id,CHANNEL);
 assert.ok(JSON.stringify(verified.components).includes('Bem-vindo ao Inferno'));
 console.log(`::notice::ENVIADO E VERIFICADO: https://discord.com/channels/${GUILD}/${CHANNEL}/${msg.id}`);
}
main().catch(e=>{console.log('::error::'+e.message);process.exitCode=1;});
