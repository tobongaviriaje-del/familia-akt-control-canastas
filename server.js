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

const defaultUsers={
admin:{pass:'admin',role:'Admin',name:'Administrador'},
hamilton:{pass:'Hamilton123!',role:'Patinador',name:'Hamilton',areas:['PRE','Izquierdo'],puestos:[]},
juanesteban:{pass:'Juan123!',role:'Patinador',name:'Juan Esteban',areas:['PRE','Derecho'],puestos:[]},
jorge:{pass:'Jorge123!',role:'Patinador',name:'Jorge',areas:['PRE','Derecho','Izquierdo','Final de línea'],puestos:[]}
};

function ensureState(){
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:defaultUsers,tasks:[]},null,2));
}
function readState(){
ensureState();
try{
const s=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
if(!s.users)s.users=defaultUsers;
for(const [key,user] of Object.entries(defaultUsers)){if(!s.users[key])s.users[key]=user;}
if(s.users.mesanin){delete s.users.mesanin;writeState(s);}
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
const snapshot=state.tasks.map(t=>({...t}));
const archived=archiveTasks(snapshot,{usuario:String(incoming.usuario||'Admin'),motivo:'Cierre de jornada',regla:'Se archivan todas las tareas; las completadas salen de la lista activa y las pendientes/parciales conservan su avance para el siguiente turno.'});
const isComplete=t=>{const total=Number(t.cantidad)||0;const delivered=Number(t.entregado)||0;return total>0&&delivered>=total;};
state.tasks=state.tasks.filter(t=>!isComplete(t));
writeState(state);
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
res.end(JSON.stringify({ok:true,archived:archived.file,count:archived.count,completedRemoved:snapshot.filter(isComplete).length,remainingCount:state.tasks.length,tasks:state.tasks}));
}catch(e){console.error('Error cerrando jornada:',e);res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:'No se pudo cerrar la jornada'}));}});return;
}
if(p==='/api/state'&&req.method==='PUT'){
let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const current=readState();const nextUsers=incoming.users||current.users;delete nextUsers.mesanin;const state={...current,users:nextUsers,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog,freeDeliveries:Array.isArray(incoming.freeDeliveries)?incoming.freeDeliveries:(current.freeDeliveries||[])};writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}catch{res.writeHead(400);res.end(JSON.stringify({error:'JSON invalido'}));}});return;
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
