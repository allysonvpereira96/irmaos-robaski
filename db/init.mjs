/**
 * db/init.mjs — aplica o schema (db/schema.sql) no Neon sem precisar do psql.
 *
 * Uso: node db/init.mjs
 *
 * Idempotente (schema usa CREATE TABLE IF NOT EXISTS, etc).
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { sql } from '../lib/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const schema = await readFile(join(__dirname, 'schema.sql'), 'utf8');

  // Divide em statements respeitando blocos $$...$$ (funções) e comentários
  const statements = splitSQL(schema);
  console.log(`[init] ${statements.length} statements a executar`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i].trim();
    if (!stmt) continue;
    const preview = stmt.split('\n')[0].slice(0, 70);
    try {
      await sql.query(stmt);
      console.log(`  ✓ [${i + 1}/${statements.length}] ${preview}`);
    } catch (e) {
      console.error(`  ✗ [${i + 1}/${statements.length}] ${preview}`);
      console.error(`     ${e.message}`);
      throw e;
    }
  }

  console.log('\n[init] ✓ schema aplicado no Neon');
  const [{ table_count }] = await sql`
    SELECT COUNT(*)::int AS table_count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  console.log(`[init] ${table_count} tabelas em public`);
}

/** Split SQL respeitando blocos $$ ... $$ (funções) */
function splitSQL(sql) {
  const out = [];
  let buf = '';
  let inDollar = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      if (buf) buf += '\n';
      continue;
    }
    // Detecta abre/fecha $$
    let i = 0;
    while ((i = line.indexOf('$$', i)) !== -1) {
      inDollar = !inDollar;
      i += 2;
    }
    buf += line + '\n';
    if (!inDollar && line.includes(';')) {
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

main().catch(e => { console.error(e); process.exit(1); });
