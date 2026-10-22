# Changelog

Todas as alterações relevantes deste projeto são registadas aqui.

Este ficheiro segue o formato do **Keep a Changelog** e utiliza **SemVer**.

---

## [1.3.2] – 2026-02-16

### Corrigido

- Dashboard: filtro de guilds reforçado no endpoint `/api/guilds` (apenas guilds onde o utilizador é **Owner** ou tem permissão **Administrator**).
- GameNews (Histórico do feed): remoção do botão **Testar**.
- GameNews (Histórico do feed): botão **Cancelar** ao lado de **Guardar** para reverter alterações locais.
- UI: inputs com largura consistente (inclui inputs/seletores do Histórico do feed).
- UI: tab **Utilizadores** e tab **Configuração do servidor** voltam a renderizar dentro do layout centrado (correção de markup HTML).

### Alterado

- i18n (PT/EN): adicionadas chaves em falta (inclui GameNews “max per cycle”, Voz Temporária e Manutenção).
- Trust (Extras): valores do resumo com tipografia mais discreta.

---

## [1.3.1]

### Alterado

- Staff roles (feature-based): enforcement consistente nos slash commands de moderação e no sistema de ticket threads (usa `staffRolesByFeature` quando configurado).
- `/help`: correção do bug de permissões (o check estava assíncrono e nunca bloqueava).
- Staff roles: cache TTL (30s) para reduzir leituras repetidas de `GuildConfig`.
- Config: removido legado `STAFF_ROLE_IDS` e `tickets.staffRoleIds` do `defaultConfig` (não eram usados em runtime).

---

## [1.3.0]

### Alterado

- Configuração (Dashboard): UX refeita para seleção de cargos de staff (chips + adicionar/remover) em vez de multi-select.
- Configuração: presets “Aplicar a todas as secções” e “Limpar overrides” atualizam imediatamente a UI.

### Adicionado

- i18n: novas chaves para o role picker (PT/EN).

---

## [1.2.9]

### Corrigido

- Dashboard (CORS): origem de produção ajustada (remoção de origem antiga).
- Frontend: correção de bug no editor de utilizadores (reset de `allowedGuildIds`).
- Cache bust: versão dos assets atualizada.

### Adicionado

- Moderação (Dashboard): secção **Casos** (lista + detalhe) usando `/api/cases` e `/api/case`.

---

## [1.2.8]

### Alterado

- Infractions: schema alinhado com o serviço (caseId, source, userTag/executorTag) + índices úteis.
- Cases API: pesquisa e filtros ajustados para os campos reais.
- Case API: usa tags guardadas (snapshot) e só faz fetch ao Discord quando necessário.

### Corrigido

- Logs API: validação Zod aceita `guildId` opcional.
- Dashboard (Moderação): paginação do painel de tickets (prev/next coerentes com total).

---

## [1.2.7]

### Alterado

- Moderação (Server Insights): ranges ajustados para 7d/14d/30d.
- Moderação (Server Insights): métricas usam **Infractions** como fonte de verdade (WARN/MUTE).
- Moderação (Server Insights): `stats` estável + cache curto (45s) por guild/range.

### Segurança

- `GET /api/mod/overview` valida `guildId` via allow-list quando configurada.

---

## [1.2.6]

### Segurança

- Guardas de permissões (RBAC) e de acesso por servidor aplicados em Case/Audit/Admin/TempVoice/Users history.

### Corrigido

- Tickets: validação de comprimento da resposta (frontend) + chave i18n para erro de mensagem longa.
- Backend: removida duplicação de verificação `NO_GUILD_ACCESS` no endpoint de reply.

---

## [1.2.5]

### Adicionado

- GameNews: validação inline (URL/canal) e botões desativados quando inválido.
- GameNews: dirty-state por feed (badge + aviso discreto ao trocar de feed).
- GameNews: badge de erro quando existe `lastError`.

---

## [1.2.4]

### Adicionado

- Frontend: validação inline em Config e Trust (erros por campo).

### Alterado

- Trust: status explícito quando um preset é aplicado (não guardado).
- Config: limpeza automática de erros inline ao editar campos.

---

## [1.0.0]

### Adicionado

- Bot Discord com comandos de moderação.
- Dashboard web inicial (Visão Geral, Utilizadores, Logs, Tickets, GameNews, Configuração).
- GameNews (RSS), Voz Temporária e persistência em MongoDB.
