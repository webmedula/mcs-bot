import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A IA é falsa: guarda o pedido para conferirmos que a memória foi junto.
const pedidos: string[] = [];
vi.mock('../ia/provedor', () => ({
  iaConfigurada: () => true,
  completar: async (_s: string, u: string) => {
    pedidos.push(u);
    return { texto: '{"resposta":"Sim, aceitamos retirada.","confianca":0.9,"precisa_humano":false,"motivo":"regra"}', modelo: 'falso' };
  },
}));

let db: typeof import('../banco');
let pg: typeof import('./perguntas');
let cor: typeof import('./correcoes');
let sug: typeof import('./sugestao');
let servico: typeof import('./servico');

beforeAll(async () => {
  db = await import('../banco');
  pg = await import('./perguntas');
  cor = await import('./correcoes');
  sug = await import('./sugestao');
  servico = await import('./servico');
});

function nova(id: string, texto: string, itemId = 'MLB1') {
  return pg.salvarPergunta({
    plataforma: 'mercadolivre', idExterno: id, itemId, texto, compradorId: null, criadaEm: new Date().toISOString(),
    status: 'pendente', resposta: null, respondidaEm: null,
  } as any).pergunta;
}

describe('memória de correções', () => {
  beforeEach(() => { db.bancoEmMemoriaParaTeste(); pedidos.length = 0; });

  it('tira saudação e assinatura do exemplo', () => {
    expect(cor.semSaudacaoEAssinatura('Olá! Sim, temos. Atenciosamente, equipe MCS.')).toBe('Sim, temos.');
  });

  it('só conta como correção quando a resposta muda de verdade', () => {
    expect(cor.ehCorrecao('Olá! Sim, temos em estoque. Atenciosamente, equipe MCS.', 'Sim, temos em estoque.')).toBe(false);
    expect(cor.ehCorrecao('Olá! Sim, serve. Atenciosamente, equipe MCS.', 'Não serve no modelo 2015, só até 2012.')).toBe(true);
    expect(cor.ehCorrecao(null, 'qualquer coisa')).toBe(true);
  });

  it('ensinar guarda a correção, troca a sugestão e não duplica', async () => {
    const p = nova('1', 'Posso retirar na loja?');
    servico.ensinarResposta(p.id, { texto: 'Sim, pode retirar no endereço da loja após a compra.', licao: 'Aceitamos retirada no local.' });
    servico.ensinarResposta(p.id, { texto: 'Sim, pode retirar após a compra.' });
    const lista = cor.listarCorrecoes();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ origem: 'ensinar', resposta: 'Sim, pode retirar após a compra.', licao: 'Aceitamos retirada no local.' });
    expect(pg.lerPergunta(p.id)!.sugestao).toBe('Sim, pode retirar após a compra.');
    // Refazer a sugestão não apaga o que foi ensinado.
    await sug.gerarSugestao(p.id, null);
    expect(pg.lerPergunta(p.id)!.sugestao).toBe('Sim, pode retirar após a compra.');
  });

  it('acha as parecidas e prefere o mesmo anúncio', () => {
    const a = nova('1', 'Serve no Gol G5 2012?', 'MLB1');
    const b = nova('2', 'Serve no Gol G5 2012?', 'MLB2');
    nova('3', 'Tem nota fiscal?', 'MLB1');
    cor.salvarCorrecao(a, 'Sim, serve no Gol G5 2009 a 2012.', 'ensinar');
    cor.salvarCorrecao(b, 'Não serve, esse é do Palio.', 'ensinar');
    const nova4 = nova('4', 'Serve no gol g5 ano 2012?', 'MLB1');
    const achadas = cor.correcoesParecidas(nova4);
    expect(achadas).toHaveLength(2);
    expect(achadas[0]).toMatchObject({ mesmoAnuncio: true });
    expect(achadas[0].correcao.itemId).toBe('MLB1');
    expect(cor.correcoesParecidas(nova('5', 'Qual a voltagem da lâmpada?'))).toHaveLength(0);
  });

  it('a IA recebe as lições e as correções parecidas, e o uso é contado', async () => {
    const a = nova('1', 'Posso retirar pessoalmente?');
    pg.gravarSugestao(a.id, { texto: 'Olá! Não fazemos retirada. Atenciosamente, equipe MCS.', origem: 'ia', prontaId: null, confianca: 0.8, motivo: '' });
    servico.ensinarResposta(a.id, { texto: 'Sim, aceitamos retirada no local.', licao: 'A loja ACEITA retirada no local.' });
    const b = nova('2', 'Dá para retirar pessoalmente na loja?');
    const s = await sug.sugerirComIa(pg.lerPergunta(b.id)!, null);
    expect(pedidos[0]).toContain('LIÇÕES DA EQUIPE');
    expect(pedidos[0]).toContain('A loja ACEITA retirada no local.');
    expect(pedidos[0]).toContain('Resposta que estava ERRADA: Não fazemos retirada.');
    expect(pedidos[0]).toContain('Resposta CERTA: Sim, aceitamos retirada no local.');
    expect(s.motivo).toContain('1 correção');
    expect(cor.listarCorrecoes()[0].usos).toBe(1);
  });

  it('desativada não entra no pedido', async () => {
    const a = nova('1', 'Posso retirar pessoalmente?');
    const c = cor.salvarCorrecao(a, 'Sim.', 'ensinar', 'Aceita retirada.');
    cor.atualizarCorrecao(c.id, { ativa: false });
    const b = nova('2', 'Posso retirar pessoalmente na loja?');
    await sug.sugerirComIa(pg.lerPergunta(b.id)!, null);
    expect(pedidos[0]).not.toContain('LIÇÕES DA EQUIPE');
    expect(pedidos[0]).not.toContain('CORREÇÕES DA EQUIPE');
  });

  it('na aba Respondidas: Gobots melhor ensina; nossa melhor desfaz', () => {
    const p = nova('1', 'Ok. Pedido feito e pago via pix.');
    expect(() => servico.avaliarResposta(p.id, 'gobots')).toThrow(/respondidas/);
    pg.marcarRespondida(p.id, 'Boa noite. Agradecemos pela sua compra!', 'externo');
    servico.avaliarResposta(p.id, 'gobots', 'Aviso de pagamento: só agradecer.');
    expect(pg.lerPergunta(p.id)!.avaliacao).toBe('gobots');
    expect(cor.listarCorrecoes()[0]).toMatchObject({ origem: 'gobots', resposta: 'Boa noite. Agradecemos pela sua compra!', ativa: true });
    servico.avaliarResposta(p.id, 'bot');
    expect(pg.lerPergunta(p.id)!.avaliacao).toBe('bot');
    expect(cor.listarCorrecoes()[0].ativa).toBe(false);
  });
});
