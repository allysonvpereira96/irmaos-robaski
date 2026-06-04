/**
 * /api/admin/upload
 *
 * Gera URL assinada (signed URL) pro cliente fazer upload DIRETO no Vercel Blob —
 * sem proxy pelo Functions (mais rápido, menos custo).
 *
 * Frontend: usa `upload()` de `@vercel/blob/client` que negocia com este endpoint.
 */

import { handleUpload } from '@vercel/blob/client';
import { requireAuth } from '../../lib/auth.mjs';
import { readJsonBody, error } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'POST') return error(res, 405, 'Use POST');

  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
        addRandomSuffix: true,
        maximumSizeInBytes: 8 * 1024 * 1024, // 8MB
        tokenPayload: JSON.stringify({ userId: user.userId, pathname }),
      }),
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // não precisamos persistir nada aqui — o frontend recebe blob.url
        // e envia no PATCH/POST do produto
        console.log('[upload] blob ok:', blob.url);
      },
    });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(jsonResponse));
  } catch (e) {
    console.error(e);
    return error(res, 500, e.message || 'Erro no upload');
  }
}
