const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('server starts with isolated data directory and serves health + app', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-test-'));
  const port = 31000 + (process.pid % 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try {
      health = await fetch(`${base}/health`);
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(health, `server did not start: ${logs}`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(health.headers.get('access-control-allow-origin'), null);

  const app = await fetch(base);
  assert.equal(app.status, 200);
  assert.match(await app.text(), /Familia AKT/);

  // Verify the test process created state only in its temporary directory.
  assert.ok(fs.existsSync(path.join(dataDir, 'state.json')));
});

test('rejects malformed JSON and oversized request bodies', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-input-test-'));
  const port = 32000 + (process.pid % 18000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${logs}`);

  const authResponse = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(authResponse.status, 200);
  const cookie = authResponse.headers.get('set-cookie').split(';')[0];

  const malformed = await fetch(`${base}/api/jornada/cerrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: '{not-json'
  });
  assert.equal(malformed.status, 400);

  const oversized = await fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ tasks: [], padding: 'x'.repeat(1024 * 1024 + 10) })
  });
  assert.equal(oversized.status, 413);
});

test('state API requires a session and never returns passwords', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-auth-test-'));
  const port = 33000 + (process.pid % 17000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try { const r = await fetch(`${base}/health`); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${logs}`);

  const anonymous = await fetch(`${base}/api/state`);
  assert.equal(anonymous.status, 401);
  const deniedWrite = await fetch(`${base}/api/state`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: [] })
  });
  assert.equal(deniedWrite.status, 401);

  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(loginBody.ok, true);
  assert.equal(Object.hasOwn(loginBody.user, 'pass'), false);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const stateResponse = await fetch(`${base}/api/state`, { headers: { Cookie: cookie } });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(Object.hasOwn(state.users.admin, 'pass'), false);

  const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${base}/api/state`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);

  const patinadorLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hamilton', password: 'Hamilton123!' })
  });
  assert.equal(patinadorLogin.status, 200);
  const patinadorCookie = patinadorLogin.headers.get('set-cookie').split(';')[0];
  const forbiddenSnapshot = await fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: patinadorCookie },
    body: JSON.stringify({ tasks: [{ id: 'forged-task', cantidad: 999999 }] })
  });
  assert.equal(forbiddenSnapshot.status, 403);
  const freshAdminLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(freshAdminLogin.status, 200);
  const freshAdminCookie = freshAdminLogin.headers.get('set-cookie').split(';')[0];
  const afterForbiddenSnapshot = await fetch(`${base}/api/state`, { headers: { Cookie: freshAdminCookie } });
  assert.equal(afterForbiddenSnapshot.status, 200);
  assert.equal((await afterForbiddenSnapshot.json()).tasks.some(task => task.id === 'forged-task'), false);
});


test('patinador solo registra entregas de tareas asignadas y conserva metadatos', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-delivery-test-'));
  const port = 34000 + (process.pid % 15000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try { const r = await fetch(`${base}/health`); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${logs}`);
  const statePath = path.join(dataDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.tasks = [
    { id: 't-pre1', puesto: 'PRE 1', area: 'PRE', cantidad: 10, entregado: 0, ean: '111', lpn: 'LPN-1', cesta: 'REF-125', referenciaCanasta: 'Canasta original', entregas: [] },
    { id: 't-pre22', puesto: 'PRE 22', area: 'PRE', cantidad: 10, entregado: 2, ean: '222', lpn: 'LPN-2', cesta: 'REF-150', referenciaCanasta: 'Otra canasta', entregas: [] }
  ];
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hamilton', password: 'Hamilton123!' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const denied = await fetch(`${base}/api/entrega`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id: 't-pre1', cantidad: 1 })
  });
  assert.equal(denied.status, 403);
  const deniedUnknown = await fetch(`${base}/api/entrega`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id: 't-unknown', cantidad: 1 })
  });
  assert.equal(deniedUnknown.status, 404);
  const allowed = await fetch(`${base}/api/entrega`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id: 't-pre22', cantidad: 3, observaciones: 'prueba sintética' })
  });
  assert.equal(allowed.status, 200);
  const result = await allowed.json();
  assert.equal(result.task.entregado, 5);
  assert.equal(result.task.estado, 'Parcial');
  assert.equal(result.task.ean, '222');
  assert.equal(result.task.lpn, 'LPN-2');
  assert.equal(result.task.referenciaCanasta, 'Otra canasta');
  assert.equal(result.task.entregas.at(-1).cantidad, 3);

  state.tasks.push({ id: 'std-pre22', puesto: 'PRE 22', area: 'PRE', cantidad: 100, lote: 100, cantidadCanasta: 10, numCanastas: 10, standardNKD: true, entregado: 0, ean: '333', lpn: 'STD-3', referenciaCanasta: 'Ref estándar', entregas: [] });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const physical = await fetch(`${base}/api/entrega`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id: 'std-pre22', cantidad: 20, canastasFisicas: 2, metodo: 'Entrega de canastas físicas', observaciones: 'prueba canastas' })
  });
  assert.equal(physical.status, 200);
  const physicalResult = await physical.json();
  assert.equal(physicalResult.task.entregado, 20);
  assert.equal(physicalResult.task.canastasEntregadas, 2);
  assert.equal(physicalResult.task.confirmacionesCanastas.at(-1).cantidad, 2);
  assert.equal(physicalResult.task.confirmacionesCanastas.at(-1).unidades, 20);
  assert.equal(physicalResult.task.entregas.at(-1).canastasFisicas, 2);
  assert.equal(physicalResult.task.referenciaCanasta, 'Ref estándar');

  const invalidPhysical = await fetch(`${base}/api/entrega`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id: 'std-pre22', cantidad: 15, canastasFisicas: 2, metodo: 'Entrega de canastas físicas' })
  });
  assert.equal(invalidPhysical.status, 400);
});


test('admin user API hashes passwords and blocks non-admin management', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-users-test-'));
  const port = 36000 + (process.pid % 12000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => { child.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try { const r = await fetch(`${base}/health`); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${logs}`);
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${base}/api/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ action: 'create', username: 'nuevo.operador', name: 'Operador de prueba', role: 'Patinador', turno: 'Día', password: 'ClaveDePrueba#2026', areas: ['PRE'], puestos: ['PRE 1'] })
  });
  assert.equal(created.status, 200);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.match(stored.users['nuevo.operador'].pass, /^scrypt\$/);
  assert.notEqual(stored.users['nuevo.operador'].pass, 'ClaveDePrueba#2026');
  const response = await created.json();
  assert.equal(Object.hasOwn(response.users['nuevo.operador'], 'pass'), false);
  const deleted = await fetch(`${base}/api/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ action: 'delete', username: 'nuevo.operador' })
  });
  assert.equal(deleted.status, 200);
  const mesaninLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mesanin', password: 'mesanin123' })
  });
  assert.equal(mesaninLogin.status, 200);
  const mesaninCookie = mesaninLogin.headers.get('set-cookie').split(';')[0];
  const removeDefault = await fetch(`${base}/api/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ action: 'delete', username: 'mesanin' })
  });
  assert.equal(removeDefault.status, 200);
  const deletedSession = await fetch(`${base}/api/session`, { headers: { Cookie: mesaninCookie } });
  assert.equal(deletedSession.status, 401);
  const stateAfterDelete = await fetch(`${base}/api/state`, { headers: { Cookie: cookie } });
  assert.equal(stateAfterDelete.status, 200);
  const stateAfterDeleteJson = await stateAfterDelete.json();
  assert.equal(Object.hasOwn(stateAfterDeleteJson.users, 'mesanin'), false);
  const userLogin = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hamilton', password: 'Hamilton123!' })
  });
  assert.equal(userLogin.status, 200);
  const userCookie = userLogin.headers.get('set-cookie').split(';')[0];
  const forbidden = await fetch(`${base}/api/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify({ action: 'create', username: 'otro.operador', name: 'No autorizado', role: 'Patinador', password: 'OtraClaveSegura#2026' })
  });
  assert.equal(forbidden.status, 403);
});

test('frontend uses role-scoped task sync instead of unauthorized whole-state writes', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(frontend, /const endpoint=role==='Admin'\?'\/api\/state':'\/api\/tasks\/sync'/);
  assert.match(frontend, /role==='Admin'\|\|role==='Mesanín'/);
  assert.match(frontend, /\{tasks:cloudTasks,lpnCatalog,freeDeliveries\}/);
  assert.doesNotMatch(frontend, /JSON\.stringify\(\{users,tasks:cloudTasks,lpnCatalog\}\)/);
  assert.match(frontend, /async function guardarNuevoLPN\(\)[\s\S]*?const saved=await saveTasks\(tasks\);[\s\S]*?if\(!saved\)/);
  assert.doesNotMatch(frontend, /saveTasks\(tasks\);\s*cloudSave\(\);\$\('lpnMsg'\)\.className='pill'/);
  assert.match(frontend, /async function crearTareaDesdeAdmin\(\)[\s\S]*?const previousTasks=cloudTasks\.slice\(\),previousCatalog=lpnCatalog\.slice\(\);[\s\S]*?if\(!saved\)\{cloudTasks=previousTasks;lpnCatalog=previousCatalog/);
  assert.match(frontend, /async function crearTarea\(\)[\s\S]*?const before=cloudTasks\.slice\(\);[\s\S]*?if\(!saved\)\{cloudTasks=before/);
  assert.match(frontend, /async function cargarMasivo\(\)\{const previousTasks=cloudTasks\.slice\(\),previousCatalog=lpnCatalog\.slice\(\);[\s\S]*?if\(!saved\)\{cloudTasks=previousTasks;lpnCatalog=previousCatalog/);
  assert.match(frontend, /function crearReferenciaManualEstandar\([\s\S]*?previousTasks=JSON\.parse\(JSON\.stringify\(cloudTasks\)\)[\s\S]*?catch\(e\)\{cloudTasks=previousTasks;lpnCatalog=previousCatalog/);
  assert.match(frontend, /function prepararEstandarNKD\([\s\S]*?cloudSave\(\)\.then\(ok=>\{[\s\S]*?if\(!ok\)throw new Error\([\s\S]*?catch\(\(\)=>\{cloudTasks=previousTasks;lpnCatalog=previousCatalog/);
  assert.doesNotMatch(frontend, /fetch\('\/api\/state',\{method:'PUT',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(\{tasks:cloudTasks,lpnCatalog\}\)\}\)/);
});


test('role-scoped task sync preserves delivery history and blocks task deletion', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-task-sync-'));
  const port = 38000 + (process.pid % 10000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => { child.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try { const r = await fetch(`${base}/health`); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${logs}`);
  const statePath = path.join(dataDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.tasks = [
    { id: 'task-a', lpn: 'LPN-A', ean: 'EAN-A', producto: 'Pieza A', cantidad: 10, entregado: 3, estado: 'Parcial', entregas: [{ cantidad: 3, patinador: 'Hamilton' }], puesto: 'PRE 22', area: 'PRE' },
    { id: 'task-b', lpn: 'LPN-B', ean: 'EAN-B', producto: 'Pieza B', cantidad: 5, entregado: 0, estado: 'Pendiente', entregas: [], puesto: 'PRE 1', area: 'PRE' }
  ];
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mesanin', password: 'mesanin123' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const submitted = [
    { ...state.tasks[0], cantidad: 12, entregado: 999, estado: 'Entregada', entregas: [] }
  ];
  const sync = await fetch(`${base}/api/tasks/sync`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ tasks: submitted })
  });
  assert.equal(sync.status, 200);
  const stored = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(stored.tasks.length, 2, 'omitted tasks cannot be deleted by a non-admin');
  assert.equal(stored.tasks.find(x => x.id === 'task-a').cantidad, 12);
  assert.equal(stored.tasks.find(x => x.id === 'task-a').entregado, 3, 'delivery count remains server-controlled');
  assert.equal(stored.tasks.find(x => x.id === 'task-a').entregas.length, 1, 'delivery history remains intact');
  assert.equal(stored.tasks.find(x => x.id === 'task-a').estado, 'Parcial');
});

test('patinador can change only standard metadata for assigned posts', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-patinador-sync-'));
  const port = 39000 + (process.pid % 9000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => { child.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try { const r = await fetch(`${base}/health`); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${logs}`);
  const statePath = path.join(dataDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.users.hamilton.puestos = ['PRE 22'];
  state.tasks = [
    { id: 'std-assigned', standardNKD: true, puesto: 'PRE 22', area: 'PRE', cantidad: 100, cantidadCanasta: 10, entregado: 20, estado: 'Parcial', entregas: [{ cantidad: 20 }], lpn: 'STD-A', ean: 'EAN-A', producto: 'Pieza A' },
    { id: 'std-other', standardNKD: true, puesto: 'PRE 1', area: 'PRE', cantidad: 50, cantidadCanasta: 5, entregado: 0, estado: 'Pendiente', entregas: [], lpn: 'STD-B', ean: 'EAN-B', producto: 'Pieza B' }
  ];
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hamilton', password: 'Hamilton123!' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const changed = [
    { ...state.tasks[0], cantidadCanasta: 12, entregado: 999, estado: 'Entregada', entregas: [] },
    { ...state.tasks[1] }
  ];
  const sync = await fetch(`${base}/api/tasks/sync`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ tasks: changed })
  });
  assert.equal(sync.status, 200);
  const stored = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(stored.tasks[0].cantidadCanasta, 12);
  assert.equal(stored.tasks[0].entregado, 20);
  assert.equal(stored.tasks[0].entregas.length, 1);
  assert.equal(stored.tasks[1].cantidadCanasta, 5);
});


test('corrupt persisted state fails closed and is never replaced with empty defaults', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-corrupt-state-'));
  const port = 41000 + (process.pid % 8000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try { const r = await fetch(`${base}/health`); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${logs}`);
  const statePath = path.join(dataDir, 'state.json');
  const corruptContents = '{"tasks":[{"id":"do-not-overwrite","cantidad":27},';
  fs.writeFileSync(statePath, corruptContents, 'utf8');
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(login.status, 500);
  const response = await login.json();
  assert.equal(response.ok, false);
  assert.match(response.error, /No se modificaron los datos/);
  assert.equal(fs.readFileSync(statePath, 'utf8'), corruptContents, 'corrupt file must remain untouched for recovery');
  const healthAfterFailure = await fetch(`${base}/health`);
  assert.equal(healthAfterFailure.status, 200, 'server should remain available after safe failure');

  for (const invalidState of [
    JSON.stringify({ users: { admin: { role: 'Admin' } } }),
    JSON.stringify({ users: [], tasks: [] }),
    JSON.stringify({ users: { admin: { role: 'Admin' } }, tasks: [], lpnCatalog: {} })
  ]) {
    fs.writeFileSync(statePath, invalidState, 'utf8');
    const failedLogin = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' })
    });
    assert.equal(failedLogin.status, 500, 'structurally invalid state must fail closed');
    assert.equal(fs.readFileSync(statePath, 'utf8'), invalidState, 'invalid but parseable state must remain untouched');
  }
});
