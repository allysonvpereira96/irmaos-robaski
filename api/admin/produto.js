/**
 * /api/admin/produto?id=XXX
 *  GET     → busca produto por id
 *  PATCH   → atualiza campos (parcial)
 *  DELETE  → marca ativo=false (soft delete) OU ?hard=1 pra remover de vez
 *
 * (Vercel Functions vanilla não tem [id].js dinâmico — usei querystring.)
 */

import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json, error, readJsonBody } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  if (!id) return error(res, 400, 'id é obrigatório');

  if (req.method === 'GET')    return getOne(id, res);
  if (req.method === 'PATCH')  return update(id, req, res, user);
  if (req.method === 'DELETE') return remove(id, url, res, user);
  return error(res, 405, 'Use GET, PATCH ou DELETE');
}

async function getOne(id, res) {
  const [row] = await sql`SELECT * FROM produtos WHERE id = ${id}`;
  if (!row) return error(res, 404, 'Produto não encontrado');
  return json(res, 200, { produto: row });
}

const CAMPOS_ATUALIZAVEIS = [
  'nome', 'slug', 'categoria_slug', 'marca', 'preco', 'preco_fisica',
  'unidade', 'ean', 'ncm', 'descricao_extra', 'imagem_url', 'ativo',
];

async function update(id, req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  // Pega só campos permitidos
  const updates = {};
  for (const k of CAMPOS_ATUALIZAVEIS) {
    if (k in body) updates[k] = body[k] === '' ? null : body[k];
  }
  if (Object.keys(updates).length === 0) {
    return error(res, 400, 'Nenhum campo válido pra atualizar');
  }

  // Constrói SET dinamicamente
  const setExprs = Object.entries(updates).map(([k, v], i) => sql`${sql.unsafe(k)} = ${v}`);
  // workaround: o driver Neon não suporta column names parametrizados.
  // Vou montar dinamicamente com strings whitelistadas (CAMPOS_ATUALIZAVEIS).
  // Usa raw query via tagged template em parts.
  const cols = Object.keys(updates);
  const vals = Object.values(updates);
  // Constrói query final manualmente (cols já validadas contra whitelist)
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const queryStr = `UPDATE produtos SET ${setClause} WHERE id = $${cols.length + 1} RETURNING *`;
  const params = [...vals, id];

  try {
    const result = await sql(queryStr, params);
    if (!result.length) return error(res, 404, 'Produto não encontrado');
    await sql`
      INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
      VALUES (${user.userId}, 'update', 'produto', ${id}, ${JSON.stringify(updates)})
    `;
    return json(res, 200, { produto: result[0] });
  } catch (e) {
    console.error(e);
    return error(res, 500, 'Erro ao atualizar');
  }
}

async function remove(id, url, res, user) {
  const hard = url.searchParams.get('hard') === '1';
  if (hard) {
    const result = await sql`DELETE FROM produtos WHERE id = ${id} RETURNING id`;
    if (!result.length) return error(res, 404, 'Produto não encontrado');
    await sql`
      INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
      VALUES (${user.userId}, 'delete', 'produto', ${id}, ${JSON.stringify({ hard: true })})
    `;
    return json(res, 200, { ok: true, hard: true });
  }
  const result = await sql`UPDATE produtos SET ativo = FALSE WHERE id = ${id} RETURNING id`;
  if (!result.length) return error(res, 404, 'Produto não encontrado');
  await sql`
    INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
    VALUES (${user.userId}, 'delete', 'produto', ${id}, ${JSON.stringify({ hard: false })})
  `;
  return json(res, 200, { ok: true, soft: true });
}
