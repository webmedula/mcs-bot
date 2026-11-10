import { banco } from '../banco';
import { ASSUNTO_OUTROS, ASSUNTOS, nomeDoAssunto } from './assuntos';
import { normalizar, palavras, semelhanca } from './texto';

/**
 * PERGUNTAS QUE MAIS SE REPETEM, tiradas do histórico do próprio ML (inclui o que o Gobots
 * respondeu). É daqui que nascem as primeiras respostas prontas.
 *
 * Duas camadas: o assunto (frete, nota fiscal, compatibilidade...) e, dentro dele, grupos de
 * perguntas parecidas (mesmas palavras, em qualquer ordem).
 */

export interface GrupoDePerguntas {
  /** Quantas perguntas caíram no grupo. */
  quantidade: number;
  exemplos: string[];
  /** Palavras mais comuns do grupo: boas candidatas a gatilho. */
  gatilhoSugerido: string;
  /** Resposta mais usada no histórico para esse grupo (o que o Gobots ou a equipe respondeu). */
  respostaMaisUsada: string | null;
  vezesDaResposta: number;
}

export interface AssuntoFrequente {
  assunto: string;
  nome: string;
  quantidade: number;
  percentual: number;
  grupos: GrupoDePerguntas[];
}

export interface PerguntaParaAgrupar {
  texto: string;
  resposta: string | null;
  assunto: string | null;
}

const LIMIAR = 0.5;

function maisFrequentes<T>(itens: T[], chave: (t: T) => string): Array<{ item: T; vezes: number }> {
  const mapa = new Map<string, { item: T; vezes: number }>();
  for (const it of itens) {
    const k = chave(it);
    if (!k) continue;
    const atual = mapa.get(k);
    if (atual) atual.vezes++;
    else mapa.set(k, { item: it, vezes: 1 });
  }
  return [...mapa.values()].sort((a, b) => b.vezes - a.vezes);
}

export function agruparPerguntas(lista: PerguntaParaAgrupar[], gruposPorAssunto = 8): AssuntoFrequente[] {
  const porAssunto = new Map<string, PerguntaParaAgrupar[]>();
  for (const p of lista) {
    const a = p.assunto || ASSUNTO_OUTROS.id;
    if (!porAssunto.has(a)) porAssunto.set(a, []);
    porAssunto.get(a)!.push(p);
  }

  const total = lista.length || 1;
  const saida: AssuntoFrequente[] = [];

  for (const [assunto, perguntas] of porAssunto) {
    const grupos: Array<{ centro: string[]; membros: PerguntaParaAgrupar[]; palavrasDe: string[][] }> = [];
    for (const p of perguntas) {
      const pp = palavras(p.texto);
      if (pp.length === 0) continue;
      let alvo: (typeof grupos)[number] | null = null;
      let melhor = LIMIAR;
      for (const g of grupos) {
        const s = semelhanca(pp, g.centro);
        if (s >= melhor) {
          melhor = s;
          alvo = g;
        }
      }
      if (alvo) {
        alvo.membros.push(p);
        alvo.palavrasDe.push(pp);
      } else {
        grupos.push({ centro: pp, membros: [p], palavrasDe: [pp] });
      }
    }

    const melhores = grupos
      .sort((a, b) => b.membros.length - a.membros.length)
      .slice(0, gruposPorAssunto)
      .map((g): GrupoDePerguntas => {
        const contagem = new Map<string, number>();
        for (const pp of g.palavrasDe) for (const w of new Set(pp)) contagem.set(w, (contagem.get(w) || 0) + 1);
        const gatilho = [...contagem.entries()]
          .filter(([, n]) => n >= Math.max(1, g.membros.length * 0.5))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([w]) => w)
          .join(' ');
        const respostas = maisFrequentes(g.membros.filter((m) => m.resposta), (m) => normalizar(m.resposta!));
        const exemplos = maisFrequentes(g.membros, (m) => normalizar(m.texto))
          .slice(0, 3)
          .map((e) => e.item.texto);
        return {
          quantidade: g.membros.length,
          exemplos,
          gatilhoSugerido: gatilho || g.centro.slice(0, 2).join(' '),
          respostaMaisUsada: respostas[0]?.item.resposta ?? null,
          vezesDaResposta: respostas[0]?.vezes ?? 0,
        };
      });

    saida.push({
      assunto,
      nome: nomeDoAssunto(assunto),
      quantidade: perguntas.length,
      percentual: Math.round((perguntas.length / total) * 1000) / 10,
      grupos: melhores,
    });
  }

  return saida.sort((a, b) => b.quantidade - a.quantidade);
}

/** Lê do banco as respondidas (as mais recentes primeiro) e agrupa. */
export function perguntasFrequentes(limite = 5000): { total: number; assuntos: AssuntoFrequente[] } {
  const linhas = banco()
    .prepare(
      `SELECT texto, resposta, assunto FROM perguntas WHERE status = 'respondida'
       ORDER BY criada_em DESC LIMIT ?`,
    )
    .all(limite) as any[];
  return { total: linhas.length, assuntos: agruparPerguntas(linhas) };
}

export const LISTA_DE_ASSUNTOS = [...ASSUNTOS.map((a) => ({ id: a.id, nome: a.nome })), ASSUNTO_OUTROS];
