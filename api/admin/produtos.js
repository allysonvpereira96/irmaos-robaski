/**
 * /api/admin/produtos — endpoint consolidado de produtos
 *
 *  GET                  → lista paginada (?page=1&size=50&q=...&cat=...&marca=...&ativo=1)
 *  GET    ?id=X         → busca 1 produto
 *  POST                 → cria novo produto
 *  PATCH  ?id=X         → atualiza campos parciais
 *  DELETE ?id=X         → soft delete (ativo=false)
 *  DELETE ?id=X&hard=1  → hard delete
 *
 * Substitui produtos.js + produto.js (2 → 1 function) pra ficar dentro do
 * limite de 12 functions/deploy do Vercel Hobby.
 */

import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json, error, readJsonBody, slugify } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');

  if (req.method === 'GET') {
    if (id) return getOne(id, res);
    return list(req, res);
  }
  if (req.method === 'POST')   return create(req, res, user);
  if (req.method === 'PATCH') {
    if (!id) return error(res, 400, 'id obrigatório pra PATCH');
    return update(id, req, res, user);
  }
  if (req.method === 'DELETE') {
    if (!id) return error(res, 400, 'id obrigatório pra DELETE');
    return remove(id, url, res, user);
  }
  return error(res, 405, 'Use GET, POST, PATCH ou DELETE');
}

/* ─── GET (lista paginada) ─── */
async function list(req, res) {
  const url = new URL(req.url, 'http://x');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const size = Math.min(200, Math.max(1, parseInt(url.searchParams.get('size') || '50', 10)));
  const offset = (page - 1) * size;
  const q = (url.searchParams.get('q') || '').trim();
  const cat = url.searchParams.get('cat') || '';
  const marca = url.searchParams.get('marca') || '';
  const ativoParam = url.searchParams.get('ativo');
  const ativoFilter = ativoParam === '0' ? false : ativoParam === '1' ? true : null;

  const conditions = [];
  const params = [];
  if (q) {
    params.push('%' + q + '%'); const pLike = params.length;
    params.push(q); const pEq = params.length;
    conditions.push(`(nome ILIKE $${pLike} OR id = $${pEq} OR ean = $${pEq})`);
  }
  if (cat) { params.push(cat); conditions.push(`categoria_slug = $${params.length}`); }
  if (marca) { params.push(marca); conditions.push(`marca = $${params.length}`); }
  if (ativoFilter !== null) { params.push(ativoFilter); conditions.push(`ativo = $${params.length}`); }
  const whereSQL = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  params.push(size);   const pSize = params.length;
  params.push(offset); const pOffset = params.length;
  // Resolve imagem_url: prioridade pra bytes no banco (via /api/imagem)
  const rows = await sql(`
    SELECT id, slug, nome, categoria_slug, marca, unidade, ean,
           CASE
             WHEN imagem_bytes IS NOT NULL THEN '/api/imagem?slug=' || slug
             ELSE imagem_url
           END AS imagem_url,
           foto_status, ativo, updated_at
    FROM produtos
    ${whereSQL}
    ORDER BY updated_at DESC, nome ASC
    LIMIT $${pSize} OFFSET $${pOffset}
  `, params);
  const countParams = params.slice(0, -2);
  const countResult = await sql(
    `SELECT COUNT(*)::int AS count FROM produtos ${whereSQL}`,
    countParams
  );
  return json(res, 200, {
    rows, total: countResult[0].count, page, size,
    pages: Math.ceil(countResult[0].count / size),
  });
}

/* ─── GET ?id=X (1 produto) ─── */
async function getOne(id, res) {
  // Não trazemos imagem_bytes (pesado). Mas se tiver bytes no banco, geramos
  // URL pra /api/imagem?slug=X (com cache-buster do hash).
  const rows = await sql`
    SELECT id, slug, nome, categoria_slug, categoria_erp, marca,
           preco, preco_fisica, unidade, ean, ncm, descricao_extra,
           foto_status, foto_observacao, ativo, created_at, updated_at,
           imagem_hash,
           CASE
             WHEN imagem_bytes IS NOT NULL THEN '/api/imagem?slug=' || slug || '&v=' || COALESCE(imagem_hash, '0')
             ELSE imagem_url
           END AS imagem_url
    FROM produtos WHERE id = ${id}
  `;
  const row = rows[0];
  if (!row) return error(res, 404, 'Produto não encontrado');
  return json(res, 200, { produto: row });
}

/* ─── POST (criar) ─── */
async function create(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  const nome = String(body.nome || '').trim();
  const categoria_slug = String(body.categoria_slug || '').trim();
  if (!nome) return error(res, 400, 'Nome obrigatório');
  if (!categoria_slug) return error(res, 400, 'Categoria obrigatória');

  let id = String(body.id || '').trim();
  let slug = (body.slug || slugify(nome)).trim();
  if (!id) id = `n${Date.now().toString(36)}`;
  if (!slug.includes('-' + id)) slug = `${slug}-${id}`.replace(/-{2,}/g, '-');

  try {
    const [row] = await sql`
      INSERT INTO produtos (
        id, slug, nome, categoria_slug, marca, preco, preco_fisica,
        unidade, ean, ncm, descricao_extra, imagem_url, ativo
      ) VALUES (
        ${id}, ${slug}, ${nome}, ${categoria_slug},
        ${body.marca || null}, ${body.preco || null}, ${body.preco_fisica || null},
        ${body.unidade || null}, ${body.ean || null}, ${body.ncm || null},
        ${body.descricao_extra || null}, ${body.imagem_url || null},
        ${body.ativo !== false}
      )
      RETURNING id, slug, nome, categoria_slug, marca, preco, unidade, ean, ncm, descricao_extra, ativo
    `;
    await sql`
      INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
      VALUES (${user.userId}, 'create', 'produto', ${id}, ${JSON.stringify({ slug, nome })})
    `;
    return json(res, 201, { produto: row });
  } catch (e) {
    if (e.message?.includes('unique')) return error(res, 409, 'ID ou slug já existe');
    console.error(e);
    return error(res, 500, 'Erro ao criar produto');
  }
}

/* ─── PATCH ?id=X (atualizar parcial) ─── */
const CAMPOS_ATUALIZAVEIS = [
  'nome', 'slug', 'categoria_slug', 'marca', 'preco', 'preco_fisica',
  'unidade', 'ean', 'ncm', 'descricao_extra', 'imagem_url', 'ativo',
];

async function update(id, req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  const updates = {};
  for (const k of CAMPOS_ATUALIZAVEIS) {
    if (k in body) updates[k] = body[k] === '' ? null : body[k];
  }
  if (Object.keys(updates).length === 0) {
    return error(res, 400, 'Nenhum campo válido pra atualizar');
  }

  const cols = Object.keys(updates);
  const vals = Object.values(updates);
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const queryStr = `UPDATE produtos SET ${setClause} WHERE id = $${cols.length + 1} RETURNING id, slug, nome, categoria_slug, marca, preco, unidade, ativo`;
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

/* ─── DELETE ?id=X (soft) ou ?id=X&hard=1 ─── */
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
