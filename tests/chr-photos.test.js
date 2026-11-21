'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const repoRoot=path.resolve(__dirname,'..');
async function freePort(){const probe=net.createServer();await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',resolve).once('error',reject));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
async function waitForHealth(url,child){const deadline=Date.now()+8000;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('El servidor terminó antes de iniciar.');try{if((await fetch(url+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('El servidor no respondió /health.');}
function webp(seed){const data=Buffer.alloc(20);data.write('RIFF',0,'ascii');data.writeUInt32LE(12,4);data.write('WEBP',8,'ascii');data.write('VP8 ',12,'ascii');data.writeUInt32LE(seed,16);return data;}
function zipStore(entries){const locals=[],centrals=[];let offset=0;for(const [name,value] of entries){const nameBytes=Buffer.from(name),data=Buffer.from(value),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);local.writeUInt32LE(0,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(nameBytes.length,26);local.writeUInt16LE(0,28);locals.push(local,nameBytes,data);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0,8);central.writeUInt16LE(0,10);central.writeUInt32LE(0,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt32LE(offset,42);centrals.push(central,nameBytes);offset+=local.length+nameBytes.length+data.length;}const centralBytes=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,centralBytes,end]);}
test('CHR conserva las 85 referencias y sus fotos, incluso con EAN 0 repetido en un puesto',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'akt-chr-photos-'));const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(path.join(temp,'public'));fs.copyFileSync(path.join(repoRoot,'server.js'),path.join(temp,'server.js'));
 fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({users:{admin:{pass:'AdminTest123',role:'Admin',name:'Admin de prueba'}},tasks:[]}));
 const port=await freePort(),baseUrl='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});fs.rmSync(temp,{recursive:true,force:true});});
 await waitForHealth(baseUrl,child);const login=await fetch(baseUrl+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'AdminTest123'})});assert.equal(login.status,200);const {token}=await login.json();
 const items={},entries=[['manifest.json',null]];for(let n=1;n<=85;n++){const ean=n<=4?'0':String(7700000000000+n),puesto=n<=4?'18 Derecho':'PRE '+Math.ceil(n/5),data=webp(n),file=crypto.createHash('sha1').update(data).digest('hex')+'.webp';items['sheet|'+n+'|'+puesto]={numeroReferencia:String(n),ean,puesto,photos:[{file}]};entries.push(['fotos/'+file,data]);}
 const manifest={modelo:'CHR',reemplazar_asociaciones:true,items};entries[0][1]=Buffer.from(JSON.stringify(manifest));const zip=zipStore(entries);
 const uploaded=await fetch(baseUrl+'/api/admin/reference-photos/chr',{method:'POST',headers:{Authorization:'Bearer '+token},body:zip});const result=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(result));assert.equal(result.referencias,85);assert.equal(result.fotos,85);assert.equal(result.asociaciones,85);
 const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'reference-photos','chr','manifest.json'),'utf8'));assert.equal(Object.keys(saved.items).length,85);assert.equal(Object.values(saved.items).filter(x=>x.ean==='0').length,4);assert.equal(Object.values(saved.items).filter(x=>x.ean==='0'&&x.puesto==='18 Derecho').length,4);
});