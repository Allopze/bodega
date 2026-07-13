/**
 * Archivos de test que usan @electric-sql/pglite (Postgres WASM in-memory).
 *
 * Cada uno instancia su propia BD y ejecuta migraciones completas, lo que
 * satura CPU si se ejecutan en paralelo. Se asignan a un proyecto vitest
 * separado con fileParallelism: false.
 *
 * ⚠️  Al agregar un nuevo test PGlite: agrégalo aquí para que se excluya
 *     del proyecto paralelo y se ejecute secuencialmente.
 */
export const pgliteTestFiles = [
  "db/schema-consistency.test.ts",
  "db/__tests__/pdtp-worksite-cascade.test.ts",
  "db/__tests__/pdtp-check-constraints.test.ts",
  "lib/__tests__/admin-user-scope.test.ts",
  "lib/__tests__/bootstrap.test.ts",
  "lib/__tests__/code-sequences.test.ts",
  "lib/__tests__/feedback.test.ts",
  "lib/__tests__/fuel-cycle-integration.test.ts",
  "lib/__tests__/full-flow-integration.test.ts",
  "lib/__tests__/integration-rbac-sequences.test.ts",
  "lib/__tests__/item-state-mutations.test.ts",
  "lib/__tests__/notification-permission-targeting.test.ts",
  "lib/__tests__/notification-service.test.ts",
  "lib/__tests__/pdtp-evidence-gc.test.ts",
  "lib/__tests__/pdtp-reminders-dedup.test.ts",
  "lib/__tests__/physical-inventory-service.test.ts",
  "lib/__tests__/prevention-pdtp.test.ts",
  "lib/__tests__/purchase-order-edit-items.test.ts",
  "lib/__tests__/purchasing-service.test.ts",
  "lib/__tests__/receiving-two-stage.test.ts",
  "lib/__tests__/registro-action.test.ts",
  "lib/__tests__/requests-delete.test.ts",
  "lib/__tests__/requests-draft-diff.test.ts",
  "lib/__tests__/resume-item-action.test.ts",
  "lib/__tests__/sst-alerts.test.ts",
  "lib/__tests__/sst-delete-evaluation.test.ts",
  "lib/__tests__/sst-integrity-constraints.test.ts",
  "lib/__tests__/stock-alerts.test.ts",
  "lib/__tests__/stock-export.test.ts",
  "lib/__tests__/stock-service.test.ts",
  "lib/__tests__/trazabilidad-export-scope.test.ts",
  "lib/__tests__/trazabilidad-item.test.ts",
  "lib/__tests__/trazabilidad-matrix.test.ts",
]
