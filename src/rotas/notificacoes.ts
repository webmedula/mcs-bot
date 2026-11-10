import type { FastifyInstance } from 'fastify';
import { lerToken } from '../conectores/mercadolivre/oauth';
import { logger } from '../logger';
import { avisoDePergunta } from '../nucleo/servico';

/** Extrai o id da pergunta de "/questions/123456". */
export function idDaPergunta(resource: unknown): string | null {
  const m = /^\/questions\/(\d+)/.exec(String(resource ?? ''));
  return m ? m[1] : null;
}

/**
 * Aviso em tempo real do Mercado Livre (tópico "questions"). O ML espera 200 rápido e reenvia se
 * não receber; por isso responde na hora e processa depois. Não confiamos no corpo: buscamos a
 * pergunta na API com o nosso token, então um aviso falso não grava nada que não exista lá.
 */
export async function rotasNotificacoes(app: FastifyInstance): Promise<void> {
  app.post('/notificacoes/ml', async (req, reply) => {
    const corpo: any = req.body ?? {};
    const id = corpo.topic === 'questions' ? idDaPergunta(corpo.resource) : null;
    const nosso = lerToken()?.userId;
    const deOutraConta = Boolean(nosso && corpo.user_id && Number(corpo.user_id) !== nosso);

    if (id && !deOutraConta) {
      setImmediate(() => {
        avisoDePergunta('mercadolivre', id).catch((err) => logger.warn(`[AVISO ML] pergunta ${id}: ${err?.message || err}`));
      });
    }
    reply.code(200);
    return { ok: true };
  });
}
