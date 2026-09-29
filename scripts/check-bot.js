// Executado em OUTRO runner: o runner do bot pode morrer sem rodar finally/always().
const MINUTE = 60_000;
const START_GRACE = 15 * MINUTE;
const DISPATCH_COOLDOWN = 5 * MINUTE;
const JOB_LIMIT = 360 * MINUTE;
const BOT_STEP = 'bot (loop infinito; .att reinicia com o codigo novo)';

function runIsUsable(run, jobs, now) {
  const age = now - Date.parse(run.created_at);
  if (['queued', 'requested', 'waiting', 'pending'].includes(run.status)) {
    return age < START_GRACE;
  }
  if (run.status !== 'in_progress') return false;
  return jobs.some(job => {
    if (job.name !== 'bot') return false;
    if (job.status === 'queued') return age < START_GRACE;
    if (job.status !== 'in_progress') return false;
    const started = Date.parse(job.started_at || run.created_at);
    if (now - started >= JOB_LIMIT) return false;
    const step = (job.steps || []).find(s => s.name === BOT_STEP);
    // O incidente de 26/09: run in_progress, mas esta etapa já terminou com failure.
    if (step?.status === 'completed') return false;
    if (step?.status === 'in_progress') return true;
    return age < START_GRACE;
  });
}

const DISCORD_ME = 'https://discord.com/api/v10/users/@me';

// Token morto nao se conserta com restart (incidente de 29/09/2026: o secret
// ficou com um token resetado e o watchdog disparava substituto para sempre).
// Falha de consulta (rede, DNS, 429, 5xx) NAO conta como token invalido: so
// 401/403 dizem "o token nao vale mais".
async function tokenDiscordValido(token, fetchImpl = fetch) {
  if (!token) return false;
  try {
    const resposta = await fetchImpl(DISCORD_ME, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    return resposta.status !== 401 && resposta.status !== 403;
  } catch {
    return true;
  }
}

async function checkBot(api, now = Date.now()) {
  const data = await api('GET', '/actions/workflows/satan.yml/runs?branch=main&per_page=100');
  const runs = data.workflow_runs.filter(r => r.head_branch === 'main');
  for (const run of runs) {
    if (run.status === 'completed') continue;
    const jobs = run.status === 'in_progress'
      ? (await api('GET', `/actions/runs/${run.id}/jobs?per_page=100`)).jobs : [];
    if (runIsUsable(run, jobs, now)) return 'execucao ativa ou iniciando';
  }
  // Impede tempestade de reinicios em falhas de token/dependencias/infraestrutura.
  if (runs.some(r => now - Date.parse(r.created_at) < DISPATCH_COOLDOWN)) {
    return 'aguardando intervalo minimo entre tentativas';
  }
  // Nao cancela o antigo: o bot novo faz isso somente depois de conectar ao Discord.
  await api('POST', '/actions/workflows/satan.yml/dispatches', { ref: 'main' });
  return 'nenhuma execucao utilizavel: reinicio solicitado';
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY e GITHUB_TOKEN obrigatorios');
  const api = async (method, endpoint, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    // Falha de consulta nao equivale a "nenhum bot vivo".
    if (!response.ok) throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  if (!(await tokenDiscordValido(process.env.DISCORD_TOKEN))) {
    console.log('[watchdog] DISCORD_TOKEN invalido (HTTP 401/403): nao vou religar o bot — troque o secret em Settings > Secrets and variables > Actions > DISCORD_TOKEN com o token atual do Developer Portal e rode o workflow satan de novo.');
    return;
  }
  console.log(`[watchdog] ${await checkBot(api)}`);
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = { runIsUsable, checkBot, tokenDiscordValido, BOT_STEP };
