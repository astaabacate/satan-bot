# Recuperação do bot

## Incidente de 01/10/2026 (watchdog cego + execução fantasma — horas sem bot)

O bot parou de responder e nada apareceu vermelho no Actions. Duas falhas
separadas se somaram:

**1. O watchdog não reconhecia mais um bot vivo (causa de fundo, desde 29/09).**
O commit `7b870fa` (PR #25, "limpeza") removeu o `.att` e renomeou a etapa do
workflow de `bot (loop infinito; .att reinicia com o codigo novo)` para
`bot (loop infinito)`. `scripts/check-bot.js` continuou procurando o nome antigo
numa string fixa. Como a etapa nunca era encontrada, a prova de vida caía na
tolerância de 15 minutos: **toda** verificação concluía "nenhuma execução
utilizável" e despachava um substituto. O padrão ficou registrado nos runs — os
últimos cinco disparos do watchdog foram seguidos, 10 a 15 segundos depois, por
um `satan` `workflow_dispatch` (ator `github-actions[bot]`), e praticamente todos
os runs terminaram `cancelled`: era a troca de guarda derrubando o bot que estava
no ar. Os testes não pegaram porque `test/recovery.test.js` montava o job falso
com o `BOT_STEP` importado do próprio módulo — autoconsistente, nunca comparado
com o workflow de verdade.

**2. Run fantasma + cron atrasado (a queda em si).** O run `36792298498`
(schedule, criado em 30/09 23:40:31Z, commit `2cb1f2a`) rodou o bot por 2h18m —
há commits de estado no `main` até 01:58:44Z — e teve a etapa `bot (loop
infinito)` **cancelada em 01/10 01:58:54Z**. O GitHub não fechou o job:
`completed_at` nulo, conclusão nula, etapas de limpeza executadas, run e job
ainda `in_progress` na API. É a mesma forma do incidente de 26/09. Quem mandou
cancelar não ficou provado (as anotações só existem depois que o job é fechado e
o log não pôde ser baixado); não foi a troca de guarda do próprio bot, que só
cancela runs de id **menor** e não havia run mais novo. A partir daí nada religou:
o cron do watchdog (`7,17,27,37,47,57 * * * *`) não disparou nenhuma vez entre
23:39:24Z e 02:25Z, e o cron do `satan` (`5 */5 * * *`) só voltaria por volta de
05:05Z. Cron do GitHub atrasa horas em período de carga — já estava escrito no
fim deste arquivo, e foi o que transformou uma queda em horas de silêncio.

Correções:

- `scripts/check-bot.js` **lê o nome da etapa do próprio
  `.github/workflows/satan.yml`** (o último passo com `run:` do job `bot`) em vez
  de usar string fixa. Renomear a etapa não cega mais o watchdog; se o arquivo
  não puder ser lido, cai no padrão `bot (loop infinito)`.
- Guarda anti-fantasma independente de nome: job `in_progress` com **todas** as
  etapas já finalizadas = nada está rodando = não é bot vivo. (Job recém-iniciado,
  sem etapas reportadas, continua com a tolerância de 15 minutos.)
- Bot morto agora **falha visível**: o watchdog imprime `::error title=bot fora do
  ar::…` com o que a API mostrou e termina com código 1, em vez de só escrever uma
  linha no log e aparecer como `success`. O substituto continua sendo pedido antes.
- `test/recovery.test.js` lê o workflow de verdade: confere que a etapa existe no
  YAML, que um rename volta a ser acompanhado e que a execução fantasma (forma
  exata do run `36792298498`) não passa por bot vivo.

Procedimento quando o bot sumir e o Actions não mostrar nada:

1. **Actions → satan → Run workflow → main** (é o que o watchdog faria).
2. Se aparecer um run `in_progress` com todas as etapas fechadas, ele é fantasma:
   pode cancelar na mão ou deixar — o bot novo cancela runs antigos depois do
   `READY` (`TROCA_DE_GUARDA` no log).
3. Conferir `[READY]` no log do run novo e testar um comando no Discord.

## Incidente de 29/09/2026 (token do secret inválido — bot mudo)

Entre ~23:45 UTC de 28/09 e 01:47 UTC de 29/09 o nuke horário passou a falhar
com `Expected token to be set for this request, but none was present` (visível no
`nuke_log.json` versionado): o processo estava vivo, mas sem token no REST.
O `DISCORD_TOKEN` do secret respondia **HTTP 401** — o token foi resetado no
Developer Portal (Reset Token invalida o anterior) e o secret continuou com o
valor antigo. Nenhum comando respondia porque não havia login nenhum.

Por que ninguém foi avisado (o problema de verdade):

- O passo do workflow é um `while true` que religa o bot a cada 10s. Com token
  morto, ele fica nesse laço para sempre e o passo continua `in_progress`.
- `scripts/check-bot.js` usa o status do passo como prova de vida: passo
  `in_progress` = "execução ativa" = não dispara recuperação e não avisa ninguém.
- O laço de reinício também pode virar zumbi: processo vivo com os intervalos
  rodando e sem token (`client.destroy()`, chamado no caminho de falha do
  `login`, zera o token do REST) — on-line no Actions, mudo no Discord.

Correções: o workflow confere o token **antes** de subir o bot e falha em
segundos com a causa escrita (`::error`); `scripts/login-guard.js` reconhece
erro de autenticação e o bot sai com código 78 (o laço para e o run falha, em vez
de tentar para sempre) e põe teto de tempo no login (processo não vira zumbi);
o laço também para depois de 5 falhas rápidas seguidas; o watchdog consulta o
token no Discord e **não** dispara substituto quando é 401/403 (o problema é o
secret, não o runner).

Procedimento quando o Actions mostrar `DISCORD_TOKEN inválido`:

1. Abra `https://discord.com/developers/applications` → seu app → **Bot**.
2. Se o token atual não estiver à mão, **Reset Token** e copie o novo.
3. No GitHub: **Settings → Secrets and variables → Actions → DISCORD_TOKEN → Update
   secret**, cole e salve.
4. **Actions → satan → Run workflow → main** (ou dê push no main). Confirmar
   `[READY]` no log e testar um comando no Discord.
5. Nunca colar o token no código, em issue, em chat ou em arquivo do repositório
   (ele é público): só no secret. Token que vazou deve ser resetado.

## Correção de 29/09/2026 (confessionario renascia em cima do inferno)

A cada nuke horário o ・confessionario voltava **acima** do canal `inferno`. A
ordem certa é inferno em primeiro, confessionario em segundo.

Causa: o nuke apaga o canal e recria passando `position: f.position`. Só que
`f.position` é o índice **calculado pelo discord.js** dentro da categoria (0, 1,
2...), não a posição bruta que o Discord usa para ordenar. O Discord não renumera
as posições quando um canal é apagado — sobram buracos (ex.: 0, 5, 7, 8) — então
um índice pequeno nasce antes de todo mundo.

Correção (`scripts/channel-order.js`): depois de criar o canal, a ordem é
aplicada de forma explícita — **inferno primeiro, confessionario logo abaixo,
resto como estava** — com um único PATCH reindexando os irmãos (0..n-1). Se não
existir canal `inferno` entre os irmãos, nada é mexido. Vale para o nuke e para
cada boot do bot (senão o conserto só apareceria no nuke seguinte, até 1h depois
do deploy). O resultado aparece em `nuke_log.json` (campo `ordem`) e a regressão
está em `test/channel-order.test.js`.

## Canais que somem: backup e restauração

Em 29/09 os canais de voz do servidor oficial sumiram, sobrando 2. **Nenhum
código do bot apaga canal de voz**: a única linha que apaga canal é o
`f.delete()` do confessionário no nuke.

Os comandos antigos de restauração (`.restaurar`, `.restaurar voz`, `.recriar`,
`.call limite`, `.snapshot agora`) foram **removidos** na limpeza de 29/09 —
agora o bot mantém apenas os essenciais:

```text
.nuke on / off
.nuke agora
.cl [qtd]
.bump
.fig
.bloquear (painel único)
.logs on/off/teste
.menu
```

O backup continua existindo: `server_snapshot.json` no repo, reescrito a cada
mudança de estrutura, com cópias em `backups/`. A proteção de não sobrescrever
um backup bom por um menor (`SNAPSHOT_RECUSADO`) continua ativa. Para restaurar
canais manualmente, use o `server_snapshot.json` ou `server_blueprint.json`
diretamente, ou recrie pelo Discord — os comandos automáticos de restore foram
removidos para simplificar o bot.

## Incidente de 27/09/2026 (spam não apagado)

Em 27/09 entre 19:27–19:29 BRT houve flood no ・confessionario (mesma mensagem
repetida + chuva de emojis). O bot estava no servidor e online (o nuke recriou o
canal às 19:23 e o castigo de chuva de emojis disparou às 19:27:40 — visível no
mute_state.json), mas nenhuma mensagem foi apagada. Causas encadeadas:

- O nuke recria o confessionario a cada 1h. O código antigo calculava as
  permissões do canal (`over`) e nunca as passava pro `channels.create` — o
  canal renascia SEM permissões. Sem **Gerenciar Mensagens** lá, todo delete do
  anti-flood falhava em silêncio.
- As regras de castigo (chuva de emojis, repetir 10+ vezes, chuva de links)
  aplicavam timeout mas não apagavam as mensagens.
- Falha de delete e ações do anti-flood iam só pro console do runner: o canal de
  logs nunca mostrava o bot agindo.

Correções: recriação copia as permissões originais + auto-reparo (o bot garante
as próprias permissões no canal novo e avisa o dono se algo faltar); castigo
também apaga; chuva de emojis conta por janela de 60s (texto no meio não zera);
5 cópias do mesmo conteúdo em 2,5min cai mesmo espaçadas; ações do anti-flood
aparecem no canal de logs e falhas de permissão chegam na DM do dono.

## Incidente de 26/09/2026

Na execução `36200231878`, a API do GitHub informou:

- Job iniciado em 25/09 às 23:14:45 UTC.
- Etapa `bot (loop infinito)` terminada em
  26/09 às 04:11:07 UTC (01:11:07 em Pernambuco), com `failure`.
- Etapa de recuperação e etapas de limpeza marcadas como `skipped`.
- Execução/job ainda marcados como `in_progress` na consulta às 04:32 UTC.

O log completo não pôde ser baixado. Não está comprovado o motivo inicial
(falha do runner, infraestrutura, etc.). Não foi o teto configurado de seis
horas: a etapa terminou depois de aproximadamente 4h56.

O defeito de recuperação é verificável: `always()` não garante execução quando
o runner deixa de executar etapas. Além disso, contar apenas runs `in_progress`
confunde uma execução fantasma com um bot vivo.

## Proteções

- `watchdog.yml` verifica a cada dez minutos, em outro runner, e também após
  conclusão com falha/timeout do workflow `satan`.
- `scripts/check-bot.js` consulta jobs/etapas, não só status da execução.
  Uma etapa do bot já finalizada não bloqueia a recuperação. O nome da etapa é
  lido do próprio `satan.yml` (renomear não cega o watchdog) e job `in_progress`
  com todas as etapas finalizadas é tratado como execução fantasma.
- Quando não existe bot vivo, o watchdog pede o substituto **e falha** (`::error`
  + código 1): queda aparece vermelha no Actions e na notificação, em vez de
  passar como `success` no log.
- Inicialização/fila tem tolerância de 15 minutos. Pedidos de recuperação têm
  intervalo mínimo de cinco minutos. Erros de API falham visivelmente, em vez
  de serem interpretados como ausência de bot.
- O substituto cancela runs antigos de produção somente após conectar ao Discord.
- Se Discord permanecer desconectado por dois minutos, o processo termina e o
  loop reinicia. A biblioteca tem tempo de reconectar antes disso.
- Renovação perto do limite de seis horas volta a tentar após cinco minutos se
  o substituto não assumir. Requisições de gerenciamento têm timeout.
- Falhas de instalação não são mais ignoradas. Código de saída e eventos de
  desconexão aparecem no log.
- Antes de subir o bot, o workflow confere o token no Discord (`GET /users/@me`):
  401/403 falha o job em segundos, com a causa e o caminho do secret escritos na
  aba de anotações; erro de rede/instabilidade só gera aviso.
- O laço de reinício para quando o bot sai com o código 78 (token não autentica)
  e depois de cinco falhas rápidas seguidas — falha visível em vez de laço mudo.
- O login tem teto de dois minutos: se nunca resolver, o processo sai em vez de
  ficar vivo com o REST sem token.
- O watchdog consulta o token antes de pedir substituto: com 401/403 ele não
  reinicia (reinício não conserta secret) e diz isso no log.

A verificação externa mede a execução da etapa, não prova respostas aos comandos.
O monitor local cobre perda de conexão; não cobre todo tipo de travamento.
Um passo em `in_progress` pode ser bot mudo em laço de reinício — o token é
conferido no início do run justamente para separar esses casos.
Cron do GitHub pode atrasar, e indisponibilidade geral de Actions, falta de
minutos ou bloqueio da API também impede recuperação. Não é garantia de uptime.
Para serviço 24/7, prefira um host permanente com supervisor e monitor externo.

## Ativação e emergência

1. Integrar esta correção ao `main`. Os workflows de produção só rodam no main;
   salvar na branch de trabalho não instala o watchdog.
2. No GitHub: **Actions → satan → Run workflow → main**.
3. Confirmar `[READY]` no log e testar um comando no Discord. `in_progress`
   sozinho não comprova que o bot conectou.
4. Verificar também **Actions → satan-watchdog**. Ele usa `actions: write` do
   `GITHUB_TOKEN` gerado pelo próprio GitHub, sem token pessoal adicional.
5. Se a integração Arena retornar 403 ao disparar o workflow, reconectar GitHub
   na Arena e verificar as permissões de Actions. A alternativa é disparar pela
   interface do GitHub com uma conta autorizada.

Não há necessidade de compartilhar o token do Discord. O secret existente é
mantido. Durante esta investigação, a tentativa de restart pela integração
retornou 403; não houve confirmação de recuperação em produção.

## Testes

`npm test` executa testes locais sem Discord, rede ou secrets. Inclui a regressão
do run fantasma, filas travadas, tolerância de boot, limitação de reinícios,
erros de API, reconexão do Discord, classificação de erro de autenticação
(`test/login-guard.test.js`) e a consulta de token do watchdog. `node --check bot.js`
valida sintaxe.
