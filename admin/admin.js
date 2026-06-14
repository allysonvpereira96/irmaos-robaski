/**
 * admin/admin.js — biblioteca compartilhada pelo frontend admin.
 * Cliente HTTP, helpers, toast, formatadores.
 */

/* ─── HTTP wrapper ─── */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body
      ? { 'content-type': 'application/json', ...(opts.headers || {}) }
      : (opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/admin/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return null;
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg); err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

/* ─── Toast ─── */
export function toast(msg, type = '') {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg;
  stack.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, type === 'error' ? 6000 : 3000);
}

/* ─── Upload de foto ─── */
/**
 * Sobe a foto pro Postgres via /api/admin/upload.
 * Lê o arquivo como base64 e envia em JSON.
 *
 * @param {string} produtoId
 * @param {File} file
 * @returns {Promise<{ok: true, imagem_url: string, hash: string}>}
 */
export async function uploadFoto(produtoId, file) {
  // limite prévio (mais informativo que erro do servidor)
  const MAX_FILE = 4 * 1024 * 1024; // 4 MB original (vira ~5.3 MB base64)
  if (file.size > MAX_FILE) {
    throw new Error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Limite: 4 MB.`);
  }

  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]); // remove "data:image/...;base64,"
    r.onerror = () => reject(new Error('Falha ao ler arquivo'));
    r.readAsDataURL(file);
  });

  return api('/api/admin/upload', {
    method: 'POST',
    body: { produto_id: produtoId, mime: file.type, data },
  });
}

/* ─── Helpers ─── */
export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
