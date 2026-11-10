import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conector, PerguntaExterna } from './tipos';

const remoto = new Map<string, PerguntaExterna>();
const respondidas: Array<{ id: string; texto: string }> = [];

const falso: Conector = {
  plataforma: 'mercadolivre',
  conectado: () => true,
  buscarPendentes: async () => [...remoto.values()].filter((p) => p.status === 'pendente'),
  buscarPergunta: async (id) => remoto.get(id) ?? null,
  buscarHistorico: async () => ({ lidas: 0, parouPor: 'fim' }),
  fichaDoProduto: async (itemId) => ({
    plataforma: 'mercadolivre', itemId, titulo: 'Farol Gol G5', permalink: null, preco: 100, precoCheio: 100, emPromocao: false, precoLidoEm: null, estoque: 2, condicao: 'novo',
    freteGratis: true, garantia: null, atributos: {}, descricao: null, compatibilidades: [], sku: null,
  }),
  responder: async (id, texto) => {
    respondidas.push({ id, texto });
    const p = remoto.get(id)!;
    remoto.set(id, { ...p, status: 'respondida', resposta: texto });
  },
};

vi.mock('../conectores', () => ({ conector: () => falso, CONECTORES: { mercadolivre: falso } }));
vi.mock('../conectores/mercadolivre/conector', () => ({ guardarTitulos: async () => undefined }));

let bancoEmMemoriaParaTeste: typeof import('../banco').bancoEmMemoriaParaTeste;
let config: typeof import('../config').config;
let criarRespostaPronta: typeof import('./respostasProntas').criarRespostaPronta;
let listarPerguntas: typeof import('./perguntas').listarPerguntas;
let lerPerguntaExterna: typeof import('./perguntas').lerPerguntaExterna;
let servico: typeof import('./servico');

beforeAll(async () => {
  ({ bancoEmMemoriaParaTeste } = await import('../banco'));
  ({ config } = await import('../config'));
  ({ criarRespostaPronta } = await import('./respostasProntas'));
  ({ listarPerguntas, lerPerguntaExterna } = await import('./perguntas'));
  servico = await import('./servico');
});

function pergunta(id: string, texto: string): PerguntaExterna {
  return {
    plataforma: 'mercadolivre', idExterno: id, itemId: 'MLB1', texto, compradorId: '9',
    criadaEm: new Date().toISOString(), status: 'pendente', resposta: null, respondidaEm: null,
  };
}

describe('fluxo', () => {
  beforeEach(() => {
    bancoEmMemoriaParaTeste();
    remoto.clear();
    respondidas.length = 0;
    config.anthropicApiKey = '';
    config.openrouterApiKey = '';
    config.mlEnvioHabilitado = false;
  });

  it('pendente nova ganha sugestão da resposta pronta, preenchida com a ficha', async () => {
    criarRespostaPronta({ titulo: 'Estoque', gatilhos: ['estoque'], texto: 'Temos {estoque} em estoque do {titulo}.' });
    remoto.set('10', pergunta('10', 'Tem estoque?'));
    const r = await servico.sincronizarPendentes();
    expect(r).toMatchObject({ pendentes: 1, novas: 1 });
    const p = lerPerguntaExterna('mercadolivre', '10')!;
    expect(p.sugestaoOrigem).toBe('pronta');
    expect(p.sugestao).toContain('Temos 2 em estoque do Farol Gol G5.');
  });

  it('sem resposta pronta e sem IA, fica sem sugestão e explica o motivo', async () => {
    remoto.set('11', pergunta('11', 'Serve no Gol 2015?'));
    await servico.sincronizarPendentes();
    const p = lerPerguntaExterna('mercadolivre', '11')!;
    expect(p.sugestao).toBeNull();
    expect(p.sugestaoMotivo).toMatch(/IA não está configurada/);
  });

  it('guarda o que foi respondido por fora (Gobots) quando a pendente some da lista', async () => {
    remoto.set('12', pergunta('12', 'Tem nota?'));
    await servico.sincronizarPendentes();
    remoto.set('12', { ...remoto.get('12')!, status: 'respondida', resposta: 'Sim, emitimos.' });
    const r = await servico.sincronizarPendentes();
    expect(r.resolvidasFora).toBe(1);
    const [p] = listarPerguntas({ status: 'respondida' });
    expect(p.respondidaPor).toBe('externo');
    expect(p.resposta).toBe('Sim, emitimos.');
  });

  it('não envia com a trava desligada', async () => {
    remoto.set('13', pergunta('13', 'Tem nota?'));
    await servico.sincronizarPendentes();
    const p = lerPerguntaExterna('mercadolivre', '13')!;
    await expect(servico.responderPergunta(p.id, 'Sim.', 'painel')).rejects.toThrow(/desligado/);
    expect(respondidas).toHaveLength(0);
  });

  it('com a trava ligada envia, mas não responde o que já foi respondido lá', async () => {
    config.mlEnvioHabilitado = true;
    remoto.set('14', pergunta('14', 'Tem nota?'));
    remoto.set('15', pergunta('15', 'Tem garantia?'));
    await servico.sincronizarPendentes();
    const a = lerPerguntaExterna('mercadolivre', '14')!;
    const b = lerPerguntaExterna('mercadolivre', '15')!;

    const enviada = await servico.responderPergunta(a.id, 'Sim, emitimos.', 'painel');
    expect(enviada).toMatchObject({ status: 'respondida', respondidaPor: 'painel' });
    expect(respondidas).toEqual([{ id: '14', texto: 'Sim, emitimos.' }]);

    remoto.set('15', { ...remoto.get('15')!, status: 'respondida', resposta: 'do Gobots' });
    await expect(servico.responderPergunta(b.id, 'Tem sim.', 'painel')).rejects.toThrow(/já foi respondida/);
    expect(respondidas).toHaveLength(1);
    expect(lerPerguntaExterna('mercadolivre', '15')!.respondidaPor).toBe('externo');
  });

  it('aviso de pergunta apagada fecha a pendente', async () => {
    remoto.set('16', pergunta('16', 'oi'));
    await servico.sincronizarPendentes();
    remoto.delete('16');
    await servico.avisoDePergunta('mercadolivre', '16');
    expect(lerPerguntaExterna('mercadolivre', '16')!.status).toBe('fechada');
  });
});

describe('respostas prontas novas', () => {
  beforeEach(() => {
    bancoEmMemoriaParaTeste();
    remoto.clear();
    config.anthropicApiKey = '';
    config.openrouterApiKey = '';
  });

  it('valem para as pendentes que já estavam sem sugestão', async () => {
    remoto.set('20', pergunta('20', 'Emite nota fiscal?'));
    await servico.sincronizarPendentes();
    expect(lerPerguntaExterna('mercadolivre', '20')!.sugestao).toBeNull();
    criarRespostaPronta({ titulo: 'NF', gatilhos: ['nota fiscal'], texto: 'Sim, emitimos.' });
    expect(servico.reaplicarRespostasProntas()).toBe(1);
    expect(lerPerguntaExterna('mercadolivre', '20')!.sugestaoOrigem).toBe('pronta');
  });
});
