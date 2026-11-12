import 'dotenv/config';
import path from 'node:path';

function semBarraFinal(s: string): string {
  return s.replace(/\/+$/, '');
}

function numero(valor: string | undefined, padrao: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function ligado(valor: string | undefined, padrao = false): boolean {
  if (valor === undefined || valor === '') return padrao;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(valor.trim().toLowerCase());
}

const baseUrl = semBarraFinal(process.env.BASE_URL || 'http://localhost:3020');

export const config = {
  port: numero(process.env.PORT, 3020),
  baseUrl,
  dataDir: process.env.DATA_DIR || path.resolve(process.cwd(), 'data'),

  /** Senha do painel. Sem ela o painel não abre (não existe painel sem senha). */
  painelSenha: process.env.PAINEL_SENHA || '',
  /** Segredo que assina o cookie do painel. Se faltar, deriva da senha. */
  painelSegredo: process.env.PAINEL_SEGREDO || '',
  /** Chave para outros sistemas (Gerente IA) lerem o estado: cabeçalho x-api-key. */
  apiKey: process.env.BOT_API_KEY || '',

  // ---------- Mercado Livre ----------
  mlClientId: process.env.ML_CLIENT_ID || '',
  mlClientSecret: process.env.ML_CLIENT_SECRET || '',
  mlRedirectUri: process.env.ML_REDIRECT_URI || `${baseUrl}/oauth/ml/callback`,
  mlAuthUrl: process.env.ML_AUTH_URL || 'https://auth.mercadolivre.com.br/authorization',
  mlTokenUrl: process.env.ML_TOKEN_URL || 'https://api.mercadolibre.com/oauth/token',
  mlApiBaseUrl: semBarraFinal(process.env.ML_API_BASE_URL || 'https://api.mercadolibre.com'),
  /**
   * TRAVA DE ENVIO. Enquanto false, o sistema só sugere: nenhuma resposta sai para o ML.
   * Começa desligada porque o Gobots ainda responde em paralelo.
   */
  mlEnvioHabilitado: ligado(process.env.ML_ENVIO_HABILITADO, false),

  /** De quantos em quantos minutos confere as perguntas pendentes (rede de segurança do webhook). */
  sincronizarMinutos: numero(process.env.SINCRONIZAR_MINUTOS, 5),
  /** Teto de perguntas respondidas importadas do histórico. */
  historicoMax: numero(process.env.HISTORICO_MAX, 5000),
  // Pendente mais velha que isso é "antiga": fica separada no painel e não gasta IA sozinha.
  perguntaAntigaDias: numero(process.env.PERGUNTA_ANTIGA_DIAS, 30),

  // ---------- Texto das respostas ----------
  saudacao: process.env.RESPOSTA_SAUDACAO ?? 'Olá!',
  assinatura: process.env.RESPOSTA_ASSINATURA ?? 'Atenciosamente, equipe MCS.',
  /** Põe o primeiro nome de quem pergunta na saudação ("Olá, Maria!") quando o apelido tem cara de nome. */
  respostaComNome: ligado(process.env.RESPOSTA_COM_NOME, true),

  // ---------- IA (mesmas variáveis do Gerente IA) ----------
  /** 'anthropic' | 'openrouter'. Vazio = usa a chave que existir (com as duas, OpenRouter). */
  iaProvedor: process.env.ASSISTENTE_PROVEDOR || '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterBaseUrl: semBarraFinal(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicBaseUrl: semBarraFinal(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'),
  anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01',
  /** Id do modelo. Vazio = escolhe sozinho um Claude Sonnet (na Anthropic ou no catálogo do OpenRouter). */
  iaModelo: process.env.ASSISTENTE_MODELO || process.env.IA_MODELO || process.env.ANTHROPIC_MODEL || '',
  iaMaxTokens: numero(process.env.IA_MAX_TOKENS, 800),
};

export function mlConfigurado(): boolean {
  return Boolean(config.mlClientId && config.mlClientSecret);
}
