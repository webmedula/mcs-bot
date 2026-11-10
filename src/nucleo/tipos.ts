/**
 * O NÚCLEO NÃO SABE QUAL É A PLATAFORMA.
 *
 * Pergunta, produto e resposta têm o mesmo formato venha de onde vier. Cada marketplace entra como
 * um Conector (hoje só o Mercado Livre). Para ligar Shopee, Amazon ou outro, basta escrever um
 * conector novo: o painel, as respostas prontas, a IA e o histórico continuam os mesmos.
 */

export type Plataforma = 'mercadolivre';

export type StatusPergunta = 'pendente' | 'respondida' | 'fechada';

/** Pergunta como chega do conector, antes de ser gravada. */
export interface PerguntaExterna {
  plataforma: Plataforma;
  idExterno: string;
  itemId: string | null;
  texto: string;
  compradorId: string | null;
  criadaEm: string | null;
  status: StatusPergunta;
  resposta: string | null;
  respondidaEm: string | null;
}

/** O que a IA e as respostas prontas podem usar sobre o produto. Só fatos vindos da plataforma. */
export interface FichaDoProduto {
  plataforma: Plataforma;
  itemId: string;
  titulo: string | null;
  permalink: string | null;
  preco: number | null;
  estoque: number | null;
  condicao: string | null;
  freteGratis: boolean | null;
  garantia: string | null;
  /** Atributos técnicos (marca, modelo, lado, voltagem...), nome → valor. */
  atributos: Record<string, string>;
  descricao: string | null;
  /** Veículos compatíveis, em texto. null = não foi possível ler; [] = anúncio sem tabela. */
  compatibilidades: string[] | null;
  sku: string | null;
}

export interface Conector {
  plataforma: Plataforma;
  /** true quando há login válido na plataforma. */
  conectado(): boolean;
  buscarPendentes(): Promise<PerguntaExterna[]>;
  buscarPergunta(idExterno: string): Promise<PerguntaExterna | null>;
  /** Histórico de respondidas, mais novas primeiro. `aoAvancar` recebe cada página. */
  buscarHistorico(max: number, aoAvancar: (pagina: PerguntaExterna[]) => void): Promise<{ lidas: number; parouPor: string }>;
  fichaDoProduto(itemId: string): Promise<FichaDoProduto>;
  responder(idExterno: string, texto: string): Promise<void>;
}
