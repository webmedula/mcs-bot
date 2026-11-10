import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { completar, descricaoDaIa, provedorAtivo } from './provedor';

describe('escolha do provedor de IA', () => {
  beforeEach(() => {
    config.iaProvedor = '';
    config.openrouterApiKey = '';
    config.anthropicApiKey = '';
    config.iaModelo = '';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sem chave, nenhum', () => {
    expect(provedorAtivo()).toBeNull();
    expect(descricaoDaIa().falta).toMatch(/OPENROUTER_API_KEY/);
  });
  it('com as duas, fica com o OpenRouter (igual ao Gerente), salvo escolha', () => {
    config.openrouterApiKey = 'sk-or-x';
    config.anthropicApiKey = 'sk-ant-x';
    expect(provedorAtivo()).toBe('openrouter');
    config.iaProvedor = 'anthropic';
    expect(provedorAtivo()).toBe('anthropic');
  });
  it('OpenRouter sem modelo avisa no painel', () => {
    config.openrouterApiKey = 'sk-or-x';
    expect(descricaoDaIa().falta).toMatch(/ASSISTENTE_MODELO/);
    config.iaModelo = 'anthropic/claude-sonnet';
    expect(descricaoDaIa().falta).toBeNull();
  });
  it('chama /chat/completions do OpenRouter com sistema e pergunta', async () => {
    config.openrouterApiKey = 'sk-or-x';
    config.iaModelo = 'modelo-x';
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ model: 'modelo-x', choices: [{ message: { content: '{"resposta":"ok"}' } }] })));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await completar('SISTEMA', 'PERGUNTA');
    expect(r).toEqual({ texto: '{"resposta":"ok"}', modelo: 'modelo-x' });
    const [url, init] = fetchFalso.mock.calls[0] as any;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const corpo = JSON.parse(init.body);
    expect(corpo.model).toBe('modelo-x');
    expect(corpo.messages).toEqual([{ role: 'system', content: 'SISTEMA' }, { role: 'user', content: 'PERGUNTA' }]);
    expect(init.headers.Authorization).toBe('Bearer sk-or-x');
  });
});
