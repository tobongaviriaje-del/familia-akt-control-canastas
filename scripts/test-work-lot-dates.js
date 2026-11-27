const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('server.js', 'utf8');
const start = source.indexOf('function workLotNumber(v)');
const end = source.indexOf('function workLotVisibleRows(row,rows)', start);
assert(start >= 0 && end > start, 'No se encontraron las funciones de cálculo y fecha de lotes');

const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.logic = { workLotNumber, workLotTarget, workLotBogotaDate, workLotBogotaDateOffset, workLotIsCompleted, workLotRecentlyCompleted };', context);
const logic = context.logic;

const rowAt = (date, delivered = 10) => ({
  completedAt: date,
  tasks: [{ cantidad: 10, entregado: delivered }]
});
const today = new Date('2026-11-26T17:00:00.000Z'); // 12:00 en Bogotá
const currentBogotaDay = '2026-11-26';

assert.equal(logic.workLotBogotaDate('2026-11-27T04:59:59.000Z'), '2026-11-26', 'Debe respetar el día local antes de medianoche Bogotá');
assert.equal(logic.workLotBogotaDate('2026-11-27T05:00:01.000Z'), '2026-11-27', 'Debe cambiar de día justo después de medianoche Bogotá');
assert.equal(logic.workLotBogotaDateOffset('2026-03-01', -1), '2026-02-28', 'Debe manejar cambio de mes');
assert.equal(logic.workLotBogotaDateOffset('2026-01-01', -1), '2025-12-31', 'Debe manejar cambio de año');
assert.equal(logic.workLotBogotaDateOffset('2024-03-01', -1), '2024-02-29', 'Debe manejar año bisiesto');

assert.equal(logic.workLotRecentlyCompleted(rowAt('2026-11-26T17:00:00.000Z'), today), true, 'Lote completado hoy debe mostrarse');
assert.equal(logic.workLotRecentlyCompleted(rowAt('2026-11-25T17:00:00.000Z'), today), true, 'Lote completado ayer debe mostrarse durante el día de gracia');
assert.equal(logic.workLotRecentlyCompleted(rowAt('2026-11-24T17:00:00.000Z'), today), false, 'Lote completado anteayer debe ocultarse');
assert.equal(logic.workLotRecentlyCompleted(rowAt('2026-11-26T17:00:00.000Z', 9), today), false, 'Lote incompleto no debe clasificarse como terminado');
assert.equal(logic.workLotRecentlyCompleted({ tasks: [] }, today), false, 'Lote sin tareas no debe clasificarse como terminado');

assert.equal(logic.workLotTarget({ lote: 500, cantidad: 5, continuidadDeTareaId: 'continuidad-1' }), 5, 'La continuidad debe tomar las unidades pendientes');
assert.equal(logic.workLotTarget({ lote: 500, cantidad: 500 }), 500, 'El objetivo de lote normal debe conservarse');

process.stdout.write('OK: fechas Bogotá, límites de día, mes/año, bisiesto, ventana ayer-hoy y objetivos de continuidad.\n');
