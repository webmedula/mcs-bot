import type { FastifyInstance } from 'fastify';
import { logado } from '../auth';
import { mlConfigurado } from '../config';
import { trocarCodigo, urlDeLogin, stateValido } from '../conectores/mercadolivre/oauth';
import { sincronizarPendentes } from '../nucleo/servico';

export async function rotasOauth(app: FastifyInstance): Promise<void> {
  app.get('/oauth/ml/login', async (req, reply) => {
    // Só quem está logado no painel pode trocar a conta do ML ligada ao sistema.
    if (!logado(req)) return reply.redirect('/?entrar=1');
    if (!mlConfigurado()) {
      reply.code(500);
      return { mensagem: 'Defina ML_CLIENT_ID e ML_CLIENT_SECRET antes de conectar.' };
    }
    return reply.redirect(urlDeLogin());
  });

  app.get('/oauth/ml/callback', async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error) return reply.type('text/html').send(pagina(`O Mercado Livre recusou: ${escapar(error)}`));
    if (!code || !stateValido(state)) {
      reply.code(400);
      return reply.type('text/html').send(pagina('Link de retorno inválido ou expirado. Tente conectar de novo pelo painel.'));
    }
    try {
      await trocarCodigo(code);
      void sincronizarPendentes();
      return reply.redirect('/?conectado=1');
    } catch (err: any) {
      reply.code(500);
      return reply.type('text/html').send(pagina(`Falha ao conectar: ${escapar(err?.message || String(err))}`));
    }
  });
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function pagina(msg: string): string {
  return `<!doctype html><meta charset="utf-8"><title>mcs-bot</title><body style="font-family:system-ui;padding:24px"><p>${msg}</p><p><a href="/">Voltar ao painel</a></p>`;
}
