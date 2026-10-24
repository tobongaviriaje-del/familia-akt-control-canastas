 const http=require('http');
const fs=require('fs');
const path=require('path');

const PORT=process.env.PORT||8080;
const ROOT=path.join(__dirname,'public');
const DATA_DIR=path.resolve(process.env.DATA_DIR||path.join(__dirname,'data'));
const STATE_FILE=path.join(DATA_DIR,'state.json');
const HISTORY_DIR=path.join(DATA_DIR,'history');
const MAX_BODY_BYTES=1024*1024;
const production=process.env.NODE_ENV==='production';
const crypto=require('crypto');
const SESSION_COOKIE='familia_akt_session';
const sessions=new Map();
const loginAttempts=new Map();
const LOGIN_WINDOW_MS=15*60*1000;
const LOGIN_MAX_ATTEMPTS=8;
function loginRateLimitKey(req){return String(req.socket.remoteAddress||'unknown').replace(/^::ffff:/,'');}
function checkLoginLimit(req){const key=loginRateLimitKey(req),now=Date.now();let item=loginAttempts.get(key);if(!item||now-item.start>LOGIN_WINDOW_MS){item={start:now,count:0};loginAttempts.set(key,item);}if(item.count>=LOGIN_MAX_ATTEMPTS)return Math.max(1,Math.ceil((LOGIN_WINDOW_MS-(now-item.start))/1000));item.count++;return 0;}
function clearLoginAttempts(req){loginAttempts.delete(loginRateLimitKey(req));}
const SESSION_TTL_MS=8*60*60*1000;
function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const derived=crypto.scryptSync(password,salt,64);
  return 'scrypt$'+salt+'$'+derived.toString('hex');
}
function verifyPassword(password,stored){
  if(typeof stored!=='string')return false;
  if(stored.startsWith('scrypt$')){
    const parts=stored.split('$');
    if(parts.length!==3||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;
    const actual=crypto.scryptSync(password,parts[1],64);
    return crypto.timingSafeEqual(actual,Buffer.from(parts[2],'hex'));
  }
  const a=Buffer.from(stored),b=Buffer.from(password);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function safeUser(username,user){
  const {pass,password,...rest}=user||{};
  return {username,...rest};
}
function parseCookies(header=''){
  const out={};
  for(const part of header.split(';')){
    const i=part.indexOf('=');
    if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function sessionUser(req){
  const token=parseCookies(req.headers.cookie||'')[SESSION_COOKIE];
  const item=token&&sessions.get(token);
  if(!item)return null;
  if(item.expires<Date.now()){sessions.delete(token);return null;}
  const currentUser=readState().users?.[item.username];
  if(!currentUser){sessions.delete(token);return null;}
  item.user={...currentUser};
  item.expires=Date.now()+SESSION_TTL_MS;
  return {username:item.username,user:item.user,token};
}
function setSessionCookie(res,token,maxAge=SESSION_TTL_MS/1000){
  const bits=[SESSION_COOKIE+'='+encodeURIComponent(token),'Path=/','HttpOnly','SameSite=Lax','Max-Age='+Math.floor(maxAge)];
  if(production)bits.push('Secure');
  res.setHeader('Set-Cookie',bits.join('; '));
}
function requireSession(req,res){
  const session=sessionUser(req);
  if(!session){sendJson(res,401,{ok:false,error:'Inicia sesión para continuar'});return null;}
  return session;
}
function requireAdmin(req,res){
  const session=requireSession(req,res);
  if(!session)return null;
  if(session.user.role!=='Admin'){sendJson(res,403,{ok:false,error:'Permiso insuficiente'});return null;}
  return session;
}
function isSafeSameOrigin(req){
  const origin=req.headers.origin;
  if(!origin)return true;
  try{return new URL(origin).host===String(req.headers.host||'');}catch{return false;}
}


const defaultUsers={
admin:{pass:'admin',role:'Admin',name:'Administrador'},
mesanin:{pass:'mesanin123',role:'Mesanín',name:'Mesanín'},
hamilton:{pass:'Hamilton123!',role:'Patinador',name:'Hamilton',areas:['PRE','Izquierdo'],puestos:[]},
juanesteban:{pass:'Juan123!',role:'Patinador',name:'Juan Esteban',areas:['PRE','Derecho'],puestos:[]},
jorge:{pass:'Jorge123!',role:'Patinador',name:'Jorge',areas:['PRE','Derecho','Izquierdo','Final de línea'],puestos:[]}
};

function sendJson(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));}
function readBody(req,res,callback){let body='';let size=0;let finished=false;req.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>MAX_BODY_BYTES){finished=true;sendJson(res,413,{ok:false,error:'Solicitud demasiado grande'});req.resume();return;}body+=chunk.toString('utf8');});req.on('end',()=>{if(finished)return;try{callback(JSON.parse(body||'{}'));}catch{sendJson(res,400,{ok:false,error:'JSON inválido'});}});req.on('error',()=>{if(!finished)sendJson(res,400,{ok:false,error:'Solicitud incompleta'});});}

function ensureState(){
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:defaultUsers,tasks:[]},null,2));
}
function readState(){
ensureState();
try{
const s=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
if(!s.users)s.users=defaultUsers;
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
let url,p;
try{url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);p=decodeURIComponent(url.pathname);}catch{return sendJson(res,400,{error:'Solicitud inválida'});}
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");if(production)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
if(req.method==='OPTIONS'){res.writeHead(405);return res.end();}
if(p==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:true,service:'familia-akt-control-canastas'}));}
if(p==='/api/login'&&req.method==='POST'){
 if(!isSafeSameOrigin(req)){sendJson(res,403,{ok:false,error:'Origen no permitido'});return;}
 const retryAfter=checkLoginLimit(req);if(retryAfter){res.setHeader('Retry-After',String(retryAfter));sendJson(res,429,{ok:false,error:'Demasiados intentos. Espera antes de volver a intentar.'});return;}
 readBody(req,res,incoming=>{
  const username=String(incoming.username||'').trim().toLowerCase();
  const password=String(incoming.password||'');
  const state=readState();
  const user=state.users&&state.users[username];
  if(!user||!verifyPassword(password,user.pass)){
    sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});return;
  }
  if(!String(user.pass).startsWith('scrypt$')){user.pass=hashPassword(password);writeState(state);}
  const token=crypto.randomBytes(32).toString('base64url');
  sessions.set(token,{username,user:{...user},expires:Date.now()+SESSION_TTL_MS});
  clearLoginAttempts(req);
  setSessionCookie(res,token);
  sendJson(res,200,{ok:true,user:safeUser(username,user)});
 });return;
}
if(p==='/api/logout'&&req.method==='POST'){
 const token=parseCookies(req.headers.cookie||'')[SESSION_COOKIE];
 if(token)sessions.delete(token);
 setSessionCookie(res,'',0);sendJson(res,200,{ok:true});return;
}
if(p==='/api/session'&&req.method==='GET'){
 const session=sessionUser(req);
 if(!session){sendJson(res,401,{ok:false,error:'Sesión no válida'});return;}
 sendJson(res,200,{ok:true,user:safeUser(session.username,session.user)});return;
}
if(p==='/api/state'&&req.method==='GET'){
 const session=requireSession(req,res);if(!session)return;
 const state=readState();
 const users={};for(const [name,user] of Object.entries(state.users||{}))users[name]=safeUser(name,user);
 sendJson(res,200,{...state,users});return;
}
if(p==='/api/jornada/cerrar'&&req.method==='POST'){
const session=requireAdmin(req,res);if(!session)return;
if(!isSafeSameOrigin(req)){sendJson(res,403,{ok:false,error:'Origen no permitido'});return;}
readBody(req,res,incoming=>{try{
const state=readState();
if(!Array.isArray(state.tasks))state.tasks=[];
if(incoming.confirmacion!=='CERRAR JORNADA'){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:false,error:'Confirmación inválida'}));}
if(!state.tasks.length){res.writeHead(409,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:false,error:'No hay tareas activas para archivar'}));}
const snapshot=state.tasks.map(t=>({...t}));
const archived=archiveTasks(snapshot,{usuario:String(session.user.name||session.username),motivo:'Cierre de jornada',regla:'Se archivan todas las tareas; las completadas salen de la lista activa y las pendientes/parciales conservan su avance para el siguiente turno.'});
const isComplete=t=>{const total=Number(t.cantidad)||0;const delivered=Number(t.entregado)||0;return total>0&&delivered>=total;};
state.tasks=state.tasks.filter(t=>!isComplete(t));
writeState(state);
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
res.end(JSON.stringify({ok:true,archived:archived.file,count:archived.count,completedRemoved:snapshot.filter(isComplete).length,remainingCount:state.tasks.length,tasks:state.tasks}));
}catch(e){console.error('Error cerrando jornada:',e);sendJson(res,500,{ok:false,error:'No se pudo cerrar la jornada'});}});return;
}
if(p==='/api/entrega'&&req.method==='POST'){
 const session=requireSession(req,res);if(!session)return;
 if(!isSafeSameOrigin(req)){sendJson(res,403,{ok:false,error:'Origen no permitido'});return;}
 readBody(req,res,incoming=>{try{
  if(session.user.role!=='Patinador'&&session.user.role!=='Admin'&&session.user.role!=='Mesanín'){sendJson(res,403,{ok:false,error:'Este rol no puede registrar entregas'});return;}
  const id=String(incoming.id??'');const qty=Number(incoming.cantidad);const obs=String(incoming.observaciones||'').slice(0,500);
  if(!id||!Number.isSafeInteger(qty)||qty<1){sendJson(res,400,{ok:false,error:'Tarea o cantidad inválida'});return;}
  const state=readState();const task=state.tasks.find(t=>String(t.id)===id);
  if(!task){sendJson(res,404,{ok:false,error:'La tarea ya no está disponible'});return;}
  if(session.user.role==='Patinador'){
   const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
   const puesto=norm(task.puesto), name=norm(session.user.name||session.username);
   let assigned='';
   if(/^pre\s*33$/.test(puesto))assigned='juan esteban';
   else {const pre=puesto.match(/^pre\s*(\d+)$/);if(pre){const n=Number(pre[1]);if(n>=1&&n<=10)assigned='juan esteban';else if(n>=11&&n<=21)assigned='jorge';else if(n>=22&&n<=32)assigned='hamilton';}}
   if(!assigned&&/^derecho(?:\s+\d+)?$/.test(puesto))assigned='juan esteban';
   if(!assigned&&/^izquierdo(?:\s+\d+)?$/.test(puesto))assigned='hamilton';
   if(!assigned&&/^final de linea(?:\s+\d+)?$/.test(puesto))assigned='jorge';
   const explicitArea=Array.isArray(session.user.areas)&&session.user.areas.includes(task.area);
   const explicitPost=Array.isArray(session.user.puestos)&&session.user.puestos.includes(task.puesto);
   if((assigned&&norm(assigned)!==name)||(!assigned&&!explicitPost)){sendJson(res,403,{ok:false,error:'La tarea no está asignada a este patinador'});return;}
  }
  const objetivo=Number(task.cantidad)||0;const entregado=Number(task.entregado)||0;const restante=Math.max(0,objetivo-entregado);
  if(qty>restante){sendJson(res,409,{ok:false,error:'La cantidad supera lo pendiente: quedan '+restante+' unidades'});return;}
  task.entregado=entregado+qty;task.estado=task.entregado>=objetivo?'Entregada':'Parcial';
  if(!Array.isArray(task.entregas))task.entregas=[];
  const entry={patinador:String(session.user.name||session.username),cantidad:qty,fechaHora:new Date().toLocaleString('es-CO'),metodo:'EAN / botón ENTREGAR',observaciones:obs};
  task.entregas.push(entry);task.entrega=entry;
  writeState(state);sendJson(res,200,{ok:true,task});
 }catch(e){console.error('Error registrando entrega:',e);sendJson(res,500,{ok:false,error:'No se pudo registrar la entrega'});}});
 return;
}
if(p==='/api/users'&&req.method==='POST'){
 const session=requireSession(req,res);if(!session)return;
 if(session.user.role!=='Admin'){sendJson(res,403,{ok:false,error:'Solo Admin puede administrar usuarios'});return;}
 if(!isSafeSameOrigin(req)){sendJson(res,403,{ok:false,error:'Origen no permitido'});return;}
 readBody(req,res,incoming=>{try{
  const action=String(incoming.action||'');
  const username=String(incoming.username||'').trim().toLowerCase();
  if(!/^[a-z0-9._-]{3,40}$/.test(username)){sendJson(res,400,{ok:false,error:'Nombre de usuario inválido'});return;}
  const state=readState(),exists=Object.prototype.hasOwnProperty.call(state.users,username);
  if(action==='create'){
   if(exists){sendJson(res,409,{ok:false,error:'El usuario ya existe'});return;}
   const name=String(incoming.name||'').trim(),role=String(incoming.role||''),password=String(incoming.password||'');
   if(!name||name.length>100||!['Admin','Mesanín','Supervisor','Patinador'].includes(role)||password.length<12||password.length>200){sendJson(res,400,{ok:false,error:'Datos inválidos; la contraseña debe tener al menos 12 caracteres'});return;}
   const puestos=Array.isArray(incoming.puestos)?incoming.puestos.filter(x=>typeof x==='string'&&x.trim()&&x.length<=80).slice(0,200):[];
   const areas=Array.isArray(incoming.areas)?incoming.areas.filter(x=>['PRE','Derecho','Izquierdo','Final de línea'].includes(x)).slice(0,4):[];
   state.users[username]={name,role,turno:String(incoming.turno||'Todos').slice(0,30),puestos:role==='Patinador'?puestos:[],areas:role==='Patinador'?areas:[],pass:hashPassword(password)};
  }else if(action==='password'){
   if(!exists){sendJson(res,404,{ok:false,error:'Usuario no encontrado'});return;}
   const password=String(incoming.password||'');if(password.length<12||password.length>200){sendJson(res,400,{ok:false,error:'La contraseña debe tener al menos 12 caracteres'});return;}
   state.users[username].pass=hashPassword(password);
  }else if(action==='assignment'){
   if(!exists||state.users[username].role!=='Patinador'){sendJson(res,404,{ok:false,error:'Patinador no encontrado'});return;}
   const puestos=Array.isArray(incoming.puestos)?incoming.puestos.filter(x=>typeof x==='string'&&x.trim()&&x.length<=80).slice(0,200):[];
   const areas=Array.isArray(incoming.areas)?incoming.areas.filter(x=>['PRE','Derecho','Izquierdo','Final de línea'].includes(x)).slice(0,4):[];
   state.users[username].puestos=[...new Set(puestos)];state.users[username].areas=[...new Set(areas)];state.users[username].turno=String(incoming.turno||'Todos').slice(0,30);
  }else if(action==='delete'){
   if(!exists){sendJson(res,404,{ok:false,error:'Usuario no encontrado'});return;}
   if(username==='admin'||username===session.username){sendJson(res,400,{ok:false,error:'No se puede eliminar la cuenta admin ni la sesión actual'});return;}
   delete state.users[username];
   for(const [token,item] of sessions){if(item.username===username)sessions.delete(token);}
  }else{sendJson(res,400,{ok:false,error:'Operación de usuario inválida'});return;}
  writeState(state);
  const safeUsers={};for(const [key,value] of Object.entries(state.users))safeUsers[key]=safeUser(key,value);
  sendJson(res,200,{ok:true,users:safeUsers});
 }catch(e){console.error('Error administrando usuario:',e);sendJson(res,400,{ok:false,error:'No se pudo guardar el usuario'});}});
 return;
}
if(p==='/api/state'&&req.method==='GET'){
 const session=requireSession(req,res);if(!session)return;
 const state=readState();
 const users={};for(const [name,user] of Object.entries(state.users||{}))users[name]=safeUser(name,user);
 sendJson(res,200,{...state,users});return;
}
if(p==='/api/jornada/cerrar'&&req.method==='POST'){
const session=requireAdmin(req,res);if(!session)return;
if(!isSafeSameOrigin(req)){sendJson(res,403,{ok:false,error:'Origen no permitido'});return;}
readBody(req,res,incoming=>{try{
const state=readState();
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
}catch(e){console.error('Error cerrando jornada:',e);sendJson(res,500,{ok:false,error:'No se pudo cerrar la jornada'});}});return;
}
if(p==='/api/entrega'&&req.method==='POST'){
 const session=requireSession(req,res);if(!session)return;
 if(!isSafeSameOrigin(req)){sendJson(res,403,{ok:false,error:'Origen no permitido'});return;}
 readBody(req,res,incoming=>{try{
  if(session.user.role!=='Patinador'&&session.user.role!=='Admin'&&session.user.role!=='Mesanín'){sendJson(res,403,{ok:false,error:'Este rol no puede registrar entregas'});return;}
  const id=String(incoming.id??'');const qty=Number(incoming.cantidad);const obs=String(incoming.observaciones||'').slice(0,500);
  if(!id||!Number.isSafeInteger(qty)||qty<1){sendJson(res,400,{ok:false,error:'Tarea o cantidad inválida'});return;}
  const state=readState();const task=state.tasks.find(t=>String(t.id)===id);
  if(!task){sendJson(res,404,{ok:false,error:'La tarea ya no está disponible'});return;}
  if(session.user.role==='Patinador'){
   const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
   const puesto=norm(task.puesto), name=norm(session.user.name||session.username);
   let assigned='';
   if(/^pre\s*33$/.test(puesto))assigned='juan esteban';
   else {const pre=puesto.match(/^pre\s*(\d+)$/);if(pre){const n=Number(pre[1]);if(n>=1&&n<=10)assigned='juan esteban';else if(n>=11&&n<=21)assigned='jorge';else if(n>=22&&n<=32)assigned='hamilton';}}
   if(!assigned&&/^derecho(?:\s+\d+)?$/.test(puesto))assigned='juan esteban';
   if(!assigned&&/^izquierdo(?:\s+\d+)?$/.test(puesto))assigned='hamilton';
   if(!assigned&&/^final de linea(?:\s+\d+)?$/.test(puesto))assigned='jorge';
   const explicitArea=Array.isArray(session.user.areas)&&session.user.areas.includes(task.area);
   const explicitPost=Array.isArray(session.user.puestos)&&session.user.puestos.includes(task.puesto);
   if((assigned&&norm(assigned)!==name)||(!assigned&&!explicitPost)){sendJson(res,403,{ok:false,error:'La tarea no está asignada a este patinador'});return;}
  }
  const objetivo=Number(task.cantidad)||0;const entregado=Number(task.entregado)||0;const restante=Math.max(0,objetivo-entregado);
  if(qty>restante){sendJson(res,409,{ok:false,error:'La cantidad supera lo pendiente: quedan '+restante+' unidades'});return;}
  task.entregado=entregado+qty;task.estado=task.entregado>=objetivo?'Entregada':'Parcial';
  if(!Array.isArray(task.entregas))task.entregas=[];
  const entry={patinador:String(session.user.name||session.username),cantidad:qty,fechaHora:new Date().toLocaleString('es-CO'),metodo:'EAN / botón ENTREGAR',observaciones:obs};
  task.entregas.push(entry);task.entrega=entry;
  writeState(state);sendJson(res,200,{ok:true,task});
 }catch(e){console.error('Error registrando entrega:',e);sendJson(res,500,{ok:false,error:'No se pudo registrar la entrega'});}});
 return;
}
if(p==='/api/state'&&req.method==='PUT'){
 const session=requireSession(req,res);if(!session)return;
 if(!isSafeSameOrigin(req)){sendJson(res,403,{ok:false,error:'Origen no permitido'});return;}
 readBody(req,res,incoming=>{try{
  const current=readState();
  if(Object.prototype.hasOwnProperty.call(incoming,'users')){sendJson(res,403,{ok:false,error:'La gestión de usuarios requiere una operación administrativa dedicada'});return;}
  if(!Array.isArray(incoming.tasks)&&!Array.isArray(incoming.lpnCatalog)&&!Array.isArray(incoming.freeDeliveries)){sendJson(res,400,{ok:false,error:'No hay cambios válidos'});return;}
  const state={...current};
  if(session.user.role!=='Admin'&&session.user.role!=='Mesanín'&&session.user.role!=='Supervisor'){sendJson(res,403,{ok:false,error:'Este rol no puede guardar el estado completo'});return;}
  if(Array.isArray(incoming.tasks))state.tasks=incoming.tasks;
  if(Array.isArray(incoming.lpnCatalog)){if(session.user.role!=='Admin'){sendJson(res,403,{ok:false,error:'Solo Admin puede cambiar el catálogo'});return;}state.lpnCatalog=incoming.lpnCatalog;}
  if(Array.isArray(incoming.freeDeliveries))state.freeDeliveries=incoming.freeDeliveries;
  writeState(state);
  const safeUsers={};for(const [name,user] of Object.entries(state.users||{}))safeUsers[name]=safeUser(name,user);
  sendJson(res,200,{...state,users:safeUsers});
 }catch{sendJson(res,400,{ok:false,error:'No se pudo guardar el estado'});}});
 return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=43"></script><script src="/profesional.js?v=3"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
ensureState();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
