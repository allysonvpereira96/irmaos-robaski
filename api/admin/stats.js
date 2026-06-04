/**
 * /api/admin/stats — overview pro dashboard
 */
import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM produtos WHERE ativo = TRUE`;
  const [{ inativos }] = await sql`SELECT COUNT(*)::int AS inativos FROM produtos WHERE ativo = FALSE`;
  const [{ semfoto }] = await sql`SELECT COUNT(*)::int AS semfoto FROM produtos WHERE imagem_url IS NULL AND ativo = TRUE`;
  const [{ cats }] = await sql`SELECT COUNT(*)::int AS cats FROM categorias`;
  const recentes = await sql`
    SELECT al.acao, al.entidade, al.entidade_id, al.created_at, u.nome as user_nome
    FROM audit_log al LEFT JOIN admin_users u ON u.id = al.user_id
    ORDER BY al.created_at DESC LIMIT 10
  `;
  return json(res, 200, {
    total, inativos, semfoto, cats,
    recentes,
  });
}
