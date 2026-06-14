/**
 * /api/admin/fotos — endpoint consolidado de fotos
 *
 *  GET                  → galeria paginada (com stats globais)
 *    ?status=ok|auto|errada|pendente|sem-foto
 *    ?cat=slug&q=busca&page=1&size=60
 *
 *  PATCH ?id=X          → atualiza só imagem_url/foto_status/foto_observacao
 *  DELETE ?id=X         → remove imagem (status → pendente)
 *
 * Substitui fotos.js + foto.js (2 → 1 function) pra ficar dentro do
 * limite de 12 functions/deploy do Vercel Hobby.
 */

import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json, error, readJsonBody } from '../../lib/http.mjs';

const STATUS_VALIDOS = new Set(['ok', 'auto', 'errada', 'pendente']);

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');

  if (req.method === 'GET') return galeria(req, res);

  if (req.method === 'PATCH') {
    if (!id) return error(res, 400, 'id obrigatório pra PATCH');
    return patch(id, req, res, user);
  }
  if (req.method === 'DELETE') {
    if (!id) return error(res, 400, 'id obrigatório pra DELETE');
    return remove(id, res, user);
  }
  return error(res, 405, 'Use GET, PATCH ou DELETE');
}

/* ─── GET: galeria com filtros + stats ─── */
async function galeria(req, res) {
  const url = new URL(req.url, 'http://x');
  const status = url.searchParams.get('status') || '';
  const cat = url.searchParams.get('cat') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const size = Math.min(200, Math.max(1, parseInt(url.searchParams.get('size') || '60', 10)));
  const offset = (page - 1) * size;

  const conditions = ['ativo = TRUE'];
  const params = [];
  if (status === 'sem-foto') conditions.push('imagem_url IS NULL AND imagem_bytes IS NULL');
  else if (status) { params.push(status); conditions.push(`foto_status = $${params.length}`); }
  if (cat) { params.push(cat); conditions.push(`categoria_slug = $${params.length}`); }
  if (q) {
    params.push('%' + q + '%'); const pLike = params.length;
    params.push(q); const pEq = params.length;
    conditions.push(`(nome ILIKE $${pLike} OR id = $${pEq} OR ean = $${pEq})`);
  }
  const whereSQL = 'WHERE ' + conditions.join(' AND ');

  params.push(size);   const pSize = params.length;
  params.push(offset); const pOffset = params.length;

  // Retornamos URL do endpoint público /api/imagem pra cada produto com bytes
  const rows = await sql(`
    SELECT id, slug, nome, categoria_slug, marca,
           CASE
             WHEN imagem_bytes IS NOT NULL THEN '/api/imagem?slug=' || slug
             ELSE imagem_url
           END AS imagem_url,
           foto_status, foto_observacao, updated_at
    FROM produtos
    ${whereSQL}
    ORDER BY
      CASE foto_status WHEN 'errada' THEN 0 WHEN 'pendente' THEN 1 WHEN 'auto' THEN 2 ELSE 3 END,
      nome ASC
    LIMIT $${pSize} OFFSET $${pOffset}
  `, params);
  const countParams = params.slice(0, params.length - 2);
  const countResult = await sql(
    `SELECT COUNT(*)::int AS count FROM produtos ${whereSQL}`,
    countParams
  );

  const stats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE foto_status = 'ok' AND ativo)::int       AS ok,
      COUNT(*) FILTER (WHERE foto_status = 'auto' AND ativo)::int     AS auto,
      COUNT(*) FILTER (WHERE foto_status = 'errada' AND ativo)::int   AS errada,
      COUNT(*) FILTER (WHERE foto_status = 'pendente' AND ativo)::int AS pendente,
      COUNT(*) FILTER (WHERE imagem_url IS NULL AND imagem_bytes IS NULL AND ativo)::int AS sem_foto,
      COUNT(*) FILTER (WHERE ativo)::int                              AS total
    FROM produtos
  `;

  return json(res, 200, {
    rows, total: countResult[0].count, page, size,
    pages: Math.ceil(countResult[0].count / size),
    stats: stats[0],
  });
}

/* ─── PATCH ?id=X ─── */
async function patch(id, req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  const updates = {};
  if ('imagem_url' in body) updates.imagem_url = body.imagem_url || null;
  if ('foto_status' in body) {
    if (!STATUS_VALIDOS.has(body.foto_status)) {
      return error(res, 400, `foto_status inválido. Use: ${[...STATUS_VALIDOS].join(', ')}`);
    }
    updates.foto_status = body.foto_status;
  }
  if ('foto_observacao' in body) updates.foto_observacao = body.foto_observacao || null;

  if (!Object.keys(updates).length) return error(res, 400, 'Nada pra atualizar');

  if ('imagem_url' in updates && !('foto_status' in updates)) {
    if (!updates.imagem_url) updates.foto_status = 'pendente';
    else updates.foto_status = 'ok';
  }

  const cols = Object.keys(updates);
  const vals = Object.values(updates);
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const queryStr = `UPDATE produtos SET ${setClause} WHERE id = $${cols.length + 1} RETURNING id, slug, nome, imagem_url, foto_status, foto_observacao`;
  const params = [...vals, id];

  try {
    const result = await sql(queryStr, params);
    if (!result.length) return error(res, 404, 'Produto não encontrado');
    await sql`
      INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
      VALUES (${user.userId}, 'foto-update', 'produto', ${id}, ${JSON.stringify(updates)})
    `;
    return json(res, 200, { produto: result[0] });
  } catch (e) {
    console.error(e);
    return error(res, 500, 'Erro ao atualizar foto');
  }
}

/* ─── DELETE ?id=X (remove só a foto) ─── */
async function remove(id, res, user) {
  const result = await sql`
    UPDATE produtos
    SET imagem_url = NULL, imagem_bytes = NULL, foto_status = 'pendente'
    WHERE id = ${id}
    RETURNING id, slug, nome
  `;
  if (!result.length) return error(res, 404, 'Produto não encontrado');
  await sql`
    INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
    VALUES (${user.userId}, 'foto-remove', 'produto', ${id}, ${JSON.stringify({ status: 'pendente' })})
  `;
  return json(res, 200, { ok: true });
}
