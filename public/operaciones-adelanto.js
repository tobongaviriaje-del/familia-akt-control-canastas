/* Operaciones de adelanto para estándares de motos. Los registros se guardan en las tareas compartidas. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const models=['NKD','CR4 150','CR4 125','VOGI 180','VOGE 180','CH'];
let mounted=false;
function operations(){return (typeof getTasks==='function'?getTasks():[]).filter(t=>t.advanceOperation===true);}
function isAdmin(){return typeof current!=='undefined'&&current&&current.role==='Admin';}
function isPatinador(){return typeof current!=='undefined'&&current&&current.role==='Patinador';}
function assigned(t){return isPatinador()&&Array.isArray(current.puestos)&&current.puestos.includes(t.puesto);}
function status(t){const goal=Number(t.cantidad)||0,done=Number(t.entregado)||0;return goal>0&&done>=goal?'Completada':done>0?'En curso':'Pendiente';}
function addStyles(){if($('advanceOpsStyles'))return;const s=document.createElement('style');s.id='advanceOpsStyles';s.textContent='.adv-op{border:1px solid #cbd5e1;border-radius:12px;padding:12px;margin:10px 0;background:#fff}.adv-op small{color:#64748b}.adv-op-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.adv-op-grid label{margin:0}.adv-op-actions{display:flex;gap:8px;flex-wrap:wrap}.adv-op-actions button{flex:1;min-width:130px}.adv-tag{display:inline-block;border-radius:20px;padding:4px 9px;background:#e0f2fe;color:#075985;font-size:12px;font-weight:bold}.adv-status{font-weight:bold;color:#0f766e}';document.head.appendChild(s);}
function mount(){
 if(mounted)return;
 const admin=$('adminPanel'),pat=$('patinadorPanel');
 if(admin){const panel=document.createElement('div');panel.className='card';panel.id='advanceAdminPanel';panel.innerHTML='<h3>🏍️ Operaciones para adelantar</h3><p class="muted">El administrador puede preparar varias tareas. Usa cualquier código de lote u operación; no hay códigos fijos.</p><div class="adv-op-grid"><label>Modelo de moto<select id="advModel">'+models.map(m=>'<option>'+m+'</option>').join('')+'</select></label><label>Lote / código de operación<input id="advCode" placeholder="Ej. KK344, KK675 o el código que corresponda"></label><label>Nombre de la tarea o referencia<input id="advName" placeholder="Descripción de la pieza o trabajo"></label><label>Cantidad total de unidades<input id="advQty" type="number" min="1" step="1" value="1"></label><label>Puesto asignado<input id="advPost" placeholder="Ej. PRE 12, Derecho, Izquierdo"></label><label>Área<select id="advArea"><option>PRE</option><option>Derecho</option><option>Izquierdo</option><option>Final de línea</option></select></label><label>Turno<select id="advShift"><option>Todos</option><option>Día</option><option>Noche</option></select></label></div><button type="button" id="advCreate" style="margin-top:12px">➕ Agregar tarea de operación</button><p id="advCreateMsg" class="muted">Puedes repetir el proceso para preparar todas las tareas necesarias.</p><div id="advAdminList"></div>';const taskActions=admin.querySelector('button[onclick="abrirCrearTareaAdmin()"]');const actionsGrid=taskActions?.closest('.grid');if(actionsGrid)actionsGrid.insertAdjacentElement('afterend',panel);else admin.appendChild(panel);}
 if(pat){const panel=document.createElement('div');panel.className='card';panel.id='advancePatinadorPanel';panel.innerHTML='<h2>🔄 Operaciones para adelantar</h2><p class="muted">Aquí aparecen las tareas que el administrador preparó para tus puestos. Puedes iniciar una operación y registrar sus entregas.</p><div id="advPatinadorList"></div>';pat.insertBefore(panel,pat.firstChild);}
 const app=$('appView');if(app){const panel=document.createElement('div');panel.className='card hidden';panel.id='advanceSupervisorPanel';panel.innerHTML='<h2>👀 Seguimiento de operaciones</h2><p class="muted">Estado de las operaciones preparadas y avance registrado por los patinadores.</p><div id="advSupervisorList"></div>';const summary=$('mesaninEntregas');if(summary)summary.parentNode.insertBefore(panel,summary);else app.appendChild(panel);}
 $('advCreate')?.addEventListener('click',createOperation);
 mounted=true;renderPanels();
}
async function saveTasks(tasks){
 const r=await apiFetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({users,tasks,lpnCatalog}),cache:'no-store'});
 const s=await r.json().catch(()=>({}));
 if(!r.ok||!Array.isArray(s.tasks))throw new Error(s.error||'No se pudo guardar en la nube.');
 cloudTasks=s.tasks;if(s.users)users=s.users;if(Array.isArray(s.lpnCatalog))lpnCatalog=s.lpnCatalog;
 localStorage.setItem('cc_tasks',JSON.stringify(cloudTasks));localStorage.setItem('cc_users',JSON.stringify(users));localStorage.setItem('cc_lpn_catalog',JSON.stringify(lpnCatalog));cloudReady=true;
}
async function createOperation(){
 if(!isAdmin()){alert('Solo el administrador puede crear estas tareas.');return;}
 const code=$('advCode').value.trim(),name=$('advName').value.trim(),qty=Number($('advQty').value),post=$('advPost').value.trim(),model=$('advModel').value,area=$('advArea').value,shift=$('advShift').value;
 const msg=$('advCreateMsg');
 if(!code||!name||!post||!Number.isInteger(qty)||qty<1){msg.className='error';msg.textContent='Completa código, descripción, cantidad y puesto.';return;}
 const tasks=(typeof getTasks==='function'?getTasks():[]).slice();
 const id='ADV-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
 tasks.push({id,lpn:'OPERACION-'+code,estiba:code,ean:'',producto:name,cantidad:qty,area,puesto:post,turno:shift,estado:'Pendiente',entregado:0,entregas:[],advanceOperation:true,operationCode:code,standardMoto:model,operationStartedBy:'',operationStartedAt:'',creadoPor:current.name||current.username||'Administrador'});
 try{await saveTasks(tasks);msg.className='muted';msg.textContent='✅ Tarea agregada. Puedes cargar otra con el mismo código o con uno diferente.';$('advName').value='';$('advQty').value='1';renderPanels();if(typeof render==='function')render();}
 catch(e){msg.className='error';msg.textContent='No se guardó la tarea: '+(e.message||'revisa la conexión');}
}
async function startOperation(id){
 const tasks=(typeof getTasks==='function'?getTasks():[]).map(t=>({...t}));
 const t=tasks.find(x=>String(x.id)===String(id));if(!t)return;
 if(!isPatinador()||!assigned(t)){alert('Esta operación no está asignada a tu puesto.');return;}
 if(status(t)==='Completada')return;
 if(t.operationStartedBy&&t.operationStartedBy!==current.name&&!confirm('Esta operación ya fue iniciada por '+t.operationStartedBy+'. ¿Deseas continuarla?'))return;
 t.operationStartedBy=t.operationStartedBy||current.name||current.username;
 t.operationStartedAt=t.operationStartedAt||new Date().toLocaleString('es-CO');
 try{await saveTasks(tasks);renderPanels();if(typeof render==='function')render();}
 catch(e){alert('No se pudo iniciar la operación: '+(e.message||'revisa la conexión'));}
}
function card(t,canWork){
 const done=Number(t.entregado)||0,goal=Number(t.cantidad)||0,left=Math.max(0,goal-done),st=status(t);
 return '<div class="adv-op"><div><span class="adv-tag">'+esc(t.standardMoto||'Moto')+'</span> <span class="adv-tag">Operación: '+esc(t.operationCode||'—')+'</span></div><h3>'+esc(t.producto||'Tarea')+'</h3><p><b>Puesto:</b> '+esc(t.puesto)+' · <b>Turno:</b> '+esc(t.turno||'Todos')+'</p><p><b>Avance:</b> '+done+' / '+goal+' unidades · <span class="adv-status">'+st+'</span></p><p><b>Faltan:</b> '+left+' · <small>Iniciada por: '+esc(t.operationStartedBy||'Aún no iniciada')+'</small></p>'+((t.entregas||[]).length?'<small>Última entrega: '+esc(t.entregas[t.entregas.length-1].patinador||'')+' · '+esc(t.entregas[t.entregas.length-1].fechaHora||'')+'</small>':'')+(canWork&&left>0?'<div class="adv-op-actions"><button type="button" class="secondary" data-start="'+esc(t.id)+'">'+(t.operationStartedBy?'Continuar operación':'▶ Iniciar operación')+'</button><input type="number" min="1" max="'+left+'" value="1" id="advQty-'+esc(t.id)+'" aria-label="Unidades a entregar" style="max-width:110px"><button type="button" data-deliver="'+esc(t.id)+'">🚚 Registrar entrega</button></div>':'')+'</div>';
}
function renderPanels(){
 const all=operations();
 const adminPanel=$('advanceAdminPanel');if(adminPanel)adminPanel.classList.toggle('hidden',!isAdmin());
 const adminList=$('advAdminList');
 if(adminList){adminList.innerHTML='<h3>Operaciones preparadas ('+all.length+')</h3>'+(all.length?all.map(t=>card(t,false)).join(''):'<p class="muted">Todavía no hay tareas de adelanto creadas.</p>');}
 const patList=$('advPatinadorList');
 if(patList){const mine=all.filter(assigned);patList.innerHTML=mine.length?mine.map(t=>card(t,true)).join(''):'<p class="muted">No tienes operaciones de adelanto asignadas a tus puestos por ahora.</p>';}
 const sup=$('advanceSupervisorPanel'),supList=$('advSupervisorList');if(sup&&supList){const visible=typeof current!=='undefined'&&current&&['Supervisor','Mesanín'].includes(current.role);sup.classList.toggle('hidden',!visible);supList.innerHTML=all.length?all.map(t=>card(t,false)).join(''):'<p class="muted">Todavía no hay operaciones preparadas.</p>';}
}
document.addEventListener('click',async e=>{
 const start=e.target.closest('[data-start]');if(start){await startOperation(start.getAttribute('data-start'));return;}
 const deliver=e.target.closest('[data-deliver]');if(deliver){const id=deliver.getAttribute('data-deliver'),t=operations().find(x=>String(x.id)===String(id));if(!t||!assigned(t)){alert('Esta tarea no está asignada a tu puesto.');return;}const qty=Number($('advQty-'+id)?.value),left=Math.max(0,Number(t.cantidad||0)-Number(t.entregado||0));if(!Number.isInteger(qty)||qty<1||qty>left){alert('Ingresa una cantidad válida. Quedan '+left+' unidades.');return;}if(!t.operationStartedBy){await startOperation(id);}if(typeof window.confirmarEntrega==='function')await window.confirmarEntrega(id,qty,'Entrega de operación '+t.operationCode);renderPanels();}
});
function wrapRender(){if(typeof render!=='function'||render.__advanceWrapped)return;const original=render;const wrapped=function(){const v=original.apply(this,arguments);try{renderPanels();}catch(e){}return v;};wrapped.__advanceWrapped=true;render=wrapped;}
function boot(){addStyles();mount();wrapRender();renderPanels();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0));else setTimeout(boot,0);
})();
