import { normalizar } from './texto';

/**
 * Assunto de cada pergunta, por palavras. Serve para agrupar o histórico e para a IA saber quando
 * tomar mais cuidado (compatibilidade, por exemplo, nunca pode ser chute).
 *
 * A ordem importa: o primeiro assunto que casar vence. Compatibilidade vem antes porque "tem para
 * o Gol 2015?" é pergunta de compatibilidade, não de estoque; estoque vem antes de frete porque
 * "pronta entrega" é sobre ter o produto, não sobre o envio.
 */
export const ASSUNTOS: Array<{ id: string; nome: string; termos: string[] }> = [
  // Primeiro: "pedido feito e pago via pix" não é pergunta de preço.
  {
    id: 'pos_compra',
    nome: 'Aviso de compra ou pagamento',
    termos: ['pedido feito', 'ja paguei', 'paguei', 'pago via pix', 'pago no pix', 'pagamento feito', 'pagamento efetuado',
      'efetuei o pagamento', 'acabei de comprar', 'acabei de fazer a compra', 'acabei de fazer o pedido', 'fiz o pedido',
      'fiz a compra', 'ja comprei', 'comprei agora'],
  },
  {
    id: 'compatibilidade',
    nome: 'Compatibilidade (serve no carro?)',
    termos: ['serve', 'servi', 'compativel', 'compatibilidade', 'encaixa', 'encaixe', 'cabe', 'meu carro', 'minha moto',
      'meu veiculo', 'ano', 'modelo', 'chassi', 'placa', 'versao', 'motor', 'flex', 'gol', 'palio', 'onix', 'hb20',
      'corolla', 'civic', 'uno', 'celta', 'strada', 'saveiro', 'fiesta', 'ka', 'sandero', 'hilux', 's10', 'ranger',
      'fox', 'polo', 'voyage', 'cg', 'titan', 'fan', 'biz', 'bros', 'fazer', 'factor'],
  },
  {
    id: 'estoque',
    nome: 'Estoque e disponibilidade',
    termos: ['estoque', 'disponivel', 'disponibilidade', 'pronta entrega', 'quantidade', 'unidades', 'tem mais',
      'ainda tem', 'acabou', 'repor', 'reposicao'],
  },
  {
    id: 'frete',
    nome: 'Frete e prazo de entrega',
    termos: ['frete', 'prazo', 'entrega', 'entregue', 'chega', 'chegar', 'chegaria', 'envio', 'envia', 'enviam', 'cep',
      'correios', 'transportadora', 'full', 'sedex', 'despacho', 'despacha', 'postagem', 'rastreio'],
  },
  {
    id: 'nota_fiscal',
    nome: 'Nota fiscal',
    termos: ['nota', 'nf', 'nfe', 'fiscal', 'cnpj', 'faturar', 'faturamento'],
  },
  {
    id: 'garantia',
    nome: 'Garantia',
    termos: ['garantia', 'defeito', 'troca', 'devolucao', 'devolver'],
  },
  {
    id: 'original',
    nome: 'Original, marca e qualidade',
    termos: ['original', 'originais', 'paralelo', 'paralela', 'genuino', 'genuina', 'marca', 'fabricante', 'qualidade',
      'primeira linha', 'inmetro', 'nacional', 'importado', 'china'],
  },
  {
    id: 'kit_lado',
    nome: 'Par, lado, kit e o que acompanha',
    termos: ['par', 'unidade', 'lado', 'direito', 'esquerdo', 'motorista', 'passageiro', 'kit', 'acompanha', 'vem com',
      'vem o', 'vem a', 'inclui', 'incluso', 'conjunto', 'jogo'],
  },
  {
    id: 'medidas',
    nome: 'Medidas e especificações',
    termos: ['medida', 'medidas', 'tamanho', 'dimensao', 'dimensoes', 'cm', 'mm', 'polegada', 'voltagem', '12v', '24v',
      'volts', 'watts', 'potencia', 'lumens', 'peso', 'diametro', 'largura', 'altura', 'comprimento', 'cor'],
  },
  {
    id: 'instalacao',
    nome: 'Instalação',
    termos: ['instalar', 'instalacao', 'instala', 'plug', 'fio', 'fios', 'conector', 'chicote', 'ligar', 'ligacao',
      'manual', 'adaptacao', 'adaptar', 'reator'],
  },
  {
    id: 'preco',
    nome: 'Preço, desconto e pagamento',
    termos: ['desconto', 'preco', 'valor', 'pix', 'parcela', 'parcelar', 'parcelado', 'boleto', 'cartao', 'menor',
      'barato', 'atacado', 'revenda', 'promocao', 'cupom'],
  },
  {
    id: 'retirada',
    nome: 'Retirada e endereço',
    termos: ['retirar', 'retirada', 'retiro', 'buscar', 'loja fisica', 'endereco', 'onde fica', 'cidade', 'pessoalmente'],
  },
];

export const ASSUNTO_OUTROS = { id: 'outros', nome: 'Outros' };

export function nomeDoAssunto(id: string | null | undefined): string {
  return ASSUNTOS.find((a) => a.id === id)?.nome ?? ASSUNTO_OUTROS.nome;
}

/** Casa termo como palavra (ou frase) inteira, para "ka" não casar com "kafka". */
function contemTermo(textoNormalizado: string, termo: string): boolean {
  return ` ${textoNormalizado} `.includes(` ${termo} `);
}

export function classificarAssunto(texto: string): string {
  const t = normalizar(texto);
  for (const a of ASSUNTOS) {
    if (a.termos.some((termo) => contemTermo(t, termo))) return a.id;
  }
  return ASSUNTO_OUTROS.id;
}
