'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Inteligencia muestra KK711 y calcula avance desde el acumulado entregado sin duplicar eventos ni correcciones', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  assert.match(source, /\/api\/work-lots\/overview\?model=NKD&code=KK711/);
  assert.match(source, /codigoLoteOperacion:lotCode/);

  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  assert.notEqual(bootstrap, -1, 'se debe encontrar el arranque de la interfaz');
  const isolated = source.slice(0, bootstrap) +
    'globalThis.__aktIntelTest = { groupsByOperation };})();';
  const context = { document: {}, console };
  vm.runInNewContext(isolated, context);

  const sample = [
    { id: 'PRE26', puesto: 'PRE 26', lote: 600, entregado: 600, entregas: [{ cantidad: 600 }], correcciones: [{ unidades: 336 }] },
    { id: 'D5', puesto: 'Derecho 5', lote: 600, entregado: 0, entregas: [], correcciones: [{ unidades: 600 }] },
    { id: 'D6', puesto: 'Derecho 6', lote: 600, entregado: 600, entregas: [{ cantidad: 600 }], correcciones: [{ unidades: 600 }] },
    { id: 'PRE12', puesto: 'PRE 12', lote: 600, entregado: 600, entregas: [{ cantidad: 600 }], correcciones: [{ unidades: 600 }] },
    { id: 'PRE22', puesto: 'PRE 22', lote: 600, entregado: 600, entregas: [{ cantidad: 600 }], correcciones: [{ unidades: 135 }] }
  ].map(task => ({ ...task, standardNKD: true, standardMoto: 'NKD', codigoLoteOperacion: 'KK711' }));

  const groups = context.__aktIntelTest.groupsByOperation(sample);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].code, 'KK711');
  assert.equal(groups[0].total, 3000);
  assert.equal(groups[0].done, 2400);
  assert.equal(groups[0].pending, 600);
  assert.equal(Math.round(groups[0].done / groups[0].total * 100), 80);
});
