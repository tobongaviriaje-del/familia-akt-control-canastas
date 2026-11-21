'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('El servidor de prueba terminó antes de iniciar.');
    try {
      const response = await fetch(baseUrl + '/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor de prueba no respondió /health.');
}

async function request(baseUrl, route, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(baseUrl + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

test('protege credenciales, cambios administrativos y cierre de jornada', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-security-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(temp, 'public'));
  fs.copyFileSync(path.join(repoRoot, 'server.js'), path.join(temp, 'server.js'));
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
    users: {
      admin: { pass: 'AdminTest123', role: 'Admin', name: 'Admin de prueba' },
      supervisor: { pass: 'SupervisorTest123', role: 'Supervisor', name: 'Supervisor de prueba' },
      patinador: { pass: 'PatinadorTest123', role: 'Patinador', name: 'Patinador de prueba', puestos: ['PRE 1'] }
    },
    patinadoresAuth: { passDia: 'DiaTest123', passNoche: 'NocheTest123' },
    lpnCatalog: [{ id: 'LPN-ORIGINAL' }],
    tasks: [{ id: 'T-1', standardNKD: true, standardMoto: 'NKD', lote: 10, cantidad: 10, entregado: 2, estado: 'Parcial', puesto: 'PRE 1', entregas: [], entrega: null, canastasEntregadas: 0, confirmacionesCanastas: [], correcciones: [] }]
  }, null, 2));

  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: temp,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(resolve, 1500).unref(); });
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitForHealth(baseUrl, child);

  async function login(username, password) {
    const result = await request(baseUrl, '/api/login', { method: 'POST', body: { username, password } });
    assert.equal(result.status, 200, 'login de ' + username + ' debe funcionar');
    return result.data.token;
  }

  const supervisorToken = await login('supervisor', 'SupervisorTest123');
  const patinadorToken = await login('patinador', 'PatinadorTest123');
  const adminToken = await login('admin', 'AdminTest123');

  const sharedLogin = await request(baseUrl, '/api/login', {
    method: 'POST', body: { username: 'patinadores', password: 'DiaTest123' }
  });
  assert.equal(sharedLogin.status, 200, 'el ingreso compartido de Patinadores debe funcionar');
  const sharedToken = sharedLogin.data.token;
  const sharedLot = await request(baseUrl, '/api/work-lots?model=NKD&username=patinador', { token: sharedToken });
  assert.equal(sharedLot.status, 200, 'el token compartido debe abrir el lote del perfil seleccionado');
  assert.equal(sharedLot.data.tasks.length, 1);
  const previousTask = sharedLot.data.tasks[0];
  const movement = { cantidad: 1, canastasFisicas: 0 };
  const sharedSave = await request(baseUrl, '/api/work-lots', {
    token: sharedToken,
    method: 'PUT',
    body: {
      username: 'patinador', model: 'NKD', lotId: sharedLot.data.lot.id,
      version: sharedLot.data.lot.updatedAt,
      tasks: [{ ...previousTask, entregado: 3, estado: 'Parcial', entregas: [movement], entrega: movement }]
    }
  });
  assert.equal(sharedSave.status, 200, 'el Patinador compartido debe poder guardar una entrega asignada');
  assert.equal(sharedSave.data.tasks[0].entregado, 3);

  const safeState = await request(baseUrl, '/api/state', { token: supervisorToken });
  assert.equal(safeState.status, 200);
  assert.equal(safeState.data.patinadoresAuth, undefined);
  for (const user of Object.values(safeState.data.users)) {
    assert.equal(user.pass, undefined);
    assert.equal(user.passDia, undefined);
    assert.equal(user.passNoche, undefined);
  }

  const forbiddenCloseSupervisor = await request(baseUrl, '/api/jornada/cerrar', {
    token: supervisorToken, method: 'POST', body: { confirmacion: 'CERRAR JORNADA' }
  });
  assert.equal(forbiddenCloseSupervisor.status, 403);

  const forbiddenClosePatinador = await request(baseUrl, '/api/jornada/cerrar', {
    token: patinadorToken, method: 'POST', body: { confirmacion: 'CERRAR JORNADA' }
  });
  assert.equal(forbiddenClosePatinador.status, 403);


  const patinadorProtectedWrite = await request(baseUrl, '/api/state', {
    token: patinadorToken, method: 'PUT',
    body: { users: { admin: { role: 'Patinador', pass: 'ROBBED' }, intruso: { role: 'Admin', pass: 'x' } } }
  });
  assert.equal(patinadorProtectedWrite.status, 200);
  assert.equal(patinadorProtectedWrite.data.users.admin.role, 'Admin');
  assert.equal(patinadorProtectedWrite.data.users.intruso, undefined);

  const patinadorTaskWrite = await request(baseUrl, '/api/state', {
    token: patinadorToken, method: 'PUT',
    body: { tasks: [{ id: 'T-1', standardNKD: true, standardMoto: 'NKD', lote: 10, cantidad: 10, entregado: 10, estado: 'Entregada', puesto: 'PRE 1' }] }
  });
  assert.equal(patinadorTaskWrite.status, 403, 'un Patinador no debe alterar tareas desde el estado global');
  const stateAfterPatinadorTaskWrite = await request(baseUrl, '/api/state', { token: adminToken });
  assert.equal(stateAfterPatinadorTaskWrite.data.tasks[0].entregado, 2, 'la tarea original debe permanecer intacta');

  const protectedWrite = await request(baseUrl, '/api/state', {
    token: supervisorToken,
    method: 'PUT',
    body: {
      users: { admin: { pass: 'ROBBED', role: 'Supervisor' }, intruso: { pass: 'x', role: 'Admin' } },
      lpnCatalog: [{ id: 'LPN-ALTERADO' }],
      freeDeliveries: [{ id: 'ENTREGA-ALTERADA' }],
      tasks: [{ id: 'T-1', cantidad: 10, entregado: 3, estado: 'Parcial', puesto: 'PRE 1' }]
    }
  });
  assert.equal(protectedWrite.status, 200);
  assert.equal(protectedWrite.data.users.admin.role, 'Admin');
  assert.equal(protectedWrite.data.users.intruso, undefined);
  assert.deepEqual(protectedWrite.data.lpnCatalog, [{ id: 'LPN-ORIGINAL' }]);
  assert.deepEqual(protectedWrite.data.freeDeliveries, []);
  assert.equal(protectedWrite.data.users.admin.pass, undefined);

  const adminWrite = await request(baseUrl, '/api/state', {
    token: adminToken,
    method: 'PUT',
    body: {
      users: {
        admin: { role: 'Admin', name: 'Admin actualizado' },
        supervisor: { role: 'Supervisor', name: 'Supervisor actualizado' },
        patinador: { role: 'Patinador', name: 'Patinador actualizado', puestos: ['PRE 1'] }
      },
      tasks: [{ id: 'T-1', cantidad: 10, entregado: 3, estado: 'Parcial', puesto: 'PRE 1' }]
    }
  });
  assert.equal(adminWrite.status, 200);
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(persisted.users.admin.pass, 'AdminTest123', 'la clave Admin omitida debe conservarse');
  assert.equal(persisted.users.supervisor.pass, 'SupervisorTest123', 'la clave Supervisor omitida debe conservarse');
  assert.equal(persisted.users.patinador.pass, 'PatinadorTest123', 'la clave Patinador omitida debe conservarse');
  assert.equal(adminWrite.data.users.admin.pass, undefined, 'la respuesta PUT no debe exponer claves');

  const adminClose = await request(baseUrl, '/api/jornada/cerrar', {
    token: adminToken, method: 'POST', body: { confirmacion: 'CERRAR JORNADA', usuario: 'Admin de prueba' }
  });
  assert.equal(adminClose.status, 200);
  assert.equal(adminClose.data.ok, true);
  assert.equal(adminClose.data.count, 1);
  const afterClose = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(afterClose.tasks[0].entregado, 0, 'el cierre Admin debe reiniciar las entregas');
  assert.equal(afterClose.tasks[0].estado, 'Pendiente');
  assert.equal(fs.existsSync(path.join(dataDir, 'history', adminClose.data.archived)), true);
});
