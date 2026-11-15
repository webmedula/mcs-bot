import { banco } from '../banco';
import { ASSUNTO_OUTROS, nomeDoAssunto } from './assuntos';
import { agruparPerguntas } from './frequentes';

/**
 * SAÚDE DO PRODUTO (0.12.0): perguntas recebidas num período, por anúncio, para o relatório mensal
 * do Gerente IA. Pergunta que se repete no mesmo anúncio (medida, compatibilidade, o que vem no kit)
 * costuma ser informação que falta no anúncio; o Gerente junta isso com as reclamações da Central e
 * a nota do anúncio.
 *
 * Só leitura. Não leva quem perguntou: vai o texto da pergunta (público no ML) e a contagem.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function periodoValido(desde: unknown, ate: unknown, hoje = new Date()): { desde: string; ate: string } | null {
  const a = typeof ate === 'string' && ate ? ate : hoje.toISOString().slice(0, 10);
  const d = typeof desde === 'string' && desde ? desde : new Date(hoje.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  if (!DATA.test(d) || !DATA.test(a) || d > a) return null;
  return { desde: d, ate: a };
}

export interface SaudeDoAnuncio {
  itemId: string;
  titulo: string | null;
  sku: string | null;
  perguntas: number;
  porAssunto: Array<{ assunto: string; nome: string; quantidade: number }>;
  /** Grupos de perguntas parecidas que apareceram 2 vezes ou mais no anúncio. */
  repetidas: Array<{ assunto: string; nome: string; quantidade: number; exemplos: string[] }>;
}

function skuDaFicha(fichaJson: string | null): string | null {
  try {
    const sku = fichaJson ? JSON.parse(fichaJson)?.sku : null;
    return sku ? String(sku) : null;
  } catch {
    return null;
  }
}

export function saudeDosProdutos(desde: string, ate: string): { periodo: { desde: string; ate: string }; total: number; anuncios: SaudeDoAnuncio[] } {
  // criada_em vem do ML com o fuso dele ("2026-11-09T10:00:00.000-04:00"): os 10 primeiros caracteres são o dia local.
  const linhas = banco()
    .prepare(
      `SELECT p.item_id AS itemId, p.texto, p.assunto, pr.titulo, pr.ficha_json AS ficha
         FROM perguntas p LEFT JOIN produtos pr ON pr.plataforma = p.plataforma AND pr.item_id = p.item_id
        WHERE p.item_id IS NOT NULL AND substr(p.criada_em, 1, 10) BETWEEN ? AND ?`,
    )
    .all(desde, ate) as Array<{ itemId: string; texto: string; assunto: string | null; titulo: string | null; ficha: string | null }>;

  const porItem = new Map<string, typeof linhas>();
  for (const l of linhas) {
    if (!porItem.has(l.itemId)) porItem.set(l.itemId, []);
    porItem.get(l.itemId)!.push(l);
  }

  const anuncios: SaudeDoAnuncio[] = [];
  for (const [itemId, lista] of porItem) {
    const contagem = new Map<string, number>();
    for (const l of lista) {
      const a = l.assunto || ASSUNTO_OUTROS.id;
      contagem.set(a, (contagem.get(a) || 0) + 1);
    }
    const repetidas = agruparPerguntas(lista.map((l) => ({ texto: l.texto, resposta: null, assunto: l.assunto })), 3)
      .flatMap((a) => a.grupos.filter((g) => g.quantidade >= 2).map((g) => ({ assunto: a.assunto, nome: a.nome, quantidade: g.quantidade, exemplos: g.exemplos.slice(0, 2) })))
      .sort((x, y) => y.quantidade - x.quantidade)
      .slice(0, 5);
    anuncios.push({
      itemId,
      titulo: lista.find((l) => l.titulo)?.titulo ?? null,
      sku: skuDaFicha(lista.find((l) => l.ficha)?.ficha ?? null),
      perguntas: lista.length,
      porAssunto: [...contagem.entries()]
        .map(([assunto, quantidade]) => ({ assunto, nome: nomeDoAssunto(assunto), quantidade }))
        .sort((x, y) => y.quantidade - x.quantidade),
      repetidas,
    });
  }
  anuncios.sort((a, b) => b.perguntas - a.perguntas);
  return { periodo: { desde, ate }, total: linhas.length, anuncios };
}
