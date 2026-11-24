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
 const port=probe.address().port;
 await new Promise(resolve=>probe.close(resolve));
 return port;
}
async function waitForHealth(url,child){
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw new Error('El servidor terminó antes de iniciar.');
  try{if((await fetch(url+'/health')).ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error('El servidor no respondió /health.');
}
async function request(baseUrl,route,{token,method='GET',body}={}){
 const headers={};if(token)headers.Authorization='Bearer '+token;
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(baseUrl+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,data};
}
test('recuerda el lote seleccionado por patinador y modelo después de iniciar sesión de nuevo',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-work-lot-selection-'));
 const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));
 fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 const state={users:{
  patinador1:{pass:'Patinador123',role:'Patinador',name:'Patinador Uno',puestos:['PRE 1']},
  patinador2:{pass:'Patinador456',role:'Patinador',name:'Patinador Dos',puestos:['PRE 1']}
 },tasks:[
  {id:'chr-active',standardNKD:true,standardMoto:'CHR',puesto:'PRE 1',cantidad:80,entregado:0},
  {id:'cr4-active',standardNKD:true,standardMoto:'CR4 125',puesto:'PRE 1',cantidad:90,entregado:0}
 ]};
 const lots=[
  {id:'chr-lot-1',model:'CHR',number:1,tasks:[{id:'chr-1-ref',puesto:'PRE 1',cantidad:80,entregado:10,entregas:[]}]},
  {id:'chr-lot-2',model:'CHR',number:2,tasks:[{id:'chr-2-ref',puesto:'PRE 1',cantidad:80,entregado:20,entregas:[]}]},
  {id:'cr4-lot-1',model:'CR4 125',number:1,tasks:[{id:'cr4-1-ref',puesto:'PRE 1',cantidad:90,entregado:5,entregas:[]}]},
  {id:'cr4-lot-2',model:'CR4 125',number:2,tasks:[{id:'cr4-2-ref',puesto:'PRE 1',cantidad:90,entregado:15,entregas:[]}]}
 ];
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify(state));
 fs.writeFileSync(path.join(dataDir,'work-lots.json'),JSON.stringify(lots));
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});
  fs.rmSync(temp,{recursive:true,force:true});
 });
 await waitForHealth(baseUrl,child);
 const login=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador1',password:'Patinador123'}});
 assert.equal(login.status,200,JSON.stringify(login.data));
 const token=login.data.token;
 const initial=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador1',{token});
 assert.equal(initial.status,200,JSON.stringify(initial.data));
 assert.equal(initial.data.lot.id,'chr-lot-2','sin selección previa debe abrir el lote vigente de mayor número');
 const selected=await request(baseUrl,'/api/work-lots',{token,method:'POST',body:{action:'select',username:'patinador1',model:'CHR',lotId:'chr-lot-1'}});
 assert.equal(selected.status,200,JSON.stringify(selected.data));
 assert.equal(selected.data.lot.id,'chr-lot-1');
 const secondLogin=await request(baseUrl,'/api/login',{method:'POST',body:{username:'patinador1',password:'Patinador123'}});
 assert.equal(secondLogin.status,200);
 const resumed=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador1',{token:secondLogin.data.token});
 assert.equal(resumed.status,200,JSON.stringify(resumed.data));
 assert.equal(resumed.data.lot.id,'chr-lot-1','debe recuperar el lote que el patinador eligió antes de salir');
 assert.equal(resumed.data.tasks[0].entregado,10,'la selección no debe reiniciar ni alterar entregas');
 const otherModel=await request(baseUrl,'/api/work-lots?model=CR4%20125&username=patinador1',{token:secondLogin.data.token});
 assert.equal(otherModel.status,200,JSON.stringify(otherModel.data));
 assert.equal(otherModel.data.lot.id,'cr4-lot-2','la selección de CHR no debe contaminar la selección de otro modelo');
 const otherSkater=await request(baseUrl,'/api/work-lots?model=CHR&username=patinador2',{token:secondLogin.data.token});
 assert.equal(otherSkater.status,200,JSON.stringify(otherSkater.data));
 assert.equal(otherSkater.data.lot.id,'chr-lot-2','cada patinador debe tener su propia selección');
 const persisted=JSON.parse(fs.readFileSync(path.join(dataDir,'work-lot-selections.json'),'utf8'));
 assert.equal(persisted['patinador1|CHR'].lotId,'chr-lot-1');
 assert.equal(persisted['patinador1|CR4 125'].lotId,'cr4-lot-2');
});
