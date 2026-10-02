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

## Anti-flood individual (por pessoa)

Quem repete a **mesma mensagem** leva, sozinho, sem precisar de mais ninguém:

- **2ª cópia em até 5 min** → apaga essa e as anteriores (backlog do autor)
- **3ª cópia em até 5 min** → castigo progressivo (1h, 2h, 3h...) + apaga tudo
- rajada (6+ msgs em 6s) e chuva de emoji/link continuam como antes

O contador fica em `antiflood_state.json` (versionado no repo), então religar o
bot **não zera** mais a conta de quem estava floodando. Tudo que o anti-flood faz
fica registrado ali — dá pra conferir pelo `.antiflood` ou olhando o arquivo no
GitHub, mesmo com `.logs off`.

## .bloquear — painel único

Antes existiam `.bloquear`, `.desbloquear`, `.bloqueios`. Agora é um único painel:

- **`.bloquear`** abre um painel Components V2 com:
  - Total de palavras e preview das 15 primeiras
  - Botões: **Adicionar**, **Remover**, **Listar tudo**, **Testar frase**, **Atualizar**, **Fechar**
  - **Adicionar/Remover/Testar** abrem modais (sem digitar no chat)
  - Ação continua igual: apaga a mensagem que contém a palavra e registra no canal de logs, sem mute/ban

## Palavras bloqueadas — detalhes

- Casa **palavra inteira**: `cu` pega "cuuu" e "c.u", mas não "inculo"
- Até 300 palavras, 60 caracteres cada
- Fica em `blacklist_palavras.json`, sincronizado no repo

## Removidos

- `.desbanir todos`
- `.restaurar` / `.restaurar voz`
- `.call limite`
- `.snapshot agora`
- `.att`
- `.recriar`
- `.desbloquear` / `.bloqueios` (agora dentro do painel `.bloquear`)
