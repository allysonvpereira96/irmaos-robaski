/**
 * lib/db.mjs — cliente Neon Postgres serverless (compartilhado entre as
 * Vercel Functions e os scripts de build). Usa o driver oficial do Neon que
 * faz conexão por HTTP em vez de TCP — perfeito pra ambientes serverless.
 *
 * Em scripts locais (build/, db/), carrega .env.local automaticamente.
 * Em Vercel Functions, process.env já vem populado pela plataforma.
 */

import { neon } from '@neondatabase/serverless';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Em ambientes serverless da Vercel as vars já estão no process.env.
// Em scripts locais (rodando via `node db/...`), carrega .env.local manualmente.
if (!process.env.DATABASE_URL && !process.env.VERCEL) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, '..', '.env.local'),
    resolve(__dirname, '..', '.env'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) { dotenvConfig({ path: p }); break; }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada — defina em .env.local ou nas env vars do Vercel');
}

/**
 * `sql` é uma função tagged-template:
 *   const rows = await sql`SELECT * FROM produtos WHERE id = ${id}`;
 * Já faz parametrização contra SQL injection.
 */
export const sql = neon(process.env.DATABASE_URL);

/** Helper pra rodar com row mapping opcional. */
export async function query(strings, ...values) {
  return sql(strings, ...values);
}
