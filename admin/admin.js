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

/* ─── Lightbox (modal de imagem em tamanho grande) ─── */
let lightboxEl = null;
function ensureLightbox() {
  if (lightboxEl) return lightboxEl;
  const css = `
    .lb-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9999;
             display: none; align-items: center; justify-content: center; padding: 40px;
             animation: lbFade .15s ease-out; }
    .lb-bg.open { display: flex; }
    @keyframes lbFade { from {opacity:0} to {opacity:1} }
    .lb-img { max-width: 100%; max-height: 90vh; object-fit: contain;
              background: #fff; border-radius: 8px; padding: 8px;
              box-shadow: 0 20px 60px rgba(0,0,0,.5); }
    .lb-info { position: absolute; left: 0; right: 0; bottom: 16px; text-align: center;
               color: #fff; font-size: 14px; font-weight: 500;
               text-shadow: 0 2px 8px rgba(0,0,0,.8); pointer-events: none; }
    .lb-close { position: absolute; top: 18px; right: 22px; width: 40px; height: 40px;
                background: rgba(255,255,255,.15); color: #fff; border: 0;
                border-radius: 50%; font-size: 22px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: background .12s; }
    .lb-close:hover { background: rgba(255,255,255,.3); }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lb-bg';
  lightboxEl.innerHTML = `
    <button class="lb-close" aria-label="Fechar">×</button>
    <img class="lb-img" alt="">
    <div class="lb-info"></div>
  `;
  document.body.appendChild(lightboxEl);
  lightboxEl.addEventListener('click', e => {
    if (e.target === lightboxEl || e.target.classList.contains('lb-close')) {
      lightboxEl.classList.remove('open');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') lightboxEl.classList.remove('open');
  });
  return lightboxEl;
}
export function openLightbox(url, label = '') {
  const lb = ensureLightbox();
  lb.querySelector('.lb-img').src = url;
  lb.querySelector('.lb-img').alt = label;
  lb.querySelector('.lb-info').textContent = label;
  lb.classList.add('open');
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
