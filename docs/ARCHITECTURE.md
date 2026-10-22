# .rabbit – Visão geral de arquitetura

Esta nota resume a arquitetura atual do bot, para facilitar manutenção e evolução a longo prazo.

## Stack principal

- **Runtime:** Node.js 20.x
- **Bot Discord:** discord.js v14
- **HTTP API / Dashboard:** Express
- **Base de dados:** MongoDB (mongoose)
- **Infra:** Koyeb (porta 8000, Dockerfile próprio)
- **Autenticação da dashboard:** Discord OAuth 2.0 + sessões JWT (cookies HttpOnly)

## Estrutura de pastas (nível alto)

- `src/`
  - `index.js` – ponto de entrada. Liga ao Mongo, faz login no Discord, arranca a dashboard e os sistemas de background (maintenance, GameNews).
  - `dashboard.js` – criação do servidor Express, hardening (trust proxy/helmet/CORS/rate limit) e bootstrap das rotas.
  - `dashboard/routes/` – 15 famílias de rotas `/api/*` (`auth`, `guilds`, `users`, `user`, `mod`, `logs`, `tickets`, `gamenews`, `giveaways`, `tempVoice`, `trust`, `config`, `audit`, `admin`, `core`), ligadas por `routes/index.js`.
  - `bot.js` – criação e configuração do cliente Discord.
  - `events/` – handlers de eventos do Discord (mensagens, membros, reações, voz, etc.).
  - `database/models/` – schemas Mongoose (infrações, tickets, game news, etc.).
  - `systems/`
    - `errorGuard.js` – captura exceções não tratadas e logs amigáveis.
    - `status.js` – flags de estado (Mongo ligado, Discord ready, GameNews a correr) usadas pela dashboard.
    - `maintenance.js` – tarefas periódicas (limpeza de logs/infrações antigos, etc.).
    - `gamenews.js` – ciclo de RSS → mensagens no Discord + estado para a dashboard.
    - `logger.js` – registo de ações de moderação (Warn/Mute/Kick/Ban, etc.) em Mongo e na cache de logs da dashboard.
    - `temporaryBans.js` – expiração persistente de bans temporários, com validação de marcador e retry após falhas transitórias.
    - outros ficheiros utilitários.

- `public/`
  - `index.html` – shell da dashboard.
  - `css/` – estilos da dashboard.
  - `js/`
    - `dashboard.js` – core do front-end (state global, helpers `apiGet/apiPost`, i18n, gestão de tabs).
    - `i18n.js` – helper `OzarkDashboard.I18n` (carregamento de locales, `t()` e interpolação).
    - `dashboard.users.js` – lógica da tab Utilizadores (listagem, histórico, ações).
    - `dashboard.moderation.js` – lógica da tab Moderação (lista de logs, filtros, resumo).
    - `dashboard.tickets.js` – lógica da tab Tickets.
    - `dashboard.gamenews.js` – lógica da tab GameNews.
    - `dashboard.giveaways.js` – lógica do painel de giveaways (GamerPower).
  - `locales/`
    - `pt.js` / `en.js` – textos para i18n, usados pelo helper `t()` no front-end.

- `config/`
  - `defaultConfig.js` – defaults de configuração (inclui dashboard, GameNews, etc.).

- `Dockerfile`
  - build e arranque do container (porta 8000, `npm install` e `npm start`).

## Fluxo de dados – Moderação / Logs

1. Um comando de moderação é executado (slash ou prefix).
2. O handler chama o `logger` para:
   - guardar o evento na coleção de logs (Mongo);
   - empurrar uma entrada para a cache em memória (últimos ~200 logs) exposta à dashboard.
3. A dashboard obtém os logs via `/api/logs` e renderiza no front-end com `createLogRow()` + `renderLogs()`.

Benefícios:

- A dashboard é rápida (lê da cache de memória).
- Em caso de erro na cache, é possível cair para Mongo sem perder histórico.

## Fluxo de dados – Utilizadores

1. Front-end chama `/api/guilds/:guildId/users`.
2. O backend utiliza `_client.guilds.cache` para obter o `guild`.
3. Tenta preencher/atualizar `guild.members.cache` (com proteções contra spam ao gateway).
4. Constrói uma lista simplificada de utilizadores (id, username, tag, roles, bot/human, joinDate).
5. A tab Utilizadores renderiza esta lista e, ao clicar num utilizador, chama `/api/guilds/:guildId/users/:userId/history` para:
   - infrações recentes;
   - contagem por tipo de infração;
   - tickets associados.

## Fluxo de dados – GameNews

1. `systems/gamenews.js` corre em ciclo:
   - lê configuração (feeds ativos, canais de destino, idioma);
   - faz fetch aos RSS feeds configurados;
   - deduplica notícias já enviadas;
   - envia mensagens para o canal de GameNews no Discord;
   - atualiza o estado (última execução, estado on/off, erros) em memória.
2. A dashboard lê esse estado via API e apresenta:
   - badge de estado (ativo/inativo/erro);
   - feeds configurados;
   - botões para ativar/desativar e guardar alterações.

## Estados e saúde do sistema

- `status.js` expõe funções para:
  - `setMongoConnected(bool)`
  - `setDiscordReady(bool)`
  - `setGameNewsRunning(bool)`
  - `getStatus()` – usado pela rota `/health` para a dashboard.
- A página principal faz polling periódico à API de health e mostra badges de estado (Mongo, Discord, GameNews, Dashboard).

## Linhas gerais para evolução futura

- **Separar módulos de dashboard**: ✅ feito.
  - `src/dashboard.js` foi reduzido para criação do servidor + hardening; as rotas vivem em `dashboard/routes/` ligadas por `routes/index.js`.
  - Isto facilita testes unitários por domínio (users, logs, gamenews).

- **Testes automatizados**: ✅ coberto.
  - Testes unitários com harness próprio (`tests/unit/`, sem dependências externas).
  - Testes de integração de rotas com a app Express real e modelos em memória (`tests/integration/`, `node:test`).

- **Segurança / hardening**:
  - Validação rigorosa de ids (`sanitizeId`).
  - Middleware de autenticação centralizado em `dashboard/authMiddleware.js` (JWT + origem).
  - Endpoints sensíveis (`/api/guilds/:guildId/users`) paginados (limite 10–200).

Esta nota não altera comportamento nenhum em runtime – serve apenas como mapa mental para que tu (ou qualquer outra pessoa) consigas navegar e evoluir o projeto com confiança.
