# ── Development stage: provides a full dev environment with hot reload ──
FROM node:20-alpine AS dev

WORKDIR /app

# Install system deps for Playwright (E2E) and native modules
RUN apk add --no-cache python3 make g++ bash

COPY package*.json ./
RUN npm ci

COPY . .

# Expose dev server port (Next.js default)
EXPOSE 3000

CMD ["npm", "run", "dev", "--", "-p", "3000"]


# ── Production build helper ──
FROM dev AS build
# DATABASE_URL must be set for db/index.ts module evaluation during
# `next build` page-data collection.  The build never opens a real
# connection (all routes using @/db are force-dynamic), so a placeholder
# URL is safe here.  The real DATABASE_URL is injected at runtime only.
RUN DATABASE_URL=postgres://build:build@localhost:5432/build npm run build


# ── Production stage: standalone build, minimal runtime ──
FROM node:20-alpine AS prod

# DO-02 (security audit): tools needed for HEALTHCHECK wget probe.
RUN apk add --no-cache wget

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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
    ttf-freefont

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy standalone output from the stage that actually runs `next build`.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/db/seed ./db/seed
# Standalone migration runner (uses runtime deps only; see scripts/migrate.mjs).
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
# Next's standalone tracer only copies the files it sees imported, which can omit
# the `drizzle-orm/postgres-js/migrator` submodule used solely by migrate.mjs.
# Overlay the full packages so the migration runner always resolves.
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/postgres ./node_modules/postgres

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
    chown -R nextjs:nodejs /app/storage /app/.next /data/storage

USER nextjs

EXPOSE 3000

# Audit DO-02: healthcheck against /api/health (also pings the DB).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
