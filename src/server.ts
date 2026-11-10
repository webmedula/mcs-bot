import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { rotasApi } from './rotas/api';
import { rotasNotificacoes } from './rotas/notificacoes';
import { rotasOauth } from './rotas/oauth';
import { VERSAO } from './versao';

export async function criarApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 1024 * 1024 });

  app.get('/health', async () => ({ ok: true, versao: VERSAO }));

  await app.register(rotasOauth);
  await app.register(rotasNotificacoes);
  await app.register(rotasApi);

  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, '..', 'public'),
    prefix: '/',
    // Sem cache: depois de um deploy o navegador tem de pegar o painel novo.
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  });

  return app;
}
