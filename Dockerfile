# Stage 1: Build Vite frontend and bundle Node production server
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server

RUN npm run build && npm run build:server

# Stage 2: Minimal runtime image (no devDependencies, non-root user)
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    CACHE_DIR=/tmp/nexus-cache

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/dist-server/index.mjs ./dist-server/index.mjs

USER node
EXPOSE 8080

CMD ["node", "dist-server/index.mjs"]
