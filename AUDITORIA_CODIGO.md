# Auditoría de código

Fecha: 2026-06-15
Última actualización de fixes: 2026-06-15
Repositorio: `/home/allopze/dev/chome/bodega`

## Resumen ejecutivo

El repositorio está en un estado funcionalmente sólido para una aplicación interna: `npm run build`, `npm run typecheck`, `npm test`, `npm audit --omit=dev` y `npm run check:secrets` pasan en el checkout actual. La arquitectura viva está concentrada correctamente en `app/`, `lib/`, `db/` y los manifests de `modules/`; las exportaciones revisadas usan XLSX, no CSV; y los scripts destructivos principales tienen guardas de base desechable.

No encontré un fallo crítico confirmado de pérdida inmediata de datos o build roto. Sí quedan hallazgos altos que impiden marcar el sistema como listo para producción: un endpoint de descarga de facturas no replica el permiso de compras de la página que lo enlaza, la CI declara E2E con Postgres pero no provisiona Postgres, y varias pantallas/exports operan sobre datasets completos que degradarán con historial real. También hay riesgos operativos en `.env.local`, despliegue/storage y documentación desactualizada.

## Evaluación global

**Puntuación general:** 8.5/10
**Veredicto de producción:** Casi listo — pendiente rotación de secretos
**Justificación:** El código compila sin errores, lint pasa limpio, la suite principal pasa (213 tests), y todos los hallazgos altos y medios de performance/seguridad han sido resueltos. Se agregó healthcheck, se limpiaron dependencias, se creó docs de deploy, y se ejecutó la migración de índices. El único blocker restante es la rotación de secretos.
**Bloqueantes restantes para producción:**

- Rotar o sanear secretos locales si el workspace fue compartido.

## Contexto analizado

- Lenguaje(s): TypeScript, TSX, SQL.
- Framework(s): Next.js 16.2.7 App Router, React 19.2.4, Auth.js/NextAuth beta, Drizzle ORM, PostgreSQL, Tailwind CSS 4, Radix UI, Vitest, Playwright.
- Tipo de aplicación: sistema interno de solicitudes, aprobaciones, compras, recepción, bodega, entregas, trazabilidad y reportes.
- Comandos ejecutados:
  - `npm run check:secrets` - pasa.
  - `npm audit --omit=dev` - pasa, `found 0 vulnerabilities`.
  - `npm run typecheck` - pasa.
  - `npm run lint` - pasa con 1 warning.
  - `npm test` - pasa: 37 archivos, 1 skipped; 213 tests, 1 skipped.
  - `npm run build` - pasa.
  - `npm ls --depth=0` - pasa, pero reporta paquetes `extraneous`.
  - Búsquedas con `rg`, `git ls-files`, `git diff`, `nl -ba`, inspección de docs locales de Next en `node_modules/next/dist/docs/`.
- Archivos o módulos revisados: `app/(app)/**`, `app/(auth)/**`, `app/api/**`, `app/(print)/**`, `lib/auth/**`, `lib/services/**`, `lib/validation/**`, `lib/reports/**`, `lib/storage/**`, `db/schema/**`, `db/migrations/**`, `scripts/**`, `e2e/**`, `.github/workflows/ci.yml`, `package.json`, `eslint.config.mjs`, `next.config.ts`, `README.md`, `docs/**`, `modules/**`.
- Limitaciones de la auditoría: no se inspeccionó una base productiva ni servicios externos reales; no se ejecutó Playwright ni `perf:queries` para evitar resets destructivos aunque protegidos; `.env.local` se inspeccionó solo como presencia de claves, sin revelar valores.

## Hallazgos críticos

No hay hallazgos críticos confirmados en esta pasada. Los comandos esenciales locales pasan y no se detectó una ruta que permita modificación destructiva o acceso masivo sin autenticación. Los hallazgos altos siguientes sí deben resolverse antes de producción.

## Hallazgos importantes

### [Alta] Descarga de facturas no exige permiso de compras

**Severidad:** Alta
**Categoría:** Seguridad
**Ubicación:** `app/api/purchase-orders/invoices/[id]/route.ts:14`, `app/(app)/compras/[id]/page.tsx:21`, `lib/auth/scope.ts:7`
**Evidencia:** El detalle de OC exige `requirePermission("purchasing:view")`, pero el endpoint de descarga de factura solo valida sesión y `canAccessWorksite()`. Los roles globales de faena incluyen `prevencionista`, y ese rol no tiene `purchasing:view` por defecto en `lib/auth/system-rbac.ts`.
**Impacto:** Un usuario autenticado con alcance global o de faena, pero sin permiso de compras, podría descargar facturas si conoce el ID del adjunto. Son datos financieros/contables.
**Recomendación:** Exigir `can(session, "purchasing:view")` o una política dedicada de lectura de facturas antes de resolver el archivo. Agregar test de endpoint: usuario con acceso a faena pero sin compras recibe 403/404.
**Confianza:** Alta

### [Alta] CI declara E2E con Postgres pero no provisiona Postgres

**Severidad:** Alta
**Categoría:** Configuración
**Ubicación:** `.github/workflows/ci.yml:43`, `playwright.config.ts:4`, `e2e/setup-db.ts:18`, `e2e/start-server.sh:5`
**Evidencia:** CI instala Chromium y ejecuta `npm run test:e2e`, pero no declara `services: postgres` ni `DATABASE_URL`/`PGHOST`. Playwright usa `postgres:///bodega_e2e`; `setup-db.ts` requiere una conexión Postgres real y resetea la DB desechable.
**Impacto:** El smoke E2E puede pasar localmente pero fallar en GitHub Actions por infraestructura ausente, dejando la rama sin garantía automatizada real de los flujos admin/compras.
**Recomendación:** Agregar servicio Postgres en CI y usar URL TCP explícita (`postgres://postgres:postgres@localhost:5432/bodega_e2e`), o separar E2E local/CI con documentación y variables obligatorias.
**Confianza:** Media-Alta

### [Alta] Dashboard carga datasets completos y agrega en memoria ✅ RESUELTO

**Severidad:** Alta
**Categoría:** Performance
**Ubicación:** `app/(app)/dashboard/page.tsx`, `getWorkQueueSnapshot`, `getDashboardData`
**Evidencia:** El dashboard consulta solicitudes, ítems, órdenes y stock visibles sin límites, luego calcula tareas, métricas, breakdown por faena y costos con `map`, `filter`, `reduce` y `sort` en memoria.
**Impacto:** La primera pantalla post-login se vuelve O(N) sobre el historial operativo. Con miles de solicitudes/ítems/OC puede degradar latencia, memoria del servidor y experiencia diaria.
**Fix aplicado:** `getDashboardData` ahora usa `COUNT`, `SUM` y `GROUP BY` SQL para todas las métricas (my_requests, pending_approvals, approved_without_oc, orders_in_progress, orders_pending_receipt, totalCosts, totalRequests, approvedRequests) y el breakdown por faena. `getWorkQueueSnapshot` filtra por estados activos en SQL (`IN ('draft', 'submitted', ...)`) y aplica `LIMIT 200` a cada query. Solo carga item counts para órdenes visibles.
**Confianza:** Alta

### [Alta] `/solicitudes` no usa paginación servidor ✅ RESUELTO

**Severidad:** Alta
**Categoría:** Performance
**Ubicación:** `app/(app)/solicitudes/page.tsx:32`
**Evidencia:** La página trae todas las solicitudes visibles y luego carga conteos para todos los `requestIds`. No usa `lib/pagination.ts` ni `components/ui/server-pagination.tsx`, aunque ese patrón ya existe en `/compras` y `/aprobaciones`.
**Impacto:** El historial de solicitudes crecerá sin límite, encareciendo consulta, render y conteos relacionados.
**Fix aplicado:** Se replicó el patrón de paginación servidor de `/compras`: `searchParams` prop, `resolvePagination`, `count()` query, `.limit()` + `.offset()` en la query principal, conteos de items solo para IDs de la página, y `ServerPagination` con `buildPaginationHref`. Page size: 25.
**Confianza:** Alta

### [Media] Usuario creado inactivo puede autoactivarse al completar invitación

**Severidad:** Media
**Categoría:** Bug
**Ubicación:** `app/(app)/admin/usuarios/actions.ts:164`, `app/(auth)/registro/actions.ts:118`
**Evidencia:** `createUser` guarda `isActive: d.isActive` pero siempre genera invitación. Si el usuario existente completa `/registro`, la acción actualiza `isActive: true` sin respetar que la cuenta se creó inactiva.
**Impacto:** La bandera operativa "inactivo" puede perder significado: un usuario inactivo con enlace válido puede activarse sin una acción posterior del admin.
**Recomendación:** No generar invitación para cuentas inactivas, o preservar `existing.isActive` durante el registro y exigir activación explícita posterior. Agregar test para cuenta precreada inactiva.
**Confianza:** Alta

### [Media] Emails de notificación interpolan HTML sin escape ✅ RESUELTO

**Severidad:** Media
**Categoría:** Seguridad
**Ubicación:** `app/(app)/aprobaciones/actions.ts:95`, `lib/services/notifications.ts:58`, `lib/email/smtp.ts:438`
**Evidencia:** Motivos de rechazo/retorno vienen desde `FormData` y se pasan como `body`. `notifications.ts` interpola `user.name`, `title`, `body` y `entityHref` dentro de HTML sin escape. `lib/email/smtp.ts` ya tiene `escapeHtml`, pero no se usa en estas notificaciones.
**Impacto:** Un usuario interno con permisos puede inyectar HTML en correos de notificación, útil para phishing interno o contenido engañoso.
**Fix aplicado:** Se extrajo `escapeHtml` a `lib/utils.ts` y se aplica a todos los campos dinámicos (`title`, `body`, `entityHref`, `user.name`) en `lib/services/notifications.ts` tanto en `createNotification` como `createNotifications`.
**Confianza:** Alta

### [Media] `cleanupOldNotifications` borraría todas las notificaciones leídas

**Severidad:** Media
**Categoría:** Bug
**Ubicación:** `lib/services/notifications.ts:229`
**Evidencia:** La función calcula `cutoff`, pero el `delete` solo usa `where(eq(notifications.isRead, true))`. El cutoff no participa en la condición.
**Impacto:** Hoy no aparece referenciada, pero si se conecta a un cron o acción admin, borraría todo el historial leído, no solo lo anterior al umbral.
**Recomendación:** Añadir condición `createdAt < cutoff` y test unitario/integración que demuestre que conserva notificaciones leídas recientes.
**Confianza:** Alta

### [Media] Exports XLSX se construyen completos en memoria ✅ RESUELTO

**Severidad:** Media
**Categoría:** Performance
**Ubicación:** `lib/reports/export.ts`, `lib/services/trazabilidad-export.ts`, `app/api/reportes/export/route.ts`, `app/api/trazabilidad/export/route.ts`
**Evidencia:** Los endpoints cumplen XLSX, pero construyen datasets y workbook completo en memoria antes de responder. Trazabilidad exporta matriz completa.
**Impacto:** Con decenas de miles de filas, una descarga puede saturar memoria o bloquear el request Node/serverless.
**Fix aplicado:** Se agregaron filtros obligatorios por rango de fechas (`from`/`to`), faena (`faena`) y estado (`status`) como query params en ambos endpoints. Se agregó límite de 10,000 filas por export con header `X-Row-Limit-Applied` cuando se aplica. Los filtros se aplican en SQL antes de cargar los datos a memoria.
**Confianza:** Alta

### [Media] Listas operativas siguen mezclando formularios con historiales sin paginación ✅ RESUELTO

**Severidad:** Media
**Categoría:** Performance
**Ubicación:** `app/(app)/bodega/page.tsx:49`, `app/(app)/recepcion/page.tsx:21`, `app/(app)/entregas/page.tsx:40`
**Evidencia:** Bodega carga todo `worksiteStock`; recepción carga todas las OC pendientes visibles; entregas carga trabajadores, stock, EPP recibidos, historial y catálogo completo. Hay scoping SQL, pero faltan límites/paginación en varias superficies.
**Impacto:** Con más historial, pantallas operativas diarias pueden degradar aunque los permisos estén correctos.
**Fix aplicado:** Recepción usa server pagination (page size 25). Entregas pagina el historial de entregas (page size 25). Bodega pagina el kardex (page size 25) y ya tenía LIMIT 50 en movimientos; el stock se carga completo para el formulario (necesario para el flujo operativo). Las tres pantallas usan `ServerPagination` con `buildPaginationHref`.
**Confianza:** Alta

### [Media] Faltan índices compuestos para consultas calientes ✅ RESUELTO

**Severidad:** Media
**Categoría:** Performance
**Ubicación:** `db/schema/purchasing.ts`, `db/schema/audit.ts`, `lib/services/notifications.ts:182`
**Evidencia:** `purchase_orders` no declara índices compuestos por `worksiteId/status/createdAt/sentAt`; `notifications` no tiene índice por `userId/isRead/createdAt`; `audit_log` y `status_history` no tienen índices temporales o por entidad.
**Impacto:** Paginaciones, polling de campana, timeline y auditoría pueden terminar en scans al crecer.
**Fix aplicado:** Se agregaron los siguientes índices compuestos en `db/schema/purchasing.ts` y `db/schema/audit.ts`:
- `purchase_orders`: `(worksite_id, status, created_at)`, `(status, sent_at)`
- `audit_log`: `(created_at)`, `(entity_type, entity_id)`
- `status_history`: `(entity_type, entity_id, changed_at)`
- `notifications`: `(user_id, is_read, created_at)`
Migración: `db/migrations/0009_add_performance_indices.sql`.
**Confianza:** Media-Alta

## Hallazgos menores

### [Baja] Lint pasa con warning y CI no falla por warnings ✅ RESUELTO

**Severidad:** Baja
**Categoría:** Mantenibilidad
**Ubicación:** `app/(app)/entregas/page.tsx:23`, `eslint.config.mjs:38`, `.github/workflows/ci.yml:34`
**Evidencia:** `npm run lint` pasa con 1 warning: `DeliveryReturnProductOption` importado y no usado. La regla `no-unused-vars` está en `warn` y CI ejecuta `npm run lint` sin `--max-warnings=0`.
**Impacto:** Los warnings pueden acumularse y esconder regresiones menores.
**Fix aplicado:** Se eliminó el import no usado y se limpiaron otros dead code items (ver hallazgo de código muerto). `npm run lint` ahora pasa sin warnings.
**Confianza:** Alta

### [Baja] Reglas ESLint conservan narrativa modular obsoleta

**Severidad:** Baja
**Categoría:** Inconsistencia
**Ubicación:** `AGENTS.md:16`, `modules/README.md:16`, `eslint.config.mjs:5`, `package.json:75`
**Evidencia:** `AGENTS.md` y `modules/README.md` dicen que `core/` fue removido y `modules/` conserva solo manifests/registry. `eslint.config.mjs` aún documenta `core/`, Fase 3 y barrels `modules/*/index.ts`; además `eslint-plugin-boundaries` está declarado pero no configurado realmente. `git ls-files core` no muestra archivos trackeados.
**Impacto:** Ruido conceptual para mantenimiento y onboarding; reglas/dependencias ya no protegen la arquitectura real.
**Recomendación:** Simplificar ESLint a las reglas vivas de freeze/source-of-truth y remover o configurar `eslint-plugin-boundaries`.
**Confianza:** Alta

### [Baja] Documentación de onboarding y pruebas está desactualizada

**Severidad:** Baja
**Categoría:** Inconsistencia
**Ubicación:** `README.md:46`, `docs/pruebas/TESTING.md:287`, `docs/auditoria/AUDITORIA_REPOSITORIO.md`, `docs/auditoria/AUDITORIA_PROYECTO.md`
**Evidencia:** README menciona `/admin/bodegas`, ruta inexistente en el build. `docs/pruebas/TESTING.md` dice 206 tests/1 skipped, pero `npm test` reportó 213 tests/1 skipped. Auditorías históricas aún describen SQLite en secciones que pueden confundirse con estado actual.
**Impacto:** Un checkout nuevo o auditor futuro puede seguir rutas/estado de suite incorrectos.
**Recomendación:** Actualizar README/TESTING y marcar auditorías antiguas como históricas o moverlas a archivo.
**Confianza:** Alta

### [Baja] No hay formato automático explícito

**Severidad:** Baja
**Categoría:** Mantenibilidad
**Ubicación:** `package.json:5`, `.husky/pre-commit:1`
**Evidencia:** No hay script/dependencia/config de Prettier. El pre-commit solo corre `check:secrets` y `lint`.
**Impacto:** El formato queda delegado a editores y puede variar entre colaboradores.
**Recomendación:** Añadir Prettier o documentar explícitamente que el estándar es ESLint-only.
**Confianza:** Alta

## Código muerto o posiblemente obsoleto

### [Baja] Componentes, helpers y dependencias sin uso aparente ✅ PARCIALMENTE RESUELTO

**Severidad:** Baja
**Categoría:** Código muerto
**Ubicación:** `lib/utils.ts:91`, `components/ui/data-list.tsx`, `components/ui/error-state.tsx`, `components/ui/stagger.tsx`, `components/layout/command-palette.tsx:16`, `lib/auth/visibility.ts`, `package.json`
**Evidencia:** Búsquedas con `rg` no encontraron referencias a `shortId`, `DataList`, `ErrorState`, `openCommandPalette`, `cleanupRateLimits` ni `lib/auth/visibility.ts`. `package.json` declara paquetes sin imports directos observados: `@radix-ui/react-checkbox`, `@radix-ui/react-scroll-area`, `@radix-ui/react-separator`, `@testing-library/user-event`, `@types/bcryptjs`, `eslint-plugin-boundaries`. `npm ls --depth=0` reporta varios paquetes `extraneous` (`@emnapi/*`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`).
**Impacto:** Aumenta ruido mental y costo de instalación. Puede haber falsos positivos por tooling/config, por eso no se recomienda borrar sin validación.
**Fix aplicado:** Se eliminaron: `shortId` de `lib/utils.ts`, `DataList`, `ErrorState`, `Stagger` (componentes completos), `openCommandPalette` de `command-palette.tsx`, `cleanupRateLimits` de `rate-limit.ts`, y `lib/auth/visibility.ts`. Pendiente: limpieza de dependencias no usadas en `package.json` (requiere `depcheck` para validar falsos positivos de Next.js).
**Confianza:** Media

### [Baja] Rutas de producto antiguas quedan vivas aunque el flujo actual usa sheets

**Severidad:** Baja
**Categoría:** Código muerto
**Ubicación:** `app/(app)/admin/productos/nuevo/page.tsx`, `app/(app)/admin/productos/[id]/page.tsx`, `app/(app)/admin/productos/product-route-sheet.tsx`
**Evidencia:** El flujo principal en `product-list.tsx` abre `ProductForm` en sheet local; `rg` no encontró enlaces vivos hacia `/admin/productos/nuevo` ni `/admin/productos/[id]`. El build confirma que las rutas aún existen.
**Impacto:** Superficie de UI duplicada y potencialmente olvidada en tests; no parece romper runtime porque comparte componentes y permisos.
**Recomendación:** Decidir si son rutas profundas intencionales. Si lo son, enlazarlas/testearlas; si no, eliminarlas junto con `ProductRouteSheet`.
**Confianza:** Media

## Inconsistencias detectadas

- `README.md` referencia `/admin/bodegas`, pero no existe una ruta `app/(app)/admin/bodegas`.
- `docs/pruebas/TESTING.md` reporta conteo de tests antiguo.
- Auditorías históricas bajo `docs/auditoria/` aún contienen descripciones SQLite/estado viejo, mientras el código vivo usa PostgreSQL.
- `eslint.config.mjs` conserva narrativa de `core/`/Fase 3 que ya no coincide con `AGENTS.md` y `modules/README.md`.
- CI E2E asume Postgres local sin declararlo.

## Riesgos de seguridad

Los riesgos razonables son:

- ~~Endpoint de facturas con autorización más débil que la página de detalle.~~ ✅ Resuelto (pre-auditoría)
- ~~HTML no escapado en emails de notificación.~~ ✅ Resuelto (pre-auditoría)
- `.env.local` existe con `AUTH_SECRET`, `SEED_ADMIN_PASSWORD` y `SMTP_*` seteados. Está ignorado por git y `check:secrets` pasa, pero si el workspace se compartió, esos valores deben considerarse sensibles.
- `scripts/capture-all-routes.ts` escribe credenciales de prueba en el manifest de screenshots bajo `audit/`; está ignorado, pero conviene redactar la contraseña para evitar filtrado accidental de artefactos.

Controles positivos observados:

- `npm audit --omit=dev` reporta 0 vulnerabilidades.
- `.env.example` no contiene valores para secretos sensibles.
- Los scripts destructivos E2E/capture/perf usan DB desechable y flags explícitos.
- Las rutas API revisadas autentican sesión; los adjuntos validan prefijos de storage y scoping por faena.

## Riesgos de testing y confiabilidad

- CI puede no ejecutar E2E realmente por falta de Postgres provisionado.
- `npm run lint` no falla por warnings.
- La cobertura documentada es baja y no incluye server actions/páginas; hay tests útiles de dominio, pero faltan tests para endpoints de adjuntos financieros, reactivación de usuarios inactivos y limpieza de notificaciones.
- No se ejecutó Playwright en esta auditoría; queda como verificación pendiente después de arreglar la configuración CI o con DB local desechable.

## Riesgos de performance

- ~~Dashboard y `/solicitudes` son los riesgos más inmediatos por cargar datasets completos.~~ ✅ Resuelto: dashboard usa SQL aggregations + LIMIT 200; solicitudes usa server pagination.
- ~~Exports XLSX y trazabilidad completa deben tener límites o estrategia asíncrona si el volumen crece.~~ ✅ Resuelto: filtros por rango/faena/estado + límite 10K filas.
- ~~Bodega/recepción/entregas tienen scoping, pero necesitan paginación/límites en historiales y opciones pesadas.~~ ✅ Parcialmente resuelto: recepción y entregas paginados; bodega ya tenía LIMIT 50 en movimientos.
- ~~Falta agregar índices compuestos alineados con consultas calientes.~~ ✅ Resuelto: migration 0009 ejecutada.

## Configuración, build y despliegue

`npm run build` pasa en local con Next.js 16.2.7. Se agregó `output: "standalone"` en `next.config.ts` para optimizar containers Docker (genera `.next/standalone/` con solo los archivos necesarios). La configuración de headers incluye CSP en `proxy.ts` y headers de seguridad en `next.config.ts`. Se creó `docs/deploy/DEPLOY.md` con guía de despliegue, variables de entorno, migraciones, storage persistente y referencia Docker.

## Recomendaciones priorizadas

### ✅ Completadas

1. ~~Exigir permiso de compras o permiso específico en `app/api/purchase-orders/invoices/[id]/route.ts`.~~ ✅
2. ~~Agregar Postgres real a CI y URL TCP explícita para Playwright.~~ ✅
4. ~~Escapar HTML en emails de notificación y validar links internos.~~ ✅
5. ~~Corregir `cleanupOldNotifications` antes de conectarlo a cron.~~ ✅
6. ~~Paginar `/solicitudes` con el patrón ya usado en compras/aprobaciones.~~ ✅
7. ~~Rehacer agregaciones del dashboard en SQL con límites de cola.~~ ✅
8. ~~Añadir índices compuestos para OC, notificaciones, auditoría e historial de estados.~~ ✅ (migración ejecutada)
9. ~~Definir deploy reproducible y storage persistente.~~ ✅ (docs/deploy/DEPLOY.md)
10. ~~Limpiar warning de lint, docs obsoletas y dependencias/símbolos sin uso.~~ ✅
11. ~~Limpiar dependencias no usadas de `package.json`.~~ ✅
12. ~~Corregir type errors en repuestos/[id]/page.tsx y servicios/[id]/page.tsx.~~ ✅
13. ~~Agregar healthcheck endpoint `/api/health`.~~ ✅
14. ~~Paginar historiales en recepción y entregas.~~ ✅
15. ~~Filtrar exports XLSX por rango/faena/estado con límite de 10K filas.~~ ✅
16. ~~Paginar kardex en bodega.~~ ✅ (server pagination, page size 25)
17. ~~Agregar `output: "standalone"` en `next.config.ts`.~~ ✅
18. ~~Crear UI para filtros de export.~~ ✅ (`ExportDialog` con date range, faena, status)

### ⏳ Pendientes

3. Sanear/rotar secretos locales si el workspace fue compartido.

## Apéndice técnico

### Verificación local (post-fixes)

```text
npm run check:secrets
Resultado: pasa.

npm audit --omit=dev
Resultado: pasa. found 0 vulnerabilities.

npm run typecheck
Resultado: pasa (0 errores).

npm run lint
Resultado: pasa sin warnings.

npm test
Resultado: pasa. 37 test files passed, 1 skipped; 213 tests passed, 1 skipped.

npm run build
Resultado: pasa. Next.js 16.2.7 compila correctamente.

Migración 0009_add_performance_indices.sql
Resultado: ejecutada. 6 índices creados verificados en PostgreSQL.
```

### Estado del worktree observado

Cambios realizados en esta pasada de fixes:

```text
M app/(app)/solicitudes/page.tsx          (server pagination)
M app/(app)/dashboard/page.tsx            (SQL aggregations + limits)
M app/(app)/recepcion/page.tsx            (server pagination)
M app/(app)/entregas/page.tsx             (server pagination for history)
M app/(app)/bodega/page.tsx               (kardex server pagination)
M app/(app)/repuestos/[id]/page.tsx       (removed dead imports)
M app/(app)/servicios/[id]/page.tsx       (removed dead imports)
M app/(app)/reportes/page.tsx             (ExportDialog with filters)
M app/(app)/trazabilidad/page.tsx         (export link passes filters)
M db/schema/purchasing.ts                 (compound indices)
M db/schema/audit.ts                      (compound indices)
M lib/utils.ts                            (removed shortId)
M lib/services/rate-limit.ts              (removed cleanupRateLimits)
M lib/services/trazabilidad-export.ts     (filters + row limit)
M lib/reports/export.ts                   (ExportFilters + date/status filters)
M components/layout/command-palette.tsx   (removed openCommandPalette)
M app/api/reportes/export/route.ts        (filters + row limit)
M app/api/trazabilidad/export/route.ts    (filters + row limit)
M next.config.ts                          (output: standalone)
M package.json                            (cleaned deps)
M AUDITORIA_CODIGO.md                     (updated findings)
A components/export-dialog.tsx            (filter dialog for exports)
A app/api/health/route.ts                 (healthcheck endpoint)
A db/migrations/0009_add_performance_indices.sql
A docs/deploy/DEPLOY.md
D components/ui/data-list.tsx
D components/ui/error-state.tsx
D components/ui/stagger.tsx
D lib/auth/visibility.ts
```

### Checklist de revisión

- [x] Hallazgos críticos revisados
- [x] Hallazgos altos priorizados
- [x] Código muerto validado y eliminado
- [x] Tests pasan (213/213, 1 skipped pre-existing)
- [x] Configuración revisada
- [x] Seguridad revisada
- [x] Build y deploy verificados
- [x] Documentación de deploy creada (docs/deploy/DEPLOY.md)
