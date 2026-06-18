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


# ── Production stage: standalone build, minimal runtime ──
FROM node:20-alpine AS prod

# DO-02 (security audit): tools needed for HEALTHCHECK wget probe.
RUN apk add --no-cache wget

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Install only runtime deps for sharp (if used) and PostgreSQL client libs
RUN apk add --no-cache libc6-compat

# Copy standalone output from build
COPY --from=dev /app/.next/standalone ./
COPY --from=dev /app/.next/static ./.next/static
COPY --from=dev /app/public ./public
COPY --from=dev /app/db/migrations ./db/migrations
COPY --from=dev /app/db/seed ./db/seed

# Ensure storage dir exists and is writable
RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage

USER nextjs

EXPOSE 3000

# Audit DO-02: healthcheck against /api/health (also pings the DB).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]


# ── Production build helper: use `docker build --target dev ...` for local dev ──
FROM dev AS build
RUN npm run build
