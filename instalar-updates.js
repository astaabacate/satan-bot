// instalador antigo removido — comandos essenciais agora são apenas:
// .nuke on/off, .nuke agora, .cl, .bump, .fig, .bloquear (painel), .logs, .menu
// Este arquivo não reinstala mais .recriar, .restaurar, .call limite, .snapshot, .att, .desbanir, etc.
// Mantido apenas para não quebrar workflows que chamam node instalar-updates.js --check

const fs = require('fs');
const check = process.argv.includes('--check');
if (check) {
  console.log('aplicaveis: 0, ja feitos: 0');
  process.exit(0);
}
console.log('instalador descontinuado — bot.js já está na versão mínima.');
