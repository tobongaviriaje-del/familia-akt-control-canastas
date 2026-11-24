'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const repoRoot=path.resolve(__dirname,'..');
async function freePort(){const probe=net.createServer();await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',resolve).once('error',reject));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
async function waitForHealth(url,child){const deadline=Date.now()+8000;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('El servidor de prueba terminó antes de iniciar.');try{if((await fetch(url+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('El servidor no respondió /health.');}
async function request(base,route,{token,method='GET',body}={}){const headers={};if(token)headers.Authorization='Bearer '+token;if(body!==undefined)headers['Content-Type']='application/json';const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data};}
test('diagnóstico NKD KK711 es Admin-only, limitado y no modifica work-lots.json',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-nkd-diagnostic-')),dataDir=path.join(temp,'data');
 fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{admin:{pass:'AdminDiagnostic123',role:'Admin'},supervisor:{pass:'SupervisorDiagnostic123',role:'Supervisor'},patinador:{pass:'PatinadorDiagnostic123',role:'Patinador'}},tasks:[]}));
 const lots=[{id:'lot-711',model:'NKD',number:7,codigoLoteOperacion:'KK711',tasks:[
  {id:'REF-1',puesto:'PRE 1',lote:100,cantidad:100,entregado:30,entregas:[{cantidad:20,canastasFisicas:1},{cantidad:10,canastasFisicas:0}],correcciones:[]},
  {id:'REF-2',puesto:'PRE 2',lote:50,cantidad:50,entregado:8,entregas:[{cantidad:10,canastasFisicas:0}],correcciones:[{unidades:2}]}
 ]}];
 const lotsPath=path.join(dataDir,'work-lots.json');fs.writeFileSync(lotsPath,JSON.stringify(lots,null,2));const before=fs.readFileSync(lotsPath,'utf8');
 const port=await freePort(),base='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(base,child);
 async function login(username,password){const result=await request(base,'/api/login',{method:'POST',body:{username,password}});assert.equal(result.status,200);return result.data.token;}
 const admin=await login('admin','AdminDiagnostic123'),supervisor=await login('supervisor','SupervisorDiagnostic123'),patinador=await login('patinador','PatinadorDiagnostic123');
 const route='/api/admin/work-lots/diagnostic?model=NKD&code=KK711';
 assert.equal((await request(base,route)).status,401);
 assert.equal((await request(base,route,{token:supervisor})).status,403);
 assert.equal((await request(base,route,{token:patinador})).status,403);
 assert.equal((await request(base,'/api/admin/work-lots/diagnostic?model=CHR&code=KK711',{token:admin})).status,400);
 const result=await request(base,route,{token:admin});
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.soloLectura,true);
 assert.equal(result.data.lot.references,2);
 assert.equal(result.data.totals.targetUnits,150);
 assert.equal(result.data.totals.deliveredUnits,38);
 assert.equal(result.data.totals.pendingUnits,112);
 assert.equal(result.data.totals.deliveryEvents,3);
 assert.equal(result.data.totals.deliveryEventUnits,40);
 assert.equal(result.data.totals.correctionUnits,2);
 assert.equal(result.data.totals.netEventUnits,38);
 assert.equal(result.data.totals.referenceMismatches,0);
 assert.equal(fs.readFileSync(lotsPath,'utf8'),before,'el diagnóstico no debe escribir ni alterar el archivo de lotes');
});
