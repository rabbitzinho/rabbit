# .rabbit

.rabbit é um bot de **moderação para Discord** com uma **dashboard web** integrada, focado em:

- Moderar servidores de forma rápida e transparente.
- Centralizar histórico de ações (warn, mute, ban, tickets, etc.).
- Integrar notícias via RSS (GameNews).
- Gerir canais de **voz temporária** de forma automática.

> Versão atual: **v1.3.2**

---

## 🧩 Stack técnica

- **Node.js** 20.x
- **discord.js** ^14.25.1
- **Express** (API + dashboard)
- **MongoDB** (armazenamento de configurações, infrações, tickets, etc.)
- Frontend em **HTML + CSS + JavaScript vanilla**, sem frameworks pesadas.

---

## ✨ Funcionalidades principais

### 🔧 Moderação

- Comandos slash integrados com o dashboard:
  - `warn`, `mute`, `unmute`, `clear`, `userinfo`, `help` (e outros que venhas a adicionar).
  - `/kick`, `/ban` e `/unban`; o ban aceita duração temporária e fica registado como caso.
- Histórico de ações acessível na tab **Hub de moderação**:
  - Filtros por tipo (warn/mute/ban/tickets).
  - Limite configurável de registos por página.
- Mini-painéis de análise:
  - **Análises do Servidor** – resumo rápido das ações de moderação por intervalo (24h / 7d / 30d / 1 ano).
  - **Análises de Tickets** – lista dos tickets mais recentes, com paginação.
  - **Registo de Utilizadores Online** – utilizadores mais ativos por período (7d/14d/30d).
- **Anti-spam por servidor**: ajusta limiares de mensagens repetidas, strikes, timeout, cooldown e exceções na tab Funcionalidades; servidores sem override herdam os defaults globais.
- **AutoMod por servidor**: listas PT/EN, limite de avisos e duração de timeout são configuráveis na mesma tab; a simulação avalia mensagens sem as publicar, apagar ou punir membros.
- Auto-spam e AutoMod mantêm configurações separadas; ambas herdam os defaults globais até serem personalizadas por servidor.

### 🎟️ Sistema de Tickets

- Criação e encerramento de tickets a partir do Discord.
- Integração com a dashboard:
  - Últimos tickets.
  - Relação entre tickets e utilizadores.
- Preparado para expansão com mais estados / tipos de ticket.

### 📰 GameNews (RSS)

- Configuração de **feeds RSS** por servidor.
- Envio automático de notícias para canais específicos.
- Dashboard com:
  - Lista de feeds configurados.
  - Estado de cada feed (último envio, erros, etc.).
  - Edição rápida de URL, canal, intervalo e título.

### 😂 Memes e alertas Twitch

- **Memes** publica imagens SFW de `r/wholesomememes` no canal escolhido, com intervalo configurável entre 15 minutos e 24 horas. A integração rejeita posts NSFW/spoiler e URLs de imagem fora dos hosts do Reddit.
- **Twitch** consulta a API Helix e publica um alerta quando o streamer configurado inicia um novo direto. O cargo a mencionar é opcional e é o único tipo de menção permitido.
- Os alertas Twitch precisam de uma aplicação Twitch com `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` definidos no ambiente do bot. Os segredos nunca são guardados por servidor.

### 🔊 Voz temporária

- Canais de voz base que criam salas temporárias quando um utilizador entra.
- Salas temporárias são removidas automaticamente quando ficam vazias.
- Dashboard com:
  - Lista de canais base.
  - Configuração de:
    - Categoria de criação.
    - Canal de logs.
    - Escolha de nome das salas (padrões dinâmicos).
    - Delay para limpar canais e outras opções.
  - Lista de salas temporárias ativas.

### 🌐 Dashboard web

- Autenticação por **Discord OAuth 2.0** + sessão JWT.
- A lista de servidores é filtrada: apenas aparecem guilds onde o utilizador é **Owner** ou tem permissão **Administrator**.
- Seleção de servidor e tabs por contexto:
  - **Visão geral**
  - **Utilizadores**
  - **Hub de moderação**
  - **Tickets** (se configurado)
  - **GameNews**
  - **Extras** (feeds RSS, voz temporária, tickets, sistema de Trust)
  - **Configuração**
- Indicação visual de **bot online/offline** no topo da dashboard.

### ⭐ Premium por servidor

- A licença Premium pertence a um **servidor Discord** e desbloqueia os módulos extra desse servidor.
- O owner ou um administrador do servidor pode iniciar a compra na dashboard; a conta que paga não recebe uma licença pessoal nem desbloqueia outros servidores.
- A dashboard identifica o owner do servidor separadamente da pessoa que pagou.
- Administradores do bot podem ativar, editar e revogar licenças por servidor na dashboard.
- Owners e administradores do bot gerem licenças e consultam o histórico paginado na aba **Gestão Premium**, sem precisarem de selecionar um servidor. O owner do bot também pode alterar o plano global.
- O acesso aos módulos depende sempre de uma licença ativa do servidor, incluindo para owners e administradores do bot; estes podem revogar e reativar a própria licença para testar o bloqueio.
- Licenças de servidor já ativas antes desta alteração são mantidas até expirarem. Licenças antigas associadas apenas a uma conta não são convertidas automaticamente em licença de servidor.

### 🌍 Internacionalização (i18n)

- Sistema de i18n centralizado no frontend.
- Idioma atual guardado em `state.lang` e persistido no browser.
- Ficheiros de idioma em `public/locales/` (`pt.js` e `en.js`), preparados para crescer para mais idiomas.
- Suporte para placeholders e texto dinâmico no frontend via `t(key, params)`.

---

## 📦 Instalação

### 1. Requisitos

- **Node.js 20.x**
- **MongoDB** acessível (local ou remoto)
- Conta e bot registado em [Discord Developer Portal] com:
  - Token do bot
  - Intentos necessários para moderação, membros e mensagens.

### 2. Clonar o repositório

```bash
git clone https://github.com/maze92/rabbit-bot.git
cd rabbit-bot
```

### 3. Instalar dependências

```bash
npm install
```

### 4. Configurar variáveis de ambiente

Cria um ficheiro `.env` na raiz com algo deste género (a lista completa, com comentários, está em [`.env.example`](.env.example)):

```ini
DISCORD_TOKEN=seu_token_do_bot
MONGO_URI=mongodb://localhost:27017/rabbit-bot

# Opcional: alertas Twitch (cria uma aplicação no Twitch Developer Console)
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...

## Dashboard Auth (Discord OAuth 2.0 — obrigatório)
# Cria uma aplicação no Developer Portal e gera o client secret
DISCORD_OAUTH_CLIENT_ID=seu_client_id
DISCORD_OAUTH_CLIENT_SECRET=seu_client_secret
# Opcional: sobrepõe o redirect calculado automaticamente
# DISCORD_OAUTH_REDIRECT_URI=https://o-teu-dominio/api/auth/discord/callback

# JWT secret forte (>= 32 chars)
DASHBOARD_JWT_SECRET=coloca_um_segredo_muito_forte_aqui

# Origens permitidas (CORS) — obrigatório em produção
DASHBOARD_ORIGIN=https://o-teu-dominio

## Slash commands
# Para evitar comandos duplicados no Discord, escolhe um scope:
# - global (default): regista globalmente
# - guild: regista apenas na guild indicada
# - both: regista global + guild (apenas para testes)
SLASH_SCOPE=global

# Guild para testes (só usado quando SLASH_SCOPE=guild|both)
# SLASH_GUILD_ID=123456789012345678

## Reverse proxy
# Em produção atrás de Koyeb/NGINX, o bot usa "trust proxy" por defeito.
# Podes desligar com:
# TRUST_PROXY=false

## Observabilidade (opcional)
# Token para consultar métricas internas sem sessão da dashboard.
# METRICS_TOKEN=coloca_um_token_aleatorio_longo

PORT=8000
NODE_ENV=production
```

> **Nota:** nomes específicos podem variar consoante a versão do projeto. Consulta `src/config` se quiseres afinar cada detalhe.

---

## ▶️ Execução

### Ambiente de desenvolvimento

```bash
npm run dev
```

- Inicia o bot e a API em modo desenvolvimento.
- Mostra logs detalhados no terminal.

### Produção

```bash
npm start
```

- Inicia o bot com `NODE_ENV=production`.
- Ideal para deploy em serviços como **Koyeb**, **Render**, etc.

---

## ⚙️ Configuração via dashboard

As principais opções de configuração vivem na tab **Configuração** da dashboard:

- Canal de logs principal.
- Cargos de staff.
- Preferências de registo.
- Opções relacionadas com GameNews e Voz temporária.

Grande parte da configuração avançada é persistida em MongoDB e exposta pela API em `/guilds/:id/config`.

---

## 🧪 Testes

O projeto inclui uma camada básica de testes automatizados:

```bash
npm test
```

Além disso, podes validar traduções (i18n) com:

```bash
npm run i18n:audit
```

Lint e formatação (ESLint + Prettier):

```bash
npm run lint         # verifica
npm run lint:fix     # corrige o que for seguro
npm run format       # formata com Prettier
npm run format:check # verifica formatação sem alterar ficheiros
```

Recomendado: ativar CI no GitHub (workflow incluído em `.github/workflows/ci.yml`).

---

## 📈 Observabilidade

- `GET /health` — estado da ligação ao Discord/MongoDB e contadores de utilização.
- `GET /api/internal/metrics` — contadores internos e latência por rota (média, p95, máximo).
  Requer sessão com papel `ADMIN` na dashboard ou o header `x-metrics-token` igual a `METRICS_TOKEN`:

```bash
curl -H "x-metrics-token: $METRICS_TOKEN" https://o-teu-dominio/api/internal/metrics
```

- `GET /api/internal/metrics?format=prometheus` — o mesmo snapshot em formato de texto Prometheus,
  pronto para scraping (`text/plain; version=0.0.4`).

---

## 📚 Estrutura do projeto (resumo)

```text
src/
  index.js              # Entrypoint do bot + API
  slash/                # Comandos slash
  events/               # Event handlers do Discord
  systems/              # i18n, status, error guard, etc.
  dashboard.js          # Servidor da dashboard
  config/               # Configuração padrão do projeto
public/
  index.html            # UI principal da dashboard
  css/dashboard.css     # Estilos da dashboard
  js/dashboard.js       # Lógica principal do frontend
  js/dashboard.*.js     # Módulos específicos (users, moderation, gamenews, etc.)
  locales/pt.js         # Traduções PT
```

---

## 🗺️ Roadmap (ideias futuras)

- Melhorar relatórios de tickets (filtros avançados, estados, exportação).
- Suporte completo a múltiplos idiomas (`en`, `es`, …).
- Mais widgets de saúde/status do servidor na Visão Geral.

---

## 📝 Changelog

Todas as alterações de versão são documentadas em [`CHANGELOG.md`](./CHANGELOG.md).

---

## 📄 Licença

Este projeto é distribuído sob a licença **MIT**. Consulta o ficheiro [`LICENSE`](./LICENSE) (se existir) ou o campo `license` em `package.json` para mais detalhes.
