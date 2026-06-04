import { sql } from '../../lib/db.mjs';
import { verifyPassword, signToken, buildSessionCookie } from '../../lib/auth.mjs';
import { json, error, readJsonBody } from '../../lib/http.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return error(res, 405, 'Use POST');

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
