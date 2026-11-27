const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
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
  }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'work-lots.json'), JSON.stringify([{
    id: 'lot-1', model: 'NKD', number: 711, codigoLoteOperacion: 'KK711',
    createdAt: '2026-11-26T12:00:00.000Z', tasks: [task],
  }], null, 2));
  fs.writeFileSync(path.join(tempDir, 'work-lot-selections.json'), JSON.stringify({
    'ana|NKD': { lotId: 'lot-1', startedAt: '2026-11-26T12:00:00.000Z', updatedAt: '2026-11-26T12:00:00.000Z' },
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

  const coordinatorState = await request(base, '/api/state', { token: coordinator });
  assert.equal(coordinatorState.status, 200);
  assert.deepEqual(Object.keys(coordinatorState.data.users), ['ana'], 'Coordinación solo debe consultar perfiles Patinador');
  assert.equal(coordinatorState.data.tareasArchivadas, undefined, 'Coordinación no debe recibir el historial administrativo');
  assert.equal(coordinatorState.data.tasks.length, 1, 'Coordinación puede consultar tareas operativas');

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
