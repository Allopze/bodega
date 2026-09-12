# syntax=docker/dockerfile:1

# ── Development stage: provides a full dev environment with hot reload ──
FROM node:22.13-alpine AS dev

WORKDIR /app

# Install system deps for Playwright (E2E) and native modules
RUN apk add --no-cache python3 make g++ bash

COPY package*.json ./
# Keep the build stage complete even when the Docker daemon inherits
# NODE_ENV=production. Next.js compilation and one-shot script bundling depend
# on development tools such as TypeScript and esbuild.
RUN --mount=type=cache,id=chome-npm,target=/root/.npm,sharing=locked \
    npm ci --include=dev

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
RUN --mount=type=cache,id=chome-next,target=/app/.next/cache,sharing=locked \
    NODE_OPTIONS=--max-old-space-size=8192 \
    DATABASE_URL=postgres://build:build@localhost:5432/build npm run build

# Bundle the RBAC synchronizer while its TypeScript sources, path aliases and
# build tools are still available. The slim runtime image receives only this
# portable JavaScript artifact.
RUN ./node_modules/.bin/esbuild scripts/sync-rbac.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --outfile=/tmp/sync-rbac.mjs

# La regularización de las entregas EPP históricas forma parte del deploy, no
# de una operación manual. Se bundlea porque la imagen slim no incluye `tsx`
# ni las fuentes TypeScript; deja externos sólo los drivers que sí se copian.
RUN ./node_modules/.bin/esbuild scripts/reconcile-epp-delivery-scale.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/reconcile-epp-delivery-scale.mjs

# Mismo motivo que sync-rbac: el catálogo de instrumentos del motor de
# inspecciones se instala cableado a la actividad del PDTP que acredita cada
# uno, y sin ese paso en el deploy las plantillas quedan sin acreditar y la
# inspección se ejecuta sin que el programa anual se entere.
RUN ./node_modules/.bin/esbuild scripts/seed-pdtp-inspection-templates-2026.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/seed-pdtp-inspection-templates.mjs

# El sembrador deja el catálogo en borrador a propósito: habilitar un
# instrumento es un acto de una persona. Este cierra lo que queda —aprobar las
# que faltan, retirar las vigentes que no declaran actividad— por la misma
# puerta que la UI, firmado por quien lo corre. No va en el deploy: se invoca a
# mano con un actor explícito.
# El banner no es opcional acá y sí lo es en los demás scripts: éste es el
# primero que entra por `lib/services/prevention-inspections.ts`, que importa el
# `logger`, que importa `lib/sentry.ts`, que importa `@sentry/nextjs` — y con él
# entra Next entero, incluido código CJS que usa `__dirname`. En un bundle ESM
# eso revienta al cargar, antes de ejecutar una línea propia. `@sentry/nextjs`
# no puede marcarse external porque la imagen final no copia ese paquete a
# node_modules, así que el camino es dejarlo dentro y darle los globals que
# espera. El wrapper de Sentry ya es no-op sin `SENTRY_DSN`, que es el caso de
# cualquier script de línea de comandos.
RUN ./node_modules/.bin/esbuild scripts/approve-pdtp-2026-inspection-templates.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --banner:js='import{createRequire as __cr}from"module";import{fileURLToPath as __f}from"url";import{dirname as __d}from"path";const require=__cr(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__d(__filename);' \
    --outfile=/tmp/approve-pdtp-inspection-templates.mjs

# Corrige la clasificación de los cursos declarados como del art. 16 del DS 44
# sin serlo. No hay `updateTrainingCourse` en la capa de servicio —sólo
# `create`—, así que no existe pantalla que permita hacerlo; de ahí que sea un
# script.
#
# Lleva el mismo banner que el de habilitación de plantillas por precaución, no
# por necesidad: éste importa `db/schema` directo y no la capa de servicios, así
# que hoy no arrastra el logger ni con él Next, y pesa 735 KB en vez de 4,3 MB.
# El banner cuesta una línea y evita que el día que alguien necesite importar un
# servicio acá el script reviente al cargar, en producción.
RUN ./node_modules/.bin/esbuild scripts/reclassify-pdtp-2026-specific-courses.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --banner:js='import{createRequire as __cr}from"module";import{fileURLToPath as __f}from"url";import{dirname as __d}from"path";const require=__cr(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__d(__filename);' \
    --outfile=/tmp/reclassify-pdtp-specific-courses.mjs

# El catálogo de Documentación SST (categorías y tipos). Estaba sólo detrás de
# un botón del panel de administración, así que en producción llegó vacío — y
# con él vacío la N°36 y la N°43 no tienen dónde declarar su número.
RUN ./node_modules/.bin/esbuild scripts/apply-sst-document-taxonomy.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/apply-sst-document-taxonomy.mjs

# El plan de emergencia por faena. Sin él la N°84 no tiene dónde declararse y el
# programa anual no se puede activar. ExcelJS usa `require("crypto")` dinámico,
# así que este artefacto debe conservar el formato CommonJS para ejecutarse con
# Node en la imagen slim.
RUN ./node_modules/.bin/esbuild scripts/seed-prevention-emergency-plans.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/seed-emergency-plans.cjs

# Diagnóstico del cableado entre el programa anual y los módulos que lo
# acreditan. Sólo lectura y nunca aborta: corre DESPUÉS de sembrar el catálogo
# para dejar en el log del deploy qué quedó pendiente de aprobar. La compuerta
# real es `assertPdtpFulfillmentCoverage`, al enviar el programa a revisión.
RUN ./node_modules/.bin/esbuild scripts/preflight-pdtp-accreditation-wiring.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/preflight-pdtp-accreditation-wiring.mjs

# Las decisiones de catálogo del programa 2026 (retiros, corresponsables, textos
# y modo de indicador) son datos del programa, no del código: si no corren en el
# deploy quedan esperando que alguien las aplique a mano, que es exactamente lo
# que pasó entre agosto y septiembre de 2026.
RUN ./node_modules/.bin/esbuild scripts/apply-pdtp-2026-catalog-decisions.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/apply-pdtp-catalog-decisions.mjs

# Qué faenas operan el programa 2026 y qué actividades no les aplican dentro de
# las que sí lo operan. Sin este paso `pdtp_program_worksites` llega vacío a
# producción y la regla del motor ("sin membresía declarada, todas las faenas
# activas") deja las 81 actividades exigibles también en Oficina Central.
RUN ./node_modules/.bin/esbuild scripts/apply-pdtp-2026-worksite-scope.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/apply-pdtp-worksite-scope.mjs

# Los cursos, los planes y las campañas declaran qué actividad del PDTP acredita
# cada uno. Sin ese dato el conector existe y no hace nada: la sesión se cierra y
# el programa anual no se entera.
RUN ./node_modules/.bin/esbuild scripts/apply-pdtp-2026-program-data.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/apply-pdtp-program-data.mjs

# La clasificación por mecanismo (enganche / constancia / compuesta) dice qué
# actividad espera un evento de otro módulo y qué actividad se marca a mano. El
# submódulo Constancias filtra por esa columna, así que sin este paso llegaría
# vacío a producción. Se aplicó a mano en dev en septiembre de 2026 y nunca en
# producción: acá deja de depender de que alguien se acuerde.
RUN ./node_modules/.bin/esbuild scripts/apply-pdtp-2026-mechanisms.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/apply-pdtp-mechanisms.mjs

# El SLA y la evidencia mínima de las actividades a demanda del programa: sin
# esto no se puede ni enviar el programa a revisión
# (`pdtpSubmitReviewBlockers`). Va después de las decisiones de catálogo (que
# deciden qué actividades siguen vivas) y de la clasificación por mecanismo.
RUN ./node_modules/.bin/esbuild scripts/apply-pdtp-2026-demand-slas.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/apply-pdtp-demand-slas.mjs

# Reprocesa los eventos de cumplimiento que quedaron `pending`/`error` en
# `pdtp_fulfillment_events` — un hecho ocurrido con el programa todavía en
# borrador, o un mapeo que se acaba de corregir. Idempotente: no duplica lo ya
# acreditado. Va al final de los pasos del PDTP, cuando el resto del dato ya
# quedó declarado.
RUN ./node_modules/.bin/esbuild scripts/reconcile-pdtp-fulfillment-events.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/reconcile-pdtp-fulfillment-events.cjs

# Mismo motivo que sync-rbac: los one-shots de conciliación OC-factura viven en
# TypeScript con alias `@/`, y la imagen de producción no lleva ni `tsx` ni el
# source. Se bundlean acá y se corren con `node` desde `docker-compose.yml`.
RUN ./node_modules/.bin/esbuild \
    scripts/preflight-purchase-invoice-reconciliation.ts \
    scripts/backfill-purchase-invoice-reconciliation.ts \
    scripts/rollback-purchase-invoice-reconciliation-statuses.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --outdir=/tmp/invoice-reconciliation \
    --out-extension:.js=.mjs

# Mismo motivo: el backfill de `referenced_order_codes` relee el XML cacheado de
# los DTE sincronizados antes de que existiera la columna. Sin este paso en el
# deploy, la señal "el proveedor cita esta OC" sólo existiría para los
# documentos que lleguen después, o sea para ninguno de los que ya están.
#
# Acá NO se usa `--packages=external` como en los one-shot de arriba: la imagen
# de producción es un build standalone de Next y su `node_modules` sólo trae lo
# que el tracer vio más lo que se copia explícitamente abajo — `drizzle-orm` y
# `postgres`. `fast-xml-parser`, que este script necesita para leer el XML, NO
# está: Next lo inlinea en sus chunks de servidor y nunca queda como paquete
# resoluble. Dejarlo externo produce un ERR_MODULE_NOT_FOUND al arrancar, así
# que se externalizan sólo los dos paquetes que sí existen en la imagen y todo
# lo demás se empaqueta.
RUN ./node_modules/.bin/esbuild scripts/backfill-dte-order-refs.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/backfill-dte-order-refs.mjs

# Relectura de `referenced_order_codes` para las filas que ya se examinaron con
# el normalizador anterior (el que descartaba los correlativos de 2 dígitos).
# Complementa al backfill de arriba, que sólo mira filas en NULL.
RUN ./node_modules/.bin/esbuild scripts/reparse-dte-order-refs.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/reparse-dte-order-refs.mjs

# Migración de documentos SST del filesystem local a Cloudreve (WebDAV).
# Corre a demanda (nunca en el deploy): el operador la ejecuta explícitamente
# después de verificar la instancia Cloudreve. Externaliza sólo lo que la
# imagen standalone resuelve (drizzle-orm + postgres); el resto se empaqueta.
RUN ./node_modules/.bin/esbuild scripts/migrate-sst-to-cloudreve.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/migrate-sst-to-cloudreve.cjs

# Descarga del espacio SST desde el backend activo para el backup. No toca la
# BD: externaliza sólo postgres por consistencia con el resto (aunque no lo use)
# y empaqueta el resto para que la imagen standalone lo resuelva.
RUN ./node_modules/.bin/esbuild scripts/download-sst-documents.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:postgres \
    --outfile=/tmp/download-sst-documents.mjs

# Subida/descarga del snapshot de respaldo a Cloudreve (WebDAV). Leen las
# credenciales con `readCloudreveConfig()` —que consulta `system_settings`
# (drizzle) y descifra con el keyring DTE—, así que externalizan lo que la
# imagen standalone ya resuelve (drizzle-orm + postgres) y empaquetan el resto.
RUN ./node_modules/.bin/esbuild scripts/upload-backup-cloudreve.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/upload-backup-cloudreve.cjs
RUN ./node_modules/.bin/esbuild scripts/download-backup-cloudreve.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/download-backup-cloudreve.cjs

# Mismo motivo, para los one-shot de combustible. El backfill de lecturas de
# medidor reconstruye la serie de odómetro desde el detalle que ya está guardado
# en `raw_row`, y el sync del catálogo de reglas deja disponibles las reglas
# nuevas sin esperar la ventana del cron. Se externalizan sólo `drizzle-orm` y
# `postgres` —los dos paquetes que la imagen standalone sí resuelve— y todo lo
# demás (incluido `exceljs`, del que cuelgan los helpers de parseo) se empaqueta.
RUN ./node_modules/.bin/esbuild \
    scripts/backfill-fuel-meter-readings.ts \
    scripts/seed-fuel-anomaly-rules.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outdir=/tmp/fuel \
    --out-extension:.js=.mjs

# El preflight de integraciones de combustible sólo habla `postgres` y es de
# sólo lectura (`sql.begin("read only", ...)`): corre ANTES de migrar para dejar
# en el log del deploy cuánto detalle hay por rescatar y cuántas lecturas
# regresivas trae el histórico.
RUN ./node_modules/.bin/esbuild scripts/preflight-fuel-integrations.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:postgres \
    --outfile=/tmp/preflight-fuel-integrations.mjs

# Normalización de SKUs activos de EPP y servicios a formato secuencial
# (EPP-NNN, SRV-NNN), preservando los SKU de productos fuera del conjunto.
# Corre en deploy una sola vez: es idempotente (si ya está normalizado, no cambia nada).
RUN ./node_modules/.bin/esbuild scripts/normalize-epp-skus.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:postgres \
    --outfile=/tmp/normalize-epp-skus.mjs

# Recalcula el estado derivado de las solicitudes cuya regla de cierre cambió
# después de que sus ítems llegaran a estado terminal. El rollup solo corre en
# cada transición de ítem, así que sin esto una solicitud recibida bajo la regla
# vieja se queda con el estado viejo para siempre.
RUN ./node_modules/.bin/esbuild scripts/reconcile-request-status.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/reconcile-request-status.mjs

# Deja `size_catalog` al día con la semilla del código. Es prerrequisito de los
# dos pasos que siguen: el backfill de ropa exige `size_family = 'ropa'`, y esa
# familia sale de esta tabla. Estaba cableado sólo en `npm run db:migrate`, que
# es el camino local — producción migra por el servicio `migrate`, así que la
# tabla nunca se sincronizaba en el servidor.
RUN ./node_modules/.bin/esbuild scripts/seed-size-catalog.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/seed-size-catalog.mjs

# Da de baja las variantes que son la misma talla física escrita de dos formas
# (`N41` junto a `T41`, `L` junto a `T/L`) o duplicadas de plano. Desactiva con
# `is_active = false`, nunca borra, y sólo toca variantes sin stock ni
# historial: las que participaron de una operación se informan y se saltan.
RUN ./node_modules/.bin/esbuild scripts/reconcile-epp-duplicate-sizes.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/reconcile-epp-duplicate-sizes.mjs

# Completa S/M/L/XL/2XL/3XL —el rango que el negocio realmente compra— en toda
# familia EPP que **declare** `size_family = 'ropa'`. El importador XLSX y la
# creación manual sólo dejan la fila que trae la planilla o la que alguien
# tipeó, no el rango completo. Corre en deploy, después de normalizar SKUs,
# para que los SKU nuevos nazcan ya en la numeración secuencial vigente.
# Idempotente: familias completas o de otra familia de tallas no se tocan.
RUN ./node_modules/.bin/esbuild scripts/backfill-epp-clothing-sizes.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --external:drizzle-orm \
    --external:drizzle-orm/* \
    --external:postgres \
    --outfile=/tmp/backfill-epp-clothing-sizes.mjs


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
COPY --from=build /tmp/reconcile-epp-delivery-scale.mjs ./scripts/reconcile-epp-delivery-scale.mjs
COPY --from=build /tmp/seed-pdtp-inspection-templates.mjs ./scripts/seed-pdtp-inspection-templates.mjs
COPY --from=build /tmp/apply-sst-document-taxonomy.mjs ./scripts/apply-sst-document-taxonomy.mjs
COPY --from=build /tmp/seed-emergency-plans.cjs ./scripts/seed-emergency-plans.cjs
COPY --from=build /tmp/preflight-pdtp-accreditation-wiring.mjs ./scripts/preflight-pdtp-accreditation-wiring.mjs
COPY --from=build /tmp/approve-pdtp-inspection-templates.mjs ./scripts/approve-pdtp-inspection-templates.mjs
COPY --from=build /tmp/reclassify-pdtp-specific-courses.mjs ./scripts/reclassify-pdtp-specific-courses.mjs
COPY --from=build /tmp/apply-pdtp-catalog-decisions.mjs ./scripts/apply-pdtp-catalog-decisions.mjs
COPY --from=build /tmp/apply-pdtp-worksite-scope.mjs ./scripts/apply-pdtp-worksite-scope.mjs
COPY --from=build /tmp/apply-pdtp-program-data.mjs ./scripts/apply-pdtp-program-data.mjs
COPY --from=build /tmp/apply-pdtp-mechanisms.mjs ./scripts/apply-pdtp-mechanisms.mjs
COPY --from=build /tmp/apply-pdtp-demand-slas.mjs ./scripts/apply-pdtp-demand-slas.mjs
COPY --from=build /tmp/reconcile-pdtp-fulfillment-events.cjs ./scripts/reconcile-pdtp-fulfillment-events.cjs
COPY --from=build /tmp/invoice-reconciliation/preflight-purchase-invoice-reconciliation.mjs ./scripts/preflight-purchase-invoice-reconciliation.mjs
COPY --from=build /tmp/invoice-reconciliation/backfill-purchase-invoice-reconciliation.mjs ./scripts/backfill-purchase-invoice-reconciliation.mjs
COPY --from=build /tmp/invoice-reconciliation/rollback-purchase-invoice-reconciliation-statuses.mjs ./scripts/rollback-purchase-invoice-reconciliation-statuses.mjs
COPY --from=build /tmp/backfill-dte-order-refs.mjs ./scripts/backfill-dte-order-refs.mjs
COPY --from=build /tmp/reparse-dte-order-refs.mjs ./scripts/reparse-dte-order-refs.mjs
COPY --from=build /tmp/migrate-sst-to-cloudreve.cjs ./scripts/migrate-sst-to-cloudreve.cjs
COPY --from=build /tmp/download-sst-documents.mjs ./scripts/download-sst-documents.mjs
COPY --from=build /tmp/upload-backup-cloudreve.cjs ./scripts/upload-backup-cloudreve.cjs
COPY --from=build /tmp/download-backup-cloudreve.cjs ./scripts/download-backup-cloudreve.cjs
COPY --from=build /tmp/fuel/backfill-fuel-meter-readings.mjs ./scripts/backfill-fuel-meter-readings.mjs
COPY --from=build /tmp/fuel/seed-fuel-anomaly-rules.mjs ./scripts/seed-fuel-anomaly-rules.mjs
COPY --from=build /tmp/preflight-fuel-integrations.mjs ./scripts/preflight-fuel-integrations.mjs
COPY --from=build /tmp/normalize-epp-skus.mjs ./scripts/normalize-epp-skus.mjs
COPY --from=build /tmp/reconcile-request-status.mjs ./scripts/reconcile-request-status.mjs
COPY --from=build /tmp/seed-size-catalog.mjs ./scripts/seed-size-catalog.mjs
COPY --from=build /tmp/reconcile-epp-duplicate-sizes.mjs ./scripts/reconcile-epp-duplicate-sizes.mjs
COPY --from=build /tmp/backfill-epp-clothing-sizes.mjs ./scripts/backfill-epp-clothing-sizes.mjs
# Cron service uses this bounded internal HTTP runner instead of an inline
# wget command. It is copied explicitly because Next standalone does not trace
# scripts invoked only by Compose.
COPY --from=build /app/scripts/cron-runner.mjs ./scripts/cron-runner.mjs

# Backup scripts (orquestador, verificación, storage, scheduler)
COPY scripts/backup-orchestrator.sh  ./scripts/backup-orchestrator.sh
COPY scripts/backup-pg.sh            ./scripts/backup-pg.sh
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
RUN mkdir -p /app/storage /app/.next/cache /data/storage /app/backups && \
    chown nextjs:nodejs /app/storage /data/storage /app/backups && \
    chown -R nextjs:nodejs /app/.next/cache

USER nextjs

EXPOSE 3000

# Audit DO-02: healthcheck against /api/health (also pings the DB).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
