const DEFAULT_ADMIN_NAME = "Administrador";

export async function ensureDatabase(env) {
  if (!env || !env.DB) {
    const e = new Error("Falta vincular la base de datos D1 con el nombre DB.");
    e.status = 503;
    throw e;
  }
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_jornada_history (id INTEGER PRIMARY KEY AUTOINCREMENT, closed_at TEXT NOT NULL, metadata_json TEXT NOT NULL, tasks_json TEXT NOT NULL)"
  ).run();
}

export async function readState(env) {
  await ensureDatabase(env);
  let row = await env.DB.prepare(
    "SELECT state_json FROM app_state WHERE id = 1"
  ).first();

  if (!row) {
    const password = String(env.BOOTSTRAP_ADMIN_PASSWORD || "");
    if (password.length < 12) {
      const e = new Error("Falta configurar el secreto BOOTSTRAP_ADMIN_PASSWORD (mínimo 12 caracteres).");
      e.status = 503;
      throw e;
    }
    const initial = {
      users: {
        admin: {
          pass: password,
          role: "Admin",
          name: DEFAULT_ADMIN_NAME,
          turno: "Todos",
          areas: [],
          puestos: []
        }
      },
      tasks: [],
      lpnCatalog: []
    };
    await env.DB.prepare(
      "INSERT OR IGNORE INTO app_state (id, state_json, updated_at) VALUES (1, ?, ?)"
    ).bind(JSON.stringify(initial), new Date().toISOString()).run();
    row = await env.DB.prepare(
      "SELECT state_json FROM app_state WHERE id = 1"
    ).first();
  }

  let state;
  try {
    state = JSON.parse(row.state_json);
  } catch {
    const e = new Error("Los datos guardados no tienen un formato válido. Se detuvo la operación para protegerlos.");
    e.status = 500;
    throw e;
  }
  if (!state || typeof state !== "object") {
    const e = new Error("El estado guardado no tiene el formato esperado.");
    e.status = 500;
    throw e;
  }
  if (!state.users || typeof state.users !== "object") state.users = {};
  if (!Array.isArray(state.tasks)) state.tasks = [];
  if (!Array.isArray(state.lpnCatalog)) state.lpnCatalog = [];
  return state;
}

export async function writeState(env, state) {
  await ensureDatabase(env);
  const json = JSON.stringify({
    users: state.users || {},
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    lpnCatalog: Array.isArray(state.lpnCatalog) ? state.lpnCatalog : []
  });
  await env.DB.prepare(
    "INSERT INTO app_state (id, state_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at"
  ).bind(json, new Date().toISOString()).run();
}

export function stateForClient(state, role) {
  const copy = {
    users: {},
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    lpnCatalog: Array.isArray(state.lpnCatalog) ? state.lpnCatalog : []
  };
  for (const [key, value] of Object.entries(state.users || {})) {
    const user = { ...(value || {}) };
    if (role !== "Admin") delete user.pass;
    copy.users[key] = user;
  }
  return copy;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

export function errorResponse(error, fallback = "No se pudo completar la operación.") {
  const status = Number(error && error.status) || 500;
  const message = status >= 500
    ? (error && error.status === 503 ? error.message : fallback)
    : (error && error.message ? error.message : fallback);
  return json({ ok: false, error: message }, status);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map(
    key => JSON.stringify(key) + ":" + stableStringify(value[key])
  ).join(",") + "}";
}
