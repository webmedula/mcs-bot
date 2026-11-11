import { banco } from '../banco';
import { nomeDoAssunto } from './assuntos';
import { palavras, semelhanca } from './texto';

/**
 * Números da aba "Visão geral": quantas perguntas chegaram, quantas foram respondidas e em quanto
 * tempo, quem respondeu e quanto o bot já acerta. Compara com o período anterior do mesmo tamanho.
 *
 * As datas vêm do ML com fuso (-04:00 etc.), então a conta é feita aqui em JS com Date.parse, e não
 * comparando texto no SQL. O banco guarda no máximo alguns milhares de perguntas; ler tudo é barato.
 */

const DIA = 86_400_000;
/** Fuso da loja (Brasília) para agrupar por dia. */
const FUSO_MS = -3 * 3_600_000;
/** A partir daqui a sugestão conta como "parecida" com o que foi respondido. */
export const LIMITE_PARECIDA = 0.4;

interface Linha {
  item_id: string | null;
  titulo: string | null;
  texto: string;
  criada: number;
  status: string;
  assunto: string | null;
  resposta: string | null;
  respondida: number | null;
  respondida_por: string | null;
  sugestao: string | null;
  sugestao_origem: string | null;
  avaliacao: string | null;
}

export interface NumerosDoPeriodo {
  recebidas: number;
  respondidas: number;
  semResposta: number;
  fechadas: number;
  /** Mediana, em minutos, entre a pergunta e a resposta. */
  tempoMedianoMin: number | null;
  /** % das respondidas que saíram em até 1 hora. */
  respondidasEm1h: number | null;
  porQuem: { externo: number; painel: number; 'mcs-bot': number };
  /** Perguntas que passaram pelo bot (chegaram com ele ligado) e o que ele sugeriu. */
  bot: { analisadas: number; pronta: number; ia: number; semSugestao: number; cobertura: number | null };
  /** Respondidas por fora que tinham sugestão nossa: quantas eram parecidas. */
  comparacao: { comparadas: number; parecidas: number; percentual: number | null };
  /** Placar escolhido na aba Respondidas. */
  avaliacoes: { bot: number; iguais: number; gobots: number; nossaMelhorOuIgual: number | null };
}

export interface VisaoGeral {
  dias: number;
  desde: string;
  atual: NumerosDoPeriodo;
  anterior: NumerosDoPeriodo;
  agora: { pendentes: number; pendentesMais24h: number; maisAntiga: string | null };
  porDia: { dia: string; recebidas: number; respondidas: number }[];
  assuntos: { assunto: string; nome: string; quantidade: number }[];
  anuncios: { itemId: string; titulo: string | null; quantidade: number; pendentes: number }[];
}

function lerLinhas(): Linha[] {
  const linhas = banco()
    .prepare(
      `SELECT p.item_id, pr.titulo, p.texto, p.criada_em, p.status, p.assunto, p.resposta, p.respondida_em,
              p.respondida_por, p.sugestao, p.sugestao_origem, p.avaliacao
       FROM perguntas p LEFT JOIN produtos pr ON pr.plataforma = p.plataforma AND pr.item_id = p.item_id`,
    )
    .all() as any[];
  const out: Linha[] = [];
  for (const l of linhas) {
    const criada = Date.parse(l.criada_em);
    if (!Number.isFinite(criada)) continue;
    const respondida = l.respondida_em ? Date.parse(l.respondida_em) : NaN;
    out.push({ ...l, criada, respondida: Number.isFinite(respondida) ? respondida : null });
  }
  return out;
}

function pct(parte: number, total: number): number | null {
  return total ? Math.round((parte / total) * 1000) / 10 : null;
}

export function numerosDoPeriodo(linhas: Linha[]): NumerosDoPeriodo {
  const n: NumerosDoPeriodo = {
    recebidas: linhas.length,
    respondidas: 0,
    semResposta: 0,
    fechadas: 0,
    tempoMedianoMin: null,
    respondidasEm1h: null,
    porQuem: { externo: 0, painel: 0, 'mcs-bot': 0 },
    bot: { analisadas: 0, pronta: 0, ia: 0, semSugestao: 0, cobertura: null },
    comparacao: { comparadas: 0, parecidas: 0, percentual: null },
    avaliacoes: { bot: 0, iguais: 0, gobots: 0, nossaMelhorOuIgual: null },
  };
  const minutos: number[] = [];
  for (const l of linhas) {
    if (l.status === 'respondida') {
      n.respondidas++;
      const q = (l.respondida_por || 'externo') as keyof NumerosDoPeriodo['porQuem'];
      if (q in n.porQuem) n.porQuem[q]++;
      else n.porQuem.externo++;
      if (l.respondida != null && l.respondida >= l.criada) minutos.push((l.respondida - l.criada) / 60000);
      if (q === 'externo' && l.sugestao && l.resposta) {
        n.comparacao.comparadas++;
        if (semelhanca(palavras(l.sugestao), palavras(l.resposta)) >= LIMITE_PARECIDA) n.comparacao.parecidas++;
      }
      if (l.avaliacao === 'bot' || l.avaliacao === 'iguais' || l.avaliacao === 'gobots') n.avaliacoes[l.avaliacao]++;
    } else if (l.status === 'pendente') n.semResposta++;
    else n.fechadas++;

    if (l.sugestao_origem) {
      n.bot.analisadas++;
      if (l.sugestao && l.sugestao_origem === 'pronta') n.bot.pronta++;
      else if (l.sugestao && l.sugestao_origem === 'ia') n.bot.ia++;
      else n.bot.semSugestao++;
    }
  }
  minutos.sort((a, b) => a - b);
  if (minutos.length) {
    n.tempoMedianoMin = Math.round(minutos[Math.floor(minutos.length / 2)]);
    n.respondidasEm1h = pct(minutos.filter((m) => m <= 60).length, minutos.length);
  }
  n.bot.cobertura = pct(n.bot.pronta + n.bot.ia, n.bot.analisadas);
  n.comparacao.percentual = pct(n.comparacao.parecidas, n.comparacao.comparadas);
  const av = n.avaliacoes;
  av.nossaMelhorOuIgual = pct(av.bot + av.iguais, av.bot + av.iguais + av.gobots);
  return n;
}

function diaLocal(ms: number): string {
  return new Date(ms + FUSO_MS).toISOString().slice(0, 10);
}

export function visaoGeral(dias = 30, agoraMs = Date.now()): VisaoGeral {
  const d = Math.min(365, Math.max(1, Math.round(dias)));
  const desde = agoraMs - d * DIA;
  const antesDe = desde - d * DIA;
  const todas = lerLinhas();
  const atuais = todas.filter((l) => l.criada >= desde && l.criada <= agoraMs);
  const anteriores = todas.filter((l) => l.criada >= antesDe && l.criada < desde);

  const pendentes = todas.filter((l) => l.status === 'pendente');
  const maisAntiga = pendentes.reduce<number | null>((m, l) => (m == null || l.criada < m ? l.criada : m), null);

  // Uma barra por dia (até 90 dias; acima disso, por semana ficaria melhor, mas não é o caso ainda).
  const porDiaMapa = new Map<string, { recebidas: number; respondidas: number }>();
  if (d <= 90) {
    for (let t = desde; t <= agoraMs; t += DIA) porDiaMapa.set(diaLocal(t), { recebidas: 0, respondidas: 0 });
    porDiaMapa.set(diaLocal(agoraMs), porDiaMapa.get(diaLocal(agoraMs)) || { recebidas: 0, respondidas: 0 });
    for (const l of atuais) {
      const x = porDiaMapa.get(diaLocal(l.criada));
      if (!x) continue;
      x.recebidas++;
      if (l.status === 'respondida') x.respondidas++;
    }
  }

  const contaAssunto = new Map<string, number>();
  const contaAnuncio = new Map<string, { titulo: string | null; quantidade: number; pendentes: number }>();
  for (const l of atuais) {
    const a = l.assunto || 'outros';
    contaAssunto.set(a, (contaAssunto.get(a) || 0) + 1);
    if (l.item_id) {
      const x = contaAnuncio.get(l.item_id) || { titulo: l.titulo, quantidade: 0, pendentes: 0 };
      x.quantidade++;
      if (l.status === 'pendente') x.pendentes++;
      contaAnuncio.set(l.item_id, x);
    }
  }

  return {
    dias: d,
    desde: new Date(desde).toISOString(),
    atual: numerosDoPeriodo(atuais),
    anterior: numerosDoPeriodo(anteriores),
    agora: {
      pendentes: pendentes.length,
      pendentesMais24h: pendentes.filter((l) => agoraMs - l.criada > DIA).length,
      maisAntiga: maisAntiga != null ? new Date(maisAntiga).toISOString() : null,
    },
    porDia: [...porDiaMapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, v]) => ({ dia, ...v })),
    assuntos: [...contaAssunto.entries()]
      .map(([assunto, quantidade]) => ({ assunto, nome: nomeDoAssunto(assunto), quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 8),
    anuncios: [...contaAnuncio.entries()]
      .map(([itemId, v]) => ({ itemId, ...v }))
      .sort((a, b) => b.quantidade - a.quantidade || b.pendentes - a.pendentes)
      .slice(0, 8),
  };
}
