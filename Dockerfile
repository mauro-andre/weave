# Imagem da aplicação Weave (engine + GUI + server) — publicada no GHCR.
# O dev sobe este container e instala @mauroandre/weave-sdk no app dele.

# ---- build ----
FROM node:24-slim AS build
WORKDIR /app

# Manifestos primeiro (cache de camada do npm ci). Os workspaces precisam dos
# seus package.json presentes pra montar os symlinks.
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/sdk/package.json ./packages/sdk/
RUN npm ci

# Só o necessário pro build (sem tests/, scripts/, docs). `public/` é copiada
# pro dist/client; `vite.config.ts` é o config do build.
COPY tsconfig.json vite.config.ts ./
COPY app ./app
COPY packages ./packages
COPY public ./public
RUN npm run build

# ---- runtime ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# O dist externaliza só as deps de runtime (postgres, velojs, preact, dotenv…) —
# instalamos apenas produção. O core foi embutido no bundle, então packages/ não
# é necessário aqui (só os manifestos, pros symlinks de workspace do npm ci).
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/sdk/package.json ./packages/sdk/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Default do app é 3000; sobrescreva em runtime com -e PORT=... (não fixamos aqui).
EXPOSE 3000
# Equivale a `velojs start`: sobe dist/server.js (escuta em PORT, ou 3000).
CMD ["node", "dist/server.js"]
