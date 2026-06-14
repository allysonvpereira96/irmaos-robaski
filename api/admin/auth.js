/**
 * /api/admin/auth — endpoint consolidado de autenticação
 *
 *  POST ?action=login   body: { email, senha } → cookie + user
 *  POST ?action=logout  → clear cookie
 *  GET                  → retorna user logado (precisa cookie)
 *
 * Substitui login.js + logout.js + me.js (3 → 1 function) pra ficar
 * dentro do limite de 12 functions/deploy do Vercel Hobby.
 */

import { sql } from '../../lib/db.mjs';
import {
  verifyPassword, signToken, buildSessionCookie, buildClearCookie, requireAuth,
} from '../../lib/auth.mjs';
import { json, error, readJsonBody } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action');

  // GET → me
  if (req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    return json(res, 200, {
      user: { id: user.userId, email: user.email, nome: user.nome, role: user.role },
    });
  }

  if (req.method !== 'POST') return error(res, 405, 'Use GET ou POST');

  // POST ?action=logout → clear cookie
  if (action === 'logout') {
    res.setHeader('Set-Cookie', buildClearCookie());
    return json(res, 200, { ok: true });
  }

  // POST ?action=login → autentica
  if (action !== 'login') return error(res, 400, 'action obrigatório (login|logout)');

  let body;
  try { body = await readJsonBody(req); }
  catch { return error(res, 400, 'JSON inválido'); }

  const email = String(body.email || '').toLowerCase().trim();
  const senha = String(body.senha || '');
  if (!email || !senha) return error(res, 400, 'Email e senha são obrigatórios');

  const rows = await sql`
    SELECT id, email, nome, password_hash, role, ativo
    FROM admin_users
    WHERE email = ${email}
    LIMIT 1
  `;
  const user = rows[0];
  if (!user || !user.ativo) return error(res, 401, 'Credenciais inválidas');

  const ok = await verifyPassword(senha, user.password_hash);
  if (!ok) return error(res, 401, 'Credenciais inválidas');

  await sql`UPDATE admin_users SET last_login_at = NOW() WHERE id = ${user.id}`;
  await sql`
    INSERT INTO audit_log (user_id, acao, entidade, ip)
    VALUES (${user.id}, 'login', 'user',
            ${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null})
  `;

  const token = signToken({
    userId: user.id, email: user.email, nome: user.nome, role: user.role,
  });
  res.setHeader('Set-Cookie', buildSessionCookie(token));
  return json(res, 200, {
    ok: true,
    user: { id: user.id, email: user.email, nome: user.nome, role: user.role },
  });
}
