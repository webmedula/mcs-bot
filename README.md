# mcs-bot

Responde as perguntas dos compradores nos marketplaces. Começa pelo Mercado Livre e vai substituir o Gobots. O núcleo não depende da plataforma: Shopee, Amazon ou outra entram como um conector novo em `src/conectores/`.

## Como funciona

1. A pergunta chega pelo aviso em tempo real do ML (`POST /notificacoes/ml`) ou pela conferência a cada `SINCRONIZAR_MINUTOS`.
2. O sistema lê a ficha do anúncio (título, preço, estoque, garantia, atributos, descrição, compatibilidades).
3. Monta a sugestão:
   - **resposta pronta**, se algum gatilho casa (a do anúncio vence a geral; o gatilho mais longo vence o curto);
   - senão, a **IA**, usando só a ficha e as respostas anteriores do anúncio. Sem base, ela pede uma pessoa.
4. A sugestão aparece no painel para revisar e enviar. **Enquanto `ML_ENVIO_HABILITADO=false` nada é enviado**: o sistema roda ao lado do Gobots só sugerindo, e a aba "Respondidas" mostra o que o Gobots respondeu ao lado da nossa sugestão.

Antes de enviar, o sistema confere no ML se a pergunta ainda está sem resposta.

## Painel

`/` (senha em `PAINEL_SENHA`):

- **Pendentes**: perguntas sem resposta, com a sugestão editável.
- **Perguntas frequentes**: importa o histórico do ML e agrupa por assunto; cada grupo mostra a resposta mais usada e vira resposta pronta com um clique.
- **Respostas prontas**: criar, editar, testar.
- **Respondidas**: comparação com o que foi respondido por fora (Gobots).
- **Conexão**: login no ML, endereços para configurar no app do ML, estado da IA e tempos de resposta.

## Configurar o app no Mercado Livre

Em developers.mercadolivre.com.br, crie um app só para este serviço:

- URI de redirect: `https://bot.mcs.ind.br/oauth/ml/callback`
- URL de notificações: `https://bot.mcs.ind.br/notificacoes/ml`
- Tópico: **Questions**. Permissões: perguntas (leitura e escrita) e anúncios.

Depois, no painel, aba Conexão → "Conectar ao Mercado Livre".

## Deploy (EasyPanel)

Push na `main` publica `ghcr.io/webmedula/mcs-bot:latest` (GitHub Actions). No EasyPanel:

- imagem `ghcr.io/webmedula/mcs-bot:latest`, porta 3020;
- **volume em `/app/data`** (banco, login do ML, respostas prontas — sem volume o deploy apaga tudo);
- variáveis de `env.example`.

## Rotas para outros sistemas

`GET /api/estado` com `x-api-key: BOT_API_KEY`: contadores, tempos de resposta e pendentes (para o Gerente IA).

Diagnóstico (logado no painel): `GET /debug/ml/item/MLB...` mostra o anúncio cru e a ficha traduzida.

## Desenvolvimento

```
npm install
npm test          # vitest
npm run typecheck
npm run dev
```

Node 22.13+ (usa `node:sqlite`). A imagem usa Node 24.
