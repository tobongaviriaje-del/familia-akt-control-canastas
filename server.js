 const http=require('http');
const fs=require('fs');
const path=require('path');

const PORT=process.env.PORT||8080;
const ROOT=path.join(__dirname,'public');
const DATA_DIR=path.join(__dirname,'data');
const STATE_FILE=path.join(DATA_DIR,'state.json');
const HISTORY_DIR=path.join(DATA_DIR,'history');

const defaultUsers={
admin:{pass:'admin',role:'Admin',name:'Administrador'},
mesanin:{pass:'mesanin123',role:'Mesanín',name:'Mesanín'},
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
if(!Array.isArray(s.tasks))s.tasks=[];
if(!Array.isArray(s.lpnCatalog))s.lpnCatalog=[];
return s;
}catch{return {users:defaultUsers,tasks:[]};}
}
function writeState(s){ensureState();const tmp=STATE_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s,null,2));fs.renameSync(tmp,STATE_FILE);}
function archiveTasks(tasks,meta={}){fs.mkdirSync(HISTORY_DIR,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-');const file=path.join(HISTORY_DIR,'jornada-'+stamp+'.json');fs.writeFileSync(file,JSON.stringify({app:'Familia AKT Control de Canastas',fechaCierre:new Date().toISOString(),meta,tasks},null,2));return {file:path.basename(file),count:tasks.length};}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{
const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const p=decodeURIComponent(url.pathname);
res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');res.setHeader('Cache-Control','no-store');
if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,PUT,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');return res.end();}
if(p==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:true,service:'familia-akt-control-canastas'}));}
if(p==='/api/state'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(readState()));}
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
let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{const incoming=JSON.parse(body||'{}');const current=readState();const state={users:incoming.users||current.users,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog};writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}catch{res.writeHead(400);res.end(JSON.stringify({error:'JSON invalido'}));}});return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=40"></script><script src="/profesional.js?v=2"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
ensureState();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
