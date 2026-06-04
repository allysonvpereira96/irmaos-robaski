import { requireAuth } from '../../lib/auth.mjs';
import { json } from '../../lib/http.mjs';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  return json(res, 200, {
    user: { id: user.userId, email: user.email, nome: user.nome, role: user.role },
  });
}
