# Recuperação do bot

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
existir canal `inferno` entre os irmãos, nada é mexido. Vale para o nuke, para o
`.recriar` (`scripts/setup-servidor.js`) e para cada boot do bot (senão o conserto
só apareceria no nuke seguinte, até 1h depois do deploy). O resultado aparece em
`nuke_log.json` (campo `ordem`) e a regressão está em `test/channel-order.test.js`.

## Canais que somem: como restaurar (`.restaurar`)

Em 29/09 os canais de voz do servidor oficial sumiram, sobrando 2. **Nenhum
código do bot apaga canal de voz**: a única linha que apaga canal é o
`f.delete()` do confessionário no nuke. Os caminhos que apagam em massa são:

- `.recriar limpo` / `.recriar refazer` — apaga tudo cujo **nome** não está em
  `server_blueprint.json` (os 9 nomes de voz estão lá; cairiam fora as
  categorias `・`, `inferno`, `rules`, `logs` e `moderator-only`).
- Alguém com **Gerenciar canais** apagando na mão.

Para voltar o que sumiu (sem apagar nada do que ficou):

```text
.restaurar          # recria tudo que está no backup e não existe mais
.restaurar voz      # só os canais de voz
.restaurar de backups/server_snapshot-2026-09-29T1130Z.json   # backup específico
```

O restore (`scripts/restaurar-canais.js`) cria **só** o que falta, dentro da
categoria original, com as permissões/overwrites do backup, e devolve a ordem
original da categoria. Não cria cargo (o servidor é o mesmo: os ids das
overwrites continuam valendo) e não apaga nada.

O backup é o `server_snapshot.json`, que o bot reescreve sozinho a cada mudança
de estrutura. Cópia com data em `backups/` serve de segurança.

Limite de pessoas por call (o restore copia o `userLimit` do backup; `0` =
sem limite):

```text
.call limite 99                             # todas as calls
.call limite 99 gf caos                     # só essas duas
.call limite gf=2 caos=10 purgatorio=99     # cada call com o seu
.call limite 0                              # volta pro sem limite
```

O valor fica gravado no backup, então o próximo `.restaurar` já traz o limite
certo. Vale também pôr o `userLimit` nos canais de voz do
`server_blueprint.json` se quiser que o `.recriar` já nasça com ele (o blueprint
da reconstrução de 28/09 não tinha esse campo — foi por isso que as calls
voltaram sem limite naquela rebuild).

Proteção nova: `salvarSnapshot` **recusa** sobrescrever o backup quando o novo
snapshot tem **menos** canais que o salvo (`SNAPSHOT_RECUSADO` no log). Sem isso,
o boot seguinte ao incidente jogaria fora justamente o backup que permite
restaurar. Se você apagou canais de propósito e quer atualizar o backup:
`.snapshot agora`.

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
- Etapa `bot (loop infinito; .att reinicia com o codigo novo)` terminada em
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
  Uma etapa do bot já finalizada não bloqueia a recuperação.
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
