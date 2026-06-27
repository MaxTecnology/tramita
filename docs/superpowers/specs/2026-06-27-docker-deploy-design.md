# Design — Containerização e Deploy (Dokploy) — Fase 9

## Objetivo

Completar a Fase 9 do `docs/TASKS.md` (Infra e Deploy): Dockerfiles multi-stage
para `api` e `web`, um `docker-compose.prod.yml` pronto para o Dokploy
(Traefik global já existente, sem subir Traefik próprio), e um jeito de testar
as mesmas imagens localmente antes de subir — sem alterar o fluxo de
desenvolvimento atual (`pnpm --filter api dev` + `docker-compose.yml` só com
Postgres/Redis para dev).

## Decisões confirmadas com o usuário

- **Domínios:** mantém a separação já implementada no código — `tramita.autohubs.com.br`
  (web) e `api.tramita.autohubs.com.br` (api), com CORS habilitado (já está
  assim em `apps/api/src/plugins/cors.ts`). A nota de "domínio único, zero
  CORS" em `CLAUDE.md`/`ARCHITECTURE.md` está desatualizada em relação ao
  código real — não será seguida.
- **Traefik:** o Dokploy já gerencia um Traefik global na VPS. O projeto
  não sobe Traefik próprio — só adiciona labels nos serviços.
- **Postgres/Redis em produção:** já existem no Dokploy (gerenciados
  separadamente). O `docker-compose.prod.yml` da Tramita só contém `api`,
  `worker`, `web` — conectam via `DATABASE_URL`/`REDIS_URL` apontando para
  esses serviços existentes.
- **Puppeteer:** continua embutido na imagem da API (sem extrair para
  microserviço) — só precisa de Chromium + libs de sistema na imagem.
- **Frontend em produção:** servido por Nginx (`nginx:alpine`), não por um
  servidor Node.
- **Docker local:** convive com o fluxo atual. `docker-compose.yml` (dev,
  só Postgres/Redis) não muda. Um arquivo de override separado permite
  testar as imagens de produção localmente sem precisar de Traefik.

## 1. `apps/api/Dockerfile`

Multi-stage, base `node:22-alpine`:

```dockerfile
# deps — instala o workspace completo (pnpm precisa dos symlinks entre apps/packages)
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# build — compila a API e gera o Prisma Client
FROM deps AS build
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

# runtime — só o necessário pra rodar, com Chromium de sistema (não o do Puppeteer)
FROM node:22-alpine AS runtime
RUN corepack enable \
  && apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --prod --filter api
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY apps/api/entrypoint.sh apps/api/entrypoint.sh
RUN chmod +x apps/api/entrypoint.sh
WORKDIR /repo/apps/api
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/app.js"]
```

`apps/api/entrypoint.sh`:

```bash
#!/bin/sh
set -e
echo "Aplicando migrations..."
node ./node_modules/prisma/build/index.js migrate deploy
exec "$@"
```

O serviço **worker** usa a mesma imagem, só troca o `command` no compose para
`node dist/worker.js` — não passa pelo `entrypoint.sh`'s migrate (só a API
roda migration, pra não disputar lock de migration com dois containers
subindo ao mesmo tempo).

## 2. `apps/web/Dockerfile`

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter web build

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

`apps/web/nginx.conf` — fallback de SPA + gzip:

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

`VITE_API_URL` precisa ser passado como **build arg** (`--build-arg
VITE_API_URL=https://api.tramita.autohubs.com.br`), já que o Vite assa as
env vars no bundle em tempo de build — trocar depois exige rebuild da imagem,
não só reiniciar o container.

## 3. `docker-compose.prod.yml`

```yaml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
      ASAAS_API_KEY: ${ASAAS_API_KEY}
      ASAAS_BASE_URL: ${ASAAS_BASE_URL}
      ASAAS_WEBHOOK_SECRET: ${ASAAS_WEBHOOK_SECRET}
      B2_KEY_ID: ${B2_KEY_ID}
      B2_APP_KEY: ${B2_APP_KEY}
      B2_BUCKET_NAME: ${B2_BUCKET_NAME}
      B2_BUCKET_REGION: ${B2_BUCKET_REGION}
      B2_ENDPOINT: ${B2_ENDPOINT}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      APP_URL: ${APP_URL}
      NODE_ENV: production
      PORT: 3000
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - dokploy-network
    labels:
      - traefik.enable=true
      - traefik.http.routers.tramita-api.rule=Host(`api.tramita.autohubs.com.br`)
      - traefik.http.routers.tramita-api.entrypoints=websecure
      - traefik.http.routers.tramita-api.tls.certresolver=letsencrypt
      - traefik.http.services.tramita-api.loadbalancer.server.port=3000
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/worker.js"]
    environment:
      # mesmas variáveis do api (sem PORT/healthcheck HTTP — processo de fila)
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      B2_KEY_ID: ${B2_KEY_ID}
      B2_APP_KEY: ${B2_APP_KEY}
      B2_BUCKET_NAME: ${B2_BUCKET_NAME}
      B2_BUCKET_REGION: ${B2_BUCKET_REGION}
      B2_ENDPOINT: ${B2_ENDPOINT}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      APP_URL: ${APP_URL}
      NODE_ENV: production
    networks:
      - dokploy-network
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        VITE_API_URL: https://api.tramita.autohubs.com.br
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:80"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - dokploy-network
    labels:
      - traefik.enable=true
      - traefik.http.routers.tramita-web.rule=Host(`tramita.autohubs.com.br`)
      - traefik.http.routers.tramita-web.entrypoints=websecure
      - traefik.http.routers.tramita-web.tls.certresolver=letsencrypt
      - traefik.http.services.tramita-web.loadbalancer.server.port=80
    restart: unless-stopped

networks:
  dokploy-network:
    external: true
```

`certresolver: letsencrypt` e o nome da rede `dokploy-network` são os nomes
**padrão** usados pelo Dokploy — o usuário deve confirmar no painel do
próprio Dokploy se esses nomes batem com a instalação dele antes do primeiro
deploy (isso entra na revisão do `infra-auditor` depois da implementação).

Nenhuma porta é publicada no host — o Traefik do Dokploy roteia pela rede
`dokploy-network`, que é o padrão seguro (não expõe os containers
diretamente na interface da VPS).

## 4. `docker-compose.local-test.yml` (override só para teste local)

```yaml
services:
  api:
    ports:
      - "3000:3000"
    networks:
      dokploy-network:
        aliases: []
    network_mode: bridge

  web:
    ports:
      - "8080:80"

networks:
  dokploy-network:
    external: false
```

Uso: `docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml up --build`
— roda as mesmas imagens localmente, publica `localhost:3000` (api) e
`localhost:8080` (web), e torna a rede `dokploy-network` local (não externa),
já que ela não existe fora do servidor Dokploy real.

O merge do Docker Compose substitui valores escalares pelo último arquivo
informado — `external: false` no override sobrescreve o `external: true`
do `docker-compose.prod.yml` para essa mesma chave, então a rede passa a ser
criada localmente pelo próprio Compose em vez de exigir uma rede externa
pré-existente. A task de implementação valida isso rodando o comando acima
de fato e confirmando que ele sobe sem erro de "network not found".

## 5. Arquivos auxiliares

- `.dockerignore` (raiz): `node_modules`, `.git`, `**/dist`, `**/.env*`,
  `**/*.test.ts`, `.claude/`, `docs/`.
- `apps/api/.dockerignore` e `apps/web/.dockerignore`: espelham o da raiz
  para o contexto de cada build (mesmo contexto raiz, mas documentam intenção).
- `.env.example`: adicionar comentário deixando explícito que `VITE_API_URL`
  é variável de **build** do frontend (não roda em runtime), para não
  confundir com as demais variáveis de runtime da API.
- `docs/TASKS.md`: marcar os itens da Fase 9 conforme implementados.

## Testes

Não há testes automatizados de infra neste projeto (Vitest/Playwright testam
código, não Dockerfiles). A validação é manual:
- `docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml up --build`
  sobe os 3 serviços localmente sem erro.
- `curl http://localhost:3000/health` retorna `200`.
- `curl http://localhost:8080` retorna o HTML do SPA.
- Geração de relatório PDF (`reports.service.ts`) funciona dentro do
  container da API (valida que o Chromium de sistema está acessível).

Depois da implementação, despachar os agentes `docker-auditor` (revisão dos
Dockerfiles/compose) e `infra-auditor` (revisão de Traefik/rede/Dokploy)
antes do usuário fazer o primeiro deploy real.

## Fora do escopo

- Extrair Puppeteer para microserviço separado.
- Migrar para domínio único com proxy de path.
- CI/CD automatizado (GitHub Actions) — Fase 9 do `TASKS.md` já lista isso
  como item separado, não pedido nesta rodada.
- Self-host de Postgres/Redis em container (já existem no Dokploy do usuário).
