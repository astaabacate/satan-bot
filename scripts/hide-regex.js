// Passo 1 da ofuscacao (roda sozinho via `preofuscar` antes do `ofuscar`).
// Deixa o fonte pronto para o ofuscador esconder TUDO:
//
// PASSO A - regex literais -> new RegExp("source", "flags"), porque regex
// literal nao entra no string-array criptografado. Escaping exato via
// JSON.stringify do .source real, com prova de equivalencia por regex.
//
// PASSO B - acessos a process.env -> chave montada em runtime:
//   process.env.FOO_BAR / process.env['FOO_BAR']
// vira:
//   const EK_H_0 = ['FOO', 'BAR'].join('_'); ... process.env[EK_H_0]
// porque string em posicao de membro computado (obj['x']) tambem nao e
// criptografada pelo ofuscador. O nome completo nunca aparece no fonte.
//
// Idempotente: numa segunda passada nada mais e encontrado e nada muda.
// LIMITES (nao cobertos, evitar no fonte limpo): `obj['literal']` generico
// fora de process.env, e aliases como `const { env } = process`.
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('uso: node scripts/hide-regex.js <arquivo...>');
  process.exit(1);
}

// divide um nome em 2 pedacos que nunca revelam o nome completo sozinhos
function splitKey(name) {
  const i = name.indexOf('_');
  if (i > 0) return { parts: [name.slice(0, i), name.slice(i + 1)], sep: '_' };
  const m = Math.max(1, Math.floor(name.length / 2));
  return { parts: [name.slice(0, m), name.slice(m)], sep: '' };
}
const isProcessEnv = (node) =>
  node && node.type === 'MemberExpression' && !node.computed &&
  node.object && node.object.type === 'Identifier' && node.object.name === 'process' &&
  node.property && node.property.type === 'Identifier' && node.property.name === 'env';

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');

  // ---- PASSO A: regex literais ----
  {
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    const found = [];
    walk.simple(ast, { Literal(node) { if (node.regex) found.push(node); } });
    console.log(`[hide] ${file}: ${found.length} regex literais`);
    const sorted = [...found].sort((a, b) => b.start - a.start);
    for (const n of sorted) {
      const original = src.slice(n.start, n.end);
      const rx = eval(original);
      if (!(rx instanceof RegExp)) {
        console.error(`[hide] ERRO: nao-regex em ${file}: ${original.slice(0, 80)}`);
        process.exit(1);
      }
      const repl = `new RegExp(${JSON.stringify(rx.source)}, ${JSON.stringify(rx.flags)})`;
      const check = eval(repl);
      if (check.source !== rx.source || check.flags !== rx.flags) {
        console.error(`[hide] ERRO: divergencia em ${file}: ${original.slice(0, 80)}`);
        process.exit(1);
      }
      src = src.slice(0, n.start) + repl + src.slice(n.end);
    }
  }

  // ---- PASSO B: process.env.X / process.env['X'] ----
  {
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    const hits = [];
    walk.simple(ast, {
      MemberExpression(node) {
        if (!isProcessEnv(node.object)) return;
        if (!node.computed && node.property.type === 'Identifier') {
          hits.push({ node, name: node.property.name });
        } else if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
          hits.push({ node, name: node.property.value });
        }
      },
    });
    const names = [...new Set(hits.map((h) => h.name))];
    console.log(`[hide] ${file}: ${hits.length} acessos a process.env (${names.length} chaves)`);
    const varOf = new Map(names.map((nm, i) => [nm, `EK_H_${i}`]));
    const sorted = [...hits].sort((a, b) => b.node.start - a.node.start);
    for (const { node, name } of sorted) {
      const objSrc = src.slice(node.object.start, node.object.end);
      src = src.slice(0, node.start) + `${objSrc}[${varOf.get(name)}]` + src.slice(node.end);
    }
    if (names.length) {
      const decls = names.map((nm) => {
        const { parts, sep } = splitKey(nm);
        return `const ${varOf.get(nm)} = [${parts.map((p) => JSON.stringify(p)).join(', ')}].join(${JSON.stringify(sep)});`;
      }).join('\n') + '\n';
      // injeta antes do 1o statement (mas depois de 'use strict'/shebang)
      const ast2 = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
      const first = ast2.body[0];
      let pos = 0;
      if (first) {
        const isDir = first.type === 'ExpressionStatement' && first.expression.type === 'Literal' &&
          typeof first.expression.value === 'string';
        pos = isDir ? first.end : first.start;
      }
      src = src.slice(0, pos) + (pos > 0 && !src.slice(0, pos).endsWith('\n') ? '\n' : '') + decls + src.slice(pos);
    }
    // alarme: nao pode restar acesso direto com nome visivel
    const rest = src.match(/process\s*\.\s*env\s*(\.\s*[A-Za-z_$][\w$]*|\[\s*['"`])/);
    if (rest) {
      console.error(`[hide] ERRO: acesso direto a process.env restou em ${file}: ${rest[0]}`);
      process.exit(1);
    }
  }

  fs.writeFileSync(file, src);
}
console.log('[hide] ok');
