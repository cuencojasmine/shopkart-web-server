# Production image for Render (free Docker web service).
# Product images are stored in Cloudflare R2 (R2_* variables) and data in Neon,
# so nothing on this container's disk needs to survive a restart.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
# Compiles the TypeScript server code and the admin panel into dist/
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1337 \
    TZ=Asia/Manila \
    STRAPI_TELEMETRY_DISABLED=true
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 1337
CMD ["node_modules/.bin/strapi", "start"]
