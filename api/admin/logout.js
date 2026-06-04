import { buildClearCookie } from '../../lib/auth.mjs';
import { json, error } from '../../lib/http.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return error(res, 405, 'Use POST');
  res.setHeader('Set-Cookie', buildClearCookie());
  return json(res, 200, { ok: true });
}
