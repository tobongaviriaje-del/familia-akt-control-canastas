const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');

const defaultUsers = {
  admin:{pass:'admin',role:'Admin',name:'Administrador'},
  mesanin:{pass:'mesanin123',role:'Mesanín',name:'Mesanín'},
  hamilton:{pass:'Hamilton123!',role:'Patinador',name:'Hamilton',areas:['PRE','Izquierdo'],puestos:['PRE 21','PRE 22','PRE 23','PRE 24','PRE 25','PRE 26','PRE 27','PRE 28','PRE 29','PRE 30','PRE 31','PRE 32','Izquierdo 1','Izquierdo 2','Izquierdo 3','Izquierdo 4','Izquierdo 5','Izquierdo 6','Izquierdo 7','Izquierdo 8','Izquierdo 9','Izquierdo 10']},
  juanesteban:{pass:'Juan123!',role:'Patinador',name:'Juan Esteban',areas:['PRE','Derecho'],puestos:['PRE 1','PRE 2','PRE 3','PRE 4','PRE 5','PRE 6','PRE 7','PRE 8','PRE 9','PRE 10','PRE 33','Derecho 1','Derecho 2','Derecho 3','Derecho 4','Derecho 5','Derecho 6','Derecho 7','Derecho 8','Derecho 9','Derecho 10']},
  jorge:{pass:'Jorge123!',role:'Patinador',name:'Jorge',areas:['PRE','Derecho','Izquierdo','Final de línea'],puestos:['PRE 11','PRE 12','PRE 13','PRE 14','PRE 15','PRE 16','PRE 17','PRE 18','PRE 19','PRE 20','Derecho 11','Derecho 12','Derecho 13','Derecho 14','Derecho 15','Derecho 16','Izquierdo 12','Izquierdo 13','Izquierdo 14','Izquierdo 15','Izquierdo 16','Final 1','Final 2','Final 3','Final 4','Final 5','Final 6','Final 7','Final 8','Final 9','Final 10','Final 11','Final 12','Final 13','Final 14','Final 15','Final 16','Final 17','Final 18','Final 19','Final 20']}
};

function ensureData(){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  if(!fs.existsSync(DATA_FILE)){
    fs.writeFileSync(DATA_FILE, JSON.stringify({users:defaultUsers,tasks:[]}, null, 2));
  }
}
function readState(){
  ensureData();
  try{
    const s=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
    return {users:s.users||defaultUsers,tasks:Array.isArray(s.tasks)?s.tasks:[]};
  }catch{
    return {users:defaultUsers,tasks:[]};
  }
}
function writeState(s){
  ensureData();
  const tmp=DATA_FILE+'.tmp';
  fs.writeFileSync(tmp, JSON.stringify({users:s.users||{},tasks:Array.isArray(s.tasks)?s.tasks:[]}, null, 2));
  fs.renameSync(tmp,DATA_FILE);
}
function json(res,code,obj){
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify(obj));
}
function serve(res,reqPath){
  let p=decodeURIComponent(reqPath.split('?')[0]);
  if(p==='/')p='/index.html';
  const file=path.normalize(path.join(ROOT,p));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
  const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
}
function body(req){
  return new Promise((resolve,reject)=>{
    let b=''; req.on('data',c=>{b+=c;if(b.length>5e6)req.destroy();});
    req.on('end',()=>{try{resolve(JSON.parse(b||'{}'));}catch(e){reject(e);}});
    req.on('error',reject);
  });
}

ensureData();

http.createServer(async (req,res)=>{
  if(req.method==='OPTIONS'){
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
    return res.end();
  }
  if(req.url.split('?')[0]==='/api/state'){
    if(req.method==='GET') return json(res,200,readState());
    if(req.method==='PUT'){
      try{
        const incoming=await body(req);
        const old=readState();
        const users=(incoming.users && typeof incoming.users==='object')?incoming.users:old.users;
        const tasks=Array.isArray(incoming.tasks)?incoming.tasks:old.tasks;
        writeState({users,tasks});
        return json(res,200,readState());
      }catch(e){return json(res,400,{error:'Datos inválidos'});}
    }
    return json(res,405,{error:'Método no permitido'});
  }
  serve(res,req.url);
}).listen(PORT,()=>console.log('Familia AKT funcionando en http://localhost:'+PORT));
