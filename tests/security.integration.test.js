'use strict';

// Black-box integration tests run the real server against a temporary data directory.
// No production files or persistent Railway volume are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'familia-akt-test-'));
const port = 18000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const password = 'Test-Admin-Password-123!';
let child;
let token;

function request(route, { method = 'GET', body, auth } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(base + route, {
      method,
      headers: {
        ...(data === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed ?? raw });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('Server exited before becoming ready');
    try { const r = await request('/health'); if (r.status === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready');
}

(async () => {
  try {
    fs.copyFileSync(path.join(root, 'server.js'), path.join(temp, 'server.js'));
    fs.cpSync(path.join(root, 'public'), path.join(temp, 'public'), { recursive: true });
    child = spawn(process.execPath, ['server.js'], {
      cwd: temp,
      env: { ...process.env, PORT: String(port), INITIAL_ADMIN_PASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => stderr += chunk);
    await waitForServer();

    assert.equal((await request('/api/state')).status, 401, 'state API must reject unauthenticated requests');
    let login = await request('/api/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
    assert.equal(login.status, 401, 'invalid credentials must be rejected');

    login = await request('/api/login', { method: 'POST', body: { username: 'admin', password } });
    assert.equal(login.status, 200, 'configured admin must be able to log in');
    token = login.body.token;
    assert.ok(token, 'login must return a session token');

    let state = await request('/api/state', { auth: token });
    assert.equal(state.status, 200);
    assert.equal(state.body.users.admin.role, 'Admin');

    const attemptedEscalation = await request('/api/state', {
      method: 'PUT', auth: token,
      body: { ...state.body, users: { admin: state.body.users.admin, intruder: { pass: 'pw', role: 'Patinador' } } },
    });
    assert.equal(attemptedEscalation.status, 200, 'admin can manage users');
    const normalLogin = await request('/api/login', { method: 'POST', body: { username: 'intruder', password: 'pw' } });
    assert.equal(normalLogin.status, 200, 'admin-created account should be usable in the test instance');
    const normalToken = normalLogin.body.token;

    state = await request('/api/state', { auth: normalToken });
    assert.equal(state.status, 200);
    const forbidden = await request('/api/state', {
      method: 'PUT', auth: normalToken,
      body: { ...state.body, users: { ...state.body.users, intruder: { ...state.body.users.intruder, role: 'Admin' } } },
    });
    assert.equal(forbidden.status, 403, 'non-admin must not change roles');

    assert.equal((await request('/api/backup', { auth: normalToken })).status, 403, 'non-admin must not download backups');
    const backup = await request('/api/backup', { auth: token });
    assert.equal(backup.status, 200, 'admin backup download should work');
    assert.equal(backup.body.format, 'familia-akt-backup-v1');

    const invalidRestore = await request('/api/backup/restore', { method: 'POST', auth: token, body: { nope: true } });
    assert.equal(invalidRestore.status, 400, 'invalid backup must be rejected');

    // Restore a valid backup in this temporary test server and verify state remains readable.
    const validBundle = {
      format: 'familia-akt-backup-v1',
      createdAt: new Date().toISOString(),
      state: { ...backup.body.state, tasks: [{ id: 'test-task', cantidad: 10, entregado: 0 }] },
      history: [],
    };
    const restored = await request('/api/backup/restore', { method: 'POST', auth: token, body: validBundle });
    assert.equal(restored.status, 200, 'admin should restore a valid backup');
    assert.equal(restored.body.ok, true);
    state = await request('/api/state', { auth: token });
    assert.equal(state.status, 200);
    assert.equal(state.body.tasks[0].id, 'test-task', 'restored state should be persisted');
    assert.ok(fs.readdirSync(path.join(temp, 'data')).some(name => name.startsWith('pre-restauracion-')), 'restore should save a pre-restore snapshot');
    const missingAuthClose = await request('/api/jornada/cerrar', { method: 'POST', body: { confirmacion: 'CERRAR JORNADA' } });
    assert.equal(missingAuthClose.status, 401, 'close journey must require authentication');

    console.log('PASS: auth, invalid login, state access, role protection, backup permissions, invalid restore, close-journey auth');
  } catch (error) {
    console.error(error.stack || error);
    if (child && child.stderr) console.error('Server stderr:', child.stderr.read()?.toString?.() || '');
    process.exitCode = 1;
  } finally {
    if (child) child.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
