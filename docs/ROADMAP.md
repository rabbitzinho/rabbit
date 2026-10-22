# .rabbit – Roadmap técnico

Este documento lista ideias e próximos passos para evoluir o projeto a médio/longo prazo.  
Não é um compromisso rígido, mas um guia de prioridades.

## 1. Dashboard / UX

- Melhorar navegação em “Utilizadores”:
  - Paginação ou scroll infinito em servidores com muitos membros. ✅ – endpoint paginado `GET /api/guilds/:guildId/users` (limite 10–200) e botão “Carregar mais” em `public/js/dashboard.users.js` (`hasMore`).
  - Campo de pesquisa por nome/tag diretamente na tabela. ✅ – `#usersSearch` com debounce; o backend usa `guild.members.fetch({ query })` no modo pesquisa.
- Filtros mais ricos na aba “Moderação”:
  - Filtrar por tipo de ação (Warn, Mute, Ban, etc.). ✅ – `#logType` (warn/mute/unmute/kick/ban/tickets) enviado como `type=`.
  - Filtrar por utilizador/moderador. ✅ – `#logSearch` → `search=`, com `$or` + `$regex` case-insensitive em `src/dashboard/routes/logs.js`.
  - Intervalos de datas customizáveis. ✅ – `#logFrom`/`#logTo` → `since=`/`until=`.
- Melhor feedback para estados vazios:
  - Mensagens claras quando não há logs, infrações ou GameNews configurados. ✅ – `logs_empty`, `users_empty_search`/`users_empty_generic`, `gamenews_editor_empty`, `gamenews_detail_empty`, `tempvoice_*_empty`, `tickets_*_empty` (pt + en).
  - Tooltips explicativos para badges (Trust, GameNews, status do bot). ✅ – atributos `title` nos badges: bot (`badge_bot_tooltip_*`), Trust (`users_trust_score`) e estado do feed GameNews (mostra o `lastError` quando existe).
- Preferências de interface (topbar):
  - Alternância entre tema escuro e claro. ✅ – `#themeToggle` grava `ozark.theme`; o tema claro é aplicado via `data-theme="light"` no `<html>` com overrides de tokens em `public/css/tokens.css`.
  - Modo de densidade compacta. ✅ – `#densityToggle` grava `ozark.density`; `data-density="compact"` reduz alturas de controlo e espaçamentos via tokens.
- Exportação de utilizadores: ✅ – `GET /api/guilds/:guildId/users/export` (CSV/JSON, `MAX_EXPORT=10000`) e botões `#btnExportUsersCsv`/`#btnExportUsersJson` em `public/js/dashboard.users.js`.
- Painel de auditoria: ✅ – `GET /api/audit` (filtros `guildId`/`action`/`search` + paginação), módulo `public/js/dashboard.audit.js` e secção `#config-section-audit` na aba Configuração.
- Histórico de giveaways: ✅ – `GET /api/giveaways/history` (filtros `platform`/`search` + paginação) e secção `#giveawaysHistorySection` em `public/js/dashboard.giveaways.js`.
- Inventário de servidores e gestão global: ✅ – estados de presença do bot e acesso de gestão explícitos; resumo operacional com ligação Discord/BD, servidores e ações recentes; checklist e diagnóstico das features ativas por servidor; alertas de licenças Premium perto da expiração; controlos globais de manutenção exclusivos do dono do bot.
- Menu da conta: ✅ – o perfil abre um menu unificado com Painel, Tema, Densidade, Conta e Sair.
- Navegação orientada por tarefas e checklist de onboarding por servidor: ✅ – Visão geral mostra estado do bot, canal de logs, cargos de staff, canal de Tickets e configuração de features; apresenta diagnósticos das features ativas.
- Gestão avançada de tickets: 🟡 – atribuição a membro, prioridade, SLA e etiquetas configuráveis na dashboard; transcrição `.txt` exportável (até 1.000 mensagens) e timeline com até 100 eventos de gestão. Eventos anteriores à implementação não são reconstruídos. A dashboard permite listar, responder, fechar e reabrir.

## 2. Arquitetura da Dashboard

- ~~Extrair rotas da dashboard para módulos dedicados~~ ✅ (feito em `src/dashboard/routes/`)
  - `dashboard/routes/users.js`
  - `dashboard/routes/mod.js`
  - `dashboard/routes/gamenews.js`
  - `dashboard/routes/config.js`
- Criar camada de serviços:
  - `services/guildService.js` ✅ – acesso ao Discord client (`getGuild`, `getCachedChannel`, `getCachedMember`, `getCachedUser`, `formatUserTag`, `resolveChannel/Member/User`), null-safe e com caching delegado em `services/discordFetchCache.js`. Já adotado nas rotas `tickets`, `guilds`, `admin`, `tempVoice`, `users`, `user` e em `services/moderationService.js`; coberto por `tests/unit/guildService.test.js`.
  - `services/moderationService.js` ✅ – consolidado por **mudança**, não por duplicação: `dashboard/modService.js` foi movido para `services/moderationService.js` (expõe `ModError`, `dashboardWarn`, `resolveGuildMember`). O CRUD de infrações continua a pertencer a `systems/infractionsService.js`; a camada de serviços passou a ser o único ponto de entrada para ações de moderação agnósticas de HTTP.
  - `services/gameNewsService.js` ✅ – `toFeedDto`, `listStaticFeeds` e `listFeeds` centralizam o mapeamento documento→DTO dos feeds. Removeu quatro mapeamentos quase idênticos que estavam inline em `dashboard/routes/gamenews.js` (rotas de status, listagem, gravação e fallback estático).
- ~~Reduzir o tamanho de `src/dashboard.js`~~ ✅
  - `dashboard/authMiddleware.js` ✅ – fábrica `createAuthMiddleware({ jwt, JWT_SECRET, sanitizeId, config })` que encapsula `isAuthEnabled`, `extractToken`, `decodeDashboardToken`, `requireDashboardAuth`, `requirePerm`, `requireGuildAccess`. Lógica movida 1:1 com injeção de dependências para testes isolados; coberto por `tests/unit/authMiddleware.test.js`.
  - `dashboard/logStore.js` ✅ – fábrica `createLogStore({ config, getModel })` que encapsula o cache em memória + persistência Mongo (`get`, `set`, `push`, `saveToMongo`, `loadInitial`). Substitui `logsCache`/`MAX_MEMORY_LOGS`/`saveLogToMongo`/`loadInitialCacheFromMongo` no `dashboard.js`.
  - `dashboard/sanitize.js` ✅ – `sanitizeText`, `sanitizeId`, `safeAuditPayload` (puros).
  - `dashboard/schemas.js` ✅ – schemas Zod (`GuildConfigSchema`, `ModWarn/Mute/Unmute`, `LogsQuerySchema`, `GameNewsFeedSchema`).
  - `dashboard/models.js` ✅ – `loadDashboardModels()` carrega todos os modelos Mongoose null-safe num só sítio.
  - `dashboard/audit.js` ✅ – `getActorFromRequest` + fábrica `createAuditRecorder({ getModel })`.
  - `dashboard/middleware.js` ✅ – `requestIdMiddleware` e `createMetricsMiddleware({ metrics })`.
  - `dashboard/static.js` ✅ – `registerStaticRoutes` (shell HTML com cache-busting + assets de `public/`) e `registerSpaFallback`.
  - `dashboard/routes/index.js` ✅ – `registerDashboardRoutes(ctx)` concentra a ligação das 15 famílias de rotas, removendo do bootstrap a lista de ~50 dependências.
  - Resultado: `src/dashboard.js` passou de ~854 para ~386 linhas, ficando apenas com a criação da app/servidor, o hardening (trust proxy/helmet/CORS/rate limit), o estado partilhado, o `sendToDashboard` e os handlers finais. Coberto por `tests/unit/dashboardUtils.test.js`.
- Objetivo: facilitar testes unitários, evitar duplicação de lógica e reduzir o tamanho de `src/dashboard.js`.

## 3. Sistema de confiança (Trust)

- Refinar regras de pontuação:
  - Penalizações diferentes para Warn/Mute/Ban. ⏸️ – WARN e MUTE têm penalizações distintas; KICK/BAN ficam registados como casos, mas não alteram Trust. Definir uma política antes de aplicar penalizações a ações que removem o membro do servidor.
  - Banimentos temporários e unban: ✅ – `/ban` e a dashboard aceitam duração opcional (1 minuto–365 dias); registo persistente com marcador único, scheduler após arranque Discord e retry quando Discord/API ou guild não estão disponíveis. `/unban` cancela o agendamento e cria um caso `UNBAN`.
  - Bónus gradual por tempo sem infrações. ✅ – `applyTrustRegen` em `src/systems/warningsService.js` (ganho diário limitado por `regenMaxDays`).
- Expor mais detalhes na dashboard:
  - Histórico visual da evolução do Trust de um utilizador. ✅ – campo `trustHistory` no modelo `User` (máx. 30 entradas, `{ at, delta, trust, reason }`), alimentado por `warningsService` (warn/mute/regen/unwarn/unmute/reset); exposto em `GET /api/user` e renderizado no painel de detalhe (`#userDetailPanel`).
  - Tabela com distribuição de Trust no servidor (quantos utilizadores em “alto risco”, “risco médio”, “seguro”). ✅ – bloco “Distribuição por nível” em `#extras-trust-panel`, alimentado por `GET /api/trust/summary` (`buckets {low, medium, high}`).
- Ajustar automaticamente a agressividade da automoderação em função do Trust médio do servidor ✅ – **opt-in** (`trust.adaptive`, desligado por defeito):
  - Regra definida: média de Trust do servidor ≤ `lowThreshold` ⇒ automoderação mais rígida (`strictDelta`, −1 warn); ≥ `highThreshold` ⇒ mais tolerante (`lenientDelta`, +1 warn); entre os dois, neutro. Amostras abaixo de `minSampleSize` (5) nunca ajustam, para não reagir a servidores com poucos dados.
  - Helpers puros `getAdaptiveAutomodAdjustment`/`getAdaptiveMaxWarnings` em `src/utils/trust.js`; agregado memoizado (TTL 5 min) em `warningsService.getGuildAverageTrust`; aplicado em `src/systems/autoModeration.js` sobre o limite já ajustado pelo Trust do utilizador (com piso de 1 warn).
- Configuração e simulação AutoMod por servidor: ✅ – listas PT/EN, limiar de avisos e duração de timeout são definidos por servidor; a feature fica desligada até ser configurada na tab Funcionalidades, e a simulação usa o rascunho sem persistir ou executar ações.
- Regras AutoMod por servidor: ⏳ – exceções por cargo/canal, listas de permissões para links/domínios e métricas de falsos positivos ainda precisam de implementação.
- Anti-spam por servidor: ✅ – limites, strikes e duração/cooldown são configuráveis na feature `antiSpam`; fica desligada até configuração explícita e não herda overrides globais por canal ou cargo.
- Proteção contra raids: ⏳ – deteção de picos de entradas, idade da conta, modo de verificação temporário, limite de menções e alerta à equipa; incluir limites por servidor e salvaguardas contra falsos positivos.
- Revisão de casos: ⏳ – permitir que membros contestem uma ação e que a equipa acompanhe o recurso sem expor dados sensíveis num canal público.
- Giveaways nativos: ⏳ – criação de campanhas, seleção e novo sorteio de vencedores; o módulo atual publica ofertas do GamerPower.
- Progressão de níveis: ⏳ – cargos de recompensa e mecanismos de proteção contra farming.

## 4. GameNews

- Filtros por idioma / palavras-chave:
  - Excluir termos ou jogos específicos. ✅ – campo `excludeKeywords` por feed (máx. 50, normalizado para minúsculas/dedupe); filtro aplicado no ciclo de envio em `src/systems/gamenews.js` e editável no painel de detalhe (`#gnDetailExcludeKeywords`).
- Estatísticas:
  - Quantidade de notícias enviadas por dia. ✅ – `sentHistory` (contador diário, janela de 30 dias) no modelo `GameNews`, incrementado no envio e mostrado no painel de detalhe.
  - Último erro de GameNews (se existir), mostrado na dashboard. ✅ – campo `lastError` no modelo `GameNews`, gravado em `registerFeedFailure` (limpo em sucesso) e devolvido em `/api/gamenews-status`; já renderizado no painel de detalhe.
- Suporte a múltiplos canais por feed:
  - Permitir replicar notícias em mais que um canal se fizer sentido (por exemplo, canal global + canal da staff). ✅ – campo `extraChannelIds` (máx. 5) no modelo `GameNewsFeed`, sanitizado/deduplicado em `POST /api/gamenews/feeds` (aceita IDs crus ou menções `<#id>` e ignora o canal principal). O envio replica o mesmo embed nos canais extra em `src/systems/gamenews.js` (helper puro `collectExtraChannelIds`, com falhas por canal registadas no canal de logs sem afetar a entrega principal). Editável em `#gnDetailExtraChannels` no painel de detalhe.

## 5. Testes e qualidade

- Testes unitários ✅ (harness próprio em `tests/unit/`, sem dependências):
  - `utils/time`, `utils/regex`, `utils/trust`, `systems/metrics` — já cobertos.
  - `systems/logger` ✅ – formato consistente de títulos e anotação de risco do Trust.
  - `systems/gamenews` ✅ – SSRF guards (IP privado/hostname), normalização de links, deduplicação por hash, janelas temporais e `collectExtraChannelIds` (fan-out multi-canal).
  - `systems/maintenance` ✅ – configuração, cutoff e filtro de limpeza (helpers puros, sem BD).
  - `utils/trust` ✅ – inclui a automoderação adaptativa (`getAdaptiveAutomodAdjustment`/`getAdaptiveMaxWarnings`): limites por nível, amostra insuficiente e piso de 1 warn.
  - `services/gameNewsService` ✅ – `toFeedDto`, `listStaticFeeds` (com/sem id) e tolerância a documentos nulos/parciais.
- Testes de integração de API: ✅ – `tests/integration/` com o runner nativo `node:test` (sem supertest nem novas dependências). Sobe uma app Express efémera com as rotas reais e modelos em memória; cobre `/health`, `/api/internal/metrics` e `/api/gamenews/*` (feeds + status, incluindo `excludeKeywords`, `extraChannelIds`, `lastError` e `sentHistory`).
  - Corre com `npm run test:integration` (ou incluído em `npm test`).
- Linters/formatters ✅ ESLint + Prettier configurados, com `npm run lint` e `npm run format`.

## 6. Observabilidade

- Endpoint interno de métricas ✅ (não exposto publicamente) — `GET /api/internal/metrics`:
  - Contadores de comandos executados, infrações, auto-moderação e anti-spam.
  - Latência média, p95 e máxima por rota.
- Acesso restrito a `ADMIN` da dashboard ou ao token `METRICS_TOKEN`
  (`x-metrics-token` ou `Authorization: Bearer <token>`; o segundo é o formato que o Prometheus consegue enviar).
- Formato Prometheus ✅ — `GET /api/internal/metrics?format=prometheus` (`text/plain; version=0.0.4`).
- Ligar o endpoint a um Prometheus/Grafana (ou equivalente) ✅ — `docker-compose.observability.yml` sobe Prometheus + Grafana com a datasource já provisionada (`observability/prometheus.yml`, `observability/grafana-datasource.yml`). O alvo do scrape é `BOT_METRICS_TARGET` (por defeito `host.docker.internal:8000`).

## 7. Funcionalidades, boas-vindas e multi-servidor

- Sessão na dashboard: ✅ – badge no topbar com o tempo decorrido desde o login (`#badgeSession`, `ozark.loginAt` em `sessionStorage`; chaves `badge_session`/`badge_session_tooltip`).
- Multi-servidor: ✅ – o bot já funciona em vários servidores (`GuildConfig` por guild, OAuth até 200 guilds, slash commands globais). O onboarding é tratado em `src/events/guildCreate.js` (cria a `GuildConfig` e envia uma mensagem de boas-vindas do bot) e o convite está exposto em `#loginAddBotBtn`/`#addBotBtn` (`GET /api/public/invite` e `GET /api/invite`).
- Estatísticas do servidor no topo: ✅ – agregado diário `MemberStat` (`{guildId, date, joins, leaves}`), registado em `guildMemberAdd`/`guildMemberRemove` via `systems/memberStats.js`, e canais de voz criados/atualizados em `systems/serverStats.js` (👥 Membros, 📥 Entradas 7d, 📤 Saídas 7d), sem categoria para aparecerem acima destas.
- Boas-vindas e saída: ✅ – features `welcome`/`goodbye` (`GuildConfig.features`) com canal, mensagem modelada (`{user}`, `{server}`, `{memberCount}`), cor, banner por URL e opção de embed; render partilhado em `systems/welcomeMessages.js`.
- Teste de funcionalidades: ✅ – botão “Testar” em todos os cartões da aba Funcionalidades, servido por `POST /api/features/:key/test` e `systems/featureTests.js` (envia uma amostra para o canal configurado ou devolve a configuração efetiva quando não há efeito visível).
- Cargos por reação: ✅ – correspondência de emojis centralizada em `systems/reactionRoles.js` (`emojiMatches`/`toReactable`/`resolveShortcodes`), aceitando glifos Unicode, `<:nome:id>` e atalhos `:nome:` (resolvidos para o id do emoji do servidor ao guardar). Os handlers `messageReactionAdd`/`messageReactionRemove` usam o mesmo módulo e o teste avisa quando o bot não consegue atribuir os cargos (permissão/hierarquia).
- Extras uniformizado: ✅ – a aba Extras deixou de usar subtabs e passou a usar a grelha de cartões `.features-grid` com painéis colapsáveis (`.feature-card`), o mesmo padrão da aba Funcionalidades.
- Estatísticas do servidor: ✅ – ao desligar, os canais são removidos (`removeGuild` lê os IDs da base de dados quando o payload os omite) e `POST /api/features` devolve os IDs efetivamente persistidos, evitando canais duplicados ao usar “Testar”.
- Alertas Twitch: 🟡 – atualmente consulta um canal por servidor a cada 30 segundos, em sequência, e guarda a deduplicação em memória. Próximos passos: vários canais por servidor, consulta Helix em lote ou EventSub quando houver endpoint público, estado persistente, política de retry e filtros por categoria/idioma.

## 8. Música no Discord (proposta)

- UX esperada: comandos de pesquisa/reprodução, fila por servidor, faixa atual, pausa/retoma, salto, repetição, aleatório, playlists e permissões de DJ.
- Arquitetura: sessões isoladas por servidor; adaptadores de fontes explícitas; fila e estado testáveis independentemente da ligação de voz; reconexão e limpeza ao sair do canal.
- Decisão de fontes é pré-requisito: aceitar apenas APIs, catálogos licenciados ou streams diretos autorizados. Não implementar extração/scraping de áudio do YouTube nem contornar restrições do serviço; consultar os [termos do YouTube](https://www.youtube.com/t/terms) e a [documentação de ligações de voz do Discord](https://docs.discord.com/developers/topics/voice-connections) antes de escolher dependências.
- Verificar suporte, manutenção e licenças das bibliotecas de voz antes de adicionar dependências; o projeto atualmente não inclui um player de voz.

Este roadmap serve como referência.  
A cada alteração maior (por exemplo, refactor de um módulo ou adição de uma funcionalidade), recomenda-se atualizar este ficheiro para manter alinhamento entre o código real e os objetivos do projeto.
