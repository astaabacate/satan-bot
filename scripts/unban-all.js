const PAGE_SIZE = 1000;
const CONFIRM_MS = 60_000;

// Coleta a lista ANTES de alterar bans: paginacao completa, sem pular usuarios
// ao remover itens e sem continuar atras de novos bans criados durante a operacao.
async function fetchAllBanIds(guild) {
  const ids = new Set();
  let after;
  while (true) {
    const page = await guild.bans.fetch({ limit: PAGE_SIZE, cache: false, ...(after ? { after } : {}) });
    if (!page.size) break;
    let last = after;
    for (const id of page.keys()) {
      ids.add(id);
      if (!last || BigInt(id) > BigInt(last)) last = id;
    }
    if (last === after) throw new Error('A paginacao dos banimentos nao avancou.');
    after = last;
    if (page.size < PAGE_SIZE) break;
  }
  return [...ids];
}

async function unbanIds(guild, ids, { reason, log, isBlacklisted }) {
  const result = { total: ids.length, removed: 0, alreadyRemoved: 0, failed: 0, pending: 0, blacklisted: 0 };
  for (const id of ids) {
    try {
      // Sequencial: o gerenciador REST do discord.js respeita os rate limits.
      await guild.bans.remove(id, reason);
      result.removed++;
    } catch (error) {
      if (Number(error.code) === 10026) {
        result.alreadyRemoved++; // outro moderador ja retirou esse ban
        continue;
      }
      result.failed++;
      log('DESBANIR_FALHA', { guild: guild.id, userId: id, code: error.code, message: error.message });
      if ([50001, 50013].includes(Number(error.code))) break; // acesso/permissao perdida
      continue;
    }
    if (isBlacklisted(id)) result.blacklisted++;
  }
  result.pending = result.total - result.removed - result.alreadyRemoved - result.failed;
  return result;
}

function createUnbanAllCommand({ ownerId, send, log, onError, isBlacklisted = () => false, now = Date.now }) {
  const pending = new Map();
  const running = new Set();
  return async function handleUnbanAll(message) {
    const command = (message.content || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/^\.desbanir(?: |$)/.test(command)) return false;
    if (message.author.id !== ownerId || message.author.bot || message.webhookId) return true;
    const guild = message.guild;
    if (!guild) {
      await send(message, 'use `.desbanir todos` em um canal do servidor que você quer desbanir.');
      return true;
    }
    if (running.has(guild.id)) {
      await send(message, 'já estou desbanindo neste servidor. aguarde o resumo final.');
      return true;
    }
    if (command === '.desbanir cancelar') {
      pending.delete(guild.id);
      await send(message, 'confirmação de desbanimento cancelada.');
      return true;
    }
    if (!['.desbanir todos', '.desbanir todos confirmar'].includes(command)) {
      await send(message, 'use `.desbanir todos`. vou pedir confirmação antes de remover os banimentos.');
      return true;
    }
    // Trava tambem durante checagem de permissao/listagem e consome confirmacao
    // antes do primeiro await para impedir dois comandos simultaneos.
    const confirmation = pending.get(guild.id);
    if (command === '.desbanir todos confirmar') {
      if (!confirmation || confirmation.channelId !== message.channelId || now() >= confirmation.expiresAt) {
        await send(message, 'sem confirmação válida neste canal. envie `.desbanir todos` novamente (prazo de 60 segundos).');
        return true;
      }
      pending.delete(guild.id);
    }
    running.add(guild.id);
    let result;
    try {
      const me = await guild.members.fetchMe();
      if (!me.permissions.has('BanMembers')) {
        await send(message, 'preciso da permissão **Banir membros** para listar e remover os banimentos.');
        return true;
      }
      if (command === '.desbanir todos') {
        await send(message, [
          '**Atenção: isso remove TODOS os banimentos deste servidor.**',
          'Para confirmar, envie `.desbanir todos confirmar` **neste canal em até 60 segundos**.',
          'Para desistir: `.desbanir cancelar`.',
          'A blacklist automática **não será apagada**: quem estiver nela pode ser banido novamente ao entrar. Desbanir não adiciona ninguém de volta ao servidor.',
        ].join('\n'));
        pending.set(guild.id, { channelId: message.channelId, expiresAt: now() + CONFIRM_MS });
        return true;
      }
      await send(message, 'buscando a lista completa de banidos deste servidor. vou desbanir um por vez; isso pode demorar.');
      const ids = await fetchAllBanIds(guild);
      log('DESBANIR_INICIO', { guild: guild.id, by: message.author.id, total: ids.length });
      result = await unbanIds(guild, ids, {
        reason: `Desbanimento em massa solicitado por ${message.author.id}`,
        log, isBlacklisted,
      });
      log('DESBANIR_FIM', { guild: guild.id, by: message.author.id, ...result });
      await send(message, !ids.length ? 'não há pessoas banidas neste servidor.' : [
        '**Desbanimento finalizado neste servidor.**',
        `Desbanidos: **${result.removed}** • Já estavam desbanidos: **${result.alreadyRemoved}**`,
        `Falhas: **${result.failed}** • Não processados: **${result.pending}** • Total listado: **${result.total}**`,
        result.blacklisted ? `⚠️ **${result.blacklisted}** dos desbanidos continuam na blacklist e podem ser banidos novamente ao entrar.` : '',
        result.failed || result.pending ? 'Confira as permissões e os logs. Você pode executar o comando novamente para tentar os restantes.' : '',
      ].filter(Boolean).join('\n'));
    } catch (error) {
      onError(error);
      await send(message, result
        ? `a operação terminou, mas houve erro ao enviar o resumo. Desbanidos: ${result.removed}; falhas: ${result.failed}; não processados: ${result.pending}. Confira os logs.`
        : 'não consegui concluir o desbanimento. confira minha permissão **Banir membros** e os logs antes de tentar novamente.').catch(onError);
    } finally {
      running.delete(guild.id);
    }
    return true;
  };
}
module.exports = { fetchAllBanIds, unbanIds, createUnbanAllCommand };
