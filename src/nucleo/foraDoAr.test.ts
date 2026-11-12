import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conector, PerguntaExterna } from './tipos';

const remoto = new Map<string, PerguntaExterna>();
let situacoes: Record<string, string> = {};
let fichasLidas = 0;

const falso: Conector = {
  plataforma: 'mercadolivre',
  conectado: () => true,
  buscarPendentes: async () => [...remoto.values()].filter((p) => p.status === 'pendente'),
  buscarPergunta: async (id) => remoto.get(id) ?? null,
  buscarHistorico: async () => ({ lidas: 0, parouPor: 'fim' }),
  fichaDoProduto: async (itemId) => {
    fichasLidas++;
    return {
      plataforma: 'mercadolivre', itemId, titulo: 'Farol Gol G5', permalink: null, preco: 100, precoCheio: 100, emPromocao: false, precoLidoEm: null, estoque: 2, condicao: 'novo',
      freteGratis: true, garantia: null, atributos: {}, descricao: null, compatibilidades: [], sku: null,
    };
  },
  responder: async () => undefined,
  situacaoDosAnuncios: async (ids) => Object.fromEntries(ids.filter((i) => situacoes[i]).map((i) => [i, situacoes[i]])),
};

vi.mock('../conectores', () => ({ conector: () => falso, CONECTORES: { mercadolivre: falso } }));
vi.mock('../conectores/mercadolivre/conector', () => ({ guardarTitulos: async () => undefined }));

let banco: typeof import('../banco');
let config: typeof import('../config').config;
let servico: typeof import('./servico');
let perguntas: typeof import('./perguntas');
let criarRespostaPronta: typeof import('./respostasProntas').criarRespostaPronta;

beforeAll(async () => {
  banco = await import('../banco');
  ({ config } = await import('../config'));
  servico = await import('./servico');
  perguntas = await import('./perguntas');
  ({ criarRespostaPronta } = await import('./respostasProntas'));
});

function pergunta(id: string, itemId: string): PerguntaExterna {
  return {
    plataforma: 'mercadolivre', idExterno: id, itemId, texto: 'Tem nota fiscal?', compradorId: null,
    criadaEm: new Date().toISOString(), status: 'pendente', resposta: null, respondidaEm: null,
  };
}

describe('anúncio fora do ar', () => {
  beforeEach(() => {
    banco.bancoEmMemoriaParaTeste();
    remoto.clear();
    fichasLidas = 0;
    config.anthropicApiKey = '';
    config.openrouterApiKey = '';
    criarRespostaPronta({ titulo: 'NF', gatilhos: ['nota fiscal'], texto: 'Sim, emitimos nota fiscal.' });
    situacoes = { MLB1: 'active', MLB2: 'paused' };
    remoto.set('1', pergunta('1', 'MLB1'));
    remoto.set('2', pergunta('2', 'MLB2'));
  });

  it('pergunta de anúncio pausado não ganha sugestão e fica marcada', async () => {
    await servico.sincronizarPendentes();
    const ativa = perguntas.lerPerguntaExterna('mercadolivre', '1')!;
    const pausada = perguntas.lerPerguntaExterna('mercadolivre', '2')!;
    expect(ativa.anuncioSituacao).toBe('active');
    expect(ativa.sugestao).toContain('emitimos nota fiscal');
    expect(pausada.anuncioSituacao).toBe('paused');
    expect(pausada.sugestao).toBeNull();
    expect(pausada.sugestaoMotivo).toMatch(/^Anúncio fora do ar.*pausado/);
    expect(fichasLidas).toBe(1);
  });

  it('arquivar de uma vez tira só as de anúncio fora do ar', async () => {
    await servico.sincronizarPendentes();
    expect(perguntas.arquivarForaDoAr()).toBe(1);
    expect(perguntas.listarPerguntas({ status: 'pendente' }).map((p) => p.idExterno)).toEqual(['1']);
  });

  it('se o anúncio volta ao ar, a pergunta ganha sugestão', async () => {
    await servico.sincronizarPendentes();
    situacoes.MLB2 = 'active';
    await servico.sincronizarPendentes();
    const p = perguntas.lerPerguntaExterna('mercadolivre', '2')!;
    expect(p.anuncioSituacao).toBe('active');
    expect(p.sugestao).toContain('emitimos nota fiscal');
  });
});
