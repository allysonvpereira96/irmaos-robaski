/**
 * gerar-catalogo-pdf.mjs
 *
 * Gera um PDF A4 com todo o catálogo (1.972 produtos em 19 categorias),
 * usando Puppeteer (Chrome headless) pra renderizar HTML → PDF.
 *
 * Layout:
 *  - Capa (logo verde + dados)
 *  - Sumário (19 categorias + contagem)
 *  - Páginas por categoria: 6 produtos por página A4 (grid 2x3)
 *  - Contracapa (WhatsApp + dados de contato)
 *
 * Pre-otimização das imagens: WebP 800px → JPG 360px embedded, pra controlar
 * tamanho final do PDF (~20-30 MB esperado).
 *
 * Uso: node build/gerar-catalogo-pdf.mjs
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR   = resolve(__dirname, '..');
const DATA_DIR   = join(SITE_DIR, 'data');
const IMG_DIR    = join(SITE_DIR, 'assets', 'img', 'produtos');
const CACHE_DIR  = join(SITE_DIR, 'build', '.pdf-cache');     // JPGs otimizados
const PLACEHOLDER = join(SITE_DIR, 'assets', 'img', 'placeholder.svg');
const LOGO_PATH   = join(SITE_DIR, 'assets', 'img', 'logo.png');
const LOGO_WHITE  = join(SITE_DIR, 'assets', 'img', 'logo-white.png');
const OUT_PDF     = resolve(SITE_DIR, '..', 'catalogo-irmaos-robaski.pdf');

const IMG_WIDTH = 280;     // px no PDF (cards menores em 3 cols)
const PRODS_POR_PAGINA = 12;  // 3 cols × 4 linhas

/* ─── helpers ─── */
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function fileUrl(p) {
  return pathToFileURL(p).href;
}
async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/* ─── 1. Otimiza imagens uma vez (cache) ─── */
async function prepararImagens(produtos) {
  await mkdir(CACHE_DIR, { recursive: true });
  let convertidas = 0;
  let já = 0;
  let semFonte = 0;
  for (const p of produtos) {
    if (!p.imagem) { semFonte++; continue; }
    const src = join(SITE_DIR, p.imagem);
    const dst = join(CACHE_DIR, `${p.slug}.jpg`);
    if (await fileExists(dst)) { já++; continue; }
    if (!(await fileExists(src))) { semFonte++; continue; }
    try {
      await sharp(src)
        .flatten({ background: '#ffffff' })  // remove transparência (PDF não gosta)
        .resize({ width: IMG_WIDTH, height: IMG_WIDTH, fit: 'inside' })
        .jpeg({ quality: 78, progressive: true })
        .toFile(dst);
      convertidas++;
    } catch (e) {
      console.warn('[pdf] falhou img:', p.slug, e.message);
      semFonte++;
    }
  }
  console.log(`[pdf] imagens: convertidas=${convertidas} jaCache=${já} semFonte=${semFonte}`);
}

/* ─── 2. Monta HTML único ─── */
function montarHTML(produtos, categorias) {
  const css = `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { font-family: 'Inter', -apple-system, sans-serif; color: #0F1A14; }

    .page {
      width: 210mm; height: 297mm;
      page-break-after: always;
      page-break-inside: avoid;
      position: relative;
      overflow: hidden;
    }

    /* ── CAPA ── */
    .capa { background: #004020; color: #fff; padding: 28mm 18mm; display: flex; flex-direction: column; justify-content: space-between; }
    .capa-logo { width: 70mm; height: auto; margin: 0 auto 20mm; filter: brightness(0) invert(1); }
    .capa h1 { font-size: 36pt; font-weight: 800; line-height: 1.05; text-align: center; letter-spacing: -0.02em; margin-bottom: 10mm; }
    .capa h1 em { font-style: normal; color: #E8B547; }
    .capa-sub { text-align: center; font-size: 13pt; color: rgba(255,255,255,0.8); max-width: 130mm; margin: 0 auto 14mm; line-height: 1.4; }
    .capa-stats { display: flex; gap: 8mm; justify-content: center; padding: 8mm 0; border-top: 1px solid rgba(255,255,255,0.15); border-bottom: 1px solid rgba(255,255,255,0.15); }
    .capa-stat { text-align: center; }
    .capa-stat strong { display: block; font-size: 22pt; font-weight: 800; color: #E8B547; }
    .capa-stat span { font-size: 9pt; color: rgba(255,255,255,0.7); }
    .capa-foot { text-align: center; font-size: 10pt; color: rgba(255,255,255,0.6); letter-spacing: 0.06em; text-transform: uppercase; }

    /* ── SUMÁRIO ── */
    .sumario { padding: 22mm 18mm; }
    .sumario h2 { font-size: 26pt; font-weight: 800; color: #004020; margin-bottom: 4mm; letter-spacing: -0.02em; }
    .sumario-sub { color: #4A5A52; font-size: 11pt; margin-bottom: 14mm; }
    .sumario-list { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm 10mm; }
    .sumario-item { display: flex; justify-content: space-between; align-items: baseline; padding: 4mm 0; border-bottom: 1px dashed #DDE4DE; }
    .sumario-item .titulo { font-size: 12pt; font-weight: 600; color: #0F1A14; }
    .sumario-item .count { font-size: 10pt; color: #4A5A52; font-weight: 700; padding: 2pt 8pt; background: #F4F7F4; border-radius: 8pt; }

    /* ── PÁGINA DE CATEGORIA (header + grid) ── */
    .cat-header { padding: 10mm 14mm 6mm; border-bottom: 3px solid #004020; }
    .cat-header .eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: 0.15em; color: #E8B547; text-transform: uppercase; }
    .cat-header h2 { font-size: 22pt; font-weight: 800; color: #004020; margin-top: 1mm; letter-spacing: -0.02em; }
    .cat-header .desc { font-size: 9pt; color: #4A5A52; margin-top: 1mm; }
    .cat-header .count { font-size: 8pt; color: #7A8B82; margin-top: 1mm; }

    .cat-grid {
      padding: 5mm 12mm 10mm;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(4, 1fr);
      gap: 3mm;
      height: calc(100% - 32mm);
    }
    .prod-card {
      border: 1px solid #DDE4DE;
      border-radius: 2mm;
      padding: 2.5mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      background: #FBFAF6;
      overflow: hidden;
    }
    .prod-img-box {
      width: 100%; aspect-ratio: 1;
      background: #fff;
      border-radius: 1.5mm;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 2mm;
      overflow: hidden;
    }
    .prod-img-box img { max-width: 88%; max-height: 88%; object-fit: contain; }
    .prod-marca { font-size: 5.5pt; font-weight: 700; letter-spacing: 0.06em; color: #1A6238; text-transform: uppercase; margin-bottom: 0.5mm; }
    .prod-nome {
      font-size: 7pt; font-weight: 600;
      line-height: 1.2;
      color: #0F1A14;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden;
      max-height: 9mm;
    }
    .prod-sku { font-size: 5.5pt; color: #7A8B82; margin-top: auto; padding-top: 1.5mm; }

    /* page footer (number) */
    .page-num {
      position: absolute; bottom: 5mm; right: 14mm;
      font-size: 8pt; color: #7A8B82; letter-spacing: 0.05em;
    }
    .page-cat-foot {
      position: absolute; bottom: 5mm; left: 14mm;
      font-size: 8pt; color: #7A8B82; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 600;
    }

    /* CONTRACAPA */
    .contra { background: #004020; color: #fff; padding: 28mm 18mm; display: flex; flex-direction: column; justify-content: space-between; }
    .contra-logo { width: 50mm; margin: 0 auto 16mm; filter: brightness(0) invert(1); }
    .contra h2 { font-size: 28pt; font-weight: 800; text-align: center; letter-spacing: -0.02em; margin-bottom: 8mm; line-height: 1.1; }
    .contra h2 em { color: #E8B547; font-style: normal; }
    .contra-cta { background: #E8B547; color: #0F1A14; text-align: center; padding: 10mm; border-radius: 4mm; font-size: 16pt; font-weight: 700; margin: 0 auto; max-width: 130mm; }
    .contra-cta .num { font-size: 22pt; font-weight: 800; margin: 3mm 0; letter-spacing: 0.02em; }
    .contra-foot { text-align: center; font-size: 9pt; color: rgba(255,255,255,0.55); }
  `;

  // Imagem path → file:// URL (com fallback pra placeholder se não existir cache)
  function imgFor(p) {
    if (!p.imagem) return fileUrl(PLACEHOLDER);
    const cached = join(CACHE_DIR, `${p.slug}.jpg`);
    return fileUrl(cached);
  }

  // Capa
  const capa = `
  <section class="page capa">
    <div>
      <img src="${fileUrl(LOGO_WHITE)}" class="capa-logo" alt="">
      <h1>Catálogo de <em>Atacado</em><br>2026</h1>
      <p class="capa-sub">Mercearia, bebidas, limpeza, descartáveis, embalagens e utilidades — em um único fornecedor.</p>
    </div>
    <div class="capa-stats">
      <div class="capa-stat"><strong>${produtos.length}</strong><span>SKUS NO CATÁLOGO</span></div>
      <div class="capa-stat"><strong>${categorias.length}</strong><span>CATEGORIAS</span></div>
      <div class="capa-stat"><strong>WhatsApp</strong><span>PEDIDO EM 1 MENSAGEM</span></div>
    </div>
    <p class="capa-foot">Irmãos Robaski Ltda · Distribuidora Atacadista</p>
  </section>`;

  // Sumário
  const sumario = `
  <section class="page sumario">
    <h2>Sumário</h2>
    <p class="sumario-sub">Use a busca digital em <strong>irmaosrobaski.com.br</strong> para encontrar o produto rapidamente, ou navegue por categoria abaixo.</p>
    <div class="sumario-list">
      ${categorias.sort((a,b) => a.ordem - b.ordem).map(c => `
        <div class="sumario-item">
          <span class="titulo">${escapeHTML(c.titulo)}</span>
          <span class="count">${c.count} produtos</span>
        </div>
      `).join('')}
    </div>
    <div class="page-num">2</div>
  </section>`;

  // Páginas por categoria
  let pageNumber = 2;
  const categoriasOrdered = categorias.sort((a,b) => a.ordem - b.ordem);
  const paginasCategoria = categoriasOrdered.map(cat => {
    const prods = produtos.filter(p => p.categoriaHumana === cat.slug).sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const grupos = chunk(prods, PRODS_POR_PAGINA);
    return grupos.map((grupo, idxGrupo) => {
      pageNumber++;
      const isFirst = idxGrupo === 0;
      return `
      <section class="page">
        ${isFirst ? `
          <div class="cat-header">
            <div class="eyebrow">CATEGORIA</div>
            <h2>${escapeHTML(cat.titulo)}</h2>
            <div class="desc">${escapeHTML(cat.descricao)}</div>
            <div class="count">${cat.count} produtos · página ${idxGrupo + 1} de ${grupos.length}</div>
          </div>
        ` : `
          <div class="cat-header" style="padding: 6mm 14mm 4mm;">
            <div class="eyebrow">CATEGORIA · CONTINUAÇÃO</div>
            <h2 style="font-size: 16pt;">${escapeHTML(cat.titulo)}</h2>
            <div class="count">página ${idxGrupo + 1} de ${grupos.length}</div>
          </div>
        `}
        <div class="cat-grid">
          ${grupo.map(p => `
            <div class="prod-card">
              <div class="prod-img-box"><img src="${imgFor(p)}" alt=""></div>
              ${p.marca ? `<div class="prod-marca">${escapeHTML(p.marca)}</div>` : '<div class="prod-marca">&nbsp;</div>'}
              <div class="prod-nome">${escapeHTML(p.nome)}</div>
              <div class="prod-sku">Cód. ${escapeHTML(p.id)}</div>
            </div>
          `).join('')}
        </div>
        <div class="page-cat-foot">${escapeHTML(cat.titulo)}</div>
        <div class="page-num">${pageNumber}</div>
      </section>`;
    }).join('');
  }).join('');

  // Contracapa
  const contra = `
  <section class="page contra">
    <div>
      <img src="${fileUrl(LOGO_WHITE)}" class="contra-logo" alt="">
      <h2>Faça seu pedido <em>agora.</em></h2>
    </div>
    <div class="contra-cta">
      Envie sua lista no WhatsApp
      <div class="num">(51) 99999-9999</div>
      <div style="font-size: 10pt; font-weight: 500;">Confirmação de preço e disponibilidade na hora.</div>
    </div>
    <p class="contra-foot">irmaosrobaski.com.br · Catálogo digital com busca · ${produtos.length} produtos</p>
  </section>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${css}</style>
</head>
<body>
  ${capa}
  ${sumario}
  ${paginasCategoria}
  ${contra}
</body>
</html>`;
}

/* ═══════════════════════════════════════════════════════════════ */
async function main() {
  console.log('[pdf] carregando dados…');
  const produtos = JSON.parse(await readFile(join(DATA_DIR, 'produtos.json'), 'utf8'));
  const categorias = JSON.parse(await readFile(join(DATA_DIR, 'categorias.json'), 'utf8'));

  console.log('[pdf] preparando imagens (cache)…');
  const tImg = Date.now();
  await prepararImagens(produtos);
  console.log(`[pdf] imagens prontas em ${((Date.now() - tImg)/1000).toFixed(1)}s`);

  console.log('[pdf] montando HTML…');
  const html = montarHTML(produtos, categorias);
  const totalPaginasEsperadas = 2 +
    categorias.reduce((s, c) => s + Math.ceil(c.count / PRODS_POR_PAGINA), 0) + 1;
  console.log(`[pdf] páginas esperadas: ~${totalPaginasEsperadas}`);

  // Salva HTML pra debug
  await writeFile(join(CACHE_DIR, 'catalogo.html'), html, 'utf8');

  console.log('[pdf] iniciando puppeteer…');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1754 });

  // page.goto(file://) resolve corretamente as URLs de imagem (vs. setContent que
  // carrega no contexto about:blank e pode bloquear file://).
  const htmlPath = join(CACHE_DIR, 'catalogo.html');
  console.log('[pdf] carregando HTML via file://…');
  await page.goto(fileUrl(htmlPath), {
    waitUntil: 'networkidle0',
    timeout: 180_000,
  });

  console.log('[pdf] gerando PDF…');
  const tPdf = Date.now();
  await page.pdf({
    path: OUT_PDF,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    timeout: 300_000,
  });
  console.log(`[pdf] PDF gerado em ${((Date.now() - tPdf)/1000).toFixed(1)}s`);

  await browser.close();

  const st = await stat(OUT_PDF);
  console.log(`\n[pdf] ✓ ${OUT_PDF}`);
  console.log(`[pdf]   tamanho: ${(st.size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
