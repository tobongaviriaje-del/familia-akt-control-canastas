import { readState, writeState, json, errorResponse } from "../../_lib/db.js";
import { authenticate } from "../../_lib/auth.js";

const MANAGERS = new Set(["Admin", "Mesanín", "Supervisor"]);

export async function onRequestPost({ request, env }) {
  try {
    const auth = await authenticate(request, env);
    if (!MANAGERS.has(auth.user.role)) {
      return json({ ok: false, error: "Solo administración puede cerrar la jornada." }, 403);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: "La confirmación no es válida." }, 400); }

    if (body.confirmacion !== "CERRAR JORNADA") {
      return json({ ok: false, error: "Confirmación inválida." }, 400);
    }
    const state = await readState(env);
    if (!state.tasks.length) {
      return json({ ok: false, error: "No hay tareas activas para archivar." }, 409);
    }

    const snapshot = state.tasks.map(t => ({ ...t }));
    const closedAt = new Date().toISOString();
    const metadata = {
      usuario: String(body.usuario || auth.user.name || auth.username),
      motivo: "Cierre de jornada",
      regla: "Se archivan todas las tareas; las completadas salen de la lista activa y las pendientes/parciales conservan su avance para el siguiente turno."
    };
    await env.DB.prepare(
      "INSERT INTO app_jornada_history (closed_at, metadata_json, tasks_json) VALUES (?, ?, ?)"
    ).bind(closedAt, JSON.stringify(metadata), JSON.stringify(snapshot)).run();

    const isComplete = task => {
      const total = Number(task.lote) || Number(task.cantidad) || 0;
      const delivered = Number(task.entregado) || 0;
      return total > 0 && delivered >= total;
    };
    state.tasks = state.tasks.filter(task => !isComplete(task));
    await writeState(env, state);
    const stored = await readState(env);

    return json({
      ok: true,
      archived: "jornada-" + closedAt.replace(/[:.]/g, "-") + ".json",
      count: snapshot.length,
      completedRemoved: snapshot.filter(isComplete).length,
      remainingCount: stored.tasks.length,
      tasks: stored.tasks
    });
  } catch (error) {
    return errorResponse(error, "No se pudo cerrar la jornada. Las tareas deben permanecer activas.");
  }
}
