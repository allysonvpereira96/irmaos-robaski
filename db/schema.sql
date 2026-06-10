-- ════════════════════════════════════════════════════════════════
-- Schema do Postgres (Neon) para o admin do catálogo Irmãos Robaski.
-- Roda uma vez no setup do banco: psql $DATABASE_URL -f db/schema.sql
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- pra gen_random_uuid()

-- ─── Categorias ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categorias (
  slug         TEXT PRIMARY KEY,
  titulo       TEXT NOT NULL,
  descricao    TEXT,
  ordem        INTEGER NOT NULL DEFAULT 999,
  icone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Produtos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS produtos (
  id               TEXT PRIMARY KEY,              -- código do ERP (ex: '4080')
  slug             TEXT NOT NULL UNIQUE,
  nome             TEXT NOT NULL,
  categoria_slug   TEXT NOT NULL REFERENCES categorias(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  categoria_erp    TEXT,                          -- preservado pra rastreabilidade ao ERP
  marca            TEXT,
  preco            NUMERIC(10,2),                 -- mantido pro caso de voltar a exibir
  preco_fisica     NUMERIC(10,2),
  unidade          TEXT,
  ean              TEXT,
  ncm              TEXT,
  descricao_extra  TEXT,
  imagem_url       TEXT,                          -- URL absoluta (Vercel Blob ou assets/)
  -- Status da foto (pra gestão pelo admin):
  --   'ok'        → foto validada
  --   'auto'      → veio do scraping automático, ainda não revisada
  --   'errada'    → marcada como errada (não usar; aguardando substituição)
  --   'pendente'  → produto ainda sem foto, precisa fotografia
  foto_status      TEXT NOT NULL DEFAULT 'auto' CHECK (foto_status IN ('ok','auto','errada','pendente')),
  foto_observacao  TEXT,                          -- nota livre da dona (ex: "tirar nova foto melhor")
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration p/ instalações antigas: adiciona as colunas se não existirem
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='produtos' AND column_name='foto_status') THEN
    ALTER TABLE produtos ADD COLUMN foto_status TEXT NOT NULL DEFAULT 'auto'
      CHECK (foto_status IN ('ok','auto','errada','pendente'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='produtos' AND column_name='foto_observacao') THEN
    ALTER TABLE produtos ADD COLUMN foto_observacao TEXT;
  END IF;
  -- Imagens armazenadas como BYTEA no Postgres (em vez de object storage).
  -- Servidas via /api/imagem?slug=X com cache CDN agressivo.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='produtos' AND column_name='imagem_bytes') THEN
    ALTER TABLE produtos ADD COLUMN imagem_bytes BYTEA;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='produtos' AND column_name='imagem_mime') THEN
    ALTER TABLE produtos ADD COLUMN imagem_mime TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='produtos' AND column_name='imagem_hash') THEN
    ALTER TABLE produtos ADD COLUMN imagem_hash TEXT;  -- SHA-1 do conteúdo (cache-buster)
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_produtos_categoria  ON produtos(categoria_slug);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo      ON produtos(ativo);
CREATE INDEX IF NOT EXISTS idx_produtos_nome       ON produtos USING gin (to_tsvector('portuguese', nome));
CREATE INDEX IF NOT EXISTS idx_produtos_marca      ON produtos(marca) WHERE marca IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_fotostatus ON produtos(foto_status);
CREATE INDEX IF NOT EXISTS idx_produtos_semfoto    ON produtos(ativo) WHERE imagem_url IS NULL;

-- ─── Admin users ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  nome            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin',  -- 'admin' | 'editor'
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit log (rastreabilidade de quem fez o quê) ─────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  acao        TEXT NOT NULL,            -- 'create', 'update', 'delete', 'login', 'rebuild'
  entidade    TEXT NOT NULL,            -- 'produto', 'categoria', 'user'
  entidade_id TEXT,
  detalhes    JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_log(created_at DESC);

-- ─── Trigger pra updated_at automático ─────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS produtos_updated  ON produtos;
DROP TRIGGER IF EXISTS categorias_updated ON categorias;
DROP TRIGGER IF EXISTS users_updated      ON admin_users;

CREATE TRIGGER produtos_updated    BEFORE UPDATE ON produtos    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER categorias_updated  BEFORE UPDATE ON categorias  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER users_updated       BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
