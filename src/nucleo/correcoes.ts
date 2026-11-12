import { agora, banco } from '../banco';
import { config } from '../config';
import type { Pergunta } from './perguntas';
import { palavras, semelhanca } from './texto';

/**
 * MEMÓRIA DE CORREÇÕES
 *
 * Quando alguém da equipe corrige uma sugestão, a resposta certa fica guardada aqui. Antes de
 * responder uma pergunta nova, a IA recebe as correções mais parecidas como exemplo e as lições
 * escritas pela equipe. Assim o bot não repete o mesmo erro.
 *
 * Três jeitos de uma correção nascer:
 * - "ensinar": botão "Ensinar ao bot" na pergunta pendente (funciona com o envio desligado);
 * - "envio": a resposta enviada pelo painel ficou bem diferente da sugestão;
 * - "gobots": na aba Respondidas, a resposta do Gobots era melhor e alguém a marcou como certa;
 * - "frequentes": na aba Frequentes, alguém escreveu a resposta certa para um grupo de perguntas.
 */

export type OrigemCorrecao = 'ensinar' | 'envio' | 'gobots' | 'frequentes';

/**
 * Para onde a correção vale:
 * - geral: qualquer pergunta parecida (de outro anúncio, ensina a política, não os dados do produto);
 * - anuncio: só perguntas do mesmo anúncio;
 * - produto: perguntas de qualquer anúncio com o mesmo SKU.
 */
export type EscopoCorrecao = 'geral' | 'anuncio' | 'produto';

export function escopoValido(e: unknown): EscopoCorrecao | undefined {
  return e === 'geral' || e === 'anuncio' || e === 'produto' ? e : undefined;
}

/** SKU guardado na ficha do anúncio (se a ficha já foi lida). */
export function skuDoAnuncio(plataforma: string, itemId: string | null): string | null {
  if (!itemId) return null;
  const l = banco().prepare('SELECT ficha_json FROM produtos WHERE plataforma = ? AND item_id = ?').get(plataforma, itemId) as any;
  if (!l?.ficha_json) return null;
  try {
    const sku = JSON.parse(l.ficha_json)?.sku;
    return sku ? String(sku) : null;
  } catch {
    return null;
  }
}

/** Sem anúncio não dá para prender a correção a ele; sem SKU, "produto" vira "anúncio". */
function ajustarEscopo(e: EscopoCorrecao | undefined, itemId: string | null, sku: string | null): EscopoCorrecao {
  if (!e || e === 'geral' || !itemId) return 'geral';
  return e === 'produto' && !sku ? 'anuncio' : e;
}

export interface Correcao {
  id: number;
  plataforma: string;
  itemId: string | null;
  assunto: string | null;
  pergunta: string;
  sugestao: string | null;
  resposta: string;
  licao: string | null;
  escopo: EscopoCorrecao;
  sku: string | null;
  origem: OrigemCorrecao;
  perguntaId: number | null;
  ativa: boolean;
  usos: number;
  criadaEm: string;
}

/** Abaixo disso a resposta enviada conta como diferente da sugestão (vira correção sozinha). */
export const LIMITE_DIFERENTE = 0.85;
/** Quantas correções parecidas vão no pedido à IA. */
const MAX_EXEMPLOS = 5;
/** Quantas lições (as mais recentes) vão no pedido à IA. */
const MAX_LICOES = 20;

function daLinha(l: any): Correcao {
  return {
    id: Number(l.id),
    plataforma: l.plataforma,
    itemId: l.item_id ?? null,
    assunto: l.assunto ?? null,
    pergunta: l.pergunta,
    sugestao: l.sugestao ?? null,
    resposta: l.resposta,
    licao: l.licao ?? null,
    escopo: escopoValido(l.escopo) ?? 'geral',
    sku: l.sku ?? null,
    origem: l.origem,
    perguntaId: l.pergunta_id != null ? Number(l.pergunta_id) : null,
    ativa: Boolean(l.ativa),
    usos: Number(l.usos),
    criadaEm: l.criada_em,
  };
}

/** Tira saudação e assinatura: a IA é instruída a não escrever as duas, então o exemplo não deve ter. */
export function semSaudacaoEAssinatura(t: string): string {
  let x = (t || '').trim();
  const assin = config.assinatura.trim();
  if (assin && x.toLowerCase().endsWith(assin.toLowerCase())) x = x.slice(0, x.length - assin.length).trim();
  // "Olá, Maria!" também: o nome de quem perguntou não serve de exemplo para outra pessoa.
  x = x.replace(/^(ol[aá]|oi|bom dia|boa tarde|boa noite)(\s*,\s*(?!tudo\b)[A-Za-zÀ-ÿ]+)?[!,.]*\s*(tudo bem\??\s*)?/i, '').trim();
  return x;
}

export function listarCorrecoes(): Correcao[] {
  return (banco().prepare('SELECT * FROM correcoes ORDER BY id DESC').all() as any[]).map(daLinha);
}

/** A correção que a equipe já deu para esta mesma pergunta (se houver e estiver ativa). */
export function correcaoDaPergunta(perguntaId: number): Correcao | null {
  const l = banco().prepare('SELECT * FROM correcoes WHERE pergunta_id = ? AND ativa = 1').get(perguntaId);
  return l ? daLinha(l) : null;
}

export function contarCorrecoes(): number {
  return Number((banco().prepare('SELECT COUNT(*) AS n FROM correcoes WHERE ativa = 1').get() as any).n);
}

/**
 * Guarda a resposta certa para a pergunta. Se já existe correção para a mesma pergunta, atualiza
 * (a última palavra da equipe vale).
 */
export function salvarCorrecao(p: Pergunta, resposta: string, origem: OrigemCorrecao, licao?: string | null, escopo?: EscopoCorrecao): Correcao {
  const r = resposta.trim();
  if (!r) throw new Error('Escreva a resposta certa antes de ensinar.');
  const l = licao?.trim() ? licao.trim().slice(0, 500) : null;
  const db = banco();
  const sku = skuDoAnuncio(p.plataforma, p.itemId);
  const existente = db.prepare('SELECT id, licao, escopo FROM correcoes WHERE pergunta_id = ?').get(p.id) as any;
  if (existente) {
    const esc = escopo ? ajustarEscopo(escopo, p.itemId, sku) : existente.escopo;
    db.prepare('UPDATE correcoes SET resposta = ?, licao = ?, origem = ?, escopo = ?, sku = ?, ativa = 1, criada_em = ? WHERE id = ?')
      .run(r.slice(0, 2000), l ?? existente.licao ?? null, origem, esc, sku, agora(), existente.id);
    return daLinha(db.prepare('SELECT * FROM correcoes WHERE id = ?').get(existente.id));
  }
  const res = db
    .prepare(
      `INSERT INTO correcoes (plataforma, item_id, assunto, pergunta, sugestao, resposta, licao, origem, pergunta_id, criada_em, escopo, sku)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.plataforma, p.itemId, p.assunto, p.texto, p.sugestao, r.slice(0, 2000), l, origem, p.id, agora(), ajustarEscopo(escopo, p.itemId, sku), sku);
  return daLinha(db.prepare('SELECT * FROM correcoes WHERE id = ?').get(Number(res.lastInsertRowid)));
}

/** A resposta enviada ficou bem diferente da sugestão? Então é uma correção. */
export function ehCorrecao(sugestao: string | null, enviada: string): boolean {
  if (!sugestao) return true;
  return semelhanca(palavras(semSaudacaoEAssinatura(sugestao)), palavras(semSaudacaoEAssinatura(enviada))) < LIMITE_DIFERENTE;
}

export function atualizarCorrecao(id: number, dados: { ativa?: boolean; licao?: string | null; resposta?: string; escopo?: EscopoCorrecao }): Correcao {
  const db = banco();
  const atual = db.prepare('SELECT * FROM correcoes WHERE id = ?').get(id) as any;
  if (!atual) throw new Error('Correção não encontrada.');
  const ativa = dados.ativa === undefined ? atual.ativa : dados.ativa ? 1 : 0;
  const licao = dados.licao === undefined ? atual.licao : dados.licao?.trim() ? dados.licao.trim().slice(0, 500) : null;
  const resposta = dados.resposta?.trim() ? dados.resposta.trim().slice(0, 2000) : atual.resposta;
  const sku = atual.sku ?? skuDoAnuncio(atual.plataforma, atual.item_id ?? null);
  const escopo = escopoValido(dados.escopo) ? ajustarEscopo(dados.escopo, atual.item_id ?? null, sku) : atual.escopo;
  db.prepare('UPDATE correcoes SET ativa = ?, licao = ?, resposta = ?, escopo = ?, sku = ? WHERE id = ?').run(ativa, licao, resposta, escopo, sku, id);
  return daLinha(db.prepare('SELECT * FROM correcoes WHERE id = ?').get(id));
}

export function apagarCorrecao(id: number): void {
  banco().prepare('DELETE FROM correcoes WHERE id = ?').run(id);
}

export interface ExemploCorrigido {
  correcao: Correcao;
  mesmoAnuncio: boolean;
  /** Outro anúncio, mas o mesmo SKU: os dados do produto valem. */
  mesmoProduto: boolean;
  pontos: number;
}

/** A correção vale para esta pergunta? (respeita o "vale para" escolhido pela equipe) */
function valePara(c: Correcao, p: Pergunta, sku: string | null): boolean {
  if (c.escopo === 'geral') return true;
  if (p.itemId && c.itemId === p.itemId) return true;
  return c.escopo === 'produto' && Boolean(c.sku && sku && c.sku === sku);
}

/**
 * As correções mais parecidas com a pergunta. Parecida = palavras em comum; ganha ponto extra se for
 * do mesmo anúncio ou do mesmo assunto. Correção de outro anúncio vale pela política e pelo jeito
 * de responder, não pelos dados do produto (isso é dito à IA).
 */
export function correcoesParecidas(p: Pergunta, limite = MAX_EXEMPLOS): ExemploCorrigido[] {
  const alvo = palavras(p.texto);
  const out: ExemploCorrigido[] = [];
  const sku = skuDoAnuncio(p.plataforma, p.itemId);
  for (const c of listarCorrecoes()) {
    if (!c.ativa || c.perguntaId === p.id || !valePara(c, p, sku)) continue;
    const mesmoAnuncio = Boolean(p.itemId && c.itemId === p.itemId);
    const mesmoProduto = !mesmoAnuncio && Boolean(c.sku && sku && c.sku === sku);
    const perto = mesmoAnuncio || mesmoProduto;
    const base = semelhanca(alvo, palavras(c.pergunta));
    const pontos = base + (perto ? 0.2 : 0) + (p.assunto && c.assunto === p.assunto ? 0.15 : 0);
    if (base >= 0.2 || (perto && pontos >= 0.3)) out.push({ correcao: c, mesmoAnuncio, mesmoProduto, pontos });
  }
  return out.sort((a, b) => b.pontos - a.pontos).slice(0, limite);
}

/**
 * Lições escritas pela equipe (as mais recentes). A lição de uma correção geral vale para qualquer
 * pergunta; a de uma correção presa a um anúncio ou produto, só para perguntas dele.
 */
export function licoesDaEquipe(p?: Pergunta, limite = MAX_LICOES): string[] {
  const sku = p ? skuDoAnuncio(p.plataforma, p.itemId) : null;
  return (banco().prepare(`SELECT * FROM correcoes WHERE ativa = 1 AND licao IS NOT NULL AND licao <> '' ORDER BY id DESC`).all() as any[])
    .map(daLinha)
    .filter((c) => c.escopo === 'geral' || (p && valePara(c, p, sku)))
    .slice(0, limite)
    .map((c) => String(c.licao));
}

export function contarUsoDasCorrecoes(ids: number[]): void {
  if (!ids.length) return;
  const st = banco().prepare('UPDATE correcoes SET usos = usos + 1 WHERE id = ?');
  for (const id of ids) st.run(id);
}

/** Texto que entra no pedido à IA. Vazio se não houver nada a dizer. */
export function memoriaParaIa(p: Pergunta): { texto: string; ids: number[] } {
  const licoes = licoesDaEquipe(p);
  const exemplos = correcoesParecidas(p);
  const partes: string[] = [];
  if (licoes.length) {
    partes.push('LIÇÕES DA EQUIPE (aprendidas com correções; siga sempre):\n' + licoes.map((l) => `- ${l}`).join('\n'));
  }
  if (exemplos.length) {
    partes.push(
      'CORREÇÕES DA EQUIPE EM PERGUNTAS PARECIDAS (é assim que a loja quer que responda):\n' +
        exemplos
          .map(({ correcao: c, mesmoAnuncio, mesmoProduto }) => {
            const onde = mesmoAnuncio ? 'mesmo anúncio' : mesmoProduto ? 'mesmo produto (mesmo SKU) em outro anúncio' : 'outro anúncio: copie a política e o jeito de responder, NÃO os dados do produto';
            const errada = c.sugestao ? `\nResposta que estava ERRADA: ${semSaudacaoEAssinatura(c.sugestao)}` : '';
            return `[${onde}]\nP: ${c.pergunta}${errada}\nResposta CERTA: ${semSaudacaoEAssinatura(c.resposta)}${c.licao ? `\nPor quê: ${c.licao}` : ''}`;
          })
          .join('\n\n'),
    );
  }
  return { texto: partes.join('\n\n'), ids: exemplos.map((e) => e.correcao.id) };
}

/**
 * Correção sem pergunta pendente por trás (aba Frequentes: vale para o grupo inteiro). Se já existe
 * uma avulsa com a mesma pergunta, atualiza.
 */
export function salvarCorrecaoAvulsa(dados: {
  pergunta: string; resposta: string; licao?: string | null; assunto?: string | null; itemId?: string | null; escopo?: EscopoCorrecao;
}): Correcao {
  const pergunta = (dados.pergunta || '').trim().slice(0, 2000);
  const resposta = (dados.resposta || '').trim().slice(0, 2000);
  if (!pergunta) throw new Error('Falta a pergunta.');
  if (!resposta) throw new Error('Escreva a resposta certa antes de ensinar.');
  const licao = dados.licao?.trim() ? dados.licao.trim().slice(0, 500) : null;
  const db = banco();
  const itemId = dados.itemId ? String(dados.itemId).toUpperCase() : null;
  const sku = skuDoAnuncio('mercadolivre', itemId);
  const escopo = ajustarEscopo(escopoValido(dados.escopo), itemId, sku);
  const existente = db.prepare('SELECT id, licao FROM correcoes WHERE pergunta_id IS NULL AND pergunta = ?').get(pergunta) as any;
  if (existente) {
    db.prepare('UPDATE correcoes SET resposta = ?, licao = ?, item_id = COALESCE(?, item_id), escopo = ?, sku = ?, ativa = 1, criada_em = ? WHERE id = ?')
      .run(resposta, licao ?? existente.licao ?? null, itemId, escopo, sku, agora(), existente.id);
    return daLinha(db.prepare('SELECT * FROM correcoes WHERE id = ?').get(existente.id));
  }
  const r = db
    .prepare(
      `INSERT INTO correcoes (plataforma, item_id, assunto, pergunta, sugestao, resposta, licao, origem, pergunta_id, criada_em, escopo, sku)
       VALUES ('mercadolivre', ?, ?, ?, NULL, ?, ?, 'frequentes', NULL, ?, ?, ?)`,
    )
    .run(itemId, dados.assunto ?? null, pergunta, resposta, licao, agora(), escopo, sku);
  return daLinha(db.prepare('SELECT * FROM correcoes WHERE id = ?').get(Number(r.lastInsertRowid)));
}
