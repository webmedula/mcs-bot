import { config } from '../config';
import { logger } from '../logger';

/** Chamada mínima à API de mensagens da Anthropic (sem SDK, como nos outros serviços da MCS). */

let modeloEscolhido: string | null = null;

function cabecalhos(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': config.anthropicApiKey,
    'anthropic-version': config.anthropicVersion,
  };
}

export function iaConfigurada(): boolean {
  return Boolean(config.anthropicApiKey);
}

/** Sem modelo fixado, pergunta à API e prefere um Sonnet. Id fixo no código envelhece. */
export async function resolverModelo(): Promise<string> {
  if (config.iaModelo) return config.iaModelo;
  if (modeloEscolhido) return modeloEscolhido;
  const res = await fetch(`${config.anthropicBaseUrl}/v1/models?limit=20`, { headers: cabecalhos() });
  const corpo: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo?.error?.message || `Erro HTTP ${res.status} ao listar modelos.`);
  const ids: string[] = (corpo?.data ?? []).map((m: any) => m.id);
  if (ids.length === 0) throw new Error('A API não devolveu nenhum modelo para esta chave.');
  modeloEscolhido = ids.find((id) => /sonnet/i.test(id)) ?? ids[0];
  logger.info(`[IA] modelo escolhido: ${modeloEscolhido}`);
  return modeloEscolhido;
}

export async function completar(sistema: string, usuario: string): Promise<{ texto: string; modelo: string }> {
  if (!iaConfigurada()) throw new Error('ANTHROPIC_API_KEY não configurada.');
  const modelo = await resolverModelo();
  const res = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: cabecalhos(),
    body: JSON.stringify({
      model: modelo,
      max_tokens: config.iaMaxTokens,
      system: sistema,
      messages: [{ role: 'user', content: usuario }],
    }),
  });
  const corpo: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo?.error?.message || `Erro HTTP ${res.status} na API da Anthropic.`);
  const texto = (corpo?.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
  return { texto, modelo };
}
