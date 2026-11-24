'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const repoRoot=path.resolve(__dirname,'..');
async function freePort(){
 const probe=net.createServer();
 await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',resolve).once('error',reject));
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;
}
async function waitForHealth(url,child){
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('El servidor terminó antes de iniciar.');try{if((await fetch(url+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error('El servidor no respondió /health.');
}
async function request(baseUrl,route,{token,method='GET',body}={}){
 const headers={};if(token)headers.Authorization='Bearer '+token;if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(baseUrl+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
}
test('Patinadores solo reciben lotes trabajados hoy, el seleccionado y el siguiente',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-work-lot-visibility-'));
 const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));
 fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 fs.copyFileSync(path.join(repoRoot,'public/icon.svg'),path.join(temp,'public/icon.svg'));
 const now=new Date().toISOString(),old='2024-01-15T12:00:00-05:00';
 const state={users:{patinador1:{pass:'Patinador123',role:'Patinador',name:'Patinador Uno',puestos:['PRE 1']}},tasks:[{id:'active',standardNKD:true,standardMoto:'CHR',puesto:'PRE 1',cantidad:80,entregado:12}]};
 const lots=[
  {id:'chr-old-1',model:'CHR',number:1,updatedAt:old,tasks:[{id:'old1',puesto:'PRE 1',cantidad:80,entregado:0}]},
  {id:'chr-today-2',model:'CHR',number:2,updatedAt:now,tasks:[{id:'today2',puesto:'PRE 1',cantidad:80,entregado:10}]},
  {id:'chr-today-3',model:'CHR',number:3,updatedAt:now,tasks:[{id:'today3',puesto:'PRE 1',cantidad:80,entregado:20}]},
  {id:'chr-next-4',model:'CHR',number:4,updatedAt:old,tasks:[{id:'next4',puesto:'PRE 1',cantidad:80,entregado:0}]},
  {id:'chr-old-5',model:'CHR',number:5,updatedAt:old,tasks:[{id:'old5',puesto:'PRE 1',cantidad:80,entregado:0}]}
 ];
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify(state));
 fs.writeFileSync(path.join(dataDir,'work-lots.json'),JSON.stringify(lots));
 fs.writeFileSync(path.join(dataDir,'work-lot-selections.json'),JSON.stringify({'patinador1|CHR':{lotId:'chr-today-3'}}));
 const beforeState=fs.readFileSync(path.join(dataDir,'state.json'),'utf8'),beforeLots=fs.readFileSync(path.join(dataDir,'work-lots.json'),'utf8');
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);
 const login=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador1',password:'Patinador123'}});
 assert.equal(login.status,200,JSON.stringify(login.data));
 const result=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador1',{token:login.data.token});
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.lot.id,'chr-today-3');
 assert.deepEqual(result.data.lots.map(x=>x.id),['chr-today-2','chr-today-3','chr-next-4']);
 const favicon=await request(baseUrl,'/favicon.ico');
 assert.equal(favicon.status,200,'el navegador debe recibir el icono y no un 404');
 assert.match(favicon.data,/svg/i);
 assert.equal(fs.readFileSync(path.join(dataDir,'state.json'),'utf8'),beforeState,'consultar lotes visibles no debe cambiar el estado productivo');
 assert.equal(fs.readFileSync(path.join(dataDir,'work-lots.json'),'utf8'),beforeLots,'ocultar lotes antiguos no debe borrar ni reescribir históricos');
});
