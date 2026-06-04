/**
 * build/vercel-build.mjs — buildCommand do Vercel.
 *
 * Comportamento:
 *  - Se DATABASE_URL está configurada (banco Neon disponível) → extrai do banco e rebuilda
 *  - Senão → faz só o build a partir do data/produtos.json commitado no repo
 *
 * Roda automaticamente em cada deploy (ou quando o Deploy Hook é disparado pelo admin).
 */

import { spawnSync } from 'node:child_process';

function run(label, cmd, args) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`✗ Falhou: ${label} (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

if (process.env.DATABASE_URL) {
  console.log('[vercel-build] DATABASE_URL detectada — extraindo do Neon antes de buildar');
  run('Extract do Neon', 'node', ['db/extract-to-json.mjs']);
} else {
  console.log('[vercel-build] sem DATABASE_URL — usando produtos.json commitado no repo');
}

run('Build do site estático', 'node', ['build/build-site.mjs']);
console.log('\n✓ Build completo');
