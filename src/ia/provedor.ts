import { config } from '../config';
import { logger } from '../logger';

/**
 * IA: Anthropic direto ou OpenRouter, com as mesmas variáveis do Gerente IA.
 * ASSISTENTE_PROVEDOR escolhe ('anthropic' | 'openrouter'); vazio = usa a chave configurada e,
 * com as duas, fica com o OpenRouter (igual ao Gerente).
 * Aqui não há ferramentas: é um pedido e uma resposta em JSON, então qualquer modelo bom serve.
 */

export type NomeDoProvedor = 'anthropic' | 'openrouter';

export function provedorAtivo(): NomeDoProvedor | null {
  const escolhido = config.iaProvedor.trim().toLowerCase();
  if (escolhido === 'anthropic') return config.anthropicApiKey ? 'anthropic' : null;
  if (escolhido === 'openrouter') return config.openrouterApiKey ? 'openrouter' : null;
  if (config.openrouterApiKey) return 'openrouter';
  if (config.anthropicApiKey) return 'anthropic';
  return null;
}

export function iaConfigurada(): boolean {
  return provedorAtivo() !== null;
}

/** Texto para o painel: qual provedor e modelo, ou o que falta. */
export function descricaoDaIa(): { configurada: boolean; provedor: string | null; modelo: string; falta: string | null } {
  const p = provedorAtivo();
  const falta = !p
    ? 'Defina OPENROUTER_API_KEY (com ASSISTENTE_MODELO) ou ANTHROPIC_API_KEY.'
    : p === 'openrouter' && !config.iaModelo
      ? 'Com OpenRouter, defina ASSISTENTE_MODELO (o mesmo do Gerente serve).'
      : null;
  return { configurada: Boolean(p), provedor: p, modelo: config.iaModelo || (p === 'anthropic' ? '(automático)' : '(não definido)'), falta };
}

let modeloAnthropic: string | null = null;

function cabecalhosAnthropic(): Record<string, string> {
  return { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': config.anthropicVersion };
}

/** Na Anthropic, sem modelo fixado, pergunta à API e prefere um Sonnet. */
async function resolverModeloAnthropic(): Promise<string> {
  if (config.iaModelo) return config.iaModelo;
  if (modeloAnthropic) return modeloAnthropic;
  const res = await fetch(`${config.anthropicBaseUrl}/v1/models?limit=20`, { headers: cabecalhosAnthropic() });
  const corpo: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo?.error?.message || `Erro HTTP ${res.status} ao listar modelos.`);
  const ids: string[] = (corpo?.data ?? []).map((m: any) => m.id);
  if (ids.length === 0) throw new Error('A API não devolveu nenhum modelo para esta chave.');
  modeloAnthropic = ids.find((id) => /sonnet/i.test(id)) ?? ids[0];
  logger.info(`[IA] modelo escolhido: ${modeloAnthropic}`);
  return modeloAnthropic;
}

async function completarAnthropic(sistema: string, usuario: string): Promise<{ texto: string; modelo: string }> {
  const modelo = await resolverModeloAnthropic();
  const res = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: cabecalhosAnthropic(),
    body: JSON.stringify({ model: modelo, max_tokens: config.iaMaxTokens, system: sistema, messages: [{ role: 'user', content: usuario }] }),
  });
  const corpo: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo?.error?.message || `Erro HTTP ${res.status} na API da Anthropic.`);
  const texto = (corpo?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  return { texto, modelo };
}

async function completarOpenRouter(sistema: string, usuario: string): Promise<{ texto: string; modelo: string }> {
  const modelo = config.iaModelo;
  if (!modelo) throw new Error('Com OpenRouter é obrigatório definir ASSISTENTE_MODELO.');
  const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'X-Title': 'mcs-bot',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: config.iaMaxTokens,
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: usuario },
      ],
    }),
  });
  const corpo: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo?.error?.message || `Erro HTTP ${res.status} no OpenRouter.`);
  const conteudo = corpo?.choices?.[0]?.message?.content;
  // Alguns modelos devolvem o conteúdo em partes; junta só o texto.
  const texto = Array.isArray(conteudo)
    ? conteudo.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n')
    : String(conteudo ?? '');
  return { texto: texto.trim(), modelo: corpo?.model || modelo };
}

export async function completar(sistema: string, usuario: string): Promise<{ texto: string; modelo: string }> {
  const p = provedorAtivo();
  if (p === 'openrouter') return completarOpenRouter(sistema, usuario);
  if (p === 'anthropic') return completarAnthropic(sistema, usuario);
  throw new Error('IA não configurada (falta OPENROUTER_API_KEY ou ANTHROPIC_API_KEY).');
}
