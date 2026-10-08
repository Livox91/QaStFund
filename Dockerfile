FROM node:24-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder

COPY . .

ARG NEXT_PUBLIC_CIRCLE_CLIENT_KEY=""
ARG NEXT_PUBLIC_CIRCLE_CLIENT_URL=""
ARG NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS=""

ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    APP_URL="http://localhost:3000" \
    NEXT_PUBLIC_CIRCLE_CLIENT_KEY=$NEXT_PUBLIC_CIRCLE_CLIENT_KEY \
    NEXT_PUBLIC_CIRCLE_CLIENT_URL=$NEXT_PUBLIC_CIRCLE_CLIENT_URL \
    NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS=$NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS

RUN mkdir -p public \
    && npm run contracts:compile \
    && npm run prisma:generate \
    && npm run build

FROM dependencies AS migrator

COPY prisma ./prisma
COPY prisma7.config.ts ./

CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
