(function(){
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function mostrarEstiba(){
    const box=document.getElementById('foundTask');
    const lpn=document.getElementById('scanLpn');
    const puesto=document.getElementById('scanPuesto');
    if(!box||!lpn||!puesto||!lpn.value.trim()) return;
    fetch('/api/state',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(s=>{
      if(!s||!Array.isArray(s.tasks)) return;
      const t=s.tasks.find(x=>String(x.lpn||'')===lpn.value.trim() && String(x.puesto||'')===puesto.value.trim() && x.estado!=='Entregada');
      if(!t) return;
      let old=box.querySelector('.estiba-destacada');
      if(!old){old=document.createElement('div');old.className='estiba-destacada';box.prepend(old);}
      old.innerHTML='📦 <b>ESTIBA: '+esc(t.estiba||'Sin número de estiba')+'</b>';
    }).catch(()=>{});
  }

  function patinadorAsignado(puesto){
    const v=String(puesto||'').trim().toLowerCase();
    const m=v.match(/^(pre|derecho|izquierdo)\s*(\d+)/);
    if(!m) return '';
    const area=m[1],n=Number(m[2]);
    if(area==='pre'){
      if(n>=1&&n<=10 || n===33) return 'Juan Esteban';
      if(n>=11&&n<=20) return 'Jorge';
      if(n>=21&&n<=32) return 'Hamilton';
    }
    if(area==='derecho'){
      if(n>=1&&n<=10) return 'Juan Esteban';
      if(n>=11&&n<=16) return 'Jorge';
    }
    if(area==='izquierdo'){
      if(n>=1&&n<=10) return 'Hamilton';
      if(n>=12&&n<=16) return 'Jorge';
    }
    return '';
  }

  let eanStream=null, eanTimer=null;
  async function escanearEAN(){
    const input=document.getElementById('scanEan');
    if(!input){alert('El campo EAN no está disponible en esta versión.');return;}
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){alert('La cámara necesita HTTPS y permiso de cámara. También puedes escribir el EAN manualmente.');return;}
    if(!('BarcodeDetector' in window)){alert('Este navegador no admite lectura automática de EAN. Prueba Chrome actualizado en Android o escribe el EAN manualmente.');return;}
    let supported=[]; try{supported=await BarcodeDetector.getSupportedFormats();}catch(e){}
    const formats=['ean_13','ean_8','upc_a','upc_e'].filter(x=>supported.includes(x));
    if(!formats.length){alert('El navegador no informa soporte para EAN. Puedes escribirlo manualmente.');return;}
    cerrarEAN();
    const box=document.createElement('div');
    box.id='eanScannerBox';
    box.style.cssText='position:fixed;inset:6%;background:#111;z-index:10000;border-radius:16px;padding:14px;color:#fff;text-align:center;box-shadow:0 10px 40px #0008';
    box.innerHTML='<div style="font-size:20px;font-weight:bold;margin-bottom:10px">📷 Escanear EAN</div><video id="eanVideo" autoplay playsinline muted style="width:100%;max-height:65vh;border-radius:12px"></video><p id="eanMsg">Apunta al código de barras EAN…</p><button type="button" style="padding:12px 20px;border:0;border-radius:10px" id="cerrarEANBtn">Cerrar</button>';
    document.body.appendChild(box);
    document.getElementById('cerrarEANBtn').onclick=cerrarEAN;
    try{
      eanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      const video=document.getElementById('eanVideo');
      video.srcObject=eanStream; await video.play();
      const detector=new BarcodeDetector({formats});
      eanTimer=setInterval(async()=>{
        try{
          const codes=await detector.detect(video);
          if(codes?.length){
            const value=String(codes[0].rawValue||'').trim();
            if(value){input.value=value;cerrarEAN();if(typeof buscarTarea==='function')buscarTarea();}
          }
        }catch(e){}
      },250);
    }catch(e){cerrarEAN();alert('No se pudo abrir la cámara. Revisa el permiso de cámara.');}
  }
  function cerrarEAN(){
    if(eanTimer){clearInterval(eanTimer);eanTimer=null;}
    if(eanStream){eanStream.getTracks().forEach(t=>t.stop());eanStream=null;}
    document.getElementById('eanScannerBox')?.remove();
  }

  async function guardarEntregaDirecta(id,qty,obs){
    const t=cloudTasks;
    const x=t.find(a=>a.id===id);
    if(!x) throw new Error('La tarea ya no está disponible.');
    const restante=Number(x.cantidad||0)-Number(x.entregado||0);
    if(qty<1||qty>restante) throw new Error('La cantidad supera lo pendiente.');
    x.entregado=(x.entregado||0)+qty;
    x.estado=x.entregado>=x.cantidad?'Entregada':'Parcial';
    x.entregas=x.entregas||[];
    x.entregas.push({patinador:current.name,cantidad:qty,fechaHora:new Date().toLocaleString('es-CO'),metodo:'EAN / botón ENTREGAR',observaciones:obs||''});
    x.entrega=x.entregas[x.entregas.length-1];
    const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({users,tasks:t,lpnCatalog})});
    if(!r.ok) throw new Error('El servidor no pudo guardar la entrega.');
    const s=await r.json();
    users=s.users||users; cloudTasks=Array.isArray(s.tasks)?s.tasks:t;
    if(Array.isArray(s.lpnCatalog)) lpnCatalog=s.lpnCatalog;
    localStorage.setItem('cc_users',JSON.stringify(users));
    localStorage.setItem('cc_tasks',JSON.stringify(cloudTasks));
    localStorage.setItem('cc_lpn_catalog',JSON.stringify(lpnCatalog));
  }

  function instalar(){
    const box=document.getElementById('foundTask');
    if(!box)return;
    const eanInput=document.getElementById('scanEan');
    if(!eanInput){
      const lpn=document.getElementById('scanLpn');
      if(lpn?.parentElement){
        const wrap=document.createElement('label');wrap.innerHTML='EAN<input id="scanEan" inputmode="numeric" autocomplete="off"></label>';
        lpn.parentElement.parentElement?.insertBefore(wrap,lpn.parentElement.nextSibling);
      }
    }
    const cameraArea=box.parentElement?.querySelector('.camera') || document.querySelector('.camera');
    if(cameraArea && !document.getElementById('btnEscanearEAN')){
      const b=document.createElement('button');b.type='button';b.id='btnEscanearEAN';b.textContent='📷 Escanear EAN';b.onclick=escanearEAN;cameraArea.appendChild(b);
    }
    const obs=new MutationObserver(()=>{
      mostrarEstiba();
      const b=box.querySelector('button[onclick*="confirmarEntrega"]');
      if(b){b.textContent='🚚 ENTREGAR';b.style.fontWeight='bold';}
      const text=[...box.querySelectorAll('button')].find(x=>/Entregado|ENTRÉ|Registrar entrega/i.test(x.textContent||''));
      if(text){text.textContent='🚚 ENTREGAR';text.style.fontWeight='bold';}
    });
    obs.observe(box,{childList:true,subtree:true});
    ['scanLpn','scanPuesto','scanEan'].forEach(id=>document.getElementById(id)?.addEventListener('input',mostrarEstiba));
    mostrarEstiba();
  }

  window.confirmarEntrega=async function(id,qty,obs){
    try{
      await guardarEntregaDirecta(id,Number(qty),obs||'');
      const box=document.getElementById('foundTask');
      if(box)box.innerHTML='<p class="pill">✅ Entrega registrada correctamente.</p>';
      if(typeof render==='function')render();
    }catch(e){alert(e.message||'No se pudo registrar la entrega.');}
  };

  window.buscarTarea=function(){
    const lpn=(document.getElementById('scanLpn')?.value||'').trim();
    const ean=(document.getElementById('scanEan')?.value||'').trim();
    const puesto=(document.getElementById('scanPuesto')?.value||'').trim();
    const qty=Number(document.getElementById('scanCantidad')?.value||1);
    const obs=(document.getElementById('scanObservaciones')?.value||'').trim();
    const box=document.getElementById('foundTask');
    if(!lpn||!puesto){box.innerHTML='<p class="error">Escribe o escanea el LPN y el puesto.</p>';return;}
    const t=cloudTasks.find(x=>String(x.lpn||'')===lpn && (!ean||String(x.ean||'')===ean) && String(x.puesto||'')===puesto && x.estado!=='Entregada');
    if(!t){box.innerHTML='<p class="error">No se encontró una tarea pendiente para ese LPN, EAN y puesto.</p>';return;}
    const asignado=patinadorAsignado(t.puesto);
    if(asignado && current.name!==asignado){box.innerHTML='<p class="error">Esta tarea está asignada a <b>'+esc(asignado)+'</b>.</p>';return;}
    if(current.areas&&!current.areas.includes(t.area)&&!(current.puestos||[]).includes(t.puesto)){box.innerHTML='<p class="error">Esta tarea no está asignada a tu zona.</p>';return;}
    const restante=Number(t.cantidad||0)-Number(t.entregado||0);
    if(qty<1||qty>restante){box.innerHTML='<p class="error">Cantidad inválida. Faltan '+restante+' unidades.</p>';return;}
    box.innerHTML='<div class="notice"><b>'+esc(t.producto)+'</b><br>📦 Estiba: <b>'+esc(t.estiba||'Sin estiba')+'</b><br>🏷️ EAN: '+esc(t.ean||'')+'<br>🏷️ LPN: '+esc(t.lpn||'')+'<br>👷 Patinador: <b>'+esc(asignado||current.name)+'</b><br>Solicitado: '+t.cantidad+'<br>Entregado: '+(t.entregado||0)+'<br>Faltante: '+restante+'<br>Destino: '+esc(t.area)+' / '+esc(t.puesto)+'<button type="button" id="btnEntregarReal">🚚 ENTREGAR</button></div>';
    document.getElementById('btnEntregarReal').onclick=()=>window.confirmarEntrega(t.id,qty,obs);
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',instalar);else instalar();
})();