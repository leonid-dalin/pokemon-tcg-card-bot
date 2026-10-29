FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.22.1-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data BOT_STATUS_FILE=/run/bot/status.json
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/data/text-index.json ./src/data/text-index.json
COPY deploy/smoke.mjs ./deploy/smoke.mjs
COPY LICENSE NOTICE ./
COPY docs/THIRD_PARTY_NOTICES.md ./docs/THIRD_PARTY_NOTICES.md
RUN mkdir /data /run/bot && chown node:node /data /run/bot
USER node
RUN node deploy/smoke.mjs
WORKDIR /run/bot
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node --input-type=module -e 'import{readFileSync}from"node:fs";const s=JSON.parse(readFileSync(process.env.BOT_STATUS_FILE));process.exit(s.ready&&Date.now()-s.updatedAt<20000?0:1)'
CMD ["node", "--max-old-space-size=192", "/app/dist/src/index.js"]
