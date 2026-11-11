import { atualizarCorrecao, correcaoDaPergunta, ehCorrecao, salvarCorrecao } from './correcoes';
import { banco, gravarEstado, lerEstado, agora } from '../banco';
import { config } from '../config';
import { conector } from '../conectores';
import { guardarTitulos } from '../conectores/mercadolivre/conector';
import { logger } from '../logger';
import {
  gravarAvaliacao,
  gravarSugestao,
  lerPergunta,
  lerPerguntaExterna,
  listarPerguntas,
  marcarRespondida,
  pendentesForaDaLista,
  salvarPergunta,
  type Pergunta,
} from './perguntas';
import { gerarSugestao, sugerirComPronta } from './sugestao';
import { contarUso } from './respostasProntas';
import type { FichaDoProduto, PerguntaExterna, Plataforma } from './tipos';

/**
 * O FLUXO, de ponta a ponta:
 *   chega pergunta (aviso do ML ou conferência periódica) → grava → lê a ficha do anúncio →
 *   monta a sugestão (pronta ou IA) → espera aprovação no painel.
 *
 * Enviar sozinho (automático) e aprovar pelo Telegram são os próximos passos; o envio já passa por
 * uma trava única (ML_ENVIO_HABILITADO), desligada enquanto o Gobots ainda responde.
 */

async function fichaSemErro(p: Pergunta): Promise<FichaDoProduto | null> {
  if (!p.itemId) return null;
  try {
    return await conector(p.plataforma).fichaDoProduto(p.itemId);
  } catch (err: any) {
    logger.warn(`[FICHA] ${p.itemId}: ${err?.message || err}`);
    return null;
  }
}

/** Grava a pergunta e, se estiver pendente sem sugestão, monta a sugestão. */
export async function processarPergunta(e: PerguntaExterna): Promise<Pergunta> {
  const { pergunta } = salvarPergunta(e);
  if (pergunta.status === 'pendente' && !pergunta.sugestaoEm) {
    const ficha = await fichaSemErro(pergunta);
    await gerarSugestao(pergunta.id, ficha);
  }
  return lerPergunta(pergunta.id)!;
}

export async function refazerSugestao(id: number): Promise<Pergunta> {
  const p = lerPergunta(id);
  if (!p) throw new Error('Pergunta não encontrada.');
  const ficha = await fichaSemErro(p);
  await gerarSugestao(id, ficha);
  return lerPergunta(id)!;
}

/** Chegou aviso de pergunta nova ou alterada (webhook). */
export async function avisoDePergunta(plataforma: Plataforma, idExterno: string): Promise<void> {
  const e = await conector(plataforma).buscarPergunta(idExterno);
  if (!e) {
    const local = lerPerguntaExterna(plataforma, idExterno);
    if (local && local.status === 'pendente') salvarPergunta({ ...paraExterna(local), status: 'fechada' });
    return;
  }
  await processarPergunta(e);
}

function paraExterna(p: Pergunta): PerguntaExterna {
  return {
    plataforma: p.plataforma,
    idExterno: p.idExterno,
    itemId: p.itemId,
    texto: p.texto,
    compradorId: p.compradorId,
    criadaEm: p.criadaEm,
    status: p.status,
    resposta: p.resposta,
    respondidaEm: p.respondidaEm,
  };
}

export interface ResultadoSincronizacao {
  em: string;
  pendentes: number;
  novas: number;
  resolvidasFora: number;
  erro?: string;
}

let sincronizando = false;

/**
 * Conferência periódica: pega as pendentes da plataforma e atualiza as que sumiram da lista
 * (respondidas por fora, ou apagadas). É assim que guardamos o que o Gobots respondeu, para
 * comparar com a nossa sugestão.
 */
export async function sincronizarPendentes(plataforma: Plataforma = 'mercadolivre'): Promise<ResultadoSincronizacao> {
  const c = conector(plataforma);
  if (!c.conectado()) return { em: agora(), pendentes: 0, novas: 0, resolvidasFora: 0, erro: 'não conectado' };
  if (sincronizando) return lerEstado<ResultadoSincronizacao>('ultima-sincronizacao') ?? { em: agora(), pendentes: 0, novas: 0, resolvidasFora: 0 };
  sincronizando = true;
  const r: ResultadoSincronizacao = { em: agora(), pendentes: 0, novas: 0, resolvidasFora: 0 };
  try {
    const lista = await c.buscarPendentes();
    r.pendentes = lista.length;
    for (const e of lista) {
      const antes = lerPerguntaExterna(plataforma, e.idExterno);
      await processarPergunta(e);
      if (!antes) r.novas++;
    }
    for (const p of pendentesForaDaLista(plataforma, lista.map((e) => e.idExterno))) {
      const e = await c.buscarPergunta(p.idExterno).catch(() => undefined);
      if (e === undefined) continue;
      salvarPergunta(e ?? { ...paraExterna(p), status: 'fechada' });
      r.resolvidasFora++;
    }
  } catch (err: any) {
    r.erro = err?.message || String(err);
    logger.warn(`[SINCRONIZAÇÃO] ${r.erro}`);
  } finally {
    sincronizando = false;
  }
  gravarEstado('ultima-sincronizacao', r);
  return r;
}

export interface EstadoHistorico {
  rodando: boolean;
  inicio: string | null;
  fim: string | null;
  lidas: number;
  parouPor: string | null;
  erro: string | null;
}

export function estadoDoHistorico(): EstadoHistorico {
  return lerEstado<EstadoHistorico>('historico') ?? { rodando: false, inicio: null, fim: null, lidas: 0, parouPor: null, erro: null };
}

let importando = false;

/** Importa as perguntas já respondidas. Roda em segundo plano; o painel acompanha pelo estado. */
export function importarHistorico(plataforma: Plataforma = 'mercadolivre'): EstadoHistorico {
  if (importando) return estadoDoHistorico();
  importando = true;
  const est: EstadoHistorico = { rodando: true, inicio: agora(), fim: null, lidas: 0, parouPor: null, erro: null };
  gravarEstado('historico', est);
  const itens = new Set<string>();
  const vistas = new Set<string>();

  (async () => {
    try {
      const r = await conector(plataforma).buscarHistorico(config.historicoMax, (pagina) => {
        for (const e of pagina) {
          salvarPergunta(e);
          vistas.add(e.idExterno);
          if (e.itemId) itens.add(e.itemId);
        }
        // Conta perguntas diferentes: a passada anúncio por anúncio repete as que já vieram.
        est.lidas = vistas.size;
        gravarEstado('historico', est);
      });
      est.parouPor = r.parouPor;
      if (plataforma === 'mercadolivre') await guardarTitulos([...itens]);
    } catch (err: any) {
      est.erro = err?.message || String(err);
      logger.error(`[HISTÓRICO] ${est.erro}`);
    } finally {
      est.rodando = false;
      est.fim = agora();
      gravarEstado('historico', est);
      importando = false;
    }
  })();

  return est;
}

export class EnvioBloqueadoError extends Error {}

/**
 * Envia a resposta para a plataforma. Antes confere se a pergunta ainda está sem resposta lá
 * (o Gobots pode ter respondido no meio do caminho).
 */
export async function responderPergunta(id: number, texto: string, por: 'painel' | 'mcs-bot'): Promise<Pergunta> {
  if (!config.mlEnvioHabilitado) {
    throw new EnvioBloqueadoError('Envio desligado (ML_ENVIO_HABILITADO=false). Por enquanto o sistema só sugere.');
  }
  const p = lerPergunta(id);
  if (!p) throw new Error('Pergunta não encontrada.');
  const t = texto.trim();
  if (!t) throw new Error('Resposta vazia.');
  if (t.length > 2000) throw new Error('O Mercado Livre aceita no máximo 2000 caracteres.');

  const c = conector(p.plataforma);
  const agoraLa = await c.buscarPergunta(p.idExterno);
  if (!agoraLa || agoraLa.status !== 'pendente') {
    if (agoraLa) salvarPergunta(agoraLa);
    throw new EnvioBloqueadoError('Essa pergunta já foi respondida ou removida no Mercado Livre.');
  }
  await c.responder(p.idExterno, t);
  marcarRespondida(id, t, por);
  // Quem aprovou mudou bastante a sugestão? Então o bot aprende com isso.
  if (por === 'painel' && ehCorrecao(p.sugestao, t)) salvarCorrecao(p, t, 'envio');
  logger.info(`[ENVIO] pergunta ${p.idExterno} respondida por ${por}`);
  return lerPergunta(id)!;
}

/**
 * Depois de criar ou mudar uma resposta pronta, as pendentes que ainda não usam resposta pronta
 * ganham a sugestão nova se ela casar. Não chama a IA (é rápido e não gasta nada).
 */
export function reaplicarRespostasProntas(): number {
  let trocadas = 0;
  for (const p of listarPerguntas({ status: 'pendente', limite: 1000 })) {
    if (p.sugestaoOrigem === 'pronta' && p.sugestaoProntaId != null) continue;
    let ficha: FichaDoProduto | null = null;
    if (p.itemId) {
      const l = banco().prepare('SELECT ficha_json FROM produtos WHERE plataforma = ? AND item_id = ?').get(p.plataforma, p.itemId) as any;
      ficha = l?.ficha_json ? JSON.parse(l.ficha_json) : null;
    }
    const s = sugerirComPronta(p, ficha);
    if (!s) continue;
    contarUso(s.prontaId!);
    gravarSugestao(p.id, s);
    trocadas++;
  }
  return trocadas;
}

/**
 * "Ensinar ao bot": guarda a resposta certa para esta pergunta. Na pendente, a sugestão passa a ser
 * a corrigida (pronta para copiar ou enviar). Na aba Respondidas, ensina com o que foi respondido
 * (por exemplo, quando a resposta do Gobots era melhor que a nossa).
 */
export function ensinarResposta(id: number, dados: { texto?: string; licao?: string | null }) {
  const p = lerPergunta(id);
  if (!p) throw new Error('Pergunta não encontrada.');
  const origem = p.status === 'pendente' ? 'ensinar' : 'gobots';
  const texto = (dados.texto ?? (origem === 'gobots' ? p.resposta : '') ?? '').trim();
  const c = salvarCorrecao(p, texto, origem, dados.licao);
  if (p.status === 'pendente') {
    gravarSugestao(id, { texto, origem: 'ia', prontaId: null, confianca: 1, motivo: 'Corrigida pela equipe (o bot guardou para as próximas).' });
  }
  logger.info(`[MEMÓRIA] correção ${c.id} (${origem}) guardada para a pergunta ${p.idExterno}`);
  return c;
}

/**
 * Aba Respondidas: a pessoa escolhe qual resposta era melhor. "Gobots" ensina o bot com a resposta
 * dada; "bot" ou "iguais" só contam para o placar (e desfazem um "Gobots" escolhido antes).
 */
export function avaliarResposta(id: number, melhor: 'gobots' | 'bot' | 'iguais', licao?: string | null) {
  const p = lerPergunta(id);
  if (!p) throw new Error('Pergunta não encontrada.');
  if (p.status !== 'respondida') throw new Error('Só dá para avaliar perguntas já respondidas.');
  if (!['gobots', 'bot', 'iguais'].includes(melhor)) throw new Error('Escolha gobots, bot ou iguais.');
  if (melhor === 'gobots') {
    if (!p.resposta) throw new Error('Essa pergunta não tem resposta registrada para ensinar.');
    salvarCorrecao(p, p.resposta, 'gobots', licao);
  } else {
    const c = correcaoDaPergunta(id);
    if (c && c.origem === 'gobots') atualizarCorrecao(c.id, { ativa: false });
  }
  gravarAvaliacao(id, melhor);
  return lerPergunta(id)!;
}
