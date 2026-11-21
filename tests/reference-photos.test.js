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
    try { if ((await fetch(baseUrl + '/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor de prueba no respondió /health.');
}

function zipStore(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, dataValue] of entries) {
    const nameBytes = Buffer.from(name), data = Buffer.from(dataValue);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

async function request(baseUrl, route, { token, method = 'GET', body, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const response = await fetch(baseUrl + route, {
    method, headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

function webp(seed) {
  const data = Buffer.alloc(20);
  data.write('RIFF', 0, 'ascii');
  data.writeUInt32LE(12, 4);
  data.write('WEBP', 8, 'ascii');
  data.write('VP8 ', 12, 'ascii');
  data.writeUInt32LE(seed, 16);
  return data;
}

test('consolida CR4-150 por EAN y puesto sin perder fotos y cuenta asociaciones repetidas', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'akt-cr4150-audit-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(temp, 'public'));
  fs.copyFileSync(path.join(repoRoot, 'server.js'), path.join(temp, 'server.js'));
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
    users: { admin: { pass: 'AdminTest123', role: 'Admin', name: 'Admin de prueba' } },
    tasks: [{ id: 'CR4-1', standardMoto: 'CR4-150', ean: '001234', puesto: 'PRE 1', cantidad: 10, entregado: 4 }]
  }));
  const port = await freePort(), baseUrl = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: temp, env: { ...process.env, PORT: String(port) }, stdio: 'ignore'
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(resolve, 1500).unref(); });
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitForHealth(baseUrl, child);
  const login = await request(baseUrl, '/api/login', {
    method: 'POST', body: { username: 'admin', password: 'AdminTest123' }
  });
  assert.equal(login.status, 200);
  const token = login.data.token;

  const photoA = 'a'.repeat(40) + '.webp';
  const photoB = 'b'.repeat(40) + '.webp';
  const manifest = {
    modelo: 'CR4-150',
    items: {
      'entrada-1': { ean: '001 234', puesto: 'PRE 01', producto: 'Referencia de prueba', photos: [{ file: photoA }] },
      'entrada-2': { ean: '001234', puesto: 'pre 1', producto: 'Referencia repetida', photos: [{ file: photoB }] },
      'entrada-3': { ean: '009999', puesto: 'PRE 2', producto: 'Otra referencia', photos: [{ file: photoB }] }
    }
  };
  const zip = zipStore([
    ['manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['fotos/' + photoA, webp(1)],
    ['fotos/' + photoB, webp(2)]
  ]);
  const imported = await request(baseUrl, '/api/admin/reference-photos/cr4150', {
    token, method: 'POST', body: zip, raw: true
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.referencias, 2, 'dos claves repetidas EAN+puesto deben quedar en una referencia');
  assert.equal(imported.data.fotos, 2);
  assert.equal(imported.data.asociaciones, 3, 'las tres asociaciones de foto deben conservarse');

  const savedManifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'reference-photos', 'cr4150', 'manifest.json'), 'utf8'));
  const rows = Object.values(savedManifest.items);
  const consolidated = rows.find(row => row.ean.replace(/\s+/g, '') === '001234');
  assert.ok(consolidated);
  assert.deepEqual(new Set(consolidated.photos.map(photo => photo.file)), new Set([photoA, photoB]));
  assert.equal(rows.length, 2);
  assert.equal(fs.existsSync(path.join(dataDir, 'reference-photos', 'cr4150', photoA)), true);
  assert.equal(fs.existsSync(path.join(dataDir, 'reference-photos', 'cr4150', photoB)), true);

  const diagnostic = await request(baseUrl, '/api/admin/reference-photos/diagnostic', { token });
  assert.equal(diagnostic.status, 200);
  const cr = diagnostic.data.modelos.find(model => model.modelo === 'CR4-150');
  assert.equal(cr.referenciasDuplicadas, 0, 'la consolidación debe eliminar la duplicidad lógica');
  assert.equal(cr.asociacionesFotoDuplicadas, 1, 'la misma foto asociada a dos referencias debe contarse una vez como duplicada');
  assert.equal(cr.archivosFotoFaltantes, 0);
  assert.equal(cr.referenciasSinFoto, 0);
  assert.equal(cr.tareasSinFoto, 0);
  assert.equal(diagnostic.data.soloLectura, true);
});
