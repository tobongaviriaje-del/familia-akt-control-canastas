 const http=require('http');
const fs=require('fs');
const zlib=require('zlib');
const path=require('path');

const PORT=process.env.PORT||8080;
const ROOT=path.join(__dirname,'public');
const DATA_DIR=path.join(__dirname,'data');
const STATE_FILE=path.join(DATA_DIR,'state.json');
const HISTORY_DIR=path.join(DATA_DIR,'history');
const SESSION_FILE=path.join(DATA_DIR,'sessions.json');
const sessions=new Map();
const SESSION_TTL=12*60*60*1000;
function persistSessions(){
 try{
  fs.mkdirSync(DATA_DIR,{recursive:true});
  const tmp=SESSION_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify([...sessions.entries()]),{mode:0o600});
  fs.renameSync(tmp,SESSION_FILE);
 }catch(e){console.error('No se pudieron guardar las sesiones:',e.message);}
}
function loadSessions(){
 try{
  if(!fs.existsSync(SESSION_FILE))return;
  const saved=JSON.parse(fs.readFileSync(SESSION_FILE,'utf8'));
  if(!Array.isArray(saved))return;
  for(const entry of saved){
   if(!Array.isArray(entry)||entry.length!==2)continue;
   const [token,session]=entry;
   if(typeof token==='string'&&session&&typeof session.username==='string'&&Number(session.expires)>Date.now())sessions.set(token,session);
  }
  persistSessions();
 }catch(e){console.error('No se pudieron recuperar las sesiones:',e.message);}
}
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function authorized(req){const h=String(req.headers.authorization||'');const token=h.startsWith('Bearer ')?h.slice(7):'';const session=sessions.get(token);if(!session)return false;if(session.expires<Date.now()){sessions.delete(token);persistSessions();return false;}session.expires=Date.now()+SESSION_TTL;persistSessions();return true;}

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

function readZipEntries(buffer){
 let eocd=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65558);i--){if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
 if(eocd<0)throw new Error('ZIP inválido: no se encontró el directorio central.');
 const count=buffer.readUInt16LE(eocd+10),cdOffset=buffer.readUInt32LE(eocd+16),out=new Map();let pos=cdOffset,total=0;
 if(count>600)throw new Error('El paquete tiene demasiados archivos.');
 for(let i=0;i<count;i++){
  if(buffer.readUInt32LE(pos)!==0x02014b50)throw new Error('Directorio ZIP dañado.');
  const method=buffer.readUInt16LE(pos+10),compressed=buffer.readUInt32LE(pos+20),uncompressed=buffer.readUInt32LE(pos+24),nl=buffer.readUInt16LE(pos+28),el=buffer.readUInt16LE(pos+30),cl=buffer.readUInt16LE(pos+32),lo=buffer.readUInt32LE(pos+42),name=buffer.toString('utf8',pos+46,pos+46+nl);pos+=46+nl+el+cl;
  if(!name||name.endsWith('/'))continue;if(name.startsWith('/')||name.includes('..')||name.includes('\\'))throw new Error('El ZIP contiene una ruta no permitida.');
  if(name!=='manifest.json'&&!/^fotos\/[a-f0-9]{40}\.webp$/i.test(name))continue;
  total+=uncompressed;if(total>60*1024*1024)throw new Error('El contenido descomprimido supera el límite permitido.');
  if(buffer.readUInt32LE(lo)!==0x04034b50)throw new Error('Entrada ZIP dañada.');
  const start=lo+30+buffer.readUInt16LE(lo+26)+buffer.readUInt16LE(lo+28),raw=buffer.subarray(start,start+compressed);
  let data;if(method===0)data=Buffer.from(raw);else if(method===8)data=zlib.inflateRawSync(raw);else throw new Error('Compresión ZIP no compatible.');
  if(data.length!==uncompressed)throw new Error('Tamaño de archivo ZIP no coincide.');out.set(name,data);
 }
 return out;
}
function safePhotoModel(value){return value==='xrs180'?'XRS-180':value==='cr4125'?'CR4 125':value==='cr4150'?'CR4-150':value==='nkd'?'NKD':value==='chr'?'CHR':null;}

const WORK_LOTS_FILE=path.join(DATA_DIR,'work-lots.json');
const WORK_LOT_DELIVERY_FIELDS=['entregado','estado','entregas','entrega','canastasEntregadas','confirmacionesCanastas','correcciones'];
const WORK_LOT_CAPACITY_FIELDS=['cantidadCanasta','cantidadCanastaRaw','numCanastas','numCanastasRaw'];
function stableWorkValue(v){if(Array.isArray(v))return v.map(stableWorkValue);if(v&&typeof v==='object')return Object.keys(v).sort().reduce((o,k)=>(o[k]=stableWorkValue(v[k]),o),{});return v;}
function stableWorkString(v){return JSON.stringify(stableWorkValue(v));}
function workLotNumber(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function workLotModel(v){return String(v||'').trim().toUpperCase().replace(/VOGUE 180/g,'VOGE 180').replace(/VOGI 180/g,'VOGE 180').replace(/^CH$/,'CHR').replace(/^CR4[-_ ]?150$/,'CR4 150').replace(/^CR4[-_ ]?125$/,'CR4 125').replace(/^XRS[ _]?180$/,'XRS-180');}
function workLotTarget(t){const lot=workLotNumber(t.lote),qty=workLotNumber(t.cantidad),cap=workLotNumber(t.cantidadCanasta),baskets=workLotNumber(t.numCanastas),unit=workLotNumber(t.cantidadUnidad);if(lot>1)return lot;if(qty>1)return qty;if(cap>0&&baskets>0)return cap*baskets;return unit>0?unit:(lot>0?lot:(cap>0?cap:qty));}
function readWorkLots(){try{if(!fs.existsSync(WORK_LOTS_FILE))return [];const data=JSON.parse(fs.readFileSync(WORK_LOTS_FILE,'utf8'));return Array.isArray(data)?data:[];}catch(e){console.error('No se pudieron leer los lotes de trabajo:',e.message);throw new Error('No se pudieron leer los lotes de trabajo.');}}
function writeWorkLots(rows){fs.mkdirSync(DATA_DIR,{recursive:true});const tmp=WORK_LOTS_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows,null,2),{mode:0o600});fs.renameSync(tmp,WORK_LOTS_FILE);}
function workLotNorm(v){return String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');}
function workLotPosition(v){let x=workLotNorm(v),m=x.match(/^pre\s*0*(\d+)$/);if(m)return 'pre '+Number(m[1]);m=x.match(/^0*(\d+)\s*(derecho|izquierdo)$/);if(m)return m[2]+' '+Number(m[1]);m=x.match(/^(derecho|izquierdo|final(?: de linea)?)\s*0*(\d+)$/);if(m)return (m[1].startsWith('final')?'final':m[1])+' '+Number(m[2]);return x;}
function workLotUserCanTask(user,username,task){const positions=new Set(Array.isArray(user.puestos)?user.puestos.map(workLotPosition).filter(Boolean):[]);const position=workLotPosition(task.puesto);if(position&&positions.has(position))return true;const responsible=workLotNorm(task.patinadorEstandar),identities=[user.name,username].map(workLotNorm).filter(Boolean);return !!responsible&&identities.some(v=>v===responsible||v.startsWith(responsible+' ')||v.endsWith(' '+responsible));}
function workLotResponse(row,user,username,rows){return {ok:true,lot:{id:row.id,model:row.model,number:row.number,createdAt:row.createdAt,updatedAt:row.updatedAt},lots:rows.filter(x=>x.model===row.model).sort((a,b)=>a.number-b.number).map(x=>({id:x.id,number:x.number})),tasks:(row.tasks||[]).filter(t=>workLotUserCanTask(user,username,t))};}
function validateWorkLot(saved,incoming,user,username){
 if(!Array.isArray(incoming))throw new Error('La lista de referencias no es válida.');
 const byId=new Map(incoming.map(x=>[String(x&&x.id),x]));
 if(byId.size!==incoming.length)throw new Error('Hay referencias repetidas.');
 const result=[];
 for(const old of saved){
  const key=String(old.id),candidate=byId.get(key);
  if(!candidate){result.push(old);continue;}
  byId.delete(key);
  if(!workLotUserCanTask(user,username,old))throw new Error('No tienes permiso para modificar este puesto.');
  if(stableWorkString(withoutWork(old,[...WORK_LOT_DELIVERY_FIELDS,...WORK_LOT_CAPACITY_FIELDS]))!==stableWorkString(withoutWork(candidate,[...WORK_LOT_DELIVERY_FIELDS,...WORK_LOT_CAPACITY_FIELDS])))throw new Error('No puedes modificar las referencias ni sus cantidades originales.');
  const target=workLotTarget(old),oldDelivered=workLotNumber(old.entregado),newDelivered=workLotNumber(candidate.entregado);
  const oldEvents=Array.isArray(old.entregas)?old.entregas:[],newEvents=Array.isArray(candidate.entregas)?candidate.entregas:[];
  const oldConf=Array.isArray(old.confirmacionesCanastas)?old.confirmacionesCanastas:[],newConf=Array.isArray(candidate.confirmacionesCanastas)?candidate.confirmacionesCanastas:[];
  const oldCorrections=Array.isArray(old.correcciones)?old.correcciones:[],newCorrections=Array.isArray(candidate.correcciones)?candidate.correcciones:[];
  const capacityChanged=WORK_LOT_CAPACITY_FIELDS.some(k=>stableWorkString(old[k]??null)!==stableWorkString(candidate[k]??null));
  if(newDelivered>target)throw new Error('La entrega no puede superar el lote.');
  if(capacityChanged){
   if(newDelivered!==oldDelivered||stableWorkString(newEvents)!==stableWorkString(oldEvents)||stableWorkString(newConf)!==stableWorkString(oldConf)||stableWorkString(newCorrections)!==stableWorkString(oldCorrections))throw new Error('Guarda la capacidad por separado de las entregas.');
   const cap=workLotNumber(candidate.cantidadCanasta),baskets=workLotNumber(candidate.numCanastas);
   if(!Number.isInteger(cap)||cap<1||String(candidate.cantidadCanastaRaw??'')!==String(cap))throw new Error('La capacidad debe ser un entero válido.');
   const expected=target>0?Math.ceil(target/cap):baskets;
   if(baskets!==expected||String(candidate.numCanastasRaw??'')!==String(expected))throw new Error('El cálculo de canastas no coincide con el lote.');
  }
  if(newDelivered<oldDelivered){
   const correction=newCorrections[newCorrections.length-1],delta=oldDelivered-newDelivered;
   if(capacityChanged||stableWorkString(newEvents)!==stableWorkString(oldEvents)||stableWorkString(newConf)!==stableWorkString(oldConf)||newCorrections.length!==oldCorrections.length+1||!oldCorrections.every((e,i)=>stableWorkString(e)===stableWorkString(newCorrections[i])))throw new Error('La corrección no coincide con el historial.');
   const who=workLotNorm(correction&&correction.usuario),identities=[user.name,username].map(workLotNorm);
   if(workLotNumber(correction&&correction.unidades)!==delta||workLotNumber(correction&&correction.entregadoAntes)!==oldDelivered||workLotNumber(correction&&correction.entregadoDespues)!==newDelivered||!String(correction&&correction.motivo||'').trim()||!identities.includes(who))throw new Error('Los datos de la corrección no son válidos.');
   const expected=newDelivered>=target&&target>0?'Entregada':newDelivered>0?'Parcial':'Pendiente';
   if(candidate.estado!==expected||stableWorkString(candidate.entrega||null)!==stableWorkString(old.entrega||null))throw new Error('El estado de la corrección no coincide.');
  }else if(newDelivered>oldDelivered){
   if(capacityChanged||newCorrections.length!==oldCorrections.length||!oldCorrections.every((e,i)=>stableWorkString(e)===stableWorkString(newCorrections[i])))throw new Error('No se permiten correcciones junto con una entrega nueva.');
   if(newEvents.length!==oldEvents.length+1||!oldEvents.every((e,i)=>stableWorkString(e)===stableWorkString(newEvents[i])))throw new Error('El movimiento de entrega no coincide.');
   const movement=newEvents[newEvents.length-1],physical=workLotNumber(movement&&movement.canastasFisicas);
   if(physical!==0&&(!Number.isInteger(physical)||physical<1))throw new Error('La cantidad de canastas físicas no es válida.');
   if(workLotNumber(movement&&movement.cantidad)!==newDelivered-oldDelivered)throw new Error('La cantidad del movimiento no coincide.');
   const expected=newDelivered>=target?'Entregada':'Parcial';
   if(candidate.estado!==expected||stableWorkString(candidate.entrega||null)!==stableWorkString(movement))throw new Error('El estado de entrega no coincide.');
   if(newConf.length!==oldConf.length+(physical>0?1:0)||!oldConf.every((e,i)=>stableWorkString(e)===stableWorkString(newConf[i])))throw new Error('La confirmación de canastas no coincide.');
   if(physical>0){const last=newConf[newConf.length-1];if(workLotNumber(last&&last.cantidad)!==physical||workLotNumber(last&&last.unidades)!==newDelivered-oldDelivered||workLotNumber(candidate.canastasEntregadas)!==workLotNumber(old.canastasEntregadas)+physical)throw new Error('Las canastas físicas no coinciden con las unidades.');}
   else if(stableWorkString(newConf)!==stableWorkString(oldConf)||workLotNumber(candidate.canastasEntregadas)!==workLotNumber(old.canastasEntregadas))throw new Error('No se permiten cambios en las canastas físicas.');
  }else{
   if(stableWorkString(newEvents)!==stableWorkString(oldEvents)||stableWorkString(newCorrections)!==stableWorkString(oldCorrections)||candidate.estado!==old.estado||stableWorkString(candidate.entrega||null)!==stableWorkString(old.entrega||null))throw new Error('No se permiten cambios en el historial de entregas.');
   if(!capacityChanged){
    const added=newConf.length===oldConf.length+1&&oldConf.every((e,i)=>stableWorkString(e)===stableWorkString(newConf[i]));
    if(added){const last=newConf[newConf.length-1],n=workLotNumber(last&&last.cantidad);if(last.soloConteo!==true||n<1||!Number.isInteger(n)||workLotNumber(last.unidades)!==0||workLotNumber(candidate.canastasEntregadas)!==workLotNumber(old.canastasEntregadas)+n)throw new Error('El conteo de canastas no es válido.');}
    else if(stableWorkString(newConf)!==stableWorkString(oldConf)||workLotNumber(candidate.canastasEntregadas)!==workLotNumber(old.canastasEntregadas))throw new Error('No se permiten cambios en las canastas físicas.');
   }
  }
  const merged={...old};
  for(const k of WORK_LOT_CAPACITY_FIELDS){if(Object.prototype.hasOwnProperty.call(candidate,k))merged[k]=candidate[k];else delete merged[k];}
  for(const k of WORK_LOT_DELIVERY_FIELDS){if(Object.prototype.hasOwnProperty.call(candidate,k))merged[k]=candidate[k];else delete merged[k];}
  result.push(merged);
 }
 if(byId.size)throw new Error('La lista contiene referencias que no pertenecen a este lote.');
 return result;
}
function withoutWork(value,fields){const copy={...(value||{})};for(const f of fields)delete copy[f];return copy;}
function ensureWorkLot(rows,state,model,username){let row=rows.filter(x=>x.model===model).sort((a,b)=>b.number-a.number)[0];if(row)return row;const tasks=(Array.isArray(state.tasks)?state.tasks:[]).filter(t=>t&&t.standardNKD&&workLotModel(t.standardMoto||(t.standardNKD?'NKD':''))===model);if(!tasks.length)throw new Error('No hay referencias originales cargadas para '+model+'.');const now=new Date().toISOString();row={id:require('crypto').randomUUID(),model,number:1,tasks:JSON.parse(JSON.stringify(tasks)),createdBy:username,createdAt:now,updatedAt:now};rows.push(row);writeWorkLots(rows);return row;}

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
  const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username:'patinadores',expires:Date.now()+SESSION_TTL});persistSessions();
  return sendJson(res,200,{ok:true,token,sharedPatinadores:true,patinadores:profiles,user:{username:'patinadores',name:'Patinadores',role:'Patinador',turno:turnoLogin}});
 }
 let user=state.users[username],turnoLogin=null,passwordValid=false;
 if(user&&user.role==='Patinador'&&(typeof user.passDia==='string'||typeof user.passNoche==='string')){
  if(typeof user.passDia==='string'&&user.passDia===password){passwordValid=true;turnoLogin='Día';}
  else if(typeof user.passNoche==='string'&&user.passNoche===password){passwordValid=true;turnoLogin='Noche';}
 }else if(user&&typeof user.pass==='string'&&user.pass===password){passwordValid=true;turnoLogin=user.turno||'Todos';}
 if(!passwordValid&&username==='admin'&&process.env.ADMIN_RECOVERY_PASSWORD&&password===process.env.ADMIN_RECOVERY_PASSWORD&&!state.adminRecoveryUsed&&user&&user.role==='Admin'){user.pass=password;state.adminRecoveryUsed=true;writeState(state);passwordValid=true;}
 if(!user||!passwordValid)return sendJson(res,401,{ok:false,error:'Usuario o contraseña incorrectos'});
 const token=require('crypto').randomBytes(32).toString('hex');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});persistSessions();
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
if(p==='/api/work-lots'&&['GET','POST','PUT'].includes(req.method)){
 const token=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):'',session=sessions.get(token);
 if(!authorized(req)||!session)return sendJson(res,401,{ok:false,error:'Sesión vencida. Ingresa nuevamente.'});
 const state=readState();let body={};
 const finish=(actor,model,action)=>{
  const user=state.users&&state.users[actor];if(!user||user.role!=='Patinador')return sendJson(res,403,{ok:false,error:'Esta función está disponible para Patinadores.'});
  const rows=readWorkLots();let row;
  try{row=ensureWorkLot(rows,state,model,actor);}catch(e){return sendJson(res,404,{ok:false,error:e.message||'No hay estándar disponible.'});}
  if(action==='GET')return sendJson(res,200,workLotResponse(row,user,actor,rows));
  if(action==='POST'){
   if(body.action==='select'){const selected=rows.find(x=>x.model===model&&x.id===String(body.lotId||''));if(!selected)return sendJson(res,404,{ok:false,error:'No se encontró el lote guardado.'});return sendJson(res,200,workLotResponse(selected,user,actor,rows));}
   if(body.action!=='next')return sendJson(res,400,{ok:false,error:'Acción de lote no válida.'});
   if(!body.lotId)return sendJson(res,400,{ok:false,error:'Falta identificar el lote actual.'});const source=rows.find(x=>x.model===model&&x.id===String(body.lotId));if(!source)return sendJson(res,404,{ok:false,error:'El lote actual ya no existe. Actualiza la pantalla.'});const nextNo=source.number+1;let selected=rows.find(x=>x.model===model&&x.number===nextNo);
   if(!selected){const cloned=(row.tasks||[]).map(t=>({...t,entregado:0,estado:'Pendiente',entregas:[],entrega:null,canastasEntregadas:0,confirmacionesCanastas:[]}));const now=new Date().toISOString();selected={id:require('crypto').randomUUID(),model,number:nextNo,tasks:cloned,createdBy:actor,createdAt:now,updatedAt:now};rows.push(selected);writeWorkLots(rows);}
   return sendJson(res,200,workLotResponse(selected,user,actor,rows));
  }
  if(action==='PUT'){
   if(!body.lotId||!body.version)return sendJson(res,400,{ok:false,error:'Falta identificar la versión del lote.'});
   const selected=rows.find(x=>x.model===model&&x.id===String(body.lotId));if(!selected)return sendJson(res,404,{ok:false,error:'El lote ya no existe. Actualiza la pantalla.'});
   if(selected.updatedAt!==body.version)return sendJson(res,409,{ok:false,error:'Otro usuario guardó cambios en este lote. Actualiza antes de continuar.'});
   let merged;try{merged=validateWorkLot(selected.tasks||[],body.tasks,user,actor);}catch(e){return sendJson(res,403,{ok:false,error:e.message||'No se pudo validar el cambio.'});}
   selected.tasks=merged;selected.updatedAt=new Date().toISOString()+'#'+require('crypto').randomUUID();writeWorkLots(rows);return sendJson(res,200,workLotResponse(selected,user,actor,rows));
  }
 };
 if(req.method==='GET'){const model=workLotModel(url.searchParams.get('model')),actor=session.username==='patinadores'?String(url.searchParams.get('username')||''):session.username;if(!model)return sendJson(res,400,{ok:false,error:'Selecciona un modelo válido.'});return finish(actor,model,'GET');}
 let raw='';req.on('data',c=>{raw+=c;if(raw.length>10000000)req.destroy();});req.on('end',()=>{try{body=JSON.parse(raw||'{}');const model=workLotModel(body.model),actor=session.username==='patinadores'?String(body.username||''):session.username;if(!model)return sendJson(res,400,{ok:false,error:'Selecciona un modelo válido.'});return finish(actor,model,req.method);}catch(e){return sendJson(res,400,{ok:false,error:'Solicitud de lote inválida.'});}});return;
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

if(p.startsWith('/api/admin/reference-photos/')&&req.method==='POST'){
 const token=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):'',session=sessions.get(token),modelKey=p.split('/').pop(),model=safePhotoModel(modelKey);
 if(!session||session.username!=='admin')return sendJson(res,403,{ok:false,error:'Solo el administrador puede cargar fotos de referencias.'});
 if(!model)return sendJson(res,400,{ok:false,error:'Modelo de fotos no válido.'});
 const chunks=[];let size=0,tooLarge=false;
 req.on('data',chunk=>{size+=chunk.length;if(size>15*1024*1024){tooLarge=true;chunks.length=0;}else if(!tooLarge)chunks.push(chunk);});
 req.on('end',()=>{
  if(tooLarge)return sendJson(res,413,{ok:false,error:'El ZIP supera el límite de 15 MB.'});
  try{
   const entries=readZipEntries(Buffer.concat(chunks)),mb=entries.get('manifest.json');if(!mb)throw new Error('El paquete no contiene manifest.json.');
   const manifest=JSON.parse(mb.toString('utf8'));
   if(String(manifest.modelo||'').trim().toUpperCase()!==model.toUpperCase())throw new Error('El paquete seleccionado no corresponde al modelo '+model+'.');
   if(!manifest.items||typeof manifest.items!=='object'||Array.isArray(manifest.items))throw new Error('El manifiesto de referencias no es válido.');
   const used=new Set();for(const item of Object.values(manifest.items)){if(!item||!String(item.ean||'').trim()||!String(item.puesto||'').trim()||!Array.isArray(item.photos))throw new Error('El manifiesto contiene una referencia incompleta.');if(modelKey==='chr'&&!/^\d+$/.test(String(item.numeroReferencia||'')))throw new Error('Cada referencia CHR debe incluir su número y puesto exacto.');for(const photo of item.photos){const file=String(photo.file||'');if(!/^[a-f0-9]{40}\.webp$/i.test(file))throw new Error('Nombre de foto no permitido.');used.add(file);}}
   if(!used.size)throw new Error('El paquete no contiene fotos asociadas.');
   const files=new Map();for(const name of used){const data=entries.get('fotos/'+name);if(!data||data.length<16||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP')throw new Error('Falta una foto o no es WebP válida: '+name);files.set(name,data);}
   const base=path.join(DATA_DIR,'reference-photos'),target=path.join(base,modelKey),temp=path.join(base,modelKey+'.tmp-'+Date.now()),old=path.join(base,modelKey+'.old');fs.mkdirSync(temp,{recursive:true});
   const existingManifestPath=path.join(target,'manifest.json');
   if(fs.existsSync(target)){
    let existingManifest=null;
    if(fs.existsSync(existingManifestPath)){try{existingManifest=JSON.parse(fs.readFileSync(existingManifestPath,'utf8'));}catch(e){throw new Error('El catálogo existente no se pudo leer; se conservó sin cambios.');}}
    if(existingManifest&&existingManifest.items&&typeof existingManifest.items==='object'&&!Array.isArray(existingManifest.items)){
     for(const [itemKey,existingItem] of Object.entries(existingManifest.items)){
      const incomingItem=manifest.items[itemKey];
      if(!incomingItem){manifest.items[itemKey]=existingItem;}
      else{
       const combined=new Map();
       for(const photo of [...(Array.isArray(existingItem.photos)?existingItem.photos:[]),...(Array.isArray(incomingItem.photos)?incomingItem.photos:[])])if(photo&&/^[a-f0-9]{40}\.webp$/i.test(String(photo.file||'')))combined.set(photo.file,photo);
       manifest.items[itemKey]={...existingItem,...incomingItem,photos:[...combined.values()]};
      }
      const mergedItem=manifest.items[itemKey];
      for(const photo of Array.isArray(mergedItem.photos)?mergedItem.photos:[]){const file=String(photo&&photo.file||'');if(/^[a-f0-9]{40}\.webp$/i.test(file)){const source=path.join(target,file);if(fs.existsSync(source)&&!fs.existsSync(path.join(temp,file)))fs.copyFileSync(source,path.join(temp,file));}}
     }
    }
    for(const name of fs.readdirSync(target)){if(/^[a-f0-9]{40}\.webp$/i.test(name)){const source=path.join(target,name),dest=path.join(temp,name);if(fs.statSync(source).isFile()&&!fs.existsSync(dest))fs.copyFileSync(source,dest);}}
   }
   for(const [name,data] of files)fs.writeFileSync(path.join(temp,name),data);
   const mergedItems=Object.values(manifest.items),withPhotos=mergedItems.filter(item=>item&&Array.isArray(item.photos)&&item.photos.some(photo=>photo&&photo.file)).length;
   manifest.referencias_confirmadas=withPhotos;manifest.referencias_pendientes=mergedItems.length-withPhotos;manifest.asociaciones_foto=withPhotos;
   fs.writeFileSync(path.join(temp,'manifest.json'),JSON.stringify(manifest));
   fs.rmSync(old,{recursive:true,force:true});if(fs.existsSync(target))fs.renameSync(target,old);
   try{fs.renameSync(temp,target);fs.rmSync(old,{recursive:true,force:true});}catch(e){if(fs.existsSync(old)&&!fs.existsSync(target))fs.renameSync(old,target);throw e;}
   return sendJson(res,200,{ok:true,modelo:model,referencias:Object.keys(manifest.items).length,fotos:files.size,asociaciones:Number(manifest.asociaciones_foto)||0,pendientes:Number(manifest.referencias_pendientes)||0});
  }catch(e){console.error('Importación de fotos de referencias:',e);return sendJson(res,400,{ok:false,error:e.message||'No se pudo importar el paquete de fotos.'});}
 });return;
}

if(p==='/api/admin/archive-completed-lot'&&req.method==='POST'){
 const token=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):'',session=sessions.get(token),state=readState();
 if(!session||session.username!=='admin'||!state.users[session.username]||state.users[session.username].role!=='Admin')return sendJson(res,403,{ok:false,error:'Solo el administrador puede retirar lotes.'});
 let body='';req.on('data',c=>{body+=c;if(body.length>10000)req.destroy();});req.on('end',()=>{
  try{
   const incoming=JSON.parse(body||'{}'),modelo=String(incoming.modelo||'').trim().toUpperCase(),codigo=String(incoming.codigo||'').trim().toUpperCase();
   if(!modelo||!codigo)return sendJson(res,400,{ok:false,error:'Falta el modelo o el código exacto del lote.'});
   const modelOf=t=>String(t&&(t.standardMoto||(t.standardNKD?'NKD':''))||'').trim().toUpperCase();
   const selected=(Array.isArray(state.tasks)?state.tasks:[]).filter(t=>(t.standardNKD||String(t.standardMoto||'').trim())&&modelOf(t)===modelo&&String(t.codigoLoteOperacion||'').trim().toUpperCase()===codigo);
   if(!selected.length)return sendJson(res,404,{ok:false,error:'No hay tareas activas para ese lote.'});
   const objective=t=>{if(String(t.standardMoto||'').trim().toUpperCase()==='XRS-180'&&t.continuidadDeTareaId&&String(t.codigoLoteOperacion||'').trim().toUpperCase()==='KK767A')return Math.max(0,Number(String(t.cantidad??'').replace(',','.'))||0);const lot=Number(String(t.lote??'').replace(',','.'))||0,cap=Number(String(t.cantidadCanasta??'').replace(',','.'))||0,baskets=Number(String(t.numCanastas??'').replace(',','.'))||0,unit=Number(String(t.cantidadUnidad??'').replace(',','.'))||0,qty=Number(String(t.cantidad??'').replace(',','.'))||0;if(lot>1)return lot;if(qty>1)return qty;if(cap>0&&baskets>0)return cap*baskets;return unit>0?unit:(lot>0?lot:(cap>0?cap:qty));};
   const pending=selected.filter(t=>Math.max(0,objective(t))>Math.max(0,Number(t.entregado)||0));
   const untouched=selected.every(t=>Math.max(0,Number(t.entregado)||0)===0&&!(Array.isArray(t.entregas)&&t.entregas.length)&&!(Array.isArray(t.confirmacionesCanastas)&&t.confirmacionesCanastas.length));
   const completed=pending.length===0;
   if(!completed&&!untouched)return sendJson(res,409,{ok:false,error:'Este lote tiene entregas parciales. Solo se pueden retirar lotes totalmente terminados o lotes sin ninguna entrega.',tareasPendientes:pending.length});
   if(incoming.confirmacion!=='RETIRAR LOTE COMPLETADO')return sendJson(res,400,{ok:false,error:'Falta la confirmación de retiro.'});
   const fecha=new Date().toLocaleString('es-CO'),usuario=String(state.users[session.username].name||session.username);
   const archivados=selected.map(t=>({...JSON.parse(JSON.stringify(t)),archivadaEn:fecha,archivadaPor:usuario,motivoArchivo:'Lote retirado de tareas activas: '+modelo+' / '+codigo}));
   const archivo=archiveTasks(selected,{usuario,motivo:'Retiro manual de lote: '+modelo+' / '+codigo,regla:'Se conserva el detalle íntegro de tareas y entregas en el historial. Se retiran de la lista activa únicamente las tareas del modelo y código exactos seleccionados por administración, estén completas o sin trabajar.'});
   state.tareasArchivadas=[...(Array.isArray(state.tareasArchivadas)?state.tareasArchivadas:[]),...archivados];
   const ids=new Set(selected.map(t=>String(t.id)));state.tasks=(Array.isArray(state.tasks)?state.tasks:[]).filter(t=>!ids.has(String(t.id)));
   writeState(state);
   return sendJson(res,200,{ok:true,archivo:archivo.file,modelo,codigo,tareasRetiradas:selected.length,mensaje:'Lote retirado de tareas activas. Las entregas quedaron conservadas en el historial.'});
  }catch(e){console.error('archive completed lot failed',e);return sendJson(res,500,{ok:false,error:'No se pudo retirar el lote.'});}
 });return;
}

if(p==='/api/admin/reference-photos/diagnostic'&&req.method==='GET'){
 const token=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):'',session=sessions.get(token),state=readState();
 if(!session||session.username!=='admin'||!state.users[session.username]||state.users[session.username].role!=='Admin')return sendJson(res,403,{ok:false,error:'Solo el administrador puede consultar este diagnóstico.'});
 const models=[{key:'nkd',name:'NKD',match:t=>!!t.standardNKD&&String(t.standardMoto||t.modelo||'NKD').trim().toUpperCase()==='NKD'},{key:'cr4125',name:'CR4 125',match:t=>String(t.standardMoto||t.modelo||t.modeloMoto||'').trim().toUpperCase().replace(/[-_]/g,' ')==='CR4 125'},{key:'cr4150',name:'CR4-150',match:t=>['CR4 150','CR4-150'].includes(String(t.standardMoto||t.modelo||t.modeloMoto||'').trim().toUpperCase())},{key:'xrs180',name:'XRS-180',match:t=>String(t.standardMoto||t.modelo||t.modeloMoto||'').trim().toUpperCase().replace(/[-_ ]/g,'')==='XRS180'},{key:'chr',name:'CHR',match:t=>String(t.standardMoto||t.modelo||t.modeloMoto||'').trim().toUpperCase()==='CHR'}];
 const normPos=v=>{const x=String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');let m=x.match(/^pre\s*0*(\d+)$/);if(m)return 'pre '+Number(m[1]);m=x.match(/^0*(\d+)\s*(derecho|izquierdo)$/);if(m)return m[2]+' '+Number(m[1]);m=x.match(/^(derecho|izquierdo|final(?: de linea)?)\s*0*(\d+)$/);if(m)return (m[1].startsWith('final')?'final':m[1])+' '+Number(m[2]);return x;};
 const out=models.map(model=>{
  const dir=path.join(DATA_DIR,'reference-photos',model.key),manifestPath=path.join(dir,'manifest.json');let manifest=null,manifestError=null;
  try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}catch(e){manifestError='No hay manifiesto legible para este modelo.';}
  const items=manifest&&manifest.items&&typeof manifest.items==='object'?Object.values(manifest.items):[],byKey=new Map(),byNumber=new Map(),byEan=new Map(),missingFiles=[];
  for(const item of items){const ean=String(item&&item.ean||'').trim().replace(/\s+/g,''),pos=normPos(item&&item.puesto),photos=Array.isArray(item&&item.photos)?item.photos:[],key=ean+'|'+pos;byKey.set(key,item);const numero=String(item&&item.numeroReferencia||'').trim();if(numero)byNumber.set(numero+'|'+pos,item);if(ean){if(!byEan.has(ean))byEan.set(ean,[]);byEan.get(ean).push(item);}for(const photo of photos){const file=String(photo&&photo.file||'');if(!/^[a-f0-9]{40}\.webp$/i.test(file)||!fs.existsSync(path.join(dir,file)))missingFiles.push({ean:item.ean||'',puesto:item.puesto||'',archivo:file||'sin nombre'});}}
  const refsConFoto=items.filter(x=>Array.isArray(x.photos)&&x.photos.some(ph=>ph&&ph.file)).length,refsSinFoto=items.length-refsConFoto;
  const taskRows=(Array.isArray(state.tasks)?state.tasks:[]).filter(model.match).map(t=>{const ean=String(t.ean||'').trim().replace(/\s+/g,''),pos=normPos(t.puesto),numero=String(t.numeroReferencia||'').trim(),exact=(model.key==='chr'&&numero?byNumber.get(numero+'|'+pos):null)||byKey.get(ean+'|'+pos);let has=!!(exact&&Array.isArray(exact.photos)&&exact.photos.some(ph=>ph&&ph.file));if(!has&&model.key!=='chr'){const candidates=(byEan.get(ean)||[]).filter(x=>Array.isArray(x.photos)&&x.photos.some(ph=>ph&&ph.file));if(candidates.length===1)has=true;}return {numeroReferencia:numero||exact&&exact.numeroReferencia||'',ean:t.ean||'',producto:t.producto||'',puesto:t.puesto||'',foto:has};});
  const tasksSinFoto=taskRows.filter(x=>!x.foto);
  const estructuraTareas=model.key==='chr'?(()=>{const sample=(Array.isArray(state.tasks)?state.tasks:[]).find(model.match);if(!sample)return {camposDisponibles:[],valoresCandidatos:[]};const campos=Object.keys(sample);const relevantes=campos.filter(k=>/(numero|refer|ean|puesto|ubic|producto|nombre|codigo|posic|linea|estacion|modelo|moto)/i.test(k));return {camposDisponibles:campos,valoresCandidatos:relevantes.filter(k=>['string','number','boolean'].includes(typeof sample[k])).slice(0,35).map(k=>({campo:k,valor:String(sample[k]).slice(0,120)}))};})():undefined;
  return {modelo:model.name,estado:manifestError?'sin_manifiesto':'revisado',referenciasManifiesto:items.length,referenciasConFoto:refsConFoto,referenciasSinFoto:refsSinFoto,archivosFotoFaltantes:missingFiles.length,tareasRevisadas:taskRows.length,tareasSinFoto:tasksSinFoto.length,ejemplosSinFoto:tasksSinFoto.slice(0,40),...(estructuraTareas?{estructuraTareas}:{}),ejemplosArchivosFaltantes:missingFiles.slice(0,20),error:manifestError};
 });
 return sendJson(res,200,{ok:true,soloLectura:true,fecha:new Date().toISOString(),modelos:out});
}

if(p.startsWith('/api/reference-photos/')&&req.method==='GET'){
 const parts=p.split('/'),modelKey=parts[3],model=safePhotoModel(modelKey);if(!model)return sendJson(res,404,{ok:false,error:'Modelo no encontrado.'});
 const dir=path.join(DATA_DIR,'reference-photos',modelKey);
 if(parts[4]==='manifest'&&parts.length===5){fs.readFile(path.join(dir,'manifest.json'),(err,data)=>{if(err)return sendJson(res,404,{ok:false,error:'Aún no hay fotos cargadas para este modelo.'});res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, max-age=300'});res.end(data);});return;}
 const file=parts[4]||'';if(parts.length!==5||! /^[a-f0-9]{40}\.webp$/i.test(file))return sendJson(res,404,{ok:false,error:'Foto no encontrada.'});
 fs.readFile(path.join(dir,file),(err,data)=>{if(err)return sendJson(res,404,{ok:false,error:'Foto no encontrada.'});res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'private, max-age=86400'});res.end(data);});return;
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
return sendJson(res,200,{ok:true,archived:archived.file,count:archived.count,remainingCount:state.tasks.length,tasks:state.tasks});
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
  const cap=Number(String(t.cantidadCanasta??'').replace(',','.'))||0;
  const canastas=Number(String(t.numCanastas??'').replace(',','.'))||0;
  const unidad=Number(String(t.cantidadUnidad??'').replace(',','.'))||0;
  const cantidad=Number(String(t.cantidad??'').replace(',','.'))||0;
  if(lote>1)return lote;
  if(cantidad>1)return cantidad;
  if(cap>0&&canastas>0)return cap*canastas;
  return unidad>0?unidad:(lote>0?lote:(cap>0?cap:cantidad));
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
if(p==='/api/jornada/continuar-estandar'&&req.method==='POST'){
const token=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):'',session=sessions.get(token),state=readState();
if(!session||!state.users[session.username]||state.users[session.username].role!=='Admin')return sendJson(res,403,{ok:false,error:'Solo el administrador puede preparar esta continuidad.'});
let body='';req.on('data',c=>{body+=c;if(body.length>10000)req.destroy();});req.on('end',()=>{
try{
 const incoming=JSON.parse(body||'{}'),accion=String(incoming.accion||'previsualizar');
 const modelo=String(incoming.modelo||'').trim().toUpperCase(),codigo=String(incoming.codigo||'').trim().toUpperCase();
 const modelosPermitidos=new Set(['NKD','CR4 150','CR4 125','XRS-180','CHR']);
 if(!modelosPermitidos.has(modelo)||!codigo)return sendJson(res,400,{ok:false,error:'Selecciona un modelo y un código de operación válidos.'});
 const modelOf=t=>String(t&&(t.standardMoto||(t.standardNKD?'NKD':''))||'').trim().toUpperCase();
 const seleccionadas=(Array.isArray(state.tasks)?state.tasks:[]).filter(t=>modelOf(t)===modelo&&String(t.codigoLoteOperacion||'').trim().toUpperCase()===codigo);
 const objetivo=t=>{
  if(modelo==='NKD'||t.standardNKD){
   const lote=Number(String(t.lote??'').replace(',','.'))||0,cap=Number(String(t.cantidadCanasta??'').replace(',','.'))||0,canastas=Number(String(t.numCanastas??'').replace(',','.'))||0,unidad=Number(String(t.cantidadUnidad??'').replace(',','.'))||0,cantidad=Number(String(t.cantidad??'').replace(',','.'))||0;
   if(lote>1)return lote;
   if(cantidad>1)return cantidad;
   if(cap>0&&canastas>0)return cap*canastas;
   return unidad>0?unidad:(lote>0?lote:(cap>0?cap:cantidad));
  }
  return Math.max(0,Number(String(t.cantidad??'').replace(',','.'))||0);
 };
 const calcular=t=>{const total=Math.max(0,objetivo(t)),entregado=Math.min(total,Math.max(0,Number(String(t.entregado??0).replace(',','.'))||0));return {total,entregado,restante:Math.max(0,total-entregado)};};
 const resumen={modelo,codigo,tareasEncontradas:seleccionadas.length,tareasPendientes:0,tareasCompletadas:0,unidadesObjetivo:0,unidadesEntregadas:0,unidadesPendientes:0};
 seleccionadas.forEach(t=>{const v=calcular(t);resumen.unidadesObjetivo+=v.total;resumen.unidadesEntregadas+=v.entregado;resumen.unidadesPendientes+=v.restante;if(v.restante>0)resumen.tareasPendientes++;else resumen.tareasCompletadas++;});
 const key=modelo+'|'+codigo,previous=state.continuidadOperaciones&&state.continuidadOperaciones[key];
 const continuidadYaPreparada=!!(previous&&previous.activeFingerprint===JSON.stringify(seleccionadas));
 if(accion==='previsualizar')return sendJson(res,200,{ok:true,resumen,continuidadYaPreparada,mensaje:seleccionadas.length?'Vista previa solamente. No se modificó ningún dato.':('No hay tareas activas para '+modelo+' / '+codigo+'.')});
 if(accion!=='aplicar')return sendJson(res,400,{ok:false,error:'Acción no válida.'});
 if(!seleccionadas.length)return sendJson(res,409,{ok:false,error:'No hay tareas activas para la selección indicada.'});
 if(continuidadYaPreparada)return sendJson(res,409,{ok:false,error:'Esta continuidad ya fue preparada y no se duplicaron tareas.'});
 const stamp=Date.now(),fecha=new Date().toLocaleString('es-CO'),pendientes=[];
 seleccionadas.forEach((t,i)=>{const v=calcular(t);if(v.restante<=0)return;const next={...JSON.parse(JSON.stringify(t)),id:String(t.id)+'-continuidad-'+stamp+'-'+i,cantidad:v.restante,entregado:0,entregas:[],entrega:null,canastasEntregadas:0,confirmacionesCanastas:[],correcciones:[],estado:'Pendiente',continuidadDeTareaId:t.id,continuidadFecha:fecha,unidadesObjetivoAnterior:v.total,unidadesEntregadasJornadaAnterior:v.entregado,unidadesPendientesContinuadas:v.restante};if(modelo==='NKD'||t.standardNKD){next.lote=v.restante;if(Object.prototype.hasOwnProperty.call(t,'lotePiezas'))next.lotePiezas=v.restante;const cap=Number(String(t.cantidadCanasta??'').replace(',','.'))||0;if(cap>0){next.numCanastas=Math.ceil(v.restante/cap);if(Object.prototype.hasOwnProperty.call(t,'numCanastasRaw'))next.numCanastasRaw=String(next.numCanastas);}}pendientes.push(next);});
 if(!pendientes.length)return sendJson(res,409,{ok:false,error:'No hay cantidades pendientes para esta operación. No se modificó nada.'});
 const usuario=String(state.users[session.username].name||session.username),ids=new Set(seleccionadas.map(t=>String(t.id)));
 const archivados=seleccionadas.map(t=>({...JSON.parse(JSON.stringify(t)),archivadaEn:fecha,archivadaPor:usuario,motivoArchivo:'Continuidad por modelo y operación: '+modelo+' / '+codigo+'. Se conserva el registro original íntegro.'}));
 const archivo=archiveTasks(seleccionadas,{usuario,motivo:'Continuidad por modelo y operación: '+modelo+' / '+codigo,regla:'Solo se archivó esta selección. Las entregas anteriores quedan en el historial y únicamente las cantidades pendientes pasan a tareas activas nuevas.'});
 state.tareasArchivadas=[...(Array.isArray(state.tareasArchivadas)?state.tareasArchivadas:[]),...archivados];
 state.tasks=(Array.isArray(state.tasks)?state.tasks:[]).filter(t=>!ids.has(String(t.id))).concat(pendientes);
 if(!state.continuidadOperaciones||typeof state.continuidadOperaciones!=='object')state.continuidadOperaciones={};
 state.continuidadOperaciones[key]={fecha,archivo:archivo.file,activeFingerprint:JSON.stringify(pendientes)};
 writeState(state);
 return sendJson(res,200,{ok:true,resumen,archivo:archivo.file,tareasNuevas:pendientes.length,unidadesContinuadas:pendientes.reduce((n,t)=>n+Math.max(0,Number(t.cantidad)||0),0),mensaje:'Continuidad preparada solo para '+modelo+' / '+codigo+'. Las demás motos y operaciones permanecen intactas.'});
}catch(e){console.error('Error preparando continuidad por modelo y operación:',e);return sendJson(res,500,{ok:false,error:'No se pudo preparar la continuidad de esta operación.'});}
});return;
}
if(p==='/api/jornada/continuar-xrs180'&&req.method==='POST'){
const token=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):'',session=sessions.get(token),state=readState();
if(!session||!state.users[session.username]||state.users[session.username].role!=='Admin')return sendJson(res,403,{ok:false,error:'Solo el administrador puede preparar esta continuidad.'});
let body='';req.on('data',c=>{body+=c;if(body.length>10000)req.destroy();});req.on('end',()=>{
try{
const incoming=JSON.parse(body||'{}'),accion=String(incoming.accion||'previsualizar');
const esObjetivo=t=>String(t&& (t.standardMoto||(t.standardNKD?'NKD':''))||'').trim().toUpperCase()==='XRS-180'&&String(t&&t.codigoLoteOperacion||'').trim().toUpperCase()==='KK767A';
const seleccionadas=(Array.isArray(state.tasks)?state.tasks:[]).filter(esObjetivo);
const calcular=t=>{
 const total=Math.max(0,Number(String(t.cantidad??'').replace(',','.'))||0);
 const entregado=Math.min(total,Math.max(0,Number(String(t.entregado??0).replace(',','.'))||0));
 return {total,entregado,restante:Math.max(0,total-entregado)};
};
const resumen={modelo:'XRS-180',codigoLoteOperacion:'KK767A',tareasEncontradas:seleccionadas.length,tareasPendientes:0,tareasCompletadas:0,unidadesObjetivo:0,unidadesEntregadas:0,unidadesPendientes:0};
seleccionadas.forEach(t=>{const x=calcular(t);resumen.unidadesObjetivo+=x.total;resumen.unidadesEntregadas+=x.entregado;resumen.unidadesPendientes+=x.restante;if(x.restante>0)resumen.tareasPendientes++;else resumen.tareasCompletadas++;});
if(accion==='previsualizar'){
 if(!seleccionadas.length)return sendJson(res,200,{ok:true,resumen,mensaje:'No hay tareas activas que coincidan exactamente con XRS-180 y KK767A.'});
 return sendJson(res,200,{ok:true,resumen,mensaje:'Vista previa solamente. No se modificó ningún dato.'});
}
if(accion!=='aplicar')return sendJson(res,400,{ok:false,error:'Acción no válida.'});
if(!seleccionadas.length)return sendJson(res,409,{ok:false,error:'No hay tareas activas XRS-180 con código KK767A.'});
const fingerprint=JSON.stringify(seleccionadas);
if(state.continuidadXRS180KK767A&&state.continuidadXRS180KK767A.fingerprint===fingerprint)return sendJson(res,409,{ok:false,error:'Esta misma continuidad ya fue preparada. No se duplicaron tareas.'});
const stamp=Date.now(),fecha=new Date().toLocaleString('es-CO'),pendientes=[];
seleccionadas.forEach((t,i)=>{
 const x=calcular(t);if(x.restante<=0)return;
 const next={...JSON.parse(JSON.stringify(t)),id:String(t.id)+'-continuidad-xrs180-kk767a-'+stamp+'-'+i,cantidad:x.restante,entregado:0,entregas:[],entrega:null,canastasEntregadas:0,confirmacionesCanastas:[],correcciones:[],estado:'Pendiente',continuidadDeTareaId:t.id,continuidadFecha:fecha,unidadesObjetivoAnterior:x.total,unidadesEntregadasJornadaAnterior:x.entregado,unidadesPendientesContinuadas:x.restante};
 pendientes.push(next);
});
if(!pendientes.length)return sendJson(res,409,{ok:false,error:'No hay cantidades pendientes para pasar al turno siguiente. No se modificó nada.'});
const archivados=seleccionadas.map(t=>({...JSON.parse(JSON.stringify(t)),archivadaEn:fecha,archivadaPor:String(state.users[session.username].name||session.username),motivoArchivo:'Continuidad exclusiva XRS-180 OPR KK767A; se conserva el registro anterior íntegro.'}));
const archivo=archiveTasks(seleccionadas,{usuario:String(state.users[session.username].name||session.username),motivo:'Continuidad exclusiva XRS-180 OPR KK767A',regla:'Se conserva el historial original. Solo las cantidades pendientes pasan a tareas activas nuevas; las entregas previas quedan registradas en el archivo.'});
state.tareasArchivadas=[...(Array.isArray(state.tareasArchivadas)?state.tareasArchivadas:[]),...archivados];
state.tasks=(Array.isArray(state.tasks)?state.tasks:[]).filter(t=>!esObjetivo(t)).concat(pendientes);
state.continuidadXRS180KK767A={fecha,archivo:archivo.file,fingerprint:JSON.stringify(pendientes)};
writeState(state);
return sendJson(res,200,{ok:true,resumen,archivo:archivo.file,tareasNuevas:pendientes.length,unidadesContinuadas:pendientes.reduce((n,t)=>n+Math.max(0,Number(t.cantidad)||0),0),mensaje:'Continuidad XRS-180 / KK767A preparada. Las demás motos y códigos de operación no fueron modificados.'});
}catch(e){console.error('Error preparando continuidad XRS-180 KK767A:',e);return sendJson(res,500,{ok:false,error:'No se pudo preparar la continuidad XRS-180 / KK767A.'});}
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
 const objective=t=>{if(String(t.standardMoto||'').trim().toUpperCase()==='XRS-180'&&t.continuidadDeTareaId&&String(t.codigoLoteOperacion||'').trim().toUpperCase()==='KK767A')return Math.max(0,Number(String(t.cantidad??'').replace(',','.'))||0);const lot=Number(String(t.lote??'').replace(',','.'))||0,cap=Number(String(t.cantidadCanasta??'').replace(',','.'))||0,baskets=Number(String(t.numCanastas??'').replace(',','.'))||0,unit=Number(String(t.cantidadUnidad??'').replace(',','.'))||0,qty=Number(String(t.cantidad??'').replace(',','.'))||0;if(lot>1)return lot;if(qty>1)return qty;if(cap>0&&baskets>0)return cap*baskets;return unit>0?unit:(lot>0?lot:(cap>0?cap:qty));};
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
ensureState();loadSessions();server.listen(PORT,()=>console.log('FAMILIA AKT funcionando en puerto '+PORT));
