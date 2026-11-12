import { banco } from '../banco';
import { config } from '../config';
import { completar, iaConfigurada } from '../ia/provedor';
import { logger } from '../logger';
import { nomeDoAssunto } from './assuntos';
import { compradorGuardado, outrasPerguntasDoComprador } from './comprador';
import { contarUsoDasCorrecoes, correcaoDaPergunta, memoriaParaIa } from './correcoes';
import { lerRegrasDaLoja } from './regrasDaLoja';
import { gravarSugestao, lerPergunta, type Pergunta, type Sugestao } from './perguntas';
import { contarUso, encontrarRespostaPronta, preencherModelo } from './respostasProntas';
import type { FichaDoProduto } from './tipos';

/**
 * COMO A SUGESTÃO É MONTADA
 *
 * 1. Resposta pronta que casa com a pergunta (a do anúncio vence a geral).
 * 2. Senão, a IA, presa à ficha do anúncio, às regras da loja, às correções da equipe (memória) e
 *    ao que já foi respondido no anúncio.
 * 3. Se a IA não tiver base, ela devolve "precisa de humano" e não inventa nada.
 *
 * Nada aqui envia para o ML. Enviar é outra decisão (painel, Telegram ou automático), com trava.
 */

const LIMITE_ML = 2000;

/** "Olá!" + nome → "Olá, Maria!". Sem nome (ou com RESPOSTA_COM_NOME=false), a saudação de sempre. */
export function saudacaoPara(nome?: string | null): string {
  const saud = config.saudacao.trim();
  if (!saud || !nome || !config.respostaComNome) return saud;
  return /[!.]$/.test(saud) ? saud.replace(/[!.]$/, `, ${nome}!`) : `${saud}, ${nome}!`;
}

/** Saudação + corpo + assinatura, sem repetir o que o corpo já trouxer. */
export function montarTexto(corpo: string, nome?: string | null): string {
  let t = corpo.trim();
  const saud = saudacaoPara(nome);
  const assin = config.assinatura.trim();
  if (saud && !/^(ol[aá]|oi|bom dia|boa tarde|boa noite|prezad)/i.test(t)) t = `${saud} ${t}`;
  if (assin && !t.toLowerCase().includes(assin.toLowerCase())) t = `${t} ${assin}`;
  return t.slice(0, LIMITE_ML);
}

/** Tira telefone, e-mail e link: o ML proíbe dado de contato nas respostas e pode punir. */
export function limparDadosDeContato(t: string): string {
  return t
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '')
    // Telefone só com cara de telefone (DDD entre parênteses ou número partido por hífen/espaço):
    // código de peça com 8 dígitos seguidos não pode sumir da resposta.
    .replace(/(\+?55\s?)?\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}/g, '')
    .replace(/(\+?55\s?)?\b\d{2}\s9?\d{4}[-\s]\d{4}\b/g, '')
    .replace(/\b9?\d{4}-\d{4}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function fichaEmTexto(f: FichaDoProduto): string {
  const linhas: string[] = [];
  linhas.push(`Título: ${f.titulo ?? '(sem título)'}`);
  if (f.preco != null) {
    linhas.push(
      f.emPromocao && f.precoCheio != null
        ? `Preço agora: R$ ${f.preco.toFixed(2)} (em promoção; preço sem promoção R$ ${f.precoCheio.toFixed(2)})`
        : `Preço agora: R$ ${f.preco.toFixed(2)}`,
    );
  } else {
    linhas.push('Preço: NÃO DISPONÍVEL agora (não informe valor).');
  }
  if (f.estoque != null) linhas.push(`Estoque disponível: ${f.estoque}`);
  if (f.condicao) linhas.push(`Condição: ${f.condicao}`);
  if (f.freteGratis != null) linhas.push(`Frete grátis: ${f.freteGratis ? 'sim' : 'não'}`);
  if (f.garantia) linhas.push(`Garantia: ${f.garantia}`);
  if (f.sku) linhas.push(`SKU: ${f.sku}`);
  const attrs = Object.entries(f.atributos);
  if (attrs.length) linhas.push('Atributos:\n' + attrs.map(([k, v]) => `- ${k}: ${v}`).join('\n'));
  if (f.compatibilidades === null) linhas.push('Compatibilidades: NÃO FOI POSSÍVEL LER a tabela de compatibilidade.');
  else if (f.compatibilidades.length === 0) linhas.push('Compatibilidades: o anúncio não tem tabela de compatibilidade.');
  else linhas.push('Compatibilidades (tabela do anúncio):\n' + f.compatibilidades.slice(0, 80).map((c) => `- ${c}`).join('\n'));
  if (f.descricao) linhas.push(`Descrição do anúncio:\n${f.descricao.slice(0, 4000)}`);
  return linhas.join('\n');
}

const SISTEMA = `Você responde perguntas de compradores em anúncios de autopeças de uma loja no Mercado Livre.

REGRAS (obrigatórias):
- Use SOMENTE as informações da ficha do anúncio, das REGRAS DA LOJA, das LIÇÕES e CORREÇÕES DA
  EQUIPE e das respostas anteriores fornecidas. Nunca invente medida, voltagem, compatibilidade, prazo,
  marca, garantia ou qualquer dado que não esteja ali.
- Prioridade quando divergirem: regras da loja > lições e correções da equipe > respostas anteriores.
  As correções mostram erros que já aconteceram: não repita a resposta marcada como ERRADA.
- Voltagem, potência e medidas: só o que estiver nos atributos, no título ou na descrição do anúncio.
  Se não estiver, marque precisa_humano.
- Compatibilidade com veículo: só confirme se o veículo (modelo E ano) estiver na tabela de
  compatibilidade ou escrito claramente no título/descrição. Na dúvida, não confirme: marque que
  precisa de humano.
- Nunca escreva telefone, e-mail, link, rede social ou peça para negociar fora do Mercado Livre.
- Não prometa prazo de entrega exato: o prazo aparece no anúncio ao informar o CEP.
- Preço: use só o "Preço agora" da ficha. Se estiver em promoção, pode dizer que o valor é
  promocional, sem prometer até quando vale. Não ofereça desconto que não esteja na ficha.
- Português do Brasil, cordial, direto, no máximo 3 frases. Sem saudação, sem o nome da pessoa e sem
  assinatura: elas são acrescentadas depois.
- OUTRAS PERGUNTAS DESTA PESSOA servem de contexto (ex.: o carro que ela já citou). Use só se
  ajudarem a responder a pergunta atual; não comente que ela já perguntou antes.
- Se a pergunta for ofensiva, não for pergunta, ou você não tiver base para responder com certeza,
  marque precisa_humano = true.

Responda APENAS com um JSON, sem texto em volta:
{"resposta": "texto ou vazio", "confianca": 0.0 a 1.0, "precisa_humano": true|false, "motivo": "uma frase curta"}`;

export function lerJsonDaIa(texto: string): { resposta: string; confianca: number; precisaHumano: boolean; motivo: string } | null {
  const ini = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    const j = JSON.parse(texto.slice(ini, fim + 1));
    return {
      resposta: String(j.resposta ?? '').trim(),
      confianca: Math.max(0, Math.min(1, Number(j.confianca) || 0)),
      precisaHumano: Boolean(j.precisa_humano),
      motivo: String(j.motivo ?? '').trim(),
    };
  } catch {
    return null;
  }
}

/** Até 8 perguntas já respondidas NESTE anúncio: mostram à IA como a loja costuma responder. */
function respostasAnteriores(p: Pergunta): Array<{ pergunta: string; resposta: string }> {
  if (!p.itemId) return [];
  return (banco()
    .prepare(
      `SELECT texto, resposta FROM perguntas WHERE plataforma = ? AND item_id = ? AND status = 'respondida'
       AND resposta IS NOT NULL AND id <> ? ORDER BY criada_em DESC LIMIT 8`,
    )
    .all(p.plataforma, p.itemId, p.id) as any[]).map((l) => ({ pergunta: l.texto, resposta: l.resposta }));
}

export async function sugerirComIa(p: Pergunta, ficha: FichaDoProduto | null): Promise<Sugestao> {
  if (!iaConfigurada()) {
    return { texto: null, origem: 'nenhuma', prontaId: null, confianca: null, motivo: 'Nenhuma resposta pronta casou e a IA não está configurada.' };
  }
  const anteriores = respostasAnteriores(p);
  const memoria = memoriaParaIa(p);
  const comprador = compradorGuardado(p.plataforma, p.compradorId);
  const outras = outrasPerguntasDoComprador(p);
  const usuario = [
    `PERGUNTA DO COMPRADOR: ${p.texto}`,
    `Assunto detectado: ${nomeDoAssunto(p.assunto)}`,
    ...(comprador?.apelido ? [`Quem pergunta: apelido ${comprador.apelido}${comprador.primeiroNome ? ` (primeiro nome provável: ${comprador.primeiroNome})` : ''}`] : []),
    ...(outras.length
      ? ['OUTRAS PERGUNTAS DESTA PESSOA (mais novas primeiro):', ...outras.map((o) => `- [${o.anuncio || 'anúncio?'}] P: ${o.pergunta}${o.resposta ? ` | R: ${o.resposta}` : ' | (sem resposta)'}`)]
      : []),
    '',
    'REGRAS DA LOJA (valem para todos os anúncios):',
    lerRegrasDaLoja() || '(nenhuma regra cadastrada)',
    '',
    ...(memoria.texto ? [memoria.texto, ''] : []),
    'FICHA DO ANÚNCIO:',
    ficha ? fichaEmTexto(ficha) : '(não foi possível ler o anúncio)',
    '',
    anteriores.length
      ? 'RESPOSTAS ANTERIORES DA LOJA NESTE ANÚNCIO (estilo e fatos já confirmados):\n' +
        anteriores.map((a) => `P: ${a.pergunta}\nR: ${a.resposta}`).join('\n\n')
      : 'Não há respostas anteriores neste anúncio.',
  ].join('\n');

  const { texto, modelo } = await completar(SISTEMA, usuario);
  contarUsoDasCorrecoes(memoria.ids);
  const j = lerJsonDaIa(texto);
  if (!j) return { texto: null, origem: 'nenhuma', prontaId: null, confianca: null, motivo: `A IA (${modelo}) respondeu fora do formato.` };
  if (j.precisaHumano || !j.resposta) {
    return { texto: null, origem: 'ia', prontaId: null, confianca: j.confianca, motivo: `Precisa de uma pessoa: ${j.motivo || 'sem base na ficha'}` };
  }
  const motivo = j.motivo || 'Resposta da IA com base na ficha do anúncio.';
  return {
    texto: montarTexto(limparDadosDeContato(j.resposta), comprador?.primeiroNome),
    origem: 'ia',
    prontaId: null,
    confianca: j.confianca,
    motivo: memoria.ids.length ? `${motivo} (usou ${memoria.ids.length} correção(ões) da equipe)` : motivo,
  };
}

export function sugerirComPronta(p: Pergunta, ficha: FichaDoProduto | null): Sugestao | null {
  const c = encontrarRespostaPronta(p.texto, p.itemId);
  if (!c) return null;
  return {
    texto: montarTexto(preencherModelo(c.pronta.texto, ficha), compradorGuardado(p.plataforma, p.compradorId)?.primeiroNome),
    origem: 'pronta',
    prontaId: c.pronta.id,
    confianca: c.confianca,
    motivo: `Resposta pronta "${c.pronta.titulo}" (gatilho: ${c.gatilho}).`,
  };
}

/** Monta e grava a sugestão de uma pergunta. Erro da IA vira motivo, não exceção. */
export async function gerarSugestao(id: number, ficha: FichaDoProduto | null): Promise<Sugestao> {
  const p = lerPergunta(id);
  if (!p) throw new Error('Pergunta não encontrada.');
  // A equipe já corrigiu esta pergunta: a correção vence (refazer não pode apagar o que foi ensinado).
  const corrigida = correcaoDaPergunta(id);
  if (corrigida) {
    const s: Sugestao = { texto: corrigida.resposta, origem: 'ia', prontaId: null, confianca: 1, motivo: 'Corrigida pela equipe (o bot guardou para as próximas).' };
    gravarSugestao(id, s);
    return s;
  }
  let s = sugerirComPronta(p, ficha);
  if (s) {
    contarUso(s.prontaId!);
  } else {
    try {
      s = await sugerirComIa(p, ficha);
    } catch (err: any) {
      logger.warn(`[SUGESTÃO] IA falhou na pergunta ${p.idExterno}: ${err?.message || err}`);
      s = { texto: null, origem: 'nenhuma', prontaId: null, confianca: null, motivo: `Erro na IA: ${err?.message || err}` };
    }
  }
  gravarSugestao(id, s);
  return s;
}
