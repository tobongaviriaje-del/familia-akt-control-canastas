const fs = require('node:fs');
const vm = require('node:vm');

const files = [
  'server.js',
  'public/profesional.js',
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  new vm.Script(source, { filename: file });
  process.stdout.write('OK sintaxis: ' + file + '\n');
}

const html = fs.readFileSync('public/index.html', 'utf8');
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
let inlineCount = 0;
for (const [index, match] of blocks.entries()) {
  const attributes = match[1] || '';
  const source = match[2] || '';
  if (/\bsrc\s*=/.test(attributes) || !source.trim()) continue;
  new vm.Script(source, { filename: 'public/index.html:inline-script-' + (index + 1) });
  inlineCount++;
}
if (!inlineCount) throw new Error('No se encontró ningún script inline para validar.');
process.stdout.write('OK sintaxis: ' + inlineCount + ' script(s) inline de public/index.html\n');
