import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

let db: typeof import('../banco');
let pg: typeof import('./perguntas');
let cor: typeof import('./correcoes');
let servico: typeof import('./servico');

beforeAll(async () => {
  db = await import('../banco');
  pg = await import('./perguntas');
  cor = await import('./correcoes');
  servico = await import('./servico');
});

function nova(id: string, texto: string, itemId = 'MLB1') {
  return pg.salvarPergunta({
    plataforma: 'mercadolivre', idExterno: id, itemId, texto, compradorId: null, criadaEm: new Date().toISOString(),
    status: 'pendente', resposta: null, respondidaEm: null,
  } as any).pergunta;
}

function anuncio(itemId: string, sku: string | null) {
  db.banco()
    .prepare(`INSERT INTO produtos (plataforma, item_id, titulo, ficha_json, atualizado_em) VALUES ('mercadolivre', ?, 'Lanterna', ?, ?)`)
    .run(itemId, JSON.stringify({ sku }), new Date().toISOString());
}

describe('vale para (alcance da correção)', () => {
  beforeEach(() => {
    db.bancoEmMemoriaParaTeste();
    anuncio('MLB1', 'LANT-01');
    anuncio('MLB2', 'LANT-01');
    anuncio('MLB3', 'OUTRO');
  });

  it('correção só do anúncio não aparece em outro anúncio, nem a lição dela', () => {
    const p = nova('1', 'Essa lanterna é do lado direito?');
    const c = servico.ensinarResposta(p.id, { texto: 'Não, é do lado esquerdo.', licao: 'Este anúncio é só lado esquerdo.', escopo: 'anuncio' });
    expect(c.escopo).toBe('anuncio');
    const mesmo = nova('2', 'A lanterna é do lado direito?', 'MLB1');
    const outro = nova('3', 'A lanterna é do lado direito?', 'MLB3');
    expect(cor.correcoesParecidas(mesmo).map((e) => e.correcao.id)).toEqual([c.id]);
    expect(cor.correcoesParecidas(outro)).toEqual([]);
    expect(cor.licoesDaEquipe(mesmo)).toEqual(['Este anúncio é só lado esquerdo.']);
    expect(cor.licoesDaEquipe(outro)).toEqual([]);
  });

  it('correção do produto vale para outro anúncio com o mesmo SKU', () => {
    const p = nova('1', 'Funciona em 12 volts?');
    const c = servico.ensinarResposta(p.id, { texto: 'Sim, é bivolt 12/24V.', escopo: 'produto' });
    expect(c.escopo).toBe('produto');
    expect(c.sku).toBe('LANT-01');
    const mesmoSku = cor.correcoesParecidas(nova('2', 'Funciona em 12 volts?', 'MLB2'));
    expect(mesmoSku.map((e) => e.mesmoProduto)).toEqual([true]);
    expect(cor.correcoesParecidas(nova('3', 'Funciona em 12 volts?', 'MLB3'))).toEqual([]);
    expect(cor.memoriaParaIa(nova('4', 'Funciona em 12 volts?', 'MLB2')).texto).toContain('mesmo produto');
  });

  it('sem SKU, "produto" vira "anúncio"; sem escolher, continua geral como antes', () => {
    anuncio('MLB9', null);
    const a = servico.ensinarResposta(nova('1', 'Tem nota fiscal?', 'MLB9').id, { texto: 'Sim, emitimos.', escopo: 'produto' });
    expect(a.escopo).toBe('anuncio');
    const b = servico.ensinarResposta(nova('2', 'Posso retirar na loja?').id, { texto: 'Sim, pode retirar.' });
    expect(b.escopo).toBe('geral');
    expect(cor.correcoesParecidas(nova('3', 'Posso retirar na loja?', 'MLB3')).map((e) => e.correcao.id)).toEqual([b.id]);
  });

  it('dá para mudar o alcance depois, na Memória', () => {
    const c = servico.ensinarResposta(nova('1', 'Essa lanterna é do lado direito?').id, { texto: 'Não, esquerdo.' });
    expect(cor.atualizarCorrecao(c.id, { escopo: 'anuncio' }).escopo).toBe('anuncio');
    expect(cor.correcoesParecidas(nova('2', 'Essa lanterna é do lado direito?', 'MLB3'))).toEqual([]);
  });
});

describe('joinha na sugestão', () => {
  beforeEach(() => { db.bancoEmMemoriaParaTeste(); });

  it('grava o voto, conta no placar e zera quando a sugestão muda', () => {
    const p = nova('1', 'Tem nota fiscal?');
    expect(() => servico.votarSugestao(p.id, 'bom')).toThrow(/não tem sugestão/);
    pg.gravarSugestao(p.id, { texto: 'Sim, emitimos.', origem: 'ia', prontaId: null, confianca: 0.9, motivo: 'x' });
    expect(servico.votarSugestao(p.id, 'bom').sugestaoVoto).toBe('bom');
    expect(pg.contarVotos()).toEqual({ bom: 1, ruim: 0 });
    expect(servico.votarSugestao(p.id, 'ruim').sugestaoVoto).toBe('ruim');
    expect(servico.votarSugestao(p.id, null).sugestaoVoto).toBeNull();
    servico.votarSugestao(p.id, 'ruim');
    pg.gravarSugestao(p.id, { texto: 'Sim, emitimos nota.', origem: 'ia', prontaId: null, confianca: 0.9, motivo: 'x' });
    expect(pg.lerPergunta(p.id)!.sugestaoVoto).toBeNull();
  });
});
