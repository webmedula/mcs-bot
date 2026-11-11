import { agora, banco } from '../banco';
import { classificarAssunto } from './assuntos';
import type { PerguntaExterna, Plataforma, StatusPergunta } from './tipos';

export interface Pergunta {
  id: number;
  plataforma: Plataforma;
  idExterno: string;
  itemId: string | null;
  texto: string;
  compradorId: string | null;
  criadaEm: string | null;
  status: StatusPergunta;
  assunto: string | null;
  resposta: string | null;
  respondidaEm: string | null;
  respondidaPor: string | null;
  sugestao: string | null;
  sugestaoOrigem: string | null;
  sugestaoProntaId: number | null;
  sugestaoConfianca: number | null;
  sugestaoMotivo: string | null;
  sugestaoEm: string | null;
  atualizadoEm: string;
  /** Vem do JOIN com produtos. */
  itemTitulo?: string | null;
  permalink?: string | null;
}

function daLinha(l: any): Pergunta {
  return {
    id: Number(l.id),
    plataforma: l.plataforma,
    idExterno: l.id_externo,
    itemId: l.item_id ?? null,
    texto: l.texto,
    compradorId: l.comprador_id ?? null,
    criadaEm: l.criada_em ?? null,
    status: l.status,
    assunto: l.assunto ?? null,
    resposta: l.resposta ?? null,
    respondidaEm: l.respondida_em ?? null,
    respondidaPor: l.respondida_por ?? null,
    sugestao: l.sugestao ?? null,
    sugestaoOrigem: l.sugestao_origem ?? null,
    sugestaoProntaId: l.sugestao_pronta_id != null ? Number(l.sugestao_pronta_id) : null,
    sugestaoConfianca: l.sugestao_confianca != null ? Number(l.sugestao_confianca) : null,
    sugestaoMotivo: l.sugestao_motivo ?? null,
    sugestaoEm: l.sugestao_em ?? null,
    atualizadoEm: l.atualizado_em,
    itemTitulo: l.item_titulo ?? null,
    permalink: l.permalink ?? null,
  };
}

const SELECT = `SELECT p.*, pr.titulo AS item_titulo, pr.permalink AS permalink
  FROM perguntas p LEFT JOIN produtos pr ON pr.plataforma = p.plataforma AND pr.item_id = p.item_id`;

/**
 * Grava ou atualiza a pergunta vinda da plataforma. Nunca apaga a sugestão. Se ela estava pendente
 * aqui e chegou respondida sem ter passado por nós, quem respondeu foi alguém de fora (o Gobots,
 * enquanto ele estiver ligado, ou alguém direto no ML).
 * Devolve a pergunta gravada e se ela é nova.
 */
export function salvarPergunta(e: PerguntaExterna): { pergunta: Pergunta; nova: boolean } {
  const db = banco();
  const atual = db
    .prepare('SELECT * FROM perguntas WHERE plataforma = ? AND id_externo = ?')
    .get(e.plataforma, e.idExterno) as any;
  const t = agora();

  if (!atual) {
    const r = db
      .prepare(
        `INSERT INTO perguntas (plataforma, id_externo, item_id, texto, comprador_id, criada_em, status, assunto,
           resposta, respondida_em, respondida_por, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.plataforma, e.idExterno, e.itemId, e.texto, e.compradorId, e.criadaEm, e.status, classificarAssunto(e.texto),
        e.resposta, e.respondidaEm, e.status === 'respondida' ? 'externo' : null, t,
      );
    return { pergunta: lerPergunta(Number(r.lastInsertRowid))!, nova: true };
  }

  const respondidaPor = atual.respondida_por ?? (e.status === 'respondida' ? 'externo' : null);
  db.prepare(
    `UPDATE perguntas SET item_id = COALESCE(?, item_id), texto = ?, status = ?, resposta = COALESCE(?, resposta),
       respondida_em = COALESCE(?, respondida_em), respondida_por = ?, atualizado_em = ?
     WHERE id = ?`,
  ).run(e.itemId, e.texto, e.status, e.resposta, e.respondidaEm, respondidaPor, t, atual.id);
  return { pergunta: lerPergunta(Number(atual.id))!, nova: false };
}

export function lerPergunta(id: number): Pergunta | null {
  const l = banco().prepare(`${SELECT} WHERE p.id = ?`).get(id);
  return l ? daLinha(l) : null;
}

export function lerPerguntaExterna(plataforma: Plataforma, idExterno: string): Pergunta | null {
  const l = banco().prepare(`${SELECT} WHERE p.plataforma = ? AND p.id_externo = ?`).get(plataforma, idExterno);
  return l ? daLinha(l) : null;
}

export interface FiltroPerguntas {
  status?: StatusPergunta;
  assunto?: string;
  busca?: string;
  limite?: number;
  /** Só as respondidas que tinham sugestão nossa (para comparar com o Gobots). */
  comSugestao?: boolean;
}

export function listarPerguntas(f: FiltroPerguntas = {}): Pergunta[] {
  const where: string[] = [];
  const args: any[] = [];
  if (f.status) {
    where.push('p.status = ?');
    args.push(f.status);
  }
  if (f.assunto) {
    where.push('p.assunto = ?');
    args.push(f.assunto);
  }
  if (f.busca) {
    where.push('(p.texto LIKE ? OR p.resposta LIKE ? OR p.item_id LIKE ? OR pr.titulo LIKE ?)');
    const b = `%${f.busca}%`;
    args.push(b, b, b, b);
  }
  // "Passou pelo bot": inclui as que a IA devolveu para uma pessoa (sem texto), que são as que mais ensinam.
  if (f.comSugestao) where.push('p.sugestao_origem IS NOT NULL');
  const ordem = f.status === 'pendente' ? 'p.criada_em ASC' : 'p.criada_em DESC';
  const limite = Math.min(Math.max(f.limite ?? 100, 1), 1000);
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${ordem} LIMIT ${limite}`;
  return (banco().prepare(sql).all(...args) as any[]).map(daLinha);
}

/** Pendentes que sumiram da lista da plataforma: foram respondidas ou apagadas fora daqui. */
export function pendentesForaDaLista(plataforma: Plataforma, idsNaLista: string[]): Pergunta[] {
  const ids = new Set(idsNaLista);
  return listarPerguntas({ status: 'pendente', limite: 1000 }).filter((p) => p.plataforma === plataforma && !ids.has(p.idExterno));
}

export interface Sugestao {
  texto: string | null;
  origem: 'pronta' | 'ia' | 'nenhuma';
  prontaId: number | null;
  confianca: number | null;
  motivo: string;
}

export function gravarSugestao(id: number, s: Sugestao): void {
  banco()
    .prepare(
      `UPDATE perguntas SET sugestao = ?, sugestao_origem = ?, sugestao_pronta_id = ?, sugestao_confianca = ?,
         sugestao_motivo = ?, sugestao_em = ?, atualizado_em = ? WHERE id = ?`,
    )
    .run(s.texto, s.origem, s.prontaId, s.confianca, s.motivo, agora(), agora(), id);
}

export function marcarRespondida(id: number, texto: string, por: 'painel' | 'mcs-bot' | 'externo'): void {
  const t = agora();
  banco()
    .prepare(`UPDATE perguntas SET status = 'respondida', resposta = ?, respondida_em = ?, respondida_por = ?, atualizado_em = ? WHERE id = ?`)
    .run(texto, t, por, t, id);
}

export function contarPorStatus(): Record<string, number> {
  const linhas = banco().prepare('SELECT status, COUNT(*) AS n FROM perguntas GROUP BY status').all() as any[];
  const out: Record<string, number> = { pendente: 0, respondida: 0, fechada: 0 };
  for (const l of linhas) out[l.status] = Number(l.n);
  return out;
}

/** Tempo até a resposta (minutos), nas respondidas dos últimos N dias. */
export function tempoDeResposta(dias = 30): { quantidade: number; medianaMin: number | null; porQuem: Record<string, number> } {
  const desde = new Date(Date.now() - dias * 86400_000).toISOString();
  const linhas = banco()
    .prepare(
      `SELECT criada_em, respondida_em, respondida_por FROM perguntas
       WHERE status = 'respondida' AND criada_em >= ? AND respondida_em IS NOT NULL`,
    )
    .all(desde) as any[];
  const minutos: number[] = [];
  const porQuem: Record<string, number> = {};
  for (const l of linhas) {
    const m = (Date.parse(l.respondida_em) - Date.parse(l.criada_em)) / 60000;
    if (Number.isFinite(m) && m >= 0) minutos.push(m);
    const q = l.respondida_por || 'externo';
    porQuem[q] = (porQuem[q] || 0) + 1;
  }
  minutos.sort((a, b) => a - b);
  const medianaMin = minutos.length ? Math.round(minutos[Math.floor(minutos.length / 2)]) : null;
  return { quantidade: linhas.length, medianaMin, porQuem };
}
