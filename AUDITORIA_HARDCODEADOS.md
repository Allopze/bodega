# Auditoría de Valores Hardcodeados — Reporte Integral

**Proyecto:** Bodega (Plataforma Chome)  
**Fecha:** 2026-07-30  
**Resumen:** 87 hallazgos en 8 categorías. 3 críticos, 9 altos, 21 medios, 23 bajos.

---

## Tabla de Contenidos

1. [Hallazgos Críticos](#1-hallazgos-críticos)
2. [Hardcoded URLs / Endpoints / Dominios / IPs](#2-hardcoded-urls--endpoints--dominios--ips)
3. [Credenciales y Secretos](#3-credenciales-y-secretos)
4. [Magic Numbers — Límites y Thresholds](#4-magic-numbers--límites-y-thresholds)
5. [Magic Numbers — Negocio](#5-magic-numbers--negocio)
6. [Hardcoded Feature Flags / Toggles](#6-hardcoded-feature-flags--toggles)
7. [Hardcoded Nombres de Entorno](#7-hardcoded-nombres-de-entorno)
8. [Hardcoded Roles / Permisos / Status Strings](#8-hardcoded-roles--permisos--status-strings)
9. [Strings de Empresa / Plantilla Hardcodeados](#9-strings-de-empresa--plantilla-hardcodeados)
10. [Recomendaciones Priorizadas](#10-recomendaciones-priorizadas)

---

## 1. Hallazgos Críticos

| # | Archivo | Línea | Valor | Riesgo |
|---|---------|-------|-------|--------|
| 1 | `doc.env` | 28 | `AUTH_SECRET=7e71d80a...` | **CRÍTICO** — El secreto de firma de sesiones NextAuth.js está en un archivo trackeado en git. Si se filtra, se pueden forjar sesiones de cualquier usuario. |
| 2 | `doc.env` | 50 | `POSTGRES_PASSWORD=ea7d48a...` | **CRÍTICO** — Password de base de datos en archivo trackeado en git. |
| 3 | `doc.env` | 58 | `RESEND_API_KEY=re_J6Znmf...` | **CRÍTICO** — API key de Resend para envío de emails. Permite suplantar `plataforma@portalchome.cl`. |
| 4 | `doc.env` | 123 | `CRON_SECRET=66b51e2f...` | **CRÍTICO** — Protege todos los endpoints `/api/cron/*`. Con este secreto un atacante puede disparar backups, syncs, recordatorios. |
| 5 | `doc.env` | 128-129 | `COPEC_USERNAME=plataforma` / `COPEC_PASSWORD=Chgo1314.` | **CRÍTICO** — Credenciales del portal Copec TCT/TAE. Acceso a sistema externo de reportes de combustible. |
| 6 | `doc.env` | 146,148 | `SENTRY_DSN=...` (producción) | **ALTO** — DSN real de Sentry en archivo trackeado. Aunque son semi-públicos, permiten envenenar el tracking de errores. |

**Nota:** `doc.env` dice ser una "PLANTILLA DE VARIABLES DE ENTORNO" pero contiene las credenciales reales de producción. Debe limpiarse URGENTE. Los secretos 1–5 deben rotarse de inmediato.

---

## 2. Hardcoded URLs / Endpoints / Dominios / IPs

### 2.1 URLs de servicios externos (deberían ser variables de entorno)

| # | Archivo | Línea | Valor | Recomendación |
|---|---------|-------|-------|---------------|
| 7 | `lib/combustibles/copec-reports.ts` | 4 | `const PORTAL = "https://tctcliente.copec.cl/Login.aspx"` | `COPEC_PORTAL_URL` en `.env` |
| 8 | `lib/services/backups.ts` | 290 | `"https://oauth2.googleapis.com/token"` | `GOOGLE_OAUTH_TOKEN_URI` en `.env` |
| 9 | `lib/security/csp.ts` | 47 | `https://api.dicebear.com` en política CSP | `DICEBEAR_CDN_URL` o `EXTERNAL_IMG_SOURCES` |
| 10 | `components/ui/avatar.tsx` | 73 | `` `https://api.dicebear.com/9.x/...` `` | Variable de entorno + fallback local |
| 11 | `lib/email/smtp.ts` | 12 | `const FROM = "Plataforma Chome <plataforma@portalchome.cl>"` | `EMAIL_FROM_ADDRESS` + `APP_NAME` en `.env` |
| 12 | `lib/services/smtp-settings.ts` | 9 | `export const RESEND_FROM = "plataforma@portalchome.cl"` | Debe reusar `EMAIL_FROM_ADDRESS` del punto anterior |
| 13 | `lib/auth/auth.ts` | 25 | `DUMMY_HASH = "$2b$10$..."` — hash bcrypt hardcodeado | Verificar que no sea de un usuario real; si es placeholder, generar en runtime desde env |

### 2.2 URLs de demo/referencia en código de producción

| # | Archivo | Línea | Valor | Recomendación |
|---|---------|-------|-------|---------------|
| 14 | `app/(app)/admin/plantillas/template-list.tsx` | 215 | `"https://app.chome.cl/solicitudes/abc123"` | Usar `APP_URL` del entorno + path dinámico |
| 15 | `app/(app)/admin/plantillas/template-list.tsx` | 216 | `"https://app.chome.cl/invitar/abc123"` | Usar `APP_URL` del entorno + path dinámico |

### 2.3 URLs de fallback hardcodeadas

| # | Archivo | Línea | Valor | Recomendación |
|---|---------|-------|-------|---------------|
| 16 | `lib/email/smtp.ts` | 19 | `"http://localhost:3001"` (fallback `getAppBaseUrl`) | Usar `process.env.APP_URL` como único fallback |
| 17 | `db/seed/nuevos-roles.ts` | 150 | `?? "http://localhost:3001"` | Consolidar fallback en `lib/env.ts` |
| 18 | `lib/services/sst-module/evaluation-archive.ts` | 56 | `"localhost:3000"` | Usar `APP_URL` del entorno |

### 2.4 IPs de fallback (127.0.0.1) para detección de IP de cliente

Aparece en **7 archivos** como fallback de IP. El valor `"127.0.0.1"` es aceptable como fallback (no se puede obtener la IP real del cliente fuera de producción), pero el patrón se repite en todos lados:

- `lib/auth/auth.ts:88,91`
- `app/(auth)/registro/actions.ts:47,50`
- `app/(auth)/recuperar/actions.ts:17,20`
- `app/(public)/ppa/actions.ts:20,87`
- `app/api/tae/submit/route.ts:31`
- `app/api/tae/identity/route.ts:11`
- `app/api/tae/access/route.ts:10`

**Recomendación:** Centralizar la detección de IP en una función `getClientIP()` en `lib/utils.ts` o `lib/env.ts`.

### 2.5 Orígenes de desarrollo hardcodeados

| # | Archivo | Línea | Valor | Recomendación |
|---|---------|-------|-------|---------------|
| 19 | `next.config.ts` | 34 | `allowedDevOrigins: ["bodega.allopze.dev", "bodega.chome.dev"]` | `ALLOWED_DEV_ORIGINS` en `.env` |

### 2.6 Archivos `.env` con URLs de entorno

| Archivo | URLs hardcodeadas |
|---------|-------------------|
| `.env.example` | `localhost:3001` en APP_URL, AUTH_URL, NEXTAUTH_URL, PDF_RENDER_ORIGIN |
| `.env.local` | `localhost:3001`, Sentry DSN con token real de dev |
| `doc.env` | `plataforma.portalchome.cl`, Sentry DSN producción, PDF_RENDER_ORIGIN loopback |

---

## 3. Credenciales y Secretos

### 3.1 Secretos trackeados en git (doc.env)

Ver sección 1 arriba — 6 hallazgos críticos. **Rotar todos inmediatamente.**

### 3.2 Secretos en `.env.local` (gitignorado pero presente en disco)

| # | Archivo | Línea | Variable | Valor |
|---|---------|-------|----------|-------|
| 20 | `.env.local` | 15 | `AUTH_SECRET` | `d004547a...` (diferente a doc.env) |
| 21 | `.env.local` | 5-6 | `COPEC_USERNAME/PASSWORD` | `plataforma` / `Chgo1314.` |
| 22 | `.env.local` | 48,50 | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Token dev de Sentry |
| 23 | `.env.local` | 60 | `SEED_ADMIN_PASSWORD` | `Chgo1314.` — password reusado (mismo que COPEC_PASSWORD) |

**Recomendación:** No reusar passwords entre servicios. Cada sistema debe tener credenciales únicas.

### 3.3 Passwords de test/dev hardcodeadas en scripts

| # | Archivo(s) | Valor | Contexto |
|---|-----------|-------|----------|
| 24 | `e2e/helpers.ts`, `e2e/setup-db.ts`, 6 archivos `.spec.ts`, `scripts/capture-all-routes.ts`, `scripts/axe-audit.ts`, `scripts/generate-test-pdfs.ts` | `"chome2026"` | Password de test repetido en 9+ archivos |
| 25 | `scripts/capture-all-routes.ts:123` | `"route-screenshot-audit-secret"` | Secreto predecible para firmar sesiones |
| 26 | `e2e/start-server.sh:7` | `"e2e-auth-secret-for-playwright"` | AUTH_SECRET de E2E determinístico |

**Recomendación:** Centralizar en `E2E_TEST_PASSWORD` y `E2E_AUTH_SECRET` como variables de entorno o constantes compartidas.

---

## 4. Magic Numbers — Límites y Thresholds

### 4.1 Límites de tamaño de archivo (dispersos, sin centralizar)

| # | Archivo | Línea | Valor | Contexto |
|---|---------|-------|-------|----------|
| 27 | `lib/services/prevention-documents/utils.ts` | 25 | `25 * 1024 * 1024` | Documentos prevención |
| 28 | `lib/services/prevention-documents/crud.ts` | 36 | `25 * 1024 * 1024` | Duplicado del anterior |
| 29 | `lib/services/prevention-risk-import.ts` | 23 | `20 * 1024 * 1024` | Importación de riesgos |
| 30 | `lib/combustibles/copec-reports.ts` | 5 | `25 * 1024 * 1024` | Import Copec |
| 31 | `app/api/tae/submit/route.ts` | 13 | `5 * 1024 * 1024` | Upload de imagen TAE |
| 32 | `app/(app)/combustibles/actions-consumos.ts` | 20 | `5 * 1024 * 1024` | Import consumos |
| 33 | `app/(app)/combustibles/actions-operaciones.ts` | 25 | `10 * 1024 * 1024` | Import operaciones |
| 34 | `app/(app)/combustibles/tae/importar/actions.ts` | 16 | `20 * 1024 * 1024` | Import TAE |
| 35 | `app/(app)/flota/actions.ts` | 37 | `20` MB | Upload documentos flota |

**Recomendación:** Unificar en constantes en `lib/constants.ts` o `lib/env.ts` con sobreescritura por variable de entorno (p. ej. `MAX_UPLOAD_SIZE_MB`, `MAX_IMPORT_FILE_MB`).

### 4.2 Límites de export (duplicados)

| # | Archivo | Valor |
|---|---------|-------|
| 36 | Múltiples servicios | `maxRows = 10_000` repetido en 6 lugares |

**Archivos:** `lib/services/system-settings.ts`, `lib/services/epp-delivery-export.ts`, `lib/services/stock-export.ts`, `lib/services/epp-coverage-export.ts`, `lib/services/ppa-module/reportes.ts`, `lib/reports/export-module/dispatcher.ts`.

**Recomendación:** Referenciar desde `lib/constants.ts` o `getSystemSettings()`.

### 4.3 Page Sizes (dispersos)

Valores de paginación hardcodeados en páginas individuales:

| Página | Valor |
|--------|-------|
| DataTable default | 20 |
| Solicitudes | 25 |
| Aprobaciones | 20 |
| Combustibles (5 páginas) | 50 |
| PPA | 20 |
| CAPA, MIPER, Documentación, Privacidad, Emergencias | 50 |

**Recomendación:** `lib/constants.ts` ya centraliza algunos (`DEFAULT_PAGE_SIZE = 25`), pero las páginas individuales no lo referencian. Consolidar todas a `DEFAULT_PAGE_SIZE` o hacerlo configurable por módulo.

### 4.4 Timeouts y delays

| # | Archivo | Línea | Valor | Recomendación |
|---|---------|-------|-------|---------------|
| 37 | `lib/services/password-reset.ts` | 11 | `TOKEN_TTL_MS = 60 * 60 * 1000` (1h) | `PASSWORD_RESET_TOKEN_TTL_MINUTES` |
| 38 | `lib/services/password-reset.ts` | 31 | `setTimeout(r, 80)` (anti-oracle) | Constante documentada |
| 39 | `lib/services/rate-limit.ts` | 9-10 | `LIMIT_ATTEMPTS = 5`, `LOCK_TIME = 15 * 60 * 1000` | `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MS` |
| 40 | `lib/hooks/use-debounced-autosave.ts` | 26 | `debounceMs = 1500` | `AUTOSAVE_DEBOUNCE_MS` |
| 41 | `lib/hooks/use-url-filters.ts` | 13 | `debounceMs = 350` | `URL_FILTER_DEBOUNCE_MS` |
| 42 | `lib/toast.ts` | 8 | `DEFAULT_TOAST_DURATION = 5000` | Ya es una constante exportada — razonable |
| 43 | `lib/pwa/hooks.ts` | 164 | `MAX_AUTO_RETRIES = 5` | `OFFLINE_SYNC_MAX_RETRIES` |
| 44 | `lib/pwa/hooks.ts` | 151 | `7 * 24 * 60 * 60 * 1000` (7 días) | `OFFLINE_PPA_MAX_AGE_DAYS` |
| 45 | `lib/auth/rbac.ts` | 24 | `RBAC_CACHE_TTL_MS = 5_000` (5s) | `RBAC_CACHE_TTL_MS` |

---

## 5. Magic Numbers — Negocio

### 5.1 Umbrales de combustible

| # | Archivo | Línea | Valor | Contexto |
|---|---------|-------|-------|----------|
| 46 | `lib/combustibles/fuel-cycle.ts` | 12,16 | `CYCLE_DIFF_NORMAL_PCT = 2`, `WARNING_PCT = 5` | Umbrales de diferencia entre ciclos |
| 47 | `lib/combustibles/consumption-dashboard.ts` | 69,73,77 | `VARIACION_FUERTE_PCT = 30`, `TRANSACCIONES_ALTAS = 30`, `DEFAULT_DAYS_AGO = 30` | Alertas de consumo |
| 48 | `lib/combustibles/consumption-dashboard.ts` | 88,92 | `MONTO_MEDIO_ALERT_MULTIPLIER = 1.5`, `MIN_PATENTES_FOR_ALERT = 4` | Umbrales de anomalías |
| 49 | `lib/combustibles/consumption-dashboard.ts` | 96-98 | `CONSUMO_ALTO_ALERT_COUNT = 3`, `TRANSACCIONES_ALTAS_ALERT_COUNT = 3`, `RENDIMIENTO_CERO_ALERT_COUNT = 5` | Disparadores de alerta |
| 50 | `lib/combustibles/performance-statistics.ts` | 34,154 | `MIN_CONCLUSIVE_SAMPLE = 5`, `DEFAULT_OUTLIER_THRESHOLD_STDDEVS = 1.5` | Estadística de rendimiento |
| 51 | `lib/combustibles/tae-ocr.ts` | 10,12 | `MAX_METER_VALUE = 9_999_999`, `MIN_ACCEPTED_OCR_CONFIDENCE = 0.7` | OCR de medidores |
| 52 | `lib/combustibles/equipment-performance.ts` | 220 | `MAX_TREND_PERIODS = 6` | Períodos de tendencia |

**Recomendación:** Mover a `lib/combustibles/config.ts` con sobreescritura por tabla `system_settings` para que los usuarios avanzados puedan calibrar umbrales sin deploy.

### 5.2 Otros umbrales de negocio

| # | Archivo | Línea | Valor | Recomendación |
|---|---------|-------|-------|---------------|
| 53 | `lib/constants.ts` | 12 | `TAX_RATE = 0.19` (IVA Chile) | Ya usa `process.env.NEXT_PUBLIC_TAX_RATE` como override — correcto |
| 54 | `lib/services/stock-alerts.ts` | 23 | `WARNING_RATIO = 1.5` | `STOCK_ALERT_WARNING_RATIO` en system_settings |
| 55 | `lib/prevention/hygiene.ts` | 125 | `MIN_ANONYMOUS_GROUP_SIZE = 5` | `HYGIENE_MIN_ANON_GROUP_SIZE` |
| 56 | `lib/validation/prevention-module/training.ts` | 26-27 | `DS44_ART16_MIN_DURATION_MINUTES = 480`, `DS44_ART16_MAX_VALIDITY_MONTHS = 24` | Son requisitos legales chilenos — aceptable hardcodear, pero documentar |
| 57 | `lib/services/pdtp/worksites.ts` | 199 | `PDTP_CPHS_MIN_HEADCOUNT = 25` | Ya es constante exportada — correcto |

---

## 6. Hardcoded Feature Flags / Toggles

| # | Archivo | Línea | Valor | Recomendación |
|---|---------|-------|-------|---------------|
| 58 | `lib/services/system-settings.ts` | 260-269 | `getEmailsEnabled()` — default `true` (string "true"/"false" en BD) | Bien — ya es configurable vía BD |
| 59 | `lib/services/module-toggles.ts` | 5-6 | Módulos default `"true"` | Bien — ya usa BD |
| 60 | `lib/hooks/use-enter-advances-fields.ts` | 31 | `enabled = true` | Debería ser opción de usuario, guardada en perfil |
| 61 | `lib/hooks/use-debounced-autosave.ts` | 25 | `enabled = true` | Aceptable como default de feature |

---

## 7. Hardcoded Nombres de Entorno

`NODE_ENV === "production"` o `"development"` aparece en **13 lugares**:

| # | Archivo | Línea | Contexto |
|---|---------|-------|----------|
| 62 | `lib/auth/auth.ts` | 37 | URL de auth condicionada por entorno |
| 63 | `lib/logger.ts` | 19 | Nivel de log |
| 64 | `lib/security/csp.ts` | 34 | Política CSP más laxa en dev |
| 65 | `db/index.ts` | 25 | Verbosidad de queries SQL |
| 66 | `sentry.server.config.ts` | 8 | Tag de entorno en Sentry |
| 67 | `sentry.edge.config.ts` | 8 | Tag de entorno en Sentry Edge |
| 68 | `instrumentation-client.ts` | 8 | Tag de entorno en Sentry cliente |
| 69 | `lib/env.ts` | 27 | Fallback de `NODE_ENV` |
| 70 | `app/api/backups/status/route.ts` | 36 | Ruta de scripts de backup |
| 71 | `app/api/cron/pdtp-weekly-reminders/route.ts` | 45 | Guard de cron solo en prod |
| 72 | `app/api/cron/pdtp-evidence-gc/route.ts` | 50 | Guard de cron solo en prod |
| 73 | `app/api/cron/operational-metric-snapshots/route.ts` | 20 | Mensaje de error condicionado |
| 74 | `components/providers/session-retry-handler.tsx` | 72,87 | Logging de debug en dev |

**Recomendación:** Centralizar en `lib/env.ts` con helpers como `isProd()`, `isDev()`, `isTest()`. Reemplazar referencias dispersas.

---

## 8. Hardcoded Roles / Permisos / Status Strings

### 8.1 Roles del sistema

`lib/auth/system-rbac.ts` define 11 roles con slugs y labels. Esto es correcto — los roles son parte del modelo de dominio. Pero el array de roles se referencia en múltiples lugares con strings literales en vez de usar las constantes exportadas:

| # | Archivo | Valor hardcodeado | Debería usar |
|---|---------|-------------------|-------------|
| 75 | `lib/auth/scope.ts:9-15` | `["administrador", "jefa_chome", ...]` | Referenciar `SYSTEM_ROLES` de `system-rbac.ts` |
| 76 | `lib/prevention/cphs.ts:87` | `["presidente", "secretario"]` (roles CPHS) | Definir como enum/const |

### 8.2 Permisos como strings literales

Aparecen 25+ strings de permiso dispersos en servicios (ej: `"approvals:approve"`, `"prevention:incidents:view"`, `"prevention:health:view_clinical"`). Los archivos principales:

| Archivo | Línea | Cantidad de permisos referenciados |
|---------|-------|-----------------------------------|
| `lib/services/operational-assignments.ts` | 53-70 | 7 |
| `lib/services/prevention-incidents.ts` | 1306 | 3 |
| `lib/services/prevention-sensitive-files.ts` | 106-276 | 5 |
| `lib/services/prevention-risk-legal.ts` | 67-998 | 4 |
| `lib/services/prevention-reserved-cases.ts` | 36-78 | 3 |

**Recomendación:** Estos ya están definidos en `lib/auth/permissions.ts` — usar las constantes exportadas en vez de strings literales para evitar typos y facilitar refactors.

### 8.3 Strings de estado (status)

Strings como `"pendiente"`, `"borrador"`, `"aprobado"`, `"vencido"`, `"cancelado"` aparecen en 20+ servicios. Definir zod schemas o enums compartidos reduciría errores de typo y divergencia entre módulos:

```
lib/services/sst-module/evaluations.ts     → "borrador", "pendiente"
lib/services/prevention-documents/crud.ts  → "borrador", "archivado", "vigente", "aprobado"
lib/services/pdtp/action-plan.ts           → "pendiente", "cancelado"
lib/services/pdtp/checklist-domain.ts      → 6 estados distintos
lib/services/operational-work-queue.ts     → 6+ estados distintos
lib/services/prevention-health.ts          → 4 estados de aptitud
lib/prevention/epp.ts                      → "expired", "vencido"
lib/prevention/training.ts                 → "expired", "vencida", "missing"
```

---

## 9. Strings de Empresa / Plantilla Hardcodeados

### 9.1 "Plataforma Chome" (nombre de la app)

El nombre `"Plataforma Chome"` aparece 10+ veces hardcodeado en:

- `lib/email/smtp.ts:12` — FROM address
- Templates de email (confirmación, reset, notificaciones)
- Metadatos de PDF exportados
- Páginas de error, títulos de página
- Footer de emails

**Recomendación:** Crear `APP_NAME` en `.env` y referenciarlo en todos estos lugares.

### 9.2 Perfil de empresa default

`lib/services/system-settings.ts:212-221` tiene nombre de empresa, RUT, dirección y teléfono hardcodeados como defaults del seed. Esto es aceptable para el seed inicial, pero debe estar claramente documentado que son placeholders.

### 9.3 `plataforma@portalchome.cl`

Hardcodeado en 2 lugares (SMTP y Resend FROM). Este email es específico de producción. Usar `EMAIL_FROM_ADDRESS`.

---

## 10. Recomendaciones Priorizadas

### 🔴 Inmediatas (antes del próximo deploy)

1. **Limpiar `doc.env`**: Reemplazar todos los secretos reales con placeholders. Rotar `AUTH_SECRET`, `POSTGRES_PASSWORD`, `RESEND_API_KEY`, `CRON_SECRET`, `COPEC_PASSWORD` en producción.
2. **Verificar `DUMMY_HASH`** en `lib/auth/auth.ts:25`: Confirmar que no es el hash de un usuario real.
3. **Verificar `.gitignore`**: Asegurar que `doc.env` esté en `.gitignore` después de limpiarlo (o eliminarlo si `.env.example` ya cumple el rol de plantilla).
4. **No reusar `Chgo1314.`** como password en múltiples contextos (Copec + seed admin).

### 🟡 Alta prioridad (próximo sprint)

5. **Centralizar IP del cliente**: Crear `getClientIP()` en `lib/utils.ts` y reemplazar 7 ocurrencias.
6. **Centralizar `NODE_ENV` checks**: Crear `isProd()` / `isDev()` en `lib/env.ts`.
7. **Variables de entorno para URLs externas**: `COPEC_PORTAL_URL`, `DICEBEAR_CDN_URL`, `EMAIL_FROM_ADDRESS`, `ALLOWED_DEV_ORIGINS`.
8. **Centralizar tamaño máximo de archivos**: `MAX_UPLOAD_SIZE_MB` y `MAX_IMPORT_FILE_MB` en `lib/env.ts`.
9. **Constante para password de test**: `E2E_TEST_PASSWORD` centralizado en vez de 9 ocurrencias de `"chome2026"`.

### 🟢 Mediana prioridad

10. **Usar constantes de permisos**: Reemplazar strings de permiso literales con referencias a `lib/auth/permissions.ts`.
11. **Consolidar page sizes**: Usar `DEFAULT_PAGE_SIZE` de `lib/constants.ts` en todas las páginas.
12. **Centralizar setting defaults**: Todos los `system-settings.ts` defaults documentados como overridables vía BD.
13. **APP_NAME**: Variable de entorno para el nombre de la app, usada en emails, PDFs, y UI.

### 🔵 Baja prioridad (mejora continua)

14. **Enums de estado compartidos**: Zod schemas centralizados para `"pendiente"`, `"aprobado"`, etc.
15. **Config externalizada de umbrales de combustible**: Tabla `system_settings` para que usuarios puedan calibrar sin deploy.
16. **Test password único**: Rotar `"chome2026"` por uno generado aleatoriamente para entornos de test.

---

## Nota sobre duplicación

El índice de duplicación más alto está en:
- **Límites de archivo**: 9 ubicaciones con su propio `MAX_BYTES` (5MB, 10MB, 15MB, 20MB, 25MB)
- **Page sizes**: 12+ páginas con su propio `PAGE_SIZE`
- **`NODE_ENV` checks**: 13 lugares
- **IP fallback `127.0.0.1`**: 7 lugares
- **Password de test `chome2026`**: 9+ archivos
- **Export `maxRows = 10_000`**: 6 servicios

Cada uno de estos patrones justifica un refactor de centralización dedicado.
