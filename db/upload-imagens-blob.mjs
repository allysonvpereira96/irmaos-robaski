/**
 * db/upload-imagens-blob.mjs
 *
 * Migra as ~1.970 imagens que estão em assets/img/produtos/*.webp pro Vercel Blob,
 * e atualiza produtos.imagem_url no Neon pras URLs novas do Blob.
 *
 * Roda 1 vez no setup. Depois, todas as imagens novas (via admin) já caem direto no Blob.
 *
 * Uso:
 *   BLOB_READ_WRITE_TOKEN=... DATABASE_URL=... node db/upload-imagens-blob.mjs
 *
 * Idempotente: skip imagens já migradas (imagem_url começa com https://).
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { put } from '@vercel/blob';
import { sql } from '../lib/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = resolve(__dirname, '..', 'assets', 'img', 'produtos');

const CONCURRENCY = 6;

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

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN não configurada (.env.local)');
    process.exit(1);
  }

  // Produtos do Neon com imagem local (path começa com assets/)
  const produtos = await sql`
    SELECT id, slug, imagem_url
    FROM produtos
    WHERE imagem_url IS NOT NULL AND imagem_url NOT LIKE 'https://%'
  `;
  console.log(`[blob-upload] ${produtos.length} imagens locais a migrar`);

  if (!produtos.length) {
    console.log('[blob-upload] nada a fazer.');
    return;
  }

  const t0 = Date.now();
  let ok = 0, fail = 0, skip = 0;

  await runWithLimit(produtos, CONCURRENCY, async (p, i) => {
    if (i % 50 === 0 && i > 0) {
      const sec = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  [${sec}s] ${i}/${produtos.length} (ok=${ok} fail=${fail})`);
    }
    try {
      const path = join(IMG_DIR, `${p.slug}.webp`);
      const buf = await readFile(path);
      const blob = await put(`produtos/${p.slug}.webp`, buf, {
        access: 'public',
        contentType: 'image/webp',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      await sql`UPDATE produtos SET imagem_url = ${blob.url} WHERE id = ${p.id}`;
      ok++;
    } catch (e) {
      if (e.code === 'ENOENT') { skip++; return; }
      fail++;
      console.error(`  falhou ${p.slug}: ${e.message}`);
    }
  });

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[blob-upload] ✓ concluído em ${dur}s`);
  console.log(`  uploads ok:    ${ok}`);
  console.log(`  arquivo n/e:   ${skip}`);
  console.log(`  falhas:        ${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
