'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('el panel Admin/Supervisor compara todos los patinadores en todos los modelos y lotes cargados', () => {
  assert.match(html, /const allOperations=\[\.\.\.activeMap\.values\(\)\]/);
  assert.match(html, /skaters\.forEach\(\(\[key,u\]\)=>\{/);
  assert.match(html, /allOperations\.forEach\(op=>\{/);
  assert.match(html, /Avance de entregas de todos los patinadores/);
  assert.match(html, /<th>Modelo<\/th><th>Lote<\/th>/);
  assert.match(html, /<th>Entregadas<\/th><th>Pendientes<\/th><th>Avance<\/th>/);
  assert.match(html, /\['Admin','Supervisor'\]/);
});

test('el avance individual descuenta correcciones y no atribuye entregas de otro patinador', () => {
  const start = html.indexOf('function resumenEntregaPatinador(');
  const end = html.indexOf('\nfunction guardarCodigoOperacionCompartido()', start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const helper = html.slice(start, end);
  const context = {
    tareasAsignadasAUsuarioEstandar: (task, user) =>
      user && user.role === 'Patinador' && (user.puestos || []).includes(task.puesto),
    unidadesObjetivoEstandar: task => task.objetivo
  };
  vm.runInNewContext(helper + '\nglobalThis.__summary = resumenEntregaPatinador;', context);
  const task = {
    standardNKD: true,
    puesto: 'PRE 1',
    objetivo: 100,
    entregas: [
      { patinador: 'Ana', cantidad: 60 },
      { patinador: 'Beto', cantidad: 40 }
    ],
    correcciones: [{ usuario: 'Ana', unidades: 10 }]
  };
  const ana = context.__summary([task], { role: 'Patinador', name: 'Ana', puestos: ['PRE 1'] }, 'ana');
  const beto = context.__summary([task], { role: 'Patinador', name: 'Beto', puestos: ['PRE 1'] }, 'beto');
  assert.equal(ana.total, 100);
  assert.equal(ana.delivered, 50);
  assert.equal(ana.pct, 50);
  assert.equal(beto.total, 100);
  assert.equal(beto.delivered, 40);
  assert.equal(beto.pct, 40);
});
