/**
 * scraper-bing.mjs
 *
 * Camada de fallback: busca cada produto sem foto no Bing Images,
 * baixa o primeiro resultado que: (a) responda 200, (b) tenha >= 200x200,
 * (c) seja uma URL de imagem real (jpg/png/webp, não svg/gif/ico).
 *
 * Bing Images é público e mais tolerante a scraping do que Google.
 * Sem token, sem custo. Paralelismo conservador pra evitar captcha.
 *
 * Uso: node build/scraper-bing.mjs              # processa todos os produtos sem foto
 *      node build/scraper-bing.mjs --limit=50   # processa só 50 (teste)
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');
const DATA_DIR = join(SITE_DIR, 'data');
const IMG_DIR = join(SITE_DIR, 'assets', 'img', 'produtos');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const PARALELOS = 3;        // conservador pra não tomar captcha do Bing
const TIMEOUT_MS = 10000;
const MIN_IMG_PX = 200;     // ignora thumbs minúsculos (logos/ícones)
const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5MB max por imagem (download)
const PROGRESS_EVERY = 50;

// Args
const arg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = arg ? parseInt(arg.split('=')[1], 10) : Infinity;

/* ─── helpers ─── */
function normalize(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildQuery(p) {
  const tokens = normalize(p.nome).split(' ');
  const stop = new Set(['KG','GR','G','ML','LT','L','UN','CM','MM','MT','M','PCT','DP','CX','FD','UND','PCS','FRD','C']);
  const rel = tokens.filter(t => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));
  return rel.slice(0, 6).join(' ');
}

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally { clearTimeout(t); }
}

/** Faz busca no Bing Images e retorna até 10 URLs candidatas. */
async function buscarBing(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} na busca`);
  const html = await res.text();
  // Bing embeda em data-m JSON-encoded. Caça `&quot;murl&quot;:&quot;URL&quot;` pra extrair.
  const re = /&quot;murl&quot;:&quot;([^&]+)&quot;/g;
  const urls = [...html.matchAll(re)].map(m => m[1].replace(/\\u002f/g, '/'));
  // Filtra: jpg/png/webp, descarta svg/gif/ico/bmp e thumbs gigantes
  return urls.filter(u =>
    /\.(jpe?g|png|webp)(\?|$|#|&)/i.test(u) &&
    !u.includes('th.bing.com')   // skip thumbs do Bing
  ).slice(0, 10);
}

/** Baixa imagem e valida tamanho mínimo. */
async function downloadValid(url) {
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': UA, 'accept': 'image/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_IMG_BYTES) throw new Error(`muito grande (${contentLength})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('arquivo muito pequeno');
  // Verifica dimensões via sharp
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('sem dimensões');
  if (meta.width < MIN_IMG_PX || meta.height < MIN_IMG_PX) {
    throw new Error(`pequeno: ${meta.width}x${meta.height}`);
  }
  return buf;
}

/** Pra um produto, tenta baixar entre N candidatas até dar bom. */
async function tentarBaixar(produto, urls) {
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const buf = await downloadValid(url);
      const out = join(IMG_DIR, `${produto.slug}.webp`);
      await sharp(buf)
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(out);
      return { ok: true, urlEscolhida: url, posicao: i + 1 };
    } catch (e) {
      // tenta próxima
    }
  }
  return { ok: false, urlsTentadas: urls.length };
}

async function runWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { ok: false, error: e.message, slug: items[idx].slug }; }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

async function main() {
  await mkdir(IMG_DIR, { recursive: true });

  const produtosPath = join(DATA_DIR, 'produtos.json');
  const produtos = JSON.parse(await readFile(produtosPath, 'utf8'));
  const semFoto = produtos.filter(p => !p.imagem);
  const target = semFoto.slice(0, LIMIT);

  console.log(`[bing] produtos sem foto: ${semFoto.length}`);
  console.log(`[bing] processando: ${target.length}`);
  console.log(`[bing] paralelismo: ${PARALELOS}\n`);

  const tStart = Date.now();
  let progress = 0;
  let okCount = 0, semCandidatos = 0, todasFalharam = 0, erros = 0;
  const detalhes = [];

  await runWithLimit(target, PARALELOS, async (p) => {
    progress++;
    if (progress % PROGRESS_EVERY === 0) {
      const sec = ((Date.now() - tStart) / 1000).toFixed(0);
      const pct = ((progress * 100) / target.length).toFixed(1);
      const rate = (progress / (Date.now() - tStart) * 1000).toFixed(2);
      console.log(`  [${sec}s] ${progress}/${target.length} (${pct}%) — ok=${okCount} | sem=${semCandidatos} | falha=${todasFalharam} | erros=${erros} | rate=${rate}/s`);
    }
    try {
      const q = buildQuery(p);
      if (q.split(' ').length < 2) { semCandidatos++; return; }
      const urls = await buscarBing(q);
      if (!urls.length) { semCandidatos++; return; }
      const r = await tentarBaixar(p, urls);
      if (r.ok) {
        okCount++;
        detalhes.push({ slug: p.slug, nome: p.nome, urlEscolhida: r.urlEscolhida, posicao: r.posicao });
      } else {
        todasFalharam++;
      }
    } catch (e) {
      erros++;
    }
  });

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(0);
  console.log(`\n[bing] finalizado em ${elapsed}s`);
  console.log(`  acertos:           ${okCount}`);
  console.log(`  sem candidatos:    ${semCandidatos}`);
  console.log(`  todas falharam:    ${todasFalharam}`);
  console.log(`  erros gerais:      ${erros}`);

  // Atualiza produtos.json
  const slugsOk = new Set(detalhes.map(d => d.slug));
  for (const p of produtos) {
    if (slugsOk.has(p.slug) && !p.imagem) {
      p.imagem = `assets/img/produtos/${p.slug}.webp`;
    }
  }
  await writeFile(produtosPath, JSON.stringify(produtos, null, 2), 'utf8');

  // Relatório
  const csvRows = ['slug,nome,url_imagem,posicao_no_resultado'];
  detalhes.forEach(d => csvRows.push([
    d.slug, JSON.stringify(d.nome), JSON.stringify(d.urlEscolhida), d.posicao,
  ].join(',')));
  await writeFile(join(DATA_DIR, 'relatorio-bing.csv'), csvRows.join('\n'), 'utf8');

  const totalComImagem = produtos.filter(p => p.imagem).length;
  console.log(`\n[bing] ✓ cobertura final: ${totalComImagem} / ${produtos.length} (${(totalComImagem * 100 / produtos.length).toFixed(1)}%)`);
  console.log('[bing] rode `npm run build` pra rebuildar as páginas.');
}

main().catch(e => { console.error(e); process.exit(1); });
