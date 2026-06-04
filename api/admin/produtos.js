/**
 * /api/admin/produtos
 *  GET  → lista paginada (com busca, filtro de categoria/marca)
 *         ?page=1&size=50&q=...&cat=slug&marca=...&ativo=1
 *  POST → cria novo produto
 *         body: { id, slug, nome, categoria_slug, marca?, unidade?, ean?, ncm?, descricao_extra?, imagem_url?, preco?, preco_fisica? }
 */

import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json, error, readJsonBody, slugify } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET')  return list(req, res);
  if (req.method === 'POST') return create(req, res, user);
  return error(res, 405, 'Use GET ou POST');
}

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

  // monta WHERE dinâmico via template-tag
  const filters = [];
  if (q) filters.push(sql`(nome ILIKE ${'%' + q + '%'} OR id = ${q} OR ean = ${q})`);
  if (cat) filters.push(sql`categoria_slug = ${cat}`);
  if (marca) filters.push(sql`marca = ${marca}`);
  if (ativoFilter !== null) filters.push(sql`ativo = ${ativoFilter}`);

  const whereClause = filters.length
    ? filters.reduce((acc, f, i) => i === 0 ? sql`WHERE ${f}` : sql`${acc} AND ${f}`, sql``)
    : sql``;

  const rows = await sql`
    SELECT id, slug, nome, categoria_slug, marca, unidade, ean, imagem_url, ativo, updated_at
    FROM produtos
    ${whereClause}
    ORDER BY updated_at DESC, nome ASC
    LIMIT ${size} OFFSET ${offset}
  `;
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM produtos ${whereClause}`;

  return json(res, 200, { rows, total: count, page, size, pages: Math.ceil(count / size) });
}

async function create(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  const nome = String(body.nome || '').trim();
  const categoria_slug = String(body.categoria_slug || '').trim();
  if (!nome) return error(res, 400, 'Nome obrigatório');
  if (!categoria_slug) return error(res, 400, 'Categoria obrigatória');

  // ID: usa o passado, ou gera UUID curto baseado no slug
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
      RETURNING *
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
