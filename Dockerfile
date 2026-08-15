# ── Development stage: provides a full dev environment with hot reload ──
FROM node:22.13-alpine AS dev

WORKDIR /app

# Install system deps for Playwright (E2E) and native modules
RUN apk add --no-cache python3 make g++ bash

COPY package*.json ./
# Keep the build stage complete even when the Docker daemon inherits
# NODE_ENV=production. Next.js compilation and one-shot script bundling depend
# on development tools such as TypeScript and esbuild.
RUN npm ci --include=dev

COPY . .

# The invoice OCR must never download language data during a user request.
# Keep the small fast models installed as direct npm dependencies and place both
# languages in one directory, which is what Tesseract expects for "spa+eng".
RUN mkdir -p /app/tessdata && \
    cp node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz /app/tessdata/spa.traineddata.gz && \
    cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz /app/tessdata/eng.traineddata.gz

# Expose dev server port
EXPOSE 3001

CMD ["npm", "run", "dev"]


# ── Production build helper ──
FROM dev AS build
# DATABASE_URL must be set for db/index.ts module evaluation during
# `next build` page-data collection.  The build never opens a real
# connection (all routes using @/db are force-dynamic), so a placeholder
# URL is safe here.  The real DATABASE_URL is injected at runtime only.
RUN DATABASE_URL=postgres://build:build@localhost:5432/build npm run build

# Bundle the RBAC synchronizer while its TypeScript sources, path aliases and
# build tools are still available. The slim runtime image receives only this
# portable JavaScript artifact.
RUN ./node_modules/.bin/esbuild scripts/sync-rbac.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --outfile=/tmp/sync-rbac.mjs


# ── Production stage: standalone build, minimal runtime ──
FROM node:22.13-alpine AS prod

# DO-02 (security audit): tools needed for HEALTHCHECK wget probe.
RUN apk add --no-cache wget

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV INVOICE_OCR_TESSDATA_PATH=/app/tessdata

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Runtime deps: libc6-compat for sharp/native modules; chromium + fonts for
# the server-side PDF route (app/(print)/sst/[id]/print/pdf/route.ts).
# PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH tells playwright-core to use the
# system Chromium rather than its own downloaded browser.
RUN apk add --no-cache \
    libc6-compat \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    postgresql-client \
    coreutils \
    bash \
    rclone \
    jq

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy standalone output from the stage that actually runs `next build`.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/tessdata ./tessdata
# Tesseract launches a child Node worker. Its runtime-only image decoders and
# fetch helpers are not statically visible to Next's file tracer, so copy the
# worker's dependency closure explicitly into the standalone image.
COPY --from=build /app/node_modules/bmp-js ./node_modules/bmp-js
COPY --from=build /app/node_modules/is-electron ./node_modules/is-electron
COPY --from=build /app/node_modules/is-url ./node_modules/is-url
COPY --from=build /app/node_modules/node-fetch ./node_modules/node-fetch
COPY --from=build /app/node_modules/regenerator-runtime ./node_modules/regenerator-runtime
COPY --from=build /app/node_modules/wasm-feature-detect ./node_modules/wasm-feature-detect
COPY --from=build /app/node_modules/zlibjs ./node_modules/zlibjs
COPY --from=build /app/node_modules/whatwg-url ./node_modules/whatwg-url
COPY --from=build /app/node_modules/tr46 ./node_modules/tr46
COPY --from=build /app/node_modules/webidl-conversions ./node_modules/webidl-conversions
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/db/seed ./db/seed
# Standalone migration runner (uses runtime deps only; see scripts/migrate.mjs).
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/migration-preflight.mjs ./scripts/migration-preflight.mjs
# Next's standalone tracer only copies the files it sees imported, which can omit
# the `drizzle-orm/postgres-js/migrator` submodule used solely by migrate.mjs.
# Overlay the full packages so the migration runner always resolves.
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/postgres ./node_modules/postgres

COPY --from=build /tmp/sync-rbac.mjs ./scripts/sync-rbac.mjs
# Cron service uses this bounded internal HTTP runner instead of an inline
# wget command. It is copied explicitly because Next standalone does not trace
# scripts invoked only by Compose.
COPY --from=build /app/scripts/cron-runner.mjs ./scripts/cron-runner.mjs

# Backup scripts (orquestador, verificación, storage, scheduler)
COPY scripts/backup-orchestrator.sh  ./scripts/backup-orchestrator.sh
COPY scripts/backup-verify.sh       ./scripts/backup-verify.sh
COPY scripts/backup-storage.sh      ./scripts/backup-storage.sh
COPY scripts/restore-all.sh         ./scripts/restore-all.sh
COPY scripts/catastrophic-restore.sh ./scripts/catastrophic-restore.sh
COPY scripts/backup-scheduler.sh    ./scripts/backup-scheduler.sh

# Make scripts executable
RUN chmod +x ./scripts/backup-*.sh ./scripts/restore-all.sh ./scripts/catastrophic-restore.sh

# Ensure storage + the Next.js ISR/prerender cache dirs exist and are writable.
# The standalone output copies .next/static but not a cache dir; at runtime the
# `nextjs` user writes the incremental cache to /app/.next/cache, which would
# fail with EACCES if the dir is missing or root-owned.
# /data/storage is the docker-compose volume mountpoint (STORAGE_PATH); it must be
# pre-created and owned by nextjs so that a freshly created named volume inherits
# UID/GID 1001 (Docker copies the mountpoint's ownership into an empty volume).
# Otherwise the volume defaults to root and `mkdir /data/storage/<repuestos|...>`
# at runtime fails with EACCES.
RUN mkdir -p /app/storage /app/.next/cache /data/storage && \
    chown nextjs:nodejs /app/storage /data/storage && \
    chown -R nextjs:nodejs /app/.next/cache

USER nextjs

EXPOSE 3000

# Audit DO-02: healthcheck against /api/health (also pings the DB).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
