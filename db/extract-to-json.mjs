/**
 * db/extract-to-json.mjs
 *
 * Lê do Neon e gera data/produtos.json + data/categorias.json — usado pelo
 * build estático (build-site.mjs).
 *
 * Roda automaticamente antes do `npm run build` quando o build vier do banco
 * (configurar em package.json e no buildCommand do Vercel).
 *
 * Uso: node db/extract-to-json.mjs
 */

import { writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { sql } from '../lib/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

async function main() {
  console.log('[extract-db] lendo categorias…');
  const categoriasRows = await sql`
    SELECT slug, titulo, descricao, ordem, icone,
           (SELECT COUNT(*) FROM produtos p WHERE p.categoria_slug = c.slug AND p.ativo = TRUE)::int AS count
    FROM categorias c
    ORDER BY ordem ASC, titulo ASC
  `;

  console.log('[extract-db] lendo produtos…');
  const produtosRows = await sql`
    SELECT id, slug, nome, categoria_slug, categoria_erp, marca,
           preco, preco_fisica, unidade, ean, ncm, descricao_extra,
           imagem_url, foto_status
    FROM produtos
    WHERE ativo = TRUE
    ORDER BY nome ASC
  `;

  // Adapta o shape pra ser idêntico ao que o build-site.mjs espera
  const produtos = produtosRows.map(r => ({
    id: r.id,
    slug: r.slug,
    nome: r.nome,
    categoriaErp: r.categoria_erp,
    categoriaHumana: r.categoria_slug,
    marca: r.marca,
    preco: r.preco != null ? Number(r.preco) : null,
    precoFisica: r.preco_fisica != null ? Number(r.preco_fisica) : null,
    unidade: r.unidade,
    ean: r.ean,
    ncm: r.ncm,
    descricaoExtra: r.descricao_extra,
    // imagens "erradas" são filtradas do site público (não rendem nas páginas)
    imagem: r.imagem_url && r.foto_status !== 'errada'
      ? r.imagem_url.replace(/^\//, '')
      : null,
  }));

  const categorias = categoriasRows.map(r => ({
    slug: r.slug, titulo: r.titulo, descricao: r.descricao,
    ordem: r.ordem, icone: r.icone, count: r.count,
  }));

  await writeFile(join(DATA_DIR, 'produtos.json'),   JSON.stringify(produtos,   null, 2), 'utf8');
  await writeFile(join(DATA_DIR, 'categorias.json'), JSON.stringify(categorias, null, 2), 'utf8');
  console.log(`[extract-db] ✓ ${produtos.length} produtos, ${categorias.length} categorias gravados em data/`);
}

main().catch(e => { console.error(e); process.exit(1); });
