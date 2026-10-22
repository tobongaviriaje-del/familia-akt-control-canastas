import { json, errorResponse } from "../../../_lib/db.js";
import { revokeSession } from "../../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  try {
    await revokeSession(request, env);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "No se pudo cerrar la sesión.");
  }
}
