'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/index.html'),'utf8');
const start=html.indexOf('function tareasSinDuplicadosEstandar(tasks){');
const end=html.indexOf('\nfunction mostrarEntregasZona',start);
assert.ok(start>=0&&end>start,'debe existir la función de deduplicación');
const source=html.slice(start,end);
const context={
 modeloDeTareaEstandar:x=>x.standardMoto||(x.standardNKD?'NKD':''),
 normalizarPuestoEstandar:x=>String(x||'').trim()
};
vm.runInNewContext(source+';this.dedupe=tareasSinDuplicadosEstandar;',context);
test('conserva referencias distintas sin EAN en el mismo puesto',()=>{
 const tasks=[
  {id:'a',standardNKD:true,standardMoto:'CR4 150',ean:'0',producto:'Tornillo batería M5',puesto:'18 Derecho',lpn:'lote1'},
  {id:'b',standardNKD:true,standardMoto:'CR4 150',ean:'0',producto:'Tuerca batería M5',puesto:'18 Derecho',lpn:'lote1'}
 ];
 assert.deepEqual(Array.from(context.dedupe(tasks),x=>x.id).sort(),['a','b']);
});
test('consolida la misma referencia sin EAN repetida entre patinadores',()=>{
 const tasks=[
  {id:'a',standardNKD:true,standardMoto:'CR4 150',ean:'0',producto:'Tornillo batería M5',puesto:'18 Derecho',lpn:'lote1'},
  {id:'b',standardNKD:true,standardMoto:'CR4 150',ean:'0',producto:'Tornillo batería M5',puesto:'18 Derecho',lpn:'lote1'}
 ];
 assert.equal(context.dedupe(tasks).length,1);
});
test('CHR usa número de referencia para distinguir referencias con EAN 0',()=>{
 const tasks=[
  {id:'a',standardNKD:true,standardMoto:'CHR',ean:'0',numeroReferencia:'12',producto:'Tornillo',puesto:'PRE 1',lpn:'lote1'},
  {id:'b',standardNKD:true,standardMoto:'CHR',ean:'0',numeroReferencia:'13',producto:'Tornillo',puesto:'PRE 1',lpn:'lote1'}
 ];
 assert.deepEqual(Array.from(context.dedupe(tasks),x=>x.id).sort(),['a','b']);
});
test('no fusiona el mismo EAN cuando pertenece a lotes distintos',()=>{
 const tasks=[
  {id:'a',standardNKD:true,standardMoto:'CR4 150',ean:'77001',producto:'Pieza',puesto:'18 Derecho',codigoLoteOperacion:'KK766'},
  {id:'b',standardNKD:true,standardMoto:'CR4 150',ean:'77001',producto:'Pieza',puesto:'18 Derecho',codigoLoteOperacion:'KK767B'}
 ];
 assert.equal(context.dedupe(tasks).length,2);
});
