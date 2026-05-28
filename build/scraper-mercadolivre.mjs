/**
 * scraper-mercadolivre.mjs
 *
 * Camada 3 do pipeline de imagens: busca pública na API do Mercado Livre.
 * Sem auth, sem token, sem custo.
 *
 * Estratégia:
 *  1. Pra cada produto Robaski ainda sem imagem, monta query (marca + tokens longos do nome)
 *  2. GET https://api.mercadolibre.com/sites/MLB/search?q=...&limit=5
 *  3. Filtra os 5 resultados por SIMILARIDADE de título (Fuse) + presença de marca
 *  4. Se score < threshold, baixa o thumbnail (-O.jpg → -F.jpg upgrade pra qualidade maior)
 *  5. Converte WebP, salva, atualiza produtos.json
 *
 * Uso: node build/scraper-mercadolivre.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Fuse from 'fuse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');
const DATA_DIR = join(SITE_DIR, 'data');
const IMG_DIR = join(SITE_DIR, 'assets', 'img', 'produtos');

const ML_API = 'https://api.mercadolibre.com/sites/MLB/search';
const UA = 'Mozilla/5.0 (Robaski-Site-Builder/1.0)';

const SCORE_MAX = 0.45;     // threshold de match com o título do anúncio
const PARALELOS = 6;        // pra não estourar rate limit do ML
const TIMEOUT_MS = 8000;    // timeout por requisição
const PROGRESS_EVERY = 50;  // log de progresso

/* ─── helpers ─── */
function normalize(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Constrói query para o ML — prioriza marca + tokens longos. */
function buildQuery(produto) {
  const tokens = normalize(produto.nome).split(' ');
  // Remove tokens muito curtos ou que são unidades (KG, ML, GR, LT, etc.)
  const unidades = new Set(['KG','GR','G','ML','LT','L','UN','CM','MM','MT','M','PCT','DP','CX','FD','CTL','UND','PCS','FRD']);
  const tokensRelevantes = tokens.filter(t => t.length >= 3 && !unidades.has(t) && !/^\d+$/.test(t));
  // Pega até 5 tokens (ex: "ABACAXI EM CALDA RODELAS BELLA" — sem números/unidades)
  const queryTokens = tokensRelevantes.slice(0, 5);
  return queryTokens.join(' ');
}

/** Verifica se um título do ML é match aceitável. */
function avaliarTitulo(produtoNome, mlTitulo, mlPriceCheck) {
  const tokensProduto = new Set(normalize(produtoNome).split(' ').filter(t => t.length >= 4));
  const tokensML = new Set(normalize(mlTitulo).split(' ').filter(t => t.length >= 4));
  // Pelo menos 50% dos tokens do produto devem estar no título do ML
  let matches = 0;
  for (const t of tokensProduto) if (tokensML.has(t)) matches++;
  const ratio = tokensProduto.size ? matches / tokensProduto.size : 0;
  return { ratio, matchedTokens: matches, totalTokens: tokensProduto.size };
}

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally { clearTimeout(t); }
}

/* ─── 1. busca no ML ─── */
async function buscarML(query) {
  const url = `${ML_API}?q=${encodeURIComponent(query)}&limit=5&category=MLB1403`; // MLB1403 = Alimentos e Bebidas — mas vamos remover filtro porque limpeza/embalagens não cabem
  // Vou tirar o filtro de categoria pra ser mais amplo:
  const url2 = `${ML_API}?q=${encodeURIComponent(query)}&limit=5`;
  const res = await fetchWithTimeout(url2, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.results || [];
}

/* ─── 2. baixa e converte imagem ─── */
async function downloadImagem(thumbnail, slug) {
  // Thumbnail do ML é tipo: https://http2.mlstatic.com/D_NQ_NP_xxxx-O.jpg
  // -O = pequeno (orig 200x200); -F (médio); -W (largo); -V (alta qualidade)
  // Vou trocar -O por -F pra pegar maior (até 500px)
  const url = thumbnail.replace(/-O\.(jpg|webp|png)/i, '-F.$1');
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em download`);
  const buf = Buffer.from(await res.arrayBuffer());
  const out = join(IMG_DIR, `${slug}.webp`);
  await sharp(buf)
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(out);
  return out;
}

/* ─── 3. concorrência limitada ─── */
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

/* ═══════════════════════════════════════════════════════════════ */
async function main() {
  await mkdir(IMG_DIR, { recursive: true });

  const produtosPath = join(DATA_DIR, 'produtos.json');
  const produtos = JSON.parse(await readFile(produtosPath, 'utf8'));
  const semFoto = produtos.filter(p => !p.imagem);
  console.log(`[ml] produtos sem foto: ${semFoto.length}`);

  const tStart = Date.now();
  let progress = 0;
  let acertos = 0;
  let semResultados = 0;
  let scoreBaixo = 0;
  let erros = 0;
  const detalhes = []; // pra CSV

  const results = await runWithLimit(semFoto, PARALELOS, async (p) => {
    progress++;
    if (progress % PROGRESS_EVERY === 0) {
      const pct = (progress * 100 / semFoto.length).toFixed(1);
      const t = ((Date.now() - tStart) / 1000).toFixed(0);
      console.log(`  [${t}s] ${progress}/${semFoto.length} (${pct}%) — ok=${acertos}, sem-res=${semResultados}, score-baixo=${scoreBaixo}`);
    }

    try {
      const q = buildQuery(p);
      if (q.split(' ').length < 2) { semResultados++; return { ok: false, reason: 'query muito curta' }; }
      const candidatos = await buscarML(q);
      if (!candidatos.length) { semResultados++; return { ok: false, reason: 'sem resultados' }; }

      // Pega o melhor candidato por similaridade de tokens
      let best = null, bestScore = -1;
      for (const c of candidatos) {
        const av = avaliarTitulo(p.nome, c.title);
        if (av.ratio > bestScore) { bestScore = av.ratio; best = { ...c, ratio: av.ratio }; }
      }

      // Threshold: 50%+ dos tokens grandes do produto devem aparecer no título do anúncio
      if (!best || bestScore < 0.5) {
        scoreBaixo++;
        return { ok: false, reason: 'score baixo', ratio: bestScore, sample: best?.title };
      }

      // Baixa imagem
      await downloadImagem(best.thumbnail, p.slug);
      acertos++;
      detalhes.push({ slug: p.slug, nome: p.nome, mlTitle: best.title, ratio: bestScore, ml_id: best.id });
      return { ok: true, slug: p.slug, ratio: bestScore };

    } catch (e) {
      erros++;
      return { ok: false, error: e.message };
    }
  });

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(0);
  console.log(`\n[ml] finalizado em ${elapsed}s`);
  console.log(`  acertos:        ${acertos}`);
  console.log(`  sem resultados: ${semResultados}`);
  console.log(`  score baixo:    ${scoreBaixo}`);
  console.log(`  erros HTTP:     ${erros}`);

  // Atualiza produtos.json
  const slugsOk = new Set(detalhes.map(d => d.slug));
  for (const p of produtos) {
    if (slugsOk.has(p.slug) && !p.imagem) {
      p.imagem = `assets/img/produtos/${p.slug}.webp`;
    }
  }
  await writeFile(produtosPath, JSON.stringify(produtos, null, 2), 'utf8');

  // Relatório
  const csvRows = ['slug,nome,ml_title,ml_id,ratio'];
  detalhes.forEach(d => csvRows.push([
    d.slug, JSON.stringify(d.nome), JSON.stringify(d.mlTitle), d.ml_id, d.ratio.toFixed(3),
  ].join(',')));
  await writeFile(join(DATA_DIR, 'relatorio-mercadolivre.csv'), csvRows.join('\n'), 'utf8');

  const totalComImagem = produtos.filter(p => p.imagem).length;
  console.log(`\n[ml] ✓ cobertura final: ${totalComImagem} / ${produtos.length} (${(totalComImagem * 100 / produtos.length).toFixed(1)}%)`);
  console.log('[ml] rode `npm run build` pra rebuildar as páginas.');
}

main().catch(e => { console.error(e); process.exit(1); });
