 const http=require('http');
const fs=require('fs');
const path=require('path');

const PORT=process.env.PORT||8080;
const ROOT=path.join(__dirname,'public');
const DATA_DIR=path.join(__dirname,'data');
const STATE_FILE=path.join(DATA_DIR,'state.json');
const HISTORY_DIR=path.join(DATA_DIR,'history');
const sessions=new Map();
const SESSION_TTL=12*60*60*1000;
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function authorized(req){const h=String(req.headers.authorization||'');const token=h.startsWith('Bearer ')?h.slice(7):'';const session=sessions.get(token);if(!session)return false;if(session.expires<Date.now()){sessions.delete(token);return false;}session.expires=Date.now()+SESSION_TTL;return true;}

// Cuentas base: solo administración. Las cuentas de patinadores retiradas
// no deben recrearse automáticamente al iniciar ni al leer el estado.
const defaultUsers={
admin:{pass:'admin',role:'Admin',name:'Administrador'}
};
const retiredPatinadores=['juanesteban','jorge','hamilton'];

function ensureState(){
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:defaultUsers,tasks:[]},null,2));
}
function readState(){
ensureState();
try{
const s=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
if(!s.users)s.users={...defaultUsers};
for(const [key,user] of Object.entries(defaultUsers)){if(!s.users[key])s.users[key]=user;}
let usersChanged=false;
for(const key of [...retiredPatinadores,'mesanin']){if(Object.prototype.hasOwnProperty.call(s.users,key)){delete s.users[key];usersChanged=true;}}
if(usersChanged)writeState(s);
if(s.users.fredy && s.users.fredy.role==='Admin'){s.users.fredy.role='Supervisor';writeState(s);}
if(!Array.isArray(s.tasks))s.tasks=[];
if(!Array.isArray(s.lpnCatalog))s.lpnCatalog=[];
if(!Array.isArray(s.freeDeliveries))s.freeDeliveries=[];
return s;
}catch{return {users:defaultUsers,tasks:[],lpnCatalog:[],freeDeliveries:[]};}
}
function writeState(s){ensureState();const tmp=STATE_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s,null,2));fs.renameSync(tmp,STATE_FILE);}
function archiveTasks(tasks,meta={}){fs.mkdirSync(HISTORY_DIR,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-');const file=path.join(HISTORY_DIR,'jornada-'+stamp+'.json');fs.writeFileSync(file,JSON.stringify({app:'Familia AKT Control de Canastas',fechaCierre:new Date().toISOString(),meta,tasks},null,2));return {file:path.basename(file),count:tasks.length};}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{
const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const p=decodeURIComponent(url.pathname);
res.setHeader('Vary','Origin');res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');res.setHeader('Cache-Control','no-store');
if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,PUT,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');return res.end();}
if(p==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:true,service:'familia-akt-control-canastas'}));}
if(p==='/api/login'&&req.method==='POST'){
let body='';req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});req.on('end',()=>{try{
 const incoming=JSON.parse(body||'{}'),username=String(incoming.username||'').trim().toLowerCase(),password=String(incoming.password||''),state=readState();
 if(username==='patinadores'){
  const creds=state.patinadoresAuth||{},turnoLogin=creds.passDia===password?'Día':(creds.passNoche===password?'Noche':null);
  if(!turnoLogin)return sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});
  const profiles=Object.entries(state.users||{}).filter(([,u])=>u&&u.role==='Patinador').map(([key,u])=>({username:key,name:u.name||key,role:'Patinador',areas:u.areas||[],puestos:u.puestos||[],turno:u.turno||'Todos'}));
  if(!profiles.length)return sendJson(res,409,{ok:false,error:'No hay patinadores registrados.'});
  const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username:'patinadores',expires:Date.now()+SESSION_TTL});
  return sendJson(res,200,{ok:true,token,sharedPatinadores:true,patinadores:profiles,user:{username:'patinadores',name:'Patinadores',role:'Patinador',turno:turnoLogin}});
 }
 let user=state.users[username],turnoLogin=null,passwordValid=false;
 if(user&&user.role==='Patinador'&&(typeof user.passDia==='string'||typeof user.passNoche==='string')){
  if(typeof user.passDia==='string'&&user.passDia===password){passwordValid=true;turnoLogin='Día';}
  else if(typeof user.passNoche==='string'&&user.passNoche===password){passwordValid=true;turnoLogin='Noche';}
 }else if(user&&typeof user.pass==='string'&&user.pass===password){passwordValid=true;turnoLogin=user.turno||'Todos';}
 if(!passwordValid&&username==='admin'&&process.env.ADMIN_RECOVERY_PASSWORD&&password===process.env.ADMIN_RECOVERY_PASSWORD&&!state.adminRecoveryUsed&&user&&user.role==='Admin'){user.pass=password;state.adminRecoveryUsed=true;writeState(state);passwordValid=true;}
 if(!user||!passwordValid)return sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});
 const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});
 return sendJson(res,200,{ok:true,token,user:{username,name:user.name,role:user.role,turno:turnoLogin,areas:user.areas||[],puestos:user.puestos||[]}});
 }catch{return sendJson(res,400,{ok:false,error:'Solicitud inválida'});}});return;
}
if(p==='/api/admin/patinadores-credentials'&&req.method==='POST'){
 const token=String(req.headers.authorization||'').slice(7),session=sessions.get(token),state=readState();
 if(!session||session.username!=='admin'||!state.users.admin||state.users.admin.role!=='Admin')return sendJson(res,403,{ok:false,error:'Solo el administrador puede configurar estas claves.'});
 let body='';req.on('data',c=>{body+=c;if(body.length>10000)req.destroy();});req.on('end',()=>{try{
  const incoming=JSON.parse(body||'{}'),passDia=String(incoming.passDia||''),passNoche=String(incoming.passNoche||'');
  if(passDia.length<4||passNoche.length<4)return sendJson(res,400,{ok:false,error:'Cada contraseña debe tener mínimo 4 caracteres.'});
  state.patinadoresAuth={passDia,passNoche,updatedAt:new Date().toISOString()};writeState(state);
  return sendJson(res,200,{ok:true});
 }catch{return sendJson(res,400,{ok:false,error:'Solicitud inválida.'});}});
 return;
}
if(p.startsWith('/api/')&&p!=='/api/login'&&!authorized(req))return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});
if(p==='/api/admin/deduplicate-standard-tasks'&&req.method==='POST'){
 const sessionToken=String(req.headers.authorization||'').slice(7),session=sessions.get(sessionToken),state=readState();
 if(!session||!state.users[session.username]||state.users[session.username].role!=='Admin')return sendJson(res,403,{ok:false,error:'Solo administración puede limpiar duplicados.'});
 let body='';req.on('data',c=>{body+=c;if(body.length>10000)req.destroy();});req.on('end',()=>{
  try{
   const incoming=JSON.parse(body||'{}');
   if(incoming.confirmacion!=='LIMPIAR DUPLICADOS NKD')return sendJson(res,400,{ok:false,error:'Confirmación inválida.'});
   const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
   const puesto=v=>{const x=norm(v);let m=x.match(/^pre\s*0*(\d+)/);if(m)return 'pre '+Number(m[1]);m=x.match(/^0*(\d+)\s*(derecho|izquierdo)$/);if(m)return m[2]+' '+Number(m[1]);m=x.match(/^(derecho|izquierdo|final(?: de linea)?)\s*0*(\d+)/);if(m)return (m[1].startsWith('final')?'final':m[1])+' '+Number(m[2]);return x;};
   const isNkd=t=>t&&t.standardNKD&&String(t.standardMoto||t.modelo||t.modeloMoto||t.moto||'NKD').trim().toUpperCase()==='NKD';
   const key=t=>[norm(t.ean).replace(/\s/g,''),norm(t.producto||t.lpn||t.ean),puesto(t.puesto)].join('|');
   const groups=new Map();
   state.tasks.forEach((t,i)=>{if(!isNkd(t)||!String(t.ean||'').trim()||!String(t.puesto||'').trim())return;const k=key(t);if(!groups.has(k))groups.set(k,[]);groups.get(k).push({t,i});});
   const allDupGroups=[...groups.values()].filter(g=>g.length>1);
   const dupGroups=allDupGroups.filter(g=>new Set(g.map(x=>Number(x.t.cantidad)||0)).size===1);
   const skippedConflicts=allDupGroups.length-dupGroups.length;
   if(incoming.preview===true)return sendJson(res,200,{ok:true,preview:true,duplicateGroups:dupGroups.length,duplicateRows:dupGroups.reduce((n,g)=>n+g.length-1,0),skippedConflicts,examples:dupGroups.slice(0,25).map(g=>({ean:g[0].t.ean,producto:g[0].t.producto,puesto:g[0].t.puesto,copias:g.length,entregados:g.map(x=>Number(x.t.entregado)||0),cantidades:g.map(x=>Number(x.t.cantidad)||0)}))});
   const backupDir=path.join(DATA_DIR,'history');fs.mkdirSync(backupDir,{recursive:true});
   const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupName='backup-antes-limpieza-duplicados-'+stamp+'.json';
   fs.writeFileSync(path.join(backupDir,backupName),JSON.stringify({fecha:new Date().toISOString(),motivo:'Backup íntegro previo a deduplicación NKD',state},null,2));
   const remove=new Set(),replace=new Map();
   for(const g of dupGroups){
    const score=x=>(Number(x.t.entregado)||0)*100000+(Array.isArray(x.t.entregas)?x.t.entregas.length:0)*100+(x.t.estado==='Entregada'?1:0);
    const sorted=[...g].sort((a,b)=>score(b)-score(a)),keep=sorted[0],events=[],seen=new Set();
    for(const item of sorted)for(const ev of (Array.isArray(item.t.entregas)?item.t.entregas:[])){const sig=ev&&ev.id!=null?'id:'+ev.id:JSON.stringify(ev);if(!seen.has(sig)){seen.add(sig);events.push(ev);}}
    const delivered=Math.max(...sorted.map(x=>Math.max(0,Number(x.t.entregado)||0)));
    replace.set(keep.i,{...keep.t,entregado:delivered,entregas:events,entrega:sorted.find(x=>x.t.entrega)?.t.entrega||keep.t.entrega,estado:delivered>=Number(keep.t.cantidad||0)?'Entregada':'Pendiente'});
    sorted.slice(1).forEach(x=>remove.add(x.i));
   }
   state.tasks=state.tasks.map((t,i)=>replace.has(i)?replace.get(i):t).filter((t,i)=>!remove.has(i));
   writeState(state);
   return sendJson(res,200,{ok:true,backup:backupName,duplicateGroups:dupGroups.length,removed:remove.size,skippedConflicts,remainingTasks:state.tasks.length});
  }catch(e){console.error('deduplicate standard tasks failed',e);return sendJson(res,500,{ok:false,error:'No se pudo completar la limpieza.'});}
 });return;
}
if(p==='/api/state'&&req.method==='GET'){const safe=readState();delete safe.patinadoresAuth;return sendJson(res,200,safe);}
if(p==='/api/jornada/cerrar'&&req.method==='POST'){
let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{
const incoming=JSON.parse(body||'{}');const state=readState();
if(!Array.isArray(state.tasks))state.tasks=[];
if(incoming.confirmacion!=='CERRAR JORNADA'){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:false,error:'Confirmación inválida'}));}
if(!state.tasks.length){res.writeHead(409,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:false,error:'No hay tareas activas para archivar'}));}
const snapshot=state.tasks.map(t=>({...t,entregas:Array.isArray(t.entregas)?t.entregas.map(e=>({...e})):[],confirmacionesCanastas:Array.isArray(t.confirmacionesCanastas)?t.confirmacionesCanastas.map(e=>({...e})):[],correcciones:Array.isArray(t.correcciones)?t.correcciones.map(e=>({...e})):[]}));
const archived=archiveTasks(snapshot,{usuario:String(incoming.usuario||'Admin'),motivo:'Cierre de jornada e inicio de nueva operación',regla:'Se guarda una copia íntegra de la jornada cerrada en el historial. Todas las tareas continúan activas para la nueva operación, con entregas de unidades y canastas reiniciadas a cero para todos los patinadores.'});
state.tasks=state.tasks.map(t=>({...t,entregado:0,entregas:[],entrega:null,canastasEntregadas:0,confirmacionesCanastas:[],correcciones:[],estado:'Pendiente'}));
writeState(state);
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
res.end(JSON.stringify({ok:true,archived:archived.file,count:archived.count,completedRemoved:snapshot.filter(isComplete).length,remainingCount:state.tasks.length,tasks:state.tasks}));
}catch(e){console.error('Error cerrando jornada:',e);res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:'No se pudo cerrar la jornada'}));}});return;
}
if(p==='/api/jornada/continuar-pendientes'&&req.method==='POST'){
const token=String(req.headers.authorization||'').slice(7),session=sessions.get(token),state=readState();
if(!session||!state.users[session.username]||state.users[session.username].role!=='Admin')return sendJson(res,403,{ok:false,error:'Solo el administrador puede preparar la continuidad de tareas.'});
let body='';req.on('data',c=>{body+=c;if(body.length>10000)req.destroy();});req.on('end',()=>{
try{
const incoming=JSON.parse(body||'{}');
if(!Array.isArray(state.tasks)||!state.tasks.length)return sendJson(res,409,{ok:false,error:'No hay tareas activas para continuar.'});
const fingerprint=JSON.stringify(state.tasks);
if(state.continuidadPendienteActiva&&state.continuidadPendienteActiva.fingerprint===fingerprint)return sendJson(res,409,{ok:false,error:'La continuidad ya fue preparada y no hay nuevas entregas que continuar.'});
const objetivo=t=>{
 if(!t)return 0;
 if(t.standardNKD){
  const lote=Number(String(t.lote??'').replace(',','.'))||0;
  if(lote>0)return lote;
  const cap=Number(String(t.cantidadCanasta??'').replace(',','.'))||0;
  const canastas=Number(String(t.numCanastas??'').replace(',','.'))||0;
  if(cap>0&&canastas>0)return cap*canastas;
  const unidad=Number(String(t.cantidadUnidad??'').replace(',','.'))||0;
  const cantidad=Number(String(t.cantidad??'').replace(',','.'))||0;
  return unidad>0?unidad:(cap>0?cap:cantidad);
 }
 return Math.max(0,Number(t.cantidad)||0);
};
const stamp=Date.now(),fecha=new Date().toLocaleString('es-CO');
const snapshot=state.tasks.map(t=>JSON.parse(JSON.stringify(t)));
const pendientes=[];
snapshot.forEach((t,i)=>{
 const total=Math.max(0,objetivo(t)),entregado=Math.max(0,Number(t.entregado)||0),restante=Math.max(0,total-entregado);
 if(restante<=0)return;
 const next={...t,id:String(t.id)+'-continuidad-'+stamp+'-'+i,cantidad:restante,entregado:0,entregas:[],entrega:null,canastasEntregadas:0,confirmacionesCanastas:[],correcciones:[],estado:'Pendiente',continuidadDeTareaId:t.id,continuidadFecha:fecha,unidadesObjetivoAnterior:total,unidadesEntregadasJornadaAnterior:Math.min(total,entregado),unidadesPendientesContinuadas:restante};
 if(t.standardNKD){
  next.lote=restante;
  if(Object.prototype.hasOwnProperty.call(t,'lotePiezas'))next.lotePiezas=restante;
  const cap=Number(String(t.cantidadCanasta??'').replace(',','.'))||0;
  if(cap>0){next.numCanastas=Math.ceil(restante/cap);if(Object.prototype.hasOwnProperty.call(t,'numCanastasRaw'))next.numCanastasRaw=String(next.numCanastas);}
 }
 pendientes.push(next);
});
if(!pendientes.length)return sendJson(res,409,{ok:false,error:'No hay cantidades pendientes. No se modificó ni archivó ningún dato.'});
const archivados=snapshot.map(t=>({...t,archivadaEn:fecha,archivadaPor:String(incoming.usuario||'Admin'),motivoArchivo:'Cierre de jornada y preparación de continuidad de cantidades pendientes'}));
const archivedFile=archiveTasks(snapshot,{usuario:String(incoming.usuario||'Admin'),motivo:'Cierre de jornada y preparación de continuidad',regla:'Se conserva la jornada completa. Solo las cantidades pendientes pasan a la nueva jornada; las unidades entregadas quedan en el historial.'});
state.tareasArchivadas=[...(Array.isArray(state.tareasArchivadas)?state.tareasArchivadas:[]),...archivados];
state.tasks=pendientes;
state.continuidadPendienteActiva={fecha,archivo:archivedFile.file,fingerprint:JSON.stringify(state.tasks)};
writeState(state);
return sendJson(res,200,{ok:true,archived:archivedFile.file,archivedCount:snapshot.length,pendingCount:pendientes.length,pendingUnits:pendientes.reduce((n,t)=>n+Math.max(0,Number(t.cantidad)||0),0),tasks:state.tasks});
}catch(e){console.error('Error preparando continuidad de pendientes:',e);return sendJson(res,500,{ok:false,error:'No se pudo preparar la continuidad de tareas.'});}
});return;
}
if(p==='/api/state'&&req.method==='PUT'){
let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{
const incoming=JSON.parse(body||'{}'),current=readState(),nextUsers=incoming.users||current.users;delete nextUsers.mesanin;
const state={...current,users:nextUsers,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog,freeDeliveries:Array.isArray(incoming.freeDeliveries)?incoming.freeDeliveries:(current.freeDeliveries||[]),estibasRecibidas:Array.isArray(incoming.estibasRecibidas)?incoming.estibasRecibidas:(current.estibasRecibidas||[]),queuedStandardBatches:Array.isArray(incoming.queuedStandardBatches)?incoming.queuedStandardBatches:(current.queuedStandardBatches||[]),tareasArchivadas:Array.isArray(incoming.tareasArchivadas)?incoming.tareasArchivadas:(current.tareasArchivadas||[])};
const queued=state.queuedStandardBatches[0];
if(queued&&queued.modeloActual&&Array.isArray(queued.tasks)&&queued.tasks.length){
 const activeModel=String(queued.modeloActual),modelOf=t=>String(t&& (t.standardMoto||(t.standardNKD?'NKD':''))||'');
 const active=state.tasks.filter(t=>t&&t.standardNKD&&modelOf(t)===activeModel);
 const objective=t=>{const basket=Number(String(t.cantidadCanasta??'').replace(',','.'))||0,baskets=Number(String(t.numCanastas??'').replace(',','.'))||0,lot=Number(String(t.lote??'').replace(',','.'))||0,unit=Number(String(t.cantidadUnidad??'').replace(',','.'))||0,qty=Number(String(t.cantidad??'').replace(',','.'))||0;return lot>0?lot:(basket>0&&baskets>0?basket*baskets:(unit>0?unit:(basket>0?basket:qty)));};
 const total=active.reduce((n,t)=>n+Math.max(0,objective(t)),0),delivered=active.reduce((n,t)=>n+Math.min(Math.max(0,Number(t.entregado)||0),Math.max(0,objective(t))),0);
 const target=state.tasks.filter(t=>t&&t.standardNKD&&modelOf(t)===String(queued.modelo)&&modelOf(t)!==activeModel);
 const targetHasPartial=target.some(t=>(Number(t.entregado)||0)>0&&(Number(t.entregado)||0)<objective(t));
 if(total>0&&delivered>=total&& !targetHasPartial){
  const affected=new Set([activeModel,String(queued.modelo)]),stamp=new Date().toLocaleString('es-CO');
  const archived=state.tasks.filter(t=>t&&t.standardNKD&&affected.has(modelOf(t))).map(t=>({...t,archivadaEn:stamp,archivadaPor:'Sistema',motivoArchivo:'Cierre automático de lote completado'}));
  state.tareasArchivadas=[...(state.tareasArchivadas||[]),...archived];
  state.tasks=state.tasks.filter(t=>!(t&&t.standardNKD&&affected.has(modelOf(t)))).concat(queued.tasks.map(t=>({...t})));
  state.queuedStandardBatches=[];
  state.ultimoLoteActivadoAutomaticamente={modelo:queued.modelo,codigo:queued.codigo,fechaHora:new Date().toISOString(),loteAnterior:activeModel};
 }
}
writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));
}catch(e){console.error('Error guardando estado:',e);res.writeHead(400);res.end(JSON.stringify({error:'JSON invalido'}));}});return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=44"></script><script src="/profesional.js?v=3"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
ensureState();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
