// Renascimento de canal (nuke do confessionario): o spec de recriacao PRECISA
// carregar as permissoes originais. O bug antigo calculava as overwrites num
// mapa "over" e nunca as passava pro channels.create — o canal renascia SEM
// permissoes e o anti-flood nao conseguia apagar nada la (falta Gerenciar
// Mensagens), em silencio.

// o que o bot precisa num canal pra moderar (apagar spam e falar)
const PERMS_BOT_CANAL = {
  ViewChannel: true,
  SendMessages: true,
  EmbedLinks: true,
  AttachFiles: true,
  ReadMessageHistory: true,
  ManageMessages: true,
  ManageWebhooks: true,
};

function toBitfield(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  return BigInt(String(v));
}

// chan: { name, type, parentId, topic, nsfw, rateLimitPerUser, position }
// overwrites: [{ id, type, allow, deny }] (allow/deny: bigint | number | string)
function buildChannelSpec(chan, overwrites, { reason } = {}) {
  const spec = {
    name: chan.name,
    type: chan.type,
    parent: chan.parentId || undefined,
    topic: chan.topic || undefined,
    nsfw: chan.nsfw,
    rateLimitPerUser: chan.rateLimitPerUser || undefined,
    position: chan.position,
  };
  if (reason) spec.reason = reason;
  spec.permissionOverwrites = (overwrites || []).map((o) => ({
    id: o.id,
    type: o.type,
    allow: toBitfield(o.allow || 0),
    deny: toBitfield(o.deny || 0),
  }));
  return spec;
}

// devolve quais permissoes da lista faltam (has: (nome) => boolean)
function missingPerms(has, perms = Object.keys(PERMS_BOT_CANAL)) {
  return perms.filter((p) => !has(p));
}

module.exports = { buildChannelSpec, missingPerms, PERMS_BOT_CANAL };
