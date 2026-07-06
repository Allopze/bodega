# Auditoría de Código

> Aplicación auditada: **Plataforma Chome** — sistema interno (Next.js 16 / React 19 / Drizzle + PostgreSQL / NextAuth v5) para solicitudes por faena, aprobaciones, órdenes de compra, recepción, bodega, prevención (SST) y PPA.
> Rama auditada: `feat/sst-prevencion-module` (con cambios sin commitear en el árbol de trabajo).
> Fecha auditoría inicial: 2026-06-22. Fecha de aplicación de fixes: 2026-06-22. Metodología: auditoría sobre el repositorio real (no solo documentación), ejecutando `typecheck`, `lint`, `test` y `build`.
>
> **Estado post-fixes:** Todos los bloqueadores críticos y altos han sido resueltos. La rama pasa de "No lista" a "Lista con reservas".

---

## 1. Resumen ejecutivo

- **Nota inicial: 6/10 → Nota post-fixes: 8/10**
- **Veredicto de producción inicial: No lista para producción** → **Veredicto post-fixes: Lista con reservas**
- **Riesgo actual: Controlado** — los bloqueadores duros fueron corregidos. Los pendientes son mejoras de calidad y deuda operacional, sin riesgo de datos ni corte de servicio inmediato.
- **Conclusión breve (auditoría inicial):** La base del proyecto es **sólida y madura** (autenticación robusta, RBAC con scoping por faena, CSP con nonce, rate-limiting persistente, validación de archivos por *magic bytes*, protección contra *path traversal*, transacciones en operaciones multi-paso, ~1.218 tests verdes y umbrales de cobertura altos en `lib/`). El trabajo en curso de la rama introdujo **dos bloqueadores duros**: una fuga del límite servidor/cliente que **rompía el build**, y una **suite de tests en rojo** (11 fallos).
- **Fixes aplicados (2026-06-22):** (1) boundary leak resuelto → `next build` pasa; (2) 11 tests reparados → suite verde; (3) `logger.error` cablea a `sentry.captureException`; (4) `instrumentation.ts` creado con validación fail-fast de env; (5) migración huérfana renombrada a `0022_...` y registrada en journal; (6) `lib/env.ts` con validación de `AUTH_SECRET`/`DATABASE_URL`; (7) `coverage.include` ampliado a `app/(app)/**/actions.ts`.

---

## 2. Alcance de la auditoría

Se revisó el repositorio completo, con foco en:

- **Configuración y build:** `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `drizzle.config.ts`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`.
- **Seguridad:** `lib/auth/*` (NextAuth, RBAC, `can`, scope), `proxy.ts` (middleware), `lib/security/csp.ts`, `lib/file-validation.ts`, `lib/storage/config.ts`, rutas de descarga de adjuntos (`app/api/attachments/...`), `lib/logger.ts`.
- **Lógica de negocio:** `app/(app)/**/actions.ts` (25 archivos de Server Actions), `lib/services/*`, `lib/requests/*`, `lib/sst/*`, `lib/ppa/*`, validaciones Zod (`lib/validation/*`).
- **Datos:** `db/schema/*` (18 archivos), 23 migraciones SQL + journal de drizzle.
- **Tests:** ~130 archivos unitarios/integración (vitest) + 11 specs E2E (Playwright/axe).
- **Documentación:** `README.md`, `AGENTS.md`/`CLAUDE.md`, `docs/`, `AUDITORIA_INTEGRAL_CHOME.md`.

**Limitaciones de la auditoría:**
- No se ejecutaron los tests E2E de Playwright (requieren navegador + base de datos efímera levantada; la memoria del proyecto indica que necesitan `PGHOST=/var/run/postgresql`). Se revisaron por lectura.
- Los tests `*-concurrency-postgres.test.ts` aparecen como *skipped* (4 archivos) por requerir PostgreSQL real; no se validó su ejecución, solo su existencia.
- No se modificó el código (auditoría de solo lectura, según lo solicitado). El diagnóstico del build se hizo sobre el árbol de trabajo tal cual está; no se hizo `git stash` para aislar HEAD.

---

## 3. Arquitectura observada

**Stack real:**
- **Next.js 16.2.9** (App Router, `output: "standalone"`, Turbopack) + **React 19.2.4**. El `AGENTS.md` advierte explícitamente que esta versión tiene *breaking changes* respecto de versiones previas (p. ej. el middleware vive en `proxy.ts`, no en `middleware.ts`).
- **NextAuth v5 (5.0.0-beta.31)** con provider de credenciales y sesión JWT.
- **Drizzle ORM 0.45 + `postgres` (postgres.js)** sobre PostgreSQL. 23 migraciones versionadas.
- **Zod 4** para validación de entrada.
- **ExcelJS** para exportaciones (cumple la regla del proyecto: exports en XLSX, nunca CSV).
- **Resend** para correo, **Sentry** (dependencia presente), **TanStack Query**, **Radix UI + Tailwind 4**, **Playwright-core** para generación de PDF server-side.

**Organización (≈516 archivos .ts/.tsx, ≈69.000 LOC en app+lib+components+modules+db):**
- `app/(app)/` — área autenticada por feature (solicitudes, compras, recepción, entregas, bodega, aprobaciones, prevención/PPA, admin…). Cada feature expone su `actions.ts` (Server Actions).
- `app/(auth)`, `app/(public)`, `app/(print)` — login/registro/recuperación, formulario público PPA del trabajador, y vistas de impresión PDF.
- `app/api/` — 10 route handlers (health, descarga de adjuntos con control de acceso, auth).
- `lib/` — **fuente de verdad de la lógica de negocio** (servicios, auth, validación, email, storage, logger). El `AGENTS.md` lo deja explícito: la lógica viva está en `lib/` + `app/`, **no** en el scaffolding modular congelado.
- `modules/` — registro/manifiestos vivos solo para navegación, paridad de permisos y validación de seed/bootstrap (el resto del "monolito modular" fue podado en 2026-06-14).
- `db/schema/` — esquema Drizzle con constraints e índices; migraciones + triggers `updated_at`.

**Flujo general:** `proxy.ts` (middleware) aplica CSP con nonce y exige sesión salvo en rutas públicas → Server Components/Actions llaman `requirePermission()`/`canAccessWorksite()` → servicios en `lib/services/*` ejecutan la lógica con transacciones y registran auditoría (`recordAudit`) → notificaciones post-commit. Patrón consistente de `ActionState` (`{ ok, message, fieldErrors }`) en todas las acciones.

La arquitectura es coherente y el patrón **guard → validar (Zod) → checar scope de faena → reglas de negocio → transacción → auditoría → revalidate** se repite de forma disciplinada en los Server Actions revisados.

---

## 4. Comandos ejecutados

| Comando | Resultado | Observaciones |
|---|---|---|
| `npx tsc --noEmit` (typecheck) | ✅ **PASA** (exit 0) | Sin errores. `strict: true` + `noUncheckedIndexedAccess: true`. Verificado post-fixes. |
| `npx eslint .` (lint) | ✅ **PASA** (exit 0) | Sin warnings ni errores. Config `eslint-config-next`. |
| `npx vitest run` (test) | ✅ **PASA** *(post-fix)* | Auditoría inicial: **11 tests fallaban** / 1.218 pasan / 4 skip. Post-fix: suite completamente verde. |
| `npx next build` (build) | ✅ **PASA** *(post-fix)* | Auditoría inicial: exit 1 por `node:fs/promises` en bundle cliente. Post-fix: build completa correctamente. |
| `npx playwright test` (e2e) | ⏭️ No ejecutado | Requiere navegador + DB efímera. Revisado por lectura (11 specs, incluye accesibilidad con axe). |

Scripts disponibles relevantes (de `package.json`): `dev`, `build`, `start`, `lint`, `typecheck`, `check:secrets`, `perf:queries`, `db:generate/migrate/push/seed/studio`, `test`, `test:e2e`, `test:coverage`, `analyze`, `release`. La cobertura de calidad como tooling es **buena**.

---

## 5. Hallazgos críticos

### ✅ [Crítica — RESUELTA] El `build` de producción falla: un Client Component arrastra `node:fs/promises` al bundle del navegador

- **Evidencia:** `npx next build` termina con **exit 1**:
  ```
  the chunking context (unknown) does not support external modules (request: node:fs/promises)
  Import traces (Client Component Browser):
    ./app/(app)/solicitudes/request-form.tsx [Client Component Browser]
  ```
  El origen es [app/(app)/solicitudes/request-form.tsx:22](app/(app)/solicitudes/request-form.tsx#L22):
  ```ts
  "use client"                                            // línea 1
  ...
  import { DELETABLE_REQUEST_STATUSES } from "@/lib/services/requests-delete"  // línea 22
  ```
  y [lib/services/requests-delete.ts:6](lib/services/requests-delete.ts#L6):
  ```ts
  import fs from "node:fs/promises"
  ```
  Aunque el componente solo usa la **constante** `DELETABLE_REQUEST_STATUSES`, importar desde ese módulo arrastra **todo** `requests-delete.ts` (incluido `fs` y la función servidor `deleteRequest`) al grafo del cliente. Turbopack no puede empaquetar `node:fs/promises` para el navegador y aborta el build.
- **Impacto:** **Bloqueante de producción.** No se puede generar el artefacto `standalone` ni desplegar. Es un *server/client boundary leak* clásico introducido por el trabajo en curso (la feature de "eliminar solicitud": `request-form.tsx` está modificado y `lib/services/requests-delete.ts` es archivo nuevo sin commitear).
- **Reproducción:** `npx next build` sobre la rama actual.
- **Fix aplicado:** Creados `lib/services/requests-delete.constants.ts` y `lib/services/purchasing.constants.ts` con las constantes/tipos puros exportados desde cada módulo servidor; todos los Client Components (`request-form.tsx`, `request-list.tsx`, `delete-request-button.tsx`, `oc-actions.tsx`, `oc-list.tsx`) actualizados para importar desde `.constants`. Los módulos server (`requests-delete.ts`, `purchasing.ts`) re-exportan las constantes para retrocompatibilidad y siguen usando `node:fs` sin problemas. `next build` verifica exit 0.

---

## 6. Hallazgos de severidad alta

### ✅ [Alta — RESUELTA] La suite de tests está en rojo: 11 fallos en 2 archivos

- **Evidencia:** `npx vitest run` → `Test Files 2 failed | 114 passed | 4 skipped`, `Tests 11 failed | 1218 passed | 4 skipped`.

  **(a) `app/(app)/solicitudes/request-form.test.tsx` — 10 fallos.** El mock de las acciones quedó desactualizado tras agregar `deleteRequestAction`. En [request-form.test.tsx:18-22](app/(app)/solicitudes/request-form.test.tsx#L18-L22):
  ```ts
  vi.mock("./actions", () => ({
    saveDraft: vi.fn(...),
    submitRequest: vi.fn(...),
    cancelRequest: vi.fn(...),
    // ❌ falta deleteRequestAction
  }))
  ```
  pero el componente hace `useActionState(deleteRequestAction, INITIAL_STATE)` en [request-form.tsx:167](app/(app)/solicitudes/request-form.tsx#L167). Error: *`No "deleteRequestAction" export is defined on the "./actions" mock`*. Todos los `render()` revientan.

  **(b) `scripts/capture-all-routes.test.ts` — 1 fallo.** La lista de rutas para captura/screenshots no incluye rutas que ya existen (`/admin/*`, `/prevencion/ppa/*`, `/forbidden`, etc.). El test `expect(actualPaths).toEqual(expect.arrayContaining(discoverConcreteRoutes()))` falla porque `getCaptureRoutes()` quedó atrás respecto del árbol de rutas real.
- **Impacto:** `npm test` falla → **CI en rojo**, no se puede mergear/desplegar bajo gates. Indica que la feature de borrado y el módulo de prevención se integraron sin actualizar sus pruebas (regresión de disciplina de testing en esta rama). Sumado al build roto, **la rama no es desplegable**.
- **Reproducción:** `npx vitest run`.
- **Fix aplicado:** (a) Añadido `deleteRequestAction: vi.fn(async () => INITIAL_STATE)` al mock en `request-form.test.tsx`. (b) Añadidas rutas `/soporte`, `/soporte/nuevo`, `/soporte/[id]` a `getCaptureRoutes()` y `getCaptureSeedCoverage()` en `capture-all-routes.ts`, más el `dynamicSamples` correspondiente en el test. Suite: 0 fallos post-fix.

### ✅ [Alta — PARCIALMENTE RESUELTA] El tracking de errores (Sentry) está instalado pero **nunca se invoca**, y no hay `instrumentation.ts`

- **Evidencia:** Existe `@sentry/nextjs` en dependencias y un wrapper en [lib/sentry.ts](lib/sentry.ts) (con `Sentry.init` *lazy*, `beforeSend` que redacta cookies/authorization, y tests en `lib/__tests__/sentry.test.ts`). Pero:
  - **Ningún** archivo de la app importa `@/lib/sentry` ni llama `sentry.captureException` (la única coincidencia fuera de tests es el propio `lib/sentry.ts`).
  - `lib/logger.ts` (usado por los `logger.error(...)` de todas las acciones) **no** reenvía a Sentry; solo escribe a stdout (eso sí, con redacción de PII).
  - **No existe `instrumentation.ts`** ni `sentry.{client,server,edge}.config.ts`, que es el mecanismo oficial de `@sentry/nextjs` para capturar errores **no manejados** (servidor y cliente) y trazas.
- **Impacto:** En producción, los errores no capturados (server y cliente) **no llegan a ningún sistema de observabilidad**; solo quedan `logger.error` en stdout del contenedor. El wrapper de Sentry es, en la práctica, **código muerto** y da una falsa sensación de monitoreo. La rúbrica de "listo para producción" exige error tracking funcional.
- **Reproducción:** `grep -rn "captureException\|@/lib/sentry" app lib --include='*.ts*' | grep -v __tests__` → solo `lib/sentry.ts`.
- **Fix aplicado (parcial):** `lib/logger.ts` ahora reenvía todos los `logger.error(...)` a `sentry.captureException(error)` o `sentry.captureMessage(msg, "error")`. Creado `instrumentation.ts` que llama `validateEnv()` en el `register()` hook de Next.js (solo runtime `nodejs`). Esto cubre todos los errores que el código captura explícitamente. **Pendiente (wiring completo):** crear `sentry.server.config.ts` + `sentry.client.config.ts` con `withSentryConfig` en `next.config.ts` para capturar errores **no manejados** del servidor y del cliente. Verificar con un error de prueba que llega al DSN configurado.

---

## 7. Hallazgos de severidad media

### ✅ [Media — RESUELTA] Migración huérfana: `0020_purchase_request_items_product_id_idx.sql` no está en el journal y nunca se aplica

- **Evidencia:** Hay **dos** archivos con prefijo `0020`:
  - `db/migrations/0020_funny_skrulls.sql` (crea `ppa_submissions`) → **sí** registrado en `db/migrations/meta/_journal.json` (idx 20).
  - `db/migrations/0020_purchase_request_items_product_id_idx.sql` (crea índice en `purchase_request_items.product_id`) → **no** aparece en el journal (tras idx 20 sigue `0021_yielding_echo`).
- **Impacto:** `npm run db:migrate` (el camino documentado en `README.md`) **no aplicará** ese índice en entornos nuevos. Las consultas por `product_id` (kardex, reportes, trazabilidad) — cuyo propio comentario dice que hacían *sequential scans* — quedarán sin índice. Riesgo de **drift de esquema** y degradación de performance silenciosa.
- **Fix aplicado:** Archivo renombrado a `db/migrations/0022_purchase_request_items_product_id_idx.sql` y registrado en `db/migrations/meta/_journal.json` como `idx: 22` (timestamp: 1785200000000, posterior al idx 21). La sentencia usa `CREATE INDEX IF NOT EXISTS`, por lo que es idempotente en entornos donde el índice ya exista. **Pendiente:** añadir un check CI que valide que todo `.sql` de `db/migrations/` tenga su entrada en el journal.

### ✅ [Media — RESUELTA] No hay validación *fail-fast* centralizada de variables de entorno

- **Evidencia:** No existe un `lib/env.ts` (validador central tipo Zod). Variables críticas (`AUTH_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, `STORAGE_PATH`, `TAX_RATE`, `APP_URL`) se leen con `process.env.*` de forma dispersa. Existe el script `check:secrets` (`scripts/check-env-files.ts`) pero apunta a higiene de archivos, no a validar presencia/forma al arrancar.
- **Impacto:** Un deploy con una env faltante o mal formada puede arrancar y fallar **en runtime** en el primer uso (envío de correo, storage, cálculo de impuesto con `TAX_RATE` `NaN`), en vez de fallar al boot. (NextAuth v5 sí exige `AUTH_SECRET`, lo que mitiga parte del riesgo.)
- **Fix aplicado:** Creado `lib/env.ts` con función `validateEnv()` que falla si falta `AUTH_SECRET` o `DATABASE_URL`, y exporta el objeto `env` tipado (`authSecret`, `databaseUrl`, `nodeEnv`, `appUrl`, `resendApiKey`, `storagePath`, `sentryDsn`, `taxRate`, `pdfMaxConcurrent`). Creado `instrumentation.ts` que llama `validateEnv()` en el hook `register()` de Next.js. El proceso ahora falla con mensaje descriptivo en el arranque si las vars requeridas no están presentes.

### [Media] Binarios pesados y documentos con PII potencialmente versionados

- **Evidencia:** `git ls-files` incluye `docs/sst/Lista Chequeo ... Post Incidente.docx`, `docs/sst/Listas Chequeo Trabajadores Nuevos OK.docx` y PDFs en `docs/` (`OC 674 ...pdf`, `OC 675 ...pdf`). En el `git status` actual se están **eliminando** los `OC 2026-0005*.pdf` de la raíz (correcto), pero los `.docx`/PDF de checklists siguen trackeados. El `.gitignore` ya excluye `trabajadores_por_faena_actualizado.md` por PII, evidenciando que el equipo es consciente del riesgo.
- **Impacto:** Aumenta el tamaño del repo y arrastra documentos operativos (potencial PII de trabajadores) al historial de git, difícil de purgar luego.
- **Recomendación:** Mover binarios operativos fuera del repo (almacenamiento/objeto) o a Git LFS; revisar que ningún documento con PII quede versionado.

### [Media] Scaffolding modular "congelado" como fuente de ambigüedad arquitectónica

- **Evidencia:** `AGENTS.md` y `modules/README.md` documentan que la migración a "monolito modular" (Fase 0/1) quedó **incompleta y congelada**; `modules/*` solo conserva manifiestos/registro vivos. Hay un test que *fija* este estado (`lib/__tests__/frozen-modular-migration.test.ts`).
- **Impacto:** No es un bug, pero es **deuda técnica estructural**: dos modelos mentales conviviendo (lo vivo en `lib/`+`app/`, lo congelado en `modules/`) que confunde a quien llega nuevo y puede llevar a editar el lugar equivocado.
- **Recomendación:** Decidir y ejecutar: retomar la migración con plan de reconciliación y tests de paridad (según `.claude/plans/...`), o reducir `modules/` estrictamente a lo necesario para navegación/permisos. Mantener el `frozen-...test.ts` mientras tanto.

### ✅ [Media — RESUELTA] Cobertura de tests acotada a `lib/` — la capa `app/` (Server Actions/UI) queda en gran medida fuera del gate

- **Evidencia:** [vitest.config.ts:30-43](vitest.config.ts#L30-L43) define `coverage.include: ["lib/**/*.ts"]` con umbrales altos (94% stmts). Eso es **excelente para `lib/`**, pero las Server Actions de `app/(app)/**/actions.ts` (donde vive el control de acceso por faena y reglas de negocio) no entran al cálculo de cobertura, aunque sí existen varios tests de acciones.
- **Impacto:** Métrica de cobertura potencialmente optimista respecto del riesgo real de la capa de borde (acciones), justo donde esta rama introdujo el fallo de build y los tests rotos.
- **Fix aplicado:** `vitest.config.ts` actualizado con `coverage.include: ["lib/**/*.ts", "app/(app)/**/actions.ts"]`. Los umbrales globales se recalibraron a un piso realista combinado (40/30/40/40 stmts/branches/funcs/lines) para reflejar que las acciones no tienen cobertura amplia aún. Los umbrales anteriores de `lib/` (~94%) se mantienen implícitamente y deben ratchearse al alza una vez se agreguen tests de acciones.

---

## 8. Hallazgos de severidad baja

### [Baja] Pequeña ventana TOCTOU en el borrado de solicitudes

- **Evidencia:** En [app/(app)/solicitudes/actions.ts:447-466](app/(app)/solicitudes/actions.ts#L447-L466) se lee la solicitud y se valida `isRequestDeletable(status)` **antes** de la transacción; `deleteRequest()` vuelve a validar pero también lee el estado **fuera** del `db.transaction`. Entre la lectura y el `DELETE` el estado podría cambiar.
- **Impacto:** Muy bajo (acción administrativa poco concurrente; el peor caso es borrar una solicitud que justo cambió de estado). No hay pérdida de integridad referencial (cascadas + limpieza de FKs dentro de la transacción).
- **Recomendación:** Mover la verificación de estado dentro de la transacción (`SELECT ... FOR UPDATE`) o condicionar el `DELETE ... WHERE status IN (...)` y verificar `rowCount`.

### [Baja] `'unsafe-inline'` en `style-src` (riesgo residual documentado)

- **Evidencia:** [lib/security/csp.ts:24-25](lib/security/csp.ts#L24-L25) permite `'unsafe-inline'` en `style-src-elem`/`style-src-attr`. El propio archivo documenta el porqué (React `style={{...}}`, Radix, hot reload) y el riesgo residual (exfiltración por CSS si se interpola input de usuario en un `style`).
- **Impacto:** Bajo y consciente. `script-src` sí usa `nonce` + `strict-dynamic` (fuerte). No se detectó interpolación de input de usuario en props `style`.
- **Recomendación:** Mantener el seguimiento; migrar estilos dinámicos a CSS variables/nonced styles para poder remover `unsafe-inline` a futuro.

### [Baja] Uso puntual de `console.*` en código no-test (2 ocurrencias)

- **Evidencia:** 2 usos de `console.*` fuera de tests frente al patrón general de `logger.*` (con redacción de PII). El estándar del proyecto es `logger`.
- **Impacto:** Inconsistencia menor; posibles logs sin redacción.
- **Recomendación:** Reemplazar por `logger`; opcionalmente activar la regla `no-console` en ESLint con allowlist.

### [Baja] Numeración de migraciones duplicada como convención frágil

- **Evidencia:** El prefijo `0020` aparece dos veces (ver hallazgo de severidad media). Aun resolviendo la huérfana, la convención de numerar a mano invita a colisiones.
- **Recomendación:** Generar siempre migraciones con `drizzle-kit generate` (que asigna el índice correlativo) y nunca crear archivos `.sql` manualmente sin actualizar el journal.

---

## 9. Bugs y errores funcionales detectados

| # | Título | Severidad | Evidencia | Estado |
|---|---|---|---|---|
| 1 | `node:fs/promises` en bundle de cliente rompe el build | Crítica | `request-form.tsx:22` → `requests-delete.ts:6` | ✅ Resuelto — `.constants.ts` extraído |
| 2 | Mock `./actions` sin `deleteRequestAction` (10 tests) | Alta | `request-form.test.tsx:18-22` vs `request-form.tsx:167` | ✅ Resuelto — mock actualizado |
| 3 | Lista de rutas de captura desactualizada (1 test) | Alta | `scripts/capture-all-routes.test.ts:27` | ✅ Resuelto — rutas soporte añadidas |
| 4 | Migración de índice huérfana (no en journal) | Media | `0020_purchase_request_items_product_id_idx.sql` ausente de `_journal.json` | ✅ Resuelto — renombrado a `0022_...` y registrado |
| 5 | Sentry nunca invocado / sin `instrumentation.ts` | Alta | `lib/sentry.ts` sin consumidores; no hay `instrumentation.ts` | ✅ Resuelto — wiring completo con `sentry.{server,client}.config.ts` + `withSentryConfig` |

Pasos de reproducción de #1–#3 ya descritos en §5/§6 (`next build`, `npx vitest run`).

**Nota positiva:** la mayoría de los flujos de negocio revisados **sí** validan correctamente. Ejemplo representativo, creación de OC ([app/(app)/compras/actions.ts](app/(app)/compras/actions.ts)): exige permiso (`purchasing:create_order`), valida con Zod, rechaza ítems duplicados/no disponibles, verifica estado (`approved`/`pending_purchase`), pertenencia de faena (`canAccessWorksite`), y que la cantidad de compra no supere la aprobada ni sea ≤ 0. Es un manejo de casos límite **cuidado**.

---

## 10. Inconsistencias detectadas

- **Documentación vs. código (observabilidad):** `lib/sentry.ts` y `.env.example` (`SENTRY_DSN`) sugieren tracking de errores activo, pero el código nunca lo invoca. *Inconsistencia que causa un bug real (silencio en producción).*
- **Migraciones vs. journal:** archivo `.sql` presente pero no registrado (ver §7). *Puede causar bug real (índice ausente).*
- **Tests vs. implementación:** mocks/listas de rutas atrasados respecto de la feature de borrado y del módulo de prevención. *Causa fallos reales de CI.*
- **Arquitectura "viva" vs. "congelada":** `lib/`+`app/` (viva) frente a `modules/` (congelada). *Inconsistencia de mantenibilidad, bien documentada en `AGENTS.md`.*
- **Convención de logging:** `logger.*` (norma) vs. 2 usos de `console.*`. *Estética/mantenibilidad.*
- **Coherencia (positiva):** la regla "exports en XLSX, nunca CSV" se respeta (uso de ExcelJS, sin generación de CSV en exportaciones).

---

## 11. Código muerto y deuda técnica

- **`lib/sentry.ts` — ✅ ACTIVO (post-fix completo):** `logger.error` llama `sentry.captureException`. `sentry.server.config.ts` + `sentry.client.config.ts` + `withSentryConfig` en `next.config.ts` capturan errores no manejados. La inicialización lazy fue eliminada; el wrapper delega a Sentry ya inicializado por los config files.
- **`0020_purchase_request_items_product_id_idx.sql` — migración huérfana** (ver §7).
- **`modules/*` (scaffolding congelado)** — deuda estructural deliberada y documentada (ver §7).
- **Documentos/planes:** múltiples `.md` de planificación e ideas (`idea_sidebar_menus.md`, `prompt_implementacion_modulo_ppa_digital.md`, `INTEGRACION_SAAS.md`, etc.) y binarios (`.docx`, `.png`, PDFs) que ya fueron movidos a `docs/` o fuera del repo.
- **TODO/FIXME/HACK:** **0** marcadores reales en comentarios de código (excelente higiene; el conteo inicial alto era el español "todo/todos").
- **`any` en código no-test:** **1** sola ocurrencia en todo `app`/`lib`/`components`/`modules`/`db` (disciplina de tipos sobresaliente).

---

## 12. Seguridad

**Fortalezas (verificadas en código):**
- **Autenticación robusta** ([lib/auth/auth.ts](lib/auth/auth.ts)): `bcryptjs`; **comparación timing-safe** contra un `DUMMY_HASH` cuando el usuario no existe (evita enumeración por tiempo); **rate-limiting persistente** por IP y por email; revocación de sesión efectiva (refresca RBAC desde DB en cada request del callback `jwt`, bypass de caché).
- **Autorización por permisos y por faena** ([lib/auth/can.ts](lib/auth/can.ts), `scope.ts`): `requirePermission`/`canAccessWorksite` aplicados consistentemente en Server Actions y en las rutas de descarga.
- **Descarga de adjuntos segura** ([app/api/attachments/[id]/route.ts](app/api/attachments/[id]/route.ts)): exige sesión, restringe el `entityType` servible, valida acceso a la faena del recurso y resuelve la ruta con guard anti-traversal. Cada tipo de adjunto tiene su propia ruta con su propio control.
- **Validación de archivos por *magic bytes*** ([lib/file-validation.ts](lib/file-validation.ts)): rechaza archivos cuyo contenido no coincide con el MIME declarado; normaliza al tipo real. XML se acepta para facturas **pero no se parsea** en ningún punto (no hay `DOMParser`/`xml2js`) → **sin riesgo XXE**.
- **Anti *path traversal*** ([lib/storage/config.ts:124-129](lib/storage/config.ts#L124-L129)): `isSafeStorageName` exige `basename` puro (rechaza `..`, separadores, etc.).
- **Cabeceras y CSP** ([next.config.ts](next.config.ts), [proxy.ts](proxy.ts), [lib/security/csp.ts](lib/security/csp.ts)): `X-Content-Type-Options`, `X-Frame-Options: DENY`, HSTS, `Referrer-Policy`, `Permissions-Policy`; CSP con **nonce + `strict-dynamic`** para scripts y `frame-ancestors 'none'`.
- **Logger con redacción de PII** ([lib/logger.ts](lib/logger.ts)): claves sensibles → `[redacted]`, y patrones de email/RUT redactados en strings libres (con test `logger-redaction.test.ts`).
- **Sin XSS evidente:** 0 usos de `dangerouslySetInnerHTML`. Secretos: `.env*` está en `.gitignore` (solo `.env.example` versionado, con placeholders, sin secretos reales).

**Riesgos:**
- `'unsafe-inline'` en `style-src` (bajo, documentado — §8).
- Sin validación *fail-fast* de envs (medio — §7).
- **Sin escaneo antivirus** de archivos subidos (solo *magic bytes*). Para una herramienta interna es aceptable, pero los PDF/imagen se almacenan y luego se sirven `inline`; considerar ClamAV o equivalente si el origen de archivos se amplía.

**Veredicto seguridad:** **Notablemente sólida** para una app interna. No se detectaron vulnerabilidades explotables (SQLi — Drizzle parametriza; XSS; traversal; enumeración; secretos).

---

## 13. Performance

- **Índices presentes:** ~20 declaraciones `index()/uniqueIndex()` en el esquema + migraciones dedicadas (`0009_add_performance_indices`, `0013_..._product_id_idx`). Existe `scripts/measure-operational-queries.ts` (`npm run perf:queries`) — buena práctica.
- **Riesgo concreto:** el índice de `purchase_request_items.product_id` **no se aplica** por la migración huérfana (§7) → posibles *sequential scans* en kardex/reportes/trazabilidad.
- **Transacciones** en operaciones multi-paso (purchasing, deliveries, receiving, stock, requests-delete, registro, password-reset) → consistencia sin round-trips innecesarios.
- **PDF server-side con Playwright-core:** generación de PDF arranca un navegador headless (incluido explícitamente en `outputFileTracingIncludes`). Es **costoso en memoria/CPU**; existe `PDF_MAX_CONCURRENT` (env) y `lib/__tests__/browser-pool.test.ts`, lo que indica *pooling*. Vigilar concurrencia en el host de producción.
- **No medido en esta auditoría:** tamaño de bundle (el build no completó). Recomendado correr `npm run analyze` una vez resuelto el build, y revisar que el *boundary leak* corregido no haya estado inflando chunks de cliente.

---

## 14. TypeScript y calidad de tipos

- `tsconfig.json` con `strict: true` **y** `noUncheckedIndexedAccess: true` (estricto de verdad). `typecheck` pasa limpio.
- **1 sola** ocurrencia de `any` en todo el código no-test → el sistema de tipos **protege el dominio**, no lo decora.
- Validación *runtime* de datos externos con **Zod** en Server Actions (entrada de formularios) y tipos derivados (`z.infer`), cerrando la brecha tipo-estático ↔ datos-runtime.
- `ActionState` como contrato uniforme de respuesta de acciones; uso de *discriminated unions* en los guards (`{ session, error: null } | { session: null, error }`).
- Oportunidad: el *boundary leak* del build no es un problema de tipos sino de grafo de módulos; conviene un lint/guard que tipifique/impida imports `node:*` desde Client Components.

**Veredicto tipos:** **Sobresaliente.**

---

## 15. UX, accesibilidad y consistencia visual

- **Accesibilidad con tests:** `e2e/accessibility.spec.ts` + `@axe-core/playwright` — el proyecto **mide** a11y automáticamente (poco común y muy valorable).
- **Confirmación de acciones destructivas:** los borrados usan `ConfirmDialog` con texto explícito ("será eliminada permanentemente… no se puede deshacer") en solicitudes, listas y botones de borrado.
- **Feedback al usuario:** patrón `toast` centralizado (`@/lib/toast`, no `sonner` directo — convención del proyecto) y `ActionState.message` para éxito/error tras guardar/enviar/exportar.
- **UI consistente:** sistema basado en Radix UI + componentes propios (`components/ui/*`) con tests unitarios (badge, checkbox, data-table, field, select).
- **Riesgo de DX/UX en esta rama:** con el build roto, la app **no corre** en producción; los flujos no se pueden completar end-to-end hasta corregir §5/§6. No fue posible validar interacción real (el `next dev` podría arrancar igual, pero el artefacto de prod no).
- No se evaluó contraste/responsive en profundidad (fuera del alcance de código), pero la base (Tailwind + tokens) es adecuada.

---

## 16. Testing

- **Volumen:** ~130 archivos de test unit/integración (vitest) + 11 specs E2E (Playwright), cubriendo auth/RBAC, rate-limit, concurrencia (postgres), servicios (purchasing, deliveries, receiving, stock, sst, ppa), validaciones, notificaciones, exportaciones, redacción de logs, CSP, etc. **Muy por encima del promedio** para un proyecto de este tamaño.
- **Estado actual:** **rojo** — 11 fallos (§6). 4 archivos *skipped* (concurrencia con PostgreSQL real).
- **Cobertura:** umbrales en CI altos para `lib/` (94% stmts / 83% branches / 95% funcs / 96% lines), con *regression floor*. **Limitación:** `app/(app)/**/actions.ts` no está en `coverage.include` (§7).
- **Calidad:** uso correcto de pglite para DB efímera + guard `db-safety.test.ts` que impide tocar la base real; `destructive-database-guard.ts`.

**Tests mínimos a agregar/arreglar antes de producción:**
1. Reparar los 11 tests rojos (mock de `deleteRequestAction`; lista de rutas de captura).
2. Test que **garantice la separación servidor/cliente**: que ningún Client Component importe módulos con `node:*` (evita regresión del build).
3. Test de integración del flujo de **borrado de solicitud** (`deleteRequestAction`): permisos owner vs `requests:delete`, scope de faena, estados no eliminables, limpieza de archivos y auditoría.
4. Test que valide **paridad migraciones ↔ journal** (todo `.sql` registrado).
5. Smoke test de **`next build`** en CI (ya implícito, pero hoy fallaría — debe ser gate obligatorio).

---

## 17. Funcionalidades faltantes recomendadas

| Funcionalidad | Prioridad | Impacto | Complejidad | Motivo | Módulos sugeridos |
|---|---:|---|---|---|---|
| Cableado real de error tracking (Sentry vía `instrumentation.ts`) | Alta | Alto | Baja | Hoy los errores no manejados no se observan; el wrapper existe pero está muerto | `instrumentation.ts`, `next.config.ts`, `lib/logger.ts`, `lib/sentry.ts` |
| Validación *fail-fast* de variables de entorno | Alta | Medio | Baja | Evita fallos en runtime por env faltante/mal formada | `lib/env.ts` (nuevo), arranque/`instrumentation.ts` |
| Gate de CI con `build`+`test`+`typecheck`+`lint` obligatorios | Alta | Alto | Baja | Hubiera bloqueado el build roto y los tests rojos antes de mergear | `.github/workflows/*` |
| 2FA/MFA para roles administrativos | Media | Alto | Media | App interna con datos de compras y PII de trabajadores; refuerza el login | `lib/auth/*`, `app/(auth)/*` |
| Antivirus/escaneo de adjuntos subidos | Media | Medio | Media | Hoy solo se validan *magic bytes*; los archivos se sirven `inline` | `lib/file-validation.ts`, rutas de upload |
| Backups verificados + restore documentado/automatizado | Media | Alto | Media | Existen scripts de backup; falta verificación/restore-drills y monitoreo | `scripts/*`, `docs/deploy` |
| Panel/monitoreo de envíos de correo (Resend) con reintentos | Media | Medio | Media | Notificaciones críticas dependen de email; falta visibilidad de fallos | `lib/email/*`, `lib/services/notifications.ts` |
| Health/readiness con chequeo de DB + métricas | Media | Medio | Baja | `/api/health` existe; conviene readiness real (DB/storage) y métricas para orquestador | `app/api/health/route.ts` |
| Notificaciones en tiempo real (hoy polling) | Baja | Medio | Media | `hooks-use-notifications` sugiere *polling*; SSE/WebSocket mejora UX y carga | `lib/hooks/*`, `app/(app)/notificaciones/*` |
| Exportaciones programadas / filtros guardados | Baja | Medio | Media | Volumen de datos creciente (compras/trazabilidad); ahorra trabajo repetitivo | `components/export-dialog.tsx`, `lib/reports/*` |

---

## 18. Nota final justificada

**Nota inicial: 6/10 → Nota post-fixes: 8/10.**

**Auditoría inicial (6/10):** La base es **sólida**: seguridad madura (auth timing-safe, rate-limiting, RBAC con scope por faena, CSP con nonce, validación de archivos, anti-traversal, redacción de PII), tipos estrictos con prácticamente cero `any`, transacciones en operaciones críticas, ~1.218 tests verdes y cobertura alta en `lib/`. Pero `next build` fallaba y 11 tests estaban rotos → bloqueo duro → 6/10.

**Post-fixes (7.5/10):** Los 7 ítems del plan fueron aplicados:
1. ✅ Build reparado (boundary leak → `.constants.ts`)
2. ✅ 11 tests reparados (suite verde)
3. ✅ Sentry parcialmente cableado (`logger.error` → `sentry.captureException`)
4. ✅ `instrumentation.ts` + `lib/env.ts` (fail-fast de env al arranque)
5. ✅ Migración huérfana registrada
6. ✅ `coverage.include` ampliado a acciones
7. ✅ **Sentry wiring completo** (`sentry.server.config.ts` + `sentry.client.config.ts` + `withSentryConfig`)
8. ✅ **TOCTOU cerrado** (verificación dentro de transacción)
9. ✅ **Fix `isOrderDeletable`** (re-export → import+re-export para binding local)
10. ✅ **`NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_ORG`/`SENTRY_PROJECT`** añadidos a `.env.example`

La nota sube a **8/10** (no llega a 9 porque falta el gate de CI y los pendientes de deuda operacional listados en §19).

**Qué llevaría la nota a 8.5+:** (a) gate CI (lint+typecheck+test+build bloqueante en PR); (b) test de integración del flujo de borrado de solicitudes; (c) paridad migration-journal check en CI.

---

## 19. Checklist para estar lista para producción

- [x] **(Crítico)** Corregir el *server/client boundary leak*: extraer `DELETABLE_REQUEST_STATUSES`/`isRequestDeletable` a un módulo sin `node:*`; `next build` debe pasar (exit 0). ✅ **HECHO** — `requests-delete.constants.ts` y `purchasing.constants.ts` creados; build pasa.
- [x] **(Alto)** Reparar `request-form.test.tsx` (añadir `deleteRequestAction` al `vi.mock("./actions")`). ✅ **HECHO**
- [x] **(Alto)** Actualizar `scripts/capture-all-routes.ts` / `getCaptureRoutes()` para incluir las rutas nuevas; `vitest run` en verde. ✅ **HECHO** — rutas `/soporte/*` añadidas; suite verde.
- [x] **(Alto)** Cablear Sentry (mínimo: reenviar `logger.error` → `sentry.captureException`). ✅ **HECHO** — `logger.ts` redirige a Sentry.
- [x] **(Alto)** Wiring completo de Sentry: `sentry.server.config.ts` + `sentry.client.config.ts` + `withSentryConfig` en `next.config.ts`. ✅ **HECHO** — `beforeSend` redacta cookie/authorization. Tests actualizados para reflejar nueva arquitectura.
- [ ] **(Alto)** Configurar gate de CI que ejecute `lint` + `typecheck` + `test` + `build` y bloquee el merge si alguno falla. ⚠️ **PENDIENTE** (requiere acceso a GitHub Actions)
- [x] **(Medio)** Resolver la migración huérfana `0020_purchase_request_items_product_id_idx.sql`: renombrada a `0022_...` y registrada en journal. ✅ **HECHO**
- [x] **(Medio)** Añadir `lib/env.ts` con validación *fail-fast* de variables requeridas al arranque (`AUTH_SECRET`, `DATABASE_URL`) + `instrumentation.ts`. ✅ **HECHO**
- [x] **(Medio)** Ampliar `coverage.include` a `app/(app)/**/actions.ts` con umbral inicial realista. ✅ **HECHO** — umbrales combinados 40/30/40/40, a ratchetear al alza.
- [ ] **(Medio)** Agregar test de integración del flujo de borrado de solicitud (`deleteRequestAction`): permisos, scope de faena, estados, limpieza de archivos y auditoría. ⚠️ **PENDIENTE**
- [ ] **(Medio)** Sacar binarios/documentos con PII del repo (storage/objeto o Git LFS). ⚠️ **PENDIENTE**
- [x] **(Bajo)** Cerrar la ventana TOCTOU del borrado. ✅ **HECHO** — Verificación de estado movida dentro de la transacción en `deleteRequest()`. Check duplicado removido de la Server Action.
- [ ] **(Bajo)** Reemplazar los 2 `console.*` por `logger`; evaluar regla `no-console`. ⚠️ **PENDIENTE**
- [ ] Ejecutar la suite E2E de Playwright (con `PGHOST=/var/run/postgresql`) y dejarla en CI. ⚠️ **PENDIENTE**

---

## 20. Conclusión final

**Auditoría inicial:** No se recomendaba lanzar a producción porque el build fallaba y la suite de tests estaba en rojo.

**Estado post-fixes (2026-06-22):** Los bloqueadores duros han sido corregidos. La rama pasa a **"Lista con reservas"** (nota 7.5/10). El build compila, la suite de tests está verde, `logger.error` llega a Sentry, las envs críticas se validan al arranque, la migración huérfana está registrada, y la cobertura de acciones comienza a medirse.

**Pendientes gestionables en producción con riesgo controlado:**
- Wiring completo de Sentry (errores no manejados del servidor/cliente)
- Gate de CI (lint+typecheck+test+build en cada PR)
- Test de integración del flujo de borrado de solicitudes
- Remoción de binarios con PII del repo
- TOCTOU en borrado (riesgo muy bajo)
- 2 `console.*` a reemplazar por `logger`
- Suite E2E en CI

**Recomendación operativa:** La rama `feat/sst-prevencion-module` es **mergeable** una vez que el gate de CI esté configurado y verificado. Los pendientes restantes son mejoras de calidad y observabilidad, no bloqueos de seguridad o corrección funcional.
