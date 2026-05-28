/**
 * scraper-imagens.mjs
 *
 * Estratégia (zero firecrawl): o site atual (servicosgold.com.br) é server-side
 * rendered — todos os produtos com imagem já vêm no HTML. Basta baixar a home,
 * extrair (id, nome, descrição, imgUrl), cruzar com produtos.json por nome
 * (fuzzy via Fuse.js), baixar os PNGs do CDN e converter pra WebP.
 *
 * Saídas:
 *  - assets/img/produtos/{slug}.webp     ← imagens dos produtos com match
 *  - data/produtos.json                  ← atualizado com campo `imagem` preenchido
 *  - data/relatorio-cobertura.csv        ← match + score + sem-match (pra auditoria)
 *
 * Uso: node build/scraper-imagens.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Fuse from 'fuse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');
const DATA_DIR = join(SITE_DIR, 'data');
const IMG_DIR  = join(SITE_DIR, 'assets', 'img', 'produtos');

const SRC_URL = 'https://irmaosrobaskiltda.servicosgold.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const FUSE_THRESHOLD = 0.40;  // 0 = match exato; 0.40 = tolera "AQUALEVE 5L" ↔ "AQUALEVE" (foto base)
const MAX_PARALELOS = 25;     // requisições simultâneas pro CDN
const MIN_MATCH_LEN = 4;      // ignora candidatos com nome curto demais (evita falsos positivos)
const ALLOW_REUSE = true;     // permite 1 imagem do site servir N variações de embalagem do ERP

/* ─── helpers ─── */
function normalize(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ─── 1. Baixa o HTML do site atual ─── */
async function fetchHomeHtml() {
  console.log(`[scrape] baixando ${SRC_URL} …`);
  const res = await fetch(SRC_URL, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  console.log(`[scrape] HTML: ${(html.length / 1024).toFixed(0)} KB`);
  return html;
}

/* ─── 2. Extrai (id, nome, descricao, imgUrl) do HTML ─── */
function parseProdutosDoSite(html) {
  // Split pelo data-product-id e processa cada bloco
  const blocos = html.split(/data-product-id=["'](\d+)["']/);
  const produtos = [];
  for (let i = 1; i < blocos.length; i += 2) {
    const id = blocos[i];
    const corpo = blocos[i + 1].slice(0, 5000);
    const imgM = corpo.match(/<img[^>]*src=["'](https:\/\/files\.nextgocard\.com\.br\/products\/[^"']+\.png)["']/);
    if (!imgM) continue;
    const detM = corpo.match(/<div\s+class=["']details["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
    if (!detM) continue;
    const nome = detM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const descM = corpo.match(/<div\s+class=["']description["'][^>]*>([\s\S]*?)<\/div>/);
    const descricao = descM ? descM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    produtos.push({ id, nome, descricao, imgUrl: imgM[1], nomeNorm: normalize(nome + ' ' + descricao) });
  }
  return produtos;
}

/* ─── 3. Cruza produtos do XLSX com produtos do site usando Fuse.js ─── */
function cruzar(produtosErp, produtosSite) {
  const fuse = new Fuse(produtosSite, {
    keys: ['nomeNorm'],
    threshold: FUSE_THRESHOLD,
    ignoreLocation: true,
    minMatchCharLength: MIN_MATCH_LEN,
    includeScore: true,
  });
  const matches = [];
  const semMatch = [];

  for (const p of produtosErp) {
    const query = normalize(p.nome);
    const r = fuse.search(query, { limit: 3 });
    // Pega o melhor match abaixo do threshold (ALLOW_REUSE = 1:N)
    const ok = r[0];
    if (ok && ok.score <= FUSE_THRESHOLD) {
      matches.push({ erp: p, site: ok.item, score: ok.score });
    } else {
      semMatch.push(p);
    }
  }
  return { matches, semMatch };
}

/* ─── 4. Baixa o PNG e converte pra WebP ─── */
async function downloadAndConvert(imgUrl, outPath) {
  const res = await fetch(imgUrl, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${imgUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await sharp(buf)
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);
}

/* ─── 5. Limita concorrência ─── */
async function runWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   Main
═══════════════════════════════════════════════════════════════ */
async function main() {
  // Garante diretório de imagens
  await mkdir(IMG_DIR, { recursive: true });

  // Carrega produtos do XLSX
  const produtosPath = join(DATA_DIR, 'produtos.json');
  const produtos = JSON.parse(await readFile(produtosPath, 'utf8'));
  console.log(`[scrape] produtos do ERP: ${produtos.length}`);

  // Baixa + parse do site fonte
  const html = await fetchHomeHtml();
  const produtosSite = parseProdutosDoSite(html);
  console.log(`[scrape] produtos no NextGoCard: ${produtosSite.length}`);

  // Cruzamento
  console.log('[scrape] cruzando por nome (fuzzy Fuse.js)…');
  const { matches, semMatch } = cruzar(produtos, produtosSite);
  console.log(`[scrape] matches: ${matches.length} (${(matches.length * 100 / produtos.length).toFixed(1)}%)`);
  console.log(`[scrape] sem match: ${semMatch.length}`);

  // Mostra 10 melhores matches e 5 piores (pra sanity check antes de baixar)
  const sortedScore = [...matches].sort((a, b) => a.score - b.score);
  console.log('\n[scrape] melhores 5 matches (score baixo = mais confiança):');
  sortedScore.slice(0, 5).forEach(m =>
    console.log(`  ${m.score.toFixed(3)}  ERP: ${m.erp.nome}\n          SITE: ${m.site.nome}`)
  );
  console.log('\n[scrape] piores 5 matches:');
  sortedScore.slice(-5).forEach(m =>
    console.log(`  ${m.score.toFixed(3)}  ERP: ${m.erp.nome}\n          SITE: ${m.site.nome}`)
  );

  // Download em paralelo (com limite)
  console.log(`\n[scrape] baixando ${matches.length} imagens com concorrência ${MAX_PARALELOS}…`);
  const tStart = Date.now();
  let done = 0;
  const results = await runWithLimit(matches, MAX_PARALELOS, async (m) => {
    const out = join(IMG_DIR, `${m.erp.slug}.webp`);
    try {
      await downloadAndConvert(m.site.imgUrl, out);
      done++;
      if (done % 50 === 0) console.log(`  ${done} / ${matches.length}`);
      return { ok: true, slug: m.erp.slug, score: m.score };
    } catch (e) {
      return { ok: false, slug: m.erp.slug, error: e.message };
    }
  });
  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  console.log(`[scrape] download concluído em ${elapsed}s — ok: ${okCount}, falhou: ${failCount}`);

  // Atualiza produtos.json com paths
  const okSlugs = new Set(results.filter(r => r.ok).map(r => r.slug));
  for (const p of produtos) {
    if (okSlugs.has(p.slug)) {
      p.imagem = `assets/img/produtos/${p.slug}.webp`;
    } else {
      p.imagem = null;
    }
  }
  await writeFile(produtosPath, JSON.stringify(produtos, null, 2), 'utf8');
  console.log(`[scrape] produtos.json atualizado (${okCount} com campo imagem preenchido)`);

  // Relatório CSV (cobertura)
  const csvRows = [
    'slug,categoria,nome_erp,nome_site,score,imagem_arquivo,com_foto',
    ...matches.map(m => {
      const ok = okSlugs.has(m.erp.slug);
      return [
        m.erp.slug,
        m.erp.categoriaHumana,
        JSON.stringify(m.erp.nome),
        JSON.stringify(m.site.nome),
        m.score.toFixed(4),
        ok ? `assets/img/produtos/${m.erp.slug}.webp` : '',
        ok ? 'SIM' : 'FALHOU_DOWNLOAD',
      ].join(',');
    }),
    ...semMatch.map(p => [
      p.slug, p.categoriaHumana, JSON.stringify(p.nome), '', '', '', 'NAO',
    ].join(',')),
  ];
  await writeFile(join(DATA_DIR, 'relatorio-cobertura.csv'), csvRows.join('\n'), 'utf8');
  console.log(`[scrape] relatório: data/relatorio-cobertura.csv (${csvRows.length - 1} linhas)`);

  console.log('\n[scrape] ✓ concluído. Rode `npm run build` pra rebuildar as páginas com as imagens.');
}

main().catch(e => { console.error(e); process.exit(1); });
