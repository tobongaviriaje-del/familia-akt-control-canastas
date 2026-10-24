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

  const malformed = await fetch(`${base}/api/jornada/cerrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json'
  });
  assert.equal(malformed.status, 400);

  const oversized = await fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
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
});
