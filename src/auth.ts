import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';

/** Login do painel: uma senha (PAINEL_SENHA) e um cookie assinado por 30 dias. */

const COOKIE = 'mcsbot';
const VALIDADE_MS = 30 * 86400_000;

function segredo(): string {
  return config.painelSegredo || crypto.createHash('sha256').update(`mcs-bot:${config.painelSenha}`).digest('hex');
}

function assinar(valor: string): string {
  return crypto.createHmac('sha256', segredo()).update(valor).digest('base64url');
}

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function senhaConfere(senha: string): boolean {
  return Boolean(config.painelSenha) && iguais(String(senha || ''), config.painelSenha);
}

export function cookieDeLogin(): string {
  const expira = String(Date.now() + VALIDADE_MS);
  const seguro = config.baseUrl.startsWith('https://') ? '; Secure' : '';
  return `${COOKIE}=${expira}.${assinar(expira)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VALIDADE_MS / 1000}${seguro}`;
}

export function cookieDeSaida(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function lerCookie(req: FastifyRequest): string | null {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

export function logado(req: FastifyRequest): boolean {
  if (!config.painelSenha) return false;
  const c = lerCookie(req);
  if (!c) return false;
  const [expira, assinatura] = c.split('.');
  if (!expira || !assinatura || !iguais(assinatura, assinar(expira))) return false;
  return Number(expira) > Date.now();
}

/** Guarda das rotas do painel. */
export async function exigirLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!logado(req)) {
    reply.code(401).send({ mensagem: config.painelSenha ? 'Entre no painel.' : 'Defina PAINEL_SENHA para usar o painel.' });
  }
}

/** Guarda das rotas lidas por outros sistemas (Gerente IA). */
export async function exigirApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const chave = String(req.headers['x-api-key'] || '');
  if (!config.apiKey || !iguais(chave, config.apiKey)) {
    reply.code(401).send({ mensagem: 'x-api-key inválida.' });
  }
}
