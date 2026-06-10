/**
 * /api/admin/upload
 *
 * Gera URL assinada (signed URL) pro cliente fazer upload DIRETO no Vercel Blob —
 * sem proxy pelo Functions (mais rápido, menos custo).
 *
 * Frontend: usa `upload()` de `@vercel/blob/client` que negocia com este endpoint.
 */

/**
 * /api/admin/upload — TEMPORARIAMENTE DESABILITADO
 *
 * O Vercel Blob foi criado como Private store (que não pode ser alterado pra
 * Public depois da criação). O SDK v2 do @vercel/blob não tem fluxo simples
 * pra signed URLs públicas reutilizáveis nesse modo.
 *
 * Solução pendente: deletar o store atual via dashboard/CLI e recriar como
 * Public. Quando isso for resolvido, basta restaurar este arquivo pra versão
 * anterior (em `git log api/admin/upload.js`).
 *
 * O admin segue funcionando pra:
 *  - editar nome, marca, categoria, descrição, etc
 *  - marcar fotos como erradas / ok / com observação
 *  - excluir produtos
 *  - exportar CSV de sem-foto
 *  - aplicar mudanças no site público
 */
import { requireAuth } from '../../lib/auth.mjs';
import { error } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  return error(res, 503,
    'Upload de foto está temporariamente desabilitado. O Vercel Blob foi criado como Private store e precisa ser recriado como Public. Enquanto isso, edite os outros campos do produto ou marque a foto como errada.'
  );
}
