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
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{patinador1:{passDia:'TestDia123',role:'Patinador',name:'Patinador Uno',puestos:['PRE 1']},patinador2:{passDia:'TestDia123',role:'Patinador',name:'Patinador Dos',puestos:['PRE 1']}},tasks:[{id:'CHR-1',standardNKD:true,standardMoto:'CHR',ean:'770000000001',producto:'Referencia CHR',puesto:'PRE 1',cantidad:85,lote:85,codigoLoteOperacion:'CODIGO-ANTERIOR',estado:'Pendiente',entregado:0,entregas:[],confirmacionesCanastas:[]}]}));
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port;const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);
 const login1=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador1',password:'TestDia123'}});assert.equal(login1.status,200);const token1=login1.data.token;
 const login2=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador2',password:'TestDia123'}});assert.equal(login2.status,200);const token2=login2.data.token;
 const initial=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador1',{token:token1});assert.equal(initial.status,200);assert.equal(initial.data.lot.codigoLoteOperacion,'');const first=initial.data.lot;
 const saved=await request(baseUrl,'/api/work-lots',{token:token1,method:'POST',body:{action:'set-code',username:'patinador1',model:'CHR',lotId:first.id,version:first.updatedAt,code:'KK764A'}});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.lot.codigoLoteOperacion,'KK764A');
 const visible=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador2',{token:token2});assert.equal(visible.status,200);assert.equal(visible.data.lot.codigoLoteOperacion,'KK764A');
 const next=await request(baseUrl,'/api/work-lots',{token:token1,method:'POST',body:{action:'next',username:'patinador1',model:'CHR',lotId:first.id}});assert.equal(next.status,200);assert.equal(next.data.lot.number,2);assert.equal(next.data.lot.codigoLoteOperacion,'');assert.equal(next.data.tasks[0].codigoLoteOperacion,undefined,'el código del lote anterior no debe copiarse a las tareas del siguiente lote');
 const back=await request(baseUrl,'/api/work-lots',{token:token1,method:'POST',body:{action:'select',username:'patinador1',model:'CHR',lotId:first.id}});assert.equal(back.status,200);assert.equal(back.data.lot.codigoLoteOperacion,'KK764A');
});