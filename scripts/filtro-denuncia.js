// Filtro de denúncia: apaga, na hora, o conteúdo que faz o Discord derrubar o
// servidor inteiro. Não é "esconder do Discord" — é o oposto. Quando o Discord
// remove um servidor por violação, a remoção é definitiva e o dono cai junto
// (a Community Guidelines/T&S costuma banir o owner junto com o servidor).
// Denúncia em massa de quem acabou de ser banido é o caminho mais comum pra
// isso acontecer em minutos, e o print que a pessoa levou continua valendo.
//
// Categorias (Community Guidelines + o que o Discord remove ativamente no
// Brasil: automutilação, exploração sexual infantil, violência extrema,
// sextorsão, crueldade contra animais — 9,7 mil servidores em 2024–2026):
//
//   menor-sexual  -> exploração sexual infantil. É o que derruba servidor na
//                    hora e o que a polícia recebe. Tolerância zero.
//   automutilacao -> incentivo/convite a se machucar ou se matar.
//   ameaca        -> ameaça de violência a pessoa concreta.
//  iative         -> (placeholder, ver abaixo)
const REGRAS = [
  {
    cat: 'menor-sexual',
    cor: 0x8b0000,
    grave: true,
    termos: [
      'pornografia infantil', 'porno infantil', 'porn infant', 'papo infantil',
      'child porn', 'pedopornia', 'pedo porno',
      'nu de menor', 'menor nu', 'menor nu', 'desnuda de menor', 'foto de menor',
      'video de menor', 'menor sem roupa', 'menor pelada', 'menor de idade nu',
      'estupro de menor', 'abusar de menor', 'molestar menor',
      'underage', 'loli', 'lolicon', 'shotacon', 'shota',
    ],
    regex: [/\bmenor(?:es)?\s+de\s+\d{1,2}\s+anos?\b.{0,40}\b(nu|nua|nude|porn|sexo|sexual)\b/i],
  },
  {
    cat: 'automutilacao',
    cor: 0x8b0000,
    grave: true,
    termos: [
      'vou me matar', 'me mato', 'quero morrer', 'queria morrer', 'vou me enforcar',
      'vou me cortar', 'tirar a minha vida', 'acabar com a minha vida',
      'nao quero mais viver', 'to sem querer viver', 'se mate', 'corte o pulso',
      'cortar o pulso', 'vou me queimar', 'pular do edificio',
    ],
    regex: [/\b(vou|quero|queria)\s+(me\s+)?(matar|enforcar|cortar)\b.{0,20}\b(eu|eu mesmo)\b/i],
  },
  {
    cat: 'ameaca',
    cor: 0xb22222,
    grave: true,
    termos: [
      'vou te matar', 'vou matar vc', 'vou matar voce', 'vou te enforcar',
      'te vou matar', 'vou matar o canal', 'vou explodir o canal', 'vou explodir esse canal', 'vou botar bomba',
      'vou atirar em', 'vou te dar um tiro', 'vou te destruir', 'vou te humilhar', 'vou te expor',
    ],
  },
  {
    cat: 'extorsao',
    cor: 0x8b1a1a,
    grave: true,
    termos: [
      'manda pix que eu', 'pix que eu mostro', 'pix e eu mostro', 'me paga que eu',
      'senha do insta', 'senha do facebook', 'senha do tiktok', 'manda a nude',
      'manda a foto sem roupa', 'sextors', 'extorsao', 'vou expor', 'vou postar seu nude',
    ],
  },
  {
    cat: 'dox',
    cor: 0x8a6d3b,
    grave: false,
    termos: ['meu cpf', 'meu rg', 'minha identidade', 'meu telefone e', 'minha senha e', 'minha senha do', 'numero da minha conta'],
    regex: [
      /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,                  // cpf
      /\b\d{2}\.?\d{5}-?\d{3}\b/,                         // rg
      /\(\d{2}\)\s?9?\d{4}-?\d{4}\b/,                     // telefone
      /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,       // e-mail
      /\b(rua|avenida|av\.?|travessa)\s+[a-z0-9\s,.-]{5,}\d{1,4}\b/i, // endereço
    ],
  },
  {
    cat: 'gore',
    cor: 0x8b0000,
    grave: false,
    termos: ['desmembrado', 'decapitado', 'violada no chat', 'estupro no chat', 'video de execut', 'gore de'],
  },
];

// invisíveis/zero-width + lonas do corretor do celular, pra furar "c p", "p.c.p"
const INVISIVEL = /[\s­͏؜ᅟᅠ឴឵-‏‪-‮⁠-⁯﻿᠎]/g;
const LEET = { 4: 'a', 3: 'e', 1: 'i', 0: 'o', 5: 's', 7: 't', 8: 'b', 6: 'g', '@': 'a', $: 's', '!': 'i', '|': 'l' };

function normalizar(t) {
  return String(t == null ? '' : t)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(INVISIVEL, ' ')
    .replace(/[0-9@$!|]/g, (c) => LEET[c] || c)
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// "vou morrer de rir", "me mato demais": nao e automutilacao. Some o qualificador
// antes de casar os termos, senao o filtro enche o canal de bloqueio.
const ZOEIRO = new RegExp('(?:de rir|demaio|demais|demaisinho|demaiszinhao|tava zoando|ta zoando|zoeira|brincadeira|mentira|so zuera)\\b', 'g');
const ZOEIRO_TEST = /\b(de rir|demaio|demais|demaisinho|demaiszinhao|tava zoando|ta zoando|zoeira|brincadeira|mentira|so zuera)\b/;
function normalizarSemZoeira(t) { return normalizar(t).replace(ZOEIRO, ' ').replace(/\s+/g, ' ').trim(); }
function colado(t) { return normalizar(t).replace(/ /g, ''); }

// termo com espaco e/ou pontuacao: casa no texto normalizado e no "colado"
// (assim "c.p", "c p" e "c-p" caem no mesmo termo)
function casa(termo, txt, limpo, col) {
  let idx = limpo.indexOf(termo);
  if (idx < 0) {
    const c = termo.replace(/[^a-z]/g, '');
    if (!c || !col.includes(c)) return false;
    idx = 0;
  }
  // zoeira logo depois do termo? ("vou morrer DE RIR", "me mato DEMAIS")
  const depois = txt.slice(idx, idx + termo.length + 30);
  if (ZOEIRO_TEST.test(depois)) return false;
  return true;
}

/**
 * classifica o texto de uma mensagem.
 * @returns {{cat:string,cor:number,grave:boolean,termo:string}|null}
 */
function classificarDenuncia(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const txt = normalizar(texto);
  const limpo = normalizarSemZoeira(texto);
  const col = colado(texto);
  for (const regra of REGRAS) {
    for (const termo of regra.termos) {
      if (casa(termo, txt, limpo, col)) return { cat: regra.cat, cor: regra.cor, grave: !!regra.grave, termo };
    }
    for (const rx of (regra.regex || [])) {
      const achou = texto.match(rx);
      if (achou) return { cat: regra.cat, cor: regra.cor, grave: !!regra.grave, termo: achou[0] };
    }
  }
  return null;
}

function resumoRegras() {
  return REGRAS.map((r) => ({ cat: r.cat, grave: !!r.grave, termos: r.termos.length, regex: (r.regex || []).length }));
}

module.exports = { classificarDenuncia, normalizar, colado, resumoRegras, REGRAS };
