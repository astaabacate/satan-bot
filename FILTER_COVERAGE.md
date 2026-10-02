# FILTER_COVERAGE — cobertura e limitações do filtro de conteúdo

> **DESLIGADO em 02/10/2026 a pedido do dono.** O `classificarDenuncia` não é mais
> chamado pelo `bot.js`: o único filtro de conteúdo é a lista do dono (`.bloquear`,
> casamento por formação — ver `COMMANDS.md`). O módulo continua no repo porque a
> lista usa o `normalizar` dele. O texto abaixo fica como referência do que as
> regras cobriam, caso o dono queira religar (é só voltar a chamar o filtro no
> `messageCreate`).
>
> Na mesma data também saíram os filtros de textão, link/convite, link de CDN,
> repetição interna, asterisco, `#` e mensagem invisível. Sobrou só a lista do
> dono (conteúdo) + o anti-flood (comportamento: repetir/floodar/emoji/msg curta),
> e o anti-flood também só apaga — sem timeout nenhum.

Este documento descreve o que o filtro textual do bot cobre e o que ele **não** cobre. O filtro é apenas textual, não analisa imagem/vídeo/áudio.

## Objetivo

Apagar na hora conteúdo que faz o Discord derrubar o servidor inteiro e banir o dono (Community Guidelines / T&S). Denúncia em massa por quem foi banido é o caminho mais comum para a remoção definitiva em minutos — o print continua valendo mesmo depois de apagar.

## Categorias

| cat | grave | cor | o que derruba |
|---|---|---|---|
| `menor-sexual` | sim | `0x8b0000` | exploração sexual infantil (tolerância zero). É o que a polícia recebe. |
| `violencia-sexual` | sim | `0x8b0000` | estupro/abuso sexual (termos sem “abuso” puro; sem zoeira) |
| `automutilacao` | sim | `0x8b0000` | incentivo/convite a se machucar ou se matar |
| `ameaca` | sim | `0xb22222` | ameaça de violência a pessoa concreta |
| `extorsao` | sim | `0x8b1a1a` | sextorsão / chantagem (ex.: “manda pix que eu mostro”, “vou postar seu nude”) |
| `dox` | não | `0x8a6d3b` | dados pessoais sensíveis (CPF, RG, telefone, e-mail, endereço) |
| `gore` | não | `0x8b0000` | violência extrema / crueldade |

`grave = true` gera alerta vermelho no canal de logs e DM destacada ao dono; `grave = false` gera aviso padrão. Ver `scripts/filtro-denuncia.js` (`resumoRegras()`).

## Cobertura atual (texto)

`scripts/filtro-denuncia.js` casa termos normalizados e “colados”, com tolerância a:

- caixa (caixa-alta/baixa), acento, pontuação, espaços múltiplos
- leet (`0→o, 4→a, 3→e, 1→i, 5→s` etc.), caracteres invisíveis / zero-width / `NFKC`
- separadores (`c.p`, `c p`, `c-p`, `c　p` fullwidth, `c\u200bp` etc.)

**Siglas curtas** (`CP`, `CSAM`, `CSEM`) são casadas como palavra separada com regex de borda (`(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`), usando `NFKC` + remoção de `Cf/Mn` sem unir palavras. Isso evita bloquear `CPF`, `TCP`, `SCP`, `cpus`, `recepcao`, `csample` etc.

**Termos ampliados para `menor-sexual` (pt/en):**

```
pornografia infantil, porno infantil, porn infant, papo infantil,
child porn, child pornography, child sexual abuse material,
child sexual exploitation material, material de abuso sexual infantil,
abuso sexual infantil, exploracao sexual infantil,
exploracao sexual de menores, abuso sexual de menores,
pornografia de menores, pornografia de criancas, porno de crianca,
nude infantil, nudes infantis, nudes de menores, nudes de criancas,
pedopornia, pedopornografia, pedofilia, pedofilo, pedofila, pedo porno,
nu de menor, menor nu, desnuda de menor, foto de menor, video de menor,
menor sem roupa, menor pelada, menor de idade nu,
estupro de menor, abusar de menor, molestar menor,
underage, loli, lolicon, shotacon, shota
+ siglas: cp, csam, csem
+ regex: \bmenor(?:es)?\s+de\s+\d{1,2}\s+anos?\b.{0,40}\b(nu|nua|nude|porn|sexo|sexual)\b
```

`CP` é bloqueado **independentemente do contexto**, inclusive “CP do pokemon”, “CP brincadeira”. Para essa categoria não há exceção por conter “brincadeira”, “zoeira”, “de rir”, “demais” etc. — a exceção `ZOEIRO` só se aplica às demais categorias (evita apagar “vou morrer de rir”, “me mato de rir kkk”). A `violencia-sexual` também não tem exceção de zoeira.

**Categoria `violencia-sexual` (pt/en):**

```
estupro, estuprar, estuprada, estuprado, estuprador, estupradora, estupradores,
estuprou, estuprando, estupra, estuprei, estuprava,
abusador, abusadora, abusadores, abuso sexual, abusei, abusou, abusava,
rape, rapist, sexual assault
```

Sem “abuso” puro para não pegar “abuso de poder”. Categoria `grave` com a mesma
ação das demais (apagar e avisar o dono, sem mute/timeout/ban). Conjugações em
1ª pessoa (`abusei`, `estuprei`) caem inclusive ofuscadas pelos mecanismos de
pontuação/leet: `a.b.u.s.e.i`, `3stuprei` etc.

**Exemplos que caem:**

- `CP`, `c.p`, `C P`, `c-p`, `c‌p` (zero-width), `ＣＰ` (fullwidth), `(cp)`, `cp!`, `c💀p`, `CP brincadeira`, `csam`, `C.S.A.M.`, `CSEM`
- `material de abuso sexual infantil`, `exploracao sexual de menores`, `child sexual abuse material`, `pedofilia de rir` (sem exceção)

**Exemplos que não caem (falso positivo evitado):**

- `CPF`, `TCP`, `SCP`, `cpus`, `recepcao`, `pc para jogar`, `c pessoa`, `ação cpá`, `vou matar a fome`, `to com medo do`

## Ação do bot

- **Apenas** tenta apagar a mensagem e avisa o dono (canal de logs + DM). **Não aplica mute/timeout/ban por filtro**, inclusive `CP`/`CSAM`/`CSEM` e `violencia-sexual`. A imunidade do dono (`OWNER_ID`) continua igual.
- Flood/spam continua com punições separadas (timeout progressivo de 1h +1h, `mute_state.json`), sem alteração aqui.
- Categorias, permissões de canais e mensagem de boas-vindas não são alteradas por este filtro.

## Blacklist curada (`blacklist_termos.json`)

`blacklist_termos.json` espelha os termos de detecção do filtro, separados por
gravidade (`alta` = `grave: true`, `baixa` = o resto). É a referência curada da
cobertura: **não é lida em runtime** pelo bot. Ao alterar termos, atualizar o
JSON junto com `scripts/filtro-denuncia.js` e rodar `npm test`.

## Limitações (importante)

- Não analisa imagem, vídeo, áudio, link externo ou arquivo. Só texto da mensagem (`m.content`).
- Não distingue contexto educativo, jornalístico, denúncia ou ficção de apologia — toda menção textual nos termos acima é tratada igual.
- Não garante pegar toda variação: leet, pontuação e colado cobrem casos comuns, mas não há garantia contra novas ofuscações.
- Não substitui moderação humana nem denúncia ao Discord. O bot pode falhar em apagar se faltar permissão `Gerenciar Mensagens` no canal (avisa dono 1x/30min por canal).
- Siglas são verificadas como palavra; letras coincidentes entre palavras não são bloqueadas.
- O filtro não reavalia edições de mensagem antigas; só `messageCreate`.

## Detector de links (anti-flood)

O anti-flood apaga links/convites na hora (`temLink`/`temLinkCdn`). Para não apagar prosa normal:

- Frases com ponto + espaço + maiúscula (ex.: `Conta criada ontem. Perdeu?`) **não** são tratadas como `ontem.perdeu` site.
- Conteúdo dentro de bloco de código (`` ```…``` `` e `` `…` `` inline) é ignorado pelo detector.

Links reais continuam apagados: `https://…`, `www.…`, `discord.gg/…`, `discord.com/invite/…`, `canary.discord.com/invite/…`, `discord://-/invite/…`, `disboard.org/server`, `cdn.discordapp.com` etc., com tolerância a espaços/zero-width/fullwidth ao redor de `.` e `/` quando o TLD é conhecido.

## Testes

`npm test` (`node --test`) roda sem Discord/rede:

- `test/filtro-denuncia.test.js` — categorias (incl. `violencia-sexual`), leet/pontuação/zero-width, falsos positivos, normalização, graves vs não-graves, siglas `CP/CSAM/CSEM` e termos ampliados.
- `test/link-prose.test.js` — prosa normal não é link, prosa em bloco de código não é link, links reais ainda são pegos, convites obfuscados ainda caem.

Total esperado: **61 testes**.

## Ativação

Publicar **juntos** `bot.js` + `scripts/filtro-denuncia.js` e reiniciar o bot (workflow `satan` no `main`). Alterações só em branch de trabalho não ativam o filtro em produção.
