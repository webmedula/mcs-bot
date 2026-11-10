import crypto from 'node:crypto';
import { apagarEstado, gravarEstado, lerEstado } from '../../banco';
import { config } from '../../config';
import { logger } from '../../logger';

/**
 * Login no Mercado Livre (OAuth2). O token fica no banco (tabela estado), dentro do volume: um
 * deploy não derruba o login. Mesmo desenho do ml-analytics, com app próprio do ML.
 */

export interface TokenMl {
  accessToken: string;
  refreshToken: string;
  accessExpiraEm: number;
  userId: number | null;
  obtidoEm: number;
}

const CHAVE = 'ml-token';
const statesPendentes = new Set<string>();

export class MlNaoConectadoError extends Error {
  constructor() {
    super('Mercado Livre não conectado. Abra /oauth/ml/login para entrar.');
    this.name = 'MlNaoConectadoError';
  }
}

export function lerToken(): TokenMl | null {
  return lerEstado<TokenMl>(CHAVE);
}

export function urlDeLogin(): string {
  const state = crypto.randomBytes(16).toString('hex');
  statesPendentes.add(state);
  setTimeout(() => statesPendentes.delete(state), 10 * 60 * 1000).unref();
  const url = new URL(config.mlAuthUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.mlClientId);
  url.searchParams.set('redirect_uri', config.mlRedirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export function stateValido(state: string | undefined): boolean {
  if (!state || !statesPendentes.has(state)) return false;
  statesPendentes.delete(state);
  return true;
}

function guardar(data: any): TokenMl {
  const t: TokenMl = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiraEm: Date.now() + Number(data.expires_in ?? 21600) * 1000,
    userId: data.user_id != null ? Number(data.user_id) : null,
    obtidoEm: Date.now(),
  };
  gravarEstado(CHAVE, t);
  return t;
}

async function pedirToken(corpo: Record<string, string>): Promise<any> {
  const res = await fetch(config.mlTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(corpo).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const erro = new Error(`ML recusou o token: ${res.status} ${data?.message || data?.error || ''}`.trim());
    (erro as any).status = res.status;
    throw erro;
  }
  return data;
}

export async function trocarCodigo(code: string): Promise<TokenMl> {
  const data = await pedirToken({
    grant_type: 'authorization_code',
    client_id: config.mlClientId,
    client_secret: config.mlClientSecret,
    redirect_uri: config.mlRedirectUri,
    code,
  });
  logger.info(`[ML OAUTH] conectado (user_id=${data.user_id})`);
  return guardar(data);
}

let renovando: Promise<TokenMl> | null = null;

async function renovar(): Promise<TokenMl> {
  const atual = lerToken();
  if (!atual) throw new MlNaoConectadoError();
  if (Date.now() < atual.accessExpiraEm - 2 * 60_000) return atual;
  try {
    const data = await pedirToken({
      grant_type: 'refresh_token',
      client_id: config.mlClientId,
      client_secret: config.mlClientSecret,
      refresh_token: atual.refreshToken,
    });
    logger.info('[ML OAUTH] token renovado');
    return guardar(data);
  } catch (err: any) {
    // 400/401 = refresh revogado (senha trocada, app desautorizado): precisa entrar de novo.
    if (err?.status === 400 || err?.status === 401) {
      logger.error('[ML OAUTH] refresh recusado; é preciso entrar de novo em /oauth/ml/login');
      apagarEstado(CHAVE);
      throw new MlNaoConectadoError();
    }
    throw err;
  }
}

export function renovarToken(): Promise<TokenMl> {
  if (!renovando) renovando = renovar().finally(() => (renovando = null));
  return renovando;
}

export async function tokenValido(): Promise<string> {
  const atual = lerToken();
  if (!atual) throw new MlNaoConectadoError();
  if (Date.now() >= atual.accessExpiraEm - 60_000) return (await renovarToken()).accessToken;
  return atual.accessToken;
}

export function desconectar(): void {
  apagarEstado(CHAVE);
}
