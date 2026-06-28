# ---- deps: instala o workspace completo (pnpm precisa dos symlinks entre apps) ----
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---- build: compila a API e gera o Prisma Client ----
FROM deps AS build
COPY . .
RUN pnpm --filter api exec prisma generate
RUN mkdir -p /prisma-client-output \
  && find /repo/node_modules/.pnpm -path '*/node_modules/.prisma/client' -exec cp -r {}/. /prisma-client-output/ \;
RUN pnpm --filter api build

# ---- runtime: só o necessário pra rodar ----
FROM node:22-alpine AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --prod --filter api
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /prisma-client-output /prisma-client-output
RUN PRISMA_CLIENT_NM="$(dirname "$(dirname "$(find /repo/node_modules/.pnpm -maxdepth 3 -path '*/node_modules/@prisma/client' | head -n1)")")" \
  && mkdir -p "$PRISMA_CLIENT_NM/.prisma/client" \
  && cp -r /prisma-client-output/. "$PRISMA_CLIENT_NM/.prisma/client/" \
  && rm -rf /prisma-client-output
COPY apps/api/entrypoint.sh apps/api/entrypoint.sh
RUN chmod +x apps/api/entrypoint.sh
WORKDIR /repo/apps/api
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/app.js"]
