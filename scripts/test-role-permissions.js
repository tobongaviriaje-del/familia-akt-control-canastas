const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

// Regression visual: Coordinación comparte el panel operativo, pero no debe mostrar
// paneles ni acciones exclusivas del Administrador. Supervisión conserva su vista aparte.
const uiSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
assert.match(uiSource, /const coordinator=!!\(current&&current\.role==='Coordinador'\);/);
assert.match(uiSource, /app\.classList\.toggle\('cc-coordinator-view',!!coordinator\);/);
assert.match(uiSource, /cc-coordinator-view #adminPanel/);
assert.match(uiSource, /cc-coordinator-view #historialTareasPanel/);
assert.match(uiSource, /cc-coordinator-view #resetDemoBtn/);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akt-role-tests-'));
let child;
let output = '';

function fixture() {
  const event = { patinador: 'Ana', cantidad: 50, fechaHora: '26/11/2026 08:00', metodo: 'manual', numeroOperacion: 'KK711', turno: 'Día' };
  const task = {
    id: 'task-1', standardNKD: true, standardMoto: 'NKD',
    codigoLoteOperacion: 'KK711', ean: '770000000001', producto: 'Referencia de prueba',
    puesto: 'PRE 1', cantidad: 100, entregado: 50, estado: 'En proceso',
    entregas: [event], entrega: { ...event }, canastasEntregadas: 0,
  };
  const users = {
    admin: { pass: 'Admin-test-2026!', role: 'Admin', name: 'Admin de prueba' },
    coord: { pass: 'Coord-test-2026!', role: 'Coordinador', name: 'Coordinación' },
    supervisor: { pass: 'Super-test-2026!', role: 'Supervisor', name: 'Supervisión' },
    ana: { pass: 'Ana-test-2026!', role: 'Patinador', name: 'Ana', puestos: ['PRE 1'], areas: ['PRE'] },
  };
  fs.writeFileSync(path.join(tempDir, 'state.json'), JSON.stringify({
    users, tasks: [task], lpnCatalog: ['TEST'], freeDeliveries: [],
    estibasRecibidas: [], queuedStandardBatches: [],
    tareasArchivadas: [{ id: 'archive-1' }],
    adminConfig: { maintenanceMode: true },
    permissions: { canManageUsers: true },
    systemSettings: { secretFlag: 'admin-only' },
    auditLog: [{ id: 'audit-1' }],
  }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'work-lots.json'), JSON.stringify([{
    id: 'lot-1', model: 'NKD', number: 711, codigoLoteOperacion: 'KK711',
    createdAt: '2026-11-26T12:00:00.000Z', tasks: [task],
  }], null, 2));
  fs.writeFileSync(path.join(tempDir, 'work-lot-selections.json'), JSON.stringify({
    'ana|NKD': { lotId: 'lot-1', startedAt: '2026-11-26T12:00:00.000Z', updatedAt: '2026-11-26T12:00:00.000Z' },
  }, null, 2));
}


function multiFixture() {
  const makeTask = (id, model, code, ean, position, skater, target, delivered) => {
    const event = { patinador: skater, cantidad: delivered, fechaHora: '27/11/2026 08:00', metodo: 'manual', numeroOperacion: code, turno: 'Día' };
    return { id, standardNKD: true, standardMoto: model, codigoLoteOperacion: code, ean,
      producto: 'Referencia ' + id, puesto: position, cantidad: target, entregado: delivered,
      estado: delivered >= target ? 'Entregada' : 'En proceso', entregas: [event], entrega: { ...event }, canastasEntregadas: 0 };
  };
  const nkdTasks = [
    makeTask('nkd-1', 'NKD', 'KK711', '770000000101', 'PRE 1', 'Ana', 100, 50),
    makeTask('nkd-2', 'NKD', 'KK711', '770000000102', 'PRE 2', 'Beto', 100, 20),
  ];
  const chrTasks = [
    makeTask('chr-1', 'CHR', 'CH900', '770000000201', 'PRE 1', 'Ana', 200, 100),
    makeTask('chr-2', 'CHR', 'CH900', '770000000202', 'PRE 2', 'Beto', 100, 25),
  ];
  const users = {
    admin: { pass: 'Admin-test-2026!', role: 'Admin', name: 'Admin de prueba' },
    coord: { pass: 'Coord-test-2026!', role: 'Coordinador', name: 'Coordinación' },
    supervisor: { pass: 'Super-test-2026!', role: 'Supervisor', name: 'Supervisión' },
    ana: { pass: 'Ana-test-2026!', role: 'Patinador', name: 'Ana', puestos: ['PRE 1'], areas: ['PRE'] },
    beto: { pass: 'Beto-test-2026!', role: 'Patinador', name: 'Beto', puestos: ['PRE 2'], areas: ['PRE'] },
  };
  fs.writeFileSync(path.join(tempDir, 'state.json'), JSON.stringify({
    users, tasks: [...nkdTasks, ...chrTasks], lpnCatalog: [], freeDeliveries: [],
    estibasRecibidas: [], queuedStandardBatches: [], tareasArchivadas: [],
  }, null, 2));
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const closedHistoricalTask = makeTask('nkd-closed-yesterday', 'NKD', 'KK710', '770000000099', 'PRE 3', 'Ana', 40, 40);
  fs.writeFileSync(path.join(tempDir, 'work-lots.json'), JSON.stringify([
    { id: 'lot-nkd-closed', model: 'NKD', number: 710, codigoLoteOperacion: 'KK710', createdAt: yesterday, updatedAt: yesterday, completedAt: yesterday, tasks: [closedHistoricalTask] },
    { id: 'lot-nkd', model: 'NKD', number: 711, codigoLoteOperacion: 'KK711', createdAt: '2026-11-27T12:00:00.000Z', updatedAt: '2026-11-27T12:00:00.000Z', tasks: nkdTasks },
    { id: 'lot-chr', model: 'CHR', number: 900, codigoLoteOperacion: 'CH900', createdAt: '2026-11-27T12:00:00.000Z', updatedAt: '2026-11-27T12:00:00.000Z', tasks: chrTasks },
  ], null, 2));
  fs.writeFileSync(path.join(tempDir, 'work-lot-selections.json'), JSON.stringify({
    'ana|NKD': { lotId: 'lot-nkd', startedAt: '2026-11-27T12:00:00.000Z', updatedAt: '2026-11-27T12:00:00.000Z' },
    'beto|CHR': { lotId: 'lot-chr', startedAt: '2026-11-27T12:00:00.000Z', updatedAt: '2026-11-27T12:00:00.000Z' },
  }, null, 2));
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(base) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('El servidor terminó antes de iniciar:\n' + output);
    try {
      const response = await fetch(base + '/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor no respondió /health:\n' + output);
}

async function request(base, route, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + route, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data };
}

async function login(base, username, password) {
  const result = await request(base, '/api/login', { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, 'Debe permitir el ingreso del perfil ' + username + ': ' + JSON.stringify(result.data));
  assert.ok(result.data.token, 'El ingreso debe emitir un token de sesión');
  return result.data.token;
}

async function main() {
  fixture();
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: tempDir, ADMIN_INITIAL_PASSWORD: 'Initial-test-password-2026!' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  await waitForServer(base);

  const unauthenticated = await request(base, '/api/state');
  assert.equal(unauthenticated.status, 401, 'GET /api/state debe exigir sesión');

  const admin = await login(base, 'admin', 'Admin-test-2026!');
  const coordinator = await login(base, 'coord', 'Coord-test-2026!');
  const supervisor = await login(base, 'supervisor', 'Super-test-2026!');
  const skater = await login(base, 'ana', 'Ana-test-2026!');

  const adminState = await request(base, '/api/state', { token: admin });
  assert.equal(adminState.status, 200);
  assert.ok(adminState.data.users.admin && adminState.data.users.coord && adminState.data.users.supervisor);
  assert.equal(adminState.data.users.admin.pass, undefined, 'Nunca debe devolver contraseñas');
  assert.equal(adminState.data.tasks.length, 1, 'Admin conserva el estado completo de producción');
  assert.deepEqual(adminState.data.adminConfig, { maintenanceMode: true }, 'Admin conserva configuración administrativa');
  assert.deepEqual(adminState.data.permissions, { canManageUsers: true }, 'Admin conserva permisos administrativos');
  assert.deepEqual(adminState.data.systemSettings, { secretFlag: 'admin-only' }, 'Admin conserva ajustes del sistema');
  assert.deepEqual(adminState.data.auditLog, [{ id: 'audit-1' }], 'Admin conserva auditoría');

  const coordinatorState = await request(base, '/api/state', { token: coordinator });
  assert.equal(coordinatorState.status, 200);
  assert.deepEqual(Object.keys(coordinatorState.data.users), ['ana'], 'Coordinación solo debe consultar perfiles Patinador');
  assert.equal(coordinatorState.data.tareasArchivadas, undefined, 'Coordinación no debe recibir el historial administrativo');
  assert.deepEqual(Object.keys(coordinatorState.data).sort(), [
    'estibasRecibidas', 'freeDeliveries', 'lpnCatalog', 'queuedStandardBatches', 'tasks', 'users',
  ], 'Coordinación recibe únicamente la lista permitida de datos operativos');
  for (const key of ['adminConfig', 'permissions', 'systemSettings', 'auditLog', 'adminRecoveryUsed', 'patinadoresAuth']) {
    assert.equal(coordinatorState.data[key], undefined, 'Coordinación no debe recibir el campo administrativo ' + key);
  }
  assert.equal(coordinatorState.data.tasks.length, 1, 'Coordinación puede consultar tareas operativas');
  assert.deepEqual(coordinatorState.data.queuedStandardBatches, [], 'Coordinación conserva el flujo operativo de lotes en cola');
  assert.deepEqual(coordinatorState.data.estibasRecibidas, [], 'Coordinación conserva la consulta operativa de estibas');

  const supervisorState = await request(base, '/api/state', { token: supervisor });
  assert.equal(supervisorState.status, 200);
  assert.deepEqual(supervisorState.data.users, {}, 'Supervisor no debe recibir usuarios');
  assert.deepEqual(supervisorState.data.tasks, [], 'Supervisor no debe recibir referencias ni registros operativos');

  const coordinatorProgress = await request(base, '/api/admin/work-lots/progress', { token: coordinator });
  assert.equal(coordinatorProgress.status, 200);
  assert.ok(coordinatorProgress.data.lots[0].tasks, 'Coordinación puede consultar el detalle operativo autorizado');

  const supervisorProgress = await request(base, '/api/admin/work-lots/progress', { token: supervisor });
  assert.equal(supervisorProgress.status, 200);
  assert.equal(supervisorProgress.data.soloLectura, true);
  assert.equal(supervisorProgress.data.lots[0].percentage, 50);
  assert.equal(supervisorProgress.data.lots[0].skaters[0].percentage, 50);
  assert.equal(supervisorProgress.data.lots[0].tasks, undefined, 'Supervisor solo recibe porcentajes, nunca tareas o referencias');
  assert.equal(supervisorProgress.data.lots[0].totalUnits, undefined, 'Supervisor no debe recibir cantidades');

  const assistantSupervisor = await request(base, '/api/assistant/production-summary', { token: supervisor });
  assert.equal(assistantSupervisor.status, 200);
  assert.equal(assistantSupervisor.data.soloLectura, true);
  assert.equal(assistantSupervisor.data.lots[0].percentage, 50);
  assert.equal(assistantSupervisor.data.lots[0].totalUnits, undefined, 'El asistente debe respetar el recorte del Supervisor');
  assert.equal(assistantSupervisor.data.skaters[0].percentage, 50);
  assert.equal(assistantSupervisor.data.skaters[0].deliveredUnits, undefined);

  const assistantAdmin = await request(base, '/api/assistant/production-summary', { token: admin });
  assert.equal(assistantAdmin.status, 200);
  assert.equal(assistantAdmin.data.lots[0].totalUnits, 100, 'Admin conserva el detalle cuantitativo del asistente');

  const assistantSkater = await request(base, '/api/assistant/production-summary', { token: skater });
  assert.equal(assistantSkater.status, 200);
  assert.equal(assistantSkater.data.summary.percentage, 50, 'El patinador solo debe recibir su propio avance');
  assert.equal(assistantSkater.data.summary.deliveredUnits, 50, 'Los eventos duplicados no deben contar dos veces');

  const supervisorPhotos = await request(base, '/api/reference-photos/nkd/manifest', { token: supervisor });
  assert.equal(supervisorPhotos.status, 403, 'Supervisor no puede consultar fotos/catalogación de referencias');
  for (const [role, token] of [['Admin', admin], ['Coordinador', coordinator], ['Patinador', skater]]) {
    const photos = await request(base, '/api/reference-photos/nkd/manifest', { token });
    assert.equal(photos.status, 404, role + ' debe tener permiso de lectura de fotos (el fixture no tiene manifiesto)');
  }

  const coordinatorAdminAction = await request(base, '/api/admin/patinadores-credentials', {
    method: 'POST', token: coordinator, body: { passDia: 'test-dia', passNoche: 'test-noche' },
  });
  assert.equal(coordinatorAdminAction.status, 403, 'Coordinación no puede cambiar credenciales administrativas');

  const forbiddenCoordinatorWrite = await request(base, '/api/state', {
    method: 'PUT', token: coordinator,
    body: { ...coordinatorState.data, tasks: [{ ...coordinatorState.data.tasks[0], producto: 'Cambio no autorizado' }] },
  });
  assert.equal(forbiddenCoordinatorWrite.status, 403, 'Coordinación no puede cambiar referencias');

  const allowedCoordinatorWrite = await request(base, '/api/state', {
    method: 'PUT', token: coordinator,
    body: { ...coordinatorState.data, tasks: [{ ...coordinatorState.data.tasks[0], entregado: 60, estado: 'En proceso' }] },
  });
  assert.equal(allowedCoordinatorWrite.status, 200, 'Coordinación puede guardar avance operativo');

  const forbiddenSupervisorWrite = await request(base, '/api/state', {
    method: 'PUT', token: supervisor,
    body: { tasks: [] },
  });
  assert.equal(forbiddenSupervisorWrite.status, 403, 'Supervisor es de solo consulta');

  const adminAction = await request(base, '/api/admin/patinadores-credentials', {
    method: 'POST', token: admin, body: { passDia: 'test-dia', passNoche: 'test-noche' },
  });
  assert.equal(adminAction.status, 200, 'Admin conserva funciones administrativas');


  // Fixture aislado multi-lote: NKD + CHR, dos tareas y dos patinadores por lote.
  // Los eventos se reflejan en entregas y entrega; deben contarse una sola vez.
  multiFixture();
  const beto = await login(base, 'beto', 'Beto-test-2026!');
  const multiSupervisor = await request(base, '/api/admin/work-lots/progress', { token: supervisor });
  assert.equal(multiSupervisor.status, 200);
  assert.equal(multiSupervisor.data.lots.length, 2, 'Supervisor debe ver ambos lotes activos, incluido CHR');
  const nkdSummary = multiSupervisor.data.lots.find(lot => lot.model === 'NKD');
  const chrSummary = multiSupervisor.data.lots.find(lot => lot.model === 'CHR');
  assert.ok(nkdSummary && chrSummary, 'Deben aparecer NKD y CHR');
  assert.equal(nkdSummary.percentage, 35, 'NKD debe sumar dos tareas: 70/200');
  assert.equal(chrSummary.percentage, 125 / 300 * 100, 'CHR debe sumar dos tareas: 125/300');
  assert.deepEqual(nkdSummary.skaters.map(x => [x.name, x.percentage]), [['Ana', 50], ['Beto', 20]]);
  assert.deepEqual(chrSummary.skaters.map(x => [x.name, x.percentage]), [['Ana', 50], ['Beto', 25]]);
  for (const lot of multiSupervisor.data.lots) {
    assert.equal(lot.totalUnits, undefined, 'Supervisor no recibe cantidades');
    assert.equal(lot.tasks, undefined, 'Supervisor no recibe referencias ni tareas');
  }

  const multiAssistantSupervisor = await request(base, '/api/assistant/production-summary', { token: supervisor });
  assert.equal(multiAssistantSupervisor.status, 200);
  assert.equal(multiAssistantSupervisor.data.lots.length, 2, 'Asistente debe incluir ambos modelos');
  assert.ok(multiAssistantSupervisor.data.lots.some(lot => lot.model === 'CHR'));
  assert.ok(multiAssistantSupervisor.data.lots.every(lot => lot.totalUnits === undefined && lot.deliveredUnits === undefined));
  assert.equal(multiAssistantSupervisor.data.skaters.length, 4, 'Asistente debe incluir ambos patinadores por modelo');
  assert.ok(multiAssistantSupervisor.data.skaters.every(row => row.totalUnits === undefined && row.deliveredUnits === undefined));

  const multiAnaAssistant = await request(base, '/api/assistant/production-summary', { token: skater });
  assert.equal(multiAnaAssistant.status, 200);
  assert.equal(multiAnaAssistant.data.summary.totalUnits, 300, 'Ana suma NKD y CHR en sus puestos');
  assert.equal(multiAnaAssistant.data.summary.deliveredUnits, 150, 'Ana no duplica eventos');
  assert.equal(multiAnaAssistant.data.summary.percentage, 50);
  const multiBetoAssistant = await request(base, '/api/assistant/production-summary', { token: beto });
  assert.equal(multiBetoAssistant.status, 200);
  assert.equal(multiBetoAssistant.data.summary.totalUnits, 200);
  assert.equal(multiBetoAssistant.data.summary.deliveredUnits, 45);
  assert.equal(multiBetoAssistant.data.summary.percentage, 22.5);

  const multiCoordinator = await request(base, '/api/admin/work-lots/progress', { token: coordinator });
  assert.equal(multiCoordinator.status, 200);
  assert.equal(multiCoordinator.data.lots.length, 2, 'Coordinación ve ambos lotes');
  assert.ok(multiCoordinator.data.lots.every(lot => Array.isArray(lot.tasks)), 'Coordinación conserva detalle operativo');

  process.stdout.write('OK: integración HTTP, sesiones, permisos Admin/Coordinador/Supervisor/Patinador, porcentajes, asistente, fotos y escrituras restringidas.\n');
}

main()
  .catch(error => {
    process.stderr.write((error && error.stack || String(error)) + '\n' + output);
    process.exitCode = 1;
  })
  .finally(() => {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });
