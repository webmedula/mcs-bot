import { agora, banco } from '../../banco';
import { logger } from '../../logger';
import type { Conector, FichaDoProduto, PerguntaExterna, StatusPergunta } from '../../nucleo/tipos';
import { ml, MlApiError } from './api';
import { lerToken } from './oauth';

/**
 * CONECTOR DO MERCADO LIVRE: traduz a API do ML para o formato do núcleo.
 * Rotas usadas: /questions/search, /questions/{id}, /answers, /items/{id}, /items/{id}/description,
 * /items/{id}/compatibilities, /users/{id}/items/search e /users/{id} (apelido de quem pergunta).
 */

export function statusDoMl(s: string | undefined): StatusPergunta {
  if (s === 'UNANSWERED') return 'pendente';
  if (s === 'ANSWERED') return 'respondida';
  return 'fechada';
}

export function perguntaDoMl(q: any): PerguntaExterna {
  return {
    plataforma: 'mercadolivre',
    idExterno: String(q.id),
    itemId: q.item_id ? String(q.item_id) : null,
    texto: String(q.text ?? ''),
    compradorId: q.from?.id != null ? String(q.from.id) : null,
    criadaEm: q.date_created ?? null,
    status: statusDoMl(q.status),
    resposta: q.answer?.text ?? null,
    respondidaEm: q.answer?.date_created ?? null,
  };
}

async function sellerId(): Promise<number> {
  const t = lerToken();
  if (t?.userId) return t.userId;
  const me = await ml<{ id: number }>('/users/me');
  return me.id;
}

const POR_PAGINA = 50;

async function paginarPerguntas(
  filtro: string,
  max: number,
  aoAvancar: (pagina: PerguntaExterna[]) => void,
): Promise<{ lidas: number; total: number; parouPor: string }> {
  let offset = 0;
  let lidas = 0;
  let total = 0;
  for (;;) {
    let data: any;
    try {
      data = await ml(`/questions/search?${filtro}&api_version=4&sort_fields=date_created&sort_types=DESC&limit=${POR_PAGINA}&offset=${offset}`);
    } catch (err: any) {
      // O ML limita até onde dá para paginar. Quando recusa, paramos com o que já veio.
      if (err instanceof MlApiError && err.status >= 400 && err.status < 500 && lidas > 0) {
        return { lidas, total, parouPor: `o ML parou de paginar no item ${offset} (${err.message})` };
      }
      throw err;
    }
    const qs: any[] = data?.questions ?? [];
    total = Number(data?.total ?? total);
    if (qs.length) aoAvancar(qs.map(perguntaDoMl));
    lidas += qs.length;
    offset += POR_PAGINA;
    if (qs.length === 0) return { lidas, total, parouPor: 'fim da lista' };
    if (lidas >= max) return { lidas, total, parouPor: `teto de ${max} perguntas` };
    if (offset >= total) return { lidas, total, parouPor: 'fim da lista' };
  }
}

/** Ids dos anúncios do vendedor (ativos e pausados), por scan: não tem teto de 1000 como o offset. */
async function idsDosAnuncios(seller: number, max = 3000): Promise<string[]> {
  const ids: string[] = [];
  let scroll: string | null = null;
  for (;;) {
    const q: string = scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : '';
    const data: any = await ml(`/users/${seller}/items/search?search_type=scan&limit=100${q}`);
    const r: string[] = data?.results ?? [];
    ids.push(...r);
    scroll = data?.scroll_id ?? null;
    if (r.length === 0 || !scroll || ids.length >= max) return ids.slice(0, max);
  }
}

function texto(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}

export async function lerCompatibilidades(itemId: string): Promise<string[] | null> {
  try {
    const data: any = await ml(`/items/${itemId}/compatibilities`);
    const produtos: any[] = data?.products ?? data?.results ?? [];
    if (produtos.length === 0) return [];
    const nomes: string[] = [];
    const semNome: string[] = [];
    for (const p of produtos) {
      const nome = texto(p.catalog_product_name) ?? texto(p.name) ?? texto(p.title);
      if (nome) nomes.push(nome);
      else if (p.catalog_product_id) semNome.push(String(p.catalog_product_id));
    }
    // Sem nome na lista: busca o nome do veículo no catálogo (até 40, para não pesar).
    for (const id of semNome.slice(0, 40)) {
      try {
        const prod: any = await ml(`/products/${id}`);
        if (prod?.name) nomes.push(String(prod.name));
      } catch {
        /* segue sem esse */
      }
    }
    if (produtos.length > 0 && nomes.length === 0) return null;
    return [...new Set(nomes)];
  } catch (err: any) {
    if (err instanceof MlApiError && err.status === 404) return [];
    return null;
  }
}

export interface PrecoAtual {
  preco: number | null;
  precoCheio: number | null;
  emPromocao: boolean;
  estoque: number | null;
}

function numero(v: unknown): number | null {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

/**
 * Junta o que o anúncio diz (price, original_price) com /items/{id}/sale_price, que é o preço que
 * o comprador vê com a promoção ativa (amount) e o preço cheio (regular_amount). O `price` do
 * anúncio sozinho pode ser o preço cheio mesmo com campanha do ML rodando.
 */
export function montarPreco(item: any, salePrice: any | null): PrecoAtual {
  const precoItem = numero(item?.price);
  const original = numero(item?.original_price);
  const venda = numero(salePrice?.amount);
  const cheioVenda = numero(salePrice?.regular_amount);
  const preco = venda ?? precoItem;
  const precoCheio = cheioVenda ?? original ?? preco;
  return {
    preco,
    precoCheio,
    emPromocao: preco != null && precoCheio != null && precoCheio > preco + 0.009,
    estoque: numero(item?.available_quantity),
  };
}

async function lerSalePrice(itemId: string): Promise<any | null> {
  try {
    return await ml(`/items/${itemId}/sale_price?context=channel_marketplace`);
  } catch {
    return null;
  }
}

/** Só preço e estoque, leve: roda a cada pergunta. */
export async function lerPrecoAtual(itemId: string): Promise<PrecoAtual> {
  const [item, venda] = await Promise.all([
    ml(`/items/${itemId}?attributes=id,price,original_price,available_quantity`),
    lerSalePrice(itemId),
  ]);
  return montarPreco(item, venda);
}

export async function lerFichaDoMl(itemId: string): Promise<FichaDoProduto> {
  const [item, venda]: [any, any] = await Promise.all([ml(`/items/${itemId}?include_attributes=all`), lerSalePrice(itemId)]);
  const preco = montarPreco(item, venda);
  let descricao: string | null = null;
  try {
    const d: any = await ml(`/items/${itemId}/description`);
    descricao = texto(d?.plain_text) ?? texto(d?.text);
  } catch {
    descricao = null;
  }
  const atributos: Record<string, string> = {};
  let sku: string | null = texto(item?.seller_custom_field);
  for (const a of item?.attributes ?? []) {
    const v = texto(a.value_name);
    if (!v || !a.name) continue;
    if (a.id === 'SELLER_SKU') sku = sku ?? v;
    atributos[String(a.name)] = v;
  }
  const termos: any[] = item?.sale_terms ?? [];
  const garantiaTipo = texto(termos.find((t) => t.id === 'WARRANTY_TYPE')?.value_name);
  const garantiaTempo = texto(termos.find((t) => t.id === 'WARRANTY_TIME')?.value_name);
  const garantia = [garantiaTipo, garantiaTempo].filter(Boolean).join(': ') || texto(item?.warranty);

  return {
    plataforma: 'mercadolivre',
    itemId,
    titulo: texto(item?.title),
    permalink: texto(item?.permalink),
    situacao: texto(item?.status),
    ...preco,
    precoLidoEm: agora(),
    condicao: item?.condition === 'new' ? 'novo' : item?.condition === 'used' ? 'usado' : texto(item?.condition),
    freteGratis: item?.shipping?.free_shipping != null ? Boolean(item.shipping.free_shipping) : null,
    garantia,
    atributos,
    descricao,
    compatibilidades: await lerCompatibilidades(itemId),
    sku,
  };
}

/**
 * A ficha (atributos, descrição, compatibilidades) fica guardada por 6 horas: isso quase não muda e
 * poupa chamadas ao ML. Preço e estoque, não: são relidos a cada pergunta, para nunca responder
 * com valor velho.
 */
const VALIDADE_FICHA_MS = 6 * 60 * 60 * 1000;

export async function fichaComCache(itemId: string, forcar = false): Promise<FichaDoProduto> {
  const db = banco();
  const linha = db.prepare("SELECT * FROM produtos WHERE plataforma = 'mercadolivre' AND item_id = ?").get(itemId) as any;
  let ficha: FichaDoProduto;
  if (!forcar && linha?.ficha_json && Date.now() - Date.parse(linha.atualizado_em) < VALIDADE_FICHA_MS) {
    ficha = JSON.parse(linha.ficha_json);
    try {
      ficha = { ...ficha, ...(await lerPrecoAtual(itemId)), precoLidoEm: agora() };
    } catch (err: any) {
      // Sem preço novo, não usa o velho: melhor a IA dizer que não sabe do que errar o valor.
      logger.warn(`[ML] preço de ${itemId} não atualizou: ${err?.message || err}`);
      ficha = { ...ficha, preco: null, precoCheio: null, emPromocao: false, estoque: null, precoLidoEm: null };
    }
    db.prepare("UPDATE produtos SET ficha_json = ? WHERE plataforma = 'mercadolivre' AND item_id = ?").run(JSON.stringify(ficha), itemId);
    return ficha;
  }
  ficha = await lerFichaDoMl(itemId);
  db.prepare(
    `INSERT INTO produtos (plataforma, item_id, titulo, permalink, ficha_json, atualizado_em, situacao, situacao_em) VALUES ('mercadolivre', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plataforma, item_id) DO UPDATE SET titulo = excluded.titulo, permalink = excluded.permalink,
       ficha_json = excluded.ficha_json, atualizado_em = excluded.atualizado_em,
       situacao = COALESCE(excluded.situacao, situacao), situacao_em = COALESCE(excluded.situacao_em, situacao_em)`,
  ).run(itemId, ficha.titulo, ficha.permalink, JSON.stringify(ficha), agora(), ficha.situacao ?? null, ficha.situacao ? agora() : null);
  return ficha;
}

/** Só título e link, em lote (multiget de 20), para mostrar o anúncio no histórico importado. */
export async function guardarTitulos(itemIds: string[]): Promise<void> {
  const db = banco();
  const faltam = itemIds.filter(
    (id) => !db.prepare("SELECT 1 FROM produtos WHERE plataforma = 'mercadolivre' AND item_id = ?").get(id),
  );
  for (let i = 0; i < faltam.length; i += 20) {
    const lote = faltam.slice(i, i + 20);
    try {
      const r: any[] = await ml(`/items?ids=${lote.join(',')}&attributes=id,title,permalink`);
      for (const x of r) {
        const b = x?.body;
        if (!b?.id) continue;
        db.prepare(
          `INSERT INTO produtos (plataforma, item_id, titulo, permalink, ficha_json, atualizado_em)
           VALUES ('mercadolivre', ?, ?, ?, NULL, '1970-01-01T00:00:00.000Z') ON CONFLICT DO NOTHING`,
        ).run(b.id, b.title ?? null, b.permalink ?? null);
      }
    } catch (err: any) {
      logger.warn(`[ML] títulos em lote falharam: ${err?.message || err}`);
    }
  }
}

export const conectorMercadoLivre: Conector = {
  plataforma: 'mercadolivre',

  conectado: () => Boolean(lerToken()),

  async buscarPendentes() {
    const seller = await sellerId();
    const out: PerguntaExterna[] = [];
    await paginarPerguntas(`seller_id=${seller}&status=UNANSWERED`, 1000, (p) => out.push(...p));
    return out;
  },

  async buscarPergunta(idExterno) {
    try {
      return perguntaDoMl(await ml(`/questions/${idExterno}?api_version=4`));
    } catch (err: any) {
      if (err instanceof MlApiError && err.status === 404) return null;
      throw err;
    }
  },

  /**
   * Primeiro pagina tudo junto. Se o ML cortar a paginação antes do fim, completa anúncio por
   * anúncio (cada anúncio tem a própria lista, bem menor).
   */
  async buscarHistorico(max, aoAvancar) {
    const seller = await sellerId();
    const geral = await paginarPerguntas(`seller_id=${seller}&status=ANSWERED`, max, aoAvancar);
    if (geral.lidas >= max || geral.lidas >= geral.total) return { lidas: geral.lidas, parouPor: geral.parouPor };

    logger.info(`[ML] histórico geral parou em ${geral.lidas}/${geral.total}; seguindo anúncio por anúncio`);
    let lidas = geral.lidas;
    const anuncios = await idsDosAnuncios(seller);
    for (const item of anuncios) {
      if (lidas >= max) return { lidas, parouPor: `teto de ${max} perguntas` };
      try {
        const r = await paginarPerguntas(`item=${item}&status=ANSWERED`, max - lidas, aoAvancar);
        lidas += r.lidas;
      } catch (err: any) {
        logger.warn(`[ML] histórico do ${item} falhou: ${err?.message || err}`);
      }
    }
    return { lidas, parouPor: `anúncio por anúncio (${anuncios.length} anúncios)` };
  },

  fichaDoProduto: (itemId) => fichaComCache(itemId),

  async responder(idExterno, textoResposta) {
    await ml('/answers', { metodo: 'POST', corpo: { question_id: Number(idExterno), text: textoResposta } });
  },

  async situacaoDosAnuncios(itemIds) {
    const out: Record<string, string> = {};
    const ids = [...new Set(itemIds.filter(Boolean))];
    // Multiget do ML: até 20 anúncios por chamada.
    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20);
      try {
        const r: any[] = await ml(`/items?ids=${lote.join(',')}&attributes=id,status`);
        for (const x of r ?? []) {
          if (x?.code === 200 && x.body?.id && x.body?.status) out[String(x.body.id)] = String(x.body.status);
          // 404: anúncio apagado. Conta como fora do ar.
          else if (x?.code === 404 && x.body?.id) out[String(x.body.id)] = 'closed';
        }
      } catch (err: any) {
        logger.warn(`[ML] situação dos anúncios falhou: ${err?.message || err}`);
      }
    }
    return out;
  },

  async apelidoDoComprador(compradorId) {
    const u: any = await ml(`/users/${encodeURIComponent(compradorId)}`);
    return u?.nickname ? String(u.nickname) : null;
  },
};
