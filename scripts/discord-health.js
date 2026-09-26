// A biblioteca tenta reconectar primeiro; so reinicia se permanecer desconectada.
function watchDiscord(client, { log, exit = code => process.exit(code), now = Date.now,
  every = setInterval, graceMs = 120_000, intervalMs = 30_000 } = {}) {
  let lastReady = now();
  return every(() => {
    if (client.isReady()) {
      lastReady = now();
      return;
    }
    if (now() - lastReady < graceMs) return;
    log('DISCORD_OFFLINE', { offlineMs: now() - lastReady, acao: 'reiniciando processo' });
    client.destroy();
    exit(1);
  }, intervalMs);
}
module.exports = { watchDiscord };
