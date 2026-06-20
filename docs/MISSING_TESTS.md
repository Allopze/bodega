# Cobertura de Tests — Estado Actual y Faltantes

> Actualizado: 2026-06-19  
> Base: contraste entre este documento, el checkout actual y `rg --files -g '*test*' -g '*spec*'`.

## Resumen

El análisis original estaba desactualizado: marcaba como faltantes varias áreas que ya tienen tests dedicados en el repo. Al momento de esta actualización hay **88 archivos de test/spec**.

En esta pasada se agregaron o ampliaron tests para:

- `lib/validation/servicios.ts` -> `lib/__tests__/validation-servicios.test.ts`
- `lib/validation/repuestos.ts` -> `lib/__tests__/validation-repuestos.test.ts`
- `lib/validation/sst.ts` -> `lib/__tests__/validation-sst.test.ts`
- `lib/services/notifications.ts` -> `lib/__tests__/notification-service.test.ts`
- `lib/request-types.ts` -> `lib/__tests__/request-type-permissions.test.ts`
- `lib/id.ts` -> `lib/__tests__/id.test.ts`

Verificación ejecutada:

```bash
npm test -- lib/__tests__/validation-servicios.test.ts lib/__tests__/validation-repuestos.test.ts lib/__tests__/validation-sst.test.ts lib/__tests__/notification-service.test.ts lib/__tests__/request-type-permissions.test.ts lib/__tests__/id.test.ts
```

Resultado: **6 archivos, 39 tests passed**.

## Cobertura Confirmada

Estas secciones ya no deben tratarse como faltantes sin una brecha más específica:

| Área | Evidencia |
| --- | --- |
| `lib/services/stock.ts` | `lib/__tests__/stock-service.test.ts`, `lib/__tests__/stock-concurrency-postgres.test.ts`, `lib/__tests__/stock-alerts.test.ts` |
| `lib/services/purchasing.ts` | `lib/__tests__/purchasing-service.test.ts`, `lib/__tests__/purchasing-stock-validation.test.ts`, `lib/__tests__/order-totals.test.ts`, `lib/__tests__/cancel-order-action.test.ts` |
| `lib/services/receiving.ts` | `lib/__tests__/receiving-service.test.ts`, `lib/__tests__/receiving-two-stage.test.ts`, `lib/__tests__/receiving-concurrency-postgres.test.ts` |
| `lib/services/item-state.ts` | `lib/__tests__/item-state.test.ts`, `lib/__tests__/item-state-mutations.test.ts` |
| `lib/services/notifications.ts` | `lib/__tests__/notification-service.test.ts`, `lib/__tests__/notification-permission-targeting.test.ts` |
| `lib/services/trazabilidad-export*.ts` | `lib/__tests__/trazabilidad-export.test.ts`, `lib/__tests__/trazabilidad-export-scope.test.ts`, `lib/__tests__/report-export.test.ts`, `e2e/export-volume.spec.ts` |
| `lib/validation/masters.ts` | `lib/__tests__/validation-masters.test.ts` |
| `lib/validation/servicios.ts` | `lib/__tests__/validation-servicios.test.ts` |
| `lib/validation/repuestos.ts` | `lib/__tests__/validation-repuestos.test.ts` |
| `lib/validation/sst.ts` | `lib/__tests__/validation-sst.test.ts` |
| `lib/auth/scope.ts` | `lib/__tests__/worksite-scope.test.ts`, `lib/__tests__/admin-user-scope.test.ts` |
| RBAC/bootstrap permissions | `lib/__tests__/auth-bootstrap-permissions.test.ts`, `lib/__tests__/auth-rbac.test.ts`, `lib/__tests__/auth-rbac-user-permissions.test.ts`, `lib/__tests__/auth-can.test.ts` |
| `lib/sst/date.ts` | `lib/sst/__tests__/date.test.ts` |
| `lib/sst/badges.ts` | `lib/sst/__tests__/badges.test.ts` |
| `lib/sst/cargos.ts` | `lib/sst/__tests__/cargos.test.ts` |
| `lib/sst/compliance.ts` | `lib/sst/__tests__/compliance.test.ts`, `lib/sst/__tests__/compliance-helpers.test.ts` |
| `lib/sst/definitions/*` | `lib/sst/__tests__/definitions.test.ts` |
| `lib/utils.ts` | `lib/__tests__/utils.test.ts`, `lib/__tests__/content-disposition.test.ts`, `lib/__tests__/formatting.test.ts` |
| `lib/request-types.ts` | `lib/__tests__/request-type-permissions.test.ts`, `lib/__tests__/request-type-actions-rejection.test.ts` |
| `lib/id.ts` | `lib/__tests__/id.test.ts`, `lib/__tests__/code-sequences.test.ts` |
| Componentes base principales | `components/__tests__/badge.test.tsx`, `checkbox.test.tsx`, `select.test.tsx`, `field.test.tsx`, `data-table.test.tsx` |
| Formularios App Router clave | `app/(app)/solicitudes/request-form.test.tsx`, `app/(app)/recepcion/receipt-form.test.tsx`, `app/(app)/prevencion/[id]/evaluation-detail.test.tsx`, `app/(app)/admin/usuarios/user-form.test.tsx`, `app/(app)/compras/[id]/oc-reception-cta.test.tsx` |
| E2E operativo | `e2e/admin-flow.spec.ts`, `e2e/negative-flows.spec.ts`, `e2e/worker-delivery-flow.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/purchase-flow.spec.ts`, `e2e/export-volume.spec.ts` |

## Faltantes Reales Pendientes

### Prioridad 1 — servicios con efectos y DB

- `lib/services/email-templates.ts`
  - Falta cubrir render con variables, condicionales, escape HTML, fallback/defaults, update/reset/seed.

- `lib/services/rate-limit.ts`
  - Existe `lib/__tests__/rate-limit-concurrency-postgres.test.ts`, pero faltan unit/integration tests de `checkRateLimit`, `recordFailure`, `recordSuccess` y `pruneExpiredLocks` para casos no concurrentes.

- `lib/services/dashboard.ts`
  - Falta cobertura directa para métricas globales vs. scope restringido y `getWorkQueueSnapshot`.

- `lib/services/deliveries.ts`
  - Existe cobertura E2E/concurrencia, pero faltan unit/integration tests directos de `registerWorksiteDelivery` y `registerWorkerEppDelivery` con validaciones de negocio y adjuntos.

### Prioridad 2 — server actions

Los formularios principales tienen cobertura de UI, pero las server actions todavía necesitan tests directos por archivo:

- `app/(app)/solicitudes/actions.ts`: draft, update, submit, permisos por tipo y requerimiento de ítems.
- `app/(app)/aprobaciones/actions.ts`: aprobar, rechazar, devolver y bulk approve.
- `app/(app)/compras/actions.ts`: crear, emitir, enviar y cancelar OC.
- `app/(app)/recepcion/actions.ts`: registro office/faena y validación de cantidades.
- `app/(app)/entregas/actions.ts`: entrega a trabajador/faena, stock y saldo pendiente.
- `app/(app)/admin/*/actions.ts`: CRUD de masters y permisos.
- `app/(app)/prevencion/actions.ts`: crear/cerrar evaluación, respuestas y plan de acción.

### Prioridad 3 — componentes/layout restantes

- `components/ui/dialog.tsx`: abrir/cerrar y accesibilidad.
- `components/ui/tooltip.tsx`: interacción hover/focus.
- `components/ui/tabs.tsx`: cambio de tab.
- `components/ui/pagination.tsx`: navegación y estado disabled.
- `components/layout/notification-bell.tsx`: badge de no leídas y menú.
- `components/layout/command-palette.tsx`: apertura con `Ctrl+K` y navegación.
- `components/layout/desktop-nav.tsx`: visibilidad según manifest/permisos.

### Prioridad 4 — utilidades DB/auditoría

- `lib/audit.ts`: `recordAudit`, `recordStatusChange`, limpieza con `keepYears >= 5`.
- `db/seed.ts`: idempotencia de seed y roles del sistema.
- `db/schema-consistency.test.ts`: ampliar columnas críticas de `email_templates`, `rate_limits` y `sst_evaluations` si no están ya cubiertas en el schema snapshot actual.

## Recomendación de Siguiente Pasada

1. Cubrir `email-templates.ts` con mocks/DB real para render, defaults y seed.
2. Cubrir `rate-limit.ts` casos secuenciales con DB real, dejando concurrencia separada.
3. Añadir tests directos de server actions empezando por `solicitudes/actions.ts` y `compras/actions.ts`, porque son las puertas de entrada del flujo operativo.
