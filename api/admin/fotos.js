/**
 * /api/admin/fotos
 *
 * GET — lista de produtos otimizada pra galeria de fotos no admin.
 *   Query params:
 *     ?status=ok|auto|errada|pendente|sem-foto
 *     ?cat=slug
 *     ?q=busca
 *     ?page=1&size=60
 *
 *   Retorno: { rows, total, page, size, pages, stats }
 *     stats = { ok, auto, errada, pendente, sem_foto } — contagens globais
 *             (não muda com filtro, sempre o total geral)
 */

import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const url = new URL(req.url, 'http://x');
  const status = url.searchParams.get('status') || '';   // '', 'ok', 'auto', 'errada', 'pendente', 'sem-foto'
  const cat = url.searchParams.get('cat') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const size = Math.min(200, Math.max(1, parseInt(url.searchParams.get('size') || '60', 10)));
  const offset = (page - 1) * size;

  // Filtros dinâmicos
  const filters = [sql`ativo = TRUE`];
  if (status === 'sem-foto') filters.push(sql`imagem_url IS NULL`);
  else if (status) filters.push(sql`foto_status = ${status}`);
  if (cat) filters.push(sql`categoria_slug = ${cat}`);
  if (q) filters.push(sql`(nome ILIKE ${'%' + q + '%'} OR id = ${q} OR ean = ${q})`);

  const whereClause = filters.reduce(
    (acc, f, i) => i === 0 ? sql`WHERE ${f}` : sql`${acc} AND ${f}`,
    sql``
  );

  const rows = await sql`
    SELECT id, slug, nome, categoria_slug, marca, imagem_url, foto_status, foto_observacao, updated_at
    FROM produtos
    ${whereClause}
    ORDER BY
      CASE foto_status WHEN 'errada' THEN 0 WHEN 'pendente' THEN 1 WHEN 'auto' THEN 2 ELSE 3 END,
      nome ASC
    LIMIT ${size} OFFSET ${offset}
  `;
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM produtos ${whereClause}`;

  // Stats globais (sempre fixas, sem aplicar filtro)
  const stats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE foto_status = 'ok' AND ativo)::int       AS ok,
      COUNT(*) FILTER (WHERE foto_status = 'auto' AND ativo)::int     AS auto,
      COUNT(*) FILTER (WHERE foto_status = 'errada' AND ativo)::int   AS errada,
      COUNT(*) FILTER (WHERE foto_status = 'pendente' AND ativo)::int AS pendente,
      COUNT(*) FILTER (WHERE imagem_url IS NULL AND ativo)::int       AS sem_foto,
      COUNT(*) FILTER (WHERE ativo)::int                              AS total
    FROM produtos
  `;

  return json(res, 200, {
    rows, total: count, page, size, pages: Math.ceil(count / size),
    stats: stats[0],
  });
}
