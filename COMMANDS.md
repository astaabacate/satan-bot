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

## Filtro de proteção infantil

O filtro textual inclui `CP`, `CSAM`, `CSEM` e termos relacionados em português
 e inglês. As siglas são verificadas como palavras separadas, com tolerância a
espaços, pontuação e caracteres invisíveis, sem bloquear `CPF`, `TCP` ou `SCP`.
`CP` é bloqueado independentemente do contexto (inclusive jogos). Termos dessa
categoria não recebem exceção por conterem “brincadeira” ou “zoeira”.

A ação continua sendo a já configurada para `menor-sexual`: tentativa de apagar,
aviso ao dono e castigo. O filtro não analisa imagens/vídeos, não distingue
conversas educativas de outras menções e não garante detectar toda variação.
A imunidade do dono existente no bot não foi alterada.

Para ativar: publicar `scripts/filtro-denuncia.js` na versão de produção e
reiniciar o bot. Alterações apenas na branch de trabalho não ativam o filtro.
