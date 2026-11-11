import { beforeEach, describe, expect, it } from 'vitest';
import { banco, bancoEmMemoriaParaTeste } from '../banco';
import { visaoGeral } from './visaoGeral';

const AGORA = Date.parse('2026-11-10T15:00:00Z');
const ha = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();
let n = 0;
function pergunta(o: Record<string, unknown>) {
  const p: Record<string, unknown> = { item_id: 'MLB1', texto: 'tem nota fiscal?', status: 'pendente', assunto: 'nota_fiscal', resposta: null, respondida_em: null,
    respondida_por: null, sugestao: null, sugestao_origem: null, ...o };
  banco().prepare(`INSERT INTO perguntas (plataforma, id_externo, item_id, texto, criada_em, status, assunto, resposta, respondida_em,
      respondida_por, sugestao, sugestao_origem, avaliacao, atualizado_em) VALUES ('mercadolivre', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(++n), p.item_id as any, p.texto as any, p.criada_em as any, p.status as any, p.assunto as any, p.resposta as any,
      p.respondida_em as any, p.respondida_por as any, p.sugestao as any, p.sugestao_origem as any, (p.avaliacao ?? null) as any, ha(0));
}

describe('visão geral', () => {
  beforeEach(() => { bancoEmMemoriaParaTeste(); n = 0; });

  it('conta o período, o anterior, quem respondeu e quanto o bot acerta', () => {
    // período atual (7 dias)
    pergunta({ criada_em: ha(2), status: 'respondida', respondida_em: ha(1.5), respondida_por: 'externo',
      resposta: 'Olá! Sim, emitimos nota fiscal em todos os pedidos.', sugestao: 'Olá! Sim, todos os pedidos saem com nota fiscal.', sugestao_origem: 'pronta', avaliacao: 'iguais' });
    pergunta({ criada_em: ha(30), status: 'respondida', respondida_em: ha(25), respondida_por: 'painel', sugestao: 'x', sugestao_origem: 'ia' });
    pergunta({ criada_em: ha(26), sugestao_origem: 'ia' }); // IA pediu uma pessoa, ainda pendente
    pergunta({ criada_em: '2026-11-09T10:00:00.000-04:00', item_id: 'MLB2', assunto: 'frete' }); // data com fuso do ML
    // período anterior
    pergunta({ criada_em: ha(24 * 10), status: 'respondida', respondida_em: ha(24 * 10 - 1), respondida_por: 'externo' });

    const v = visaoGeral(7, AGORA);
    expect(v.atual.recebidas).toBe(4);
    expect(v.anterior.recebidas).toBe(1);
    expect(v.atual.respondidas).toBe(2);
    expect(v.atual.semResposta).toBe(2);
    expect(v.atual.porQuem).toEqual({ externo: 1, painel: 1, 'mcs-bot': 0 });
    expect(v.atual.tempoMedianoMin).toBe(300);
    expect(v.atual.respondidasEm1h).toBe(50);
    expect(v.atual.bot).toEqual({ analisadas: 3, pronta: 1, ia: 1, semSugestao: 1, cobertura: 66.7 });
    expect(v.atual.comparacao).toEqual({ comparadas: 1, parecidas: 1, percentual: 100 });
    expect(v.atual.avaliacoes).toEqual({ bot: 0, iguais: 1, gobots: 0, nossaMelhorOuIgual: 100 });
    expect(v.agora).toMatchObject({ pendentes: 2, pendentesMais24h: 2 });
    expect(v.porDia).toHaveLength(8);
    expect(v.porDia.reduce((s, d) => s + d.recebidas, 0)).toBe(4);
    expect(v.assuntos[0]).toEqual({ assunto: 'nota_fiscal', nome: expect.any(String), quantidade: 3 });
    expect(v.anuncios[0]).toMatchObject({ itemId: 'MLB1', quantidade: 3, pendentes: 1 });
  });

  it('banco vazio não quebra', () => {
    const v = visaoGeral(30, AGORA);
    expect(v.atual.recebidas).toBe(0);
    expect(v.atual.tempoMedianoMin).toBeNull();
    expect(v.atual.bot.cobertura).toBeNull();
  });
});
