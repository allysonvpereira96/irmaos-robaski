/**
 * /api/admin/sem-foto-csv
 *
 * GET → baixa um CSV com todos os produtos sem foto (ou foto marcada como errada),
 *       pra mandar pro fotógrafo / pra dona ir produzindo as imagens.
 *
 *   Colunas: id, slug, nome, categoria, marca, foto_status, foto_observacao
 */

import { sql } from '../../lib/db.mjs';
import { requireAuth } from '../../lib/auth.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const rows = await sql`
    SELECT p.id, p.slug, p.nome, c.titulo AS categoria, p.marca, p.foto_status, p.foto_observacao
    FROM produtos p
    LEFT JOIN categorias c ON c.slug = p.categoria_slug
    WHERE p.ativo = TRUE
      AND (p.imagem_url IS NULL OR p.foto_status IN ('errada', 'pendente'))
    ORDER BY c.titulo, p.nome
  `;

  const header = 'id,slug,nome,categoria,marca,foto_status,observacao';
  const csvBody = rows.map(r => [
    csvField(r.id),
    csvField(r.slug),
    csvField(r.nome),
    csvField(r.categoria),
    csvField(r.marca),
    csvField(r.foto_status),
    csvField(r.foto_observacao),
  ].join(',')).join('\n');

  const date = new Date().toISOString().slice(0, 10);
  res.statusCode = 200;
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="produtos-sem-foto-${date}.csv"`);
  res.end('﻿' + header + '\n' + csvBody); // BOM pra Excel abrir UTF-8
}

function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
