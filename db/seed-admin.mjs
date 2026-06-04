/**
 * db/seed-admin.mjs
 *
 * Cria (ou reseta a senha de) um usuário admin.
 *
 * Uso:
 *   node db/seed-admin.mjs <email> <senha> [nome]
 *
 * Exemplo:
 *   node db/seed-admin.mjs allyson@promoove.tech minhaSenha123 "Allyson"
 *   node db/seed-admin.mjs dona@robaski.com.br senhaForte456 "Maria Robaski"
 */

import 'dotenv/config';
import { sql } from '../lib/db.mjs';
import { hashPassword } from '../lib/auth.mjs';

async function main() {
  const [email, senha, nome = email.split('@')[0]] = process.argv.slice(2);
  if (!email || !senha) {
    console.error('Uso: node db/seed-admin.mjs <email> <senha> [nome]');
    process.exit(1);
  }
  if (senha.length < 8) {
    console.error('Senha deve ter no mínimo 8 caracteres.');
    process.exit(1);
  }

  const hash = await hashPassword(senha);
  const [user] = await sql`
    INSERT INTO admin_users (email, password_hash, nome, role)
    VALUES (${email.toLowerCase()}, ${hash}, ${nome}, 'admin')
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          nome = EXCLUDED.nome,
          ativo = TRUE
    RETURNING id, email, nome, role, created_at
  `;
  console.log('✓ Usuário admin criado/atualizado:');
  console.log('  id:    ', user.id);
  console.log('  email: ', user.email);
  console.log('  nome:  ', user.nome);
  console.log('  role:  ', user.role);
  console.log('\nAgora faça login em https://<seu-dominio>/admin/login.html');
}

main().catch(e => { console.error(e); process.exit(1); });
