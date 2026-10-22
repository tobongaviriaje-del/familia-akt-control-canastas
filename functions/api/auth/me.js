import { json, errorResponse } from "../../../_lib/db.js";
import { authenticate } from "../../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authenticate(request, env);
    const user = { ...auth.user };
    if (user.role !== "Admin") delete user.pass;
    return json({ ok: true, username: auth.username, user });
  } catch (error) {
    return errorResponse(error, "No se pudo comprobar la sesión.");
  }
}
