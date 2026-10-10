const CACHE='familia-akt-v20';
const APP_SCRIPT='/patinador-estiba.js';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/index.html','/manifest.json',APP_SCRIPT])))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!=='familia-akt-v7').map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  if(url.origin===location.origin && (url.pathname==='/'||url.pathname==='/index.html')){
    e.respondWith(fetch(e.request).then(async r=>{
      const text=await r.text();
      if(text.includes('patinador-estiba.js')) return new Response(text,{status:r.status,statusText:r.statusText,headers:r.headers});
      const injected=text.replace('</body>','<script src="/patinador-estiba.js?v=20"></script></body>');
      const headers=new Headers(r.headers);headers.set('Content-Type','text/html; charset=utf-8');headers.set('Cache-Control','no-store');
      const out=new Response(injected,{status:r.status,statusText:r.statusText,headers});
      caches.open(CACHE).then(c=>c.put('/index.html',out.clone()));
      return out;
    }).catch(()=>caches.match('/index.html')));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request)));
});