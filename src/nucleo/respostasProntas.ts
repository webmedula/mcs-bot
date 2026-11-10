import { agora, banco } from '../banco';
import { normalizar } from './texto';
import type { FichaDoProduto } from './tipos';

export interface RespostaPronta {
  id: number;
  titulo: string;
  assunto: string | null;
  gatilhos: string[];
  texto: string;
  escopo: string;
  ativa: boolean;
  usos: number;
  criadaEm: string;
  atualizadaEm: string;
}

function daLinha(l: any): RespostaPronta {
  let gatilhos: string[] = [];
  try {
    gatilhos = JSON.parse(l.gatilhos);
  } catch {
    gatilhos = [];
  }
  return {
    id: Number(l.id),
    titulo: l.titulo,
    assunto: l.assunto ?? null,
    gatilhos,
    texto: l.texto,
    escopo: l.escopo || 'geral',
    ativa: Boolean(l.ativa),
    usos: Number(l.usos || 0),
    criadaEm: l.criada_em,
    atualizadaEm: l.atualizada_em,
  };
}

export function listarRespostasProntas(): RespostaPronta[] {
  return (banco().prepare('SELECT * FROM respostas_prontas ORDER BY ativa DESC, usos DESC, id DESC').all() as any[]).map(daLinha);
}

export function lerRespostaPronta(id: number): RespostaPronta | null {
  const l = banco().prepare('SELECT * FROM respostas_prontas WHERE id = ?').get(id);
  return l ? daLinha(l) : null;
}

export interface DadosRespostaPronta {
  titulo: string;
  assunto?: string | null;
  gatilhos: string[];
  texto: string;
  escopo?: string;
  ativa?: boolean;
}

function validar(d: DadosRespostaPronta): DadosRespostaPronta {
  const titulo = String(d.titulo || '').trim();
  const texto = String(d.texto || '').trim();
  const gatilhos = (Array.isArray(d.gatilhos) ? d.gatilhos : [])
    .map((g) => String(g).trim())
    .filter((g) => normalizar(g).length > 0);
  if (!titulo) throw new Error('Dê um nome para a resposta pronta.');
  if (!texto) throw new Error('Escreva o texto da resposta.');
  if (gatilhos.length === 0) throw new Error('Informe pelo menos um gatilho (palavras que a pergunta precisa ter).');
  if (texto.length > 2000) throw new Error('O Mercado Livre aceita no máximo 2000 caracteres por resposta.');
  const escopo = String(d.escopo || 'geral').trim().toUpperCase() === 'GERAL' ? 'geral' : String(d.escopo).trim().toUpperCase();
  return { titulo, texto, gatilhos, escopo, assunto: d.assunto || null, ativa: d.ativa !== false };
}

export function criarRespostaPronta(d: DadosRespostaPronta): RespostaPronta {
  const v = validar(d);
  const t = agora();
  const r = banco()
    .prepare(
      `INSERT INTO respostas_prontas (titulo, assunto, gatilhos, texto, escopo, ativa, usos, criada_em, atualizada_em)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(v.titulo, v.assunto ?? null, JSON.stringify(v.gatilhos), v.texto, v.escopo!, v.ativa ? 1 : 0, t, t);
  return lerRespostaPronta(Number(r.lastInsertRowid))!;
}

export function atualizarRespostaPronta(id: number, d: DadosRespostaPronta): RespostaPronta {
  if (!lerRespostaPronta(id)) throw new Error('Resposta pronta não encontrada.');
  const v = validar(d);
  banco()
    .prepare(
      `UPDATE respostas_prontas SET titulo = ?, assunto = ?, gatilhos = ?, texto = ?, escopo = ?, ativa = ?, atualizada_em = ?
       WHERE id = ?`,
    )
    .run(v.titulo, v.assunto ?? null, JSON.stringify(v.gatilhos), v.texto, v.escopo!, v.ativa ? 1 : 0, agora(), id);
  return lerRespostaPronta(id)!;
}

export function apagarRespostaPronta(id: number): void {
  banco().prepare('DELETE FROM respostas_prontas WHERE id = ?').run(id);
}

export function contarUso(id: number): void {
  banco().prepare('UPDATE respostas_prontas SET usos = usos + 1 WHERE id = ?').run(id);
}

/** Um gatilho casa quando TODAS as palavras dele aparecem na pergunta (em qualquer ordem). */
export function gatilhoCasa(perguntaNormalizada: string, gatilho: string): boolean {
  const palavrasDoGatilho = normalizar(gatilho).split(' ').filter(Boolean);
  if (palavrasDoGatilho.length === 0) return false;
  const texto = ` ${perguntaNormalizada} `;
  return palavrasDoGatilho.every((p) => texto.includes(` ${p} `));
}

export interface Casamento {
  pronta: RespostaPronta;
  gatilho: string;
  /** 0 a 1: quanto mais específico (escopo do anúncio, gatilho com mais palavras), maior. */
  confianca: number;
}

/**
 * Escolhe a resposta pronta que melhor serve. Ganha, nesta ordem: a do próprio anúncio sobre a
 * geral, e o gatilho mais longo (mais específico) sobre o mais curto.
 */
export function encontrarRespostaPronta(pergunta: string, itemId: string | null, prontas = listarRespostasProntas()): Casamento | null {
  const p = normalizar(pergunta);
  let melhor: Casamento | null = null;
  let melhorPeso = -1;
  for (const pronta of prontas) {
    if (!pronta.ativa) continue;
    const doAnuncio = pronta.escopo !== 'geral';
    if (doAnuncio && (!itemId || pronta.escopo !== itemId.toUpperCase())) continue;
    for (const g of pronta.gatilhos) {
      if (!gatilhoCasa(p, g)) continue;
      const tamanho = normalizar(g).split(' ').length;
      const peso = (doAnuncio ? 100 : 0) + tamanho;
      if (peso > melhorPeso) {
        melhorPeso = peso;
        const confianca = Math.min(0.95, 0.6 + 0.1 * tamanho + (doAnuncio ? 0.1 : 0));
        melhor = { pronta, gatilho: g, confianca };
      }
    }
  }
  return melhor;
}

/** Troca {titulo}, {preco}, {estoque}, {garantia} e {sku} pelos dados do anúncio. */
export function preencherModelo(texto: string, ficha: FichaDoProduto | null): string {
  const preco = ficha?.preco != null ? `R$ ${ficha.preco.toFixed(2).replace('.', ',')}` : '';
  const valores: Record<string, string> = {
    titulo: ficha?.titulo ?? '',
    preco,
    estoque: ficha?.estoque != null ? String(ficha.estoque) : '',
    garantia: ficha?.garantia ?? '',
    sku: ficha?.sku ?? '',
  };
  return texto.replace(/\{(titulo|preco|estoque|garantia|sku)\}/gi, (_, chave: string) => valores[chave.toLowerCase()] ?? '');
}
