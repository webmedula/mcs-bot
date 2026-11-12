# Changelog

## 0.10.0 (2026-11-12)

- **Nome de quem pergunta na resposta.** O bot lê o apelido público do comprador no ML (`/users/{id}`, uma vez por pessoa) e tira dele o primeiro nome quando é um nome comum ("MARIA.SILVA82" → Maria, "JOAOPAULO_RS" → João). A saudação vira "Olá, Maria!". Apelido sem cara de nome ("AUTOPECAS2020") fica no "Olá!" de sempre. Desliga com `RESPOSTA_COM_NOME=false`.
- Vale para respostas prontas e IA. Pendentes que já tinham sugestão ganham o nome na saudação sem chamar a IA de novo.
- **Outras perguntas da mesma pessoa** (em qualquer anúncio) entram no pedido à IA como contexto, por exemplo o carro que ela já citou.
- Painel: cada pendente mostra quem perguntou e, entre parênteses, o nome que vai na saudação.
- A memória de correções tira "Olá, Maria!" junto com a saudação, para o nome não virar exemplo para outra pessoa.
- **Anúncio fora do ar.** A cada conferência o bot lê a situação dos anúncios das pendentes no ML (em lotes de 20). Pergunta de anúncio pausado, finalizado ou apagado sai de "Recentes" e do contador do menu e vai para a aba **"Anúncio fora do ar"**, com o botão "Arquivar as N fora do ar". Ela não ganha sugestão automática (não gasta IA); se o anúncio voltar ao ar, volta para a lista e ganha sugestão.
- Rota `POST /api/perguntas/arquivar-fora-do-ar`.

## 0.9.0 (2026-11-12)

- **Perguntas antigas separadas.** Em Pendentes, as abas "Recentes (até 30 dias)", "Antigas" e "Arquivadas". O contador do menu conta só as recentes, e a lista mostra as mais novas primeiro.
- **Arquivar**: em cada pergunta, e "Arquivar as N antigas" de uma vez. Arquivada sai da lista do painel e dos números, mas continua sem resposta no ML; dá para desarquivar.
- Pergunta com mais de 30 dias não ganha sugestão automática (não gasta IA); "Refazer sugestão" continua funcionando nela. Prazo configurável em `PERGUNTA_ANTIGA_DIAS`.

## 0.8.1 (2026-11-11)

- "Virar resposta pronta" de compatibilidade, medidas, lado/kit ou instalação já vem com **Vale para** preenchido com o anúncio (o MLB onde a pergunta mais aparece), e o formulário mostra o nome do anúncio. Salvar um desses assuntos como "geral" pede confirmação.
- Frequentes mostram em qual anúncio (ou em quantos) o grupo de perguntas aparece.
- "Vale para" aceita o código como aparece no endereço do anúncio (`MLB-123...`) e guarda `MLB123...`.
- O texto que vira resposta pronta perde "Boa tarde/Boa noite" do começo e a assinatura do fim (o sistema coloca sozinho).

## 0.8.0 (2026-11-11)

- **Frequentes: resposta editável.** Cada grupo de perguntas parecidas mostra a melhor resposta num campo editável, com o "Por quê?" opcional, e dois botões: **Ensinar ao bot** (vai para a Memória e a IA usa como exemplo em perguntas parecidas) e **Virar resposta pronta** (agora leva o texto editado). Grupo já ensinado aparece marcado.
- Mensagens automáticas ("Agradecemos sua mensagem. Não estamos disponíveis no momento.", "fora do horário"...) deixam de contar como "resposta mais usada"; o grupo avisa quando todas as respostas eram automáticas.
- Rota `POST /api/correcoes` (correção sem pergunta pendente por trás, origem "frequentes").

## 0.7.0 (2026-11-11)

- **Respondidas: escolha qual resposta é melhor** em cada pergunta: "A do Gobots (ensinar ao bot)", "Iguais" ou "A do bot". Escolher a do Gobots guarda a resposta na Memória (com o "Por quê?" opcional); trocar depois para "Iguais" ou "A do bot" desativa essa correção. Filtros "Para avaliar", "Gobots melhor" e "Todas", e placar no topo.
- Visão geral: o cartão de comparação passa a mostrar o placar real ("bot empata ou ganha do Gobots") quando houver avaliações; sem avaliações, continua a estimativa por palavras.
- Novo assunto **Aviso de compra ou pagamento** ("pedido feito e pago via pix", "já paguei"...) e resposta pronta inicial para ele, só para avisos curtos (quem manda um pedido junto, como "quero 4 laranja e 2 azul", continua indo para a IA/pessoa). Para ganhá-la em produção: botão "Carregar as da planilha do Gobots" (carrega só as que faltam).

## 0.6.0 (2026-11-11)

- **Memória de correções**: o bot aprende com as correções da equipe. Antes de responder, a IA recebe as correções de perguntas parecidas (com a resposta errada e a certa) e todas as lições escritas pela equipe. Correção do mesmo anúncio pesa mais; correção de outro anúncio ensina a política e o jeito de responder, não os dados do produto.
- Uma correção entra na memória quando alguém: clica em **Ensinar ao bot** numa pendente (funciona com o envio desligado); envia pelo painel uma resposta bem diferente da sugestão (ou uma em que o bot não tinha sugestão); ou marca na aba **Respondidas** que a resposta do Gobots era a certa. Campo opcional "Por quê?" vira uma lição que vale para todas as perguntas.
- Aba **Memória**: lista o que o bot aprendeu, quantas vezes cada correção foi usada, e permite editar a lição, desativar ou apagar.
- "Refazer sugestão" não apaga uma correção já ensinada para a mesma pergunta.
- Aba Respondidas passa a mostrar também as perguntas em que o bot pediu uma pessoa (as que mais ensinam).

## 0.5.0 (2026-11-11)

- **Visão geral**, nova tela inicial no estilo da home do Gobots: perguntas recebidas, respondidas e sem resposta (com "Atender agora"), tempo de resposta (mediana) e % respondidas em até 1 hora, quem respondeu (Gobots/fora, painel, bot sozinho), % das perguntas com sugestão do bot (resposta pronta × IA × precisou de pessoa), % de sugestões parecidas com o que o Gobots respondeu, gráfico de perguntas por dia, assuntos e anúncios com mais perguntas. Período de 7, 30 ou 90 dias, com seta de variação em relação ao período anterior. Rota `GET /api/visao-geral?dias=30`.
- Datas do ML com fuso (-04:00) contadas corretamente (comparação por data, não por texto).

## 0.4.0 (2026-11-10)

- **Regras da loja** editáveis no painel (aba Respostas prontas): horário de envio, retirada, troca, nota fiscal etc. A IA lê esse texto antes de responder; mudar o texto muda as respostas na hora. Vem preenchido com as regras da planilha do Gobots, já adaptadas ao ML.
- **Respostas prontas iniciais** (9), tiradas da planilha do Gobots e adaptadas da Shopee para o ML: nota fiscal, novo/original, garantia, prazo de entrega, prazo de envio, presente, cores, troca/devolução (as duas regras juntas) e retirada no local. Um botão carrega as que faltam, sem duplicar.
- Modelos aceitam texto alternativo: `{garantia|informada na descrição do anúncio}`.
- Voltagem, potência e medidas: a IA só responde com o que estiver no anúncio; senão, passa para uma pessoa.
- Assinatura padrão: "Atenciosamente, equipe MCS." (como na planilha).
- **Painel com visual novo e logo da MCS**: topo escuro com o logo, cores da marca, ícone na aba do navegador e o número de pendentes no título da aba. Bolinhas no topo mostram se o ML está conectado, se a IA tem chave e se o envio está ligado.
- Pendentes: indicadores (pendentes, a mais antiga, tempo de resposta e respostas prontas ativas), filtro por assunto, uma faixa colorida em cada pergunta (verde = resposta pronta, azul = IA, amarelo = precisa de uma pessoa) e um contador de caracteres.
- Botão **Copiar resposta** enquanto o envio está desligado, para colar no ML à mão. Botão **Sair** no topo.
- Revisão de acessibilidade e uso (checklist da skill UI/UX Pro Max): contraste mínimo 4.5:1 nos botões e etiquetas (laranja mais escuro onde há texto branco), anel de foco visível no teclado, botões de 44px e campos de 16px no celular, rótulos ligados aos campos, avisos lidos por leitor de tela, aba atual no endereço (`#pendentes`, `#prontas`...) com o botão Voltar funcionando, e botões que mostram "Enviando…/Buscando…" e não aceitam clique duplo.

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
