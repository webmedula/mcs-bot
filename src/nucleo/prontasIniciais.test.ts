import { beforeEach, describe, expect, it } from 'vitest';
import { bancoEmMemoriaParaTeste } from '../banco';
import { carregarProntasIniciais, PRONTAS_INICIAIS } from './prontasIniciais';
import { gravarRegrasDaLoja, lerRegrasDaLoja, REGRAS_PADRAO } from './regrasDaLoja';
import { encontrarRespostaPronta, listarRespostasProntas, preencherModelo } from './respostasProntas';
import type { FichaDoProduto } from './tipos';

const ficha = (garantia: string | null): FichaDoProduto => ({
  plataforma: 'mercadolivre', itemId: 'MLB1', titulo: 'Farol', permalink: null, preco: 10, precoCheio: 10, emPromocao: false,
  precoLidoEm: null, estoque: 1, condicao: null, freteGratis: null, garantia, atributos: {}, descricao: null, compatibilidades: [], sku: null,
});

describe('respostas prontas iniciais (planilha do Gobots)', () => {
  beforeEach(() => bancoEmMemoriaParaTeste());

  it('carrega uma vez só, sem duplicar', () => {
    expect(carregarProntasIniciais().criadas).toBe(PRONTAS_INICIAIS.length);
    expect(carregarProntasIniciais()).toEqual({ criadas: 0, jaExistiam: PRONTAS_INICIAIS.map((p) => p.titulo) });
    expect(listarRespostasProntas()).toHaveLength(PRONTAS_INICIAIS.length);
  });

  it.each([
    ['Vocês emitem nota fiscal?', 'Nota fiscal'],
    ['É original ou paralelo?', 'Produto novo e original'],
    ['Tem garantia?', 'Garantia'],
    ['Posso retirar na loja?', 'Retirada no local'],
    ['Se não servir posso trocar?', 'Troca e devolução'],
    ['Envia hoje?', 'Prazo de envio'],
    ['Quantos dias para chegar em Recife?', 'Prazo de entrega'],
  ])('%s → %s', (pergunta, titulo) => {
    carregarProntasIniciais();
    expect(encontrarRespostaPronta(pergunta, 'MLB1')?.pronta.titulo).toBe(titulo);
  });

  it('não rouba da IA as perguntas de compatibilidade e voltagem', () => {
    carregarProntasIniciais();
    expect(encontrarRespostaPronta('Serve no Gol 2015? Comprei o carro novo', 'MLB1')).toBeNull();
    expect(encontrarRespostaPronta('É 12v ou 24v?', 'MLB1')).toBeNull();
  });

  it('garantia usa o texto alternativo quando o anúncio não tem', () => {
    const g = PRONTAS_INICIAIS.find((p) => p.titulo === 'Garantia')!.texto;
    expect(preencherModelo(g, ficha('Garantia do vendedor: 90 dias'))).toContain('é Garantia do vendedor: 90 dias.');
    expect(preencherModelo(g, ficha(null))).toContain('é informada na descrição do anúncio.');
  });
});

describe('regras da loja', () => {
  beforeEach(() => bancoEmMemoriaParaTeste());
  it('começa com o texto padrão e guarda o editado', () => {
    expect(lerRegrasDaLoja()).toBe(REGRAS_PADRAO);
    gravarRegrasDaLoja('  Envio: até 14h sai no mesmo dia.  ');
    expect(lerRegrasDaLoja()).toBe('Envio: até 14h sai no mesmo dia.');
    expect(() => gravarRegrasDaLoja('x'.repeat(6001))).toThrow(/6000/);
  });
});
