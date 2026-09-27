# Recuperação do bot

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

A verificação externa mede a execução da etapa, não prova respostas aos comandos.
O monitor local cobre perda de conexão; não cobre todo tipo de travamento.
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
erros de API e reconexão do Discord. `node --check bot.js` valida sintaxe.
