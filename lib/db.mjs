/**
 * lib/db.mjs — cliente Neon Postgres serverless (compartilhado entre as
 * Vercel Functions e os scripts de build). Usa o driver oficial do Neon que
 * faz conexão por HTTP em vez de TCP — perfeito pra ambientes serverless.
 */

import { neon } from '@neondatabase/serverless';

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
