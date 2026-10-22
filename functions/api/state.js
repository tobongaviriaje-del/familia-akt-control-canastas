import { readState, writeState, stateForClient, json, errorResponse, stableStringify } from "../_lib/db.js";
import { authenticate } from "../_lib/auth.js";

const MANAGERS = new Set(["Admin", "Mesanín", "Supervisor"]);
const DELIVERY_FIELDS = [
  "entregado", "estado", "entregas", "entrega",
  "canastasEntregadas", "confirmacionesCanastas"
];
const CAPACITY_FIELDS = ["cantidadCanasta", "cantidadCanastaRaw", "numCanastas", "numCanastasRaw"];

function withoutFields(value, fields) {
  const copy = { ...(value || {}) };
  for (const field of fields) delete copy[field];
  return copy;
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fieldsOnly(value, fields) {
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value || {}, field)) out[field] = value[field];
  }
  return out;
}

function mergePatinadorTasks(saved, incoming, user) {
  if (!Array.isArray(incoming) || incoming.length !== saved.length) {
    const e = new Error("No se permite crear ni borrar tareas desde una sesión de entrega.");
    e.status = 403;
    throw e;
  }
  const byId = new Map(incoming.map(task => [String(task && task.id), task]));
  if (byId.size !== saved.length) {
    const e = new Error("La lista de tareas no coincide con el estado guardado.");
    e.status = 409;
    throw e;
  }

  const puestos = new Set(Array.isArray(user.puestos) ? user.puestos.map(String) : []);
  const merged = [];
  const protectedFields = [...DELIVERY_FIELDS, ...CAPACITY_FIELDS];

  for (const previous of saved) {
    const key = String(previous && previous.id);
    const candidate = byId.get(key);
    if (!candidate) {
      const e = new Error("Falta una tarea del estado guardado. No se guardó ningún cambio.");
      e.status = 409;
      throw e;
    }

    if (stableStringify(previous) === stableStringify(candidate)) {
      merged.push(previous);
      continue;
    }

    if (!puestos.has(String(previous.puesto || ""))) {
      const e = new Error("Solo puedes modificar la capacidad o registrar entregas en los puestos asignados a tu usuario.");
      e.status = 403;
      throw e;
    }

    if (stableStringify(withoutFields(previous, protectedFields)) !==
        stableStringify(withoutFields(candidate, protectedFields))) {
      const e = new Error("El patinador solo puede cambiar la capacidad de su canasta y registrar sus entregas; no puede modificar el lote ni la referencia.");
      e.status = 403;
      throw e;
    }

    const capacityChanged = stableStringify(fieldsOnly(previous, CAPACITY_FIELDS)) !==
      stableStringify(fieldsOnly(candidate, CAPACITY_FIELDS));
    const deliveryChanged = stableStringify(fieldsOnly(previous, DELIVERY_FIELDS)) !==
      stableStringify(fieldsOnly(candidate, DELIVERY_FIELDS));

    if (!capacityChanged && !deliveryChanged) {
      merged.push(previous);
      continue;
    }

    let newCapacity = numeric(previous.cantidadCanasta);
    let expectedBaskets = numeric(previous.numCanastas);
    if (capacityChanged) {
      newCapacity = Number(candidate.cantidadCanasta);
      if (!Number.isInteger(newCapacity) || newCapacity < 1) {
        const e = new Error("La capacidad debe ser un número entero de unidades por canasta, mayor que cero.");
        e.status = 400;
        throw e;
      }
      if (String(candidate.cantidadCanastaRaw ?? "") !== String(newCapacity)) {
        const e = new Error("No se pudo validar la capacidad de la canasta. Vuelve a escribirla y guardarla.");
        e.status = 400;
        throw e;
      }
      const target = numeric(previous.lote) || numeric(previous.cantidad);
      expectedBaskets = target > 0 ? Math.ceil(target / newCapacity) : numeric(previous.numCanastas);
      if (numeric(candidate.numCanastas) !== expectedBaskets ||
          String(candidate.numCanastasRaw ?? "") !== String(expectedBaskets)) {
        const e = new Error("El cálculo de canastas debe coincidir con el lote y la capacidad. Vuelve a guardar la capacidad.");
        e.status = 400;
        throw e;
      }
    }

    if (deliveryChanged) {
      const oldDelivered = numeric(previous.entregado);
      const newDelivered = numeric(candidate.entregado);
      const target = numeric(previous.lote) || numeric(previous.cantidad);
      if (newDelivered <= oldDelivered || newDelivered > target) {
        const e = new Error("La entrega debe aumentar el saldo registrado sin superar el lote pendiente.");
        e.status = 400;
        throw e;
      }

      const oldEvents = Array.isArray(previous.entregas) ? previous.entregas : [];
      const newEvents = Array.isArray(candidate.entregas) ? candidate.entregas : [];
      if (newEvents.length !== oldEvents.length + 1 ||
          !oldEvents.every((event, index) => stableStringify(event) === stableStringify(newEvents[index]))) {
        const e = new Error("No se pudo validar el movimiento de entrega. No se guardó.");
        e.status = 400;
        throw e;
      }
      const movement = newEvents[newEvents.length - 1];
      if (numeric(movement && movement.cantidad) !== newDelivered - oldDelivered) {
        const e = new Error("Las unidades del movimiento no coinciden con la cantidad entregada.");
        e.status = 400;
        throw e;
      }
      const expectedStatus = newDelivered >= target ? "Entregada" : "Parcial";
      if (candidate.estado !== expectedStatus ||
          stableStringify(candidate.entrega || null) !== stableStringify(movement)) {
        const e = new Error("El estado de la entrega no coincide con el movimiento.");
        e.status = 400;
        throw e;
      }

      const oldConf = Array.isArray(previous.confirmacionesCanastas) ? previous.confirmacionesCanastas : [];
      const newConf = Array.isArray(candidate.confirmacionesCanastas) ? candidate.confirmacionesCanastas : [];
      const physicalCount = numeric(movement.canastasFisicas);
      const expectedConfLength = oldConf.length + (physicalCount > 0 ? 1 : 0);
      if (newConf.length !== expectedConfLength ||
          !oldConf.every((event, index) => stableStringify(event) === stableStringify(newConf[index]))) {
        const e = new Error("No se pudo validar la cantidad de canastas físicas. No se guardó.");
        e.status = 400;
        throw e;
      }
      if (physicalCount > 0) {
        const last = newConf[newConf.length - 1];
        if (numeric(last && last.cantidad) !== physicalCount ||
            numeric(last && last.unidades) !== newDelivered - oldDelivered ||
            numeric(candidate.canastasEntregadas) !== numeric(previous.canastasEntregadas) + physicalCount) {
          const e = new Error("Las canastas registradas no coinciden con las unidades entregadas.");
          e.status = 400;
          throw e;
        }
      } else {
        if (stableStringify(candidate.confirmacionesCanastas || []) !== stableStringify(previous.confirmacionesCanastas || [])) {
          const e = new Error("No se pudieron validar las canastas físicas. No se guardó.");
          e.status = 400;
          throw e;
        }
        const oldBasketEquivalent = numeric(previous.canastasEntregadas);
        const newBasketEquivalent = numeric(candidate.canastasEntregadas);
        const effectiveCapacity = capacityChanged ? newCapacity : numeric(previous.cantidadCanasta);
        const expectedBasketEquivalent = effectiveCapacity > 0
          ? Number((newDelivered / effectiveCapacity).toFixed(4))
          : oldBasketEquivalent;
        const unchangedEquivalent = newBasketEquivalent === oldBasketEquivalent;
        const calculatedEquivalent = Math.abs(newBasketEquivalent - expectedBasketEquivalent) < 0.0001;
        if (!unchangedEquivalent && !calculatedEquivalent) {
          const e = new Error("El cálculo de canastas equivalentes no coincide con las unidades entregadas.");
          e.status = 400;
          throw e;
        }
      }
    }

    const updated = { ...previous };
    if (capacityChanged) {
      updated.cantidadCanasta = newCapacity;
      updated.cantidadCanastaRaw = String(newCapacity);
      const target = numeric(previous.lote) || numeric(previous.cantidad);
      if (target > 0) {
        updated.numCanastas = Math.ceil(target / newCapacity);
        updated.numCanastasRaw = String(updated.numCanastas);
      }
    }
    if (deliveryChanged) {
      for (const field of DELIVERY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(candidate, field)) updated[field] = candidate[field];
        else delete updated[field];
      }
    }
    merged.push(updated);
  }

  return merged;
}

export async function onRequest({ request, env }) {
  try {
    const auth = await authenticate(request, env);
    if (request.method === "GET") {
      return json(stateForClient(auth.state, auth.user.role));
    }

    if (request.method !== "PUT") {
      return json({ ok: false, error: "Método no permitido." }, 405, { Allow: "GET, PUT" });
    }

    let incoming;
    try { incoming = await request.json(); }
    catch { return json({ ok: false, error: "El contenido enviado no es un JSON válido." }, 400); }

    if (!incoming || !Array.isArray(incoming.tasks)) {
      return json({ ok: false, error: "El estado enviado no contiene una lista válida de tareas." }, 400);
    }

    const role = auth.user.role;
    let next;
    if (role === "Admin") {
      if (!incoming.users || typeof incoming.users !== "object" || Array.isArray(incoming.users)) {
        return json({ ok: false, error: "La lista de usuarios no es válida." }, 400);
      }
      const ids = incoming.tasks.map(t => String(t && t.id));
      if (new Set(ids).size !== ids.length) {
        return json({ ok: false, error: "Hay identificadores de tareas repetidos. No se guardó." }, 400);
      }
      next = {
        users: incoming.users,
        tasks: incoming.tasks,
        lpnCatalog: Array.isArray(incoming.lpnCatalog) ? incoming.lpnCatalog : auth.state.lpnCatalog
      };
    } else if (MANAGERS.has(role)) {
      next = {
        users: auth.state.users,
        tasks: incoming.tasks,
        lpnCatalog: Array.isArray(incoming.lpnCatalog) ? incoming.lpnCatalog : auth.state.lpnCatalog
      };
    } else if (role === "Patinador") {
      next = {
        users: auth.state.users,
        tasks: mergePatinadorTasks(auth.state.tasks, incoming.tasks, auth.user),
        lpnCatalog: auth.state.lpnCatalog
      };
    } else {
      return json({ ok: false, error: "Tu usuario no tiene permiso para guardar cambios." }, 403);
    }

    await writeState(env, next);
    const stored = await readState(env);
    return json(stateForClient(stored, role));
  } catch (error) {
    return errorResponse(error, "No se pudo leer o guardar el estado. No vuelvas a intentar hasta verificar la conexión.");
  }
}
