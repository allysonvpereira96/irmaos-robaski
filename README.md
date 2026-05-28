# Irmãos Robaski — Site Institucional + Catálogo B2B

Vanilla HTML/CSS/JS, deploy Vercel. **Stack zero-build no front** (browser carrega direto). Build scripts em Node apenas para gerar os datasets (`produtos.json`, `categorias.json`) e as 1.972 páginas de produto.

## Estrutura

```
site/
├── index.html              ← home institucional
├── produtos.html           ← catálogo navegável (filtros + busca + cart)
├── p/{slug}.html           ← 1.972 páginas individuais (geradas pelo build)
├── categorias/{slug}.html  ← 19 páginas de categoria (geradas pelo build)
├── data/
│   ├── produtos.json       ← dataset final (gerado)
│   ├── produtos-raw.json   ← intermediário (gerado)
│   └── categorias.json     ← metadados das 19 categorias (gerado)
├── assets/
│   ├── css/style.css
│   ├── js/{main,catalogo,cart}.js
│   └── img/produtos/{slug}.webp    ← scraper preenche
├── build/
│   ├── extract-from-xlsx.mjs       ← passo 1
│   ├── mapear-categorias.mjs       ← passo 2
│   ├── scraper-imagens.mjs         ← passo 3 (firecrawl)
│   └── build-site.mjs              ← passo 4 (gera HTML estático)
├── sitemap.xml                     ← gerado pelo build
├── robots.txt
└── vercel.json
```

## Pipeline de build

```bash
npm install                  # xlsx, sharp, fuse.js
npm run extract              # XLSX → data/produtos-raw.json
npm run map-cats             # → data/produtos.json + categorias.json
npm run scrape-imgs          # site atual NextGoCard → assets/img/produtos/*.webp
npm run build                # gera p/{slug}.html × 1.972 + categorias × 19 + sitemap

# atalho que roda extract → map-cats → build (não roda scraper)
npm run all
```

## Decisões arquiteturais

- **Zero build no front** — produtos.html lê JSON direto. Mantém debug simples e Lighthouse 95+.
- **Páginas individuais** — cada uma das 1.972 URLs é HTML pré-renderizado com Schema.org Product. SEO máximo.
- **Cart B2B** — localStorage + WhatsApp como "checkout". Sem pagamento online.
- **Busca** — Fuse.js client-side, fuzzy, 220ms debounce. Sem backend.
- **Imagens** — WebP, lazy loading nativo (`loading="lazy"`), placeholder SVG genérico pra produtos sem foto.

## Pendências de briefing

Ver `../brief.md`. Resumo crítico antes do deploy em produção:
- Logo + paleta + tipografia oficial
- WhatsApp comercial real (atualmente `5551999999999` placeholder em `cart.js`, `index.html`, `produtos.html`, `wpp-float`)
- CNPJ, razão social, endereço, cidades atendidas → schema LocalBusiness completo
- Domínio definitivo (canonical + og:url + sitemap)

## Deploy

Vercel (cleanUrls + cache de assets imutável + headers de segurança). Domínio TBD.

```bash
vercel              # preview
vercel --prod       # produção (após domínio confirmado)
```
