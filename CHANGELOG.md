# Changelog

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
