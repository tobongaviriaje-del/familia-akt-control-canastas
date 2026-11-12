import { json, errorResponse, stableStringify } from "../_lib/db.js";
import { authenticate } from "../_lib/auth.js";

const MODELS = new Set(["NKD","CR4 150","CR4 125","VOGI 180","VOGE 180","CH"]);
const DELIVERY_FIELDS = ["entregado","estado","entregas","entrega","canastasEntregadas","confirmacionesCanastas"];
const CAPACITY_FIELDS = ["cantidadCanasta","cantidadCanastaRaw","numCanastas","numCanastasRaw"];

function fail(message, status=400) { const e=new Error(message); e.status=status; throw e; }
function number(v) { const n=Number(v); return Number.isFinite(n)?n:0; }
function targetOf(task) { const lot=number(task.lote); if(lot>0)return lot; const baskets=number(task.cantidadCanasta), count=number(task.numCanastas); if(baskets>0&&count>0)return baskets*count; return number(task.cantidadUnidad)||number(task.cantidad)||baskets; }
function modelOf(task) { return String(task.standardMoto || (task.standardNKD ? "NKD" : "")).trim().toUpperCase().replace("VOGUE 180","VOGE 180"); }
function without(value, fields) { const copy={...(value||{})}; for(const f of fields) delete copy[f]; return copy; }
function cleanNewLot(tasks) {
  return tasks.map(task=>{
    const copy={...task};
    copy.entregado=0; copy.estado="Pendiente"; copy.entregas=[]; copy.entrega=null;
    copy.canastasEntregadas=0; copy.confirmacionesCanastas=[];
    return copy;
  });
}
async function ensureTables(DB) {
  await DB.prepare("CREATE TABLE IF NOT EXISTS app_work_lots (id TEXT PRIMARY KEY, model TEXT NOT NULL, lot_number INTEGER NOT NULL, tasks_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(model, lot_number))").run();
}
function validateAndMerge(saved, incoming, user) {
  if(!Array.isArray(incoming)) fail("La lista de referencias no es válida.");
  const byId=new Map(incoming.map(x=>[String(x&&x.id),x]));
  if(byId.size!==incoming.length) fail("Hay referencias repetidas.",409);
  const assigned=new Set(Array.isArray(user.puestos)?user.puestos.map(String):[]);
  const result=[];
  for(const old of saved) {
    const key=String(old.id), candidate=byId.get(key);
    if(!candidate){result.push(old);continue;}
    byId.delete(key);
    if(!assigned.has(String(old.puesto||""))) fail("No tienes permiso para modificar este puesto.",403);
    if(stableStringify(without(old,[...DELIVERY_FIELDS,...CAPACITY_FIELDS]))!==stableStringify(without(candidate,[...DELIVERY_FIELDS,...CAPACITY_FIELDS]))) fail("No puedes modificar referencias ni cantidades originales.",403);
    const oldCapacity=number(old.cantidadCanasta), newCapacity=number(candidate.cantidadCanasta);
    const oldDelivered=number(old.entregado), newDelivered=number(candidate.entregado), target=targetOf(old);
    const capacityFields=["cantidadCanasta","cantidadCanastaRaw","numCanastas","numCanastasRaw"];
    const capacityChanged=stableStringify(without(old,DELIVERY_FIELDS))!==stableStringify(without(candidate,DELIVERY_FIELDS)) &&
      stableStringify(capacityFields.map(k=>old[k]??null))!==stableStringify(capacityFields.map(k=>candidate[k]??null));
    if(capacityChanged) {
      if(!Number.isInteger(newCapacity)||newCapacity<1 || String(candidate.cantidadCanastaRaw??"")!==String(newCapacity)) fail("La capacidad debe ser un entero válido.");
      const expectedBaskets=target>0?Math.ceil(target/newCapacity):number(old.numCanastas);
      if(number(candidate.numCanastas)!==expectedBaskets || String(candidate.numCanastasRaw??"")!==String(expectedBaskets)) fail("El cálculo de canastas no coincide con el lote.");
    }
    if(newDelivered<oldDelivered||newDelivered>target) fail("La entrega no puede disminuir ni superar el lote.",409);
    const oldEvents=Array.isArray(old.entregas)?old.entregas:[], newEvents=Array.isArray(candidate.entregas)?candidate.entregas:[];
    const oldConf=Array.isArray(old.confirmacionesCanastas)?old.confirmacionesCanastas:[], newConf=Array.isArray(candidate.confirmacionesCanastas)?candidate.confirmacionesCanastas:[];
    if(newDelivered!==oldDelivered) {
      if(newEvents.length!==oldEvents.length+1 || !oldEvents.every((e,i)=>stableStringify(e)===stableStringify(newEvents[i]))) fail("El movimiento de entrega no coincide.",409);
      const movement=newEvents[newEvents.length-1], physical=number(movement&&movement.canastasFisicas);
      if(physical!==0&&(!Number.isInteger(physical)||physical<1)) fail("La cantidad de canastas físicas no es válida.");
      if(number(movement&&movement.cantidad)!==newDelivered-oldDelivered) fail("La cantidad del movimiento no coincide.");
      const expected=newDelivered>=target?"Entregada":"Parcial";
      if(candidate.estado!==expected || stableStringify(candidate.entrega||null)!==stableStringify(movement)) fail("El estado de entrega no coincide.");
      if(newConf.length!==oldConf.length+(physical>0?1:0) || !oldConf.every((e,i)=>stableStringify(e)===stableStringify(newConf[i]))) fail("La confirmación de canastas no coincide.",409);
      if(physical>0) {
        const last=newConf[newConf.length-1];
        if(number(last&&last.cantidad)!==physical || number(last&&last.unidades)!==newDelivered-oldDelivered || number(candidate.canastasEntregadas)!==number(old.canastasEntregadas)+physical) fail("Las canastas físicas no coinciden con las unidades.");
      } else if(stableStringify(newConf)!==stableStringify(oldConf) || number(candidate.canastasEntregadas)!==number(old.canastasEntregadas)) fail("No se permiten cambios en las canastas físicas.",403);
    } else if(stableStringify(newEvents)!==stableStringify(oldEvents) || stableStringify(newConf)!==stableStringify(oldConf) || number(candidate.canastasEntregadas)!==number(old.canastasEntregadas) || candidate.estado!==old.estado || stableStringify(candidate.entrega||null)!==stableStringify(old.entrega||null)) fail("No se permiten cambios en el historial de entregas.",403);
    const merged={...old};
    for(const f of CAPACITY_FIELDS) if(Object.prototype.hasOwnProperty.call(candidate,f)) merged[f]=candidate[f]; else delete merged[f];
    for(const f of DELIVERY_FIELDS) if(Object.prototype.hasOwnProperty.call(candidate,f)) merged[f]=candidate[f]; else delete merged[f];
    result.push(merged);
  }
  if(byId.size) fail("La lista contiene referencias que no pertenecen a este lote.",409);
  return result;
}
async function getOrCreate(DB, model, state, username) {
  let row=await DB.prepare("SELECT * FROM app_work_lots WHERE model=? ORDER BY lot_number DESC LIMIT 1").bind(model).first();
  if(!row) {
    const tasks=(state.tasks||[]).filter(t=>t.standardNKD&&modelOf(t)===model);
    if(!tasks.length) fail("No hay referencias originales cargadas para "+model+".",404);
    const now=new Date().toISOString(), id=crypto.randomUUID();
    await DB.prepare("INSERT OR IGNORE INTO app_work_lots (id,model,lot_number,tasks_json,created_by,created_at,updated_at) VALUES (?,?,1,?,?,?,?)")
      .bind(id,model,JSON.stringify(tasks),username,now,now).run();
    row=await DB.prepare("SELECT * FROM app_work_lots WHERE model=? ORDER BY lot_number DESC LIMIT 1").bind(model).first();
  }
  return row;
}
function responseFor(row,user,allRows) {
  const assigned=new Set(Array.isArray(user.puestos)?user.puestos.map(String):[]);
  let tasks=JSON.parse(row.tasks_json||"[]");
  tasks=tasks.filter(t=>assigned.has(String(t.puesto||"")));
  return {ok:true,lot:{id:row.id,model:row.model,number:Number(row.lot_number),createdAt:row.created_at},lots:allRows.map(x=>({id:x.id,number:Number(x.lot_number)})),tasks};
}
export async function onRequest({request,env}) {
  try {
    const auth=await authenticate(request,env);
    if(auth.user.role!=="Patinador") return json({ok:false,error:"Esta función está disponible para Patinadores."},403);
    await ensureTables(env.DB);
    const url=new URL(request.url);
    if(request.method==="GET") {
      const model=String(url.searchParams.get("model")||"").trim().toUpperCase().replace("VOGUE 180","VOGE 180");
      if(!MODELS.has(model)) fail("Selecciona un modelo válido.");
      const row=await getOrCreate(env.DB,model,auth.state,auth.username);
      const all=await env.DB.prepare("SELECT id,lot_number FROM app_work_lots WHERE model=? ORDER BY lot_number").bind(model).all();
      return json(responseFor(row,auth.user,all.results||[]));
    }
    if(request.method==="POST") {
      const body=await request.json();
      const model=String(body.model||"").trim().toUpperCase().replace("VOGUE 180","VOGE 180");
      if(!MODELS.has(model)) fail("Selecciona un modelo válido.");
      const current=await getOrCreate(env.DB,model,auth.state,auth.username);
      let selected;
      if(body.action==="next") {
        const previous=JSON.parse(current.tasks_json||"[]");
        if(!previous.length) fail("El lote actual no tiene referencias para copiar.",409);
        const nextNo=Number(current.lot_number)+1, now=new Date().toISOString(), id=crypto.randomUUID();
        const cloned=cleanNewLot(previous);
        const ins=await env.DB.prepare("INSERT OR IGNORE INTO app_work_lots (id,model,lot_number,tasks_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
          .bind(id,model,nextNo,JSON.stringify(cloned),auth.username,now,now).run();
        selected=await env.DB.prepare("SELECT * FROM app_work_lots WHERE model=? AND lot_number=?").bind(model,nextNo).first();
        if(!selected) fail("No se pudo crear el lote siguiente. Actualiza y vuelve a intentar.",409);
      } else if(body.action==="select") {
        selected=await env.DB.prepare("SELECT * FROM app_work_lots WHERE model=? AND id=?").bind(model,String(body.lotId||"")).first();
        if(!selected) fail("No se encontró el lote anterior.",404);
      } else fail("Acción de lote no válida.");
      const all=await env.DB.prepare("SELECT id,lot_number FROM app_work_lots WHERE model=? ORDER BY lot_number").bind(model).all();
      return json(responseFor(selected,auth.user,all.results||[]));
    }
    if(request.method==="PUT") {
      const body=await request.json();
      const model=String(body.model||"").trim().toUpperCase().replace("VOGUE 180","VOGE 180");
      if(!MODELS.has(model)||!body.lotId) fail("Falta identificar el lote de trabajo.");
      const row=await env.DB.prepare("SELECT * FROM app_work_lots WHERE model=? AND id=?").bind(model,String(body.lotId)).first();
      if(!row) fail("El lote de trabajo ya no existe. Actualiza la pantalla.",404);
      const saved=JSON.parse(row.tasks_json||"[]");
      const merged=validateAndMerge(saved,body.tasks,auth.user);
      const now=new Date().toISOString()+"#"+crypto.randomUUID();
      const updated=await env.DB.prepare("UPDATE app_work_lots SET tasks_json=?,updated_at=? WHERE id=? AND updated_at=?")
        .bind(JSON.stringify(merged),now,row.id,row.updated_at).run();
      if(Number(updated.meta&&updated.meta.changes||0)!==1) fail("Otro patinador guardó cambios al mismo tiempo. Actualiza el lote antes de continuar.",409);
      const fresh=await env.DB.prepare("SELECT * FROM app_work_lots WHERE id=?").bind(row.id).first();
      const all=await env.DB.prepare("SELECT id,lot_number FROM app_work_lots WHERE model=? ORDER BY lot_number").bind(model).all();
      return json(responseFor(fresh,auth.user,all.results||[]));
    }
    return json({ok:false,error:"Método no permitido."},405,{Allow:"GET, POST, PUT"});
  } catch(error) { return errorResponse(error,"No se pudo guardar el lote de trabajo."); }
}
