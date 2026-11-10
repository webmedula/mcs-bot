# Changelog

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
