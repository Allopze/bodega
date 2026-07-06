# Dead Code Report — Plataforma Chome

**Fecha de análisis:** 2026-07-05
**Alcance:** Código fuente del proyecto (excluyendo `node_modules/`, `.git/`, archivos generados)
**Metodología:** Búsqueda exhaustiva de exports sin importaciones, funciones solo usadas en tests, constantes sin consumidores, patrones de código no alcanzable, y archivos huérfanos.

---

## Tabla de Contenidos

1. [Funciones Exportadas sin Consumidores](#1-funciones-exportadas-sin-consumidores)
2. [Funciones Solo Usadas en Tests](#2-funciones-solo-usadas-en-tests)
3. [Archivos Potencialmente Huérfanos](#3-archivos-potencialmente-huérfanos)
4. [Imports No Utilizados / Código Comentado](#4-imports-no-utilizados--código-comentado)
5. [Constantes sin Consumidores](#5-constantes-sin-consumidores)
6. [Scaffolding Modular Congelado](#6-scaffolding-modular-congelado)
7. [Resumen y Recomendaciones](#7-resumen-y-recomendaciones)

---

## 1. Funciones Exportadas sin Consumidores

Estas funciones están exportadas pero **no son importadas** por ningún módulo de producción (solo en tests o en absoluto).

### 1.1 `sanitizeHeaderValue` — `lib/utils.ts:85`

- **Archivo:** `lib/utils.ts`
- **Línea:** 85
- **Estado:** ⚠️ **SIN CONSUMIDORES** — No importada en ningún archivo del proyecto (ni producción ni tests).
- **Acción recomendada:** Eliminar la función.

```typescript
// lib/utils.ts:85
export function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n\t]/g, "_").trim()
}
```

### 1.2 `useClientValidation` — `lib/hooks/use-client-validation.ts:19`

- **Archivo:** `lib/hooks/use-client-validation.ts`
- **Línea:** 19
- **Estado:** ⚠️ **Solo en tests** — Importada únicamente en `lib/__tests__/hooks.test.tsx`. Ningún componente de producción la usa.
- **Acción recomendada:** Revisar si se eliminó un componente que la usaba; considerar eliminar el hook y su test.

### 1.3 `incidentSlaBreached` — `lib/prevention/incident-sla.ts:10`

- **Archivo:** `lib/prevention/incident-sla.ts`
- **Línea:** 10
- **Estado:** ⚠️ **SIN CONSUMIDORES** — Exportada pero no importada en ningún archivo (ni producción ni tests).
- **Acción recomendada:** Eliminar la función y revisar si `INCIDENT_SLA_HOURS` (L5) tampoco se usa externamente.

### 1.4 `cleanupOldAuditLog` — `lib/audit.ts:80`

- **Archivo:** `lib/audit.ts`
- **Línea:** 80
- **Estado:** ℹ️ **Solo tests + documentación** — Referenciada en `lib/__tests__/audit.test.ts` y documentada en ADRs, pero **no ejecutada desde código de producción** (ni cron job, ni action, ni scheduled task).
- **Nota:** Es funcional (llama a la función SQL `cleanup_old_audit_log`), pero requiere invocación manual o cron.
- **Acción recomendada:** Documentar explícitamente que es de uso manual o crear un cron job.

### 1.5 `archiveOldInventoryMovements` — `lib/audit.ts:92`

- **Archivo:** `lib/audit.ts`
- **Línea:** 92
- **Estado:** ℹ️ **Solo tests + documentación** — Misma situación que `cleanupOldAuditLog`.
- **Acción recomendada:** Mismo que 1.4.

### 1.6 `getApplicableResponses` — `lib/sst/checklist.ts:59`

- **Archivo:** `lib/sst/checklist.ts`
- **Línea:** 59
- **Estado:** ℹ️ **Solo tests** — Exportada pero solo importada en `lib/sst/__tests__/checklist.test.ts`. El código de producción usa `getApplicableResponseStatuses` (wrapper) en su lugar.
- **Acción recomendada:** Podría ser internal (no exportada) ya que es consumida solo por `getApplicableResponseStatuses`.

---

## 2. Funciones Solo Usadas en Tests

Estas funciones tienen consumo real pero **exclusivamente en archivos de test**, lo que sugiere que son helpers de testing o que su uso en producción fue eliminado.

| Función | Archivo | Solo en tests de |
|---------|---------|-----------------|
| `useClientValidation` | `lib/hooks/use-client-validation.ts` | `lib/__tests__/hooks.test.tsx` |
| `useHideOnScroll` | `lib/hooks/use-hide-on-scroll.ts` | `lib/__tests__/hooks.test.tsx` |
| `computeRutDv` | `lib/rut.ts:30` | `lib/__tests__/rut.test.ts` |

**Nota sobre `useHideOnScroll`:** También es importada en `components/layout/app-shell.tsx`, por lo que **SÍ tiene consumo en producción**. Solo estaba clasificada erróneamente en la búsqueda inicial.

**Nota sobre `computeRutDv`:** Es consumida internamente por `validateRut` en el mismo archivo, por lo que **no es dead code** — es una función helper interna que correctamente no necesita ser importada externamente.

---

## 3. Archivos Potencialmente Huérfanos

Archivos que **no son importados** por ningún módulo de producción.

### 3.1 `lib/sentry.ts`

- **Archivo:** `lib/sentry.ts`
- **Estado:** Solo importado por `lib/logger.ts` (1 consumidor).
- **Veredicto:** ✅ **Vivo** — Es un wrapper used por el logger.

### 3.2 `lib/hooks/use-client-validation.ts`

- **Estado:** Solo consumido por tests.
- **Acción recomendada:** Verificar si es dead code o预留 para uso futuro.

---

## 4. Imports No Utilizados / Código Comentado

### 4.1 `eslint-disable` para `no-unused-vars` en Sentry configs

```typescript
// sentry.client.config.ts:12
// eslint-disable-next-line @typescript-eslint/no-unused-vars

// sentry.server.config.ts:12
// eslint-disable-next-line @typescript-eslint/no-unused-vars
```

- **Estado:** Los `event.exception.values` son desestructurados pero el valor extraído (`values`) no se usa directamente — se accede al primer elemento del array.
- **Acción recomendada:** Cambiar a `event.exception.values?.[0]` en lugar de desestructurar.

### 4.2 `@ts-expect-error` para PGlite en tests

Múltiples archivos de test usan `// @ts-expect-error PGlite is compatible at runtime`:

- `db/__tests__/pdtp-worksite-cascade.test.ts:12`
- `db/__tests__/pdtp-check-constraints.test.ts:11`
- `lib/__tests__/trazabilidad-export-scope.test.ts:11`
- `lib/__tests__/sst-delete-evaluation.test.ts:12`
- `lib/__tests__/stock-alerts.test.ts:13`
- `lib/__tests__/full-flow-integration.test.ts:32`
- `lib/__tests__/pdtp-evidence-gc.test.ts:14`
- `lib/__tests__/notification-permission-targeting.test.ts:11`
- `lib/__tests__/prevention-pdtp.test.ts:13`
- `lib/__tests__/requests-draft-diff.test.ts:18`
- `lib/__tests__/pdtp-reminders-dedup.test.ts:11`
- `lib/__tests__/requests-delete.test.ts:18`
- `lib/__tests__/sst-alerts.test.ts:19`
- `lib/__tests__/feedback.test.ts:11`
- `lib/__tests__/receiving-two-stage.test.ts:24`
- `lib/__tests__/trazabilidad-matrix.test.ts:11`
- `lib/__tests__/registro-action.test.ts:13`

- **Estado:** Patrón conocido y documentado — PGlite es compatible a nivel runtime con postgres-js pero los tipos difieren.
- **Acción recomendada:** Crear un tipo compartido `TestDb` que resuelva la incompatibilidad tipográfica.

### 4.3 `eslint-disable` para `react-hooks/exhaustive-deps`

```typescript
// app/(app)/prevencion/[id]/evaluation-detail/use-evaluation-detail.ts:181
// eslint-disable-next-line react-hooks/exhaustive-deps

// app/(app)/admin/usuarios/use-user-form.ts:78, 89
// eslint-disable-next-line react-hooks/exhaustive-deps
```

- **Estado:** Dependencias omitidas deliberadamente.
- **Acción recomendada:** Revisar si las dependencias omitidas son necesarias o si el efecto debería refactorizarse.

---

## 5. Constantes sin Consumidores

### 5.1 `DEFAULT_PAGE_SIZE` — `lib/constants.ts:9`

- **Valor:** `25`
- **Estado:** ✅ **Vivo** — Definida y referenciada en tests (`lib/__tests__/constants.test.ts`), pero **no importada por ningún módulo de producción**. Los módulos usan constantes específicas como `SOLICITUDES_PAGE_SIZE`, `ORDERS_PAGE_SIZE`, etc.
- **Acción recomendada:** Verificar si es fallback o si se puede eliminar.

### 5.2 Otras constantes de paginación

| Constante | Valor | Consumidores en producción |
|-----------|-------|---------------------------|
| `SOLICITUDES_PAGE_SIZE` | 25 | ✅ `app/(app)/solicitudes/page.tsx` |
| `ORDERS_PAGE_SIZE` | 25 | ✅ `app/(app)/compras/page.tsx` |
| `APPROVAL_REQUESTS_PAGE_SIZE` | 20 | ✅ `app/(app)/aprobaciones/page.tsx` |
| `HISTORY_PAGE_SIZE` | 25 | ✅ `app/(app)/entregas/page.tsx` |
| `KARDEX_PAGE_SIZE` | 25 | ✅ `app/(app)/bodega/page.tsx` |
| `RECEPCION_PAGE_SIZE` | 25 | ✅ `app/(app)/recepcion/page.tsx` |
| `TRACEABILITY_PAGE_SIZE` | 50 | ✅ `lib/services/trazabilidad-matrix.ts` + `app/(app)/trazabilidad/page.tsx` |
| `TRACEABILITY_ALERT_SCAN_LIMIT` | 1000 | ✅ `lib/services/trazabilidad-matrix.ts` + `app/(app)/trazabilidad/page.tsx` |

**Veredicto:** Todas las constantes de paginación específicas tienen consumo real.

---

## 6. Scaffolding Modular Congelado

Según `AGENTS.md` y `modules/README.md`, el scaffolding modular fue "congelado" el 2026-06-14. Los siguientes archivos en `modules/` son los **únicos vivos** y no deben tocarse para lógica de negocio:

| Archivo | Propósito |
|---------|-----------|
| `modules/registry.ts` | Registro de módulos |
| `modules/permissions.ts` | Tipos y exports de permisos |
| `modules/manifest-types.ts` | Interfaces de manifests |
| `modules/*/manifest.ts` | Manifests de cada módulo |

**Archivos eliminados (Fase 0/1):** `core/`, `modules/*/{services,actions,schema,validation}`

**Nota:** Este scaffolding **no es dead code** — es una capa viva de navegación, permisos y seed. Sin embargo, representa deuda técnica documentada.

---

## 7. Resumen y Recomendaciones

### Dead Code Confirmado (Eliminar)

| Prioridad | Archivo | Línea | Elemento | Razón |
|-----------|---------|-------|----------|-------|
| 🔴 Alta | `lib/utils.ts` | 85 | `sanitizeHeaderValue()` | 0 consumidores en producción ni tests |
| 🟡 Media | `lib/prevention/incident-sla.ts` | 10 | `incidentSlaBreached()` | 0 consumidores (ni producción ni tests) |
| 🟡 Media | `lib/hooks/use-client-validation.ts` | 19 | `useClientValidation()` | Solo usado en tests, no en componentes |

### Código Funcional sin Invocación Automática

| Prioridad | Archivo | Línea | Elemento | Razón |
|-----------|---------|-------|----------|-------|
| 🟡 Media | `lib/audit.ts` | 80 | `cleanupOldAuditLog()` | Solo tests; requiere invocación manual/cron |
| 🟡 Media | `lib/audit.ts` | 92 | `archiveOldInventoryMovements()` | Solo tests; requiere invocación manual/cron |

### Mejoras de Calidad (No es dead code pero mejora mantenibilidad)

| Prioridad | Archivo | Línea | Elemento | Acción |
|-----------|---------|-------|----------|--------|
| 🟢 Baja | `sentry.client.config.ts` | 12 | `eslint-disable @typescript-eslint/no-unused-vars` | Refactorizar desestructuración |
| 🟢 Baja | `sentry.server.config.ts` | 12 | `eslint-disable @typescript-eslint/no-unused-vars` | Refactorizar desestructuración |
| 🟢 Baja | Múltiples archivos test | — | `@ts-expect-error PGlite` | Crear tipo `TestDb` compartido |
| 🟢 Baja | `use-evaluation-detail.ts` | 181 | `eslint-disable exhaustive-deps` | Revisar deps omitidas |
| 🟢 Baja | `use-user-form.ts` | 78, 89 | `eslint-disable exhaustive-deps` | Revisar deps omitidas |

### Constantes/Archivos Verificados como Vivos

- ✅ `lib/constants.ts` — Todas las constantes de paginación tienen consumidores
- ✅ `lib/utils.ts` — `formatCLP`, `formatQty`, `toCode`, `toTitleCase`, `getInitials`, `escapeHtml`, `encodeContentDisposition` — todos usados en producción
- ✅ `lib/sentry.ts` — Usado por `lib/logger.ts`
- ✅ `lib/order-totals.ts` — Usado en 3 archivos de producción
- ✅ `lib/pagination.ts` — Usado en 6+ archivos de producción
- ✅ `modules/*/manifest.ts` — Vivis como capa de navegación/permisos

---

*Documento generado automáticamente por análisis de código. Verificar cada hallazgo antes de eliminar.*
