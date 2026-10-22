import { readState, stateForClient, json, errorResponse } from "../../_lib/db.js";
import { createSession } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  try {
    let body;
    try { body = await request.json(); }
    catch {
      return json({ ok: false, error: "Escribe el usuario y la contraseña para ingresar." }, 400);
    }

    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!username || !password) {
      return json({ ok: false, error: "Escribe el usuario y la contraseña." }, 400);
    }

    const state = await readState(env);
    const user = state.users && state.users[username];
    if (!user || String(user.pass || "") !== password) {
      return json({ ok: false, error: "Usuario o contraseña incorrectos." }, 401);
    }

    const session = await createSession(env, username);
    return json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      username,
      user: (() => {
        const u = { ...user };
        if (user.role !== "Admin") delete u.pass;
        return u;
      })(),
      state: stateForClient(state, user.role)
    });
  } catch (error) {
    return errorResponse(error, "No se pudo iniciar sesión.");
  }
}
