/**
 * /api/admin/rebuild
 *
 * POST: dispara o Deploy Hook do Vercel pra rebuildar o site público
 * com os dados atuais do Neon. Resposta imediata; o rebuild leva ~30s.
 *
 * Cooldown: 1 trigger a cada 30s pra evitar spam.
 */

import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json, error } from '../../lib/http.mjs';

let lastTrigger = 0;
const COOLDOWN_MS = 30_000;

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (req.method !== 'POST') return error(res, 405, 'Use POST');

  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) return error(res, 500, 'VERCEL_DEPLOY_HOOK_URL não configurada');

  const now = Date.now();
  if (now - lastTrigger < COOLDOWN_MS) {
    return error(res, 429, `Aguarde ${Math.ceil((COOLDOWN_MS - (now - lastTrigger)) / 1000)}s antes de outro rebuild`);
  }
  lastTrigger = now;

  try {
    const response = await fetch(hookUrl, { method: 'POST' });
    if (!response.ok) throw new Error(`Hook respondeu ${response.status}`);

    await sql`
      INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
      VALUES (${user.userId}, 'rebuild', 'site', NULL, ${JSON.stringify({ hookStatus: response.status })})
    `;
    return json(res, 200, { ok: true, message: 'Rebuild disparado. O site público vai atualizar em ~30 segundos.' });
  } catch (e) {
    console.error(e);
    return error(res, 500, 'Falha ao disparar rebuild: ' + e.message);
  }
}
