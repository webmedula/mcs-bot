# Changelog

## 0.4.0 (2026-11-10)

- **Regras da loja** editáveis no painel (aba Respostas prontas): horário de envio, retirada, troca, nota fiscal etc. A IA lê esse texto antes de responder; mudar o texto muda as respostas na hora. Vem preenchido com as regras da planilha do Gobots, já adaptadas ao ML.
- **Respostas prontas iniciais** (9), tiradas da planilha do Gobots e adaptadas da Shopee para o ML: nota fiscal, novo/original, garantia, prazo de entrega, prazo de envio, presente, cores, troca/devolução (as duas regras juntas) e retirada no local. Um botão carrega as que faltam, sem duplicar.
- Modelos aceitam texto alternativo: `{garantia|informada na descrição do anúncio}`.
- Voltagem, potência e medidas: a IA só responde com o que estiver no anúncio; senão, passa para uma pessoa.
- Assinatura padrão: "Atenciosamente, equipe MCS." (como na planilha).

## 0.3.0 (2026-11-10)

- IA pelo OpenRouter, com as mesmas variáveis do Gerente IA (`OPENROUTER_API_KEY`; `ASSISTENTE_MODELO` e `ASSISTENTE_PROVEDOR` opcionais). Sem modelo definido, usa o Claude Sonnet mais novo do catálogo do OpenRouter. A Anthropic direta continua funcionando. O painel mostra o provedor, o modelo e o que falta configurar.

## 0.2.0 (2026-11-10)

- Preço real: usa `/items/{id}/sale_price`, o preço que o comprador vê com a promoção ativa, e o preço sem promoção. A IA sabe quando o valor é promocional; as respostas prontas ganham `{preco_cheio}` além de `{preco}`.
- Preço e estoque são relidos do ML a cada pergunta (a ficha com atributos e descrição continua guardada por 6 horas). Se a leitura falhar, a sugestão sai sem valor em vez de usar um preço velho.
- Endereço padrão nos exemplos: `bot.mcs.ind.br`.

## 0.1.0 (2026-11-10)

Primeira versão. Só sugere: nenhuma resposta sai para o Mercado Livre enquanto `ML_ENVIO_HABILITADO=false`.

- Núcleo independente de plataforma (pergunta, ficha do produto, resposta) com conector do Mercado Livre.
- Login no ML (OAuth, app próprio), token guardado no banco.
- Perguntas chegam pelo aviso em tempo real (`/notificacoes/ml`, tópico questions) e por uma conferência a cada 5 minutos.
- Ficha do anúncio para responder: título, preço, estoque, garantia, atributos, descrição e tabela de compatibilidade.
- Sugestão: resposta pronta primeiro (a do anúncio vence a geral); senão a IA, presa à ficha e às respostas anteriores do anúncio. Sem base, a IA pede uma pessoa em vez de inventar.
- Importação do histórico de perguntas respondidas (inclui as do Gobots) e tela de perguntas frequentes, agrupadas por assunto, com a resposta mais usada e o botão "Virar resposta pronta".
- Tela "Respondidas": o que o Gobots respondeu ao lado da nossa sugestão.
- Painel com senha; envio pelo painel atrás da trava; rota `/api/estado` para o Gerente IA.
