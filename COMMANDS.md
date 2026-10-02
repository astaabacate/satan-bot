# Comandos do Satan (apenas essenciais)

Só o dono (`OWNER_ID`) pode usar. Todos os outros comandos foram removidos.

## Lista

```text
.nuke on / off       # arma/desarma o nuke automático (1h)
.nuke agora          # limpa agora (calls + confessionário)
.cl [qtd]            # apaga mensagens (padrão 10, max 500)
.bump                # painel de quem o lembrete marca
.fig                 # fabrica de figurinhas
.bloquear            # painel único em Components V2 para palavras bloqueadas
.antiflood           # o que o anti-flood fez (detecções, apagadas, castigos, falhas)
.logs on / off / teste   # liga/desliga/testa logs
.menu                # mostra este menu resumido
```

## Anti-flood individual (por pessoa) — só apaga, sem castigo

Quem repete a **mesma mensagem** cai sozinho, sem precisar de mais ninguém:

- **2ª cópia em até 5 min** → apaga essa, as anteriores e o backlog do autor
  (até 10 min de cópias; pega até o que passou antes de um restart)
- da 2ª em diante é sempre apagar. **Não existe mais castigo/timeout** (1h, 2h...)
- rajada (6+ msgs em 6s), chuva de emoji e msg curtinha seguem como anti-spam, também só apagando
- **sem regra "de várias contas"**: cada conta é tratada individualmente

O contador fica em `antiflood_state.json` (versionado no repo), então religar o
bot **não zera** mais a conta de quem estava floodando. Tudo que o anti-flood faz
fica registrado ali — dá pra conferir pelo `.antiflood` ou olhando o arquivo no
GitHub, mesmo com `.logs off`.

## .bloquear — painel único (o ÚNICO filtro de conteúdo)

Antes existiam `.bloquear`, `.desbloquear`, `.bloqueios`. Agora é um único painel:

- **`.bloquear`** abre um painel Components V2 com:
  - Total de palavras e preview das 15 primeiras
  - Botões: **Adicionar**, **Remover**, **Listar tudo**, **Testar frase**, **Atualizar**, **Fechar**
  - **Adicionar/Remover/Testar** abrem modais (sem digitar no chat)
  - Ação: apaga a mensagem que casa com a formação e registra (sem mute/ban/castigo)

## Palavras bloqueadas — casamento por FORMAÇÃO

O termo é o **começo da palavra**, e o bot pega as variações que o povo usa pra
fugir do filtro:

| bloqueio | apaga | não apaga |
|---|---|---|
| `estu` | estupro, estuprar, stupro, **st**, stu | — (cuidado: `estudo`/`estudante` também caem) |
| `estupr` | estupro, stupro, estuprando | estudo, estudar |
| `est` | estupro, stupro, st | **tu**, teste |
| `molest` | molestar, molestei, molestando, molestaram | — |
| `pedo` | pedofilo, pedofilia | pedido |
| `cu` | cu, cuuu, c.u, CÚ | inculo, cuidado |
| `vai se fuder` | vai se fuder, vai se fu-der | vai ser fuder |

- Regras: casa no começo da palavra (formação), aceita pontuação/efeito de teclado
  no meio (`s.t.u`) e letra esticada no fim (`estuuupro`); a versão sem a vogal
  inicial também vale (`estu` → `stu`); abreviações da forma sem vogal (`st`, `stu`)
  valem como palavra inteira; termo de 2 letras (`cu`, `cp`) só casa palavra inteira.
- **Atenção:** formação é literal — `estu` apaga também estudo/estudante/estúpido.
  Pra pegar só o crime, use `estupr`.
- Até 300 palavras, 60 caracteres cada
- Fica em `blacklist_palavras.json`, sincronizado no repo

## Purga retroativa da lista

Quando o bot liga, ele varre o histórico dos canais e apaga **o que já estava lá**
e casa com a lista do dono (não só o que chega depois):

- até 5.000 mensagens por canal a cada rodada; continua de onde parou na próxima
- roda no máximo 1x por hora — e na hora, de novo, se a lista mudou
- pula o dono, bots e as mensagens dos próprios painéis/logs do bot
- o que foi apagado fica no `.antiflood` e no `antiflood_state.json`

## Filtros de conteúdo — só o bloqueio do dono

- O filtro automático de conteúdo (`scripts/filtro-denuncia.js`) **não está mais
  ligado**: o dono removeu em 02/10. O arquivo fica no repo e continua exportando
  o `normalizar` usado pela lista.
- Também foram removidos, a pedido do dono: textão (>300), link/convite e link de
  CDN, repetição interna na mensagem, asterisco, mensagem começando com `#` e
  mensagem invisível — nada disso é mais filtrado por código.
- O único filtro de conteúdo é a lista do `.bloquear`. O que sobra é **anti-flood**
  (comportamento: repetir, floodar, encher de emoji/msg curta) e mesmo ele só apaga.

## Removidos

- `.desbanir todos`
- `.restaurar` / `.restaurar voz`
- `.call limite`
- `.snapshot agora`
- `.att`
- `.recriar`
- `.desbloquear` / `.bloqueios` (agora dentro do painel `.bloquear`)
- **castigo/timeout do anti-flood** (1h, 2h, 3h...) — agora só apaga
