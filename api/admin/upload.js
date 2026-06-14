/**
 * /api/admin/upload — substitui foto de um produto.
 *
 * Recebe a imagem em base64 (JSON) e salva direto na coluna BYTEA do Postgres.
 * Não usa Vercel Blob (que ficou como Private store sem fluxo simples).
 *
 *   POST  body: { produto_id, mime: 'image/jpeg'|'image/png'|'image/webp', data: 'base64...' }
 *   → 200 { ok: true, imagem_url: '/api/imagem?slug=X&v=hash' }
 *
 * Processamento:
 *  - Decodifica base64 → buffer
 *  - sharp: resize 800x800 max (inside, sem ampliar) + WebP quality 82
 *  - UPDATE produtos com imagem_bytes, imagem_mime='image/webp', imagem_hash (sha1)
 *  - foto_status passa a 'ok' (validada manualmente)
 */

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json, error, readJsonBody } from '../../lib/http.mjs';

const MAX_BASE64_SIZE = 6 * 1024 * 1024;  // ~4.5 MB original após base64 inflate
const MIMES_ACEITOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (req.method !== 'POST') return error(res, 405, 'Use POST');

  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  const produto_id = String(body.produto_id || '').trim();
  const mime = String(body.mime || '').toLowerCase();
  const data = body.data || '';

  if (!produto_id) return error(res, 400, 'produto_id obrigatório');
  if (!MIMES_ACEITOS.has(mime)) return error(res, 400, `mime inválido (use ${[...MIMES_ACEITOS].join(', ')})`);
  if (!data || typeof data !== 'string') return error(res, 400, 'data (base64) obrigatório');
  if (data.length > MAX_BASE64_SIZE) return error(res, 413, `Imagem muito grande (max ${MAX_BASE64_SIZE} chars base64 ≈ 4.5 MB)`);

  let input;
  try { input = Buffer.from(data, 'base64'); }
  catch { return error(res, 400, 'data não é base64 válido'); }
  if (input.length < 100) return error(res, 400, 'Imagem vazia ou corrompida');

  // Confere se o produto existe e pega slug
  const [prod] = await sql`SELECT id, slug FROM produtos WHERE id = ${produto_id}`;
  if (!prod) return error(res, 404, 'Produto não encontrado');

  // Processa: redimensiona pra max 800px (inside) + WebP quality 82
  let processed;
  try {
    processed = await sharp(input)
      .rotate() // respeita orientação EXIF
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (e) {
    console.error('[upload] sharp falhou:', e.message);
    return error(res, 400, 'Não foi possível processar a imagem');
  }

  const hash = createHash('sha1').update(processed).digest('hex').slice(0, 16);

  await sql`
    UPDATE produtos
       SET imagem_bytes = ${processed}::bytea,
           imagem_mime  = 'image/webp',
           imagem_hash  = ${hash},
           imagem_url   = NULL,
           foto_status  = 'ok'
     WHERE id = ${produto_id}
  `;
  await sql`
    INSERT INTO audit_log (user_id, acao, entidade, entidade_id, detalhes)
    VALUES (${user.userId}, 'foto-upload', 'produto', ${produto_id},
            ${JSON.stringify({ mime: 'image/webp', bytes: processed.length, hash })})
  `;

  // Cache-buster via hash pra navegador puxar a imagem nova
  return json(res, 200, {
    ok: true,
    imagem_url: `/api/imagem?slug=${encodeURIComponent(prod.slug)}&v=${hash}`,
    bytes: processed.length,
    hash,
  });
}
