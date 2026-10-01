// Executado em OUTRO runner: o runner do bot pode morrer sem rodar finally/always().
const fs = require('fs');
const path = require('path');

const MINUTE = 60_000;
const START_GRACE = 15 * MINUTE;
const DISPATCH_COOLDOWN = 5 * MINUTE;
const JOB_LIMIT = 360 * MINUTE;
const WORKFLOW_SATAN = path.join(__dirname, '..', '.github', 'workflows', 'satan.yml');

// Incidente de 01/10/2026: o passo do workflow foi renomeado (saiu o ".att",
// commit 7b870fa) e este arquivo continuou procurando o nome ANTIGO. O watchdog
// nunca mais reconheceu um bot vivo: a cada verificação concluía "nenhuma
// execução utilizável" e despachava um substituto — e, na troca de guarda, os
// dois runs se cancelavam. Por isso o nome do passo NÃO é mais uma string fixa
// aqui: ele é lido do próprio workflow, que é a fonte única da verdade.
const PASSO_BOT_PADRAO = 'bot (loop infinito)';

const INDENTACAO = (linha) => linha.match(/^ */)[0].length;
const EH_COMENTARIO = (linha) => linha.trim().startsWith('#');

// Passos do job "bot" que executam shell (têm "run:"). O do bot é o ÚLTIMO deles:
// os anteriores (checkout/setup-node/conferência de token) terminam em segundos.
function passosComRun(yaml) {
  const linhas = String(yaml || '').split(/\r?\n/).filter((l) => !EH_COMENTARIO(l));
  const inicio = (de, re, maxIndent) => {
    for (let i = de; i < linhas.length; i += 1) {
      const l = linhas[i];
      if (!l.trim()) continue;
      if (INDENTACAO(l) <= maxIndent && i > de) return -1;
      if (re.test(l)) return i;
    }
    return -1;
  };
  const fimDoBloco = (de, maxIndent) => {
    for (let i = de + 1; i < linhas.length; i += 1) {
      const l = linhas[i];
      if (!l.trim()) continue;
      if (INDENTACAO(l) <= maxIndent) return i;
    }
    return linhas.length;
  };
  const jobs = inicio(0, /^jobs:\s*$/, -1);
  if (jobs < 0) return [];
  const job = inicio(jobs + 1, /^\s*bot:\s*$/, 0);
  if (job < 0) return [];
  const steps = inicio(job + 1, /^\s*steps:\s*$/, INDENTACAO(linhas[job]));
  if (steps < 0) return [];
  const indentStep = INDENTACAO(linhas[steps]) + 2;
  const limite = fimDoBloco(steps, INDENTACAO(linhas[steps]));
  const passos = [];
  let atual = null;
  for (let i = steps + 1; i < limite; i += 1) {
    const l = linhas[i];
    if (!l.trim()) continue;
    if (INDENTACAO(l) === indentStep && l.trim().startsWith('- ')) {
      atual = { name: null, hasRun: false };
      passos.push(atual);
    }
    if (!atual) continue;
    const nome = l.match(/^\s*-?\s*name:\s*(.+?)\s*$/);
    if (nome && atual.name === null) atual.name = nome[1].replace(/^['"]|['"]$/g, '');
    if (/^\s*(-\s*)?run:\s*[|>]?/.test(l)) atual.hasRun = true;
  }
  return passos;
}

// Nome do passo em que o bot roda, lido do workflow; se o arquivo sumir/mudar de
// forma, cai no padrão conhecido (e o guarda anti-zumbi abaixo continua valendo).
function passoDoBot(yaml = lerWorkflow()) {
  const comRun = passosComRun(yaml).filter((p) => p.hasRun && p.name);
  return (comRun[comRun.length - 1] || {}).name || PASSO_BOT_PADRAO;
}

function lerWorkflow(arquivo = WORKFLOW_SATAN) {
  try {
    return fs.readFileSync(arquivo, 'utf8');
  } catch {
    return '';
  }
}

const BOT_STEP = passoDoBot();

function runIsUsable(run, jobs, now, passo = BOT_STEP) {
  const age = now - Date.parse(run.created_at);
  if (['queued', 'requested', 'waiting', 'pending'].includes(run.status)) {
    return age < START_GRACE;
  }
  if (run.status !== 'in_progress') return false;
  return jobs.some((job) => {
    if (job.name !== 'bot') return false;
    if (job.status === 'queued') return age < START_GRACE;
    if (job.status !== 'in_progress') return false;
    const started = Date.parse(job.started_at || run.created_at);
    if (now - started >= JOB_LIMIT) return false;
    const passos = job.steps || [];
    // Execução fantasma (incidentes de 26/09 e de 01/10): run e job continuam
    // "in_progress" na API, mas TODAS as etapas já terminaram — o GitHub não
    // fechou o job depois do cancelamento. Não depende do nome do passo: se nada
    // está rodando, não existe bot vivo.
    if (passos.length && !passos.some((s) => s.status !== 'completed')) return false;
    const step = passos.find((s) => s.name === passo);
    // O incidente de 26/09: run in_progress, mas esta etapa já terminou com failure.
    if (step?.status === 'completed') return false;
    if (step?.status === 'in_progress') return true;
    return age < START_GRACE;
  });
}

// Frase curta para o dono entender o que a API mostrou (vai na anotação do run).
function motivoIndisponivel(run, jobs, passo = BOT_STEP) {
  if (!run) return 'nenhuma execucao do workflow satan em main';
  if (run.status !== 'in_progress') return `run ${run.id} ${run.status}${run.conclusion ? `/${run.conclusion}` : ''}`;
  const job = (jobs || []).find((j) => j.name === 'bot');
  if (!job) return `run ${run.id} in_progress sem job "bot"`;
  if (job.status !== 'in_progress') return `run ${run.id}: job "bot" ${job.status}${job.conclusion ? `/${job.conclusion}` : ''}`;
  const passos = job.steps || [];
  if (passos.length && !passos.some((s) => s.status !== 'completed')) {
    return `run ${run.id}: execucao fantasma - job "bot" in_progress com todas as etapas finalizadas (a ultima, "${passos[passos.length - 1].name}", ${passos[passos.length - 1].conclusion || 'sem conclusao'})`;
  }
  const step = passos.find((s) => s.name === passo);
  if (step?.status === 'completed') return `run ${run.id}: etapa do bot terminou (${step.conclusion}) e o run continuou in_progress`;
  return `run ${run.id}: etapa "${passo}" nao esta em andamento (job com ${passos.length} etapas)`;
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

async function checkBot(api, now = Date.now(), { passo = BOT_STEP } = {}) {
  const data = await api('GET', '/actions/workflows/satan.yml/runs?branch=main&per_page=100');
  const runs = data.workflow_runs.filter((r) => r.head_branch === 'main');
  let ultimoMotivo = null;
  for (const run of runs) {
    if (run.status === 'completed') continue;
    const jobs = run.status === 'in_progress'
      ? (await api('GET', `/actions/runs/${run.id}/jobs?per_page=100`)).jobs : [];
    if (runIsUsable(run, jobs, now, passo)) return 'execucao ativa ou iniciando';
    if (!ultimoMotivo) ultimoMotivo = motivoIndisponivel(run, jobs, passo);
  }
  // Impede tempestade de reinicios em falhas de token/dependencias/infraestrutura.
  if (runs.some((r) => now - Date.parse(r.created_at) < DISPATCH_COOLDOWN)) {
    return 'aguardando intervalo minimo entre tentativas';
  }
  // Nao cancela o antigo: o bot novo faz isso somente depois de conectar ao Discord.
  await api('POST', '/actions/workflows/satan.yml/dispatches', { ref: 'main' });
  return `nenhuma execucao utilizavel: reinicio solicitado (${ultimoMotivo || motivoIndisponivel(null)})`;
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
  console.log(`[watchdog] passo do bot esperado: "${BOT_STEP}" (lido de .github/workflows/satan.yml)`);
  const resultado = await checkBot(api);
  console.log(`[watchdog] ${resultado}`);
  // Bot morto não pode passar em silêncio: foi assim em 01/10 (run fantasma +
  // cron atrasado = horas sem moderação e nada vermelho no Actions para avisar).
  if (resultado.startsWith('nenhuma execucao utilizavel')) {
    console.log(`::error title=bot fora do ar::${resultado}. Um substituto foi solicitado agora e deve ficar online em ~1 minuto. Se isto se repetir, veja RECOVERY.md (troca de guarda / runs fantasma).`);
    process.exitCode = 1;
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = {
  runIsUsable, checkBot, tokenDiscordValido, motivoIndisponivel,
  passoDoBot, passosComRun, lerWorkflow,
  BOT_STEP, PASSO_BOT_PADRAO, WORKFLOW_SATAN,
};
