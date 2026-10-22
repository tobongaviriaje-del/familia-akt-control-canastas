import { ensureDatabase, json, errorResponse } from "./_lib/db.js";

export async function onRequestGet({ env }) {
  try {
    await ensureDatabase(env);
    return json({ ok: true, service: "familia-akt-control-canastas", storage: "cloudflare-d1", database: "connected" });
  } catch (error) {
    return errorResponse(error, "El servidor está disponible, pero no se pudo conectar con la base de datos.");
  }
}
