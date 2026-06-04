/**
 * catalogo.js — controla a página produtos.html.
 *
 * Responsabilidades:
 *  - Carrega data/produtos.json e data/categorias.json
 *  - Inicializa Fuse.js para busca fuzzy
 *  - Filtros: categoria, marca, faixa de preço, ordenação
 *  - Paginação virtual (renderiza 60 cards por vez)
 *  - Lazy load de imagens (loading="lazy")
 *  - Botão "Adicionar à lista" delega pra window.Cart
 *
 * Dependências: Fuse.js (carregado via CDN no produtos.html), window.Cart (cart.js)
 */

(function () {
  'use strict';

  const PAGE_SIZE = 60;
  const SEARCH_DEBOUNCE = 220;

  /** Estado completo da página. */
  const state = {
    produtos: [],     // dataset completo
    categorias: [],   // dataset
    filtered: [],     // depois dos filtros
    fuse: null,       // instância Fuse.js sobre o dataset
    filtros: {
      busca: '',
      categoria: 'todos',
      marca: '',
      sort: 'relevancia',
    },
    pagina: 1,
  };

  /* ─── Elementos ─── */
  const els = {};
  function bindEls() {
    els.grid          = document.getElementById('produtos-grid');
    els.sidebar       = document.querySelector('.cat-sidebar');
    els.busca         = document.getElementById('filtro-busca');
    els.categorias    = document.getElementById('filtro-categorias');
    els.marcas        = document.getElementById('filtro-marca');
    els.sort          = document.getElementById('filtro-sort');
    els.total         = document.getElementById('toolbar-total');
    els.label         = document.getElementById('toolbar-label');
    els.paginacao     = document.getElementById('paginacao');
    els.limparFiltros = document.getElementById('limpar-filtros');
  }

  /* ─── Loader ─── */
  async function carregarDados() {
    const [pRes, cRes] = await Promise.all([
      fetch('data/produtos.json'),
      fetch('data/categorias.json'),
    ]);
    if (!pRes.ok || !cRes.ok) throw new Error('Falha ao carregar dados do catálogo');
    state.produtos = await pRes.json();
    state.categorias = await cRes.json();
  }

  /* ─── Sidebar render ─── */
  function renderCategorias() {
    if (!els.categorias) return;
    const items = [
      `<button class="cat-opcao ativo" data-cat="todos">Todos <span class="count">${state.produtos.length}</span></button>`,
      ...state.categorias.map(c => `
        <button class="cat-opcao" data-cat="${c.slug}">
          ${c.titulo} <span class="count">${c.count}</span>
        </button>
      `),
    ];
    els.categorias.innerHTML = items.join('');
    els.categorias.querySelectorAll('.cat-opcao').forEach(btn => {
      btn.addEventListener('click', () => {
        els.categorias.querySelectorAll('.cat-opcao').forEach(b => b.classList.remove('ativo'));
        btn.classList.add('ativo');
        state.filtros.categoria = btn.getAttribute('data-cat');
        state.pagina = 1;
        aplicarFiltros();
      });
    });
  }

  function renderMarcas() {
    if (!els.marcas) return;
    const marcas = [...new Set(state.produtos.map(p => p.marca).filter(Boolean))].sort();
    els.marcas.innerHTML = `
      <option value="">Todas as marcas</option>
      ${marcas.map(m => `<option value="${m}">${m}</option>`).join('')}
    `;
  }

  /* ─── Filtros / busca / sort ─── */
  function initFuse() {
    state.fuse = new Fuse(state.produtos, {
      keys: [
        { name: 'nome',  weight: 0.7 },
        { name: 'marca', weight: 0.3 },
      ],
      threshold: 0.36,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }

  function aplicarFiltros() {
    let lista;

    // 1. busca
    if (state.filtros.busca.length >= 2) {
      lista = state.fuse.search(state.filtros.busca).map(r => r.item);
    } else {
      lista = state.produtos.slice();
    }

    // 2. categoria
    if (state.filtros.categoria !== 'todos') {
      lista = lista.filter(p => p.categoriaHumana === state.filtros.categoria);
    }

    // 3. marca
    if (state.filtros.marca) {
      lista = lista.filter(p => p.marca === state.filtros.marca);
    }

    // 4. sort
    const sort = state.filtros.sort;
    if (sort === 'nome') lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    // 'relevancia' = mantém ordem do fuse ou do dataset

    state.filtered = lista;
    renderGrid();
  }

  /* ─── Grid + paginação ─── */
  function renderGrid() {
    const total = state.filtered.length;
    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.pagina > totalPaginas) state.pagina = totalPaginas;

    const ini = (state.pagina - 1) * PAGE_SIZE;
    const fim = ini + PAGE_SIZE;
    const slice = state.filtered.slice(ini, fim);

    // Toolbar info
    if (els.total) els.total.textContent = total;
    if (els.label) {
      const catLabel = state.filtros.categoria === 'todos'
        ? 'Todos os produtos'
        : (state.categorias.find(c => c.slug === state.filtros.categoria)?.titulo || '');
      els.label.textContent = catLabel;
    }

    if (!total) {
      els.grid.innerHTML = `
        <div class="sem-resultados" style="grid-column: 1 / -1;">
          <strong>Nenhum produto encontrado</strong>
          Tente outra busca, mude a categoria ou limpe os filtros.
        </div>
      `;
      els.paginacao.innerHTML = '';
      return;
    }

    els.grid.innerHTML = slice.map(cardHTML).join('');

    // Bind botões "Adicionar à lista"
    els.grid.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-add');
        const produto = state.produtos.find(p => p.id === id);
        if (produto) {
          window.Cart.add(produto, 1);
          btn.classList.add('added');
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg> Adicionado';
          setTimeout(() => {
            btn.classList.remove('added');
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Adicionar';
          }, 1400);
        }
      });
    });

    renderPaginacao(totalPaginas);
  }

  function cardHTML(p) {
    const imgSrc = p.imagem || 'assets/img/placeholder.svg';
    const cat = state.categorias.find(c => c.slug === p.categoriaHumana);
    return `
      <article class="produto-card">
        <a class="produto-img" href="p/${p.slug}.html" aria-label="Ver detalhes de ${escapeHTML(p.nome)}">
          <img src="${imgSrc}" alt="${escapeHTML(p.nome)}" loading="lazy" width="220" height="275">
          ${cat ? `<span class="produto-cat-badge">${cat.titulo}</span>` : ''}
        </a>
        <div class="produto-info">
          ${p.marca ? `<span class="produto-marca">${escapeHTML(p.marca)}</span>` : ''}
          <a class="produto-nome" href="p/${p.slug}.html">${escapeHTML(p.nome)}</a>
        </div>
        <div class="produto-actions">
          <button class="btn-add-cart" data-add="${p.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Adicionar
          </button>
        </div>
      </article>
    `;
  }

  function renderPaginacao(totalPaginas) {
    if (totalPaginas <= 1) { els.paginacao.innerHTML = ''; return; }

    const cur = state.pagina;
    const btns = [];
    btns.push(`<button data-pg="prev" ${cur === 1 ? 'disabled' : ''}>‹</button>`);

    // Janela: 1 ... cur-1 cur cur+1 ... last
    const winSize = 1;
    const pages = new Set([1, totalPaginas, cur, ...range(cur - winSize, cur + winSize)]);
    const sorted = [...pages].filter(n => n >= 1 && n <= totalPaginas).sort((a, b) => a - b);

    let last = 0;
    for (const n of sorted) {
      if (last && n - last > 1) btns.push(`<button disabled>…</button>`);
      btns.push(`<button data-pg="${n}" class="${n === cur ? 'ativo' : ''}">${n}</button>`);
      last = n;
    }

    btns.push(`<button data-pg="next" ${cur === totalPaginas ? 'disabled' : ''}>›</button>`);
    els.paginacao.innerHTML = btns.join('');
    els.paginacao.querySelectorAll('button[data-pg]:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-pg');
        if (v === 'prev') state.pagina = Math.max(1, state.pagina - 1);
        else if (v === 'next') state.pagina = Math.min(totalPaginas, state.pagina + 1);
        else state.pagina = parseInt(v, 10);
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ─── Helpers ─── */
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  /* ─── Bind dos inputs ─── */
  function bindInputs() {
    if (els.busca) {
      els.busca.addEventListener('input', debounce(() => {
        state.filtros.busca = els.busca.value.trim();
        state.pagina = 1;
        aplicarFiltros();
      }, SEARCH_DEBOUNCE));
    }
    if (els.marcas) {
      els.marcas.addEventListener('change', () => {
        state.filtros.marca = els.marcas.value;
        state.pagina = 1;
        aplicarFiltros();
      });
    }
    if (els.sort) {
      els.sort.addEventListener('change', () => {
        state.filtros.sort = els.sort.value;
        aplicarFiltros();
      });
    }
    if (els.limparFiltros) {
      els.limparFiltros.addEventListener('click', () => {
        state.filtros = { busca: '', categoria: 'todos', marca: '', sort: 'relevancia' };
        state.pagina = 1;
        if (els.busca) els.busca.value = '';
        if (els.marcas) els.marcas.value = '';
        if (els.sort) els.sort.value = 'relevancia';
        els.categorias.querySelectorAll('.cat-opcao').forEach((b, i) => b.classList.toggle('ativo', i === 0));
        aplicarFiltros();
      });
    }
  }

  /* ─── Boot ─── */
  document.addEventListener('DOMContentLoaded', async () => {
    bindEls();
    if (!els.grid) return; // não está na página de catálogo
    try {
      await carregarDados();
      initFuse();
      renderCategorias();
      renderMarcas();
      bindInputs();

      // Pré-seleção via URL ?cat=slug e/ou ?q=busca
      const params = new URLSearchParams(location.search);
      const cat = params.get('cat');
      if (cat && state.categorias.find(c => c.slug === cat)) {
        state.filtros.categoria = cat;
        els.categorias.querySelectorAll('.cat-opcao').forEach(b => b.classList.toggle('ativo', b.getAttribute('data-cat') === cat));
      }
      const q = params.get('q');
      if (q && els.busca) {
        state.filtros.busca = q;
        els.busca.value = q;
      }

      aplicarFiltros();
    } catch (e) {
      console.error(e);
      els.grid.innerHTML = `<div class="sem-resultados" style="grid-column: 1 / -1;"><strong>Erro ao carregar o catálogo.</strong>Tente recarregar a página.</div>`;
    }
  });
})();
