(function(){
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
      old.innerHTML='📦 <b>ESTIBA: '+String(t.estiba||'Sin número de estiba')+'</b>';
    }).catch(()=>{});
  }
  function instalar(){
    const box=document.getElementById('foundTask');
    if(!box) return;
    const obs=new MutationObserver(mostrarEstiba);
    obs.observe(box,{childList:true,subtree:true});
    ['scanLpn','scanPuesto'].forEach(id=>{const e=document.getElementById(id);if(e)e.addEventListener('input',mostrarEstiba);});
    mostrarEstiba();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',instalar);else instalar();
})();
