/**
 * scraper-kec.mjs
 *
 * Camada 2 do pipeline de imagens. Reaproveita as 435 fotos do projeto KEC
 * (categorias limpeza/embalagens/descartáveis/escritório se sobrepõem com Robaski).
 *
 * Pipeline:
 *  1. Lê o array de produtos da KEC (extraído de js/produtos-completo.js)
 *  2. Pra cada produto Robaski SEM imagem, busca match fuzzy no KEC
 *  3. Se score < threshold, copia a imagem KEC → site/assets/img/produtos/{slug}.webp (convertida)
 *  4. Atualiza data/produtos.json
 *  5. Adiciona ao relatorio-cobertura.csv com fonte=kec
 *
 * Uso: node build/scraper-kec.mjs
 */

import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Fuse from 'fuse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(__dirname, '..');
const DATA_DIR = join(SITE_DIR, 'data');
const IMG_DIR = join(SITE_DIR, 'assets', 'img', 'produtos');
const KEC_DIR = 'C:/Users/allyv/OneDrive/Área de Trabalho/Projetos/kecsuprimentos';

const FUSE_THRESHOLD = 0.38;
const MIN_MATCH_LEN = 4;

function normalize(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai array de produtos do JS bundle da KEC. */
async function loadKec() {
  const text = await readFile(join(KEC_DIR, 'js/produtos-completo.js'), 'utf8');
  const m = text.match(/(?:const|var|let)\s+PRODUTOS\w*\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('Não achou array PRODUTOS no js/produtos-completo.js da KEC');
  // É JS literal, não JSON. Eval-like via Function pra evitar `eval` direto.
  const arr = new Function('return ' + m[1])();
  return arr
    .filter(p => p.imagem && p.imagem.includes('img-'))
    .map(p => ({
      ...p,
      nomeNorm: normalize(p.nome + ' ' + (p.descricao || '') + ' ' + (p.marca || '')),
    }));
}

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  await mkdir(IMG_DIR, { recursive: true });

  const produtosPath = join(DATA_DIR, 'produtos.json');
  const produtos = JSON.parse(await readFile(produtosPath, 'utf8'));
  const semFoto = produtos.filter(p => !p.imagem);
  console.log(`[kec] produtos no ERP sem foto: ${semFoto.length}`);

  const kec = await loadKec();
  console.log(`[kec] produtos KEC com imagem: ${kec.length}`);

  const fuse = new Fuse(kec, {
    keys: ['nomeNorm'],
    threshold: FUSE_THRESHOLD,
    ignoreLocation: true,
    minMatchCharLength: MIN_MATCH_LEN,
    includeScore: true,
  });

  const matches = [];
  for (const p of semFoto) {
    const r = fuse.search(normalize(p.nome));
    const ok = r[0];
    if (ok && ok.score <= FUSE_THRESHOLD) {
      matches.push({ erp: p, kec: ok.item, score: ok.score });
    }
  }
  console.log(`[kec] matches fuzzy: ${matches.length}`);

  // Mostra 5 melhores e 5 piores pra sanity check
  const sorted = [...matches].sort((a, b) => a.score - b.score);
  console.log('\n[kec] 5 melhores matches:');
  sorted.slice(0, 5).forEach(m =>
    console.log(`  ${m.score.toFixed(3)}  ERP: ${m.erp.nome}\n          KEC: ${m.kec.nome}`)
  );
  console.log('\n[kec] 5 piores matches (já abaixo do threshold):');
  sorted.slice(-5).forEach(m =>
    console.log(`  ${m.score.toFixed(3)}  ERP: ${m.erp.nome}\n          KEC: ${m.kec.nome}`)
  );

  // Copia imagens (KEC img-XXX.jpg → site/{slug}.webp)
  console.log(`\n[kec] copiando ${matches.length} imagens (com conversão WebP)…`);
  let ok = 0, skip = 0, fail = 0;
  for (const m of matches) {
    const src = join(KEC_DIR, m.kec.imagem);
    const dst = join(IMG_DIR, `${m.erp.slug}.webp`);
    if (!(await fileExists(src))) { fail++; continue; }
    try {
      await sharp(src)
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(dst);
      ok++;
    } catch (e) {
      console.warn(`[kec] falhou em ${m.erp.slug}: ${e.message}`);
      fail++;
    }
  }
  console.log(`[kec] copiadas: ${ok}, falhas: ${fail}`);

  // Atualiza produtos.json
  const slugsComKec = new Set(matches.slice(0, ok + skip).map(m => m.erp.slug));
  for (const p of produtos) {
    if (slugsComKec.has(p.slug) && !p.imagem) {
      p.imagem = `assets/img/produtos/${p.slug}.webp`;
    }
  }
  await writeFile(produtosPath, JSON.stringify(produtos, null, 2), 'utf8');

  const totalComImagem = produtos.filter(p => p.imagem).length;
  console.log(`\n[kec] ✓ cobertura final: ${totalComImagem} / ${produtos.length} (${(totalComImagem * 100 / produtos.length).toFixed(1)}%)`);
  console.log('[kec] rode `npm run build` pra rebuildar as páginas.');
}

main().catch(e => { console.error(e); process.exit(1); });
