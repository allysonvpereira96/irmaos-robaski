/**
 * db/upload-imagens-bytea.mjs
 *
 * Migra as imagens .webp de assets/img/produtos/ para colunas BYTEA da tabela
 * produtos no Neon. Substitui o pipeline anterior baseado em Vercel Blob.
 *
 * Idempotente: pula imagens já migradas (imagem_bytes IS NOT NULL).
 *
 * Uso: node db/upload-imagens-bytea.mjs
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config as dotenvConfig } from 'dotenv';
import { Pool } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');
const IMG_DIR  = join(SITE_DIR, 'assets', 'img', 'produtos');

// Carrega .env.local localmente
if (!process.env.DATABASE_URL && !process.env.VERCEL) {
  for (const p of [resolve(SITE_DIR, '.env.local'), resolve(SITE_DIR, '.env')]) {
    if (existsSync(p)) { dotenvConfig({ path: p }); break; }
  }
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');

const CONCURRENCY = 4; // poucas em paralelo (Postgres connection pool limitado)
const PROGRESS_EVERY = 100;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Lista os slugs que existem como arquivo
  const files = (await readdir(IMG_DIR)).filter(f => f.endsWith('.webp'));
  console.log(`[bytea] ${files.length} arquivos .webp em ${IMG_DIR}`);

  // Lista produtos que já têm imagem migrada (skip)
  const { rows: jaMigrados } = await pool.query(
    `SELECT slug FROM produtos WHERE imagem_bytes IS NOT NULL`
  );
  const skipSet = new Set(jaMigrados.map(r => r.slug));
  console.log(`[bytea] já migrados: ${skipSet.size}`);

  // Lista produtos que precisam de migração (têm o arquivo no disco)
  const todo = [];
  for (const f of files) {
    const slug = f.replace(/\.webp$/, '');
    if (skipSet.has(slug)) continue;
    todo.push({ slug, file: f });
  }
  console.log(`[bytea] a migrar: ${todo.length}`);

  let ok = 0, fail = 0, naoEncontrados = 0;
  const tStart = Date.now();

  // Concorrência limitada
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= todo.length) return;
      const { slug, file } = todo[idx];
      try {
        const buf = await readFile(join(IMG_DIR, file));
        const hash = createHash('sha1').update(buf).digest('hex').slice(0, 16);
        const result = await pool.query(
          `UPDATE produtos
              SET imagem_bytes = $1::bytea,
                  imagem_mime  = 'image/webp',
                  imagem_hash  = $2
              WHERE slug = $3
              RETURNING id`,
          [buf, hash, slug]
        );
        if (!result.rowCount) {
          naoEncontrados++;
          continue;
        }
        ok++;
        if (ok % PROGRESS_EVERY === 0) {
          const elapsed = ((Date.now() - tStart) / 1000).toFixed(0);
          console.log(`  [${elapsed}s] ${ok} / ${todo.length} migrados`);
        }
      } catch (e) {
        fail++;
        console.error(`  ✗ ${slug}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`\n[bytea] finalizado em ${elapsed}s`);
  console.log(`  migrados:        ${ok}`);
  console.log(`  não encontrados: ${naoEncontrados} (sem produto no banco)`);
  console.log(`  falhas:          ${fail}`);

  // Estado final
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE imagem_bytes IS NOT NULL)::int AS com_bytea,
      COUNT(*) FILTER (WHERE imagem_url IS NOT NULL)::int AS com_url,
      pg_size_pretty(SUM(LENGTH(imagem_bytes))) AS total_bytes
    FROM produtos
  `);
  console.log(`[bytea] estado do banco: ${stats[0].com_bytea} produtos com imagem (${stats[0].total_bytes})`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
