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
   #puJourney{border:1px solid #bfdbfe;border-radius:16px;padding:14px;margin:10px 0 14px;background:linear-gradient(135deg,#eff6ff,#fff)}
   #puJourney .puj-head{display:flex;justify-content:space-between;align-items:center;gap:10px;font-weight:800}
   #puJourney .puj-pct{font-size:25px;font-weight:900;color:#075985;white-space:nowrap}
   #puJourney .puj-track{height:10px;background:#dbeafe;border-radius:99px;overflow:hidden;margin:10px 0}
   #puJourney .puj-fill{height:100%;background:#0f766e;border-radius:99px;transition:width .2s}
   #puJourney .puj-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}
   #puJourney .puj-stat{background:#ffffffd9;border:1px solid #dbeafe;border-radius:10px;padding:8px;text-align:center}
   #puJourney .puj-stat b{display:block;font-size:18px}
   #puJourney .puj-stat small{font-size:11px;color:#475569}
   #puJourney .puj-next{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px}
   #puJourney button{width:auto;min-height:40px;margin:0;padding:8px 12px}
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
  installJourneyCard(list);
  $('puSearch').value=searchText;
  $('puFilter').value=filterMode;
  $('puSearch').addEventListener('input',()=>{searchText=$('puSearch').value.trim().toLocaleLowerCase('es');applyFilters();});
  $('puFilter').addEventListener('change',()=>{filterMode=$('puFilter').value;applyFilters();});
 }
 function installJourneyCard(list){
  if($('puJourney'))return;
  const card=document.createElement('section');card.id='puJourney';card.setAttribute('aria-label','Mi avance de trabajo');
  card.innerHTML='<div class="puj-head"><span>⚡ Mi jornada</span><span class="puj-pct" id="pujPct">0%</span></div><div class="puj-track" role="progressbar" aria-label="Avance de referencias" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="puj-fill" id="pujFill" style="width:0%"></div></div><div class="puj-stats"><div class="puj-stat"><b id="pujDone">0</b><small>Completadas</small></div><div class="puj-stat"><b id="pujPending">0</b><small>Pendientes</small></div><div class="puj-stat"><b id="pujUnits">0</b><small>Unidades faltantes</small></div></div><div class="puj-next"><span id="pujNextText">Cargando tu siguiente referencia…</span><button type="button" id="pujNextBtn">▶ Ir a la siguiente</button></div>';
  const toolbar=$('patinadorQuickTools');if(toolbar)toolbar.insertAdjacentElement('afterend',card);else list.parentNode.insertBefore(card,list);
  $('pujNextBtn').addEventListener('click',()=>{
   const rows=[...list.querySelectorAll('tbody tr[id^="stdRow"]')],next=rows.find(row=>!isCompletedRow(row));
   if(!next)return;
   searchText='';filterMode='pending';
   if($('puSearch'))$('puSearch').value='';
   if($('puFilter'))$('puFilter').value='pending';
   applyFilters();
   next.scrollIntoView({behavior:'smooth',block:'center'});
   const qty=next.querySelector('input[id^="stdQty"]');if(qty){qty.focus({preventScroll:true});qty.select?.();}
  });
 }
 function isCompletedRow(row){
  const text=(row.cells[0]?.textContent||'').toLocaleUpperCase('es');
  return text.includes('COMPLETA')||text.includes('LOTE AGOTADO');
 }
 function renderJourney(rows){
  const card=$('puJourney');if(!card)return;
  const total=rows.length,done=rows.filter(isCompletedRow).length,pending=total-done,pct=total?Math.round(done*100/total):0;
  const units=rows.reduce((sum,row)=>sum+Math.max(0,Number((row.cells[6]?.textContent||'').replace(/[^0-9.,-]/g,'').replace(',','.'))||0),0);
  $('pujPct').textContent=pct+'%';$('pujDone').textContent=done.toLocaleString('es-CO');$('pujPending').textContent=pending.toLocaleString('es-CO');$('pujUnits').textContent=units.toLocaleString('es-CO');
  $('pujFill').style.width=pct+'%';card.querySelector('[role="progressbar"]').setAttribute('aria-valuenow',String(pct));
  const next=rows.find(row=>!isCompletedRow(row)),text=$('pujNextText'),button=$('pujNextBtn');
  if(!total){text.textContent='Todavía no tienes referencias asignadas para este modelo.';button.disabled=true;button.textContent='Sin referencias';}
  else if(!next){text.textContent='🎉 ¡Terminaste todas tus referencias!';button.disabled=true;button.textContent='Jornada completada';}
  else{const product=(next.cells[0]?.querySelector('b')?.textContent||'Siguiente referencia').trim(),station=(next.cells[1]?.textContent||'').trim();text.textContent='Siguiente: '+product+(station?' · '+station:'');button.disabled=false;button.textContent='▶ Ir a la siguiente';}
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
   const b=document.createElement('button');b.type='button';b.className=item.label==='Todo'?'':'secondary';b.textContent=item.label;b.title=item.label==='Todo'?'Preparar todo el saldo pendiente ('+max+' unidades)':'Sumar hasta '+item.value+' unidad(es); después confirma Registrar unidades';
   b.addEventListener('click',()=>{const current=Math.max(0,Number(input.value)||0);const next=item.label==='Todo'?max:Math.min(max,current+item.value);input.value=String(next);input.focus({preventScroll:true});});
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
   const isDone=isCompletedRow(row);
   if(isDone)done++;else pending++;
   const matchesText=!searchText||row.textContent.toLocaleLowerCase('es').includes(searchText);
   const matchesStatus=filterMode==='all'||(filterMode==='done'?isDone:!isDone);
   const visible=matchesText&&matchesStatus;
   row.classList.toggle('pu-hidden',!visible);
   if(visible)shown++;
  });
  const count=$('puCount');
  if(count)count.textContent=shown+' de '+rows.length+' referencias visibles · '+pending+' pendientes · '+done+' completadas';
  renderJourney(rows);
  let empty=$('puNoResults');
  if(!empty){empty=document.createElement('p');empty.id='puNoResults';empty.className='notice';list.appendChild(empty);}
  const emptyMessage=rows.length&&shown===0?'No encontramos referencias con esa búsqueda. Prueba otro EAN, nombre o puesto.':'';
  if(empty.textContent!==emptyMessage)empty.textContent=emptyMessage;
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
