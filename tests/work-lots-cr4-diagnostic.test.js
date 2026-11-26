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
test('diagnóstico CR4 150 KK848A es Admin-only, detecta duplicados y no modifica el lote',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-cr4-diagnostic-')),dataDir=path.join(temp,'data');
 fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{admin:{pass:'AdminDiagnostic123',role:'Admin'},supervisor:{pass:'SupervisorDiagnostic123',role:'Supervisor'}},tasks:[]}));
 const lot={id:'lot-848a',model:'CR4 150',number:12,codigoLoteOperacion:'KK848A',tasks:[
  {id:'REF-DUP',ean:'770000000001',puesto:'LADO IZQUIERDO',codigoLoteOperacion:'KK848A',cantidad:10,lote:10,entregado:4,entregas:[{cantidad:4}],correcciones:[]},
  {id:'REF-DUP',ean:'770000000002',puesto:'LADO DERECHO',codigoLoteOperacion:'KK848A',cantidad:20,lote:20,entregado:5,entregas:[{cantidad:5}],correcciones:[]},
  {id:'REF-FINAL',ean:'770000000001',puesto:'LADO IZQUIERDO',codigoLoteOperacion:'KK848A',cantidad:10,lote:10,entregado:0,entregas:[],correcciones:[]}
 ]};
 const lotsPath=path.join(dataDir,'work-lots.json');fs.writeFileSync(lotsPath,JSON.stringify([lot],null,2));const before=fs.readFileSync(lotsPath,'utf8');
 const port=await freePort(),base='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(base,child);
 async function login(username,password){const result=await request(base,'/api/login',{method:'POST',body:{username,password}});assert.equal(result.status,200);return result.data.token;}
 const admin=await login('admin','AdminDiagnostic123'),supervisor=await login('supervisor','SupervisorDiagnostic123');
 const route='/api/admin/work-lots/diagnostic-cr4?model=CR4%20150&code=KK848A';
 assert.equal((await request(base,route)).status,401);
 assert.equal((await request(base,route,{token:supervisor})).status,403);
 assert.equal((await request(base,'/api/admin/work-lots/diagnostic-cr4?model=NKD&code=KK711',{token:admin})).status,400);
 const result=await request(base,route,{token:admin});
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.soloLectura,true);
 assert.equal(result.data.lots.length,1);
 assert.equal(result.data.lots[0].totals.references,3);
 assert.equal(result.data.lots[0].totals.targetUnits,40);
 assert.equal(result.data.lots[0].totals.deliveredUnits,9);
 assert.equal(result.data.lots[0].duplicateIds.length,1);
 assert.equal(result.data.lots[0].duplicateIds[0].id,'REF-DUP');
 assert.equal(result.data.lots[0].duplicateReferenceKeys.length,1);
 assert.equal(result.data.lots[0].positions['LADO IZQUIERDO'].references,2);
 assert.equal(fs.readFileSync(lotsPath,'utf8'),before,'el diagnóstico no debe escribir ni alterar el archivo de lotes');
});
