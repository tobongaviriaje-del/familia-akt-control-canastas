/* AKT INTELIGENTE: conversational read-only view over verified production indicators. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const norm=value=>String(value??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=value=>Number(value||0).toLocaleString('es-CO',{maximumFractionDigits:1});
const pct=value=>Number.isFinite(Number(value))?fmt(value)+'%':'Sin dato';
let mounted=false,busy=false;
function style(){
 if($('aktAssistantStyle'))return;
 const s=document.createElement('style');s.id='aktAssistantStyle';
 s.textContent='.akt-assistant{border:1px solid #bfcee0;background:linear-gradient(145deg,#fff,#f7faff)}.akt-assistant-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.akt-assistant-sub{font-size:12px;color:#64748b}.akt-assistant-log{display:flex;flex-direction:column;gap:9px;max-height:360px;overflow:auto;padding:8px 2px}.akt-assistant-msg{padding:10px 12px;border-radius:12px;max-width:94%;white-space:pre-wrap;overflow-wrap:anywhere}.akt-assistant-msg.bot{background:#eef4fb;border:1px solid #dbe5f1;align-self:flex-start}.akt-assistant-msg.user{background:#e8f5ec;border:1px solid #cde8d5;align-self:flex-end}.akt-assistant-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}.akt-assistant-form textarea{width:100%;min-height:54px;resize:vertical}.akt-assistant-chips{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.akt-assistant-chips button{font-size:12px;padding:7px 10px}.akt-assistant-foot{font-size:11px;color:#64748b;margin-top:8px}@media(max-width:520px){.akt-assistant-form{grid-template-columns:1fr}.akt-assistant-form button{width:100%}}';
 document.head.appendChild(s);
}
function addMessage(kind,text){
 const log=$('aktAssistantLog');if(!log)return;
 const item=document.createElement('div');item.className='akt-assistant-msg '+kind;item.textContent=text;
 log.appendChild(item);log.scrollTop=log.scrollHeight;
}
function currentUser(){return typeof current!=='undefined'&&current?current:null;}
function sync(){
 const panel=$('aktAssistantPanel'),who=currentUser();
 if(!panel)return;
 const visible=!!(who&&['Admin','Supervisor','Coordinador','Patinador'].includes(who.role));
 panel.classList.toggle('hidden',!visible);
 if(visible&&!mounted){mounted=true;addMessage('bot','Hola. Soy AKT INTELIGENTE. Puedo consultar los lotes activos y los porcentajes que tu perfil tiene permiso para ver. Mis respuestas salen de los datos registrados; si no hay información suficiente, te lo diré.');}
}
function modelFilter(query){
 const q=norm(query).toUpperCase().replace(/\s+/g,' ');
 if(/\bCHR\b/.test(q))return 'CHR';
 if(/\bNKD\b/.test(q))return 'NKD';
 if(/CR4\s*[- ]?\s*125/.test(q))return 'CR4 125';
 if(/CR4\s*[- ]?\s*150/.test(q))return 'CR4 150';
 if(/XRS\s*[- ]?\s*180/.test(q))return 'XRS-180';
 return '';
}
function buildAnswer(query,data){
 const who=currentUser(),role=who&&who.role,q=norm(query),model=modelFilter(query);
 const codeMatch=String(query||'').toUpperCase().match(/\b[A-Z]{1,5}\s*[-]?\s*\d{2,}\b/);
 const lotCode=codeMatch?codeMatch[0].replace(/\s+/g,'').replace('-',''):'';
 let lots=(Array.isArray(data.lots)?data.lots:[]).filter(x=>(!model||x.model===model)&&(!lotCode||norm(x.lot).replace(/[\s-]/g,'').includes(norm(lotCode))));
 let skaters=(Array.isArray(data.skaters)?data.skaters:[]).filter(x=>(!model||x.model===model)&&(!lotCode||norm(x.lot).replace(/[\s-]/g,'').includes(norm(lotCode))));
 const low=q.includes('atras')||q.includes('mas bajo')||q.includes('menor')||q.includes('peor')||q.includes('pendiente');
 const asksModel=q.includes('modelo')&&!model;
 const high=q.includes('mejor')||q.includes('mayor avance')||q.includes('mas alto')||q.includes('mas avanzado');
 const byPct=(items,field='percentage',descending=false)=>[...items].sort((a,b)=>(Number(a[field]||0)-Number(b[field]||0))*(descending?-1:1));
 const lotLabel=x=>x.model+' · '+x.lot;
 if(role==='Patinador'){
  const summary=data.summary||{};
  if(!lots.length)return 'No encuentro un lote activo asignado a tu cuenta que coincida con esa consulta. No voy a completar cifras por suposición.';
  if(q.includes('lote')||q.includes('modelo')||model||lotCode)return 'Tu avance por lote:\n'+lots.map(x=>lotLabel(x)+': '+pct(x.percentage)+' ('+fmt(x.deliveredUnits)+' de '+fmt(x.totalUnits)+' unidades; '+fmt(x.pendingUnits)+' pendientes).').join('\n');
  return 'Tu avance registrado en los lotes activos:\n'+fmt(summary.deliveredUnits)+' de '+fmt(summary.totalUnits)+' unidades entregadas ('+pct(summary.percentage)+').\nPendientes: '+fmt(summary.pendingUnits)+' unidades en '+fmt(summary.references)+' referencias asignadas.';
 }
 if(!lots.length)return 'No encontré lotes activos que coincidan con esa consulta. Los indicadores no se estiman cuando no hay datos.';
 if(role==='Supervisor'){
  if(q.includes('patinador')||q.includes('quien')||q.includes('quién')){
   const selected=skaters.filter(x=>q.includes(norm(x.name)));
   const ranked=byPct(selected.length?selected:skaters,'percentage',high);
   if(!ranked.length)return 'No hay porcentajes individuales disponibles para esta selección.';
   if(low||high)return (low?'Patinador con menor porcentaje registrado':'Patinador con mayor porcentaje registrado')+':\n'+ranked.slice(0,1).map(x=>x.name+' · '+lotLabel(x)+': '+pct(x.percentage)+'.').join('\n');
   return 'Porcentaje de entrega por patinador'+(model?' · '+model:'')+':\n'+ranked.map(x=>x.name+' · '+lotLabel(x)+': '+pct(x.percentage)+'.').join('\n');
  }
  const rankedLots=byPct(lots,'percentage',high);
  if(low||high)return (low?'Lote con menor avance':'Lote con mayor avance')+':\n'+rankedLots.slice(0,1).map(x=>lotLabel(x)+': '+pct(x.percentage)+'.').join('\n');
  if(q.includes('lote')||q.includes('modelo')||model||lotCode){
   return 'Avance de los lotes activos'+(model?' para '+model:'')+':\n'+rankedLots.map(x=>lotLabel(x)+': '+pct(x.percentage)+'.').join('\n');
  }
  return 'Porcentaje de entrega por patinador:\n'+(skaters.length?byPct(skaters).map(x=>x.name+' · '+lotLabel(x)+': '+pct(x.percentage)+'.').join('\n'):'No hay porcentajes individuales disponibles para esta selección.')+'\n\nAvance de lotes:\n'+rankedLots.map(x=>lotLabel(x)+': '+pct(x.percentage)+'.').join('\n');
 }
 const matchingSkaters=skaters.filter(x=>q.includes(norm(x.name)));
 if(q.includes('patinador')||q.includes('quien')||q.includes('quién')||matchingSkaters.length){
  const chosen=matchingSkaters.length?matchingSkaters:skaters,ranked=byPct(chosen,'percentage',high);
  if(!ranked.length)return 'No hay patinadores con asignaciones en los lotes activos.';
  if(low||high)return (low?'Patinador con menor porcentaje de entrega':'Patinador con mayor porcentaje de entrega')+':\n'+ranked.slice(0,1).map(x=>x.name+' · '+lotLabel(x)+': '+pct(x.percentage)+' ('+fmt(x.deliveredUnits)+' de '+fmt(x.totalUnits)+'; '+fmt(x.pendingUnits)+' pendientes).').join('\n');
  return 'Comparativo de entrega por patinador'+(model?' · '+model:'')+':\n'+ranked.map(x=>x.name+' · '+lotLabel(x)+': '+pct(x.percentage)+' ('+fmt(x.deliveredUnits)+' de '+fmt(x.totalUnits)+'; '+fmt(x.pendingUnits)+' pendientes).').join('\n');
 }
 if(asksModel){
  const groups=new Map();
  lots.forEach(x=>{
   const key=x.model;if(!groups.has(key))groups.set(key,{model:key,total:0,delivered:0,pending:0,count:0,percentSum:0});
   const g=groups.get(key);g.count++;g.percentSum+=Number(x.percentage||0);
   g.total+=Number(x.totalUnits||0);g.delivered+=Number(x.deliveredUnits||0);g.pending+=Number(x.pendingUnits||0);
  });
  const models=[...groups.values()].map(g=>({...g,percentage:g.total?Math.min(100,g.delivered/g.total*100):g.percentSum/Math.max(1,g.count)})).sort((a,b)=>a.percentage-b.percentage);
  if(!models.length)return 'No hay indicadores de modelos disponibles para esta consulta.';
  if(low||high){const chosen=high?models[models.length-1]:models[0];return (low?'Modelo con menor avance':'Modelo con mayor avance')+':\\n'+chosen.model+': '+pct(chosen.percentage)+'.';}
  return 'Avance por modelo en los lotes activos:\\n'+models.map(x=>x.model+': '+pct(x.percentage)+'.').join('\\n');
 }
 if(low||high){
  const ranked=byPct(lots,'percentage',high);
  return (low?'Lote con menor avance':'Lote con mayor avance')+':\n'+ranked.slice(0,1).map(x=>lotLabel(x)+': '+pct(x.percentage)+' ('+fmt(x.deliveredUnits)+' de '+fmt(x.totalUnits)+' unidades).').join('\n');
 }
 const total=lots.reduce((n,x)=>n+Number(x.totalUnits||0),0),delivered=lots.reduce((n,x)=>n+Number(x.deliveredUnits||0),0),pending=lots.reduce((n,x)=>n+Number(x.pendingUnits||0),0),references=lots.reduce((n,x)=>n+Number(x.references||0),0);
 const percent=total?Math.min(100,delivered/total*100):0;
 return 'Resumen de producción'+(model?' · '+model:'')+(lotCode?' · '+lotCode:'')+' según los lotes activos:\n'+fmt(delivered)+' de '+fmt(total)+' unidades entregadas ('+pct(percent)+').\nPendientes: '+fmt(pending)+' unidades · Referencias: '+fmt(references)+'.\n\nLotes:\n'+byPct(lots).map(x=>lotLabel(x)+': '+pct(x.percentage)+' ('+fmt(x.deliveredUnits)+' / '+fmt(x.totalUnits)+').').join('\n');
}
async function ask(query){
 if(busy)return;
 const text=String(query||'').trim();if(!text)return;
 const who=currentUser();if(!who)return;
 const token=sessionStorage.getItem('cc_session_token');if(!token){addMessage('bot','No encuentro una sesión activa. Ingresa nuevamente a Familia AKT.');return;}
 busy=true;const button=$('aktAssistantSend'),input=$('aktAssistantInput');
 if(button){button.disabled=true;button.textContent='Consultando…';}
 addMessage('user',text);
 try{
  const response=await fetch('/api/assistant/production-summary',{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+token}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw new Error(data.error||'No se pudieron consultar los indicadores.');
  addMessage('bot',buildAnswer(text,data));
 }catch(error){addMessage('bot','No pude verificar los datos en este momento: '+(error.message||'error de consulta')+'. No voy a inventar una respuesta.');}
 finally{busy=false;if(button){button.disabled=false;button.textContent='Preguntar';}if(input)input.focus();}
}
function mount(){
 if($('aktAssistantPanel'))return;
 const anchor=$('patinadorProgressPanel');if(!anchor||!anchor.parentNode)return;
 const panel=document.createElement('section');panel.id='aktAssistantPanel';panel.className='card akt-assistant hidden';
 panel.innerHTML='<div class="akt-assistant-head"><div><h2 style="margin-bottom:4px">🤖 AKT INTELIGENTE</h2><div class="akt-assistant-sub">Copiloto de producción · datos reales · solo lectura</div></div><span class="pill">CONSULTA SEGURA</span></div><div id="aktAssistantLog" class="akt-assistant-log" aria-live="polite"></div><div class="akt-assistant-chips"><button type="button" class="secondary" data-akt-question="¿Cómo vamos hoy en producción?">¿Cómo vamos hoy?</button><button type="button" class="secondary" data-akt-question="¿Qué avance lleva CHR?">Avance CHR</button><button type="button" class="secondary" data-akt-question="¿Cómo va cada patinador?">Por patinador</button></div><form id="aktAssistantForm" class="akt-assistant-form"><textarea id="aktAssistantInput" maxlength="500" placeholder="Escribe tu pregunta sobre producción…" aria-label="Pregunta para AKT INTELIGENTE"></textarea><button id="aktAssistantSend" type="submit">Preguntar</button></form><div class="akt-assistant-foot">La respuesta depende de tu perfil y de los lotes activos registrados. No modifica entregas, referencias ni históricos.</div>';
 anchor.insertAdjacentElement('afterend',panel);
 $('aktAssistantForm').addEventListener('submit',event=>{event.preventDefault();const input=$('aktAssistantInput');const value=input&&input.value; if(input)input.value='';ask(value);});
 panel.querySelectorAll('[data-akt-question]').forEach(button=>button.addEventListener('click',()=>{const input=$('aktAssistantInput');if(input)input.value=button.getAttribute('data-akt-question')||'';ask(input&&input.value);if(input)input.value='';}));
}
function start(){
 style();mount();sync();
 if(typeof render==='function'&&!render.__aktAssistantWrapped){
  const original=render;
  const wrapped=function(){const value=original.apply(this,arguments);try{mount();sync();}catch(error){console.warn('AKT INTELIGENTE:',error);}return value;};
  wrapped.__aktAssistantWrapped=true;render=wrapped;
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,0));else setTimeout(start,0);
})();
