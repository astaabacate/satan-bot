// Protecoes contra o incidente de 29/09/2026 (token do secret invalido).
//
// O que aconteceu: o DISCORD_TOKEN do secret foi resetado no Developer Portal e
// ficou invalido (HTTP 401). O bot nao autenticava, mas ninguem via: o passo do
// workflow continuava "in_progress" para sempre, o watchdog olhava o status do
// passo, concluia "execucao ativa" e nao avisava ninguem. Pior: houve processo
// vivo com os intervalos rodando e o REST SEM token ("Expected token to be set
// for this request, but none was present") — on-line no Actions, mudo no Discord.
//
// Aqui ficam as duas travas: (1) reconhecer erro de autenticacao e sair com
// codigo proprio em vez de religar para sempre; (2) estourar por tempo se o
// login nunca resolver, em vez de virar zumbi.

const CODIGO_TOKEN_INVALIDO = 78; // token morto: o workflow para e mostra o erro
const CODIGO_LOGIN_TRAVADO = 76;  // login nao resolveu: vale religar
const TIMEOUT_CODE = 'LOGIN_TIMEOUT';

class LoginTimeoutError extends Error {
  constructor(ms) {
    super(`login nao resolveu em ${Math.round(ms / 1000)}s (cliente travado)`);
    this.name = 'LoginTimeoutError';
    this.code = TIMEOUT_CODE;
  }
}

// Erro que diz "o token nao vale mais": nao adianta religar, tem que trocar o secret.
function ehErroDeAutenticacao(e) {
  if (!e) return false;
  const codigo = e.code;
  if (codigo === 'TokenInvalid' || codigo === 'DisallowedIntents') return true;
  if (codigo === 401 || codigo === 403) return true;
  if (e.status === 401 || e.status === 403) return true;
  const msg = String((e && e.message) || e);
  return /invalid token|unauthorized|authentication failed|\b401\b|\b403\b/i.test(msg);
}

// Resolve/rejeita com a promessa original, mas rejeita por tempo se ela nao
// resolver (setTimeout/clearTimeout injetaveis para teste).
function corridaComTimeout(promessa, ms, { setTimeout: agendar = setTimeout, clearTimeout: cancelar = clearTimeout } = {}) {
  return new Promise((resolve, reject) => {
    const t = agendar(() => reject(new LoginTimeoutError(ms)), ms);
    Promise.resolve(promessa).then(
      (valor) => { cancelar(t); resolve(valor); },
      (erro) => { cancelar(t); reject(erro); },
    );
  });
}

module.exports = {
  ehErroDeAutenticacao, corridaComTimeout, LoginTimeoutError,
  TIMEOUT_CODE, CODIGO_TOKEN_INVALIDO, CODIGO_LOGIN_TRAVADO,
};
