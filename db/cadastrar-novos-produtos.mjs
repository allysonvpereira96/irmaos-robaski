/**
 * db/cadastrar-novos-produtos.mjs
 *
 * Cadastra novos produtos enviados pelo cliente no banco, busca foto via Bing
 * Images e faz upload BYTEA direto. Substitui o pipeline manual (XLSX → JSON →
 * scraper → migrate) quando são poucos produtos (até ~30).
 *
 * Uso: node db/cadastrar-novos-produtos.mjs
 *
 * Edite o array NOVOS_PRODUTOS abaixo antes de rodar.
 *
 * O que faz:
 *  1. UPSERT cada produto na tabela `produtos` (categoria humana + slug + marca).
 *  2. Busca uma foto no Bing Images, valida ≥200×200, baixa, otimiza p/ WebP 800.
 *  3. Faz UPDATE da imagem como BYTEA na linha do produto (mesmo padrão da
 *     upload-imagens-bytea.mjs — a `/api/imagem` resolve via CASE quando bytes
 *     IS NOT NULL).
 *  4. Imprime relatório no final (ok / sem foto / falha).
 *
 * Idempotente: ON CONFLICT (id) DO UPDATE pros campos editoriais; foto só é
 * sobrescrita se o produto AINDA não tem bytes (preserva uploads manuais via
 * painel).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config as dotenvConfig } from 'dotenv';
import { Pool } from '@neondatabase/serverless';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');

if (!process.env.DATABASE_URL && !process.env.VERCEL) {
  for (const p of [resolve(SITE_DIR, '.env.local'), resolve(SITE_DIR, '.env')]) {
    if (existsSync(p)) { dotenvConfig({ path: p }); break; }
  }
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');

/* ════════════════════════════════════════════════════════════════════════
   PRODUTOS A CADASTRAR
   - id          → SKU do ERP (string)
   - nome        → nome completo do produto
   - unidade     → "Unidade", "Caixa", "DP", "Fardo"…
   - categoriaErp→ categoria bruta do ERP (mapeada abaixo)
   - marca       → opcional; se não vier, tenta extrair do nome
═════════════════════════════════════════════════════════════════════════ */
const NOVOS_PRODUTOS = [
  { id: '4626', nome: 'PANO TOP 600 28X240M LIFE CLEAN',                            unidade: 'Unidade', categoriaErp: 'DESCARTAVEIS_SEM_ST_NEW', marca: 'LIFE CLEAN' },
  { id: '4625', nome: 'ASSADEIRA 4L LIFE CLEAN',                                    unidade: 'Unidade', categoriaErp: 'DESCARTAVEIS_SEM_ST_NEW', marca: 'LIFE CLEAN' },
  { id: '4624', nome: 'SACOLA 30X40 BRANCA GOLD CX C/1000',                         unidade: 'Caixa',   categoriaErp: 'SACOLAS_NEW',             marca: 'GOLD' },
  { id: '4623', nome: 'EMB. REDONDA ALTA TORTA GRANDE BP-60A BR. BOPACK',           unidade: 'Unidade', categoriaErp: 'POTES_BANDEJAS_NEW',      marca: 'BOPACK' },
  { id: '4622', nome: 'EMB. REDONDA ALTA TORTA PEQ. BP-50A BRANCA BOPACK',          unidade: 'Unidade', categoriaErp: 'POTES_BANDEJAS_NEW',      marca: 'BOPACK' },
  { id: '4621', nome: 'SAZON FLOPPY TOQUE ALHO 60GR',                               unidade: 'Unidade', categoriaErp: 'MOLHO_TOMATE_NEW',        marca: 'SAZON' },
  { id: '4620', nome: 'PEPINOS EM RODELAS AGRI DOCE HENMER 440GR',                  unidade: 'Unidade', categoriaErp: 'CONSERVAS_SEM_ST_NEW',    marca: 'HENMER' },
  { id: '4619', nome: 'VINHO ROSE SUAVE BORDO DELGRANO GOLD 750ML',                 unidade: 'Unidade', categoriaErp: 'BEBIDA_VII_NEW',          marca: 'DELGRANO' },
  { id: '4618', nome: 'SACO DE LIXO 100LT JUNIOR 0,7',                              unidade: 'Unidade', categoriaErp: 'SACO_LIXO_II_NEW',        marca: 'JUNIOR' },
  { id: '4617', nome: 'BASE RETA COM HASTE PVC VERDE',                              unidade: 'Unidade', categoriaErp: 'BOBINAS_NEW',             marca: null },
  { id: '4616', nome: 'ETIQUETA 90X30 OH NAD GL SER. TR. BR. SUPRIMAX C/2UN',       unidade: 'DP',      categoriaErp: 'ETIQUETA_III_NEW',        marca: 'SUPRIMAX' },
  { id: '4615', nome: 'FOLHA DE OFICIO A4 OFFICE PAPER C/500 FOLHAS',               unidade: 'Unidade', categoriaErp: 'UTILIDADE_NEW',           marca: 'OFFICE PAPER' },
  { id: '4614', nome: 'FITA ADESIVA TRANSPARENTE',                                  unidade: 'Unidade', categoriaErp: 'UTILIDADE_NEW',           marca: null },
];

/* ERP → categoria humana (mesmo dicionário do build/mapear-categorias.mjs) */
const ERP_TO_HUMANA = {
  DESCARTAVEIS_SEM_ST_NEW: 'descartaveis',
  SACOLAS_NEW: 'embalagens',
  POTES_BANDEJAS_NEW: 'embalagens',
  MOLHO_TOMATE_NEW: 'molhos-e-conservas',
  CONSERVAS_SEM_ST_NEW: 'molhos-e-conservas',
  BEBIDA_VII_NEW: 'vinhos-e-espumantes',
  SACO_LIXO_II_NEW: 'limpeza',
  BOBINAS_NEW: 'embalagens',
  ETIQUETA_III_NEW: 'embalagens',
  UTILIDADE_NEW: 'utilidades-domesticas',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const TIMEOUT_MS = 10000;
const MIN_IMG_PX = 200;
const MAX_IMG_BYTES = 5 * 1024 * 1024;

/* ─── slug ─── */
function slugify(nome, id) {
  const base = nome
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return `${base}-${id}`;
}

/* ─── busca foto Bing ─── */
function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function buildQuery(nome) {
  const tokens = normalize(nome).split(' ');
  const stop = new Set(['KG','GR','G','ML','LT','L','UN','CM','MM','MT','M','PCT','DP','CX','FD','UND','PCS','FRD','C']);
  const rel = tokens.filter(t => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));
  return rel.slice(0, 6).join(' ');
}
async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}
async function buscarBing(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
  const res = await fetchWithTimeout(url, {
    headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} na busca Bing`);
  const html = await res.text();
  const re = /&quot;murl&quot;:&quot;([^&]+)&quot;/g;
  const urls = [...html.matchAll(re)].map(m => m[1].replace(/\\u002f/g, '/'));
  return urls.filter(u =>
    /\.(jpe?g|png|webp)(\?|$|#|&)/i.test(u) && !u.includes('th.bing.com')
  ).slice(0, 12);
}
async function downloadValid(url) {
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': UA, 'accept': 'image/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_IMG_BYTES) throw new Error(`muito grande (${contentLength})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('arquivo muito pequeno');
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('sem dimensões');
  if (meta.width < MIN_IMG_PX || meta.height < MIN_IMG_PX) {
    throw new Error(`pequeno: ${meta.width}x${meta.height}`);
  }
  return buf;
}
async function buscarEOtimizar(nome) {
  const q = buildQuery(nome);
  if (q.split(' ').length < 2) return { ok: false, motivo: 'query curta' };
  let urls;
  try { urls = await buscarBing(q); }
  catch (e) { return { ok: false, motivo: `busca falhou: ${e.message}` }; }
  if (!urls.length) return { ok: false, motivo: 'zero candidatos' };
  for (let i = 0; i < urls.length; i++) {
    try {
      const buf = await downloadValid(urls[i]);
      const optimized = await sharp(buf)
        .rotate()
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      return { ok: true, buf: optimized, posicao: i + 1, url: urls[i], query: q };
    } catch (e) {
      /* tenta próxima */
    }
  }
  return { ok: false, motivo: `todas ${urls.length} candidatas falharam` };
}

/* ─── main ─── */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log(`[novo] ${NOVOS_PRODUTOS.length} produtos a cadastrar\n`);

  const relatorio = [];
  for (const p of NOVOS_PRODUTOS) {
    const categoria_slug = ERP_TO_HUMANA[p.categoriaErp];
    if (!categoria_slug) {
      console.error(`  ✗ ${p.id} ${p.nome} — categoria ERP "${p.categoriaErp}" não mapeada`);
      relatorio.push({ id: p.id, status: 'erro-categoria' });
      continue;
    }
    const slug = slugify(p.nome, p.id);

    /* 1. UPSERT produto */
    try {
      await pool.query(
        `INSERT INTO produtos (
           id, slug, nome, categoria_slug, categoria_erp, marca,
           unidade, foto_status, ativo
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', TRUE)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           nome = EXCLUDED.nome,
           categoria_slug = EXCLUDED.categoria_slug,
           categoria_erp = EXCLUDED.categoria_erp,
           marca = EXCLUDED.marca,
           unidade = EXCLUDED.unidade,
           ativo = TRUE`,
        [p.id, slug, p.nome, categoria_slug, p.categoriaErp, p.marca, p.unidade]
      );
      console.log(`  ✓ ${p.id} ${p.nome.slice(0, 50).padEnd(50)} [${categoria_slug}]`);
    } catch (e) {
      console.error(`  ✗ ${p.id} insert: ${e.message}`);
      relatorio.push({ id: p.id, slug, status: 'erro-insert', erro: e.message });
      continue;
    }

    /* 2. Já tem foto? skip */
    const { rows: jaFoto } = await pool.query(
      `SELECT 1 FROM produtos WHERE id = $1 AND imagem_bytes IS NOT NULL`,
      [p.id]
    );
    if (jaFoto.length) {
      console.log(`     ↳ já tem foto, pulando busca`);
      relatorio.push({ id: p.id, slug, status: 'ok-sem-foto-nova', categoria: categoria_slug });
      continue;
    }

    /* 3. Busca + valida + otimiza foto */
    const r = await buscarEOtimizar(p.nome);
    if (!r.ok) {
      console.log(`     ↳ sem foto: ${r.motivo}`);
      relatorio.push({ id: p.id, slug, status: 'sem-foto', motivo: r.motivo, categoria: categoria_slug });
      continue;
    }

    /* 4. UPDATE BYTEA */
    const hash = createHash('sha1').update(r.buf).digest('hex').slice(0, 16);
    try {
      await pool.query(
        `UPDATE produtos
           SET imagem_bytes = $1::bytea,
               imagem_mime  = 'image/webp',
               imagem_hash  = $2,
               foto_status  = 'auto'
         WHERE id = $3`,
        [r.buf, hash, p.id]
      );
      console.log(`     ↳ foto OK (${(r.buf.length / 1024).toFixed(0)}KB, pos #${r.posicao})`);
      relatorio.push({ id: p.id, slug, status: 'ok', categoria: categoria_slug, posicaoBing: r.posicao });
    } catch (e) {
      console.error(`     ↳ erro upload bytea: ${e.message}`);
      relatorio.push({ id: p.id, slug, status: 'erro-bytea', erro: e.message });
    }
  }

  /* relatório final */
  console.log('\n══════════ RELATÓRIO ══════════');
  const ok = relatorio.filter(r => r.status === 'ok').length;
  const semFoto = relatorio.filter(r => r.status === 'sem-foto').length;
  const erros = relatorio.filter(r => r.status.startsWith('erro')).length;
  console.log(`  cadastrados c/ foto: ${ok}`);
  console.log(`  cadastrados s/ foto: ${semFoto}`);
  console.log(`  erros:               ${erros}`);
  console.log('\nDetalhe:');
  for (const r of relatorio) {
    console.log(`  [${r.status.padEnd(10)}] ${r.id}  ${r.slug || ''}  ${r.motivo || r.erro || ''}`);
  }

  /* recontagem total */
  const { rows: t } = await pool.query(
    `SELECT COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE imagem_bytes IS NOT NULL)::int as com_foto
     FROM produtos WHERE ativo = TRUE`
  );
  console.log(`\n[novo] estado atual: ${t[0].total} produtos ativos · ${t[0].com_foto} com foto`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
