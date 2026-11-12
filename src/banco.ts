import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config';

/**
 * Banco local (SQLite nativo do Node). Tudo que o sistema sabe mora aqui: perguntas, respostas
 * prontas, ficha dos produtos e o login no ML. Precisa de volume em /app/data no EasyPanel,
 * senão cada deploy apaga tudo (inclusive o login).
 */

let db: DatabaseSync | null = null;

/** Carregado na hora de usar: o vitest não reconhece `node:sqlite` como módulo nativo no topo. */
function carregarSqlite(): typeof import('node:sqlite') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node:sqlite');
  } catch (err: any) {
    throw new Error(
      `Este serviço precisa do node:sqlite (Node 22.13+). Versão em uso: ${process.version}. Detalhe: ${err?.message || err}`,
    );
  }
}

function migrar(banco: DatabaseSync): void {
  banco.exec(`
    PRAGMA journal_mode = WAL;

    -- Uma linha por pergunta, de qualquer plataforma. (plataforma, id_externo) é a chave natural.
    CREATE TABLE IF NOT EXISTS perguntas (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      plataforma          TEXT NOT NULL,
      id_externo          TEXT NOT NULL,
      item_id             TEXT,
      texto               TEXT NOT NULL,
      comprador_id        TEXT,
      criada_em           TEXT,
      -- pendente | respondida | fechada (apagada, banida ou fechada sem resposta)
      status              TEXT NOT NULL,
      assunto             TEXT,
      resposta            TEXT,
      respondida_em       TEXT,
      -- mcs-bot (envio automático) | painel (alguém aprovou aqui) | externo (Gobots ou o próprio ML)
      respondida_por      TEXT,
      sugestao            TEXT,
      -- pronta | ia | nenhuma
      sugestao_origem     TEXT,
      sugestao_pronta_id  INTEGER,
      sugestao_confianca  REAL,
      sugestao_motivo     TEXT,
      sugestao_em         TEXT,
      atualizado_em       TEXT NOT NULL,
      UNIQUE (plataforma, id_externo)
    );
    CREATE INDEX IF NOT EXISTS idx_perguntas_status ON perguntas(status);
    CREATE INDEX IF NOT EXISTS idx_perguntas_item ON perguntas(item_id);

    -- Retrato do anúncio usado como contexto da resposta (título, atributos, descrição...).
    CREATE TABLE IF NOT EXISTS produtos (
      plataforma     TEXT NOT NULL,
      item_id        TEXT NOT NULL,
      titulo         TEXT,
      permalink      TEXT,
      ficha_json     TEXT,
      atualizado_em  TEXT NOT NULL,
      PRIMARY KEY (plataforma, item_id)
    );

    CREATE TABLE IF NOT EXISTS respostas_prontas (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo         TEXT NOT NULL,
      assunto        TEXT,
      -- JSON: lista de gatilhos. Cada gatilho é uma frase; casa se TODAS as palavras dela aparecem.
      gatilhos       TEXT NOT NULL,
      texto          TEXT NOT NULL,
      -- 'geral' ou o id de um anúncio (MLB...)
      escopo         TEXT NOT NULL DEFAULT 'geral',
      ativa          INTEGER NOT NULL DEFAULT 1,
      usos           INTEGER NOT NULL DEFAULT 0,
      criada_em      TEXT NOT NULL,
      atualizada_em  TEXT NOT NULL
    );

    -- Correções da equipe: a resposta certa para uma pergunta (e, se quiser, a lição por trás dela).
    -- A IA recebe as parecidas como exemplo antes de responder.
    CREATE TABLE IF NOT EXISTS correcoes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      plataforma     TEXT NOT NULL,
      item_id        TEXT,
      assunto        TEXT,
      pergunta       TEXT NOT NULL,
      sugestao       TEXT,
      resposta       TEXT NOT NULL,
      licao          TEXT,
      -- ensinar (botão no painel) | envio (resposta enviada pelo painel diferente da sugestão) | gobots (aba Respondidas)
      origem         TEXT NOT NULL,
      pergunta_id    INTEGER,
      ativa          INTEGER NOT NULL DEFAULT 1,
      usos           INTEGER NOT NULL DEFAULT 0,
      criada_em      TEXT NOT NULL
    );

    -- Apelido público de quem pergunta (lido uma vez da plataforma) e o primeiro nome tirado dele.
    CREATE TABLE IF NOT EXISTS compradores (
      plataforma    TEXT NOT NULL,
      comprador_id  TEXT NOT NULL,
      apelido       TEXT,
      lido_em       TEXT NOT NULL,
      PRIMARY KEY (plataforma, comprador_id)
    );

    -- Chave/valor: login do ML, progresso da importação, últimos erros.
    CREATE TABLE IF NOT EXISTS estado (
      chave  TEXT PRIMARY KEY,
      valor  TEXT
    );
  `);
  // Colunas novas em bancos que já existiam.
  const colunas = (banco.prepare('PRAGMA table_info(perguntas)').all() as any[]).map((c) => c.name);
  // Qual resposta era melhor, escolhido na aba Respondidas: gobots | bot | iguais.
  if (!colunas.includes('avaliacao')) banco.exec('ALTER TABLE perguntas ADD COLUMN avaliacao TEXT');
  // Pendente arquivada: some da lista do painel (continua sem resposta no ML).
  if (!colunas.includes('arquivada')) banco.exec('ALTER TABLE perguntas ADD COLUMN arquivada INTEGER NOT NULL DEFAULT 0');
  // Avaliação rápida da sugestão no painel (joinha): bom | ruim.
  if (!colunas.includes('sugestao_voto')) banco.exec('ALTER TABLE perguntas ADD COLUMN sugestao_voto TEXT');
  // Para onde a correção vale: geral (qualquer pergunta do tema) | anuncio (só o anúncio dela) | produto (mesmo SKU).
  const colsCorrecoes = (banco.prepare('PRAGMA table_info(correcoes)').all() as any[]).map((c) => c.name);
  if (!colsCorrecoes.includes('escopo')) banco.exec("ALTER TABLE correcoes ADD COLUMN escopo TEXT NOT NULL DEFAULT 'geral'");
  if (!colsCorrecoes.includes('sku')) banco.exec('ALTER TABLE correcoes ADD COLUMN sku TEXT');
  // Situação do anúncio na plataforma (active, paused, closed, under_review, inactive) e quando foi lida.
  const colsProdutos = (banco.prepare('PRAGMA table_info(produtos)').all() as any[]).map((c) => c.name);
  if (!colsProdutos.includes('situacao')) banco.exec('ALTER TABLE produtos ADD COLUMN situacao TEXT');
  if (!colsProdutos.includes('situacao_em')) banco.exec('ALTER TABLE produtos ADD COLUMN situacao_em TEXT');
}

export function banco(): DatabaseSync {
  if (db) return db;
  const { DatabaseSync } = carregarSqlite();
  if (config.dataDir !== ':memory:' && !fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  const caminho = config.dataDir === ':memory:' ? ':memory:' : path.join(config.dataDir, 'mcs-bot.db');
  db = new DatabaseSync(caminho);
  migrar(db);
  return db;
}

/** Só para testes: troca o banco por um em memória limpo. */
export function bancoEmMemoriaParaTeste(): DatabaseSync {
  const { DatabaseSync } = carregarSqlite();
  db = new DatabaseSync(':memory:');
  migrar(db);
  return db;
}

export function lerEstado<T = unknown>(chave: string): T | null {
  const linha = banco().prepare('SELECT valor FROM estado WHERE chave = ?').get(chave) as { valor?: string } | undefined;
  if (!linha?.valor) return null;
  try {
    return JSON.parse(linha.valor) as T;
  } catch {
    return null;
  }
}

export function gravarEstado(chave: string, valor: unknown): void {
  banco()
    .prepare('INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, JSON.stringify(valor));
}

export function apagarEstado(chave: string): void {
  banco().prepare('DELETE FROM estado WHERE chave = ?').run(chave);
}

export function agora(): string {
  return new Date().toISOString();
}
