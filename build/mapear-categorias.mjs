/**
 * mapear-categorias.mjs
 *
 * Lê data/produtos-raw.json (gerado por extract-from-xlsx.mjs) e:
 *  - mapeia as 147 categorias ERP brutas → 18 categorias humanas
 *  - exclui linhas que não são produto (NF_COMPLEMENTAR, etc)
 *  - tenta extrair `marca` de dentro do nome quando o campo estava vazio
 *  - grava data/produtos.json (dataset final) + data/categorias.json (com contagens)
 *
 * Uso: node build/mapear-categorias.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const IN_PATH = resolve(DATA_DIR, 'produtos-raw.json');
const OUT_PRODUTOS = resolve(DATA_DIR, 'produtos.json');
const OUT_CATEGORIAS = resolve(DATA_DIR, 'categorias.json');

/* ════════════════════════════════════════════════════════════════
   DICIONÁRIO 147 ERP → 18 HUMANAS
   - chave = string exata da categoria ERP
   - valor = slug de categoria humana
   - null = exclui do catálogo (não é produto)
═══════════════════════════════════════════════════════════════ */
const ERP_TO_HUMANA = {
  // Bebidas (não vinho, não destilado)
  BEBIDA_NEW: 'bebidas',
  BEBIDA_II_NEW: 'bebidas',
  BEBIDA_III_NEW: 'bebidas',
  BEBIDA_IV_NEW: 'destilados-e-coqueteis', // cachaça 51
  BEBIDA_V_NEW: 'destilados-e-coqueteis', // cooler
  BEBIDA_VI_NEW: 'destilados-e-coqueteis', // whisky
  BEBIDA_VII_NEW: 'vinhos-e-espumantes', // espumante

  // Vinhos & espumantes
  VINHO_NEW: 'vinhos-e-espumantes',
  VINHO_III_NEW: 'vinhos-e-espumantes',
  VINHO_IV_NEW: 'vinhos-e-espumantes',
  VINHO_V_NEW: 'vinhos-e-espumantes',
  VINHOS_DELLANNO_NEW: 'vinhos-e-espumantes',
  FILTRADO_CASA_DELLANNO_NEW: 'vinhos-e-espumantes',
  SIDRA_FIREPREMIUM_NEW: 'vinhos-e-espumantes',

  // Destilados, ice, coquetéis
  VELHO_BARREIRO_NEW: 'destilados-e-coqueteis',
  ICE_KISLLA_II_NEW: 'destilados-e-coqueteis',

  // Energéticos
  ENERGETICO_NEW: 'energeticos',
  ENERGETICO_II_NEW: 'energeticos',

  // Águas e sucos
  AGUA_NEW: 'aguas-e-sucos',
  AGUA_II_NEW: 'aguas-e-sucos',
  SUCO_SACHE_NEW: 'aguas-e-sucos',
  SUCO_SACHE_II_NEW: 'aguas-e-sucos',
  XAROPE_ARTIFICIAL_NEW: 'aguas-e-sucos',

  // Chás e mates
  CHA_NEW: 'chas-e-mates',
  CHA_III_NEW: 'chas-e-mates',
  CHA_IMPORTADO_NEW: 'chas-e-mates',
  ERVA_MATE_NEW: 'chas-e-mates',
  ERVA_MATE_II_NEW: 'chas-e-mates',
  ERVA_MATE_III_NEW: 'chas-e-mates',

  // Doces & sobremesas
  DOCES_NEW: 'doces-e-sobremesas',
  DOCES_II_NEW: 'doces-e-sobremesas',
  DOCE_ENLATADO_NEW: 'doces-e-sobremesas',
  DOCE_ENLATADO_NEW_II: 'doces-e-sobremesas',
  RAPADURA_SEM_ST_NEW: 'doces-e-sobremesas',
  GELATINA_NEW: 'doces-e-sobremesas',
  ALFAJOR_NEW: 'doces-e-sobremesas',
  PESSEGO_ENLATADO_NEW: 'doces-e-sobremesas',
  PUDIM_NEW: 'doces-e-sobremesas',
  SAGU_NEW: 'doces-e-sobremesas',

  // Biscoitos & massas
  BISCOITO_MACARRAO_NEW: 'biscoitos-e-massas',
  MASSAS_NEW: 'biscoitos-e-massas',

  // Mercearia seca (farinhas, açúcar, cereais, óleo, sal, achocolatados, leite em pó, coco ralado)
  CEREAIS_NEW: 'mercearia-seca',
  CEREAIS_II_NEW: 'mercearia-seca',
  CEREAIS_III_NEW: 'mercearia-seca',
  FARINHA_NEW: 'mercearia-seca',
  FARINHA_AVEIA_NEW: 'mercearia-seca',
  FARINHA_TRIGO_NEW: 'mercearia-seca',
  FARINHA_ROSCA_MARAVILHOSA_NEW: 'mercearia-seca',
  ACUCAR_NEW: 'mercearia-seca',
  SAL_NEW: 'mercearia-seca',
  OLEO_DE_SOJA_NEW: 'mercearia-seca',
  FEIJAO_SEM_ST_NEW: 'mercearia-seca',
  MILHO_NEW: 'mercearia-seca',
  POLENTA_FLOCARINA_NEW: 'mercearia-seca',
  AMIDO_MILHO_TOKZENA_NEW: 'mercearia-seca',
  AMIDO_MILHO_MAISCERTA_NEW: 'mercearia-seca',
  ALIM_PO_LEITE_NEW: 'mercearia-seca',
  ACHOCOLATADO_SEM_ST_NEW: 'mercearia-seca',
  COCO_SEM_ST_NEW: 'mercearia-seca',
  COCO_SEM_ST_II_NEW: 'mercearia-seca',
  QUEIJO_RALADO_NEW: 'mercearia-seca',

  // Padaria & confeitaria
  MISTURA_BOLO_NEW: 'padaria-e-confeitaria',
  FERMENTO_NEW: 'padaria-e-confeitaria',

  // Temperos & condimentos
  TEMPERO_NEW: 'temperos-e-condimentos',
  CONDIMENTOS_SEM_ST_NEW: 'temperos-e-condimentos',
  CANELA_MONOPOL_NEW: 'temperos-e-condimentos',
  CANELA_II_NEW: 'temperos-e-condimentos',
  CRAVO_MONOPOL_NEW: 'temperos-e-condimentos',
  CRAVO_NEILAR_NEW: 'temperos-e-condimentos',
  CHIMICHURI_NEW: 'temperos-e-condimentos',
  LOURO_NEW: 'temperos-e-condimentos',
  PIMENTA_COM_ST_NEW: 'temperos-e-condimentos',
  COLORAU_COLORIFICO_NEW: 'temperos-e-condimentos',

  // Molhos & conservas
  CATCHUP_NEW: 'molhos-e-conservas',
  CATCHUP_II_NEW: 'molhos-e-conservas',
  MOSTARDA_NEW: 'molhos-e-conservas',
  MOSTARDA_II_NEW: 'molhos-e-conservas',
  MAIONESE_NEW: 'molhos-e-conservas',
  MAIONESE_II_NEW: 'molhos-e-conservas',
  MOLHO_TOMATE_NEW: 'molhos-e-conservas',
  MOLHO_TOMATE_II_NEW: 'molhos-e-conservas',
  MOLHOS_SEM_ST_NEW: 'molhos-e-conservas',
  CONSERVAS_SEM_ST_NEW: 'molhos-e-conservas',
  ENLATADO_SEM_ST_NEW: 'molhos-e-conservas',
  ENLATADO_SEM_ST_II_NEW: 'molhos-e-conservas',
  VINAGRE_NEW: 'molhos-e-conservas',
  SOPA_NEW: 'molhos-e-conservas',
  SALSICHA_NEW: 'molhos-e-conservas',
  FAROFA_NEW: 'molhos-e-conservas',
  BATATA_PALHA_NEW: 'molhos-e-conservas',

  // Limpeza (incluindo sacos de lixo, álcool, desinfetante, odorizadores)
  LIMPEZA_SEM_ST_NEW: 'limpeza',
  LIMPEZA_SEM_ST_III_NEW: 'limpeza',
  LIMPEZA_COM_ST_NEW: 'limpeza',
  DESINFETANTE_NEW: 'limpeza',
  ALCOOL_NEW: 'limpeza',
  ALCOOL_II_NEW: 'limpeza',
  AEROSOL_AMBIENTE: 'limpeza',
  ODORIZADOR_NEW: 'limpeza',
  ESPONJAS_NEW: 'limpeza',
  QUEROSENE_NEW: 'limpeza',
  SACO_LIXO_NEW: 'limpeza',
  SACO_LIXO_II_NEW: 'limpeza',

  // Descartáveis (copos, pratos, guardanapos, luvas, papel)
  DESCARTAVEIS_SEM_ST_NEW: 'descartaveis',
  COPO_DESCARTAVEL_NEW: 'descartaveis',
  PRATO_DESCARTAVEL_NEW: 'descartaveis',
  GUARDANAPO_PAPEL_NEW: 'descartaveis',
  LUVAS_NEW: 'descartaveis',
  PAPEL_TOALHA_NEW: 'descartaveis',
  PAPEL_HIG_COMST_NEW: 'descartaveis',
  PAPEL_HIG_SEMST_NEW: 'descartaveis',

  // Embalagens (sacolas, bobinas, potes, bandejas, kraft, filme, etiqueta, papel alumínio/manteiga)
  SACOLAS_NEW: 'embalagens',
  BOBINAS_NEW: 'embalagens',
  POTES_BANDEJAS_NEW: 'embalagens',
  POTES_TAMPAS_NEW: 'embalagens',
  POTES: 'embalagens',
  EMBALAGEM_DOCE_BOLO_NEW: 'embalagens',
  EMBALAGENS_NEW: 'embalagens',
  SACO_KRAFT_PAPEL_SALGADO_NEW: 'embalagens',
  FILM_NEW: 'embalagens',
  BANDEJA_II_NEW: 'embalagens',
  ETIQUETA_NEW: 'embalagens',
  ETIQUETA_II_NEW: 'embalagens',
  ETIQUETA_III_NEW: 'embalagens',
  PAPEL_ALUMINIO_NEW: 'embalagens',
  PAPEL_ALUMINIO_II_NEW: 'embalagens',
  PAPEL_MANTEIGA_NEW: 'embalagens',
  LANCHEIRA_NEW: 'embalagens',
  HAMBURGUEIRA_NEW: 'embalagens',
  SACO_NEW: 'embalagens',
  FITA_ADESIVA_NEW: 'embalagens',
  DISPLAY_NEW: 'embalagens',

  // Utilidades domésticas (balde, mop, prendedor, garrafa térmica, cuia, pilha, lâmpada, velas, inseticida)
  UTILIDADE_NEW: 'utilidades-domesticas',
  UTILIDADE_II_NEW: 'utilidades-domesticas',
  PRENDEDOR_NEW: 'utilidades-domesticas',
  CUIA_PORONGO_NEW: 'utilidades-domesticas',
  GARRAFA_TERMICA_NEW: 'utilidades-domesticas',
  PILHA_NEW: 'utilidades-domesticas',
  LAMPADA_NEW: 'utilidades-domesticas',
  VELAS_NEW: 'utilidades-domesticas',
  VELAS_II_NEW: 'utilidades-domesticas',
  INSETICIDA_NEW: 'utilidades-domesticas',

  // Higiene pessoal & saúde
  HIGIENE_PESSOAL_NEW: 'higiene-pessoal',
  HIGIENE_PESSOAL_SEM_ST_NEW: 'higiene-pessoal',
  FRALDAS_NEW: 'higiene-pessoal',

  // Rações
  RACAO_NEW: 'racoes-e-pet',

  // Fumo
  FUMO_NEW: 'fumo',

  // Não é produto — exclui do catálogo
  NF_COMPLEMENTAR: null,
};

/* Metadados das 18 categorias humanas — display name, descrição, ícone (Lucide). */
const CATEGORIAS_META = {
  'bebidas':                 { titulo: 'Bebidas',                    descricao: 'Refrigerantes, sucos prontos, cervejas e bebidas em geral.',                                       ordem: 1, icone: 'beer' },
  'vinhos-e-espumantes':     { titulo: 'Vinhos e Espumantes',        descricao: 'Vinhos tintos, brancos, sidras e espumantes para revenda e eventos.',                              ordem: 2, icone: 'wine' },
  'destilados-e-coqueteis':  { titulo: 'Destilados e Coquetéis',     descricao: 'Cachaça, vodka, whisky, ice e coquetéis prontos.',                                                ordem: 3, icone: 'martini' },
  'energeticos':             { titulo: 'Energéticos',                descricao: 'Energéticos em latas e garrafas, com e sem açúcar.',                                              ordem: 4, icone: 'zap' },
  'aguas-e-sucos':           { titulo: 'Águas e Sucos',              descricao: 'Águas minerais com e sem gás, sucos em sachê e geladinhos.',                                      ordem: 5, icone: 'droplet' },
  'chas-e-mates':            { titulo: 'Chás e Erva-Mate',           descricao: 'Erva-mate, chás importados e nacionais para terere e infusão.',                                   ordem: 6, icone: 'leaf' },
  'doces-e-sobremesas':      { titulo: 'Doces e Sobremesas',         descricao: 'Balas, chocolates, doces enlatados, alfajores, gelatinas e sobremesas em pó.',                    ordem: 7, icone: 'candy' },
  'biscoitos-e-massas':      { titulo: 'Biscoitos e Massas',         descricao: 'Biscoitos recheados, bolachas, macarrão e massas alimentícias.',                                  ordem: 8, icone: 'cookie' },
  'mercearia-seca':          { titulo: 'Mercearia Seca',             descricao: 'Açúcar, farinha, óleo, sal, cereais, feijão, achocolatados e ingredientes básicos.',              ordem: 9, icone: 'wheat' },
  'padaria-e-confeitaria':   { titulo: 'Padaria e Confeitaria',      descricao: 'Misturas para bolo, fermento e ingredientes de confeitaria.',                                     ordem: 10, icone: 'cake' },
  'temperos-e-condimentos':  { titulo: 'Temperos e Condimentos',     descricao: 'Açafrão, canela, cravo, pimenta, ervas e temperos prontos.',                                      ordem: 11, icone: 'pepper-hot' },
  'molhos-e-conservas':      { titulo: 'Molhos e Conservas',         descricao: 'Ketchup, mostarda, maionese, molho de tomate, azeitona, conservas e enlatados.',                  ordem: 12, icone: 'soup' },
  'limpeza':                 { titulo: 'Limpeza',                    descricao: 'Água sanitária, detergente, desinfetante, álcool, ceras, esponjas e sacos de lixo.',              ordem: 13, icone: 'spray-can' },
  'descartaveis':            { titulo: 'Descartáveis',               descricao: 'Copos, pratos, guardanapos, luvas, papel toalha e higiênico.',                                    ordem: 14, icone: 'package-open' },
  'embalagens':              { titulo: 'Embalagens',                 descricao: 'Sacolas, bobinas, potes, bandejas, papel kraft, filme, etiqueta e alumínio.',                     ordem: 15, icone: 'package' },
  'utilidades-domesticas':   { titulo: 'Utilidades Domésticas',      descricao: 'Velas, baldes, mops, garrafas térmicas, lâmpadas, pilhas, prendedores e inseticidas.',            ordem: 16, icone: 'home' },
  'higiene-pessoal':         { titulo: 'Higiene Pessoal',            descricao: 'Fraldas, curativos e itens de higiene.',                                                          ordem: 17, icone: 'heart-pulse' },
  'racoes-e-pet':            { titulo: 'Rações e Pet',               descricao: 'Rações, alpiste e itens para animais.',                                                           ordem: 18, icone: 'paw-print' },
  'fumo':                    { titulo: 'Fumo',                       descricao: 'Fumo para cigarro de palha e correlatos.',                                                        ordem: 19, icone: 'cigarette' },
};

/* Lista de marcas conhecidas no catálogo — extraídas heuristicamente do nome do produto. */
const MARCAS_CONHECIDAS = [
  'BELLA DICA', 'ODERICH', 'SCHRAMM', 'MONOPOL', 'TINGITEX', 'PARANA', 'NEILAR', 'ALTO ALEGRE',
  'DORI', 'LIX FLEX', 'DELLANNO', 'ROLEPLAST', 'PLASFILM', 'CARMAX', 'CORDEIRO', 'COROA', 'COAMO',
  'GIRANDO SOL', 'ACTUALY', 'MINAPLAST', 'CAMILA', 'FUGINI', 'KISLLA', 'BALY', 'FOMITOS', 'COMETA',
  'FRUKI', 'BAUNILHA', 'COCO BOM', 'SILOTI', 'WEINMANN', 'CANCAO', 'CANÇÃO', 'KE SOL', 'CORSAK',
  'DIANA', 'IVOTI', 'BLUFORTE', 'FACIL', 'MASTER', 'PLENNO', 'BRILHEX', 'KIAN', 'ORQUIDEA',
  'MARAVILHOSA', 'IMPERIO', 'IMPERIAL', 'JACARE', 'SUPRIMAX', 'PRIMAVERA', 'GUARUFILME', 'JUNIOR',
  'PRATICA', 'ALKLIN', 'AVANT', 'GALVANOTEK', 'FLOPS', 'BUCHANAS', 'VELHO BARREIRO', '51',
  'GARIBALDI', 'KPH', 'DINDA', 'HAPPY', 'POP', 'DUETTO', 'FLORAX', 'GAP', 'TILHA', 'NATHY',
  'PPLAST', 'TAKA FOGO', 'BARREIRO', 'MADRUGADA', 'FERINHA', 'LADY PRIME', 'FRUCTUS', 'GLORINHA',
  'ADIGEL', 'BRANKITO', 'NINUS', 'CHINOCA', 'PLENNO', 'DUDIGO', 'AQUALEVE', 'AGUA DA PEDRA',
  'TUTTI-FRUTI', 'TUTTI FRUTI', 'DUETO', 'COCO BOM', 'CASA DELLANNO', 'FIRE PREMIUM',
  'PRODUTO', 'PRIMICIAS', 'LEVE 4 PAGUE 3', 'MAIODOG', 'INDIA', 'BACON',
];

/** Tenta extrair marca do nome do produto. Retorna a marca matchada (string) ou null. */
function extrairMarca(nome) {
  if (!nome) return null;
  const upper = nome.toUpperCase();
  // Ordena por tamanho desc pra match mais específico primeiro ("ALTO ALEGRE" antes de "ALTO")
  const ordenadas = [...MARCAS_CONHECIDAS].sort((a, b) => b.length - a.length);
  for (const marca of ordenadas) {
    // word-boundary lookalike (espaço, início, fim ou pontuação)
    const re = new RegExp(`(^|[\\s\\(\\)\\.,])${marca.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}([\\s\\(\\)\\.,]|$)`);
    if (re.test(upper)) return marca;
  }
  return null;
}

async function main() {
  const buf = await readFile(IN_PATH, 'utf8');
  const produtos = JSON.parse(buf);

  const stats = {
    total: produtos.length,
    incluidos: 0,
    excluidos: 0,
    semMapeamento: 0,
    marcaExtraida: 0,
  };
  const naoMapeadas = new Set();
  const contadoresHumana = {};
  const finais = [];

  for (const p of produtos) {
    const humana = ERP_TO_HUMANA.hasOwnProperty(p.categoriaErp)
      ? ERP_TO_HUMANA[p.categoriaErp]
      : undefined;

    if (humana === undefined) {
      stats.semMapeamento++;
      naoMapeadas.add(p.categoriaErp);
      continue;
    }
    if (humana === null) {
      stats.excluidos++;
      continue;
    }

    // Marca: usa o campo original se existir, senão tenta extrair do nome
    let marca = p.marca;
    if (!marca) {
      marca = extrairMarca(p.nome);
      if (marca) stats.marcaExtraida++;
    }

    finais.push({ ...p, categoriaHumana: humana, marca });
    contadoresHumana[humana] = (contadoresHumana[humana] || 0) + 1;
    stats.incluidos++;
  }

  // Monta categorias.json (com count efetivo)
  const categorias = Object.entries(CATEGORIAS_META)
    .map(([slug, meta]) => ({
      slug,
      titulo: meta.titulo,
      descricao: meta.descricao,
      ordem: meta.ordem,
      icone: meta.icone,
      count: contadoresHumana[slug] || 0,
    }))
    .sort((a, b) => a.ordem - b.ordem);

  await writeFile(OUT_PRODUTOS, JSON.stringify(finais, null, 2), 'utf8');
  await writeFile(OUT_CATEGORIAS, JSON.stringify(categorias, null, 2), 'utf8');

  console.log('[map-cats] estatísticas:');
  console.log(`  total no raw:           ${stats.total}`);
  console.log(`  incluídos no final:     ${stats.incluidos}`);
  console.log(`  excluídos (não-produto): ${stats.excluidos}`);
  console.log(`  sem mapeamento (BUG):   ${stats.semMapeamento}`);
  console.log(`  marca extraída do nome: ${stats.marcaExtraida}`);
  if (naoMapeadas.size) {
    console.log('  categorias ERP não mapeadas (precisa adicionar ao dicionário):');
    [...naoMapeadas].sort().forEach(c => console.log(`    - ${c}`));
  }
  console.log('\n[map-cats] contagens por categoria humana:');
  categorias.forEach(c => console.log(`  ${String(c.count).padStart(4)}  ${c.slug.padEnd(28)} ${c.titulo}`));

  console.log(`\n[map-cats] gravado: ${OUT_PRODUTOS}`);
  console.log(`[map-cats] gravado: ${OUT_CATEGORIAS}`);
}

main().catch(e => { console.error(e); process.exit(1); });
