/**
 * /api/admin/foto
 *
 * Endpoints rápidos pra gestão de foto sem precisar editar o produto inteiro.
 *
 *  PATCH ?id=X  body: { imagem_url?, foto_status?, foto_observacao? }
 *    - troca a URL da imagem
 *    - muda status ('ok' | 'auto' | 'errada' | 'pendente')
 *    - registra observação livre da dona
 *
 *  DELETE ?id=X
 *    - remove a imagem do produto (set imagem_url = NULL, status = 'pendente')
 *    - o blob no Vercel Blob NÃO é apagado (auditoria); só limpa o vínculo
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
  if (!id) return error(res, 400, 'id é obrigatório');

  if (req.method === 'PATCH')  return patch(id, req, res, user);
  if (req.method === 'DELETE') return remove(id, res, user);
  return error(res, 405, 'Use PATCH ou DELETE');
}

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

  // Auto-ajusta status quando troca a foto
  if ('imagem_url' in updates && !('foto_status' in updates)) {
    if (!updates.imagem_url) updates.foto_status = 'pendente';
    else updates.foto_status = 'ok';  // upload manual = considerado validado
  }

  const cols = Object.keys(updates);
  const vals = Object.values(updates);
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const queryStr = `UPDATE produtos SET ${setClause} WHERE id = $${cols.length + 1} RETURNING id, slug, nome, imagem_url, foto_status, foto_observacao`;
  const params = [...vals, id];

  try {
    const result = await sql.query(queryStr, params);
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

async function remove(id, res, user) {
  const result = await sql`
    UPDATE produtos
    SET imagem_url = NULL, foto_status = 'pendente'
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
