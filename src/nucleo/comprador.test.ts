import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conector, PerguntaExterna } from './tipos';

const remoto = new Map<string, PerguntaExterna>();
const apelidos: Record<string, string> = { '1': 'MARIA.SILVA82', '2': 'AUTOPECAS2020' };
let chamadasApelido = 0;

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
  responder: async () => undefined,
  apelidoDoComprador: async (id) => {
    chamadasApelido++;
    return apelidos[id] ?? null;
  },
};

vi.mock('../conectores', () => ({ conector: () => falso, CONECTORES: { mercadolivre: falso } }));
vi.mock('../conectores/mercadolivre/conector', () => ({ guardarTitulos: async () => undefined }));

let comprador: typeof import('./comprador');
let banco: typeof import('../banco');
let config: typeof import('../config').config;
let servico: typeof import('./servico');
let perguntas: typeof import('./perguntas');
let sugestao: typeof import('./sugestao');
let correcoes: typeof import('./correcoes');
let criarRespostaPronta: typeof import('./respostasProntas').criarRespostaPronta;

beforeAll(async () => {
  comprador = await import('./comprador');
  banco = await import('../banco');
  ({ config } = await import('../config'));
  servico = await import('./servico');
  perguntas = await import('./perguntas');
  sugestao = await import('./sugestao');
  correcoes = await import('./correcoes');
  ({ criarRespostaPronta } = await import('./respostasProntas'));
});

function pergunta(id: string, texto: string, compradorId: string): PerguntaExterna {
  return {
    plataforma: 'mercadolivre', idExterno: id, itemId: 'MLB1', texto, compradorId,
    criadaEm: new Date().toISOString(), status: 'pendente', resposta: null, respondidaEm: null,
  };
}

describe('primeiro nome a partir do apelido', () => {
  it.each([
    ['MARIA.SILVA82', 'Maria'],
    ['mariana_costa', 'Mariana'],
    ['JOAOPAULO_RS', 'João'],
    ['ANTONIO-CARLOS', 'Antônio'],
    ['FERNANDOSOUZA1990', 'Fernando'],
    ['ANAPECAS', null],
    ['AUTOPECAS2020', null],
    ['XYZ123', null],
    ['', null],
  ])('%s → %s', (apelido, nome) => {
    expect(comprador.primeiroNomeDoApelido(apelido)).toBe(nome);
  });
});

describe('saudação com o nome', () => {
  beforeEach(() => {
    config.saudacao = 'Olá!';
    config.assinatura = 'Atenciosamente, equipe MCS.';
    config.respostaComNome = true;
  });

  it('põe o nome quando há, e não quando não há ou está desligado', () => {
    expect(sugestao.montarTexto('Temos sim.', 'Maria')).toBe('Olá, Maria! Temos sim. Atenciosamente, equipe MCS.');
    expect(sugestao.montarTexto('Temos sim.', null)).toBe('Olá! Temos sim. Atenciosamente, equipe MCS.');
    config.respostaComNome = false;
    expect(sugestao.montarTexto('Temos sim.', 'Maria')).toBe('Olá! Temos sim. Atenciosamente, equipe MCS.');
  });

  it('a memória tira o nome junto com a saudação (não vira exemplo para outra pessoa)', () => {
    expect(correcoes.semSaudacaoEAssinatura('Olá, Maria! Temos sim. Atenciosamente, equipe MCS.')).toBe('Temos sim.');
    expect(correcoes.semSaudacaoEAssinatura('Olá, tudo bem? Temos sim.')).toBe('Temos sim.');
  });
});

describe('fluxo com quem pergunta', () => {
  beforeEach(() => {
    banco.bancoEmMemoriaParaTeste();
    remoto.clear();
    chamadasApelido = 0;
    config.anthropicApiKey = '';
    config.openrouterApiKey = '';
    config.saudacao = 'Olá!';
    config.respostaComNome = true;
  });

  it('a sugestão da resposta pronta já sai com o nome; apelido sem nome fica no "Olá!"', async () => {
    criarRespostaPronta({ titulo: 'NF', gatilhos: ['nota fiscal'], texto: 'Sim, emitimos nota fiscal.' });
    remoto.set('10', pergunta('10', 'Tem nota fiscal?', '1'));
    remoto.set('11', pergunta('11', 'Tem nota fiscal?', '2'));
    await servico.sincronizarPendentes();
    const a = perguntas.lerPerguntaExterna('mercadolivre', '10')!;
    const b = perguntas.lerPerguntaExterna('mercadolivre', '11')!;
    expect(a.sugestao).toMatch(/^Olá, Maria! Sim, emitimos nota fiscal\./);
    expect(a.compradorApelido).toBe('MARIA.SILVA82');
    expect(a.compradorNome).toBe('Maria');
    expect(b.sugestao).toMatch(/^Olá! Sim/);
    // O apelido é lido uma vez só por pessoa.
    await servico.sincronizarPendentes();
    expect(chamadasApelido).toBe(2);
  });

  it('pendente que já tinha sugestão ganha o nome na saudação sem refazer', async () => {
    remoto.set('12', pergunta('12', 'Tem nota fiscal?', '1'));
    const { pergunta: p } = perguntas.salvarPergunta(remoto.get('12')!);
    perguntas.gravarSugestao(p.id, { texto: 'Olá! Sim, emitimos. Atenciosamente, equipe MCS.', origem: 'pronta', prontaId: null, confianca: 1, motivo: 'x' });
    await servico.sincronizarPendentes();
    expect(perguntas.lerPergunta(p.id)!.sugestao).toBe('Olá, Maria! Sim, emitimos. Atenciosamente, equipe MCS.');
  });

  it('outras perguntas da mesma pessoa ficam disponíveis para a IA', async () => {
    remoto.set('13', pergunta('13', 'Serve no Gol 2015?', '1'));
    remoto.set('14', pergunta('14', 'E o farol direito também tem?', '1'));
    await servico.sincronizarPendentes();
    const p = perguntas.lerPerguntaExterna('mercadolivre', '14')!;
    expect(comprador.outrasPerguntasDoComprador(p).map((o) => o.pergunta)).toEqual(['Serve no Gol 2015?']);
  });
});
