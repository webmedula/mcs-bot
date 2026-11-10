import { config } from '../../config';
import { logger } from '../../logger';
import { renovarToken, tokenValido } from './oauth';

export class MlApiError extends Error {
  constructor(public status: number, mensagem: string, public corpo?: unknown) {
    super(mensagem);
    this.name = 'MlApiError';
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chamada à API do ML com token, renovação em 401 e nova tentativa em 429/5xx. */
export async function ml<T = any>(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  let tentou401 = false;
  for (let tentativa = 0; ; tentativa++) {
    const token = await tokenValido();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(`${config.mlApiBaseUrl}${caminho}`, {
        method: opcoes.metodo || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
        signal: ctl.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (tentativa < 2) {
        await esperar(1000 * (tentativa + 1));
        continue;
      }
      throw new MlApiError(0, `Sem resposta do Mercado Livre: ${err?.message || err}`);
    }
    clearTimeout(timer);

    if (res.status === 401 && !tentou401) {
      tentou401 = true;
      await renovarToken().catch(() => undefined);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && tentativa < 3 && (opcoes.metodo || 'GET') === 'GET') {
      await esperar(1500 * (tentativa + 1));
      continue;
    }
    const texto = await res.text();
    let data: any;
    try {
      data = texto ? JSON.parse(texto) : undefined;
    } catch {
      data = texto;
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || `Erro HTTP ${res.status}`;
      logger.warn(`[ML API] ${opcoes.metodo || 'GET'} ${caminho.split('?')[0]} → ${res.status} ${msg}`);
      throw new MlApiError(res.status, msg, data);
    }
    return data as T;
  }
}
