FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk upgrade --no-cache \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && rm -rf /root/.npm /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY database/initial ./database/initial
ARG VCS_REF=uncommitted
LABEL org.opencontainers.image.revision=$VCS_REF
USER node

FROM runtime AS worker
HEALTHCHECK NONE
CMD ["node", "dist/worker.js"]

FROM runtime AS api
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-4000}/health/live" || exit 1
CMD ["node", "dist/main.js"]
