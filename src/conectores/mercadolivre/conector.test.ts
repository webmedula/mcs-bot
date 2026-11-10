import { describe, expect, it } from 'vitest';
import { idDaPergunta } from '../../rotas/notificacoes';
import { perguntaDoMl, statusDoMl } from './conector';

describe('tradução do ML', () => {
  it('status', () => {
    expect(statusDoMl('UNANSWERED')).toBe('pendente');
    expect(statusDoMl('ANSWERED')).toBe('respondida');
    expect(statusDoMl('BANNED')).toBe('fechada');
    expect(statusDoMl('CLOSED_UNANSWERED')).toBe('fechada');
  });

  it('pergunta no formato api_version=4', () => {
    const p = perguntaDoMl({
      id: 123, item_id: 'MLB9', text: 'Serve?', status: 'ANSWERED', date_created: '2026-11-10T10:00:00.000-04:00',
      from: { id: 55 }, answer: { text: 'Serve sim', date_created: '2026-11-10T10:03:00.000-04:00', status: 'ACTIVE' },
    });
    expect(p).toEqual({
      plataforma: 'mercadolivre', idExterno: '123', itemId: 'MLB9', texto: 'Serve?', compradorId: '55',
      criadaEm: '2026-11-10T10:00:00.000-04:00', status: 'respondida', resposta: 'Serve sim',
      respondidaEm: '2026-11-10T10:03:00.000-04:00',
    });
  });

  it('id da pergunta no aviso', () => {
    expect(idDaPergunta('/questions/5036111111')).toBe('5036111111');
    expect(idDaPergunta('/orders/1')).toBeNull();
    expect(idDaPergunta(undefined)).toBeNull();
  });
});
