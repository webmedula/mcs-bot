import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const respostas = new Map<string, any>();
const chamadas: string[] = [];
vi.mock('./api', () => ({
  MlApiError: class extends Error {},
  ml: async (caminho: string) => {
    chamadas.push(caminho);
    for (const [prefixo, r] of respostas) if (caminho.startsWith(prefixo)) {
      if (r instanceof Error) throw r;
      return r;
    }
    throw new Error(`sem resposta para ${caminho}`);
  },
}));

let bancoEmMemoriaParaTeste: typeof import('../../banco').bancoEmMemoriaParaTeste;
let fichaComCache: typeof import('./conector').fichaComCache;
let montarPreco: typeof import('./conector').montarPreco;

beforeAll(async () => {
  ({ bancoEmMemoriaParaTeste } = await import('../../banco'));
  ({ fichaComCache, montarPreco } = await import('./conector'));
});

describe('preço do anúncio', () => {
  it('usa o sale_price (promoção) quando existe', () => {
    expect(montarPreco({ price: 78.9, available_quantity: 5 }, { amount: 36.99, regular_amount: 78.9 })).toEqual({
      preco: 36.99, precoCheio: 78.9, emPromocao: true, estoque: 5,
    });
  });
  it('sem sale_price, cai no price/original_price do anúncio', () => {
    expect(montarPreco({ price: 90, original_price: 120 }, null)).toMatchObject({ preco: 90, precoCheio: 120, emPromocao: true });
    expect(montarPreco({ price: 90 }, null)).toMatchObject({ preco: 90, precoCheio: 90, emPromocao: false });
  });
  it('sale_price sem regular_amount não inventa promoção', () => {
    expect(montarPreco({ price: 90 }, { amount: 90 })).toMatchObject({ preco: 90, precoCheio: 90, emPromocao: false });
  });
});

describe('ficha guardada', () => {
  beforeEach(() => {
    bancoEmMemoriaParaTeste();
    respostas.clear();
    chamadas.length = 0;
    respostas.set('/items/MLB1/sale_price', { amount: 100, regular_amount: 100 });
    respostas.set('/items/MLB1/description', { plain_text: 'desc' });
    respostas.set('/items/MLB1/compatibilities', { products: [] });
    respostas.set('/items/MLB1?include_attributes', { id: 'MLB1', title: 'Farol', price: 100, available_quantity: 5, attributes: [] });
    respostas.set('/items/MLB1?attributes', { id: 'MLB1', price: 100, available_quantity: 5 });
  });

  it('relê preço e estoque a cada pergunta, mesmo com a ficha guardada', async () => {
    const primeira = await fichaComCache('MLB1');
    expect(primeira).toMatchObject({ preco: 100, estoque: 5, emPromocao: false });

    respostas.set('/items/MLB1/sale_price', { amount: 79.9, regular_amount: 100 });
    respostas.set('/items/MLB1?attributes', { id: 'MLB1', price: 100, available_quantity: 2 });
    chamadas.length = 0;
    const segunda = await fichaComCache('MLB1');
    expect(segunda).toMatchObject({ preco: 79.9, precoCheio: 100, emPromocao: true, estoque: 2, descricao: 'desc' });
    // Não releu a ficha inteira, só o preço.
    expect(chamadas.some((c) => c.includes('include_attributes'))).toBe(false);
  });

  it('se o preço não atualiza, não usa o valor velho', async () => {
    await fichaComCache('MLB1');
    respostas.set('/items/MLB1?attributes', new Error('ML fora'));
    const f = await fichaComCache('MLB1');
    expect(f.preco).toBeNull();
    expect(f.estoque).toBeNull();
    expect(f.titulo).toBe('Farol');
  });
});
