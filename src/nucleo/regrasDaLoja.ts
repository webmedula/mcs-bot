import { gravarEstado, lerEstado } from '../banco';

/**
 * REGRAS DA LOJA: texto livre, editado no painel, que a IA recebe junto com a ficha do anúncio.
 * É onde ficam as regras que valem para todos os anúncios e mudam com o tempo (horário de envio,
 * retirada, troca). Editar aqui muda o comportamento da IA na hora, sem deploy.
 */

const CHAVE = 'regras-da-loja';

export const REGRAS_PADRAO = `Envio: pedidos aprovados até as 12h em dias úteis são enviados no mesmo dia. Depois desse horário, e em fins de semana e feriados, o envio é feito no próximo dia útil.
Prazo de entrega: depende do endereço do comprador e aparece no anúncio ao informar o CEP. A entrega é feita pelo Mercado Livre.
Retirada: aceitamos retirada no local. O comprador escolhe a opção de retirada na hora da compra, quando o anúncio tiver essa opção; o endereço e o horário aparecem no detalhe da compra.
Troca: não fazemos troca direta. O comprador pode pedir devolução com reembolso pelo Mercado Livre, dentro do prazo, enviando o produto como recebeu (com caixa e manual). Produto com problema: abrir reclamação na compra, com foto ou vídeo.
Nota fiscal: emitida em todas as vendas, automaticamente.
Produtos: todos novos, lacrados e originais.
Embalagem para presente: não fazemos.
Voltagem, medidas e compatibilidade: responder somente com o que está no anúncio. Se o anúncio não informar, passar para uma pessoa.`;

export function lerRegrasDaLoja(): string {
  const r = lerEstado<string>(CHAVE);
  return typeof r === 'string' ? r : REGRAS_PADRAO;
}

export function gravarRegrasDaLoja(texto: string): string {
  const t = String(texto ?? '').trim();
  if (t.length > 6000) throw new Error('As regras da loja passam de 6000 caracteres. Resuma um pouco.');
  gravarEstado(CHAVE, t);
  return t;
}
