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
.logs on / off / teste   # liga/desliga/testa logs
.menu                # mostra este menu resumido
```

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
