 const http=require('http');
const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');

const PORT=process.env.PORT||8080;
const ROOT=path.join(__dirname,'public');
const DATA_DIR=path.join(__dirname,'data');
const STATE_FILE=path.join(DATA_DIR,'state.json');
const HISTORY_DIR=path.join(DATA_DIR,'history');
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5,connectionTimeoutMillis:10000}):null;

const defaultUsers={
admin:{role:'Admin',name:'Administrador'},
mesanin:{role:'Mesanín',name:'Mesanín'},
hamilton:{role:'Patinador',name:'Hamilton',areas:['PRE','Izquierdo'],puestos:[]},
juanesteban:{role:'Patinador',name:'Juan Esteban',areas:['PRE','Derecho'],puestos:[]},
jorge:{role:'Patinador',name:'Jorge',areas:['PRE','Derecho','Izquierdo','Final de línea'],puestos:[]}
};

function ensureDataDir(){fs.mkdirSync(DATA_DIR,{recursive:true});}
function ensureState(){
ensureDataDir();
if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify({users:defaultUsers,tasks:[]},null,2),{flag:'wx'});
}
function normalizeState(input){
if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('El estado guardado no tiene un formato válido');
const s=input;
if(!s.users||typeof s.users!=='object'||Array.isArray(s.users))s.users={...defaultUsers};
for(const [key,user] of Object.entries(defaultUsers)){if(!s.users[key])s.users[key]=user;}
if(!Array.isArray(s.tasks))s.tasks=[];
if(!Array.isArray(s.lpnCatalog))s.lpnCatalog=[];
if(!Array.isArray(s.freeDeliveries))s.freeDeliveries=[];
return s;
}
function readFileState({createIfMissing=false}={}){
ensureDataDir();
if(!fs.existsSync(STATE_FILE)){
if(!createIfMissing)throw new Error('No existe data/state.json en el volumen; se cancela el arranque para proteger los datos.');
ensureState();
}
let parsed;
try{parsed=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}
catch(e){throw new Error('No se puede leer data/state.json; no se inicializará Neon con datos por defecto. '+e.message);}
return normalizeState(parsed);
}
async function readState(){
if(!pool)return readFileState({createIfMissing:true});
ensureDataDir();
const result=await pool.query('SELECT data FROM app_state WHERE id=1');
if(result.rows.length)return normalizeState(result.rows[0].data);
// Neon está vacío: importar únicamente desde un archivo local real y válido.
const local=readFileState({createIfMissing:false});
await pool.query('INSERT INTO app_state(id,data) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING',[JSON.stringify(local)]);
const seeded=await pool.query('SELECT data FROM app_state WHERE id=1');
if(!seeded.rows.length)throw new Error('No se pudo inicializar el estado en Neon');
return normalizeState(seeded.rows[0].data);
}
async function writeState(s){
ensureDataDir();
if(pool)await pool.query('INSERT INTO app_state(id,data,updated_at) VALUES (1,$1::jsonb,now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',[JSON.stringify(s)]);
else ensureState();
const tmp=STATE_FILE+'.tmp';
fs.writeFileSync(tmp,JSON.stringify(s,null,2));
fs.renameSync(tmp,STATE_FILE);
}
async function archiveTasks(tasks,meta={}){
ensureDataDir();
fs.mkdirSync(HISTORY_DIR,{recursive:true});
const closedAt=new Date().toISOString();
const fileName='jornada-'+closedAt.replace(/[:.]/g,'-')+'.json';
const payload={app:'Familia AKT Control de Canastas',fechaCierre:closedAt,meta,tasks};
if(pool)await pool.query('INSERT INTO jornada_history(file_name,archived_at,payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (file_name) DO NOTHING',[fileName,closedAt,JSON.stringify(payload)]);
fs.writeFileSync(path.join(HISTORY_DIR,fileName),JSON.stringify(payload,null,2));
return {file:fileName,count:tasks.length};
}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{
const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const p=decodeURIComponent(url.pathname);
res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');res.setHeader('Cache-Control','no-store');
if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,PUT,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');return res.end();}
if(p==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:true,service:'familia-akt-control-canastas'}));}
if(p==='/api/state'&&req.method==='GET'){readState().then(state=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}).catch(e=>{console.error('Error leyendo estado:',e);res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:'Estado no disponible'}));});return;}
if(p==='/api/jornada/cerrar'&&req.method==='POST'){
let body='';req.on('data',c=>body+=c);req.on('end',async()=>{try{
const incoming=JSON.parse(body||'{}');const state=await readState();
if(!Array.isArray(state.tasks))state.tasks=[];
if(incoming.confirmacion!=='CERRAR JORNADA'){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:false,error:'Confirmación inválida'}));}
if(!state.tasks.length){res.writeHead(409,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:false,error:'No hay tareas activas para archivar'}));}
const snapshot=state.tasks.map(t=>({...t}));
const archived=await archiveTasks(snapshot,{usuario:String(incoming.usuario||'Admin'),motivo:'Cierre de jornada',regla:'Se archivan todas las tareas; las completadas salen de la lista activa y las pendientes/parciales conservan su avance para el siguiente turno.'});
const isComplete=t=>{const total=Number(t.cantidad)||0;const delivered=Number(t.entregado)||0;return total>0&&delivered>=total;};
state.tasks=state.tasks.filter(t=>!isComplete(t));
await writeState(state);
res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
res.end(JSON.stringify({ok:true,archived:archived.file,count:archived.count,completedRemoved:snapshot.filter(isComplete).length,remainingCount:state.tasks.length,tasks:state.tasks}));
}catch(e){console.error('Error cerrando jornada:',e);res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:'No se pudo cerrar la jornada'}));}});return;
}
if(p==='/api/state'&&req.method==='PUT'){
let body='';req.on('data',c=>body+=c);req.on('end',async()=>{try{const incoming=JSON.parse(body||'{}');const current=await readState();const state={...current,users:incoming.users||current.users,tasks:Array.isArray(incoming.tasks)?incoming.tasks:current.tasks,lpnCatalog:Array.isArray(incoming.lpnCatalog)?incoming.lpnCatalog:current.lpnCatalog,freeDeliveries:Array.isArray(incoming.freeDeliveries)?incoming.freeDeliveries:(current.freeDeliveries||[])};await writeState(state);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(state));}catch{res.writeHead(400);res.end(JSON.stringify({error:'JSON invalido'}));}});return;
}
let filePath=p==='/'?'/index.html':p;const file=path.normalize(path.join(ROOT,filePath));
if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}let output=data;
if(path.extname(file)==='.html'){
  output=Buffer.from(data.toString('utf8').replace('</body>','<style>.estiba-destacada{background:#fff7ed;border:3px solid #f97316;color:#9a3412;border-radius:14px;padding:16px;margin:12px 0;font-size:24px;text-align:center}</style><script src="/patinador-estiba.js?v=43"></script><script src="/profesional.js?v=3"></script></body>'),'utf8');
}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(output);});
});
async function start(){
if(pool){
  ensureDataDir();
  await pool.query('CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY CHECK (id=1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE IF NOT EXISTS jornada_history (id bigserial PRIMARY KEY, file_name text NOT NULL UNIQUE, archived_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL)');
  await readState();
  console.log('Persistencia Neon activada');
}else{
  ensureState();
  console.log('ADVERTENCIA: DATABASE_URL no configurada; usando almacenamiento local');
}
server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
}
start().catch(e=>{console.error('No se pudo iniciar la persistencia:',e);process.exit(1);});
