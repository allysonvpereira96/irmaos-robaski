/**
 * /api/health — diagnóstico simples (não exige auth)
 *
 * Mostra apenas SE as env vars existem e têm valor (sem expor valores).
 * Útil pra diagnosticar problemas de configuração no Vercel.
 */

export default async function handler(req, res) {
  const env = process.env;
  const check = (name) => {
    const v = env[name];
    if (v == null) return 'AUSENTE';
    if (v === '') return 'VAZIA';
    return `OK (${v.length} chars)`;
  };

  let dbOk = 'NÃO TESTADO';
  if (env.DATABASE_URL) {
    try {
      const { sql } = await import('../lib/db.mjs');
      const r = await sql`SELECT 1 AS ok`;
      dbOk = r[0]?.ok === 1 ? 'CONECTOU' : 'INESPERADO';
    } catch (e) {
      dbOk = 'FALHOU: ' + e.message.slice(0, 100);
    }
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({
    runtime: env.VERCEL_REGION || 'local',
    env: env.VERCEL_ENV || 'local',
    deployment_url: env.VERCEL_URL || null,
    vars: {
      DATABASE_URL: check('DATABASE_URL'),
      JWT_SECRET: check('JWT_SECRET'),
      BLOB_READ_WRITE_TOKEN: check('BLOB_READ_WRITE_TOKEN'),
      VERCEL_DEPLOY_HOOK_URL: check('VERCEL_DEPLOY_HOOK_URL'),
      POSTGRES_URL: check('POSTGRES_URL'),
    },
    db_connection: dbOk,
    timestamp: new Date().toISOString(),
  }, null, 2));
}
