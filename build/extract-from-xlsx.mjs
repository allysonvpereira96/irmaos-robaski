/**
 * extract-from-xlsx.mjs
 *
 * Lê clients/IRMAOS-ROBASKI/catálogo.xlsx e gera data/produtos-raw.json
 * com 1 registro por SKU, campos normalizados e slug.
 *
 * Saída intermediária — categoriaHumana ainda fica como ERP. O mapeamento
 * para as 16 categorias humanas acontece em mapear-categorias.mjs.
 *
 * Uso: node build/extract-from-xlsx.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR  = resolve(__dirname, '..');
const XLSX_PATH = resolve(SITE_DIR, '..', 'catálogo.xlsx');
const OUT_PATH  = resolve(SITE_DIR, 'data', 'produtos-raw.json');

/* Index das colunas da planilha (0-based, conferido na inspeção):
   0  Tipo de produto hierárquico
   1  Id produto                          ← usar
   2  Tipo de produto                     ← categoriaErp
   4  Descrição                           ← nome
   5  Descrição detalhada                 ← descricaoExtra
   6  Marca
   7  Referência
   9  Fabricante (código de fornecedor)
   12 Unidade de medida                   ← unidade
   17 Código de barras                    ← ean
   22 NCM
   30 Preço                               ← preco (PADRAO)
   32 Classificação                       ← "P_FISICA_BASE_PADRAO - R$ 19,43\nPADRAO - R$ 18,50"
   37 Data de inclusão
   39 Estoque atual                       ← (descartado por ora — vem como datetime do Excel)
*/
const COL = {
  id: 1, tipoProduto: 2, nome: 4, descricaoExtra: 5,
  marca: 6, referencia: 7, fabricante: 9, unidade: 12,
  ean: 17, ncm: 22, preco: 30, classificacaoPreco: 32,
  dataInclusao: 37,
};

/** Remove acentos e normaliza espaços/caracteres especiais para slug. */
function slugify(...parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                         // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, '')                             // trim hyphens
    .replace(/-{2,}/g, '-');                             // collapse hyphens
}

/** Extrai o preço de venda (PADRAO) do campo "Classificação" se o campo Preço estiver vazio. */
function parseClassificacao(s) {
  if (!s || typeof s !== 'string') return null;
  // "P_FISICA_BASE_PADRAO - R$ 19,43\r\nPADRAO - R$ 18,50"
  const m = s.match(/PADRAO\s*-\s*R\$\s*([\d,]+)/);
  if (!m) return null;
  return Number(m[1].replace(',', '.'));
}

/** Extrai o preço FÍSICA BASE PADRAO (varejo sugerido) — usado como "de R$ X, por R$ Y". */
function parseClassificacaoFisica(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/P_FISICA_BASE_PADRAO\s*-\s*R\$\s*([\d,]+)/);
  if (!m) return null;
  return Number(m[1].replace(',', '.'));
}

/** Limpa e converte EAN — XLSX às vezes lê com prefixo `\n` ou múltiplos códigos separados. */
function cleanEan(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Pode vir como "17896041171041\n 7896080900896" — pega o primeiro código
  const first = s.split(/[\s\n]+/)[0].trim();
  return /^\d{8,14}$/.test(first) ? first : null;
}

async function main() {
  console.log(`[extract] lendo ${XLSX_PATH}`);
  const buf = await readFile(XLSX_PATH);
  const wb  = xlsx.read(buf, { type: 'buffer', cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  const header = rows[0];
  const dataRows = rows.slice(1);
  console.log(`[extract] header lido (${header.length} colunas), ${dataRows.length} linhas de dados`);

  const stats = { total: 0, semPreco: 0, semCategoria: 0, semNome: 0, semEan: 0, slugDuplicado: 0 };
  const seenSlugs = new Map();
  const produtos = [];

  for (const row of dataRows) {
    const id        = row[COL.id];
    const nome      = row[COL.nome];
    const tipoErp   = row[COL.tipoProduto];
    const marca     = row[COL.marca] || null;
    const descExtra = row[COL.descricaoExtra] || null;
    const unidade   = row[COL.unidade] || null;
    const ean       = cleanEan(row[COL.ean]);
    const ncm       = row[COL.ncm] || null;

    let preco = (typeof row[COL.preco] === 'number' && row[COL.preco] > 0)
      ? row[COL.preco]
      : parseClassificacao(row[COL.classificacaoPreco]);
    const precoFisica = parseClassificacaoFisica(row[COL.classificacaoPreco]);

    if (!nome) { stats.semNome++; continue; }
    if (!preco) stats.semPreco++;
    if (!tipoErp) stats.semCategoria++;
    if (!ean) stats.semEan++;

    // slug: nome + id (id como sufixo garante unicidade)
    let slug = slugify(nome, id);
    if (seenSlugs.has(slug)) {
      stats.slugDuplicado++;
      slug = `${slug}-${stats.slugDuplicado}`;
    }
    seenSlugs.set(slug, true);

    produtos.push({
      id: id != null ? String(id) : null,
      slug,
      nome: nome.trim(),
      categoriaErp: tipoErp || null,
      categoriaHumana: null, // será preenchido em mapear-categorias.mjs
      marca: marca ? String(marca).trim() : null,
      preco: preco || null,
      precoFisica: precoFisica || null,
      unidade: unidade ? String(unidade).trim() : null,
      ean: ean || null,
      ncm: ncm ? String(ncm) : null,
      descricaoExtra: descExtra ? String(descExtra).trim() : null,
      imagem: null, // preenchido em scraper-imagens.mjs
    });

    stats.total++;
  }

  // Garante diretório
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(produtos, null, 2), 'utf8');

  console.log('[extract] estatísticas:');
  console.log(`  total parseado:      ${stats.total}`);
  console.log(`  sem nome (skip):     ${stats.semNome}`);
  console.log(`  sem preço:           ${stats.semPreco}`);
  console.log(`  sem categoria ERP:   ${stats.semCategoria}`);
  console.log(`  sem EAN:             ${stats.semEan}`);
  console.log(`  slugs duplicados:    ${stats.slugDuplicado}`);
  console.log(`[extract] gravado: ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
