import { criarRespostaPronta, listarRespostasProntas, type DadosRespostaPronta } from './respostasProntas';

/**
 * Respostas prontas iniciais, tiradas da planilha de regras que o Gobots usa hoje (adaptada da
 * Shopee para perguntas do Mercado Livre). Carregadas por um botão no painel; depois disso são
 * editáveis como qualquer outra.
 *
 * Gatilhos de uma palavra só são os bem específicos ("garantia", "nf"): palavra comum demais
 * ("novo", "carro") roubaria a pergunta da IA, porque resposta pronta vence a IA.
 */
export const PRONTAS_INICIAIS: DadosRespostaPronta[] = [
  {
    titulo: 'Nota fiscal',
    assunto: 'nota_fiscal',
    gatilhos: ['nota fiscal', 'nota', 'nf', 'nfe', 'cnpj'],
    texto: 'Sim, emitimos nota fiscal em todas as vendas. Ela é gerada automaticamente na compra e fica disponível no detalhe do pedido.',
  },
  {
    titulo: 'Produto novo e original',
    assunto: 'original',
    gatilhos: ['original', 'originais', 'produto novo', 'novo ou usado', 'usado', 'paralelo', 'lacrado', 'genuino'],
    texto: 'Todos os nossos produtos são novos, lacrados e originais.',
  },
  {
    titulo: 'Garantia',
    assunto: 'garantia',
    gatilhos: ['garantia'],
    texto: 'Todos os nossos produtos têm garantia. A garantia deste anúncio é {garantia|informada na descrição do anúncio}.',
  },
  {
    titulo: 'Prazo de entrega',
    assunto: 'frete',
    gatilhos: ['prazo entrega', 'quantos dias', 'demora chegar', 'previsao entrega', 'quando chega'],
    texto: 'O prazo de entrega depende do seu endereço e aparece no anúncio ao informar o seu CEP, logo abaixo do preço. A entrega é feita pelo Mercado Livre.',
  },
  {
    titulo: 'Prazo de envio',
    assunto: 'frete',
    gatilhos: ['envio', 'envia hoje', 'enviado hoje', 'postagem', 'despacha', 'mesmo dia', 'posta hoje'],
    texto: 'Os pedidos aprovados até as 12h em dias úteis são enviados no mesmo dia. Depois desse horário, e nos fins de semana e feriados, o envio é feito no próximo dia útil.',
  },
  {
    titulo: 'Embalagem para presente',
    assunto: null,
    gatilhos: ['presente', 'embrulho', 'embrulhar'],
    texto: 'Infelizmente não enviamos embalagem para presente, porque os produtos seguem o padrão de embalagem exigido pelo Mercado Livre.',
  },
  {
    titulo: 'Cores e variações',
    assunto: 'medidas',
    gatilhos: ['outra cor', 'outras cores', 'quais cores', 'tem na cor', 'variacao'],
    texto: 'As cores disponíveis são as que aparecem nas opções do anúncio, logo abaixo das fotos. Basta escolher a variação antes de comprar. Se a cor que você quer não aparece, ela está sem estoque no momento.',
  },
  {
    titulo: 'Troca e devolução',
    assunto: 'garantia',
    gatilhos: ['troca', 'trocar', 'devolucao', 'devolver'],
    texto: 'Não fazemos troca direta, mas você pode pedir a devolução com reembolso pelo Mercado Livre, dentro do prazo, enviando o produto como recebeu (com caixa e manual). Se o produto chegar com algum problema, abra uma reclamação na compra com foto ou vídeo, que resolvemos.',
  },
  {
    // Só avisos curtos de compra/pagamento. "Acabei de comprar, quero 4 laranja" NÃO casa: vai para a IA/pessoa.
    titulo: 'Aviso de compra ou pagamento',
    assunto: 'pos_compra',
    gatilhos: ['pedido feito', 'ja paguei', 'pago via pix', 'pago no pix', 'pagamento feito', 'pagamento efetuado', 'efetuei pagamento'],
    texto: 'Agradecemos pela sua compra! Assim que o pagamento for aprovado pelo Mercado Livre, o pedido é separado e enviado.',
  },
  {
    titulo: 'Retirada no local',
    assunto: 'retirada',
    gatilhos: ['retirar', 'retirada', 'retiro', 'buscar pessoalmente', 'pegar pessoalmente', 'loja fisica'],
    texto: 'Sim, aceitamos retirada no local. Na hora da compra, escolha a opção de retirada; o endereço e o horário aparecem no detalhe da compra.',
  },
];

/** Cria as que ainda não existem (pelo nome). Devolve quantas criou e quais já existiam. */
export function carregarProntasIniciais(): { criadas: number; jaExistiam: string[] } {
  const existentes = new Set(listarRespostasProntas().map((r) => r.titulo.trim().toLowerCase()));
  let criadas = 0;
  const jaExistiam: string[] = [];
  for (const p of PRONTAS_INICIAIS) {
    if (existentes.has(p.titulo.toLowerCase())) {
      jaExistiam.push(p.titulo);
      continue;
    }
    criarRespostaPronta(p);
    criadas++;
  }
  return { criadas, jaExistiam };
}
