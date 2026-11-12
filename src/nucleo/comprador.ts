import { agora, banco } from '../banco';
import { conector } from '../conectores';
import { logger } from '../logger';
import type { Pergunta } from './perguntas';
import { normalizar } from './texto';
import type { Plataforma } from './tipos';

/**
 * QUEM ESTÁ PERGUNTANDO
 *
 * Antes da compra o Mercado Livre não mostra o nome de verdade, só o apelido público (ex.:
 * "MARIA.SILVA82" ou "JOAOPAULO_RS"). Daqui tiramos o primeiro nome quando ele é um nome comum
 * brasileiro, para a resposta começar com "Olá, Maria!". Se o apelido não tiver cara de nome
 * ("AUTOPECAS2020", "XYZ123"), a saudação fica só "Olá!": melhor genérico do que errado.
 */

/** Nomes comuns no Brasil, já com acento (a busca compara sem acento). */
const NOMES = `
Adriana Adriano Afonso Alan Alessandra Alex Alexandre Alice Aline Alisson Amanda Ana Anderson André Andrea Andréia
Andressa Angela Antônio Aparecida Ariane Armando Arthur Augusto Aurélio Beatriz Benedito Bernardo Bianca Bruna
Bruno Caio Camila Carla Carlos Carolina Caroline Cássio Catarina Cecília Célia Celso César Cícero Clara Claudia
Claudio Cleber Cleiton Cristiane Cristiano Cristina Daiane Daniel Daniela Danilo Davi David Débora Denis Denise
Diego Diogo Domingos Douglas Eduardo Edson Elaine Eliane Elias Elisa Elizabete Emanuel Emerson Enzo Erica Erick
Ernesto Evandro Everton Fabiana Fabiano Fábio Fabrício Felipe Fernanda Fernando Flávia Flávio Francisco Gabriel
Gabriela Geraldo Gilberto Gilmar Giovana Giovanni Gisele Glauber Guilherme Gustavo Heitor Helena Hélio Henrique
Hugo Igor Ingrid Isabel Isabela Isaac Ivan Ivone Jaqueline Jair Jean Jefferson Jéssica Joana João Joaquim Jonas
Jonathan Jorge José Josiane Juan Júlia Juliana Juliano Júlio Jussara Karina Kátia Kelly Larissa Laura Leandro
Leonardo Letícia Lívia Lorena Lourdes Lucas Luana Lúcia Luciana Luciano Luís Luiz Luiza Manoel Manuel Marcela
Marcelo Márcia Marcio Marco Marcos Margarete Maria Mariana Marina Mário Marlene Marta Mateus Matheus Maurício
Mauro Mayara Michel Michele Miguel Milton Mirian Moisés Murilo Natália Nathalia Neide Nelson Nicolas Nilton
Noemi Olga Orlando Osvaldo Otávio Pablo Patrícia Paula Paulo Pedro Priscila Rafael Rafaela Raimundo Raquel
Raul Regina Reinaldo Renan Renata Renato Ricardo Rita Roberta Roberto Robson Rodrigo Rogério Ronaldo Rosa Rosana
Rosângela Rose Rubens Rui Samuel Sandra Sandro Sara Sebastião Sérgio Silvana Silvia Simone Sônia Suelen Tainá
Tânia Tatiana Teresa Thais Thiago Tiago Valdir Valéria Vanessa Vera Vicente Victor Vinícius Vitor Vitória Vivian
Wagner Waldir Washington Wellington Wesley William Willian Wilson Yago Yara Yasmin Zilda
`.trim().split(/\s+/);

const POR_CHAVE = new Map(NOMES.map((n) => [normalizar(n).replace(/\s/g, ''), n]));
/** Os mais compridos primeiro: "MARIANA" tem de achar Mariana, não Maria. */
const CHAVES = [...POR_CHAVE.keys()].sort((a, b) => b.length - a.length);

/**
 * Primeiro nome a partir do apelido, ou null.
 * - "MARIA.SILVA82" → Maria (nome inteiro antes do separador);
 * - "JOAOPAULO_RS" → João (começa com um nome de 4+ letras);
 * - "ANAPECAS" → null (nome curto grudado em outra palavra é arriscado);
 * - "AUTOPECAS2020" → null.
 */
export function primeiroNomeDoApelido(apelido: string | null | undefined): string | null {
  if (!apelido) return null;
  const base = normalizar(apelido).replace(/\s/g, ' ');
  const primeiro = base.split(/[^a-z]+/).filter(Boolean)[0];
  if (!primeiro || primeiro.length < 3) return null;
  const inteiro = POR_CHAVE.get(primeiro);
  if (inteiro) return inteiro;
  for (const k of CHAVES) {
    if (k.length >= 4 && primeiro.startsWith(k) && primeiro.length - k.length >= 3) return POR_CHAVE.get(k)!;
  }
  return null;
}

export interface Comprador {
  apelido: string | null;
  primeiroNome: string | null;
}

export function compradorGuardado(plataforma: Plataforma, compradorId: string | null): Comprador | null {
  if (!compradorId) return null;
  const l = banco().prepare('SELECT apelido FROM compradores WHERE plataforma = ? AND comprador_id = ?').get(plataforma, compradorId) as any;
  if (!l) return null;
  return { apelido: l.apelido ?? null, primeiroNome: primeiroNomeDoApelido(l.apelido) };
}

/** Lê o apelido na plataforma uma vez e guarda. Falha de rede não impede a sugestão. */
export async function conhecerComprador(p: Pergunta): Promise<Comprador | null> {
  if (!p.compradorId) return null;
  const guardado = compradorGuardado(p.plataforma, p.compradorId);
  if (guardado) return guardado;
  const c = conector(p.plataforma);
  if (!c.apelidoDoComprador) return null;
  let apelido: string | null = null;
  try {
    apelido = await c.apelidoDoComprador(p.compradorId);
  } catch (err: any) {
    logger.warn(`[COMPRADOR] ${p.compradorId}: ${err?.message || err}`);
    return null;
  }
  banco()
    .prepare(
      `INSERT INTO compradores (plataforma, comprador_id, apelido, lido_em) VALUES (?, ?, ?, ?)
       ON CONFLICT(plataforma, comprador_id) DO UPDATE SET apelido = excluded.apelido, lido_em = excluded.lido_em`,
    )
    .run(p.plataforma, p.compradorId, apelido, agora());
  return { apelido, primeiroNome: primeiroNomeDoApelido(apelido) };
}

/** Outras perguntas da mesma pessoa (qualquer anúncio), as mais novas primeiro. */
export function outrasPerguntasDoComprador(p: Pergunta, limite = 5): Array<{ pergunta: string; resposta: string | null; anuncio: string | null }> {
  if (!p.compradorId) return [];
  return (banco()
    .prepare(
      `SELECT q.texto, q.resposta, COALESCE(pr.titulo, q.item_id) AS anuncio
       FROM perguntas q LEFT JOIN produtos pr ON pr.plataforma = q.plataforma AND pr.item_id = q.item_id
       WHERE q.plataforma = ? AND q.comprador_id = ? AND q.id <> ? ORDER BY q.criada_em DESC LIMIT ?`,
    )
    .all(p.plataforma, p.compradorId, p.id, limite) as any[]).map((l) => ({ pergunta: l.texto, resposta: l.resposta ?? null, anuncio: l.anuncio ?? null }));
}
