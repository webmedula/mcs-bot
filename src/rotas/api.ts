import type { FastifyInstance } from 'fastify';
import { cookieDeLogin, cookieDeSaida, exigirApiKey, exigirLogin, logado, senhaConfere } from '../auth';
import { banco, lerEstado } from '../banco';
import { config, mlConfigurado } from '../config';
import { fichaComCache, lerFichaDoMl } from '../conectores/mercadolivre/conector';
import { ml } from '../conectores/mercadolivre/api';
import { lerToken } from '../conectores/mercadolivre/oauth';
import { descricaoDaIa } from '../ia/provedor';
import { classificarAssunto, nomeDoAssunto } from '../nucleo/assuntos';
import { LISTA_DE_ASSUNTOS, perguntasFrequentes } from '../nucleo/frequentes';
import { arquivarAntigas, arquivarForaDoAr, arquivarPergunta, contarPorStatus, contarVotos, ehAntiga, lerPergunta, listarPerguntas, tempoDeResposta, type FiltroPerguntas } from '../nucleo/perguntas';
import {
  apagarRespostaPronta,
  atualizarRespostaPronta,
  criarRespostaPronta,
  encontrarRespostaPronta,
  listarRespostasProntas,
} from '../nucleo/respostasProntas';
import { carregarProntasIniciais } from '../nucleo/prontasIniciais';
import { visaoGeral } from '../nucleo/visaoGeral';
import { apagarCorrecao, atualizarCorrecao, contarCorrecoes, escopoValido, listarCorrecoes, salvarCorrecaoAvulsa } from '../nucleo/correcoes';
import { gravarRegrasDaLoja, lerRegrasDaLoja, REGRAS_PADRAO } from '../nucleo/regrasDaLoja';
import {
  EnvioBloqueadoError,
  avaliarResposta,
  ensinarResposta,
  estadoDoHistorico,
  importarHistorico,
  reaplicarRespostasProntas,
  refazerSugestao,
  responderPergunta,
  sincronizarPendentes,
  votarSugestao,
} from '../nucleo/servico';
import { VERSAO } from '../versao';

function erro(reply: any, err: any, codigo = 400) {
  reply.code(err instanceof EnvioBloqueadoError ? 409 : codigo);
  return { mensagem: err?.message || String(err) };
}

function estadoGeral() {
  const token = lerToken();
  return {
    versao: VERSAO,
    mercadoLivre: {
      appConfigurado: mlConfigurado(),
      conectado: Boolean(token),
      userId: token?.userId ?? null,
      envioHabilitado: config.mlEnvioHabilitado,
      enderecoDeAvisos: `${config.baseUrl}/notificacoes/ml`,
      enderecoDeRetorno: config.mlRedirectUri,
    },
    ia: descricaoDaIa(),
    perguntas: contarPorStatus(),
    tempoDeResposta30d: tempoDeResposta(30),
    ultimaSincronizacao: lerEstado('ultima-sincronizacao'),
    historico: estadoDoHistorico(),
    respostasProntas: listarRespostasProntas().filter((r) => r.ativa).length,
    perguntaAntigaDias: config.perguntaAntigaDias,
    // O contador do menu mostra só as recentes (as antigas ficam numa aba à parte), excluindo anúncios fora do ar.
    pendentesRecentes: (banco()
      .prepare(
        `SELECT p.criada_em FROM perguntas p LEFT JOIN produtos pr ON pr.plataforma = p.plataforma AND pr.item_id = p.item_id
         WHERE p.status = 'pendente' AND p.arquivada = 0 AND (pr.situacao IS NULL OR pr.situacao = 'active')`,
      )
      .all() as any[])
      .filter((l) => !ehAntiga(l.criada_em, config.perguntaAntigaDias)).length,
    correcoes: contarCorrecoes(),
    votos: contarVotos(),
  };
}

export async function rotasApi(app: FastifyInstance): Promise<void> {
  // ---------- Login do painel ----------
  app.post('/painel/login', async (req, reply) => {
    const { senha } = (req.body ?? {}) as { senha?: string };
    if (!config.painelSenha) return erro(reply, new Error('Defina PAINEL_SENHA no servidor.'), 500);
    if (!senhaConfere(String(senha ?? ''))) return erro(reply, new Error('Senha errada.'), 401);
    reply.header('set-cookie', cookieDeLogin());
    return { ok: true };
  });
  app.post('/painel/sair', async (_req, reply) => {
    reply.header('set-cookie', cookieDeSaida());
    return { ok: true };
  });
  app.get('/painel/sessao', async (req) => ({ logado: logado(req), senhaDefinida: Boolean(config.painelSenha) }));

  // ---------- Painel (precisa de login) ----------
  app.register(async (p) => {
    p.addHook('preHandler', exigirLogin);

    p.get('/api/painel/estado', async () => estadoGeral());
    p.get('/api/assuntos', async () => LISTA_DE_ASSUNTOS);

    p.get('/api/perguntas', async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const f: FiltroPerguntas = {
        status: (q.status as any) || undefined,
        assunto: q.assunto || undefined,
        busca: q.busca || undefined,
        limite: q.limite ? Number(q.limite) : undefined,
        comSugestao: q.comSugestao === '1',
        arquivadas: q.arquivadas === '1',
      };
      return listarPerguntas(f).map((x) => ({ ...x, assuntoNome: nomeDoAssunto(x.assunto) }));
    });

    p.get('/api/perguntas/:id', async (req, reply) => {
      const pg = lerPergunta(Number((req.params as any).id));
      if (!pg) return erro(reply, new Error('Pergunta não encontrada.'), 404);
      const linha = pg.itemId
        ? (banco().prepare('SELECT ficha_json FROM produtos WHERE plataforma = ? AND item_id = ?').get(pg.plataforma, pg.itemId) as any)
        : null;
      return { ...pg, assuntoNome: nomeDoAssunto(pg.assunto), ficha: linha?.ficha_json ? JSON.parse(linha.ficha_json) : null };
    });

    p.post('/api/perguntas/:id/sugestao', async (req, reply) => {
      try {
        return await refazerSugestao(Number((req.params as any).id));
      } catch (err) {
        return erro(reply, err);
      }
    });

    p.post('/api/perguntas/:id/responder', async (req, reply) => {
      const { texto } = (req.body ?? {}) as { texto?: string };
      try {
        return await responderPergunta(Number((req.params as any).id), String(texto ?? ''), 'painel');
      } catch (err) {
        return erro(reply, err);
      }
    });

    p.post('/api/perguntas/:id/ensinar', async (req, reply) => {
      const b = (req.body ?? {}) as { texto?: string; licao?: string; escopo?: string };
      try {
        return ensinarResposta(Number((req.params as any).id), { texto: b.texto, licao: b.licao, escopo: escopoValido(b.escopo) });
      } catch (err) {
        return erro(reply, err);
      }
    });

    p.post('/api/perguntas/:id/avaliar', async (req, reply) => {
      const b = (req.body ?? {}) as { melhor?: any; licao?: string; texto?: string; escopo?: string };
      try {
        return avaliarResposta(Number((req.params as any).id), b.melhor, b.licao, { texto: b.texto, escopo: escopoValido(b.escopo) });
      } catch (err) {
        return erro(reply, err);
      }
    });

    p.post('/api/perguntas/:id/voto', async (req, reply) => {
      try {
        return votarSugestao(Number((req.params as any).id), ((req.body as any)?.voto ?? null) as any);
      } catch (err) {
        return erro(reply, err);
      }
    });

    p.post('/api/perguntas/:id/arquivar', async (req, reply) => {
      const id = Number((req.params as any).id);
      if (!lerPergunta(id)) return erro(reply, new Error('Pergunta não encontrada.'), 404);
      arquivarPergunta(id, (req.body as any)?.arquivada !== false);
      return { ok: true };
    });
    p.post('/api/perguntas/arquivar-antigas', async () => ({ arquivadas: arquivarAntigas(config.perguntaAntigaDias) }));
    p.post('/api/perguntas/arquivar-fora-do-ar', async () => ({ arquivadas: arquivarForaDoAr() }));

    // Memória de correções
    p.get('/api/correcoes', async () => listarCorrecoes());
    p.post('/api/correcoes', async (req, reply) => {
      try {
        return salvarCorrecaoAvulsa((req.body ?? {}) as any);
      } catch (err) {
        return erro(reply, err);
      }
    });
    p.put('/api/correcoes/:id', async (req, reply) => {
      try {
        return atualizarCorrecao(Number((req.params as any).id), (req.body ?? {}) as any);
      } catch (err) {
        return erro(reply, err, 404);
      }
    });
    p.delete('/api/correcoes/:id', async (req) => {
      apagarCorrecao(Number((req.params as any).id));
      return { ok: true };
    });

    p.post('/api/sincronizar', async () => sincronizarPendentes());
    p.post('/api/historico/importar', async () => importarHistorico());
    p.get('/api/frequentes', async () => perguntasFrequentes(config.historicoMax));
    p.get('/api/visao-geral', async (req) => visaoGeral(Number((req.query as any).dias) || 30));

    // Respostas prontas
    p.get('/api/respostas-prontas', async () => listarRespostasProntas());
    p.post('/api/respostas-prontas', async (req, reply) => {
      try {
        const r = criarRespostaPronta(req.body as any);
        return { ...r, pendentesAtualizadas: reaplicarRespostasProntas() };
      } catch (err) {
        return erro(reply, err);
      }
    });
    p.put('/api/respostas-prontas/:id', async (req, reply) => {
      try {
        const r = atualizarRespostaPronta(Number((req.params as any).id), req.body as any);
        return { ...r, pendentesAtualizadas: reaplicarRespostasProntas() };
      } catch (err) {
        return erro(reply, err);
      }
    });
    p.delete('/api/respostas-prontas/:id', async (req) => {
      apagarRespostaPronta(Number((req.params as any).id));
      return { ok: true };
    });
    p.post('/api/respostas-prontas/carregar-iniciais', async () => {
      const r = carregarProntasIniciais();
      return { ...r, pendentesAtualizadas: reaplicarRespostasProntas() };
    });

    p.get('/api/regras-da-loja', async () => ({ texto: lerRegrasDaLoja(), padrao: REGRAS_PADRAO }));
    p.put('/api/regras-da-loja', async (req, reply) => {
      try {
        return { texto: gravarRegrasDaLoja(String((req.body as any)?.texto ?? '')) };
      } catch (err) {
        return erro(reply, err);
      }
    });

    /** Testa uma pergunta inventada: qual resposta pronta casaria e qual assunto. */
    p.post('/api/respostas-prontas/testar', async (req) => {
      const { texto, itemId } = (req.body ?? {}) as { texto?: string; itemId?: string };
      const c = encontrarRespostaPronta(String(texto ?? ''), itemId ? String(itemId).toUpperCase() : null);
      const assunto = classificarAssunto(String(texto ?? ''));
      return {
        assunto,
        assuntoNome: nomeDoAssunto(assunto),
        casou: c ? { id: c.pronta.id, titulo: c.pronta.titulo, gatilho: c.gatilho, confianca: c.confianca } : null,
      };
    });

    // Diagnóstico: o que o ML devolve de um anúncio, cru e já traduzido.
    p.get('/debug/ml/item/:id', async (req, reply) => {
      const id = String((req.params as any).id).toUpperCase();
      try {
        const [item, compat] = await Promise.all([
          ml(`/items/${id}?include_attributes=all`).catch((e) => ({ erro: e.message })),
          ml(`/items/${id}/compatibilities`).catch((e) => ({ erro: e.message })),
        ]);
        return { ficha: await lerFichaDoMl(id), itemCru: item, compatibilidadesCru: compat };
      } catch (err) {
        return erro(reply, err, 502);
      }
    });
    p.post('/api/produtos/:id/atualizar', async (req, reply) => {
      try {
        return await fichaComCache(String((req.params as any).id).toUpperCase(), true);
      } catch (err) {
        return erro(reply, err, 502);
      }
    });
  });

  // ---------- Leitura para outros sistemas (Gerente IA), com x-api-key ----------
  app.register(async (p) => {
    p.addHook('preHandler', exigirApiKey);
    p.get('/api/estado', async () => {
      const pendentes = listarPerguntas({ status: 'pendente', limite: 50 }).map((x) => ({
        pergunta: x.texto,
        anuncio: x.itemTitulo || x.itemId,
        criadaEm: x.criadaEm,
        assunto: nomeDoAssunto(x.assunto),
        temSugestao: Boolean(x.sugestao),
        origemDaSugestao: x.sugestaoOrigem,
      }));
      return { ...estadoGeral(), pendentes };
    });
  });
}
