/* Mejoras de uso para el panel de Patinadores. No modifica tareas, fotos ni entregas por sí solo. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 let searchText='',filterMode='pending',observer=null,refreshQueued=false;
 const labels=['Referencia / EAN','Puesto','Cant. unitaria','Estándar de canasta','Lote total','Entregadas','Pendientes','Registrar unidades','Canastas entregadas','Corregir saldo'];
 function addStyles(){
  if($('patinadorUxStyles'))return;
  const style=document.createElement('style');style.id='patinadorUxStyles';
  style.textContent=`
   #patinadorQuickTools{position:sticky;top:6px;z-index:5;background:#fff;border:1px solid #bfdbfe;border-radius:14px;padding:12px;margin:12px 0;box-shadow:0 5px 18px #0f172a12}
   #patinadorQuickTools .pu-title{font-weight:800;font-size:16px;margin-bottom:8px}
   #patinadorQuickTools .pu-controls{display:grid;grid-template-columns:minmax(0,2fr) minmax(140px,1fr);gap:8px}
   #patinadorQuickTools input,#patinadorQuickTools select{margin:0;min-height:44px}
   #patinadorQuickTools .pu-count{font-size:13px;color:#475569;margin-top:8px}
   #standardItems .pu-qty-shortcuts{display:flex;gap:5px;flex-wrap:wrap;margin:5px 0 8px}
   #standardItems .pu-qty-shortcuts button{width:auto;min-width:48px;min-height:36px;padding:6px 10px;margin:0;font-size:13px}
   #standardItems .pu-qty-shortcuts button:last-child{background:#0f766e}
   #standardItems tr.pu-hidden{display:none!important}
   @media(max-width:640px){
    #patinadorQuickTools{top:2px;padding:10px}
    #patinadorQuickTools .pu-controls{grid-template-columns:1fr}
    #standardItems .scroll{overflow:visible}
    #standardItems .scroll table,#standardItems .scroll tbody{display:block;width:100%;min-width:0}
    #standardItems .scroll thead{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    #standardItems .scroll tbody tr{display:block;background:#fff!important;border:1px solid #cbd5e1;border-radius:14px;margin:12px 0;padding:8px;box-shadow:0 2px 8px #0f172a0d}
    #standardItems .scroll tbody td{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 6px;border-bottom:1px solid #e2e8f0;text-align:right;min-width:0}
    #standardItems .scroll tbody td:first-child{display:block;text-align:left;padding:8px 4px}
    #standardItems .scroll tbody td:last-child{border-bottom:0}
    #standardItems .scroll tbody td:not(:first-child):before{content:attr(data-label);font-size:12px;font-weight:700;color:#475569;text-align:left;flex:0 0 42%;max-width:42%}
    #standardItems .scroll tbody td>*{max-width:58%}
    #standardItems .scroll tbody td .pu-qty-shortcuts{max-width:100%;justify-content:flex-end}
    #standardItems .scroll tbody td button{min-height:40px}
   }
  `;
  document.head.appendChild(style);
 }
 function installToolbar(){
  const list=$('standardItems');if(!list||$('patinadorQuickTools'))return;
  const tools=document.createElement('section');tools.id='patinadorQuickTools';tools.setAttribute('aria-label','Buscar y filtrar mis referencias');
  tools.innerHTML='<div class="pu-title">🔎 Encuentra tu referencia rápido</div><div class="pu-controls"><input id="puSearch" type="search" autocomplete="off" placeholder="Buscar producto, EAN o puesto…"><select id="puFilter" aria-label="Filtrar referencias"><option value="pending">Solo pendientes</option><option value="all">Todas las referencias</option><option value="done">Completadas</option></select></div><div id="puCount" class="pu-count" aria-live="polite"></div>';
  list.parentNode.insertBefore(tools,list);
  $('puSearch').value=searchText;
  $('puFilter').value=filterMode;
  $('puSearch').addEventListener('input',()=>{searchText=$('puSearch').value.trim().toLocaleLowerCase('es');applyFilters();});
  $('puFilter').addEventListener('change',()=>{filterMode=$('puFilter').value;applyFilters();});
 }
 function addRowShortcuts(row){
  if(row.dataset.puEnhanced==='1')return;
  row.querySelectorAll('td').forEach((td,i)=>{td.dataset.label=labels[i]||'Dato';});
  const input=row.querySelector('input[id^="stdQty"]');
  if(!input){row.dataset.puEnhanced='1';return;}
  const max=Math.max(0,Number(input.max)||0);
  if(max<1){row.dataset.puEnhanced='1';return;}
  const wrap=document.createElement('div');wrap.className='pu-qty-shortcuts';wrap.setAttribute('aria-label','Cantidades rápidas');
  const values=[{label:'+1',value:1},{label:'+5',value:Math.min(5,max)},{label:'Todo',value:max}];
  values.forEach(item=>{
   const b=document.createElement('button');b.type='button';b.className=item.label==='Todo'?'':'secondary';b.textContent=item.label;b.title='Preparar '+item.value+' unidad(es); después confirma Registrar unidades';
   b.addEventListener('click',()=>{input.value=String(item.value);input.focus({preventScroll:true});});
   wrap.appendChild(b);
  });
  input.insertAdjacentElement('afterend',wrap);
  row.querySelectorAll('td').forEach((td,i)=>{td.dataset.label=labels[i]||'Dato';});
  row.dataset.puEnhanced='1';
 }
 function applyFilters(){
  const list=$('standardItems');if(!list)return;
  const rows=[...list.querySelectorAll('tbody tr[id^="stdRow"]')];
  let shown=0,pending=0,done=0;
  rows.forEach(row=>{
   addRowShortcuts(row);
   const first=(row.cells[0]?.textContent||'').toLocaleUpperCase('es');
   const isDone=first.includes('COMPLETA')||first.includes('LOTE AGOTADO');
   if(isDone)done++;else pending++;
   const matchesText=!searchText||row.textContent.toLocaleLowerCase('es').includes(searchText);
   const matchesStatus=filterMode==='all'||(filterMode==='done'?isDone:!isDone);
   const visible=matchesText&&matchesStatus;
   row.classList.toggle('pu-hidden',!visible);
   if(visible)shown++;
  });
  const count=$('puCount');
  if(count)count.textContent=shown+' de '+rows.length+' referencias visibles · '+pending+' pendientes · '+done+' completadas';
  let empty=$('puNoResults');
  if(!empty){empty=document.createElement('p');empty.id='puNoResults';empty.className='notice';list.appendChild(empty);}
  empty.textContent=rows.length&&shown===0?'No encontramos referencias con esa búsqueda. Prueba otro EAN, nombre o puesto.':'';
  empty.style.display=rows.length&&shown===0?'block':'none';
 }
 function scheduleRefresh(){
  if(refreshQueued)return;refreshQueued=true;
  requestAnimationFrame(()=>{refreshQueued=false;const panel=$('patinadorPanel');if(!panel||panel.classList.contains('hidden'))return;installToolbar();applyFilters();});
 }
 function start(){
  addStyles();
  const list=$('standardItems');if(!list)return;
  installToolbar();applyFilters();
  observer=new MutationObserver(scheduleRefresh);
  observer.observe(list,{childList:true,subtree:true});
  const panel=$('patinadorPanel');
  if(panel)new MutationObserver(scheduleRefresh).observe(panel,{attributes:true,attributeFilter:['class']});
  document.addEventListener('change',e=>{if(e.target&&e.target.id==='modeloEstandarPatinador'){searchText='';filterMode='pending';scheduleRefresh();}});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,0));else setTimeout(start,0);
})();
