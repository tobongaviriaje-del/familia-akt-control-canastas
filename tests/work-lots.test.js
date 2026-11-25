'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const repoRoot = path.resolve(__dirname, '..');
async function freePort(){const probe=net.createServer();await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',resolve).once('error',reject));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
async function waitForHealth(url,child){const deadline=Date.now()+8000;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('El servidor terminó antes de iniciar.');try{if((await fetch(url+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('El servidor no respondió /health.');}
async function request(baseUrl,route,{token,method='GET',body}={}){const headers={};if(token)headers.Authorization='Bearer '+token;if(body!==undefined)headers['Content-Type']='application/json';const response=await fetch(baseUrl+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};}
test('el código de operación pertenece al lote seleccionado y es visible para sus patinadores',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-work-lots-'));const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));
 fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{admin:{pass:'AdminTest123',role:'Admin',name:'Administrador'},patinador1:{passDia:'TestDia123',role:'Patinador',name:'Patinador Uno',puestos:['PRE 1']},patinador2:{passDia:'TestDia123',role:'Patinador',name:'Patinador Dos',puestos:['PRE 1']}},tasks:[{id:'CHR-1',standardNKD:true,standardMoto:'CHR',ean:'770000000001',producto:'Referencia CHR',puesto:'PRE 1',cantidad:85,lote:85,estado:'Pendiente',entregado:0,entregas:[],confirmacionesCanastas:[]}]}));
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port;const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);
 const login1=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador1',password:'TestDia123'}});assert.equal(login1.status,200);const token1=login1.data.token;
 const login2=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador2',password:'TestDia123'}});assert.equal(login2.status,200);const token2=login2.data.token;
 const initial=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador1',{token:token1});assert.equal(initial.status,200);assert.equal(initial.data.lot.codigoLoteOperacion,'');const first=initial.data.lot;
 const adminLogin=await request(baseUrl,'/api/login',{method:'POST',body:{username:'admin',password:'AdminTest123'}});assert.equal(adminLogin.status,200);const beforeStart=await request(baseUrl,'/api/admin/work-lots/progress',{token:adminLogin.data.token});assert.equal(beforeStart.status,200);assert.equal(beforeStart.data.lots.length,0,'abrir el lote no debe marcarlo como iniciado');
 const started=await request(baseUrl,'/api/work-lots',{token:token1,method:'POST',body:{action:'select',username:'patinador1',model:'CHR',lotId:first.id}});assert.equal(started.status,200);const afterStart=await request(baseUrl,'/api/admin/work-lots/progress',{token:adminLogin.data.token});assert.equal(afterStart.status,200);assert.equal(afterStart.data.lots.length,1,'seleccionar explícitamente el lote debe hacerlo aparecer en Inteligencia');assert.equal(afterStart.data.lots[0].active,true);assert.equal(afterStart.data.lots[0].activePatinadores[0],'Patinador Uno');
 const saved=await request(baseUrl,'/api/work-lots',{token:token1,method:'POST',body:{action:'set-code',username:'patinador1',model:'CHR',lotId:first.id,version:first.updatedAt,code:'KK764A'}});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.lot.codigoLoteOperacion,'KK764A');
 const visible=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador2',{token:token2});assert.equal(visible.status,200);assert.equal(visible.data.lot.codigoLoteOperacion,'KK764A');
 const next=await request(baseUrl,'/api/work-lots',{token:token1,method:'POST',body:{action:'next',username:'patinador1',model:'CHR',lotId:first.id}});assert.equal(next.status,200);assert.equal(next.data.lot.number,2);assert.equal(next.data.lot.codigoLoteOperacion,'');assert.equal(next.data.tasks[0].codigoLoteOperacion,undefined,'el código del lote anterior no debe copiarse a las tareas del siguiente lote');
 const back=await request(baseUrl,'/api/work-lots',{token:token1,method:'POST',body:{action:'select',username:'patinador1',model:'CHR',lotId:first.id}});assert.equal(back.status,200);assert.equal(back.data.lot.codigoLoteOperacion,'KK764A');
});
test('corrige exclusivamente CR4 125 / KK809 a 270 por referencia y conserva entregas',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-kk809-fix-'));const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));
 fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 const active={id:'active-1',standardNKD:true,standardMoto:'CR4 125',codigoLoteOperacion:'KK809',lote:110,cantidad:110,lotePiezas:110,cantidadCanasta:10,numCanastas:11,entregado:20,entregas:[{cantidad:20,patinador:'Patinador Uno'}],estado:'Parcial'};
 const queued={id:'queued-1',standardNKD:true,standardMoto:'CR4 125',lote:100,cantidad:100,entregado:0,entregas:[],estado:'Pendiente'};
 const work={id:'work-1',standardNKD:true,standardMoto:'CR4 125',lote:90,cantidad:90,lotePiezas:90,cantidadCanasta:10,numCanastas:9,entregado:5,entregas:[{cantidad:5,patinador:'Patinador Dos'}],estado:'Parcial'};
 const state={users:{admin:{pass:'AdminTest123',role:'Admin',name:'Administrador'}},tasks:[active,{id:'other-1',standardNKD:true,standardMoto:'CR4 125',codigoLoteOperacion:'KK810',lote:100,cantidad:100,entregado:0},{id:'chr-1',standardNKD:true,standardMoto:'CHR',codigoLoteOperacion:'KK809',lote:300,cantidad:300,entregado:0}],queuedStandardBatches:[{id:'queue-kk809',modelo:'CR4 125',codigo:'KK809',tasks:[queued]},{id:'queue-other',modelo:'CR4 125',codigo:'KK810',tasks:[{id:'queued-other',standardNKD:true,standardMoto:'CR4 125',lote:80,cantidad:80}]}]};
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify(state));
 fs.writeFileSync(path.join(dataDir,'work-lots.json'),JSON.stringify([{id:'worklot-kk809',model:'CR4 125',number:1,codigoLoteOperacion:'KK809',tasks:[work]},{id:'worklot-kk810',model:'CR4 125',number:2,codigoLoteOperacion:'KK810',tasks:[{id:'work-other',standardNKD:true,standardMoto:'CR4 125',lote:70,cantidad:70}]},{id:'worklot-chr',model:'CHR',number:1,codigoLoteOperacion:'KK809',tasks:[{id:'work-chr',standardNKD:true,standardMoto:'CHR',lote:300,cantidad:300}]}]));
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port;const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);
 const login=await request(baseUrl,'/api/login',{method:'POST',body:{username:'admin',password:'AdminTest123'}});assert.equal(login.status,200);const token=login.data.token;
 const preview=await request(baseUrl,'/api/admin/work-lots/standardize-kk809',{token,method:'POST',body:{action:'preview',model:'CR4 125',code:'KK809'}});
 assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.summary.stateReferences,1);assert.equal(preview.data.summary.queuedReferences,1);assert.equal(preview.data.summary.workLotReferences,1);assert.equal(preview.data.summary.conflicts,0);
 const beforePreview=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'));assert.equal(beforePreview.tasks[0].lote,110,'la vista previa no modifica datos');
 const applied=await request(baseUrl,'/api/admin/work-lots/standardize-kk809',{token,method:'POST',body:{action:'apply',model:'CR4 125',code:'KK809'}});
 assert.equal(applied.status,200,JSON.stringify(applied.data));
 const after=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'));assert.equal(after.tasks[0].lote,270);assert.equal(after.tasks[0].cantidad,270);assert.equal(after.tasks[0].entregado,20);assert.deepEqual(after.tasks[0].entregas,[{cantidad:20,patinador:'Patinador Uno'}]);assert.equal(after.tasks[1].lote,100);assert.equal(after.tasks[2].lote,300);assert.equal(after.queuedStandardBatches[0].tasks[0].lote,270);assert.equal(after.queuedStandardBatches[1].tasks[0].lote,80);
 const lots=JSON.parse(fs.readFileSync(path.join(dataDir,'work-lots.json'),'utf8'));assert.equal(lots[0].tasks[0].lote,270);assert.equal(lots[0].tasks[0].entregado,5);assert.equal(lots[1].tasks[0].lote,70);assert.equal(lots[2].tasks[0].lote,300);
 const wrong=await request(baseUrl,'/api/admin/work-lots/standardize-kk809',{token,method:'POST',body:{action:'apply',model:'CHR',code:'KK809'}});assert.equal(wrong.status,400);
});
test('bloquea la corrección KK809 completa si alguna referencia supera 270 entregadas',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-kk809-conflict-'));const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));
 fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{admin:{pass:'AdminTest123',role:'Admin',name:'Administrador'}},tasks:[{id:'over',standardNKD:true,standardMoto:'CR4 125',codigoLoteOperacion:'KK809',lote:300,cantidad:300,entregado:275}],queuedStandardBatches:[]}));
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port;const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);
 const login=await request(baseUrl,'/api/login',{method:'POST',body:{username:'admin',password:'AdminTest123'}});assert.equal(login.status,200);
 const result=await request(baseUrl,'/api/admin/work-lots/standardize-kk809',{token:login.data.token,method:'POST',body:{action:'apply',model:'CR4 125',code:'KK809'}});
 assert.equal(result.status,409);assert.equal(result.data.summary.conflicts,1);
 const unchanged=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'));assert.equal(unchanged.tasks[0].lote,300);assert.equal(unchanged.tasks[0].entregado,275);
});


test('el endpoint de avance entrega solo el lote vigente por modelo y no altera el estado al consultar',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-progress-current-lots-'));const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));
 fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 const state={users:{
  admin:{pass:'AdminTest123',role:'Admin',name:'Administrador'},
  supervisor:{pass:'Supervisor123',role:'Supervisor',name:'Supervisor'},
  coordinator:{pass:'Coordinator123',role:'Coordinador',name:'Coordinador'},
  fredy:{pass:'FredyTest123',role:'Admin',name:'Fredy'},
  juanesteban:{pass:'RetiredTest123',role:'Patinador',name:'Usuario histórico'},
  patinadorNkd:{pass:'NkdTest123',role:'Patinador',name:'Patinador NKD'},
  patinadorChr:{pass:'ChrTest123',role:'Patinador',name:'Patinador CHR'},
  patinadorCr4:{pass:'Cr4Test123',role:'Patinador',name:'Patinador CR4'}
 },tasks:[
  {id:'nkd-active-1',standardNKD:true,standardMoto:'NKD',puesto:'PRE 1',cantidad:100,entregado:20},
  {id:'nkd-active-2',standardNKD:true,standardMoto:'NKD',puesto:'PRE 2',cantidad:100,entregado:0},
  {id:'chr-active-1',standardNKD:true,standardMoto:'CHR',puesto:'PRE 3',cantidad:80,entregado:10},
  {id:'cr4-active-1',standardNKD:true,standardMoto:'CR4 125',codigoLoteOperacion:'CR4-TODAY',puesto:'PRE 4',cantidad:100,entregado:25}
 ]};
 const workLots=[
  {id:'nkd-old',model:'NKD',number:11,codigoLoteOperacion:'NKD-OLD',tasks:[{id:'nkd-historic-1',cantidad:500}]},
  {id:'nkd-current',model:'NKD',number:12,codigoLoteOperacion:'NKD-CURRENT',tasks:[{id:'nkd-active-1',cantidad:100,entregado:20},{id:'nkd-active-2',cantidad:100,entregado:0}]},
  {id:'nkd-future-empty',model:'NKD',number:13,codigoLoteOperacion:'NKD-FUTURE',tasks:[{id:'nkd-not-active',cantidad:700}]},
  {id:'chr-current',model:'CHR',number:4,codigoLoteOperacion:'CHR-CURRENT',tasks:[{id:'chr-active-1',cantidad:80,entregado:10}]},
  {id:'cr4-historic',model:'CR4 125',number:90,codigoLoteOperacion:'CR4-HIST',tasks:[{id:'cr4-historic-1',cantidad:900}]},
  {id:'active-CR4 125',model:'CR4 125',number:91,codigoLoteOperacion:'CR4-TODAY',tasks:[{id:'cr4-active-1',cantidad:100,entregado:25}]},
  {id:'prepared-nkd',model:'NKD',number:14,codigoLoteOperacion:'NKD-PREP',tasks:[{id:'nkd-prepared',cantidad:200,entregado:0}]},
  {id:'completed-chr',model:'CHR',number:5,codigoLoteOperacion:'CHR-DONE',tasks:[{id:'chr-completed',cantidad:50,entregado:50}]},
  {id:'stale-xrs',model:'XRS-180',number:7,codigoLoteOperacion:'XRS-OLD',tasks:[{id:'xrs-stale',cantidad:100,entregado:30}]}
 ];
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify(state));
 fs.writeFileSync(path.join(dataDir,'work-lots.json'),JSON.stringify(workLots));
 fs.writeFileSync(path.join(dataDir,'work-lot-selections.json'),JSON.stringify({
  'patinadornkd|NKD':{lotId:'nkd-current',updatedAt:'2026-11-24T08:00:00.000Z',startedAt:'2026-11-24T08:00:00.000Z'},
  'patinadorchr|CHR':{lotId:'chr-current',updatedAt:'2026-11-24T08:05:00.000Z',startedAt:'2026-11-24T08:05:00.000Z'},
  'patinadorcr4|CR4 125':{lotId:'active-CR4 125',updatedAt:'2026-11-24T08:10:00.000Z',startedAt:'2026-11-24T08:10:00.000Z'},
  'juanesteban|NKD':{lotId:'prepared-nkd',updatedAt:'2026-11-24T08:11:00.000Z',startedAt:null},
  'juanesteban|CHR':{lotId:'completed-chr',updatedAt:'2026-11-24T08:12:00.000Z',startedAt:'2026-11-24T08:12:00.000Z'},
  'juanesteban|XRS-180':{lotId:'stale-xrs',updatedAt:'2026-11-24T08:13:00.000Z',startedAt:null}
 }));
  const port=await freePort(),baseUrl='http://127.0.0.1:'+port;const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);
 const tokens=[];
 for(const username of ['admin','supervisor','coordinator']){
  const password={admin:'AdminTest123',supervisor:'Supervisor123',coordinator:'Coordinator123'}[username];
  const login=await request(baseUrl,'/api/login',{method:'POST',body:{username,password}});
  assert.equal(login.status,200,JSON.stringify(login.data));tokens.push(login.data.token);
 }
 const before=fs.readFileSync(path.join(dataDir,'state.json'),'utf8');
 for(const token of tokens){
  const response=await request(baseUrl,'/api/admin/work-lots/progress',{token});
  assert.equal(response.status,200,JSON.stringify(response.data));
  assert.deepEqual(response.data.lots.map(x=>x.id).sort(),['active-CR4 125','chr-current','nkd-current']);
  assert.equal(response.data.lots.find(x=>x.model==='NKD').tasks.length,2);
  assert.equal(response.data.lots.find(x=>x.model==='CHR').tasks[0].id,'chr-active-1');
  const cr4=response.data.lots.find(x=>x.model==='CR4 125');assert.equal(cr4.codigoLoteOperacion,'CR4-TODAY');assert.equal(cr4.tasks.length,1);assert.equal(cr4.tasks[0].entregado,25);
 }
 assert.equal(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'),before,'el endpoint GET no debe borrar ni cambiar usuarios o datos después de iniciar sesión');
});


test('Patinadores abre el lote activo del modelo y no una selección histórica recordada',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-active-skater-lot-'));const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));
 fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 const activeTask={id:'cr4-today-1',standardNKD:true,standardMoto:'CR4 125',codigoLoteOperacion:'CR4-HOY',ean:'770000000125',producto:'Referencia CR4 125 de hoy',puesto:'PRE 1',cantidad:270,lote:270,entregado:35,entregas:[{id:'delivery-today',cantidad:35,patinador:'Patinador Uno'}],estado:'Parcial'};
 const historicTask={id:'cr4-historic-1',standardNKD:true,standardMoto:'CR4 125',codigoLoteOperacion:'CR4-ANTERIOR',ean:'770000000124',producto:'Referencia histórica',puesto:'PRE 1',cantidad:270,lote:270,entregado:120,entregas:[{id:'delivery-old',cantidad:120,patinador:'Patinador Uno'}],estado:'Parcial'};
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{patinador1:{pass:'TestDia123',role:'Patinador',name:'Patinador Uno',puestos:['PRE 1']}},tasks:[activeTask]}));
 fs.writeFileSync(path.join(dataDir,'work-lots.json'),JSON.stringify([{id:'cr4-historic-lot',model:'CR4 125',number:91,codigoLoteOperacion:'CR4-ANTERIOR',tasks:[historicTask]}]));
 fs.writeFileSync(path.join(dataDir,'work-lot-selections.json'),JSON.stringify({'patinador1|CR4 125':{lotId:'cr4-historic-lot',updatedAt:'2026-11-23T10:00:00.000Z'}}));
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port;const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);
 const login=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador1',password:'TestDia123'}});assert.equal(login.status,200);const token=login.data.token;
 const opened=await request(baseUrl,'/api/work-lots?model=CR4%20125&username=patinador1',{token});
 assert.equal(opened.status,200,JSON.stringify(opened.data));assert.equal(opened.data.lot.codigoLoteOperacion,'CR4-HOY');assert.equal(opened.data.tasks.length,1);assert.equal(opened.data.tasks[0].id,'cr4-today-1');assert.equal(opened.data.tasks[0].entregado,35);
 const rows=JSON.parse(fs.readFileSync(path.join(dataDir,'work-lots.json'),'utf8'));assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id==='cr4-historic-lot').tasks[0].entregado,120);assert.equal(rows.find(x=>x.id===opened.data.lot.id).number,92);
 const selection=JSON.parse(fs.readFileSync(path.join(dataDir,'work-lot-selections.json'),'utf8'));assert.equal(selection['patinador1|CR4 125'].lotId,opened.data.lot.id);
});
