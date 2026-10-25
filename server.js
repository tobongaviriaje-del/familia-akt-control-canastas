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
const crypto=require('crypto');
function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');return 'scrypt
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function getSession(req){const h=String(req.headers.authorization||'');const token=h.startsWith('Bearer ')?h.slice(7):'';const session=sessions.get(token);if(!session)return null;if(session.expires<Date.now()){sessions.delete(token);return null;}session.expires=Date.now()+SESSION_TTL;return session;}
function authorized(req){return !!getSession(req);}
function isAdmin(req){const session=getSession(req);if(!session)return false;try{const state=readState();const user=state.users[session.username];return !!user&&user.role==='Admin';}catch(error){console.error('No se pudo verificar el rol administrativo:',error.message);return false;}}
function readRequestBody(req,maxBytes=10*1024*1024){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>maxBytes){reject(new Error('El archivo supera el límite permitido'));req.destroy();}});req.on('end',()=>resolve(body));req.on('error',reject);});}
function createBackupBundle(){const state=readState();let history=[];if(fs.existsSync(HISTORY_DIR)){history=fs.readdirSync(HISTORY_DIR).filter(name=>/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(name)).map(name=>({name,content:fs.readFileSync(path.join(HISTORY_DIR,name),'utf8')}));}return {format:'familia-akt-backup-v1',createdAt:new Date().toISOString(),state,history};}

function initialUsersFromEnvironment(){
const adminPassword=process.env.INITIAL_ADMIN_PASSWORD;
if(!adminPassword||adminPassword.length<12)throw new Error('Para inicializar una instalación nueva, configura INITIAL_ADMIN_PASSWORD con al menos 12 caracteres.');
return {admin:{pass:adminPassword,role:'Admin',name:'Administrador'}};
}

function ensureState(){
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:initialUsersFromEnvironment(),tasks:[]},null,2));
}
function readState(){
ensureState();
const raw=fs.readFileSync(STATE_FILE,'utf8');
let s;
try{s=JSON.parse(raw);}catch(e){throw new Error('El archivo de estado está dañado; se detuvo la operación para proteger los datos.');}
if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('El archivo de estado tiene un formato inválido; se detuvo la operación para proteger los datos.');
if(!s.users||typeof s.users!=='object'||Array.isArray(s.users))throw new Error('El estado no contiene una lista de usuarios válida.');
if(!Array.isArray(s.tasks))throw new Error('El estado no contiene una lista de tareas válida.');
if(!Array.isArray(s.lpnCatalog))s.lpnCatalog=[];
if(!Array.isArray(s.freeDeliveries))s.freeDeliveries=[];
return s;
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
let body='';req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const username=String(incoming.username||'').trim().toLowerCase();const password=String(incoming.password||'');const user=readState().users[username];if(!user||typeof user.pass!=='string'||user.pass!==password){return sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});}const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});return sendJson(res,200,{ok:true,token,user:{username,name:user.name,role:user.role,areas:user.areas||[],puestos:user.puestos||[]}});}catch{return sendJson(res,400,{ok:false,error:'Solicitud inválida'});}});return;
}
if(p.startsWith('/api/')&&p!=='/api/login'&&!authorized(req))return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});
if(p==='/api/backup'&&req.method==='GET'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede descargar respaldos.'});
const bundle=createBackupBundle();const filename='familia-akt-respaldo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store'});return res.end(JSON.stringify(bundle,null,2));
}
if(p==='/api/backup/restore'&&req.method==='POST'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede restaurar respaldos.'});
readRequestBody(req).then(body=>{
let bundle;try{bundle=JSON.parse(body||'{}');}catch{return sendJson(res,400,{ok:false,error:'El archivo no contiene JSON válido.'});}
if(!bundle||bundle.format!=='familia-akt-backup-v1'||!bundle.state||typeof bundle.state!=='object'||!bundle.state.users||!Array.isArray(bundle.state.tasks))return sendJson(res,400,{ok:false,error:'El archivo no es un respaldo válido de Familia AKT.'});
if(bundle.history!==undefined&&(!Array.isArray(bundle.history)||bundle.history.some(x=>{if(!x||typeof x.name!=='string'||!/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(x.name)||typeof x.content!=='string')return true;try{const parsed=JSON.parse(x.content);return !parsed||typeof parsed!=='object'||Array.isArray(parsed);}catch{return true;}})))return sendJson(res,400,{ok:false,error:'El historial del respaldo tiene un formato inválido.'});
let current=null;let stateWritten=false;
try{
current=createBackupBundle();
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const preRestore=path.join(DATA_DIR,'pre-restauracion-'+stamp+'.json');
fs.writeFileSync(preRestore,JSON.stringify(current,null,2),{flag:'wx'});
const restored={...bundle.state,users:bundle.state.users,tasks:bundle.state.tasks,lpnCatalog:Array.isArray(bundle.state.lpnCatalog)?bundle.state.lpnCatalog:[],freeDeliveries:Array.isArray(bundle.state.freeDeliveries)?bundle.state.freeDeliveries:[]};
writeState(restored);stateWritten=true;
if(Array.isArray(bundle.history)){fs.mkdirSync(HISTORY_DIR,{recursive:true});for(const item of bundle.history){const target=path.join(HISTORY_DIR,item.name);if(!fs.existsSync(target)){const parsed=JSON.parse(item.content);if(parsed&&typeof parsed==='object')fs.writeFileSync(target,JSON.stringify(parsed,null,2),{flag:'wx'});}}}
return sendJson(res,200,{ok:true,message:'Respaldo restaurado. Se guardó una copia previa y no se eliminaron jornadas históricas existentes.'});
}catch(e){
console.error('Error restaurando respaldo:',e);
if(stateWritten&&current&&current.state){try{writeState(current.state);}catch(rollbackError){console.error('FALLÓ la reversión del estado tras una restauración incompleta:',rollbackError);}}
return sendJson(res,500,{ok:false,error:'No se pudo completar la restauración. Se intentó recuperar el estado anterior; conserva también el respaldo original y verifica los datos antes de continuar.'});
}
}).catch(e=>sendJson(res,400,{ok:false,error:e.message||'No se pudo leer el archivo.'}));return;
}
if(p==='/api/state'&&req.method==='GET'){return sendJson(res,200,readState());}
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
let body='';req.on('data',c=>{body+=c;if(Buffer.byteLength(body)>10*1024*1024){res.writeHead(413);res.end(JSON.stringify({error:'Solicitud demasiado grande'}));req.destroy();}});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const current=readState();const session=getSession(req);if(!session)return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});if(Object.prototype.hasOwnProperty.call(incoming,'users')&&!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede modificar usuarios y roles.'});const state={...current,users:isAdmin(req)&&incoming.users&&typeof incoming.users==='object'&&!Array.isArray(incoming.users)?incoming.users:current.users,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog,freeDeliveries:Array.isArray(incoming.freeDeliveries)?incoming.freeDeliveries:(current.freeDeliveries||[])};writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}catch(e){console.error('Error guardando estado:',e);sendJson(res,500,{ok:false,error:'No se pudo guardar el estado. Se protegieron los datos existentes.'});}});return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=44"></script><script src="/profesional.js?v=3"></script><script src="/backup.js?v=1"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
ensureState();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
+salt+'
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function getSession(req){const h=String(req.headers.authorization||'');const token=h.startsWith('Bearer ')?h.slice(7):'';const session=sessions.get(token);if(!session)return null;if(session.expires<Date.now()){sessions.delete(token);return null;}session.expires=Date.now()+SESSION_TTL;return session;}
function authorized(req){return !!getSession(req);}
function isAdmin(req){const session=getSession(req);if(!session)return false;try{const state=readState();const user=state.users[session.username];return !!user&&user.role==='Admin';}catch(error){console.error('No se pudo verificar el rol administrativo:',error.message);return false;}}
function readRequestBody(req,maxBytes=10*1024*1024){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>maxBytes){reject(new Error('El archivo supera el límite permitido'));req.destroy();}});req.on('end',()=>resolve(body));req.on('error',reject);});}
function createBackupBundle(){const state=readState();let history=[];if(fs.existsSync(HISTORY_DIR)){history=fs.readdirSync(HISTORY_DIR).filter(name=>/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(name)).map(name=>({name,content:fs.readFileSync(path.join(HISTORY_DIR,name),'utf8')}));}return {format:'familia-akt-backup-v1',createdAt:new Date().toISOString(),state,history};}

function initialUsersFromEnvironment(){
const adminPassword=process.env.INITIAL_ADMIN_PASSWORD;
if(!adminPassword||adminPassword.length<12)throw new Error('Para inicializar una instalación nueva, configura INITIAL_ADMIN_PASSWORD con al menos 12 caracteres.');
return {admin:{pass:adminPassword,role:'Admin',name:'Administrador'}};
}

function ensureState(){
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:initialUsersFromEnvironment(),tasks:[]},null,2));
}
function readState(){
ensureState();
const raw=fs.readFileSync(STATE_FILE,'utf8');
let s;
try{s=JSON.parse(raw);}catch(e){throw new Error('El archivo de estado está dañado; se detuvo la operación para proteger los datos.');}
if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('El archivo de estado tiene un formato inválido; se detuvo la operación para proteger los datos.');
if(!s.users||typeof s.users!=='object'||Array.isArray(s.users))throw new Error('El estado no contiene una lista de usuarios válida.');
if(!Array.isArray(s.tasks))throw new Error('El estado no contiene una lista de tareas válida.');
if(!Array.isArray(s.lpnCatalog))s.lpnCatalog=[];
if(!Array.isArray(s.freeDeliveries))s.freeDeliveries=[];
return s;
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
let body='';req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const username=String(incoming.username||'').trim().toLowerCase();const password=String(incoming.password||'');const user=readState().users[username];if(!user||typeof user.pass!=='string'||user.pass!==password){return sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});}const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});return sendJson(res,200,{ok:true,token,user:{username,name:user.name,role:user.role,areas:user.areas||[],puestos:user.puestos||[]}});}catch{return sendJson(res,400,{ok:false,error:'Solicitud inválida'});}});return;
}
if(p.startsWith('/api/')&&p!=='/api/login'&&!authorized(req))return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});
if(p==='/api/backup'&&req.method==='GET'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede descargar respaldos.'});
const bundle=createBackupBundle();const filename='familia-akt-respaldo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store'});return res.end(JSON.stringify(bundle,null,2));
}
if(p==='/api/backup/restore'&&req.method==='POST'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede restaurar respaldos.'});
readRequestBody(req).then(body=>{
let bundle;try{bundle=JSON.parse(body||'{}');}catch{return sendJson(res,400,{ok:false,error:'El archivo no contiene JSON válido.'});}
if(!bundle||bundle.format!=='familia-akt-backup-v1'||!bundle.state||typeof bundle.state!=='object'||!bundle.state.users||!Array.isArray(bundle.state.tasks))return sendJson(res,400,{ok:false,error:'El archivo no es un respaldo válido de Familia AKT.'});
if(bundle.history!==undefined&&(!Array.isArray(bundle.history)||bundle.history.some(x=>{if(!x||typeof x.name!=='string'||!/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(x.name)||typeof x.content!=='string')return true;try{const parsed=JSON.parse(x.content);return !parsed||typeof parsed!=='object'||Array.isArray(parsed);}catch{return true;}})))return sendJson(res,400,{ok:false,error:'El historial del respaldo tiene un formato inválido.'});
let current=null;let stateWritten=false;
try{
current=createBackupBundle();
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const preRestore=path.join(DATA_DIR,'pre-restauracion-'+stamp+'.json');
fs.writeFileSync(preRestore,JSON.stringify(current,null,2),{flag:'wx'});
const restored={...bundle.state,users:bundle.state.users,tasks:bundle.state.tasks,lpnCatalog:Array.isArray(bundle.state.lpnCatalog)?bundle.state.lpnCatalog:[],freeDeliveries:Array.isArray(bundle.state.freeDeliveries)?bundle.state.freeDeliveries:[]};
writeState(restored);stateWritten=true;
if(Array.isArray(bundle.history)){fs.mkdirSync(HISTORY_DIR,{recursive:true});for(const item of bundle.history){const target=path.join(HISTORY_DIR,item.name);if(!fs.existsSync(target)){const parsed=JSON.parse(item.content);if(parsed&&typeof parsed==='object')fs.writeFileSync(target,JSON.stringify(parsed,null,2),{flag:'wx'});}}}
return sendJson(res,200,{ok:true,message:'Respaldo restaurado. Se guardó una copia previa y no se eliminaron jornadas históricas existentes.'});
}catch(e){
console.error('Error restaurando respaldo:',e);
if(stateWritten&&current&&current.state){try{writeState(current.state);}catch(rollbackError){console.error('FALLÓ la reversión del estado tras una restauración incompleta:',rollbackError);}}
return sendJson(res,500,{ok:false,error:'No se pudo completar la restauración. Se intentó recuperar el estado anterior; conserva también el respaldo original y verifica los datos antes de continuar.'});
}
}).catch(e=>sendJson(res,400,{ok:false,error:e.message||'No se pudo leer el archivo.'}));return;
}
if(p==='/api/state'&&req.method==='GET'){return sendJson(res,200,readState());}
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
let body='';req.on('data',c=>{body+=c;if(Buffer.byteLength(body)>10*1024*1024){res.writeHead(413);res.end(JSON.stringify({error:'Solicitud demasiado grande'}));req.destroy();}});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const current=readState();const session=getSession(req);if(!session)return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});if(Object.prototype.hasOwnProperty.call(incoming,'users')&&!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede modificar usuarios y roles.'});const state={...current,users:isAdmin(req)&&incoming.users&&typeof incoming.users==='object'&&!Array.isArray(incoming.users)?incoming.users:current.users,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog,freeDeliveries:Array.isArray(incoming.freeDeliveries)?incoming.freeDeliveries:(current.freeDeliveries||[])};writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}catch(e){console.error('Error guardando estado:',e);sendJson(res,500,{ok:false,error:'No se pudo guardar el estado. Se protegieron los datos existentes.'});}});return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=44"></script><script src="/profesional.js?v=3"></script><script src="/backup.js?v=1"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
ensureState();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
+crypto.scryptSync(String(password),salt,64).toString('hex');}
function verifyPassword(user,password){
if(user&&typeof user.passHash==='string'){const p=user.passHash.split('
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function getSession(req){const h=String(req.headers.authorization||'');const token=h.startsWith('Bearer ')?h.slice(7):'';const session=sessions.get(token);if(!session)return null;if(session.expires<Date.now()){sessions.delete(token);return null;}session.expires=Date.now()+SESSION_TTL;return session;}
function authorized(req){return !!getSession(req);}
function isAdmin(req){const session=getSession(req);if(!session)return false;try{const state=readState();const user=state.users[session.username];return !!user&&user.role==='Admin';}catch(error){console.error('No se pudo verificar el rol administrativo:',error.message);return false;}}
function readRequestBody(req,maxBytes=10*1024*1024){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>maxBytes){reject(new Error('El archivo supera el límite permitido'));req.destroy();}});req.on('end',()=>resolve(body));req.on('error',reject);});}
function createBackupBundle(){const state=readState();let history=[];if(fs.existsSync(HISTORY_DIR)){history=fs.readdirSync(HISTORY_DIR).filter(name=>/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(name)).map(name=>({name,content:fs.readFileSync(path.join(HISTORY_DIR,name),'utf8')}));}return {format:'familia-akt-backup-v1',createdAt:new Date().toISOString(),state,history};}

function initialUsersFromEnvironment(){
const adminPassword=process.env.INITIAL_ADMIN_PASSWORD;
if(!adminPassword||adminPassword.length<12)throw new Error('Para inicializar una instalación nueva, configura INITIAL_ADMIN_PASSWORD con al menos 12 caracteres.');
return {admin:{pass:adminPassword,role:'Admin',name:'Administrador'}};
}

function ensureState(){
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:initialUsersFromEnvironment(),tasks:[]},null,2));
}
function readState(){
ensureState();
const raw=fs.readFileSync(STATE_FILE,'utf8');
let s;
try{s=JSON.parse(raw);}catch(e){throw new Error('El archivo de estado está dañado; se detuvo la operación para proteger los datos.');}
if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('El archivo de estado tiene un formato inválido; se detuvo la operación para proteger los datos.');
if(!s.users||typeof s.users!=='object'||Array.isArray(s.users))throw new Error('El estado no contiene una lista de usuarios válida.');
if(!Array.isArray(s.tasks))throw new Error('El estado no contiene una lista de tareas válida.');
if(!Array.isArray(s.lpnCatalog))s.lpnCatalog=[];
if(!Array.isArray(s.freeDeliveries))s.freeDeliveries=[];
return s;
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
let body='';req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const username=String(incoming.username||'').trim().toLowerCase();const password=String(incoming.password||'');const user=readState().users[username];if(!user||typeof user.pass!=='string'||user.pass!==password){return sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});}const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});return sendJson(res,200,{ok:true,token,user:{username,name:user.name,role:user.role,areas:user.areas||[],puestos:user.puestos||[]}});}catch{return sendJson(res,400,{ok:false,error:'Solicitud inválida'});}});return;
}
if(p.startsWith('/api/')&&p!=='/api/login'&&!authorized(req))return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});
if(p==='/api/backup'&&req.method==='GET'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede descargar respaldos.'});
const bundle=createBackupBundle();const filename='familia-akt-respaldo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store'});return res.end(JSON.stringify(bundle,null,2));
}
if(p==='/api/backup/restore'&&req.method==='POST'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede restaurar respaldos.'});
readRequestBody(req).then(body=>{
let bundle;try{bundle=JSON.parse(body||'{}');}catch{return sendJson(res,400,{ok:false,error:'El archivo no contiene JSON válido.'});}
if(!bundle||bundle.format!=='familia-akt-backup-v1'||!bundle.state||typeof bundle.state!=='object'||!bundle.state.users||!Array.isArray(bundle.state.tasks))return sendJson(res,400,{ok:false,error:'El archivo no es un respaldo válido de Familia AKT.'});
if(bundle.history!==undefined&&(!Array.isArray(bundle.history)||bundle.history.some(x=>{if(!x||typeof x.name!=='string'||!/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(x.name)||typeof x.content!=='string')return true;try{const parsed=JSON.parse(x.content);return !parsed||typeof parsed!=='object'||Array.isArray(parsed);}catch{return true;}})))return sendJson(res,400,{ok:false,error:'El historial del respaldo tiene un formato inválido.'});
let current=null;let stateWritten=false;
try{
current=createBackupBundle();
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const preRestore=path.join(DATA_DIR,'pre-restauracion-'+stamp+'.json');
fs.writeFileSync(preRestore,JSON.stringify(current,null,2),{flag:'wx'});
const restored={...bundle.state,users:bundle.state.users,tasks:bundle.state.tasks,lpnCatalog:Array.isArray(bundle.state.lpnCatalog)?bundle.state.lpnCatalog:[],freeDeliveries:Array.isArray(bundle.state.freeDeliveries)?bundle.state.freeDeliveries:[]};
writeState(restored);stateWritten=true;
if(Array.isArray(bundle.history)){fs.mkdirSync(HISTORY_DIR,{recursive:true});for(const item of bundle.history){const target=path.join(HISTORY_DIR,item.name);if(!fs.existsSync(target)){const parsed=JSON.parse(item.content);if(parsed&&typeof parsed==='object')fs.writeFileSync(target,JSON.stringify(parsed,null,2),{flag:'wx'});}}}
return sendJson(res,200,{ok:true,message:'Respaldo restaurado. Se guardó una copia previa y no se eliminaron jornadas históricas existentes.'});
}catch(e){
console.error('Error restaurando respaldo:',e);
if(stateWritten&&current&&current.state){try{writeState(current.state);}catch(rollbackError){console.error('FALLÓ la reversión del estado tras una restauración incompleta:',rollbackError);}}
return sendJson(res,500,{ok:false,error:'No se pudo completar la restauración. Se intentó recuperar el estado anterior; conserva también el respaldo original y verifica los datos antes de continuar.'});
}
}).catch(e=>sendJson(res,400,{ok:false,error:e.message||'No se pudo leer el archivo.'}));return;
}
if(p==='/api/state'&&req.method==='GET'){return sendJson(res,200,readState());}
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
let body='';req.on('data',c=>{body+=c;if(Buffer.byteLength(body)>10*1024*1024){res.writeHead(413);res.end(JSON.stringify({error:'Solicitud demasiado grande'}));req.destroy();}});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const current=readState();const session=getSession(req);if(!session)return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});if(Object.prototype.hasOwnProperty.call(incoming,'users')&&!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede modificar usuarios y roles.'});const state={...current,users:isAdmin(req)&&incoming.users&&typeof incoming.users==='object'&&!Array.isArray(incoming.users)?incoming.users:current.users,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog,freeDeliveries:Array.isArray(incoming.freeDeliveries)?incoming.freeDeliveries:(current.freeDeliveries||[])};writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}catch(e){console.error('Error guardando estado:',e);sendJson(res,500,{ok:false,error:'No se pudo guardar el estado. Se protegieron los datos existentes.'});}});return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=44"></script><script src="/profesional.js?v=3"></script><script src="/backup.js?v=1"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
ensureState();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
);if(p.length!==3||p[0]!=='scrypt')return false;try{const expected=Buffer.from(p[2],'hex');const actual=crypto.scryptSync(String(password),p[1],expected.length);return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}catch{return false;}}
return !!user&&typeof user.pass==='string'&&user.pass===String(password);
}
function publicUser(user){const {pass,passHash,...safe}=user||{};return safe;}
function normalizeUsersForStorage(users){
if(!users||typeof users!=='object'||Array.isArray(users))throw new Error('Lista de usuarios inválida');
const out={};for(const [key,value] of Object.entries(users)){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Usuario inválido');const user={...value};if(typeof user.pass==='string'&&user.pass.length){user.passHash=hashPassword(user.pass);delete user.pass;}else if(typeof user.passHash!=='string')throw new Error('Cada usuario debe tener contraseña');out[key]=user;}return out;
}
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function getSession(req){const h=String(req.headers.authorization||'');const token=h.startsWith('Bearer ')?h.slice(7):'';const session=sessions.get(token);if(!session)return null;if(session.expires<Date.now()){sessions.delete(token);return null;}session.expires=Date.now()+SESSION_TTL;return session;}
function authorized(req){return !!getSession(req);}
function isAdmin(req){const session=getSession(req);if(!session)return false;try{const state=readState();const user=state.users[session.username];return !!user&&user.role==='Admin';}catch(error){console.error('No se pudo verificar el rol administrativo:',error.message);return false;}}
function readRequestBody(req,maxBytes=10*1024*1024){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>maxBytes){reject(new Error('El archivo supera el límite permitido'));req.destroy();}});req.on('end',()=>resolve(body));req.on('error',reject);});}
function createBackupBundle(){const state=readState();let history=[];if(fs.existsSync(HISTORY_DIR)){history=fs.readdirSync(HISTORY_DIR).filter(name=>/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(name)).map(name=>({name,content:fs.readFileSync(path.join(HISTORY_DIR,name),'utf8')}));}return {format:'familia-akt-backup-v1',createdAt:new Date().toISOString(),state,history};}

function initialUsersFromEnvironment(){
const adminPassword=process.env.INITIAL_ADMIN_PASSWORD;
if(!adminPassword||adminPassword.length<12)throw new Error('Para inicializar una instalación nueva, configura INITIAL_ADMIN_PASSWORD con al menos 12 caracteres.');
return {admin:{pass:adminPassword,role:'Admin',name:'Administrador'}};
}

function ensureState(){
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:initialUsersFromEnvironment(),tasks:[]},null,2));
}
function readState(){
ensureState();
const raw=fs.readFileSync(STATE_FILE,'utf8');
let s;
try{s=JSON.parse(raw);}catch(e){throw new Error('El archivo de estado está dañado; se detuvo la operación para proteger los datos.');}
if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('El archivo de estado tiene un formato inválido; se detuvo la operación para proteger los datos.');
if(!s.users||typeof s.users!=='object'||Array.isArray(s.users))throw new Error('El estado no contiene una lista de usuarios válida.');
if(!Array.isArray(s.tasks))throw new Error('El estado no contiene una lista de tareas válida.');
if(!Array.isArray(s.lpnCatalog))s.lpnCatalog=[];
if(!Array.isArray(s.freeDeliveries))s.freeDeliveries=[];
return s;
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
let body='';req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const username=String(incoming.username||'').trim().toLowerCase();const password=String(incoming.password||'');const user=readState().users[username];if(!user||typeof user.pass!=='string'||user.pass!==password){return sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});}const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});return sendJson(res,200,{ok:true,token,user:{username,name:user.name,role:user.role,areas:user.areas||[],puestos:user.puestos||[]}});}catch{return sendJson(res,400,{ok:false,error:'Solicitud inválida'});}});return;
}
if(p.startsWith('/api/')&&p!=='/api/login'&&!authorized(req))return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});
if(p==='/api/backup'&&req.method==='GET'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede descargar respaldos.'});
const bundle=createBackupBundle();const filename='familia-akt-respaldo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store'});return res.end(JSON.stringify(bundle,null,2));
}
if(p==='/api/backup/restore'&&req.method==='POST'){
if(!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede restaurar respaldos.'});
readRequestBody(req).then(body=>{
let bundle;try{bundle=JSON.parse(body||'{}');}catch{return sendJson(res,400,{ok:false,error:'El archivo no contiene JSON válido.'});}
if(!bundle||bundle.format!=='familia-akt-backup-v1'||!bundle.state||typeof bundle.state!=='object'||!bundle.state.users||!Array.isArray(bundle.state.tasks))return sendJson(res,400,{ok:false,error:'El archivo no es un respaldo válido de Familia AKT.'});
if(bundle.history!==undefined&&(!Array.isArray(bundle.history)||bundle.history.some(x=>{if(!x||typeof x.name!=='string'||!/^jornada-[a-zA-Z0-9T._-]+\.json$/.test(x.name)||typeof x.content!=='string')return true;try{const parsed=JSON.parse(x.content);return !parsed||typeof parsed!=='object'||Array.isArray(parsed);}catch{return true;}})))return sendJson(res,400,{ok:false,error:'El historial del respaldo tiene un formato inválido.'});
let current=null;let stateWritten=false;
try{
current=createBackupBundle();
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const preRestore=path.join(DATA_DIR,'pre-restauracion-'+stamp+'.json');
fs.writeFileSync(preRestore,JSON.stringify(current,null,2),{flag:'wx'});
const restored={...bundle.state,users:bundle.state.users,tasks:bundle.state.tasks,lpnCatalog:Array.isArray(bundle.state.lpnCatalog)?bundle.state.lpnCatalog:[],freeDeliveries:Array.isArray(bundle.state.freeDeliveries)?bundle.state.freeDeliveries:[]};
writeState(restored);stateWritten=true;
if(Array.isArray(bundle.history)){fs.mkdirSync(HISTORY_DIR,{recursive:true});for(const item of bundle.history){const target=path.join(HISTORY_DIR,item.name);if(!fs.existsSync(target)){const parsed=JSON.parse(item.content);if(parsed&&typeof parsed==='object')fs.writeFileSync(target,JSON.stringify(parsed,null,2),{flag:'wx'});}}}
return sendJson(res,200,{ok:true,message:'Respaldo restaurado. Se guardó una copia previa y no se eliminaron jornadas históricas existentes.'});
}catch(e){
console.error('Error restaurando respaldo:',e);
if(stateWritten&&current&&current.state){try{writeState(current.state);}catch(rollbackError){console.error('FALLÓ la reversión del estado tras una restauración incompleta:',rollbackError);}}
return sendJson(res,500,{ok:false,error:'No se pudo completar la restauración. Se intentó recuperar el estado anterior; conserva también el respaldo original y verifica los datos antes de continuar.'});
}
}).catch(e=>sendJson(res,400,{ok:false,error:e.message||'No se pudo leer el archivo.'}));return;
}
if(p==='/api/state'&&req.method==='GET'){return sendJson(res,200,readState());}
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
let body='';req.on('data',c=>{body+=c;if(Buffer.byteLength(body)>10*1024*1024){res.writeHead(413);res.end(JSON.stringify({error:'Solicitud demasiado grande'}));req.destroy();}});req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const current=readState();const session=getSession(req);if(!session)return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});if(Object.prototype.hasOwnProperty.call(incoming,'users')&&!isAdmin(req))return sendJson(res,403,{ok:false,error:'Solo el administrador puede modificar usuarios y roles.'});const state={...current,users:isAdmin(req)&&incoming.users&&typeof incoming.users==='object'&&!Array.isArray(incoming.users)?incoming.users:current.users,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog,freeDeliveries:Array.isArray(incoming.freeDeliveries)?incoming.freeDeliveries:(current.freeDeliveries||[])};writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}catch(e){console.error('Error guardando estado:',e);sendJson(res,500,{ok:false,error:'No se pudo guardar el estado. Se protegieron los datos existentes.'});}});return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=44"></script><script src="/profesional.js?v=3"></script><script src="/backup.js?v=1"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
ensureState();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
