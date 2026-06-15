/**
 * build-site.mjs
 *
 * Gera o site estático completo a partir de data/produtos.json + data/categorias.json:
 *   - p/{slug}.html × 1.972 (uma página por produto, com Schema.org Product)
 *   - categorias/{slug}.html × 19 (com Schema.org ItemList)
 *   - sitemap.xml (incluindo todas as URLs acima + home + /produtos + páginas estáticas)
 *
 * Idempotente: pode ser rodado N vezes — sempre regrava com o estado atual dos JSONs.
 *
 * Uso: node build/build-site.mjs
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');
const DATA_DIR = join(SITE_DIR, 'data');
const P_DIR = join(SITE_DIR, 'p');
const CAT_DIR = join(SITE_DIR, 'categorias');

const ORIGIN = 'https://irmaosrobaski.com.br'; // ⚠ trocar quando domínio for confirmado
const WHATSAPP = '5551996396818';              // (51) 99639-6818
const WHATSAPP_DISPLAY = '(51) 99639-6818';
const HORARIO_DISPLAY = 'Seg a Sex 8h–18h30 · Sáb 8h–12h';

/* ════════════════════════════════════════════════════════════════
   Helpers
═══════════════════════════════════════════════════════════════ */

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function escapeAttr(s) {
  return escapeHTML(s).replace(/\n/g, ' ');
}

function formatBRL(n) {
  if (n == null || isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ════════════════════════════════════════════════════════════════
   Componentes compartilhados (navbar, footer, wpp-float, head extras)
═══════════════════════════════════════════════════════════════ */

const NAVBAR = (level = 0) => {
  const prefix = '../'.repeat(level);
  return `
  <nav class="navbar">
    <div class="navbar-inner">
      <a href="${prefix}index.html" class="nav-logo">
        <img src="${prefix}assets/img/logo.png" alt="Irmãos Robaski" width="42" height="42">
        <div class="nav-logo-text">
          <strong>Irmãos Robaski</strong>
          <span>Atacado · Distribuição</span>
        </div>
      </a>
      <ul class="nav-menu" id="nav-menu">
        <li><a href="${prefix}index.html">Home</a></li>
        <li><a href="${prefix}produtos.html">Catálogo</a></li>
        <li><a href="${prefix}index.html#categorias">Categorias</a></li>
        <li><a href="${prefix}index.html#sobre">Sobre</a></li>
        <li><a href="${prefix}index.html#faq">FAQ</a></li>
      </ul>
      <button class="nav-cart-btn" data-open-cart aria-label="Abrir carrinho">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5-8M7 13l-2 9m12-9l2 9M9 21a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z"/></svg>
        <span>Lista</span>
        <span class="nav-cart-count" data-count="0"></span>
      </button>
      <button class="nav-toggle" aria-label="Menu"><span></span><span></span><span></span></button>
    </div>
  </nav>`;
};

const FOOTER = (level = 0) => {
  const prefix = '../'.repeat(level);
  return `
  <footer>
    <div class="container">
      <div class="footer-grid">
        <div class="footer-col">
          <div class="footer-brand">
            <img src="${prefix}assets/img/logo-white.png" alt="" width="40" height="40">
            <strong>Irmãos Robaski</strong>
          </div>
          <p class="footer-about">Distribuidora atacadista com catálogo amplo de mercearia, bebidas, limpeza, descartáveis e embalagens.</p>
        </div>
        <div class="footer-col">
          <h4>Empresa</h4>
          <ul>
            <li><a href="${prefix}index.html">Home</a></li>
            <li><a href="${prefix}produtos.html">Catálogo</a></li>
            <li><a href="${prefix}index.html#sobre">Sobre</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Contato</h4>
          <ul>
            <li><a href="https://wa.me/${WHATSAPP}?text=Ol%C3%A1%21%20Gostaria%20de%20fazer%20um%20pedido.">WhatsApp · ${WHATSAPP_DISPLAY}</a></li>
            <li>contato@irmaosrobaski.com.br</li>
            <li style="opacity:.85;">${HORARIO_DISPLAY}</li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; 2026 Irmãos Robaski. Todos os direitos reservados.</span>
        <span>Site por <a href="https://promoove.tech" style="color: rgba(255,255,255,0.75);">Promoove</a></span>
      </div>
    </div>
  </footer>`;
};

const WPP_FLOAT = `
  <a href="https://wa.me/${WHATSAPP}?text=Ol%C3%A1%21%20Gostaria%20de%20fazer%20um%20pedido." target="_blank" rel="noopener" class="wpp-float" aria-label="WhatsApp">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5l.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20"/></svg>
  </a>`;

const HEAD_FONTS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;

/* ════════════════════════════════════════════════════════════════
   Página individual de produto: p/{slug}.html
═══════════════════════════════════════════════════════════════ */

function paginaProduto(p, categoria, relacionados) {
  const titulo = `${p.nome} | Irmãos Robaski`;
  const desc = (() => {
    const partes = [
      p.nome,
      p.marca ? `Marca ${p.marca}` : null,
      `${categoria.titulo} no atacado Irmãos Robaski.`,
      'Pedido e cotação pelo WhatsApp.',
    ].filter(Boolean);
    return truncate(partes.join(' · '), 158);
  })();
  const url = `${ORIGIN}/p/${p.slug}`;
  const imgSrc = p.imagem || '../assets/img/placeholder.svg';
  const imgAbsolute = p.imagem
    ? `${ORIGIN}/${p.imagem.replace(/^\.\.\//, '')}`
    : `${ORIGIN}/assets/img/og-image.jpg`;

  // Schema.org Product — sem preço (atacado: preço sob consulta via WhatsApp)
  const schemaProduct = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: p.nome,
    sku: p.id,
    category: categoria.titulo,
    image: imgAbsolute,
    url,
    ...(p.marca ? { brand: { '@type': 'Brand', name: p.marca } } : {}),
    ...(p.ean ? { gtin13: p.ean } : {}),
    ...(p.descricaoExtra ? { description: p.descricaoExtra } : { description: desc }),
  };

  const schemaBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Catálogo', item: `${ORIGIN}/produtos` },
      { '@type': 'ListItem', position: 3, name: categoria.titulo, item: `${ORIGIN}/categorias/${categoria.slug}` },
      { '@type': 'ListItem', position: 4, name: p.nome, item: url },
    ],
  };

  const precoBlock = `
        <div class="produto-detalhe-preco">
          <div>
            <div class="label">Preço</div>
            <div class="valor" style="font-size: 18px; color: var(--text-muted);">Consulte pelo WhatsApp</div>
          </div>
        </div>`;

  const relacionadosHTML = relacionados.length ? `
    <section class="produtos-relacionados">
      <div class="container">
        <div class="section-header" style="margin-bottom: 28px;">
          <h2 style="font-size: 22px;">Outros itens de <span style="color: var(--brand);">${escapeHTML(categoria.titulo)}</span></h2>
        </div>
        <div class="produtos-grid">
          ${relacionados.map(r => {
            const imgRel = r.imagem
              ? `../${r.imagem}`
              : '../assets/img/placeholder.svg';
            return `
              <article class="produto-card">
                <a class="produto-img" href="${r.slug}.html" aria-label="Ver detalhes de ${escapeAttr(r.nome)}">
                  <img src="${escapeAttr(imgRel)}" alt="${escapeAttr(r.nome)}" loading="lazy" width="220" height="275">
                </a>
                <div class="produto-info">
                  ${r.marca ? `<span class="produto-marca">${escapeHTML(r.marca)}</span>` : ''}
                  <a class="produto-nome" href="${r.slug}.html">${escapeHTML(r.nome)}</a>
                </div>
              </article>`;
          }).join('')}
        </div>
        <div style="text-align: center; margin-top: 26px;">
          <a href="../produtos.html?cat=${categoria.slug}" class="btn btn-outline">Ver todos de ${escapeHTML(categoria.titulo)}</a>
        </div>
      </div>
    </section>
  ` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(titulo)}</title>
  <meta name="description" content="${escapeAttr(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url}">

  <meta property="og:type" content="product">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${escapeAttr(p.nome)}">
  <meta property="og:description" content="${escapeAttr(desc)}">
  <meta property="og:image" content="${imgAbsolute}">
  <meta property="og:image:width" content="800">
  <meta property="og:image:height" content="800">
  <meta property="og:site_name" content="Irmãos Robaski">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(p.nome)}">
  <meta name="twitter:description" content="${escapeAttr(desc)}">
  <meta name="twitter:image" content="${imgAbsolute}">

  ${HEAD_FONTS}
  <link rel="stylesheet" href="../assets/css/style.css?v=3">
  <link rel="icon" type="image/png" sizes="32x32" href="../assets/img/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/img/apple-touch-icon.png">

  <script type="application/ld+json">${JSON.stringify(schemaProduct)}</script>
  <script type="application/ld+json">${JSON.stringify(schemaBreadcrumb)}</script>
</head>
<body>

  <a href="#main-content" class="skip-link">Pular para o conteúdo</a>

${NAVBAR(1)}

  <main id="main-content">

  <div class="container">
    <div class="breadcrumb">
      <a href="../index.html">Home</a>
      <span class="sep">›</span>
      <a href="../produtos.html">Catálogo</a>
      <span class="sep">›</span>
      <a href="../categorias/${categoria.slug}.html">${escapeHTML(categoria.titulo)}</a>
      <span class="sep">›</span>
      <span class="atual">${escapeHTML(truncate(p.nome, 60))}</span>
    </div>
  </div>

  <main class="container">
    <div class="produto-detalhe">
      <div class="produto-detalhe-img">
        <img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(p.nome)}" loading="eager" width="500" height="500">
      </div>
      <div class="produto-detalhe-info">
        ${p.marca ? `<span class="produto-marca" style="font-size: 12px;">${escapeHTML(p.marca)}</span>` : ''}
        <h1>${escapeHTML(p.nome)}</h1>
        <div class="produto-detalhe-meta">
          <span>Categoria: <strong>${escapeHTML(categoria.titulo)}</strong></span>
          ${p.unidade ? `<span>Unidade: <strong>${escapeHTML(p.unidade)}</strong></span>` : ''}
          ${p.ean ? `<span>EAN: <strong>${escapeHTML(p.ean)}</strong></span>` : ''}
          <span>Cód.: <strong>${escapeHTML(p.id)}</strong></span>
        </div>

        ${precoBlock}

        <div class="produto-detalhe-acoes">
          <div class="qty-input">
            <button id="qty-dec" aria-label="Diminuir">−</button>
            <input id="qty-input" type="number" min="1" value="1" aria-label="Quantidade">
            <button id="qty-inc" aria-label="Aumentar">+</button>
          </div>
          <button class="btn btn-primary btn-lg" id="btn-add">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5-8M7 13l-2 9m12-9l2 9M9 21a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z"/></svg>
            Adicionar à lista
          </button>
          <a class="btn btn-whatsapp btn-lg" href="https://wa.me/${WHATSAPP}?text=Ol%C3%A1%21%20Tenho%20interesse%20no%20produto%3A%20${encodeURIComponent(p.nome)}%20%28c%C3%B3d.%20${encodeURIComponent(p.id)}%29." target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5l.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20"/></svg>
            Perguntar no WhatsApp
          </a>
        </div>

        <p style="margin-top: 18px; font-size: 12px; color: var(--text-soft); line-height: 1.6;">
          Preços e disponibilidade sujeitos a confirmação pelo vendedor. Catálogo de atacado para revenda.
        </p>
      </div>
    </div>
  </main>

  ${relacionadosHTML}

  </main>

  ${FOOTER(1)}

  ${WPP_FLOAT}

  <script>
    /* dados do produto pro botão "Adicionar à lista" */
    window.__PRODUTO__ = ${JSON.stringify({
      id: p.id, slug: p.slug, nome: p.nome,
      unidade: p.unidade, imagem: p.imagem, categoriaHumana: p.categoriaHumana,
    })};
  </script>
  <script src="../assets/js/main.js"></script>
  <script src="../assets/js/cart.js?v=3"></script>
  <script>
    /* Bind do qty + add to cart */
    document.addEventListener('DOMContentLoaded', () => {
      const input = document.getElementById('qty-input');
      document.getElementById('qty-dec').addEventListener('click', () => {
        input.value = Math.max(1, (parseInt(input.value) || 1) - 1);
      });
      document.getElementById('qty-inc').addEventListener('click', () => {
        input.value = (parseInt(input.value) || 1) + 1;
      });
      document.getElementById('btn-add').addEventListener('click', () => {
        const qtd = Math.max(1, parseInt(input.value) || 1);
        window.Cart.add(window.__PRODUTO__, qtd);
        window.Cart.openDrawer();
      });
    });
  </script>
</body>
</html>`;
}

/* ════════════════════════════════════════════════════════════════
   Página de categoria: categorias/{slug}.html
═══════════════════════════════════════════════════════════════ */

function paginaCategoria(cat, produtosCat) {
  const titulo = `${cat.titulo} no Atacado — ${cat.count} produtos | Irmãos Robaski`;
  const desc = truncate(`${cat.descricao} ${cat.count} produtos em estoque para pedido no WhatsApp.`, 158);
  const url = `${ORIGIN}/categorias/${cat.slug}`;

  // Schema ItemList — primeiros 24 produtos (limite razoável pra evitar payload gigante)
  const schemaItemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: cat.titulo,
    description: cat.descricao,
    url,
    numberOfItems: cat.count,
    itemListElement: produtosCat.slice(0, 24).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${ORIGIN}/p/${p.slug}`,
      name: p.nome,
    })),
  };

  const schemaBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Catálogo', item: `${ORIGIN}/produtos` },
      { '@type': 'ListItem', position: 3, name: cat.titulo, item: url },
    ],
  };

  const cardsHTML = produtosCat.map(p => {
    const imgSrc = p.imagem ? `../${p.imagem}` : '../assets/img/placeholder.svg';
    return `
      <article class="produto-card">
        <a class="produto-img" href="../p/${p.slug}.html" aria-label="Ver detalhes de ${escapeAttr(p.nome)}">
          <img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(p.nome)}" loading="lazy" width="220" height="275">
        </a>
        <div class="produto-info">
          ${p.marca ? `<span class="produto-marca">${escapeHTML(p.marca)}</span>` : ''}
          <a class="produto-nome" href="../p/${p.slug}.html">${escapeHTML(p.nome)}</a>
        </div>
      </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(titulo)}</title>
  <meta name="description" content="${escapeAttr(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url}">

  <meta property="og:type" content="website">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${escapeAttr(cat.titulo)} no Atacado | Irmãos Robaski">
  <meta property="og:description" content="${escapeAttr(desc)}">
  <meta property="og:image" content="${ORIGIN}/assets/img/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(cat.titulo)} no Atacado">
  <meta name="twitter:description" content="${escapeAttr(desc)}">
  <meta name="twitter:image" content="${ORIGIN}/assets/img/og-image.jpg">

  ${HEAD_FONTS}
  <link rel="stylesheet" href="../assets/css/style.css?v=3">
  <link rel="icon" type="image/png" sizes="32x32" href="../assets/img/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/img/apple-touch-icon.png">

  <script type="application/ld+json">${JSON.stringify(schemaItemList)}</script>
  <script type="application/ld+json">${JSON.stringify(schemaBreadcrumb)}</script>
</head>
<body>

  <a href="#main-content" class="skip-link">Pular para o conteúdo</a>

${NAVBAR(1)}

  <main id="main-content">

  <div class="container">
    <div class="breadcrumb">
      <a href="../index.html">Home</a>
      <span class="sep">›</span>
      <a href="../produtos.html">Catálogo</a>
      <span class="sep">›</span>
      <span class="atual">${escapeHTML(cat.titulo)}</span>
    </div>
    <h1 style="font-size: 30px; font-weight: 800; letter-spacing: -0.02em; margin: 6px 0 6px;">${escapeHTML(cat.titulo)} no Atacado</h1>
    <p style="color: var(--text-muted); max-width: 720px; margin-bottom: 12px;">${escapeHTML(cat.descricao)}</p>
    <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 24px;"><strong>${cat.count}</strong> produtos disponíveis nesta categoria.</p>
  </div>

  <div class="container" style="padding-bottom: 60px;">
    <div class="produtos-grid">
      ${cardsHTML}
    </div>
    <div style="text-align: center; margin-top: 36px;">
      <a href="../produtos.html?cat=${cat.slug}" class="btn btn-outline">Abrir cat. com filtros</a>
    </div>
  </div>

  </main>

  ${FOOTER(1)}
  ${WPP_FLOAT}

  <script src="../assets/js/main.js"></script>
  <script src="../assets/js/cart.js?v=3"></script>
</body>
</html>`;
}

/* ════════════════════════════════════════════════════════════════
   Sitemap.xml
═══════════════════════════════════════════════════════════════ */

function sitemap(produtos, categorias) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${ORIGIN}/`,            priority: '1.0', changefreq: 'weekly' },
    { loc: `${ORIGIN}/produtos`,    priority: '0.9', changefreq: 'weekly' },
    ...categorias.map(c => ({
      loc: `${ORIGIN}/categorias/${c.slug}`,
      priority: '0.8',
      changefreq: 'weekly',
    })),
    ...produtos.map(p => ({
      loc: `${ORIGIN}/p/${p.slug}`,
      priority: '0.6',
      changefreq: 'monthly',
    })),
  ];
  const body = urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

/* ════════════════════════════════════════════════════════════════
   Main
═══════════════════════════════════════════════════════════════ */

async function main() {
  console.log('[build] lendo datasets…');
  const produtos = JSON.parse(await readFile(join(DATA_DIR, 'produtos.json'), 'utf8'));
  const categorias = JSON.parse(await readFile(join(DATA_DIR, 'categorias.json'), 'utf8'));
  const catBySlug = Object.fromEntries(categorias.map(c => [c.slug, c]));

  // Limpa diretórios antes de regerar (evita órfãos quando produtos saem do XLSX)
  console.log('[build] limpando p/ e categorias/…');
  await rm(P_DIR, { recursive: true, force: true });
  await rm(CAT_DIR, { recursive: true, force: true });
  await mkdir(P_DIR, { recursive: true });
  await mkdir(CAT_DIR, { recursive: true });

  // Mapa produtos por categoria (pra "relacionados" e categorias)
  const porCategoria = {};
  for (const p of produtos) {
    (porCategoria[p.categoriaHumana] ||= []).push(p);
  }

  // ─── Páginas de produto ───
  console.log(`[build] gerando ${produtos.length} páginas /p/{slug}.html …`);
  let i = 0;
  const tStart = Date.now();
  const writeProdutos = produtos.map(async p => {
    const cat = catBySlug[p.categoriaHumana];
    if (!cat) { console.warn(`[build] categoria não encontrada: ${p.categoriaHumana} (produto ${p.id})`); return; }
    // 4 relacionados aleatórios da mesma categoria, excluindo o próprio
    const irmaos = porCategoria[cat.slug].filter(x => x.id !== p.id);
    const relacionados = shuffle(irmaos).slice(0, 4);
    const html = paginaProduto(p, cat, relacionados);
    await writeFile(join(P_DIR, `${p.slug}.html`), html, 'utf8');
    if (++i % 200 === 0) console.log(`  ${i} / ${produtos.length}`);
  });
  await Promise.all(writeProdutos);
  console.log(`[build] produtos OK em ${((Date.now() - tStart) / 1000).toFixed(1)}s`);

  // ─── Páginas de categoria ───
  console.log(`[build] gerando ${categorias.length} páginas /categorias/{slug}.html …`);
  await Promise.all(categorias.map(async c => {
    const prods = porCategoria[c.slug] || [];
    const html = paginaCategoria(c, prods);
    await writeFile(join(CAT_DIR, `${c.slug}.html`), html, 'utf8');
  }));

  // ─── Sitemap ───
  console.log('[build] gerando sitemap.xml …');
  await writeFile(join(SITE_DIR, 'sitemap.xml'), sitemap(produtos, categorias), 'utf8');

  console.log('\n[build] ✓ build completo');
  console.log(`  páginas de produto:    ${produtos.length}`);
  console.log(`  páginas de categoria:  ${categorias.length}`);
  console.log(`  URLs no sitemap:       ${produtos.length + categorias.length + 2}`);
}

main().catch(e => { console.error(e); process.exit(1); });
