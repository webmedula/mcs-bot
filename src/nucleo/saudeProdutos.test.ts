import { beforeEach, describe, expect, it } from 'vitest';
import { banco, bancoEmMemoriaParaTeste } from '../banco';
import { periodoValido, saudeDosProdutos } from './saudeProdutos';

let n = 0;
function pergunta(item: string, texto: string, assunto: string, criada: string) {
  banco().prepare(`INSERT INTO perguntas (plataforma, id_externo, item_id, texto, criada_em, status, assunto, comprador_id, atualizado_em)
      VALUES ('mercadolivre', ?, ?, ?, ?, 'respondida', ?, 'COMPRADOR9', ?)`).run(String(++n), item, texto, criada, assunto, criada);
}

describe('saúde do produto (perguntas por anúncio)', () => {
  beforeEach(() => { bancoEmMemoriaParaTeste(); n = 0; });

  it('valida o período', () => {
    expect(periodoValido('2026-10-01', '2026-10-31')).toEqual({ desde: '2026-10-01', ate: '2026-10-31' });
    expect(periodoValido('2026-10-31', '2026-10-01')).toBeNull();
    expect(periodoValido('x', undefined)).toBeNull();
    expect(periodoValido(undefined, undefined, new Date('2026-11-15T12:00:00Z'))).toEqual({ desde: '2026-10-16', ate: '2026-11-15' });
  });

  it('conta por anúncio e assunto e acha as perguntas que se repetem, só no período', () => {
    banco().prepare(`INSERT INTO produtos (plataforma, item_id, titulo, ficha_json, atualizado_em) VALUES ('mercadolivre', 'MLB1', 'Farol de milha', ?, '2026-10-01')`)
      .run(JSON.stringify({ sku: 'FAROL-01' }));
    pergunta('MLB1', 'Qual a medida do farol?', 'medidas', '2026-10-03T10:00:00.000-04:00');
    pergunta('MLB1', 'qual a medida desse farol', 'medidas', '2026-10-09T10:00:00.000-04:00');
    pergunta('MLB1', 'Qual medida do farol?', 'medidas', '2026-10-20T10:00:00.000-04:00');
    pergunta('MLB1', 'Tem nota fiscal?', 'nota_fiscal', '2026-10-21T10:00:00.000-04:00');
    pergunta('MLB2', 'Serve no Gol 2015?', 'compatibilidade', '2026-10-05T10:00:00.000-04:00');
    pergunta('MLB1', 'Qual a medida do farol?', 'medidas', '2026-11-02T10:00:00.000-04:00'); // fora do período

    const r = saudeDosProdutos('2026-10-01', '2026-10-31');
    expect(r.total).toBe(5);
    const a = r.anuncios[0];
    expect(a).toMatchObject({ itemId: 'MLB1', titulo: 'Farol de milha', sku: 'FAROL-01', perguntas: 4 });
    expect(a.porAssunto[0]).toEqual({ assunto: 'medidas', nome: 'Medidas e especificações', quantidade: 3 });
    expect(a.repetidas[0]).toMatchObject({ assunto: 'medidas', quantidade: 3 });
    expect(r.anuncios[1]).toMatchObject({ itemId: 'MLB2', perguntas: 1, repetidas: [] });
    expect(JSON.stringify(r)).not.toContain('COMPRADOR9');
  });
});
