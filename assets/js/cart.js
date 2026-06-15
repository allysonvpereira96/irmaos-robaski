/**
 * cart.js — cart B2B com localStorage + drawer + checkout via WhatsApp.
 *
 * API exposta em window.Cart:
 *   add(produto, qtd)
 *   remove(id)
 *   updateQty(id, qtd)
 *   clear()
 *   getItems() → Array<{produto, qtd}>
 *   getTotal() → number
 *   getCount() → number
 *   openDrawer() / closeDrawer()
 *   sendWhatsApp() — abre wa.me com mensagem formatada
 *
 * Eventos disparados em window:
 *   'cart:change' — sempre que o cart muda
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'robaski_cart_v1';
  const WHATSAPP_NUMBER = '5551996396818';

  /* ─── Storage ─── */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[cart] falha ao carregar storage', e);
      return {};
    }
  }
  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[cart] falha ao salvar storage', e);
    }
  }

  let state = load(); // { [id]: { produto, qtd } }

  function emitChange() {
    save(state);
    updateBadge();
    if (drawerOpen) renderDrawer();
    window.dispatchEvent(new CustomEvent('cart:change', { detail: { count: api.getCount(), total: api.getTotal() } }));
  }

  /* ─── API pública ─── */
  const api = {
    add(produto, qtd = 1) {
      if (!produto || !produto.id) return;
      const id = produto.id;
      const existing = state[id];
      if (existing) {
        existing.qtd += qtd;
      } else {
        state[id] = {
          produto: {
            id: produto.id,
            slug: produto.slug,
            nome: produto.nome,
            preco: produto.preco,
            unidade: produto.unidade,
            imagem: produto.imagem,
            categoriaHumana: produto.categoriaHumana,
          },
          qtd,
        };
      }
      emitChange();
    },
    remove(id) {
      delete state[id];
      emitChange();
    },
    updateQty(id, qtd) {
      qtd = Math.max(0, Math.floor(qtd) || 0);
      if (qtd === 0) return api.remove(id);
      if (state[id]) {
        state[id].qtd = qtd;
        emitChange();
      }
    },
    clear() {
      state = {};
      emitChange();
    },
    getItems() {
      return Object.values(state);
    },
    getCount() {
      return Object.values(state).reduce((s, x) => s + x.qtd, 0);
    },
    getTotal() {
      return Object.values(state).reduce((s, x) => s + (x.produto.preco || 0) * x.qtd, 0);
    },
    sendWhatsApp() {
      const items = api.getItems();
      if (!items.length) return;

      const linhas = items.map(({ produto, qtd }) => `• ${qtd}x ${produto.nome}`);

      const msg = [
        'Olá! Gostaria de fazer um pedido na Irmãos Robaski:',
        '',
        ...linhas,
        '',
        '_Aguardo confirmação de disponibilidade e preço._',
      ].join('\n');

      const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank', 'noopener');
    },
    openDrawer() { setDrawerOpen(true); },
    closeDrawer() { setDrawerOpen(false); },
  };
  window.Cart = api;

  /* ─── Badge contador na navbar ─── */
  function updateBadge() {
    const els = document.querySelectorAll('.nav-cart-count');
    const count = api.getCount();
    els.forEach(el => {
      el.textContent = count > 0 ? String(count) : '';
      el.setAttribute('data-count', String(count));
    });
  }

  /* ─── Drawer DOM ─── */
  let drawer, overlay, drawerOpen = false;

  function ensureDrawer() {
    if (drawer) return;

    overlay = document.createElement('div');
    overlay.className = 'cart-overlay';
    overlay.addEventListener('click', () => setDrawerOpen(false));
    document.body.appendChild(overlay);

    drawer = document.createElement('aside');
    drawer.className = 'cart-drawer';
    drawer.setAttribute('aria-label', 'Carrinho de pedidos');
    drawer.innerHTML = `
      <div class="cart-header">
        <h3>Sua lista de pedido</h3>
        <button class="close" aria-label="Fechar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="cart-items" data-items></div>
      <div class="cart-footer" data-footer></div>
    `;
    drawer.querySelector('.close').addEventListener('click', () => setDrawerOpen(false));
    document.body.appendChild(drawer);
  }

  function setDrawerOpen(open) {
    ensureDrawer();
    drawerOpen = open;
    drawer.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
    if (open) renderDrawer();
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function renderDrawer() {
    if (!drawer) return;
    const items = api.getItems();
    const itemsEl = drawer.querySelector('[data-items]');
    const footerEl = drawer.querySelector('[data-footer]');

    if (!items.length) {
      itemsEl.innerHTML = `
        <div class="cart-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5-8M7 13l-2 9m12-9l2 9M9 21a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z"/></svg>
          <strong>Sua lista está vazia</strong>
          Adicione produtos do catálogo para montar o pedido.
        </div>
      `;
      footerEl.innerHTML = '';
      return;
    }

    itemsEl.innerHTML = items.map(({ produto, qtd }) => {
      const imgSrc = produto.imagem || 'assets/img/placeholder.svg';
      return `
        <div class="cart-item" data-id="${produto.id}">
          <div class="cart-item-img"><img src="${imgSrc}" alt="" loading="lazy"></div>
          <div class="cart-item-info">
            <div class="cart-item-nome">${produto.nome}</div>
            <div class="cart-item-qty">
              <button data-act="dec" aria-label="Diminuir">−</button>
              <input type="number" min="1" value="${qtd}" data-qty-input>
              <button data-act="inc" aria-label="Aumentar">+</button>
            </div>
          </div>
          <button class="cart-item-remove" data-act="remove" aria-label="Remover">×</button>
        </div>
      `;
    }).join('');

    const totalItens = items.reduce((s, x) => s + x.qtd, 0);
    footerEl.innerHTML = `
      <div class="cart-total">
        <span class="label">Total de itens</span>
        <span class="valor">${totalItens}</span>
      </div>
      <button class="btn btn-whatsapp btn-block btn-lg" data-act="send">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5l.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20"/></svg>
        Enviar lista pelo WhatsApp
      </button>
      <div class="cart-disclaimer">
        O vendedor vai confirmar disponibilidade, preço e prazo de entrega após receber a sua lista.
      </div>
    `;

    // Bind dos botões
    itemsEl.querySelectorAll('.cart-item').forEach(node => {
      const id = node.getAttribute('data-id');
      node.querySelectorAll('button[data-act]').forEach(btn => {
        const act = btn.getAttribute('data-act');
        btn.addEventListener('click', () => {
          const item = state[id]; if (!item) return;
          if (act === 'inc') api.updateQty(id, item.qtd + 1);
          if (act === 'dec') api.updateQty(id, item.qtd - 1);
          if (act === 'remove') api.remove(id);
        });
      });
      const input = node.querySelector('[data-qty-input]');
      if (input) {
        input.addEventListener('change', () => {
          api.updateQty(id, parseInt(input.value, 10));
        });
      }
    });
    footerEl.querySelector('[data-act="send"]').addEventListener('click', api.sendWhatsApp);
  }

  /* ─── Botão Cart na navbar ─── */
  document.addEventListener('DOMContentLoaded', () => {
    updateBadge();
    document.querySelectorAll('[data-open-cart]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        setDrawerOpen(true);
      });
    });
  });
})();
