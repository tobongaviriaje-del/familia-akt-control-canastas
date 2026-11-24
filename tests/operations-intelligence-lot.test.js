'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Inteligencia consulta dinámicamente los lotes vigentes de todos los modelos habilitados', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/operaciones-inteligentes.js'), 'utf8');
  assert.match(source, /STANDARD_LOT_MODELS=\['NKD','CR4 150','CR4 125','XRS-180'\]/);
  assert.match(source, /overview\?model=\x27\+encodeURIComponent\(modelName\)/);
  assert.match(source, /standardMoto:modelName/);
  assert.doesNotMatch(source, /overview\?model=NKD&code=KK711/);

  const bootstrap = source.indexOf("if(document.readyState==='loading')");
  assert.notEqual(bootstrap, -1, 'se debe encontrar el arranque de la interfaz');
  const isolated = source.slice(0, bootstrap) +
    'globalThis.__aktIntelTest = { groupsByOperation };})();';
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
