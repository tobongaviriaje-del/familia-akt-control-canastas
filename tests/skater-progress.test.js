'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

function loadProgressHelpers() {
  const start = html.indexOf('function tareasAsignadasAUsuarioEstandar(');
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
    normalizarPuestoEstandar: value => String(value || '').trim(),
  };
  vm.runInNewContext(source + '\nglobalThis.__combine = combinarTareasProgreso; globalThis.__summary = resumenEntregaPatinador; globalThis.__lots = tareasLotesParaProgreso; globalThis.tareasAsignadasAUsuarioEstandar = tareasAsignadasAUsuarioEstandar; globalThis.__operationKey = claveOperacionProgreso;', context);
  return context;
}


test('Inteligencia de producción incluye correctamente el modelo CR4-150 en su mapa de lotes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  const start = source.indexOf('const model=t=>');
  const end = source.indexOf('\nfunction loadStandardWorkLots', start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const context = {};
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.__flatten = flattenWorkLotProgress;', context);
  const legacy = [{ id: 'cr4-task-1', standardMoto: 'CR4 150', cantidad: 100, entregado: 25 }];
  const lots = [{ id: 'cr4-lot-1', model: 'CR4 150', number: 1, tasks: [{ id: 'cr4-task-1', cantidad: 100, entregado: 25 }] }];
  const mapped = context.__flatten({ lots }, legacy);
  assert.equal(mapped.get('CR4-150').length, 1);
  assert.equal(mapped.get('CR4-150')[0].entregado, 25);
});

test('cuenta la entrega histórica en entrega aunque entregas exista vacío', () => {
  const context = loadProgressHelpers();
  const legacyMovement = { id: 'legacy-1', patinador: 'Ana', cantidad: 180, fechaHora: '20/11/2026 09:00' };
  const task = {
    standardNKD: true, puesto: 'PRE 26', objetivo: 600,
    entregado: 180, entregas: [], entrega: legacyMovement
  };
  const ana = context.__summary([task], { role: 'Patinador', name: 'Ana', puestos: ['PRE 26'] }, 'ana');
  assert.equal(ana.total, 600);
  assert.equal(ana.delivered, 180);
  assert.equal(ana.pct, 30);
  const merged = context.__combine([task]);
  assert.equal(merged[0].entregas.length, 1);
  assert.equal(merged[0].entregas[0].id, 'legacy-1');
});

test('atribuye entregas históricas usando alias de identidad del patinador', () => {
  const context = loadProgressHelpers();
  const task = { standardNKD: true, puesto: 'PRE 26', objetivo: 600, entregas: [
    { usuario: 'Ana', cantidad: 120 },
    { username: 'ana', cantidad: 60 }
  ] };
  const ana = context.__summary([task], { role: 'Patinador', name: 'Ana', username: 'ana', puestos: ['PRE 26'] }, 'ana');
  assert.equal(ana.total, 600);
  assert.equal(ana.delivered, 180);
  assert.equal(ana.pct, 30);
});

test('no duplica un movimiento que aparece en entregas y también en entrega', () => {
  const context = loadProgressHelpers();
  const movement = { id: 'same-event', patinador: 'Ana', cantidad: 180, fechaHora: '20/11/2026 09:00' };
  const merged = context.__combine([{
    standardNKD: true, puesto: 'PRE 26', objetivo: 600,
    entregado: 180, entregas: [movement], entrega: movement
  }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].entregas.length, 1);
  const ana = context.__summary(merged, { role: 'Patinador', name: 'Ana', puestos: ['PRE 26'] }, 'ana');
  assert.equal(ana.delivered, 180);
});

test('deduplica el mismo movimiento cuando los registros usan alias distintos', () => {
  const context = loadProgressHelpers();
  const merged = context.__combine([{
    standardNKD: true, puesto: 'PRE 26', objetivo: 600,
    entregas: [{ patinador: 'Ana', cantidad: 120, fechaHora: '20/11/2026 09:00' }],
    entrega: { usuario: 'Ana', cantidad: 120, fechaHora: '20/11/2026 09:00' }
  }]);
  assert.equal(merged[0].entregas.length, 1);
  const ana = context.__summary(merged, { role: 'Patinador', name: 'Ana', puestos: ['PRE 26'] }, 'ana');
  assert.equal(ana.delivered, 120);
  assert.equal(ana.pct, 20);
});

test('el comparativo consulta los lotes reales del servidor y no depende solo de /api/state', () => {
  assert.match(html, /fetch\('\/api\/admin\/work-lots\/progress'/);
  assert.match(html, /combinarTareasProgreso\(\[\.\.\.legacyTasks,\.\.\.lotTasks\]\)/);
  assert.match(server, /if\(p==='\/api\/admin\/work-lots\/progress'&&req\.method==='GET'\)/);
  assert.match(server, /source:'work-lots',lots/);
  assert.match(server, /const activeIdsByModel=new Map\(\)/);
  assert.match(server, /for\(const candidate of readWorkLots\(\)\)/);
  assert.match(server, /activeByModel\.set\(model,\{row:candidate,matches\}\)/);
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

test('las tareas de los cuatro modelos se normalizan desde los lotes y conservan su identidad', () => {
  const context = loadProgressHelpers();
  const lots = [
    { id: 'a', number: 794, model: 'CR4 125', tasks: [{ id: '1', puesto: 'PRE 1', cantidad: 510, entregado: 200, entregas: [{ patinador: 'Ana', cantidad: 200 }] }] },
    { id: 'b', number: 795, model: 'CR4 150', tasks: [{ id: '2', puesto: 'PRE 2', cantidad: 600 }] },
    { id: 'c', number: 796, model: 'NKD', tasks: [{ id: '3', puesto: 'PRE 3', cantidad: 600 }] },
    { id: 'd', number: 797, model: 'XRS-180', tasks: [{ id: '4', puesto: 'PRE 4', cantidad: 600 }] },
    { id: 'e', number: 1, model: 'CHR', tasks: [{ id: '5', puesto: 'PRE 5', cantidad: 600 }] }
  ];
  const mapped = context.__lots(lots);
  assert.equal(mapped.length, 5);
  assert.ok(mapped.every(task => task.standardNKD === true));
  assert.deepEqual(Array.from(mapped, task => task.standardMoto), ['CR4 125', 'CR4 150', 'NKD', 'XRS-180', 'CHR']);
  const chr = mapped.find(task => task.standardMoto === 'CHR');
  assert.equal(chr.__progressLotLabel, 'Sin código · lote 1');
  assert.equal(context.__summary([chr], { role: 'Patinador', name: 'Caro', puestos: ['PRE 5'] }, 'caro').pct, 0);
  assert.equal(mapped[0].__progressLotLabel, 'Sin código · lote 794');
  const ana = context.__summary(mapped, { role: 'Patinador', name: 'Ana', puestos: ['PRE 1'] }, 'ana');
  assert.equal(ana.assigned, 1);
  assert.equal(ana.total, 510);
  assert.equal(ana.delivered, 200);
  assert.equal(ana.pct, 200 / 510 * 100);
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


test('reconoce la asignación directa por patinadorEstandar aunque no tenga el puesto en su perfil', () => {
  const context = loadProgressHelpers();
  const task = { standardNKD: true, puesto: 'PRE 26', patinadorEstandar: 'Ana María' };
  const ana = { role: 'Patinador', name: 'Ana María', puestos: [] };
  const beto = { role: 'Patinador', name: 'Beto', puestos: [] };
  assert.equal(context.tareasAsignadasAUsuarioEstandar(task, ana, 'ana'), true);
  assert.equal(context.tareasAsignadasAUsuarioEstandar(task, beto, 'beto'), false);
});

test('mantiene separados dos lotes distintos aunque compartan código, EAN y puesto', () => {
  const context = loadProgressHelpers();
  const base = { standardNKD: true, standardMoto: 'NKD', puesto: 'PRE 1', ean: '123', objetivo: 600, codigoLoteOperacion: 'KK800' };
  const mapped = context.__lots([
    { id: 'lote-1', number: 1, model: 'NKD', codigoLoteOperacion: 'KK800', tasks: [{ ...base, id: 'task-1' }] },
    { id: 'lote-2', number: 2, model: 'NKD', codigoLoteOperacion: 'KK800', tasks: [{ ...base, id: 'task-2' }] }
  ]);
  const merged = context.__combine(mapped);
  assert.equal(merged.length, 2);
  assert.notEqual(merged[0].__progressLotKey, merged[1].__progressLotKey);
});

test('separa lotes reales distintos aunque compartan modelo y código de operación', () => {
  const context = loadProgressHelpers();
  const a = { standardNKD: true, standardMoto: 'NKD', codigoLoteOperacion: 'KK800', __progressLotKey: 'lote-1' };
  const b = { ...a, __progressLotKey: 'lote-2' };
  assert.notEqual(context.__operationKey(a), context.__operationKey(b));
  assert.equal(context.__operationKey(a), context.__operationKey({ ...a }));
});

test('mantiene agrupadas las tareas locales sin identidad de lote por el mismo código', () => {
  const context = loadProgressHelpers();
  const a = { standardNKD: true, standardMoto: 'NKD', codigoLoteOperacion: 'KK800' };
  const b = { ...a, ean: 'EAN-2' };
  assert.equal(context.__operationKey(a), context.__operationKey(b));
});

test('la vista de Admin/Supervisor incluye todos los lotes y muestra error si la consulta real falla', () => {
  assert.ok(html.includes('tareasLotesParaProgreso(skaterWorkLotProgress)'));
  assert.match(html, /No se mostrarán totales incompletos/);
  assert.match(html, /\['Admin','Supervisor'\]/);
  assert.match(html, /<th>Modelo<\/th><th>Lote<\/th>/);
  assert.match(html, /<th>Entregadas<\/th><th>Pendientes<\/th>/);
  assert.match(html, /<th>Avance<\/th>/);
});


test('CHR entra en el comparativo individual y conserva sus entregas por patinador', () => {
  const context = loadProgressHelpers();
  const mapped = context.__lots([{ id: 'chr-lot', number: 12, model: 'CHR', codigoLoteOperacion: 'CHR-012', tasks: [{ id: 'chr-task', puesto: 'PRE 5', cantidad: 300, entregado: 120, entregas: [{ patinador: 'Caro', cantidad: 120 }] }] }]);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].standardMoto, 'CHR');
  const summary = context.__summary(mapped, { role: 'Patinador', name: 'Caro', puestos: ['PRE 5'] }, 'caro');
  assert.equal(summary.assigned, 1);
  assert.equal(summary.total, 300);
  assert.equal(summary.delivered, 120);
  assert.equal(summary.pct, 40);
});

test('la vista de Supervisor solo muestra patinador, modelo, lote y porcentaje de entrega', () => {
  assert.match(html, /const isSupervisor=current\.role==='Supervisor'/);
  assert.ok(html.includes("isSupervisor?'':'<th>Refs.</th><th>Entregadas</th><th>Pendientes</th>'"));
  assert.match(html, /!isSupervisor&&selected\?/);
});
