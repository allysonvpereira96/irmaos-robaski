import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const rows = await sql`
    SELECT slug, titulo, descricao, ordem, icone,
           (SELECT COUNT(*) FROM produtos p WHERE p.categoria_slug = c.slug AND p.ativo = TRUE)::int AS count
    FROM categorias c
    ORDER BY ordem ASC, titulo ASC
  `;
  return json(res, 200, { rows });
}
