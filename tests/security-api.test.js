'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

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

  const publicState = await request(baseUrl, '/api/state');
  assert.equal(publicState.status, 401, 'el estado global no debe exponerse sin una sesión autenticada');
  assert.equal(publicState.data.ok, false);

  const invalidSessionState = await request(baseUrl, '/api/state', { token: 'token-invalido' });
  assert.equal(invalidSessionState.status, 401, 'un token inválido no debe consultar el estado global');

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
  assert.equal(patinadorProtectedWrite.status, 403, 'un Patinador no debe escribir en el estado global');
  const stateAfterPatinadorProtectedWrite = await request(baseUrl, '/api/state', { token: adminToken });
  assert.equal(stateAfterPatinadorProtectedWrite.data.users.admin.role, 'Admin');
  assert.equal(stateAfterPatinadorProtectedWrite.data.users.intruso, undefined);

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
  assert.equal(protectedWrite.status, 403, 'Supervisor es de solo consulta y no debe escribir en el estado global');
  const stateAfterSupervisorWrite = await request(baseUrl, '/api/state', { token: adminToken });
  assert.equal(stateAfterSupervisorWrite.data.users.admin.role, 'Admin');
  assert.equal(stateAfterSupervisorWrite.data.users.intruso, undefined);
  assert.deepEqual(stateAfterSupervisorWrite.data.lpnCatalog, [{ id: 'LPN-ORIGINAL' }]);
  assert.equal(stateAfterSupervisorWrite.data.tasks[0].entregado, 2, 'el intento de escritura Supervisor no debe alterar producción');

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

test('no recrea admin/admin y exige una clave inicial explícita en instalaciones nuevas', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-bootstrap-'));
  const publicDir = path.join(temp, 'public');
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'server.js'), path.join(temp, 'server.js'));

  // Un estado existente sin la cuenta admin no debe recibirla de nuevo.
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
    users: { supervisor: { pass: 'SupervisorOnly123', role: 'Supervisor', name: 'Supervisor' } },
    tasks: []
  }, null, 2));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  delete env.ADMIN_INITIAL_PASSWORD;
  delete env.ADMIN_RECOVERY_PASSWORD;
  const child = spawn(process.execPath, ['server.js'], { cwd: temp, env, stdio: 'ignore' });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(resolve, 1500).unref(); });
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const baseUrl = 'http://127.0.0.1:' + port;
  await waitForHealth(baseUrl, child);
  const defaultLogin = await request(baseUrl, '/api/login', {
    method: 'POST', body: { username: 'admin', password: 'admin' }
  });
  assert.equal(defaultLogin.status, 401, 'admin/admin no debe funcionar en un estado existente');
  const existingState = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(existingState.users.admin, undefined, 'leer el estado no debe recrear la cuenta admin');

  // Una instalación nueva falla de forma segura si no se configura una clave inicial.
  const freshWithoutPassword = path.join(temp, 'fresh-without-password');
  fs.mkdirSync(path.join(freshWithoutPassword, 'public'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'server.js'), path.join(freshWithoutPassword, 'server.js'));
  const missingPasswordEnv = { ...env, PORT: String(await freePort()) };
  const blocked = spawnSync(process.execPath, ['server.js'], {
    cwd: freshWithoutPassword,
    env: missingPasswordEnv,
    encoding: 'utf8',
    timeout: 5000
  });
  assert.notEqual(blocked.status, 0, 'la instalación nueva debe bloquearse sin clave inicial');
  assert.match(String(blocked.stderr) + String(blocked.stdout), /ADMIN_INITIAL_PASSWORD/);
  assert.equal(fs.existsSync(path.join(freshWithoutPassword, 'data', 'state.json')), false);

  // Con una clave explícita, el primer administrador sí puede iniciar sesión.
  const freshConfigured = path.join(temp, 'fresh-configured');
  fs.mkdirSync(path.join(freshConfigured, 'public'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'server.js'), path.join(freshConfigured, 'server.js'));
  const configuredPort = await freePort();
  const configuredEnv = { ...process.env, PORT: String(configuredPort), ADMIN_INITIAL_PASSWORD: 'InitialAdminTest123!' };
  delete configuredEnv.ADMIN_RECOVERY_PASSWORD;
  const configuredChild = spawn(process.execPath, ['server.js'], { cwd: freshConfigured, env: configuredEnv, stdio: 'ignore' });
  t.after(async () => {
    configuredChild.kill('SIGTERM');
    await new Promise(resolve => { if (configuredChild.exitCode !== null) return resolve(); configuredChild.once('exit', resolve); setTimeout(resolve, 1500).unref(); });
    fs.rmSync(freshConfigured, { recursive: true, force: true });
    fs.rmSync(freshWithoutPassword, { recursive: true, force: true });
  });
  const configuredUrl = 'http://127.0.0.1:' + configuredPort;
  await waitForHealth(configuredUrl, configuredChild);
  const validLogin = await request(configuredUrl, '/api/login', {
    method: 'POST', body: { username: 'admin', password: 'InitialAdminTest123!' }
  });
  assert.equal(validLogin.status, 200);
  const rejectedDefault = await request(configuredUrl, '/api/login', {
    method: 'POST', body: { username: 'admin', password: 'admin' }
  });
  assert.equal(rejectedDefault.status, 401);
});


test('permite rotar la contraseña Admin después de una recuperación de un solo uso', async t => {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-admin-rotation-')),dataDir=path.join(temp,'data');
 fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{admin:{pass:'legacy-test-password',role:'Admin'},supervisor:{pass:'supervisor-test',role:'Supervisor'}},tasks:[]}));
 const port=await freePort(),recovery='recovery-test-only',next='rotated-test-password-2026';
 const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port),ADMIN_RECOVERY_PASSWORD:recovery},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;await waitForHealth(base,child);
 const login=await request(base,'/api/login',{method:'POST',body:{username:'admin',password:recovery}});
 assert.equal(login.status,200);
 let saved=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'));
 assert.equal(saved.users.admin.pass,'legacy-test-password');assert.equal(saved.adminRecoveryUsed,true);
 const rotate=await request(base,'/api/admin/change-password',{token:login.data.token,method:'POST',body:{newPassword:next}});
 assert.equal(rotate.status,200);
 saved=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'));
 assert.equal(saved.users.admin.pass,next);assert.equal(saved.adminRecoveryUsed,true);
 assert.equal((await request(base,'/api/login',{method:'POST',body:{username:'admin',password:'legacy-test-password'}})).status,401);
 assert.equal((await request(base,'/api/login',{method:'POST',body:{username:'admin',password:recovery}})).status,401);
 assert.equal((await request(base,'/api/login',{method:'POST',body:{username:'admin',password:next}})).status,200);
 const supervisor=await request(base,'/api/login',{method:'POST',body:{username:'supervisor',password:'supervisor-test'}});
 assert.equal((await request(base,'/api/admin/change-password',{token:supervisor.data.token,method:'POST',body:{newPassword:next}})).status,403);
});


test('AKT INTELIGENTE entrega solo indicadores permitidos por perfil y no modifica datos', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-assistant-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(temp, 'public'));
  fs.copyFileSync(path.join(repoRoot, 'server.js'), path.join(temp, 'server.js'));
  const state = {
    users: {
      admin: { pass: 'AdminTest123', role: 'Admin', name: 'Admin de prueba' },
      supervisor: { pass: 'SupervisorTest123', role: 'Supervisor', name: 'Supervisor de prueba' },
      coordinador: { pass: 'CoordinadorTest123', role: 'Coordinador', name: 'Coordinador de prueba' },
      patinador: { pass: 'PatinadorTest123', role: 'Patinador', name: 'Patinador de prueba', puestos: ['PRE 1'] }
    },
    patinadoresAuth: { passDia: 'DiaTest123', passNoche: 'NocheTest123' },
    tasks: [{ id: 'T-1', standardNKD: true, standardMoto: 'NKD', codigoLoteOperacion: 'KK711', ean: '770000000001', lote: 10, cantidad: 10, entregado: 2, estado: 'Parcial', puesto: 'PRE 1' }]
  };
  const workLots = [
    { id: 'LOT-ACTIVE', model: 'NKD', number: 7, codigoLoteOperacion: 'KK711', tasks: [
      { id: 'SNAPSHOT-TASK-DIFFERENT-ID', ean: '770000000001', puesto: 'PRE 1', lote: 10, cantidad: 10, entregado: 2, entregas: [{ id: 'EV-1', patinador: 'Patinador de prueba', cantidad: 2 }], entrega: null }
    ] },
    { id: 'LOT-HISTORY', model: 'NKD', number: 6, codigoLoteOperacion: 'KK700', tasks: [
      { id: 'T-OLD', puesto: 'PRE 1', lote: 20, cantidad: 20, entregado: 20, entregas: [{ patinador: 'Patinador de prueba', cantidad: 20 }] }
    ] }
  ];
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(dataDir, 'work-lots.json'), JSON.stringify(workLots, null, 2));
  const originalState = fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8');
  const originalLots = fs.readFileSync(path.join(dataDir, 'work-lots.json'), 'utf8');

  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(resolve, 1500).unref(); });
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitForHealth(baseUrl, child);
  async function login(username, password) {
    const result = await request(baseUrl, '/api/login', { method: 'POST', body: { username, password } });
    assert.equal(result.status, 200);
    return result.data.token;
  }

  const anonymous = await request(baseUrl, '/api/assistant/production-summary');
  assert.equal(anonymous.status, 401);
  const invalid = await request(baseUrl, '/api/assistant/production-summary', { token: 'invalid-token' });
  assert.equal(invalid.status, 401);

  const supervisorToken = await login('supervisor', 'SupervisorTest123');
  const supervisor = await request(baseUrl, '/api/assistant/production-summary', { token: supervisorToken });
  assert.equal(supervisor.status, 200);
  assert.equal(supervisor.data.role, 'Supervisor');
  assert.equal(supervisor.data.lots.length, 1, 'solo debe incluir el lote vigente');
  assert.equal(supervisor.data.lots[0].lot, 'KK711 · lote 7', 'debe relacionar la instantánea aunque el ID de su tarea sea distinto');
  assert.deepEqual(Object.keys(supervisor.data.lots[0]).sort(), ['lot', 'model', 'percentage']);
  assert.deepEqual(Object.keys(supervisor.data.skaters[0]).sort(), ['lot', 'model', 'name', 'percentage']);
  assert.equal(supervisor.data.skaters[0].percentage, 20);
  assert.equal(supervisor.data.tasks, undefined);
  assert.equal(supervisor.data.users, undefined);
  assert.equal(JSON.stringify(supervisor.data).includes('EV-1'), false);

  const adminToken = await login('admin', 'AdminTest123');
  const admin = await request(baseUrl, '/api/assistant/production-summary', { token: adminToken });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.summary.totalUnits, 10);
  assert.equal(admin.data.summary.deliveredUnits, 2);
  assert.equal(admin.data.summary.pendingUnits, 8);
  assert.equal(admin.data.summary.percentage, 20);
  assert.equal(admin.data.skaters[0].deliveredUnits, 2);

  const coordinatorToken = await login('coordinador', 'CoordinadorTest123');
  const coordinator = await request(baseUrl, '/api/assistant/production-summary', { token: coordinatorToken });
  assert.equal(coordinator.status, 200);
  assert.equal(coordinator.data.role, 'Coordinador');
  assert.equal(coordinator.data.summary.percentage, 20);
  const coordinatorState = await request(baseUrl, '/api/state', { token: coordinatorToken });
  assert.equal(coordinatorState.status, 200);
  const rejectedFreeDelivery = await request(baseUrl, '/api/state', {
    token: coordinatorToken, method: 'PUT',
    body: { ...coordinatorState.data, freeDeliveries: [{ id: 'FREE-UNAUTHORIZED', cantidad: 99 }] }
  });
  assert.equal(rejectedFreeDelivery.status, 403, 'Coordinación no debe guardar entregas sin estándar reservadas al Administrador');
  const unchangedFreeDeliveries = await request(baseUrl, '/api/state', { token: adminToken });
  assert.deepEqual(unchangedFreeDeliveries.data.freeDeliveries || [], [], 'El intento rechazado no debe crear registros');

  const patinadorToken = await login('patinador', 'PatinadorTest123');
  const patinador = await request(baseUrl, '/api/assistant/production-summary', { token: patinadorToken });
  assert.equal(patinador.status, 200);
  assert.equal(patinador.data.role, 'Patinador');
  assert.equal(patinador.data.summary.totalUnits, 10);
  assert.equal(patinador.data.summary.deliveredUnits, 2);
  assert.equal(patinador.data.lots.length, 1);
  assert.equal(patinador.data.lots[0].lot, 'KK711 · lote 7');

  const sharedLogin = await request(baseUrl, '/api/login', { method: 'POST', body: { username: 'patinadores', password: 'DiaTest123' } });
  assert.equal(sharedLogin.status, 200);
  const sharedAssistant = await request(baseUrl, '/api/assistant/production-summary', { token: sharedLogin.data.token });
  assert.equal(sharedAssistant.status, 403, 'el acceso compartido no debe poder elegir la identidad de otro Patinador');
  assert.equal(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'), originalState, 'la consulta no debe modificar state.json');
  assert.equal(fs.readFileSync(path.join(dataDir, 'work-lots.json'), 'utf8'), originalLots, 'la consulta no debe modificar work-lots.json');
});
