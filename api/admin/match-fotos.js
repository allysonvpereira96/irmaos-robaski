/**
 * /api/admin/match-fotos
 *
 * POST — recebe uma lista de nomes de arquivo e tenta casar com produtos do banco
 *        usando matching fuzzy (Fuse.js) sobre nome e slug.
 *
 *   body: { filenames: ['leite-condensado-piracanjuba-395g.jpg', 'cafe-pilao-500g.png', ...] }
 *
 *   retorna: {
 *     matches: [
 *       { filename, melhor: { produto_id, slug, nome, score, imagem_url_atual }, alternativas: [...3 outros] }
 *     ]
 *   }
 *
 * Usado no /admin/upload-massa.html — usuário arrasta N arquivos, o sistema
 * mostra a sugestão de match pra cada um, e o usuário confirma/ajusta antes de
 * fazer os uploads de fato.
 */

import Fuse from 'fuse.js';
import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';
import { json, error, readJsonBody } from '../../lib/http.mjs';

function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(jpe?g|png|webp|avif|gif)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  if (req.method !== 'POST') return error(res, 405, 'Use POST');

  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  const filenames = Array.isArray(body.filenames) ? body.filenames.slice(0, 200) : null;
  if (!filenames || !filenames.length) return error(res, 400, 'filenames (array) obrigatório');

  // Pega todos os produtos ativos (poderia paginar, mas 2k é tranquilo na memória)
  const produtos = await sql`
    SELECT id, slug, nome, marca, categoria_slug, imagem_url
    FROM produtos
    WHERE ativo = TRUE
  `;

  // Index pra Fuse com nome+marca normalizado
  const indexados = produtos.map(p => ({
    ...p,
    nomeNorm: normalize(p.nome + ' ' + (p.marca || '')),
    slugNorm: normalize(p.slug),
  }));

  const fuse = new Fuse(indexados, {
    keys: [
      { name: 'nomeNorm', weight: 0.6 },
      { name: 'slugNorm', weight: 0.4 },
    ],
    threshold: 0.45,
    ignoreLocation: true,
    minMatchCharLength: 3,
    includeScore: true,
  });

  const matches = filenames.map(filename => {
    const q = normalize(filename);
    if (q.length < 3) {
      return { filename, melhor: null, alternativas: [], avisos: ['nome muito curto'] };
    }
    const r = fuse.search(q, { limit: 4 });
    if (!r.length) return { filename, melhor: null, alternativas: [] };

    return {
      filename,
      melhor: {
        produto_id: r[0].item.id,
        slug: r[0].item.slug,
        nome: r[0].item.nome,
        marca: r[0].item.marca,
        score: Number(r[0].score.toFixed(3)),
        imagem_url_atual: r[0].item.imagem_url,
      },
      alternativas: r.slice(1).map(x => ({
        produto_id: x.item.id,
        nome: x.item.nome,
        marca: x.item.marca,
        score: Number(x.score.toFixed(3)),
      })),
    };
  });

  return json(res, 200, { matches, total_produtos: produtos.length });
}
