import { banco } from './banco';
import { config } from './config';
import { logger } from './logger';
import { sincronizarPendentes } from './nucleo/servico';
import { criarApp } from './server';
import { VERSAO } from './versao';

async function iniciar(): Promise<void> {
  banco();
  const app = await criarApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`mcs-bot v${VERSAO} ouvindo na porta ${config.port} (envio ${config.mlEnvioHabilitado ? 'LIGADO' : 'desligado'})`);
  if (!config.painelSenha) logger.warn('PAINEL_SENHA não definida: o painel não abre até ela existir.');

  // Rede de segurança do aviso em tempo real: confere as pendentes de tempos em tempos.
  const rodar = () => void sincronizarPendentes().catch((err) => logger.warn(`[SINCRONIZAÇÃO] ${err?.message || err}`));
  setTimeout(rodar, 10_000).unref();
  setInterval(rodar, config.sincronizarMinutos * 60_000).unref();
}

iniciar().catch((err) => {
  logger.error('Falha ao iniciar:', err);
  process.exit(1);
});
