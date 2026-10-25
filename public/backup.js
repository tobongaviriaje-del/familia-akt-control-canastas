(() => {
  const el = (tag, attrs = {}, text = '') => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text) node.textContent = text;
    return node;
  };
  function authHeaders(json = false) {
    const token = sessionStorage.getItem('cc_session_token');
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }
  function message(text, bad = false) {
    const box = document.getElementById('backupRestoreMessage');
    if (box) { box.textContent = text; box.style.color = bad ? '#a30d24' : '#166534'; }
  }
  async function downloadBackup() {
    try {
      const response = await fetch('/api/backup', { headers: authHeaders(), cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo descargar el respaldo.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'familia-akt-respaldo.json' });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      message('Respaldo descargado. Guárdalo fuera del celular o computador donde usas la app.');
    } catch (error) { message(error.message || 'Error al descargar respaldo.', true); }
  }
  async function restoreBackup(fileInput) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!confirm('Vas a restaurar los datos activos desde este archivo. Se guardará una copia del estado actual antes de restaurar y las jornadas históricas existentes no se borrarán. ¿Continuar?')) {
      fileInput.value = ''; return;
    }
    try {
      const text = await file.text();
      const response = await fetch('/api/backup/restore', { method: 'POST', headers: authHeaders(true), body: text, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo restaurar el respaldo.');
      message(result.message || 'Respaldo restaurado. Recarga la aplicación para ver los datos.');
      alert('Respaldo restaurado. La aplicación se recargará para actualizar los datos.');
      window.location.reload();
    } catch (error) { message(error.message || 'Error al restaurar respaldo.', true); }
    finally { fileInput.value = ''; }
  }
  function install() {
    const admin = document.getElementById('adminPanel');
    if (!admin || document.getElementById('backupRestoreCard')) return;
    const card = el('section', { id: 'backupRestoreCard', class: 'card' });
    card.appendChild(el('h3', {}, '🛡️ Copia de seguridad y restauración'));
    card.appendChild(el('p', { class: 'muted' }, 'Descarga los datos activos y el historial de jornadas a un archivo JSON. Guárdalo en un lugar seguro. Restaurar reemplaza los datos activos; las jornadas ya existentes se conservan.'));
    const download = el('button', { type: 'button' }, '⬇️ Descargar respaldo');
    download.addEventListener('click', downloadBackup);
    card.appendChild(download);
    const input = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Seleccionar archivo de respaldo' });
    input.style.marginTop = '10px';
    const restore = el('button', { type: 'button', class: 'secondary' }, '♻️ Restaurar desde archivo');
    restore.addEventListener('click', () => {
      if (!input.files || !input.files.length) { message('Primero selecciona un archivo de respaldo válido.', true); return; }
      restoreBackup(input);
    });
    card.appendChild(input); card.appendChild(restore);
    card.appendChild(el('p', { id: 'backupRestoreMessage', class: 'muted', role: 'status' }));
    admin.appendChild(card);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  const observer = new MutationObserver(install);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
})();
