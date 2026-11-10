import { beforeEach, describe, expect, it } from 'vitest';
import { bancoEmMemoriaParaTeste } from '../banco';
import { classificarAssunto } from './assuntos';
import { agruparPerguntas } from './frequentes';
import { contarPorStatus, lerPergunta, salvarPergunta } from './perguntas';
import { criarRespostaPronta, encontrarRespostaPronta, gatilhoCasa, preencherModelo } from './respostasProntas';
import { fichaEmTexto, limparDadosDeContato, lerJsonDaIa, montarTexto } from './sugestao';
import { normalizar, palavras } from './texto';
import type { PerguntaExterna } from './tipos';

function externa(p: Partial<PerguntaExterna> = {}): PerguntaExterna {
  return {
    plataforma: 'mercadolivre', idExterno: '1', itemId: 'MLB1', texto: 'Tem nota fiscal?', compradorId: '9',
    criadaEm: '2026-11-10T10:00:00.000Z', status: 'pendente', resposta: null, respondidaEm: null, ...p,
  };
}

describe('texto', () => {
  it('normaliza acento, pontuação e caixa', () => {
    expect(normalizar('  Olá!! Serve no GOL 2015?  ')).toBe('ola serve no gol 2015');
  });
  it('tira palavras de ligação e cumprimentos', () => {
    expect(palavras('Boa tarde, vocês emitem nota fiscal?')).toEqual(['emitem', 'nota', 'fiscal']);
  });
});

describe('assuntos', () => {
  it.each([
    ['Serve no Gol 2015?', 'compatibilidade'],
    ['Qual o prazo de entrega para o CEP 01001-000?', 'frete'],
    ['Emite nota fiscal?', 'nota_fiscal'],
    ['É original ou paralelo?', 'original'],
    ['Vem o par ou só uma unidade?', 'kit_lado'],
    ['Qual a voltagem, 12v?', 'medidas'],
    ['Tem pronta entrega?', 'estoque'],
    ['Faz desconto no pix?', 'preco'],
    ['Quero saber a cor do céu', 'medidas'],
    ['kafka', 'outros'],
  ])('%s → %s', (texto, assunto) => {
    expect(classificarAssunto(texto)).toBe(assunto);
  });
});

describe('respostas prontas', () => {
  beforeEach(() => bancoEmMemoriaParaTeste());

  it('gatilho casa com todas as palavras, em qualquer ordem', () => {
    expect(gatilhoCasa(normalizar('Vocês emitem a nota fiscal?'), 'nota fiscal')).toBe(true);
    expect(gatilhoCasa(normalizar('fiscal da nota'), 'nota fiscal')).toBe(true);
    expect(gatilhoCasa(normalizar('anotação'), 'nota')).toBe(false);
  });

  it('a do anúncio vence a geral, e o gatilho mais longo vence o curto', () => {
    const geral = criarRespostaPronta({ titulo: 'NF', gatilhos: ['nota'], texto: 'Sim, emitimos nota.' });
    const longa = criarRespostaPronta({ titulo: 'NF CNPJ', gatilhos: ['nota cnpj'], texto: 'Emitimos no CNPJ.' });
    const doAnuncio = criarRespostaPronta({ titulo: 'NF do MLB1', gatilhos: ['nota'], texto: 'Neste anúncio...', escopo: 'mlb1' });

    expect(encontrarRespostaPronta('tem nota?', null)!.pronta.id).toBe(geral.id);
    expect(encontrarRespostaPronta('nota no meu cnpj?', null)!.pronta.id).toBe(longa.id);
    expect(encontrarRespostaPronta('tem nota?', 'MLB1')!.pronta.id).toBe(doAnuncio.id);
    expect(encontrarRespostaPronta('tem nota?', 'MLB2')!.pronta.id).toBe(geral.id);
    expect(encontrarRespostaPronta('serve no gol?', 'MLB1')).toBeNull();
  });

  it('ignora resposta desativada e valida o tamanho', () => {
    criarRespostaPronta({ titulo: 'off', gatilhos: ['nota'], texto: 'x', ativa: false });
    expect(encontrarRespostaPronta('nota', null)).toBeNull();
    expect(() => criarRespostaPronta({ titulo: 't', gatilhos: ['a b'], texto: 'x'.repeat(2001) })).toThrow(/2000/);
    expect(() => criarRespostaPronta({ titulo: 't', gatilhos: [], texto: 'x' })).toThrow(/gatilho/);
  });

  it('preenche as variáveis com a ficha', () => {
    const t = preencherModelo('{titulo} sai por {preco}, temos {estoque}.', {
      plataforma: 'mercadolivre', itemId: 'MLB1', titulo: 'Farol Gol', permalink: null, preco: 199.9, estoque: 3,
      precoCheio: 249.9, emPromocao: true, precoLidoEm: null, condicao: null, freteGratis: null, garantia: null, atributos: {}, descricao: null, compatibilidades: [], sku: null,
    });
    expect(t).toBe('Farol Gol sai por R$ 199,90, temos 3.');
    expect(preencherModelo('de {preco_cheio} por {preco}', {
      plataforma: 'mercadolivre', itemId: 'MLB1', titulo: null, permalink: null, preco: 199.9, estoque: 3,
      precoCheio: 249.9, emPromocao: true, precoLidoEm: null, condicao: null, freteGratis: null, garantia: null,
      atributos: {}, descricao: null, compatibilidades: [], sku: null,
    })).toBe('de R$ 249,90 por R$ 199,90');
  });
});

describe('texto final da resposta', () => {
  it('acrescenta saudação e assinatura sem repetir', () => {
    const t = montarTexto('Sim, emitimos nota fiscal.');
    expect(t.startsWith('Olá!')).toBe(true);
    expect(t.endsWith('Equipe MCS.')).toBe(true);
    expect(montarTexto(t)).toBe(t);
  });

  it('tira telefone, e-mail e link, mas não código de peça', () => {
    const t = limparDadosDeContato('Chame (11) 98765-4321 ou x@y.com.br ou https://site.com. Código 93378837.');
    expect(t).not.toMatch(/98765|@|https/);
    expect(t).toContain('93378837');
  });

  it('lê o JSON da IA mesmo com texto em volta', () => {
    const j = lerJsonDaIa('aqui: {"resposta":"Sim.","confianca":0.9,"precisa_humano":false,"motivo":"ficha"} fim');
    expect(j).toEqual({ resposta: 'Sim.', confianca: 0.9, precisaHumano: false, motivo: 'ficha' });
    expect(lerJsonDaIa('sem json')).toBeNull();
  });
});

describe('perguntas no banco', () => {
  beforeEach(() => bancoEmMemoriaParaTeste());

  it('pendente que chega respondida sem passar por nós fica como "externo" (Gobots)', () => {
    const { pergunta, nova } = salvarPergunta(externa());
    expect(nova).toBe(true);
    expect(pergunta.assunto).toBe('nota_fiscal');
    salvarPergunta(externa({ status: 'respondida', resposta: 'Sim!', respondidaEm: '2026-11-10T10:05:00.000Z' }));
    const depois = lerPergunta(pergunta.id)!;
    expect(depois.status).toBe('respondida');
    expect(depois.respondidaPor).toBe('externo');
    expect(depois.resposta).toBe('Sim!');
    expect(contarPorStatus()).toEqual({ pendente: 0, respondida: 1, fechada: 0 });
  });
});

describe('perguntas frequentes', () => {
  it('agrupa por assunto e junta as parecidas, com a resposta mais usada', () => {
    const lista = [
      { texto: 'Emite nota fiscal?', resposta: 'Sim, emitimos.', assunto: 'nota_fiscal' },
      { texto: 'Vocês emitem nota fiscal?', resposta: 'Sim, emitimos.', assunto: 'nota_fiscal' },
      { texto: 'emite nota fiscal', resposta: 'Emitimos sim', assunto: 'nota_fiscal' },
      { texto: 'Serve no Gol 2015?', resposta: 'Serve.', assunto: 'compatibilidade' },
    ];
    const r = agruparPerguntas(lista);
    expect(r[0].assunto).toBe('nota_fiscal');
    expect(r[0].quantidade).toBe(3);
    expect(r[0].percentual).toBe(75);
    expect(r[0].grupos[0].quantidade).toBe(3);
    expect(r[0].grupos[0].respostaMaisUsada).toBe('Sim, emitimos.');
    expect(r[0].grupos[0].gatilhoSugerido).toMatch(/nota|fiscal|emite/);
  });
});

describe('preço na ficha que vai para a IA', () => {
  const base = {
    plataforma: 'mercadolivre' as const, itemId: 'MLB1', titulo: 'Farol', permalink: null, estoque: 1, precoLidoEm: null,
    condicao: null, freteGratis: null, garantia: null, atributos: {}, descricao: null, compatibilidades: [], sku: null,
  };
  it('mostra promoção e preço cheio', () => {
    expect(fichaEmTexto({ ...base, preco: 36.99, precoCheio: 78.9, emPromocao: true })).toContain(
      'Preço agora: R$ 36.99 (em promoção; preço sem promoção R$ 78.90)',
    );
  });
  it('sem preço, manda não informar valor', () => {
    expect(fichaEmTexto({ ...base, preco: null, precoCheio: null, emPromocao: false })).toContain('NÃO DISPONÍVEL');
  });
});
