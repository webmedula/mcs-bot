import { agora, banco } from '../banco';
import { classificarAssunto } from './assuntos';
import { primeiroNomeDoApelido } from './comprador';
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
  /** Na aba Respondidas: qual resposta era melhor (gobots | bot | iguais). */
  avaliacao: string | null;
  /** Pendente tirada da lista do painel (antiga, sem como responder...). */
  arquivada: boolean;
  /** Vem do JOIN com produtos. */
  itemTitulo?: string | null;
  permalink?: string | null;
  /** Vem do JOIN com compradores: apelido público e o primeiro nome tirado dele. */
  compradorApelido?: string | null;
  compradorNome?: string | null;
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
    avaliacao: l.avaliacao ?? null,
    arquivada: Boolean(l.arquivada),
    itemTitulo: l.item_titulo ?? null,
    permalink: l.permalink ?? null,
    compradorApelido: l.comprador_apelido ?? null,
    compradorNome: primeiroNomeDoApelido(l.comprador_apelido),
  };
}

const SELECT = `SELECT p.*, pr.titulo AS item_titulo, pr.permalink AS permalink, cp.apelido AS comprador_apelido
  FROM perguntas p LEFT JOIN produtos pr ON pr.plataforma = p.plataforma AND pr.item_id = p.item_id
  LEFT JOIN compradores cp ON cp.plataforma = p.plataforma AND cp.comprador_id = p.comprador_id`;

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
  /** Nas pendentes: false (padrão) esconde as arquivadas; true mostra só as arquivadas. */
  arquivadas?: boolean;
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
  if (f.status === 'pendente') where.push(f.arquivadas ? 'p.arquivada = 1' : 'p.arquivada = 0');
  // Mais novas primeiro: no ML quem perguntou agora é quem ainda está decidindo a compra.
  const ordem = 'p.criada_em DESC';
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

/** "pendente" conta só as que estão na lista (não arquivadas); "arquivada" conta à parte. */
export function contarPorStatus(): Record<string, number> {
  const linhas = banco()
    .prepare(`SELECT CASE WHEN status = 'pendente' AND arquivada = 1 THEN 'arquivada' ELSE status END AS s, COUNT(*) AS n
              FROM perguntas GROUP BY s`)
    .all() as any[];
  const out: Record<string, number> = { pendente: 0, respondida: 0, fechada: 0, arquivada: 0 };
  for (const l of linhas) out[l.s] = Number(l.n);
  return out;
}

export function arquivarPergunta(id: number, arquivada: boolean): void {
  banco().prepare('UPDATE perguntas SET arquivada = ?, atualizado_em = ? WHERE id = ?').run(arquivada ? 1 : 0, agora(), id);
}

/** Pendente criada há mais de N dias? (data do ML vem com fuso, por isso Date.parse) */
export function ehAntiga(criadaEm: string | null, dias: number, agoraMs = Date.now()): boolean {
  const t = criadaEm ? Date.parse(criadaEm) : NaN;
  return Number.isFinite(t) && agoraMs - t > dias * 86_400_000;
}

/** Arquiva de uma vez as pendentes mais velhas que N dias. Devolve quantas. */
export function arquivarAntigas(dias: number): number {
  const linhas = banco().prepare(`SELECT id, criada_em FROM perguntas WHERE status = 'pendente' AND arquivada = 0`).all() as any[];
  const ids = linhas.filter((l) => ehAntiga(l.criada_em, dias)).map((l) => Number(l.id));
  const st = banco().prepare('UPDATE perguntas SET arquivada = 1, atualizado_em = ? WHERE id = ?');
  for (const id of ids) st.run(agora(), id);
  return ids.length;
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

export type Avaliacao = 'gobots' | 'bot' | 'iguais';

export function gravarAvaliacao(id: number, avaliacao: Avaliacao | null): void {
  banco().prepare('UPDATE perguntas SET avaliacao = ?, atualizado_em = ? WHERE id = ?').run(avaliacao, agora(), id);
}
