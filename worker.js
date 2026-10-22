import { onRequest as stateHandler } from "./functions/api/state.js";
import { onRequestPost as loginHandler } from "./functions/api/auth/login.js";
import { onRequestPost as logoutHandler } from "./functions/api/auth/logout.js";
import { onRequestGet as meHandler } from "./functions/api/auth/me.js";
import { onRequestPost as closeShiftHandler } from "./functions/api/jornada/cerrar.js";

const routes = new Map([
  ["/api/state", { methods: ["GET", "PUT"], handler: stateHandler }],
  ["/api/auth/login", { methods: ["POST"], handler: loginHandler }],
  ["/api/auth/logout", { methods: ["POST"], handler: logoutHandler }],
  ["/api/auth/me", { methods: ["GET"], handler: meHandler }],
  ["/api/jornada/cerrar", { methods: ["POST"], handler: closeShiftHandler }]
]);

function jsonError(message, status) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const route = routes.get(url.pathname);
      if (!route) return jsonError("Ruta de API no encontrada.", 404);
      if (!route.methods.includes(request.method)) {
        return new Response(JSON.stringify({ ok: false, error: "Método no permitido." }), {
          status: 405,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Allow": route.methods.join(", "),
            "Cache-Control": "no-store"
          }
        });
      }
      try {
        return await route.handler({ request, env, params: {}, data: {} });
      } catch {
        return jsonError("Error interno. No se modificaron los datos; vuelve a intentarlo más tarde.", 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
