# Banco de dados — Neon Postgres

## Setup inicial (1ª vez)

### 1. Criar projeto no Neon
- Acessa https://console.neon.tech
- Cria projeto `irmaos-robaski` (região `us-east-2` ou mais próxima de RS — `sa-east-1` se disponível)
- Copia a `DATABASE_URL` em "Connection Details"

### 2. Aplicar schema
```bash
# instala psql se necessário (Windows: choco install postgresql / Mac: brew install postgresql)
psql "$DATABASE_URL" -f db/schema.sql
```

Ou via Neon CLI:
```bash
npx neonctl sql --project-id <project-id> < db/schema.sql
```

### 3. Migrar dados iniciais
```bash
# Garante que produtos.json + categorias.json existem em data/
npm run extract && npm run map-cats

# Migra pro Neon
node db/migrate-from-json.mjs
```

### 4. Criar usuário admin master
Pra criar o primeiro admin (você vai precisar do bcrypt hash da senha):

```bash
node -e "import('bcryptjs').then(b => console.log(b.default.hashSync('SUA_SENHA_AQUI', 10)))"
# Output: $2a$10$xxxxxxxxxx...
```

Depois SQL:
```sql
INSERT INTO admin_users (email, password_hash, nome, role)
VALUES ('voce@exemplo.com', '$2a$10$xxxxxxxxxx...', 'Allyson', 'admin');
```

## Variáveis de ambiente necessárias

`.env.local` (não commitar):
```
DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
JWT_SECRET=<gere com: openssl rand -hex 32>
BLOB_READ_WRITE_TOKEN=<criar em Vercel > Storage > Blob>
VERCEL_DEPLOY_HOOK_URL=<criar em Vercel > Settings > Git > Deploy Hooks>
```

Em produção, configurar no dashboard do Vercel (Settings → Environment Variables).

## Estrutura

- `schema.sql` — CREATE TABLE (idempotente; pode rodar várias vezes)
- `migrate-from-json.mjs` — popula tabelas com dados de `data/produtos.json` + `data/categorias.json`
- `seed-admin.mjs` — utilitário para criar/resetar usuários admin
- `extract-to-json.mjs` — lê o banco e gera `data/produtos.json` (usado pelo `npm run build`)
