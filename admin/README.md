# Admin do Catálogo Irmãos Robaski

Painel administrativo (acesso em `/admin/login.html`) pra gestão dos produtos
do catálogo: cadastrar, editar, excluir, upload de foto e "publicar no site".

## Setup inicial (faça uma vez)

### 1. Criar projeto Neon (Postgres)
- https://console.neon.tech → New Project → nomeie `irmaos-robaski`
- Em "Connection Details", copia a **`DATABASE_URL`**

### 2. Criar Vercel Blob (storage de imagens)
- Vercel Dashboard → projeto irmaos-robaski → **Storage** → Create → **Blob**
- Cria token de leitura/escrita → copia **`BLOB_READ_WRITE_TOKEN`**

### 3. Criar Deploy Hook (rebuilds disparados pelo admin)
- Vercel Dashboard → projeto → **Settings** → **Git** → **Deploy Hooks**
- Cria hook chamado `admin-rebuild` na branch `main`
- Copia a URL (formato `https://api.vercel.com/v1/integrations/deploy/prj_xxx/yyy`)
- Essa é a **`VERCEL_DEPLOY_HOOK_URL`**

### 4. Gerar JWT_SECRET
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Configurar env vars no Vercel
Vercel Dashboard → projeto → Settings → Environment Variables.
Adiciona **em todas as ambientes** (Production, Preview, Development):

| Nome | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://...` |
| `JWT_SECRET` | hex de 64 chars |
| `BLOB_READ_WRITE_TOKEN` | `vercel_blob_rw_...` |
| `VERCEL_DEPLOY_HOOK_URL` | `https://api.vercel.com/v1/integrations/deploy/...` |

### 6. Setup local pra rodar os scripts de inicialização
Copia `.env.example` pra `.env.local` e preenche com as mesmas vars.

### 7. Aplicar schema + migrar dados (uma vez só)
```bash
cd site/
npm install                # já feito
npm run init-db            # cria as tabelas no Neon
npm run migrate            # popula com os 1.972 produtos do data/produtos.json
npm run upload-imgs        # migra ~1.970 imagens pro Vercel Blob (5-10 min)
npm run seed-admin allyson@promoove.tech "MinhaSenha123" "Allyson"   # 1ª conta
```

### 8. Push pro GitHub → Vercel deploya com APIs ativas
```bash
git add . && git commit -m "feat: admin painel" && git push
```

### 9. Login!
`https://<seu-dominio>/admin/login.html` com email/senha do seed.

## Fluxo de uso pela dona da Robaski

1. Acessa `/admin/login.html`, entra com email/senha
2. Dashboard mostra stats (total produtos, sem foto, etc) e tabela paginada
3. Clica em **+ Novo produto** → preenche form + drag-drop da foto → Salvar
4. Pode **Editar** clicando no produto, **Desativar** ou **Excluir** pelos botões
5. Quando terminar as mudanças, clica em **↻ Aplicar no site** (canto superior direito)
   → dispara rebuild do Vercel → site público atualiza em ~30s

## APIs disponíveis (todas em `/api/admin/*`, todas exigem cookie de auth)

| Método | Rota | Função |
|---|---|---|
| POST | `/api/admin/login` | login (email + senha) |
| POST | `/api/admin/logout` | logout (clear cookie) |
| GET  | `/api/admin/me` | dados do user logado |
| GET  | `/api/admin/stats` | totais pro dashboard |
| GET  | `/api/admin/categorias` | listar categorias |
| GET  | `/api/admin/produtos` | listar produtos (paginado, com filtros) |
| POST | `/api/admin/produtos` | criar produto |
| GET  | `/api/admin/produto?id=X` | buscar 1 produto |
| PATCH | `/api/admin/produto?id=X` | atualizar (parcial) |
| DELETE | `/api/admin/produto?id=X` | desativar (soft) |
| DELETE | `/api/admin/produto?id=X&hard=1` | remover de vez |
| POST | `/api/admin/upload` | gera signed URL pro Vercel Blob |
| POST | `/api/admin/rebuild` | dispara Deploy Hook (cooldown 30s) |

## Segurança

- Senha hash com bcrypt (cost 10)
- JWT em cookie HTTP-only, SameSite=Lax, Secure em prod
- Sessão 7 dias
- Audit log de todas as ações (`audit_log` table)
- Upload limitado a 8MB, tipos restritos (jpeg/png/webp/avif)
- Cooldown de 30s no rebuild pra evitar spam de deploys

## Troubleshooting

- **"Não autenticado" após login**: cookie pode estar bloqueado se `domain` do
  site for diferente do `api`. Verificar que ambos estão no mesmo origin.
- **Upload falha**: cheque `BLOB_READ_WRITE_TOKEN` no Vercel.
- **Rebuild não dispara**: cheque `VERCEL_DEPLOY_HOOK_URL`.
- **Imagens não aparecem**: a tabela `produtos.imagem_url` deve ter URLs
  absolutas (`https://*.public.blob.vercel-storage.com/...`).
