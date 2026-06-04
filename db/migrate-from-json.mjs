/**
 * db/migrate-from-json.mjs
 *
 * Migra os dados iniciais (categorias.json + produtos.json gerados pelo
 * pipeline XLSX) para o Neon. Idempotente: usa ON CONFLICT pra upsert.
 *
 * Uso: node db/migrate-from-json.mjs
 *
 * Pré-requisitos:
 *  - DATABASE_URL configurada em .env.local
 *  - Schema aplicado: psql $DATABASE_URL -f db/schema.sql
 *  - data/produtos.json e data/categorias.json existentes
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { sql } from '../lib/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

async function main() {
  console.log('[migrate] lendo data/categorias.json + data/produtos.json…');
  const categorias = JSON.parse(await readFile(join(DATA_DIR, 'categorias.json'), 'utf8'));
  const produtos   = JSON.parse(await readFile(join(DATA_DIR, 'produtos.json'),   'utf8'));
  console.log(`[migrate] ${categorias.length} categorias, ${produtos.length} produtos`);

  // ── Categorias ──
  console.log('[migrate] upsert categorias…');
  for (const c of categorias) {
    await sql`
      INSERT INTO categorias (slug, titulo, descricao, ordem, icone)
      VALUES (${c.slug}, ${c.titulo}, ${c.descricao}, ${c.ordem}, ${c.icone})
      ON CONFLICT (slug) DO UPDATE
        SET titulo = EXCLUDED.titulo,
            descricao = EXCLUDED.descricao,
            ordem = EXCLUDED.ordem,
            icone = EXCLUDED.icone
    `;
  }
  console.log(`[migrate] ${categorias.length} categorias OK`);

  // ── Produtos ── (batch pra ser rápido)
  console.log('[migrate] upsert produtos…');
  let ok = 0, fail = 0;
  for (const p of produtos) {
    try {
      await sql`
        INSERT INTO produtos (
          id, slug, nome, categoria_slug, categoria_erp, marca,
          preco, preco_fisica, unidade, ean, ncm, descricao_extra, imagem_url, ativo
        ) VALUES (
          ${p.id}, ${p.slug}, ${p.nome}, ${p.categoriaHumana}, ${p.categoriaErp}, ${p.marca},
          ${p.preco}, ${p.precoFisica}, ${p.unidade}, ${p.ean}, ${p.ncm}, ${p.descricaoExtra},
          ${p.imagem ? `/${p.imagem}` : null}, TRUE
        )
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug,
          nome = EXCLUDED.nome,
          categoria_slug = EXCLUDED.categoria_slug,
          marca = EXCLUDED.marca,
          preco = EXCLUDED.preco,
          unidade = EXCLUDED.unidade,
          ean = EXCLUDED.ean,
          ncm = EXCLUDED.ncm,
          descricao_extra = EXCLUDED.descricao_extra,
          imagem_url = EXCLUDED.imagem_url
      `;
      ok++;
      if (ok % 200 === 0) console.log(`  ${ok} / ${produtos.length}`);
    } catch (e) {
      fail++;
      console.error(`  falhou id=${p.id} slug=${p.slug}: ${e.message}`);
    }
  }
  console.log(`[migrate] produtos: ok=${ok}, falhas=${fail}`);

  // Stats
  const [{ count: pc }] = await sql`SELECT COUNT(*)::int as count FROM produtos`;
  const [{ count: cc }] = await sql`SELECT COUNT(*)::int as count FROM categorias`;
  console.log(`\n[migrate] ✓ banco populado: ${pc} produtos, ${cc} categorias`);
}

main().catch(e => { console.error(e); process.exit(1); });
