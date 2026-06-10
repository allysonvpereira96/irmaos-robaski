/**
 * /api/imagem?slug=X    (PÚBLICO — não exige auth)
 *
 * Serve a imagem do produto direto do Postgres (coluna imagem_bytes).
 *
 * Cabeçalhos de cache agressivos pra que o Vercel CDN cacheie a resposta:
 *   - Primeira request: ~150ms (banco → bytes → response)
 *   - Demais requests: ~20ms (CDN do Vercel)
 *
 * Cache-buster: usar ?v={imagem_hash} pra invalidar quando trocar a foto.
 */

import { sql } from '../lib/db.mjs';

const ONE_YEAR = 60 * 60 * 24 * 365;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug');
  if (!slug) {
    res.statusCode = 400;
    return res.end('slug obrigatório');
  }

  const rows = await sql(
    `SELECT imagem_bytes, imagem_mime, imagem_hash, foto_status
       FROM produtos
       WHERE slug = $1 AND ativo = TRUE
       LIMIT 1`,
    [slug]
  );
  const row = rows[0];

  if (!row || !row.imagem_bytes) {
    // 404 com cache curto pra evitar martelar o banco
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.end('Imagem não encontrada');
  }

  // Imagem marcada como errada: opcional ocultar do público
  if (row.foto_status === 'errada') {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.end('Imagem indisponível');
  }

  const buf = Buffer.isBuffer(row.imagem_bytes) ? row.imagem_bytes : Buffer.from(row.imagem_bytes);

  res.statusCode = 200;
  res.setHeader('Content-Type', row.imagem_mime || 'image/webp');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, s-maxage=${ONE_YEAR}, immutable`);
  if (row.imagem_hash) res.setHeader('ETag', `"${row.imagem_hash}"`);

  // If-None-Match → 304 Not Modified (economiza banda)
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && row.imagem_hash && ifNoneMatch.includes(row.imagem_hash)) {
    res.statusCode = 304;
    return res.end();
  }

  res.end(buf);
}
