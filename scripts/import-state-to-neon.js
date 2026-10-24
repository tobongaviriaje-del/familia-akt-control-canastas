#!/usr/bin/env node
'use strict';

// One-time, fail-safe import of an exported state.json into Neon.
// Usage: DATABASE_URL='postgres://…' node scripts/import-state-to-neon.js /path/to/state.json [history-dir]
// This script NEVER overwrites an existing app_state row and never deletes rows.
// Review the source export and take a separate backup before running.

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('El estado debe ser un objeto JSON.');
  if (!state.users || typeof state.users !== 'object' || Array.isArray(state.users)) throw new Error('Falta el mapa de usuarios.');
  if (!Array.isArray(state.tasks)) throw new Error('Falta la lista de tareas.');
  if (state.lpnCatalog !== undefined && !Array.isArray(state.lpnCatalog)) throw new Error('lpnCatalog debe ser una lista.');
  if (state.freeDeliveries !== undefined && !Array.isArray(state.freeDeliveries)) throw new Error('freeDeliveries debe ser una lista.');
  state.lpnCatalog ||= [];
  state.freeDeliveries ||= [];
  return state;
}
async function main() {
  const input = process.argv[2];
  const historyDir = process.argv[3];
  if (!process.env.DATABASE_URL || !input) {
    console.error('Uso: DATABASE_URL=<conexión> node scripts/import-state-to-neon.js <state.json> [carpeta-history]');
    process.exitCode = 2;
    return;
  }
  const inputPath = path.resolve(input);
  const state = validateState(readJson(inputPath));
  const historyFiles = historyDir && fs.existsSync(historyDir)
    ? fs.readdirSync(path.resolve(historyDir)).filter(name => /^jornada-.*\.json$/i.test(name)).sort()
    : [];
  const history = historyFiles.map(name => {
    const payload = readJson(path.join(path.resolve(historyDir), name));
    const archivedAt = payload.fechaCierre || payload.archivedAt;
    if (!archivedAt || Number.isNaN(Date.parse(archivedAt)) || !Array.isArray(payload.tasks)) {
      throw new Error('Archivo histórico inválido: ' + name);
    }
    return { fileName: name, archivedAt: new Date(archivedAt).toISOString(), payload };
  });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT NOW())');
    await client.query('CREATE TABLE IF NOT EXISTS jornada_history (id bigserial PRIMARY KEY, file_name text NOT NULL UNIQUE, archived_at timestamptz NOT NULL, payload jsonb NOT NULL)');
    const existing = await client.query('SELECT id FROM app_state WHERE id = 1 FOR UPDATE');
    if (existing.rowCount) throw new Error('Neon ya tiene un estado en app_state. Se cancela sin modificarlo.');
    await client.query('INSERT INTO app_state (id, data, updated_at) VALUES (1, $1::jsonb, NOW())', [JSON.stringify(state)]);
    for (const item of history) {
      await client.query('INSERT INTO jornada_history (file_name, archived_at, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (file_name) DO NOTHING', [item.fileName, item.archivedAt, JSON.stringify(item.payload)]);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({
      success: true,
      source: path.basename(inputPath),
      tasks: state.tasks.length,
      users: Object.keys(state.users).length,
      lpnCatalog: state.lpnCatalog.length,
      freeDeliveries: state.freeDeliveries.length,
      historyFilesFound: history.length,
      note: 'Importación confirmada. Verifique los conteos y mantenga el respaldo original.'
    }, null, 2));
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Importación cancelada; no se reemplazó ningún estado existente:', error.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}
main().catch(error => { console.error('Importación cancelada:', error.message); process.exitCode = 1; });
