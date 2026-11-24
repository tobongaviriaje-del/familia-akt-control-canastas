'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

function loadProgressHelpers() {
  const start = html.indexOf('function combinarTareasProgreso(');
  const end = html.indexOf('\nfunction guardarCodigoOperacionCompartido()', start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const source = html.slice(start, end);
  const context = {
    esContinuidadXRS180: task => !!task.continuidadDeTareaId,
    modeloDeTareaEstandar: task => task.standardMoto || (task.standardNKD ? 'NKD' : ''),
    normalizarModeloContinuidad: value => String(value || '').trim().toUpperCase(),
    normalizarPuestoEstandar: value => String(value || '').trim(),
    unidadesObjetivoEstandar: task => task.objetivo ?? task.cantidad ?? 0,
    tareasAsignadasAUsuarioEstandar: (task, user) =>
      user && user.role === 'Patinador' && (user.puestos || []).includes(task.puesto)
  };
  vm.runInNewContext(source + '\nglobalThis.__combine = combinarTareasProgreso; globalThis.__summary = resumenEntregaPatinador;', context);
  return context;
}

test('el comparativo consulta los lotes reales del servidor y no depende solo de /api/state', () => {
  assert.match(html, /fetch\('\/api\/admin\/work-lots\/progress'/);
  assert.match(html, /combinarTareasProgreso\(\[\.\.\.legacyTasks,\.\.\.lotTasks\]\)/);
  assert.match(server, /if\(p==='\/api\/admin\/work-lots\/progress'&&req\.method==='GET'\)/);
  assert.match(server, /source:'work-lots',lots/);
  assert.match(server, /const lots=readWorkLots\(\)\.map\(row=>/);
});

test('las correcciones no se restan de las entregas atribuidas al patinador', () => {
  const context = loadProgressHelpers();
  const task = {
    standardNKD: true, puesto: 'PRE 26', objetivo: 600,
    entregas: [{ patinador: 'Ana', cantidad: 600 }],
    correcciones: [{ usuario: 'Ana', unidades: 336 }]
  };
  const ana = context.__summary([task], { role: 'Patinador', name: 'Ana', puestos: ['PRE 26'] }, 'ana');
  assert.equal(ana.total, 600);
  assert.equal(ana.delivered, 600);
  assert.equal(ana.pct, 100);
});

test('combina copias de una referencia sin duplicar el objetivo y conserva eventos de ambos patinadores', () => {
  const context = loadProgressHelpers();
  const a = { standardNKD: true, puesto: 'PRE 1', ean: '123', objetivo: 600, entregado: 350,
    entregas: [{ patinador: 'Ana', cantidad: 350, fechaHora: '01/01/2026 08:00' }] };
  const b = { ...a, entregado: 250,
    entregas: [{ patinador: 'Beto', cantidad: 250, fechaHora: '01/01/2026 09:00' }],
    correcciones: [{ usuario: 'Beto', unidades: 200 }] };
  const merged = context.__combine([a, b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].entregas.length, 2);
  const ana = context.__summary(merged, { role: 'Patinador', name: 'Ana', puestos: ['PRE 1'] }, 'ana');
  const beto = context.__summary(merged, { role: 'Patinador', name: 'Beto', puestos: ['PRE 1'] }, 'beto');
  assert.equal(ana.total, 600);
  assert.equal(ana.delivered, 350);
  assert.equal(beto.total, 600);
  assert.equal(beto.delivered, 250);
});

test('incluye modelos y lotes servidos por el backend y no mezcla operaciones con el mismo EAN', () => {
  const context = loadProgressHelpers();
  const nkd = { standardNKD: true, standardMoto: 'NKD', puesto: 'PRE 1', ean: '123', objetivo: 600, codigoLoteOperacion: 'KK711' };
  const cr4 = { ...nkd, standardMoto: 'CR4 150', codigoLoteOperacion: 'CR4-150-02' };
  const otherLot = { ...nkd, codigoLoteOperacion: 'KK712' };
  const merged = context.__combine([nkd, cr4, otherLot]);
  assert.equal(merged.length, 3);
  assert.deepEqual(Array.from(merged, x => x.standardMoto), ['NKD', 'CR4 150', 'NKD']);
});

test('la vista de Admin/Supervisor incluye todos los lotes y muestra error si la consulta real falla', () => {
  assert.match(html, /skaterWorkLotProgress\.flatMap/);
  assert.match(html, /No se mostrarán totales incompletos/);
  assert.match(html, /\['Admin','Supervisor'\]/);
  assert.match(html, /<th>Modelo<\/th><th>Lote<\/th>/);
  assert.match(html, /<th>Entregadas<\/th><th>Pendientes<\/th><th>Avance<\/th>/);
});
