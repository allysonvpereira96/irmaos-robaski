/**
 * lib/auth.mjs — JWT + bcrypt + cookie helpers.
 *
 * Auth flow:
 *  - POST /api/admin/login → bcrypt compare → gera JWT → set cookie httpOnly
 *  - Demais rotas /api/admin/* → middleware verifyAuth lê cookie + valida JWT
 *  - Logout → set cookie vazio
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'robaski_admin_session';
const TOKEN_TTL = '7d';

if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
  console.warn('[auth] JWT_SECRET não configurada — auth vai falhar');
}

/* ─── Bcrypt ─── */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/* ─── JWT ─── */
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}
export function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

/* ─── Cookie ─── */
export function buildSessionCookie(token, { maxAge = 7 * 24 * 3600 } = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    isProd ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(req) {
  const header = req.headers?.cookie || '';
  const cookies = Object.fromEntries(header.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k, v.join('=')];
  }));
  return cookies[COOKIE_NAME] || null;
}

/**
 * Middleware: extrai user do cookie. Retorna o payload ou null.
 * Use no início de cada handler de API admin.
 *
 *   const user = requireAuth(req, res);
 *   if (!user) return;  // 401 já foi enviado
 */
export function requireAuth(req, res) {
  const token = readCookie(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload || !payload.userId) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Não autenticado' }));
    return null;
  }
  return payload;
}
