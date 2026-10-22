import { readState, ensureDatabase } from "./db.js";

const encoder = new TextEncoder();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function tokenHex() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export async function authenticate(request, env) {
  await ensureDatabase(env);
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!match) {
    const e = new Error("Sesión vencida. Vuelve a ingresar.");
    e.status = 401;
    throw e;
  }
  const tokenHash = await sha256(match[1]);
  const session = await env.DB.prepare(
    "SELECT username, expires_at FROM app_sessions WHERE token_hash = ?"
  ).bind(tokenHash).first();

  if (!session || Number(session.expires_at) <= Date.now()) {
    if (session) {
      await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
    const e = new Error("Sesión vencida. Vuelve a ingresar.");
    e.status = 401;
    throw e;
  }

  const state = await readState(env);
  const username = String(session.username || "").toLowerCase();
  const user = state.users && state.users[username];
  if (!user || !user.role) {
    await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(tokenHash).run();
    const e = new Error("La sesión ya no tiene un usuario activo. Vuelve a ingresar.");
    e.status = 401;
    throw e;
  }
  return { username, user, state, tokenHash };
}

export async function createSession(env, username) {
  await ensureDatabase(env);
  const token = tokenHex();
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await env.DB.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await env.DB.prepare(
    "INSERT INTO app_sessions (token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, username, expiresAt, new Date().toISOString()).run();
  return { token, expiresAt };
}

export async function revokeSession(request, env) {
  await ensureDatabase(env);
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!match) return;
  const tokenHash = await sha256(match[1]);
  await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(tokenHash).run();
}
