'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Inteligencia consulta dinámicamente los lotes vigentes de todos los modelos habilitados', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  assert.match(source, /STANDARD_LOT_MODELS=\['NKD','CR4 150','CR4 125','XRS-180','CHR'\]/);
  assert.match(source, /fetch\('\/api\/admin\/work-lots\/progress'/);
  assert.match(source, /__progressLotKey:lotKey/);
  assert.match(source, /lot.active!==true/);
  assert.doesNotMatch(source, /overview\?model=\x27\+encodeURIComponent\(modelName\)/);

  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  assert.notEqual(bootstrap, -1, 'se debe encontrar el arranque de la interfaz');
  const isolated = source.slice(0, bootstrap) +
    'globalThis.__aktIntelTest = { groupsByOperation, flattenWorkLotProgress };})();';
  const context = { document: {}, console };
  vm.runInNewContext(isolated, context);

  const sample = [
    { id: 'PRE26', puesto: 'PRE 26', lote: 600, entregado: 600, entregas: [{ cantidad: 600 }], correcciones: [{ unidades: 336 }], standardMoto: 'NKD', codigoLoteOperacion: 'KK712' },
    { id: 'D5', puesto: 'Derecho 5', lote: 600, entregado: 0, entregas: [], correcciones: [{ unidades: 600 }], standardMoto: 'NKD', codigoLoteOperacion: 'KK712' },
    { id: 'D6', puesto: 'Derecho 6', lote: 600, entregado: 600, entregas: [{ cantidad: 600 }], correcciones: [{ unidades: 600 }], standardMoto: 'CR4 150', codigoLoteOperacion: 'CR4-A' },
    { id: 'PRE12', puesto: 'PRE 12', lote: 600, entregado: 600, entregas: [{ cantidad: 600 }], correcciones: [{ unidades: 600 }], standardMoto: 'CR4 150', codigoLoteOperacion: 'CR4-A' }
  ];
  const groups = context.__aktIntelTest.groupsByOperation(sample);
  assert.equal(groups.length, 2);
  const nkd = groups.find(group => group.model === 'NKD');
  const cr4 = groups.find(group => group.model === 'CR4-150');
  assert.ok(nkd);
  assert.ok(cr4);
  assert.equal(nkd.code, 'KK712');
  assert.equal(nkd.total, 1200);
  assert.equal(nkd.done, 600);
  assert.equal(nkd.pending, 600);
  assert.equal(Math.round(nkd.done / nkd.total * 100), 50);
  assert.equal(cr4.code, 'CR4-A');
  assert.equal(cr4.total, 1200);
  assert.equal(cr4.done, 1200);
  assert.equal(cr4.pending, 0);
  assert.equal(Math.round(cr4.done / cr4.total * 100), 100);
});


test('Inteligencia carga dinámicamente los lotes CHR y calcula su avance', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  assert.match(source, /STANDARD_LOT_MODELS=\['NKD','CR4 150','CR4 125','XRS-180','CHR'\]/);
  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  const isolated = source.slice(0, bootstrap) + 'globalThis.__aktIntelTest = { groupsByOperation };})();';
  const context = { document: {}, console };
  vm.runInNewContext(isolated, context);
  const groups = context.__aktIntelTest.groupsByOperation([
    { id: 'CHR-PRE5', puesto: 'PRE 5', lote: 300, entregado: 120, entregas: [{ cantidad: 120 }], standardMoto: 'CHR', codigoLoteOperacion: 'CHR-012' }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].model, 'CHR');
  assert.equal(groups[0].total, 300);
  assert.equal(groups[0].done, 120);
  assert.equal(groups[0].pending, 180);
  assert.equal(Math.round(groups[0].done / groups[0].total * 100), 40);
});


test('Inteligencia conserva solo el lote vigente más reciente de cada modelo', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  const isolated = source.slice(0, bootstrap) + 'globalThis.__aktIntelTest = { groupsByOperation, flattenWorkLotProgress };})();';
  const context = { document: {}, console };
  vm.runInNewContext(isolated, context);
  const rows = context.__aktIntelTest.flattenWorkLotProgress({ lots: [
    { id: 'nkd-711', model: 'NKD', active: true, number: 4, codigoLoteOperacion: 'KK711', tasks: [{ id: 'a', lote: 100, entregado: 80 }] },
    { id: 'nkd-next', model: 'NKD', active: false, number: 5, codigoLoteOperacion: '', tasks: [{ id: 'b', lote: 200, entregado: 0 }] }
  ] }, [
    { id: 'a', standardMoto: 'NKD', codigoLoteOperacion: 'KK711' }
  ]);
  assert.equal(rows.get('NKD').length, 1);
  assert.equal(rows.get('NKD')[0].codigoLoteOperacion, 'KK711');
  assert.equal(rows.get('NKD')[0].__progressLotKey, 'nkd-711');
  const groups = context.__aktIntelTest.groupsByOperation(rows.get('NKD'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].done, 80);
  assert.equal(groups[0].pending, 20);
});

test('Inteligencia recupera el código del lote desde la tarea local con el mismo ID', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  const isolated = source.slice(0, bootstrap) + 'globalThis.__aktIntelTest = { groupsByOperation, flattenWorkLotProgress };})();';
  const context = { document: {}, console };
  vm.runInNewContext(isolated, context);
  const rows = context.__aktIntelTest.flattenWorkLotProgress({ lots: [
    { id: 'worklot-711', model: 'NKD', active: true, number: 711, tasks: [
      { id: 'ref-1', lote: 100, entregado: 90 },
      { id: 'ref-2', lote: 100, entregado: 0 }
    ] }
  ] }, [
    { id: 'ref-1', standardMoto: 'NKD', codigoLoteOperacion: 'KK711' },
    { id: 'ref-2', standardMoto: 'NKD', codigoLoteOperacion: 'KK711' }
  ]);
  const groups = context.__aktIntelTest.groupsByOperation(rows.get('NKD'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].code, 'KK711');
  assert.equal(groups[0].done, 90);
  assert.equal(groups[0].pending, 110);
  assert.equal(groups[0].lotNumber, 711);
});


test('Inteligencia muestra varios lotes iniciados del mismo modelo y excluye preparados', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  const isolated = source.slice(0, bootstrap) + 'globalThis.__aktIntelTest = { groupsByOperation, flattenWorkLotProgress };})();';
  const context = { document: {}, console };
  vm.runInNewContext(isolated, context);
  const rows = context.__aktIntelTest.flattenWorkLotProgress({ lots: [
    { id: 'nkd-a', model: 'NKD', active: true, number: 8, codigoLoteOperacion: 'KK888', tasks: [{ id: 'saved-a', lote: 100, entregado: 25 }] },
    { id: 'nkd-b', model: 'NKD', active: true, number: 9, codigoLoteOperacion: 'KK889', tasks: [{ id: 'saved-b', lote: 200, entregado: 50 }] },
    { id: 'nkd-prepared', model: 'NKD', active: false, number: 10, codigoLoteOperacion: 'KK890', tasks: [{ id: 'prepared', lote: 300, entregado: 0 }] },
    { id: 'chr-live', model: 'CHR', active: true, number: 2, codigoLoteOperacion: 'CHR-02', tasks: [{ id: 'chr-saved', lote: 80, entregado: 40 }] }
  ]});
  assert.equal(rows.get('NKD').length, 2);
  assert.equal(rows.get('CHR').length, 1);
  const groups = context.__aktIntelTest.groupsByOperation(rows.get('NKD'));
  assert.equal(groups.length, 2);
  assert.equal(groups.map(group => group.code).sort().join(','), 'KK888,KK889');
  assert.equal(groups.reduce((sum, group) => sum + group.done, 0), 75);
});


test('Inteligencia normaliza CR4-150 y no depende de que los IDs estén en tareas locales', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  const isolated = source.slice(0, bootstrap) + 'globalThis.__aktIntelTest = { groupsByOperation, flattenWorkLotProgress };})();';
  const context = { document: {}, console };
  vm.runInNewContext(isolated, context);
  const rows = context.__aktIntelTest.flattenWorkLotProgress({ lots: [
    { id: 'cr4-150-live', model: 'CR4 150', active: true, number: 3, codigoLoteOperacion: 'CR4-150-03', tasks: [{ id: 'independent-id', lote: 150, entregado: 45 }] }
  ]});
  assert.equal(rows.get('CR4 150').length, 1);
  const groups = context.__aktIntelTest.groupsByOperation(rows.get('CR4 150'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].model, 'CR4-150');
  assert.equal(groups[0].done, 45);
});
