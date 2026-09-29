# Comandos de moderação

## Desbanir todos

No servidor desejado, o dono configurado no bot pode enviar:

```text
.desbanir todos
```

O bot pede confirmação. No mesmo canal, em até 60 segundos, envie:

```text
.desbanir todos confirmar
```

Para cancelar a confirmação antes de começar: `.desbanir cancelar`.
Não é um comando para interromper uma operação já iniciada.

- Requer **Banir membros** para o bot.
- Só altera os banimentos do servidor onde o comando foi enviado.
- Lista todos os bans com paginação, inclusive mais de 1.000, antes de remover.
- Processa um por vez e mostra totais de sucesso, falhas e não processados.
- Não adiciona os usuários de volta ao servidor: eles precisam entrar novamente.
- **Não remove ninguém da blacklist automática.** Quem continuar nela pode ser
  banido novamente ao entrar. O aviso aparece antes da confirmação e no resumo.
- Só uma operação por servidor neste processo. Se o bot reiniciar, a confirmação
  pendente é descartada. Se a operação for interrompida, execute novamente para
  processar os banimentos restantes.
- O comando também aparece em `.menu`.

## Instalação

Publicar `bot.js` junto com `scripts/unban-all.js` e reiniciar o bot para ativar.
Não atualizar apenas `bot.js` pelo `.att`: ele depende do novo módulo.
Nenhum banimento real é removido pela instalação ou pelos testes.

## Palavras bloqueadas (`.bloquear`)

Só o dono usa. É a lista **dele**, mexida na hora — diferente do filtro de
denúncia, que é código (conteúdo que derruba o servidor e que não se desliga por
engano).

```text
.bloquear cu, bosta, vai se fuder   # bloqueia (vírgula, pipe ou quebra separam)
.desbloquear cu, bosta              # desbloqueia
.bloqueios                          # lista, com quantas vezes cada uma pegou
.bloqueios fala cu                  # testa se a frase cairia em alguma palavra
```

- **Ação: apaga a mensagem e registra no canal de logs.** Sem mute, sem timeout e
  sem ban — igual ao filtro de denúncia.
- O dono é imune (precisa conseguir digitar a palavra para bloquear/desbloquear).
- Casa **palavra inteira**: bloquear `cu` pega “cuuu” e “c.u” (letra esticada e
  pontuação no meio), mas não derruba “inculo”. Sufixo precisa de termo novo:
  `puta` não pega “putaria”.
- Acentos, caixa e leet (`b0sta`) dão na mesma — usa a mesma normalização do filtro.
- Até 300 palavras, 60 caracteres cada.
- A lista fica em `blacklist_palavras.json`, sincronizado no repositório: o runner
  do GitHub Actions é descartável, e é isso que faz a lista sobreviver ao restart.

Para ativar: publicar `bot.js` junto com `scripts/blacklist-palavras.js` na
versão de produção e reiniciar. Alterações só na branch de trabalho não ativam.

## Filtro de proteção infantil

O filtro textual inclui `CP`, `CSAM`, `CSEM` e termos relacionados em português
 e inglês. As siglas são verificadas como palavras separadas, com tolerância a
espaços, pontuação e caracteres invisíveis, sem bloquear `CPF`, `TCP` ou `SCP`.
`CP` é bloqueado independentemente do contexto (inclusive jogos). Termos dessa
categoria não recebem exceção por conterem “brincadeira” ou “zoeira”.

A ação para qualquer categoria, inclusive `menor-sexual`/`CP`: tentativa de apagar
a mensagem e aviso ao dono, **sem mute/timeout/ban**. O filtro não analisa imagens/vídeos, não distingue
conversas educativas de outras menções e não garante detectar toda variação.
A imunidade do dono existente no bot não foi alterada. Cobertura e limitações detalhadas em `FILTER_COVERAGE.md`.

Para ativar: publicar `bot.js` junto com `scripts/filtro-denuncia.js` na versão de produção e
reiniciar o bot. Alterações apenas na branch de trabalho não ativam o filtro.
