# Comandos de moderação

## Recriar estrutura

No servidor novo, depois de adicionar o bot, o dono pode executar:

```text
.recriar
```

O comando cria os canais definidos em `server_blueprint.json` (por enquanto, estrutura mínima), restaura o canal de sistema e tenta religar os logs. Ele é idempotente: canais e cargos de mesmo nome/tipo não são duplicados. **Não apaga** canais, mensagens nem cargos existentes e não arma o nuke; `.nuke on` continua sendo uma decisão manual.

O bot precisa de **Gerenciar Canais**, **Gerenciar Cargos** e **Gerenciar Webhooks**. O blueprint atual não recupera a lista completa de canais, categorias ou cargos antigos; nomes conhecidos podem ser ajustados nesse JSON antes do deploy.

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
